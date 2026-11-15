package main

// Win32 宿主窗口：无边框分层透明窗口、桌面贴底巡护、拖动/缩放、DPI、
// 单实例、全局热键、状态持久化，以及桌面层的 Z 序巡护。

import (
	"fmt"
	"log"
	"math"
	"os"
	"path/filepath"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"github.com/jchv/go-webview2/pkg/edge"
	"golang.org/x/sys/windows"
)

var (
	user32   = windows.NewLazySystemDLL("user32.dll")
	kernel32 = windows.NewLazySystemDLL("kernel32.dll")

	pGetModuleHandleW           = kernel32.NewProc("GetModuleHandleW")
	pCreateMutexW               = kernel32.NewProc("CreateMutexW")
	pRegisterClassExW           = user32.NewProc("RegisterClassExW")
	pCreateWindowExW            = user32.NewProc("CreateWindowExW")
	pDefWindowProcW             = user32.NewProc("DefWindowProcW")
	pDestroyWindow              = user32.NewProc("DestroyWindow")
	pShowWindow                 = user32.NewProc("ShowWindow")
	pUpdateWindow               = user32.NewProc("UpdateWindow")
	pGetMessageW                = user32.NewProc("GetMessageW")
	pTranslateMessage           = user32.NewProc("TranslateMessage")
	pDispatchMessageW           = user32.NewProc("DispatchMessageW")
	pPostQuitMessage            = user32.NewProc("PostQuitMessage")
	pPostMessageW               = user32.NewProc("PostMessageW")
	pSetWindowPos               = user32.NewProc("SetWindowPos")
	pFindWindowW                = user32.NewProc("FindWindowW")
	pGetWindow                  = user32.NewProc("GetWindow")
	pIsWindowVisible            = user32.NewProc("IsWindowVisible")
	pIsIconic                   = user32.NewProc("IsIconic")
	pSetLayeredWindowAttributes = user32.NewProc("SetLayeredWindowAttributes")
	pGetWindowRect              = user32.NewProc("GetWindowRect")
	pSystemParametersInfoW      = user32.NewProc("SystemParametersInfoW")
	pGetDpiForWindow            = user32.NewProc("GetDpiForWindow")
	pSetProcessDPIAware         = user32.NewProc("SetProcessDPIAware")
	pSetProcessDpiAwarenessCtx  = user32.NewProc("SetProcessDpiAwarenessContext")
	pRegisterHotKey             = user32.NewProc("RegisterHotKey")
	pUnregisterHotKey           = user32.NewProc("UnregisterHotKey")
	pLoadCursorW                = user32.NewProc("LoadCursorW")
	pLoadImageW                 = user32.NewProc("LoadImageW")
	pSendMessageW               = user32.NewProc("SendMessageW")
)

const (
	wmDestroy       = 0x0002
	wmMove          = 0x0003
	wmSize          = 0x0005
	wmActivate      = 0x0006
	wmClose         = 0x0010
	wmQuit          = 0x0012
	wmGetMinMaxInfo = 0x0024
	wmNcHitTest     = 0x0084
	wmHotKey        = 0x0312
	wmAppUI         = 0x8001
	wmAppShow       = 0x8002
	wmExitsSizeMove = 0x0232

	wsPopup        = 0x80000000
	wsExLayered    = 0x00080000
	wsExToolWindow = 0x00000080

	swHide           = 0
	swShowNoActivate = 4
	swRestore        = 9

	gwHwndNext = 2
	gwHwndPrev = 3

	swpNoSize     = 0x0001
	swpNoMove     = 0x0002
	swpNoZOrder   = 0x0004
	swpNoActivate = 0x0010

	lwaAlpha       = 0x00000002
	spiGetWorkArea = 0x0030
	modAlt         = 0x0001
	modControl     = 0x0002
	modNoRepeat    = 0x4000
	errorAlready   = 183

	htClient      = 1
	htLeft        = 10
	htRight       = 11
	htTop         = 12
	htTopLeft     = 13
	htTopRight    = 14
	htBottom      = 15
	htBottomLeft  = 16
	htBottomRight = 17

	defaultWidth  = 1000
	defaultHeight = 660
	windowClass   = "hs-dashboard-window"
)

