//! 内容变化只修剪失效引用；计数、日期和终身约定的内部矛盾已在快照校验中拒绝。
use super::*;
use crate::{
    log::{LogEvent, LogKind},
    world::World,
};

impl World {
    pub(crate) fn reconcile_cast(&mut self) {
        let before = self.state.cast.clone();
        if self.defs.cast.persons.is_empty() {
            let (place, academy) = if self.upbringing_active() {
                (self.state.cast.place.clone(), self.state.cast.academy)
            } else {
                (None, false)
            };
            self.state.cast = CastState { place, academy, ..Default::default() };
        } else {
            let defs = &self.defs;
            let known = |p: &str| defs.cast.person(p).is_some();
            self.state.cast.persons.retain(|p, _| known(p));
            for p in self.state.cast.persons.values_mut() {
                if p.schedule.as_ref().is_some_and(|s| !defs.locations.iter().any(|l| l.key == s.at)) {
                    p.schedule = None;
                }
                if let Some(memory) = &mut p.school {
                    memory.academies.retain(|key| defs.upbringing.academies.iter().any(|a| &a.key == key));
                    if memory.academies.is_empty() || defs.upbringing.family(&memory.family).is_none() {
                        p.school = None;
                    }
                }
                p.interactions
                    .likes_known
                    .retain(|k| defs.items.item(k).is_some() || defs.goods.iter().any(|g| &g.key == k));
            }
            self.state.cast.ties.retain(|t| known(&t.a) && known(&t.b));
            self.state.cast.graduation_ties.retain(|key, _| defs.cast.deferred_ties.iter().any(|d| &d.key == key));
            self.state.cast.promises.retain(|a, b| known(a) && (b == "$captain" || known(b)));
            if self.state.cast.promise.as_ref().is_some_and(|p| !known(p)) {
                self.state.cast.promise = None;
            }
            if self.state.cast.last.as_ref().is_some_and(|last| !known(&last.person)) {
                self.state.cast.last = None;
            }
            if self.state.cast.place.as_ref().is_some_and(|p| p.loc.idx() >= defs.locations.len()) {
                self.state.cast.place = None;
            }
        }
        if before != self.state.cast {
            self.push_log(LogEvent { day: self.day(), kind: LogKind::CastReconciled });
        }
    }
}
