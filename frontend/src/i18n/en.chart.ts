// 界面字符串（en）：航海图、航行状态、选择目的地与入港。与 zh-CN.chart.ts 的键一一对应。
// 术语：港口 Port、内陆城市 Inland city、殖民点 Colony site、殖民地 Colony、发现物 Discovery、船员 Crew、士气 Morale。
import type { Translation } from "./translation";
import type { chart as zh } from "./zh-CN.chart";

export const chart: Translation<typeof zh> = {
  // 航海图上的小窗
  chartWinLegend: "Legend",
  chartWinPlaces: "Places",
  chartCollapse: "Collapse",
  chartExpand: "Expand",
  chartToggleLegend: "Collapse or expand the legend",
  chartTogglePlaces: "Collapse or expand the list of places",
  chartUnknownPlace: "Unvisited",
  chartFilter: "Find a place",
  chartFilterEmpty: "No place matches that name.",

  // 地点列表的分组
  chartGroupPorts: "Ports ({n})",
  chartGroupCities: "Inland cities ({n})",
  chartGroupWild: "Unsettled ({n})",
  chartGroupClaimed: "Claimed ({n})",
  chartGroupMine: "My colonies ({n})",
  chartGroupOther: "Others' colonies ({n})",

  // 殖民点与发现物
  chartSites: "Colony sites",
  chartSiteWild: "Colony site (unsettled)",
  chartSiteClaimed: "Colony site (claimed by the {faction})",
  chartSiteColony: "Colony: {name}",
  chartSiteOther: "Colony (someone else's)",
  chartLegendSite: "Colony site (unsettled)",
  chartLegendClaimed: "Claimed by a nation",
  chartLegendColony: "Colony",
  chartLegendDiscovery: "Discovery",
  // 天况标记与夜间灯火
  chartLegendWeather: "Today's weather in each sea region (drifts with the wind)",
  "chartLegendSky.cloudy": "Cloudy",
  "chartLegendSky.rain": "Rain",
  "chartLegendSky.fog": "Fog",
  "chartLegendSky.storm": "Storm",
  "chartLegendSky.snow": "Snow",
  chartLegendLights: "Lights at night",

  // 选择目的地
  chartPickHint: "Pick a destination on the sea chart",
  chartPickSub: "Click a port, or choose one from the list of places.",
  chartPickCancel: "Cancel",
  chartPickPortOnly: "Fleets can only sail to ports; form a caravan to reach inland cities.",
  chartPickPortOrSite: "Fleets can only sail to ports or colony sites; form a caravan to reach inland cities.",
  chartPickSubSites: "Click a port or colony site, or choose one from the list of places.",
  chartAlreadyHere: "The flagship fleet is already docked at {port}.",
  chartNoFleet: "No fleet can set sail.",

  // 出航确认
  chartConfirmTitle: "Set sail",
  chartConfirmDest: "Destination",
  chartConfirmNew: "Unvisited port",
  chartConfirmDays: "Estimated voyage",
  chartConfirmSupplies: "Suggested supplies",
  chartConfirmHave: "Supplies on board",
  chartConfirmHaveValue: "Food {food}, water {water} (lasts {days:plural(day,days)})",
  chartConfirmShort: "Not enough food and water for the whole voyage; you may run out on the way.",
  chartResupply: "Resupply to the suggested level (about {cost})",
  chartConfirmCrew: "Crew",
  chartConfirmCrewValue: "{crew} (min {min}, max {max})",
  chartCrewShort: "Not enough crew: you need at least {min} and have {crew}, so you cannot sail.",
  chartConfirmNoRoute: "That port cannot be reached.",
  chartConfirmLoading: "Plotting a course…",
  chartConfirmSail: "Sail",
  chartConfirmRepick: "Pick again",
  chartConfirmCancel: "Stay in port",
  chartConfirmAutoStart: "Time starts flowing at 1× once you confirm.",

  // 出航确认：目的地是殖民点
  chartConfirmStatus: "Status",
  chartConfirmTerrain: "Terrain",
  chartTerrainValue: "{terrain} (fertility {fertility}, hazard {hazard})",
  chartStatusWild: "Unsettled land",
  chartStatusClaimed: "Claimed by the {faction}",
  chartStatusMine: "My colony: {name}",
  chartStatusOther: "Someone else's colony",
  chartConfirmNewSite: "Not yet surveyed",
  chartConfirmNoRouteSite: "That place cannot be reached.",
  chartConfirmFoundHint: "On arrival you can found a colony here: at least {settlers:plural(settler,settlers)}, {cost:money} and building materials.",
  chartConfirmTakenHint: "This land already has an owner; you cannot found a colony here.",

  // 航行状态
  chartHudTitle: "Voyage",
  chartHudDest: "Destination",
  chartHudDays: "At sea",
  chartHudEta: "Arrives in",
  chartHudSupply: "Supplies last",
  chartHudMorale: "Morale",
  chartHudCrew: "Crew",
  chartHudCrewValue: "{crew} (min. {min})",
  chartHudDaysValue: "{n:plural(day,days)}",
  chartHudUnknown: "—",
  chartHudSupplyLow: "Supplies critical!",
  chartHudMoraleLow: "Morale is low",
  chartHudChangeCourse: "Change course",
  chartHudDrifting: "Adrift",
  chartHudFound: "Discoveries",
  chartHudFoundValue: "{n}",

  // 入港
  chartArrived: "Arrived at {port}.",
  // 接在抵达提示后面：英文前面空一格
  chartArrivedPaused: " Paused automatically; setting sail resumes at your previous speed.",
  chartDiscovered: "New port discovered: {port}! Its market prices are in the logbook.",
  chartArrivedWild: "Arrived at unsettled land: {site}.",
  chartArrivedWildNew: "Surveyed unsettled land: {site}! A colony can be founded here.",
  chartArrivedColony: "Arrived at the colony of {name}.",
  chartArrivedClaimed: "Arrived at {site}: this land has been claimed by the {faction}.",
  chartArrivedOther: "Arrived at {site}: someone else already has a colony here.",

  // 航行中的发现
  chartFoundNotice: "Discovered: {name}! Report it at a port's guild for a bounty.",
};
