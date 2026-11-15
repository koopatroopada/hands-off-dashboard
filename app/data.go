package main

// HANDOFF.md 解析与 /api/projects 数据组装。
// 字段名、null 语义、错误文案与边界处理都在这里统一定义，
// 输出结构即 index.html 直接使用的数据契约。

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"golang.org/x/text/collate"
	"golang.org/x/text/language"
)

const handoffName = "HANDOFF.md"

var skipDirs = map[string]bool{
	"node_modules": true, "dist": true, "build": true,
	".git": true, ".workbuddy": true, ".superpowers": true,
}

var (
	reHeaderLine = regexp.MustCompile(`^([A-Za-z][A-Za-z0-9 _-]*?):\s*(.*)$`)
	reKeyNoise   = regexp.MustCompile(`[^a-z0-9]`)
	reStages     = regexp.MustCompile(`→|->|⇒`)
	reDate       = regexp.MustCompile(`(\d{4})-(\d{2})-(\d{2})`)
	reNA         = regexp.MustCompile(`(?i)^(?:n/?a|none|null|-|无|暂无)[.。]?$`)
	reHeading    = regexp.MustCompile(`(?m)^#\s+(.+)$`)
	reHandoffPre = regexp.MustCompile(`(?i)^handoff\s*[:：]\s*`)
	reGenerated  = regexp.MustCompile(`生成时间\s*[:：]\s*(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?`)

	// JS 里用 localeCompare('zh-CN')，这里用同一套中文排序规则。
	zhCollator = collate.New(language.MustParse("zh-CN"))
)

type handoffInfo struct {
	Path    string  `json:"path"`
	RelPath string  `json:"relPath"`
	Mtime   string  `json:"mtime"`
	Bytes   int64   `json:"bytes"`
	Title   *string `json:"title"`
}

type project struct {
	ID             string       `json:"id"`
	Name           string       `json:"name"`
	Dir            string       `json:"dir"`
	RelDir         string       `json:"relDir"`
	Handoff        *handoffInfo `json:"handoff"`
	Error          *string      `json:"error"`
	Title          *string      `json:"title"`
	GeneratedAt    *string      `json:"generatedAt"`
	Audience       *string      `json:"audience"`
	Why            *string      `json:"why"`
	Stages         []string     `json:"stages"`
	Current        *string      `json:"current"`
	Evidence       *string      `json:"evidence"`
	Gate           *string      `json:"gate"`
	Blocker        *string      `json:"blocker"`
	Next           *string      `json:"next"`
	NextDetermined *bool        `json:"nextDetermined"`
	Created        *string      `json:"created"`
	LastActivity   *string      `json:"lastActivity"`
}

type payload struct {
	Root        string    `json:"root"`
	Roots       []string  `json:"roots"`
	GeneratedAt string    `json:"generatedAt"`
	Count       int       `json:"count"`
	Projects    []project `json:"projects"`
}

type spec struct {
	ID          string
	Name        string
	Dir         string
	Root        string
	HandoffPath string
}

// JS 的 Date.toISOString() 把亚毫秒四舍五入，Go 的 Format 是截断；
// 先加 500µs 才能与 Node 版逐字节一致。
func isoTime(t time.Time) string {
	return t.UTC().Add(500 * time.Microsecond).Format("2006-01-02T15:04:05.000Z")
}

func normalizeKey(raw string) string {
	return reKeyNoise.ReplaceAllString(strings.ToLower(raw), "")
}

// parseHeader：以第一个空行为界，之后正文不参与解析。
func parseHeader(text string) map[string]string {
	text = strings.TrimPrefix(text, "\uFEFF")
	text = strings.ReplaceAll(text, "\r\n", "\n")
	header := map[string]string{}
	for _, line := range strings.Split(text, "\n") {
		if strings.TrimSpace(line) == "" {
			break
		}
		m := reHeaderLine.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		key := normalizeKey(m[1])
		if key == "" {
			continue
		}
		header[key] = strings.TrimSpace(m[2])
	}
	return header
}

func splitStages(v string) []string {
	out := []string{}
	if v == "" {
		return out
	}
	for _, item := range reStages.Split(v, -1) {
		if item = strings.TrimSpace(item); item != "" {
			out = append(out, item)
		}
	}
	return out
}

func parseBooleanFlag(raw string) *bool {
	if raw == "" {
		return nil
	}
	v := strings.ToUpper(raw)
	// UNDETERMINED 里也含 DETERMINED，必须先判否定。
	if strings.Contains(v, "UNDETERMINED") || strings.Contains(v, "未定") {
		b := false
		return &b
	}
	if strings.Contains(v, "DETERMINED") || strings.Contains(v, "已定") {
		b := true
		return &b
	}
	return nil
}

func parseDate(raw string) *string {
	m := reDate.FindStringSubmatch(raw)
	if m == nil {
		return nil
	}
	s := m[1] + "-" + m[2] + "-" + m[3]
	return &s
}

func cleanText(raw string) *string {
	v := strings.TrimSpace(raw)
	if v == "" || reNA.MatchString(v) {
		return nil
	}
	return &v
}

func firstHeading(text string) *string {
	m := reHeading.FindStringSubmatch(text)
	if m == nil {
		return nil
	}
	v := strings.TrimSpace(reHandoffPre.ReplaceAllString(m[1], ""))
	if v == "" {
		return nil
	}
	return &v
}

func generatedAt(text string) *string {
	m := reGenerated.FindStringSubmatch(text)
	if m == nil {
		return nil
	}
	v := m[1]
	if m[2] != "" {
		v += " " + m[2]
	}
	return &v
}