type wndClassExW struct {
	CbSize        uint32
	Style         uint32
	LpfnWndProc   uintptr
	CbClsExtra    int32
	CbWndExtra    int32
	HInstance     windows.Handle
	HIcon         windows.Handle
	HCursor       windows.Handle
	HbrBackground windows.Handle
	LpszMenuName  *uint16
	LpszClassName *uint16
	HIconSm       windows.Handle
}

type rect struct{ Left, Top, Right, Bottom int32 }

type point struct{ X, Y int32 }

// Win32 MSG（x/sys/windows 未导出该类型，按平台 ABI 自行定义）。
type msg struct {
	Hwnd     windows.HWND
	Message  uint32
	WParam   uintptr
	LParam   uintptr
	Time     uint32
	Pt       point
	LPrivate uint32
}

type minMaxInfo struct {
	Reserved     [2]int32
	MaxSize      [2]int32
	MaxPosition  [2]int32
	MinTrackSize [2]int32
	MaxTrackSize [2]int32
}

type dragState struct {
	WinX, WinY       float64
	ScreenX, ScreenY float64
}

type uiTask struct {
	fn   func()
	done chan struct{}
}

var (
	uiQueue     = make(chan uiTask, 256)
	boundsMu    sync.Mutex
	boundsTimer *time.Timer
	gDrag       *dragState
)

// postUI 把必须在窗口线程执行的操作排队（COM Eval、窗口移动等）。
func postUI(fn func()) {
	select {
	case uiQueue <- uiTask{fn: fn}:
		if gApp != nil && gApp.hwnd != 0 {
			_, _, _ = pPostMessageW.Call(uintptr(gApp.hwnd), wmAppUI, 0, 0)
		}
	default:
	}
}

func callUI(fn func()) {
	done := make(chan struct{})
	uiQueue <- uiTask{fn: fn, done: done}
	_, _, _ = pPostMessageW.Call(uintptr(gApp.hwnd), wmAppUI, 0, 0)
	<-done
}

func drainUI() {
	for {
		select {
		case t := <-uiQueue:
			func() {
				defer func() {
					if r := recover(); r != nil {
						log.Printf("UI 任务异常：%v", r)
					}
					if t.done != nil {
						close(t.done)
					}
				}()
				t.fn()
			}()
		default:
			return
		}
	}
}

func dpiScale() float64 {
	if gApp == nil || gApp.hwnd == 0 {
		return 1
	}
	if err := pGetDpiForWindow.Find(); err != nil {
		return 1
	}
	dpi, _, _ := pGetDpiForWindow.Call(uintptr(gApp.hwnd))
	if dpi == 0 {
		return 1
	}
	return float64(dpi) / 96.0
}

func setDpiAwareness() {
	if err := pSetProcessDpiAwarenessCtx.Find(); err == nil {
		// DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = (HANDLE)-4
		if _, _, e := pSetProcessDpiAwarenessCtx.Call(^uintptr(3)); e == nil {
			return
		}
	}
	_, _, _ = pSetProcessDPIAware.Call()
}

func primaryWorkArea() rect {
	var rc rect
	_, _, _ = pSystemParametersInfoW.Call(spiGetWorkArea, 0, uintptr(unsafe.Pointer(&rc)), 0)
	if rc.Right <= rc.Left || rc.Bottom <= rc.Top {
		w, _, _ := pGetSystemMetrics.Call(0)
		h, _, _ := pGetSystemMetrics.Call(1)
		rc = rect{0, 0, int32(w), int32(h)}
	}
	return rc
}

var pGetSystemMetrics = user32.NewProc("GetSystemMetrics")

