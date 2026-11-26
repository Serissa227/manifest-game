// 界面字符串（zh-CN）：殖民地——殖民地窗口、殖民点、殖民相关的日志、提醒与账簿用语。
// 键名加模块前缀（如 `colony.xxx`、`colonyKind.xxx`），避免与其他模块重复（见 i18n.test.ts）。
// 金额写 `{cur}`（自动填货币名称）或 `{x:money}`；日期写 `{day:date}`；查表写 `{x:@前缀}`（见 i18n/index.ts）。
export const colony = {
  // 功能页
  "tab.colonies": "殖民地",
  "colony.panelTitle": "殖民地名册",
  "colony.empty": "你还没有殖民地。带上移民、木料与口粮，驶向新大陆的未开拓之地，立下第一块界碑吧。",

  // 顶部状态栏
  hudColonies: "殖民地",
  hudColoniesValue: "{n} 座",
  hudColonyLine: "{name}：{population} 人，士气 {morale}",
  hudColonyStarving: "{name}：断粮 {days} 天！",

  // 殖民点地形
  "terrain.forest": "森林",
  "terrain.plains": "平原",
  "terrain.hills": "丘陵",
  "terrain.jungle": "雨林",
  "terrain.tundra": "冻原",
  "terrain.desert": "荒漠",
  "terrain.swamp": "沼泽",
  "terrain.island": "海岛",

  // 殖民地建筑的种类
  "colonyKind.food": "粮食",
  "colonyKind.extract": "采集",
  "colonyKind.process": "加工",
  "colonyKind.storage": "仓储",
  "colonyKind.defense": "防御",
  "colonyKind.morale": "民心",
  "colonyKind.dock": "码头",
  "colonyKind.housing": "住宅",

  // 税率档位（rules.colony_tax_levels 的下标）
  "colonyTax.0": "免税",
  "colonyTax.1": "轻税",
  "colonyTax.2": "常税",
  "colonyTax.3": "重税",
  "colonyTax.4": "苛税",

  // 失去殖民地的原因（日志 ColonyLost 的 reason）
  "colonyLoss.abandoned": "主动放弃",
  "colonyLoss.depopulated": "人烟断绝",
  "colonyLoss.sold": "破产变卖",

  // 事件日志
  "log.ColonyFounded": "{owner} 在 {loc} 立下界碑，殖民地 #{colony} 自此开拓",
  "log.ColonyBuilt": "{owner} 在 {loc} 的殖民地，{building}落成（{level} 级）",
  "log.ColonyStarving": "{owner} 在 {loc} 的殖民地粮仓见底，{deaths} 名殖民者饿死",
  "log.ColonyRaided": "海盗夜袭 {owner} 在 {loc} 的殖民地：劫走货物 {cargo_lost}，{deaths} 人罹难",
  "log.ColonyEpidemic": "热病在 {owner} 于 {loc} 的殖民地蔓延，{deaths} 人病故",
  "log.ColonyLost": "{owner} 失去了 {loc} 的殖民地 #{colony}（{reason:@colonyLoss}）",
  "log.SiteClaimed": "{faction} 的旗帜插上了 {loc}，此地从此归其所有",

  // 航海日志的提醒（由概览中的殖民地摘要推算）
  "notice.colonyStarving": "{colony} 已断粮 {days} 天，殖民者正在饿死",
  "notice.colonyLowFood": "{colony} 的存粮只够 {days} 天",

  // 账簿用语
  "memo.Colony": "殖民地收支",
  "flow.Colony": "殖民地：建立、建设、维护与税收",

  // 剧本目标
  "start.goal.colonies": "经营 {target} 座兴旺的殖民地",
  goalColonies: "目标：殖民地 {current} / {target} 座（每座人口 ≥ {population}）",

  // ── 殖民地窗口：名册与概况 ──
  "colony.slots": "还可建立 {n} 处殖民地（上限 {max} 处）",
  "colony.listLabel": "你的殖民地",
  "colony.listPop": "{n} 人",
  "colony.listMorale": "士气 {n}",
  "colony.listFood": "存粮 {n} 天",
  "colony.chipStarving": "断粮 {days} 天",
  "colony.chipLowFood": "存粮告急",
  "colony.chipRaid": "袭击风险高",
  "colony.chipBuilding": "在建",
  "colony.founded": "{day:date}立下界碑 · {site} · {terrain}",
  "colony.bookValue": "账面价值 {v:money}",
  "colony.tilePop": "人口",
  "colony.tileMorale": "士气",
  "colony.tileFood": "存粮",
  "colony.tileDefense": "防御",
  "colony.tileTax": "月税收",
  "colony.tileDays": "{n} 天",
  "colony.tilePct": "{n}%",

  // 分节
  "colony.secPeople": "人口与住房",
  "colony.secMorale": "士气构成",
  "colony.secFood": "粮食",
  "colony.secBuildings": "建筑",
  "colony.secConstruction": "在建工程",
  "colony.secBuild": "建造与升级",
  "colony.secTax": "税率",
  "colony.secMonth": "上月统计",
  "colony.secDefense": "防御与袭击",
  "colony.secCargo": "装卸货物",
  "colony.secAbandon": "放弃殖民地",

  // 人口与住房
  "colony.population": "人口 {n} / 住房 {max}",
  "colony.housingFull": "住房已满，人口不再增长。扩建住宅区可以容纳更多殖民者。",
  "colony.workers": "岗位需要 {need} 人 · 工人充足率 {pct}%",
  "colony.workersShort": "人手不足，各建筑只能按 {pct}% 的效率运转。",

  // 士气
  "colony.morale": "士气 {n} / 100",
  "colony.moraleHint": "士气不低于 50 时人口才会增长；士气越高，移民越多。",
  "colony.moraleMult": "士气使产量 ×{mult}",
  "colony.factorTax": "税率：{name}",
  "colony.factorBuilding": "{name} Lv{level}",
  "colony.factorGoods": "消费品满足度 {pct}%",
  "colony.factorGoodsHint": "葡萄酒、茶叶、烟叶与布匹运到殖民地仓库，月末按人口消耗，满足度越高士气越高。",
  "colony.factorStarving": "断粮 {days} 天",
  "colony.factorRaid": "近期遭袭（{day:date}）",
  "colony.factorUp": "提升",
  "colony.factorDown": "拖累",

  // 粮食
  "colony.foodStock": "存粮 {stock} 件 · 每天吃 {need} 件",
  "colony.foodDays": "可支撑 {days} 天（不计产出）",
  "colony.foodStarving": "粮仓见底，已断粮 {days} 天！殖民者正在饿死——尽快运粮，或建农庄与渔场。",
  "colony.foodLow": "存粮只够 {days} 天，请及时补充粮食。",

  // 库存
  "colony.capacity": "仓位 {used} / {capacity}",
  "colony.stockEmpty": "仓库空空如也。",

  // 建筑
  "colony.noBuildings": "还没有任何建筑。先建一座农庄或渔场，让殖民者吃上饭吧。",
  "colony.levelOf": "Lv{level}/{max}",
  "colony.output": "产出",
  "colony.gain": "+{qty}/天",
  "colony.spend": "−{qty}/天",
  "colony.times": "×{n}",
  "colony.idle": "暂无产出",
  "colony.effectCapacity": "仓位 +{n}",
  "colony.effectDefense": "防御 +{n}",
  "colony.effectMorale": "士气 +{n}",
  "colony.effectHousing": "住房 +{n}",
  "colony.effectDock": "可靠岸补给、修船",
  "colony.workersNeed": "工人 {n}",
  "colony.upkeep": "维护 {v:money}/月",

  // 在建工程
  "colony.noConstruction": "眼下没有在建工程。同一时间只能进行一项工程。",
  "colony.constructing": "{name} → Lv{level}",
  "colony.constructDone": "预计 {day:date}完工，还需 {days} 天",

  // 建造与升级
  "colony.buildNew": "新建",
  "colony.buildUpgrade": "Lv{from} → Lv{to}",
  "colony.buildBtn": "建造",
  "colony.upgradeBtn": "升级",
  "colony.cost": "费用 {v:money}",
  "colony.materials": "建材",
  "colony.missing": "缺 {n}",
  "colony.buildDays": "工期 {n} 天",
  "colony.produces": "在此地产出{good}，产量 {pct}%",
  "colony.noProduce": "此地没有可供它开采的资源",
  "colony.maxed": "所有建筑都已升到最高级。",

  // 税率
  "colony.taxShare": "收入 {pct}%",
  "colony.taxMorale": "士气 {delta}",
  "colony.taxIncome": "月税收约 {v:money}",
  "colony.taxHint": "税率越高收入越多，士气也越低。按当前人口估算。",
  "colony.taxGroup": "税率档位",

  // 上月统计
  "colony.mProduced": "产出",
  "colony.mFood": "吃粮",
  "colony.mBirths": "出生",
  "colony.mImmigrants": "移民",
  "colony.mDeaths": "死亡",
  "colony.mTax": "税收",
  "colony.mUpkeep": "维护",
  "colony.mSatisfaction": "消费品满足度",
  "colony.mPeople": "{n} 人",
  "colony.mPieces": "{n} 件",

  // 防御与袭击
  "colony.defense": "防御 {n}%",
  "colony.raidDaily": "每日遭袭概率 {pct}%",
  "colony.raidMonthly": "一个月内约 {pct}%",
  "colony.raid.low": "风险低",
  "colony.raid.mid": "风险中",
  "colony.raid.high": "风险高",
  "colony.lastRaid": "上次遭袭：{day:date}",
  "colony.neverRaided": "从未遭袭",
  "colony.raids": "累计遭袭 {n} 次",
  "colony.defenseHint": "建栅栏堡可以提高防御，减少海盗夜袭。",

  // 装卸
  "colony.cargoNoFleet": "没有舰队停泊在此。船队停靠殖民地后，可以在这里装卸货物。",
  // 从殖民地带人上船
  "colony.crewLine": "舰队 #{id} 船员 {crew}（最低 {min}，上限 {max}）· 殖民地人口 {pop}",
  "colony.crewShort": "人手不足，无法出航",
  "colony.takeAboardCount": "带上船的人数",
  "colony.takeAboard": "带 {n} 名殖民者上船",
  "colony.takeAboardHint": "按招募费计价，殖民地至少留下 1 人。",
  "colony.cargoFleet": "装卸的舰队",
  "colony.cargoShip": "船上货物",
  "colony.cargoColony": "殖民地库存",
  "colony.cargoRoom": "空位 {n}",
  "colony.unload": "卸货",
  "colony.load": "装船",
  "colony.all": "全部",
  "colony.half": "一半",
  "colony.shipEmpty": "船舱是空的。",
  "colony.qtyOf": "{name}数量",

  // 放弃
  "colony.abandonBtn": "放弃殖民地",
  "colony.abandonWarn": "放弃后，这里的殖民者、建筑与库存都将失去，无法恢复。确定放弃 {name} 吗？",
  "colony.abandonConfirm": "确认放弃",
  "colony.cancel": "取消",

  // ── 港口窗口：殖民地与殖民点 ──
  "colony.hereTitle": "你的殖民地",
  "colony.hereLine": "人口 {pop} · 士气 {morale} · 存粮 {days} 天",
  "colony.openPanel": "打开殖民地窗口",
  "colony.siteNature": "自然条件",
  "colony.siteTerrain": "地形：{name}",
  "colony.siteFertility": "肥力 {n}",
  "colony.siteHazard": "险恶 {n}",
  "colony.siteFertilityHint": "肥力决定农庄与种植园的收成",
  "colony.siteHazardHint": "险恶决定疾病与袭击的多寡",
  "colony.siteResources": "资源",
  "colony.siteRichness": "丰度 {n}",
  "colony.siteProducible": "可建的生产建筑",
  "colony.siteProduceLine": "{building} → {good}",
  "colony.siteProducePct": "产量 {pct}%",
  "colony.siteClaimFaction": "此地已被{faction}占领，插上了他们的旗帜，不能再建立殖民地。",
  "colony.siteClaimOther": "此地已有其他商会的殖民地。",
  "colony.siteUnknown": "尚未探明这处殖民点：先驶来亲眼看看。",
  "colony.siteConditions": "建立条件",
  "colony.condCost": "建立费 {v:money}（现金 {cash:money}）",
  "colony.condMaterial": "{name} {need} 件（船上 {have}）",
  "colony.condSettlers": "殖民者至少 {n} 人，从船员中转出",
  "colony.condFleet": "舰队 #{id}：{status}",
  "colony.condFleetOk": "可以建立",
  "colony.condNoFleet": "须有你的舰队停泊在此",
  "colony.foundBtn": "建立殖民地",

  // ── 殖民地窗口：选中殖民点时名册上方的殖民点卡片 ──
  "colony.foundHere": "在此建立殖民地",
  "colony.foundReady": "你的船队停泊在{site}，条件齐备，可以立下界碑了。",
  "colony.backToSite": "查看殖民点：{site}",

  // ── 殖民地窗口：事件影响（组合事件的殖民地效果） ──
  "colony.secEffects": "事件影响",
  "colony.effectsNone": "眼下没有海上大事影响这处殖民地。",
  "colony.growthMult": "人口增长与移民 ×{mult}",
  "colony.growthHint": "海上大事（组合事件）带来的增长系数，月末的出生与移民都按它计算；预计产量已计入产量类事件。",
  "colony.growthNote": "受事件影响，人口增长与移民 ×{mult}",
  "colony.effectLeft": "剩 {days} 天 · 至 {end:date}",
  "colony.effectLastDay": "今天结束",
  "colony.chipEvent": "事件影响",

  // 建立殖民地对话框
  "colony.foundTitle": "在{site}建立殖民地",
  "colony.foundIntro": "立下界碑，给这片土地取个名字。留下的船员将成为第一批殖民者。",
  "colony.foundName": "殖民地名称",
  "colony.foundNameHint": "1–16 个字",
  "colony.foundReroll": "换一个名字",
  "colony.foundSettlers": "殖民者人数",
  "colony.foundSettlersLine": "{n} 人留下开拓，舰队剩 {left} 名船员（至少 {min} 人）",
  "colony.foundCrewShort": "船员不足：至少需要 {need} 人（殖民者 {settlers} + 最低船员 {crewMin}），舰队现有 {have} 人。",
  "colony.foundFleet": "出发的舰队",
  "colony.foundConfirm": "立下界碑",
  "colony.foundDone": "{name} 建立了！{n} 名殖民者开始开垦这片土地。",
  // 建议的殖民地名称：前半与后半各取一个组合（用“、”分隔，可以随意增删）
  // 西幻风格：音译名与意译名混用（例如“新维拉港”“银松湾”）
  // 前半不要以某个后半结尾（否则会拼出“月湾湾”）；也不要用现实地名（如卡斯蒂利亚）。英文表 en.colony.ts 与这里逐项对应。
  "colony.namePrefixes": "新维拉、圣艾琳、阿尔塔、洛维纳、卡斯特里亚、瓦伦、布里萨、马雷斯、索拉纳、埃尔莫、伊斯特、贝洛纳、奥斯韦、林德、银松、白帆、琥珀、鸢尾、月泽、星泉、黎明、苍鹭、橡木、蔷薇",
  "colony.nameSuffixes": "港、堡、镇、湾、角、渡、岬、谷、城、滩",
  // 前半与后半的拼法（英文用空格隔开）
  "colony.nameJoin": "{prefix}{suffix}",
} as const;
