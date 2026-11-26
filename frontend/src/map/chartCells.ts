// H03 世界海图上的天气团（VOYAGE-PLAN §4.1 第三条）：旗舰队在海上时，离它 chart_range 格以内、海图已有或已探明处的团，
// 画成与航行视图同一种粗像素圆块（世界图上每格只取几块，淡一些），放在天气层里（迷雾之下，地点、舰队、航线之上不挡点选）。
// 只在概览更新时换；纯绘制，不持有游戏状态。对世界图渲染器只要两行接入：建图层、在 drawWeather 旁边调用 update。
import type { Container, Sprite, Texture } from "pixi.js";
import type { Overview } from "../ipc/types";
import { cellColors, cellMask } from "./navSea";

type Pixi = typeof import("pixi.js");
type ChartCell = NonNullable<Overview["weather_cells"]>[number];

/** 世界图上天气团每格几块（世界图每格的像素少，块再细也看不出）。 */
export const CHART_CELL_BLOCKS = 8;
/** 世界图上整体再淡一些：不盖住海图的颜色与标记。 */
const CHART_ALPHA = 0.8;

/** 一个团在世界图上的 RGBA 像素（纯函数，测试用）。 */
export function chartCellPixels(c: ChartCell): { n: number; rgba: Uint8ClampedArray<ArrayBuffer> } {
  const { n, data } = cellMask(c.r, c.id, c.kind, CHART_CELL_BLOCKS);
  const colors = cellColors(c.kind);
  const rgba = new Uint8ClampedArray(new ArrayBuffer(n * n * 4));
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (!v) continue;
    const [r, g, b, a] = colors[v - 1];
    rgba.set([r, g, b, Math.round(a * CHART_ALPHA)], i * 4);
  }
  return { n, rgba };
}

/**
 * 建世界图上的天气团图层。`cellPx` 是世界图每格的像素（海图坐标），`atView` 把海图横坐标摆到离镜头最近的那一份上。
 * 返回 update（概览更新时调用）与 dispose。
 */
export function createChartCells(PIXI: Pixi, layer: Container, cellPx: number, atView: (x: number) => number) {
  const sprites = new Map<string, Sprite>();
  const textures = new Map<string, Texture>();
  const textureOf = (c: ChartCell): Texture | null => {
    const key = `${c.id}:${c.kind}:${c.r.toFixed(2)}`;
    let t = textures.get(key);
    if (t) return t;
    if (typeof document === "undefined" || typeof ImageData === "undefined") return null;
    const { n, rgba } = chartCellPixels(c);
    const canvas = document.createElement("canvas");
    canvas.width = n;
    canvas.height = n;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.putImageData(new ImageData(rgba, n, n), 0, 0);
    t = PIXI.Texture.from(canvas);
    t.source.scaleMode = "nearest";
    textures.set(key, t);
    return t;
  };
  return {
    update(o: Overview | null) {
      const cells = o?.weather_cells ?? [];
      const keep = new Set(cells.map((c) => c.id));
      for (const [id, s] of sprites) {
        if (!keep.has(id)) {
          s.destroy();
          sprites.delete(id);
        }
      }
      for (const c of cells) {
        const t = textureOf(c);
        if (!t) continue;
        let s = sprites.get(c.id);
        if (!s) {
          s = new PIXI.Sprite(t);
          layer.addChild(s);
          sprites.set(c.id, s);
        }
        s.texture = t;
        const size = 2 * c.r * cellPx;
        s.width = size;
        s.height = size;
        s.position.set(atView(c.x * cellPx) - size / 2, c.y * cellPx - size / 2);
      }
      // 纹理只留在用的（团每天换位置，旧的不再要）
      for (const [key, t] of textures) {
        if (!cells.some((c) => key.startsWith(`${c.id}:`))) {
          t.destroy(true);
          textures.delete(key);
        }
      }
    },
    dispose() {
      for (const s of sprites.values()) s.destroy();
      sprites.clear();
      for (const t of textures.values()) t.destroy(true);
      textures.clear();
    },
  };
}
