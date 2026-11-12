package main

// 本地 HTTP 服务：/、三个 /api 端点与 server.js 完全同契约。
// 另外提供 /api/desktop/<channel>，把 Electron 的 ipcRenderer 调用映射成
// 普通的同源 POST——这样 desktop/preload.js 里那套右键面板、滑块、拖动逻辑
// 一行都不用改，只需把 require('electron') 换成这个 shim。

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
)

var (
	gBaseURL          string
	reRequireElectron = regexp.MustCompile(`(?m)^\s*const\s*\{\s*ipcRenderer\s*\}\s*=\s*require\('electron'\);\s*$`)
)

func writeJSON(w http.ResponseWriter, status int, v any) {
	b, _ := json.Marshal(v)
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Length", fmt.Sprint(len(b)))
	w.WriteHeader(status)
	_, _ = w.Write(b)
}

func writeText(w http.ResponseWriter, status int, text string) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_, _ = io.WriteString(w, text)
}

// bridgeJS 把现成的 preload.js 包进一个 IIFE，并用 fetch 版 ipcRenderer 替换 Electron 依赖。
func bridgeJS() []byte {
	src, err := os.ReadFile(filepath.Join(gApp.appDir, "desktop", "preload.js"))
	if err != nil {
		log.Printf("读取 preload.js 失败：%v", err)
		return []byte("")
	}
	body := reRequireElectron.ReplaceAllString(string(src), "")

	shim := `(function(){
  const ipcRenderer = {
    invoke: async function (channel, payload) {
      const r = await fetch('/api/desktop/' + encodeURIComponent(channel), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload === undefined ? null : payload)
      });
      return r.json();
    },
    send: function (channel, payload) {
      fetch('/api/desktop/' + encodeURIComponent(channel), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload === undefined ? null : payload)
      }).catch(function () {});
    }
  };
`
	return []byte(shim + body + "\n})();\n")
}

func serveIndex(w http.ResponseWriter, r *http.Request) {
	b, err := os.ReadFile(filepath.Join(gApp.appDir, "index.html"))
	if err != nil {
		writeText(w, 500, "无法读取 index.html："+err.Error())
		return
	}
	html := string(b)
	if i := strings.LastIndex(strings.ToLower(html), "</head>"); i >= 0 {
		html = html[:i] + `<script src="/__hs/bridge.js"></script>` + html[i:]
	} else {
		html = `<script src="/__hs/bridge.js"></script>` + html
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Length", fmt.Sprint(len(html)))
	w.WriteHeader(200)
	_, _ = io.WriteString(w, html)
}

func currentPayload() (payload, error) {
	gApp.cfgMu.RLock()
	cfg := *gApp.cfg
	gApp.cfgMu.RUnlock()
	return buildPayload(&cfg)
}

func openInExplorer(target string) {
	win := strings.ReplaceAll(target, "/", "\\")
	_ = exec.Command("explorer.exe", "/select,"+win).Start()
}

// findProject 与 server.js 的 findProject 一致（按 id 匹配）。
func findProject(p payload, id string) *project {
	for i := range p.Projects {
		if p.Projects[i].ID == id {
			return &p.Projects[i]
		}
	}
	return nil
}

func serveAPI(w http.ResponseWriter, r *http.Request) {
	route := strings.TrimRight(r.URL.Path, "/")
	if route == "" {
		route = "/"
	}
	switch route {

	case "/", "/index.html":
		serveIndex(w, r)

	case "/favicon.ico":
		w.WriteHeader(204)

	case "/__hs/bridge.js":
		b := bridgeJS()
		w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Length", fmt.Sprint(len(b)))
		_, _ = w.Write(b)

	case "/api/projects":
		p, err := currentPayload()
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, 200, p)

	case "/api/handoff":
		p, err := currentPayload()
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		proj := findProject(p, r.URL.Query().Get("id"))
		if proj == nil || proj.Handoff == nil {
			writeJSON(w, 404, map[string]string{"error": "找不到该项目或它没有交接文档"})
			return
		}
		b, err := os.ReadFile(proj.Handoff.Path)
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, 200, map[string]any{
			"id": proj.ID, "name": proj.Name, "relPath": proj.Handoff.RelPath,
			"mtime": proj.Handoff.Mtime, "markdown": string(b),
		})

	case "/api/reveal":
		p, err := currentPayload()
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		proj := findProject(p, r.URL.Query().Get("id"))
		if proj == nil {
			writeJSON(w, 404, map[string]string{"error": "找不到该项目"})
			return
		}
		target := proj.Dir
		if r.URL.Query().Get("target") == "handoff" && proj.Handoff != nil {
			target = proj.Handoff.Path
		}
		openInExplorer(target)
		writeJSON(w, 200, map[string]any{"ok": true, "opened": target})

	default:
		if strings.HasPrefix(route, "/api/desktop/") {
			serveDesktopIPC(w, r, strings.TrimPrefix(route, "/api/desktop/"))
			return
		}
		writeText(w, 404, "Not found")
	}
}

func startServer() error {
	start := gApp.cfg.Port
	if start <= 0 {
		start = 4177
	}
	var ln net.Listener
	var err error
	for i := 0; i < 20; i++ {
		ln, err = net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", start+i))
		if err == nil {
			break
		}
	}
	if ln == nil {
		return err
	}
	gBaseURL = "http://" + ln.Addr().String()
	mux := http.NewServeMux()
	mux.HandleFunc("/", serveAPI)
	srv := &http.Server{Handler: mux}
	go func() { _ = srv.Serve(ln) }()
	log.Printf("本地服务 %s  工作目录 %v", gBaseURL, gApp.cfg.Roots)
	return nil
}
