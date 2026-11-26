// 出港、选择目的地与入港：主舞台在港口街景与航海图之间的自动切换。
// 导出的名称与签名是其他模块依赖的接口（外壳在 App 中调用一次 useVoyage()，港口与命令栏调用 beginDeparture()）。
//
// 流程：
//   beginDeparture()          → picking：切到航海图，玩家在海图或地点列表上点选港口或殖民点
//                               （第九批手动航行的世界：改为打开出港框，在罗经盘上定航向后提交 Depart，见 components/nav/）
//   chooseDestination(loc)    → 记下待确认的目的地，航海图上弹出确认框（MapView 里）并画出规划航线
//   confirmDeparture()        → 提交 SetSail（目的地可以是殖民点，后端实时寻路）；游戏暂停时顺便开始航行：
//                               按最近一次运行时的倍速（靠港自动暂停之前的速度；没运行过为 1×）
//   useVoyage()               → 旗舰队离港时切到航海图；靠港时选中港口、切回港口街景并提示“抵达”或“发现新港口”；
//                               抵达殖民点时选中它（我的殖民地同时选中该殖民地）、切到“殖民地”页，街景显示荒野或殖民地。
//                               同时跟踪航行中的新发现（map/found.ts）。
import { useEffect } from "react";
import { create } from "zustand";
import { closeWindow } from "../components/shell/shellState";
import { t } from "../i18n";
import { api } from "../ipc/api";
import { locById } from "../ipc/byId";
import type { Overview } from "../ipc/types";
import { watchDiscoveries } from "../map/found";
import { hasSites, isSite, siteState, siteStates } from "../map/marks";
import { flagship, useGame } from "../store/game";
import { NORMAL_SPEED } from "../time/daylight";
import { isManualWorld, useNavStore } from "./useNavigation";

/** 待确认航线的规划（sail_preview 的结果），航海图据此画出白色点线。 */
export interface VoyagePlan {
  dest: number;
  path: [number, number][];
}

interface VoyageState {
  /** 正在海图上为旗舰队选择目的地 */
  picking: boolean;
  /** 已点选、等待确认的目的地 */
  target: number | null;
  /** 待确认的规划航线 */
  plan: VoyagePlan | null;
  /** 出航前查到的“是否到访过”（地点 → 是否已知），用于靠港时判断是不是新发现的港口 */
  known: Record<number, boolean>;
}

export const useVoyageStore = create<VoyageState>(() => ({ picking: false, target: null, plan: null, known: {} }));

/** 出港：切到航海图，进入选择目的地的状态。 */
export function beginDeparture() {
  // 手动航行的世界：出港框（罗经盘定航向）代替“在海图上选目的地”
  if (isManualWorld(useGame.getState().statics)) {
    useVoyageStore.setState({ picking: false, target: null, plan: null });
    useNavStore.setState({ departing: true });
    useGame.getState().setStage("chart");
    closeWindow();
    return;
  }
  useVoyageStore.setState({ picking: true, target: null, plan: null });
  useGame.getState().setStage("chart");
  // 收起功能窗口：选目的地时海图要完整可见
  closeWindow();
}

/** 取消选择目的地（旗舰队仍在港内时回到港口街景）。 */
export function cancelDeparture() {
  useVoyageStore.setState({ picking: false, target: null, plan: null });
  if (useNavStore.getState().departing) useNavStore.setState({ departing: false });
  const fleet = flagship(useGame.getState().overview);
  if (fleet && fleet.docked !== null) useGame.getState().setStage("town");
}

/** 放弃刚点选的目的地，继续在海图上选择。 */
export function repickDestination() {
  useVoyageStore.setState({ target: null, plan: null });
}

/** 能否驶向该地点：港口与殖民点可以，内陆城市不行。 */
export function canSailTo(place: { kind: string }): boolean {
  return place.kind === "port" || isSite(place);
}

/**
 * 在海图或地点列表上点选了地点。选择目的地时返回 true（调用方不再做默认的“选中并切到港口页”）。
 * 内陆城市不能直接驶入，旗舰队所在的地点也不必再去：给出提示并继续选择。
 */
export function chooseDestination(loc: number): boolean {
  if (!useVoyageStore.getState().picking) return false;
  const g = useGame.getState();
  const place = locById(g.statics, loc);
  const fleet = flagship(g.overview);
  if (!place) return true;
  if (!canSailTo(place)) {
    g.notify(hasSites(g.statics) ? t("chartPickPortOrSite") : t("chartPickPortOnly"));
    return true;
  }
  if (fleet && fleet.docked === loc) {
    g.notify(t("chartAlreadyHere", { port: place.name }));
    return true;
  }
  useVoyageStore.setState({ target: loc, plan: null });
  return true;
}

/** 记下某港口是否到访过（出航前查询，靠港时判断“发现新港口”）。 */
export function rememberKnown(loc: number, known: boolean) {
  useVoyageStore.setState((s) => (s.known[loc] === known ? s : { known: { ...s.known, [loc]: known } }));
}

/**
 * 确认出航：提交 SetSail；成功后退出选择状态，游戏暂停时按最近一次运行时的倍速开始航行（没运行过为设置里的默认速度，缺省“普通”）。
 * 出港之后后端已经在走了（在港暂停的世界）时不再另外设速度。
 */
