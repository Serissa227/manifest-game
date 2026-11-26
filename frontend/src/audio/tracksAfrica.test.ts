// 地方特色第二阶段·非洲（评审后补）：曲子的写法守住当地的规矩，两套编配都查——
// 象牙号一支只吹一两个音（几支号按音高分工，合起来才是一句）；贝宁湾的《胡椒与铜手镯》只用贝宁湾的乐器、不借曼丁的；
// 埃塞俄比亚教堂的贝格纳琴与采纳齐尔叉铃只在引子与尾声（“远处的教堂”），正文是阿兹马里的世俗合奏；
// 《赤道的长浪》第二遍（刚果与安哥拉的海岸）不按“地方”换和声：衬底只有 D 上的空五度，利肯贝转一个两小节的圈。
import { describe, expect, it } from "vitest";
import { ORCH_TRACKS } from "./orchestra/tracks";
import { realizePass, type TrackDef } from "./score";
import { TRACKS } from "./tracks";
import { byPitch, hocket } from "./tracks/weave";

/** 两套编配。 */
const both = (id: keyof typeof TRACKS): TrackDef[] => [TRACKS[id], ORCH_TRACKS[id]];

/** 曲式一步里的演奏记号：旋律行（可能没有）与声部。 */
function plays(play: string): { line?: string; voice: string }[] {
  return play
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => {
      const m = /^(?:(\w+):)?(\w+)/.exec(t)!;
      return { line: m[1], voice: m[2] };
    });
}

/** 一个声部用到的鼓点（伴奏型的所有变体）。 */
function hitsOf(track: TrackDef, voice: string): string[] {
  const p = track.voices[voice].pattern;
  if (!p) return [];
  const variants = "kind" in p ? [p] : Object.values(p);
  return variants.flatMap((v) => (v.kind === "drum" ? Object.values(v.hits).map(([h]) => h) : []));
}

describe("按音高分声部（byPitch）", () => {
  it("几个声部的音名合起来覆盖整句、互不重复时，合起来正好是原来的旋律；每个声部只出现自己的音，小节长度不变", () => {
    const line = "!bend!D6 C3 A,3 | !bend!C6 A,3 C3 | !bend!D6 !fall!D,6 | z12";
    const parts = [byPitch(line, ["D", "D,"]), byPitch(line, ["C"]), byPitch(line, ["A,"])];
    const tokens = (s: string) => s.split(/\s+/).filter(Boolean);
    const orig = tokens(line);
    for (const p of parts) expect(tokens(p).length).toBe(orig.length);
    for (let i = 0; i < orig.length; i++) {
      const sounding = parts.map((p) => tokens(p)[i]).filter((t) => t !== "|" && !t.startsWith("z"));
      if (orig[i] === "|" || orig[i].startsWith("z")) expect(sounding, `第 ${i} 项`).toEqual([]);
      else expect(sounding, `第 ${i} 项`).toEqual([orig[i]]);
    }
    expect(parts[1]).toBe("z6 C3 z3 | !bend!C6 z3 C3 | z6 z6 | z12");
    // 与按先后交替的 hocket 不同：刚果的号声按先后交替拆，第一支号要吹 D、B、G 三个音；按音高分工，每支只有两个
    const names = (s: string) => new Set(tokens(s).filter((t) => t !== "|" && !t.startsWith("z")).map((t) => t.replace(/^(?:![a-z]+!)*/, "").replace(/[0-9/]+$/, "")));
    const call = "!bend!D6 B,3 D3 | !bend!E6 !fall!D6 | !bend!G,6 B,3 D3 | !fall!G,12";
    expect(names(hocket(call, 0)).size).toBeGreaterThan(2);
    expect([...names(byPitch(call, ["G,", "B,"]))].sort()).toEqual(["B,", "G,"]);
    expect([...names(byPitch(call, ["D", "E"]))].sort()).toEqual(["D", "E"]);
    for (const p of parts) expect(names(p).size).toBeLessThanOrEqual(2);
  });
});

