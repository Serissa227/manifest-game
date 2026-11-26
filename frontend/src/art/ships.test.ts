import { describe, expect, it } from "vitest";
import { P, ink } from "./palette";
import { rgba, type Px } from "./px";
import {
  BOAT_SIZE,
  CLASSIC_SHIP_KEYS,
  SHIP_FRAMES,
  SHIP_FRAME_SIZE,
  SHIP_TYPES,
  TERRA16_SHIP_KEYS,
  drawBoat,
  drawShip,
  drawShipByKey,
  drawShipFrame,
  shipArtKey,
  shipKeyOverride,
  waterlineByKey,
  waterlineOf,
  type ShipArtOpts,
} from "./ships";
import { T16_GLYPHS, T16_SPECS } from "./ships16";

const TYPES = Array.from({ length: SHIP_TYPES }, (_, i) => i);
/** ships.toml 中各船型的帆型（0–7 为原有船型，8–18 为航海历 1502 年追加的船型）。 */
const SAILS = [
  "lateen", "square", "square", "lateen", "square", "square", "lateen", "square",
  "square", "lateen", "lateen", "square", "lateen", "square", "square", "lateen", "lateen", "square", "square",
] as const;

function same(a: Px, b: Px): boolean {
  return a.w === b.w && a.h === b.h && a.data.every((v, i) => v === b.data[i]);
}

