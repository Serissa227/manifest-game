// 时钟与昼夜（EXPANSION.md §9.2、§9.3）：一天 24 小时，每日结算在清晨 6:00。
// 这里只放纯函数：时段划分、时刻文字、每种速度下一天的实时长度，以及光照是否跟随时钟（防闪烁）。
// 街景、海图、航行小画面与顶栏都从这里取时段，保证各处一致。

/** 一天的分钟数。 */
export const MINUTES_PER_DAY = 1440;
/** 每日结算发生的时刻（6:00）。 */
export const DAY_START_MINUTE = 360;
/** 新游戏与没有时刻的旧存档的起始时刻（8:00）。 */
export const DEFAULT_MINUTE = 480;
/** 1× 时一天的实时长度（毫秒）。 */
export const BASE_DAY_MS = 4000;
/** 后端接受的倍速（与后端 settings::SPEEDS 一致；界面只给下面三档，其余几档留给旧存档、旧设置）。 */
export const SPEEDS = [1, 2, 4, 8, 16, 32] as const;
/**
 * 界面上的三档速度（与后端 settings::SPEED_TIERS 一致）：
 * 慢 2×（每天 2 秒）、普通 4×（每天 1 秒）、快 8×（每天 0.5 秒）。
 */
export const SPEED_TIERS = [2, 4, 8] as const;
/** 缺省的一档：普通。 */
export const NORMAL_SPEED = 4;
/** 档位的名字（界面文字见 i18n/zhOnly.ts 的 time.tier.*）；veryfast 只在海上有。 */
export type SpeedTier = "slow" | "normal" | "fast" | "veryfast";
export const TIER_NAMES: Record<(typeof SPEED_TIERS)[number], SpeedTier> = { 2: "slow", 4: "normal", 8: "fast" };
/**
 * H10b：海上四档（与后端 settings::SEA_TIERS / SEA_DAY_MS 一致）：慢 / 普通 / 快 / 极快，一天 6 / 3 / 1 / 0.5 秒。
 * 只在 Overview.sea_clock 为真时用；港内仍是上面三档。
 */
export const SEA_TIERS = [2, 4, 8, 16] as const;
export const SEA_DAY_MS: Record<(typeof SEA_TIERS)[number], number> = { 2: 6000, 4: 3000, 8: 1000, 16: 500 };
export const SEA_TIER_NAMES: Record<(typeof SEA_TIERS)[number], SpeedTier> = { 2: "slow", 4: "normal", 8: "fast", 16: "veryfast" };

/** 海上把任意倍速归到最近的一档（与后端 nearest_sea_tier 一致：一样近取较慢的一档；0 与无效值归“普通”）。 */
export function nearestSeaTier(speed: number): (typeof SEA_TIERS)[number] {
  if (!Number.isFinite(speed) || speed <= 0) return NORMAL_SPEED;
  let best: (typeof SEA_TIERS)[number] = SEA_TIERS[0];
  for (const t of SEA_TIERS) if (Math.abs(t - speed) < Math.abs(best - speed)) best = t;
  return best;
}

/** 当前口径下的档位（海上四档、港内三档）。 */
export function tiersFor(sea: boolean): readonly number[] {
  return sea ? SEA_TIERS : SPEED_TIERS;
}

/** 当前口径下归到最近的一档。 */
export function nearestTierFor(speed: number, sea: boolean): number {
  return sea ? nearestSeaTier(speed) : nearestTier(speed);
}

/** 某一档一天的实时长度（毫秒），照后端 clock::day_ms 算：海上查表，港内 4000 / min(倍速, 8)；暂停为 0。 */
export function tierDayMs(speed: number, sea: boolean): number {
  if (!Number.isFinite(speed) || speed <= 0) return 0;
  return sea ? SEA_DAY_MS[nearestSeaTier(speed)] : BASE_DAY_MS / Math.min(speed, 8);
}

/** 把任意倍速归到最近的一档（旧的 1× → 慢，16× / 32× → 快；0 与无效值归“普通”；一样近时取较慢的一档）。 */
export function nearestTier(speed: number): (typeof SPEED_TIERS)[number] {
  if (!Number.isFinite(speed) || speed <= 0) return NORMAL_SPEED;
  let best: (typeof SPEED_TIERS)[number] = SPEED_TIERS[0];
  for (const t of SPEED_TIERS) if (Math.abs(t - speed) < Math.abs(best - speed)) best = t;
  return best;
}
/** 一天短于这个实时长度时，光照固定为白天（防闪烁）。 */
export const MIN_CYCLE_DAY_MS = 2000;

