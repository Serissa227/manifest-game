//! 按周首月份现算潮汐；不向存档追加日历状态。
use super::*;

#[derive(Clone, Debug, Default, Serialize)]
pub struct TideEffects {
    pub this_week: Vec<String>,
    pub jobs: BTreeMap<String, i64>,
    pub people: Vec<String>,
    pub rumors: u32,
    pub closed: Vec<String>,
    pub duty_fail: BTreeMap<String, i64>,
}
impl World {
    pub fn act_tides_at(&self, week: u32) -> Vec<&ActTideDef> {
        if !self.act_stage_on("tides") {
            return Vec::new();
        }
        let date = self.act_week_date(week, false);
        let current = self.state.upbringing.as_ref().is_some_and(|s| s.act.week == week);
        let sailing_port = self.state.upbringing.as_ref().and_then(|s| s.act.voyage.as_ref()).and_then(|active| {
            let v = self.act_voyage_def()?;
            let leg = week.checked_sub(active.start_week)?;
            v.legs.get(leg as usize).map(|leg| leg.port.as_str())
        });
        let port = if current {
            sailing_port.or_else(|| self.upbringing_location().map(|loc| self.defs.loc(loc).key.as_str()))
        } else {
            sailing_port.or_else(|| self.upbringing_stage_on(date).map(|stage| stage.at.as_str()))
        };
        self.defs
            .upbringing
            .act_tides
            .iter()
            .filter(|t| Some(t.port.as_str()) == port && t.months.contains(&(date[1] as u8)))
            .collect()
    }
    pub fn act_tide_effects(&self) -> TideEffects {
        let mut out = TideEffects::default();
        let week = self.state.upbringing.as_ref().map_or(0, |s| s.act.week);
        for tide in self.act_tides_at(week) {
            out.this_week.push(tide.key.clone());
            for (key, value) in &tide.jobs {
                *out.jobs.entry(key.clone()).or_default() += value;
            }
            for (key, value) in &tide.duty_fail {
                *out.duty_fail.entry(key.clone()).or_default() += value;
            }
            out.people.extend(tide.people.iter().cloned());
            out.closed.extend(tide.closed.iter().cloned());
            out.rumors += tide.rumors;
        }
        out.people.sort();
        out.people.dedup();
        out.closed.sort();
        out.closed.dedup();
        out
    }
    pub fn act_tide_closed(&self, excursion: &str, node: &str) -> bool {
        let key = format!("{excursion}:{node}");
        self.act_tide_effects().closed.contains(&key)
    }
    pub fn act_job_bonus_pct(&self, place: &str, group: &str) -> i64 {
        let tide = self.act_tide_effects().jobs.get(group).copied().unwrap_or(0);
        let partner = self
            .act_people()
            .iter()
            .any(|p| self.act_presence(p) == Some(place) && self.act_has_perk(p, "job_partner"));
        tide + if partner { self.act_rules().map_or(0, |r| r.perk.job_partner_pct) } else { 0 }
    }
    pub fn act_job_income(&self, place: &str, activity: &ActivityDef) -> i64 {
        self.act_rules().map_or(0, |r| {
            r.job_income[self.act_job_level(activity)]
                * (100 + self.act_job_bonus_pct(place, job_group(activity))).max(0)
                / 100
        })
    }
    pub(super) fn act_tide_presence(&self, presence: &mut BTreeMap<String, String>) {
        let week = self.state.upbringing.as_ref().map_or(0, |s| s.act.week);
        for tide in self.act_tides_at(week) {
            let place = self.act_places().iter().find(|p| p.venue == tide.venue && self.upbringing_place_open(p));
            if let Some(place) = place {
                for person in &tide.people {
                    if let Some(at) = presence.get_mut(person) {
                        *at = place.key.clone();
                    }
                }
            }
        }
    }
}
