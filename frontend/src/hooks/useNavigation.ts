// 手动航行（FRAMEWORK §6、UI-CONTRACT I3）的状态与动作：航行视图（navigation）、按分钟的航迹（preview_course）、
// 拖动罗经盘时的预测、出港、操舵、调帆、自动航行、登陆与潜水（B12）。
//
// - 只有打开了 navigation_manual 模块的世界、旗舰队在海上时才有航行视图；经典世界（route）什么都不做。
// - 命令带上应用层时钟的分钟（从当天 6:00 起，store/clock.ts）：命令在下一次 6:00 结算时按分钟插进当天的 24 步里。
// - 预测就是结果：拖动罗经盘时先画 preview_course 的预测，松手才提交 Steer；结算之间船沿当天的航迹按分钟移动。
// - P03（慢连接）：预测请求同一时间只有一个在路上，另有一个“最新的待查意图”，在路上的回来之后才发它。
//   本地意图版本（intent）：草稿航向、提交的转舵与调帆、自动航行、出港、登陆，以及航行相关状态的变化（航行视图换了、
//   换局、重连）每发生一次加一，决定还要不要再问一次最新的意图。
//   其中除草稿航向以外的变化另记一个状态版本（stateVer）：预测的回包只在状态版本与本地请求序号（ipc/sequence.ts）都没变时
//   才显示。拖动中草稿变了不丢旧回包——上一个草稿的预测先画出来当过渡，最新的意图随后补问（桌面版拖动时每一帧都是新草稿，
//   只认当前草稿的话预测线会一直停着不动）；状态变了的旧预测一律不画。
import { create } from "zustand";
import { navApi, navCommand } from "../ipc/api";
import { locById } from "../ipc/byId";
import type { RoutePref } from "../ipc/routing";
import { onRequestSeq, requestSeq, type SeqReason } from "../ipc/sequence";
import { t } from "../i18n";
import type { Command, CoursePreview, NavView, Overview, SailSetting, StaticView } from "../ipc/types";
import { navMinute } from "../components/nav/navKit";
import { diveCommand } from "../components/panels/diveKit";
import { useClockStore } from "../store/clock";
import { flagship, useGame } from "../store/game";
import { onGameSwitch } from "../store/gameSwitch";
import { NORMAL_SPEED } from "../time/daylight";

export interface NavStore {
  /** 航行视图（不在海上或不是手动航行的世界时为 null） */
  nav: NavView | null;
  /** 当天的航迹（按分钟，preview_course 不带操舵的结果）：结算之间让船连续移动 */
  course: CoursePreview | null;
  /** 正在调整、还没提交的航向（拖动罗经盘、按住转舵键） */
  draft: number | null;
  /** 调整中的预测（照 draft 算的） */
  preview: CoursePreview | null;
  /** 航行视图还是世界图（Tab 切换） */
  view: "nav" | "world";
  /** 手动航行的世界里，港内打开的出港框 */
  departing: boolean;
  /** 命令在路上 */
  busy: boolean;
  /** 世界图上点选的、等待确认自动驶往的地点 */
  pick: number | null;
  /**
   * FIX5F：前端的粮水警戒（常设命令 supply_alert）刚把时钟停下时的“够几天”；顶栏时刻下面据此留一句原因，
   * 继续航行、粮水回到警戒线以上、离开海面时清掉（NavigationView）。
   */
  supplyHold: number | null;
  /**
   * S02nF6（实测 M7）：换局序号——新开局、读档、换世界以后，新一局的第一份概览到了就加一。
   * NavigationView 重取航行视图的 effect 依赖它：读回来的档与眼下的签名相同（同一天、同一位置）时也重取一次。
   */
  game: number;
}

export const useNavStore = create<NavStore>(() => ({
  nav: null,
  course: null,
  draft: null,
  preview: null,
  view: "nav",
  departing: false,
  busy: false,
  pick: null,
  supplyHold: null,
  game: 0,
}));

/** 这个世界是否手动航行（world.modules 里有 navigation_manual）。 */
export function isManualWorld(statics: Pick<StaticView, "world"> | null | undefined): boolean {
  return statics?.world?.modules?.includes("navigation_manual") ?? false;
}

/** 旗舰队在海上、且是手动航行的世界：航行视图该出现。 */
export function navActive(statics: StaticView | null, o: Overview | null): boolean {
  const f = flagship(o);
  return isManualWorld(statics) && !!f && f.docked === null;
}

