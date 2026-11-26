// H08 航海日志、航程总结与一句话提示的纯函数（组件文件只导出组件，热更新才正常）。
import { tk } from "../../i18n";
import { tz } from "../../i18n/zhOnly";
import type { NavView, Overview } from "../../ipc/types";

type Journal = NonNullable<NavView["journal"]>;
type Summary = NonNullable<Overview["trip_summary"]>;

/** 日志一条的文字（与情报窗口的事件日志同一张字符串表；“玩家”写成“你”）。 */
export function journalText(e: Journal["entries"][number]): string {
  // 后端已出好句子时直接用（S02nZ2）
  if (e.text) return e.text;
  const vars: Record<string, string> = {};
  for (const [k, v] of e.args) vars[k] = k === "owner" && v === "player" ? tz("journal.me") : v;
  return tk(`log.${e.kind}`, vars);
}

/** 新系统第一次出现时的提示：按顺序。 */
export const HINTS = ["cells", "sails", "sightings", "hail", "journal"] as const;
export type Hint = (typeof HINTS)[number];

/** 这一刻该提示哪一样（按顺序取第一样眼下有、还没提示过的）。 */
export function pendingHint(nav: NavView, isSeen: (h: Hint) => boolean): Hint | null {
  const present: Record<Hint, boolean> = {
    cells: (nav.cells ?? []).length > 0,
    sails: (nav.ships ?? []).length > 0,
    sightings: (nav.sightings?.marks ?? []).length > 0,
    hail: (nav.ships ?? []).some((s) => s.hail),
    journal: !!nav.journal,
  };
  return HINTS.find((h) => present[h] && !isSeen(h)) ?? null;
}

/** 里程（海里）：格数 × 每格公里 ÷ 1.852；没有地图资源时按每格 37 公里。 */
export function nauticalMiles(cells: number, cellKm: number | undefined): number {
  return Math.round((cells * (cellKm ?? 37)) / 1.852);
}

/** 盈亏：途中现金与货值的增减合计。 */
export function profitOf(s: Pick<Summary, "cash_change" | "cargo_change">): number {
  return s.cash_change + s.cargo_change;
}
