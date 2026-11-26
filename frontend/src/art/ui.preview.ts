// 界面贴图预览（npx vite-node scripts/art-preview.ts ui.preview）：单张贴图，以及按 CSS 九宫格规则拼出的窗口、顶栏、卷轴、缎带与开机画面的样张。
import { P, ink } from "./palette";
import { Px, sheet, type Preview } from "./px";
import {
  FRAME_SLICE,
  PLAQUE_SLICE,
  RIBBON_SLICE,
  SCROLL_SLICE,
  THIN_SLICE,
  UI_TEXTURES,
  drawEmblem,
  drawFrame,
  drawOrnament,
  drawParchment,
  drawPlanks,
  drawPlaque,
  drawRail,
  drawRibbon,
  drawRope,
  drawScroll,
  drawSeaTile,
  drawSeal,
  drawThinFrame,
  drawTitle,
  nineSlice,
} from "./ui";

const all = (n: number) => ({ t: n, r: n, b: n, l: n });

/** 平铺一张贴图到指定区域。 */
function tile(dst: Px, src: Px, x: number, y: number, w: number, h: number) {
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const v = src.data[(yy % src.h) * src.w + (xx % src.w)];
      dst.data[(y + yy) * dst.w + (x + xx)] = v;
    }
  }
}

/** 模拟 CSS 像素按钮：2 像素深色边、左上高光、右下阴影、底部 2 像素厚度。 */
function button(dst: Px, x: number, y: number, w: number, h: number, kind: "wood" | "brass" | "red" | "pressed") {
  const face = { wood: P.wood[2], brass: P.gold[2], red: P.red[1], pressed: P.wood[2] }[kind];
  const hi = { wood: P.wood[3], brass: P.gold[4], red: P.red[2], pressed: P.wood[1] }[kind];
  const lo = { wood: P.wood[1], brass: P.gold[1], red: P.red[0], pressed: P.wood[2] }[kind];
  const dy = kind === "pressed" ? 1 : 0;
  dst.rect(x, y + dy, w, h, ink.brown);
  dst.rect(x + 1, y + 1 + dy, w - 2, h - 2, face);
  dst.hline(x + 1, x + w - 2, y + 1 + dy, hi).vline(x + 1, y + 1 + dy, y + h - 2 + dy, hi);
  dst.hline(x + 2, x + w - 2, y + h - 2 + dy, lo).vline(x + w - 2, y + 2 + dy, y + h - 2 + dy, lo);
  dst.hline(x, x + w - 1, y + h + dy, ink.brown);
  // 假文字
  const txt = kind === "brass" ? ink.brown : P.paper;
  dst.rect(x + 4, y + Math.floor(h / 2) - 1 + dy, w - 8, 2, txt);
}

/** 一扇窗口样张：木框 + 标题栏 + 牌匾 + 羊皮纸 + 小节标题 + 账簿表格 + 按钮。 */
function windowMock(): Px {
  const w = 220;
  const h = 150;
  const p = new Px(w, h);
  const S = FRAME_SLICE;
  tile(p, drawParchment(), S, S, w - 2 * S, h - 2 * S);
  // 标题栏：木板底纹
  tile(p, drawPlanks(), S, S, w - 2 * S, 18);
  p.hline(S, w - S - 1, S + 18, ink.brown);
  p.blit(nineSlice(drawFrame("wood"), all(S), w, h), 0, 0);
  // 牌匾
  const pw = 70;
  const plaque = nineSlice(drawPlaque(), { t: PLAQUE_SLICE.v, r: PLAQUE_SLICE.h, b: PLAQUE_SLICE.v, l: PLAQUE_SLICE.h }, pw, 16, true);
  p.blit(plaque, Math.floor((w - pw) / 2), S + 1);
  p.rect(Math.floor((w - pw) / 2) + 22, S + 8, 26, 2, ink.brown);
  // 关闭按钮
  button(p, w - S - 16, S + 2, 13, 12, "red");
  // 小节标题：罗盘星 + 文字 + 绳纹
  const y0 = S + 26;
  p.blit(drawOrnament(), S + 8, y0);
  p.rect(S + 20, y0 + 3, 30, 3, P.wood[1]);
  tile(p, drawRope(), S + 56, y0 + 3, 130, 4);
  // 账簿表格
  const tx = S + 8;
  const ty = y0 + 14;
  const tw = w - 2 * S - 16;
  p.rect(tx, ty, tw, 9, P.wood[2]);
  p.hline(tx, tx + tw - 1, ty + 9, ink.brown);
  for (let i = 0; i < 4; i++) p.rect(tx + 4 + i * 45, ty + 3, 24, 2, P.paper);
  for (let r = 0; r < 5; r++) {
    const ry = ty + 10 + r * 9;
    if (r % 2 === 1) p.dither(tx, ry, tw, 8, P.parchment, 2);
    for (let i = 0; i < 4; i++) p.rect(tx + 4 + i * 45, ry + 3, 18 + ((r * 7 + i * 5) % 10), 2, ink.brown);
    for (let x = tx; x < tx + tw; x += 2) p.put(x, ry + 8, P.parchmentDark);
  }
  // 按钮
  button(p, S + 8, h - S - 18, 36, 13, "wood");
  button(p, S + 50, h - S - 18, 36, 13, "brass");
  button(p, S + 92, h - S - 18, 36, 13, "pressed");
  return p;
}