/** 应用层时钟此刻的“从 6:00 起的分钟”。 */
export function nowNavMinute(): number {
  return navMinute(useClockStore.getState().minute);
}

let navSeq = 0;
/** 在路上的刷新；其间又要刷新时，等它回来再取一次（高倍速时每天一次的推送不会把请求越堆越多） */
let navInflight: Promise<NavView | null> | null = null;
let navAgain = false;
let navRetryTimer: ReturnType<typeof setTimeout> | null = null;
let navRetryKey: string | null = null;

/** 本地意图版本与状态版本（见文件开头）。 */
let intent = 0;
let stateVer = 0;

/** 草稿以外的意图变化（命令、调帆、航行相关状态、换局、重连）：在路上的预测回来也不画。 */
function bumpState(): void {
  intent++;
  stateVer++;
}

/** 航行视图里与“预测对应哪个状态”有关的部分（换日、位置、航向、帆变了才算航行相关状态变了）。 */
function navKey(nav: NavView | null): string {
  return nav ? [nav.fleet, nav.day, nav.minute, nav.pos.x, nav.pos.y, nav.heading, nav.sail].join("|") : "-";
}

async function fetchNav(seq: number): Promise<NavView | null> {
  const rseq = requestSeq();
  const requestedState = stateVer;
  const g = useGame.getState();
  const fleet = flagship(g.overview);
  const signature = navSignature(g.overview);
  if (!navActive(g.statics, g.overview) || !fleet) {
    useNavStore.setState({ nav: null, course: null, preview: null, draft: null });
    return null;
  }
  try {
    const nav = await navApi.navigation(fleet.id);
    // 被放弃的请求（resetNav、换局、重连）回来的不是现在的
    if (seq !== navSeq || rseq !== requestSeq() || requestedState !== stateVer) return nav;
    if (signature !== navSignature(useGame.getState().overview)) {
      navAgain = true;
      return nav;
    }
    if (navRetryTimer) clearTimeout(navRetryTimer);
    navRetryTimer = null;
    navRetryKey = null;
    // 航行相关状态变了：在路上的预测不再对应当前的状态；还在调整的话按新的状态重问
    const changed = navKey(useNavStore.getState().nav) !== navKey(nav);
    if (changed) bumpState();
    // 新日期／操舵状态不能配上上一份航迹；新预测返回前使用当前权威船位。
    useNavStore.setState(changed ? { nav, course: null } : { nav });
    resumePreview();
    if (!nav) {
      useNavStore.setState({ course: null });
      // 后端可能已经靠港或移除了舰队，不能一直拿旧概览等待下一次换日。
      void useGame.getState().resync();
      return nav;
    }
    // 当天的航迹按分钟（从上次结算到一天结束）：船在两次结算之间沿着它走
    try {
      const courseState = stateVer;
      const course = await navApi.previewCourse(nav.fleet, [], nav.minute);
      if (seq === navSeq && rseq === requestSeq() && courseState === stateVer) useNavStore.setState({ course });
    } catch {
      // 没有航迹：船停在结算时的位置
    }
    return nav;
  } catch (error) {
    if (seq === navSeq && rseq === requestSeq() && requestedState === stateVer) {
      const previous = useNavStore.getState().nav;
      const current = useGame.getState().overview;
      const keep = previous?.fleet === fleet.id && previous?.day === current?.day;
      // 一次查询失败不能抹掉仍有效的船；停止使用预测，并为暂停中的界面补一次有界重试。
      useNavStore.setState({ nav: keep ? previous : null, course: null, preview: null });
      if (navRetryKey !== signature) {
        navRetryKey = signature;
        if (navRetryTimer) clearTimeout(navRetryTimer);
        navRetryTimer = setTimeout(() => {
          navRetryTimer = null;
          void refreshNav();
        }, 500);
      } else {
        useGame.getState().fail(error);
      }
    }
    return null;
  }
}

/** 重新取航行视图与当天的航迹（不在海上时清空）。同一时间只有一个请求在路上，其间的请求合并成回来后的一次。 */
export function refreshNav(): Promise<NavView | null> {
  if (navInflight) {
    navAgain = true;
    return navInflight;
  }
  const p: Promise<NavView | null> = fetchNav(++navSeq).finally(() => {
    // 已经被 resetNav 放弃的请求不再接着取
    if (navInflight !== p) return;
    navInflight = null;
    if (navAgain) {
      navAgain = false;
      void refreshNav();
    }
  });
  navInflight = p;
  return p;
}

