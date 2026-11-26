//! 考试门槛的结构化进度；保留 all / any，前端自行组织文字。
use super::*;

fn number(kind: &str, key: &str, current: i64, min: Option<i64>, max: Option<i64>) -> Value {
    json!({"kind":kind,"key":key,"current":current,"min":min,"max":max,
        "missing":min.map_or(0,|v|v.saturating_sub(current).max(0)),
        "excess":max.map_or(0,|v|current.saturating_sub(v).max(0)),
        "met":min.is_none_or(|v|current>=v)&&max.is_none_or(|v|current<=v)})
}

fn requirements(w: &World, r: &Requirements) -> Value {
    let s = w.state.upbringing.as_ref();
    let mut checks = Vec::new();
    if let Some(key) = &r.attr {
        checks.push(number("attr", key, w.upbringing_projected(key), r.min, r.max));
    }
    if let Some(rating) = &r.rating {
        let min = match rating {
            RatingRequirement::Key(_) => r.min,
            RatingRequirement::Threshold(t) => Some(r.min.unwrap_or(t.min).max(t.min)),
        };
        checks.push(number("rating", rating.key(), w.upbringing_rating(rating.key()), min, r.max));
    }
    if let Some(key) = &r.skill {
        checks.push(number("skill", key, i64::from(w.upbringing_skill_level(key)), Some(i64::from(r.level)), None));
    }
    if let Some(key) = &r.activity {
        let current = s.and_then(|s| s.activity_counts.get(key)).copied().unwrap_or(0);
        // 按周（U05）次数按格重累计；只要求一次的，有进展（含进位余数）就算做过，与内核的判定一致。
        let current = if w.upbringing_activity_done(key, r.times) { current.max(r.times) } else { current };
        checks.push(number("activity", key, i64::from(current), Some(i64::from(r.times)), None));
    }
    if let Some(year) = r.year {
        checks.push(number("year", "", i64::from(w.upbringing_school_year()), Some(i64::from(year)), None));
    }
    if let Some(lessons) = r.lessons {
        let is_lesson = |key: &str| w.defs.upbringing.activity(key).is_some_and(|a| a.kind == ActivityKind::Lesson);
        let current = s.map_or(0, |s| {
            if s.journal.is_empty() {
                s.activity_counts.iter().filter(|(k, _)| is_lesson(k)).map(|(_, n)| i64::from(*n)).sum()
            } else {
                // 按周的记录按格重折成标准格（按旬时每条记录就是一格）。
                w.upbringing_lessons_done()
            }
        });
        checks.push(number("lessons", "", current, Some(i64::from(lessons)), None));
    }
    if let Some(slots) = r.completed_slots {
        checks.push(number(
            "completed_slots",
            "",
            if s.is_some() { w.upbringing_completed_slots() } else { 0 },
            Some(i64::from(slots)),
            None,
        ));
    }
    if let Some(count) = r.languages_at_level {
        let current = w
            .defs
            .story2
            .skills
            .iter()
            .filter(|k| k.starts_with("lang_") && w.upbringing_skill_level(k) >= r.level)
            .count() as i64;
        let mut value = number("languages", "", current, Some(i64::from(count)), None);
        value["level"] = json!(r.level);
        checks.push(value);
    }
    if r.fame_min.is_some() || r.fame_max.is_some() {
        checks.push(number("fame", "", s.map_or(0, |s| s.fame), r.fame_min, r.fame_max));
    }
    if let Some(flag) = &r.flag {
        let current = w.upbringing_flag(flag);
        let required = r.flag_value.unwrap_or(true);
        checks.push(json!({"kind":"flag","key":flag,"current":current,"required":required,"met":current==required}));
    }
    if let Some(contest) = &r.contest {
        let met = s.is_some_and(|s| s.contest_results.values().any(|v| &v.contest == contest));
        checks.push(json!({"kind":"contest","key":contest,"current":met,"required":true,"met":met}));
    }
    json!({"met":w.upbringing_requirements(r),"checks":checks,
        "all":r.all.iter().map(|r|requirements(w,r)).collect::<Vec<_>>(),
        "any":r.any.iter().map(|r|requirements(w,r)).collect::<Vec<_>>()})
}

pub(super) fn exam(w: &World, e: &ExamDef) -> Value {
    let s = w.state.upbringing.as_ref();
    let record = s.and_then(|s| s.exams.get(&e.key));
    let academy = w.upbringing_academy().map(|a| a.key.as_str());
    let cooldown = record
        .and_then(|r| r.last_day)
        .map_or(0, |day| e.retake.cooldown_days.saturating_sub(w.day().saturating_sub(day)));
    let remediation = record.map_or_else(Vec::new, |r| {
        e.retake
            .remediation
            .iter()
            .map(|key| {
                // 按周（U05）：考试时记下的是八分之一刻度的进度，补习“有进展”就算数，这里也按八分之一显示与判定。
                let mark = s.and_then(|s| s.weekly.remediation.get(&weekly::remediation_key(&e.key, key)));
                let mut v = match mark {
                    Some(mark) => number("activity", key, w.upbringing_activity_eighths(key), Some(mark + 1), None),
                    None => number(
                        "activity",
                        key,
                        s.and_then(|s| s.activity_counts.get(key)).copied().map_or(0, i64::from),
                        Some(i64::from(r.remediation.get(key).copied().unwrap_or(0)) + 1),
                        None,
                    ),
                };
                if mark.is_some() {
                    v["unit"] = json!("eighths");
                }
                v
            })
            .collect::<Vec<_>>()
    });
    let fee = record.map_or(0, |_| e.retake.fee);
    let rating_total = e.rating_check.as_ref().map(|r| {
        let mut value =
            number("rating_total", "", r.ratings.iter().map(|k| w.upbringing_rating(k)).sum(), Some(r.min_total), None);
        value["ratings"] = json!(r.ratings);
        value
    });
    let attempts = record.map_or(0, |r| r.attempts);
    // 设了考期（U02 工作包 4）时补考也要在考期内；否则沿用旧规则：只有初考看日期。
    let sessions = w.defs.upbringing.rules.exam_session_days > 0;
    let date_met = e.dates.is_empty() || (record.is_some() && !sessions) || w.exam_in_session(e);
    json!({"met":w.exam_available(e).is_ok(),"requirements":requirements(w,&e.requirements),
        "rating_total":rating_total,
        "academy":{"current":academy,"required":e.academy,"met":e.academy.as_deref().is_none_or(|key|academy==Some(key))},
        "phase_met":w.upbringing_active()&&s.is_some_and(|s|matches!(s.phase,Phase::Plan|Phase::Running)),
        "date":{"current":w.cast_date(),"allowed":e.dates,"met":date_met},
        "cooldown_days":cooldown,"attempts":attempts,"attempts_remaining":e.retake.max_attempts.saturating_sub(attempts),
        "passed":record.is_some_and(|r|r.passed),
        "remediation_met":remediation.is_empty()||remediation.iter().any(|r|r["met"]==true),"remediation":remediation,
        "fee":number("cash","",w.agent(OwnerId::Player).map_or(0,|a|a.cash),Some(fee),None)})
}
