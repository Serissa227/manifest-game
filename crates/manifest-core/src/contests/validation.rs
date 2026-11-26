//! 比赛的参数、私有分值和每个奖励引用必须在载入时可判定。
use super::*;
use crate::{CoreError, StaticData, World};
use std::collections::BTreeSet;
pub fn validate(defs: &StaticData) -> Vec<String> {
    let mut errors = super::native::validate(defs);
    let mut keys = BTreeSet::new();
    for c in &defs.upbringing.contests {
        let mut check = |ok: bool, message: &str| {
            if !ok {
                errors.push(format!("{}: {message}", c.key));
            }
        };
        check(
            !c.key.is_empty()
                && c.key.len() <= 128
                && c.key.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
                && keys.insert(&c.key)
                && !c.name.trim().is_empty(),
            "比赛键重复或名称无效",
        );
        check(defs.locations.iter().any(|l| l.key == c.at), "比赛引用未知地点");
        check(c.junior_families.iter().all(|f| defs.upbringing.family(f).is_some()), "少年组家庭不存在");
        check(
            !c.dates.is_empty()
                && c.dates.len() <= 100
                && c.dates.windows(2).all(|d| d[0] < d[1])
                && c.dates.iter().all(|d| crate::scenario::day_of(defs, *d).is_ok())
                && (1..=60).contains(&c.open_days),
            "比赛日期或开放天数无效",
        );
        check(
            defs.captain.attribute_index(&c.check.attr).is_some()
                && (0..=100).contains(&c.check.base)
                && (0..=20).contains(&c.check.coef),
            "比赛属性或系数无效",
        );
        check((c.kind == Kind::Race) == c.scoring.race.is_some(), "只有竞渡可以且必须提供赛道");
        check((c.kind == Kind::Identify) != c.scoring.answers.is_empty(), "只有辨识可以且必须提供答案表");
        check((0..=30).contains(&c.scoring.max_bonus), "小游戏加成越界");
        check(
            match (&c.kind, &c.params) {
                (Kind::Match, Params::Match(p)) => p.validate() && c.scoring.line_points.is_empty(),
                (Kind::Poem, Params::Poem(p)) => p.validate(&c.scoring.line_points),
                (Kind::Identify, Params::Identify(p)) => {
                    p.validate(&c.scoring.answers) && c.scoring.line_points.is_empty()
                }
                (Kind::Debate, Params::Debate(p)) => p.validate() && c.scoring.line_points.is_empty(),
                (Kind::Race, Params::Race(p)) => {
                    c.scoring.race.as_ref().is_some_and(|t| p.validate(t, defs)) && c.scoring.line_points.is_empty()
                }
                (Kind::Rhythm, Params::Rhythm(p)) => p.validate() && c.scoring.line_points.is_empty(),
                _ => false,
            },
            "小游戏参数或私有分值无效",
        );
        check(
            c.rivals.len() <= 64
                && c.rivals.iter().collect::<BTreeSet<_>>().len() == c.rivals.len()
                && c.rivals.iter().all(|p| defs.cast.person(p).is_some()),
            "对手重复或人物不存在",
        );
        check(
            c.prep.activities.iter().all(|k| defs.upbringing.activity(k).is_some())
                && c.prep.items.iter().all(|k| defs.items.item(k).is_some())
                && c.prep.companions.iter().all(|k| defs.cast.person(k).is_some()),
            "准备项引用未知活动、物品或人物",
        );
        check(
            [c.prep.per_practice, c.prep.item_bonus, c.prep.companion_bonus].iter().all(|v| (0..=20).contains(v))
                && (0..=30).contains(&c.prep.cap),
            "准备加成越界",
        );
        let mut ranks = BTreeSet::new();
        for r in &c.rewards {
            check(r.rank > 0 && r.rank <= c.rivals.len() as u32 + 1 && ranks.insert(r.rank), "奖励名次重复或越界");
            check(
                (0..=100).contains(&r.fame)
                    && r.growth
                        .iter()
                        .all(|(k, v)| defs.captain.attribute_index(k).is_some() && (0..=1000).contains(v))
                    && r.items.iter().all(|(k, v)| defs.items.item(k).is_some() && (1..=100).contains(v)),
                "奖励数值或引用无效",
            );
        }
        check(
            c.events.iter().all(|p| {
                defs.story2.tracks.iter().any(|t| crate::upbringing::activity_validation::event_matches(p, &t.key))
            }),
            "比赛事件没有对应轨道",
        );
    }
    errors
}
impl World {
    pub(crate) fn validate_contest_snapshot(&self) -> Result<(), CoreError> {
        if self.state.upbringing.as_ref().is_some_and(|s| {
            s.contest_registrations.iter().any(|key| {
                // 定义删除后保留历史报名，键仍须是规范的实例格式。
                key.len() > 160
                    || !key.rsplit_once(':').is_some_and(|(contest, date)| {
                        !contest.is_empty()
                            && date.split('-').count() == 3
                            && date.split('-').all(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit()))
                    })
            }) || s.contest_results.iter().any(|(key, r)| {
                *key != occurrence_key(&r.contest, r.date)
                    || r.day > self.day()
                    || r.rank == 0
                    || r.total > 65
                    || r.rank > r.total
                    || !crate::scenario::day_of(&self.defs, r.date).is_ok_and(|due| r.day <= due)
                    || !(0..=125).contains(&r.score)
                    || r.game_score.is_some_and(|v| !(0..=100).contains(&v))
                    || r.steers.len() > 32
                    || r.steers
                        .iter()
                        .any(|s| s.minute >= 1440 || s.heading.is_none_or(|h| h >= 360) || s.sail.is_none())
                    || r.steers.windows(2).any(|s| s[0].minute >= s[1].minute)
                    || (!r.steers.is_empty() && (r.game_score.is_none() || r.steers[0].minute != 0))
            })
        }) {
            return Err(CoreError::SnapshotMismatch("比赛结算记录含非法名次、得分或未来日期".into()));
        }
        Ok(())
    }
}
