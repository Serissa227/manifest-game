// H08 到港的航程总结：靠港那天在海图上方出一张不挡操作的小卡（不是模态窗口），一眼看完、点一下就关；
// 关过的同一程不再出（记在本机）。设置里“到港时显示航程总结”关掉时不出。航线纪录（H07）有数据时才显示那一行。
// H10hF：后端的“上一程”一直留到下一次到港，所以这支舰队又出了港（在海上）时不再出——试玩时从堺出港，海上还挂着“下田→堺 2 天”。
// FIX4F：到港后玩家点开出港（手动航行的罗经盘，或自动航行开始选目的地 / 确认出航）就当作看过了：撤掉并记下，不再回来；
// 记在本机、按这一程的编号（舰队:起日:到日），所以读档后同一程也不重出（1113b 实测：港里再开出港还挂着上一程的卡）。
import { useEffect, useState } from "react";
import { useNavStore } from "../hooks/useNavigation";
import { useVoyageStore } from "../hooks/useVoyage";
import type { ChartSource } from "../hooks/useChartSource";
import { tz } from "../i18n/zhOnly";
import { api } from "../ipc/api";
import { useGame } from "../store/game";
import { nauticalMiles, profitOf } from "./nav/voyageKit";

function closed(id: string): boolean {
  try {
    return localStorage.getItem("manifest.tripSummary") === id;
  } catch {
    return false;
  }
}

/** 记下这一程的总结已经看过（本机存储用不了时只在这一次有效）。 */
function remember(id: string) {
  try {
    localStorage.setItem("manifest.tripSummary", id);
  } catch {
    // 本机存储用不了：只在这一次关掉
  }
}

export default function TripSummaryCard({ source }: { source: ChartSource | null }) {
  const summary = useGame((s) => s.overview?.trip_summary ?? null);
  // 那支舰队现在在不在港里（在海上为 false；舰队没了也不出）
  const docked = useGame((s) => {
    const id = s.overview?.trip_summary?.fleet;
    const f = id === undefined ? undefined : s.overview?.fleets.find((x) => x.id === id);
    return !!f && f.docked !== null;
  });
  const [enabled, setEnabled] = useState(true);
  const [hidden, setHidden] = useState<string | null>(null);
  // 正在出港：手动航行的出港罗经盘开着，或自动航行在选目的地 / 确认出航
  const departing = useNavStore((s) => s.departing);
  const planning = useVoyageStore((s) => s.picking || s.target !== null);
  const summaryId = summary?.id ?? null;
  useEffect(() => {
    if (!summaryId || !(departing || planning)) return;
    remember(summaryId);
    setHidden(summaryId);
  }, [summaryId, departing, planning]);
  useEffect(() => {
    void api.getSettings().then(
      (s) => setEnabled((s.settings as { voyage_summary?: boolean }).voyage_summary !== false),
      () => undefined,
    );
  }, [summary?.id]);
  if (!summary || !docked || !enabled || departing || planning || hidden === summary.id || closed(summary.id)) return null;
  const close = () => {
    remember(summary.id);
    setHidden(summary.id);
  };
  const nm = nauticalMiles(summary.distance, source?.resource?.cell_km);
  const profit = profitOf(summary);
  return (
    <section className="trip-summary" role="status" aria-label={tz("trip.title")} data-testid="trip-summary">
      <header>
        <h4>{summary.from ? tz("trip.route", { from: summary.from, to: summary.to }) : tz("trip.arrived", { to: summary.to })}</h4>
        <button type="button" className="chart-btn" onClick={close} data-testid="trip-summary-close" aria-label={tz("trip.close")}>
          ×
        </button>
      </header>
      <dl>
        <div>
          <dt>{tz("trip.days")}</dt>
          <dd>{tz("trip.daysValue", { n: summary.days })}</dd>
        </div>
        <div>
          <dt>{tz("trip.distance")}</dt>
          <dd>{tz("trip.distanceValue", { nm, avg: Math.round(nm / Math.max(1, summary.days)) })}</dd>
        </div>
        <div>
          <dt>{tz("trip.seen")}</dt>
          <dd>{tz("trip.seenValue", { s: summary.sightings, h: summary.hails, e: summary.shook_off })}</dd>
        </div>
        <div className={summary.hull_lost > 0 || summary.crew_change < 0 ? "loss" : undefined}>
          <dt>{tz("trip.wear")}</dt>
          <dd>{tz("trip.wearValue", { hull: summary.hull_lost, crew: summary.crew_change >= 0 ? `+${summary.crew_change}` : `${summary.crew_change}`, storms: summary.storms })}</dd>
        </div>
        <div className={profit < 0 ? "loss" : "gain"}>
          <dt>{tz("trip.profit")}</dt>
          <dd>{tz("trip.profitValue", { v: profit >= 0 ? `+${profit}` : `${profit}` })}</dd>
        </div>
        {summary.record_days != null && (
          <div className={summary.record_broken || summary.record_first ? "gain" : undefined}>
            <dt>{tz("trip.record")}</dt>
            <dd>
              {summary.record_first
                ? tz("trip.recordFirst", { n: summary.record_days })
                : summary.record_broken
                  ? tz("trip.recordBroken", { n: summary.record_days })
                  : tz("trip.recordValue", { n: summary.record_days })}
            </dd>
          </div>
        )}
        {(summary.agency_fills ?? 0) > 0 && (
          <div className="gain" data-testid="trip-agency">
            <dt>{tz("trip.agency")}</dt>
            <dd>{tz("trip.agencyValue", { n: summary.agency_fills ?? 0 })}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}
