// 界面字符串（zh-CN）：游戏外壳：顶部状态栏、底部命令栏、窗口、提示与结局横幅。
// 键名加模块前缀（如 `shell.xxx` 或驼峰 `shellXxx`），避免与其他模块重复。
export const shell = {
  // 开机画面
  shellTagline: "扬帆 · 通商 · 经营",

  // 顶部状态栏：主角
  shellCaptainDefault: "无名船长",
  shellCaptainDocked: "停泊于{port}",
  shellCaptainAtSea: "航行中 · 出海第 {days} 天",
  shellCaptainNoFleet: "暂无船队",
  shellGoalProgress: "剧本目标进度",
  shellSandbox: "自由经营",

  // 命令栏与舞台切换
  shellCommandBar: "命令栏",
  shellStageGroup: "主舞台",
  shellStageTown: "港口街景",
  shellStageChart: "航海图",
  shellStageTownAtSea: "旗舰队正在海上，只能查看航海图",

  // 窗口
  shellCloseWindow: "关闭窗口",
  shellPanelError: "这个窗口出错了：{message}",
  shellStageError: "画面出错了：{message}",

  // 航海日志与提示
  shellLog: "航海日志",

  // 结局横幅
  shellOutcomeContinue: "继续经营",
  shellOutcomeShow: "查看结局：{title}",

  // 顶部状态栏：时刻、当地天气与风（EXPANSION.md §9.3）
  // 时段名：深夜 0–5、黎明 5–7、上午 7–11、正午 11–13、下午 13–17、黄昏 17–19、夜晚 19–24
  "period.lateNight": "深夜",
  "period.dawn": "黎明",
  "period.morning": "上午",
  "period.noon": "正午",
  "period.afternoon": "下午",
  "period.dusk": "黄昏",
  "period.night": "夜晚",
  // 天况
  "sky.clear": "晴",
  "sky.cloudy": "多云",
  "sky.rain": "雨",
  "sky.fog": "雾",
  "sky.storm": "暴风雨",
  "sky.snow": "雪",
  // 八方位（0 = 北，顺时针）。风名取风的来向：从北吹来的是“北风”
  "compass.0": "北",
  "compass.1": "东北",
  "compass.2": "东",
  "compass.3": "东南",
  "compass.4": "南",
  "compass.5": "西南",
  "compass.6": "西",
  "compass.7": "西北",
  hudWind: "{dir}风 {n} 级",
  hudWindCalm: "无风",
  hudClockLabel: "时刻 {time}，{period}",
  hudWeatherLabel: "{region}：{sky}，{wind}（悬停或聚焦查看未来两天预报）",
  hudWeatherHere: "当地",
  hudForecastTitle: "{region} · 未来两天",
  hudForecastTomorrow: "明天",
  hudForecastAfter: "后天",
  hudForecastLater: "{n} 天后",
  hudForecastDate: "{month}月{date}日",
  hudForecastEmpty: "暂无预报",
} as const;
