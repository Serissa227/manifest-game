// H10a 航行画面的“动”：船位、船头与别的船的平滑（纯计算，不画东西，不改 store）。
//
// 航行时船头的朝向。原因见 docs/research/r10/sailing-view.md：船头画的是一天只取一次的舵向，
// 实际航迹叠了洋流与纬度修正；换日时航迹被清空，船停一下再跳。这里把它们改成：
//
// 1. **船头 = 对地航向**：每帧按航迹（逐分钟点）在播放到的分钟前后取一段弦（H10iF2 起按距离取，见 chordHeading，加死区）；
//    H10iF3 起所有模式（含抢风、慢行）都按航迹取弦——航行视图的舵向一天只取一次，后端当天中途转了向，画它就会横着走（X07）；
//    弦往回取时接着用上一份航迹（跨日、日中重算都接得上）。
//    转速上限每秒 TURN_DEG_PER_S 度。拖罗经盘时朝草稿航向转；停着（收帆、锚泊，或弦太短：停在暂停点上）时保持最后的朝向，
//    这时改了舵就朝新舵向转过去。H10hF：对地航向离舵向超过 DRIFT_DEG（逆风倒退、横漂）时画舵向，见 drifting()。
// 2. **换日不顿**：store 里的航迹被清空（等新航迹）时，沿手上最后一份航迹接着播；那份航迹走到一天的末尾以后，
//    按最后半小时的速度再外推最多 DEAD_RECKON_MIN 分钟。新航迹（或新的航行视图）到了，旧画面与新数据之间的位置差
//    在 SETTLE_MS 毫秒内缓掉，不跳。差得太远（换舰队、读档）直接换过去。
// 3. **播放的分钟**跨日连续：按 day × 1440 + 从 6:00 起的分钟算，后端时钟采样之间按倍速外推最多 EXTRAPOLATE_MS。
//    没经后端确认越过的暂停点不先行越过（与原来的 NavPlayback 一致）。
//    H10iF3：播放的速度取后端实际推进的平均速度（含每天日结的那一段停顿），播放与后端的差只做 ±10% 的微调；
//    日界不等后端，沿外推的航迹接着走，最多领先 PLAY_LEAD_MAX_MS（后端一直不回再停下等）。新航迹到了以后位置差沿航迹只进不退地消掉
//    （横向的差约 0.3 秒缓掉）；后端真停了（暂停、停因）才缓回停点。
//
// 航行视图（NavCanvas）与世界海图（renderer.ts）共用同一个旗舰队的实例（flagshipMotion），Tab 来回切换时朝向不重来。
import type { CoursePreview, NavShip, NavView } from "../ipc/types";
import { angleDiff, inIrons, navMinute, normDeg, positionAt } from "../components/nav/navKit";
import { useNavStore } from "../hooks/useNavigation";
import { useClockStore } from "../store/clock";
import { dayLengthMs, MINUTES_PER_DAY } from "../time/daylight";
import { shipAt, type PlacedShip } from "./navSea";
import { modX, wrapDx } from "./wrap";

/**
 * 船头的转速上限（度 / 秒）。H10iF 从 120 提到 180：手动转舵、点海面、换舷都按这个缓过去（掉头 180° 正好一秒），
 * 比 120 跟手，又不至于像原来顶风换舷那样一甩就到。按两帧之间的实际间隔算（不夹 100 ms），后台标签页回来、掉帧时不会追不上。
 */
export const TURN_DEG_PER_S = 180;
/** 新数据到了以后，位置误差在多久内缓掉（毫秒）。 */
export const SETTLE_MS = 300;
/** 后端时钟两次采样之间最多往前外推多久（毫秒；与后端单步补推的上限一致）。 */
export const EXTRAPOLATE_MS = 250;
/** 航迹走到一天的末尾以后、新航迹到之前，最多再沿最后的方向外推多少游戏分钟（换日后取新航迹慢的时候要半秒多，常速下就是半天）。 */
export const DEAD_RECKON_MIN = 1440;
/**
 * H10iF3 播放领先后端最多多久（实时毫秒）：日界时后端要结算（慢的时候量到 0.4–0.7 秒），这段时间画面沿外推的航迹接着走；
 * 领先到 PLAY_LEAD_MAX_MS - PLAY_LEAD_RAMP_MS 以后逐渐慢下来，到上限停住等后端。
 */
export const PLAY_LEAD_MAX_MS = 1500;
/**
 * H10iF4 领先后端确认的分钟最多多少游戏分钟（与 PLAY_LEAD_MAX_MS 取小的）。X08：只按实时封顶时，快进下 1.5 秒就是一天半，
 * 新一天的航迹、停船消息没赶上时船沿旧航迹一直跑到第二天末。普通档后端日结 105–439 毫秒约合 50–211 游戏分钟，基本不受影响；
 * 快进、极快档在日界会有零点一秒上下的短停。
 */
