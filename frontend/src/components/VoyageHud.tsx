// 航行状态：主角的旗舰队在海上时显示在航海图一角——船在浪上起伏的小画面、目的地、已航行天数、
// 粮水可支撑天数、士气与船员、本次航程的新发现数（世界里有发现物时），以及“改变航向”。
// 小画面的天空与海面随时段与当地天况变化（雨丝、暴风雨的大浪与压暗），同样遵守防闪烁（4× 及以上白天、不闪电），切换时淡入淡出。
// 选择目的地时显示提示条（PickBar）与“取消”。
//
// 摆放：MapView 在左侧栏里放一个 <VoyageHud inMap />，与地点列表、图例上下排好；
// 此时别处单独渲染的 <VoyageHud />（例如外壳的舞台）自动让位，不会出现两份。
// 没有 MapView 时，单独的 <VoyageHud /> 自己浮在所在容器的左上角，并带着提示条。
//
// 网页自适应：标题栏右边有“收起 / 展开”（与地点、图例小窗一样）；收起时只剩一行“目的地 · 还需几天”（粮水告急时带红标）。
// 手机上缺省收起，不挡海图；玩家点过之后以玩家的选择为准（切换舞台时保留）。
// 第九批：手动航行的世界由航行视图（components/nav/NavigationView）显示航向、粮水与士气，这里不再出现。
// 新界面（v2）：深色的浮层（styles/ui-v2/voyage.css）；知道还需几天时多一条航程进度（已航行 / 已航行 + 还需），
// 收起与展开时都在，一眼看出走了多远。v1 不画这一条，DOM 与原来一样。
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { drawDiscoveryMarker } from "../art/map";
import { P } from "../art/palette";
import { paint } from "../art/render";
import { applyFlash, gradeColor, lightningAt, shadeCached } from "../art/scenery";
import { drawShipByKey, shipArtKey, SHIP_FRAMES } from "../art/ships";
import type { Px } from "../art/px";
import { Sprite } from "../art/Sprite";
import { useFrames } from "../art/useFrames";
import { drawVoyageVignette, type VignetteOpts } from "../art/vignette";
import { useScenePhase } from "../hooks/useClock";
import { beginDeparture, cancelDeparture, useVoyageStore } from "../hooks/useVoyage";
import { t } from "../i18n";
import { api } from "../ipc/api";
import { locById } from "../ipc/byId";
import type { FleetView } from "../ipc/types";
import { useFoundStore } from "../map/found";
import { hasDiscoveries, hasSites } from "../map/marks";
import { crossfade, LookFader } from "../scene/look";
import { useHeldWeather, voyageWeather } from "./port/sceneLook";
import { isCompact, useLayout } from "../hooks/useViewport";
import { flagship, useGame } from "../store/game";
import { isManualWorld } from "../hooks/useNavigation";
import { useRequestSeq } from "../hooks/useRequestSeq";
import { BiName } from "./BiName";
import { supplyDays as fleetSupplyDays } from "./panels/supplyKit";
import { useIsV2 } from "../ui/uiMode";

const VW = 72;
const VH = 30;

/** MapView 里的航行状态栏位个数（>0 时单独渲染的实例让位）。 */
const useHudSlot = create<{ n: number }>(() => ({ n: 0 }));

/** 航行状态是否展开：null 为自动（手机上收起、其余展开），玩家点过之后以玩家的选择为准。 */
const useHudOpen = create<{ open: boolean | null }>(() => ({ open: null }));

/** 一帧航行小画面（含船）：按外观画天空与海、船随浪起伏（暴风雨时起伏更大）。 */
function vignetteFrame(key: string, sail: "square" | "lateen", f: number, look: VignetteOpts): Px {
  const time = look.time ?? "day";
  const weather = look.weather ?? "clear";
  const { px, waterline, swell } = drawVoyageVignette(VW, VH, f, look);
  const ship = shadeCached(drawShipByKey(key, sail, { size: "small", flag: P.gold[3], frame: f % SHIP_FRAMES }), time, weather);
  const bob = Math.round([0, 0, 1, 1, 1, 0, -1, -1][f % 8] * swell);
  const out = px.clone();
  const x = Math.floor(VW * 0.36) - Math.floor(ship.w / 2);
  out.blit(ship, x, waterline - ship.h + 3 + bob);
  // 船头的白浪与船尾的航迹
  const foam = gradeColor(P.foam, time, weather);
  out.set(x + ship.w - 1, waterline + 1 + bob, foam).set(x + ship.w, waterline + bob, foam);
  out.hline(x - 4 - (f % 3), x - 1, waterline + 2, foam);
  return out;
}

