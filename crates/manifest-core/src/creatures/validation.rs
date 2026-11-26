//! 怪异数据的限定应对、损失边界与鉴定记录校验。
use super::*;
use crate::{StaticData, societies::validation::key};
pub fn validate(d: &StaticData) -> Vec<String> {
    let mut errors = Vec::new();
    let mut keys = BTreeSet::new();
    if d.creatures.creatures.len() > 256 {
        errors.push("怪异目录超过256条".into());
    }
    for c in &d.creatures.creatures {
        if !key(&c.key)
            || !keys.insert(&c.key)
            || c.name.trim().is_empty()
            || c.text.trim().is_empty()
            || c.regions.is_empty() && c.ports.is_empty()
            || c.regions.iter().any(|r| !d.regions.iter().any(|v| v.key == *r))
            || c.ports.iter().any(|p| d.find_loc(p).is_none_or(|p| !d.loc(p).is_port()))
            || c.when.months.iter().any(|m| !(1..=12).contains(m))
            || c.when.moon.iter().any(|m| *m > 7)
            || !(1..=10000).contains(&c.chance_bp)
            || !(1..=3650).contains(&c.cooldown_days)
            || !c.omens.is_empty() && c.omen_text.as_ref().is_none_or(|s| s.trim().is_empty())
            || c.responses.is_empty()
            || c.responses.iter().collect::<BTreeSet<_>>().len() != c.responses.len()
            || c.responses.len() != c.outcomes.len()
            || c.responses.iter().any(|r| !c.outcomes.contains_key(r))
            || c.knowledge.as_ref().is_some_and(|k| !key(k))
            || c.books.iter().collect::<BTreeSet<_>>().len() != c.books.len()
            || c.books.iter().any(|b| {
                !d.items
                    .items
                    .iter()
                    .any(|i| i.read.is_some() && i.work_key() == b && !crate::arcana::validation::religious(i))
            })
        {
            errors.push(format!("{}：怪异条件、引用或应对无效", c.key));
        }
        for o in c.outcomes.values() {
            if o.text.trim().is_empty()
                || o.reply.trim().is_empty()
                || o.hull_pct > 25
                || o.crew_pct > 20
                || o.delay_days > 7
                || !empty_cost(&o.cost) && crate::arcana::validation::cost_error(d, &o.cost)
                || o.clue.as_ref().is_some_and(|c| !key(c))
            {
                errors.push(format!("{}：怪异结果或费用越界", c.key));
            }
        }
        let mut value = 0i64;
        if c.loot.len() > 1
            || c.loot.iter().any(|l| {
                !(0..=100).contains(&l.appraisal)
                    || d.items.item(&l.item).is_none_or(|i| {
                        value = value.saturating_add(i.price);
                        i.protected() || crate::arcana::validation::religious(i)
                    })
            })
            || value > crate::arcana::MAX_VALUE
        {
            errors.push(format!("{}：奇物引用或价值越界", c.key));
        }
    }
    errors
}
impl World {
    fn valid_encounter(&self, e: &Encounter) -> bool {
        self.defs.creatures.creature(&e.creature).is_some()
            && e.day <= self.day()
            && e.fleet.0 > 0
            && e.fleet.0 < self.state.next_fleet
            && e.id == format!("{}:{}:{}", e.creature, e.day, e.fleet.0)
            && self.state.creatures.last.get(&e.creature).is_some_and(|d| *d >= e.day)
    }
    pub(crate) fn validate_creatures_snapshot(&self) -> Result<(), CoreError> {
        let s = &self.state.creatures;
        let valid = s.is_empty()
            || !self.defs.creatures.is_empty()
                && s.last.iter().all(|(k, d)| self.defs.creatures.creature(k).is_some() && *d <= self.day())
                && s.pending.as_ref().is_none_or(|e| self.valid_encounter(e) && !s.resolved.contains(&e.id))
                && s.delays
                    .iter()
                    .all(|(f, d)| f.0 > 0 && f.0 < self.state.next_fleet && *d <= self.day().saturating_add(7))
                && s.specimens.iter().all(|(id, p)| {
                    p.day <= self.day()
                        && self.defs.creatures.creature(&p.creature).is_some_and(|c| {
                            c.loot.iter().enumerate().any(|(i, l)| {
                                l.item == p.item
                                    && match p.verdict {
                                        Verdict::Genuine => l.genuine,
                                        Verdict::Fake => !l.genuine,
                                        Verdict::Unsure => true,
                                    }
                                    && id.starts_with(&format!("{}:", p.creature))
                                    && id.strip_suffix(&format!(":{i}")).is_some_and(|v| {
                                        s.resolved.contains(v)
                                            && v.split(':')
                                                .nth(1)
                                                .and_then(|d| d.parse::<u32>().ok())
                                                .is_some_and(|day| day <= p.day)
                                    })
                            })
                        })
                })
                && s.resolved.iter().all(|id| {
                    let v: Vec<_> = id.split(':').collect();
                    v.len() == 3
                        && self.defs.creatures.creature(v[0]).is_some()
                        && v[1].parse::<u32>().is_ok_and(|d| d <= self.day())
                        && v[2].parse::<u32>().is_ok_and(|f| f > 0 && f < self.state.next_fleet)
                })
                && s.last_result.as_ref().is_none_or(|r| {
                    self.valid_encounter(&r.encounter)
                        && s.resolved.contains(&r.encounter.id)
                        && r.hull_lost >= 0
                        && r.crew_lost >= 0
                        && self
                            .defs
                            .creatures
                            .creature(&r.encounter.creature)
                            .is_some_and(|c| c.responses.contains(&r.response))
                });
        if valid {
            Ok(())
        } else {
            Err(CoreError::SnapshotMismatch("怪异待决、损失或鉴定记录无效".into()))
        }
    }
}
