// UI strings (en): new UI phase 2 — fleet and people (fleet, mates, inventory / equipment, codex, relationship map, quest log). Keys start with v2.fleet.
// 与 zh-CN.v2-fleet.ts 一一对应。
import type { Translation } from "./translation";
import type { v2Fleet as zh } from "./zh-CN.v2-fleet";

export const v2Fleet: Translation<typeof zh> = {
  // Fleet
  "v2.fleet.pick": "Choose a fleet",
  "v2.fleet.cargoHint": "Docked at {loc} — the market is right by the quay.",
  "v2.fleet.cargoHintSea": "Load goods at a market once you make port.",
  "v2.fleet.goMarket": "Go to the market",
  "v2.fleet.crewBlocked": "Fewer than {min} crew — you can't set sail ({crew} aboard).",
  "v2.fleet.crewBlockedSea": "You can only hire hands in port.",

  // Mates
  "v2.fleet.matesHint": "Mates are waiting in port taverns — see who is where below.",
  "v2.fleet.matesHintSea": "Hire mates at a tavern once you make port.",
  "v2.fleet.goTavern": "Go to the tavern",
  "v2.fleet.hireAt": "Hire at the tavern in {loc}.",
  "v2.fleet.dismissTitle": "Dismiss {name}?",
  "v2.fleet.dismissBody": "{name} will go back to the tavern in their home port; to bring them back you'd have to hire them there again.",
  "v2.fleet.dismissBodyRole": "{name} will go back to the tavern in their home port and the post of “{role}” will be left empty; to bring them back you'd have to hire them there again.",
  "v2.fleet.dismissConfirm": "Dismiss {name}",
  "v2.fleet.dismissed": "{name} has been dismissed.",

  // Inventory
  "v2.fleet.equip": "Equip",
  "v2.fleet.equipNamed": "Equip {item} on {wearer}",
  "v2.fleet.read": "Read",
  "v2.fleet.readNamed": "Start reading {item}",
  "v2.fleet.use": "Use",
  "v2.fleet.useNamed": "Use {item}",
  "v2.fleet.worn": "Worn",
  "v2.fleet.readingThis": "Reading",
  "v2.fleet.readAfter": "Finish “{name}” first",
  "v2.fleet.itemsEmpty": "Your pack is empty.",
  "v2.fleet.itemsEmptyHint": "Things you buy at item shops and auctions, and rewards for requests, end up here.",
  "v2.fleet.filterEmptyHint": "There are things in the other categories.",
  "v2.fleet.showAll": "Show all items",
  "v2.fleet.setsEmpty": "You're not collecting any sets yet.",
  "v2.fleet.itemPick": "Pick an item to see what it is and what it does.",

  // Codex
  "v2.fleet.codexPick": "Pick an entry to read about it and where it comes from.",

  // Quest log
  "v2.fleet.questsHint": "Requests from people, story chapters and promises are logged here.",
  "v2.fleet.goPeople": "Go and meet people",
  "v2.fleet.showDone": "Show finished and failed ones too",

  // Relationship map
  "v2.fleet.graphHint": "Click a name to see that person's details.",
  "v2.fleet.graphLegend": "Line colours",
  "v2.fleet.edge.love": "Lovers · someone they care for",
  "v2.fleet.edge.bond": "Friends · sworn · sisters",
  "v2.fleet.edge.rival": "Rivals · enemies",
  "v2.fleet.edge.mentor": "Mentor and pupil",
  "v2.fleet.graphEmpty": "You haven't met anyone yet.",
  "v2.fleet.graphEmptyHint": "People you meet in ports, taverns and stories are linked up here.",

  // Free chat (phone)
  "v2.fleet.chatPlaceholderShort": "Say something…",
  "v2.fleet.chatLimit": "Up to {max} characters a line",
  "v2.fleet.noFleetHint": "Buy a ship at a port with a shipyard to put a new fleet together.",
  "v2.fleet.toShipyard": "Go to the shipyard",
  "v2.fleet.pp.nobodyHereHint": "Everyone you know is somewhere else.",
  "v2.fleet.pp.showAll": "Show everyone",
  "v2.fleet.pp.nobodyHint": "You meet more people by asking around in taverns, taking on requests and visiting ports.",
  "v2.fleet.pp.newsHereHint": "You may have heard something elsewhere.",
  "v2.fleet.pp.newsAll": "See all news",
};
