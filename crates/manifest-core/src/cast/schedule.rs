//! 日程只依赖日期、定义与确定性状态；史实卒年不是本世界的自动死亡命令。
use super::*;
use crate::{error::CoreError, ids::OwnerId, world::World};

pub fn schedule_on<'a>(
    person: &'a PersonDef,
    state: Option<&'a PersonState>,
    date: WorldDate,
    season: u32,
) -> Option<&'a ScheduleDef> {
    if state.is_some_and(|s| s.alive == Some(false)) || (person.born[0] != 0 && date < person.born) {
        return None;
    }
    let matches = |s: &&ScheduleDef| {
        s.from <= date && s.to.is_none_or(|to| date <= to) && (s.seasons.is_empty() || s.seasons.contains(&season))
    };
    state
        .and_then(|s| s.schedule.as_ref())
        .filter(|s| matches(s))
        .or_else(|| person.schedule.iter().filter(matches).max_by_key(|s| s.from))
}

impl World {
    pub fn cast_date(&self) -> WorldDate {
        let date = self.defs.calendar.date_of(self.day());
        [(self.defs.rules.world.start_year + i64::from(date.year) - 1) as u32, date.month, date.day]
    }

    pub fn cast_player_place(&self) -> Option<CastPlace> {
        if !self.state.agents.contains_key(&OwnerId::Player) {
            return None;
        }
        if let Some(place) = &self.state.cast.place {
            return Some(place.clone());
        }
        if let Some(fleet) = self.fleets_of(OwnerId::Player).next() {
            return fleet.docked_at().map(|loc| CastPlace { loc, venue: String::new() });
        }
        self.defs.scenarios.get(self.state.scenario.idx()).map(|s| CastPlace { loc: s.start_loc, venue: String::new() })
    }

    pub fn person_alive(&self, key: &str) -> bool {
        self.defs.cast.person(key).is_some_and(|p| {
            (p.born[0] == 0 || p.born <= self.cast_date())
                && self.state.cast.persons.get(key).is_none_or(|s| s.alive != Some(false))
        })
    }

    pub fn person_place(&self, key: &str) -> Option<CastPlace> {
        let person = self.defs.cast.person(key)?;
        if self.state.protagonist.as_ref().and_then(|p| p.protagonist.as_deref()) == Some(key) {
            return None;
        }
        if !self.person_alive(key) || self.idea_passenger(key) {
            return None;
        }
        if self.person_in_team(key) {
            return self.cast_player_place();
        }
        if let Some(place) = self.person_schedule_override(key) {
            return Some(place);
        }
        let schedule = schedule_on(
            person,
            self.state.cast.persons.get(key),
            self.cast_date(),
            self.defs.calendar.season_of(self.day()) as u32,
        )?;
        self.defs.find_loc(&schedule.at).map(|loc| CastPlace { loc, venue: schedule.venue.clone() })
    }

    /// 故事安排的有效停留优先于定义里的日程。
    pub(crate) fn person_schedule_override(&self, key: &str) -> Option<CastPlace> {
        let state = self.state.cast.persons.get(key)?;
        let selected = state.schedule.as_ref()?;
        let date = self.cast_date();
        let season = self.defs.calendar.season_of(self.day()) as u32;
        if !self.person_alive(key)
            || selected.from > date
            || selected.to.is_some_and(|to| to < date)
            || (!selected.seasons.is_empty() && !selected.seasons.contains(&season))
        {
            return None;
        }
        self.defs.find_loc(&selected.at).map(|loc| CastPlace { loc, venue: selected.venue.clone() })
    }

    pub fn person_here(&self, key: &str) -> bool {
        match (self.person_place(key), self.cast_player_place()) {
            (Some(p), Some(at)) => {
                p.loc == at.loc && (at.venue.is_empty() || p.venue.is_empty() || at.venue == p.venue)
            }
            _ => false,
        }
    }

    pub fn cast_meet_here(&mut self) {
        self.remember_cast_promises();
        if !self.defs.scenarios[self.state.scenario.idx()].upbringing && self.state.protagonist.is_some() {
            self.settle_graduation_ties();
        }
        if let Some(key) = self.state.protagonist.as_ref().and_then(|p| p.protagonist.as_deref())
            && let Some(person) = self.state.cast.persons.get_mut(key)
        {
            person.met = false;
        }
        // 主角不在任何地方（在海上）时谁也碰不到：`person_here` 对每个人都是假，不用逐个去排日程
        let keys: Vec<_> = if self.cast_player_place().is_none() {
            Vec::new()
        } else {
            self.defs.cast.persons.iter().filter(|p| self.person_here(&p.key)).map(|p| p.key.clone()).collect()
        };
        for key in keys {
            self.state.cast.persons.entry(key).or_default().met = true;
        }
        self.meet_schoolmates();
    }

