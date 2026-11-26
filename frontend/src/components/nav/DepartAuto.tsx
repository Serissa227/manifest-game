// FIX5F 第二趟：寰宇出港框的第二种出港方式“自动驶往”——挑一处目的地，确认即出港并设好自动航行（一条 Autopilot 命令，
// 内核在港时就是出港 + 领航）。目的地清单用 H10b 的按需清单（navigation_dests，与航行视图的 known_dests 同一个算法）；
// 问不到（旧后端没有这条命令）时退回看见过的港口，天数在选中以后用航线预览（route_plan）现估。
// 这一程的天数大于粮水够用的天数（每项带 supplies_days 时用它，否则用舰队的）：主按钮换成“先去补给”，“驶往”退成次要的“照样出发”。
// 被拒时把内核给的原因就地写出来（提示条照常也报），船还在港里，不会悬着。
import { useEffect, useMemo, useState } from "react";
import { t } from "../../i18n";
import { tz } from "../../i18n/zhOnly";
import { navApi } from "../../ipc/api";
import { routingApi } from "../../ipc/routing";
import type { FleetView, NavDest } from "../../ipc/types";
import { departAuto, useNavStore } from "../../hooks/useNavigation";
import { useGame } from "../../store/game";
import { InlineError } from "../feedback";
import { legOver, legOverText, supplyDays } from "../panels/supplyKit";
import { supplyShort } from "../routing/routeText";
import { openPanel } from "../tutorial/panelSpots";

/** 目的地清单：按需清单（guess 为 false）或退回的看见过的港口（guess 为 true，天数要选了再估）。 */
interface DestList {
  dests: NavDest[];
  guess: boolean;
}

