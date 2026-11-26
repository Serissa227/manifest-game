// 旅店（components/port/Inn.tsx）的常量：可选的休息天数、分几次推进、两次之间的停顿（测试里改成 0）。

/** 可选的休息天数（另有“住到下月初”）。 */
export const INN_DAYS = [1, 3, 7] as const;

/**
 * 一段休息最多分几次推进：一周以内一天一次；住到下月初（二三十天）几天一次——每次推进都要回传整份概览，
 * 一天一次太慢。每次推进遇到要回应的事照样在那一天停下（step 本身的规矩）。
 */
export const INN_STEPS = 8;

/** 每次推进几天。 */
export function innChunk(total: number): number {
  return Math.max(1, Math.ceil(total / INN_STEPS));
}

/**
 * 两天之间停多久（毫秒）：让人看得见日子一天天过去，整段大约一秒多；测试里改成 0。
 * 一天的结算本身也要时间，这里只是下限。
 */
export const INN_PACE = { ms: (total: number): number => Math.max(40, Math.min(200, 1200 / Math.max(1, total))) };
