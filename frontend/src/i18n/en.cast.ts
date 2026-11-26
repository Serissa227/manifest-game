// 界面字符串（en）：新增的人物位（与 zh-CN.cast.ts 一一对应）。
import type { Translation } from "./translation";
import type { cast as zhCast } from "./zh-CN.cast";

export const cast: Translation<typeof zhCast> = {
  "cast.informant": "Informant",
  "cast.steward": "Colony steward",
  "cast.ruler.cuilan": "King",
  "cast.ruler.jinsui": "First Magistrate",
  "cast.ruler.chisha": "Sultan",
  "cast.ruler.bichao": "High Chieftainess",
  "cast.ruler.shuangling": "Duchess",
  "cast.ruler.yaohua": "Emperor",
  "cast.ruler.other": "Ruler",
  "cast.companyHead": "Head of the house",
  "cast.roster": "Rulers and trading houses",
  "cast.rosterRulers": "Rulers",
  "cast.rosterCompanies": "Heads of the trading houses",
  "cast.fleetOf": "Fleet of {company}",
  "cast.fleetMaster": "Shipmaster",
};
