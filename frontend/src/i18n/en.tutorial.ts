// 界面字符串（en）：新手教程。与 zh-CN.tutorial.ts 的键一一对应。讲解的是一只没有名字的小乌鸦。
import type { Translation } from "./translation";
import type { tutorial as zh } from "./zh-CN.tutorial";

export const tutorial: Translation<typeof zh> = {
  "tut.progress": "{n} / {total}",
  "tut.next": "Next",
  "tut.prev": "Back",
  "tut.finish": "Done",
  "tut.skip": "Skip tutorial",
  "tut.tryIt": "Try it once and the tutorial moves on by itself.",
  "tut.guideLabel": "The little crow",
  "tut.welcome.title": "Caw! Welcome, Captain",
  "tut.welcome.text":
    "I'm a crow with a very good memory, and showing new captains around is my job: read the market, buy, set sail, sell. If I talk too much, click Skip tutorial. You can call me back from Settings later. Caw.",
  "tut.cash.title": "Cash and assets",
  "tut.cash.text":
    "All the shiny things are here! Your cash, net worth and total assets. Cash pays for goods, wages and supplies; net worth is cash plus ships, cargo and deposits, minus loans. I love counting coins: one, two, three…",
  "tut.cash.textCompact":
    "All the shiny things are here! This is your cash; it pays for goods, wages and supplies. Net worth and total assets are in the Menu at the top right. I love counting coins: one, two, three…",
  "tut.goal.title": "Your goal",
  "tut.goal.text": "The scenario goal, your progress and the deadline. You can keep trading after you reach it. Caw.",
  "tut.goal.textCompact": "The thin gold line under your cash is your progress toward the scenario goal; the full goal and the deadline are in the Menu at the top right. You can keep trading after you reach it. Caw.",
  "tut.time.title": "Time",
  "tut.time.text":
    "Pause, or run at 1× to 32×. At 1× a day takes about 4 seconds. The game starts paused, so look around before you sail. Don't fly into the mast like I did the first time.",
  "tut.town.title": "The port",
  "tut.town.text": "This is the harbor! Each building is a facility: market, shipyard, tavern, guild, bank… Click a building to go in.",
  "tut.town.textCompact": "This is the harbor! Each building is a facility: market, shipyard, tavern, guild, bank… Tap a building to go in. When the harbor is wider than the screen, drag it left and right.",
  "tut.market.title": "The market",
  "tut.market.text":
    "The market has a Sell tab and a Buy tab. The Buy tab lists only what this port sells, mostly goods tagged Specialty that are made here and usually cheap; a green price is below the usual, a good time to buy, and the little line beside it is the recent trend. I can spot a bargain from a mile away.",
  "tut.buy.title": "Buying",
  "tut.buy.text":
    "Found something? Click Max on the right of its row to buy as much as your cash, hold and the stock allow. Only want some? Use − / + on the row (hold to repeat), then press Trade all at the bottom. Give it a try, caw!",
  "tut.cart.title": "The ledger",
  "tut.cart.text":
    "The plank at the bottom of the window is the ledger: your cash and cargo are always here. Set quantities on a few rows and it adds up the total, the cash and room left afterwards; press Trade all to settle it at once, sales first. If you are short of cash it says so. Nobody counts coins like me!",
  "tut.sell.title": "Selling",
  "tut.sell.text":
    "At another port the market opens on the Sell tab: each cargo shows its bid and profit. Click Sell all on a row, or Sell everything at the top; to sell only part, set the quantity with − / + and press Trade all. Every port buys every good, and the farther from where a good is made, the more it fetches: carry specialties far away!",
  "tut.info.title": "Where to sell",
  "tut.info.text":
    "The Analysis window shows price trends for ports you have visited, with forecasts. Prices elsewhere are from your last visit or news carried by ships, and may have changed by the time they reach you. Caw.",
  "tut.crew.title": "Crew",
  "tut.crew.text":
    "Crew are lost in sea battles, storms and when food runs out, and below the minimum you cannot sail! At the top of the tavern (and on the Fleet page) you can Hire to minimum or Fill the crew in one click.",
  "tut.depart.title": "Setting sail",
  "tut.depart.text": "When you are ready, click Set sail, then pick a port on the chart. I'll watch the wind for you from the masthead!",
  "tut.route.title": "Check the route",
  "tut.route.text":
    "The dialog shows how many days the voyage takes and whether your food, water and crew will last. Your crew eats and drinks every day; if supplies are short, click Resupply first, then Sail.",
  "tut.sea.title": "At sea",
  "tut.sea.text":
    "Off we go! The weather changes at sea and pirates may appear; resolve fights automatically or command them yourself. The market opens when you arrive.",
  "tut.save.title": "Saving and settings",
  "tut.save.text": "Remember to save, caw! In Settings you can turn on AI enhancement (livelier events and rumors) and adjust music and language.",
  "tut.save.textCompact": "Remember to save, caw! Saving and loading are in the Menu at the top right; in Settings you can turn on AI enhancement (livelier events and rumors) and adjust music and language.",
  "tut.end.title": "That's all!",
  "tut.end.text":
    "Buy low, sell high, and put away your first savings. Fleets, mates, caravans, industry and colonies are yours to discover. Count your savings out loud for me sometime. Fair winds, caw!",
  "tut.settingsTitle": "Tutorial",
  "tut.settingsHelp": "Let the little crow walk you through the basics again: read the market, buy, set sail, sell.",
  "tut.settingsStart": "Start the tutorial",
  // 第九批：养成教程（UB_STEPS）
  "tut.ub_welcome.title": "Before You Grow Up",
  "tut.ub_welcome.text": "Caw! Before you go to sea you grow up at home and at an academy — plan each month and watch yourself get stronger. Let me show you around.",
  "tut.ub_hero.title": "You",
  "tut.ub_hero.text": "On the left is you: stamina, fatigue, mood and renown. Too much fatigue and you fall ill, sulk or fail exams; a good mood helps you learn faster. The ratings below decide your title at graduation.",
  "tut.ub_plan.title": "This Month",
  "tut.ub_plan.text": "A month has three ten-day weeks. At home each week has one slot; at the academy each has a lesson and an after-class slot. Click a slot, then pick an activity below.",
  "tut.ub_cards.title": "Activities",
  "tut.ub_cards.text": "Each card shows what you gain, how tiring it is, what it costs or pays, and whether your mentor is there. Jobs you keep at earn a higher rank; grayed-out cards say why you can't do them yet. Some ask where, with whom, or which book.",
  "tut.ub_auto.title": "Too Many Slots?",
  "tut.ub_auto.text": "Use Auto plan with a focus — seamanship, trade, arms, study, social or balanced — and the month fills itself. Change a few slots if you like.",
  "tut.ub_go.title": "Begin the Month",
  "tut.ub_go.text": "At the bottom is what the month should bring; you'll be warned if it is too tiring. When every slot is filled, click Begin the Month — time runs, and anything that happens will stop and ask you.",
  "tut.ub_side.title": "Stats, Bonds, Calendar…",
  "tut.ub_side.text": "On the right: how far each stat has grown, how close you are to the people around you, which festivals and birthdays are coming, plus your album, letters and diary. Letters from afar take months by ship.",
  "tut.ub_calendar.title": "Countdowns",
  "tut.ub_calendar.text": "Up top are the nearest dates: festivals, contests, exams, birthdays. Prepare ahead — practice, save for a gift, make plans — and the day goes better.",
  "tut.ub_end.title": "Off You Go",
  "tut.ub_end.text": "In four years you put to sea. For now, plan this month.",
};
