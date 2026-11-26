//! I6 考试与志向只投影同一套内核门槛，隐藏选项不提前泄露。
use super::*;

pub(super) fn graduation(ctx: Ctx<'_>, w: &World) -> Value {
    let Some(record) = w.state.upbringing.as_ref().and_then(|s| s.graduation.as_ref()) else { return Value::Null };
    let ending = |key: &str| {
        let definition = ctx.names.upbringing.endings.iter().find(|e| e.key == key);
        json!({"key":key,"title":definition.map(|e|&e.title),"text":definition.map(|e|&e.text)})
    };
    // U04：差一点达成的结局带上结局标题与每一项差距的显示名（`:max` 是上限）。
    let near_miss = record
        .near_miss
        .iter()
        .map(|m| {
            let missing = m
                .missing
                .iter()
                .map(|g| {
                    let (key, max) = g.key.strip_suffix(":max").map_or((g.key.as_str(), false), |k| (k, true));
                    json!({"key":g.key,"label":gap_label(ctx,key),"have":g.have,"need":g.need,"max":max})
                })
                .collect::<Vec<_>>();
            json!({"ending":m.ending,"title":ctx.names.upbringing.endings.iter().find(|e|e.key==m.ending).map(|e|&e.title),"missing":missing})
        })
        .collect::<Vec<_>>();
    let mut view = json!({"phase":"done","graduation":record,
        "ending":record.ending.as_deref().map(ending),
        "supplementary":record.supplementary.iter().map(|key|ending(key)).collect::<Vec<_>>(),
        "near_miss":near_miss,"act_review":record.act});
    if let Some(guarantee) = record.act.as_ref().and_then(|act| w.act_capital_guarantee(&act.band)) {
        // 两处都是结业清单的视图副本；作保条款不进入 ActGraduation 存档记录。
        view["graduation"]["act"]["guarantee"] = json!(guarantee);
        view["act_review"]["guarantee"] = json!(guarantee);
    }
    view
}

/// 结局门槛差项的显示名；剧情条件这类说不清的回 null，界面写通用语。
fn gap_label(ctx: Ctx<'_>, key: &str) -> Option<String> {
    let (kind, rest) = key.split_once(':').unwrap_or((key, ""));
    let u = &ctx.names.upbringing;
    match kind {
        "attr" => ctx.names.captain.attributes.iter().find(|a| a.key == rest).map(|a| a.name.clone()),
        "rating" => ctx.names.captain.ratings.iter().find(|r| r.key == rest).map(|r| r.name.clone()),
        "skill" => Some(super::activity::skill_name(ctx, rest)),
        "exam" => u.exams.iter().find(|e| e.key == rest).map(|e| e.name.clone()),
        "activity" => u.activity(rest).map(|a| a.name.clone()),
        "contest" => u.contests.iter().find(|c| c.key == rest).map(|c| c.name.clone()),
        _ => None,
    }
}

