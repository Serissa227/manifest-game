// 航海画面的连续分钟：仅在已知航迹上按帧推进，不写回时钟或参与命令。
import type { CoursePreview, NavView } from "../../ipc/types";
import type { ClockStore } from "../../store/clock";
import { dayLengthMs, MINUTES_PER_DAY } from "../../time/daylight";
import { navMinute } from "./navKit";

/** 与后端的单步补推上限一致；断线或后台挂起后不沿旧预测一直开船。 */
export const NAV_EXTRAPOLATION_MS = 250;

type ClockSample = Pick<ClockStore, "day" | "minute" | "speed" | "sampledAt">;

export class NavPlayback {
  private course: CoursePreview | null = null;
  private fleet = -1;
  private day = -1;
  private lastMinute = 0;

  minute(nav: Pick<NavView, "fleet" | "day" | "minute">, course: CoursePreview | null, clock: ClockSample, now: number): number | null {
    if (!course?.points.length) {
      this.course = null;
      return null;
    }
    const first = course.points[0][2];
    let limit = Math.min(MINUTES_PER_DAY, course.points[course.points.length - 1][2]);
    const confirmed = clock.day > nav.day ? MINUTES_PER_DAY : clock.day === nav.day
      ? Math.max(nav.minute, navMinute(clock.minute)) : nav.minute;
    let minute = confirmed;
    if (clock.day === nav.day && clock.speed > 0) {
      const elapsed = Math.min(NAV_EXTRAPOLATION_MS, Math.max(0, now - clock.sampledAt));
      minute = Math.max(confirmed, navMinute(clock.minute) + elapsed * MINUTES_PER_DAY / dayLengthMs(clock.speed));
    }
    // 未经后端确认跨过的暂停点不能被画面先行越过；确认越过后自然解除这道边界。
    for (const stop of course.stops) {
      // 1104 的普通商船发现不停船；无地点的 sight 不能在画面里重新制造一次暂停。
      if (stop.kind === "sight" && stop.loc === null) continue;
      if (stop.minute >= confirmed) limit = Math.min(limit, stop.minute);
    }
    if (this.course === course && this.fleet === nav.fleet && this.day === nav.day && clock.speed > 0) {
      minute = Math.max(this.lastMinute, minute);
    }
    minute = Math.max(first, Math.min(limit, minute));
    this.course = course;
    this.fleet = nav.fleet;
    this.day = nav.day;
    this.lastMinute = minute;
    return minute;
  }
}
