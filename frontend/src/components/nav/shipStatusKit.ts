// H02 船况状态区的读数与命令（组件在 ShipStatus.tsx；分开放，组件文件只导出组件）。
import type { IconName } from "../../art/icons";
import { tz } from "../../i18n/zhOnly";
import type { NavView, StandingOrders, WearView } from "../../ipc/types";
import { useGame } from "../../store/game";

export type Level = "ok" | "caution" | "warn";

export interface Gauge {
  key: string;
  icon: IconName;
  value: string;
  level: Level;
  tip: string;
}

/** 七项读数与各自的告警档（阈值与内核一致：船体 < 30% 进水、< 70% 海上修理；帆缆 < 80 修理；疲劳 60 / 85）。 */
export function gauges(w: WearView): Gauge[] {
  const lv = (warn: boolean, caution: boolean): Level => (warn ? "warn" : caution ? "caution" : "ok");
  return [
    { key: "hull", icon: "shipyard", value: `${w.hull}%`, level: lv(w.hull < 30, w.hull < 70), tip: tz("wear.tip.hull", { v: w.hull }) },
    { key: "rigging", icon: "sail", value: `${w.rigging}`, level: lv(w.rigging < 50, w.rigging < 80), tip: tz("wear.tip.rigging", { v: w.rigging }) },
    { key: "fouling", icon: "anchor", value: `${w.fouling}`, level: lv(w.fouling >= 60, w.fouling >= 30), tip: tz("wear.tip.fouling", { v: w.fouling }) },
    {
      key: "crew",
      icon: "crew",
      value: w.sick > 0 ? `${w.crew}·${w.sick}` : `${w.crew}`,
      level: lv(w.sick * 10 >= w.crew, w.sick > 0),
      tip: w.sick > 0 ? tz("wear.tip.crewSick", { crew: w.crew, sick: w.sick }) : tz("wear.tip.crew", { crew: w.crew }),
    },
    {
      key: "fatigue",
      icon: "clock",
      value: `${w.fatigue}`,
      level: lv(w.fatigue >= w.exhausted, w.fatigue >= w.tired),
      tip: tz("wear.tip.fatigue", { v: w.fatigue, tired: w.tired, exhausted: w.exhausted }),
    },
    {
      key: "fresh",
      icon: "food",
      value: `${w.fresh_days}`,
      level: lv(w.fresh_days > w.scurvy_after, w.fresh_days + 10 > w.scurvy_after),
      tip: tz("wear.tip.fresh", { n: w.fresh_days, after: w.scurvy_after }),
    },
    {
      key: "timber",
      icon: "build",
      value: `${w.timber}`,
      level: lv(false, w.timber === 0),
      tip: tz("wear.tip.timber", { n: w.timber, cap: w.timber_cap }),
    },
  ];
}

/** 按比例抛货（从最不值钱的货抛起）。 */
export async function sendJettison(fleet: number, pct: number): Promise<boolean> {
  const r = await useGame.getState().submit({ Voyage: { owner: "player", fleet, order: { jettison_share: { pct } } } });
  return !!r;
}

/** 提交常设命令（改一项，其余照旧）。 */
export async function sendOrders(fleet: number, orders: StandingOrders): Promise<boolean> {
  const r = await useGame.getState().submit({ Voyage: { owner: "player", fleet, order: { set_orders: orders } } });
  return !!r;
}

/** 粮水低于提醒天数时该不该暂停（每天最多一次，由调用处记日子）。 */
export function supplyAlertDue(nav: NavView): boolean {
  // FIX5F 第二趟：自动航行中由内核按警戒线停一次（停因 supplies_low，wear.alert_by_pilot 为真）时，前端不再每天自己停
  if (nav.wear?.alert_by_pilot) return false;
  const alert = nav.wear?.orders.supply_alert ?? 7;
  return !!nav.wear && alert > 0 && nav.supplies_days !== null && nav.supplies_days < alert;
}

/**
 * FIX6F：答应船员靠港的那句。`promise_until` 是内部的日序号，不给玩家看；后端给了日历日期（`promise_date`）就写“M 月 D 日前”，
 * 跨年（日期的年份不是今年）时带年份；没有日期（旧后端）只写“尽快靠港”。没有承诺时为 null。
 */
export function promiseNote(wear: Pick<WearView, "promise_until" | "promise_date">, year: number | null): string | null {
  if (wear.promise_until === null && !wear.promise_date) return null;
  const date = wear.promise_date;
  if (!date) return tz("wear.note.promiseBare");
  const [y, m, d] = date;
  return year !== null && y !== year ? tz("wear.note.promiseDateYear", { y, m, d }) : tz("wear.note.promiseDate", { m, d });
}