/** 顶栏与命令栏样张。 */
function barMock(): Px {
  const w = 240;
  const p = new Px(w, 70);
  tile(p, drawPlanks(), 0, 0, w, 30);
  tile(p, drawRail(), 0, 30, w, 6);
  // 头像框
  p.rect(4, 3, 24, 24, P.cloth.navy[1]);
  p.blit(nineSlice(drawThinFrame(), all(THIN_SLICE), 26, 26), 3, 2);
  // 日期牌匾
  p.blit(nineSlice(drawPlaque(), { t: 4, r: 9, b: 4, l: 9 }, 60, 16, true), 150, 4);
  // 命令栏
  tile(p, drawRail(), 0, 40, w, 6);
  tile(p, drawPlanks(), 0, 46, w, 24);
  for (let i = 0; i < 7; i++) button(p, 8 + i * 32, 50, 28, 16, i === 2 ? "brass" : "wood");
  return p;
}

function boardMock(): Px {
  const p = new Px(200, 110);
  tile(p, drawSeaTile(), 0, 0, 200, 110);
  const emblem = drawEmblem();
  p.blit(emblem, 100 - Math.floor(emblem.w / 2), 4);
  const title = drawTitle("Manifest");
  p.blit(title, 100 - Math.floor(title.w / 2), 76);
  return p;
}

function bannerMock(): Px {
  const p = new Px(200, 60);
  p.fill(P.sea[2]);
  p.blit(nineSlice(drawRibbon("won"), { t: RIBBON_SLICE.v, r: RIBBON_SLICE.h, b: RIBBON_SLICE.v, l: RIBBON_SLICE.h }, 140, 20, true), 30, 4);
  p.blit(nineSlice(drawScroll(), { t: SCROLL_SLICE.v, r: SCROLL_SLICE.h, b: SCROLL_SLICE.v, l: SCROLL_SLICE.h }, 150, 22, true), 25, 30);
  p.blit(drawSeal(), 36, 35);
  return p;
}

export default function preview(): Preview[] {
  const singles = UI_TEXTURES.map((t) => t.draw());
  return [
    { name: "textures", px: sheet(singles, { cols: 7, gap: 6, bg: "#40404a" }), scale: 5 },
    { name: "window", px: windowMock(), scale: 3 },
    { name: "bars", px: barMock(), scale: 3 },
    { name: "boot", px: boardMock(), scale: 3 },
    { name: "banner", px: bannerMock(), scale: 3 },
    { name: "frame-wood", px: drawFrame("wood"), scale: 10 },
    { name: "frame-brass", px: nineSlice(drawFrame("brass"), all(FRAME_SLICE), 90, 60), scale: 5 },
    { name: "plaque", px: drawPlaque(), scale: 10 },
    { name: "ribbon-lost", px: drawRibbon("lost"), scale: 8 },
  ];
}
