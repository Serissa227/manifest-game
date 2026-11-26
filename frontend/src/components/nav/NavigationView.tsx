// 航行视图（FRAMEWORK §6.8）：手动航行的世界里，旗舰队在海上时的主画面（整屏场景，盖在世界图上面）。
// - 海图：以舰队为中心的局部海图（NavCanvas）；点海面设航向。
// - 平视显示：航向（32 个罗经点的中文名，如“西北偏西”）、航速（节）、风向风力、洋流、粮水天数、士气、经纬度、自动航行。
// - 罗经盘（拖动转舵，拖动时画预测、松手提交 Steer）与帆的三档；手机上放在屏幕左下的拇指区。
// - 键盘：A/D 或 ←/→ 转舵（按住连续转，松开提交），W/S 升降帆，空格暂停，Tab 切换世界图。
// - 自动航行（已知海域里看见过的港口；开到已知海域的边缘）、登陆探索、今天会停下的地方。
// - 潜水（B12）：收着帆时才查探险记录里的潜水入口（张帆航行时不随每次推送多一个查询），旗舰队此处能潜时才出“潜水”；
//   不能潜的原因写在探险窗口的潜水点里。
// - 天气：旗舰队所在海区是暴风雨、雨、雾、雪时，航行海图之上、仪表之下另有全画面的雨幕、压暗与闪电（WeatherScreen）。
// Tab 切到世界图时只留一条“回到航行”的提示条（世界图上点已知港口发起自动航行）。
// 新界面（v2）：深色的仪表（styles/ui-v2/voyage.css）；按钮上的“（Tab）”“（空格）”改成小键帽（触屏上不显示），
// 底部的按键说明改成一组小键帽（KeyHints）；手机（竖屏与横屏）上仪表、“今天会停下”与打开着的小菜单在同一个纵向容器里
// （v2-nav-stack，互不遮挡），小菜单的 id 由打开它的按钮 aria-controls 指过来。v1 的字与 DOM 照旧。
import { useEffect, useId, useRef, useState } from "react";
import { latitudeAt, longitudeAt } from "../../art/map";
import type { ChartSource } from "../../hooks/useChartSource";
import {
  autopilotTo,
  draftHeading,
  navActive,
  navSignature,
  refreshNav,
  resetNav,
  sendDive,
  sendLanding,
  sendSighting,
  setSail,
  steerTo,
  toggleNavView,
  togglePause,
  useNavStore,
} from "../../hooks/useNavigation";
import { useView } from "../../hooks/useView";
import { isCompact, useLayout } from "../../hooks/useViewport";
import { t, tk } from "../../i18n";
import { tz } from "../../i18n/zhOnly";
import { api } from "../../ipc/api";
import type { DiveOptionView, NavView } from "../../ipc/types";
import { useGame } from "../../store/game";
import { diveName, divesOf } from "../panels/diveKit";
import { legOver, legOverText } from "../panels/supplyKit";
import { clockText } from "../../time/daylight";
import CompassDial from "./CompassDial";
import HailCard from "./HailCard";
import VoyageExtras from "./VoyageExtras";
import NavCanvas from "./NavCanvas";
import { navZoomKind, stepNavZoom, useNavZoom, zoomAtLimit } from "./navZoom";
import { clockMinuteOf, compassPoint, formatLatLon, inIrons, normDeg, SAILS } from "./navKit";
import { useSteerKeys } from "./useSteerKeys";
import { JettisonMenu, OrdersMenu, ShipStatus } from "./ShipStatus";
import { supplyAlertDue } from "./shipStatusKit";
import { ShoreMenu } from "./ShorePanel";
import { shoreButton } from "./shoreKit";
import { Kbd, KeyHints } from "../feedback";
import { useIsV2 } from "../../ui/uiMode";
import WeatherScreen from "../WeatherScreen";
import RoutePlanner from "../routing/RoutePlanner";
import { useRouteStore } from "../routing/routeStore";

