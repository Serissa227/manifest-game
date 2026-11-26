//! 作者分值按实际命中结算，避免先转百分数再转奖励造成二次截断。
use super::*;
use crate::World;
impl World {
    pub fn contest_here(&self, c: &ContestDef, date: WorldDate) -> bool {
        let Some(loc) = self.upbringing_location().map(|i| self.defs.loc(i)) else { return false };
        if self.contest_junior(c, date) {
            return true;
        }
        if c.bindings.is_empty() {
            c.at == loc.key
        } else {
            c.bindings.iter().any(|b| b.at == loc.key && b.dates.contains(&date))
        }
    }
    pub(crate) fn contest_weather_allowed(&self, c: &ContestDef) -> bool {
        if c.unlock.weather.as_deref() != Some("safe_ice") {
            return true;
        }
        let Some(loc) = self.upbringing_location().map(|i| self.defs.loc(i)) else { return false };
        let Some(region) = self.defs.map.region_of(loc.cell) else { return false };
        // 没有冰厚模拟；连续三日实际雪天是本比赛的保守开放条件。
        (0..3).all(|ago| {
            self.day()
                .checked_sub(ago)
                .and_then(|day| self.weather_on(region, day))
                .is_some_and(|w| w.sky == crate::weather::Sky::Snow)
        })
    }
    pub(crate) fn authored_contest_bonus(
        &self,
        c: &ContestDef,
        params: &Params,
        moves: &Moves,
        race: Option<i64>,
    ) -> Option<i64> {
        c.scoring.authored_kind.as_ref()?;
        if c.poem.as_ref().is_some_and(|p| p.score_tags) {
            return None;
        }
        let score = match (params, moves) {
            (Params::Match(p), Moves::Pairs(pairs)) => {
                pairs.iter().filter(|[a, b]| p.faces.get(*a as usize) == p.faces.get(*b as usize)).count() as i64
                    * c.scoring.points_per_pair.unwrap_or(0)
            }
            (Params::Poem(_), Moves::Choices(choices)) => {
                c.scoring.line_points.iter().zip(choices).map(|(v, k)| v.get(*k as usize).copied().unwrap_or(0)).sum()
            }
            (Params::Debate(p), Moves::Keys(cards)) => {
                p.rounds
                    .iter()
                    .zip(cards)
                    .filter(|(r, k)| {
                        p.hand
                            .iter()
                            .find(|c| &c.key == *k)
                            .is_some_and(|c| p.beats.contains(&[c.kind.clone(), r.opponent.kind.clone()]))
                    })
                    .count() as i64
                    * c.scoring.points_per_win.unwrap_or(0)
            }
            (Params::Identify(p), Moves::Keys(answers)) => {
                p.samples.iter().zip(answers).filter(|(s, a)| c.scoring.answers.get(&s.key) == Some(*a)).count() as i64
                    * c.scoring.points_per_correct.unwrap_or(0)
            }
            (Params::Rhythm(p), Moves::Choices(taps)) => {
                let mut beat = 0;
                let mut hits = 0;
                for (i, time) in taps.iter().enumerate() {
                    if i > 0 && taps[i - 1] == *time {
                        continue;
                    }
                    while p.beats.get(beat).is_some_and(|b| b.saturating_add(p.window) < *time) {
                        beat += 1;
                    }
                    if p.beats.get(beat).is_some_and(|b| b.abs_diff(*time) <= p.window) {
                        hits += 1;
                        beat += 1;
                    }
                }
                hits * c.scoring.points_per_hit.unwrap_or(0) * p.beats.len() as i64
                    / p.beats.len().max(taps.len()) as i64
            }
            (Params::Race(_), Moves::Keys(_)) => race.unwrap_or(0),
            _ => 0,
        };
        Some(score.clamp(0, c.scoring.max_bonus))
    }
}
