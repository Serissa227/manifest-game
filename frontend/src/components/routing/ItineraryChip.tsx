// H07 多站行程的下一站：舰队靠了港、行程里还有没去的站时，在舞台上方给一枚小卡“行程下一站：X · 继续行程 / 不去了”。
// 继续＝从港里直接发自动领航（内核的 Autopilot 在港时就是出港 + 领航），偏好沿用出发时选的。
// 不弹窗、不暂停：在港里买卖、补给完了再点。
// FIX5F：在港里问一次这一站的航线预览（route_plan）；预计天数大于粮水够用的天数（或预览说还差粮水）时写明，
// 主按钮换成“先去补给”（打开舰队页的购买补给），“继续行程”退成次要的“照样出发”。问不到预览时照旧。
import { useEffect, useState } from "react";
import { navCommand } from "../../ipc/api";
import { routingApi } from "../../ipc/routing";
import { nowNavMinute } from "../../hooks/useNavigation";
import { tz } from "../../i18n/zhOnly";
import { useGame } from "../../store/game";
import { legOver, legOverText, supplyDays } from "../panels/supplyKit";
import { openPanel } from "../tutorial/panelSpots";
import { useRouteStore } from "./routeStore";
import { routeText, supplyShort } from "./routeText";

export default function ItineraryChip() {
  const itinerary = useRouteStore((s) => s.itinerary);
  const fleet = useGame((s) => (itinerary ? s.overview?.fleets.find((f) => f.id === itinerary.fleet) : undefined));
  const names = useGame((s) => s.statics?.locations);
  const day = useGame((s) => s.overview?.day ?? 0);
  const next = itinerary?.stops[0];
  const docked = fleet?.docked ?? null;
  const fleetId = fleet?.id ?? null;
  const pref = itinerary?.pref ?? null;
  // 这一站的天数与还差的粮水（只在港里、有下一站时问）
  const [leg, setLeg] = useState<{ key: string; days: number; short: boolean } | null>(null);
  const key = fleetId !== null && docked !== null && next !== undefined ? `${fleetId}|${docked}|${next}|${pref ?? ""}|${day}` : null;
  useEffect(() => {
    if (key === null || fleetId === null || next === undefined) return;
    let alive = true;
    routingApi
      .routePlan(fleetId, [next], pref)
      .then((p) => {
        if (alive) setLeg({ key, days: p.days, short: supplyShort(p) });
      })
      .catch(() => {
        if (alive) setLeg(null);
      });
    return () => {
      alive = false;
    };
  }, [key, fleetId, next, pref]);
  if (!itinerary) return null;
  // 舰队没了（卖掉、沉了）：行程作废
  if (!fleet) return null;
  // 还在海上：等靠港
  if (fleet.docked === null) return null;
  if (next === undefined) return null;
  const name = names?.find((l) => l.id === next)?.name ?? "";
  const have = supplyDays(fleet);
  const shown = leg && leg.key === key ? leg : null;
  const over = !!shown && legOver(shown.days, have);
  const gate = !!shown && (over || shown.short);
  const drop = () => useRouteStore.setState({ itinerary: null });
  const go = async () => {
    const cmd = navCommand.autopilot(itinerary.fleet, next, nowNavMinute(), false, itinerary.pref ?? undefined);
    const ok = await useGame.getState().submit(cmd);
    if (!ok) return;
    const rest = itinerary.stops.slice(1);
    useRouteStore.setState({ itinerary: rest.length > 0 ? { ...itinerary, stops: rest } : null });
  };
  return (
    <div className={gate ? "route-itinerary is-short" : "route-itinerary"} role="status" data-testid="route-itinerary">
      <span>{routeText.nextStop(name)}</span>
      {gate && shown && (
        <span className="route-itinerary-short" data-testid="route-itinerary-short">
          {over && have !== null ? legOverText(shown.days, have) : routeText.short()}
        </span>
      )}
      {gate && (
        <button type="button" className="chart-btn primary" data-testid="route-supply" onClick={() => openPanel("supply")}>
          {tz("sup.goSupply")}
        </button>
      )}
      <button type="button" className={gate ? "chart-btn" : "chart-btn primary"} data-testid="route-continue" onClick={() => void go()}>
        {gate ? tz("sup.sailAnyway") : routeText.continue()}
      </button>
      <button type="button" className="chart-btn" onClick={drop}>
        {routeText.dropItinerary()}
      </button>
    </div>
  );
}
