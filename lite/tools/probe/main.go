// 窗口层级探针：诊断原型窗口的 z-order，并可临时置顶/复位以便截图验证。
package main

import (
	"fmt"
	"os"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	user32 = windows.NewLazySystemDLL("user32.dll")

	pFindWindowW     = user32.NewProc("FindWindowW")
	pGetWindow       = user32.NewProc("GetWindow")
	pGetClassNameW   = user32.NewProc("GetClassNameW")
	pIsWindowVisible = user32.NewProc("IsWindowVisible")
	pIsIconic        = user32.NewProc("IsIconic")
	pGetWindowRect   = user32.NewProc("GetWindowRect")
	pSetWindowPos    = user32.NewProc("SetWindowPos")
	pPostMessageW    = user32.NewProc("PostMessageW")
)

type rect struct{ Left, Top, Right, Bottom int32 }

const (
	gwNext        = 2
	gwPrev        = 3
	swpNoSize     = 0x0001
	swpNoMove     = 0x0002
	swpNoActivate = 0x0010
)

func className(h uintptr) string {
	if h == 0 {
		return "(none)"
	}
	buf := make([]uint16, 256)
	_, _, _ = pGetClassNameW.Call(h, uintptr(unsafe.Pointer(&buf[0])), 256)
	return windows.UTF16ToString(buf)
}

func ptr(s string) *uint16 {
	p, _ := windows.UTF16PtrFromString(s)
	return p
}

func describe(h uintptr, label string) {
	var r rect
	_, _, _ = pGetWindowRect.Call(h, uintptr(unsafe.Pointer(&r)))
	vis, _, _ := pIsWindowVisible.Call(h)
	ico, _, _ := pIsIconic.Call(h)
	fmt.Printf("%-8s hwnd=%-10d class=%-24s visible=%d iconic=%d rect=(%d,%d)-(%d,%d)\n",
		label, h, className(h), vis, ico, r.Left, r.Top, r.Right, r.Bottom)
}

func main() {
	cls := "hs-lite-window"
	if v := os.Getenv("HS_WINDOW_CLASS"); v != "" {
		cls = v
	}
	h, _, _ := pFindWindowW.Call(uintptr(unsafe.Pointer(ptr(cls))), 0)
	if h == 0 {
		fmt.Println("窗口未找到: class=" + cls)
		os.Exit(1)
	}
	progman, _, _ := pFindWindowW.Call(uintptr(unsafe.Pointer(ptr("Progman"))), 0)
	next, _, _ := pGetWindow.Call(h, gwNext)
	prev, _, _ := pGetWindow.Call(h, gwPrev)
	anchor, _, _ := pGetWindow.Call(progman, gwPrev)

	mode := "diag"
	if len(os.Args) > 1 {
		mode = os.Args[1]
	}
	switch mode {
	case "top":
		_, _, _ = pSetWindowPos.Call(h, ^uintptr(0), 0, 0, 0, 0, swpNoSize|swpNoMove|swpNoActivate)
		fmt.Println("已临时置顶（仅用于截图验证）")
	case "bottom":
		_, _, _ = pSetWindowPos.Call(h, anchor, 0, 0, 0, 0, swpNoSize|swpNoMove|swpNoActivate)
		fmt.Println("已恢复到桌面贴底位置")
	case "hotkey":
		id := uintptr(1)
		if len(os.Args) > 2 {
			if os.Args[2] == "2" {
				id = 2
			}
		}
		// 模拟系统派发 WM_HOTKEY(0x0312)，验证热键处理分支
		_, _, _ = pPostMessageW.Call(h, 0x0312, id, 0)
		fmt.Printf("已投递 WM_HOTKEY id=%d\n", id)
	}
	describe(h, "self")
	describe(prev, "prev")
	describe(next, "next")
	describe(progman, "Progman")
	describe(anchor, "anchor")
	if next == progman {
		fmt.Println("结论: z-order 正确 —— 下一个窗口就是 Progman，窗口位于桌面层之上、普通窗口之下")
	} else if mode == "top" {
		fmt.Println("结论: 当前为临时置顶状态，不判断贴底")
	} else {
		fmt.Println("结论: 贴底位置尚未稳定（下一窗口不是 Progman）")
	}
}