function useDests(fleet: FleetView): DestList | null | undefined {
  const statics = useGame((s) => s.statics);
  const sighted = useGame((s) => s.overview?.sighted);
  const [list, setList] = useState<DestList | null | undefined>(undefined);
  const here = fleet.docked;
  // 退回的清单：看见过的港口（不含所在的这一座）
  const fallback = useMemo<NavDest[]>(
    () =>
      (statics?.locations ?? [])
        .filter((l) => l.kind === "port" && l.id !== here && (!sighted || sighted.includes(l.id)))
        .map((l) => ({ loc: l.id, name: l.name, days: null }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [statics, sighted, here],
  );
  useEffect(() => {
    let alive = true;
    setList(undefined);
    navApi
      .navigationDests(fleet.id)
      .then((v) => {
        if (alive) setList(v ? { dests: v.dests.filter((d) => d.loc !== here), guess: false } : { dests: fallback, guess: true });
      })
      .catch(() => {
        if (alive) setList({ dests: fallback, guess: true });
      });
    return () => {
      alive = false;
    };
  }, [fleet.id, here, fallback]);
  return list;
}

/** 选中的那一处：天数（按需清单里有就用，退回的清单现问航线预览）与预览说的缺口。 */
function useLeg(fleetId: number, dest: NavDest | null, guess: boolean): { days: number | null; short: boolean; loading: boolean } {
  const [leg, setLeg] = useState<{ loc: number; days: number | null; short: boolean } | null>(null);
  const need = !!dest && guess;
  useEffect(() => {
    if (!need || !dest) return;
    let alive = true;
    routingApi
      .routePlan(fleetId, [dest.loc], null)
      .then((p) => alive && setLeg({ loc: dest.loc, days: p.legs[0]?.edge ? null : p.days, short: supplyShort(p) }))
      .catch(() => alive && setLeg({ loc: dest.loc, days: null, short: false }));
    return () => {
      alive = false;
    };
  }, [need, dest, fleetId]);
  if (!dest) return { days: null, short: false, loading: false };
  if (!guess) return { days: dest.days, short: false, loading: false };
  const got = leg && leg.loc === dest.loc ? leg : null;
  return { days: got?.days ?? null, short: got?.short ?? false, loading: !got };
}

export default function DepartAuto({ fleet, onCancel }: { fleet: FleetView; onCancel: () => void }) {
  const busy = useNavStore((s) => s.busy);
  const list = useDests(fleet);
  const [pick, setPick] = useState<number | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const dest = list?.dests.find((d) => d.loc === pick) ?? null;
  const leg = useLeg(fleet.id, dest, list?.guess ?? false);
  // 够用天数：清单那一项带了 supplies_days 就用它（后端在补），否则用舰队的
  const have = dest && dest.supplies_days !== undefined ? dest.supplies_days : supplyDays(fleet);
  const over = !!dest && legOver(leg.days, have);
  const gate = !!dest && (over || leg.short);
  const edge = !!dest && (dest.edge ?? (!list?.guess && dest.days === null));
  const go = async () => {
    if (!dest) return;
    setFailed(null);
    const why = await departAuto(dest.loc, edge);
    if (why !== null) setFailed(why);
  };
  const goSupply = () => {
    onCancel();
    openPanel("supply");
  };
  return (
    <>
      <div className="chart-dialog-body nav-depart-auto" data-testid="nav-depart-auto">
        <p className="chart-note">{tz("depart.autoHint")}</p>
        {list === undefined && <p className="chart-note">{tz("depart.autoLoading")}</p>}
        {list && list.dests.length === 0 && <p className="chart-note">{t("nav.autopilotNone")}</p>}
        {list && list.dests.length > 0 && (
          <div className="nav-depart-dests" role="radiogroup" aria-label={tz("depart.modeAuto")}>
            {list.dests.map((d) => {
              const itemHave = d.supplies_days !== undefined ? d.supplies_days : supplyDays(fleet);
              const short = !list.guess && legOver(d.days, itemHave);
              // R10-FIX8：这支舰队去不了的港（名船的禁港、王国的进港限制）事先灰着，写出与真去时被拒的同一句
              const blocked = d.blocked?.text ?? null;
              return (
                <button
                  key={d.loc}
                  type="button"
                  role="radio"
                  aria-checked={pick === d.loc}
                  aria-disabled={blocked ? true : undefined}
                  disabled={!!blocked}
                  title={blocked ?? undefined}
                  className={["nav-depart-dest", pick === d.loc ? "is-on" : "", short ? "is-short" : "", blocked ? "is-blocked" : ""].filter(Boolean).join(" ")}
                  data-testid={`nav-depart-dest-${d.loc}`}
                  onClick={() => {
                    setPick(d.loc);
                    setFailed(null);
                  }}
                >
                  <span>{d.days === null && !list.guess ? t("nav.autopilotEdge", { name: d.name }) : d.name}</span>
                  {d.days !== null && <small>{t("nav.autopilotDays", { n: d.days })}</small>}
                  {short && !blocked && <small className="nav-dest-short">{tz("sup.legOverItem", { have: itemHave ?? 0 })}</small>}
                  {blocked && <small className="nav-dest-blocked">{blocked}</small>}
                </button>
              );
            })}
          </div>
        )}
        {list?.guess && <p className="chart-note">{tz("depart.autoGuess")}</p>}
        {dest && list?.guess && (
          <p className="chart-note" data-testid="nav-depart-leg">
            {leg.loading ? tz("depart.autoLoadingOne") : leg.days !== null ? t("nav.autopilotDays", { n: leg.days }) : tz("depart.autoEdge")}
          </p>
        )}
        <p className={gate ? "chart-note chart-warn" : "chart-note"} data-testid="nav-depart-have">
          {gate && leg.days !== null && have !== null ? legOverText(leg.days, have) : gate ? tz("sup.legShortPlan") : tz("depart.autoHave", { n: have ?? 0 })}
        </p>
        {failed !== null && <InlineError reason={failed ? tz("depart.autoFailed", { why: failed }) : tz("depart.autoFailedBare")} />}
      </div>
      <footer className="chart-dialog-actions">
        {gate && (
          <button type="button" className="chart-btn primary" data-testid="nav-depart-supply-first" data-hotkey="primary" onClick={goSupply}>
            {tz("sup.goSupply")}
          </button>
        )}
        <button
          type="button"
          className={gate ? "chart-btn" : "chart-btn primary"}
          disabled={!dest || !!dest.blocked || busy || leg.loading}
          data-testid="nav-depart-auto-go"
          data-hotkey={gate ? undefined : "primary"}
          onClick={() => void go()}
        >
          {gate ? tz("sup.sailAnyway") : dest ? t("nav.autopilotGo", { name: dest.name }) : tz("depart.autoPick")}
        </button>
        <button type="button" className="chart-btn" onClick={onCancel}>
          {t("nav.departCancel")}
        </button>
      </footer>
    </>
  );
}