/** H10h：船为什么慢、为什么不走——延误（海上奇遇等）优先，其次是自动航行的等风、慢行。没有这些时为 null（后端还没给这些字段时也是）。 */
// H10iF：多一个抢风（beat）——顶风时领航照平均航向直走，排在等风、慢行之后（三者不会同时出现）。
type NavWhy = "delay-creature" | "delay" | "wait" | "creep" | "beat";
function navWhy(nav: Pick<NavView, "autopilot" | "delay">): NavWhy | null {
  if (nav.delay) return nav.delay.kind === "creature" ? "delay-creature" : "delay";
  const mode = nav.autopilot?.mode;
  return mode === "wait" || mode === "creep" || mode === "beat" ? mode : null;
}

/** 仪表里“自动航行”一栏：预计天数一律是后端的 eta_days（与出航菜单同一个算法），前端不另算；等风、延误时不写天数。 */
function autopilotText(ap: NonNullable<NavView["autopilot"]>, why: NavWhy | null): string {
  const name = ap.dest_name;
  if (why === "delay" || why === "delay-creature") return tz("nav.apDelay", { name });
  if (why === "wait") return tz("nav.apWait", { name });
  if (ap.eta_days === null) return tz("nav.apGo", { name });
  if (why === "creep") return tz("nav.apCreep", { name, n: ap.eta_days });
  if (why === "beat") return tz("nav.apBeat", { name, n: ap.eta_days });
  return t("nav.autopilotOn", { name, n: ap.eta_days });
}

/** 罗经盘上方的一行：船为什么慢、为什么不走（不弹框、不暂停）。 */
const WHY_LINE: Record<NavWhy, Parameters<typeof tz>[0]> = {
  "delay-creature": "nav.whyDelayCreature",
  delay: "nav.whyDelay",
  wait: "nav.whyWait",
  creep: "nav.whyCreep",
  beat: "nav.whyBeat",
};

/** 平视显示。 */
function NavHud({ nav, draft, source }: { nav: NavView; draft: number | null; source: ChartSource | null }) {
  const shown = draft ?? nav.heading;
  const proj = source?.resource?.projection ?? null;
  const latLon = nav.lat_lon ?? (proj ? formatLatLon(latitudeAt(proj, nav.pos.y), longitudeAt(proj, nav.pos.x)) : null);
  // 粮水能撑几天：后端按船员人日算好的 supplies_days（V01）；没有船员不消耗时为 null
  const lowSupply = nav.supplies_days !== null && nav.supplies_days <= 3;
  const lowMorale = nav.morale < 30;
  const why = navWhy(nav);
  return (
    <dl className="nav-hud" data-testid="nav-hud" aria-label={t("nav.title")}>
      <div className="nav-hud-item nav-hud-heading">
        <dt>{t("nav.heading")}</dt>
        <dd data-testid="nav-heading">{t("nav.headingValue", { point: compassPoint(shown), deg: Math.round(normDeg(shown)) })}</dd>
      </div>
      <div className="nav-hud-item">
        <dt>{t("nav.speed")}</dt>
        <dd data-testid="nav-speed">{t("nav.knots", { v: (Math.round(nav.speed * 10) / 10).toFixed(1) })}</dd>
      </div>
      <div className="nav-hud-item">
        <dt>{t("nav.wind")}</dt>
        <dd data-testid="nav-wind" title={t("nav.windFrom", { point: compassPoint(nav.wind.dir) })}>
          {nav.wind.name}
        </dd>
      </div>
      <div className="nav-hud-item">
        <dt>{t("nav.current")}</dt>
        <dd data-testid="nav-current">
          {nav.current && nav.current.speed > 0
            ? t("nav.currentValue", { point: compassPoint(nav.current.dir), v: (Math.round(nav.current.speed * 10) / 10).toFixed(1) })
            : t("nav.currentNone")}
        </dd>
      </div>
      <div className={lowSupply ? "nav-hud-item warn" : "nav-hud-item"}>
        <dt>{t("nav.supplies")}</dt>
        <dd data-testid="nav-supplies">{nav.supplies_days === null ? tz("sup.idleShort") : t("nav.suppliesValue", { n: nav.supplies_days })}</dd>
      </div>
      <div className={lowMorale ? "nav-hud-item warn" : "nav-hud-item"}>
        <dt>{t("nav.morale")}</dt>
        <dd data-testid="nav-morale">{nav.morale}</dd>
      </div>
      <div className="nav-hud-item nav-hud-pos">
        <dt>{t("nav.position")}</dt>
        <dd data-testid="nav-latlon">{latLon ?? t("nav.positionCell", { x: Math.floor(nav.pos.x), y: Math.floor(nav.pos.y) })}</dd>
      </div>
      {nav.autopilot && (
        <div className={why ? "nav-hud-item nav-hud-auto slow" : "nav-hud-item nav-hud-auto"} data-why={why ?? undefined}>
          <dt>{t("nav.autopilot")}</dt>
          <dd data-testid="nav-autopilot">{autopilotText(nav.autopilot, why)}</dd>
        </div>
      )}
    </dl>
  );
}

