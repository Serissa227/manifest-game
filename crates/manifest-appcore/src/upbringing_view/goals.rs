//! U04 工作包 5：年度目标卡。只投影内核记下的目标进度；目标文字为空时 `text` 为 null，界面回退通用语。
use super::*;
use manifest_core::story2::Effect;

/// 完成后多少天内算“刚完成”（`done_now`），够前端在下一次结算上浮里提示一次。
const DONE_NOW_DAYS: u32 = 10;

fn text_of(ctx: Ctx<'_>, key: &str) -> Option<String> {
    ctx.names.upbringing.annual_goals.iter().find(|g| g.key == key).map(|g| g.text.clone()).filter(|t| !t.is_empty())
}

fn reward(ctx: Ctx<'_>, goal: &str, e: &Effect) -> Value {
    match e {
        Effect::Growth { attr, value } => {
            let name =
                ctx.names.captain.attributes.iter().find(|a| &a.key == attr).map_or(attr.as_str(), |a| a.name.as_str());
            json!({"kind":"growth","key":attr,"label":name,"value":value})
        }
        Effect::Skill { skill, value } => {
            json!({"kind":"skill","key":skill,"label":activity::skill_name(ctx,skill),"value":value})
        }
        Effect::Item { item, qty } => {
            json!({"kind":"item","key":item,"label":ctx.names.items.item(item).map_or(item.as_str(),|i|i.name.as_str()),"value":qty})
        }
        Effect::Memory { memory, .. } => json!({"kind":"memory","key":memory,"label":text_of(ctx,goal),"value":1}),
        _ => json!({"kind":"other"}),
    }
}

pub(super) fn goals(ctx: Ctx<'_>, w: &World) -> Value {
    let Some(s) = w.state.upbringing.as_ref() else { return Value::Null };
    let year = w.cast_date()[0];
    let today = w.day();
    let date = |day: u32| {
        let d = w.defs.calendar.date_of(day);
        [(w.defs.rules.world.start_year + i64::from(d.year) - 1) as u32, d.month, d.day]
    };
    let mut items = Vec::new();
    let mut history = Vec::new();
    let mut done_now = Vec::new();
    for g in w.upbringing_annual_goals() {
        let state = s.goals.get(&g.key);
        let status = match state.map(|st| st.status) {
            Some(GoalStatus::Active) => "active",
            Some(GoalStatus::Done) => "done",
            Some(GoalStatus::Missed) => "missed",
            None if g.year > year => "upcoming",
            None if g.year == year => "active",
            None => "missed",
        };
        if let Some(d) = state.and_then(|st| st.done)
            && today.saturating_sub(d) < DONE_NOW_DAYS
        {
            done_now.push(g.key.clone());
        }
        if g.year != year {
            if g.year < year {
                history.push(json!({"key":g.key,"year":g.year,"text":text_of(ctx,&g.key),"status":status}));
            }
            continue;
        }
        let since = state.map_or(today, |st| st.since);
        let objectives = g
            .objectives
            .iter()
            .map(|o| {
                let p = w.upbringing_goal_progress(o, since);
                json!({"key":p.key,"label":p.label,"have":p.have,"need":p.need,"done":p.done || status == "done"})
            })
            .collect::<Vec<_>>();
        items.push(
            json!({"key":g.key,"year":g.year,"text":text_of(ctx,&g.key),"fallback_code":"upbringing.goal_generic",
            "status":status,"since":date(since),"done_date":state.and_then(|st|st.done).map(date),
            "objectives":objectives,"rewards":g.rewards.iter().map(|e|reward(ctx,&g.key,e)).collect::<Vec<_>>()}),
        );
    }
    json!({"year":year,"items":items,"history":history,"done_now":done_now})
}
