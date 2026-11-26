// 航海图：PixiJS 画布 + 左侧栏（航行状态、可折叠的“地点”与“图例”小窗）+ 选择目的地的提示条 + 出航确认框。
// 渲染不可用时也能用地点列表操作。选择目的地（picking）时，在海图或地点列表上点选港口或殖民点会弹出确认框；
// 平时点选地点则选中它并切到港口页（殖民点切到殖民地页）。
// 地点列表：港口与内陆城市在“地点列表”里分两组；殖民点另列在“未开拓之地”下，按现状分为
// 我的殖民地 / 尚未开拓 / 已被占领 / 他人的殖民地。地点多时（新大陆）顶部有按名字查找的输入框。
// 左侧栏只占舞台上半部分：外壳的航海日志在左下角，功能窗口在右侧。
// 指针移到别家商会的船队标记上时，旁边弹出一张信息卡：哪家商会的船队、船长的肖像与名字（FleetHoverCard）；触屏上点一下船队标记。
// 网页自适应：右上角有放大、缩小与看全图三个按钮（触屏上也可以双指缩放）；手机上地点与图例小窗缺省收起，不挡海图。
// 第九批（UI-CONTRACT I3）：大地图（StaticView.map.external）先按 hash 取地图资源再画，迷雾改用 fog_delta 的位图增量；
// 看见过的地点（Overview.sighted）给出时，没看见的地点不画、不列、不能选；手动航行的世界在海上时盖上航行视图
// （components/nav/NavigationView），世界图上点已知港口发起自动航行，港内出港改为罗经盘定航向（DepartDialog）。
// 新界面（v2，docs/UI-REDESIGN.md 第二阶段·航海）：样式在 styles/ui-v2/voyage.css；DOM 只在 v2 下多几处——
// 查找没有结果时给“清除查找”（EmptyState，紧跟在查找框下面，下面不留空的分组标题），出航确认里做不了 / 有风险的原因就地写清并给补救（InlineError：
// 粮水不够全程时“补给到建议量”就在那一条里），“起航”“重新选择”旁边是回车、Esc 的小键帽。v1 的 DOM 与原来一模一样。
// 原因分两级：做不了（无法到达、船员不足、没有舰队）时“起航”不可用、aria-describedby 指向原因，焦点给“重新选择”；
// 有风险（粮水不够全程）时只是安静的提醒，照样可以起航。无法到达时“重新选择”当主按钮。选目的地时旗舰队所在的港口不算“能去”。
// 天气特效：海图上按海区的压暗、雨线与闪电由渲染器画（开关经 WeatherSync 交给它）；旗舰队在暴风雨等海区里时
// 另有全画面的雨幕（WeatherScreen），盖在海图画布之上、左侧栏之下。
import TripSummaryCard from "./TripSummaryCard";
import { memo, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  PLAYER_FLAG,
  drawCaravanMarker,
  drawCityMarker,
  drawDiscoveryMarker,
  drawPortMarker,
  drawSiteMarker,
  drawWindArrow,
  fogSwatch,
  lightSwatch,
  markerStyle,
  weatherSwatch,
} from "../art/map";
import { P } from "../art/palette";
import type { Px } from "../art/px";
import { drawShip } from "../art/ships";
import { Sprite } from "../art/Sprite";
import {
  canSailTo,
  cancelDeparture,
  chooseDestination,
  confirmDeparture,
  focusSite,
  rememberKnown,
  repickDestination,
  useVoyageStore,
} from "../hooks/useVoyage";
import { useClockStore } from "../store/clock";
import { isCompact, useLayout } from "../hooks/useViewport";
import { money, otherName, t, tk } from "../i18n";
import { tz } from "../i18n/zhOnly";
import { api } from "../ipc/api";
import { locById } from "../ipc/byId";
import type { LocView, Overview, PortCondition, SailPreview, SiteView, SkyKind, StaticView } from "../ipc/types";
import { hasDiscoveries, hasSites, isSite, portConditions, siteMark, siteState, siteStates, type SiteState, type SiteStatus } from "../map/marks";
import { createMapRenderer, type FleetHover, type MapRenderer } from "../map/renderer";
import QuestChartMark from "../map/QuestChartMark";
import { chartNight } from "../map/weather";
import { flagship, useGame } from "../store/game";
import { useChartUi } from "./chartUi";
import { useChartSource } from "../hooks/useChartSource";
import { navActive, pickAutopilot, useNavStore } from "../hooks/useNavigation";
import { playerSky } from "../map/weatherFx";
import { useWeatherFxPref } from "../map/weatherPref";
import { usePrefersReducedMotion } from "./portrait/motion";
import WeatherScreen from "./WeatherScreen";
import { useRequestSeq } from "../hooks/useRequestSeq";
import { fogLookup, fogMapKey, fogRowsOf, refreshFogDelta, rowsLookup, setFogRows, useChartFog, type FogLookup } from "../map/fogStore";
import { isExternalMap } from "../map/mapResource";
import DepartDialog from "./nav/DepartDialog";
import MonsoonControl from "./routing/MonsoonControl";
import NavigationView from "./nav/NavigationView";
import { useDaylightPref } from "../time/prefs";
import { BiName } from "./BiName";
import { CrewHireButtons } from "./crew/CrewHire";
import { buySupplies, fillNote, fillPlan, haveText, legOver, legOverText, shortText, supplyDays as fleetSupplyDays, toSuggested, tripShort } from "./panels/supplyKit";
import FleetHoverCard from "./FleetHoverCard";
import VoyageHud, { PickBar } from "./VoyageHud";
import { ShellIcon } from "./shell/ShellIcon";
import { canSeeTown } from "./shell/shellState";
import { EmptyState, InlineError, Kbd } from "./feedback";
import { useIsV2 } from "../ui/uiMode";


/** 地点多于这个数时，地点列表顶部显示查找框。 */
const FILTER_MIN_PLACES = 12;