func windowRect() rect {
	var rc rect
	_, _, _ = pGetWindowRect.Call(uintptr(gApp.hwnd), uintptr(unsafe.Pointer(&rc)))
	return rc
}

func persistBounds() {
	boundsMu.Lock()
	if boundsTimer != nil {
		boundsTimer.Stop()
	}
	boundsTimer = time.AfterFunc(400*time.Millisecond, func() {
		postUI(func() {
			if gApp == nil || gApp.hwnd == 0 {
				return
			}
			rc := windowRect()
			s := dpiScale()
			x := int(math.Round(float64(rc.Left) / s))
			y := int(math.Round(float64(rc.Top) / s))
			w := int(math.Round(float64(rc.Right-rc.Left) / s))
			h := int(math.Round(float64(rc.Bottom-rc.Top) / s))
			writeState(State{X: intPtr(x), Y: intPtr(y), Width: intPtr(w), Height: intPtr(h)})
		})
	})
	boundsMu.Unlock()
}

// pinToBottom：插到「桌面窗口之上、普通窗口之下」。
// 不能直接用 Progman 当锚点（Win8 起 z-band 跨带插入会被静默丢弃），
// 要用紧挨在 Progman 之上的那个窗口。
func pinToBottom() {
	if gApp == nil || gApp.hwnd == 0 || gApp.debugTopmost {
		return
	}
	name, _ := windows.UTF16PtrFromString("Progman")
	progman, _, _ := pFindWindowW.Call(uintptr(unsafe.Pointer(name)), 0)
	flags := uintptr(swpNoSize | swpNoMove | swpNoActivate)
	if progman == 0 {
		_, _, _ = pSetWindowPos.Call(uintptr(gApp.hwnd), 1, 0, 0, 0, 0, flags)
		return
	}
	next, _, _ := pGetWindow.Call(uintptr(gApp.hwnd), gwHwndNext)
	if next == progman {
		return
	}
	anchor, _, _ := pGetWindow.Call(progman, gwHwndPrev)
	_, _, _ = pSetWindowPos.Call(uintptr(gApp.hwnd), anchor, 0, 0, 0, 0, flags)
}

func keepOnDesktop() {
	if gApp == nil || gApp.hwnd == 0 || gApp.hidden || gApp.debugTopmost || os.Getenv("HS_NO_ATTACH") == "1" {
		return
	}
	if iconic, _, _ := pIsIconic.Call(uintptr(gApp.hwnd)); iconic != 0 {
		_, _, _ = pShowWindow.Call(uintptr(gApp.hwnd), swRestore)
		_, _, _ = pShowWindow.Call(uintptr(gApp.hwnd), swShowNoActivate)
	} else if visible, _, _ := pIsWindowVisible.Call(uintptr(gApp.hwnd)); visible == 0 {
		_, _, _ = pShowWindow.Call(uintptr(gApp.hwnd), swShowNoActivate)
	}
	pinToBottom()
}

func toggleVisible() {
	if gApp.hidden {
		_, _, _ = pShowWindow.Call(uintptr(gApp.hwnd), swShowNoActivate)
		gApp.hidden = false
		pinToBottom()
	} else {
		_, _, _ = pShowWindow.Call(uintptr(gApp.hwnd), swHide)
		gApp.hidden = true
	}
}

func dragStart(sx, sy float64) {
	rc := windowRect()
	s := dpiScale()
	gDrag = &dragState{
		WinX: float64(rc.Left) / s, WinY: float64(rc.Top) / s,
		ScreenX: sx, ScreenY: sy,
	}
}

func dragMove(sx, sy float64) {
	if gDrag == nil {
		return
	}
	s := dpiScale()
	nextX := math.Round(gDrag.WinX + (sx - gDrag.ScreenX))
	nextY := math.Round(gDrag.WinY + (sy - gDrag.ScreenY))
	_, _, _ = pSetWindowPos.Call(
		uintptr(gApp.hwnd), 0,
		uintptr(int(math.Round(nextX*s))), uintptr(int(math.Round(nextY*s))),
		0, 0, swpNoSize|swpNoZOrder|swpNoActivate,
	)
}

