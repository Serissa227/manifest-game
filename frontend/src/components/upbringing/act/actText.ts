// 养成行动制界面上的字（只写中文，寰宇只有中文；按 docs/COPY-STYLE.md：短、在戏里、不用“系统”“效率”一类的词）。
// 这里只放界面字：按钮、停因、空状态、行动名、错误码的说明。门名、家业、寒暄句这类内容文字由视图按键给（ActView.texts），
// 没给时显示占位（actKit.ts 的 makeNames）。不放进 i18n 的中英表：寰宇只有中文，这一屏也只在寰宇出现。
// 占位符写成 {name}；ta() 换掉，缺的参数原样留着。

import { tz, ZH_ONLY, type ZhOnlyKey } from "../../../i18n/zhOnly";

export const ACT_TEXT = {
  // —— 顶栏 ——
  "top.week": "{y} 年 {m} 月第 {w} 周",
  "top.day": "第 {d} 天",
  "top.idle": "月末闲日",
  "top.lessons": "课业",
  "top.lessonsTip": "这周的课业格：已经上了 {done} 格，共 {n} 格。课业格只排课，和行动点是两本账。",
  "top.points": "行动",
  "top.pointsTip": "行动点：本周还剩 {left} 点（共 {max} 点）。进地点、看看、寒暄、买东西都不花点；做事才花。",
  "top.bonus.constitution": "体魄好，多 {n} 点",
  "top.bonus.rank": "身份高，多 {n} 点",
  "top.cash": "钱",
  "top.cashTip": "这周进 {in} 文、出 {out} 文",
  "top.fatigue": "疲劳",
  "top.fatigueTip": "到 {fail} 课容易失手，到 {ill} 可能病倒。照这样过，周末大约 {proj}。",
  "top.fatigueIll": "病倒的机会 {n}%",
  "top.mood": "心情",
  "top.book": "手账",
  "top.bookTip": "属性、人、日历、书信、志向与考试",
  "top.play": "继续",
  "top.pause": "停一下",
  "top.menu": "菜单",
  "top.skip": "跳过养成",

  // —— 阶段 ——
  "phase.plan": "周初",
  "phase.lessons": "上课",
  "phase.moment": "关键时刻",
  "phase.free": "周末",
  "phase.story": "有事",
  "phase.voyage": "出海",
  "phase.summary": "小结",

  // —— 日历条 ——
  "cal.label": "本周与后四周",
  "cal.thisWeek": "本周",
  "cal.weekN": "第 {n} 周",
  "cal.empty": "无事",
  "cal.markerDue": "{who}的事到期",
  "cal.any.festival": "节日",
  "cal.any.exam": "考试",
  "cal.any.contest": "比赛",
  "cal.any.academy": "学院的事",
  "cal.any.marker_due": "有件事到期",
  "cal.any.agenda": "有事",
  "cal.any.mission_due": "交差",
  "cal.any.review": "评定",
  "cal.any.voyage": "出海",
  "cal.any.tide": "大潮",
  "cal.kind.festival": "节",
  "cal.kind.exam": "考",
  "cal.kind.contest": "赛",
  "cal.kind.academy": "校",
  "cal.kind.marker_due": "!",
  "cal.kind.agenda": "事",
  "cal.kind.mission_due": "命",
  "cal.kind.review": "评",
  "cal.kind.voyage": "船",
  "cal.kind.tide": "潮",
  "cal.day": "{d} 日",

  // —— 停因（周初停下来问的一条） ——
  "stop.lead": "停在这里",
  "stop.tier_open": "新的一档开了",
  "stop.tier_open.hint": "「{what}」可以往上排了",
  "stop.fee": "学费不够",
  "stop.fee.hint": "本周学费 {need} 文，手头 {have} 文",
  "stop.fatigue": "会累过头",
  "stop.fatigue.hint": "照这张课表，周末疲劳约 {n}，课容易失手",
  "stop.calendar": "这周有事",
  "stop.calendar.hint": "{what}",
  "stop.mission_due": "主命快到期",
  "stop.mission_due.hint": "还差一点，这周是最后的机会",
  "stop.key_marker": "有件事这周到期",
  "stop.key_marker.hint": "{what}——不去看，它也会自己找上门",
  "stop.restage": "新的地方",
  "stop.restage.hint": "课表按这里能上的课排过了，先看一眼再开课",
  "stop.blocked": "课表排不上",
  "stop.blocked.hint": "第 {what} 格排不上，换一门或换一档",
  "stop.look": "看课表",
  "plan.quiet": "课表照上周",
  "plan.quietHint": "{n} 格 · 学费 {fee} 文 · 疲劳 +{fat} · 周末约 {proj}",
  "plan.edit": "改课表",
  "plan.go": "开课",
  "plan.goTip": "开课以后平日一天一格地上，第六天停在城里",
  "plan.short": "学费还差 {n} 文",
  "plan.blocked": "先把排不上的格换掉",
  "plan.peek": "开课前也能进城看看谁在哪儿，寒暄、买东西不用等周末。",

  // —— 课表 ——
  "tt.title": "本周课表",
  "tt.slots": "{n} 格",
  "tt.defaults": "缺省课表",
  "tt.evening": "晚课",
  "tt.past": "已过",
  "tt.tier": "{n} 档",
  "tt.tierLocked": "未开",
  "tt.tierNew": "新",
  "tt.tierGate": "要过师事",
  "tt.with": "同行",
  "tt.withNone": "不带人",
  "tt.withTip": "一周只能带一个人上一格课；对方要在那门课的地方",
  "tt.fee": "学费 {n}",
  "tt.fatigue": "疲劳 +{n}",
  "tt.success": "成 {n}%",
  "tt.great": "出彩 {n}%",
  "tt.gain": "{attr} +{lo}–{hi}",
  "tt.total": "本周：学费 {fee} 文 · 疲劳 +{fat} · 周末约 {proj}",
  "tt.overBudget": "差 {n} 文",
  "tt.yearRoom": "今年{attr}还能长 {n}",
  "tt.templates": "模板",
  "tt.saveTo": "存为 {n}",
  "tt.useN": "用 {n}",
  "tt.emptyTpl": "空",
  "tt.close": "收起",
  "tt.noLines": "这一阶段还没有能上的课。",

  // —— 上课（平日逐格出结果） ——
  "ls.title": "这一周的课",
  "ls.skip": "跳过",
  "ls.skipTip": "不再一格格地看，时间走快些",
  "ls.grade.fail": "失手",
  "ls.grade.ok": "顺利",
  "ls.grade.great": "出彩！",
  "ls.pending": "还没上",
  "ls.paused": "时间停着。",
  "ls.weekend": "周末余下的日子，过完就是小结。",
  // U06F3 第四趟：“结束这一周”之后自动走完余下的日子，停在小结；小结上一键进下一周并开课
  "wk.rest": "这一周过完了，余下的日子走完就看小结（{d}/{n} 天）",
  "wk.remind": "这周提醒",
  "sum.look": "先看课表",
  "sum.lookTip": "进下一周，停在周初：先改课表，再开课",
  "sum.goTip": "进下一周；没有要你定的事就直接开课（回车）",

  // —— 地图 ——
  "map.label": "城里各处",
  "map.hintFree": "点一个地方进去看看。看看、寒暄、买东西不花点。",
  "map.hintPlan": "周末才能在城里做事；现在可以先去看看谁在哪儿。",
  "map.people": "{n} 人",
  "map.shop": "能买东西",
  "map.job": "有活干",
  "map.closed": "去不了",
  "map.end": "结束这一周",
  "map.endHint": "剩下的 {n} 点就作废了",
  "map.useTpl": "照上周末做",
  "map.useTplHint": "按记下的顺序做：{list}",
  "map.useTplNone": "还没记下周末的安排",
  "map.saveTpl": "记下这周末",
  "map.saveTplHint": "把这周花了点的事按顺序记下来，下周一键照做",
  "map.halt": "照上周末做到第 {n} 步停下：{why}",
  "map.noPoints": "行动点用完了——还可以四处看看。",
  "map.think": "这周值得想的",

  // —— “这周值得想的”几条（地图下方，点了进那个地方） ——
  "hint.markerLast": "{what}，这周不看就过了",
  "hint.markerKey": "{what}要紧，还剩 {n} 周",
  "hint.tired": "疲劳 {n}，歇一歇？",
  "hint.jobUp": "{job}再干 {n} 次就升一级",
  "hint.duty": "家业还没做",
  "hint.gift": "手上有东西可以送人",

  // —— 地点 ——
  "pl.back": "回地图",
  "pl.backKey": "Esc",
  "pl.people": "在这里的人",
  "pl.nobody": "这里现在没有熟人。",
  "pl.greet": "打招呼",
  "pl.greeted": "打过招呼了",
  "pl.greetFree": "寒暄不花点，每人每周一次",
  "pl.todo": "这里能做的事",
  "pl.nothing": "这里这周没什么可做的，看看就好。",
  "pl.log": "这周在这里",
  "pl.logEmpty": "还什么都没做。",
  "pl.cost": "{n} 点",
  "pl.left": "行动点还剩 {n}",
  "pl.weekendOnly": "周末才能做",
  "pl.success": "成 {n}%",
  "pl.shop": "货架",
  "pl.buy": "买",
  "pl.have": "有 {n}",
  "pl.short": "差 {n} 文",
  "pl.noLoc": "这座城还不认得",
  "pl.price": "{n} 文",
  "pl.markerKey": "要紧",
  "pl.markerLeft": "还剩 {n} 周",
  "pl.markerLast": "这周最后",
  "pl.markerOf": "{who}的事",
  "pl.markerSomeone": "一件事",
  "pl.giftPick": "挑一件送",
  "pl.giftNone": "手上没有能送的东西",
  "pl.giftBack": "换个人",
  "pl.job.level": "{n} 级",
  "pl.job.income": "钱 {lo}–{hi}",
  "pl.job.incomeOne": "钱 {n}",
  "pl.job.fatigue": "疲劳 +{n}",
  "pl.job.progress": "升级 {have}/{need}",
  "pl.job.top": "已到顶",
  "pl.talk.effect": "好感 +{aff} · 心情 +{mood}",
  "pl.talk.marker": "会先说起那件事",
  "pl.rest.effect": "疲劳 −{n}",
  "pl.pray.effect": "疲劳 −{f} · 心情 +{m} · 意志 +{w}",
  "pl.study.effect": "半格课的长进",
  "pl.excursion.effect": "走一段远路，疲劳 +{n}",
  "pl.rumor.effect": "听听这里的人在说什么",
  "pl.marker.effect": "那段事就在这里展开",
  "pl.result.ok": "成",
  "pl.result.fail": "没成",
  "pl.result.none": "没什么变化",

  // —— 行动名（≤ 4 字） ——
  "action.greet": "寒暄",
  "action.job": "打工",
  "action.talk": "深谈",
  "action.gift": "送礼",
  "action.marker": "去看看",
  "action.rest": "休养",
  "action.pray": "参拜",
  "action.self_study": "自修",
  "action.excursion": "远足",
  "action.rumor": "听消息",

  // —— 家业 ——
  "duty.title": "家业",
  "duty.hint": "一周一件，不花点",
  "duty.done": "这周的家业做完了",
  "duty.progress": "{have}/{need}",
  "duty.go": "就做这件",
  "duty.pick": "挑一件",

  // —— 周末小结 ——
  "sum.title": "本周所得",
  "sum.range": "{a} 至 {b}",
  "sum.growth": "长进",
  "sum.noGrowth": "这周没长什么。",
  "sum.money": "钱",
  "sum.fatigue": "疲劳",
  "sum.mood": "心情",
  "sum.people": "人",
  "sum.noPeople": "这周没和谁走近。",
  "sum.lessons": "课 {ok} 格顺利、{fail} 格失手",
  "sum.points": "花了 {n} 点行动",
  "sum.markers": "看了 {n} 件事",
  "sum.next": "下周",
  "sum.nextEmpty": "下周日历上没什么事。",
  "sum.go": "下一周",

  // —— 有事在等 ——
  "story.wait": "有一段事在等你回应。",
  "story.open": "看剧情",
  // HOTFIX1：剧情被“稍后再说”收起时，行动制里时间不走、开课 / 结束这一周 / 下一周都会被拒——底栏一律给出口
  "story.gate": "有一件事等你回应，回应了时间才会走。",
  "story.go": "去回应",
  // U06F3 第三趟：底栏上方“刚完成的年度目标、刚开放的东西”那一条的收起
  "unlocked.close": "知道了",
  "story.goFirst": "先回应那件事",
  "await.other": "有别的事在等你处理（海战、遭遇或来客），处理完时间才会走。",
  "await.phase": "这会儿在等别的事办完；办完了这里会接着往下走。",

  // —— 比赛 ——
  "ct.register": "报名",
  "ct.play": "去比",
  "ct.registered": "报了名",

  // —— 旧档 ——
  "old.save": "这是旧存档，养成照原来的方式走完；新的玩法从新开的局开始。",
  "old.dismiss": "知道了",

  // —— 错误码（契约 4；命令被拒时就地显示，≤ 20 字） ——
  "ub.act.off": "现在不在养成里",
  "ub.act.phase": "现在还不能做这一步",
  "ub.act.story": "先看完眼前的事",
  "ub.act.slots": "课表的格数不对",
  "ub.act.line": "这一阶段没有这门课",
  "ub.act.tier": "这一档还没开",
  "ub.act.with": "一周只能带一次人",
  "ub.act.absent": "那人不在这里",
  "ub.act.monthly_limit": "这个月上够次数了",
  "ub.act.fee": "学费不够",
  "ub.act.template": "这个模板是空的",
  "ub.act.place": "这里现在去不了",
  "ub.act.action": "这里做不了这件事",
  "ub.act.points": "行动点不够",
  "ub.act.greeted": "这周已经打过招呼",
  "ub.act.item": "手上没有能送的东西",
  "ub.act.job": "这里没有这份工",
  "ub.act.marker": "现在还不能去看",
  "ub.act.self_study": "自修只到第 2 档",
  "ub.act.excursion": "那边现在去不了",
  "ub.act.stage_off": "这一部分还没开放",
  "ub.act.duty": "没有这项家业",
  "ub.act.duty_done": "这周的家业做过了",
  "ub.act.shop": "这里不卖这件",
  "ub.act.use_action": "要从课表或地点里做",
  "ub.act.old_save": "新的玩法从新开的局开始",
  "ub.cadence.outing_interval": "两周才能带一次人",
  "insufficient_stock": "手上没有这件",
  "insufficient_cash": "钱不够",
} as const;

