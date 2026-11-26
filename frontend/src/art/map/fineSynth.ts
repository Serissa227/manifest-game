// 合成的细图层——只用于测试与美术预览，不进数据、不被游戏界面引用（真实的细图层由后端的 map_fine 下发）。
// 给一张合成世界（synth.ts）的海图输入配上细海岸、细高程与细河流：海岸在粗格的海陆上按平滑噪声参差，
// 但照“骨架”的意思保住每个可航行粗格的格心与上下左右相邻可航行格之间的水道；陆格里也留出一些水（海湾），
// 好让“粗格是陆、细层是水”的浅滩画法有地方出现。确定性：同样的输入同样的结果。
import { FINE_LAKE, FINE_LAND, FINE_SEA, fineCoastFromRaster, type FineLayers, type FineRiver } from "./fine";
import { vnoise } from "./noise";
import { DETAIL_CELL, type ChartInput } from "./types";

/** 每粗格的高程样本数（与真实数据相同：4 × 4）。 */
const ELEV_PER = 4;

/** 给一张海图输入合成细图层。hash 取自尺寸与种子（测试里当缓存键用）。 */
export function synthFine(input: ChartInput, seed = 11): FineLayers {
  const W = Math.max(1, input.width);
  const H = Math.max(1, input.height);
  const S = DETAIL_CELL;
  const FW = W * S;
  const FH = H * S;
  const wrap = input.wrapX === true;
  const landAt = (x: number, y: number) => {
    const yy = y < 0 ? 0 : y >= H ? H - 1 : y;
    const xx = wrap ? ((x % W) + W) % W : x < 0 ? 0 : x >= W ? W - 1 : x;
    return (input.rows[yy] ?? "")[xx] === "#";
  };
  const raster = new Uint8Array(FW * FH);
  for (let fy = 0; fy < FH; fy++) {
    for (let fx = 0; fx < FW; fx++) {
      // 在挪了几个细格的位置上取粗格的海陆：海岸不沿格线走
      const qx = fx + (vnoise(fx / 9, fy / 9, seed) - 0.5) * 16;
      const qy = fy + (vnoise(fx / 9, fy / 9, seed + 1) - 0.5) * 16;
      let land = landAt(Math.floor(qx / S), Math.floor(qy / S));
      const cx = Math.floor(fx / S);
      const cy = Math.floor(fy / S);
      const ix = fx - cx * S;
      const iy = fy - cy * S;
      if (!landAt(cx, cy)) {
        // 可航行格：格心的圆，与通往上下左右可航行邻格的水道必是水
        const dx = ix + 0.5 - S / 2;
        const dy = iy + 0.5 - S / 2;
        const midX = ix >= S / 2 - 3 && ix < S / 2 + 3;
        const midY = iy >= S / 2 - 3 && iy < S / 2 + 3;
        if (dx * dx + dy * dy <= 16) land = false;
        else if (midY && ((ix < S / 2 && !landAt(cx - 1, cy)) || (ix >= S / 2 && !landAt(cx + 1, cy)))) land = false;
        else if (midX && ((iy < S / 2 && !landAt(cx, cy - 1)) || (iy >= S / 2 && !landAt(cx, cy + 1)))) land = false;
      }
      raster[fy * FW + fx] = land ? FINE_LAND : FINE_SEA;
    }
  }
  // 一座湖：第一个四周都是陆的陆格中央
  for (let cy = 1; cy < H - 1; cy++) {
    let done = false;
    for (let cx = 1; cx < W - 1 && !done; cx++) {
      let inland = true;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!landAt(cx + dx, cy + dy)) inland = false;
      if (!inland) continue;
      for (let iy = 6; iy < 18; iy++) for (let ix = 5; ix < 19; ix++) raster[(cy * S + iy) * FW + cx * S + ix] = FINE_LAKE;
      done = true;
    }
    if (done) break;
  }
  // 高程：陆格按高程图层（0–9）给几百到几千米，海格浅海 −60 米、深海 −2500 米，再加一点起伏
  const elevW = W * ELEV_PER;
  const elevH = H * ELEV_PER;
  const elevation = new Int16Array(elevW * elevH);
  for (let ey = 0; ey < elevH; ey++) {
    const cy = Math.floor(ey / ELEV_PER);
    for (let ex = 0; ex < elevW; ex++) {
      const cx = Math.floor(ex / ELEV_PER);
      const ch = (input.rows[cy] ?? "")[cx];
      const n = vnoise(ex / 5, ey / 5, seed + 2);
      if (ch === "#") {
        const r = Number((input.relief?.[cy] ?? "")[cx] ?? "1") || 0;
        elevation[ey * elevW + ex] = Math.round(40 + r * 320 + n * 180);
      } else elevation[ey * elevW + ex] = Math.round(ch === "-" ? -30 - n * 120 : -1800 - n * 2400);
    }
  }
  // 河：海图输入里的河（格坐标折线）照格心连成细河流，头一条算大河
  const rivers: FineRiver[] = (input.rivers ?? []).map((r, k) => {
    const pts = new Int32Array(r.path.length * 2);
    r.path.forEach(([x, y], i) => {
      pts[i * 2] = x * S + S / 2;
      pts[i * 2 + 1] = y * S + S / 2;
    });
    return { rank: k === 0 ? 1 : 6, pts };
  });
  return { hash: `synth-${W}x${H}-${seed}`, ...fineCoastFromRaster(W, H, S, raster), elevW, elevH, elevPer: ELEV_PER, elevation, rivers };
}