/** 帆的三档。 */
function SailButtons({ sail, disabled }: { sail: NavView["sail"]; disabled: boolean }) {
  return (
    <div className="nav-sails" role="group" aria-label={t("nav.sailGroup")} data-testid="nav-sails">
      {[...SAILS].reverse().map((s) => (
        <button
          key={s}
          type="button"
          className={sail === s ? "nav-sail active" : "nav-sail"}
          aria-pressed={sail === s}
          disabled={disabled}
          data-testid={`nav-sail-${s}`}
          onClick={() => void setSail(s)}
        >
          {tk(`nav.sail.${s}`)}
        </button>
      ))}
    </div>
  );
}

/** 自动航行：已知海域里看见过的港口（开到已知海域的边缘的另行标出）。id 只在新界面给（打开它的按钮用 aria-controls 指过来）。 */
function AutopilotMenu({ nav, onClose, id }: { nav: NavView; onClose: () => void; id?: string }) {
  return (
    <div className="nav-pop" id={id} role="menu" aria-label={t("nav.autopilotPick")} data-testid="nav-autopilot-menu">
      <h4>{t("nav.autopilotPick")}</h4>
      {nav.known_dests.length === 0 && <p className="nav-note">{t("nav.autopilotNone")}</p>}
      {nav.known_dests.map((d) => {
        // FIX5F：这一程比粮水撑得久时在这一项上写明（海上没处买，只提醒、不拦）
        const over = legOver(d.days, nav.supplies_days);
        // R10-FIX8：去不了的港事先灰着，写出与真去时被拒的同一句
        const blocked = d.blocked?.text ?? null;
        return (
          <button
            key={d.loc}
            type="button"
            role="menuitem"
            disabled={!!blocked}
            className={["nav-pop-item", over ? "is-short" : "", blocked ? "is-blocked" : ""].filter(Boolean).join(" ")}
            data-testid={`nav-dest-${d.loc}`}
            title={blocked ?? (over && d.days !== null && nav.supplies_days !== null ? legOverText(d.days, nav.supplies_days, true) : undefined)}
            onClick={() => {
              onClose();
              void autopilotTo(d.loc, d.days === null);
            }}
          >
            <span>{d.days === null ? t("nav.autopilotEdge", { name: d.name }) : t("nav.autopilotGo", { name: d.name })}</span>
            {d.days !== null && <small>{t("nav.autopilotDays", { n: d.days })}</small>}
            {blocked && (
              <small className="nav-dest-blocked" data-testid={`nav-dest-blocked-${d.loc}`}>
                {blocked}
              </small>
            )}
            {over && !blocked && (
              <small className="nav-dest-short" data-testid={`nav-dest-short-${d.loc}`}>
                {tz("sup.legOverItem", { have: nav.supplies_days ?? 0 })}
              </small>
            )}
          </button>
        );
      })}
      {nav.known_dests.some((d) => legOver(d.days, nav.supplies_days)) && <p className="nav-note nav-dest-short-note">{tz("sup.legOverSea")}</p>}
      <button type="button" className="nav-pop-close" onClick={onClose}>
        {t("nav.autopilotCancel")}
      </button>
    </div>
  );
}