export const PLAY_LEAD_MAX_MIN = 240;
/** H10iF4：暂停时画面领先、原地停住以后，恢复时先按这么多倍速慢慢起步，等后端走到画面的位置。 */
const PLAY_RESUME_K = 0.3;
/** 到领先上限前这么多游戏分钟里逐渐慢下来。 */
const PLAY_LEAD_RAMP_MIN = 60;
/** 领先的上限（游戏分钟）：PLAY_LEAD_MAX_MIN、PLAY_LEAD_MAX_MS 折成的分钟、0.9 天，取最小。 */
export function leadCapMin(nominalMinPerMs: number): number {
  return Math.min(PLAY_LEAD_MAX_MIN, PLAY_LEAD_MAX_MS * nominalMinPerMs, 0.9 * MINUTES_PER_DAY);
}
/** 播放与后端差这么多（实时毫秒）时速度调 10%（微调的力度；调幅夹在 ±PLAY_TRIM）。 */
export const PLAY_TRIM_MS = 3000;
const PLAY_TRIM = 0.1;
/** 暂停时播放缓回确认分钟的时间常数（毫秒；约 4–5 倍缓完）。 */
const PAUSE_SETTLE_TAU_MS = 80;
/** 落后超过这么多（实时毫秒）才用力追（最多 4 倍；读档、后台标签页回来）。 */
export const PLAY_BEHIND_MAX_MS = 1500;
/** 后端实际推进速度的平均窗口：至少这么久（实时毫秒），且不短于 PLAY_RATE_DAYS 个游戏日。 */
const PLAY_RATE_WINDOW_MS = 4000;
const PLAY_RATE_DAYS = 2.5;
/** 位置差沿航迹“领先”的部分（画面比权威航迹靠前）：每帧最多吃掉船这一帧前进量的这么多，画面只进不退。 */
const AHEAD_ABSORB = 0.5;
/** 位置差的横向部分：每帧最多消掉船这一帧前进量的这么多（tan 11° 左右）。 */
const CROSS_ABSORB = 0.2;
/** H10iF4：位置差消除的每秒上限（格 / 秒）：沿航迹、横向。 */
const ALONG_MAX_PER_S = 0.6;
const CROSS_MAX_PER_S = 0.3;
/** H10iF4：暂停时画面与新航迹在同一分钟的位置差超过这么多格，就当外推走偏了（可能画到了陆上），缓回停点。 */
export const RETREAT_CELLS = 0.3;
/** 必须退时位置差缓掉的时间常数（毫秒；约 3 倍即缓完）。 */
const OFFSET_TAU_MS = 100;
/** 位置差超过这么多格就不缓了，直接换过去（换舰队、读档、瞬移）。 */
export const SNAP_CELLS = 4;
/** 判断“停没停”时前后各取多少分钟（H10iF2 起船头的方向改按距离取弦，见 HEADING_CHORD）。 */
export const HEADING_WINDOW = 20;
/** 弦短于这么多格就算停着。 */
const MIN_CHORD = 0.02;
/**
 * H10iF2 船头取弦按**距离**：从播放到的分钟往前后对称地展开，直到两端的直线距离够 HEADING_CHORD 格
 * （航迹点是 1/256 格的定点数，0.3 格的弦量化误差不到 1.5°）。X06 量到慢行、慢速时固定 ±20 分钟的弦只有几百分之一格，
 * 被量化盖过，画出来的船头每秒左右来回 5–17 次。
 */
export const HEADING_CHORD = 0.3;
/** 展开时每一侧最多取多少游戏分钟；凑不够距离就沿用上一次的方向（慢到这个份上，方向本来也看不出来）。 */
export const HEADING_MAX_MIN = 360;
/** H10iF4：取弦每侧至少覆盖这么多实时毫秒的航程（快进、极快时一天里的小弯在屏上只有零点几秒，按实时把弦拉长）。 */
export const HEADING_MIN_SPAN_MS = 250;
/** H10iF4：出港后头这么多实时毫秒里船头直接跟着航迹方向，不按转速上限缓。 */
export const DEPART_SNAP_MS = 600;
/** 展开的步长（游戏分钟）。 */
const HEADING_STEP_MIN = 5;
/** 对地方向变化小于这么多度不追（死区），只在航迹真的折了时转。 */
export const HEADING_DEADBAND_DEG = 4;
/**
 * H10hF：对地航向离舵向超过这么多度，就算“漂”（逆风禁区里被吹着倒退、被流推着横移），船头画舵向，不画漂的方向。
 * 换舷、洋流与纬度修正造成的偏差在这以内，照旧画对地航向（H10a 修好的“朝向诡异”不回来）。
 */
export const DRIFT_DEG = 60;

type CoursePoints = CoursePreview["points"];
export type ClockSample = { day: number; minute: number; speed: number; sampledAt: number };

/** 平滑因子：f 从 1 降到 0 时先慢后快再慢（smoothstep）。 */
function ease(f: number): number {
  const t = Math.max(0, Math.min(1, f));
  return t * t * (3 - 2 * t);
}

/** 方向向量（x 向东、y 向南）→ 航向（0 北、顺时针）。 */
function headingOf(dx: number, dy: number): number {
  return normDeg((Math.atan2(dx, -dy) * 180) / Math.PI);
}

/**
 * 船在“漂”：对地航向离舵向超过 DRIFT_DEG。手动航行时舵向就是罗经盘上的读数，一天里不会过期，直接比；
 * 自动航行时航行视图的舵向一天只取一次（领航中途换舷了它还是旧的），所以只在舵向本身落在逆风禁区里（帆吃不上风，
 * 动起来只能是被吹、被推）时才算——否则换舷后的新一舷会被当成“漂”，船头倒去画过期的舵向。
 */
export function drifting(ground: number, nav: Pick<NavView, "heading" | "autopilot" | "wind" | "sail_limit">): boolean {
  if (Math.abs(angleDiff(ground, nav.heading)) <= DRIFT_DEG) return false;
  // H10iF 抢风：舵向是朝瞄准点的方位，本来就在逆风禁区里，船是照平均航向在走，不是漂
  if (nav.autopilot?.mode === "beat") return false;
  return nav.autopilot === null || inIrons(nav.heading, nav.wind.dir, nav.sail_limit);
}

/** 按转速上限把 from 转向 to（走最短的那一边；dtMs 是两帧之间的实际间隔，一步转够了就停在 to 上）。 */
export function turnToward(from: number, to: number, dtMs: number, rate = TURN_DEG_PER_S): number {
  const step = (rate * Math.max(0, dtMs)) / 1000;
  const d = angleDiff(from, to);
  return normDeg(from + Math.max(-step, Math.min(step, d)));
}

/**
 * H10iF 画出来的船头这一帧该在哪：还没画过（null）或 snap（暂停）时直接到位，否则按转速上限缓过去。
 * 只管画出来的船；罗经读数、航迹线、预测线用的是真实的舵向与航迹。
 */
export function nextHeading(shown: number | null, target: number, dtMs: number, snap = false, rate = TURN_DEG_PER_S): number {
  if (shown === null || snap) return normDeg(target);
  return turnToward(shown, target, dtMs, rate);
}

/**
 * 航迹上某分钟的位置：在航迹范围里按分钟插值；超出末端、且末端就是一天的结束时，按最后半小时的速度外推（最多 DEAD_RECKON_MIN）。
 */
export function courseAt(points: CoursePoints, minute: number, width: number, wrap: boolean): { x: number; y: number } | null {
  if (points.length === 0) return null;
  const last = points[points.length - 1];
  const lastMin = last[2];
  if (minute <= lastMin || lastMin < MINUTES_PER_DAY - 1) return positionAt(points, minute, width, wrap);
  const a = positionAt(points, lastMin - 30, width, wrap);
  if (!a) return { x: last[0], y: last[1] };
  const span = Math.max(1, lastMin - Math.max(points[0][2], lastMin - 30));
  const vx = wrapDx(a.x, last[0], width, wrap) / span;
  const vy = (last[1] - a.y) / span;
  const over = Math.min(DEAD_RECKON_MIN, minute - lastMin);
  const x = last[0] + vx * over;
  return { x: wrap && width > 0 ? modX(x, width) : x, y: last[1] + vy * over };
}

