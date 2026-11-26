package main

// dedupeIDs 的边界：确认补号结果稳定、不影响唯一项目、不会产生二次冲突。

import (
	"testing"
)

func specAt(id, name, dir, root string) spec {
	return spec{ID: id, Name: name, Dir: dir, Root: root, HandoffPath: dir + "/HANDOFF.md"}
}

func TestDedupeKeepsUniqueIDs(t *testing.T) {
	in := []spec{
		specAt("甲", "甲", "/r1/甲", "/r1"),
		specAt("乙", "乙", "/r1/乙", "/r1"),
	}
	out := dedupeIDs(in)
	for i := range in {
		if out[i].ID != in[i].ID {
			t.Fatalf("唯一 id 被改写：%q -> %q", in[i].ID, out[i].ID)
		}
	}
}

func TestDedupeStableAcrossInputOrder(t *testing.T) {
	a := specAt("同名", "同名", `D:\roots\alpha\同名`, `D:\roots\alpha`)
	b := specAt("同名", "同名", `D:\roots\beta\同名`, `D:\roots\beta`)

	first := dedupeIDs([]spec{a, b})
	second := dedupeIDs([]spec{b, a})

	m := map[string]string{}
	for i, s := range first {
		m[s.Dir] = s.ID
		_ = i
	}
	n := map[string]string{}
	for _, s := range second {
		n[s.Dir] = s.ID
	}
	for dir, id := range m {
		if n[dir] != id {
			t.Fatalf("顺序影响结果：%s 得到 %q vs %q", dir, id, n[dir])
		}
	}
}

func TestDedupeHandlesThreeWayAndRootLessSpec(t *testing.T) {
	in := []spec{
		specAt("同名", "同名", "/r1/同名", "/r1"),
		specAt("同名", "同名", "/r2/同名", "/r2"),
		specAt("同名", "同名", "/r3/同名", "/r3"),
	}
	out := dedupeIDs(in)
	seen := map[string]bool{}
	for _, s := range out {
		if seen[s.ID] {
			t.Fatalf("仍存在重复 id：%q", s.ID)
		}
		seen[s.ID] = true
		if s.Name != "同名" {
			t.Fatalf("展示名被改动：%q", s.Name)
		}
	}
}

func TestDedupeEmptyAndSingle(t *testing.T) {
	if got := dedupeIDs(nil); len(got) != 0 {
		t.Fatalf("nil 输入应原样返回")
	}
	one := []spec{specAt("甲", "甲", "/r/甲", "/r")}
	if got := dedupeIDs(one); got[0].ID != "甲" {
		t.Fatalf("单元素不应改动")
	}
}