func dragEnd() {
	gDrag = nil
	persistBounds()
	pinToBottom()
}

func quitApp() {
	_, _, _ = pPostMessageW.Call(uintptr(gApp.hwnd), wmClose, 0, 0)
}

func hitTest(lp uintptr) uintptr {
	x := int32(int16(uint16(lp & 0xffff)))
	y := int32(int16(uint16((lp >> 16) & 0xffff)))
	rc := windowRect()
	edgePx := int32(math.Max(6, 8*dpiScale()))
	left := x < rc.Left+edgePx
	right := x >= rc.Right-edgePx
	top := y < rc.Top+edgePx
	bottom := y >= rc.Bottom-edgePx
	switch {
	case top && left:
		return htTopLeft
	case top && right:
		return htTopRight
	case bottom && left:
		return htBottomLeft
	case bottom && right:
		return htBottomRight
	case left:
		return htLeft
	case right:
		return htRight
	case top:
		return htTop
	case bottom:
		return htBottom
	}
	// 客户区交给 DefWindowProc：它要把 hit-test 转发给 WebView2 的子窗口，
	// 自己返回 HTCLIENT 会让网页完全收不到鼠标事件。
	r, _, _ := pDefWindowProcW.Call(uintptr(gApp.hwnd), wmNcHitTest, 0, lp)
	return r
}

func wndproc(hwnd, umsg, wp, lp uintptr) uintptr {
	switch umsg {
	case wmSize:
		if gApp != nil && gApp.chrome != nil {
			gApp.chrome.Resize()
		}
		persistBounds()
	case wmMove:
		if gApp != nil && gApp.chrome != nil {
			_ = gApp.chrome.NotifyParentWindowPositionChanged()
		}
		persistBounds()
	case wmExitsSizeMove:
		pinToBottom()
	case wmNcHitTest:
		return hitTest(lp)
	case wmGetMinMaxInfo:
		if lp != 0 {
			s := dpiScale()
			mmi := (*minMaxInfo)(unsafe.Pointer(lp))
			mmi.MinTrackSize[0] = int32(math.Round(460 * s))
			mmi.MinTrackSize[1] = int32(math.Round(280 * s))
		}
		return 0
	case wmActivate:
		if wp != 0 {
			pinToBottom()
		}
	case wmHotKey:
		switch wp {
		case 1:
			toggleVisible()
		case 2:
			quitApp()
		}
		return 0
	case wmAppShow:
		if gApp.hidden {
			_, _, _ = pShowWindow.Call(hwnd, swShowNoActivate)
			gApp.hidden = false
		}
		pinToBottom()
		return 0
	case wmAppUI:
		drainUI()
		return 0
	case wmClose:
		_, _, _ = pDestroyWindow.Call(hwnd)
		return 0
	case wmDestroy:
		_, _, _ = pUnregisterHotKey.Call(hwnd, 1)
		_, _, _ = pUnregisterHotKey.Call(hwnd, 2)
		_, _, _ = pPostQuitMessage.Call(0)
		return 0
	}
	r, _, _ := pDefWindowProcW.Call(hwnd, umsg, wp, lp)
	return r
}

func registerSingleInstanceOrNotify() bool {
	name, _ := windows.UTF16PtrFromString(`Local\HandsOffDashboard`)
	_, _, lastErr := pCreateMutexW.Call(0, 0, uintptr(unsafe.Pointer(name)))
	if errno, ok := lastErr.(syscall.Errno); ok && uint32(errno) == errorAlready {
		class, _ := windows.UTF16PtrFromString(windowClass)
		h, _, _ := pFindWindowW.Call(uintptr(unsafe.Pointer(class)), 0)
		if h != 0 {
			_, _, _ = pPostMessageW.Call(h, wmAppShow, 0, 0)
		}
		return false
	}
	return true
}

