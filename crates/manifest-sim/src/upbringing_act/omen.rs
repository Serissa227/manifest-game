//! 报表内只读记录异兆候选、实际排期与门槛，不改调度器。
use super::*;
use serde::Serialize;

#[derive(Debug, Default, Serialize)]
pub(super) struct OmenTrace {
    pub shown: BTreeMap<String, Vec<(u32, [u32; 3])>>,
    pub flags: BTreeSet<String>,
    pub september: Vec<OmenDay>,
    pub september_events: BTreeMap<String, Vec<[u32; 3]>>,
}
#[derive(Debug, Serialize)]
pub(super) struct OmenDay {
    pub date: [u32; 3],
    pub week: u32,
    pub candidate: bool,
    pub alternate_candidate: bool,
    pub alternate_checks: BTreeMap<String, bool>,
    pub in_pool: bool,
    pub checks: BTreeMap<String, bool>,
    pub poetry: i64,
    pub used: [u8; 2],
    pub scheduled: BTreeMap<String, u32>,
    pub permits: BTreeSet<String>,
    pub pending: Vec<String>,
}
impl OmenTrace {
    pub fn observe(&mut self, w: &World) {
        for pending in &w.state.story2.pending {
            if w.cast_date()[0..2] == [1554, 9] {
                let dates = self.september_events.entry(pending.track.clone()).or_default();
                if !dates.contains(&w.cast_date()) {
                    dates.push(w.cast_date());
                }
            }
            if pending.track.contains("omen") {
                let dates = self.shown.entry(pending.track.clone()).or_default();
                let at = (week_index(&w.defs, w.day()) + 1, w.cast_date());
                if !dates.contains(&at) {
                    dates.push(at);
                }
            }
        }
        self.flags = w.state.story2.flags.iter().filter(|f| f.starts_with("c9_mio_omen_")).cloned().collect();
        let date = w.cast_date();
        if date[0..2] != [1554, 9] || self.september.last().is_some_and(|d| d.date == date) {
            return;
        }
        if let Some(state) = &w.state.upbringing {
            self.september.push(OmenDay {
                date,
                week: week_index(&w.defs, w.day()) + 1,
                candidate: w.cadence_candidate_now("c9_mio_omen_1", false),
                alternate_candidate: w.cadence_candidate_now("c9_mio_noshima_omen_1", false),
                alternate_checks: w.cadence_candidate_checks("c9_mio_noshima_omen_1", false),
                in_pool: w.defs.upbringing.event_gates.contains_key("c9_mio_omen_1")
                    || state.activity_tracks.contains("c9_mio_omen_1"),
                checks: w.cadence_candidate_checks("c9_mio_omen_1", false),
                poetry: w.upbringing_skill_xp("poetry"),
                used: state.cadence.used,
                scheduled: state.cadence.scheduled.clone(),
                permits: state.event_permits.clone(),
                pending: w.state.story2.pending.iter().map(|p| p.track.clone()).collect(),
            });
        }
    }
}