/** 登陆探索：派出几天。id 同上，只在新界面给。 */
function LandingMenu({ onClose, id }: { onClose: () => void; id?: string }) {
  return (
    <div className="nav-pop" id={id} role="menu" aria-label={t("nav.landingTitle")} data-testid="nav-landing-menu">
      <h4>{t("nav.landingTitle")}</h4>
      <p className="nav-note">{t("nav.landingHint")}</p>
      <div className="nav-pop-row">
        {[1, 2, 3, 5].map((d) => (
          <button
            key={d}
            type="button"
            role="menuitem"
            className="nav-pop-item"
            data-testid={`nav-landing-${d}`}
            onClick={() => {
              onClose();
              void sendLanding(d);
            }}
          >
            {t("nav.landingDays", { n: d })}
          </button>
        ))}
      </div>
      <button type="button" className="nav-pop-close" onClick={onClose}>
        {t("nav.autopilotCancel")}
      </button>
    </div>
  );
}

/** 潜水：旗舰队此处能潜的潜水点（B12）；潜成了在提示条回一句。id 同上，只在新界面给。 */
function DiveMenu({ dives, nameOf, onClose, id }: { dives: DiveOptionView[]; nameOf: (discovery: number) => string; onClose: () => void; id?: string }) {
  return (
    <div className="nav-pop" id={id} role="menu" aria-label={t("nav.diveTitle")} data-testid="nav-dive-menu">
      <h4>{t("nav.diveTitle")}</h4>
      {dives.map((d) => (
        <button
          key={d.discovery}
          type="button"
          role="menuitem"
          className="nav-pop-item"
          data-testid={`nav-dive-${d.discovery}`}
          onClick={() => {
            const name = nameOf(d.discovery);
            onClose();
            void sendDive(d.discovery).then((ok) => {
              if (ok) useGame.getState().notify(t("explore.diveDone", { name }));
            });
          }}
        >
          {nameOf(d.discovery)}
        </button>
      ))}
      <button type="button" className="nav-pop-close" onClick={onClose}>
        {t("nav.autopilotCancel")}
      </button>
    </div>
  );
}

/**
 * H04 海上所见的小卡片：碰上了的那一个（标题、看见的样子、一两个按钮；要绕开的直接给结果与“知道了”），
 * 或刚结算完的结果（一句话，下一次刷新前留着）。不是整屏的故事窗口，放在罗经盘旁边，不挡海面中央。
 */
function SightingCard({ nav, busy }: { nav: NavView; busy: boolean }) {
  const s = nav.sightings;
  if (!s) return null;
  if (s.card) {
    const c = s.card;
    return (
      <section className="nav-sighting" role="dialog" aria-label={c.title} data-testid="nav-sighting-card" data-kind={c.kind}>
        <h4>{c.title}</h4>
        <p>{c.text}</p>
        {c.result && <p className={c.harm ? "nav-sighting-result harm" : "nav-sighting-result"}>{c.result}</p>}
        <div className="nav-sighting-actions">
          {c.options.map((label, i) => (
            <button key={i} type="button" className="chart-btn" disabled={busy} data-testid={`nav-sighting-${i}`} onClick={() => void sendSighting(c.id, i)}>
              {label}
            </button>
          ))}
        </div>
      </section>
    );
  }
  if (s.last) {
    return (
      <section className="nav-sighting done" role="status" data-testid="nav-sighting-last">
        <h4>{s.last.title}</h4>
        <p className={s.last.harm ? "nav-sighting-result harm" : "nav-sighting-result"}>{s.last.text}</p>
      </section>
    );
  }
  return null;
}

