//! 活动卡、结算与自动排期共用内核的费用、门槛和收益区间。
use super::*;
pub(super) fn skill_name(ctx: Ctx<'_>, key: &str) -> String {
    ctx.names.story2.skill_labels.iter().find(|s| s.key == key).map_or_else(|| key.into(), |s| s.name.clone())
}
pub(super) fn activity(ctx: Ctx<'_>, w: &World, a: &ActivityDef) -> Value {
    let display = ctx.names.upbringing.activity(&a.key).unwrap_or(a);
    let enabled = w.upbringing_activity_available(a, w.cast_date());
    let tier = a.tier.as_ref().map(|t| {
        json!({"level":t.level,"name":display.tier.as_ref().map_or(t.name.as_str(),|t|t.name.as_str()),
        "progress":w.upbringing_job_progress(&t.group),"next":t.next})
    });
    let income = a.income.bounds();
    let risk = w.upbringing_risk(a);
    let income = if risk == 0 {
        income
    } else if risk == 10000 {
        [income[0] * a.failure.income_pct / 100, income[1] * a.failure.income_pct / 100]
    } else {
        [income[0] * a.failure.income_pct / 100, income[1]]
    };
    let income = if w.circulation_on() { [0, income[1]] } else { income };
    let mentor = w.upbringing_mentor(a).map(|key| {
        json!({"key":key,"name":ctx.names.cast.person(key).map(|p|p.name.as_str()).unwrap_or(key),
        "present":w.person_place(key).is_some_and(|p|Some(p.loc)==w.upbringing_location())})
    });
    // U05 按周：一格只占格重（八分之几个标准格）。卡片上的数是单格取整值（费用取上界，与能不能排的判定一致），
    // `eighths` 给精确值（八分之一为单位），前端把本周各格加起来再除以 8 当“本周预计”。按旬时格重是 8，数与原来相同。
    let weight = w.upbringing_weight(a, w.cast_date());
    let relief = w.upbringing_fatigue_relief_bp(a);
    let fatigue = if a.fatigue > 0 && relief > 0 { a.fatigue * (10_000 - relief) / 10_000 } else { a.fatigue };
    let mood = w.upbringing_activity_mood(a);
    let gains = a.gains.keys().map(|key| (key, w.upbringing_gain_range(a, key))).collect::<Vec<_>>();
    let round = |v: i64| weekly::rounded(v, weight);
    let eighths = json!({"cost":w.upbringing_activity_cost(a)*weight,"income":[income[0]*weight,income[1]*weight],
        "fatigue":fatigue*weight,"mood":mood*weight,
        "gains":gains.iter().map(|(key,r)|json!({"attr":key,"range":[r[0]*weight,r[1]*weight]})).collect::<Vec<_>>()});
    json!({"key":a.key,"name":display.name,"desc":display.description,"kind":a.kind,"scene":a.scene,
        "cost":w.upbringing_slot_cost(a,w.cast_date()),"income":[round(income[0]),round(income[1])],"fatigue":round(fatigue),"mood":round(mood),
        "weight":weight,"eighths":eighths,
        "gains":gains.iter().map(|(key,r)|json!({"attr":key,"range":[round(r[0]),round(r[1])]})).collect::<Vec<_>>(),
        "skills":a.skills.iter().map(|s|json!({"skill":s.skill,"name":skill_name(ctx,&s.skill),"xp":round(s.xp)})).collect::<Vec<_>>(),
        "mentor":mentor,"companions":if a.needs.contains(&Need::Companion){w.upbringing_companions().keys().map(|key|json!({"key":key,"name":ctx.names.cast.person(key).map_or(key.as_str(),|p|p.name.as_str())})).collect::<Vec<_>>()}else{Vec::new()},"tier":tier,"risk":risk,"needs":a.needs,"enabled":enabled.is_ok(),
        "blocked_code":enabled.as_ref().err().map(|_|"upbringing.activity_blocked"),"blocked_reason":enabled.err().map(|e|ctx.error(&e)),
        "tags":a.tags,"new":w.state.upbringing.as_ref().is_some_and(|s|!s.activity_counts.contains_key(&a.key))})
}
pub(super) fn result(ctx: Ctx<'_>, r: &SlotResult) -> Value {
    let title = if r.activities.is_empty() {
        r.title.clone()
    } else {
        r.activities
            .iter()
            .map(|k| ctx.names.upbringing.activity(k).map_or(k.as_str(), |a| a.name.as_str()))
            .collect::<Vec<_>>()
            .join(" / ")
    };
    json!({"index":r.index,"title":title,"scene":r.scene,"success":r.success,
        "growth":r.growth.iter().map(|(attr,delta)|json!({"attr":attr,"delta":delta})).collect::<Vec<_>>(),
        "skills":r.skills.iter().map(|(skill,xp)|json!({"skill":skill,"name":skill_name(ctx,skill),"xp":xp})).collect::<Vec<_>>(),
        "cash":r.cash,"fatigue":r.fatigue,"mood":r.mood,
        "affinity":r.affinity.iter().map(|(person,delta)|json!({"person":person,"name":ctx.names.cast.person(person).map_or(person.as_str(),|p|p.name.as_str()),"delta":delta})).collect::<Vec<_>>(),
        "items":r.items.iter().map(|(key,qty)|json!({"item":key,"name":ctx.names.items.item(key).map_or(key.as_str(),|i|i.name.as_str()),"qty":qty})).collect::<Vec<_>>(),"line":r.line})
}
/// 自动安排的排程逻辑在内核（`World::auto_plan`），这里只包成视图的 JSON。
pub fn auto_plan(w: &World, preset: &str) -> Result<Value, CommandError> {
    w.auto_plan(preset).map(|slots| json!({"slots":slots}))
}
