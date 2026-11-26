// 在港时任务的“去”（R10-Q02）：舞台上方一张小卡，就是航线预览（天数、粮水够不够、沿途风险、寻路偏好），目的地已经填好；
// 航海图上同时画出这条航线（白色点线）。“启航”从港里直接发自动领航（内核的 Autopilot 在港时就是出港 + 领航，与多站行程的“继续”一样），
// 下令时总带上寻路偏好（没有领航员时是“按距离”），内核据此记“规划航线”（R10-Q01 契约 3 的 plan_route）。
// 离港、换了目的地、点“先不去”就收起。海上的“去”不走这里：直接打开世界海图的航线规划（RoutePlanner）。
import { useEffect, useRef, useState } from "react";
import { nowNavMinute } from "../../hooks/useNavigation";
import { useVoyageStore } from "../../hooks/useVoyage";
import { tz } from "../../i18n/zhOnly";
import { errorText, navCommand } from "../../ipc/api";
import { routingApi, type RoutePlanView, type RoutePref } from "../../ipc/routing";
import { flagship, useGame } from "../../store/game";
import { RoutePlanBody } from "../routing/RoutePlanner";
import { joinPaths } from "../routing/routeStore";
import { supplyShort } from "../routing/routeText";
import { legOver, supplyDays } from "../panels/supplyKit";
import { openPanel } from "../tutorial/panelSpots";
import { useQuestUi } from "./questGo";

/** 由这张卡交给航海图的航线（只清自己画的那一条）。 */
let ownPlan: object | null = null;

function drawPlan(plan: RoutePlanView | null) {
  if (!plan || plan.legs.length === 0) {
    if (ownPlan && useVoyageStore.getState().plan === ownPlan) useVoyageStore.setState({ plan: null });
    ownPlan = null;
    return;
  }
  const last = plan.legs[plan.legs.length - 1];
  const next = { dest: last.dest, path: joinPaths(plan.legs.map((l) => l.path)) };
  ownPlan = next;
  useVoyageStore.setState({ plan: next });
}

export default function QuestRoute() {
  const route = useQuestUi((s) => s.route);
  const fleet = useGame((s) => flagship(s.overview));
  const fleetId = fleet?.id ?? null;
  const docked = fleet?.docked ?? null;
  const day = useGame((s) => s.overview?.day ?? 0);
  const [pref, setPref] = useState<RoutePref | null>(null);
  const [plan, setPlan] = useState<RoutePlanView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const dest = route?.dest ?? null;
  // 不在港了（出了港、或在海上）、或已经在目的地：收起
  const live = dest !== null && fleetId !== null && docked !== null && docked !== dest;

  useEffect(() => {
    if (!live || dest === null || fleetId === null) {
      setPlan(null);
      drawPlan(null);
      return;
    }
    const mine = ++seq.current;
    setError(null);
    routingApi
      .routePlan(fleetId, [dest], pref)
      .then((p) => {
        if (mine !== seq.current) return;
        setPlan(p);
        drawPlan(p);
      })
      .catch((e) => {
        if (mine !== seq.current) return;
        setPlan(null);
        drawPlan(null);
        setError(errorText(e));
      });
  }, [live, dest, fleetId, pref, day]);
  useEffect(() => () => drawPlan(null), []);
  // 离了港就把小卡收掉（下次再点“去”）
  useEffect(() => {
    if (route && docked === null) useQuestUi.setState({ route: null });
  }, [route, docked]);

  if (!route || !live) return null;
  const close = () => {
    drawPlan(null);
    useQuestUi.setState({ route: null });
  };
  const first = plan?.legs[0];
  // FIX5F：在港里定下的这一程比粮水撑得久（或预览说还差粮水）：主按钮换成“先去补给”，“启航”退成次要的“照样出发”
  const have = fleet ? supplyDays(fleet) : null;
  const gate = !!plan && (legOver(plan.days, have) || supplyShort(plan));
  const go = async () => {
    if (!plan || !first || fleetId === null) return;
    setBusy(true);
    const r = await useGame.getState().submit(navCommand.autopilot(fleetId, first.dest, nowNavMinute(), first.edge, plan.pref));
    setBusy(false);
    if (r) close();
  };
  return (
    <section className="route-planner quest-route" aria-label={tz("quest.route.title", { place: route.name })} data-testid="quest-route">
      <h4>{tz("quest.route.title", { place: route.name || first?.name || "" })}</h4>
      {plan ? (
        <RoutePlanBody plan={plan} have={have} atSea={false} onPref={setPref} />
      ) : error ? (
        <p className="route-warn" role="alert">
          {tz("quest.route.failed", { place: route.name, why: error })}
        </p>
      ) : (
        <p className="route-note">{tz("quest.route.loading")}</p>
      )}
      <div className="route-actions">
        {first && gate && (
          <button type="button" className="chart-btn primary" data-testid="quest-route-supply" onClick={() => openPanel("supply")}>
            {tz("sup.goSupply")}
          </button>
        )}
        {first && (
          <button type="button" className={gate ? "chart-btn" : "chart-btn primary"} data-testid="quest-route-go" disabled={busy} onClick={() => void go()}>
            {gate ? tz("sup.sailAnyway") : tz("quest.route.go", { place: first.name || route.name })}
          </button>
        )}
        <button type="button" className="chart-btn" onClick={close}>
          {tz("quest.route.cancel")}
        </button>
      </div>
    </section>
  );
}
