// 界面字符串（en）：港口街景、设施窗口、设施掌柜的问候与台词、出港。与 zh-CN.port.ts 的键一一对应。
// 掌柜问候语的占位符与中文完全相同（见 zh-CN.port.ts 顶部的说明）；零值说法（.zero）同样不能再用值为 0 的占位符。
// 设施名按 EXPANSION.md §12.2：交易所（market）→ Market、造船厂 → Shipyard、酒馆 → Tavern、商会（guild）→ Guild、
// 银行 → Bank、期货交易所（exchange）→ Exchange、仓库 → Warehouse、港口投资 → Investment、势力办事处 → Office。
import type { Translation } from "./translation";
import type { port as zh } from "./zh-CN.port";

export const port: Translation<typeof zh> = {
  // ── 街景 ──
  portSceneLabel: "Streets of {name}",
  portSceneDepart: "Set sail",
  portSceneDepartHint: "Lead your fleet out of port and pick a destination on the sea chart",
  portSceneCrewShort: "Crew {crew}/{min}: too few to sail",
  portSceneDocked: "Your fleet is docked here",
  portSceneTaxShort: "Tax {pct}%",
  portSceneDev: "Development {dev}",
  portSceneFacilities: "Facilities of {name}",
  // 殖民点与殖民地的街景
  portSceneFound: "Found a colony",
  portSceneFoundHint: "Raise a boundary stone in this wilderness and found your colony",
  portSceneBuildings: "Buildings of {name}",
  portSceneBuilding: "{name} (Lv {level})",
  portSceneWild: "{terrain} · unclaimed land",
  portSceneColonySub: "Colony · {site}",
  portSceneColonyStats: "Pop. {population} · Morale {morale}",
  portSceneClaimed: "Outpost of the {faction}",
  portSceneOtherColony: "Another company's colony",

  // ── 设施掌柜 ──
  "portKeeperTitle.market": "Market keeper",
  "portKeeperTitle.shipyard": "Master shipwright",
  "portKeeperTitle.tavern": "Innkeeper",
  "portKeeperTitle.tavern.f": "Innkeeper",
  "portKeeperTitle.guild": "Guild steward",
  "portKeeperTitle.bank": "Bank treasurer",
  "portKeeperTitle.exchange": "Futures broker",
  "portKeeperTitle.warehouse": "Warehouse steward",
  "portKeeperTitle.invest": "Harbor councilor",
  "portKeeperTitle.office": "Resident envoy",
  portKeeperCaptain: "Captain",
  portKeeperCaptainNamed: "Captain {name}",

  "portGreet.market.0": "Welcome to the {port} market! We have {specialty:plural(local specialty,local specialties)} at fair prices. Have a look, Captain.",
  "portGreet.market.1": "Good timing: {popular:plural(item is,items are)} in fashion right now and fetching a fine price.",
  "portGreet.market.2": "All of {port}'s prices are on the board: {count:plural(item,items)} for sale, and we'll buy whatever you've brought in.",
  "portGreet.market.3": "{captain}, good to see you again. {season} has been generous: {specialty:plural(local specialty,local specialties)} on offer.",
  "portGreet.market.0.zero": "Welcome to the {port} market! We have no specialties of our own; everything here came in on other ships. Have a look, Captain.",
  "portGreet.market.1.zero": "Nothing is especially in fashion just now. Prices are steady, so there's room to bargain.",
  "portGreet.market.2.zero": "Nothing is listed in {port} today; the price board is empty. Come back in a few days.",
  "portGreet.market.3.zero": "{captain}, good to see you again. {season} brings little to these parts; the good stuff all comes in by ship.",
  "portGreet.market.4": "Buying and selling both happen here. Check the price first, then name your quantity. Big lots move the price.",

  "portGreet.shipyard.0": "The timber is seasoned and the keels are laid. We can build {count:plural(type,types)} of ship.",
  "portGreet.shipyard.1": "{captain}, isn't your hull due for scraping? Repairs, refits, new ships: come to me.",
  "portGreet.shipyard.2": "{port}'s shipwrights are the finest: {count:plural(type,types)} for sale. Just say which one catches your eye.",
  "portGreet.shipyard.3": "The open sea is rough. A sturdy ship keeps you safe, and I have {count:plural(type,types)} to choose from.",
  "portGreet.shipyard.none": "The slipways are empty and there are no new ships for sale, but we can still patch you up.",

  "portGreet.tavern.0": "Care for a drink? {mates:plural(mate is,mates are)} here tonight looking for work.",
  "portGreet.tavern.1": "{captain}, there's plenty of news from the sea lately. Sit down and listen.",
  "portGreet.tavern.2": "Sailors love a drink in {port}. If you're hiring, I'm the one to ask: {mates:plural(good hand,good hands)} right now.",
  "portGreet.tavern.3": "Windy out there. Come in and warm up. After news, or hiring crew?",
  "portGreet.tavern.nomate": "No mates came by today. Have a drink and hear the news.",

  "portGreet.guild.0": "The guild has {contracts:plural(contract,contracts)} waiting, and they pay well.",
  "portGreet.guild.1": "Deliver on time and your good name follows. Take a look at today's contracts.",
  "portGreet.guild.2": "{captain}, the guildmaster says trusted shipowners get first pick.",
  "portGreet.guild.3": "Every contract is sealed. Once you take one, deliver on time, or you'll pay a penalty.",
  "portGreet.guild.none": "No contracts right now. Check back in a few days.",

  "portGreet.bank.0": "Deposits earn {rate}% a year, safe and sound. Deposit or withdraw as you like.",
  "portGreet.bank.1": "Credit is capital. Repay on time and your limit rises with the tide.",
  "portGreet.bank.2": "The bank of {port} deals honestly with all. Loans run at {loanRate}% a year.",
  "portGreet.bank.0.zero": "Deposits earn no interest right now, but your money is safe here. Deposit or withdraw as you like.",
  "portGreet.bank.2.zero": "The bank of {port} deals honestly with all. Loans are interest-free right now, a rare chance.",
  "portGreet.bank.3": "Short of coin, {captain}? Check your credit limit first.",

  "portGreet.exchange.0": "Futures are about foresight: fix tomorrow's goods today and profit from the market.",
  "portGreet.exchange.1": "Keep your margin topped up. Don't delay when a margin call comes.",
  "portGreet.exchange.2": "Trading opens at the bell. {captain}, the board is over there.",
  "portGreet.exchange.3": "Welcome to the {port} futures exchange. Contracts settle as agreed at expiry.",
  "portGreet.exchange.none": "There is no futures exchange here. You'll have to trade futures in another port.",

  "portGreet.warehouse.0": "Leave your goods with me: safe from wind and rain.",
  "portGreet.warehouse.1": "Rent space by the hundred units, or buy a whole bay outright.",
  "portGreet.warehouse.2": "Your space in {port}: {used} used of {capacity}.",
  "portGreet.warehouse.2.zero": "You have nothing stored in {port} yet. If your holds are crowded, leave some cargo here.",
  "portGreet.warehouse.3": "{captain}, cargo on board takes up hold space. Why not store it here first?",

  "portGreet.invest.0": "{port}'s development stands at {dev}. Invest, and the docks will only get busier.",
  "portGreet.invest.0.zero": "{port} is still rebuilding; development is a long way off. Invest, and the docks will liven up day by day.",
  "portGreet.invest.1": "When the port thrives, its investors do well too.",
  "portGreet.invest.2": "The largest investor becomes the port's ally. Interested, {captain}?",
  "portGreet.invest.3": "New piers, bigger storehouses: it all costs money.",

  "portGreet.office.0": "This is the office of the {faction} in {port}. Your reputation with us is {rep}.",
  "portGreet.office.0.zero": "This is the office of the {faction} in {port}. Nobody here knows your name yet. Trade honestly and your reputation will grow.",
  "portGreet.office.1": "Military goods need a license, and privateering in wartime needs a letter of marque.",
  "portGreet.office.2": "The {faction} welcomes honest merchants. Please sit, {captain}.",
  "portGreet.office.3": "Relations between the nations are delicate lately. Ask around before you sail.",

  // ── 设施分页里的卡片 ──
  portMateNav: "Nav",
  portMateTrade: "Trade",
  portMateCombat: "Combat",
  portMateMgmt: "Mgmt",
  portMateLevel: "Lv {level}",
  portShipCrew: "{min}–{max}",
  portContractTitle: "Contract · No. {id}",
  portContractBody: "You are hereby engaged to carry {qty:plural(unit,units)} of {good} to {to} by day {day}.",
  portContractDirection: "an unsighted port ({dir})",
  portContractIssuer: "Issuer: {issuer}",
  portContractDaysLeft: "{days:plural(day,days)} left",
  portContractOverdue: "Expired",
  portContractSeal: "Seal",
  portMarketVsBase: "{sign}{pct}% vs base",
};
