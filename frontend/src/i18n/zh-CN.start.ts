// 界面字符串（zh-CN）：标题画面、开局剧本选择与主角创建。
// 键名加模块前缀（如 `start.xxx` 或驼峰 `startXxx`），避免与其他模块重复。
export const start = {
  // 标题画面
  "start.tagline": "扬帆四海，经营你的商号",
  "start.sceneLabel": "黄昏的港湾：灯塔在岬角上转动光束，一艘帆船正在归航，海鸥掠过海面",
  "start.menuLabel": "主菜单",
  "start.menuNew": "新的航程",
  "start.menuLoad": "读取存档",
  "start.footer": "原创航海贸易经营 · 所有人物与地名均为虚构",
  // 标题下的纪年与一句编年背景（纪年名称与起始年取自 statics.world）
  "start.eraLine": "{era} {year} 年",
  "start.eraLore": "巨人之门已开四十年，新大陆的海岸线仍未画完。",

  // 剧本卡片
  "start.scenarioStart": "起始港",
  "start.scenarioCash": "资金",
  "start.scenarioGoal": "目标",
  "start.scenarioFleet": "船队",
  "start.scenarioShip": "{ship} · 船员 {crew} 人",
  "start.scenarioMates": "航海士 {n} 名",
  // 开局货物（ScenarioView.cargo，装在开局舰队的货舱）与粮水
  "start.scenarioCargo": "货舱",
  "start.scenarioCargoItem": "{name} ×{qty}",
  "start.scenarioSupplies": "粮 {food} · 水 {water}",
  "start.goal.net_worth": "净资产达到 {target}",
  "start.goal.ally_ports": "成为 {target} 个港口的同盟商号",
  "start.goal.sandbox": "自由经营，没有胜利目标",
  // 殖民地目标带人口门槛时用这一条（没有 population 时退回 start.goal.colonies）
  "start.goal.coloniesPopulation": "拥有 {target} 个人口 ≥ {population} 的殖民地",
  "start.goalYears": "（限期 {years} 年）",
  // 限期换算成纪年日期（绝对天数 = 年数 × 世界日历一年的天数，经典世界 360）
  "start.goalUntil": "截至 {day:date}",
  "start.scenarioEra": "纪年",
  "start.scenarioEraValue": "{era} {year} 年启航",
  "start.listSep": "、",
  "start.factSep": " · ",
  "start.chosen": "已选定",

  // 主角创建
  "start.captainTitle": "你的船长",
  "start.captainName": "船长姓名",
  "start.captainNameHint": "1–12 个字",
  "start.captainNameEmpty": "请给船长起个名字（可点“随机”）。",
  "start.random": "随机",
  "start.randomName": "随机姓名",
  "start.randomLook": "随机外貌",
  "start.prevLook": "上一个外貌",
  "start.nextLook": "下一个外貌",
  "start.looks": "外貌",
  "start.lookN": "外貌 {n}",
  "start.lookCount": "{n} / {total}",
  "start.portraitLabel": "船长 {name} 的头像（外貌 {n}）",
  "start.captainPlate": "{name} 船长",
  "start.voyageLine": "{name} 船长将从{port}启航。",
  "start.starting": "正在起锚……",

  // 读档
  "start.loadHint": "选择一个存档，继续上次的航程。",
  "start.saveCaptain": "{name} 船长",
  "start.saveNoCaptain": "无名船长",
  "start.saveDetail": "{scenario} · {day} · 净资产 {worth}",
  // 世界多于一个时，剧本前面写上存档所在的世界
  "start.saveWorldScenario": "{world} · {scenario}",
  "start.saveRetired": "旧剧本已下线，这份存档不能再读（可以删除）",
  "start.saveOpen": "读取存档 {slot}",
  "start.saveDelete": "删除",
  "start.saveDeleteLabel": "删除存档 {slot}",
  "start.saveDeleteAsk": "删除存档「{slot}」？删掉之后找不回来。",
  "start.saveDeleteYes": "删除",
  "start.saveDeleteNo": "取消",
  "start.saveDeleted": "已删除存档 {slot}",
} as const;