/** 世界图上的提示条：回到航行，确认自动驶往点选的港口。 */
function WorldBar() {
  const v2 = useIsV2();
  const nav = useNavStore((s) => s.nav);
  const pick = useNavStore((s) => s.pick);
  const dest = pick !== null ? nav?.known_dests.find((d) => d.loc === pick) : undefined;
  // H07：拿到了航线预览就由它来“驶往”（选偏好、排经停点）；拿不到（旧后端）时照旧是下面的快捷按钮
  const planned = useRouteStore((s) => s.shown);
  return (
    <div className="nav-worldbar" role="status" data-testid="nav-worldbar">
      <button type="button" className="chart-btn primary" onClick={toggleNavView} data-testid="nav-back">
        {v2 ? (
          <>
            {t("v2.voyage.backToNav")}
            <Kbd k="Tab" />
          </>
        ) : (
          t("nav.backToNav")
        )}
      </button>
      {nav && <RoutePlanner nav={nav} />}
      {dest && !planned && (
        <span className="nav-worldbar-pick">
          <button
            type="button"
            className="chart-btn"
            data-testid="nav-pick-go"
            disabled={!!dest.blocked}
            title={dest.blocked?.text}
            onClick={() => void autopilotTo(dest.loc, dest.days === null)}
          >
            {dest.days === null ? t("nav.autopilotEdge", { name: dest.name }) : t("nav.autopilotGo", { name: dest.name })}
            {dest.days !== null && ` · ${t("nav.autopilotDays", { n: dest.days })}`}
          </button>
          {dest.blocked && (
            <span className="nav-worldbar-short" role="note" data-testid="nav-pick-blocked">
              {dest.blocked.text}
            </span>
          )}
          {!dest.blocked && dest.days !== null && nav && nav.supplies_days !== null && legOver(dest.days, nav.supplies_days) && (
            <span className="nav-worldbar-short" role="note" data-testid="nav-pick-short">
              {legOverText(dest.days, nav.supplies_days, true)}
            </span>
          )}
          <button type="button" className="chart-btn" onClick={() => useNavStore.setState({ pick: null })}>
            {t("nav.autopilotCancel")}
          </button>
        </span>
      )}
    </div>
  );
}

