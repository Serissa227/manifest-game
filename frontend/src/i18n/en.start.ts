// 界面字符串（en）：标题画面、开局剧本选择与主角创建。与 zh-CN.start.ts 的键一一对应。
// 术语：巨人之门 the Giant's Gate、新大陆 the New World（Astria, the New World）、航海历 Mariner's Reckoning、主角 Captain。
import type { Translation } from "./translation";
import type { start as zh } from "./zh-CN.start";

export const start: Translation<typeof zh> = {
  // 标题画面
  "start.tagline": "Sail the seven seas and build your trading house",
  "start.sceneLabel": "A harbor at dusk: a lighthouse sweeps its beam from the headland, a sailing ship heads home, gulls skim the water",
  "start.menuLabel": "Main menu",
  "start.menuNew": "New Voyage",
  "start.menuLoad": "Load Game",
  "start.footer": "An original seafaring trade game · All people and places are fictional",
  // 标题下的纪年与一句编年背景
  "start.eraLine": "{era} {year}",
  "start.eraLore": "Forty years since the Giant's Gate opened, and the New World's coast is still not fully charted.",

  // 剧本卡片
  "start.scenarioStart": "Home port",
  "start.scenarioCash": "Funds",
  "start.scenarioGoal": "Goal",
  "start.scenarioFleet": "Fleet",
  "start.scenarioShip": "{ship} · crew {crew}",
  "start.scenarioMates": "{n:plural(mate,mates)}",
  // 开局货物与粮水
  "start.scenarioCargo": "Hold",
  "start.scenarioCargoItem": "{name} ×{qty}",
  "start.scenarioSupplies": "Food {food} · Water {water}",
  "start.goal.net_worth": "Reach a net worth of {target}",
  "start.goal.ally_ports": "Become the allied house of {target:plural(port,ports)}",
  "start.goal.sandbox": "Free trade, no victory goal",
  "start.goal.coloniesPopulation": "Own {target:plural(colony,colonies)} with population ≥ {population}",
  "start.goalYears": " (within {years:plural(year,years)})",
  "start.goalUntil": "by {day:date}",
  "start.scenarioEra": "Era",
  "start.scenarioEraValue": "Sets sail in {year} ({era})",
  "start.listSep": ", ",
  "start.factSep": " · ",
  "start.chosen": "Selected",

  // 主角创建
  "start.captainTitle": "Your captain",
  "start.captainName": "Captain's name",
  "start.captainNameHint": "1–12 characters",
  "start.captainNameEmpty": "Give your captain a name (or click “Random”).",
  "start.random": "Random",
  "start.randomName": "Random name",
  "start.randomLook": "Random look",
  "start.prevLook": "Previous look",
  "start.nextLook": "Next look",
  "start.looks": "Looks",
  "start.lookN": "Look {n}",
  "start.lookCount": "{n} / {total}",
  "start.portraitLabel": "Portrait of Captain {name} (look {n})",
  "start.captainPlate": "Captain {name}",
  "start.voyageLine": "Captain {name} will set sail from {port}.",
  "start.starting": "Weighing anchor…",

  // 读档
  "start.loadHint": "Choose a save to continue your last voyage.",
  "start.saveCaptain": "Captain {name}",
  "start.saveNoCaptain": "Nameless Captain",
  "start.saveDetail": "{scenario} · {day} · Net worth {worth}",
  "start.saveWorldScenario": "{world} · {scenario}",
  "start.saveRetired": "The old scenario has been retired; this save can no longer be loaded (you can delete it)",
  "start.saveOpen": "Load save {slot}",
  "start.saveDelete": "Delete",
  "start.saveDeleteLabel": "Delete save {slot}",
  "start.saveDeleteAsk": "Delete save “{slot}”? It cannot be recovered.",
  "start.saveDeleteYes": "Delete",
  "start.saveDeleteNo": "Cancel",
  "start.saveDeleted": "Deleted save {slot}",
};
