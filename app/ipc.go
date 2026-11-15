package main

// /api/desktop/<channel> —— 界面层交互的 10 个动作，全部走同源 POST。
// 返回值的字段名、去重规则、「至少保留一个目录」等边界在这里统一处理。

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strings"
)

func currentRoots() []string {
	s := readState()
	if len(s.Roots) > 0 {
		return append([]string{}, s.Roots...)
	}
	gApp.cfgMu.RLock()
	defer gApp.cfgMu.RUnlock()
	return append([]string{}, gApp.cfg.Roots...)
}

func setRoots(next []string) {
	writeState(State{Roots: next})
	gApp.cfgMu.Lock()
	gApp.cfg.Roots = append([]string{}, next...)
	if len(next) > 0 {
		gApp.cfg.Root = next[0]
	}
	gApp.cfgMu.Unlock()
}

func refreshPage() {
	postUI(func() {
		if gApp.chrome != nil {
			gApp.chrome.Eval("window.dispatchEvent(new Event('hs-refresh'))")
		}
	})
}

func samePath(a, b string) bool {
	return strings.EqualFold(strings.ReplaceAll(a, "/", "\\"), strings.ReplaceAll(b, "/", "\\"))
}

func decodePayload(r *http.Request) any {
	b, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if len(b) == 0 || string(b) == "null" {
		return nil
	}
	var v any
	if json.Unmarshal(b, &v) != nil {
		return nil
	}
	return v
}

func asFloat(v any) (float64, bool) {
	f, ok := v.(float64)
	return f, ok
}

func serveDesktopIPC(w http.ResponseWriter, r *http.Request, channel string) {
	if r.Method != http.MethodPost {
		writeJSON(w, 405, map[string]string{"error": "method not allowed"})
		return
	}
	raw := decodePayload(r)

	switch channel {

	case "desktop:bootstrap":
		s := readState()
		shell, card := 1.0, 0.56
		if s.ShellOpacity != nil {
			shell = *s.ShellOpacity
		}
		if s.CardOpacity != nil {
			card = *s.CardOpacity
		}
		writeJSON(w, 200, map[string]any{
			"shellOpacity": shell,
			"cardOpacity":  card,
			"roots":        currentRoots(),
			"version":      appVersion,
			"desktopLayer": !gApp.debugTopmost,
		})

	case "desktop:set-opacity":
		patch := map[string]float64{}
		if m, ok := raw.(map[string]any); ok {
			if v, ok := asFloat(m["shellOpacity"]); ok {
				if v < 0 {
					v = 0
				}
				if v > 1 {
					v = 1
				}
				patch["shellOpacity"] = v
			}
			if v, ok := asFloat(m["cardOpacity"]); ok {
				if v < 0 {
					v = 0
				}
				if v > 1 {
					v = 1
				}
				patch["cardOpacity"] = v
			}
		}
		st := State{}
		if v, ok := patch["shellOpacity"]; ok {
			st.ShellOpacity = floatPtr(v)
		}
		if v, ok := patch["cardOpacity"]; ok {
			st.CardOpacity = floatPtr(v)
		}
		writeState(st)
		writeJSON(w, 200, patch)

	case "desktop:get-roots":
		writeJSON(w, 200, map[string]any{"roots": currentRoots()})

	case "desktop:add-roots":
		chosen, err := chooseFolders("添加工作目录（可多选）")
		if err != nil || len(chosen) == 0 {
			writeJSON(w, 200, map[string]any{"roots": currentRoots(), "added": 0})
			return
		}
		roots := currentRoots()
		seen := map[string]bool{}
		for _, item := range roots {
			seen[strings.ToLower(item)] = true
		}
		added := 0
		for _, dir := range chosen {
			if dir == "" || seen[strings.ToLower(dir)] {
				continue
			}
			seen[strings.ToLower(dir)] = true
			roots = append(roots, dir)
			added++
		}
		if added > 0 {
			setRoots(roots)
			refreshPage()
		}
		writeJSON(w, 200, map[string]any{"roots": roots, "added": added})

	case "desktop:remove-root":
		dir, _ := raw.(string)
		cur := currentRoots()
		next := []string{}
		for _, item := range cur {
			if !samePath(item, dir) {
				next = append(next, item)
			}
		}
		if len(next) == len(cur) {
			writeJSON(w, 200, map[string]any{"roots": next, "removed": 0})
			return
		}
		// 至少保留一个工作目录
		if len(next) == 0 {
			writeJSON(w, 200, map[string]any{"roots": cur, "removed": 0})
			return
		}
		setRoots(next)
		refreshPage()
		writeJSON(w, 200, map[string]any{"roots": next, "removed": 1})

	case "desktop:refresh":
		refreshPage()
		writeJSON(w, 200, true)

	case "desktop:drag-start":
		if m, ok := raw.(map[string]any); ok {
			x, xok := asFloat(m["screenX"])
			y, yok := asFloat(m["screenY"])
			if xok && yok {
				postUI(func() { dragStart(x, y) })
			}
		}
		writeJSON(w, 200, nil)

	case "desktop:drag-move":
		if m, ok := raw.(map[string]any); ok {
			x, xok := asFloat(m["screenX"])
			y, yok := asFloat(m["screenY"])
			if xok && yok {
				postUI(func() { dragMove(x, y) })
			}
		}
		writeJSON(w, 200, nil)

	case "desktop:drag-end":
		postUI(dragEnd)
		writeJSON(w, 200, nil)

	case "desktop:quit":
		log.Print("收到退出请求")
		postUI(func() { quitApp() })
		writeJSON(w, 200, nil)

	default:
		writeJSON(w, 404, map[string]string{"error": "unknown channel: " + channel})
	}
}