/** 殖民点的现状在列表中的分组顺序。 */
const SITE_GROUPS: readonly { status: SiteStatus; title: "chartGroupMine" | "chartGroupWild" | "chartGroupClaimed" | "chartGroupOther" }[] = [
  { status: "mine", title: "chartGroupMine" },
  { status: "wild", title: "chartGroupWild" },
  { status: "claimed", title: "chartGroupClaimed" },
  { status: "other", title: "chartGroupOther" },
];

/** 地点标记图（列表、确认框用）。殖民点按现状画（未开拓 / 势力占领 / 殖民地）。 */
function placeArt(statics: StaticView, l: LocView, unknown: boolean, states?: Map<number, SiteState>): Px {
  if (isSite(l)) return drawSiteMarker(siteMark(statics, states?.get(l.id)), { unknown });
  const faction = statics.factions[l.faction];
  const style = markerStyle(faction?.key, faction?.style);
  const flag = faction?.color ?? "#ffffff";
  return l.kind === "port" ? drawPortMarker(style, flag, { unknown }) : drawCityMarker(style, flag, { unknown });
}

/** 势力名称（没有时为空串）。 */
function factionName(statics: StaticView, faction: number | null): string {
  return (faction !== null && statics.factions[faction]?.name) || "";
}

/** 殖民点在列表里的说明文字（未开拓 / 被某势力占领 / 殖民地）。 */
function siteTitle(statics: StaticView, state: SiteState): string {
  switch (state.status) {
    case "mine":
      return t("chartSiteColony", { name: state.name ?? "" });
    case "other":
      return t("chartSiteOther");
    case "claimed":
      return t("chartSiteClaimed", { faction: factionName(statics, state.faction) });
    default:
      return t("chartSiteWild");
  }
}

/** 殖民点的现状（确认框用）。 */
function siteStatusText(statics: StaticView, state: SiteState): string {
  switch (state.status) {
    case "mine":
      return t("chartStatusMine", { name: state.name ?? "" });
    case "other":
      return t("chartStatusOther");
    case "claimed":
      return t("chartStatusClaimed", { faction: factionName(statics, state.faction) });
    default:
      return t("chartStatusWild");
  }
}

/** 在海图或列表上点选了地点：选择目的地时交给出航流程；否则选中地点并切到港口页（殖民点切到殖民地页）。 */
function pickLocation(loc: number) {
  if (chooseDestination(loc)) return;
  // 手动航行、旗舰队在海上：世界图上点地点是“自动驶往”（能去的等待确认，不能去的给出提示）
  if (pickAutopilot(loc)) return;
  const g = useGame.getState();
  const place = locById(g.statics, loc);
  if (place && isSite(place)) {
    focusSite(loc);
    return;
  }
  g.selectLoc(loc);
  g.setTab("port");
}

/** 带木框的小窗：标题牌 + 折叠按钮。 */
function ChartWindow({
  title,
  className,
  open,
  toggleLabel,
  onToggle,
  children,
}: {
  title: string;
  className: string;
  open: boolean;
  toggleLabel: string;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className={`chart-win ${className}${open ? "" : " collapsed"}`}>
      <header className="chart-win-title">
        <h3>{title}</h3>
        <button
          type="button"
          className="chart-win-toggle"
          aria-expanded={open}
          aria-label={toggleLabel}
          title={open ? t("chartCollapse") : t("chartExpand")}
          onClick={onToggle}
        >
          {open ? "−" : "+"}
        </button>
      </header>
      {open && <div className="chart-win-body">{children}</div>}
    </section>
  );
}

/** 图例里列出的天况标记（晴天没有标记）。 */
const LEGEND_SKIES: readonly Exclude<SkyKind, "clear">[] = ["cloudy", "rain", "fog", "storm", "snow"];

/**
 * 图例。weather：后端给出了各海区的天况（旧后端没有时不列天况标记）；
 * lights：后端给出了时刻（旧后端没有时海图不会入夜，不列夜间灯火）。
 */
function Legend({ weather = false, lights = false }: { weather?: boolean; lights?: boolean }) {
  const statics = useGame((s) => s.statics);
  const port = statics?.locations.find((l) => l.kind === "port");
  const city = statics?.locations.find((l) => l.kind === "city");
  // 有殖民点或发现物的世界才列出它们的图例
  const sites = hasSites(statics);
  const discoveries = hasDiscoveries(statics);
  const icon = (px: Px) => <Sprite px={px} scale={1} className="chart-legend-icon" />;
  return (
    <ul className="legend chart-legend" aria-label={t("mapLegend")}>
      <li className="lg-port">
        {icon(statics && port ? placeArt(statics, port, false) : drawPortMarker(markerStyle(undefined), P.red[2]))}
        {t("mapLegendPort")}
      </li>
      <li className="lg-city">
        {icon(statics && city ? placeArt(statics, city, false) : drawCityMarker(markerStyle(undefined), P.red[2]))}
        {t("mapLegendCity")}
      </li>
      {sites && (
        <>
          <li className="lg-site">
            {icon(drawSiteMarker({}))}
            {t("chartLegendSite")}
          </li>
          <li className="lg-claim">
            {icon(drawSiteMarker({ claim: statics?.factions[0]?.color ?? P.red[2] }))}
            {t("chartLegendClaimed")}
          </li>
          <li className="lg-colony">
            {icon(drawSiteMarker({ colony: { flag: PLAYER_FLAG, size: 1 } }))}
            {t("chartLegendColony")}
          </li>
        </>
      )}
      {discoveries && (
        <li className="lg-discovery">
          {icon(drawDiscoveryMarker("ruins"))}
          {t("chartLegendDiscovery")}
        </li>
      )}
      <li className="lg-fleet">
        {icon(drawShip(0, "square", { size: "small", flag: P.gold[3] }))}
        {t("mapLegendFleet")}
      </li>
      <li className="lg-caravan">
        {icon(drawCaravanMarker(0))}
        {t("mapLegendCaravan")}
      </li>
      <li className="lg-other">
        {icon(drawShip(2, "square", { size: "small", flag: P.teal[3] }))}
        {t("mapLegendOther")}
      </li>
      <li className="lg-pirate">
        {icon(drawShip(0, "lateen", { size: "small", pirate: true }))}
        {t("mapLegendPirate")}
      </li>
      <li className="lg-fog">
        {icon(fogSwatch())}
        {t("mapFog")}
      </li>
      <li className="lg-wind">
        {icon(drawWindArrow(2, 4))}
        {t("mapLegendWind")}
      </li>
      {lights && (
        <li className="lg-lights">
          {icon(lightSwatch())}
          {t("chartLegendLights")}
        </li>
      )}
      {weather &&
        LEGEND_SKIES.map((sky) => (
          <li key={sky} className={`lg-sky lg-sky-${sky}`} title={t("chartLegendWeather")}>
            {icon(weatherSwatch(sky))}
            {tk(`chartLegendSky.${sky}`)}
          </li>
        ))}
    </ul>
  );
}

