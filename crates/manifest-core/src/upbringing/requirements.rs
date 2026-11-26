//! 里程碑条件只查询真实状态；隐藏志向和结局共用同一解释器。
use super::{NodeState, Stage, milestones::*};
use crate::{OwnerId, World};
use std::collections::BTreeSet;
impl World {
    pub fn upbringing_school_year(&self) -> u32 {
        let date = self.cast_date();
        self.upbringing_family()
            .and_then(|f| f.stages.iter().find(|s| s.stage == Stage::Academy && s.from <= date))
            .map_or(0, |s| date[0].saturating_sub(s.from[0]) + 1)
    }
    pub fn upbringing_skill_level(&self, key: &str) -> u32 {
        let xp = self.upbringing_skill_xp(key);
        if let Some(p) = self.defs.upbringing.skill_profiles.get(key) {
            if p.unavailable { 0 } else { p.thresholds.iter().filter(|t| xp >= **t).count() as u32 }
        } else if xp <= 0 {
            0
        } else {
            (xp / self.defs.rules.items.xp_per_point.max(1) + 1).min(3) as u32
        }
    }
    pub fn upbringing_requirements(&self, r: &Requirements) -> bool {
        let between = |v: i64| r.min.is_none_or(|m| v >= m) && r.max.is_none_or(|m| v <= m);
        let s = self.state.upbringing.as_ref();
        let exams = s.map(|s| &s.exams);
        let passed = |k: &str| exams.and_then(|s| s.get(k)).is_some_and(|e| e.passed);
        let count = |level| {
            self.state
                .cast
                .persons
                .iter()
                .filter(|(p, s)| {
                    r.person.as_ref().is_none_or(|k| k == *p) && s.affection.bond.is_some_and(|b| b >= level)
                })
                .count() as u32
        };
        r.all.iter().all(|r| self.upbringing_requirements(r))
            && (r.any.is_empty() || r.any.iter().any(|r| self.upbringing_requirements(r)))
            && r.attr.as_ref().is_none_or(|k| between(self.upbringing_projected(k)))
            && r.rating.as_ref().is_none_or(|k| {
                let v = self.upbringing_rating(k.key());
                between(v)
                    && match k {
                        RatingRequirement::Key(_) => true,
                        RatingRequirement::Threshold(t) => v >= t.min,
                    }
            })
            && r.flag.as_ref().is_none_or(|f| self.upbringing_flag(f) == r.flag_value.unwrap_or(true))
            && r.activity.as_ref().is_none_or(|k| self.upbringing_activity_done(k, r.times))
            && r.skill.as_ref().is_none_or(|k| self.upbringing_skill_level(k) >= r.level)
            && r.year.is_none_or(|y| self.upbringing_school_year() >= y)
            && r.lessons.is_none_or(|n| {
                s.map_or(0, |s| {
                    if !s.journal.is_empty() {
                        // 按周的记录按格重折成标准格（U05）；按旬的记录每条就是一格。
                        return self.upbringing_lessons_done() as u32;
                    }
                    s.activity_counts
                        .iter()
                        .filter(|(k, _)| {
                            self.defs.upbringing.activity(k).is_some_and(|a| a.kind == super::ActivityKind::Lesson)
                        })
                        .map(|(_, n)| *n)
                        .sum::<u32>()
                }) >= n
            })
            && r.completed_slots.is_none_or(|n| s.is_some() && self.upbringing_completed_slots() >= i64::from(n))
            && r.languages_at_level.is_none_or(|n| {
                self.defs
                    .story2
                    .skills
                    .iter()
                    .filter(|k| k.starts_with("lang_") && self.upbringing_skill_level(k) >= r.level)
                    .count()
                    >= n as usize
            })
            && r.exam_passed.as_ref().is_none_or(|k| passed(k))
            && r.contest.as_ref().is_none_or(|k| s.is_some_and(|s| s.contest_results.values().any(|r| &r.contest == k)))
            && r.academy_exam_passed.is_none_or(|v| {
                self.upbringing_academy().is_some_and(|a| {
                    self.defs.upbringing.exams.iter().any(|e| e.academy.as_ref() == Some(&a.key) && passed(&e.key))
                }) == v
            })
            && r.exams_attempted_min
                .is_none_or(|n| exams.map_or(0, |s| s.values().map(|e| e.attempts).sum::<u32>()) >= n)
            && r.exams_passed_max
                .is_none_or(|n| exams.map_or(0, |s| s.values().filter(|e| e.passed).count()) <= n as usize)
            && r.aspiration.as_ref().is_none_or(|k| {
                if k == "unset" {
                    s.is_none_or(|s| s.path.is_none())
                } else {
                    s.and_then(|s| s.path.as_ref()) == Some(k)
                }
            })
            && r.bond_grade.is_none_or(|b| {
                count(b) >= r.count_min.unwrap_or(if r.count_max.is_none() { 1 } else { 0 })
                    && r.count_max.is_none_or(|n| count(b) <= n)
            })
            && r.fame_min.is_none_or(|n| s.is_some_and(|s| s.fame >= n))
            && r.fame_max.is_none_or(|n| s.is_some_and(|s| s.fame <= n))
            && r.cash_max.is_none_or(|n| self.agent(OwnerId::Player).is_ok_and(|a| a.cash <= n))
            && r.books_read_min.is_none_or(|n| self.books_read(OwnerId::Player, None) >= n as usize)
            && r.book_categories_min.is_none_or(|n| {
                self.inventory(OwnerId::Player)
                    .map_or(0, |i| i.bibliography.values().map(|r| &r.category).collect::<BTreeSet<_>>().len())
                    >= n as usize
            })
            && r.outings_solved.is_none_or(|n| {
                s.map_or(0, |s| {
                    s.excursion_nodes.values().flat_map(|n| n.values()).filter(|v| **v == NodeState::Solved).count()
                }) >= n as usize
            })
    }
}
