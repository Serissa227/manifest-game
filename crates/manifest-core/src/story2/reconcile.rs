//! 章节 key 迁移与内容漂移修整，不重放已结算章节的奖励。
use super::*;
use crate::{
    log::{LogEvent, LogKind},
    world::World,
};

fn migrate_choice(c: &ChapterDef, choice: &mut Option<u32>, key: Option<&str>) -> bool {
    if let Some(key) = key {
        let Some(index) = c.choices.iter().position(|o| o.key == key) else {
            return false;
        };
        *choice = Some(index as u32);
        true
    } else {
        choice.is_none_or(|i| {
            c.choices.get(i as usize).is_some() || (i == 0 && c.stage == Some(Stage::Witness) && c.choices.is_empty())
        })
    }
}

impl World {
    pub(crate) fn reconcile_story2(&mut self) {
        let before = self.state.story2.clone();
        if self.defs.story2.tracks.is_empty() {
            self.state.story2 = Story2State::default();
        } else {
            let defs = &self.defs;
            let soft = defs.rules.story.soft_requires;
            let known = |p: &str| defs.cast.person(p).is_some();
            let chapter = |t: &str, c: &str| defs.story2.track(t).and_then(|t| t.chapter(c));
            let source = |s: &str| s.split_once(':').and_then(|(t, c)| chapter(t, c)).is_some();
            let state = &mut self.state.story2;
            state.tracks.retain(|k, _| defs.story2.track(k).is_some());
            for (key, s) in &mut state.tracks {
                let Some(t) = defs.story2.track(key) else {
                    continue;
                };
                s.visited.retain(|c| t.chapter(c).is_some());
                if t.chapter(&s.chapter).is_none()
                    || (s.status == Status::Active
                        && s.visited.contains(&s.chapter)
                        && t.chapter(&s.chapter).is_some_and(|c| c.once))
                {
                    // 见闻有时间顺序；没有见闻时按当前章节表选最近的已完成检查点。
                    let recent = before
                        .news
                        .values()
                        .filter(|n| n.track == *key)
                        .filter_map(|n| n.id.strip_prefix(&format!("{key}:")).map(|c| (n.day, c)))
                        .filter(|(_, c)| s.visited.contains(*c))
                        .max();
                    s.chapter = recent
                        .map(|(_, c)| c.to_owned())
                        .or_else(|| t.chapters.iter().rev().find(|c| s.visited.contains(&c.key)).map(|c| c.key.clone()))
                        .unwrap_or_else(|| t.start.clone());
                    s.status = Status::Waiting;
                    s.failure = Some("章节内容已调整，等待后续故事".into());
                }
            }
            state.news.retain(|_, n| {
                let Some(c) = n.id.strip_prefix(&format!("{}:", n.track)).and_then(|c| chapter(&n.track, c)) else {
                    return false;
                };
                n.persons.iter().all(|p| known(p))
                    && n.loc.is_none_or(|l| l.idx() < defs.locations.len())
                    && migrate_choice(c, &mut n.choice, n.choice_key.as_deref())
                    && (!n.timeout || (c.timeout.is_some() && (c.deadline.is_some() || c.deadline_days.is_some())))
                    && (n.success.is_none()
                        || n.choice.and_then(|i| c.choices.get(i as usize)).is_some_and(|o| {
                            // U02：掷骰规则下，只有数值门槛的选项也会有成败。
                            o.check.is_some() || (soft && (0..o.requires.len()).any(|i| o.soft_condition(i)))
                        }))
            });
            if state.last.as_mut().is_some_and(|last| {
                chapter(&last.track, &last.chapter).is_none_or(|c| {
                    !migrate_choice(c, &mut last.choice, last.choice_key.as_deref())
                        || last.variant.as_ref().is_some_and(|v| !c.variants.iter().any(|variant| &variant.key == v))
                }) || last.news.as_ref().is_some_and(|id| !state.news.contains_key(id))
            }) {
                state.last = None;
            }
            state.known_ties.retain(|t| known(&t.a) && known(&t.b) && source(&t.source));
            state.removed_ties.retain(|(a, b)| known(a) && known(b));
            state.completed_objectives.retain(|(t, c)| chapter(t, c).is_some());
            // 掷骰失败记录：内容调整后只留还存在的章节与选项。过期记录（轨道已换章或重新进入）
            // 本来就不生效，这里不动它，免得读档与不读档的状态出现差别。
            state.failed_choices.retain(|t, f| {
                let Some(c) = chapter(t, &f.chapter) else { return false };
                f.choices.retain(|key| c.choices.iter().any(|o| &o.key == key));
                !f.choices.is_empty()
            });
            state
                .variants_seen
                .retain(|(t, c, v)| chapter(t, c).is_some_and(|c| c.variants.iter().any(|x| &x.key == v)));
            state.families.retain(|key, _| {
                defs.story2.tracks.iter().flat_map(|t| &t.chapters).any(|c| c.family.as_ref() == Some(key))
            });
            state.pending.retain(|p| {
                chapter(&p.track, &p.chapter).is_some()
                    && state.tracks.get(&p.track).is_some_and(|s| s.status == Status::Active && s.chapter == p.chapter)
            });
            for p in &mut state.pending {
                if p.variant.as_ref().is_some_and(|v| {
                    chapter(&p.track, &p.chapter).is_none_or(|c| !c.variants.iter().any(|x| &x.key == v))
                }) {
                    p.variant = None;
                }
            }
        }
        // 读档沿用已出场日期，只移除暂时全锁的章并恢复投递优先级，不重新发放节奏预算。
        let mut pending = std::mem::take(&mut self.state.story2.pending);
        let mut locked = Vec::new();
        pending.retain(|p| {
            let open = self.state.story2.tracks.get(&p.track).is_some_and(|s| {
                self.defs
                    .story2
                    .track(&p.track)
                    .and_then(|t| t.chapter(&p.chapter))
                    .is_some_and(|c| !self.story2_choices_locked(c, s.entered))
            });
            if !open {
                locked.push(p.track.clone());
            }
            open
        });
        for track in locked {
            self.state.pacing.shown.remove(&track);
            self.state.pacing.held.remove(&track);
        }
        pending.sort_by_key(|p| (self.defs.story2.track(&p.track).map(|t| t.kind), p.track.clone(), p.chapter.clone()));
        self.state.story2.pending = pending;
        if before != self.state.story2 {
            self.push_log(LogEvent { day: self.day(), kind: LogKind::StoryReconciled });
        }
    }
}