fn date(w: &World, day: u32) -> [u32; 3] {
    let d = w.defs.calendar.date_of(day);
    [(w.defs.rules.world.start_year + i64::from(d.year) - 1) as u32, d.month, d.day]
}
fn exam_date(w: &World, e: &ExamDef) -> Option<[u32; 3]> {
    let sessions = w.defs.upbringing.rules.exam_session_days > 0 && !e.dates.is_empty();
    if let Some(r) = w.state.upbringing.as_ref().and_then(|s| s.exams.get(&e.key)) {
        if r.passed || r.attempts >= e.retake.max_attempts {
            return None;
        }
        let ready = r.last_day.map_or(w.day(), |d| d.saturating_add(e.retake.cooldown_days).max(w.day()));
        if !sessions {
            return Some(date(w, ready));
        }
        // 补考：冷却结束后的第一个考期（U02 工作包 4）。
        let days = w.defs.upbringing.rules.exam_session_days;
        return e
            .dates
            .iter()
            .filter_map(|d| manifest_core::scenario::day_of(&w.defs, *d).ok())
            .find(|d| ready < d + days)
            .map(|d| date(w, d.max(ready)));
    }
    if sessions {
        return w.exam_next_session(e).map(|d| date(w, d.max(w.day())));
    }
    e.dates.iter().copied().find(|d| *d >= w.cast_date())
}
fn requirement_text(ctx: Ctx<'_>, r: &Requirements) -> Vec<String> {
    let mut text = r.all.iter().flat_map(|r| requirement_text(ctx, r)).collect::<Vec<_>>();
    if !r.any.is_empty() {
        text.push(r.any.iter().flat_map(|r| requirement_text(ctx, r)).collect::<Vec<_>>().join(" / "));
    }
    if let Some(key) = &r.attr {
        let name = crate::story_log_view::attr(ctx, key);
        text.push(format!(
            "{name} {}{}",
            r.min.map_or(String::new(), |v| format!("≥ {v}")),
            r.max.map_or(String::new(), |v| format!(" ≤ {v}"))
        ));
    }
    if let Some(rating) = &r.rating {
        let name = ctx.names.captain.ratings.iter().find(|r| r.key == rating.key()).map_or(rating.key(), |r| &r.name);
        let min = match rating {
            RatingRequirement::Threshold(t) => t.min,
            _ => r.min.unwrap_or(0),
        };
        text.push(format!("{name} ≥ {min}"));
    }
    if let Some(key) = &r.activity {
        let name = ctx.names.upbringing.activity(key).map_or(key.as_str(), |a| &a.name);
        text.push(format!("{name} × {}", r.times));
    }
    if let Some(key) = &r.skill {
        text.push(format!("{} ≥ {}", super::activity::skill_name(ctx, key), r.level));
    }
    text
}
pub(super) fn exams(ctx: Ctx<'_>, w: &World) -> Vec<Value> {
    w.defs.upbringing.exams.iter().filter(|e|e.academy.as_ref().is_none_or(|key|w.upbringing_family().is_some_and(|f|f.stages.iter().any(|s|s.academy.as_ref()==Some(key))))).map(|e| {
        let display=ctx.names.upbringing.exams.iter().find(|d|d.key==e.key).unwrap_or(e);
        let state=w.state.upbringing.as_ref().and_then(|s|s.exams.get(&e.key));let open=w.exam_available(e).is_ok();
        let mut requirements=requirement_text(ctx,&e.requirements);if !display.description.is_empty(){requirements.push(display.description.clone());}
        let mut v = json!({"key":e.key,"name":display.name,"date":exam_date(w,e),"status":if state.is_some_and(|s|s.passed){"passed"}else if open{"open"}else if state.is_some(){"failed"}else{"locked"},"pass_pct":open.then(||w.exam_pass_pct(e)),"requirements":requirements,"progress":super::exam_progress::exam(w,e)});
        // U02 工作包 4：设了考期的世界给倒计时（离下一个考期开考的天数，在预告天数以内才有；考期中为 0）。
        if w.defs.upbringing.rules.exam_session_days > 0 {
            let done = state.is_some_and(|s| s.passed || s.attempts >= e.retake.max_attempts);
            let left = (!done).then(|| w.exam_next_session(e)).flatten().map(|d| d.saturating_sub(w.day()));
            v["countdown_days"] = json!(left.filter(|d| *d <= w.defs.upbringing.rules.exam_notice_days));
        }
        v
    }).collect()
}
pub(super) fn path(ctx: Ctx<'_>, w: &World) -> Value {
    let completion = w.upbringing_family().and_then(|f| f.completion.as_ref());
    let chosen = w.state.upbringing.as_ref().and_then(|s| s.path.as_ref());
    let choose_on = completion
        .zip(w.state.protagonist.as_ref())
        .map(|(c, i)| [i.born[0].saturating_add(c.choose_age), i.born[1], i.born[2]]);
    let options = completion
        .into_iter()
        .flat_map(|c| &c.paths)
        .filter_map(|key| w.defs.upbringing.paths.iter().find(|p| &p.key == key))
        .filter(|p| w.path_visible(p))
        .map(|p| {
            let d = ctx.names.upbringing.paths.iter().find(|d| d.key == p.key).unwrap_or(p);
            json!({"key":p.key,"name":d.name,"desc":d.description,"hidden":p.hidden,"locked":!w.path_available(p)})
        })
        .collect::<Vec<_>>();
    json!({"choose_on":choose_on,"chosen":chosen,"options":options})
}
pub(super) fn calendar(ctx: Ctx<'_>, w: &World) -> Vec<Value> {
    exams(ctx,w).into_iter().filter(|e|!w.act_running() || w.defs.upbringing.exams.iter().any(|d|Some(d.key.as_str())==e["key"].as_str() && d.academy.is_some())).filter_map(|e|{let d: [u32;3]=serde_json::from_value(e["date"].clone()).ok()?;let day=manifest_core::scenario::day_of(&w.defs,d).ok()?;
        (day>=w.day() && day-w.day()<=w.defs.upbringing.rules.exam_notice_days).then(||json!({"date":d,"days_left":day-w.day(),"kind":"exam","key":e["key"],"name":e["name"],"heart":false,"note":null}))}).collect()
}
