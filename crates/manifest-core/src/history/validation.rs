//! 时间线的引用、日期、效果边界和依赖图；加载时拒绝无解的数据。
use super::*;
use crate::{StaticData, defs::EffectKind, events::EventParams};
use std::collections::BTreeSet;

pub fn legal_transition(from: DiploStatus, to: DiploStatus) -> bool {
    use DiploStatus::*;
    matches!((from, to), (Peace, Tension) | (Tension, Peace) | (Tension, War) | (War, Truce) | (Truce, Peace))
}
fn key(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
}
fn date(d: &StaticData, v: WorldDate) -> bool {
    crate::scenario::day_of(d, v).is_ok()
}

/// 同日无依赖者按 key 排序；依赖（含解锁和封闭）必须先于被依赖者。
pub fn order(defs: &HistoryDefs) -> Option<Vec<usize>> {
    let mut remaining: BTreeSet<_> = (0..defs.events.len()).collect();
    let mut done = BTreeSet::new();
    let mut out = Vec::new();
    while !remaining.is_empty() {
        let pick = remaining.iter().copied().filter(|i| {
            let e = &defs.events[*i];
            e.requires.iter().all(|r| done.contains(r.event.as_str()))
                && e.trigger.iter().chain(e.outcome_rules.iter().flat_map(|r| &r.when))
                    .flat_map(Condition::events).all(|event| done.contains(event))
                && defs.events.iter().filter(|parent| parent.outcomes.iter().flat_map(|o| &o.effects).any(|eff| {
                    matches!(eff, Effect::History(HistoryEffect::Unlock { event } | HistoryEffect::Close { event }) if event == &e.key)
                })).all(|parent| done.contains(parent.key.as_str()))
        }).min_by_key(|i| (defs.events[*i].deadline(), &defs.events[*i].key))?;
        remaining.remove(&pick);
        done.insert(defs.events[pick].key.as_str());
        out.push(pick);
    }
    Some(out)
}

pub fn validate(d: &StaticData) -> Vec<String> {
    let mut errors = campaign::validate(d);
    errors.extend(ideas::validate(d));
    errors.extend(contacts::validate(d));
    let mut keys = BTreeSet::new();
    let port = |k: &str| d.find_loc(k).is_some_and(|l| d.loc(l).is_port());
    let mut ports = BTreeSet::new();
    for p in &d.history.ports {
        if !port(&p.port)
            || !ports.insert(&p.port)
            || p.state == PortStatus::Sacked
            || p.faction.as_ref().is_some_and(|f| d.find_faction(f).is_none())
        {
            errors.push(format!("{}：初始港口状态或归属无效", p.port));
        }
    }
    for e in &d.history.events {
        errors.extend(contribution::validate_levers(d, e));
        let mut check = |ok: bool, message: &str| {
            if !ok {
                errors.push(format!("{}：{message}", e.key));
            }
        };
        check(e.ripple_budget <= crate::summary::ripple::MAX_BUDGET, "涟漪预算超出上限");
        check(key(&e.key) && keys.insert(&e.key), "事件key重复或无效");
        check(
            !e.title.trim().is_empty() && e.title.chars().count() <= 100 && e.summary.chars().count() <= 1000,
            "文字为空或过长",
        );
        check(e.date.is_some() != e.latest.is_some() && date(d, e.deadline()), "必须且只能提供date或latest");
        check(e.latest.is_none() || !e.trigger.is_empty(), "触发式事件必须提供trigger");
        check(
            e.window.is_none_or(|w| date(d, w[0]) && date(d, w[1]) && w[0] <= w[1] && w[1] <= e.deadline()),
            "窗口日期无效",
        );
        check(date(d, e.history.date) && e.outcomes.iter().any(|o| o.key == e.history.outcome), "史实日期或结果无效");
        check(e.balance.abs_diff(0) <= 100_000 && (0..=100).contains(&e.roll), "天平或随机幅度越界");
        check(e.sides.len() == 2 && e.sides[0].key != e.sides[1].key, "必须有两个不同的阵营");
        for s in &e.sides {
            check(
                key(&s.key)
                    && !s.name.trim().is_empty()
                    && d.find_faction(&s.faction).is_some()
                    && s.port.as_ref().is_none_or(|p| port(p)),
                "阵营key、势力或港口无效",
            );
        }
        for c in &e.trigger {
            check(conditions::valid(d, c), "触发条件无效");
        }
        if !e.outcome_rules.is_empty() {
            // 条件终局不允许绕过某场战斗的多线、朝议或随机门槛。
            check(
                e.campaign.is_some()
                    && e.levers.is_empty()
                    && e.need.is_none()
                    && e.court.is_none()
                    && e.counter.is_none()
                    && e.roll == 0,
                "条件终局不能同时配置战斗杠杆、门槛或随机数",
            );
            let mut ruled = BTreeSet::new();
            check(e.outcome_rules.len() + 1 == e.outcomes.len(), "每个非缺省终局必须有一条规则");
            for rule in &e.outcome_rules {
                check(
                    ruled.insert(&rule.outcome)
                        && e.outcomes.iter().any(|o| o.key == rule.outcome && !o.default)
                        && !rule.when.is_empty()
                        && rule.when.len() <= 64
                        && rule.when.iter().all(|c| conditions::valid(d, c)),
                    "终局条件或结果无效",
                );
            }
        }
        for r in &e.requires {
            check(
                d.history.event(&r.event).is_some_and(|parent| {
                    parent.key != e.key
                        && parent.deadline() <= e.deadline()
                        && r.outcome.as_ref().is_none_or(|k| parent.outcomes.iter().any(|o| &o.key == k))
                }),
                "依赖事件、结果或日期无效",
            );
        }
        check(e.outcomes.iter().filter(|o| o.default).count() == 1, "必须有一个缺省结果");
        let mut outcomes = BTreeSet::new();
        let mut ranges = Vec::new();
        for o in &e.outcomes {
            check(key(&o.key) && outcomes.insert(&o.key), "结果key重复或无效");
            check(o.news.chars().count() <= 1000 && o.chronicle.chars().count() <= 1000, "结果文字过长");
            if let Some(range) = score_range(&o.when) {
                ranges.push(range);
            } else {
                check(false, "结果when无效");
            }
            for effect in &o.effects {
                check(effect_error(d, effect).is_none(), "效果引用或边界无效");
            }
        }
        ranges.sort();
        check(
            ranges.first().is_some_and(|r| r.0 == i64::MIN)
                && ranges.last().is_some_and(|r| r.1 == i64::MAX)
                && ranges.windows(2).all(|v| v[0].1.checked_add(1) == Some(v[1].0)),
            "结果区间必须完整覆盖且不能重叠",
        );
    }
    if order(&d.history).is_none() {
        errors.push("时间线依赖或解锁关系成环".into());
    }
    errors
}

