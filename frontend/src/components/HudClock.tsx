// 顶栏的时间区（EXPANSION.md §9.3）：纪年日期与季节、时刻（“06:40”+ 时段名 + 日月图标）、
// 当地天况与风（“东北风 4 级”）；悬停或聚焦天气时显示未来两天的预报（天况、风向、风力）。
// “当地”由后端给出（主角旗舰队所在海区，没有舰队时为首都港口）。旧后端没有 local_weather 时不显示天气与风，
// 没有 minute 时时刻取 8:00（useClock 的约定）。
import { useId, useState } from "react";
import type { SkyIconName } from "../art/icons";
import { Sprite } from "../art/Sprite";
import { useClock } from "../hooks/useClock";
import { dateSeasonText, dateShortText, monthLengths, overviewDate, t, type DateParts } from "../i18n";
import { tz } from "../i18n/zhOnly";
import { useNavStore } from "../hooks/useNavigation";
import type { DayWeatherView, LocalWeatherView, Overview } from "../ipc/types";
import { clockText, DAY_START_MINUTE } from "../time/daylight";
import {
  clockIcon,
  forecastDate,
  forecastLabel,
  localWeather,
  normStrength,
  periodName,
  skyIcon,
  skyIconPx,
  skyName,
  windIconPx,
  windText,
} from "./hudWeather";
import { ShellIcon } from "./shell/ShellIcon";
import { seasonIcon } from "./shell/shellArt";

/** 天况、日月图标（纯装饰，文字在旁边）。 */
function SkyIcon({ name }: { name: SkyIconName }) {
  return <Sprite px={skyIconPx(name)} scale={1} className="shell-icon" />;
}

/** 风：箭头（指向风的去向；无风时不画）+“东北风 4 级”。 */
function Wind({ dir, strength, testId }: { dir: number; strength: number; testId?: string }) {
  return (
    <span className="hud-wind" data-testid={testId}>
      {normStrength(strength) > 0 && <Sprite px={windIconPx(dir)} scale={1} className="shell-icon" />}
      {windText(dir, strength)}
    </span>
  );
}

/** 一天的预报：日子（明天 / 后天 + 月日）、天况、风。暴风雨标红，提醒避开。 */
function ForecastDay({ today, d }: { today: number; d: DayWeatherView }) {
  return (
    <li className={d.sky === "storm" ? "hud-forecast-day is-storm" : "hud-forecast-day"}>
      <span className="hud-forecast-when">
        {forecastLabel(today, d.day)}
        <small>{forecastDate(d.day)}</small>
      </span>
      <span className="hud-forecast-sky">
        <SkyIcon name={skyIcon(d.sky)} />
        {skyName(d.sky)}
      </span>
      <Wind dir={d.wind_dir} strength={d.wind_strength} />
    </li>
  );
}

function Forecast({ id, today, w }: { id: string; today: number; w: LocalWeatherView }) {
  return (
    <div className="hud-forecast" role="tooltip" id={id} data-testid="forecast">
      <div className="hud-forecast-title">{t("hudForecastTitle", { region: w.region_name || t("hudWeatherHere") })}</div>
      {w.forecast.length > 0 ? (
        <ul>
          {w.forecast.map((d) => (
            <ForecastDay key={d.day} today={today} d={d} />
          ))}
        </ul>
      ) : (
        <p className="hud-forecast-empty">{t("hudForecastEmpty")}</p>
      )}
    </div>
  );
}

/** 当地天况与风；悬停或聚焦（触屏上点按即聚焦）时展开预报，移开、失焦或按 Esc 收起。 */
function LocalSky({ today, w }: { today: number; w: LocalWeatherView }) {
  const [open, setOpen] = useState(false);
  const tipId = useId();
  const label = t("hudWeatherLabel", {
    region: w.region_name || t("hudWeatherHere"),
    sky: skyName(w.sky),
    wind: windText(w.wind_dir, w.wind_strength),
  });
  return (
    <div
      className={open ? "hud-sky open" : "hud-sky"}
      role="group"
      tabIndex={0}
      aria-label={label}
      aria-describedby={open ? tipId : undefined}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !open) return;
        // 收起预报就够了：全局快捷键不再顺手关功能窗口
        e.preventDefault();
        setOpen(false);
      }}
    >
      <span className="hud-weather" data-testid="weather">
        <SkyIcon name={skyIcon(w.sky)} />
        {skyName(w.sky)}
      </span>
      <Wind dir={w.wind_dir} strength={w.wind_strength} testId="wind" />
      {open && <Forecast id={tipId} today={today} w={w} />}
    </div>
  );
}

/**
 * 手动航行中途自动暂停的原因（Overview.navigation_stop：停着、时钟正好停在那一分钟时后端才给）：挂在时刻下面的一张小卡，
 * 不撑高顶栏；继续航行就没有了。停下的不是旗舰队时写明是哪一支。
 */
