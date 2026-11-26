// 一键补员的人数（与 CrewHire.tsx 的按钮分开放：组件文件只导出组件，保持热更新可用）。
import type { FleetView } from "../../ipc/types";

export interface CrewPlan {
  /** 补到最低人数要招的人数（已按人手与现金封顶；船员够时为 0） */
  toMin: number;
  /** 补满要招的人数（同样封顶） */
  toFull: number;
  /** 还差最低人数多少（不封顶，用来提示） */
  short: number;
  /** 为什么招不满：在海上、这里招不到人手、现金不够 */
  limit: "sea" | "hands" | "cash" | null;
}

/** 按舰队、现金与招募单价算出两种一键补员的人数。 */
export function crewPlan(f: FleetView, cash: number, unit: number): CrewPlan {
  const room = Math.max(0, f.crew_max - f.crew);
  const short = Math.max(0, f.crew_min - f.crew);
  if (f.docked === null) return { toMin: 0, toFull: 0, short, limit: "sea" };
  // 旧后端没有 hire_max：按船员上限算，招不到时由后端报错
  const hands = Math.max(0, Math.min(room, f.hire_max ?? room));
  const afford = unit > 0 ? Math.floor(Math.max(0, cash) / unit) : hands;
  const cap = Math.min(hands, afford);
  const want = short > 0 ? short : room;
  const limit = cap >= want ? null : hands < want ? "hands" : "cash";
  return { toMin: Math.min(cap, short), toFull: cap, short, limit };
}
