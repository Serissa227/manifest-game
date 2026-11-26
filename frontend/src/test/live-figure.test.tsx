// 会动的头像（P12 美术）：寰宇主角的专属头像在新界面的大头像位上会动；经典像素界面、小头像位、没有这套素材的人物照旧是一张图。
// 网格形变（WebGL）在 jsdom 里没有：这里把 liveWarp 换成替身，只验证“什么时候上画布、什么时候退回 <img>”的状态机。
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORY_LIVE, STORY_PORTRAIT_SIZE, STORY_PORTRAITS, type LiveArt } from "../art/portraitAssets";
import { Px } from "../art/px";
import { LiveFigure } from "../components/portrait/LivePortrait";
import { PortraitArt } from "../components/portrait/PortraitArt";
import { applyUi, useUiVersion } from "../ui/uiMode";

const warp = vi.hoisted(() => ({
  supported: false,
  made: [] as { draw: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }[],
  refuse: false,
  calls: [] as unknown[][],
}));

vi.mock("../components/portrait/liveWarp", () => ({
  MAX_WARPS: 6,
  warpSupported: () => warp.supported,
  activeWarps: () => warp.made.length,
  createWarp: (...args: unknown[]) => {
    warp.calls.push(args);
    if (warp.refuse) return null;
    const w = { draw: vi.fn(), dispose: vi.fn() };
    warp.made.push(w);
    return w;
  },
}));

function setUi(ui: "v1" | "v2") {
  applyUi(ui);
  useUiVersion.setState({ ui });
}

const fb = () => new Px(64, 64);
const LIVE_IDS = Object.keys(STORY_LIVE);
const HERO = "t16-mio-16";

/** jsdom 不会真的去取图：把一张 <img> 标成“已经载入”，再发 load 事件。 */
function finish(img: HTMLImageElement) {
  Object.defineProperty(img, "complete", { value: true, configurable: true });
  Object.defineProperty(img, "naturalWidth", { value: 384, configurable: true });
  fireEvent.load(img);
}

/** 形变权重图是用 new Image() 取的：换成能手动“载入”的替身。 */
class FakeImage extends EventTarget {
  static made: FakeImage[] = [];
  crossOrigin: string | null = null;
  decoding = "";
  complete = false;
  naturalWidth = 0;
  src = "";
  constructor() {
    super();
    FakeImage.made.push(this);
  }
  load() {
    this.complete = true;
    this.naturalWidth = 128;
    this.dispatchEvent(new Event("load"));
  }
  fail() {
    this.dispatchEvent(new Event("error"));
  }
}

const realImage = globalThis.Image;

beforeEach(() => {
  setUi("v2");
  warp.supported = false;
  warp.refuse = false;
  warp.made.length = 0;
  warp.calls.length = 0;
  FakeImage.made.length = 0;
});

afterEach(() => {
  cleanup();
  globalThis.Image = realImage;
  vi.useRealTimers();
  setUi("v1");
});

describe("会动的专属头像：素材清单", () => {
  it("寰宇九位主角出海后的那一张都有会动的素材（八张 t16-…-16 与诺埃尔的 story-noel），底图就是专属头像本身", () => {
    const grown = ["mio", "lieve", "najma", "lin_wandeng", "ix_nikte", "tariq", "kaicili", "baraka"].map((k) => `t16-${k}-16`).concat("story-noel");
    for (const id of grown) expect(LIVE_IDS, id).toContain(id);
    for (const id of LIVE_IDS) {
      const art = STORY_LIVE[id]!;
      const story = STORY_PORTRAITS.find((s) => s.id === id);
      expect(story, id).toBeDefined();
      expect(`portraits/${art.file}`).toBe(story!.file);
      // 2026-11-12 A02：专属头像由 384 改为 768（按原图重新导出），与清单的 STORY_PORTRAIT_SIZE 一致
      expect([art.width, art.height]).toEqual([768, 768]);
      expect(art.width).toBe(STORY_PORTRAIT_SIZE);
    }
  });

  it("每套素材的眨眼补丁落在画面里、落在脸的圆附近；支点在画面里，颈根在脸的下方", () => {
    const all: [string, LiveArt][] = Object.entries(STORY_LIVE);
    for (const [id, art] of all) {
      const b = art.blink;
      expect(b.x, id).toBeGreaterThanOrEqual(0);
      expect(b.y, id).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w, id).toBeLessThanOrEqual(art.width);
      expect(b.y + b.h, id).toBeLessThanOrEqual(art.height);
      // 两只眼睛：补丁不会小得像噪点，也不会大到半张图
      expect(b.w, id).toBeGreaterThan(art.width * 0.08);
      expect(b.w, id).toBeLessThan(art.width * 0.5);
      expect(b.h, id).toBeLessThan(art.height * 0.3);
      const rig = art.rig;
      expect(rig, id).toBeDefined();
      const [fx, fy, fr] = rig!.face;
      const [nx, ny] = rig!.neck;
      expect(fr, id).toBeGreaterThan(8);
      expect(Math.abs(b.x + b.w / 2 - fx), id).toBeLessThanOrEqual(fr);
      expect(Math.abs(b.y + b.h / 2 - fy), id).toBeLessThanOrEqual(fr);
      expect(nx, id).toBeGreaterThanOrEqual(0);
      expect(nx, id).toBeLessThan(art.width);
      expect(ny, id).toBeGreaterThan(fy);
      expect(ny, id).toBeLessThan(art.height);
      expect(rig!.file, id).toMatch(/-rig\.webp$/);
    }
  });
});