/**
 * 把海图的夜色浓度交给渲染器：按时钟（useClock）、速度（防闪烁）与“昼夜光影”偏好，与 useScenePhase 同一规则。
 * 单独成一个不渲染任何东西的小组件，时钟每分钟走动时只重画它，不牵动整个航海图。
 */
function NightSync({ renderer, ready }: { renderer: { current: MapRenderer | null }; ready: boolean }) {
  const speed = useGame((s) => s.overview?.speed ?? 0);
  const pref = useDaylightPref((s) => s.pref);
  // 只在夜色浓度变了时重画（白天与深夜里浓度不变，时钟每 100 ms 的推送不必经过它）
  const amount = useClockStore((s) => chartNight(s.minute, speed, pref));
  useEffect(() => {
    if (ready) renderer.current?.setNight?.(amount);
  }, [amount, ready, renderer]);
  return null;
}

/**
 * 把天气特效的开关交给渲染器（map/weatherLayer.ts）：设置里的“天气特效”、系统的“减少动态效果”；
 * 玩家在暴风雨里时由全画面效果（WeatherScreen）闪电，海图上的暴风雨跟着它一起亮，自己不另闪；
 * 航行视图盖着世界图时整层不画（看不见，省电）。同 NightSync，不渲染任何东西。
 */
function WeatherSync({ renderer, ready }: { renderer: { current: MapRenderer | null }; ready: boolean }) {
  const on = useWeatherFxPref((s) => s.on);
  const reduced = usePrefersReducedMotion();
  const storm = useGame((s) => playerSky(s.overview) === "storm");
  const navOn = useGame((s) => navActive(s.statics, s.overview));
  const navView = useNavStore((s) => s.view);
  const covered = navOn && navView === "nav";
  useEffect(() => {
    if (ready) renderer.current?.setWeatherFx?.({ enabled: on && !covered, reduced, lightning: !(on && storm) });
  }, [on, covered, reduced, storm, ready, renderer]);
  return null;
}

/**
 * 出航确认：目的地（殖民点另有现状与地形）、预计航程、粮水，确认后提交 SetSail。
 * 粮水（V01）：够几天照后端的 supplies_days；新界面里“现有粮水”写“粮 X / 水 Y，够 N 天”，撑不到这趟走完时那一条写清还差多少粮、多少水，
 * 就地“补给到建议量”（钱或舱位不够时只补齐缺口），买完提示条里回一句。旧界面照旧（数字照 V01 的字段算）。
 */