/** 航行视图依赖的概览签名：换舰队、换日、出港靠港、航向与位置变化时重取。 */
export function navSignature(o: Overview | null): string {
  const f = flagship(o);
  if (!o || !f) return "";
  return [f.id, o.day, f.docked ?? "-", f.heading ?? "-", f.pos ? `${f.pos.x},${f.pos.y}` : "-", o.fog_version].join("|");
}

let previewSeq = 0;
let previewTimer: ReturnType<typeof setTimeout> | null = null;
/** 预测请求在路上（同一时间最多一个：慢网下拖动罗经盘时请求不越堆越多，性能商议 2026-10-07） */
let previewInflight = false;
/** 最近一次发出的预测请求对应的意图版本：与现在的 intent 不同，就还有一个“最新的待查意图”没有问过 */
let sentIntent = -1;
/** 上一次发出预测请求的时刻（毫秒） */
let previewSentAt = -Infinity;
/** 预测请求的最短间隔（毫秒）：拖动罗经盘时不每一帧都问后端（以前 80 毫秒、在途不设上限；现在 150 毫秒、一个在途 + 一个最新）。 */
export const PREVIEW_MS = 150;

const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** 不再要预测（放弃调整、已经提交）：取消约好的请求；在路上的那个回来后不画、也不再追问。 */
function cancelPreview(): void {
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = null;
}

/** 约一次预测请求：距上一次发出不足 PREVIEW_MS 时等到满了再发（约好的那次发出时取最新的草稿）。 */
function schedulePreview(wait: number): void {
  if (previewTimer) return;
  previewTimer = setTimeout(() => {
    previewTimer = null;
    sendPreview();
  }, wait);
}

/** 还在调整、意图又变了而没有请求在路上时，约一次最新意图的预测（在路上的请求回来之后也走这里）。 */
function resumePreview(): void {
  const { nav, draft } = useNavStore.getState();
  if (!nav || draft === null || previewInflight || sentIntent === intent) return;
  schedulePreview(Math.max(0, PREVIEW_MS - (nowMs() - previewSentAt)));
}

function sendPreview(): void {
  const { nav, draft } = useNavStore.getState();
  if (!nav || draft === null) return;
  const seq = ++previewSeq;
  // 这次请求对应的意图、状态版本与请求序号：回来时状态版本与请求序号都没变才显示（草稿变了照画，见文件开头）
  const mine = intent;
  const mineState = stateVer;
  const rseq = requestSeq();
  const minute = nowNavMinute();
  previewInflight = true;
  sentIntent = mine;
  previewSentAt = nowMs();
  navApi
    .previewCourse(nav.fleet, [{ minute, heading: draft }], minute)
    .then((p) => {
      if (seq === previewSeq && mineState === stateVer && rseq === requestSeq() && useNavStore.getState().draft !== null)
        useNavStore.setState({ preview: p });
    })
    .catch(() => {})
    .finally(() => {
      // 已经被 resetNav / 换局放弃的请求不再动状态
      if (seq !== previewSeq) return;
      previewInflight = false;
      // 在路上的期间意图变了：回来以后按最新的意图再问一次（中间的意图不问，最后一次的预测一定画出来）
      resumePreview();
    });
}

/**
 * 调整中：记下草稿航向，稍后（节流）向后端要预测。null 表示放弃调整。
 * 同一时间最多一个预测请求在路上；其间草稿再变只让意图版本加一，回来的旧草稿的预测先画出来，随后按最新的意图问（中间的草稿不问）。
 */
export function draftHeading(heading: number | null): void {
  const changed = useNavStore.getState().draft !== heading;
  useNavStore.setState({ draft: heading });
  if (changed) intent++;
  if (heading === null) {
    cancelPreview();
    useNavStore.setState({ preview: null });
    return;
  }
  // 在路上：回来以后由 resumePreview 发最新的；这个意图已经问过：不重复问
  if (previewInflight || (!changed && sentIntent === intent)) return;
  schedulePreview(PREVIEW_MS);
}

/** 提交命令后刷新航行视图。 */
async function run(command: Command): Promise<boolean> {
  bumpState();
  useNavStore.setState({ busy: true });
  try {
    const r = await useGame.getState().submit(command);
    return !!r;
  } finally {
    useNavStore.setState({ busy: false });
    void refreshNav();
  }
}