    /// 时间线交付已校验的结果；同一结果重复交付不会再次改变状态。
    pub fn apply_cast_fate(&mut self, event: &str, outcome: &str) {
        if self.defs.cast.persons.is_empty() || self.state.cast.outcomes.get(event).is_some_and(|v| v == outcome) {
            return;
        }
        let effects: Vec<_> = self
            .defs
            .cast
            .persons
            .iter()
            .flat_map(|p| {
                p.fate.iter().filter(|f| f.event == event && f.outcome == outcome).map(|f| (p.key.clone(), f.clone()))
            })
            .collect();
        if effects.is_empty() {
            return;
        }
        self.state.cast.outcomes.insert(event.into(), outcome.into());
        for (key, fate) in effects {
            let state = self.state.cast.persons.entry(key).or_default();
            match fate.then {
                FateAction::Dies => state.alive = Some(false),
                FateAction::Lives => state.alive = Some(true),
                FateAction::Moves => {}
            }
            if let Some(schedule) = fate.schedule {
                state.schedule = Some(schedule);
            }
        }
    }

    pub(crate) fn validate_cast_snapshot(&self) -> Result<(), CoreError> {
        let valid_date = |d: WorldDate| {
            self.defs.calendar.day_of(crate::calendar::Date { year: d[0], month: d[1], day: d[2] }).is_ok()
        };
        let invalid = self.state.cast.persons.values().any(|s| {
            s.schedule.as_ref().is_some_and(|p| {
                !valid_date(p.from)
                    || p.to.is_some_and(|d| !valid_date(d) || d < p.from)
                    || p.seasons.iter().any(|v| *v > 3)
            })
        });
        if invalid
            || !self.valid_relations_snapshot()
            || !self.valid_interactions_snapshot()
            || !self.valid_school_memories()
        {
            return Err(CoreError::SnapshotMismatch("人物状态含不可能的日期、数值或关系记录".into()));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testkit::tiny_defs;
    use crate::{Command, ScenarioId};
    use serde_json::json;
    use std::sync::Arc;

    /// 小世界里放几个人物：有的日程在主角的出发港，有的在别处，有的地点不存在，有的没有日程。
    fn world() -> World {
        let mut defs = tiny_defs();
        let data = Arc::make_mut(&mut defs);
        let home = data.locations[data.scenarios[0].start_loc.idx()].key.clone();
        let other = data.locations.iter().map(|l| l.key.clone()).find(|k| *k != home).expect("第二处地点");
        let person = |key: &str, at: &str| {
            json!({"key": key, "name": key, "kind": "story", "gender": "f", "born": [0, 1, 1],
                "schedule": [{"from": [1, 1, 1], "at": at}]})
        };
        data.cast = serde_json::from_value(json!({"persons": [
            person("m_here", &home),
            person("b_away", &other),
            person("z_here", &home),
            person("a_nowhere", "no_such_place"),
            {"key": "k_idle", "name": "k", "kind": "story", "gender": "m", "born": [0, 1, 1]},
            person("c_here", &home),
        ]}))
        .expect("人物");
        World::new(defs, ScenarioId(0), 3).expect("开局")
    }

    /// 逐人现查的参照（P12 之前 `cast_meet_here` 就是这么筛的）。
    fn here(w: &World) -> Vec<String> {
        let mut keys: Vec<String> =
            w.defs.cast.persons.iter().filter(|p| w.person_here(&p.key)).map(|p| p.key.clone()).collect();
        keys.sort();
        keys
    }

    fn met(w: &World) -> Vec<String> {
        w.state.cast.persons.iter().filter(|(_, s)| s.met).map(|(k, _)| k.clone()).collect()
    }

    #[test]
    fn meeting_people_matches_checking_each_person_and_nobody_is_met_at_sea() {
        let mut w = world();
        w.end_day().expect("日结");
        assert_eq!(here(&w), ["c_here", "m_here", "z_here"]);
        assert_eq!(met(&w), here(&w));
        // 人物、地点按 key 查（排好序二分），与逐条比较相同，含不存在的 key
        for key in ["m_here", "b_away", "z_here", "a_nowhere", "k_idle", "c_here", "", "zz", "missing"] {
            assert_eq!(w.defs.cast.person(key), w.defs.cast.persons.iter().find(|p| p.key == key), "{key:?}");
        }
        let keys: Vec<String> = w
            .defs
            .locations
            .iter()
            .map(|l| l.key.clone())
            .chain(["".to_string(), "no_such_place".to_string()])
            .collect();
        for key in &keys {
            let linear = w.defs.locations.iter().position(|l| l.key == *key).map(LocId::from_idx);
            assert_eq!(w.defs.find_loc(key), linear, "{key:?}");
        }
        // 出海之后主角不在任何地方：谁也碰不到，认识过的照旧
        let fleet = w.fleets_of(OwnerId::Player).next().expect("舰队").id;
        let here_loc = w.cast_player_place().expect("开局在港").loc;
        let dest = w.defs.port_ids().find(|l| *l != here_loc).expect("另一个港口");
        Command::SetSail { owner: OwnerId::Player, fleet, dest }.apply(&mut w).expect("出航");
        let before = met(&w);
        w.end_day().expect("日结");
        if w.cast_player_place().is_none() {
            assert!(here(&w).is_empty());
            assert_eq!(met(&w), before);
        } else {
            // 一天就到了：照样与逐人现查相同
            let mut expect = before;
            expect.extend(here(&w));
            expect.sort();
            expect.dedup();
            assert_eq!(met(&w), expect);
        }
    }
}
