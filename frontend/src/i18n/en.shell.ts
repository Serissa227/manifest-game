// 界面字符串（en）：游戏外壳——顶部状态栏、底部命令栏、窗口、提示与结局横幅。与 zh-CN.shell.ts 的键一一对应。
// 术语按 EXPANSION.md §12.2 的英文术语表翻译（天况 Weather、风向 Wind、风力 Force、黎明 Dawn、黄昏 Dusk……）。
import type { Translation } from "./translation";
import type { shell as zh } from "./zh-CN.shell";

export const shell: Translation<typeof zh> = {
  // 开机画面
  shellTagline: "Sail · Trade · Prosper",

  // 顶部状态栏：主角
  shellCaptainDefault: "Nameless Captain",
  shellCaptainDocked: "Docked at {port}",
  shellCaptainAtSea: "At sea · day {days}",
  shellCaptainNoFleet: "No fleet",
  shellGoalProgress: "Scenario goal progress",
  shellSandbox: "Free trade",

  // 命令栏与舞台切换
  shellCommandBar: "Command bar",
  shellStageGroup: "Main view",
  shellStageTown: "Port view",
  shellStageChart: "Sea chart",
  shellStageTownAtSea: "Your flagship is at sea; only the sea chart is available",

  // 窗口
  shellCloseWindow: "Close window",
  shellPanelError: "This window hit an error: {message}",
  shellStageError: "The view hit an error: {message}",

  // 航海日志与提示
  shellLog: "Logbook",

  // 结局横幅
  shellOutcomeContinue: "Keep trading",
  shellOutcomeShow: "View outcome: {title}",

  // 时段名
  "period.lateNight": "Late night",
  "period.dawn": "Dawn",
  "period.morning": "Morning",
  "period.noon": "Noon",
  "period.afternoon": "Afternoon",
  "period.dusk": "Dusk",
  "period.night": "Night",
  // 天况
  "sky.clear": "Clear",
  "sky.cloudy": "Cloudy",
  "sky.rain": "Rain",
  "sky.fog": "Fog",
  "sky.storm": "Storm",
  "sky.snow": "Snow",
  // 八方位（0 = 北，顺时针）；风名取风的来向
  "compass.0": "N",
  "compass.1": "NE",
  "compass.2": "E",
  "compass.3": "SE",
  "compass.4": "S",
  "compass.5": "SW",
  "compass.6": "W",
  "compass.7": "NW",
  hudWind: "{dir} wind, force {n}",
  hudWindCalm: "Calm",
  hudClockLabel: "Time {time}, {period}",
  hudWeatherLabel: "{region}: {sky}, {wind} (hover or focus for the two-day forecast)",
  hudWeatherHere: "Local",
  hudForecastTitle: "{region} · next two days",
  hudForecastTomorrow: "Tomorrow",
  hudForecastAfter: "Day after",
  hudForecastLater: "In {n:plural(day,days)}",
  hudForecastDate: "{date} {month:@month}",
  hudForecastEmpty: "No forecast",
};