pub(crate) fn effect_error(d: &StaticData, e: &Effect) -> Option<String> {
    let ok = match e {
        Effect::History(HistoryEffect::Var { campaign, var, add }) => {
            add.abs_diff(0) <= 100 && d.history.campaign(campaign).is_some_and(|c| c.vars.iter().any(|v| &v.key == var))
        }
        Effect::Story(effect) => {
            story2::validation::effect_error(d, effect).is_none()
                && match effect {
                    story2::Effect::Transform { .. } => false,
                    story2::Effect::World { effects, .. } => {
                        effects.iter().all(|e| composed_params(d, e.effect, &e.params))
                    }
                    _ => true,
                }
        }
        Effect::History(HistoryEffect::PortOwner { port, faction }) => {
            d.find_loc(port).is_some_and(|l| d.loc(l).is_port()) && d.find_faction(faction).is_some()
        }
        Effect::History(HistoryEffect::PortState { port, state, days }) => {
            d.find_loc(port).is_some_and(|l| d.loc(l).is_port())
                && if *state == PortStatus::Sacked {
                    days.is_some_and(|d| (1..=3650).contains(&d))
                } else {
                    days.is_none()
                }
        }
        Effect::History(HistoryEffect::Unlock { event } | HistoryEffect::Close { event }) => {
            d.history.event(event).is_some()
        }
        Effect::History(HistoryEffect::Diplomacy { a, b, from, to }) => {
            a != b && d.find_faction(a).is_some() && d.find_faction(b).is_some() && legal_transition(*from, *to)
        }
    };
    (!ok).then(|| format!("历史效果无效：{e:?}"))
}

fn composed_params(d: &StaticData, kind: EffectKind, p: &EventParams) -> bool {
    let Some(b) = d.composed.bounds(kind) else { return false };
    p.loc.is_none_or(|id| d.locations.get(id.idx()).is_some())
        && p.good.is_none_or(|id| d.goods.get(id.idx()).is_some())
        && p.region.is_none_or(|id| d.regions.get(id.idx()).is_some())
        && [p.faction_a, p.faction_b].iter().all(|f| f.is_none_or(|id| d.factions.get(id.idx()).is_some()))
        && p.discovery.is_none_or(|id| d.discoveries.get(id.idx()).is_some())
        && p.mult.is_some() == b.mult.is_some()
        && p.mult.zip(b.mult).is_none_or(|(v, (lo, hi))| lo <= v && v <= hi && v != crate::Fx::ONE)
        && p.days.is_some() == b.days.is_some()
        && p.days.zip(b.days).is_none_or(|(v, (lo, hi))| lo <= v && v <= hi)
        && p.delta.is_some() == b.delta.is_some()
        && p.delta.zip(b.delta).is_none_or(|(v, (lo, hi))| lo <= v && v <= hi && v != 0)
        && (!kind.needs_loc() || p.loc.is_some())
        && (!kind.needs_good() || p.good.is_some())
        && (!kind.needs_region() || p.region.is_some())
        && (!kind.needs_faction_a() || p.faction_a.is_some())
        && (!kind.needs_faction_b() || p.faction_b.is_some())
}
