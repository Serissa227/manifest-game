// 界面字符串（en）：信息时效——行情情报的开局设置、远方行情的时效与来源、行情通报，行情窗口的衔接与复盘。
// 与 zh-CN.info.ts 的键一一对应。用语：market news（行情）、notice board（告示板）、market report（行情通报）。
import type { Translation } from "./translation";
import type { info as zh } from "./zh-CN.info";

export const info: Translation<typeof zh> = {
  // ── 开局向导（启航一步） ──
  "info.title": "Market news",
  "info.mode.carried": "Carried by ship (recommended)",
  "info.mode.carriedHint":
    "Prices at distant ports are news brought by ships, marked with how old they are and where they came from. They are updated only when you are there yourself, when a ship brings news while you are in port, or when you buy a market report. Trading companies only know what their own ships bring back.",
  "info.mode.live": "Live (classic)",
  "info.mode.liveHint": "Once you have visited a port, you always see its prices as they are today.",

  // ── 远方行情的时效与来源 ──
  "info.seen": "{age:plural(day,days)} old · {source}",
  "info.seenToday": "Today · {source}",
  "info.src.visit": "seen yourself",
  "info.src.ship": "ship's news",
  "info.src.report": "market report",
  "info.staleNote": "Prices and stock are as they were then and may have changed since; you are not there, so you cannot ask for today's price.",
  "info.band.0": "Scarce",
  "info.band.1": "Low",
  "info.band.2": "Normal",
  "info.band.3": "High",
  "info.band.4": "Plentiful",
  "info.bandHint": "Stock level ({age:plural(day,days)} old)",

  // ── 行情通报（交易所） ──
  "info.report.title": "Market report",
  "info.report.offer": "The notice board has newer news than yours from {n:plural(port,ports)} ({ports}). The whole report costs {price}.",
  "info.report.none": "The notice board has nothing newer than what you already know.",
  "info.report.buy": "Buy the market report",

  // ── 行情窗口：过时行情的衔接 ──
  "fc.stale":
    "These prices are {age:plural(day,days)} old ({source}), and the daily line stops on that day. Your flagship's fleet is about {voyage:plural(day,days)} away, so the horizon is {age} + {voyage} = {h} days and ends on the day you arrive.",
  "fc.staleNoVoyage": "These prices are {age:plural(day,days)} old ({source}), and the daily line stops on that day; the horizon counts from then.",
  "fc.staleArrive": "Forecast for arrival",

  // ── 复盘 ──
  "fc.f.stale": "The forecast used stale news: it started from prices {n:plural(day,days)} older than the day it was made, and nothing that happened in between could be known",
  "fc.rv.waiting":
    "The forecast period is over, but no news has come back from that port yet. Wait for a ship to bring news, buy a market report, or go there yourself to review the remaining days.",
  "fc.book.waiting": "Awaiting news",

  // ── 第八批 E7：势力的经济政策、商会传闻、市场月报、复盘点评、身世序章 ──
  "pol.ban": "Export ban",
  "pol.banHint": "The nation here bans taking this good out: it cannot be bought (local use goes on)",
  "pol.export": "Export duty ×{x}",
  "pol.exportHint": "The nation here puts a duty on this good when it leaves: the trade tax on buying it is multiplied by this",
  "pol.import": "Import tariff ×{x}",
  "pol.importHint": "The nation here puts a tariff on this good when it comes in: the trade tax on selling it is multiplied by this",
  "pnCeSource.rule": "Official decree",
  tvOutlook: "Word about {company}: {memo}",
  itReports: "Market reports",
  itReportTitle: "{region} · issued on day {day}",
  itPrologue: "Prologue",
  "fc.rv.comment": "Ask the bookkeeper",
  "fc.rv.commentBusy": "The bookkeeper is reading",

  // ── 账簿 ──
  "memo.MarketReport": "Market report",
  "flow.MarketReport": "Market reports (paid out)",
};
