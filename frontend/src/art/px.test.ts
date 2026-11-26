import { describe, expect, it } from "vitest";
import { Px, fromRows, hex, rgba, sheet } from "./px";
import { hash32, rng } from "./rng";

describe("像素缓冲", () => {
  it("解析颜色并按不透明度混合", () => {
    expect(hex(rgba("#abc"))).toBe("#aabbccff");
    expect(hex(rgba("#11223344"))).toBe("#11223344");
    expect(() => rgba("#12")).toThrow();
    const p = new Px(1, 1).set(0, 0, "#000000").set(0, 0, "#ffffff80");
    expect(hex(p.get(0, 0))).toBe("#808080ff");
  });

  it("绘制图元并裁剪越界部分", () => {
    const p = new Px(8, 8).rect(-2, -2, 4, 4, "#f00");
    expect(p.isOpaque(0, 0) && p.isOpaque(1, 1)).toBe(true);
    expect(p.isOpaque(2, 2)).toBe(false);
    const tri = new Px(9, 9).poly(
      [
        [0, 9],
        [4.5, 0],
        [9, 9],
      ],
      "#0f0",
    );
    expect(tri.isOpaque(4, 1)).toBe(true);
    expect(tri.isOpaque(0, 1)).toBe(false);
    expect(tri.isOpaque(4, 8) && tri.isOpaque(0, 8) && tri.isOpaque(8, 8)).toBe(true);
    const l = new Px(5, 5).line(0, 0, 4, 4, "#00f");
    expect([0, 1, 2, 3, 4].every((i) => l.isOpaque(i, i))).toBe(true);
  });

  it("字符网格、描边、翻转、裁边与拼图", () => {
    const p = fromRows(["a.", ".b"], { a: "#f00", b: "#00f" });
    expect(p.w).toBe(2);
    expect(p.isOpaque(1, 0)).toBe(false);
    const o = p.outlined("#000");
    expect([o.w, o.h]).toEqual([4, 4]);
    expect(hex(o.get(0, 1))).toBe("#000000ff");
    expect(hex(p.flipX().get(1, 0))).toBe("#ff0000ff");
    expect(new Px(6, 6).rect(2, 3, 2, 1, "#fff").trimmed().w).toBe(2);
    const s = sheet([new Px(2, 2).fill("#fff"), new Px(3, 1).fill("#fff")], { cols: 2, gap: 1, pad: 0 });
    expect([s.w, s.h]).toEqual([6, 2]);
    expect(p.recolor({ "#f00": "#0f0" }).get(0, 0)).toBe(rgba("#0f0"));
    expect(p.scaled(3).w).toBe(6);
  });

  it("确定性随机：同一种子同一序列", () => {
    expect(hash32("澄港")).toBe(hash32("澄港"));
    const a = rng(7);
    const b = rng(7);
    expect([a.next(), a.int(1, 6), a.pick(["x", "y"])]).toEqual([b.next(), b.int(1, 6), b.pick(["x", "y"])]);
    expect(rng("x").next()).not.toBe(rng("y").next());
  });
});