func isRegularFile(p string) bool {
	st, err := os.Stat(p)
	return err == nil && st.Mode().IsRegular()
}

func isWorktree(dir string) bool {
	st, err := os.Stat(filepath.Join(dir, ".git"))
	return err == nil && !st.IsDir()
}

func compareName(a, b string) int { return zhCollator.CompareString(a, b) }

// discover：每个子文件夹默认是一个项目，但只有根目录含 HANDOFF.md 的才展示。
func discover(root string, ignore []string) ([]spec, error) {
	skipped := map[string]bool{}
	for k, v := range skipDirs {
		skipped[k] = v
	}
	for _, k := range ignore {
		skipped[k] = true
	}

	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, err
	}
	specs := []spec{}
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") || skipped[e.Name()] {
			continue
		}
		dir := filepath.Join(root, e.Name())
		if isWorktree(dir) {
			continue
		}
		hp := filepath.Join(dir, handoffName)
		if !isRegularFile(hp) {
			continue
		}
		specs = append(specs, spec{ID: e.Name(), Name: e.Name(), Dir: dir, Root: root, HandoffPath: hp})
	}
	sort.SliceStable(specs, func(i, j int) bool { return compareName(specs[i].Name, specs[j].Name) < 0 })
	return specs, nil
}

func resolveSpecs(cfg *Config) ([]spec, error) {
	roots := cfg.Roots
	if len(roots) == 0 && cfg.Root != "" {
		roots = []string{cfg.Root}
	}

	// 显式清单仍兼容（相对第一个工作目录解析）。
	if len(cfg.Projects) > 0 {
		base := ""
		if len(roots) > 0 {
			base = roots[0]
		}
		specs := []spec{}
		for _, item := range cfg.Projects {
			name := item.Name
			if name == "" && item.Dir != "" {
				name = filepath.Base(item.Dir)
			}
			if name == "" {
				continue
			}
			rel := item.Dir
			if rel == "" {
				rel = name
			}
			dir, err := filepath.Abs(filepath.Join(base, rel))
			if err != nil {
				continue
			}
			id := item.ID
			if id == "" {
				id = name
			}
			specs = append(specs, spec{ID: id, Name: name, Dir: dir, Root: base, HandoffPath: filepath.Join(dir, handoffName)})
		}
		return specs, nil
	}

	specs := []spec{}
	seen := map[string]bool{}
	for _, root := range roots {
		found, err := discover(root, cfg.Ignore)
		if err != nil {
			return nil, err
		}
		for _, s := range found {
			key := strings.ToLower(toPosix(s.Dir))
			if seen[key] {
				continue
			}
			seen[key] = true
			specs = append(specs, s)
		}
	}
	sort.SliceStable(specs, func(i, j int) bool { return compareName(specs[i].Name, specs[j].Name) < 0 })
	return specs, nil
}

func errorPtr(s string) *string { return &s }

func readProject(s spec, fallbackRoot string) project {
	ownRoot := s.Root
	if ownRoot == "" {
		ownRoot = fallbackRoot
	}
	p := project{
		ID: s.ID, Name: s.Name, Dir: s.Dir,
		RelDir: posixRel(ownRoot, s.Dir),
		Stages: []string{},
	}

	st, err := os.Stat(s.HandoffPath)
	if err != nil || !st.Mode().IsRegular() {
		p.Error = errorPtr("找不到交接文档：" + posixRel(ownRoot, s.HandoffPath) +
			"（交接文档固定为项目根目录的 " + handoffName + "）")
		return p
	}
	b, err := os.ReadFile(s.HandoffPath)
	if err != nil {
		p.Error = errorPtr("读取失败：" + err.Error())
		return p
	}
	text := string(b)
	h := parseHeader(text)
	title := firstHeading(text)

	p.Handoff = &handoffInfo{
		Path: s.HandoffPath, RelPath: posixRel(ownRoot, s.HandoffPath),
		Mtime: isoTime(st.ModTime()), Bytes: st.Size(), Title: title,
	}
	p.Title = title
	p.GeneratedAt = generatedAt(text)
	p.Audience = cleanText(h["audience"])
	p.Why = cleanText(h["why"])
	p.Stages = splitStages(h["stages"])
	p.Current = cleanText(h["current"])
	p.Evidence = cleanText(h["evidence"])
	p.Gate = cleanText(h["gate"])
	p.Blocker = cleanText(h["blocker"])
	p.Next = cleanText(h["next"])
	p.NextDetermined = parseBooleanFlag(h["nextdetermined"])
	p.Created = parseDate(h["created"])
	p.LastActivity = parseDate(h["lastactivity"])
	return p
}

func buildPayload(cfg *Config) (payload, error) {
	roots := cfg.Roots
	if len(roots) == 0 && cfg.Root != "" {
		roots = []string{cfg.Root}
	}
	specs, err := resolveSpecs(cfg)
	if err != nil {
		return payload{}, err
	}
	projects := make([]project, 0, len(specs))
	first := ""
	if len(roots) > 0 {
		first = roots[0]
	}
	for _, s := range specs {
		projects = append(projects, readProject(s, first))
	}
	posixRoots := make([]string, 0, len(roots))
	for _, r := range roots {
		posixRoots = append(posixRoots, toPosix(r))
	}
	return payload{
		Root:        toPosix(first),
		Roots:       posixRoots,
		GeneratedAt: isoTime(time.Now()),
		Count:       len(projects),
		Projects:    projects,
	}, nil
}
