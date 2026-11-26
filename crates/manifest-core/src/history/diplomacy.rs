//! 情报原件绑定承运舰队；谈判须实际求见，条款与泄密均由内核裁定。
use super::{contribution::history_key, *};
use crate::{
    World,
    captain::AttrHook,
    error::CommandError,
    rng::{Domain, Rng},
};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Shipment {
    pub fleet: FleetId,
    pub item: String,
    pub taken: u32,
    pub from: LocId,
    pub delivered: Option<u32>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DiplomaticAttempt {
    pub day: u32,
    pub term: Option<String>,
    pub leaked: bool,
    pub truthful: bool,
}

pub(super) fn apply(
    w: &mut World,
    owner: OwnerId,
    e: &EventDef,
    l: &LeverDef,
    payload: &Payload,
) -> Result<(), CommandError> {
    let port = l.port.as_ref().and_then(|p| w.defs.find_loc(p)).ok_or_else(|| blocked("交付地点不存在"))?;
    if !w.location_open(port) {
        return Err(blocked("交付地点尚未开放"));
    }
    if l.deadline.is_some_and(|date| w.cast_date() > date) {
        return Err(blocked("情报或谈判已经过期"));
    }
    let previous = w.state.history.events.get(&e.key).and_then(|s| s.contributions.get(&l.key));
    if previous.is_some_and(|c| c.diplomacy.contains_key(&owner)) {
        return Err(blocked("本次交涉已经裁定，不能再次尝试"));
    }
    match (l.kind, payload) {
        (LeverKind::Intel, Payload::Commit {}) => {
            let shipment = previous.and_then(|c| c.shipments.get(&owner)).cloned();
            if let Some(shipment) = shipment {
                let fleet = w.fleet(shipment.fleet)?;
                if fleet.owner != owner {
                    return Err(CommandError::NotOwner);
                }
                if fleet.docked_at() != Some(port) {
                    return Err(CommandError::WrongLocation);
                }
                prerequisites(w, owner, e, l, false)?;
                adjudicate(w, owner, e, l, None)?;
                let day = w.day();
                if let Some(s) = w.contribution_mut(e, l).shipments.get_mut(&owner) {
                    s.delivered = Some(day);
                }
                Ok(())
            } else {
                let from =
                    l.from.as_ref().and_then(|p| w.defs.find_loc(p)).ok_or_else(|| blocked("情报出发地不存在"))?;
                if !w.location_open(from) {
                    return Err(blocked("情报出发地尚未开放"));
                }
                let fleet = w
                    .fleets_of(owner)
                    .find(|f| f.docked_at() == Some(from))
                    .map(|f| f.id)
                    .ok_or(CommandError::WrongLocation)?;
                let item = l.item.as_ref().ok_or_else(|| blocked("缺少情报原件定义"))?;
                if w.item_available(owner, item) < 1 {
                    return Err(blocked("没有可以装船的情报原件"));
                }
                if l.cost > 0 {
                    super::material::pay(w, owner, e, l, l.cost)?;
                }
                let taken = w.day();
                w.take_item(owner, item, 1);
                w.contribution_mut(e, l)
                    .shipments
                    .insert(owner, Shipment { fleet, item: item.clone(), taken, from, delivered: None });
                Ok(())
            }
        }
        (LeverKind::Negotiate, Payload::Negotiate { term }) => {
            if !l.terms.contains(term) {
                return Err(blocked("条款不在允许的集合中"));
            }
            prerequisites(w, owner, e, l, true)?;
            if l.cost > 0 {
                super::material::pay(w, owner, e, l, l.cost)?;
            }
            adjudicate(w, owner, e, l, Some(term.clone()))
        }
        (LeverKind::Bribe, Payload::Commit {}) => {
            prerequisites(w, owner, e, l, true)?;
            super::material::pay(w, owner, e, l, l.cost)?;
            adjudicate(w, owner, e, l, None)
        }
        _ => Err(blocked("情报或交涉不接受这个payload")),
    }
}

fn prerequisites(w: &World, owner: OwnerId, e: &EventDef, l: &LeverDef, audience: bool) -> Result<(), CommandError> {
    if !w.history_conditions_for(owner, e, &l.requires) {
        return Err(blocked("条款的条件尚未满足"));
    }
    if audience || l.with.is_some() {
        let person = l.with.as_ref().ok_or_else(|| blocked("交涉没有指定人物"))?;
        w.can_history_audience(owner, person)?;
        if !w.history_audience_today(owner, person) {
            return Err(blocked("请先求见交涉人物"));
        }
        if w.person_place(person).is_none_or(|p| l.port.as_ref().is_none_or(|key| w.defs.loc(p.loc).key != *key)) {
            return Err(CommandError::WrongLocation);
        }
    }
    for side in &e.sides {
        let faction = w.defs.find_faction(&side.faction).ok_or_else(|| blocked("交涉势力不存在"))?;
        let need = l.reputation.get(&side.faction).copied().unwrap_or(0);
        if w.reputation(owner, faction) < need {
            return Err(blocked("一方的声望不足"));
        }
    }
    for (faction, need) in &l.reputation {
        let faction = w.defs.find_faction(faction).ok_or_else(|| blocked("交涉势力不存在"))?;
        if w.reputation(owner, faction) < *need {
            return Err(blocked("交涉所需声望不足"));
        }
    }
    if let Some(lang) = &l.language {
        let knows =
            w.knows_language(owner, lang) || w.defs.mates.iter().any(|m| w.interpreter_knows(owner, &m.key, lang));
        if !knows {
            return Err(blocked("需要掌握对方语言或带通事同行"));
        }
    }
    if let Some(introducer) = &l.introducer
        && (!w.person_alive(introducer) || w.history_affinity(owner, introducer).is_none_or(|a| a < l.affinity))
    {
        return Err(blocked("尚未得到引荐人的支持"));
    }
    Ok(())
}

fn adjudicate(
    w: &mut World,
    owner: OwnerId,
    e: &EventDef,
    l: &LeverDef,
    term: Option<String>,
) -> Result<(), CommandError> {
    let key = history_key(&format!("{}:{}:{owner:?}", e.key, l.key));
    let mut leak = Rng::derive(w.state.seed, w.day(), Domain::History, key, 0x100);
    let leak_bp = (l.leak * 100 - w.attr_hook(owner, AttrHook::IntelSecrecy)).clamp(0, 10_000);
    let leaked = leak.chance_bp(leak_bp);
    let mut truth = Rng::derive(w.state.seed, w.day(), Domain::History, key, 0x101);
    let reliability = (l.reliability * 100 + w.attr_hook(owner, AttrHook::IntelReliability)).clamp(0, 10_000);
    let truthful = l.kind != LeverKind::Intel || truth.chance_bp(reliability);
    let day = w.day();
    let c = w.contribution_mut(e, l);
    c.attempts = c.attempts.checked_add(1).ok_or(CommandError::InvalidQuantity)?;
    c.completed.insert(owner);
    c.diplomacy.insert(owner, DiplomaticAttempt { day, term, leaked, truthful });
    if leaked {
        for effect in &l.leak_effects {
            w.apply_history_effect_for(owner, effect)?;
        }
    } else if !truthful {
        for effect in &l.false_effects {
            w.apply_history_effect_for(owner, effect)?;
        }
    } else {
        let value = l
            .points
            .checked_mul(l.value_per_point)
            .and_then(|v| v.checked_mul(100))
            .ok_or(CommandError::InvalidQuantity)?;
        let value = if l.kind == LeverKind::Negotiate {
            crate::fixed::mul_div(value, 10_000 + w.attr_hook(owner, AttrHook::Negotiate).clamp(0, 10_000), 10_000)
        } else {
            value
        };
        w.add_contribution(owner, e, l, value)?;
    }
    Ok(())
}

pub(super) fn valid_lever(d: &crate::StaticData, l: &LeverDef) -> bool {
    l.points > 0
        && l.deadline.is_none_or(|date| crate::scenario::day_of(d, date).is_ok())
        && (0..=100).contains(&l.leak)
        && (0..=100).contains(&l.reliability)
        && (0..=100).contains(&l.affinity)
        && l.with.as_ref().is_none_or(|p| d.cast.person(p).is_some())
        && l.introducer.as_ref().is_none_or(|p| d.cast.person(p).is_some())
        && l.language.as_ref().is_none_or(|lang| d.story2.skills.contains(lang))
        && l.reputation.iter().all(|(f, v)| d.find_faction(f).is_some() && (-100..=100).contains(v))
        && l.requires.iter().all(|c| conditions::valid(d, c))
        && l.leak_effects.iter().chain(&l.false_effects).all(|e| validation::effect_error(d, e).is_none())
        && match l.kind {
            LeverKind::Intel => {
                l.item.as_ref().is_some_and(|item| d.items.item(item).is_some())
                    && l.from.as_ref().is_some_and(|p| d.find_loc(p).is_some_and(|id| d.loc(id).is_port()))
                    && l.from != l.port
                    && l.deadline.is_some()
                    && l.terms.is_empty()
            }
            LeverKind::Negotiate => {
                l.with.is_some()
                    && l.language.is_some()
                    && !l.terms.is_empty()
                    && l.terms.iter().all(|t| !t.is_empty())
                    && l.terms.iter().collect::<std::collections::BTreeSet<_>>().len() == l.terms.len()
            }
            LeverKind::Bribe => l.with.is_some() && l.cost > 0,
            _ => false,
        }
}

pub(super) fn valid_snapshot(w: &World, e: &EventDef, l: &LeverDef, c: &Contribution) -> bool {
    let diplomatic = matches!(l.kind, LeverKind::Intel | LeverKind::Negotiate | LeverKind::Bribe);
    (!diplomatic
        || (c.attempts as usize == c.diplomacy.len()
            && c.completed.len() == c.diplomacy.len()
            && c.activities.is_empty()
            && c.seized.is_empty()
            && c.owners
                .iter()
                .all(|(owner, value)| *value > 0 && c.diplomacy.get(owner).is_some_and(|a| !a.leaked && a.truthful))))
        && (diplomatic || (c.shipments.is_empty() && c.diplomacy.is_empty()))
        && c.shipments.iter().all(|(owner, s)| {
            l.kind == LeverKind::Intel
                && l.item.as_ref() == Some(&s.item)
                && l.from.as_ref().and_then(|p| w.defs.find_loc(p)) == Some(s.from)
                && w.state.agents.contains_key(owner)
                && s.fleet.0 > 0
                && s.fleet.0 < w.state.next_fleet
                && s.taken <= w.day()
                && s.delivered.is_none_or(|day| s.taken <= day && day <= w.day())
                && s.delivered == c.diplomacy.get(owner).map(|r| r.day)
        })
        && c.diplomacy.iter().all(|(owner, a)| {
            w.state.agents.contains_key(owner)
                && a.day <= w.day()
                && c.completed.contains(owner)
                && l.deadline.is_none_or(|d| crate::scenario::day_of(&w.defs, d).is_ok_and(|day| a.day <= day))
                && (l.kind == LeverKind::Negotiate) == a.term.is_some()
                && a.term.as_ref().is_none_or(|term| l.terms.contains(term))
                && (l.kind != LeverKind::Intel || c.shipments.contains_key(owner))
                && w.defs.history.event(&e.key).is_some()
        })
}