func createWindow() error {
	h, _, _ := pGetModuleHandleW.Call(0)
	hInst := windows.Handle(h)
	className, _ := windows.UTF16PtrFromString(windowClass)
	windowName, _ := windows.UTF16PtrFromString("Hands-off Dashboard")

	cursor, _, _ := pLoadCursorW.Call(0, 32512) // IDC_ARROW
	wc := wndClassExW{
		CbSize:        uint32(unsafe.Sizeof(wndClassExW{})),
		HInstance:     hInst,
		LpfnWndProc:   windows.NewCallback(wndproc),
		LpszClassName: className,
		HCursor:       windows.Handle(cursor),
	}
	if r, _, _ := pRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc))); r == 0 {
		return fmt.Errorf("RegisterClassExW 失败")
	}

	st := readState()
	s := 1.0
	// 创建前用系统 DPI 估算缩放（创建后才能用 GetDpiForWindow）。
	if err := pGetDpiForSystem.Find(); err == nil {
		if dpi, _, _ := pGetDpiForSystem.Call(); dpi > 0 {
			s = float64(dpi) / 96.0
		}
	}
	width := float64(defaultWidth)
	height := float64(defaultHeight)
	if st.Width != nil && *st.Width > 0 {
		width = float64(*st.Width)
	}
	if st.Height != nil && *st.Height > 0 {
		height = float64(*st.Height)
	}
	wa := primaryWorkArea()
	x, y := float64(0), float64(0)
	if st.X != nil {
		x = float64(*st.X)
	} else {
		x = float64(wa.Right)/s - width - 40
	}
	if st.Y != nil {
		y = float64(*st.Y)
	} else {
		y = float64(wa.Bottom)/s - height - 40
	}

	exStyle := uintptr(wsExLayered | wsExToolWindow)
	r, _, err := pCreateWindowExW.Call(
		exStyle,
		uintptr(unsafe.Pointer(className)),
		uintptr(unsafe.Pointer(windowName)),
		wsPopup,
		uintptr(int(math.Round(x*s))), uintptr(int(math.Round(y*s))),
		uintptr(int(math.Round(width*s))), uintptr(int(math.Round(height*s))),
		0, 0, uintptr(hInst), 0,
	)
	if r == 0 {
		return fmt.Errorf("CreateWindowExW 失败: %v", err)
	}
	gApp.hwnd = windows.HWND(r)
	applyWindowIcon(gApp.hwnd)
	_, _, _ = pSetLayeredWindowAttributes.Call(uintptr(gApp.hwnd), 0, 255, lwaAlpha)
	_, _, _ = pShowWindow.Call(uintptr(gApp.hwnd), swShowNoActivate)
	_, _, _ = pUpdateWindow.Call(uintptr(gApp.hwnd))

	if gApp.debugTopmost {
		_, _, _ = pSetWindowPos.Call(uintptr(gApp.hwnd), ^uintptr(0), 0, 0, 0, 0, swpNoMove|swpNoSize|swpNoActivate)
	} else {
		pinToBottom()
	}
	log.Printf("窗口 HWND=%d 位置=(%d,%d) 尺寸=%dx%d DPI缩放=%.2f",
		gApp.hwnd, int(x*s), int(y*s), int(width*s), int(height*s), s)
	if os.Getenv("HS_DEBUG_DPI") == "1" {
		var rr rect
		_, _, _ = pGetWindowRect.Call(uintptr(gApp.hwnd), uintptr(unsafe.Pointer(&rr)))
		dw, _, _ := pGetDpiForWindow.Call(uintptr(gApp.hwnd))
		log.Printf("[dpi] 实际 rect=(%d,%d)-(%d,%d) 即 %dx%d；GetDpiForWindow=%d；请求=%dx%d",
			rr.Left, rr.Top, rr.Right, rr.Bottom, rr.Right-rr.Left, rr.Bottom-rr.Top, dw,
			int(width*s), int(height*s))
	}
	return nil
}

