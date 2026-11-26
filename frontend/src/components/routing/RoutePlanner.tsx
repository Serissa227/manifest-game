// H07 航线预览：世界图上点了目的地（手动航行、旗舰队在海上）后，画出航线、写预计天数、粮水对比（不够标红）与当季风险；
// 有领航员时可选寻路偏好（按距离 / 最快 / 稳妥 / 沿岸）；可以把点选的地点加为经停点，排成多站行程。
// 数都由后端算（route_plan），这里只画：航线交给航海图的“待确认航线”（useVoyageStore.plan，白色点线）。
// 出发时只驶往第一站，剩下的各站记在 routeStore 的 itinerary 里：靠港后由 ItineraryChip 问要不要继续。
import { useEffect, useRef, useState } from "react";
import { autopilotTo, useNavStore } from "../../hooks/useNavigation";
import { useVoyageStore } from "../../hooks/useVoyage";
import { routingApi, type RoutePlanView, type RoutePref } from "../../ipc/routing";
import type { NavView } from "../../ipc/types";
import { useGame } from "../../store/game";
import { clearStops, joinPaths, plannedStops, useRouteStore } from "./routeStore";
import { hazardText, routeText, supplyShort } from "./routeText";
import { legOver, legOverText } from "../panels/supplyKit";

/** 由这个组件交给航海图的规划航线（只清自己画的那一条，不碰出航确认框的）。 */
let ownPlan: object | null = null;

function drawPlan(plan: RoutePlanView | null) {
  const last = plan?.legs[plan.legs.length - 1];
  if (useRouteStore.getState().shown !== !!plan) useRouteStore.setState({ shown: !!plan });
  if (!plan || !last) {
    if (ownPlan && useVoyageStore.getState().plan === ownPlan) useVoyageStore.setState({ plan: null });
    ownPlan = null;
    return;
  }
  const next = { dest: last.dest, path: joinPaths(plan.legs.map((l) => l.path)) };
  ownPlan = next;
  useVoyageStore.setState({ plan: next });
}

