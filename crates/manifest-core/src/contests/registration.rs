//! 报名以比赛实例为单位保存；月程只为比赛日前开始的备赛登记。
use super::{ContestDef, occurrence_key};
use crate::{World, scenario::WorldDate, upbringing::Stage};

impl World {
    pub(crate) fn contest_home_on(&self, date: WorldDate) -> bool {
        self.upbringing_stage_on(date)
            .or_else(|| self.upbringing_family().and_then(|f| f.stages.first()))
            .is_some_and(|s| s.stage == Stage::Home)
    }
    /// 这一场是不是主角家乡的少年组：`junior_families` 里的家庭家乡期在家乡另办一场。
    pub fn contest_junior(&self, contest: &ContestDef, date: WorldDate) -> bool {
        let Some(family) = self.upbringing_family() else { return false };
        self.contest_home_on(date)
            && contest.junior_families.contains(&family.key)
            && self.upbringing_location().is_some_and(|i| self.defs.loc(i).key == family.home)
    }
    pub fn contest_registered(&self, key: &str) -> bool {
        self.state.upbringing.as_ref().is_some_and(|s| s.contest_registrations.contains(key))
    }

    pub fn contest_rival_range(&self, contest: &ContestDef, date: WorldDate) -> [i64; 2] {
        if !contest.age_groups {
            return [35, 100];
        }
        let age = self.state.protagonist.as_ref().and_then(|p| p.age_on(date)).unwrap_or(12);
        let increment = i64::from(age.saturating_sub(12)) * 10;
        [20 + increment, 60 + increment]
    }

    pub fn contest_scheduled(&self, contest: &ContestDef, date: WorldDate) -> bool {
        if !contest.dates.contains(&date) {
            return false;
        }
        if !contest.home_quarterly || !self.contest_home_on(date) {
            return true;
        }
        // 只保留当地本季首场；学院同名比赛继续使用完整排期。
        !contest.dates.iter().any(|other| {
            other < &date
                && other[0] == date[0]
                && (other[1] - 1) / 3 == (date[1] - 1) / 3
                && self.contest_here(contest, *other)
        })
    }

    pub(crate) fn register_planned_contests(&mut self) {
        let Some(state) = &self.state.upbringing else { return };
        let date = self.cast_date();
        // 按周（U05）：一格的开始日就是它的结算日（按旬仍是那一旬的首日）。
        let week_dates: Option<Vec<WorldDate>> =
            self.upbringing_weekly().then(|| self.upbringing_week_slots().into_iter().map(|(_, d)| d).collect());
        let registrations = self
            .defs
            .upbringing
            .contests
            .iter()
            .filter(|c| c.registration_required)
            .flat_map(|contest| {
                contest
                    .dates
                    .iter()
                    .filter(|due| self.contest_open(contest, **due))
                    .filter(|due| {
                        state.plan.iter().skip(usize::from(state.next_slot)).any(|slot| {
                            let start = match &week_dates {
                                Some(dates) => dates.get(usize::from(slot.index)).copied().unwrap_or(date),
                                None => [state.month[0], state.month[1], 1 + u32::from(slot.index) * 10],
                            }
                            .max(date);
                            start <= **due
                                && slot.lesson.iter().chain(slot.after.iter().map(|a| &a.activity)).any(|key| {
                                    contest.prep.activities.contains(key)
                                        || self
                                            .defs
                                            .upbringing
                                            .activity(key)
                                            .and_then(|a| a.counts_as.as_ref())
                                            .is_some_and(|base| contest.prep.activities.contains(base))
                                })
                        })
                    })
                    .map(|due| occurrence_key(&contest.key, *due))
            })
            .collect::<Vec<_>>();
        self.record_deed(
            crate::story2::deeds::Deed::UbContestEnter,
            registrations
                .iter()
                .filter(|key| !self.contest_registered(key))
                .collect::<std::collections::BTreeSet<_>>()
                .len() as u32,
        );
        if let Some(state) = &mut self.state.upbringing {
            state.contest_registrations.extend(registrations);
        }
    }
}
