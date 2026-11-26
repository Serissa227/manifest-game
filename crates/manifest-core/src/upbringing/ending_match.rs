//! 结局先检查门槛，再比较匹配度；主结局与支线纪念分别结算。
use super::*;
use crate::World;

impl World {
    pub fn upbringing_ending_score(&self, ending: &EndingDef) -> i64 {
        let weights = &ending.weights;
        let mut score = 0_i64;
        for (key, weight) in &weights.ratings {
            score = score.saturating_add(self.upbringing_rating(key).saturating_mul(*weight));
        }
        for (key, weight) in &weights.aspirations {
            if self.state.upbringing.as_ref().and_then(|s| s.path.as_ref()) == Some(key) {
                score = score.saturating_add(*weight);
            }
        }
        for (key, weight) in &weights.bonds {
            score = score.saturating_add(self.affection(key).map_or(0, |a| a.affinity).saturating_mul(*weight));
        }
        for (key, weight) in &weights.flags {
            if self.upbringing_flag(key) {
                score = score.saturating_add(*weight);
            }
        }
        score
    }

    pub fn upbringing_best_ending(&self) -> Option<&EndingDef> {
        let family = self.upbringing_family()?;
        self.defs
            .upbringing
            .endings
            .iter()
            .filter(|e| {
                !e.supplementary
                    && e.family.as_ref().is_none_or(|k| k == &family.key)
                    && self.upbringing_requirements(&e.requirements)
            })
            .min_by(|a, b| {
                self.upbringing_ending_score(b)
                    .cmp(&self.upbringing_ending_score(a))
                    .then_with(|| b.priority.cmp(&a.priority))
                    .then_with(|| a.key.cmp(&b.key))
            })
    }

    pub fn upbringing_near_misses(&self) -> Vec<EndingNearMiss> {
        let Some(family) = self.upbringing_family() else { return Vec::new() };
        let mut candidates = self
            .defs
            .upbringing
            .endings
            .iter()
            .filter(|e| !e.supplementary && e.family.as_ref().is_none_or(|k| k == &family.key))
            .filter_map(|e| {
                let missing = self.upbringing_requirement_gaps(&e.requirements);
                (!missing.is_empty()).then_some((e, missing))
            })
            .collect::<Vec<_>>();
        candidates.sort_by(|(a, left), (b, right)| {
            gap_distance(left)
                .cmp(&gap_distance(right))
                .then_with(|| self.upbringing_ending_score(b).cmp(&self.upbringing_ending_score(a)))
                .then_with(|| b.priority.cmp(&a.priority))
                .then_with(|| a.key.cmp(&b.key))
        });
        candidates
            .into_iter()
            .take(2)
            .map(|(ending, missing)| EndingNearMiss { ending: ending.key.clone(), missing })
            .collect()
    }
}

pub(super) fn gap_distance(gaps: &[RequirementGap]) -> u64 {
    gaps.iter().fold(0_u64, |sum, g| {
        sum.saturating_add(g.have.abs_diff(g.need).saturating_mul(1000) / g.need.unsigned_abs().max(1))
    })
}
