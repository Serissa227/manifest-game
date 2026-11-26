// 界面字符串（zh-CN）：窗口自适应（窄窗口上的紧凑外壳）——顶栏的菜单、底部导航的“更多”、倍速选择、海图的缩放按钮等。
// 键名一律以 layout. 开头。
export const layout = {
  // 顶栏的菜单（手机、平板：次要信息与存读档收在这里）
  "layout.menu": "菜单",
  "layout.menuTitle": "船长的账簿",
  "layout.menuAssets": "资产与目标",
  "layout.menuWeather": "时辰与天气",
  "layout.menuSaves": "存档",
  "layout.menuSystem": "系统",
  "layout.cashLabel": "现金 {money}",
  // 手机顶栏的短日期（全称在悬停提示与读屏文字里）
  "layout.dateShort": "{month}月{date}日",
  // 世界日历给了月份名时（第九批的世界可以给）：日期里写月份名
  "layout.dateShortNamed": "{month}{date}日",
  "layout.dateFullNamed": "{year}年{month}{date}日",
  // 倍速：手机上是“暂停 / 继续”一个键 + 当前倍速一个键（点开选档位）
  "layout.resume": "继续（{n}×）",
  "layout.speedNow": "倍速 {n}×，点开换挡",
  "layout.speedPaused": "已暂停，点开选倍速",
  "layout.speedTitle": "游戏速度",
  // 底部导航
  "layout.more": "更多",
  "layout.moreTitle": "全部功能",
  "layout.moreActive": "更多（当前：{tab}）",
  "layout.stageTo": "切换到{stage}",
  // 通用的底部抽屉
  "layout.sheetClose": "收起",
  // 海图的缩放按钮（触屏上也可以双指缩放）
  "layout.zoomIn": "放大海图",
  "layout.zoomOut": "缩小海图",
  "layout.zoomFit": "看全图",
  "layout.zoomGroup": "海图缩放",
  // 航海图左上的航行状态：收起时只剩一行
  "layout.toggleVoyage": "收起或展开航行状态",
  // 按需加载的界面（主界面、功能面板）没能下载下来
  "layout.loadFailed": "这部分界面没能载入（网络不稳？）",
  "layout.loadRetry": "重试",
} as const;
