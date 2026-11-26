// 交易品的小图：新界面里有手绘图的货用图片，经典像素界面与没有手绘图的货用 16×16 的像素图样。
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GOOD_ART_KEYS } from "../art/goodArt";
import { GoodGlyph } from "../components/panels/GoodGlyph";
import { goodArtSize, hasGoodArt } from "../components/panels/goodGlyphKit";
import { ITEM_ICON_KEYS } from "../components/items/itemIcons";
import { applyUi, useUiVersion } from "../ui/uiMode";

function setUi(ui: "v1" | "v2") {
  act(() => {
    applyUi(ui);
    useUiVersion.setState({ ui });
  });
}

afterEach(() => {
  cleanup();
  setUi("v1");
});

describe("交易品的小图", () => {
  it("两份清单：数量够、没有重复、没有混进占位（文件在不在、尺寸对不对由资源审计核对）", () => {
    expect(GOOD_ART_KEYS.length).toBeGreaterThanOrEqual(159);
    expect(new Set(GOOD_ART_KEYS).size).toBe(GOOD_ART_KEYS.length);
    expect(ITEM_ICON_KEYS.length).toBeGreaterThanOrEqual(481);
    expect(new Set(ITEM_ICON_KEYS).size).toBe(ITEM_ICON_KEYS.length);
    // 旧表里凑格子的占位不该混进来
    expect(ITEM_ICON_KEYS.some((k) => k.startsWith("_"))).toBe(false);
    // 名著有自己的图，船图、养成奖品不再用种类的通用图标
    for (const k of ["homer_iliad_aldine", "c11_plan_treasure_ship", "cacao_beans", "silver_branch"]) expect(ITEM_ICON_KEYS, k).toContain(k);
  });

  it("经典像素界面：仍是 16×16 的像素图样（canvas），不出现图片", () => {
    setUi("v1");
    const { container } = render(<GoodGlyph goodKey="pepper_unknown_key" category="奢侈品" scale={2} className="x" />);
    expect(container.querySelector("img")).toBeNull();
    const canvas = container.querySelector("canvas");
    expect(canvas).not.toBeNull();
    expect(canvas!.width).toBe(16);
    expect(canvas!.style.width).toBe("32px");
    cleanup();
    const again = render(<GoodGlyph goodKey="grain" category="粮食" />);
    expect(again.container.querySelector("img")).toBeNull();
    expect(again.container.querySelector("canvas")).not.toBeNull();
  });

  it("新界面：有手绘图的货用图片，边长随倍数；没有手绘图的货退回像素图样", () => {
    setUi("v2");
    expect(hasGoodArt("grain")).toBe(true);
    expect(hasGoodArt("no_such_good")).toBe(false);
    expect(hasGoodArt(undefined)).toBe(false);
    expect([goodArtSize(1), goodArtSize(2), goodArtSize(3)]).toEqual([26, 42, 58]);
    const { container } = render(<GoodGlyph goodKey="grain" category="粮食" scale={2} className="pn-good-icon" />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toContain("goods/grain.webp");
    expect(img!.className).toBe("good-art pn-good-icon");
    expect(img!.getAttribute("width")).toBe("42");
    expect(img!.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector("canvas")).toBeNull();
    cleanup();
    const missing = render(<GoodGlyph goodKey="no_such_good" category="奢侈品" />);
    expect(missing.container.querySelector("img")).toBeNull();
    expect(missing.container.querySelector("canvas")).not.toBeNull();
    cleanup();
    const none = render(<GoodGlyph goodKey={undefined} />);
    expect(none.container.querySelector("canvas")).not.toBeNull();
  });
});
