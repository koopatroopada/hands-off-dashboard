// 桌面截屏小工具：纯 Win32 GDI + 标准库 PNG 编码，用于验证原型窗口效果。
package main

import (
	"fmt"
	"image"
	"image/png"
	"os"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	user32 = windows.NewLazySystemDLL("user32.dll")
	gdi32  = windows.NewLazySystemDLL("gdi32.dll")

	pSetProcessDPIAware     = user32.NewProc("SetProcessDPIAware")
	pGetSystemMetrics       = user32.NewProc("GetSystemMetrics")
	pGetDC                  = user32.NewProc("GetDC")
	pReleaseDC              = user32.NewProc("ReleaseDC")
	pCreateCompatibleDC     = gdi32.NewProc("CreateCompatibleDC")
	pCreateCompatibleBitmap = gdi32.NewProc("CreateCompatibleBitmap")
	pSelectObject           = gdi32.NewProc("SelectObject")
	pBitBlt                 = gdi32.NewProc("BitBlt")
	pGetDIBits              = gdi32.NewProc("GetDIBits")
	pDeleteObject           = gdi32.NewProc("DeleteObject")
	pDeleteDC               = gdi32.NewProc("DeleteDC")
)

type bitmapInfoHeader struct {
	BiSize          uint32
	BiWidth         int32
	BiHeight        int32
	BiPlanes        uint16
	BiBitCount      uint16
	BiCompression   uint32
	BiSizeImage     uint32
	BiXPelsPerMeter int32
	BiYPelsPerMeter int32
	BiClrUsed       uint32
	BiClrImportant  uint32
}

func main() {
	_, _, _ = pSetProcessDPIAware.Call()
	w, _, _ := pGetSystemMetrics.Call(0)
	h, _, _ := pGetSystemMetrics.Call(1)
	width, height := int(w), int(h)

	hdcScreen, _, _ := pGetDC.Call(0)
	hdcMem, _, _ := pCreateCompatibleDC.Call(hdcScreen)
	hbm, _, _ := pCreateCompatibleBitmap.Call(hdcScreen, uintptr(width), uintptr(height))
	old, _, _ := pSelectObject.Call(hdcMem, hbm)
	_, _, _ = pBitBlt.Call(hdcMem, 0, 0, uintptr(width), uintptr(height), hdcScreen, 0, 0, 0x00CC0020)

	buf := make([]byte, width*height*4)
	bi := bitmapInfoHeader{
		BiSize:      uint32(unsafe.Sizeof(bitmapInfoHeader{})),
		BiWidth:     int32(width),
		BiHeight:    int32(height),
		BiPlanes:    1,
		BiBitCount:  32,
		BiSizeImage: uint32(len(buf)),
	}
	_, _, _ = pGetDIBits.Call(hdcMem, hbm, 0, uintptr(height),
		uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&bi)), 0)

	img := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		src := (height - 1 - y) * width * 4
		dst := y * img.Stride
		for x := 0; x < width; x++ {
			b, g, r, a := buf[src+x*4], buf[src+x*4+1], buf[src+x*4+2], buf[src+x*4+3]
			img.Pix[dst+x*4+0] = r
			img.Pix[dst+x*4+1] = g
			img.Pix[dst+x*4+2] = b
			img.Pix[dst+x*4+3] = 255
			_ = a
		}
	}

	out := "screen.png"
	if len(os.Args) > 1 {
		out = os.Args[1]
	}
	f, err := os.Create(out)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer f.Close()
	if err := png.Encode(f, img); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	_, _, _ = pSelectObject.Call(hdcMem, old)
	_, _, _ = pDeleteObject.Call(hbm)
	_, _, _ = pDeleteDC.Call(hdcMem)
	_, _, _ = pReleaseDC.Call(0, hdcScreen)
	fmt.Printf("saved %dx%d -> %s\n", width, height, out)
}