export type ActTextKey = keyof typeof ACT_TEXT;

/** 取一条界面字并换掉 {参数}。 */
export function ta(key: ActTextKey, params: Record<string, string | number> = {}): string {
  return ACT_TEXT[key].replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

/**
 * 错误码 → 一句说明；不认得的码返回 null（界面不显示码本身）。
 * U06F2：这只是退路。命令被拒时外壳提示条显示后端 `[reasons]` 的字（texts.toml，另一个任务在写），这里不参与；
 * 只有视图里“灰着的按钮”只带了码（`places[].actions[].reason`、`free.halt.reason`，后端没给字）时才用这张表。
 */
export function reasonText(code: string | null | undefined): string | null {
  if (!code) return null;
  if (Object.prototype.hasOwnProperty.call(ACT_TEXT, code)) return ACT_TEXT[code as ActTextKey];
  // U06F3：K2 新加的码（病中、关键时刻、师事）的退路在 zhOnly.ts
  const k2 = `ub.act.why.${code.replace(/^ub\.act\./, "")}`;
  return k2 in ZH_ONLY ? tz(k2 as ZhOnlyKey) : null;
}

/** 视图给的说明可用就用；是码本身、“（待写）”或空时查退路表（U06F3：真样例里 reason_text 常常就是码）。 */
export function reasonOf(text: string | null | undefined, code: string | null | undefined): string | null {
  if (text && text !== code && text !== "（待写）" && !/^ub\.act\.[\w.]+$/.test(text)) return text;
  return reasonText(code);
}
