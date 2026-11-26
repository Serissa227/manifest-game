//! 毕业配对在结业时冻结约定与旗标条件；成年后的关系仍通过共同恋爱门禁。
use crate::{
    World,
    cast::relations::{Relation, TieState, action},
};
impl World {
    pub(crate) fn settle_graduation_ties(&mut self) {
        if self.defs.cast.deferred_ties.is_empty() || self.state.cast.graduation_day.is_some() {
            return;
        }
        let mut decisions = std::collections::BTreeMap::new();
        for d in &self.defs.cast.deferred_ties {
            if d.when.flag.as_ref().is_some_and(|flag| !self.upbringing_flag(flag)) {
                continue;
            }
            let paired = d.when.no_promise_with_protagonist.iter().all(|p| {
                self.state.cast.promise.as_ref() != Some(p)
                    && self.affection(p).is_none_or(|a| a.bond != Some(crate::cast::relations::Bond::S))
            });
            decisions.insert(d.key.clone(), paired);
        }
        for (key, paired) in &decisions {
            let flag = format!("graduation_{key}_{}", if *paired { "paired" } else { "friends" });
            self.state.cast.flags.insert(flag.clone());
            self.state.story2.flags.insert(flag);
        }
        self.state.cast.graduation_ties = decisions;
        self.state.cast.graduation_day = Some(self.day());
    }
    pub(crate) fn graduated_ties(&self) -> Vec<TieState> {
        let mut pairs = std::collections::BTreeMap::new();
        for d in &self.defs.cast.deferred_ties {
            let Some(paired) = self.state.cast.graduation_ties.get(&d.key) else { continue };
            let t = &d.tie;
            let pair = (t.a.clone().min(t.b.clone()), t.a.clone().max(t.b.clone()));
            if t.since > self.cast_date()
                || t.to.is_some_and(|to| self.cast_date() > to)
                || !self.person_alive(&t.a)
                || !self.person_alive(&t.b)
                || self.state.story2.removed_ties.contains(&pair)
                || self.state.cast.ties.iter().any(|s| (s.a == t.a && s.b == t.b) || (s.a == t.b && s.b == t.a))
            {
                continue;
            }
            // 约定落点为朋友；未成年或其他门禁尚未开放时，也不提前展示成年关系。
            let kind = if *paired && action(t.kind).is_none_or(|a| self.validate_tie_romance(&t.a, &t.b, a).is_ok()) {
                t.kind
            } else {
                Relation::Friends
            };
            let row = TieState { a: t.a.clone(), b: t.b.clone(), kind, since: t.since, open: t.open };
            if pairs.get(&pair).is_none_or(|old: &TieState| old.since <= row.since) {
                pairs.insert(pair, row);
            }
        }
        pairs.into_values().collect()
    }
}