/** 转舵：提交 Steer（此刻的分钟），清掉草稿与预测。 */
export async function steerTo(heading: number): Promise<boolean> {
  const { nav } = useNavStore.getState();
  // 松手：最终的 Steer 一定提交（不等在路上的预测）；约好的预测取消，在路上的回来也不再显示
  cancelPreview();
  bumpState();
  useNavStore.setState({ draft: null, preview: null });
  if (!nav) return false;
  const h = Math.round(((heading % 360) + 360) % 360) % 360;
  // 先在本地转过去（命令回来之前罗经盘不弹回原处）
  useNavStore.setState({ nav: { ...nav, heading: h } });
  return run(navCommand.steer(nav.fleet, nowNavMinute(), { heading: h }));
}

/** 调帆。 */
export async function setSail(sail: SailSetting): Promise<boolean> {
  const { nav } = useNavStore.getState();
  if (!nav || nav.sail === sail) return false;
  bumpState();
  useNavStore.setState({ nav: { ...nav, sail } });
  return run(navCommand.steer(nav.fleet, nowNavMinute(), { sail }));
}

/** 自动航行到已知海域里看见过的港口（days 为 null 的目的地只能开到已知海域的边缘）。route 是 H07 的寻路偏好（不给按缺省）。 */
export async function autopilotTo(dest: number, toEdge: boolean, route?: RoutePref): Promise<boolean> {
  const { nav } = useNavStore.getState();
  if (!nav) return false;
  useNavStore.setState({ pick: null });
  return run(navCommand.autopilot(nav.fleet, dest, nowNavMinute(), toEdge, route));
}

/**
 * 世界图上点了一个地点（手动航行、旗舰队在海上时）：能自动驶往的（known_dests 里有）等待确认；
 * 不能的提示“前方海域尚未探明”。返回是否处理了这次点选。
 */
export function pickAutopilot(loc: number): boolean {
  const g = useGame.getState();
  if (!navActive(g.statics, g.overview)) return false;
  const { nav } = useNavStore.getState();
  const dest = nav?.known_dests.find((d) => d.loc === loc);
  if (dest) useNavStore.setState({ pick: loc });
  else g.notify(t("nav.notDest", { name: locById(g.statics, loc)?.name ?? "" }));
  return true;
}

/** 登陆探索。 */
export async function sendLanding(days: number): Promise<boolean> {
  const { nav } = useNavStore.getState();
  if (!nav) return false;
  return run(navCommand.landing(nav.fleet, days));
}

/** B12：旗舰队在这里潜水（收着帆、停在潜水点的海面时）。 */
/** H04：在海上所见的小卡片上选一个按钮。 */
export async function sendSighting(sighting: number, choice: number): Promise<boolean> {
  const { nav } = useNavStore.getState();
  if (!nav) return false;
  return run({ ResolveSighting: { owner: "player", fleet: nav.fleet, sighting, choice } });
}

export async function sendDive(discovery: number): Promise<boolean> {
  const { nav } = useNavStore.getState();
  if (!nav) return false;
  return run(diveCommand(nav.fleet, discovery));
}

/**
 * 手动出港：提交 Depart；游戏暂停时按最近一次运行时的倍速开始航行（与经典世界的出航一致）。
 * 在港暂停（11-03）时后端出港后已经按记下的一档继续了，这时不再另外设速度。
 */
export async function departWith(heading: number): Promise<boolean> {
  const g = useGame.getState();
  const fleet = flagship(g.overview);
  if (!fleet) return false;
  const paused = (g.overview?.speed ?? 0) === 0;
  const ok = await run(navCommand.depart(fleet.id, nowNavMinute(), Math.round(((heading % 360) + 360) % 360) % 360));
  if (!ok) return false;
  useNavStore.setState({ departing: false, view: "nav" });
  const after = useGame.getState();
  if (paused && (after.overview?.speed ?? 0) === 0) await after.setSpeed(after.runSpeed || NORMAL_SPEED);
  return true;
}

/**
 * FIX5F 第二趟：寰宇出港框的“自动驶往”——在港里直接发 Autopilot（内核在港时就是出港 + 领航，一条命令，与任务航线小卡、
 * 行程“下一站”的“继续”一样），不会出现“出了港、领航没设上”的悬着。被拒时返回内核给的原因（提示条也照常报）。
 */