/**
 * H10iF2 对地航向（按距离取弦）：在 [lo, hi] 分钟范围里，从 minute 往前后各展开（每步 HEADING_STEP_MIN、每侧至多 HEADING_MAX_MIN），
 * 两端直线距离够 HEADING_CHORD 格时取这段弦的方向；一侧碰到范围边上就只展开另一侧。凑不够时为 null。
 */
export function chordHeading(points: CoursePoints, minute: number, lo: number, hi: number, width: number, wrap: boolean): number | null {
  if (points.length === 0) return null;
  return chordHeadingAt((m) => courseAt(points, m, width, wrap), minute, lo, hi, width, wrap);
}

/** chordHeading 的一般形式：pos 给出任一分钟的位置（H10iF3：往回取时可以接上一份航迹）。 */
export function chordHeadingAt(
  pos: (minute: number) => { x: number; y: number } | null,
  minute: number,
  lo: number,
  hi: number,
  width: number,
  wrap: boolean,
  minSpan = 0,
): number | null {
  // H10iF4：每侧至少展开 minSpan 分钟（快进、极快时按实时折算：一天里的小弯在屏上只有零点几秒，船头不跟着扭）
  const maxK = Math.max(HEADING_MAX_MIN, minSpan);
  for (let k = HEADING_STEP_MIN; k <= maxK; k += HEADING_STEP_MIN) {
    if (k < minSpan && minute - k > lo && minute + k < hi) continue;
    const ma = Math.max(lo, minute - k);
    const mb = Math.min(hi, minute + k);
    const a = pos(ma);
    const b = pos(mb);
    if (!a || !b) return null;
    const dx = wrapDx(a.x, b.x, width, wrap);
    const dy = b.y - a.y;
    if (Math.hypot(dx, dy) >= HEADING_CHORD) return headingOf(dx, dy);
    if (ma <= lo && mb >= hi) return null;
  }
  return null;
}

/** H10iF2 死区：新的对地方向离上一次的目标不到 HEADING_DEADBAND_DEG 时不追。ground 为 null（凑不够距离）时沿用上一次。 */
export function deadband(prev: number | null, ground: number | null): number | null {
  if (ground === null) return prev;
  if (prev !== null && Math.abs(angleDiff(prev, ground)) < HEADING_DEADBAND_DEG) return prev;
  return ground;
}

/** 一帧的采样结果。 */
export interface MotionSample {
  x: number;
  y: number;
  /** 画面上的船头（度） */
  heading: number;
  /** 播放到的分钟（相对 courseDay 那天的 6:00；换日后、新航迹到之前会超过 1440）。没有航迹时为 null */
  minute: number | null;
  /** 正在播的航迹（store 里的被清空时是手上的最后一份）与它所属的日子 */
  course: CoursePreview | null;
  courseDay: number;
  /** 船在走（弦够长、时钟在走） */
  moving: boolean;
  /** H10iF3：船真的停了（收帆 / 锚泊，或播放停在停点上）——镜头只在这时回到船上（暂停、等后端都不算） */
  still: boolean;
  /** H10iF3：播放已越过后端确认的那一天的结束（日界，正在等后端结算） */
  waiting: boolean;
  /** H10iF3：这一帧的位置是外推的预测（播放越过了手上航迹的最后一点）；否则是后端给的权威航迹 */
  predicted: boolean;
  /** H10iF3：播放领先后端估计时刻多少实时毫秒（负为落后） */
  leadMs: number;
  /** H10iF4：画面领先后端最后确认的分钟多少游戏分钟（负为落后）；封顶 PLAY_LEAD_MAX_MIN 的就是它 */
  leadMin: number;
  /** H10iF4：画面领先后端此刻的估计（确认的分钟加推送之间按倍速的外推）多少游戏分钟 */
  leadEstMin: number;
  /** H10iF3：上一次换数据源（新航迹到）时，画面与新航迹之间的位置差（格；没有过为 null） */
  lastFix: number | null;
  /** 还有没转完的船头或没缓完的位置差（时钟停着也要接着画几帧） */
  animating: boolean;
}

/** 一条船的平滑状态：最后画出的位置、正在缓掉的位置差、船头与目标船头。 */
class Smooth {
  x = 0;
  y = 0;
  ox = 0;
  oy = 0;
  offAt = Number.NEGATIVE_INFINITY;
  heading: number | null = null;
  target: number | null = null;
  shown = false;

  /** 数据源换了：记下旧画面与新数据之间的差，SETTLE_MS 内缓掉。差得太远（读档、瞬移）时直接换过去，船头也下一帧直接到位。 */
  rebase(rawX: number, rawY: number, now: number, width: number, wrap: boolean): void {
    if (!this.shown) return;
    const ox = wrapDx(rawX, this.x, width, wrap);
    const oy = this.y - rawY;
    if (Math.hypot(ox, oy) > SNAP_CELLS) {
      this.ox = 0;
      this.oy = 0;
      this.offAt = Number.NEGATIVE_INFINITY;
      this.heading = null;
      return;
    }
    this.ox = ox;
    this.oy = oy;
    this.offAt = now;
  }

  /** 这一帧画在哪儿（原始位置加上还没缓完的差）。返回还在不在缓。 */
  place(rawX: number, rawY: number, now: number, width: number, wrap: boolean): boolean {
    const k = ease(1 - (now - this.offAt) / SETTLE_MS);
    const x = rawX + this.ox * k;
    this.x = wrap && width > 0 ? modX(x, width) : x;
    this.y = rawY + this.oy * k;
    this.shown = true;
    return k > 0;
  }

  /** 船头朝目标转。snap 为真（暂停时）直接到位；头一帧（刚出港、读档、换舰队）也直接到位。返回还在不在转。 */
  turn(dtMs: number, snap = false): boolean {
    if (this.target === null) return false;
    this.heading = nextHeading(this.heading, this.target, dtMs, snap);
    return Math.abs(angleDiff(this.heading, this.target)) > 0.05;
  }
}

