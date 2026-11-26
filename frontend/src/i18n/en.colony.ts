// 界面字符串（en）：殖民地——殖民地窗口、殖民点、殖民相关的日志、提醒与账簿用语。与 zh-CN.colony.ts 的键一一对应。
// 术语：殖民点 Colony site、殖民地 Colony、士气 Morale、势力 Nation、商会（其他商号）company。
// 事件日志统一写成“所有者: 事情”（所有者可能是 “You”）。
import type { Translation } from "./translation";
import type { colony as zh } from "./zh-CN.colony";

export const colony: Translation<typeof zh> = {
  // 功能页
  "tab.colonies": "Colonies",
  "colony.panelTitle": "Colony register",
  "colony.empty": "You have no colonies yet. Take settlers, timber and provisions to an unsettled site in the New World and raise your first boundary stone.",

  // 顶部状态栏
  hudColonies: "Colonies",
  hudColoniesValue: "{n}",
  hudColonyLine: "{name}: pop. {population}, morale {morale}",
  hudColonyStarving: "{name}: starving for {days:plural(day,days)}!",

  // 殖民点地形
  "terrain.forest": "Forest",
  "terrain.plains": "Plains",
  "terrain.hills": "Hills",
  "terrain.jungle": "Jungle",
  "terrain.tundra": "Tundra",
  "terrain.desert": "Desert",
  "terrain.swamp": "Swamp",
  "terrain.island": "Island",

  // 殖民地建筑的种类
  "colonyKind.food": "Food",
  "colonyKind.extract": "Gathering",
  "colonyKind.process": "Processing",
  "colonyKind.storage": "Storage",
  "colonyKind.defense": "Defense",
  "colonyKind.morale": "Morale",
  "colonyKind.dock": "Dock",
  "colonyKind.housing": "Housing",

  // 税率档位
  "colonyTax.0": "No tax",
  "colonyTax.1": "Light",
  "colonyTax.2": "Normal",
  "colonyTax.3": "Heavy",
  "colonyTax.4": "Harsh",

  // 失去殖民地的原因
  "colonyLoss.abandoned": "abandoned",
  "colonyLoss.depopulated": "depopulated",
  "colonyLoss.sold": "sold in bankruptcy",

  // 事件日志
  "log.ColonyFounded": "{owner}: raised a boundary stone at {loc}; colony #{colony} is founded",
  "log.ColonyBuilt": "{owner}: {building} completed at the colony in {loc} (Lv {level})",
  "log.ColonyStarving": "{owner}: the granary at the colony in {loc} is empty; {deaths:plural(settler,settlers)} starved",
  "log.ColonyRaided": "{owner}: pirates raided the colony in {loc} by night, taking {cargo_lost} cargo; {deaths} killed",
  "log.ColonyEpidemic": "{owner}: fever spread through the colony in {loc}; {deaths} died",
  "log.ColonyLost": "{owner}: lost colony #{colony} in {loc} ({reason:@colonyLoss})",
  "log.SiteClaimed": "The {faction} planted its flag at {loc}; the land is now theirs",

  // 航海日志的提醒
  "notice.colonyStarving": "{colony} has been starving for {days:plural(day,days)}; settlers are dying",
  "notice.colonyLowFood": "{colony} has food for only {days:plural(day,days)}",

  // 账簿用语
  "memo.Colony": "Colony income and costs",
  "flow.Colony": "Colonies: founding, building, upkeep and taxes",

  // 剧本目标
  "start.goal.colonies": "Run {target:plural(thriving colony,thriving colonies)}",
  goalColonies: "Goal: colonies {current} / {target} (pop. ≥ {population} each)",

  // ── 殖民地窗口：名册与概况 ──
  "colony.slots": "{n:plural(more colony,more colonies)} allowed (max {max})",
  "colony.listLabel": "Your colonies",
  "colony.listPop": "Pop. {n}",
  "colony.listMorale": "Morale {n}",
  "colony.listFood": "Food {n:plural(day,days)}",
  "colony.chipStarving": "Starving {days:plural(day,days)}",
  "colony.chipLowFood": "Food running low",
  "colony.chipRaid": "High raid risk",
  "colony.chipBuilding": "Building",
  "colony.founded": "Founded {day:date} · {site} · {terrain}",
  "colony.bookValue": "Book value {v:money}",
  "colony.tilePop": "Population",
  "colony.tileMorale": "Morale",
  "colony.tileFood": "Food",
  "colony.tileDefense": "Defense",
  "colony.tileTax": "Monthly tax",
  "colony.tileDays": "{n:plural(day,days)}",
  "colony.tilePct": "{n}%",

  // 分节
  "colony.secPeople": "Population & housing",
  "colony.secMorale": "Morale",
  "colony.secFood": "Food",
  "colony.secBuildings": "Buildings",
  "colony.secConstruction": "Construction",
  "colony.secBuild": "Build & upgrade",
  "colony.secTax": "Tax rate",
  "colony.secMonth": "Last month",
  "colony.secDefense": "Defense & raids",
  "colony.secCargo": "Load & unload",
  "colony.secAbandon": "Abandon colony",

  // 人口与住房
  "colony.population": "Population {n} / housing {max}",
  "colony.housingFull": "Housing is full; the population will not grow. Expand the housing quarter to take in more settlers.",
  "colony.workers": "Jobs need {need:plural(worker,workers)} · staffing {pct}%",
  "colony.workersShort": "Short of hands: buildings run at only {pct}% efficiency.",

  // 士气
  "colony.morale": "Morale {n} / 100",
  "colony.moraleHint": "The population grows only while morale is 50 or more; the higher the morale, the more immigrants arrive.",
  "colony.moraleMult": "Morale multiplies output ×{mult}",
  "colony.factorTax": "Tax: {name}",
  "colony.factorBuilding": "{name} Lv {level}",
  "colony.factorGoods": "Consumer goods supplied {pct}%",
  "colony.factorGoodsHint": "Ship wine, tea, tobacco and cloth to the colony warehouse. At month end they are consumed in proportion to the population; the better the supply, the higher the morale.",
  "colony.factorStarving": "Starving {days:plural(day,days)}",
  "colony.factorRaid": "Raided recently ({day:date})",
  "colony.factorUp": "Raises",
  "colony.factorDown": "Lowers",

  // 粮食
  "colony.foodStock": "Food {stock:plural(unit,units)} · eats {need} a day",
  "colony.foodDays": "Lasts {days:plural(day,days)} (not counting output)",
  "colony.foodStarving": "The granary is empty: starving for {days:plural(day,days)}! Settlers are dying. Ship food at once, or build farmsteads and fisheries.",
  "colony.foodLow": "Food for only {days:plural(day,days)}; restock soon.",

  // 库存
  "colony.capacity": "Storage {used} / {capacity}",
  "colony.stockEmpty": "The warehouse is empty.",

  // 建筑
  "colony.noBuildings": "No buildings yet. Start with a farmstead or fishery so your settlers can eat.",
  "colony.levelOf": "Lv {level}/{max}",
  "colony.output": "Output",
  "colony.gain": "+{qty}/day",
  "colony.spend": "−{qty}/day",
  "colony.times": "×{n}",
  "colony.idle": "No output",
  "colony.effectCapacity": "Storage +{n}",
  "colony.effectDefense": "Defense +{n}",
  "colony.effectMorale": "Morale +{n}",
  "colony.effectHousing": "Housing +{n}",
  "colony.effectDock": "Ships can resupply and repair",
  "colony.workersNeed": "Workers {n}",
  "colony.upkeep": "Upkeep {v:money}/month",

  // 在建工程
  "colony.noConstruction": "Nothing under construction. Only one project can run at a time.",
  "colony.constructing": "{name} → Lv {level}",
  "colony.constructDone": "Due {day:date}, {days:plural(day,days)} to go",

  // 建造与升级
  "colony.buildNew": "New",
  "colony.buildUpgrade": "Lv {from} → Lv {to}",
  "colony.buildBtn": "Build",
  "colony.upgradeBtn": "Upgrade",
  "colony.cost": "Cost {v:money}",
  "colony.materials": "Materials",
  "colony.missing": "short {n}",
  "colony.buildDays": "{n:plural(day,days)} to build",
  "colony.produces": "Produces {good} here at {pct}%",
  "colony.noProduce": "No resources here for it to work",
  "colony.maxed": "Every building is at its highest level.",

  // 税率
  "colony.taxShare": "Income {pct}%",
  "colony.taxMorale": "Morale {delta}",
  "colony.taxIncome": "About {v:money} a month",
  "colony.taxHint": "Higher taxes bring more income and lower morale. Estimated for the current population.",
  "colony.taxGroup": "Tax level",

  // 上月统计
  "colony.mProduced": "Produced",
  "colony.mFood": "Food eaten",
  "colony.mBirths": "Births",
  "colony.mImmigrants": "Immigrants",
  "colony.mDeaths": "Deaths",
  "colony.mTax": "Taxes",
  "colony.mUpkeep": "Upkeep",
  "colony.mSatisfaction": "Consumer goods supplied",
  "colony.mPeople": "{n}",
  "colony.mPieces": "{n:plural(unit,units)}",

  // 防御与袭击
  "colony.defense": "Defense {n}%",
  "colony.raidDaily": "Daily raid chance {pct}%",
  "colony.raidMonthly": "About {pct}% within a month",
  "colony.raid.low": "Low risk",
  "colony.raid.mid": "Medium risk",
  "colony.raid.high": "High risk",
  "colony.lastRaid": "Last raided {day:date}",
  "colony.neverRaided": "Never raided",
  "colony.raids": "Raided {n:plural(time,times)}",
  "colony.defenseHint": "A stockade fort raises defense and keeps pirates away at night.",

  // 装卸
  "colony.cargoNoFleet": "No fleet is docked here. Once a fleet docks at the colony you can load and unload here.",
  "colony.crewLine": "Fleet #{id} crew {crew} (min {min}, max {max}) · colony pop. {pop}",
  "colony.crewShort": "Too few crew to sail",
  "colony.takeAboardCount": "People to take aboard",
  "colony.takeAboard": "Take {n:plural(settler,settlers)} aboard",
  "colony.takeAboardHint": "Charged at the hiring fee; at least 1 person stays in the colony.",
  "colony.cargoFleet": "Fleet",
  "colony.cargoShip": "Ship's cargo",
  "colony.cargoColony": "Colony stock",
  "colony.cargoRoom": "{n} free",
  "colony.unload": "Unload",
  "colony.load": "Load",
  "colony.all": "All",
  "colony.half": "Half",
  "colony.shipEmpty": "The hold is empty.",
  "colony.qtyOf": "Quantity of {name}",

  // 放弃
  "colony.abandonBtn": "Abandon colony",
  "colony.abandonWarn": "Abandoning it loses its settlers, buildings and stock for good. Really abandon {name}?",
  "colony.abandonConfirm": "Abandon",
  "colony.cancel": "Cancel",

  // ── 港口窗口：殖民地与殖民点 ──
  "colony.hereTitle": "Your colony",
  "colony.hereLine": "Pop. {pop} · Morale {morale} · Food {days:plural(day,days)}",
  "colony.openPanel": "Open the colony window",
  "colony.siteNature": "Natural conditions",
  "colony.siteTerrain": "Terrain: {name}",
  "colony.siteFertility": "Fertility {n}",
  "colony.siteHazard": "Hazard {n}",
  "colony.siteFertilityHint": "Fertility sets the yield of farmsteads and plantations",
  "colony.siteHazardHint": "Hazard sets how often disease and raids strike",
  "colony.siteResources": "Resources",
  "colony.siteRichness": "Richness {n}",
  "colony.siteProducible": "Production buildings possible",
  "colony.siteProduceLine": "{building} → {good}",
  "colony.siteProducePct": "Output {pct}%",
  "colony.siteClaimFaction": "The {faction} has claimed this land and planted its flag; no colony can be founded here.",
  "colony.siteClaimOther": "Another company already has a colony here.",
  "colony.siteUnknown": "This colony site has not been surveyed: sail here and see it first.",
  "colony.siteConditions": "Requirements",
  "colony.condCost": "Founding fee {v:money} (cash {cash:money})",
  "colony.condMaterial": "{name} ×{need} (on board {have})",
  "colony.condSettlers": "At least {n:plural(settler,settlers)}, taken from the crew",
  "colony.condFleet": "Fleet #{id}: {status}",
  "colony.condFleetOk": "Ready to found",
  "colony.condNoFleet": "One of your fleets must be docked here",
  "colony.foundBtn": "Found colony",

  // ── 殖民地窗口：选中殖民点时名册上方的殖民点卡片 ──
  "colony.foundHere": "Found a colony here",
  "colony.foundReady": "Your fleet is docked at {site} and everything is ready: raise the boundary stone.",
  "colony.backToSite": "View colony site: {site}",

  // ── 殖民地窗口：事件影响 ──
  "colony.secEffects": "Event effects",
  "colony.effectsNone": "No events at sea are affecting this colony right now.",
  "colony.growthMult": "Growth & immigration ×{mult}",
  "colony.growthHint": "The growth factor from events at sea (composed events). Month-end births and immigration use it; output estimates already include output events.",
  "colony.growthNote": "Events: growth & immigration ×{mult}",
  "colony.effectLeft": "{days:plural(day,days)} left · until {end:date}",
  "colony.effectLastDay": "Ends today",
  "colony.chipEvent": "Event effects",

  // 建立殖民地对话框
  "colony.foundTitle": "Found a colony at {site}",
  "colony.foundIntro": "Raise the boundary stone and name this land. The crew who stay become its first settlers.",
  "colony.foundName": "Colony name",
  "colony.foundNameHint": "1–16 characters",
  "colony.foundReroll": "Another name",
  "colony.foundSettlers": "Settlers",
  "colony.foundSettlersLine": "{n} stay to settle; the fleet keeps {left} crew (min {min})",
  "colony.foundCrewShort": "Not enough crew: {need} needed ({settlers:plural(settler,settlers)} + {crewMin} minimum crew); the fleet has {have}.",
  "colony.foundFleet": "Fleet",
  "colony.foundConfirm": "Raise the stone",
  "colony.foundDone": "{name} is founded! {n:plural(settler begins,settlers begin)} to work the land.",
  // 建议的殖民地名称：前半与后半各取一个组合（用逗号分隔，与中文表的条目一一对应，同一个种子得到对应的名字）。
  // 前半不要以某个后半结尾（否则会拼出 “Moonbay Bay”）；最长的前半 + 空格 + 最长的后半不超过 16 个字符（殖民地名的上限），
  // 所以后半最多 5 个字母（岬译作 Reach，不用 “Head”：“Rose Head” 读来别扭）。
  "colony.namePrefixes": "New Vila, St. Irene, Alta, Lovina, Castria, Valen, Brisa, Mares, Solana, Elmo, Ister, Bellona, Osway, Lind, Silverpine, Whitesail, Amber, Iris, Moonwater, Starwell, Dawn, Heron, Oakwood, Rose",
  "colony.nameSuffixes": "Haven, Keep, Town, Bay, Point, Ferry, Reach, Vale, City, Sands",
  "colony.nameJoin": "{prefix} {suffix}",
};