/** 船在浪上起伏的小画面（按帧重绘；测试环境没有画布时静默跳过）。 */
function SeaVignette({ fleet }: { fleet: FleetView }) {
  const statics = useGame((s) => s.statics);
  // 按字段选取（P14a）：只看倍速、季节与天气（voyageWeather 只读 local_weather 与 weather）
  const overview = useGame(
    useShallow((s) =>
      s.overview ? { speed: s.overview.speed, season: s.overview.season, local_weather: s.overview.local_weather, weather: s.overview.weather } : null,
    ),
  );
  const speed = overview?.speed ?? 0;
  const canvas = useRef<HTMLCanvasElement>(null);
  const kind = fleet.ships[0]?.kind ?? 0;
  const sail = statics?.ships[kind]?.sail ?? "square";
  const key = shipArtKey(statics?.ships, kind);
  const phase = useScenePhase();
  const w = useHeldWeather(voyageWeather(overview), speed);
  const look: VignetteOpts = { time: phase, weather: w.sky, windX: w.windX, season: overview?.season ?? 1 };
  // 5 fps 下 4 帧 ≈ 0.8 秒的淡入淡出
  const fader = useRef(new LookFader<VignetteOpts>(4));
  const draw = (f: number) => {
    if (!canvas.current) return;
    const out = vignetteFrame(key, sail, f, look);
    const fade = fader.current.step(`${look.time}|${look.weather ?? "-"}`, look, f);
    if (fade.prev) crossfade(out, vignetteFrame(key, sail, f, fade.prev), 1 - fade.t);
    // 暴风雨的闪电：柔和的短暂提亮，间隔 ≥ 3 秒，4× 及以上不闪
    if (look.weather === "storm" && speed < 4) applyFlash(out, lightningAt(f, 5));
    paint(canvas.current, out);
  };
  const drawRef = useRef(draw);
  useEffect(() => {
    drawRef.current = draw;
  });
  useEffect(() => drawRef.current(0), []);
  useFrames(5, (f) => drawRef.current(f));
  return <canvas ref={canvas} className="voyage-vignette sprite" width={VW} height={VH} aria-hidden="true" data-phase={phase} data-sky={w.sky ?? "clear"} />;
}

/** 预计还需几天：旗舰队在海上时按天查询一次航线预估。 */
function useEta(fleet: FleetView | undefined): number | null {
  const [eta, setEta] = useState<number | null>(null);
  const id = fleet?.id;
  const dest = fleet?.docked === null ? fleet.dest : null;
  const day = fleet?.days_at_sea ?? 0;
  // 换了一局 / 重连之后重新问（在路上的回复不再采用，P03）
  const reqSeq = useRequestSeq();
  useEffect(() => {
    if (id === undefined || dest === null) return;
    let alive = true;
    api
      .sailPreview(id, dest)
      .then((p) => {
        if (alive) setEta(p ? p.days : null);
      })
      .catch(() => {
        if (alive) setEta(null);
      });
    return () => {
      alive = false;
    };
  }, [id, dest, day, reqSeq]);
  return dest === null ? null : eta;
}