/** 一份手上的航迹与它所属的日子。 */
type Held = { course: CoursePreview; day: number };

/** 在一份航迹上取绝对分钟的位置（超出末端按 courseAt 外推）。 */
function heldAt(h: Held, abs: number, width: number, wrap: boolean): { x: number; y: number } | null {
  return courseAt(h.course.points, abs - h.day * MINUTES_PER_DAY, width, wrap);
}

/** 这份航迹是不是在一天结束以前就停了（到港、等风、被挡）：这种不外推，走到末点为止。 */
function endsEarly(h: Held): boolean {
  const pts = h.course.points;
  return pts[pts.length - 1][2] < MINUTES_PER_DAY - 1;
}

/** 自己的船的平滑（一支舰队一个；换舰队时从头来）。 */
export class ShipMotion {
  private fleet = -1;
  private held: Held | null = null;
  /** H10iF3：上一份航迹（画面落后于新航迹开头时接着用） */
  private prev: Held | null = null;
  private lastAbs: number | null = null;
  private lastNow: number | null = null;
  private src: unknown = null;
  private helm: number | null = null;
  /** H10iF2：上一次采用的对地方向（死区与“凑不够距离就沿用”用） */
  private ground: number | null = null;
  /** H10iF4：出港（或读档、换舰队）以后还没取到过对地方向：取到的第一下船头直接到位，不从舵向转过去 */
  private groundSeen = false;
  /** H10iF3：画面相对原始位置的差（格）：新航迹到时记下，沿航迹慢慢消掉 */
  private ox = 0;
  private oy = 0;
  private lastFix: number | null = null;
  /** H10iF3：上一帧画到的绝对分钟（新停点在它之前时原地等，不往回拉） */
  private lastAt: number | null = null;
  /** H10iF3：上一帧的原始位置（算这一帧船沿航迹前进了多少） */
  private lastRaw: { x: number; y: number } | null = null;
  /** H10iF3：后端实际推进的记录（实时毫秒、确认过的绝对分钟），算平均速度；倍速换了清空 */
  private hist: { t: number; m: number }[] = [];
  private histSpeed = -1;
  /** H10iF4：暂停时画面领先、原地停住了：恢复以后等后端走到这一分钟再接着走 */
  private waitUntil: number | null = null;
  /** H10iF4：暂停中画面必须缓回停点（画过了航迹的终点、或与新航迹对不上）——上一帧判的 */
  private retreat = false;
  /** H10iF4：画出来的位置的记录（绝对分钟、位置）：船头往回取弦用画出来的，不用回填的权威位置 */
  private trail: { m: number; x: number; y: number }[] = [];
  /** H10iF4：出港以后第一次看到的确认分钟；确认的分钟变过（后端的时钟真的走起来了）才外推 */
  private firstConfirmed: number | null = null;
  /** H10iF4：出港后取到对地方向以来时钟走过的实时毫秒 */
  private departRunMs = 0;
  private clockMoved = false;
  private s = new Smooth();
  private cache: { now: number; nav: NavView; course: CoursePreview | null; draft: number | null; out: MotionSample } | null = null;

  reset(): void {
    this.fleet = -1;
    this.held = null;
    this.prev = null;
    this.lastAbs = null;
    this.lastNow = null;
    this.src = null;
    this.helm = null;
    this.ground = null;
    this.groundSeen = false;
    this.ox = 0;
    this.oy = 0;
    this.lastFix = null;
    this.lastAt = null;
    this.lastRaw = null;
    this.hist = [];
    this.histSpeed = -1;
    this.waitUntil = null;
    this.retreat = false;
    this.trail = [];
    this.firstConfirmed = null;
    this.clockMoved = false;
    this.departRunMs = 0;
    this.s = new Smooth();
    this.cache = null;
  }

  /** 后端实际推进的平均速度（游戏分钟 / 实时毫秒）：含日结的停顿；记录不够长时用名义速度。 */
  private backendRate(confirmed: number, clock: ClockSample, now: number, nominal: number): number {
    if (clock.speed !== this.histSpeed) {
      this.hist = [];
      this.histSpeed = clock.speed;
    }
    const last = this.hist[this.hist.length - 1];
    if (!last || confirmed !== last.m) this.hist.push({ t: now, m: confirmed });
    const window = Math.max(PLAY_RATE_WINDOW_MS, PLAY_RATE_DAYS * dayLengthMs(clock.speed));
    while (this.hist.length > 2 && now - this.hist[1].t > window) this.hist.shift();
    const first = this.hist[0];
    const span = now - first.t;
    if (span < window * 0.6 || confirmed <= first.m) return nominal;
    // 窗口里后端走过的分钟 / 实时（到此刻为止：日结停着的时候平均速度跟着往下掉）
    return Math.max(nominal * 0.4, Math.min(nominal * 1.05, (confirmed - first.m) / span));
  }

