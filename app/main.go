package main

// Hands-off Dashboard · Windows 桌面宿主
//
// 用系统自带的 WebView2 承载 index.html，配合 Win32 分层透明窗口贴在桌面层。
// 界面、配置、HANDOFF.md 解析与状态持久化都在这里组装。
// 编译产物是单个 GUI exe（无控制台窗口），由 NSIS 打成一键安装包。

import (
	"log"
	"os"
	"path/filepath"
	"runtime"
	"sync"

	"github.com/jchv/go-webview2/pkg/edge"
	"golang.org/x/sys/windows"
)

type App struct {
	appDir       string
	packaged     bool
	cfg          *Config
	cfgMu        sync.RWMutex
	chrome       *edge.Chromium
	hwnd         windows.HWND
	hidden       bool
	debugTopmost bool
}

var gApp *App

func detectAppDir() (string, bool) {
	if v := os.Getenv("HS_APP_DIR"); v != "" {
		return v, false
	}
	exe, err := os.Executable()
	if err != nil {
		return ".", false
	}
	dir := filepath.Dir(exe)
	// 安装版：exe 与 index.html / examples / ui 放同一目录。
	if _, err := os.Stat(filepath.Join(dir, "index.html")); err == nil {
		return dir, true
	}
	// 开发版：exe 在 <项目根>/app 下。
	return filepath.Clean(filepath.Join(dir, "..")), false
}

func ensurePackagedRoots() {
	if !gApp.packaged || os.Getenv("HS_SKIP_FIRST_RUN") == "1" {
		return
	}
	st := readState()
	if len(st.Roots) > 0 || st.FirstRunDone {
		return
	}
	chosen, _ := chooseFolders("选择项目所在的工作目录")
	roots := chosen
	if len(roots) == 0 {
		bundled := filepath.Join(gApp.appDir, "examples")
		if _, err := os.Stat(bundled); err == nil {
			roots = []string{bundled}
		}
	}
	writeState(State{Roots: roots, FirstRunDone: true})
	log.Printf("首次启动工作目录：%v", roots)
}

func main() {
	runtime.LockOSThread()
	setDpiAwareness()
	initPaths()
	setupLogging()
	log.SetFlags(log.Ldate | log.Ltime)
	log.Printf("Hands-off Dashboard %s 启动", appVersion)

	appDir, packaged := detectAppDir()
	gApp = &App{appDir: appDir, packaged: packaged, debugTopmost: os.Getenv("HS_TOPMOST") == "1"}

	if !registerSingleInstanceOrNotify() {
		log.Print("已有实例在运行，已通知其显示后退出")
		return
	}

	ensurePackagedRoots()

	st := readState()
	override := append([]string{}, st.Roots...)
	if packaged && len(override) == 0 {
		bundled := filepath.Join(appDir, "examples")
		if _, err := os.Stat(bundled); err == nil {
			override = []string{bundled}
		}
	}
	cfg := loadConfig(appDir, override)
	gApp.cfg = &cfg

	if err := startServer(); err != nil {
		log.Fatalf("启动本地服务失败：%v", err)
	}
	if err := createWindow(); err != nil {
		log.Fatalf("创建窗口失败：%v", err)
	}
	if err := setupWebView(); err != nil {
		log.Fatalf("%v", err)
	}
	registerHotkeys()
	log.Print("启动完成（Ctrl+Alt+H 隐藏/显示，Ctrl+Alt+Q 退出，右键打开设置面板）")
	runMessageLoop()
	log.Print("已退出")
}