/** 预览的正文（纯展示，测试直接渲染它）。 */
export function RoutePlanBody({ plan, onPref, have = null, atSea = true }: { plan: RoutePlanView; onPref: (p: RoutePref) => void; have?: number | null; atSea?: boolean }) {
  const short = supplyShort(plan);
  // FIX5F：全程天数大于粮水够用的天数（have：航行视图的 supplies_days）时写明，海上只提醒、不拦
  const over = legOver(plan.days, have);
  return (
    <div className="route-plan-body" data-testid="route-plan">
      {plan.prefs.length > 1 ? (
        <div className="route-prefs" role="radiogroup" aria-label={routeText.prefGroup()}>
          {plan.prefs.map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={plan.pref === p}
              className={plan.pref === p ? "route-pref active" : "route-pref"}
              title={routeText.prefTip(p)}
              data-testid={`route-pref-${p}`}
              onClick={() => onPref(p)}
            >
              {routeText.pref(p)}
            </button>
          ))}
        </div>
      ) : (
        <p className="route-note" data-testid="route-no-navigator">
          {routeText.noNavigator()}
        </p>
      )}
      <ol className="route-legs">
        {plan.legs.map((l, i) => (
          <li key={i} className="route-leg">
            <span>{routeText.leg(i, l.name)}</span>
            <small>
              {l.edge ? routeText.legEdge() : routeText.legDays(l.days)}
              {l.from !== null && !l.edge && ` · ${l.record ? routeText.record(l.record.days) : routeText.firstVoyage()}`}
            </small>
          </li>
        ))}
      </ol>
      {plan.failed && (
        <p className="route-warn" role="alert">
          {routeText.failed(plan.failed.stop, plan.failed.message)}
        </p>
      )}
      <p className="route-total" data-testid="route-total">
        {routeText.total(plan.days)}
      </p>
      <p className={short ? "route-supply short" : "route-supply"} data-testid="route-supply">
        <span className={plan.short.food > 0 ? "route-short" : undefined}>{routeText.food(plan.have.food, plan.required.food)}</span>
        {" · "}
        <span className={plan.short.water > 0 ? "route-short" : undefined}>{routeText.water(plan.have.water, plan.required.water)}</span>
        {short && <strong className="route-short"> {routeText.short()}</strong>}
      </p>
      {over && have !== null && (
        <p className="route-warn route-leg-over" role="note" data-testid="route-leg-over">
          {legOverText(plan.days, have, atSea)}
        </p>
      )}
      {plan.hazards.length > 0 && (
        <ul className="route-hazards" data-testid="route-hazards">
          {plan.hazards.map((h, i) => (
            <li key={i} className={`route-hazard route-hazard-${h.kind}`}>
              {hazardText(h)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 世界图提示条里的航线预览（NavigationView 的 WorldBar 在有点选、或排了经停点时挂它）。 */
export default function RoutePlanner({ nav }: { nav: NavView }) {
  const pick = useNavStore((s) => s.pick);
  const stops = useRouteStore((s) => s.stops);
  const pref = useRouteStore((s) => s.pref);
  const names = useGame((s) => s.statics?.locations);
  const [plan, setPlan] = useState<RoutePlanView | null>(null);
  const [loading, setLoading] = useState(false);
  const want = plannedStops(stops, pick);
  const key = `${nav.fleet}|${want.join(",")}|${pref ?? ""}|${nav.day}`;
  const seq = useRef(0);

  useEffect(() => {
    const dests = key.split("|")[1];
    const list = dests ? dests.split(",").map(Number) : [];
    if (list.length === 0) {
      setPlan(null);
      drawPlan(null);
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    routingApi
      .routePlan(nav.fleet, list, pref)
      .then((p) => {
        if (mine !== seq.current) return;
        setPlan(p);
        drawPlan(p);
      })
      .catch(() => {
        if (mine !== seq.current) return;
        setPlan(null);
        drawPlan(null);
      })
      .finally(() => {
        if (mine === seq.current) setLoading(false);
      });
    // key 里含着舰队、各站、偏好与日期
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  // 收起（离开世界图、靠港）时把画上去的航线擦掉；还在路上的航线预览回来也不再画（H10hF：靠港那一刻回来的预览会把上一程的航线留在海图上）
  useEffect(
    () => () => {
      seq.current++;
      drawPlan(null);
    },
    [],
  );

  if (want.length === 0 || !plan) return null;
  const first = plan.legs[0];
  const nameOf = (id: number) => names?.find((l) => l.id === id)?.name ?? "";
  const close = () => {
    clearStops();
    useNavStore.setState({ pick: null });
  };
  const go = async () => {
    if (!first) return;
    const rest = want.slice(1);
    // R10-Q02：从航线规划下令时总带上寻路偏好（没有领航员时就是“按距离”）——内核据此记“规划航线”（R10-Q01 契约 3 的 plan_route）
    const ok = await autopilotTo(first.dest, first.edge, plan.pref);
    if (!ok) return;
    // H10hF：出发了就收起这张预览（点选清掉；原来点选留着，预览卡与航线一直挂到靠港）
    useNavStore.setState({ pick: null });
    useRouteStore.setState({
      stops: [],
      itinerary: rest.length > 0 && !first.edge ? { fleet: nav.fleet, stops: rest, pref: plan.tier === "timed" ? plan.pref : null } : null,
    });
  };
  return (
    <section className="route-planner" aria-label={routeText.title()} data-testid="route-planner">
      <h4>{routeText.title()}</h4>
      {stops.length > 0 && <p className="route-note">{routeText.stopsNote(stops.map(nameOf).join(" → "))}</p>}
      <RoutePlanBody plan={plan} have={nav.supplies_days} onPref={(p) => useRouteStore.setState({ pref: p })} />
      {loading && <p className="route-note">{routeText.loading()}</p>}
      <div className="route-actions">
        {first && (
          <button type="button" className="chart-btn primary" data-testid="route-go" disabled={loading} onClick={() => void go()}>
            {want.length > 1 ? routeText.goVia(first.name, want.length) : routeText.go(first.name)}
          </button>
        )}
        {pick !== null && stops[stops.length - 1] !== pick && (
          <button
            type="button"
            className="chart-btn"
            title={routeText.addStopTip()}
            data-testid="route-add-stop"
            onClick={() => {
              useRouteStore.setState({ stops: [...stops, pick] });
              useNavStore.setState({ pick: null });
            }}
          >
            {routeText.addStop()}
          </button>
        )}
        {pick === null && stops.length > 0 && <span className="route-note">{routeText.pickNext()}</span>}
        <button type="button" className="chart-btn" data-testid="route-cancel" onClick={close}>
          {stops.length > 0 ? routeText.clear() : routeText.cancel()}
        </button>
      </div>
    </section>
  );
}