var pGetDpiForSystem = user32.NewProc("GetDpiForSystem")

// 从随包的 icon.ico 设置窗口/任务栏图标（Go 编译的 exe 没有内置图标资源）。
func applyWindowIcon(hwnd windows.HWND) {
	for _, p := range []string{
		filepath.Join(gApp.appDir, "icon.ico"),
		filepath.Join(gApp.appDir, "assets", "icon.ico"),
	} {
		if _, err := os.Stat(p); err != nil {
			continue
		}
		name, err := windows.UTF16PtrFromString(p)
		if err != nil {
			return
		}
		// LR_LOADFROMFILE(0x10) | LR_DEFAULTSIZE(0x40)
		h, _, _ := pLoadImageW.Call(0, uintptr(unsafe.Pointer(name)), 1, 0, 0, 0x50)
		if h == 0 {
			return
		}
		_, _, _ = pSendMessageW.Call(uintptr(hwnd), 0x0080, 1, h) // WM_SETICON ICON_BIG
		_, _, _ = pSendMessageW.Call(uintptr(hwnd), 0x0080, 0, h) // WM_SETICON ICON_SMALL
		return
	}
}

func setupWebView() error {
	chrome := edge.NewChromium()
	chrome.DataPath = filepath.Join(userDataDir, "webview2")
	gApp.chrome = chrome
	if !chrome.Embed(uintptr(gApp.hwnd)) {
		return fmt.Errorf("WebView2 初始化失败（系统可能未安装 WebView2 Runtime）")
	}
	// ICoreWebView2Controller2 的 vtable 是 Controller 的超集，布局一致。
	c2 := (*edge.ICoreWebView2Controller2)(unsafe.Pointer(chrome.GetController()))
	if err := c2.PutDefaultBackgroundColor(edge.COREWEBVIEW2_COLOR{A: 0, R: 0, G: 0, B: 0}); err != nil {
		log.Printf("透明背景设置失败：%v", err)
	} else {
		log.Print("透明背景已设置 (alpha=0)")
	}
	// 禁用 WebView2 自带的右键菜单 / Ctrl+滚轮缩放。
	chrome.Init(`(function(){
  document.addEventListener('contextmenu', function(e){ e.preventDefault(); }, true);
  document.addEventListener('wheel', function(e){ if(e.ctrlKey) e.preventDefault(); }, {passive:false, capture:true});
})();`)
	chrome.Resize()
	chrome.Navigate(gBaseURL + "/")
	return nil
}

func registerHotkeys() {
	for _, hk := range []struct {
		id  uintptr
		key uintptr
	}{{1, uintptr('H')}, {2, uintptr('Q')}} {
		r, _, err := pRegisterHotKey.Call(uintptr(gApp.hwnd), hk.id, modControl|modAlt|modNoRepeat, hk.key)
		if r == 0 {
			log.Printf("全局热键 %c 注册失败（可能被其它程序占用）：%v", hk.key, err)
		} else {
			log.Printf("全局热键 Ctrl+Alt+%c 已注册", hk.key)
		}
	}
}

func runMessageLoop() {
	go func() {
		for {
			keepOnDesktop()
			time.Sleep(50 * time.Millisecond)
		}
	}()
	var m msg
	for {
		r, _, _ := pGetMessageW.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
		if r == 0 || r == ^uintptr(0) || m.Message == wmQuit {
			return
		}
		_, _, _ = pTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
		_, _, _ = pDispatchMessageW.Call(uintptr(unsafe.Pointer(&m)))
	}
}

// Windows GUI 子系统程序没有控制台，日志写到文件方便排查。
func setupLogging() {
	if os.Getenv("HS_CONSOLE") == "1" {
		log.SetOutput(os.Stdout)
		return
	}
	_ = os.MkdirAll(userDataDir, 0o755)
	f, err := os.OpenFile(filepath.Join(userDataDir, "dashboard.log"), os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err == nil {
		log.SetOutput(f)
	}
}