export default function NavigationView({ source }: { source: ChartSource | null }) {
  const statics = useGame((s) => s.statics);
  const overview = useGame((s) => s.overview);
  const active = navActive(statics, overview);
  const nav = useNavStore((s) => s.nav);
  const view = useNavStore((s) => s.view);
  const draft = useNavStore((s) => s.draft);
  const busy = useNavStore((s) => s.busy);
  const compact = isCompact(useLayout());
  const v2 = useIsV2();
  const [menu, setMenu] = useState<"autopilot" | "landing" | "dive" | "orders" | "jettison" | "shore" | null>(null);
  // H02：粮水低于常设命令里的提醒天数时暂停一次（每天最多一次）
  const alertedDay = useRef(-1);
  // H10a：连续缩放（navZoom.ts：寰宇每格 96–240 像素，缺省 144；滚轮在画布上，按钮按 1.25 倍步进；记住上次的值）
  const zoomKind = navZoomKind(source);
  const zoomNow = useNavZoom((s) => s[zoomKind]);
  const menuId = useId();
  const sig = navSignature(overview);
  // S02nF6：换局序号（读档、新开局、换世界后新一局的第一份概览到了加一）；签名不变时也要重取
  const game = useNavStore((s) => s.game);
  const wasActive = useRef(false);
  // 潜水要收帆：收着帆时才问潜水入口（与探险窗口共用 discoveries 这一份），只留旗舰队此处能潜的
  const furled = active && nav?.sail === "furled";
  const { data: explore } = useView(furled ? "discoveries" : null, () => api.discoveries(), { quiet: true });
  const dives = furled && nav ? divesOf(explore, nav.fleet).filter((d) => d.enabled) : [];
  const diveNameOf = (discovery: number) => diveName(statics, explore, discovery);

  // 航行视图随概览刷新（换日、出港、转舵、迷雾变化）；离开海面时清空
  useEffect(() => {
    if (active) {
      wasActive.current = true;
      void refreshNav();
    } else if (wasActive.current) {
      wasActive.current = false;
      resetNav();
    }
    // 重连由 useNavigation 的 onSequence 自己重取；这里只跟换日、出港、转舵等签名与换局序号
  }, [active, sig, game]);

  useEffect(() => {
    if (!active || !nav || !supplyAlertDue(nav) || alertedDay.current === nav.day) return;
    const g = useGame.getState();
    if ((g.overview?.speed ?? 0) === 0) return;
    alertedDay.current = nav.day;
    const n = nav.supplies_days ?? 0;
    // FIX5F：停下以后把原因留在顶栏时刻下面（提示条那一句一闪就过，1113c 实测只看到“早上无故停一下”）
    void g.setSpeed(0).then(() => useNavStore.setState({ supplyHold: n }));
    g.notify(tz("orders.alertNow", { n }));
  }, [active, nav]);
  // 留着的原因：继续航行、粮水回到警戒线以上、离开海面时撤掉
  const speedNow = overview?.speed ?? 0;
  const supplyHold = useNavStore((s) => s.supplyHold);
  useEffect(() => {
    if (supplyHold === null) return;
    if (!active || speedNow > 0 || (nav && !supplyAlertDue(nav))) useNavStore.setState({ supplyHold: null });
  }, [supplyHold, active, speedNow, nav]);

  useSteerKeys(active, view === "world");

  if (!active) return null;
  if (view === "world") return <WorldBar />;
  const speed = overview?.speed ?? 0;
  const why = nav ? navWhy(nav) : null;
  // 有“为什么慢 / 不走”的一行时不再叠一条逆风提示（慢行、等风本来就是逆风）
  const irons = !!nav && why === null && inIrons(draft ?? nav.heading, nav.wind.dir, nav.sail_limit);
  const zoomLimit = zoomAtLimit(zoomKind, zoomNow);
  // 新界面的手机（竖屏与横屏）：仪表、“今天会停下”与打开着的小菜单放进同一个纵向容器（v2-nav-stack），
  // 停靠小卡总是紧跟在仪表下面（不再按写死的高度定位、被读数折行顶住），小菜单从底部升起、最高到停靠小卡下沿为止。
  // 旧界面与桌面照旧：仪表、停靠小卡各自定位，小菜单在操作按钮旁边弹出。
  const stacked = v2 && compact;
  const menuEl =
    nav && menu === "autopilot" ? (
      <AutopilotMenu nav={nav} onClose={() => setMenu(null)} id={v2 ? `${menuId}-autopilot` : undefined} />
    ) : menu === "landing" ? (
      <LandingMenu onClose={() => setMenu(null)} id={v2 ? `${menuId}-landing` : undefined} />
    ) : menu === "dive" && dives.length > 0 ? (
      <DiveMenu dives={dives} nameOf={diveNameOf} onClose={() => setMenu(null)} id={v2 ? `${menuId}-dive` : undefined} />
    ) : nav && menu === "jettison" && nav.wear ? (
      <JettisonMenu nav={nav} onClose={() => setMenu(null)} onSent={() => void refreshNav()} id={v2 ? `${menuId}-jettison` : undefined} />
    ) : nav && menu === "shore" && nav.shore ? (
      <ShoreMenu nav={nav} onClose={() => setMenu(null)} onSent={() => void refreshNav()} id={v2 ? `${menuId}-shore` : undefined} />
    ) : nav && menu === "orders" && nav.wear ? (
      <OrdersMenu nav={nav} onClose={() => setMenu(null)} onSent={() => void refreshNav()} id={v2 ? `${menuId}-orders` : undefined} />
    ) : null;
  const statusEl = nav?.wear ? <ShipStatus wear={nav.wear} /> : null;
  const stopsEl =
    nav && nav.stops.length > 0 ? (
      <ul className="nav-stops" aria-label={t("nav.stops")} data-testid="nav-stops">
        {nav.stops.map((s, i) => (
          <li key={i} className={`nav-stop nav-stop-${s.kind}`}>
            {t("nav.stopAt", { time: clockText(clockMinuteOf(s.minute)), text: s.text })}
          </li>
        ))}
      </ul>
    ) : null;
  return (
    <section className={compact ? "nav-view compact" : "nav-view"} data-testid="nav-view" aria-label={t("nav.title")}>
      <div className="nav-sea">
        {source && nav ? <NavCanvas source={source} nav={nav} overview={overview} /> : <p className="nav-loading">{t("nav.loading")}</p>}
      </div>
      {/* 旗舰队在暴风雨等海区里时的全画面天气：航行海图之上、仪表与罗经盘之下 */}
      <WeatherScreen layer="nav" />
      {/* 新界面的桌面：仪表与船况条装在同一个竖排的浮层里，船况条跟在仪表下面流动（X02：原来船况条钉在 top 78 px，
          仪表让开“已自动暂停”小卡或折成两行时，船况条压住仪表第二行的读数） */}
      {nav && !stacked && v2 && (
        <div className="v2-nav-float">
          <NavHud nav={nav} draft={draft} source={source} />
          {statusEl}
        </div>
      )}
      {nav && !stacked && !v2 && <NavHud nav={nav} draft={draft} source={source} />}
      {nav && !stacked && !v2 && statusEl}
      {nav && stacked && (
        <div className="v2-nav-stack">
          <div className="v2-nav-top">
            <NavHud nav={nav} draft={draft} source={source} />
            {statusEl}
            {stopsEl}
          </div>
          {menuEl}
        </div>
      )}
      {nav && (
        <div className="nav-thumb" data-testid="nav-thumb">
          <CompassDial
            heading={nav.heading}
            draft={draft}
            windFrom={nav.wind.dir}
            windForce={nav.wind.force}
            sailLimit={nav.sail_limit}
            current={nav.current}
            fast={nav.fast}
            disabled={busy}
            onDraft={draftHeading}
            onCommit={(h) => void steerTo(h)}
          />
          {irons && (
            <p className="nav-irons" role="alert" data-testid="nav-irons">
              {t("nav.inIrons")}
            </p>
          )}
          {why && (
            <p className="nav-irons nav-why" role="status" data-testid="nav-why" data-why={why}>
              {tz(WHY_LINE[why])}
            </p>
          )}
          <SailButtons sail={nav.sail} disabled={busy} />
        </div>
      )}
      {nav && (
        <div className="nav-actions" data-testid="nav-actions">
          <button type="button" className="chart-btn" onClick={toggleNavView} data-testid="nav-world">
            {v2 ? (
              <>
                {t("v2.voyage.worldMap")}
                <Kbd k="Tab" />
              </>
            ) : (
              t("nav.worldMap")
            )}
          </button>
          <button type="button" className="chart-btn" onClick={() => void togglePause()} data-testid="nav-pause">
            {v2 ? (
              <>
                {speed > 0 ? t("v2.voyage.pause") : t("v2.voyage.resume")}
                <Kbd k="Space" />
              </>
            ) : speed > 0 ? (
              t("nav.pause")
            ) : (
              t("nav.resume")
            )}
          </button>
          <button
            type="button"
            className="chart-btn"
            aria-expanded={menu === "autopilot"}
            aria-controls={v2 && menu === "autopilot" ? `${menuId}-autopilot` : undefined}
            onClick={() => setMenu(menu === "autopilot" ? null : "autopilot")}
            data-testid="nav-autopilot-open"
          >
            {t("nav.autopilot")}
          </button>
          {nav.autopilot && (
            <button type="button" className="chart-btn" onClick={() => void steerTo(nav.heading)} data-testid="nav-autopilot-stop">
              {t("nav.autopilotStop")}
            </button>
          )}
          <button
            type="button"
            className="chart-btn"
            aria-expanded={menu === "landing"}
            aria-controls={v2 && menu === "landing" ? `${menuId}-landing` : undefined}
            onClick={() => setMenu(menu === "landing" ? null : "landing")}
            data-testid="nav-landing-open"
          >
            {t("nav.landing")}
          </button>
          {shoreButton(nav) && (
            <button
              type="button"
              className={nav.shore?.camp ? "chart-btn active" : "chart-btn"}
              aria-expanded={menu === "shore"}
              aria-controls={v2 && menu === "shore" ? `${menuId}-shore` : undefined}
              onClick={() => setMenu(menu === "shore" ? null : "shore")}
              data-testid="nav-shore-open"
            >
              {shoreButton(nav)}
            </button>
          )}
          {nav.wear && (nav.wear.cargo ?? 0) > 0 && (
            <button
              type="button"
              className="chart-btn"
              aria-expanded={menu === "jettison"}
              aria-controls={v2 && menu === "jettison" ? `${menuId}-jettison` : undefined}
              onClick={() => setMenu(menu === "jettison" ? null : "jettison")}
              data-testid="nav-jettison-open"
            >
              {tz("wear.jettison")}
            </button>
          )}
          {nav.wear && (
            <button
              type="button"
              className="chart-btn"
              aria-expanded={menu === "orders"}
              aria-controls={v2 && menu === "orders" ? `${menuId}-orders` : undefined}
              onClick={() => setMenu(menu === "orders" ? null : "orders")}
              data-testid="nav-orders-open"
            >
              {tz("orders.open")}
            </button>
          )}
          {dives.length > 0 && (
            <button
              type="button"
              className="chart-btn"
              aria-expanded={menu === "dive"}
              aria-controls={v2 && menu === "dive" ? `${menuId}-dive` : undefined}
              onClick={() => setMenu(menu === "dive" ? null : "dive")}
              data-testid="nav-dive-open"
            >
              {t("nav.dive")}
            </button>
          )}
          <span className="nav-zoom" role="group">
            <button type="button" className="chart-zoom-btn" aria-label={t("nav.zoomIn")} title={t("nav.zoomIn")} disabled={zoomLimit.inMax} onClick={() => stepNavZoom(zoomKind, 1)}>
              +
            </button>
            <button type="button" className="chart-zoom-btn" aria-label={t("nav.zoomOut")} title={t("nav.zoomOut")} disabled={zoomLimit.outMax} onClick={() => stepNavZoom(zoomKind, -1)}>
              −
            </button>
          </span>
          {!stacked && menuEl}
        </div>
      )}
      {!stacked && stopsEl}
      {nav && <SightingCard nav={nav} busy={busy} />}
      {nav && <HailCard nav={nav} />}
      {nav && <VoyageExtras nav={nav} />}
      {!compact && (
        <KeyHints
          on="night"
          className="nav-keys"
          items={[
            { keys: ["A", "D"], label: t("v2.voyage.keySteer") },
            { keys: ["W", "S"], label: t("v2.voyage.keySail") },
            { keys: ["Space"], label: t("v2.voyage.keyPause") },
            { keys: ["Tab"], label: t("v2.voyage.keyWorld") },
          ]}
          v1={<p className="nav-keys">{t("nav.keys")}</p>}
        />
      )}
    </section>
  );
}