export async function confirmDeparture(): Promise<boolean> {
  const { target } = useVoyageStore.getState();
  const g = useGame.getState();
  const fleet = flagship(g.overview);
  if (target === null || !fleet) return false;
  const paused = (g.overview?.speed ?? 0) === 0;
  const r = await g.submit({ SetSail: { owner: "player", fleet: fleet.id, dest: target } });
  if (!r) return false;
  useVoyageStore.setState({ picking: false, target: null, plan: null });
  const after = useGame.getState();
  if (paused && (after.overview?.speed ?? 0) === 0) await after.setSpeed(after.runSpeed || NORMAL_SPEED);
  return true;
}

interface FleetSnap {
  id: number;
  day: number;
  docked: number | null;
  dest: number | null;
}

function snap(o: Overview | null): FleetSnap | null {
  const f = flagship(o);
  return o && f ? { id: f.id, day: o.day, docked: f.docked, dest: f.dest } : null;
}

/** 查询某地是否到访过：殖民点用殖民点视图，其余用港口视图。 */
export function fetchKnown(loc: number): Promise<boolean> {
  const place = locById(useGame.getState().statics, loc);
  if (place && isSite(place)) return api.site(loc).then((v) => v.known);
  return api.port(loc).then((p) => p.known);
}

/** 出航后查一次目的地是否到访过（尚未记录时）。 */
function prefetchKnown(dest: number | null) {
  if (dest === null || useVoyageStore.getState().known[dest] !== undefined) return;
  fetchKnown(dest)
    .then((known) => {
      // 已经靠港（查询晚于抵达）时不再覆盖
      const f = flagship(useGame.getState().overview);
      if (f && f.docked === dest) return;
      rememberKnown(dest, known);
    })
    .catch(() => {});
}

function departed(cur: FleetSnap) {
  const g = useGame.getState();
  useVoyageStore.setState({ picking: false, target: null, plan: null });
  g.setStage("chart");
  prefetchKnown(cur.dest);
}

/**
 * 选中殖民点并切到“殖民地”页：我的殖民地同时选中该殖民地，其余（未开拓、被占领、他人的）清空选中的殖民地，
 * 殖民地窗口据 selectedLoc 显示这处殖民点。返回它的现状。
 */
export function focusSite(loc: number) {
  const g = useGame.getState();
  const state = siteState(siteStates(g.overview), loc);
  g.selectLoc(loc);
  g.selectColony(state.status === "mine" ? state.colony : null);
  g.setTab("colonies");
  return state;
}

/** 抵达殖民点：选中它、切到“殖民地”页与街景（荒野或殖民地），并按现状提示。 */
function arrivedAtSite(loc: number, name: string, firstVisit: boolean, paused: boolean) {
  const g = useGame.getState();
  const state = focusSite(loc);
  g.setStage("town");
  const note = pausedNote(paused);
  switch (state.status) {
    case "mine":
      g.notify(t("chartArrivedColony", { name: state.name ?? name }) + note);
      break;
    case "claimed":
      g.notify(t("chartArrivedClaimed", { site: name, faction: (state.faction !== null && g.statics?.factions[state.faction]?.name) || "" }) + note);
      break;
    case "other":
      g.notify(t("chartArrivedOther", { site: name }) + note);
      break;
    default:
      g.notify((firstVisit ? t("chartArrivedWildNew", { site: name }) : t("chartArrivedWild", { site: name })) + note);
  }
}

/** 靠港时后端按设置自动暂停了（之前在运行、现在停了）：提示里说一句。 */
function pausedNote(paused: boolean): string {
  return paused ? t("chartArrivedPaused") : "";
}

function arrived(loc: number, paused: boolean) {
  const g = useGame.getState();
  const place = locById(g.statics, loc);
  const name = place?.name ?? "";
  const discovered = useVoyageStore.getState().known[loc] === false;
  useVoyageStore.setState({ picking: false, target: null, plan: null });
  rememberKnown(loc, true);
  if (place && isSite(place)) {
    arrivedAtSite(loc, name, discovered, paused);
    return;
  }
  g.selectLoc(loc);
  g.setTab("port");
  g.setFacility("market");
  g.setStage("town");
  g.notify((discovered ? t("chartDiscovered", { port: name }) : t("chartArrived", { port: name })) + pausedNote(paused));
}

/** 由外壳在 App 中调用一次：根据旗舰队的出港与靠港自动切换舞台。 */
export function useVoyage() {
  useEffect(() => watchDiscoveries(), []);
  useEffect(() => {
    let prev = snap(useGame.getState().overview);
    // 读档时旗舰队已在海上：直接显示航海图
    if (prev && prev.docked === null) {
      useGame.getState().setStage("chart");
      prefetchKnown(prev.dest);
    }
    return useGame.subscribe((s, old) => {
      if (s.overview === old.overview) return;
      const before = prev;
      const cur = snap(s.overview);
      prev = cur;
      if (!cur) return;
      // 新开局、读档（换了舰队或日期倒退）：不算出港或靠港
      if (!before || before.id !== cur.id || cur.day < before.day) {
        if (cur.docked === null) {
          s.setStage("chart");
          prefetchKnown(cur.dest);
        }
        return;
      }
      if (before.docked !== null && cur.docked === null) departed(cur);
      else if (cur.docked !== null && before.docked !== cur.docked) arrived(cur.docked, (old.overview?.speed ?? 0) > 0 && s.overview?.speed === 0);
      else if (cur.docked === null && cur.dest !== before.dest) prefetchKnown(cur.dest);
    });
  }, []);
}
