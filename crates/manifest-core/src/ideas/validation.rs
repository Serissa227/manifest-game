//! 加载时检查资源和引用，读档时拒绝预算、活动与陌生键损坏。
use super::*;
use crate::{StaticData, World, error::CoreError};

pub fn validate(d: &StaticData) -> Vec<String> {
    let mut errors = Vec::new();
    let key = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_');
    let mut keys = BTreeSet::new();
    for i in &d.ideas.ideas {
        if !key(&i.key)
            || !keys.insert(&i.key)
            || i.name.trim().is_empty()
            || i.carriers.iter().any(|s| !key(s))
            || i.books.iter().any(|s| d.items.item(s).is_none_or(|i| i.kind != crate::items::ItemKind::Book))
            || i.rivals.iter().any(|s| s == &i.key || d.ideas.idea(s).is_none())
        {
            errors.push(format!("{}：思想定义或引用无效", i.key));
        }
    }
    let mut ports = BTreeSet::new();
    for p in &d.ideas.ports {
        let mut modes = BTreeSet::new();
        let mut unlocks = BTreeSet::new();
        if !ports.insert(&p.key)
            || d.find_loc(&p.key).is_none_or(|l| !d.loc(l).is_port())
            || !(1..=100).contains(&p.annual_cap)
            || !(0..=100).contains(&p.inertia)
            || !(0..=100).contains(&p.hostility)
            || !p.shares.iter().all(|(i, s)| d.ideas.idea(i).is_some() && (0..=100).contains(s))
            || !p.forbidden.iter().all(|i| d.ideas.idea(i).is_some())
            || p.permission.as_ref().is_some_and(|f| !key(f))
            || p.protector.as_ref().is_some_and(|p| d.cast.person(p).is_none())
            || p.language.as_ref().is_some_and(|s| !d.story2.skills.contains(s))
        {
            errors.push(format!("{}：港口思想配置无效", p.key));
        }
        for m in &p.modes {
            let valid = d.ideas.idea(&m.idea).is_some()
                && modes.insert((&m.idea, m.mode))
                && !m.label.trim().is_empty()
                && (1..=100).contains(&m.points)
                && (1..=100).contains(&m.cap)
                && (0..=100).contains(&m.diminish)
                && (0..=1_000_000_000).contains(&m.cost)
                && m.days <= 3650
                && m.from_date.is_none_or(|date| crate::scenario::day_of(d, date).is_ok())
                && (0..=100).contains(&m.detection)
                && (0..=100).contains(&m.suspicion)
                && (0..=100).contains(&m.affinity)
                && (m.cost > 0 || !m.items.is_empty() || !m.goods.is_empty())
                && m.items.iter().all(|(i, q)| d.items.item(i).is_some() && (1..=10000).contains(q))
                && m.goods.iter().all(|(g, q)| d.find_good(g).is_some() && (1..=10000).contains(q))
                && m.skill
                    .as_ref()
                    .is_none_or(|s| d.story2.skills.contains(s) && m.min_skill > 0 && m.min_skill <= 10000)
                && (m.skill.is_some() || m.min_skill == 0)
                && m.person.as_ref().is_none_or(|p| d.cast.person(p).is_some())
                && m.campaign.is_some() == m.var.is_some()
                && m.campaign.as_ref().is_none_or(|c| {
                    d.history.campaign(c).is_some_and(|c| c.vars.iter().any(|v| Some(&v.key) == m.var.as_ref()))
                })
                && match m.mode {
                    Mode::Mission => {
                        m.days > 0
                            && d.ideas.idea(&m.idea).is_some_and(|i| !i.carriers.is_empty())
                            && p.language.is_some()
                    }
                    Mode::Print => {
                        m.book.as_ref().is_some_and(|b| d.ideas.idea(&m.idea).is_some_and(|i| i.books.contains(b)))
                            && (p.printing && m.cost > 0 || m.book.as_ref().is_some_and(|b| m.items.contains_key(b)))
                            && m.skill.is_some()
                    }
                    Mode::School => m.days >= 28 && m.cost > 0,
                    Mode::Charity => m.skill.is_some(),
                    Mode::Court => m.person.is_some() && (!m.items.is_empty() || m.cost > 0),
                    Mode::Protect => {
                        m.person.is_some()
                            && (1..=100).contains(&m.berths)
                            && m.from
                                .as_ref()
                                .is_some_and(|f| f != &p.key && d.find_loc(f).is_some_and(|l| d.loc(l).is_port()))
                            && !p.forbidden.contains(&m.idea)
                    }
                };
            if !valid {
                errors.push(format!("{}:{}:{:?}：传播方式、资源或门槛无效", p.key, m.idea, m.mode));
            }
        }
        for u in &p.unlocks {
            if !key(&u.key)
                || !unlocks.insert(&u.key)
                || d.ideas.idea(&u.idea).is_none()
                || !(1..=100).contains(&u.threshold)
                || u.effects.iter().any(|e| crate::history::validation::effect_error(d, e).is_some())
            {
                errors.push(format!("{}:{}：思想解锁或效果无效", p.key, u.key));
            }
        }
    }
    errors
}

impl World {
    pub(crate) fn validate_ideas_snapshot(&self) -> Result<(), CoreError> {
        let s = &self.state.ideas;
        let valid = (self.defs.ideas.is_empty() && s.is_empty())
            || (!self.defs.ideas.is_empty()
                && s.last_day.is_none_or(|d| d <= self.day())
                && s.rescued.iter().all(|p| self.defs.cast.person(p).is_some())
                && s.suspicion.iter().all(|(owner, fs)| {
                    self.state.agents.contains_key(owner)
                        && fs.iter().all(|(f, v)| self.defs.factions.get(f.idx()).is_some() && (0..=100).contains(v))
                })
                && s.ports.iter().all(|(loc, s)| {
                    let Some(p) = self.defs.locations.get(loc.idx()).and_then(|l| self.defs.ideas.port(&l.key)) else {
                        return false;
                    };
                    s.year > 0
                        && s.year <= self.cast_date()[0]
                        && s.shares.iter().all(|(i, v)| self.defs.ideas.idea(i).is_some() && (0..=100).contains(v))
                        && s.gained
                            .iter()
                            .all(|(i, v)| self.defs.ideas.idea(i).is_some() && (0..=p.annual_cap).contains(v))
                        && s.unlocked.iter().all(|k| p.unlocks.iter().any(|u| &u.key == k))
                        && s.modes.iter().all(|(key, ms)| {
                            let Some(m) = p.modes.iter().find(|m| mode_key(&m.idea, m.mode) == *key) else {
                                return false;
                            };
                            (0..=1_000_000).contains(&ms.raw)
                                && ms
                                    .last
                                    .iter()
                                    .all(|(o, day)| self.state.agents.contains_key(o) && *day <= self.day())
                                && ms.active.iter().all(|(o, a)| {
                                    matches!(m.mode, Mode::Mission | Mode::School | Mode::Protect)
                                        && self.state.agents.contains_key(o)
                                        && ms.last.get(o) == Some(&a.started)
                                        && a.started <= self.day()
                                        && a.elapsed <= 3650
                                        && a.fleet.0 > 0
                                        && a.fleet.0 < self.state.next_fleet
                                        && (m.mode == Mode::Protect || a.elapsed < m.days)
                                })
                        })
                }));
        if valid {
            Ok(())
        } else {
            Err(CoreError::SnapshotMismatch("思想状态、活动或年度预算无效".into()))
        }
    }
}