  /**
   * 播放的时钟（绝对分钟，跨日连续）。H10iF3：按后端实际推进的平均速度匀速走（日结的停顿摊到全天），与后端时钟的差只做 ±PLAY_TRIM 的微调。
   * H10iF4：领先后端确认的分钟最多 leadCap（PLAY_LEAD_MAX_MIN 游戏分钟，且不超过 PLAY_LEAD_MAX_MS 实时），到顶前逐渐停住；
   * 暂停时画面领先就原地停住（不往回拉），恢复后等后端走到这一分钟再接着走；只有 retreat（必须退）时才缓回确认的分钟。
   */
  private playMinute(confirmed: number, clock: ClockSample, now: number, dt: number): { play: number; est: number; leadMs: number } {
    // H10b：一天的实时长度以后端的 day_ms 为准（海上四档与港内不同）；暂停时为 Infinity，rate 为 0。
    const nominal = clock.speed > 0 ? MINUTES_PER_DAY / dayLengthMs(clock.speed) : 0;
    // 后端此刻的估计：确认的分钟加推送之间按倍速的外推。H10iF4：不越过确认的那一天的结束（后端到 6:00 一定要停下来结算）
    const dayEnd = Math.floor(confirmed / MINUTES_PER_DAY) * MINUTES_PER_DAY + MINUTES_PER_DAY;
    // H10iF4：出港（或读档、换舰队）以后，后端的时钟真的走起来（确认的分钟变过）以前不外推——X08-dev2 量到出港那半秒后端还没动，
    // 画面先按倍速外推出去两百多分钟，暂停后停在那儿、恢复时要等
    if (this.firstConfirmed === null) this.firstConfirmed = confirmed;
    else if (confirmed !== this.firstConfirmed) this.clockMoved = true;
    // 外推另按游戏分钟封顶（极快档 250 毫秒就是大半天；X08-dev2 量到推送断了一阵时估计的时刻一下跑出去一千多分钟）
    const extrap = clock.speed > 0 && this.clockMoved ? Math.min(PLAY_LEAD_MAX_MIN, Math.min(EXTRAPOLATE_MS, Math.max(0, now - clock.sampledAt)) * nominal) : 0;
    const est = Math.min(Math.max(confirmed, dayEnd), confirmed + extrap);
    let play = this.lastAbs;
    // 差得太远直接对齐（读档、拖了很久）：落后超过 0.75 天，或领先确认的分钟超过一天
    if (play === null || confirmed - play > MINUTES_PER_DAY * 0.75 || play - confirmed > MINUTES_PER_DAY) {
      play = est;
      this.waitUntil = null;
    } else if (nominal > 0) {
      const rate = this.backendRate(confirmed, clock, now, nominal);
      const leadMs = (play - est) / nominal;
      let k: number;
      if (this.waitUntil !== null && est < this.waitUntil - 0.5) {
        // 暂停前画面已经领先、原地停着：恢复以后慢慢起步（PLAY_RESUME_K 倍速），等后端追上来再照常走
        k = PLAY_RESUME_K;
      } else {
        this.waitUntil = null;
        // 微调朝“后端最后确认的分钟”对齐（不朝外推的时刻）：推送之间画面略落后于后端，到领先上限还有余地，
        // 极快档推送之间隔两三百游戏分钟也不会每次都顶到上限停一下
        const leadC = (play - confirmed) / nominal;
        if (leadMs < -PLAY_BEHIND_MAX_MS) k = 1 + Math.min(3, (-leadMs - PLAY_BEHIND_MAX_MS) / 300);
        else k = 1 + Math.max(-PLAY_TRIM, Math.min(PLAY_TRIM, (-leadC / PLAY_TRIM_MS) * PLAY_TRIM));
      }
      // H10iF4：领先后端最后确认的分钟的上限（游戏分钟）：到顶前 PLAY_LEAD_RAMP_MIN 分钟里逐渐慢下来
      const cap = leadCapMin(nominal);
      const ramp = Math.min(PLAY_LEAD_RAMP_MIN, cap / 2);
      const leadMin = play - confirmed;
      if (leadMin > cap - ramp) k *= Math.max(0, (cap - leadMin) / ramp);
      play = Math.min(play + rate * k * dt, Math.max(play, confirmed + cap));
    } else {
      // 暂停期间不算后端的推进速度（恢复后从头量，不把暂停的时间摊进去）
      this.hist = [];
      this.histSpeed = 0;
      if (play > est + 0.5 && !this.retreat) {
        // H10iF4：画面领先：原地停住，恢复后等后端走到这里
        this.waitUntil = play;
      } else {
        // 落后（追到确认的分钟），或必须退：约 0.35 秒缓过去
        this.waitUntil = null;
        play += (est - play) * (1 - Math.exp(-dt / PAUSE_SETTLE_TAU_MS));
        if (Math.abs(est - play) < 0.5) play = est;
      }
    }
    this.lastAbs = play;
    return { play, est, leadMs: nominal > 0 ? (play - est) / nominal : 0 };
  }

