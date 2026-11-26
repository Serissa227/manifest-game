// 界面字符串（zh-CN）：港口街景、设施窗口、设施掌柜的问候与台词、出港。
// 键名加模块前缀（如 `port.xxx` 或驼峰 `portXxx`），避免与其他模块重复。
//
// 掌柜问候语的占位符（由 components/port/greeting.ts 填入，都来自当前港口的数据）：
//   {port} 地名  {captain} 对主角的称呼（“某某船长”，未设置姓名时为“船长”）  {faction} 所属势力  {season} 季节
//   交易所 {specialty} 特产种数、{popular} 走俏货种数、{count} 上市货物种数
//   造船厂 {count} 在售船型数        酒馆 {mates} 可招募的航海士人数
//   商会 {contracts} 可承接的委托数   银行 {rate} 存款年息、{loanRate} 贷款年息
//   仓库 {used} 已用、{capacity} 总仓位  港口投资 {dev} 发展度   势力办事处 {rep} 声望
// 替换台词时：每种设施至少保留 4 句（编号从 0 连续），问候按“地点 + 日期”确定性挑选。
// 零值说法：挑中的句子里某个计数（或利率、发展度、声望）为 0 时，改用同键加 `.zero` 的一句（如 portGreet.market.1.zero），
//   避免说出“眼下有 0 样货正走俏”；零值说法里不要再用值为 0 的占位符。删掉某句的零值说法时，改用本设施下一句没有零计数的常规句。
//   整个设施空着时（没有航海士、没有船厂、没有委托、没有期货交易所）另有 .nomate / .none 专门一句，优先于零值说法。
export const port = {
  // ── 街景 ──
  portSceneLabel: "{name}街景",
  portSceneDepart: "出港",
  portSceneDepartHint: "率领船队出港，在海图上选择目的地",
  portSceneCrewShort: "船员不足 {crew}/{min}，开不了船",
  portSceneDocked: "你的船队停泊在此",
  portSceneTaxShort: "税率 {pct}%",
  portSceneDev: "发展度 {dev}",
  portSceneFacilities: "{name}的设施",
  // 殖民点与殖民地的街景
  portSceneFound: "建立殖民地",
  portSceneFoundHint: "在这片荒野上立下界碑，建立你的殖民地",
  portSceneBuildings: "{name}的建筑",
  portSceneBuilding: "{name}（{level} 级）",
  portSceneWild: "{terrain} · 无主之地",
  portSceneColonySub: "殖民地 · {site}",
  portSceneColonyStats: "人口 {population} · 士气 {morale}",
  portSceneClaimed: "{faction}的据点",
  portSceneOtherColony: "其他商会的殖民地",

  // ── 设施掌柜 ──
  "portKeeperTitle.market": "交易所掌柜",
  "portKeeperTitle.shipyard": "船厂大师傅",
  "portKeeperTitle.tavern": "酒馆老板",
  "portKeeperTitle.tavern.f": "酒馆老板娘",
  "portKeeperTitle.guild": "商会执事",
  "portKeeperTitle.bank": "银行司库",
  "portKeeperTitle.exchange": "期货经纪",
  "portKeeperTitle.warehouse": "仓库管事",
  "portKeeperTitle.invest": "港务参事",
  "portKeeperTitle.office": "驻港专员",
  portKeeperCaptain: "船长",
  portKeeperCaptainNamed: "{name}船长",

  "portGreet.market.0": "欢迎光临{port}交易所！本地出产的好货有 {specialty} 样，价钱公道，船长不妨看看。",
  "portGreet.market.1": "来得正好，眼下有 {popular} 样货正走俏，卖得上好价钱。",
  "portGreet.market.2": "{port}的行情都挂在牌子上了：架上出售的有 {count} 样，船上带来的货，什么都收。",
  "portGreet.market.3": "{captain}，又见面了。{season}天里货源足，本地出产的就有 {specialty} 样。",
  "portGreet.market.0.zero": "欢迎光临{port}交易所！本地没什么特产，架上的货都是各处船队运来的，船长不妨看看。",
  "portGreet.market.1.zero": "眼下没有哪样货特别走俏，行情平稳，买卖都好商量。",
  "portGreet.market.2.zero": "今天{port}没有货物挂牌，行情牌子空着呢，过几天再来看看。",
  "portGreet.market.3.zero": "{captain}，又见面了。{season}天里本地没什么出产，好货都靠外头的船运来。",
  "portGreet.market.4": "进货出货都在这儿。先看看价，再谈数目——量大了价钱会动的。",

  "portGreet.shipyard.0": "木料刚晒透，龙骨也备齐了。船台上现有 {count} 种船型可以订造。",
  "portGreet.shipyard.1": "{captain}，船底该刮一刮了吧？修理、改造、买新船，都来找我。",
  "portGreet.shipyard.2": "{port}的船匠手艺一流——在售 {count} 种船型，看中哪条尽管开口。",
  "portGreet.shipyard.3": "外海风浪大，买条结实的船才稳当。我这儿有 {count} 种可挑。",
  "portGreet.shipyard.none": "这儿的船台空着，没有新船出售，修修补补倒还行。",

  "portGreet.tavern.0": "来一杯？今晚有 {mates} 位航海士在这儿等活儿干。",
  "portGreet.tavern.1": "{captain}，最近海上的消息可不少，坐下来慢慢听。",
  "portGreet.tavern.2": "水手们都爱来{port}喝两杯。想招人找我就对了，眼下有 {mates} 位好手。",
  "portGreet.tavern.3": "外头风大，进来暖暖身子。打听消息还是招募船员？",
  "portGreet.tavern.nomate": "今儿个没有航海士上门，喝一杯、听听消息吧。",

  "portGreet.guild.0": "商会有 {contracts} 份委托等人承接，报酬从优。",
  "portGreet.guild.1": "按期交货，信誉自然就来了。看看今天的委托书吧。",
  "portGreet.guild.2": "{captain}，会长交代过，信得过的船东可以先挑委托。",
  "portGreet.guild.3": "委托书都盖好了印，接下就得按期交付，违约可是要赔的。",
  "portGreet.guild.none": "眼下没有委托，过几天再来看看。",

  "portGreet.bank.0": "存款年息 {rate}%，稳稳当当。要存要取，悉听尊便。",
  "portGreet.bank.1": "信用就是本钱。按期还款，额度自然水涨船高。",
  "portGreet.bank.2": "{port}银行童叟无欺，眼下借款年息 {loanRate}%。",
  "portGreet.bank.0.zero": "眼下存款不计利息，钱放在这儿图个稳妥。要存要取，悉听尊便。",
  "portGreet.bank.2.zero": "{port}银行童叟无欺，眼下借款还不收利息，这样的好时候可不多见。",
  "portGreet.bank.3": "{captain}手头紧？先看看你的贷款额度。",

  "portGreet.exchange.0": "期货讲究眼光：今天定下明天的货，赚的是行情。",
  "portGreet.exchange.1": "保证金要留足，追加通知一到可别耽搁。",
  "portGreet.exchange.2": "钟声一响就开市，{captain}请看行情板。",
  "portGreet.exchange.3": "欢迎来到{port}期货交易所，合约到期按约交割。",
  "portGreet.exchange.none": "此地没有期货交易所，要做期货得去别的港口。",

  "portGreet.warehouse.0": "货放我这儿，风吹不着、雨淋不着。",
  "portGreet.warehouse.1": "仓位可以按百担租，也可以整间买下。",
  "portGreet.warehouse.2": "您在{port}的仓位：已用 {used}，共 {capacity}。",
  "portGreet.warehouse.2.zero": "眼下还没有您存在{port}的货。船舱挤了，就卸些下来寄存吧。",
  "portGreet.warehouse.3": "{captain}，货压在船上占舱位，不如先存进仓库。",

  "portGreet.invest.0": "{port}眼下发展度 {dev}，投一笔钱，码头会越来越热闹。",
  "portGreet.invest.0.zero": "{port}百废待兴，眼下还谈不上发展。投一笔钱，码头会一天天热闹起来。",
  "portGreet.invest.1": "港口兴旺了，出资人的好处自然少不了。",
  "portGreet.invest.2": "出资最多的船东，就是本港的盟友——{captain}有意吗？",
  "portGreet.invest.3": "修码头、扩货栈，处处都要用钱。",

  "portGreet.office.0": "这里是{faction}驻{port}的办事处。您在本国的声望是 {rep}。",
  "portGreet.office.0.zero": "这里是{faction}驻{port}的办事处。您在本国还籍籍无名，守规矩做买卖，声望自然会来。",
  "portGreet.office.1": "买卖军需品要有许可证，战时出海私掠要有特许状。",
  "portGreet.office.2": "{faction}欢迎守规矩的商人，{captain}请坐。",
  "portGreet.office.3": "近来各国关系微妙，出海前先打听清楚。",

  // ── 设施分页里的卡片 ──
  portMateNav: "航海",
  portMateTrade: "交易",
  portMateCombat: "战斗",
  portMateMgmt: "管理",
  portMateLevel: "Lv.{level}",
  portShipCrew: "{min}–{max}",
  portContractTitle: "委托书 · 第 {id} 号",
  portContractBody: "兹委托贵船运送 {good} {qty} 担，于第 {day} 天前运抵 {to}。",
  // 交货港还没望见（hide_unknown_ports 的世界）：只知道方向，dir 是后端给的“东北方”一类
  portContractDirection: "{dir}一处还没望见的港口",
  portContractIssuer: "发布：{issuer}",
  portContractDaysLeft: "剩 {days} 天",
  portContractOverdue: "已过期",
  portContractSeal: "印",
  portMarketVsBase: "较基准 {sign}{pct}%",
} as const;
