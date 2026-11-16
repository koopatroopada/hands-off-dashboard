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
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"

	"github.com/jchv/go-webview2/pkg/edge"
	"golang.org/x/sys/windows"
)

var (
	user32   = windows.NewLazySystemDLL("user32.dll")
	kernel32 = windows.NewLazySystemDLL("kernel32.dll")
	gdi32    = windows.NewLazySystemDLL("gdi32.dll")

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
	pSetCursor                  = user32.NewProc("SetCursor")
	pSetCapture                 = user32.NewProc("SetCapture")
	pReleaseCapture             = user32.NewProc("ReleaseCapture")
	pGetCursorPos               = user32.NewProc("GetCursorPos")
	pGetAsyncKeyState           = user32.NewProc("GetAsyncKeyState")
	pSetWindowRgn               = user32.NewProc("SetWindowRgn")
	pCreateRoundRectRgn         = gdi32.NewProc("CreateRoundRectRgn")
)

const (
	wmDestroy        = 0x0002
	wmEraseBkgnd     = 0x000C
	wmMove           = 0x0003
	wmSize           = 0x0005
	wmActivate       = 0x0006
	wmCancelMode     = 0x001F
	wmSetCursor      = 0x0020
	wmClose          = 0x0010
	wmQuit           = 0x0012
	wmGetMinMaxInfo  = 0x0024
	wmNcHitTest      = 0x0084
	wmMouseMove      = 0x0200
	wmLButtonUp      = 0x0202
	wmCaptureChanged = 0x0215
	wmExitsSizeMove  = 0x0232
	wmHotKey         = 0x0312
	wmAppUI          = 0x8001
	wmAppShow        = 0x8002

	wsPopup           = 0x80000000
	wsExLayered       = 0x00080000
	wsExToolWindow    = 0x00000080
	wsExNoRedirBitmap = 0x00200000 // WS_EX_NOREDIRECTIONBITMAP：WebView2 的 DirectComposition 表面直连桌面合成

	htClient      = 1
	htTransparent = -2

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

	idcArrow    = 32512
	idcSizeNWSE = 32642
	idcSizeNESW = 32643
	idcSizeWE   = 32644
	idcSizeNS   = 32645

	vkLButton       = 0x01
	defaultWidth    = 1000
	defaultHeight   = 660
	minWindowWidth  = 460
	minWindowHeight = 280
	windowClass     = "hs-dashboard-window"
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

// resizeEdge 描述哪几条边参与调整，以及对应的系统拉伸光标。
type resizeEdge struct {
	left, right, top, bottom bool
	cursor                   uintptr
}

var resizeEdges = map[string]resizeEdge{
	"left":         {left: true, cursor: idcSizeWE},
	"right":        {right: true, cursor: idcSizeWE},
	"top":          {top: true, cursor: idcSizeNS},
	"bottom":       {bottom: true, cursor: idcSizeNS},
	"top-left":     {left: true, top: true, cursor: idcSizeNWSE},
	"bottom-right": {right: true, bottom: true, cursor: idcSizeNWSE},
	"top-right":    {right: true, top: true, cursor: idcSizeNESW},
	"bottom-left":  {left: true, bottom: true, cursor: idcSizeNESW},
}

type resizeState struct {
	edge        resizeEdge
	startCursor point // 物理屏幕坐标
	startRect   rect  // 物理窗口矩形
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
	gResize     *resizeState // 只在窗口线程读写
	resizing    atomic.Int32 // 供贴底巡护 goroutine 读取，1 = 拉伸中
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
	// 拉伸期间暂停 Z 序巡护：每 50ms 一次的 SetWindowPos 会和拖拽中的尺寸调整抢窗口状态。
	if gApp == nil || gApp.hwnd == 0 || gApp.hidden || gApp.debugTopmost ||
		os.Getenv("HS_NO_ATTACH") == "1" || resizing.Load() != 0 {
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

/* ── 边缘拉伸 ─────────────────────────────────────────────── */

// setResizeCursor 在拉伸期间锁住系统光标：鼠标会被拖出窗口范围，
// 那时 WebView2 已经收不到鼠标消息，光标只能由宿主窗口决定。
func setResizeCursor(id uintptr) {
	h, _, _ := pLoadCursorW.Call(0, id)
	if h != 0 {
		_, _, _ = pSetCursor.Call(h)
	}
}

// resizeStart 由网页边缘感应层的 pointerdown 触发（经 postUI 排到窗口线程）。
// 用 Win32 鼠标捕获而不是网页的 pointermove：缩小窗口时鼠标会跑出 WebView2，
// 只有系统级捕获还能持续收到 WM_MOUSEMOVE / WM_LBUTTONUP。
func resizeStart(name string) {
	e, ok := resizeEdges[name]
	if !ok || gApp == nil || gApp.hwnd == 0 || gResize != nil {
		return
	}
	// 「按下即松开」时 HTTP 请求可能晚于 pointerup 才到，此时别再抢捕获，
	// 否则会留下一个再也等不到松手事件的拉伸态。
	key, _, _ := pGetAsyncKeyState.Call(vkLButton)
	if key&0x8000 == 0 {
		return
	}
	var pt point
	if r, _, _ := pGetCursorPos.Call(uintptr(unsafe.Pointer(&pt))); r == 0 {
		return
	}
	gResize = &resizeState{edge: e, startCursor: pt, startRect: windowRect()}
	_, _, _ = pReleaseCapture.Call() // 释放 WebView2 可能持有的捕获
	_, _, _ = pSetCapture.Call(uintptr(gApp.hwnd))
	resizing.Store(1)
	setResizeCursor(e.cursor)
	log.Printf("开始拉伸：%s 起点=(%d,%d)", name, pt.X, pt.Y)
}

func resizeMove() {
	rs := gResize
	if rs == nil {
		return
	}
	var pt point
	if r, _, _ := pGetCursorPos.Call(uintptr(unsafe.Pointer(&pt))); r == 0 {
		return
	}
	// 全程物理像素：GetCursorPos / GetWindowRect 在 Per-Monitor-V2 下都是物理值。
	dx := pt.X - rs.startCursor.X
	dy := pt.Y - rs.startCursor.Y
	rc := rs.startRect
	l, t, r, b := rc.Left, rc.Top, rc.Right, rc.Bottom

	s := dpiScale()
	minW := int32(math.Round(minWindowWidth * s))
	minH := int32(math.Round(minWindowHeight * s))
	wa := primaryWorkArea()
	maxW := int32(math.Round(float64(wa.Right-wa.Left) * 1.5))
	maxH := int32(math.Round(float64(wa.Bottom-wa.Top) * 1.5))
	if maxW < minW {
		maxW = minW
	}
	if maxH < minH {
		maxH = minH
	}

	if rs.edge.left {
		l = rc.Left + dx
		if r-l < minW {
			l = r - minW
		}
	}
	if rs.edge.right {
		r = rc.Right + dx
		if r-l < minW {
			r = l + minW
		}
	}
	if rs.edge.top {
		t = rc.Top + dy
		if b-t < minH {
			t = b - minH
		}
	}
	if rs.edge.bottom {
		b = rc.Bottom + dy
		if b-t < minH {
			b = t + minH
		}
	}
	if r-l > maxW {
		if rs.edge.left {
			l = r - maxW
		} else {
			r = l + maxW
		}
	}
	if b-t > maxH {
		if rs.edge.top {
			t = b - maxH
		} else {
			b = t + maxH
		}
	}

	_, _, _ = pSetWindowPos.Call(
		uintptr(gApp.hwnd), 0,
		uintptr(int(l)), uintptr(int(t)),
		uintptr(int(r-l)), uintptr(int(b-t)),
		swpNoZOrder|swpNoActivate,
	)
}

func resizeEnd() {
	if gResize == nil {
		return
	}
	gResize = nil
	resizing.Store(0)
	_, _, _ = pReleaseCapture.Call()
	persistBounds() // 记住新位置与尺寸，重启后保持
	pinToBottom()
	// 网页侧可能收不到 pointerup（捕获在宿主窗口），由宿主主动通知它解锁光标。
	postUI(func() {
		if gApp != nil && gApp.chrome != nil {
			gApp.chrome.Eval("window.dispatchEvent(new Event('hs-resize-end'))")
		}
	})
}

func quitApp() {
	_, _, _ = pPostMessageW.Call(uintptr(gApp.hwnd), wmClose, 0, 0)
}

// 无边框窗口没有非客户区，hit-test 必须完整交给 DefWindowProc 转发给 WebView2 子窗口。
// 若在这里对边缘返回 HTLEFT / HTRIGHT 之类的边框值，系统会把那几像素当成非客户区，
// 网页就收不到 pointerdown，边缘拉伸感应层会整个失效。
// 调整大小改由网页感应层发起，宿主用 SetCapture 接管鼠标（见 resizeStart）。
func hitTest(lp uintptr) uintptr {
	r, _, _ := pDefWindowProcW.Call(uintptr(gApp.hwnd), wmNcHitTest, 0, lp)
	// 透明窗口下 DefWindowProc 对透明像素返回 HTTRANSPARENT，
	// 会让鼠标点击穿透到桌面。强制改回客户区，保证透明处仍能交互。
	if int64(r) == htTransparent {
		return htClient
	}
	return r
}

func wndproc(hwnd, umsg, wp, lp uintptr) uintptr {
	switch umsg {
	case wmEraseBkgnd:
		// 分层透明窗口在尺寸变化时会收到 WM_ERASEBKGND，
		// 交给 DefWindowProc 会用类背景画刷（默认黑）擦掉新暴露的区域，
		// WebView2 晚一帧才重绘，于是出现一瞬间的黑色过渡。
		// WebView2 覆盖整个客户区，本就没有需要擦除的背景，直接报告已处理。
		return 1
	case wmSize:
		if gApp != nil && gApp.chrome != nil {
			// 只同步 bounds。透明底色已由启动时的环境变量固定为全透明，
			// 逐帧再调 PutDefaultBackgroundColor 反而会在 resize 时引入闪烁。
			gApp.chrome.Resize()
		}
		updateWindowRegion()
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
			mmi.MinTrackSize[0] = int32(math.Round(minWindowWidth * s))
			mmi.MinTrackSize[1] = int32(math.Round(minWindowHeight * s))
		}
		return 0
	case wmMouseMove:
		if gResize != nil {
			resizeMove()
			return 0
		}
	case wmLButtonUp:
		if gResize != nil {
			resizeEnd()
			return 0
		}
	case wmCancelMode, wmCaptureChanged:
		if gResize != nil {
			resizeEnd()
			return 0
		}
	case wmSetCursor:
		if gResize != nil {
			setResizeCursor(gResize.edge.cursor)
			return 1
		}
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
	// 调试用：允许和已运行的正式实例并存（端口会自动顺延），便于隔离复现问题。
	if os.Getenv("HS_ALLOW_MULTI") == "1" {
		return true
	}
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
		CbSize: uint32(unsafe.Sizeof(wndClassExW{})),
		// 不设 CS_HREDRAW|CS_VREDRAW：那会让每次尺寸变化都强制整窗重绘，
		// 对分层透明窗口就是一次黑闪。背景擦除由 WM_ERASEBKGND 自己接管。
		Style:         0,
		HInstance:     hInst,
		LpfnWndProc:   windows.NewCallback(wndproc),
		LpszClassName: className,
		HCursor:       windows.Handle(cursor),
		HbrBackground: 0, // 无背景画刷，配合 WM_ERASEBKGND 返回 1
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

	// WS_EX_NOREDIRECTIONBITMAP 让 WebView2 的 DirectComposition 表面直接参与
	// 桌面合成，透明像素才能真正透出桌面。注意这种模式下不能调用
	// SetLayeredWindowAttributes(alpha=255)，否则会强制整窗不透明、透明区变黑。
	exStyle := uintptr(wsExLayered | wsExNoRedirBitmap | wsExToolWindow)
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
	// 不调用 SetLayeredWindowAttributes —— alpha=255 会把 WebView2 透明像素压成黑。
	// 圆角改由 CSS border-radius 负责（见 ui/preload.js），不在此处 SetWindowRgn。
	updateWindowRegion()
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

// applyTransparency 把 WebView2 的默认背景清成全透明。
// 尺寸变化后也重设一次，避免新合成表面沿用系统默认底色。
func applyTransparency() error {
	if gApp == nil || gApp.chrome == nil {
		return fmt.Errorf("WebView2 未就绪")
	}
	// ICoreWebView2Controller2 的 vtable 是 Controller 的超集，布局一致。
	c2 := (*edge.ICoreWebView2Controller2)(unsafe.Pointer(gApp.chrome.GetController()))
	if c2 == nil {
		return fmt.Errorf("取不到 Controller2")
	}
	return c2.PutDefaultBackgroundColor(edge.COREWEBVIEW2_COLOR{A: 0, R: 0, G: 0, B: 0})
}

// updateWindowRegion 把窗口裁成和页面外壳一致的圆角矩形。
// 分层窗口 resize 后新扩展出来的表面默认是不透明黑，而圆角外那几块页面从不绘制，
// 于是四角会留下黑色尖角且不会自愈。把角从窗口形状里裁掉最干净：那里本来就应透出桌面。
func updateWindowRegion() {
	if gApp == nil || gApp.hwnd == 0 {
		return
	}
	rc := windowRect()
	w, h := rc.Right-rc.Left, rc.Bottom-rc.Top
	if w <= 0 || h <= 0 {
		return
	}
	s := dpiScale()
	logicalW := float64(w) / s
	radius := 26.0 // 与 index.html 的 .app-shell border-radius 一致
	switch {
	case logicalW <= 480:
		radius = 16
	case logicalW <= 700:
		radius = 20
	}
	r := int32(math.Round(radius * s))
	if r < 1 {
		r = 1
	}
	hrgn, _, _ := pCreateRoundRectRgn.Call(
		0, 0, uintptr(int(w+1)), uintptr(int(h+1)),
		uintptr(int(2*r)), uintptr(int(2*r)),
	)
	if hrgn == 0 {
		return
	}
	// SetWindowRgn 成功后系统接管 HRGN，不要再 DeleteObject。
	_, _, _ = pSetWindowRgn.Call(uintptr(gApp.hwnd), hrgn, 1)
}

func setupWebView() error {
	// 微软文档：DefaultBackgroundColor 通过 API 设置会在生效前闪一下默认底色
	// （resize 时尤其明显），而用环境变量在进程启动时设定则无此闪烁。
	// 00000000 = RGBA 全透明。必须在 WebView2 环境创建前设置且只生效一次。
	if _, ok := os.LookupEnv("WEBVIEW2_DEFAULT_BACKGROUND_COLOR"); !ok {
		_ = os.Setenv("WEBVIEW2_DEFAULT_BACKGROUND_COLOR", "00000000")
	}
	chrome := edge.NewChromium()
	chrome.DataPath = filepath.Join(userDataDir, "webview2")
	gApp.chrome = chrome
	if !chrome.Embed(uintptr(gApp.hwnd)) {
		return fmt.Errorf("WebView2 初始化失败（系统可能未安装 WebView2 Runtime）")
	}
	if err := applyTransparency(); err != nil {
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