  /** 画出来的位置的记录里某分钟的位置（记录覆盖不到时为 null）。 */
  private trailAt(m: number): { x: number; y: number } | null {
    const t = this.trail;
    if (t.length === 0 || m < t[0].m || m > t[t.length - 1].m) return null;
    let lo = 0;
    let hi = t.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (t[mid].m <= m) lo = mid;
      else hi = mid;
    }
    const a = t[lo];
    const b = t[hi];
    const f = b.m === a.m ? 1 : (m - a.m) / (b.m - a.m);
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  }

  sample(nav: NavView | null, course: CoursePreview | null, draft: number | null, clock: ClockSample, now: number, width: number, wrap: boolean): MotionSample | null {
    if (!nav) {
      this.reset();
      return null;
    }
    // 航行视图与世界海图同一帧各问一次：给同一个结果
    const c = this.cache;
    if (c && c.now === now && c.nav === nav && c.course === course && c.draft === draft) return c.out;
    if (nav.fleet !== this.fleet) {
      this.reset();
      this.fleet = nav.fleet;
    }
    // 手上的航迹比航行视图还晚（读了旧档）：不再用
    if (this.held && this.held.day > nav.day) {
      this.held = null;
      this.prev = null;
    }
    if (course && course.points.length > 0 && this.held?.course !== course) {
      this.prev = this.held;
      this.held = { course, day: nav.day };
    }
    // 两帧之间的实际间隔：船头的缓动用不夹的（后台标签页回来、掉帧时一步转够，不追不上），播放的时钟照旧夹 100 ms
    const rawDt = this.lastNow === null ? 0 : Math.max(0, now - this.lastNow);
    const dt = Math.min(100, rawDt);
    this.lastNow = now;

    // 播放的分钟（跨日连续）。“确认过的”取航行视图的分钟与后端时钟推送的分钟里晚的那个
    const confirmed = Math.max(nav.day * MINUTES_PER_DAY + nav.minute, clock.day * MINUTES_PER_DAY + navMinute(clock.minute));
    const { play: abs, est, leadMs } = this.playMinute(confirmed, clock, now, dt);
    const held = this.held;
    let minute: number | null = null;
    let rawX = nav.pos.x;
    let rawY = nav.pos.y;
    let chord: { dx: number; dy: number } | null = null;
    let atStop = false;
    /** 原地等后端（不往回拉）：位置差也不动 */
    let freeze = false;
    let predicted = false;
    let at: number | null = null;
    let limitAbs = Infinity;
    let pastEnd = false;
    let posAt: ((m: number) => { x: number; y: number } | null) | null = null;
    let lo = 0;
    /** 这一帧实际在播的那份航迹（画面落后于新航迹的开头时是上一份） */
    let shown: Held | null = held;
    if (held) {
      const base = held.day * MINUTES_PER_DAY;
      const pts = held.course.points;
      const first = pts[0][2];
      const lastMin = pts[pts.length - 1][2];
      // H10iF4：计划内的停（航迹在一天结束以前就完了：到港、等风、被挡）不外推，走到末点为止；整天的航迹外推最多一天（领先另有上限）
      let limit = base + lastMin + (endsEarly(held) ? 0 : DEAD_RECKON_MIN);
      for (const stop of held.course.stops) {
        // 普通商船进入视野不停船（与 NavPlayback 一致）
        if (stop.kind === "sight" && stop.loc === null) continue;
        if (base + stop.minute >= confirmed) limit = Math.min(limit, base + stop.minute);
      }
      // 航行视图已经换到新的一天、航迹还是旧的时，新一天的停点也算（H10iF2）
      if (nav.day !== held.day) {
        for (const stop of nav.stops ?? []) {
          if (stop.kind === "sight" && stop.loc === null) continue;
          const m = nav.day * MINUTES_PER_DAY + stop.minute;
          if (m >= confirmed) limit = Math.min(limit, m);
        }
      }
      limitAbs = limit;
      // H10iF3：新航迹从后端此刻的分钟开始；画面落后于它时，这一段接着用上一份航迹（上一份是整天的才外推）
      const start = base + first;
      const prev = this.prev;
      const prevStart = prev ? prev.day * MINUTES_PER_DAY + prev.course.points[0][2] : Infinity;
      const prevOk = prev !== null && prevStart < start;
      posAt = (m: number) => (prev && prevOk && m < start ? heldAt(prev, m, width, wrap) : courseAt(pts, m - base, width, wrap));
      // 夹在航迹的范围里（停在暂停点上时，播放的时钟也停在那儿，恢复后从那儿接着走）
      let a = Math.min(limit, abs);
      if (a < abs) {
        this.lastAbs = a;
        atStop = true;
      }
      if (this.lastAt !== null && a < this.lastAt - 0.5) {
        if (clock.speed > 0 || !this.retreat) {
          // 新知道的停点在画面已经走过的地方：不往回拉，原地等（H10iF3）；暂停时也一样（H10iF4），只有必须退时才退
          a = this.lastAt;
          this.lastAbs = Math.max(this.lastAbs ?? a, a);
          atStop = true;
          freeze = true;
        } else {
          // 必须退：约 0.35 秒缓回停点，不一帧跳回
          a = this.lastAt + (a - this.lastAt) * (1 - Math.exp(-dt / PAUSE_SETTLE_TAU_MS));
          this.lastAbs = a;
        }
      }
      lo = prevOk ? prevStart : start;
      a = Math.max(lo, a);
      at = a;
      this.lastAt = a;
      const onPrev = prev !== null && prevOk && a < start;
      shown = onPrev ? prev : held;
      minute = a - shown.day * MINUTES_PER_DAY;
      const sp = shown.course.points;
      predicted = minute > sp[sp.length - 1][2];
      // 画过了一份提前结束的航迹的末点（到港、陆上、被挡）：这种停下来必须退
      pastEnd = endsEarly(shown) && minute > sp[sp.length - 1][2] + 0.5;
      const p = posAt(a);
      if (p) {
        rawX = p.x;
        rawY = p.y;
      }
      // 停没停：前后各 HEADING_WINDOW 分钟的弦够不够长（两端夹在航迹与外推的范围里）
      const pa = posAt(Math.max(lo, a - HEADING_WINDOW));
      const pb = posAt(Math.min(limit, a + HEADING_WINDOW));
      if (pa && pb) chord = { dx: wrapDx(pa.x, pb.x, width, wrap), dy: pb.y - pa.y };
    }

    // 数据源换了（新航迹、或没有航迹时新的航行视图）：记下画面与新数据之间的差，下面慢慢消掉
    const src = shown?.course ?? nav;
    if (src !== this.src) {
      if (this.s.shown) {
        const ox = wrapDx(rawX, this.s.x, width, wrap);
        const oy = this.s.y - rawY;
        const d = Math.hypot(ox, oy);
        if (d > SNAP_CELLS) {
          this.ox = 0;
          this.oy = 0;
          this.s.heading = null;
          this.lastRaw = null;
          this.trail = [];
        } else {
          this.ox = ox;
          this.oy = oy;
          // 换数据源这一帧的“前进量”不算（两份航迹之间的差不是船走的路）
          this.lastRaw = { x: rawX, y: rawY };
        }
        this.lastFix = d;
      }
      this.src = src;
    }

    // 位置差：船在走时沿航迹（弦的方向）领先的部分每帧最多吃掉前进量的 AHEAD_ABSORB（只进不退），落后的最多多走这么多；
    // 横向的每帧最多消掉前进量的 CROSS_ABSORB；两者另有每秒的上限（H10iF4：新航迹到的那一下不跳）。
    // 原地等时不动；暂停中必须退时按 OFFSET_TAU_MS 缓掉；暂停中不退时也不动
    const step = this.lastRaw ? Math.hypot(wrapDx(this.lastRaw.x, rawX, width, wrap), rawY - this.lastRaw.y) : 0;
    this.lastRaw = { x: rawX, y: rawY };
    const len = chord ? Math.hypot(chord.dx, chord.dy) : 0;
    const sec = rawDt / 1000;
    if (freeze || (clock.speed <= 0 && !this.retreat) || (clock.speed > 0 && atStop)) {
      // 原地等 / 暂停中停住 / 时钟在走但停在停点上（外推用完、等后端）：画面一动不动，不往回缩
    } else if (chord && len > 1e-6 && clock.speed > 0 && !atStop) {
      const ux = chord.dx / len;
      const uy = chord.dy / len;
      let along = this.ox * ux + this.oy * uy;
      let cx = this.ox - along * ux;
      let cy = this.oy - along * uy;
      const cl = Math.hypot(cx, cy);
      if (cl > 0) {
        const k = Math.max(0, cl - Math.min(CROSS_ABSORB * step, CROSS_MAX_PER_S * sec)) / cl;
        cx *= k;
        cy *= k;
      }
      const take = Math.min(AHEAD_ABSORB * step, ALONG_MAX_PER_S * sec);
      along = along > 0 ? Math.max(0, along - take) : Math.min(0, along + take);
      this.ox = cx + along * ux;
      this.oy = cy + along * uy;
    } else {
      const decay = Math.exp(-rawDt / OFFSET_TAU_MS);
      this.ox *= decay;
      this.oy *= decay;
    }
    if (Math.hypot(this.ox, this.oy) < 1e-4) {
      this.ox = 0;
      this.oy = 0;
    }
    const x = rawX + this.ox;
    this.s.x = wrap && width > 0 ? modX(x, width) : x;
    this.s.y = rawY + this.oy;
    this.s.shown = true;
    const settling = this.ox !== 0 || this.oy !== 0;

    // H10iF4：暂停中要不要退——画过了提前结束的航迹的末点（到港、被挡），或画面与新航迹在同一分钟的位置差得远（外推走偏了，可能画到了陆上）
    this.retreat = clock.speed <= 0 && (pastEnd || Math.hypot(this.ox, this.oy) > RETREAT_CELLS);

    // 画出来的位置的记录（船头往回取弦用）。停住过（暂停、原地等）就从头记：停的时候新航迹可能换了方向，
    // 往回取到停之前的那一段，船头会在起步后很久还朝着旧方向（X08-dev2 量到恢复后夹角 30–45°）
    if (freeze || clock.speed <= 0) this.trail = [];
    else if (at !== null) {
      const t = this.trail;
      const lastT = t[t.length - 1];
      if (!lastT || at > lastT.m + 0.01) t.push({ m: at, x: this.s.x, y: this.s.y });
      else if (at < lastT.m - 0.01) {
        // 退回去了：退过的那段记录作废
        while (t.length && t[t.length - 1].m > at) t.pop();
        t.push({ m: at, x: this.s.x, y: this.s.y });
      }
      while (t.length > 2 && t[0].m < at - HEADING_MAX_MIN - 30) t.shift();
    }

    // 船头的目标
    // 收帆、锚泊时船身不跟着洋流漂的方向转（“停船保持最后的朝向”）；改了舵照样转过去。
    // H10iF3：所有模式都按航迹取弦；H10iF4：取弦用画出来的位置——往回取记录里画过的，往前取航迹加上眼下还没消掉的位置差
    const creep = nav.autopilot?.mode === "creep";
    const stopped = !creep && (nav.sail === "furled" || nav.shore?.anchored === true);
    const moving = !stopped && !!chord && Math.hypot(chord.dx, chord.dy) >= MIN_CHORD;
    let groundRaw: number | null = null;
    // 原地等、暂停中停住时不重取方向（停点在画面后面时往前取不到，取出来是反的）：船头保持
    const holding = (freeze || (clock.speed <= 0 && !this.retreat)) && this.groundSeen;
    if (moving && posAt && at !== null && !holding) {
      const ox = this.ox;
      const oy = this.oy;
      const fwd = posAt;
      const nowAt = at;
      const drawnAt = (m: number) => {
        if (m < nowAt) {
          const h = this.trailAt(m);
          if (h) return h;
        }
        const p = fwd(m);
        return p ? { x: p.x + ox, y: p.y + oy } : null;
      };
      const lo2 = this.trail.length ? Math.min(lo, this.trail[0].m) : lo;
      const span = clock.speed > 0 ? (HEADING_MIN_SPAN_MS * MINUTES_PER_DAY) / dayLengthMs(clock.speed) : 0;
      groundRaw = chordHeadingAt(drawnAt, at, Math.min(lo2, at), Math.max(limitAbs, at), width, wrap, span);
    }
    if (!moving) this.ground = null;
    let snapHeading = clock.speed <= 0 && (!holding || draft !== null);
    if (draft !== null) this.s.target = draft;
    else if (holding && this.s.target !== null) {
      // 停住：船头不动
    } else if (moving) {
      this.ground = deadband(this.ground, groundRaw ?? (this.ground === null && chord ? headingOf(chord.dx, chord.dy) : null));
      if (this.ground !== null) {
        this.s.target = !creep && drifting(this.ground, nav) ? nav.heading : this.ground;
        // H10iF4：出港后取到对地方向的头 DEPART_SNAP_MS 毫秒里船头直接跟着航迹（出港的那一下航迹常常就地拐九十度，
        // 按转速上限转要半秒，船头横着走出港）
        this.groundSeen = true;
        if (clock.speed > 0) this.departRunMs += rawDt;
        if (this.departRunMs < DEPART_SNAP_MS) snapHeading = true;
      }
    } else if (!held && !this.groundSeen && nav.forecast.length > 0) {
      // H10iF4：出港后航迹还没到：先照航行视图的预测线起点的方向画
      const f = nav.forecast.find((q) => Math.hypot(wrapDx(nav.pos.x, q[0], width, wrap), q[1] - nav.pos.y) >= MIN_CHORD) ?? null;
      this.s.target = f ? headingOf(wrapDx(nav.pos.x, f[0], width, wrap), f[1] - nav.pos.y) : nav.heading;
      snapHeading = true;
    } else if (this.s.target === null || (this.helm !== null && nav.heading !== this.helm)) this.s.target = nav.heading;
    this.helm = nav.heading;
    // 暂停时直接到位（拖罗经盘、改舵都当场看到）；走着时按转速上限缓
    const turning = this.s.turn(rawDt, snapHeading);

    const out: MotionSample = {
      x: this.s.x,
      y: this.s.y,
      heading: this.s.heading ?? nav.heading,
      minute,
      course: shown?.course ?? null,
      courseDay: shown?.day ?? nav.day,
      moving: moving && clock.speed > 0,
      still: stopped || (atStop && !freeze) || !held,
      waiting: (at ?? abs) > Math.floor(confirmed / MINUTES_PER_DAY) * MINUTES_PER_DAY + MINUTES_PER_DAY,
      predicted,
      leadMs,
      leadMin: at === null ? 0 : at - confirmed,
      leadEstMin: at === null ? 0 : at - est,
      lastFix: this.lastFix,
      animating: settling || turning,
    };
    this.cache = { now, nav, course, draft, out };
    return out;
  }
}

