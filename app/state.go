package main

// 配置与状态：config.json 提供默认工作目录，
// %APPDATA%/hands-off-dashboard/desktop-state.json 保存窗口位置、透明度与工作目录。

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
)

const appVersion = "1.1.2"

// Config 对应 config.json + loadConfig() 的解析结果。
type Config struct {
	Roots    []string        `json:"roots"`
	Root     string          `json:"root"`
	Port     int             `json:"port"`
	Open     bool            `json:"open"`
	Projects []ProjectConfig `json:"projects"`
	Ignore   []string        `json:"ignore"`
}

type ProjectConfig struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Dir  string `json:"dir"`
}

// State 对应 %APPDATA%/hands-off-dashboard/desktop-state.json。
// 指针字段用来区分「没存过」和「存了 0」；未识别的字段读取时丢弃。
type State struct {
	X            *int     `json:"x,omitempty"`
	Y            *int     `json:"y,omitempty"`
	Width        *int     `json:"width,omitempty"`
	Height       *int     `json:"height,omitempty"`
	ShellOpacity *float64 `json:"shellOpacity,omitempty"`
	CardOpacity  *float64 `json:"cardOpacity,omitempty"`
	Roots        []string `json:"roots,omitempty"`
	FirstRunDone bool     `json:"firstRunDone,omitempty"`
}

var (
	stateMu     sync.Mutex
	statePath   string
	userDataDir string
)

func initPaths() {
	appData, _ := os.UserConfigDir() // Windows: %APPDATA%
	if appData == "" {
		appData = os.Getenv("APPDATA")
	}
	userDataDir = filepath.Join(appData, "hands-off-dashboard")
	// 调试/测试时把状态与 WebView2 数据隔离，避免改动用户真实配置。
	if v := os.Getenv("HS_STATE_DIR"); v != "" {
		userDataDir = v
	}
	statePath = filepath.Join(userDataDir, "desktop-state.json")

	// 兼容早期版本的状态文件位置，迁移一次。
	legacy := filepath.Join(appData, "Electron", "desktop-state.json")
	if _, err := os.Stat(statePath); os.IsNotExist(err) {
		if b, e := os.ReadFile(legacy); e == nil {
			_ = os.MkdirAll(userDataDir, 0o755)
			_ = os.WriteFile(statePath, b, 0o644)
		}
	}
}

func readState() State {
	stateMu.Lock()
	defer stateMu.Unlock()
	b, err := os.ReadFile(statePath)
	if err != nil {
		return State{}
	}
	var s State
	if json.Unmarshal(b, &s) != nil {
		return State{}
	}
	return s
}

// writeState 读-合并-写，保留调用方未指定的字段。
func writeState(patch State) State {
	stateMu.Lock()
	defer stateMu.Unlock()

	cur := State{}
	if b, err := os.ReadFile(statePath); err == nil {
		_ = json.Unmarshal(b, &cur)
	}
	if patch.X != nil {
		cur.X = patch.X
	}
	if patch.Y != nil {
		cur.Y = patch.Y
	}
	if patch.Width != nil {
		cur.Width = patch.Width
	}
	if patch.Height != nil {
		cur.Height = patch.Height
	}
	if patch.ShellOpacity != nil {
		cur.ShellOpacity = patch.ShellOpacity
	}
	if patch.CardOpacity != nil {
		cur.CardOpacity = patch.CardOpacity
	}
	if patch.Roots != nil {
		cur.Roots = patch.Roots
	}
	if patch.FirstRunDone {
		cur.FirstRunDone = true
	}

	_ = os.MkdirAll(userDataDir, 0o755)
	if b, err := json.MarshalIndent(cur, "", "  "); err == nil {
		_ = os.WriteFile(statePath, append(b, '\n'), 0o644)
	}
	return cur
}

func floatPtr(v float64) *float64 { return &v }
func intPtr(v int) *int           { return &v }

func toPosix(p string) string { return filepath.ToSlash(p) }

func posixRel(base, target string) string {
	rel, err := filepath.Rel(base, target)
	if err != nil || rel == "" {
		return "."
	}
	return toPosix(rel)
}

// loadConfig 读取 config.json 并合并运行时覆盖的工作目录：
// overrides.roots > overrides.root > DASHBOARD_ROOT > 配置文件 > appDir 上一级。
func loadConfig(appDir string, overrideRoots []string) Config {
	cfg := Config{Port: 4177, Open: true}
	if b, err := os.ReadFile(filepath.Join(appDir, "config.json")); err == nil {
		if json.Unmarshal(b, &cfg) != nil {
			cfg = Config{Port: 4177, Open: true}
		}
	}
	if cfg.Port <= 0 {
		cfg.Port = 4177
	}

	roots := overrideRoots
	if len(roots) == 0 && os.Getenv("DASHBOARD_ROOT") != "" {
		roots = []string{os.Getenv("DASHBOARD_ROOT")}
	}
	if len(roots) == 0 {
		roots = cfg.Roots
	}
	if len(roots) == 0 && cfg.Root != "" {
		roots = []string{cfg.Root}
	}
	if len(roots) == 0 {
		roots = []string{filepath.Dir(appDir)}
	}

	seen := map[string]bool{}
	deduped := make([]string, 0, len(roots))
	for _, item := range roots {
		resolved, err := filepath.Abs(strings.TrimSpace(item))
		if err != nil {
			continue
		}
		key := strings.ToLower(toPosix(resolved))
		if seen[key] {
			continue
		}
		seen[key] = true
		deduped = append(deduped, resolved)
	}
	cfg.Roots = deduped
	if len(deduped) > 0 {
		cfg.Root = deduped[0]
	}
	if v := os.Getenv("DASHBOARD_PORT"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			cfg.Port = n
		}
	}
	return cfg
}
