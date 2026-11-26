// 航海图的后台线程：按季节生成整张海图、增量重画迷雾（经典世界的整张文本，或大地图的位图与区间）、切航行视图的瓦片，
// 把 RGBA 字节转交（transfer）回主线程。整图与迷雾的回复带上这里持有的字节（主线程记进内存账本，map/memory.ts）。
// 由 chartJobs.ts 创建；出错时回复 error，主线程随即改用自己的后备实现。
import { ChartWorkState, type ChartRequest, type ChartResponse } from "./chartWork";

/** 后台线程的全局对象（项目的 TypeScript 配置只带 DOM 类型，这里只声明用到的部分）。 */
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<ChartRequest>) => void) | null;
  postMessage: (message: ChartResponse, transfer: Transferable[]) => void;
};

let state: ChartWorkState | null = null;

scope.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.kind === "init") {
      state = new ChartWorkState(m.input, m.scale ?? 1);
      return;
    }
    if (!state) throw new Error("chart worker: missing input");
    if (m.kind === "chart") {
      const img = state.chart(m.season);
      scope.postMessage({ kind: "chart", season: m.season, img, held: state.heldBytes() }, [img.data.buffer]);
    } else if (m.kind === "fog") {
      const img = state.fogUpdate(m.rows);
      scope.postMessage({ kind: "fog", img, cells: state.fog.lastCells, held: state.heldBytes() }, img ? [img.data.buffer] : []);
    } else if (m.kind === "fogSync" || m.kind === "fogRuns") {
      // 大地图的迷雾：位图（全量）或区间（增量），变化的几块各自转交
      const parts = m.kind === "fogSync" ? state.fogSync(m.bits) : state.fogRuns(m.runs);
      scope.postMessage({ kind: "fogParts", parts, held: state.heldBytes() }, parts.map((p) => p.img.data.buffer));
    } else if (m.kind === "fogFull") {
      const img = state.fogFull();
      scope.postMessage({ kind: "fog", img, cells: img ? "all" : null, full: true }, img ? [img.data.buffer] : []);
    } else if (m.kind === "tile") {
      const img = state.tile(m.season, m.tx, m.ty);
      scope.postMessage({ kind: "tile", season: m.season, tx: m.tx, ty: m.ty, img }, [img.data.buffer]);
    } else if (m.kind === "detail") {
      const img = state.detailTile(m.season, m.tx, m.ty);
      scope.postMessage({ kind: "detail", season: m.season, tx: m.tx, ty: m.ty, img }, img ? [img.data.buffer] : []);
    } else if (m.kind === "hdFog") {
      const img = state.hdFogTile(m.tx, m.ty, m.k);
      scope.postMessage({ kind: "hdFog", tx: m.tx, ty: m.ty, k: m.k, img }, img ? [img.data.buffer] : []);
    } else if (m.kind === "fogTile") {
      const img = state.fogTile(m.tx, m.ty);
      scope.postMessage({ kind: "fogTile", tx: m.tx, ty: m.ty, img }, img ? [img.data.buffer] : []);
    }
  } catch (err) {
    scope.postMessage({ kind: "error", message: err instanceof Error ? err.message : String(err) }, []);
  }
};
