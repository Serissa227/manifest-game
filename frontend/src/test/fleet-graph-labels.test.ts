// 关系图（新界面 v2）的字号与线上标签的位置（components/people/graphLabels.ts）：
// 字号按 svg 的缩放折算（手机上显示仍不小于 12 px）；线上的标签躲开圆点、名字与别的标签，都躲不开时挑重叠最少的一处。
import { describe, expect, it } from "vitest";
import { graphFontSizes, overlapArea, placeEdgeLabels, textBox, textWidth, type Box } from "../components/people/graphLabels";

describe("关系图的字号", () => {
  it("量不到缩放时按桌面：线上 12、名字 13", () => {
    expect(graphFontSizes(null)).toEqual({ edge: 12, node: 13 });
    expect(graphFontSizes(0)).toEqual({ edge: 12, node: 13 });
    expect(graphFontSizes(Number.NaN)).toEqual({ edge: 12, node: 13 });
  });

  it("桌面放大（640 / 520）时照旧 12 / 13，显示出来更大", () => {
    expect(graphFontSizes(640 / 520)).toEqual({ edge: 12, node: 13 });
  });

  it("手机上缩到约 0.7 倍：字号放大，显示出来线上标签与名字都不小于 12 px", () => {
    for (const w of [320, 340, 360, 390]) {
      const k = w / 520;
      const fs = graphFontSizes(k);
      expect(fs.edge * k).toBeGreaterThanOrEqual(12);
      expect(fs.node * k).toBeGreaterThanOrEqual(13);
      expect(fs.node).toBeGreaterThanOrEqual(fs.edge);
    }
  });
});

describe("线上标签的位置", () => {
  it("估算字宽：汉字一个字号、拉丁字母 0.6 个", () => {
    expect(textWidth("恋人", 10)).toBe(20);
    expect(textWidth("Jan", 10)).toBeCloseTo(18, 6);
    const b = textBox("恋人", 100, 50, 10, 0);
    expect([b.x0, b.x1]).toEqual([90, 110]);
    expect(b.y0).toBeCloseTo(41, 6);
    expect(b.y1).toBeCloseTo(52.5, 6);
  });

  it("中点没有遮挡时就在中点上方 4（与旧界面一样）", () => {
    const [p] = placeEdgeLabels([{ a: { x: 0, y: 100 }, b: { x: 200, y: 100 }, label: "朋友" }], [], 12);
    expect(p).toEqual({ x: 100, y: 96 });
  });

  it("中点压着别人的名字时沿线挪开，不与障碍重叠", () => {
    const edge = { a: { x: 0, y: 100 }, b: { x: 400, y: 100 }, label: "恋人" };
    // 一个名字正好在中点上
    const name = textBox("罗塞拉", 200, 96, 13);
    const [p] = placeEdgeLabels([edge], [name], 12);
    expect(p.y).toBe(96);
    expect(p.x).not.toBe(200);
    expect(overlapArea(textBox("恋人", p.x, p.y, 12), name)).toBe(0);
  });

  it("两条线的标签不叠在一起：后放的躲开先放的", () => {
    const e1 = { a: { x: 0, y: 100 }, b: { x: 400, y: 100 }, label: "朋友" };
    const e2 = { a: { x: 0, y: 100 }, b: { x: 400, y: 100 }, label: "对手" };
    const [p1, p2] = placeEdgeLabels([e1, e2], [], 12);
    expect(overlapArea(textBox("朋友", p1.x, p1.y, 12), textBox("对手", p2.x, p2.y, 12))).toBe(0);
  });

  it("处处都有遮挡时挑重叠最少的一处（不报错、每条线都有位置）", () => {
    const wall: Box = { x0: -1000, x1: 1000, y0: -1000, y1: 1000 };
    const out = placeEdgeLabels([{ a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, label: "师徒" }], [wall], 12);
    expect(out).toHaveLength(1);
    expect(Number.isFinite(out[0].x) && Number.isFinite(out[0].y)).toBe(true);
  });
});
