// 会动的场景图：有权重图的大图在新界面里换成画布逐帧画；经典像素界面、没有权重图、减少动态效果、画布建不起来时就是一张 <img>。
// WebGL 在 jsdom 里没有：把 sceneWarp 换成替身，只验证“什么时候上画布、什么时候退回 <img>”。
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SceneImg } from "../components/scene/SceneImg";
import { hasSceneRig, sceneFileOf, sceneRigSrc } from "../components/scene/sceneKit";
import { applyUi, useUiVersion } from "../ui/uiMode";

const warp = vi.hoisted(() => ({
  supported: true,
  refuse: false,
  made: [] as { draw: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }[],
}));

vi.mock("../art/sceneLive", () => ({ SCENE_RIGS: ["dock_jp", "port_venice--dawn-rain"] }));
vi.mock("../components/portrait/liveWarp", () => ({ warpSupported: () => warp.supported }));
vi.mock("../components/scene/sceneWarp", () => ({
  MAX_SCENE_WARPS: 4,
  createSceneWarp: () => {
    if (warp.refuse) return null;
    const w = { draw: vi.fn(), dispose: vi.fn() };
    warp.made.push(w);
    return w;
  },
}));

function setUi(ui: "v1" | "v2") {
  act(() => {
    applyUi(ui);
    useUiVersion.setState({ ui });
  });
}

/** 权重图是用 new Image() 取的：换成能手动“载入”的替身。 */
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
    this.naturalWidth = 384;
    this.dispatchEvent(new Event("load"));
  }
  fail() {
    this.dispatchEvent(new Event("error"));
  }
}

/** jsdom 不会真的去取图：把 <img> 标成“已经载入”，再发 load 事件。 */
function finish(img: HTMLImageElement) {
  Object.defineProperty(img, "complete", { value: true, configurable: true });
  Object.defineProperty(img, "naturalWidth", { value: 1152, configurable: true });
  Object.defineProperty(img, "naturalHeight", { value: 504, configurable: true });
  fireEvent.load(img);
}

const realImage = globalThis.Image;

beforeEach(() => {
  setUi("v2");
  warp.supported = true;
  warp.refuse = false;
  warp.made.length = 0;
  FakeImage.made.length = 0;
  globalThis.Image = FakeImage as unknown as typeof Image;
});

afterEach(() => {
  cleanup();
  globalThis.Image = realImage;
  setUi("v1");
});

describe("会动的场景图", () => {
  it("小工具：清单里有的才算有权重图；只有大图的路径能取出文件名", () => {
    expect(hasSceneRig("dock_jp")).toBe(true);
    expect(hasSceneRig("cave")).toBe(false);
    expect(hasSceneRig(null)).toBe(false);
    expect(sceneFileOf("scenes/dock_jp--winter.webp")).toBe("dock_jp--winter");
    expect(sceneFileOf("/manifest/scenes/port_venice--dawn-rain.webp")).toBe("port_venice--dawn-rain");
    expect(sceneFileOf("scenes/dock_jp-s.webp")).toBeNull();
    expect(sceneFileOf("scenes/creature_kraken-m.webp")).toBeNull();
    expect(sceneFileOf("scenes/dock_jp-rig.webp")).toBeNull();
    expect(sceneFileOf("portraits/story/noel.webp")).toBeNull();
    expect(sceneFileOf(null)).toBeNull();
    expect(sceneRigSrc("dock_jp")).toContain("scenes/dock_jp-rig.webp");
  });

  it("经典像素界面：就是一张 <img>，不出画布、不去取权重图", () => {
    setUi("v1");
    const { container } = render(<SceneImg src="scenes/dock_jp.webp" file="dock_jp" className="sd-art" testId="art" />);
    const img = container.querySelector("img")!;
    expect(img.className).toBe("sd-art");
    expect(img.getAttribute("data-live")).toBeNull();
    expect(container.querySelector("canvas")).toBeNull();
    expect(FakeImage.made).toHaveLength(0);
  });

  it("新界面、有权重图：底图与权重图都载入后画布接管，<img> 藏起来；卸载时释放", () => {
    const { container, unmount } = render(<SceneImg src="scenes/dock_jp.webp" file="dock_jp" className="ub-scene-img" testId="art" variant="dock_jp" />);
    const img = container.querySelector("img")!;
    const canvas = container.querySelector("canvas")!;
    expect(canvas.className).toBe("ub-scene-img scene-live");
    expect(img.getAttribute("data-live")).toBe("wait");
    expect(img.getAttribute("data-testid")).toBe("art");
    expect(img.getAttribute("data-variant")).toBe("dock_jp");
    expect(canvas.style.display).toBe("none");
    expect(FakeImage.made).toHaveLength(1);
    expect(FakeImage.made[0].src).toContain("scenes/dock_jp-rig.webp");
    // 只有底图载入：还不能开始
    act(() => finish(img));
    expect(warp.made).toHaveLength(0);
    act(() => FakeImage.made[0].load());
    expect(warp.made).toHaveLength(1);
    // 先画好与底图一模一样的一帧（位移 0），再露出来
    expect(warp.made[0].draw).toHaveBeenCalledWith(0, 0);
    expect(img.getAttribute("data-live")).toBe("on");
    expect(img.style.display).toBe("none");
    expect(canvas.style.display).toBe("");
    expect([canvas.width, canvas.height]).toEqual([1152, 504]);
    unmount();
    expect(warp.made[0].dispose).toHaveBeenCalledTimes(1);
  });

  it("没有权重图的图、不给文件名的图：新界面里也只是一张 <img>", () => {
    const a = render(<SceneImg src="scenes/cave.webp" file="cave" className="sd-art" />);
    expect(a.container.querySelector("canvas")).toBeNull();
    expect(a.container.querySelector("img")!.getAttribute("data-live")).toBeNull();
    cleanup();
    const b = render(<SceneImg src="scenes/dock_jp-s.webp" file={null} className="ub-scene-img" />);
    expect(b.container.querySelector("canvas")).toBeNull();
    expect(FakeImage.made).toHaveLength(0);
  });

  it("画布建不起来（没有 WebGL、名额用完）或权重图取不到：退回 <img>，不再重试这一张", () => {
    warp.refuse = true;
    const { container } = render(<SceneImg src="scenes/dock_jp.webp" file="dock_jp" className="sd-art" />);
    const img = container.querySelector("img")!;
    act(() => finish(img));
    act(() => FakeImage.made[0].load());
    expect(container.querySelector("canvas")).toBeNull();
    expect(img.getAttribute("data-live")).toBeNull();
    expect(img.style.display).toBe("");
    cleanup();
    warp.refuse = false;
    FakeImage.made.length = 0;
    const again = render(<SceneImg src="scenes/port_venice--dawn-rain.webp" file="port_venice--dawn-rain" className="port-lore-art" />);
    act(() => FakeImage.made[0].fail());
    expect(again.container.querySelector("canvas")).toBeNull();
    expect(warp.made).toHaveLength(0);
    cleanup();
    warp.supported = false;
    const none = render(<SceneImg src="scenes/dock_jp.webp" file="dock_jp" className="sd-art" />);
    expect(none.container.querySelector("canvas")).toBeNull();
  });

  it("系统设置了“减少动态效果”：不动", () => {
    const real = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
    try {
      const { container } = render(<SceneImg src="scenes/dock_jp.webp" file="dock_jp" className="sd-art" />);
      expect(container.querySelector("canvas")).toBeNull();
      expect(FakeImage.made).toHaveLength(0);
    } finally {
      window.matchMedia = real;
    }
  });
});