function NavStopNote({ o }: { o: Overview }) {
  const stop = o.navigation_stop;
  // FIX5F：前端的粮水警戒（常设命令的“粮水只够 N 天就停”）停下的：原因留在这里，直到继续航行或粮水回到警戒线以上
  const hold = useNavStore((s) => s.supplyHold);
  if (!stop && hold !== null && o.speed === 0) {
    return (
      <p className="hud-nav-stop hud-nav-stop-supplies_low" role="status" data-testid="nav-supply-hold">
        {t("nav.autoPaused", { text: tz("orders.alertHold", { n: hold }) })}
      </p>
    );
  }
  if (!stop || o.speed !== 0) return null;
  const own = o.fleets[0]?.id === stop.fleet;
  // FIX5F：新停因 supplies_low（粮水将尽）的文字由后端给；后端还是空串或占位时，界面先垫一句，不出一张空卡
  const text = stop.kind === "supplies_low" && (!stop.text.trim() || stop.text.includes("待写")) ? tz("nav.stopSuppliesLow") : stop.text;
  return (
    <p className={`hud-nav-stop hud-nav-stop-${stop.kind}`} role="status" data-testid="nav-stop-note">
      {own ? t("nav.autoPaused", { text }) : t("nav.autoPausedFleet", { fleet: stop.fleet, text })}
    </p>
  );
}

/** 日期往后挪 n 天（n 很小：0–2），按世界日历的月长进位；calendar_year 跟着年序一起进。 */
function addDays(d: DateParts, n: number): DateParts {
  const months = monthLengths();
  let { year, month, date } = d;
  let cal = typeof d.calendar_year === "number" ? d.calendar_year : null;
  for (let i = 0; i < n; i++) {
    date += 1;
    if (date > (months[month - 1] ?? 30)) {
      date = 1;
      month += 1;
      if (month > months.length) {
        month = 1;
        year += 1;
        if (cal !== null) cal += 1;
      }
    }
  }
  return { year, month, date, calendar_year: cal };
}

/**
 * 顶栏该写的日期：内核的一天从清晨 6:00 结算到次日 5:59（`DAY_START_MINUTE`），概览的日期是“这一结算日”的日期；
 * 玩家看的是墙上的日历，过了午夜就该是第二天。所以时刻在 0:00–5:59 时日期往后挪一天；
 * 时钟事件已经跨进下一结算日、新概览还没到时（换日结算的那一下）再按两边相差的天数挪（X02：顶栏日期在中午 / 清晨才换）。
 */
function wallDate(o: Overview, clockDay: number, minute: number): DateParts {
  const base = overviewDate(o);
  // 只在运行中认时钟领先的那一天（暂停时时钟以概览为准，两边一致）
  const ahead = o.speed > 0 && Number.isFinite(clockDay) && Number.isFinite(o.day) ? Math.max(0, Math.min(1, clockDay - o.day)) : 0;
  const shift = ahead + (minute < DAY_START_MINUTE ? 1 : 0);
  return shift > 0 ? addDays(base, shift) : base;
}

/**
 * 顶栏时间区的日期、时刻与天气（放在速度按钮上方）。
 * variant（网页自适应）：full 为桌面顶栏（日期牌、时刻与天气两行）；compact 为平板的一行顶栏（日期牌与时刻、天气排成一行）；
 * mini 为手机竖屏（只有时刻与短日期“1月1日”，天气与预报在“菜单”里）。
 * stop：手动航行自动暂停时在时刻下面挂一句原因（顶栏里缺省挂；“菜单”里的那一份不挂）。
 */
export default function HudClock({ o, variant = "full", stop = true }: { o: Overview; variant?: "full" | "compact" | "mini"; stop?: boolean }) {
  const { day, minute } = useClock();
  const weather = localWeather(o);
  const time = clockText(minute);
  const period = periodName(minute);
  // 世界日历的当天（后端给 world_date 时以它为准），按时刻换成墙上的日期：过了午夜就是第二天
  const wd = wallDate(o, day, minute);
  const full = dateSeasonText(wd, o.season);
  if (variant === "mini") {
    return (
      <div className="hud-clock-mini" title={`${full} · ${time} ${period}`}>
        <span className="hud-clock" data-testid="clock" aria-label={t("hudClockLabel", { time, period })}>
          <SkyIcon name={clockIcon(minute)} />
          <strong className="hud-clock-time">{time}</strong>
        </span>
        <span className="hud-date hud-date-mini" data-testid="date" aria-label={full}>
          <ShellIcon name={seasonIcon(o.season)} scale={1} />
          {dateShortText(wd.month, wd.date)}
        </span>
        {stop && <NavStopNote o={o} />}
      </div>
    );
  }
  const body = (
    <>
      <div className="hud-date" data-testid="date">
        <ShellIcon name={seasonIcon(o.season)} scale={1} />
        {full}
      </div>
      <div className="hud-now">
        <span className="hud-clock" data-testid="clock" title={t("hudClockLabel", { time, period })}>
          <SkyIcon name={clockIcon(minute)} />
          <strong className="hud-clock-time">{time}</strong>
          <span className="hud-clock-period">{period}</span>
        </span>
        {weather && <LocalSky today={o.day} w={weather} />}
        {stop && <NavStopNote o={o} />}
      </div>
    </>
  );
  return variant === "compact" ? <div className="hud-clock-row">{body}</div> : body;
}
