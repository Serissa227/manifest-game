//! I6 比赛查询投影公开参数；题意计分显式启用后公开逐句分值。
use super::*;
use manifest_core::contests::{ContestDef, occurrence_key};

pub(super) const SCALE: i64 = 1_000_000_000_000;
// 对手在本场的年龄组区间 range（`World::contest_rival_range`，与结算、讲解名次同一个区间）均匀取分，主角有-10..10扰动。同分时各人的随机顺序等可能。
// 固定分数下积分 (低于主角的分数数 + 同分序位) ^ 对手数，再把21种扰动加起来（每种按 SCALE 计，除以 21 × SCALE 才是概率）。
pub(super) fn win_sum(strength: i64, rivals: usize, range: [i64; 2]) -> i64 {
    let [low, high] = range;
    let width = high - low + 1;
    if rivals == 0 {
        return SCALE * 21;
    }
    let power = |numerator: i64| (0..=rivals).fold(SCALE, |p, _| p * numerator / width);
    (-10..=10)
        .map(|jitter| {
            let score = (strength + jitter).clamp(0, 125);
            if score < low {
                0
            } else if score > high {
                SCALE
            } else {
                (power(score - low + 1) - power(score - low)) * width / (rivals as i64 + 1)
            }
        })
        .sum::<i64>()
}
/// 拿第一的概率（百分数，四舍五入）；strength 是结算时的实力分加上小游戏的加分，range 是本场对手的年龄组区间。
pub(super) fn auto_win_pct(strength: i64, rivals: usize, range: [i64; 2]) -> i64 {
    (win_sum(strength, rivals, range) * 100 + SCALE * 21 / 2) / (SCALE * 21)
}
fn name<'a>(ctx: Ctx<'a>, c: &'a ContestDef) -> &'a str {
    ctx.names.upbringing.contests.iter().find(|d| d.key == c.key).map_or(c.name.as_str(), |d| d.name.as_str())
}
pub fn contest(ctx: Ctx<'_>, w: &World, key: &str) -> Result<Value, CommandError> {
    let (c, date) = w.contest_occurrence(key).ok_or_else(|| CommandError::NotFound(key.into()))?;
    if !w.contest_open(c, date) {
        return Err(CommandError::Precondition("比赛尚未开放、地点不符或已经结算".into()));
    }
    let params = match w.contest_params(key)? {
        manifest_core::contests::Params::Match(mut p) => {
            if let (
                manifest_core::contests::Params::Match(base),
                Some(manifest_core::contests::Params::Match(localized)),
            ) = (&c.params, ctx.names.upbringing.contests.iter().find(|d| d.key == c.key).map(|d| &d.params))
            {
                for face in &mut p.faces {
                    if let Some(text) = base.faces.iter().position(|f| f == face).and_then(|i| localized.faces.get(i)) {
                        *face = text.clone();
                    }
                }
            }
            manifest_core::contests::Params::Match(p)
        }
        manifest_core::contests::Params::Poem(p) => ctx
            .names
            .upbringing
            .contests
            .iter()
            .find(|d| d.key == c.key)
            .map_or(manifest_core::contests::Params::Poem(p), |d| d.params.clone()),
        manifest_core::contests::Params::Debate(p) => ctx
            .names
            .upbringing
            .contests
            .iter()
            .find(|d| d.key == c.key)
            .map_or(manifest_core::contests::Params::Debate(p), |d| d.params.clone()),
        manifest_core::contests::Params::Race(p) => ctx
            .names
            .upbringing
            .contests
            .iter()
            .find(|d| d.key == c.key)
            .map_or(manifest_core::contests::Params::Race(p), |d| d.params.clone()),
        manifest_core::contests::Params::Identify(p) => ctx
            .names
            .upbringing
            .contests
            .iter()
            .find(|d| d.key == c.key)
            .map_or(manifest_core::contests::Params::Identify(p), |d| d.params.clone()),
        other => other,
    };

    let mut params = json!(params);
    if c.poem.as_ref().is_some_and(|p| p.score_tags) {
        let points = w.contest_poem_points(c, date);
        params["line_points"] = json!(points);
        params["line_max"] =
            json!(points.iter().map(|line| line.iter().copied().max().unwrap_or(0)).collect::<Vec<_>>());
        params["max_bonus"] = json!(c.scoring.max_bonus);
    }
    let rivals = c
        .rivals
        .iter()
        .filter_map(|key| ctx.names.cast.person(key))
        .map(|p| json!({"key":p.key,"name":p.name,"portrait":p.portrait(w.cast_date())}))
        .collect::<Vec<_>>();
    Ok(json!({"key":key,"name":name(ctx,c),"kind":c.kind,"seed":w.contest_seed(key),
        "params":params,"rivals":rivals,"auto_pct":auto_win_pct(w.contest_strength(c),c.rivals.len(),w.contest_rival_range(c,date)),
        "registered":w.contest_registered(key),"can_register":!w.contest_registered(key),
        "days_left":manifest_core::scenario::day_of(&w.defs,date).unwrap_or(w.day()).saturating_sub(w.day())}))
}
pub(super) fn list(ctx: Ctx<'_>, w: &World) -> Vec<Value> {
    let Some(s) = w.state.upbringing.as_ref() else { return Vec::new() };
    let mut contests = Vec::new();
    for c in &w.defs.upbringing.contests {
        for date in &c.dates {
            if !w.contest_here(c, *date) || !w.contest_scheduled(c, *date) {
                continue;
            }
            let key = occurrence_key(&c.key, *date);
            let result = s.contest_results.get(&key);
            let due = manifest_core::scenario::day_of(&w.defs, *date).unwrap_or(0);
            let notice = if c.registration_required { c.open_days } else { 120 };
            if result.is_none() && (due < w.day() || due > w.day().saturating_add(notice)) {
                continue;
            }
            contests.push(json!({"key":key,"name":name(ctx,c),"kind":c.kind,"date":date,
                "status":if result.is_some()||due<w.day(){"done"}else if w.contest_open(c,*date){"open"}else{"upcoming"},
                "registered":w.contest_registered(&key),"can_register":w.contest_open(c,*date)&&!w.contest_registered(&key),
                "days_left":due.saturating_sub(w.day()),"junior":w.contest_junior(c,*date),"prep":w.contest_preparation(c),"result":result.map(|r|json!({"rank":r.rank,"total":r.total,"text":format!("{} / {}",r.rank,r.total)}))}));
        }
    }
    contests.sort_by(|a, b| {
        a["date"]
            .as_array()
            .map(|v| v.iter().filter_map(Value::as_u64).collect::<Vec<_>>())
            .cmp(&b["date"].as_array().map(|v| v.iter().filter_map(Value::as_u64).collect::<Vec<_>>()))
            .then_with(|| a["key"].as_str().cmp(&b["key"].as_str()))
    });
    contests
}
pub(super) fn calendar(ctx: Ctx<'_>, w: &World) -> Vec<Value> {
    list(ctx, w)
        .into_iter()
        .filter_map(|c| {
            let date = serde_json::from_value(c["date"].clone()).ok()?;
            let due = manifest_core::scenario::day_of(&w.defs, date).ok()?;
            (due >= w.day() && due - w.day() <= 120).then(|| {
                json!({"date":date,"days_left":due-w.day(),"kind":"contest",
            "key":c["key"],"name":c["name"],"heart":false,"note":null,
            "registered":c["registered"],"can_register":c["can_register"]})
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::auto_win_pct;

    #[test]
    fn automatic_win_estimate_accounts_for_opponents_and_ties() {
        assert_eq!(auto_win_pct(5, 2, [35, 100]), 0);
        assert_eq!(auto_win_pct(5, 0, [35, 100]), 100);
        // 一个对手时可手算：1258/1386约为91%；两个对手且45分时3087/91476约为3%。
        assert_eq!(auto_win_pct(95, 1, [35, 100]), 91);
        assert_eq!(auto_win_pct(45, 2, [35, 100]), 3);
        assert!(auto_win_pct(95, 64, [35, 100]) < auto_win_pct(95, 2, [35, 100]));
    }
}