function DepartureDialog() {
  const target = useVoyageStore((s) => s.target);
  const statics = useGame((s) => s.statics);
  // 按字段选取（P14a）：没在确认出航时不取概览（换日时合着的对话框不重渲染）
  const overview = useGame((s) => (target !== null ? s.overview : null));
  const fleet = flagship(overview);
  const fleetId = fleet?.id;
  const [preview, setPreview] = useState<SailPreview | null | undefined>(undefined);
  const [known, setKnown] = useState<boolean | null>(null);
  const [siteInfo, setSiteInfo] = useState<SiteView | null>(null);
  const [busy, setBusy] = useState(false);
  const sailRef = useRef<HTMLButtonElement>(null);
  const repickRef = useRef<HTMLButtonElement>(null);
  const v2 = useIsV2();
  // 新界面：“起航”旁边的原因（无法到达、船员不足、没有舰队：做不了；粮水不够全程：有风险）都用 aria-describedby 指过去
  const blockedId = useId();
  const crewId = useId();
  const shortId = useId();
  const overId = useId();
  const noFleetId = useId();
  const targetPlace = locById(statics, target);
  const targetIsSite = !!targetPlace && isSite(targetPlace);
  // 换了一局 / 重连之后重新问（在路上的回复不再采用，P03）
  const reqSeq = useRequestSeq();
  // FIX5F：这一程的天数大于粮水够用的天数时另写一句（预估说还差粮水时由下面原有的那条写）；够用天数照出航预览的 supplies_days（旧后端用舰队的）。
  // FIX5F 第二趟（协调方裁决）：这个框照原来的设计，不加“先去补给”、不改“起航”的名字——粮水不够时只把那条里的“补给到建议量”做成主按钮的样式、“起航”降成次要样式
  const haveDays = preview ? (preview.supplies_days !== undefined ? preview.supplies_days : fleet ? fleetSupplyDays(fleet) : null) : null;
  const legLong = !!preview && legOver(preview.days, haveDays);

  useEffect(() => {
    if (target === null || fleetId === undefined) return;
    let alive = true;
    setPreview(undefined);
    setKnown(null);
    setSiteInfo(null);
    api
      .sailPreview(fleetId, target)
      .then((p) => {
        if (!alive) return;
        setPreview(p);
        useVoyageStore.setState({ plan: p ? { dest: target, path: p.path } : null });
      })
      .catch(() => {
        if (alive) setPreview(null);
      });
    // 是否到访过：殖民点查殖民点视图（顺便拿到地形），其余查港口视图
    const knownQuery = targetIsSite
      ? api.site(target).then((v) => {
          if (alive) setSiteInfo(v);
          return v.known;
        })
      : api.port(target).then((p) => p.known);
    knownQuery
      .then((k) => {
        if (!alive) return;
        setKnown(k);
        rememberKnown(target, k);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [target, fleetId, targetIsSite, reqSeq]);

  useEffect(() => {
    if (!v2) {
      if (preview) sailRef.current?.focus();
      return;
    }
    // 新界面：预估到了就把焦点放进对话框——“起航”能点就是它（回车起航）；不能点（无法到达、船员不足）就是“重新选择”，
    // 不把焦点留在对话框外面，也不让回车去点一个注定被拒绝的“起航”
    if (preview === undefined) return;
    const sail = sailRef.current;
    if (sail && !sail.disabled) sail.focus();
    else repickRef.current?.focus();
  }, [preview, v2]);

  if (target === null || !statics) return null;
  const place = locById(statics, target);
  if (!place) return null;
  const site = isSite(place);
  const state = site ? siteState(siteStates(overview), target) : null;
  const supplyDays = fleet ? fleetSupplyDays(fleet) : null;
  const short = !!preview && !!fleet && tripShort(fleet, preview);
  // 一键补给到本次航程的建议量（与“舰队”页的同一个按钮；只在港内、差量大于 0 时出现）
  const { food: needFood, water: needWater } = fleet && preview ? toSuggested(fleet, preview) : { food: 0, water: 0 };
  const canSupply = !!fleet && fleet.docked !== null && needFood + needWater > 0;
  // 新界面：粮水不够这趟时就地补足（先补到建议量，钱或舱位不够时只补齐缺口）
  const fill = v2 && short && fleet && preview ? fillPlan(fleet, statics.rules, preview, overview?.cash ?? 0) : null;
  // 船员少于最低人数开不了船：写明差多少，并给一键补到最低人数（在港时）
  const crewShort = !!fleet && fleet.crew < fleet.crew_min;
  // 新界面：“起航”旁边写着的原因（做不了的在前，有风险的在后）；没有原因时不加这个属性
  const sailDescribedBy =
    [preview === null ? blockedId : null, !fleet ? noFleetId : null, crewShort ? crewId : null, short ? shortId : null, legLong && !short ? overId : null]
      .filter(Boolean)
      .join(" ") || undefined;
  // FIX5F 第二趟：粮水不够这趟、就地能补时，“补给到建议量”是主按钮的样式，“起航”降成次要样式（名字、焦点不变）
  const fillFirst = v2 && short && canSupply && !!fill && !fill.block;
  const resupply = async () => {
    if (!fleet) return;
    setBusy(true);
    await useGame.getState().submit({ Resupply: { owner: "player", fleet: fleet.id, food: needFood, water: needWater } });
    setBusy(false);
  };
  const fillNow = async () => {
    if (!fleet || !fill) return;
    setBusy(true);
    await buySupplies(fleet.id, fill.buy, fill.cost);
    setBusy(false);
  };
  // 殖民点的 faction 是占位值，不显示
  const faction = site ? "" : (statics.factions[place.faction]?.name ?? "");
  const info = place.site ?? siteInfo?.info ?? null;
  const confirm = async () => {
    setBusy(true);
    await confirmDeparture();
    setBusy(false);
  };
  // 船员不足的原因与一键补到最低人数（新界面里排在粮水的提醒前面，旧界面照旧在它后面）
  const crewEl = fleet && crewShort && (
    <div className="chart-crew" data-testid="departure-crew-short">
      {/* 新界面：少于最低人数内核拒绝出航——“起航”不可用，原因（这一条）由它的 aria-describedby 指过来 */}
      <InlineError
        tone="blocked"
        id={crewId}
        reason={t("chartCrewShort", { crew: fleet.crew, min: fleet.crew_min })}
        v1={<p className="chart-warn">{t("chartCrewShort", { crew: fleet.crew, min: fleet.crew_min })}</p>}
      />
      <CrewHireButtons fleet={fleet} compact testId="departure-crew-hire" />
    </div>
  );
  return (
    <div className="chart-dialog-backdrop">
      <section
        className="chart-win chart-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="chart-confirm-title"
        data-testid="departure-dialog"
        onKeyDown={(e) => {
          if (e.key === "Escape") repickDestination();
        }}
      >
        <header className="chart-win-title">
          <h3 id="chart-confirm-title">{t("chartConfirmTitle")}</h3>
        </header>
        <div className="chart-dialog-body">
          <div className="chart-dialog-art" aria-hidden="true">
            <Sprite px={placeArt(statics, place, known === false, siteStates(overview))} scale={3} />
          </div>
          <dl className="chart-kv">
            <dt>{t("chartConfirmDest")}</dt>
            <dd>
              <BiName as="strong" className="chart-dest-name" zh={place.name} en={place.name_en} testId="departure-dest" />
              {faction && <span className="chart-faction">{faction}</span>}
              {known === false && <span className="chart-tag">{site ? t("chartConfirmNewSite") : t("chartConfirmNew")}</span>}
            </dd>
            {state && (
              <>
                <dt>{t("chartConfirmStatus")}</dt>
                <dd data-testid="departure-status">
                  <span className={`chart-tag site-${state.status}`}>{siteStatusText(statics, state)}</span>
                </dd>
              </>
            )}
            {state && info && (
              <>
                <dt>{t("chartConfirmTerrain")}</dt>
                <dd>
                  {t("chartTerrainValue", { terrain: tk(`terrain.${info.terrain}`), fertility: info.fertility, hazard: info.hazard })}
                </dd>
              </>
            )}
            {preview && (
              <>
                <dt>{t("chartConfirmDays")}</dt>
                <dd data-testid="departure-days">{t("chartHudDaysValue", { n: preview.days })}</dd>
                <dt>{t("chartConfirmSupplies")}</dt>
                <dd>{preview.supplies}</dd>
              </>
            )}
            {fleet && (
              <>
                <dt>{t("chartConfirmHave")}</dt>
                <dd className={short ? "chart-warn" : undefined} data-testid="departure-have">
                  {v2
                    ? haveText(fleet)
                    : t("chartConfirmHaveValue", {
                        food: fleet.food,
                        water: fleet.water,
                        days: supplyDays ?? t("chartHudUnknown"),
                      })}
                </dd>
                <dt>{t("chartConfirmCrew")}</dt>
                <dd className={crewShort ? "chart-warn" : undefined} data-testid="departure-crew">
                  {t("chartConfirmCrewValue", { crew: fleet.crew, min: fleet.crew_min, max: fleet.crew_max })}
                </dd>
              </>
            )}
          </dl>
          {state?.status === "wild" && (
            <p className="chart-note">
              {t("chartConfirmFoundHint", { settlers: statics.rules.colony_min_settlers, cost: statics.rules.colony_found_cost })}
            </p>
          )}
          {(state?.status === "claimed" || state?.status === "other") && <p className="chart-note">{t("chartConfirmTakenHint")}</p>}
          {preview === undefined && <p className="chart-note">{t("chartConfirmLoading")}</p>}
          {preview === null && (
            <InlineError
              tone="blocked"
              id={blockedId}
              reason={site ? t("chartConfirmNoRouteSite") : t("chartConfirmNoRoute")}
              fix={t("v2.voyage.noRouteFix")}
              v1={<p className="chart-warn">{site ? t("chartConfirmNoRouteSite") : t("chartConfirmNoRoute")}</p>}
            />
          )}
          {/* 新界面：做不了的原因（船员不足）排在有风险的原因（粮水不够全程）前面——矮屏上先看到的是“起航”为什么不能点 */}
          {v2 && crewEl}
          {/* 新界面：粮水不够全程时，“补给到建议量”就放在这一条里（下面单独的补给按钮就不再出现）。
              这是风险、不是失败（玩家可以照样出航）：用安静的“提醒”（黄铜细线、不打断读屏），“起航”的 aria-describedby 指过来 */}
          {short && fleet && preview && (
            <InlineError
              tone="blocked"
              id={shortId}
              className="v2-voyage-risk"
              reason={shortText(fleet, preview)}
              fix={canSupply && fill ? fillNote(fill, preview.supplies) : t("v2.voyage.shortFixSea")}
              action={
                canSupply && fill
                  ? {
                      label: fill.margin ? t("chartResupply", { cost: money(fill.cost) }) : tz("sup.fillGap", { cost: money(fill.cost) }),
                      onClick: () => void fillNow(),
                      disabled: busy || !!fill.block,
                      primary: fillFirst,
                    }
                  : undefined
              }
              v1={<p className="chart-warn">{t("chartConfirmShort")}</p>}
            />
          )}
          {/* FIX5F：预估没说缺多少、但天数已经超过粮水够用的天数（旧后端、或余量算法不同）时，单独写一句 */}
          {legLong && !short && fleet && preview && haveDays !== null && (
            <p className="chart-warn" id={overId} data-testid="departure-leg-over">
              {legOverText(preview.days, haveDays, fleet.docked === null)}
            </p>
          )}
          {!v2 && crewEl}
          {canSupply && !(v2 && short) && (
            <p className="chart-supply">
              <button type="button" className="chart-btn" disabled={busy} onClick={() => void resupply()} data-testid="departure-resupply">
                {t("chartResupply", {
                  cost: money(needFood * statics.rules.food_price + needWater * statics.rules.water_price),
                })}
              </button>
            </p>
          )}
          {!fleet && (
            <InlineError
              tone="blocked"
              id={noFleetId}
              reason={t("chartNoFleet")}
              fix={t("v2.voyage.noFleetFix")}
              v1={<p className="chart-warn">{t("chartNoFleet")}</p>}
            />
          )}
          {preview && (overview?.speed ?? 0) === 0 && <p className="chart-note">{t("chartConfirmAutoStart")}</p>}
        </div>
        {/* 新界面：无法到达时下一步是“重新选择”——它当主按钮（手机上整宽贴底），不可用的“起航”退到上一行 */}
        <footer className={v2 && preview === null ? "chart-dialog-actions v2-voyage-noroute" : "chart-dialog-actions"}>
          <button
            ref={sailRef}
            type="button"
            className={fillFirst ? "chart-btn" : "chart-btn primary"}
            disabled={!preview || !fleet || busy || (v2 && crewShort)}
            aria-describedby={v2 ? sailDescribedBy : undefined}
            onClick={() => void confirm()}
          >
            {t("chartConfirmSail")}
            <Kbd k="Enter" />
          </button>
          <button ref={repickRef} type="button" className={v2 && preview === null ? "chart-btn v2-voyage-repick" : "chart-btn"} onClick={repickDestination}>
            {t("chartConfirmRepick")}
            <Kbd k="Esc" />
          </button>
          <button type="button" className="chart-btn" onClick={cancelDeparture}>
            {t("chartConfirmCancel")}
          </button>
        </footer>
      </section>
    </div>
  );
}

/** 列表里的一组地点：小标题（带个数）+ 两列按钮。 */
function PlaceGroup({ id, title, className, children }: { id: string; title: string; className?: string; children: ReactNode }) {
  return (
    <div className={className ? `chart-loc-group ${className}` : "chart-loc-group"} role="group" aria-labelledby={id}>
      <h5 className="chart-subgroup-title" id={id}>
        {title}
      </h5>
      <div className="chart-loc-grid">{children}</div>
    </div>
  );
}

interface PlaceListProps {
  statics: StaticView;
  /** 有归属的殖民点的状态 */
  states: Map<number, SiteState>;
  /** 到过的港口与城市的市况（不是“平稳”的） */
  conditions: Map<number, PortCondition>;
  /** 有自己舰队停泊的地点 */
  fleetsAt: Set<number>;
  /** 某格是否已揭开（还没有迷雾时为 null：全部当作揭开） */
  fogAt: FogLookup | null;
  selectedLoc: number | null;
  picking: boolean;
  /** 看见过的地点（Overview.sighted；没有这个字段时为 null，全部列出） */
  sighted?: ReadonlySet<number> | null;
  /** 旗舰队停泊的地点（在海上为 null）：新界面里选目的地时它不算“能去” */
  hereLoc?: number | null;
}

/**
 * 地点列表（港口、内陆城市、殖民点分组）。只在列表内容相关的数据变化时重画：
 * 每天的概览推送不会让几十个地点按钮跟着重建。
 */
const PlaceList = memo(function PlaceList({
  statics,
  states,
  conditions,
  fleetsAt,
  fogAt,
  selectedLoc,
  picking,
  sighted = null,
  hereLoc = null,
}: PlaceListProps) {
  const [query, setQuery] = useState("");
  const v2 = useIsV2();
  const uid = useId();
  const q = query.trim().toLowerCase();
  // 查找时中文名、英文正名与 key 都认；没看见过的地点不列
  const match = (l: LocView) =>
    (sighted === null || sighted.has(l.id)) &&
    (q === "" || l.name.toLowerCase().includes(q) || (l.name_en?.toLowerCase().includes(q) ?? false) || l.key.toLowerCase().includes(q));
  const unknown = (l: LocView) => !!fogAt && !fogAt(l.x, l.y);
  // 选目的地时哪些地点能点：港口与殖民点。新界面另把旗舰队所在的港口排除（chooseDestination 会拒绝它），
  // 它和内陆城市一样淡下去、没有“能去”的黄铜描边；旧界面照旧（class 不变）
  const pickable = (l: LocView) => picking && canSailTo(l) && !(v2 && l.id === hereLoc);
  const ports = statics.locations.filter((l) => !isSite(l) && l.kind === "port" && match(l));
  const cities = statics.locations.filter((l) => !isSite(l) && l.kind !== "port" && match(l));
  const allSites = statics.locations.filter((l) => isSite(l) && (sighted === null || sighted.has(l.id)));
  const sites = allSites.filter(match);
  const bySite = (status: SiteStatus) => sites.filter((l) => siteState(states, l.id).status === status);
  const showFilter = statics.locations.length > FILTER_MIN_PLACES;

  const locButton = (l: LocView) => {
    const u = unknown(l);
    const kind = isSite(l) ? siteTitle(statics, siteState(states, l.id)) : tk(`loc.${l.kind}`);
    const base = u ? t("paren", { text: kind, note: t("chartUnknownPlace") }) : kind;
    // 列表里只显示当前语言的名字，悬停提示里附上另一种写法（中文界面给英文原名）
    const other = otherName(l);
    // 市况（不是平稳的）：按钮右上角一面小三角旗（颜色同港口窗口的市况标签），文字在悬停提示与读屏文字里
    const cond = conditions.get(l.id);
    const condText = cond ? tk(`portCondition.${cond}`) : null;
    const tip = [base, condText, other].filter(Boolean).join(" · ");
    return (
      <button
        key={l.id}
        type="button"
        className={[
          "loc",
          l.id === selectedLoc ? "active" : "",
          u ? "unknown" : "",
          pickable(l) ? "pickable" : "",
          cond ? `chart-cond chart-cond-${cond}` : "",
        ]
          .filter(Boolean)
          .join(" ")}
        title={tip}
        onClick={() => pickLocation(l.id)}
      >
        <Sprite px={placeArt(statics, l, u, states)} scale={1} className="chart-loc-icon" />
        <span className="chart-loc-name">
          {l.name}
          {fleetsAt.has(l.id) ? " ⛵" : ""}
        </span>
        {condText && (
          <span className="chart-cond-text" data-testid={`chart-condition-${l.id}`}>
            {condText}
          </span>
        )}
      </button>
    );
  };

  const nothing = q !== "" && ports.length + cities.length + sites.length === 0;
  // 新界面：查找没有结果时，空状态紧跟在查找框下面，下面不再有空的分组（“未开拓之地”的标题不留在空状态上面，
  // 免得看成只是殖民点这一组没有结果）；查找时殖民点这一组一个都不剩，也不留它的标题。旧界面照旧
  const showSites = v2 ? sites.length > 0 : allSites.length > 0;
  const emptyEl = nothing && (
    <EmptyState
      className="chart-filter-empty"
      text={t("chartFilterEmpty")}
      action={{ label: t("v2.voyage.clearFilter"), onClick: () => setQuery("") }}
      v1={<p className="chart-note chart-filter-empty">{t("chartFilterEmpty")}</p>}
    />
  );
  return (
    <>
      {showFilter && (
        <div className="chart-filter">
          <input
            type="search"
            value={query}
            placeholder={t("chartFilter")}
            aria-label={t("chartFilter")}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}
      {v2 && emptyEl}
      {!(v2 && nothing) && (
        <nav className="loc-list chart-loc-list" aria-label={t("mapLocations")}>
          {ports.length > 0 && (
            <PlaceGroup id={`${uid}-ports`} title={t("chartGroupPorts", { n: ports.length })}>
              {ports.map(locButton)}
            </PlaceGroup>
          )}
          {cities.length > 0 && (
            <PlaceGroup id={`${uid}-cities`} title={t("chartGroupCities", { n: cities.length })}>
              {cities.map(locButton)}
            </PlaceGroup>
          )}
        </nav>
      )}
      {showSites && (
        <>
          <h4 className="chart-group-title" id={`${uid}-sites`}>
            {t("chartSites")}
          </h4>
          <nav className="loc-list chart-loc-list chart-site-list" aria-labelledby={`${uid}-sites`}>
            {SITE_GROUPS.map(({ status, title }) => {
              const list = bySite(status);
              if (list.length === 0) return null;
              return (
                <PlaceGroup key={status} id={`${uid}-site-${status}`} className={`group-${status}`} title={t(title, { n: list.length })}>
                  {list.map(locButton)}
                </PlaceGroup>
              );
            })}
          </nav>
        </>
      )}
      {!v2 && emptyEl}
    </>
  );
});

/**
 * 航海图里各自订阅 store 的子组件（P14a）：它们的 props 都是稳定的引用（渲染器的 ref、就绪与否、地图来源），
 * 包一层 memo，航海图因每天的概览重渲染时它们不跟着重渲染——只在自己选取的字段变了时才重渲染。
 */
const WeatherScreenM = memo(WeatherScreen);
const PickBarM = memo(PickBar);
const VoyageHudM = memo(VoyageHud);
const DepartureDialogM = memo(DepartureDialog);
const NightSyncM = memo(NightSync);
const WeatherSyncM = memo(WeatherSync);
const MonsoonControlM = memo(MonsoonControl);
const NavigationViewM = memo(NavigationView);
const TripSummaryCardM = memo(TripSummaryCard);
const DepartDialogM = memo(DepartDialog);

/** 殖民点归属的签名：内容不变时保持同一个状态表（列表不必重画）。 */
function sitesSignature(o: Overview | null): string {
  if (!o) return "";
  const claims = (o.site_claims ?? []).map((c) => `${c.loc}:${c.faction ?? "-"}:${c.colony ?? "-"}:${c.mine ? 1 : 0}`).join(",");
  const colonies = (o.colonies ?? []).map((c) => `${c.loc}:${c.id}:${c.name}:${c.population}`).join(",");
  return `${claims}|${colonies}`;
}

/** 主界面的航海图：PixiJS 画布 + 可访问的地点列表（渲染不可用时也能操作）。 */
export default function MapView() {
  const statics = useGame((s) => s.statics);
  const overview = useGame((s) => s.overview);
  const selectedLoc = useGame((s) => s.selectedLoc);
  const picking = useVoyageStore((s) => s.picking);
  const legendPref = useChartUi((s) => s.legend);
  const placesPref = useChartUi((s) => s.places);
  const host = useRef<HTMLDivElement>(null);
  const renderer = useRef<MapRenderer | null>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [fogRows, setFogRowsState] = useState<string[] | null>(null);
  // 悬停着的别家船队（渲染器在指针移到标记上时给出）：显示船长信息卡
  const [fleetHover, setFleetHover] = useState<FleetHover | null>(null);
  const compact = isCompact(useLayout());
  const v2 = useIsV2();
  // 海图的数据来源：经典世界就是静态数据本身；大地图先取地图资源
  const { source, failed: resourceFailed } = useChartSource(statics);
  const external = isExternalMap(statics);

  useEffect(() => {
    if (!source || !host.current) return;
    let cancelled = false;
    // 每个新渲染器都要重新拿一次迷雾：就绪状态随渲染器重置
    setReady(false);
    // 经典世界照旧只传静态数据（渲染器自己整理海图输入）；大地图另给并好图层的输入与共用后台线程的键
    // 大地图的迷雾由渲染器直接从迷雾的 store 喂给后台线程（位图与区间，不建整张文本）
    const made = source.resource
      ? createMapRenderer(host.current, source.statics, pickLocation, { input: source.input, hubKey: source.hubKey, fogMap: source.fogMap })
      : createMapRenderer(host.current, source.statics, pickLocation);
    made
      .then((r) => {
        if (cancelled) {
          r.destroy();
          return;
        }
        renderer.current = r;
        r.setHoverFleet?.(setFleetHover);
        const s = useGame.getState();
        r.update(s.overview, s.selectedLoc);
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      renderer.current?.destroy();
      renderer.current = null;
      setFleetHover(null);
    };
  }, [source]);

  // 航海图此刻看得见（P14a）：舞台是航海图（靠港时玩家可能在看街景），又没有被航行视图整个盖住。
  // 看不见时不把每天的概览推给渲染器——天气重画与模糊、天况标记的挑选、量两侧遮挡（强制排版）每天要几十毫秒，
  // 画在一张看不见的画布上；重新看得见时这条 effect 因 shown 变了而立即按当时的概览与选中的地点更新一次。
  const navView = useNavStore((s) => s.view);
  const shown = useGame((s) => (!canSeeTown(s.overview) || s.stage === "chart") && !(navView === "nav" && navActive(s.statics, s.overview)));
  useEffect(() => {
    if (!shown) return;
    renderer.current?.update(overview, selectedLoc);
  }, [overview, selectedLoc, shown]);

  // 探索进度变化时重新获取迷雾
  const fogVersion = overview?.fog_version ?? 0;
  const fogMap = statics ? fogMapKey(statics) : "";
  useEffect(() => {
    if (external || !ready || fogVersion === 0) return;
    let alive = true;
    api
      .fog()
      .then((rows) => {
        if (!alive) return;
        renderer.current?.setFog(rows);
        setFogRowsState(rows);
        setFogRows(fogMap, rows);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [fogVersion, ready, external, fogMap]);
  // 大地图：fog_delta 的位图增量（不等渲染器：航行视图也要用）；后端没有这个查询时退回整张的 fog()
  const mapW = statics?.map.width ?? 0;
  const mapH = statics?.map.height ?? 0;
  useEffect(() => {
    if (!external || fogVersion === 0) return;
    let alive = true;
    refreshFogDelta(fogMap, mapW, mapH).catch(() =>
      api
        .fog()
        .then((rows) => {
          if (alive) setFogRows(fogMap, rows);
        })
        .catch(() => {}),
    );
    return () => {
      alive = false;
    };
  }, [external, fogVersion, fogMap, mapW, mapH]);
  // 大地图的迷雾在 store 里（位图，不建文本）：变化的序号变了才重新取查法
  const fogSeq = useChartFog((s) => (external && s.map === fogMap ? s.seq : 0));
  // 渲染器就绪（或重建）时：直接从 store 取迷雾的渲染器不用管；旧的渲染器接口（只认整张文本）交给它一份文本
  useEffect(() => {
    const r = renderer.current;
    if (!external || !ready || fogSeq === 0 || !r || r.fogFromStore) return;
    const rows = fogRowsOf(useChartFog.getState(), fogMap);
    if (rows) r.setFog(rows);
  }, [external, ready, fogSeq, fogMap]);
  // 地点列表问“揭开了没有”：经典世界查 fog() 的文本，大地图直接查位图
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const storeFog = useMemo(() => (external ? fogLookup(useChartFog.getState(), fogMap) : null), [external, fogMap, fogSeq]);
  const classicFog = useMemo(() => (fogRows ? rowsLookup(fogRows) : null), [fogRows]);
  const fogAt = external ? storeFog : classicFog;

  // 列表用到的概览数据按内容取签名：内容不变时传给列表的对象也不变
  const sitesSig = sitesSignature(overview);
  const dockedSig = (overview?.fleets ?? [])
    .map((f) => f.docked)
    .filter((d): d is number => d !== null)
    .join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const states = useMemo(() => siteStates(overview), [sitesSig]);
  const fleetsAt = useMemo(() => new Set(dockedSig === "" ? [] : dockedSig.split(",").map(Number)), [dockedSig]);
  const conditionsSig = (overview?.port_conditions ?? []).map((c) => `${c.loc}:${c.condition}`).join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const conditions = useMemo(() => portConditions(overview), [conditionsSig]);
  // 看见过的地点（第九批；没有这个字段时为 null）
  const sightedSig = Array.isArray(overview?.sighted) ? overview.sighted.join(",") : null;
  const sighted = useMemo(() => (sightedSig === null ? null : new Set(sightedSig === "" ? [] : sightedSig.split(",").map(Number))), [sightedSig]);

  if (!statics) return null;
  const atSea = flagship(overview)?.docked === null;
  // 手机上舞台小：两个小窗缺省收起（选目的地时地点列表照样展开）。
  // 新界面在桌面上也缺省收起：海图本身就是点选地点的地方，
  // 地点列表与图例只剩左上角两枚标题签，点一下再展开（展开过就记着）；旧界面照旧在靠港时展开
  const legendOpen = legendPref ?? (v2 ? false : !atSea && !compact);
  const placesOpen = (placesPref ?? (v2 ? picking : (!atSea && !compact) || picking)) || failed;
  return (
    <div className={picking ? "map chart-view picking" : "map chart-view"} data-testid="map-container">
      <div className="map-canvas" ref={host} data-testid="map-canvas" aria-label={t("mapTitle")} />
      {/* 玩家所在处的全画面天气：海图画布之上，左侧栏、按钮与对话框之下（航行视图盖着时由它自己的那一份画） */}
      <WeatherScreenM layer="chart" />
      {(failed || resourceFailed) && <p className="empty chart-fail">{t("mapUnavailable")}</p>}
      <PickBarM />
      {ready && (
        <div className="chart-zoom" role="group" aria-label={t("layout.zoomGroup")}>
          <button type="button" className="chart-zoom-btn" aria-label={t("layout.zoomIn")} title={t("layout.zoomIn")} onClick={() => renderer.current?.zoomBy?.(1)}>
            +
          </button>
          <button type="button" className="chart-zoom-btn" aria-label={t("layout.zoomOut")} title={t("layout.zoomOut")} onClick={() => renderer.current?.zoomBy?.(-1)}>
            −
          </button>
          <button type="button" className="chart-zoom-btn chart-zoom-fit" aria-label={t("layout.zoomFit")} title={t("layout.zoomFit")} onClick={() => renderer.current?.zoomFit?.()}>
            <ShellIcon name="map" scale={1} />
          </button>
        </div>
      )}
      {fleetHover && <FleetHoverCard statics={statics} hover={fleetHover} />}
      <div className="chart-side">
        <VoyageHudM inMap />
        <ChartWindow
          title={t("chartWinPlaces")}
          className="chart-places-win"
          open={placesOpen}
          toggleLabel={t("chartTogglePlaces")}
          onToggle={() => useChartUi.setState({ places: !placesOpen })}
        >
          <PlaceList
            statics={statics}
            states={states}
            conditions={conditions}
            fleetsAt={fleetsAt}
            fogAt={fogAt}
            selectedLoc={selectedLoc}
            picking={picking}
            sighted={sighted}
            hereLoc={flagship(overview)?.docked ?? null}
          />
        </ChartWindow>
        <ChartWindow
          title={t("chartWinLegend")}
          className="chart-legend-win"
          open={legendOpen}
          toggleLabel={t("chartToggleLegend")}
          onToggle={() => useChartUi.setState({ legend: !legendOpen })}
        >
          <Legend weather={(overview?.weather?.length ?? 0) > 0} lights={typeof overview?.minute === "number"} />
        </ChartWindow>
      </div>
      <DepartureDialogM />
      <NightSyncM renderer={renderer} ready={ready} />
      <WeatherSyncM renderer={renderer} ready={ready} />
      <MonsoonControlM renderer={renderer} ready={ready} />
      {/* R10-Q02：置顶任务的去处（港口上的小图钉；在画面外时画面边缘一枚箭头） */}
      <QuestChartMark renderer={renderer} ready={ready} />
      <NavigationViewM source={source} />
      <TripSummaryCardM source={source} />
      <DepartDialogM key={flagship(overview)?.docked ?? "sea"} source={source} />
    </div>
  );
}