/** 光照时段：黎明 5–7、白天 7–17、黄昏 17–19、夜晚 19–5。 */
export type Phase = "dawn" | "day" | "dusk" | "night";

/** 顶栏显示的时段名键：深夜 0–5、黎明 5–7、上午 7–11、正午 11–13、下午 13–17、黄昏 17–19、夜晚 19–24。 */
export type PeriodKey = "lateNight" | "dawn" | "morning" | "noon" | "afternoon" | "dusk" | "night";

/** 昼夜光影偏好：跟随时间，或始终白天。 */
export type DaylightPref = "clock" | "day";

/** 把任意整数分钟规范到 0–1439。 */
export function normMinute(minute: number): number {
  const m = Math.floor(Number.isFinite(minute) ? minute : DEFAULT_MINUTE);
  return ((m % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/** 某时刻所在的光照时段。 */
export function phaseOf(minute: number): Phase {
  const h = normMinute(minute) / 60;
  if (h >= 5 && h < 7) return "dawn";
  if (h >= 7 && h < 17) return "day";
  if (h >= 17 && h < 19) return "dusk";
  return "night";
}

/** 某时刻的时段名键。 */
export function periodOf(minute: number): PeriodKey {
  const h = normMinute(minute) / 60;
  if (h < 5) return "lateNight";
  if (h < 7) return "dawn";
  if (h < 11) return "morning";
  if (h < 13) return "noon";
  if (h < 17) return "afternoon";
  if (h < 19) return "dusk";
  return "night";
}

/** 时刻文字 “06:40”。 */
export function clockText(minute: number): string {
  const m = normMinute(minute);
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return `${hh < 10 ? "0" : ""}${hh}:${mm < 10 ? "0" : ""}${mm}`;
}

/**
 * H10b：后端最近一次告诉的“现在一天多少毫秒”（Overview / clock 事件的 day_ms），连同当时的倍速。
 * 由 store/clock.ts 写入；没写过（旧后端、测试）或是 0（暂停）时不起作用。
 */
const live = { speed: 0, dayMs: 0 };
export function setLiveDayMs(speed: number, dayMs: number | undefined): void {
  live.speed = speed;
  live.dayMs = typeof dayMs === "number" && Number.isFinite(dayMs) && dayMs > 0 ? dayMs : 0;
}

/**
 * 某速度下一天的实时长度（毫秒）；暂停时为 Infinity。
 * 倍速正是现在的倍速、后端又给了 day_ms 时以后端为准（海上四档的日长与港内不同）；否则按 1× 一天 4 秒折算（旧行为）。
 */
export function dayLengthMs(speed: number): number {
  if (speed > 0 && live.dayMs > 0 && speed === live.speed) return live.dayMs;
  return speed > 0 ? BASE_DAY_MS / speed : Infinity;
}

/** 光照是否跟随时钟：偏好为“始终白天”时不跟随；运行中一天短于 2 秒时不跟随；暂停时跟随（画面静止，不会闪烁）。 */
export function lightingFollowsClock(speed: number, pref: DaylightPref = "clock"): boolean {
  if (pref === "day") return false;
  return dayLengthMs(speed) >= MIN_CYCLE_DAY_MS;
}

/** 画面应使用的光照时段（考虑防闪烁与偏好）。 */
export function scenePhase(minute: number, speed: number, pref: DaylightPref = "clock"): Phase {
  return lightingFollowsClock(speed, pref) ? phaseOf(minute) : "day";
}

/** 夜色浓度 0..1（海图的夜间压暗用）：白天 0、夜晚 1，黎明与黄昏线性过渡。 */
export function nightAmount(minute: number): number {
  const h = normMinute(minute) / 60;
  if (h >= 7 && h < 17) return 0;
  if (h >= 19 || h < 5) return 1;
  if (h >= 5 && h < 7) return 1 - (h - 5) / 2;
  return (h - 17) / 2;
}
