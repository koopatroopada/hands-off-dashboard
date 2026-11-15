package main

// 原生目录选择框（可多选）。用纯 Go 的 IFileOpenDialog 绑定，
// 不需要 cgo / MSVC，也不需要 PowerShell 运行时编译（本机安全策略会拦）。

import (
	"log"

	"github.com/ncruces/zenity"
)

func chooseFolders(title string) ([]string, error) {
	opts := []zenity.Option{
		zenity.Title(title),
		zenity.Directory(),
		zenity.Modal(),
	}
	if gApp != nil && gApp.hwnd != 0 {
		opts = append(opts, zenity.Attach(uintptr(gApp.hwnd)))
	}
	list, err := zenity.SelectFileMultiple(opts...)
	if err != nil {
		if err == zenity.ErrCanceled {
			return nil, nil
		}
		log.Printf("目录选择失败：%v", err)
		return nil, err
	}
	return list, nil
}
