//! 结社定义与存档的闭包校验。
use super::*;
use crate::StaticData;
pub fn key(s: &str) -> bool {
    !s.is_empty() && s.len() <= 128 && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
}
pub fn validate(d: &StaticData) -> Vec<String> {
    let mut errors = Vec::new();
    let mut keys = BTreeSet::new();
    for s in &d.societies.societies {
        if !key(&s.key)
            || !keys.insert(&s.key)
            || s.name.trim().is_empty()
            || s.secrecy > 100
            || s.ranks.is_empty()
            || s.ranks.len() > MAX_RANKS
            || s.seat.as_ref().is_some_and(|p| d.find_loc(p).is_none())
            || s.person.as_ref().is_some_and(|p| d.cast.person(p).is_none())
            || s.active.is_some_and(|[a, b]| a == 0 || a > b)
            || s.allies.iter().chain(&s.enemies).any(|k| k == &s.key || d.societies.society(k).is_none())
            || s.allies.iter().any(|k| s.enemies.contains(k))
        {
            errors.push(format!("{}：结社引用或边界无效", s.key));
        }
        for r in &s.ranks {
            if r.name.trim().is_empty()
                || r.requirement.trim().is_empty()
                || r.reward.trim().is_empty()
                || r.price_pct > 30
                || r.requires.iter().any(|c| crate::story2::validation::condition_error(d, c).is_some())
                || r.trial.as_ref().is_some_and(|t| d.story2.track(t).is_none() || r.trial_text.is_none())
                || r.effects.len() > 16
                || r.effects.iter().any(|e| {
                    crate::story2::validation::effect_error(d, e).is_some()
                        || !matches!(
                            e,
                            Effect::Item { qty: 1..=100, .. }
                                | Effect::LearnSpell { .. }
                                | Effect::Chart { .. }
                                | Effect::Flag { .. }
                                | Effect::StartTrack { .. }
                        )
                })
                || r.safe_houses.iter().any(|p| d.find_loc(p).is_none())
            {
                errors.push(format!("{}：试炼、条件或奖励无效", s.key));
            }
        }
    }
    let mut policies = BTreeSet::new();
    for p in &d.societies.policies {
        if !policies.insert(&p.faction)
            || !d.factions.iter().any(|f| f.key == p.faction)
            || !(1..=100).contains(&p.gain)
            || !(0..=100).contains(&p.decay)
            || !(p.decay..=100).contains(&p.away_decay)
            || !(1..=100).contains(&p.threshold)
            || p.event.as_ref().is_some_and(|t| d.story2.track(t).is_none())
            || p.forbids.societies.iter().any(|s| d.societies.society(s).is_none())
            || p.forbids.ideas.iter().any(|s| d.ideas.idea(s).is_none())
        {
            errors.push(format!("{}：嫌疑政策无效", p.faction));
        }
    }
    errors
}
impl World {
    pub(crate) fn validate_societies_snapshot(&self) -> Result<(), CoreError> {
        let s = &self.state.societies;
        let valid = (self.defs.societies.is_empty() && s.is_empty())
            || (!self.defs.societies.is_empty()
                && s.last_day.is_none_or(|d| d <= self.day())
                && s.met.iter().all(|k| self.defs.societies.society(k).is_some())
                && s.members.iter().all(|(k, m)| {
                    self.defs.societies.society(k).is_some_and(|d| {
                        m.rank as usize <= d.ranks.len()
                            && m.joined <= self.day()
                            && m.rewarded == (1..=m.rank).collect()
                    })
                })
                && s.relations
                    .iter()
                    .all(|(k, v)| self.defs.societies.society(k).is_some() && (-100..=100).contains(v))
                && s.suspicion.iter().all(|(f, v)| {
                    self.defs
                        .factions
                        .get(f.idx())
                        .is_some_and(|f| self.defs.societies.policies.iter().any(|p| p.faction == f.key))
                        && (0..=100).contains(v)
                })
                && s.incidents.iter().all(|f| s.suspicion.contains_key(f)));
        if valid { Ok(()) } else { Err(CoreError::SnapshotMismatch("结社状态或领奖记录无效".into())) }
    }
}
