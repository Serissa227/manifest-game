// 船的预览（npx vite-node scripts/art-preview.ts ships）。
// 0–7 为原有船型，8–18 为航海历 1502 年追加的船型（柯克船、单桅快船、三角帆商船、双桅横帆船、探险快船、
// 移民船、巡防舰、加莱赛战船、瑶华宝船、飞剪船、战列舰）。
// t16-* 为寰宇·十六世纪按 key 新增的 16 种船（ships16.ts），与几种经典船并排对比。
import { P } from "./palette";
import { Px, sheet, type Preview } from "./px";
import {
  BOAT_SIZE,
  SHIP_FRAMES,
  SHIP_TYPES,
  TERRA16_SHIP_KEYS,
  drawBoat,
  drawShip,
  drawShipByKey,
  drawShipFrame,
  waterlineByKey,
  waterlineOf,
  type ShipArtOpts,
} from "./ships";

const FLAGS = ["#c8373a", "#2f8a62", "#dca434", "#239a9a", "#4f6282", "#8a64b0", "#c8373a", "#3a5bb0"];
/** ships.toml 中各船型的帆型（sail 字段）。 */
const SAILS = [
  "lateen", "square", "square", "lateen", "square", "square", "lateen", "square",
  "square", "lateen", "lateen", "square", "lateen", "square", "square", "lateen", "lateen", "square", "square",
] as const;
/** 新增的船型（8–18 为 1502 年追加的 11 种）。 */
const NEW = Array.from({ length: SHIP_TYPES - 8 }, (_, k) => 8 + k);

function flagOf(i: number): string {
  return FLAGS[i % FLAGS.length];
}

function ship(i: number, opts: Partial<ShipArtOpts> = {}): Px {
  return drawShip(i, SAILS[i], { size: "large", flag: flagOf(i), ...opts });
}

function small(i: number, opts: Partial<ShipArtOpts> = {}): Px {
  return drawShip(i, SAILS[i], { size: "small", flag: flagOf(i), ...opts });
}

/** 把一艘船放进一块海面：天空、海面、水线处叠加一道浪花。 */
function onSea(px: Px, waterline: number, pad = 6): Px {
  const w = px.w + pad * 2;
  const h = px.h + pad + 6;
  const out = new Px(w, h);
  const sea = waterline + pad;
  out.gradient(0, 0, w, sea, [P.sky[2], P.sky[3], P.sky[4]]);
  out.gradient(0, sea, w, h - sea, [P.sea[3], P.sea[2], P.sea[1]]);
  out.blit(px, pad, pad);
  // 水线处的浪：半透明海色盖住船底，再点几道浪花
  for (let x = 0; x < w; x++) {
    for (let y = sea; y < h; y++) {
      const o = out.get(x, y);
      if (o) out.set(x, y, y === sea ? "#2f86b8cc" : "#1d5b92aa");
    }
    if ((x + Math.floor(x / 7)) % 5 < 2) out.set(x, sea, P.foam);
    if ((x + 3) % 9 < 3) out.set(x, sea + 2, P.sea[4]);
  }
  return out;
}

/** 按水线对齐排成一行（底边对齐海面），方便比较体量。 */
function lineUp(ids: readonly number[], size: "large" | "small", gap: number): Px {
  const pics = ids.map((i) => (size === "large" ? ship(i) : small(i)));
  const wls = ids.map((i) => waterlineOf(i, size, SAILS[i]));
  const top = Math.max(...wls);
  const below = Math.max(...pics.map((p, k) => p.h - wls[k]));
  const w = pics.reduce((a, p) => a + p.w + gap, gap);
  const out = new Px(w, top + below + 2);
  out.gradient(0, 0, w, top + 1, [P.sky[2], P.sky[3], P.sky[4]]);
  out.gradient(0, top + 1, w, out.h - top - 1, [P.sea[3], P.sea[2]]);
  let x = gap;
  pics.forEach((p, k) => {
    out.blit(p, x, top - wls[k]);
    x += p.w + gap;
  });
  return out;
}

/** 按 key 画一艘寰宇·十六世纪的船（旗色按序轮流）。 */
function t16(k: string, i: number, opts: Partial<ShipArtOpts> = {}): Px {
  return drawShipByKey(k, "square", { size: "large", flag: FLAGS[i % FLAGS.length], ...opts });
}

function t16Small(k: string, i: number, opts: Partial<ShipArtOpts> = {}): Px {
  return drawShipByKey(k, "square", { size: "small", flag: FLAGS[i % FLAGS.length], ...opts });
}