describe("PortraitArt 的 live：哪些头像位会动", () => {
  it("新界面的大头像位：外面一层接原来的类名、尺寸与 data-portrait，里面是会动的那一层（底图 + 眨眼补丁）", () => {
    render(<PortraitArt asset={HERO} fallback={fb} size={248} variant="full" label="一条澪" className="ub-hero-portrait" live />);
    const frame = document.querySelector(".portrait-live") as HTMLElement;
    expect(frame).toHaveClass("portrait-art", "ub-hero-portrait");
    expect(frame).toHaveAttribute("data-portrait", HERO);
    expect(frame.style.width).toBe("248px");
    expect(frame.style.height).toBe("248px");
    const fig = screen.getByRole("img", { name: "一条澪" });
    expect(fig).toHaveClass("live-portrait");
    expect(frame).toContainElement(fig);
    // 里面那层铺满外框（宽 100%、高按比例，不写死像素）：外框的响应式尺寸（各处写在类上的 !important）才管得住它
    expect(fig.style.width).toBe("100%");
    expect(fig.style.height).toBe("");
    const art = STORY_LIVE[HERO]!;
    expect(fig.querySelector(".lp-base")).toHaveAttribute("src", `/portraits/${art.file}`);
    expect(fig.querySelector(".lp-blink")).toHaveAttribute("src", `/portraits/${art.blink.file}`);
    // jsdom 没有 WebGL：不上画布，图片也不按跨域取
    expect(fig.querySelector("canvas")).toBeNull();
    expect(fig.querySelector(".lp-base")).not.toHaveAttribute("crossorigin");
    expect(fig).not.toHaveAttribute("data-warp");
  });

  it("经典像素界面照旧是一张 <img>（DOM 不变）", () => {
    setUi("v1");
    render(<PortraitArt asset={HERO} fallback={fb} size={248} variant="full" label="一条澪" className="ub-hero-portrait" live />);
    const img = screen.getByRole("img", { name: "一条澪" });
    expect(img.tagName).toBe("IMG");
    expect(img).toHaveClass("portrait-art", "ub-hero-portrait");
    expect(document.querySelector(".live-portrait")).toBeNull();
  });

  it("小头像位（脸部特写）、没要 live 的头像位、没有这套素材的人物：都是一张 <img>", () => {
    render(<PortraitArt asset={HERO} fallback={fb} size={64} label="小" live />);
    render(<PortraitArt asset={HERO} fallback={fb} size={248} variant="full" label="静" />);
    render(<PortraitArt asset="captain-00" fallback={fb} size={248} variant="full" label="普通" live />);
    for (const name of ["小", "静", "普通"]) expect(screen.getByRole("img", { name }).tagName).toBe("IMG");
    expect(document.querySelector(".live-portrait")).toBeNull();
    expect(screen.getByRole("img", { name: "小" })).toHaveAttribute("src", expect.stringContaining("-face.webp"));
  });

  it("底图取不到时回退到程序头像", () => {
    render(<PortraitArt asset={HERO} fallback={fb} size={248} variant="full" label="缺图" live />);
    fireEvent.error(document.querySelector(".lp-base") as HTMLImageElement);
    expect(document.querySelector(".live-portrait")).toHaveClass("is-fallback");
    expect(document.querySelector(".lp-base")).toBeNull();
  });
});

