// 界面字符串（en）：探险——探险记录窗口、发现物、名声，以及发现相关的日志、提醒与账簿用语。与 zh-CN.explore.ts 的键一一对应。
// 术语：发现物 Discovery、报告 Report、名声 Fame、航海士 Mate；到港口商会（guild 设施）报告发现。
import type { Translation } from "./translation";
import type { explore as zh } from "./zh-CN.explore";

export const explore: Translation<typeof zh> = {
  // 功能页
  "tab.explore": "Exploration",
  "explore.panelTitle": "Expedition log",
  "explore.placeholder": "The expedition log is being copied out…",
  "explore.empty": "Your logbook records no discoveries yet. Leave the familiar routes and see what lies in the blank spaces of the chart.",

  // 探险窗口：卷首
  "explore.journal": "Expedition journal",
  "explore.subtitle": "Record every ruin, wonder and legend you sight. Report them at a port's guild to claim bounties and spread your fame.",

  // 名声与航海士招募门槛
  "explore.fame": "Fame",
  "explore.fameNext": "{need} more fame to hire level {level} mates",
  "explore.fameAll": "Your fame is enough to hire any mate",
  "explore.ladder": "Mate hiring thresholds",
  "explore.rung": "Level {level} mates · Fame {fame}",
  "explore.rungOk": "Reached",
  "explore.rungNo": "Not yet",

  // 统计
  "explore.progress": "Found {found} / {total}",
  "explore.pending": "{n} to report",
  "explore.kinds": "By kind",
  "explore.kindCount": "{found} / {total}",
  "explore.filterAll": "All",

  // 发现物卡片
  "explore.foundOn": "Found {day:date}",
  "explore.coords": "Chart position {x}, {y}",
  "explore.lore": "“{text}”",
  "explore.bounty": "Bounty {value:money} · Fame +{fame}",
  "explore.reported": "Reported",
  "explore.unreported": "To report",
  "explore.noneOfKind": "Nothing of this kind found yet.",

  // 尚未发现
  "explore.unknownName": "???",
  "explore.unknownCount": "??? × {n}",
  "explore.unknownHint": "{n:plural(mystery remains,mysteries remain)} on the chart, waiting to be sighted by your fleet.",

  // 海上传闻
  "explore.rumors": "Rumors at sea",
  "explore.rumorHint": "Rumors from taverns and docks only name a rough sea region. Sail there and sight it yourself to make it a real discovery.",
  "explore.rumorLine": "Rumor: “{name}” · sea region: {region}",
  "explore.rumorFar": "unknown, somewhere far off",
  "explore.rumorHeard": "Heard {day:date}",
  "explore.rumorOpen": "Unconfirmed",
  "explore.rumorConfirmed": "Confirmed",

  // 向商会报告
  "explore.report": "Report to the guild",
  "explore.reportAll": "Report all ({n})",
  "explore.reportAt": "Report at",
  "explore.reportHere": "Docked at {port}: report discoveries to the local guild for bounties and fame.",
  "explore.reportNoPort": "Dock a fleet or caravan at a port to report discoveries to its guild.",
  "explore.reportDone": "Reported “{name}” to the guild at {port}: bounty {reward:money}, fame +{fame}",
  "explore.reportAllDone": "Reported {n:plural(discovery,discoveries)} to the guild at {port}: bounty {reward:money}, fame +{fame}",

  "explore.dives": "Dive sites",
  "explore.diveHint": "These can only be found by diving. Stop on that stretch of sea with sails furled (or dock) to dive.",
  "explore.dive": "Dive",
  "explore.diveRumor": "Dive site near {region}",
  "explore.diveUnknown": "Uncharted dive site",
  "explore.diveDone": "Dive done: {name}",

  // 顶部状态栏
  hudFame: "Fame",
  hudDiscoveriesUnreported: "{n} to report",
  hudDiscoveriesHint: "Report discoveries at any port's guild for bounties and fame",

  // 发现物的种类
  "discoveryKind.ruins": "Ruins",
  "discoveryKind.wonder": "Wonder",
  "discoveryKind.wreck": "Wreck",
  "discoveryKind.relic": "Relic",
  "discoveryKind.beast": "Sea beast",
  "discoveryKind.landmark": "Landmark",
  "discoveryKind.animal": "Wildlife",
  "discoveryKind.plant": "Plant",
  "discoveryKind.fallen": "Meteorite",
  "discoveryKind.phantom": "Phantom isle",

  // 事件日志（英文统一写成“所有者: 事情”，所有者可能是 “You”，避免 “You's” 这样的所有格）
  "log.Discovered": "{owner}: a fleet sighted “{discovery}” and entered it in the logbook",
  "log.DiscoveryReported": "{owner}: reported “{discovery}” to the guild at {loc}, bounty {reward:money}, fame +{fame}",

  // 航海日志的提醒
  "notice.discoveryUnreported": "{n:plural(discovery,discoveries)} not yet reported; claim bounties at a port's guild",

  // 账簿用语
  "memo.Discovery": "Discovery bounty",
  "flow.Discovery": "Exploration: discovery bounties",
};