describe("非洲的曲子：当地的规矩（评审后补）", () => {
  it("象牙号（姆蓬吉，贝宁的象牙号也借它）一支只吹一两个音：每支号每一遍最多两个音高，几支号合起来吹出句子", () => {
    for (const id of ["port_kongo", "port_benin", "sea_guinea"] as const) {
      for (const track of both(id)) {
        const horns = Object.keys(track.voices).filter((v) => track.voices[v].inst === "mpungi");
        expect(horns.length, id).toBeGreaterThanOrEqual(2);
        for (let pass = 0; pass < track.forms.length; pass++) {
          const events = realizePass(track, pass).events;
          for (const h of horns) {
            const pitches = new Set(events.filter((e) => e.voice === h).map((e) => Math.round(e.m)));
            expect(pitches.size, `${id} 第 ${pass + 1} 遍 ${h}：${[...pitches].join(" ")}`).toBeLessThanOrEqual(2);
          }
          const sounding = new Set(events.filter((e) => horns.includes(e.voice)).map((e) => e.voice));
          expect(sounding.size, `${id} 第 ${pass + 1} 遍`).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  it("《胡椒与铜手镯》（瓜托）只用贝宁湾的乐器：阿克帕塔、象牙号、埃戈戈铁双铃、伊亚伊卢与甘甘、古杜古杜、珠网沙铃；没有曼丁的科拉琴、恩戈尼、巴拉丰、金贝鼓、敦敦鼓", () => {
    const mande = ["kora", "ngoni", "balafon", "tambin"];
    for (const track of both("port_benin")) {
      const insts = new Set(Object.values(track.voices).map((v) => v.inst));
      const hits = Object.keys(track.voices).flatMap((v) => hitsOf(track, v));
      for (const k of mande) expect(insts.has(k), k).toBe(false);
      for (const h of hits) expect(/^(djembe|dundun)_/.test(h), h).toBe(false);
      for (const k of ["akpata", "mpungi"]) expect(insts.has(k), k).toBe(true);
      for (const prefix of ["egogo_", "iya_", "gangan_", "gudugudu_", "shekere"]) expect(hits.some((h) => h.startsWith(prefix)), prefix).toBe(true);
    }
  });

  it("《盐砖与乳香》：贝格纳琴与采纳齐尔叉铃只在引子与尾声；B 段的低音由克拉尔琴拨", () => {
    for (const track of both("port_ethiopia")) {
      const sacred = Object.keys(track.voices).filter((v) => track.voices[v].inst === "begena" || hitsOf(track, v).some((h) => h.startsWith("tsenatsil")));
      expect(sacred.length).toBe(2);
      for (const form of track.forms) {
        for (const step of form) {
          const used = plays(step.play).filter((p) => sacred.includes(p.voice));
          if (step.s !== "intro" && step.s !== "coda") expect(used, `${step.s}：${step.play}`).toEqual([]);
          if (step.s === "B") expect(plays(step.play).some((p) => p.line === "blow" && track.voices[p.voice].inst === "krar"), step.play).toBe(true);
        }
      }
    }
  });

  it("《赤道的长浪》第二遍（刚果与安哥拉）：衬底只有 D 上的空五度，利肯贝转两小节一圈的音型、不跟和声走；第一遍的科拉琴照旧按“地方”摇", () => {
    for (const track of both("sea_guinea")) {
      const [first, second] = track.forms;
      for (const step of second) {
        const section = track.sections[step.s];
        const bars = (section.chords ?? "").split("|").map((c) => c.trim());
        expect(bars.length, step.s).toBe(section.bars);
        for (const c of bars) expect(c, step.s).toBe("D5");
        for (const p of plays(step.play).filter((q) => track.voices[q.voice].inst === "likembe")) {
          const loop = section.lines![p.line!].split("|").map((b) => b.trim());
          for (let i = 0; i < loop.length; i++) expect(loop[i], `${step.s}/${p.line} 第 ${i + 1} 小节`).toBe(loop[i % 2]);
        }
        expect(plays(step.play).some((p) => track.voices[p.voice].inst === "likembe"), step.s).toBe(true);
      }
      // 第一遍：科拉琴按“地方”换（A 段 D G D A……）
      const a = track.sections[first[1].s];
      expect(new Set((a.chords ?? "").split("|").map((c) => c.trim())).size).toBeGreaterThan(1);
    }
  });
});