/** 一组图（连同几个整数）的像素指纹：FNV-1a 按字节累加宽、高与每个像素。 */
function digest(pics: readonly Px[], extra: readonly number[]): string {
  let h = 0x811c9dc5;
  const step = (v: number) => {
    for (let k = 0; k < 4; k++) {
      h ^= (v >>> (k * 8)) & 0xff;
      h = Math.imul(h, 0x01000193);
    }
  };
  for (const v of extra) step(v);
  for (const p of pics) {
    step(p.w);
    step(p.h);
    for (const v of p.data) step(v);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * 经典世界 19 种船的像素指纹 [large, small]：四帧带旗、海盗、受损带旗、受损的海盗、不带旗，连同水线。
 * 第九批“寰宇·十六世纪”按 key 加画新船型时取的基线——经典的船必须逐像素不变；有意改经典船的画法时才更新这张表。
 */
const CLASSIC_DIGESTS: readonly (readonly [string, string])[] = [
  ["b18c14e4", "84218f94"],
  ["dd6084d8", "5b2371c3"],
  ["a1b66418", "b23c5bc8"],
  ["d9438546", "9b28dc7a"],
  ["5dcbc699", "dc6aeddb"],
  ["ae9730b0", "9842c66b"],
  ["54749457", "0bc48244"],
  ["ed347d73", "35259065"],
  ["4cab81c2", "9dce1c80"],
  ["0343caa5", "1f292efb"],
  ["2b170f8a", "4298eb57"],
  ["26b241d5", "d080f892"],
  ["bc2392ab", "7bbf1193"],
  ["f30a3b6c", "61a9c7cf"],
  ["7bb5ac54", "db311dea"],
  ["93ce3cab", "8d6a1bc3"],
  ["4e3da917", "eac24388"],
  ["d11dc69c", "070ee3f7"],
  ["65401fa5", "5cc10da5"],
];

function classicDigest(i: number, size: "large" | "small"): string {
  const sail = SAILS[i];
  const pics: Px[] = [];
  for (let f = 0; f < SHIP_FRAMES; f++) pics.push(drawShip(i, sail, { size, flag: "#c8373a", frame: f }));
  pics.push(drawShip(i, sail, { size, pirate: true, frame: 1 }));
  pics.push(drawShip(i, sail, { size, damaged: true, frame: 2, flag: "#2f8a62" }));
  pics.push(drawShip(i, sail, { size, damaged: true, pirate: true, frame: 3 }));
  pics.push(drawShip(i, sail, { size }));
  return digest(pics, [waterlineOf(i, size, sail)]);
}

function ship(i: number, opts: Partial<ShipArtOpts> = {}): Px {
  return drawShip(i, SAILS[i] ?? "square", { size: "large", ...opts });
}

/** 调色板里的全部颜色（不含势力旗色）。 */
function paletteColors(): Set<number> {
  const out = new Set<number>();
  const walk = (v: unknown) => {
    if (typeof v === "string") out.add(rgba(v));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(P);
  walk(ink);
  return out;
}

describe("船", () => {
  it("船型数与 ships.toml 一致：原有 8 种 + 追加 11 种", () => {
    expect(SHIP_TYPES).toBe(19);
    expect(SAILS.length).toBe(SHIP_TYPES);
  });

  it("经典世界的 19 种船逐像素不变（像素指纹，large 与 small）", () => {
    expect(CLASSIC_DIGESTS.length).toBe(SHIP_TYPES);
    for (const i of TYPES) {
      expect(classicDigest(i, "large"), `large ${i}`).toBe(CLASSIC_DIGESTS[i][0]);
      expect(classicDigest(i, "small"), `small ${i}`).toBe(CLASSIC_DIGESTS[i][1]);
    }
  });

  it("同样的参数永远画出同样的图，并且返回的是可以放心修改的副本", () => {
    for (const i of TYPES) {
      for (const size of ["large", "small"] as const) {
        const opts: ShipArtOpts = { size, flag: "#c8373a", frame: 2, damaged: true };
        const a = drawShip(i, SAILS[i], opts);
        const b = drawShip(i, SAILS[i], { ...opts });
        expect(same(a, b)).toBe(true);
        a.fill("#000");
        expect(same(drawShip(i, SAILS[i], opts), b)).toBe(true);
      }
    }
    expect(same(drawBoat(1), drawBoat(1))).toBe(true);
    expect(same(drawShipFrame(0.5), drawShipFrame(0.5))).toBe(true);
  });

  it("大图宽 64–128，小图宽 14–22", () => {
    for (const i of TYPES) {
      const l = ship(i);
      expect(l.w).toBeGreaterThanOrEqual(64);
      expect(l.w).toBeLessThanOrEqual(128);
      const s = drawShip(i, SAILS[i], { size: "small" });
      expect(s.w).toBeGreaterThanOrEqual(14);
      expect(s.w).toBeLessThanOrEqual(22);
      expect(s.h).toBeLessThanOrEqual(24);
    }
  });

  it("大图宽度随船型等级大致递增", () => {
    const widths = TYPES.map((i) => ship(i).w);
    // 按船价（ships.toml）排序：卡拉维尔、柯克、单桅快船、三角帆商船、探险快船、卡拉克、双桅纵帆、双桅横帆、福禄特、移民船、
    // 武装商船、大盖伦、谢贝克、飞剪船、瑶华宝船、巡防舰、加莱赛、远洋大帆船、战列舰——19 种严格递增
    const byPrice = [0, 8, 9, 10, 12, 1, 3, 11, 2, 13, 5, 4, 6, 17, 16, 14, 15, 7, 18].map((i) => widths[i]);
    expect(byPrice.length).toBe(SHIP_TYPES);
    for (let k = 1; k < byPrice.length; k++) expect(byPrice[k]).toBeGreaterThan(byPrice[k - 1]);
    // 全部船型：最小的是卡拉维尔（海燕级），最大的是战列舰
    expect(Math.min(...widths)).toBe(widths[0]);
    expect(Math.max(...widths)).toBe(widths[18]);
    // 原有 8 种按序号：最小的是海燕级、最大的是远航级，逆序对不超过 2 个
    const old = widths.slice(0, 8);
    expect(Math.min(...old)).toBe(widths[0]);
    expect(Math.max(...old)).toBe(widths[7]);
    let inversions = 0;
    for (let a = 0; a < old.length; a++) for (let b = a + 1; b < old.length; b++) if (old[a] > old[b]) inversions++;
    expect(inversions).toBeLessThanOrEqual(2);
    // 追加的 11 种：最小的是柯克船、最大的是战列舰
    const added = widths.slice(8);
    expect(Math.min(...added)).toBe(widths[8]);
    expect(Math.max(...added)).toBe(widths[18]);
    // 小图同样：全部最小卡拉维尔、最大战列舰，原有 8 种最大远航级；按船价不减
    const small = TYPES.map((i) => drawShip(i, SAILS[i], { size: "small" }).w);
    expect(Math.min(...small)).toBe(small[0]);
    expect(Math.max(...small)).toBe(small[18]);
    expect(Math.max(...small.slice(0, 8))).toBe(small[7]);
    const smallByPrice = [0, 8, 9, 10, 12, 1, 3, 11, 2, 13, 5, 4, 6, 17, 16, 14, 15, 7, 18].map((i) => small[i]);
    for (let k = 1; k < smallByPrice.length; k++) expect(smallByPrice[k]).toBeGreaterThanOrEqual(smallByPrice[k - 1]);
  });

  it("旗色、海盗、帧、受损都不改变尺寸；海盗版、受损版、各帧与普通版不同", () => {
    for (const i of TYPES) {
      for (const size of ["large", "small"] as const) {
        const base = drawShip(i, SAILS[i], { size, flag: "#2f8a62" });
        const variants = [
          drawShip(i, SAILS[i], { size, pirate: true }),
          drawShip(i, SAILS[i], { size, flag: "#2f8a62", damaged: true }),
          drawShip(i, SAILS[i], { size, flag: "#2f8a62", frame: 2 }),
          drawShip(i, SAILS[i], { size }),
        ];
        for (const v of variants) {
          expect([v.w, v.h]).toEqual([base.w, base.h]);
          expect(same(v, base)).toBe(false);
        }
      }
    }
  });

  it("旗色画在旗上；非法颜色按无旗处理", () => {
    const withFlag = ship(4, { flag: "#123456" });
    expect(withFlag.data.includes(rgba("#123456"))).toBe(true);
    const small = drawShip(4, "square", { size: "small", flag: "#123456" });
    expect(small.data.includes(rgba("#123456"))).toBe(true);
    expect(same(ship(4, { flag: "不是颜色" }), ship(4))).toBe(true);
  });

  it("不带旗时只用调色板里的颜色", () => {
    const pal = paletteColors();
    for (const i of TYPES) {
      for (const opts of [{}, { pirate: true }, { damaged: true, frame: 1 }] as Partial<ShipArtOpts>[]) {
        for (const size of ["large", "small"] as const) {
          const px = drawShip(i, SAILS[i], { size, ...opts });
          const stray = [...new Set(px.data)].filter((v) => v !== 0 && !pal.has(v));
          expect(stray).toEqual([]);
        }
      }
    }
  });

  it("越界的 typeIndex 按帆型回退到通用船", () => {
    const opts: ShipArtOpts = { size: "large", flag: "#c8373a" };
    const square = drawShip(1, "square", opts);
    const lateen = drawShip(3, "lateen", opts);
    for (const bad of [-1, SHIP_TYPES, 99, 2.5, Number.NaN]) {
      expect(same(drawShip(bad, "square", opts), square)).toBe(true);
      expect(same(drawShip(bad, "lateen", opts), lateen)).toBe(true);
    }
    // 合法的 typeIndex 不受 sail 参数影响（含追加的船型）
    expect(same(drawShip(2, "lateen", opts), drawShip(2, "square", opts))).toBe(true);
    expect(same(drawShip(16, "square", opts), drawShip(16, "lateen", opts))).toBe(true);
    expect(same(drawShip(18, "lateen", opts), drawShip(18, "square", opts))).toBe(true);
    expect(waterlineOf(99, "large")).toBe(waterlineOf(1, "large"));
    expect(waterlineOf(-3, "small", "lateen")).toBe(waterlineOf(3, "small"));
  });

  it("瑶华宝船用赭色的东方硬帆，其余船（非海盗）都是奶白帆布", () => {
    const hasColor = (px: Px, c: string) => px.data.includes(rgba(c));
    for (const i of TYPES) {
      for (const size of ["large", "small"] as const) {
        const px = drawShip(i, SAILS[i], { size });
        if (i === 16) {
          expect(hasColor(px, P.sand[2]), `${i} ${size}`).toBe(true);
          expect(hasColor(px, P.paper), `${i} ${size}`).toBe(false);
        } else expect(hasColor(px, P.paper), `${i} ${size}`).toBe(true);
      }
    }
  });

  it("加莱赛战船的桨随帧划动：水线上方的船舷各帧不同，别的船船舷不动", () => {
    const band = (i: number, frame: number) => {
      const px = drawShip(i, SAILS[i], { size: "large", frame });
      const wl = waterlineOf(i, "large", SAILS[i]);
      return Array.from(px.data.slice((wl - 4) * px.w, (wl + 1) * px.w));
    };
    expect(band(15, 0)).not.toEqual(band(15, 2));
    for (const i of [7, 14, 16, 18]) expect(band(i, 0)).toEqual(band(i, 2));
  });

  it("帧号取模，负数与越界帧也能画", () => {
    expect(same(ship(5, { frame: SHIP_FRAMES + 1 }), ship(5, { frame: 1 }))).toBe(true);
    expect(same(ship(5, { frame: -1 }), ship(5, { frame: SHIP_FRAMES - 1 }))).toBe(true);
  });

  it("水线在图内：水线处是船体，水线以下还有几行船底", () => {
    for (const i of TYPES) {
      for (const size of ["large", "small"] as const) {
        const px = drawShip(i, SAILS[i], { size, flag: "#c8373a" });
        const wl = waterlineOf(i, size, SAILS[i]);
        expect(wl).toBeGreaterThan(px.h / 2);
        expect(wl).toBeLessThan(px.h);
        // 水线这一行与上一行都有连成片的船体
        const run = (y: number) => {
          let best = 0;
          let cur = 0;
          for (let x = 0; x < px.w; x++) {
            cur = px.isOpaque(x, y) ? cur + 1 : 0;
            best = Math.max(best, cur);
          }
          return best;
        };
        expect(run(wl)).toBeGreaterThan(px.w * 0.4);
        expect(run(wl - 1)).toBeGreaterThan(px.w * 0.4);
        // 水线以下的船底比水线处短（船底收窄），且不超过图底
        const below = [...Array(px.h - wl - 1).keys()].map((k) => run(wl + 1 + k));
        expect(below.length).toBeGreaterThan(0);
        expect(Math.max(...below)).toBeLessThanOrEqual(run(wl));
      }
    }
  });

  it("小划艇：尺寸固定、每帧轻轻摇晃，水线在图内", () => {
    const frames = Array.from({ length: SHIP_FRAMES }, (_, f) => drawBoat(f));
    for (const b of frames) expect([b.w, b.h]).toEqual([BOAT_SIZE.w, BOAT_SIZE.h]);
    expect(same(frames[0], frames[1])).toBe(false);
    expect(same(drawBoat(SHIP_FRAMES), frames[0])).toBe(true);
    const row = BOAT_SIZE.waterline;
    expect(row).toBeLessThan(BOAT_SIZE.h);
    expect([...Array(BOAT_SIZE.w).keys()].filter((x) => frames[0].isOpaque(x, row)).length).toBeGreaterThan(8);
  });

  it("船台上的船骨架：尺寸固定，进度越大画得越满，越界进度被夹住", () => {
    const count = (px: Px) => px.data.reduce((n, v) => n + (v & 0xff ? 1 : 0), 0);
    const steps = [0, 0.25, 0.6, 0.85].map((p) => drawShipFrame(p));
    for (const s of steps) expect([s.w, s.h]).toEqual([SHIP_FRAME_SIZE.w, SHIP_FRAME_SIZE.h]);
    for (let k = 1; k < steps.length; k++) expect(count(steps[k])).toBeGreaterThan(count(steps[k - 1]));
    expect(same(drawShipFrame(-1), drawShipFrame(0))).toBe(true);
    expect(same(drawShipFrame(5), drawShipFrame(1))).toBe(true);
    expect(same(drawShipFrame(Number.NaN), drawShipFrame(0))).toBe(true);
    // 完工时立起了桅杆：比铺完船板时高
    const top = (px: Px) => px.bounds()?.y ?? px.h;
    expect(top(drawShipFrame(1))).toBeLessThan(top(drawShipFrame(0.85)));
  });
});

/** 寰宇·十六世纪新增的 16 种船型（data/worlds/terra16/ships/02_galleys_eastasia.toml、03_ocean_traditions.toml 的顺序）。 */
const T16 = [
  "galley", "galiot", "kobaya", "sekibune", "atakebune", "fuchuan", "shachuan", "niaochuan",
  "panokseon", "jong", "kora_kora", "mtepe", "sambuk", "maya_canoe", "balsa_raft", "double_canoe",
] as const;
/** 数据表里的 sail 字段（新船型的帆型只是占位，画法按 key 取；sail 只在 key 未知时挑通用船）。 */
const T16_SAIL: Readonly<Record<(typeof T16)[number], "square" | "lateen">> = {
  galley: "lateen", galiot: "lateen", kobaya: "square", sekibune: "square", atakebune: "square", fuchuan: "square",
  shachuan: "square", niaochuan: "square", panokseon: "square", jong: "square", kora_kora: "square", mtepe: "square",
  sambuk: "lateen", maya_canoe: "square", balsa_raft: "lateen", double_canoe: "lateen",
};

function byKey(k: (typeof T16)[number], opts: Partial<ShipArtOpts> = {}): Px {
  return drawShipByKey(k, T16_SAIL[k], { size: "large", ...opts });
}

describe("寰宇·十六世纪的新船型（按 key 画）", () => {
  it("新船型的 key 与数据表一致，和经典的 key 不重叠", () => {
    expect([...TERRA16_SHIP_KEYS]).toEqual([...T16]);
    expect(CLASSIC_SHIP_KEYS.length).toBe(SHIP_TYPES);
    for (const k of T16) expect(CLASSIC_SHIP_KEYS as readonly string[]).not.toContain(k);
    expect(T16_SPECS.length).toBe(T16.length);
    expect(T16_GLYPHS.length).toBe(T16.length);
  });

  it("经典的 key 映射到原来的下标：large 与 small、各种参数都与 drawShip 逐像素相同，水线也相同", () => {
    for (let i = 0; i < SHIP_TYPES; i++) {
      const key = CLASSIC_SHIP_KEYS[i];
      for (const size of ["large", "small"] as const) {
        // 帆型参数对合法的 key 不起作用（与合法的 typeIndex 一样）；唯一的例外是 brig：标三角帆的是寰宇的布里甘廷桨帆船，
        // 所以 brig 用它在经典世界的帆型（横帆）对照，三角帆的那一张见下面“布里甘廷”一项
        const sail = key === "brig" ? SAILS[i] : "lateen";
        for (const opts of [{ flag: "#c8373a", frame: 1 }, { pirate: true }, { damaged: true, frame: 3 }] as Partial<ShipArtOpts>[]) {
          expect(same(drawShipByKey(key, sail, { size, ...opts }), drawShip(i, SAILS[i], { size, ...opts })), `${key} ${size}`).toBe(true);
        }
        expect(waterlineByKey(key, size, sail)).toBe(waterlineOf(i, size, SAILS[i]));
      }
    }
  });

  it("布里甘廷：寰宇的 brig 标三角帆，画成小桨帆船；经典的横帆 brig 不变", () => {
    const brigIndex = CLASSIC_SHIP_KEYS.indexOf("brig");
    expect(SAILS[brigIndex]).toBe("square");
    for (const size of ["large", "small"] as const) {
      for (const opts of [{ flag: "#c8373a", frame: 1 }, { pirate: true }, { damaged: true, frame: 3 }] as Partial<ShipArtOpts>[]) {
        const lateen = drawShipByKey("brig", "lateen", { size, ...opts });
        // 与经典的双桅横帆船、两种退回的通用船、同是三角帆桨帆船的加列奥特都不同
        expect(same(lateen, drawShip(brigIndex, "square", { size, ...opts })), `brig ${size}`).toBe(false);
        expect(same(lateen, drawShip(1, "square", { size, ...opts }))).toBe(false);
        expect(same(lateen, drawShip(3, "lateen", { size, ...opts }))).toBe(false);
        expect(same(lateen, drawShipByKey("galiot", "lateen", { size, ...opts }))).toBe(false);
        // 同样的参数画出同样的图
        expect(same(lateen, drawShipByKey("brig", "lateen", { size, ...opts }))).toBe(true);
      }
    }
    const l = drawShipByKey("brig", "lateen", { size: "large" });
    expect(l.w).toBeGreaterThanOrEqual(64);
    expect(l.w).toBeLessThanOrEqual(128);
    expect(l.h).toBeLessThanOrEqual(128);
    // 比加列奥特小一号
    expect(l.w).toBeLessThan(drawShipByKey("galiot", "lateen", { size: "large" }).w);
    const s = drawShipByKey("brig", "lateen", { size: "small" });
    expect(s.w).toBeGreaterThanOrEqual(14);
    expect(s.w).toBeLessThanOrEqual(22);
    expect(s.h).toBeLessThanOrEqual(24);
    // 水线与画出的图一致：水线那一行有不透明的像素，水线以下不超过几行船底
    for (const size of ["large", "small"] as const) {
      const img = drawShipByKey("brig", "lateen", { size });
      const wl = waterlineByKey("brig", size, "lateen");
      expect(wl).toBeGreaterThan(0);
      expect(wl).toBeLessThan(img.h);
      expect(waterlineByKey("brig", size, "square")).toBe(waterlineOf(brigIndex, size, "square"));
    }
  });

  it("未知的 key 按帆型退回通用船（横帆 → 卡拉克，三角帆 → 双桅纵帆船）", () => {
    const opts: ShipArtOpts = { size: "large", flag: "#c8373a" };
    for (const bad of ["", "no_such_ship", "Galley", "0"]) {
      expect(same(drawShipByKey(bad, "square", opts), drawShip(1, "square", opts))).toBe(true);
      expect(same(drawShipByKey(bad, "lateen", opts), drawShip(3, "lateen", opts))).toBe(true);
      expect(waterlineByKey(bad, "small", "lateen")).toBe(waterlineOf(3, "small"));
    }
    // 下标只认经典世界：越过 19 的下标不会取到新船型
    expect(same(drawShip(SHIP_TYPES, "square", opts), drawShipByKey("galley", "square", opts))).toBe(false);
  });

  it("船型表 + id → key：有表用表里的 key，没有表按经典世界的顺序，越界为空串；只在 key 与经典不同时给出覆盖", () => {
    const terra = [...CLASSIC_SHIP_KEYS.slice(0, 19), ...T16].map((key) => ({ key }));
    expect(shipArtKey(terra, 0)).toBe("swallow");
    expect(shipArtKey(terra, 19)).toBe("galley");
    expect(shipArtKey(terra, 34)).toBe("double_canoe");
    expect(shipArtKey(null, 18)).toBe("lineship");
    expect(shipArtKey(undefined, 3)).toBe("silvergull");
    expect(shipArtKey([], 2)).toBe("whale");
    expect(shipArtKey([{ key: "" }], 0)).toBe("swallow");
    for (const bad of [-1, 19, 99, 1.5, Number.NaN]) expect(shipArtKey(null, bad)).toBe("");
    expect(shipKeyOverride(terra, 5)).toBeUndefined();
    expect(shipKeyOverride(terra, 20)).toBe("galiot");
    expect(shipKeyOverride(null, 4)).toBeUndefined();
  });

  it("每种新船都能画：大图宽 64–128，小图宽 14–22、高不超过 24", () => {
    for (const k of T16) {
      const l = byKey(k);
      expect(l.w, k).toBeGreaterThanOrEqual(64);
      expect(l.w, k).toBeLessThanOrEqual(128);
      expect(l.h, k).toBeLessThanOrEqual(128);
      const s = drawShipByKey(k, T16_SAIL[k], { size: "small" });
      expect(s.w, k).toBeGreaterThanOrEqual(14);
      expect(s.w, k).toBeLessThanOrEqual(22);
      expect(s.h, k).toBeLessThanOrEqual(24);
    }
  });

  it("小图的字符网格整齐：每行等宽，叠层与底图同样大小，旗、烟、破洞都在图内", () => {
    T16_GLYPHS.forEach((g, i) => {
      const w = g.rows[0].length;
      for (const r of g.rows) expect(r.length, `${T16[i]} rows`).toBe(w);
      if (g.over) {
        expect(g.over.length, `${T16[i]} over`).toBe(g.rows.length);
        for (const r of g.over) expect(r.length, `${T16[i]} over`).toBe(w);
      }
      expect(g.bottom).toBeLessThan(g.rows.length);
      expect(g.deck).toBeLessThan(g.bottom);
      expect(g.flag[0] + 3).toBeLessThan(w);
      if (g.hole) expect(g.hole[0]).toBeLessThan(w);
    });
  });

  it("同样的参数永远画出同样的图，返回可以放心修改的副本", () => {
    for (const k of T16) {
      for (const size of ["large", "small"] as const) {
        const opts: ShipArtOpts = { size, flag: "#2f8a62", frame: 3, damaged: true };
        const a = drawShipByKey(k, T16_SAIL[k], opts);
        const b = drawShipByKey(k, T16_SAIL[k], { ...opts });
        expect(same(a, b)).toBe(true);
        a.fill("#000");
        expect(same(drawShipByKey(k, T16_SAIL[k], opts), b)).toBe(true);
      }
    }
  });

  it("4 帧各不相同；旗色、海盗、受损、帧都不改变尺寸；海盗版、受损版与普通版不同", () => {
    for (const k of T16) {
      for (const size of ["large", "small"] as const) {
        const frames = Array.from({ length: SHIP_FRAMES }, (_, f) => drawShipByKey(k, T16_SAIL[k], { size, flag: "#2f8a62", frame: f }));
        for (let a = 0; a < SHIP_FRAMES; a++) for (let b = a + 1; b < SHIP_FRAMES; b++) expect(same(frames[a], frames[b]), `${k} ${size} ${a}/${b}`).toBe(false);
        expect(same(drawShipByKey(k, T16_SAIL[k], { size, flag: "#2f8a62", frame: SHIP_FRAMES + 1 }), frames[1])).toBe(true);
        const base = frames[0];
        const variants = [
          drawShipByKey(k, T16_SAIL[k], { size, pirate: true }),
          drawShipByKey(k, T16_SAIL[k], { size, flag: "#2f8a62", damaged: true }),
          drawShipByKey(k, T16_SAIL[k], { size }),
        ];
        for (const v of variants) {
          expect([v.w, v.h]).toEqual([base.w, base.h]);
          expect(same(v, base), `${k} ${size}`).toBe(false);
        }
      }
    }
  });

  it("旗色画在旗上；不带旗时只用调色板里的颜色", () => {
    const pal = paletteColors();
    for (const k of T16) {
      for (const size of ["large", "small"] as const) {
        expect(drawShipByKey(k, T16_SAIL[k], { size, flag: "#123456" }).data.includes(rgba("#123456")), `${k} ${size}`).toBe(true);
        for (const opts of [{}, { pirate: true }, { damaged: true, frame: 1 }, { pirate: true, damaged: true, frame: 2 }] as Partial<ShipArtOpts>[]) {
          const px = drawShipByKey(k, T16_SAIL[k], { size, ...opts });
          const stray = [...new Set(px.data)].filter((v) => v !== 0 && !pal.has(v));
          expect(stray, `${k} ${size}`).toEqual([]);
        }
      }
    }
  });

  it("水线在图内：水线处是连成片的船体，水线以下还有几行、且不比水线处宽", () => {
    for (const k of T16) {
      for (const size of ["large", "small"] as const) {
        const px = drawShipByKey(k, T16_SAIL[k], { size, flag: "#c8373a" });
        const wl = waterlineByKey(k, size, T16_SAIL[k]);
        expect(wl, `${k} ${size}`).toBeGreaterThan(px.h / 2);
        expect(wl).toBeLessThan(px.h);
        const run = (y: number) => {
          let best = 0;
          let cur = 0;
          for (let x = 0; x < px.w; x++) {
            cur = px.isOpaque(x, y) ? cur + 1 : 0;
            best = Math.max(best, cur);
          }
          return best;
        };
        expect(run(wl), `${k} ${size}`).toBeGreaterThan(px.w * 0.4);
        expect(run(wl - 1), `${k} ${size}`).toBeGreaterThan(px.w * 0.4);
        const below = [...Array(px.h - wl - 1).keys()].map((d) => run(wl + 1 + d));
        expect(below.length).toBeGreaterThan(0);
        expect(Math.max(...below), `${k} ${size}`).toBeLessThanOrEqual(run(wl));
      }
    }
  });

  it("新船型彼此不同，也不同于经典的任何一种", () => {
    for (const size of ["large", "small"] as const) {
      const fresh = T16.map((k) => drawShipByKey(k, T16_SAIL[k], { size, flag: "#c8373a" }));
      const classic = CLASSIC_SHIP_KEYS.map((k) => drawShipByKey(k, "square", { size, flag: "#c8373a" }));
      fresh.forEach((a, i) => {
        for (let j = i + 1; j < fresh.length; j++) expect(same(a, fresh[j]), `${size} ${T16[i]}/${T16[j]}`).toBe(false);
        for (const c of classic) expect(same(a, c), `${size} ${T16[i]}`).toBe(false);
      });
    }
  });

  it("帆的底色：中国与朝鲜船是赭色的竹骨硬帆，席帆船是草黄的编席，地中海、阿拉伯船与木筏是奶白的布帆；没有帆的船不画帆", () => {
    const has = (px: Px, c: string) => px.data.includes(rgba(c));
    for (const size of ["large", "small"] as const) {
      for (const k of ["fuchuan", "shachuan", "niaochuan", "panokseon"] as const) expect(has(drawShipByKey(k, "square", { size }), P.sand[2]), `${k} ${size}`).toBe(true);
      for (const k of ["sekibune", "atakebune", "jong", "kora_kora", "mtepe", "double_canoe"] as const) {
        expect(has(drawShipByKey(k, "square", { size }), P.straw[2]), `${k} ${size}`).toBe(true);
      }
      for (const k of ["galley", "galiot", "sambuk", "balsa_raft"] as const) expect(has(drawShipByKey(k, "lateen", { size }), P.paper), `${k} ${size}`).toBe(true);
      // 海盗：三角帆船是暗红帆，其余是黑帆
      expect(has(drawShipByKey("galley", "lateen", { size, pirate: true }), P.red[1]), size).toBe(true);
      expect(has(drawShipByKey("jong", "square", { size, pirate: true }), P.cloth.black[1]), size).toBe(true);
    }
    // 小早与玛雅独木舟没有帆：大图里没有一个帆的像素颜色
    for (const k of ["kobaya", "maya_canoe"] as const) {
      const px = byKey(k);
      for (const c of [P.parchment, P.sand[2]]) expect(has(px, c), k).toBe(false);
    }
  });

  it("桨与桨手随帧划动：加莱船、关船、玛雅独木舟、科拉科拉水线上方的船舷各帧不同", () => {
    const band = (k: (typeof T16)[number], frame: number) => {
      const px = byKey(k, { frame });
      const wl = waterlineByKey(k, "large", T16_SAIL[k]);
      return Array.from(px.data.slice((wl - 4) * px.w, (wl + 1) * px.w));
    };
    for (const k of ["galley", "galiot", "sekibune", "maya_canoe", "kora_kora"] as const) expect(band(k, 0), k).not.toEqual(band(k, 2));
    // 没有桨的船船舷不动
    for (const k of ["fuchuan", "jong", "mtepe"] as const) expect(band(k, 0), k).toEqual(band(k, 2));
  });

  it("体量大致合乎船型：小早 < 关船 < 安宅船，加列奥特 < 加莱，爪哇大船最高，独木舟与木筏最矮", () => {
    const w = (k: (typeof T16)[number]) => byKey(k).w;
    const h = (k: (typeof T16)[number]) => byKey(k).h;
    expect(w("kobaya")).toBeLessThan(w("sekibune"));
    expect(w("sekibune")).toBeLessThan(w("atakebune"));
    expect(w("galiot")).toBeLessThan(w("galley"));
    expect(w("niaochuan")).toBeLessThan(w("fuchuan"));
    expect(Math.max(...T16.map(h))).toBe(h("jong"));
    expect(Math.min(...T16.map(h))).toBe(h("maya_canoe"));
    expect(h("kobaya")).toBeLessThan(h("sekibune"));
  });
});
