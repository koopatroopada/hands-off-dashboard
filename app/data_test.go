package main

// 解析与数据组装的回归测试：重点盯住「跨工作目录同名项目」这类
// 会让 /api/handoff?id= 与置顶状态认错项目的情况。

import (
	"os"
	"path/filepath"
	"testing"
)

func writeHandoff(t *testing.T, dir, body string) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("建目录失败 %s: %v", dir, err)
	}
	if err := os.WriteFile(filepath.Join(dir, handoffName), []byte(body), 0o644); err != nil {
		t.Fatalf("写文档失败 %s: %v", dir, err)
	}
}

func tempRoots(t *testing.T, names ...string) string {
	t.Helper()
	return t.TempDir()
}

func TestResolveSpecsIDsUniqueAcrossRoots(t *testing.T) {
	base := t.TempDir()
	rootA := filepath.Join(base, "a")
	rootB := filepath.Join(base, "b")
	writeHandoff(t, filepath.Join(rootA, "同名项目"), "Why: A 的说明\n")
	writeHandoff(t, filepath.Join(rootB, "同名项目"), "Why: B 的说明\n")
	writeHandoff(t, filepath.Join(rootA, "独立项目"), "Why: 唯一\n")

	cfg := &Config{Roots: []string{rootA, rootB}}
	specs, err := resolveSpecs(cfg)
	if err != nil {
		t.Fatalf("resolveSpecs 出错：%v", err)
	}
	if len(specs) != 3 {
		t.Fatalf("期望 3 个项目，实际 %d", len(specs))
	}

	seen := map[string]string{}
	for _, s := range specs {
		if prev, ok := seen[s.ID]; ok {
			t.Fatalf("id 冲突：%q 同时属于 %s 和 %s", s.ID, prev, s.Dir)
		}
		seen[s.ID] = s.Dir
	}
}

func TestUniqueIDStableAndReadable(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "r")
	writeHandoff(t, filepath.Join(root, "项目甲"), "Why: 只有一个\n")

	cfg := &Config{Roots: []string{root}}
	first, err := resolveSpecs(cfg)
	if err != nil {
		t.Fatalf("resolveSpecs 出错：%v", err)
	}
	second, err := resolveSpecs(cfg)
	if err != nil {
		t.Fatalf("resolveSpecs 出错：%v", err)
	}
	if first[0].ID != second[0].ID {
		t.Fatalf("id 不稳定：%q -> %q", first[0].ID, second[0].ID)
	}
	// 没有重名时保持原样，避免既有置顶记录失效。
	if first[0].ID != "项目甲" {
		t.Fatalf("唯一项目的 id 不应被改写，实际 %q", first[0].ID)
	}
	if first[0].Name != "项目甲" {
		t.Fatalf("展示名不应变化，实际 %q", first[0].Name)
	}
}

func TestReadProjectKeepsNameOnDuplicate(t *testing.T) {
	base := t.TempDir()
	rootA := filepath.Join(base, "a")
	rootB := filepath.Join(base, "b")
	writeHandoff(t, filepath.Join(rootA, "同名"), "Why: A 的说明\n")
	writeHandoff(t, filepath.Join(rootB, "同名"), "Why: B 的说明\n")

	cfg := &Config{Roots: []string{rootA, rootB}}
	specs, err := resolveSpecs(cfg)
	if err != nil {
		t.Fatalf("resolveSpecs 出错：%v", err)
	}

	whys := map[string]string{}
	for _, s := range specs {
		p := readProject(s, rootA)
		if p.Name != "同名" {
			t.Fatalf("展示名被改动：%q", p.Name)
		}
		if p.Why == nil {
			t.Fatalf("%s 的 why 没有解析出来", s.Dir)
		}
		whys[s.ID] = *p.Why
	}
	if len(whys) != 2 {
		t.Fatalf("期望 2 个不同 id，实际 %d", len(whys))
	}
	if whys[specs[0].ID] == whys[specs[1].ID] {
		t.Fatalf("两个同名项目解析到了同一份文档：%v", whys)
	}
}

func TestParseHeaderAndDates(t *testing.T) {
	text := "\uFEFFAudience: 我自己\nWhy: 想一眼看清进度\nStages: 一 → 二 → 三\nCurrent: 二\n" +
		"Next-Determined: UNDETERMINED\nCreated: 2026-11-03\nLast-Activity: 2026-11-17\n\n# Handoff: 标题\n正文不解析\n"
	h := parseHeader(text)
	if h["why"] != "想一眼看清进度" {
		t.Fatalf("why 解析错误：%q", h["why"])
	}
	if got := splitStages(h["stages"]); len(got) != 3 || got[1] != "二" {
		t.Fatalf("stages 解析错误：%v", got)
	}
	if p := parseBooleanFlag(h["nextdetermined"]); p == nil || *p {
		t.Fatalf("UNDETERMINED 应解析为 false")
	}
	if d := parseDate(h["created"]); d == nil || *d != "2026-11-03" {
		t.Fatalf("created 解析错误：%v", d)
	}
	if got := firstHeading(text); got == nil || *got != "标题" {
		t.Fatalf("标题解析错误：%v", got)
	}
}

func TestIgnoredAndHiddenDirsSkipped(t *testing.T) {
	base := t.TempDir()
	writeHandoff(t, filepath.Join(base, "保留"), "Why: x\n")
	writeHandoff(t, filepath.Join(base, ".隐藏"), "Why: x\n")
	writeHandoff(t, filepath.Join(base, "node_modules"), "Why: x\n")
	writeHandoff(t, filepath.Join(base, "自定义忽略"), "Why: x\n")

	specs, err := resolveSpecs(&Config{Roots: []string{base}, Ignore: []string{"自定义忽略"}})
	if err != nil {
		t.Fatalf("resolveSpecs 出错：%v", err)
	}
	if len(specs) != 1 || specs[0].Name != "保留" {
		names := []string{}
		for _, s := range specs {
			names = append(names, s.Name)
		}
		t.Fatalf("期望只剩「保留」，实际 %v", names)
	}
}
