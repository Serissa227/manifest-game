//! 考试、志向、结业奖励的引用闭包及存档约束。
use super::{Phase, milestones::*};
use crate::items::effects::EffectKind;
use crate::{CoreError, StaticData, World};
use std::collections::BTreeSet;
fn key(s: &str) -> bool {
    !s.is_empty() && s.len() <= 128 && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
}
fn requirements(d: &StaticData, r: &Requirements, depth: usize) -> bool {
    depth < 12
        && r.all.len() + r.any.len() <= 64
        && r.all.iter().chain(&r.any).all(|r| requirements(d, r, depth + 1))
        && r.attr.as_ref().is_none_or(|k| d.captain.attribute_index(k).is_some())
        && r.rating.as_ref().is_none_or(|k| {
            d.captain.ratings.iter().any(|a| a.key == k.key())
                && match k {
                    RatingRequirement::Threshold(t) => (0..=1000).contains(&t.min),
                    _ => true,
                }
        })
        && r.min.into_iter().chain(r.max).all(|v| (0..=1000).contains(&v))
        && r.min.zip(r.max).is_none_or(|(a, b)| a <= b)
        && ((r.min.is_none() && r.max.is_none()) || r.attr.is_some() || r.rating.is_some())
        && r.flag.as_ref().is_none_or(|f| key(f))
        && (r.flag_value.is_none() || r.flag.is_some())
        && r.activity.as_ref().is_none_or(|k| d.upbringing.activity(k).is_some() && r.times > 0)
        && r.skill.as_ref().is_none_or(|k| d.story2.skills.contains(k) && (1..=3).contains(&r.level))
        && r.languages_at_level.is_none_or(|n| (1..=64).contains(&n) && (1..=3).contains(&r.level))
        && r.exam_passed.as_ref().is_none_or(|k| d.upbringing.exams.iter().any(|e| &e.key == k))
        && r.contest.as_ref().is_none_or(|k| d.upbringing.contests.iter().any(|c| &c.key == k))
        && r.aspiration.as_ref().is_none_or(|k| k == "unset" || d.upbringing.paths.iter().any(|p| &p.key == k))
        && r.person.as_ref().is_none_or(|k| d.cast.person(k).is_some() && r.bond_grade.is_some())
        && (r.count_min.is_none() && r.count_max.is_none() || r.bond_grade.is_some())
        && r.count_min.zip(r.count_max).is_none_or(|(a, b)| a <= b)
        && r.fame_min.into_iter().chain(r.fame_max).all(|v| (0..=100).contains(&v))
        && r.cash_max.is_none_or(|n| n >= 0)
}
fn award(d: &StaticData, a: &Award) -> bool {
    a.titles.iter().all(|t| !t.trim().is_empty() && t.len() <= 4096)
        && a.flags.iter().all(|s| key(s))
        && a.skills.iter().all(|(k, v)| d.story2.skills.contains(k) && (0..=10000).contains(v))
        && a.items.iter().all(|(k, v)| d.items.item(k).is_some() && (1..=100).contains(v))
        && a.effects.iter().all(|e| {
            e.value >= 0
                && e.value <= d.rules.items.limit(e.kind).single
                && (e.activity.is_none() || e.kind == EffectKind::ActivityPct)
                && ((e.tag.is_none() && e.culture.is_none()) || e.kind == EffectKind::AffinityPct)
                && (e.spell.is_some() == (e.kind == EffectKind::Spell))
                && (e.region.is_some() == (e.kind == EffectKind::ChartReveal))
                && e.tag.iter().chain(&e.spell).all(|s| key(s))
                && e.activity.as_ref().is_none_or(|k| d.upbringing.activity(k).is_some())
                && e.region.as_ref().is_none_or(|k| d.regions.iter().any(|r| &r.key == k))
                && e.culture.as_ref().is_none_or(|k| d.locations.iter().any(|l| &l.culture == k))
        })
}
fn capital(d: &StaticData, c: &Capital, home: Option<&str>) -> bool {
    super::capital::valid(d, c)
        && (0..=100_000_000).contains(&c.cash)
        && c.ships.len() <= 16
        && c.crew >= 0
        && c.food >= 0
        && c.water >= 0
        && c.ships.iter().all(|k| d.ships.iter().any(|s| &s.key == k && !s.unique))
        && c.at
            .as_deref()
            .or(home)
            .is_none_or(|k| d.locations.iter().any(|l| l.key == k && (c.ships.is_empty() || l.is_port())))
        && c.crew
            <= c.ships.iter().filter_map(|k| d.ships.iter().find(|s| &s.key == k)).map(|s| s.crew_max).sum::<i64>()
        && c.food.saturating_add(c.water).saturating_add(c.cargo.values().fold(0_i64, |n, v| n.saturating_add(*v)))
            <= c.ships.iter().filter_map(|k| d.ships.iter().find(|s| &s.key == k)).map(|s| s.capacity).sum::<i64>()
        && c.cargo.iter().all(|(k, v)| d.goods.iter().any(|g| &g.key == k) && (1..=10000).contains(v))
        && c.regions.iter().all(|k| d.regions.iter().any(|r| &r.key == k))
        && c.items.iter().all(|(k, v)| d.items.item(k).is_some() && (1..=100).contains(v))
        && c.allies.iter().all(|p| d.cast.person(p).is_some())
        && c.mates.iter().all(|p| d.cast.person(p).and_then(|p| p.mate.as_ref()).is_some_and(|m| m.joinable))
}
pub fn validate(d: &StaticData) -> Vec<String> {
    let mut errors = Vec::new();
    let mut keys = BTreeSet::new();
    for e in &d.upbringing.exams {
        let mut check = |ok: bool, msg: &str| {
            if !ok {
                errors.push(format!("{}: {msg}", e.key));
            }
        };
        check(key(&e.key) && keys.insert(&e.key) && !e.name.trim().is_empty(), "考试键或名称无效");
        check(e.academy.as_ref().is_none_or(|k| d.upbringing.academy(k).is_some()), "考试引用未知学院");
        check(
            e.dates.windows(2).all(|p| p[0] < p[1])
                && e.dates.iter().all(|date| crate::scenario::day_of(d, *date).is_ok()),
            "考试日期无效",
        );
        check(requirements(d, &e.requirements, 0), "考试门槛含未知引用或非法数值");
        check(
            (0..=100).contains(&e.check.base)
                && e.check.min >= 5
                && e.check.max <= 95
                && e.check.min <= e.check.max
                && e.check.attrs.iter().all(|(k, v)| d.captain.attribute_index(k).is_some() && (0..=20).contains(v)),
            "考试检定无效",
        );
        check(
            e.rating_check.as_ref().is_none_or(|r| {
                r.check_bonus_divisor > 0
                    && r.min_total >= 0
                    && !r.ratings.is_empty()
                    && r.ratings.iter().all(|k| d.captain.ratings.iter().any(|r| &r.key == k))
            }),
            "综合评价引用或除数无效",
        );
        check(
            (1..=365).contains(&e.retake.cooldown_days)
                && (1..=100).contains(&e.retake.max_attempts)
                && (0..=1_000_000).contains(&e.retake.fee)
                && e.retake.remediation.iter().all(|k| d.upbringing.activity(k).is_some()),
            "补考数值或补习活动引用无效",
        );
        check(award(d, &e.award), "考试奖励无效");
        check(
            e.events
                .iter()
                .all(|k| d.story2.tracks.iter().any(|t| super::activity_validation::event_matches(k, &t.key))),
            "考试事件不存在",
        );
    }
    keys.clear();
    for p in &d.upbringing.paths {
        if !key(&p.key)
            || !keys.insert(&p.key)
            || p.name.trim().is_empty()
            || !requirements(d, &p.reveal, 0)
            || !requirements(d, &p.requirements, 0)
            || !award(d, &p.award)
            || !p
                .events
                .iter()
                .all(|k| d.story2.tracks.iter().any(|t| super::activity_validation::event_matches(k, &t.key)))
            || !capital(d, &p.capital, None)
        {
            errors.push(format!("{}: 志向键、门槛或资本无效", p.key));
        }
    }
    keys.clear();
    for e in &d.upbringing.endings {
        if !key(&e.key)
            || !keys.insert(&e.key)
            || e.title.trim().is_empty()
            || e.text.trim().is_empty()
            || e.family.as_ref().is_some_and(|k| d.upbringing.family(k).is_none())
            || !requirements(d, &e.requirements, 0)
            || !award(d, &e.award)
            || e.weights
                .ratings
                .iter()
                .any(|(key, w)| !d.captain.ratings.iter().any(|r| &r.key == key) || !(0..=1000).contains(w))
            || e.weights
                .aspirations
                .iter()
                .any(|(key, w)| !d.upbringing.paths.iter().any(|p| &p.key == key) || !(0..=10000).contains(w))
            || e.weights.bonds.iter().any(|(key, w)| d.cast.person(key).is_none() || !(0..=1000).contains(w))
            || e.weights.flags.iter().any(|(k, w)| !key(k) || !(0..=10000).contains(w))
        {
            errors.push(format!("{}: 结局键、家庭、门槛、权重或奖励无效", e.key));
        }
    }
    for f in &d.upbringing.families {
        let Some(c) = &f.completion else { continue };
        if !(1..=150).contains(&c.choose_age)
            || c.paths.iter().collect::<BTreeSet<_>>().len() != c.paths.len()
            || c.paths.iter().any(|k| !d.upbringing.paths.iter().any(|p| &p.key == k))
            || !capital(d, &c.capital, Some(&f.home))
        {
            errors.push(format!("{}: 结业志向或资本引用无效", f.key));
        }
        if c.event.iter().chain(&c.family_event).chain(&c.choose_event).any(|k| d.story2.track(k).is_none())
            || c.promise_at.as_ref().is_some_and(|k| {
                !f.places.iter().any(|p| &p.key == k)
                    && !f
                        .stages
                        .iter()
                        .filter_map(|s| s.academy.as_ref().and_then(|k| d.upbringing.academy(k)))
                        .flat_map(|a| &a.places)
                        .any(|p| &p.key == k)
            })
        {
            errors.push(format!("{}: 结业事件或约定地点不存在", f.key));
        }
        if c.family_event.is_some()
            && f.stages
                .iter()
                .rev()
                .find_map(|s| s.academy.as_deref())
                .and_then(|key| d.upbringing.academy(key))
                .and_then(|a| a.graduation.as_ref())
                .is_none_or(|g| g.date > f.graduation || f.stages.first().is_none_or(|s| g.date < s.from))
        {
            errors.push(format!("{}: 家庭告别事件缺少交接前的学院结业日期", f.key));
        }
        if c.friends.iter().any(|f| {
            d.cast.person(&f.person).and_then(|p| p.mate.as_ref()).is_none_or(|m| !m.joinable)
                || !requirements(d, &f.when, 0)
        }) {
            errors.push(format!("{}: 同行者或意愿门槛无效", f.key));
        }
        let g = &c.defaults;
        let cap = |k: &str| {
            d.captain
                .attribute_index(k)
                .map(|i| if d.captain.group(i).is_some_and(|g| g.key == "conduct") { 100 } else { 1000 })
        };
        if g.growth.iter().any(|(k, v)| cap(k).is_none_or(|max| !(0..=max).contains(v)))
            || g.skills.iter().any(|(k, v)| !d.story2.skills.contains(k) || !(0..=10000).contains(v))
            || g.flags.iter().any(|s| !key(s))
            || g.path.as_ref().is_some_and(|p| !c.paths.contains(p))
            || g.exams.iter().any(|k| !d.upbringing.exams.iter().any(|e| &e.key == k))
            || g.affinity.iter().any(|(k, v)| d.cast.person(k).is_none() || !(0..=100).contains(v))
            || g.promise.as_ref().is_some_and(|p| d.cast.person(p).is_none())
        {
            errors.push(format!("{}: 缺省成长含未知引用或越界值", f.key));
        }
    }
    errors
}
impl World {
    pub(crate) fn validate_milestone_snapshot(&self) -> Result<(), CoreError> {
        let Some(s) = &self.state.upbringing else { return Ok(()) };
        if s.exams.values().any(|e| e.attempts == 0 || e.attempts > 100 || e.last_day.is_none_or(|d| d > self.day()))
            || s.graduation.as_ref().is_some_and(|g| g.day > self.day() || g.cash < 0 || s.phase != Phase::Done)
            || (s.phase == Phase::Done && s.graduation.is_none())
        {
            return Err(CoreError::SnapshotMismatch("养成考试或结业记录矛盾".into()));
        }
        Ok(())
    }
}