/** 新界面：本次航程的进度条（已航行 / 已航行 + 预计还需）；还不知道还需几天时不画。v1 不画。 */
function VoyageProgress({ done, left }: { done: number; left: number | null }) {
  const v2 = useIsV2();
  if (!v2 || left === null) return null;
  const pct = Math.round((Math.max(0, done) / Math.max(1, done + left)) * 100);
  return (
    <div
      className="v2-voyage-progress"
      role="progressbar"
      aria-label={t("v2.voyage.progress")}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-valuetext={t("v2.voyage.progressText", { done, left })}
      data-testid="voyage-progress"
    >
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

/** 选择目的地时的提示条：“请在海图上选择目的地”与“取消”。 */
export function PickBar() {
  const picking = useVoyageStore((s) => s.picking);
  const target = useVoyageStore((s) => s.target);
  const sites = useGame((s) => hasSites(s.statics));
  if (!picking || target !== null) return null;
  return (
    <div className="voyage-pick" role="status" data-testid="voyage-pick">
      <div>
        <strong>{t("chartPickHint")}</strong>
        <span>{sites ? t("chartPickSubSites") : t("chartPickSub")}</span>
      </div>
      <button type="button" className="chart-btn" onClick={cancelDeparture}>
        {t("chartPickCancel")}
      </button>
    </div>
  );
}

function Hud({ fleet, floating }: { fleet: FleetView; floating: boolean }) {
  const statics = useGame((s) => s.statics);
  const picking = useVoyageStore((s) => s.picking);
  const found = useFoundStore((s) => s.voyage);
  const eta = useEta(fleet);
  const compact = isCompact(useLayout());
  const pref = useHudOpen((s) => s.open);
  if (!statics) return null;
  const destLoc = fleet.dest !== null ? locById(statics, fleet.dest) : undefined;
  const dest = destLoc?.name;
  // 粮水能撑几天：V01 起照后端按船员人日算好的 supplies_days（旧后端按每天各需 daily_need 推算）
  const supplyDays = fleetSupplyDays(fleet);
  const low = supplyDays !== null && (eta !== null ? supplyDays < eta : supplyDays <= 3);
  const moraleLow = fleet.morale < 30;
  const open = pref ?? !compact;
  return (
    <section
      className={[floating ? "chart-win voyage-hud floating" : "chart-win voyage-hud", open ? "" : "collapsed"].filter(Boolean).join(" ")}
      aria-label={t("chartHudTitle")}
      data-testid="voyage-hud"
    >
      <header className="chart-win-title">
        <h3>{t("chartHudTitle")}</h3>
        <button
          type="button"
          className="chart-win-toggle"
          aria-expanded={open}
          aria-label={t("layout.toggleVoyage")}
          title={open ? t("chartCollapse") : t("chartExpand")}
          onClick={() => useHudOpen.setState({ open: !open })}
        >
          {open ? "−" : "+"}
        </button>
      </header>
      {!open && (
        <p className="voyage-summary" data-testid="voyage-summary">
          <strong>{dest ?? t("chartHudDrifting")}</strong>
          {eta !== null && (
            <span>
              {t("chartHudEta")} {t("chartHudDaysValue", { n: eta })}
            </span>
          )}
          {low && <span className="chart-tag warn">{t("chartHudSupplyLow")}</span>}
          {moraleLow && <span className="chart-tag warn">{t("chartHudMoraleLow")}</span>}
        </p>
      )}
      {!open && <VoyageProgress done={fleet.days_at_sea} left={eta} />}
      {open && (
        <div className="voyage-body">
          <SeaVignette fleet={fleet} />
          <VoyageProgress done={fleet.days_at_sea} left={eta} />
          <dl className="chart-kv voyage-kv">
            <dt>{t("chartHudDest")}</dt>
            <dd data-testid="voyage-dest">
              {dest !== undefined ? (
                <BiName as="strong" zh={dest} en={destLoc?.name_en} />
              ) : (
                <strong>{t("chartHudDrifting")}</strong>
              )}
            </dd>
            <dt>{t("chartHudDays")}</dt>
            <dd data-testid="voyage-days">
              {t("chartHudDaysValue", { n: fleet.days_at_sea })}
              {eta !== null && (
                <span className="voyage-eta">
                  {t("chartHudEta")} {t("chartHudDaysValue", { n: eta })}
                </span>
              )}
            </dd>
            <dt>{t("chartHudSupply")}</dt>
            <dd data-testid="voyage-supply" className={low ? "chart-warn" : undefined}>
              {supplyDays === null ? t("chartHudUnknown") : t("chartHudDaysValue", { n: supplyDays })}
              {low && <span className="chart-tag warn">{t("chartHudSupplyLow")}</span>}
            </dd>
            <dt>{t("chartHudMorale")}</dt>
            <dd className={moraleLow ? "chart-warn" : undefined}>
              <span className="voyage-meter" aria-hidden="true">
                <span style={{ width: `${Math.max(0, Math.min(100, fleet.morale))}%` }} />
              </span>
              {fleet.morale}
              {moraleLow && <span className="chart-tag warn">{t("chartHudMoraleLow")}</span>}
            </dd>
            <dt>{t("chartHudCrew")}</dt>
            <dd className={fleet.crew < fleet.crew_min ? "chart-warn" : undefined}>
              {t("chartHudCrewValue", { crew: fleet.crew, min: fleet.crew_min })}
            </dd>
            {hasDiscoveries(statics) && (
              <>
                <dt>{t("chartHudFound")}</dt>
                <dd data-testid="voyage-found" className={found > 0 ? "voyage-found" : undefined}>
                  {found > 0 && <Sprite px={drawDiscoveryMarker("wonder")} scale={1} className="voyage-found-icon" />}
                  {t("chartHudFoundValue", { n: found })}
                </dd>
              </>
            )}
          </dl>
        </div>
      )}
      {!picking && (
        <footer className="chart-dialog-actions">
          <button type="button" className="chart-btn" onClick={beginDeparture}>
            {t("chartHudChangeCourse")}
          </button>
        </footer>
      )}
    </section>
  );
}

export default function VoyageHud({ inMap = false }: { inMap?: boolean }) {
  // 按字段选取（P14a）：只看旗舰队（结构共享：旗舰队没变时还是同一个对象）
  const fleet = useGame((s) => flagship(s.overview));
  const manual = useGame((s) => isManualWorld(s.statics));
  const slots = useHudSlot((s) => s.n);
  useEffect(() => {
    if (!inMap) return;
    useHudSlot.setState((s) => ({ n: s.n + 1 }));
    return () => useHudSlot.setState((s) => ({ n: s.n - 1 }));
  }, [inMap]);
  // MapView 里已有航行状态栏位：单独渲染的实例让位
  if (!inMap && slots > 0) return null;
  const atSea = !!fleet && fleet.docked === null;
  const hud = atSea && fleet && !manual ? <Hud fleet={fleet} floating={!inMap} /> : null;
  if (inMap) return hud;
  return (
    <>
      <PickBar />
      {hud}
    </>
  );
}