describe("LiveFigure：网格形变的画布什么时候接管", () => {
  const art = () => STORY_LIVE[HERO]!;

  function mount() {
    globalThis.Image = FakeImage as unknown as typeof Image;
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
    render(<LiveFigure art={art()} width={248} label="会动" fallback={fb} testId="lf" />);
    const fig = screen.getByTestId("lf");
    return { fig, raf, base: fig.querySelector(".lp-base") as HTMLImageElement, blink: fig.querySelector(".lp-blink") as HTMLImageElement };
  }

  it("浏览器能做形变：图片按跨域许可取；底图、补丁、权重图都到了才建画布，建好后整体伸缩的呼吸与 DOM 的补丁让位", () => {
    warp.supported = true;
    const { fig, base, blink, raf } = mount();
    expect(fig.querySelector("canvas.lp-canvas")).not.toBeNull();
    expect(base).toHaveAttribute("crossorigin", "anonymous");
    expect(blink).toHaveAttribute("crossorigin", "anonymous");
    const rig = FakeImage.made[0]!;
    expect(rig.crossOrigin).toBe("anonymous");
    expect(rig.src).toBe(`/portraits/${art().rig!.file}`);
    // 还缺图：不建
    finish(base);
    finish(blink);
    expect(warp.calls).toHaveLength(0);
    expect(fig).not.toHaveAttribute("data-warp");
    act(() => rig.load());
    expect(warp.calls).toHaveLength(1);
    expect(warp.calls[0]![2]).toBe(art());
    expect(fig).toHaveAttribute("data-warp", "on");
    expect(fig).toHaveClass("is-warp");
    // 露出来之前先画了一帧（运动量为 0 的静止帧）
    expect(warp.made[0]!.draw).toHaveBeenCalledTimes(1);
    expect(raf).toHaveBeenCalled();
    // 卸载时释放
    cleanup();
    expect(warp.made[0]!.dispose).toHaveBeenCalledTimes(1);
  });

  it("画布建不起来（名额用完、着色器不过、跨域被拒）：退回 <img>，不再按跨域取图，照样眨眼", () => {
    warp.supported = true;
    warp.refuse = true;
    const { fig, base, blink } = mount();
    finish(base);
    finish(blink);
    act(() => FakeImage.made[0]!.load());
    expect(warp.calls).toHaveLength(1);
    expect(fig.querySelector("canvas")).toBeNull();
    expect(fig).not.toHaveAttribute("data-warp");
    expect(fig.querySelector(".lp-base")).not.toHaveAttribute("crossorigin");
    expect(fig.querySelector(".lp-blink")).not.toBeNull();
    expect(fig).not.toHaveClass("is-fallback");
  });

  it("按跨域取底图失败：先放弃形变、改回普通取法；再失败才回退到程序头像", () => {
    warp.supported = true;
    const { fig, base } = mount();
    fireEvent.error(base);
    expect(fig).not.toHaveClass("is-fallback");
    expect(fig.querySelector("canvas")).toBeNull();
    expect(fig.querySelector(".lp-base")).not.toHaveAttribute("crossorigin");
    fireEvent.error(fig.querySelector(".lp-base") as HTMLImageElement);
    expect(screen.getByTestId("lf")).toHaveClass("is-fallback");
  });

  it("权重图取不到、或显卡上下文丢了：退回 <img>", () => {
    warp.supported = true;
    const a = mount();
    act(() => FakeImage.made[0]!.fail());
    expect(a.fig.querySelector("canvas")).toBeNull();
    cleanup();
    FakeImage.made.length = 0;
    const b = mount();
    finish(b.base);
    finish(b.blink);
    act(() => FakeImage.made[0]!.load());
    expect(b.fig).toHaveAttribute("data-warp", "on");
    fireEvent(b.fig.querySelector("canvas") as HTMLCanvasElement, new Event("webglcontextlost"));
    expect(b.fig.querySelector("canvas")).toBeNull();
    expect(b.fig).not.toHaveAttribute("data-warp");
    expect(warp.made.at(-1)!.dispose).toHaveBeenCalled();
  });

  it("经典像素界面、系统要求减少动态效果时：不上画布", () => {
    warp.supported = true;
    setUi("v1");
    const a = mount();
    expect(a.fig.querySelector("canvas")).toBeNull();
    cleanup();
    setUi("v2");
    const realMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as typeof window.matchMedia;
    const b = mount();
    expect(b.fig).toHaveClass("is-still");
    expect(b.fig.querySelector("canvas")).toBeNull();
    window.matchMedia = realMatchMedia;
  });

  it("没有骨架的素材（Q 版小人那种只有补丁的）：不上画布", () => {
    warp.supported = true;
    const plain: LiveArt = { ...art(), rig: undefined };
    globalThis.Image = FakeImage as unknown as typeof Image;
    render(<LiveFigure art={plain} width={128} fallback={fb} testId="plain" />);
    expect(screen.getByTestId("plain").querySelector("canvas")).toBeNull();
    expect(FakeImage.made).toHaveLength(0);
  });
});