/** 按 key 排成一行、水线对齐（经典船也按它的 key）。 */
function lineUpKeys(keys: readonly string[], size: "large" | "small", gap: number): Px {
  const pics = keys.map((k, i) => (size === "large" ? t16(k, i) : t16Small(k, i)));
  const wls = keys.map((k) => waterlineByKey(k, size));
  const top = Math.max(...wls);
  const below = Math.max(...pics.map((p, k) => p.h - wls[k]));
  const w = pics.reduce((a, p) => a + p.w + gap, gap);
  const out = new Px(w, top + below + 2);
  out.gradient(0, 0, w, top + 1, [P.sky[2], P.sky[3], P.sky[4]]);
  out.gradient(0, top + 1, w, out.h - top - 1, [P.sea[3], P.sea[2]]);
  let x = gap;
  pics.forEach((p, k) => {
    out.blit(p, x, top - wls[k]);
    x += p.w + gap;
  });
  return out;
}

export default function preview(): Preview[] {
  const keys = TERRA16_SHIP_KEYS;
  const t16Sea = keys.map((k, i) => onSea(t16(k, i), waterlineByKey(k, "large")));
  const t16SeaSmall = keys.map((k, i) => onSea(t16Small(k, i), waterlineByKey(k, "small"), 3));
  const t16Frames = ["galley", "kora_kora", "maya_canoe", "jong"].flatMap((k, i) => Array.from({ length: SHIP_FRAMES }, (_, f) => t16(k, i, { frame: f })));
  const types = Array.from({ length: SHIP_TYPES }, (_, i) => i);
  const large = types.map((i) => ship(i));
  const smalls = types.map((i) => small(i));
  const smallPirate = types.map((i) => small(i, { pirate: true, flag: undefined }));
  const smallDamaged = types.map((i) => small(i, { damaged: true }));
  const pirate = types.map((i) => ship(i, { pirate: true }));
  const damaged = types.map((i) => ship(i, { damaged: true }));
  const frames = [1, 3, 7].flatMap((i) => Array.from({ length: SHIP_FRAMES }, (_, f) => ship(i, { frame: f })));
  const dmgFrames = Array.from({ length: SHIP_FRAMES }, (_, f) => ship(5, { frame: f, damaged: true }));
  const newFrames = [15, 16].flatMap((i) => Array.from({ length: SHIP_FRAMES }, (_, f) => ship(i, { frame: f })));
  const sea = types.map((i) => onSea(ship(i), waterlineOf(i, "large", SAILS[i])));
  const seaSmall = types.map((i) => onSea(small(i), waterlineOf(i, "small", SAILS[i]), 3));
  const boats = Array.from({ length: SHIP_FRAMES }, (_, f) => onSea(drawBoat(f), BOAT_SIZE.waterline, 3));
  const frameSteps = [0, 0.1, 0.2, 0.3, 0.45, 0.55, 0.7, 0.85, 1].map((p) => drawShipFrame(p));
  const generic = [drawShip(99, "square", { size: "large", flag: FLAGS[0] }), drawShip(-1, "lateen", { size: "large", flag: FLAGS[0] })];
  // 按船价排序（ships.toml）
  const byPrice = [0, 8, 9, 10, 12, 1, 3, 11, 2, 13, 5, 4, 6, 17, 16, 14, 15, 7, 18];
  return [
    { name: "large", px: sheet(large, { cols: 4, bg: P.sky[3], gap: 6 }), scale: 3 },
    { name: "small", px: sheet([...smalls, ...smallPirate, ...smallDamaged], { cols: 10, bg: P.sea[2], gap: 4 }), scale: 6 },
    { name: "pirate", px: sheet(pirate, { cols: 4, bg: P.sky[3], gap: 6 }), scale: 3 },
    { name: "damaged", px: sheet(damaged, { cols: 4, bg: P.sky[3], gap: 6 }), scale: 3 },
    { name: "frames", px: sheet([...frames, ...dmgFrames], { cols: 4, bg: P.sky[3], gap: 4 }), scale: 3 },
    { name: "sea", px: sheet(sea, { cols: 4, gap: 0, pad: 0 }), scale: 3 },
    { name: "sea-small", px: sheet(seaSmall, { cols: 10, gap: 0, pad: 0 }), scale: 6 },
    { name: "boat", px: sheet(boats, { cols: 4, gap: 0, pad: 0 }), scale: 6 },
    { name: "shipframe", px: sheet(frameSteps, { cols: 3, bg: P.sky[3], gap: 4 }), scale: 3 },
    { name: "generic", px: sheet(generic, { cols: 2, bg: P.sky[3] }), scale: 3 },
    // 新增船型：大图、海盗、受损、动画帧、小图
    { name: "new-large", px: sheet(NEW.map((i) => ship(i)), { cols: 4, bg: P.sky[3], gap: 6 }), scale: 3 },
    { name: "new-pirate", px: sheet(NEW.map((i) => ship(i, { pirate: true })), { cols: 4, bg: P.sky[3], gap: 6 }), scale: 3 },
    { name: "new-damaged", px: sheet(NEW.map((i) => ship(i, { damaged: true, frame: 1 })), { cols: 4, bg: P.sky[3], gap: 6 }), scale: 3 },
    { name: "new-frames", px: sheet(newFrames, { cols: 4, bg: P.sky[3], gap: 4 }), scale: 3 },
    {
      name: "new-small",
      px: sheet([...NEW.map((i) => small(i)), ...NEW.map((i) => small(i, { pirate: true, flag: undefined })), ...NEW.map((i) => small(i, { damaged: true, frame: 1 }))], {
        cols: 11,
        bg: P.sea[2],
        gap: 4,
      }),
      scale: 8,
    },
    // 帆型对比：横帆、三角帆、斜桁帆、东方硬帆
    { name: "rigs", px: sheet([ship(11), ship(10), ship(9), ship(16)], { cols: 4, bg: P.sky[3], gap: 6 }), scale: 4 },
    { name: "rigs-small", px: sheet([small(11), small(10), small(9), small(16), small(15)], { cols: 5, bg: P.sea[2], gap: 4 }), scale: 10 },
    // 体量对比：按船价排成一排，水线对齐
    { name: "lineup", px: lineUp(byPrice, "large", 4), scale: 2 },
    { name: "lineup-small", px: lineUp(byPrice, "small", 3), scale: 6 },
    // 放大看细节：船体、帆、旗
    { name: "detail-tradewind", px: sheet([ship(1), ship(1, { frame: 2 })], { cols: 2, bg: P.sky[3] }), scale: 6 },
    { name: "detail-swallow-silvergull", px: sheet([ship(0), ship(3)], { cols: 2, bg: P.sky[3] }), scale: 5 },
    { name: "detail-farstar", px: sheet([ship(7), ship(7, { pirate: true })], { cols: 2, bg: P.sky[3] }), scale: 4 },
    { name: "detail-junk", px: sheet([ship(16), ship(16, { pirate: true })], { cols: 2, bg: P.sky[3] }), scale: 4 },
    { name: "detail-galleass", px: sheet([ship(15), ship(15, { frame: 2 })], { cols: 2, bg: P.sky[3] }), scale: 4 },
    { name: "detail-lineship", px: sheet([ship(18), ship(14)], { cols: 2, bg: P.sky[3] }), scale: 4 },
    { name: "detail-small-cog-dhow", px: sheet([ship(8), ship(9), ship(10), ship(12)], { cols: 4, bg: P.sky[3] }), scale: 5 },
    { name: "detail-damaged", px: sheet([ship(5, { damaged: true }), ship(6, { damaged: true, pirate: true })], { cols: 2, bg: P.sky[3] }), scale: 4 },
    { name: "detail-small", px: sheet([...smalls, ...smallPirate], { cols: 10, bg: P.sea[2], gap: 3 }), scale: 10 },
    { name: "detail-boat", px: sheet(Array.from({ length: SHIP_FRAMES }, (_, f) => drawBoat(f)), { cols: 4, bg: P.sky[3] }), scale: 10 },
    // 寰宇·十六世纪：16 种新船（大图、海盗、受损、动画帧、小图），以及与经典船的体量对比
    { name: "t16-large", px: sheet(t16Sea, { cols: 4, gap: 0, pad: 0 }), scale: 3 },
    { name: "t16-pirate", px: sheet(keys.map((k) => t16(k, 0, { pirate: true, flag: undefined })), { cols: 4, bg: P.sky[3], gap: 6 }), scale: 3 },
    { name: "t16-damaged", px: sheet(keys.map((k, i) => t16(k, i, { damaged: true, frame: 1 })), { cols: 4, bg: P.sky[3], gap: 6 }), scale: 3 },
    { name: "t16-frames", px: sheet(t16Frames, { cols: 4, bg: P.sky[3], gap: 4 }), scale: 3 },
    { name: "t16-small", px: sheet(t16SeaSmall, { cols: 8, gap: 0, pad: 0 }), scale: 8 },
    {
      name: "t16-small-variants",
      px: sheet([...keys.map((k, i) => t16Small(k, i)), ...keys.map((k) => t16Small(k, 0, { pirate: true, flag: undefined })), ...keys.map((k, i) => t16Small(k, i, { damaged: true, frame: 1 }))], {
        cols: 16,
        bg: P.sea[2],
        gap: 4,
      }),
      scale: 8,
    },
    { name: "t16-lineup", px: lineUpKeys(["swallow", "tradewind", "junk", "galleass", ...keys], "large", 4), scale: 2 },
    { name: "t16-lineup-small", px: lineUpKeys(["swallow", "tradewind", "dhow", "junk", "galleass", ...keys], "small", 3), scale: 6 },
    // 实际显示倍数（2 倍）下的总览
    { name: "overview-2x", px: sheet(sea.slice(0, 4), { cols: 4, gap: 0, pad: 0 }), scale: 2 },
    { name: "overview-new-2x", px: sheet(NEW.slice(0, 6).map((i) => sea[i]), { cols: 3, gap: 0, pad: 0 }), scale: 2 },
  ];
}