/** 旗舰队的那一份（航行视图与世界海图共用）。 */
export const flagshipMotion = new ShipMotion();
// H10iF3 验收用：开发模式下把这一份挂到 window.__flagshipMotion（验收脚本包它的 sample 记逐帧数据；
// vite 热更新以后应用用的是带 ?t= 的新模块，脚本按路径 import 拿到的是另一份）。正式包里没有
if (import.meta.env.DEV && typeof window !== "undefined") (window as unknown as { __flagshipMotion?: ShipMotion }).__flagshipMotion = flagshipMotion;
// 航行视图被清掉（靠港、换局、读档）时从头来，不拿上一局的航迹接着播
useNavStore.subscribe((s, prev) => {
  if (!s.nav && prev.nav) flagshipMotion.reset();
});

/** 从 store 里读航行视图、航迹、草稿与时钟，采样旗舰队这一帧的船位与船头（不在海上时为 null）。 */
export function sampleFlagship(now: number, width: number, wrap: boolean): MotionSample | null {
  const { nav, course, draft } = useNavStore.getState();
  return flagshipMotion.sample(nav, course, draft, useClockStore.getState(), now, width, wrap);
}

/**
 * 别的船在某分钟的原始位置：在 shipAt（navSea.ts）之外，换日后、新的航行视图到之前（分钟超过 1440）沿最后的方向外推。
 */
