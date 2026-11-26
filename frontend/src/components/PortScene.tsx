// 港口街景（主舞台）：会动的像素街景 + 叠在每座设施建筑上的透明按钮 + 左上角的港口名牌与“出港”按钮。
// 画面由 scene/port.ts 合成；这里只负责取数据、处理悬停与点击。
// 所有可点击的像素区域都是真正的 <button>（可访问名称 = 设施名），键盘与读屏软件同样能操作。
// “出港”放在左上角的名牌下面而不是船旁边：港口窗口停靠在舞台右侧，会盖住海湾里的船。
//
// 昼夜与天气：时段取 useScenePhase()（按时钟、速度与“昼夜光影”偏好，4× 及以上固定为白天），天况取当地（sceneLook.ts）；
// 时段或天况变化时两种画面在约 0.8 秒内交叉淡化；4× 及以上不闪电，天况至少停留 2 秒才换。
//
// 殖民点（kind 为 site）：
// · 无人占领：荒野海湾，空地（layout.found）上放“建立殖民地”按钮，点击打开港口窗口里的建立对话框；
// · 你的殖民地：按殖民建筑与等级、人口画成殖民地（开拓者风格、主角旗色），每座建筑一个热点，点击打开殖民地窗口并定位到它；
//   殖民点没有市场，殖民地只画仓库（殖民地库存，点击打开装卸一节）与船厂；
// · 势力据点与其他商会的殖民地：按所有者的风格与旗色画一个小聚落，不可进入。
//
// 旗舰队船员少于最低人数（开不了船）时，名牌下多一块提示与“补到最低人数”按钮（玩家反馈“不知道船员如何补充”）。
//
// 网页自适应：街景比舞台宽（手机竖屏、竖放的平板）时可以左右拖动——触屏用手指、鼠标按住拖或滚轮（hooks/usePanArea.ts），
// 一开始横向居中、纵向贴底；左右还有没看到的部分时边上有一道提示。手机横屏（矮舞台）按 1 倍画，整条街放得下，不裁掉上排的建筑。
//
// FIX4F：旗舰队停在港里时，街景（连同“出港”）始终是船停的那座港；在航海图上点选别的港只换港口窗口里的资料，不换街景
// （1113b 实测：船停在下田、点了堺，街景换成堺、“出港”不见了）。船在海上时照旧画选中的地点。点街景里的建筑会先选回这座港。
import { useCallback, useMemo, useRef, useState, type RefObject } from "react";
import { colonyBuildingIcon } from "../art/icons";
import { PLAYER_FLAG } from "../art/map";
import { Px } from "../art/px";
import { PixelStage, Sprite, type StageLayout } from "../art/Sprite";
import { useScenePhase } from "../hooks/useClock";
import { beginDeparture } from "../hooks/useVoyage";
import { usePanArea } from "../hooks/usePanArea";
import { useView } from "../hooks/useView";
import { useLayout } from "../hooks/useViewport";
import { pct, t, tk } from "../i18n";
import { tz } from "../i18n/zhOnly";
import { goFacility } from "./panels/goFacility";
import { api } from "../ipc/api";
import { locById } from "../ipc/byId";
import type { LocView, Overview, StaticView } from "../ipc/types";
import { extendSky } from "../scene/extend";
import {
  composePortScene,
  crossfade,
  layoutPortScene,
  LookFader,
  SCENE_HEIGHT,
  SCENE_MIN_WIDTH,
  sceneSkyTop,
  type PortSceneParams,
} from "../scene/port";
import { flagship, useGame, type Facility } from "../store/game";
import { openColony, openFoundDialog } from "./colony/colonyUi";
import { buildingIdOf, claimAt, colonySceneInput, myColonyAt } from "./colony/model";
import { BiName } from "./BiName";
import { CrewHireButtons } from "./crew/CrewHire";
import { Empty } from "./common";
import { iconPx } from "./panels/panelArt";
import { stageName } from "./port/devScale";
import { sceneParams } from "./port/params";
import { sceneWeather, useHeldWeather } from "./port/sceneLook";
import { openWindow } from "./shell/shellState";

