// UI strings (en): new UI phase 2 — numbers (market analysis, futures, reports, intel and chronicles). Keys start with v2.analysis.
// 与 zh-CN.v2-analysis.ts 一一对应。
import type { Translation } from "./translation";
import type { v2Analysis as zh } from "./zh-CN.v2-analysis";

export const v2Analysis: Translation<typeof zh> = {
  // —— Market analysis: empty states and the next step ——
  "v2.analysis.fc.noDataHint": "A closing price is recorded once a day — wait one day.",
  "v2.analysis.fc.bookEmptyHint": "Pick a method and horizon under “Reckon”, then press “Record this forecast”; the book checks it against real prices day by day.",
  "v2.analysis.fc.toWork": "Go to Reckon",
  "v2.analysis.fc.advHint": "Mathematical prodigies turn up in harbor taverns; hire one and you can replay every method against the old books.",
  // —— Market analysis: the pin bar at the bottom (what will be pinned) ——
  "v2.analysis.fc.pinWhat": "{method} · next {days} days",
  "v2.analysis.fc.pinBar": "Record a forecast",
  // —— Forecast book: ask before deleting ——
  "v2.analysis.fc.removeTitle": "Delete forecast #{id}?",
  "v2.analysis.fc.removeBody": "{entry}. The book will stop tracking it and its review goes too. This cannot be undone.",
  "v2.analysis.fc.removeConfirm": "Delete this forecast",
  "v2.analysis.fc.removed": "Forecast #{id} deleted",
  // —— Futures: margin amount and one-click orders in each row ——
  "v2.analysis.fu.amountHint": "Deposits and withdrawals use this amount, for every account below.",
  "v2.analysis.fu.lotsHint": "Lots per order; go long, go short or close right in the contract’s row.",
  "v2.analysis.fu.actions": "Order",
  "v2.analysis.fu.long": "Long {n}",
  "v2.analysis.fu.short": "Short {n}",
  "v2.analysis.fu.close": "Close",
  "v2.analysis.fu.longAria": "{contract}: buy to open long, {n} lots",
  "v2.analysis.fu.shortAria": "{contract}: sell to open short, {n} lots",
  "v2.analysis.fu.closeAria": "{contract}: close {n} lots",
  "v2.analysis.fu.delivery": "delivers at {port}",
  "v2.analysis.fu.settle": "At expiry",
  "v2.analysis.fu.cash": "Cash",
  "v2.analysis.fu.physical": "Physical",
  "v2.analysis.fu.settleAria": "{contract}: settlement at expiry",
  "v2.analysis.fu.callRisk": "If the balance is still below maintenance after tomorrow’s mark-to-market, the exchange liquidates the position.",
  "v2.analysis.fu.callShort": "You are at least {short:money} short.",
  // Margin call: one-click top-up of the shortfall
  "v2.analysis.fu.topUp": "Deposit the {short:money} shortfall",
  "v2.analysis.fu.topUpAria": "Deposit the {short:money} shortfall at the {exchange} to reach maintenance margin",
  "v2.analysis.fu.empty": "No futures contracts are listed right now.",
  "v2.analysis.fu.emptyHint": "Only a few great ports have an exchange; new contracts are listed at month end when old ones expire.",
  // —— Reports ——
  "v2.analysis.rp.emptyHint": "The books close on the last day of each month and the monthly report appears here; the yearly one at year end.",
  // —— Intel: empty states ——
  "v2.analysis.it.newsEmpty": "No news has reached you yet.",
  "v2.analysis.it.newsHint": "Every few days rumors, merchants’ word and official notices come in, wherever your ships are; with AI turned off in Settings, no new news arrives.",
  "v2.analysis.it.eventsEmpty": "Nothing is under way right now.",
  "v2.analysis.it.logEmpty": "Nothing has been logged yet.",
  "v2.analysis.it.logMineEmpty": "Nothing in the log concerns you yet.",
  "v2.analysis.it.logMineHint": "Every entry so far is about someone else.",
  "v2.analysis.it.logShowAll": "Show all",
  "v2.analysis.it.chronicleEmpty": "The chronicle is still blank.",
  "v2.analysis.it.chronicleHint": "At the end of each year its great events are written up as one entry.",
  "v2.analysis.fc.shortHint": "Each day adds a closing price; once the record is long enough, this method can run.",
  "v2.analysis.fc.toMonthly": "Switch to monthly",
  "v2.analysis.fc.monthShortHint": "The monthly line gains a point only at the end of each month; look at the daily line for now.",
  "v2.analysis.fc.toDaily": "Show daily",
  "v2.analysis.fc.rvWaitHint": "A few days after you record a forecast, this compares it with the actual prices.",
  "v2.analysis.fc.rvNoAttrHint": "Load this market to see what moved the price.",
  "v2.analysis.fc.rvLoadMarket": "Load this market",
};