function otherAt(ship: NavShip, minute: number | null): { x: number; y: number } {
  if (minute === null || minute <= MINUTES_PER_DAY) return shipAt(ship, minute);
  const over = Math.min(DEAD_RECKON_MIN, minute - MINUTES_PER_DAY);
  if (ship.track.length > 1) {
    const n = ship.track.length;
    const [ax, ay] = ship.track[n - 2];
    const [bx, by] = ship.track[n - 1];
    return { x: bx + ((bx - ax) / 15) * over, y: by + ((by - ay) / 15) * over };
  }
  if (ship.from && ship.to) {
    const t = 1 + over / MINUTES_PER_DAY;
    return { x: ship.from[0] + (ship.to[0] - ship.from[0]) * t, y: ship.from[1] + (ship.to[1] - ship.from[1]) * t };
  }
  return { x: ship.x, y: ship.y };
}

/** 别的船的目标船头：追击航迹取前后 15 分钟的弦；走航线的取日初到日末的方向（不再是后端给的 8 个方向）；都没有时用后端的。 */
function otherHeading(ship: NavShip, minute: number | null, width: number, wrap: boolean): number {
  if (ship.track.length > 1 && minute !== null) {
    const a = otherAt(ship, Math.max(0, minute - 15));
    const b = otherAt(ship, minute + 15);
    const dx = wrapDx(a.x, b.x, width, wrap);
    if (Math.hypot(dx, b.y - a.y) > 1e-3) return headingOf(dx, b.y - a.y);
  }
  if (ship.from && ship.to) {
    const dx = wrapDx(ship.from[0], ship.to[0], width, wrap);
    const dy = ship.to[1] - ship.from[1];
    if (Math.hypot(dx, dy) > 1e-3) return headingOf(dx, dy);
  }
  return ship.heading;
}

/** 别的船的平滑：按 id 记各自的位置差与船头；换了一份航行视图时缓掉位置差。 */
export class OthersMotion {
  private states = new Map<string, Smooth>();
  private src: unknown = null;
  private lastNow: number | null = null;
  /** 上一帧还有没缓完、没转完的 */
  animating = false;

  place(ships: readonly NavShip[] | undefined, minute: number | null, src: unknown, now: number, width: number, wrap: boolean): PlacedShip[] {
    // 船头按两帧之间的实际间隔缓（H10iF，不夹）
    const dt = this.lastNow === null ? 0 : Math.max(0, now - this.lastNow);
    this.lastNow = now;
    const rebase = src !== this.src;
    this.src = src;
    const out: PlacedShip[] = [];
    const seen = new Set<string>();
    let animating = false;
    for (const ship of ships ?? []) {
      seen.add(ship.id);
      let s = this.states.get(ship.id);
      if (!s) {
        s = new Smooth();
        this.states.set(ship.id, s);
      }
      const raw = otherAt(ship, minute);
      if (rebase) s.rebase(raw.x, raw.y, now, width, wrap);
      if (s.place(raw.x, raw.y, now, width, wrap)) animating = true;
      s.target = otherHeading(ship, minute, width, wrap);
      if (s.turn(dt)) animating = true;
      out.push({ ship: { ...ship, heading: s.heading ?? ship.heading }, x: s.x, y: s.y });
    }
    for (const id of [...this.states.keys()]) if (!seen.has(id)) this.states.delete(id);
    this.animating = animating;
    return out;
  }
}

/** 航迹线每隔几分钟取一点（逐分钟的点一天 1440 个，画线不必那么密）。 */
const TRAIL_STRIDE = 4;

/** 航迹按分钟抽稀后的点（每份航迹算一次）。 */
const thinned = new WeakMap<CoursePreview, { pts: (readonly [number, number])[]; minutes: number[] }>();
function thin(course: CoursePreview): { pts: (readonly [number, number])[]; minutes: number[] } {
  let t = thinned.get(course);
  if (t) return t;
  const pts: (readonly [number, number])[] = [];
  const minutes: number[] = [];
  const all = course.points;
  all.forEach(([x, y, m], i) => {
    if (i % TRAIL_STRIDE === 0 || i === all.length - 1) {
      pts.push([x, y]);
      minutes.push(m);
    }
  });
  t = { pts, minutes };
  thinned.set(course, t);
  return t;
}

/**
 * 航迹线按播放到的分钟切成两段：走过的（今天日初以来的 trail + 航迹里已播过的 + 船现在的位置）与预测（船现在的位置 + 还没播的）。
 * 没有航迹时照旧用航行视图的 trail / forecast。
 */
export function splitTrail(
  nav: Pick<NavView, "trail" | "forecast" | "day">,
  course: CoursePreview | null,
  courseDay: number,
  minute: number | null,
  pos: { x: number; y: number },
): { walked: (readonly [number, number])[]; ahead: (readonly [number, number])[] } {
  const here = [pos.x, pos.y] as const;
  if (!course || minute === null || course.points.length === 0) return { walked: [...nav.trail, here], ahead: nav.forecast.length > 0 ? [here, ...nav.forecast] : [] };
  const { pts, minutes } = thin(course);
  // 第一个分钟晚于播放分钟的点
  let lo = 0;
  let hi = minutes.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (minutes[mid] <= minute) lo = mid + 1;
    else hi = mid;
  }
  const before = nav.day === courseDay ? nav.trail : [];
  const walked = before.length > 0 ? [...before, ...pts.slice(0, lo), here] : [...pts.slice(0, lo), here];
  const ahead = lo < pts.length ? [here, ...pts.slice(lo)] : [];
  return { walked, ahead };
}