export default function PortScene() {
  const statics = useGame((s) => s.statics);
  const overview = useGame((s) => s.overview);
  const selectedLoc = useGame((s) => s.selectedLoc);
  // 旗舰队停泊的港口（在海上为 null）：停着时街景就画这座港
  const dockedAt = useGame((s) => flagship(s.overview)?.docked ?? null);
  const loc = dockedAt ?? selectedLoc;
  // 街景里的地点；没看见过（已从静态数据里滤掉）时为 undefined，街景不画
  const place = locById(statics, loc);
  const isSite = place?.kind === "site";
  const { data: port } = useView(loc === null || isSite ? null : `port:${loc}`, () => api.port(loc ?? 0));
  const colonyId = isSite && loc !== null ? myColonyAt(overview, loc) : null;
  const { data: colonies } = useView(colonyId !== null ? "colonies" : null, () => api.colonies());
  const [hover, setHover] = useState<Facility | null>(null);
  const [hoverBld, setHoverBld] = useState<string | null>(null);
  const buffer = useRef<Px | null>(null);
  const fadeBuf = useRef<Px | null>(null);
  const tall = useRef<Px | null>(null);
  // 时段与天况的淡入淡出：10 fps 下 8 帧 ≈ 0.8 秒
  const fader = useRef(new LookFader<SceneLookParams>(8));
  const phase = useScenePhase();
  const speed = useGame((s) => s.overview?.speed ?? 0);
  const weather = useHeldWeather(sceneWeather(statics, overview, loc), speed);
  const look = useMemo<SceneLookParams>(
    () => ({ time: phase, weather: weather.sky, windX: weather.windX, windStrength: weather.windStrength, lightning: speed < 4 }),
    [phase, weather.sky, weather.windX, weather.windStrength, speed],
  );
  // 手机横屏的舞台很矮：按 1 倍画（整条街放得下）；其余至少 2 倍，放不下时左右拖动
  const layout = useLayout();
  const sceneRoot = useRef<HTMLDivElement>(null);
  const scroller = useMemo<RefObject<HTMLElement | null>>(
    () => ({
      get current() {
        return sceneRoot.current?.querySelector<HTMLElement>(":scope > .pixel-stage") ?? null;
      },
    }),
    [],
  );

  const base = useMemo(() => {
    if (!statics || loc === null || !place) return null;
    const p = sceneParams(statics, overview, loc, colonySceneInput(statics, overview, loc, colonies));
    if (p.kind !== "colony") return p;
    // 殖民点没有市场：你的殖民地只留仓库与船厂；别人的据点不可进入，不画设施
    const facilities = colonyId !== null ? p.facilities.filter((f) => f !== "market") : [];
    return { ...p, facilities };
  }, [statics, overview, loc, place, colonies, colonyId]);
  // 参数的“内容”不变时保持同一个对象，避免每天的概览推送都让画面重建
  const sig = base ? JSON.stringify(base) : "";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const params = useMemo(() => base, [sig]);

  const draw = useCallback(
    (frame: number, layout: StageLayout) => {
      if (!params) return new Px(layout.width, SCENE_HEIGHT);
      const base = { ...params, width: layout.width, hover, hoverBuilding: hoverBld };
      const r = composePortScene({ ...base, ...look }, frame, buffer.current ?? undefined);
      buffer.current = r.px;
      // 时段或天况刚变：把旧外观的画面按比例混进来（两层交叉淡化）
      const f = fader.current.step(`${look.time}|${look.weather ?? "-"}`, look, frame);
      if (f.prev) {
        const old = composePortScene({ ...base, ...f.prev }, frame, fadeBuf.current ?? undefined);
        fadeBuf.current = old.px;
        crossfade(r.px, old.px, 1 - f.t);
      }
      if (layout.height <= SCENE_HEIGHT) return r.px;
      const deep = look.time === "day" && (look.weather ?? "clear") === "clear" ? undefined : sceneSkyTop({ season: params.season, ...look });
      tall.current = extendSky(r.px, layout.height, tall.current ?? undefined, deep);
      return tall.current;
    },
    [params, hover, hoverBld, look],
  );

  const edges = usePanArea(scroller, `${loc ?? "-"}|${params ? params.kind : "none"}`);

  if (!statics || loc === null || !params || !place) {
    return (
      <div className="port-scene" data-testid="port-scene" ref={sceneRoot}>
        <Empty text={t("portSelect")} />
      </div>
    );
  }
  const l = place;
  const fleet = flagship(overview);
  const docked = !!fleet && fleet.docked === loc;
  const sign = signOf(statics, overview, l, params);
  const summary = colonyId !== null ? overview?.colonies?.find((c) => c.id === colonyId) : undefined;
  const groupName = colonyId !== null ? t("portSceneBuildings", { name: summary?.name ?? l.name }) : t("portSceneFacilities", { name: l.name });
  // 殖民点无人占领时才能建立殖民地
  const canFound = params.kind === "site" && claimAt(overview, loc) === null;

  // 点建筑：港口窗口切到这个设施并打开（窗口关着、又点了同一座建筑时也要重新打开）。
  // 你的殖民地里的仓库就是殖民地库存：打开殖民地窗口的装卸一节。
  const enter = (f: Facility) => {
    // 选中的是别的港（在航海图上点过）：先选回街景里的这座，港口窗口才是这里的设施
    if (useGame.getState().selectedLoc !== loc) useGame.getState().selectLoc(loc);
    if (colonyId !== null && f === "warehouse") {
      openColony(colonyId, { section: "cargo" });
      return;
    }
    useGame.getState().setFacility(f);
    openWindow("port");
  };
  const enterBuilding = (key: string) => {
    if (colonyId === null) return;
    const id = buildingIdOf(statics, key);
    openColony(colonyId, id === null ? null : { building: id });
  };

  return (
    <div
      ref={sceneRoot}
      className={["port-scene", edges.left ? "can-pan-left" : "", edges.right ? "can-pan-right" : ""].filter(Boolean).join(" ")}
      data-testid="port-scene"
      data-scene={params.kind}
      data-phase={look.time}
      data-sky={look.weather ?? "clear"}
    >
      <PixelStage
        height={SCENE_HEIGHT}
        minScale={layout === "short" ? 1 : 2}
        minWidth={SCENE_MIN_WIDTH}
        fill
        draw={draw}
        label={t("portSceneLabel", { name: l.name })}
        className="port-stage"
      >
        {(layout) => {
          const lay = layoutPortScene({ ...params, width: layout.width });
          const k = layout.scale;
          // 舞台比街景高时街景贴底，热点跟着下移
          const off = Math.max(0, layout.height - SCENE_HEIGHT);
          const box = (r: { x: number; y: number; w: number; h: number }) => ({ left: r.x * k, top: (r.y + off) * k, width: r.w * k, height: r.h * k });
          const buildings = colonyId !== null ? lay.buildings : [];
          return (
            <>
              {(lay.hotspots.length > 0 || buildings.length > 0) && (
                <div className="scene-hotspots" role="group" aria-label={groupName}>
                  {[...lay.hotspots]
                    .sort((a, b) => a.x - b.x)
                    .map((h) => {
                      const name = tk(`port.${h.facility}`);
                      return (
                        <button
                          key={h.facility}
                          type="button"
                          className={hover === h.facility ? "scene-hotspot hot" : "scene-hotspot"}
                          data-facility={h.facility}
                          style={box(h)}
                          aria-label={name}
                          title={name}
                          onClick={() => enter(h.facility)}
                          onMouseEnter={() => setHover(h.facility)}
                          onMouseLeave={() => setHover((c) => (c === h.facility ? null : c))}
                          onFocus={() => setHover(h.facility)}
                          onBlur={() => setHover((c) => (c === h.facility ? null : c))}
                        >
                          <span className="scene-plate" aria-hidden="true">
                            <Sprite px={iconPx(h.facility)} scale={1} />
                            {name}
                          </span>
                        </button>
                      );
                    })}
                  {buildings.map((b) => {
                    const def = statics.colony_buildings.find((d) => d.key === b.building);
                    const name = t("portSceneBuilding", { name: def?.name ?? b.building, level: b.level });
                    return (
                      <button
                        key={b.building}
                        type="button"
                        className={hoverBld === b.building ? "scene-hotspot scene-building hot" : "scene-hotspot scene-building"}
                        data-building={b.building}
                        style={box(b)}
                        aria-label={name}
                        title={name}
                        onClick={() => enterBuilding(b.building)}
                        onMouseEnter={() => setHoverBld(b.building)}
                        onMouseLeave={() => setHoverBld((c) => (c === b.building ? null : c))}
                        onFocus={() => setHoverBld(b.building)}
                        onBlur={() => setHoverBld((c) => (c === b.building ? null : c))}
                      >
                        <span className="scene-plate" aria-hidden="true">
                          <Sprite px={iconPx(colonyBuildingIcon(b.building) ?? "build")} scale={1} />
                          {name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              {canFound && lay.found && (
                <div className="scene-hotspots">
                  <button type="button" className="scene-found" style={box(lay.found)} title={t("portSceneFoundHint")} onClick={() => openFoundDialog(loc)}>
                    <span className="scene-found-sign">
                      <Sprite px={iconPx("claim")} scale={2} />
                      {t("portSceneFound")}
                    </span>
                  </button>
                </div>
              )}
            </>
          );
        }}
      </PixelStage>
      <div className="scene-hud">
        <div className="scene-sign">
          <span className="scene-flag" style={{ background: sign.flag }} aria-hidden="true" />
          <div className="scene-sign-text">
            <BiName as="strong" className="scene-sign-name" zh={sign.name} en={sign.nameEn} testId="port-sign-name" />
            <span className="scene-sign-sub">{sign.sub}</span>
            {sign.extra && <span className="scene-sign-sub">{sign.extra}</span>}
            {!isSite && port && port.loc === loc && (
              <span className="scene-sign-sub">
                {t("portSceneTaxShort", { pct: pct(port.tax_bp) })} ·{" "}
                {/* E02：新尺度带阶段名（“小港 · 发展度 52”）；旧后端照旧只写数字 */}
                {port.invest.growth
                  ? tz("dev.sceneDev", { stage: stageName(port.invest.growth.stage), dev: port.invest.growth.value })
                  : t("portSceneDev", { dev: port.invest.development })}
              </span>
            )}
            {docked && <span className="scene-sign-docked">{t("portSceneDocked")}</span>}
          </div>
        </div>
        {docked && (
          <button type="button" className="scene-depart" title={t("portSceneDepartHint")} onClick={() => beginDeparture()}>
            <Sprite px={iconPx("sail")} scale={2} />
            {t("portSceneDepart")}
          </button>
        )}
        {/* 在港暂停（11-03）：时间不走，旅店休息才过天——“出港”旁边一个键直接去旅店 */}
        {docked && overview?.port_hold?.loc === loc && (
          <button type="button" className="scene-depart scene-inn" title={tz("inn.sceneHint")} data-testid="scene-inn" onClick={() => goFacility(loc, "inn")}>
            <Sprite px={iconPx("tavern")} scale={2} />
            {tz("inn.scene")}
          </button>
        )}
        {/* 旗舰队船员不足（少于最低人数开不了船）：名牌下写明差多少，一键补到最低人数 */}
        {docked && fleet && fleet.crew < fleet.crew_min && (
          <div className="scene-crew parchment" data-testid="scene-crew-short">
            <span className="scene-crew-text">
              <Sprite px={iconPx("crew")} scale={1} />
              {t("portSceneCrewShort", { crew: fleet.crew, min: fleet.crew_min })}
            </span>
            <CrewHireButtons fleet={fleet} compact testId="scene-crew-hire" />
          </div>
        )}
      </div>
    </div>
  );
}

/** 街景外观参数（时段、天况、风、闪电）。 */
type SceneLookParams = Pick<PortSceneParams, "time" | "weather" | "windX" | "windStrength" | "lightning">;

/** 名牌：港口与城市写地名（双行名字：中文界面下方一小行英文原名）、种类与势力；殖民点按归属写荒野、你的殖民地、势力据点或他人的殖民地。 */
function signOf(
  statics: StaticView,
  overview: Overview | null,
  l: LocView,
  params: Omit<PortSceneParams, "width" | "hover">,
): { name: string; nameEn?: string | null; sub: string; extra?: string; flag: string } {
  const loc = l.id;
  if (l.kind !== "site") {
    const faction = statics.factions[l.faction];
    return { name: l.name, nameEn: l.name_en, sub: `${tk(`loc.${l.kind}`)} · ${faction?.name ?? ""}`, flag: faction?.color ?? "#888" };
  }
  const summary = overview?.colonies?.find((c) => c.loc === loc);
  if (summary) {
    // 殖民地名是玩家起的（通常没有英文），只显示原文
    return {
      name: summary.name,
      nameEn: summary.name_en,
      sub: t("portSceneColonySub", { site: l.name }),
      extra: t("portSceneColonyStats", { population: summary.population, morale: summary.morale }),
      flag: PLAYER_FLAG,
    };
  }
  const claim = claimAt(overview, loc);
  if (claim && claim.faction !== null) {
    const f = statics.factions[claim.faction];
    return { name: l.name, nameEn: l.name_en, sub: t("portSceneClaimed", { faction: f?.name ?? "" }), flag: f?.color ?? "#888" };
  }
  if (claim && claim.colony !== null) {
    return { name: l.name, nameEn: l.name_en, sub: t("portSceneOtherColony"), flag: params.flag ?? "#888" };
  }
  const terrain = l.site?.terrain ?? params.terrain ?? "forest";
  return { name: l.name, nameEn: l.name_en, sub: t("portSceneWild", { terrain: tk(`terrain.${terrain}`) }), flag: "#8a8699" };
}