export async function departAuto(dest: number, toEdge: boolean): Promise<string | null> {
  const g = useGame.getState();
  const fleet = flagship(g.overview);
  if (!fleet) return "";
  const paused = (g.overview?.speed ?? 0) === 0;
  const ok = await run(navCommand.autopilot(fleet.id, dest, nowNavMinute(), toEdge));
  if (!ok) return useGame.getState().error ?? "";
  useNavStore.setState({ departing: false, view: "nav" });
  const after = useGame.getState();
  if (paused && (after.overview?.speed ?? 0) === 0) await after.setSpeed(after.runSpeed || NORMAL_SPEED);
  return null;
}

/** 空格：暂停或按最近一次运行时的倍速继续。 */
export async function togglePause(): Promise<void> {
  const g = useGame.getState();
  const speed = g.overview?.speed ?? 0;
  await g.setSpeed(speed > 0 ? 0 : g.runSpeed || 1);
}

/** Tab：航行视图与世界图之间切换。 */
export function toggleNavView(): void {
  useNavStore.setState((s) => ({ view: s.view === "nav" ? "world" : "nav" }));
}

/** 清空（测试、换对局）。 */
export function resetNav(): void {
  abandonRequests();
  previewSentAt = -Infinity;
  sentIntent = -1;
  useNavStore.setState({ nav: null, course: null, draft: null, preview: null, view: "nav", departing: false, busy: false, pick: null, supplyHold: null });
}

/** 放弃在路上的航行视图与预测请求（回来的不再采用、也不再追问），约好的预测取消，意图版本加一。 */
function abandonRequests(): void {
  if (navRetryTimer) clearTimeout(navRetryTimer);
  navRetryTimer = null;
  navRetryKey = null;
  navSeq++;
  navInflight = null;
  navAgain = false;
  previewSeq++;
  previewInflight = false;
  cancelPreview();
  bumpState();
}

/**
 * 本地请求序号前进（ipc/sequence.ts）：
 * - 换了一局（新开局、读档、换世界）：航行视图、航迹与预测都是上一局的，清掉（新的概览放进来之后 NavigationView 会重新取）；
 * - 重连：在路上的请求作废，航行视图重新取一次，还在调整的话按最新的意图重问；
 * - 1013 关闭（busy）：只作废在路上的请求，等重连之后再取。
 */
function onSequence(_seq: number, reason: SeqReason): void {
  abandonRequests();
  if (reason === "new_game" || reason === "load" || reason === "world") {
    useNavStore.setState({ nav: null, course: null, draft: null, preview: null, departing: false, busy: false, pick: null, supplyHold: null });
    return;
  }
  if (reason === "busy") return;
  const g = useGame.getState();
  if (navActive(g.statics, g.overview)) void refreshNav();
  resumePreview();
}
onRequestSeq(onSequence);

// 换局以后新一局的头一份概览到了（或换局没成）：换局序号加一，NavigationView 据此重取一次（store/gameSwitch.ts；重连与 1013 关闭不走这里）
onGameSwitch(() => {
  useNavStore.setState((st) => ({ game: st.game + 1 }));
});

// H10iF4：概览推送跟不上时按时钟换日补取一次航行视图与当天的航迹。X08-dev2 在快进的外海量到有时一两天收不到概览，
// 航行视图停在旧的一天，画面只能沿旧航迹外推到头再停住；时钟的推送照常在走。换日后 NAV_CLOCK_REFRESH_MS 毫秒里航行视图还是旧的一天，就补取一次
/** 时钟换日以后等多久（毫秒）还没有新一天的航行视图，就按时钟补取。 */
export const NAV_CLOCK_REFRESH_MS = 300;
let clockDayTimer: ReturnType<typeof setTimeout> | null = null;
useClockStore.subscribe((s, p) => {
  if (s.day === p.day || clockDayTimer) return;
  const nav = useNavStore.getState().nav;
  if (!nav || s.day <= nav.day) return;
  clockDayTimer = setTimeout(() => {
    clockDayTimer = null;
    const n = useNavStore.getState().nav;
    const g = useGame.getState();
    if (n && useClockStore.getState().day > n.day && navActive(g.statics, g.overview)) void refreshNav();
  }, NAV_CLOCK_REFRESH_MS);
});
