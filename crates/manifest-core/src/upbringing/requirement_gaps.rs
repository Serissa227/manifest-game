//! 门槛差距与判定读取同一份真实状态；任意分支只展示距离最近的一条。
use super::*;
use crate::{OwnerId, World};
use std::collections::BTreeSet;

fn minimum(out: &mut Vec<RequirementGap>, key: String, have: i64, need: i64) {
    if have < need {
        out.push(RequirementGap { key, have, need });
    }
}
fn maximum(out: &mut Vec<RequirementGap>, key: String, have: i64, need: i64) {
    if have > need {
        out.push(RequirementGap { key: format!("{key}:max"), have, need });
    }
}
impl World {
    pub fn upbringing_requirement_gaps(&self, r: &Requirements) -> Vec<RequirementGap> {
        let mut gaps = r.all.iter().flat_map(|v| self.upbringing_requirement_gaps(v)).collect::<Vec<_>>();
        if !r.any.is_empty() {
            let nearest = r
                .any
                .iter()
                .map(|v| self.upbringing_requirement_gaps(v))
                .min_by_key(|v| super::ending_match::gap_distance(v))
                .unwrap_or_default();
            gaps.extend(nearest);
        }
        let state = self.state.upbringing.as_ref();
        if let Some(key) = &r.attr {
            let have = self.upbringing_projected(key);
            if let Some(need) = r.min {
                minimum(&mut gaps, format!("attr:{key}"), have, need);
            }
            if let Some(need) = r.max {
                maximum(&mut gaps, format!("attr:{key}"), have, need);
            }
        }
        if let Some(rating) = &r.rating {
            let key = rating.key();
            let have = self.upbringing_rating(key);
            let threshold = match rating {
                RatingRequirement::Threshold(t) => Some(t.min),
                _ => None,
            };
            if let Some(need) = r.min.into_iter().chain(threshold).max() {
                minimum(&mut gaps, format!("rating:{key}"), have, need);
            }
            if let Some(need) = r.max {
                maximum(&mut gaps, format!("rating:{key}"), have, need);
            }
        }
        if let Some(key) = &r.flag {
            let have = i64::from(self.upbringing_flag(key));
            let need = i64::from(r.flag_value.unwrap_or(true));
            if have != need {
                gaps.push(RequirementGap { key: format!("flag:{key}"), have, need });
            }
        }
        if let Some(key) = &r.activity {
            minimum(
                &mut gaps,
                format!("activity:{key}"),
                // 按周（U05）要求“做过一次”的只看有没有进展：次数还没进到 1 也算数。
                i64::from(state.and_then(|s| s.activity_counts.get(key)).copied().unwrap_or(0))
                    .max(if self.upbringing_activity_done(key, r.times) { i64::from(r.times) } else { 0 }),
                i64::from(r.times),
            );
        }
        if let Some(key) = &r.skill {
            minimum(&mut gaps, format!("skill:{key}"), i64::from(self.upbringing_skill_level(key)), i64::from(r.level));
        }
        if let Some(need) = r.year {
            minimum(&mut gaps, "school_year".into(), i64::from(self.upbringing_school_year()), i64::from(need));
        }
        if let Some(need) = r.lessons {
            let have = state.map_or(0, |s| {
                if s.journal.is_empty() {
                    s.activity_counts
                        .iter()
                        .filter(|(key, _)| {
                            self.defs.upbringing.activity(key).is_some_and(|a| a.kind == ActivityKind::Lesson)
                        })
                        .map(|(_, count)| i64::from(*count))
                        .sum()
                } else {
                    self.upbringing_lessons_done()
                }
            });
            minimum(&mut gaps, "lessons".into(), have, i64::from(need));
        }
        if let Some(need) = r.completed_slots {
            minimum(&mut gaps, "completed_slots".into(), self.upbringing_completed_slots(), i64::from(need));
        }
        if let Some(need) = r.languages_at_level {
            let have = self
                .defs
                .story2
                .skills
                .iter()
                .filter(|key| key.starts_with("lang_") && self.upbringing_skill_level(key) >= r.level)
                .count() as i64;
            minimum(&mut gaps, format!("languages:level:{}", r.level), have, i64::from(need));
        }
        let passed = |key: &str| state.and_then(|s| s.exams.get(key)).is_some_and(|e| e.passed);
        if let Some(key) = &r.exam_passed {
            minimum(&mut gaps, format!("exam:{key}"), i64::from(passed(key)), 1);
        }
        if let Some(key) = &r.contest {
            minimum(
                &mut gaps,
                format!("contest:{key}"),
                i64::from(state.is_some_and(|s| s.contest_results.values().any(|c| &c.contest == key))),
                1,
            );
        }
        if let Some(need) = r.academy_exam_passed {
            let have = self.upbringing_academy().is_some_and(|a| {
                self.defs.upbringing.exams.iter().any(|e| e.academy.as_ref() == Some(&a.key) && passed(&e.key))
            });
            if have != need {
                gaps.push(RequirementGap {
                    key: "academy_exam_passed".into(),
                    have: i64::from(have),
                    need: i64::from(need),
                });
            }
        }
        if let Some(need) = r.exams_attempted_min {
            minimum(
                &mut gaps,
                "exams_attempted".into(),
                state.map_or(0, |s| s.exams.values().map(|e| i64::from(e.attempts)).sum()),
                i64::from(need),
            );
        }
        if let Some(need) = r.exams_passed_max {
            maximum(
                &mut gaps,
                "exams_passed".into(),
                state.map_or(0, |s| s.exams.values().filter(|e| e.passed).count()) as i64,
                i64::from(need),
            );
        }
        if let Some(key) = &r.aspiration {
            let chosen = state.and_then(|s| s.path.as_ref());
            let matches = if key == "unset" { chosen.is_none() } else { chosen == Some(key) };
            minimum(&mut gaps, format!("aspiration:{key}"), i64::from(matches), 1);
        }
        if let Some(grade) = r.bond_grade {
            let have = self
                .state
                .cast
                .persons
                .iter()
                .filter(|(person, state)| {
                    r.person.as_ref().is_none_or(|p| p == *person) && state.affection.bond.is_some_and(|b| b >= grade)
                })
                .count() as i64;
            let key = format!("bond:{}:{grade:?}", r.person.as_deref().unwrap_or("count"));
            minimum(
                &mut gaps,
                key.clone(),
                have,
                i64::from(r.count_min.unwrap_or(if r.count_max.is_none() { 1 } else { 0 })),
            );
            if let Some(need) = r.count_max {
                maximum(&mut gaps, key, have, i64::from(need));
            }
        }
        if let Some(need) = r.fame_min {
            minimum(&mut gaps, "fame".into(), state.map_or(0, |s| s.fame), need);
        }
        if let Some(need) = r.fame_max {
            maximum(&mut gaps, "fame".into(), state.map_or(0, |s| s.fame), need);
        }
        if let Some(need) = r.cash_max {
            maximum(&mut gaps, "cash".into(), self.state.agents.get(&OwnerId::Player).map_or(0, |a| a.cash), need);
        }
        if let Some(need) = r.books_read_min {
            minimum(&mut gaps, "books_read".into(), self.books_read(OwnerId::Player, None) as i64, i64::from(need));
        }
        if let Some(need) = r.book_categories_min {
            let have = self
                .inventory(OwnerId::Player)
                .map_or(0, |i| i.bibliography.values().map(|r| &r.category).collect::<BTreeSet<_>>().len())
                as i64;
            minimum(&mut gaps, "book_categories".into(), have, i64::from(need));
        }
        if let Some(need) = r.outings_solved {
            let have = state.map_or(0, |s| {
                s.excursion_nodes.values().flat_map(|n| n.values()).filter(|n| **n == NodeState::Solved).count()
            }) as i64;
            minimum(&mut gaps, "outings_solved".into(), have, i64::from(need));
        }
        gaps
    }
}
