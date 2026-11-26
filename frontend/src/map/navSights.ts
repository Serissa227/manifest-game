// H04 海上所见的小标记（航行视图）：程序画的像素图元（11 × 9），与船同一像素倍率，随浪轻轻起伏；
// 碰上了、等你在小卡片上选的，外面描一圈金色。标记小、不遮海面。纯绘制，不持有游戏状态。
import { P } from "../art/palette";
import type { NavSightings, SightKind } from "../ipc/types";
import type { SeaCamera } from "./navSea";
import { nearestCopy } from "./wrap";

/** 每种所见的字符画（. 空，字母取 colors 的颜色）。 */
const SIGHT_ART: Record<SightKind, { rows: string[]; colors: Record<string, string> }> = {
  // 两只漂流的木桶
  flotsam: { rows: ["...........", "..aa...aa..", ".abba.abba.", ".abba.abba.", "..aa...aa..", ".c.c.c.c.c.", "...........", "...........", "..........."], colors: { a: P.wood[1], b: P.wood[3], c: "#d8f4f8" } },
  // 断桅与碎板
  wreck: { rows: ["........a..", ".......a...", "......a....", ".....a.....", "..bbba.bb..", ".bbbbb.....", "c.c.c.c.c.c", "...........", "..........."], colors: { a: P.wood[2], b: P.wood[1], c: "#d8f4f8" } },
  // 小艇上的人
  castaway: { rows: ["...........", ".....a.....", ".....b.....", "....bbb....", ".cccccccc..", "..cccccc...", ".d.d.d.d.d.", "...........", "..........."], colors: { a: P.sand[3], b: P.red[2], c: P.wood[2], d: "#d8f4f8" } },
  // 一群海鸟
  birds: { rows: ["a.a........", ".a....a.a..", "......a....", "..a.a......", "...a....a.a", ".........a.", "....a.a....", ".....a.....", "..........."], colors: { a: P.white } },
  // 鱼群：跃出水面的银鱼（有眼睛）与溅起的水花——银蓝色、没有深色的核
  shoal: { rows: ["...........", "..bba......", ".baaab..ba.", "..bbc..baab", "....d..cbb.", ".d.d.d.d.d.", "..d.d.d....", "...........", "..........."], colors: { a: "#e8f2f8", b: "#8fb4cc", c: "#1a1423", d: P.white } },
  // 渔船的小帆
  fishing: { rows: ["....a......", "....aa.....", "....aaa....", "....aaaa...", "....b......", ".ccccccc...", "..ccccc....", ".d.d.d.d...", "..........."], colors: { a: P.paper, b: P.wood[1], c: P.wood[2], d: "#d8f4f8" } },
  // 一片异色的海藻
  weed: { rows: ["...........", "..aab.ab...", ".abaabaab..", "aabbaabbaa.", ".abaabbab..", "..abaab.a..", "...a..a....", "...........", "..........."], colors: { a: "#8c8a3a", b: "#b8a84a" } },
  // 浮冰
  ice: { rows: ["...........", "...aaa.....", "..abbba.aa.", ".abbbbba.ab", ".aabbbaa.aa", "..caaac....", "...........", "...........", "..........."], colors: { a: "#cfeaf2", b: P.white, c: "#7fb8cc" } },
  // 暗礁：一团深色的礁石、四周一圈白浪（深色的核是它与鱼群最大的区别）
  reef: { rows: ["..a.a.a.a..", ".a.......a.", "a..bbcb...a", "..bcccccb..", "a.bccbcc..a", "..bbbbb....", ".a.......a.", "..a.a.a.a..", "..........."], colors: { a: P.white, b: "#5a6470", c: "#2a3038" } },
};

/** 所见的像素列表 [x, y, 颜色]（左上为原点）。测试与画法共用。 */
export function sightPixels(kind: SightKind): [number, number, string][] {
  const art = SIGHT_ART[kind];
  const out: [number, number, string][] = [];
  art.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = art.colors[row[x]];
      if (c) out.push([x, y, c]);
    }
  });
  return out;
}

const sightArt = new Map<SightKind, HTMLCanvasElement | null>();

function sightCanvas(kind: SightKind): HTMLCanvasElement | null {
  if (sightArt.has(kind)) return sightArt.get(kind) ?? null;
  let canvas: HTMLCanvasElement | null = null;
  if (typeof document !== "undefined") {
    canvas = document.createElement("canvas");
    canvas.width = 11;
    canvas.height = 10;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      // 先画一层往下错一个像素的淡影，再画本体：小也看得清、浅色的在亮海面上也不散
      ctx.fillStyle = "rgba(10, 20, 34, 0.38)";
      for (const [x, y] of sightPixels(kind)) ctx.fillRect(x, y + 1, 1, 1);
      for (const [x, y, c] of sightPixels(kind)) {
        ctx.fillStyle = c;
        ctx.fillRect(x, y, 1, 1);
      }
    } else canvas = null;
  }
  sightArt.set(kind, canvas);
  return canvas;
}

/** 海上所见的小标记。 */
export function drawSightings(ctx: CanvasRenderingContext2D, cam: SeaCamera, marks: NavSightings["marks"], scale: number, time: number): void {
  if (marks.length === 0) return;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  for (const m of marks) {
    const art = sightCanvas(m.kind);
    if (!art) continue;
    const ux = nearestCopy(m.x, cam.cx, cam.width, cam.wrap);
    const sx = cam.viewW / 2 + (ux - cam.cx) * cam.cellPx;
    const sy = cam.viewH / 2 + (m.y - cam.cy) * cam.cellPx + Math.round(Math.sin(time / 600 + m.id) * scale * 0.5);
    if (sx < -40 || sy < -40 || sx > cam.viewW + 40 || sy > cam.viewH + 40) continue;
    const w = art.width * scale;
    const h = art.height * scale;
    if (m.touched) {
      ctx.strokeStyle = P.gold[3];
      ctx.lineWidth = Math.max(1, scale);
      ctx.strokeRect(Math.round(sx - w / 2) - scale, Math.round(sy - h / 2) - scale, w + 2 * scale, h + 2 * scale);
    }
    ctx.drawImage(art, Math.round(sx - w / 2), Math.round(sy - h / 2), w, h);
  }
  ctx.restore();
}
