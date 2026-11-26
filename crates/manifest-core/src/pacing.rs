//! 事件节奏（P11）：把“让时钟停下来、等玩家回应的一件事”统一描述成一个节拍（[`Beat`]），再给新出场的事过一道闸。
//!
//! 分类（第一阶段）是纯函数、只读世界：调度、概率与规则仍在各自的模块里，这里只回答两个问题——
//!
//! - 这件待回应的事算哪一类、有多要紧（[`World::pacing_classify_story2`]）；
//! - 此刻有哪些事在等玩家（[`World::pacing_waiting`]）。
//!
//! 闸与预算（第二阶段，`gate` 子模块）按这里的分类决定新候选当天出场还是先按下，
//! 状态只有一小块（[`PacingState`]）；规则关闭时不过闸、不留状态，行为与没有闸时逐位相同。
//! 旧式剧情里的奇遇（S01 起寰宇出海后的随机小事）不被按下：规则开着时它等过闸的事排定之后、名额有剩才生成。
//!
//! 审计（`manifest-sim` 的 `pacing_audit`）按同一套分类记账。[`BeatSource`] 与 [`BeatWeight`] 只在末尾追加。

use crate::ids::OwnerId;
use crate::story::StorySource;
use crate::story2::{Pending, TrackKind};
use crate::upbringing::{EventTier, Phase, event_slot, infer_event_tier, is_letter, ordinary_event};
use crate::world::World;
use serde::{Deserialize, Serialize};

#[cfg(test)]
mod encounter_tests;
mod gate;
#[cfg(test)]
mod gate_tests;
#[cfg(test)]
mod refresh_equivalence;
#[cfg(test)]
mod tests;

pub(crate) use gate::Refresh;
pub use gate::{Budget, Held, HeldBeat, PacingState, Released, Shown, SoftRank};

/// 一次打断的来源。
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BeatSource {
    /// 养成的月程安排（每月排一次三旬）。
    Plan,
    /// 心情低谷事件（旬调度里当作今天截止、排在最前）。
    LowMood,
    /// 限时：节庆、生日、家人羁绊、校历、关键事件，带截止日或窗口的章节，
    /// 以及引擎按日期直接开启的入学、志向、告别与结业事件。
    Timed,
    /// 来信与新闻。
    Letter,
    /// 重点支线：旬配额 0 号位里不属于限时的。
    Focus,
    /// 普通短事件：旬配额 1 号位里可以延后的特别档。
    Ordinary,
    /// 日常池与占位：旬配额 1 号位里的填充档。
    Filler,
    /// 不经旬调度的轨道：羁绊线、学院自动线，以及由交谈或别的章节直接开启的线。
    Bond,
    /// 同一事件当场接着出的续章。
    Continuation,
    /// 出海后的 story2 轨道与经典故事线的章节。
    Story,
    /// 奇遇（经典奇遇，以及出海后短事件种类的 story2 轨道）。
    Encounter,
    /// 怪异遭遇。
    Creature,
    /// 待决海战。
    Battle,
}

impl BeatSource {
    /// 全部来源，按声明顺序。
    pub const ALL: [BeatSource; 13] = [
        BeatSource::Plan,
        BeatSource::LowMood,
        BeatSource::Timed,
        BeatSource::Letter,
        BeatSource::Focus,
        BeatSource::Ordinary,
        BeatSource::Filler,
        BeatSource::Bond,
        BeatSource::Continuation,
        BeatSource::Story,
        BeatSource::Encounter,
        BeatSource::Creature,
        BeatSource::Battle,
    ];

    /// 小写蛇形的名字，与序列化一致。
    pub fn key(self) -> &'static str {
        match self {
            BeatSource::Plan => "plan",
            BeatSource::LowMood => "low_mood",
            BeatSource::Timed => "timed",
            BeatSource::Letter => "letter",
            BeatSource::Focus => "focus",
            BeatSource::Ordinary => "ordinary",
            BeatSource::Filler => "filler",
            BeatSource::Bond => "bond",
            BeatSource::Continuation => "continuation",
            BeatSource::Story => "story",
            BeatSource::Encounter => "encounter",
            BeatSource::Creature => "creature",
            BeatSource::Battle => "battle",
        }
    }

    /// 缺省分量。
    ///
    /// - Key：月程不排时钟不走；心情低谷事件当天截止；限时章节过了窗口就按缺省分支走掉、只出一次的就此错过；
    ///   待决海战次日自动结算，输赢都落在玩家的船上。
    /// - Major：来信、重点支线、羁绊线、续章与出海后的故事——有分量，但章节不会过期（或窗口以旬、月计），晚几天出场不丢内容。
    /// - Minor：普通短事件、日常池、奇遇、怪异与幽灵船——可重复的点缀，少一次不影响任何进度。
    ///
    /// 主线轨道（[`TrackKind::Main`]）与经典故事线的章节不论来源一律按 Key，见 [`World::pacing_classify_story2`]。
    pub fn weight(self) -> BeatWeight {
        match self {
            BeatSource::Plan | BeatSource::LowMood | BeatSource::Timed | BeatSource::Battle => BeatWeight::Key,
            BeatSource::Letter
            | BeatSource::Focus
            | BeatSource::Bond
            | BeatSource::Continuation
            | BeatSource::Story => BeatWeight::Major,
            BeatSource::Ordinary | BeatSource::Filler | BeatSource::Encounter | BeatSource::Creature => {
                BeatWeight::Minor
            }
        }
    }
}

/// 一次打断的分量：闸与预算按它决定谁先放行、谁可以等。
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BeatWeight {
    /// 要紧，不能拖：拖过就错过、被自动结算，或者时钟走不下去。
    Key,
    /// 有分量，但晚几天出场不丢内容。
    Major,
    /// 点缀：少一次也无妨。
    Minor,
}

impl BeatWeight {
    /// 全部分量，按声明顺序。
    pub const ALL: [BeatWeight; 3] = [BeatWeight::Key, BeatWeight::Major, BeatWeight::Minor];

    /// 小写蛇形的名字，与序列化一致。
    pub fn key(self) -> &'static str {
        match self {
            BeatWeight::Key => "key",
            BeatWeight::Major => "major",
            BeatWeight::Minor => "minor",
        }
    }
}

/// 一次打断：一件在等玩家回应的事。
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Beat {
    pub source: BeatSource,
    pub weight: BeatWeight,
    /// 轨道、遭遇或战斗的 key；月程安排是 `年-月`。
    pub key: String,
    /// 章节 key（story2 与经典故事线的章节才有）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chapter: Option<String>,
    /// 出现的日子。
    pub since: u32,
    /// 最后一个还能回应的日子；不会过期的为 None。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deadline: Option<u32>,
    /// 养成期经旬调度入选时占的位（0 重点、1 短事件、2 来信）；没过旬配额的为 None。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub slot: Option<u8>,
}

impl World {
    /// 给 story2 待决队列里的一项分类。养成期与出海后都能用；只读，不改状态。
    ///
    /// 养成期按它怎么来到玩家面前分：
    /// - 上一章今天刚答完、当场接着出的是续章；
    /// - 经旬调度入选的（登记在 `activity_tracks` 里）按位与档次分——心情低谷、来信、限时、重点、普通、日常；
    /// - 没过旬配额的：来信照旧算来信；引擎按日期直接开启的（入学、校历、节庆、志向、告别、结业）与按 key 属于限时档的算限时；
    ///   其余（羁绊线、学院自动线、由交谈或别的章节开启的线）算 [`BeatSource::Bond`]。
    ///
    /// 出海后（或没有养成的世界）：续章、短事件种类的轨道算奇遇，带截止日或窗口的算限时，其余算故事。
    pub fn pacing_classify_story2(&self, p: &Pending) -> Beat {
        let beat = |source: BeatSource, weight: BeatWeight, deadline: Option<u32>, slot: Option<u8>| Beat {
            source,
            weight,
            key: p.track.clone(),
            chapter: Some(p.chapter.clone()),
            since: p.day,
            deadline,
            slot,
        };
        let Some((t, c)) = self.defs.story2.track(&p.track).and_then(|t| Some((t, t.chapter(&p.chapter)?))) else {
            // 定义已经不在（内容调整后的旧档）：不猜档次，按一般的故事算。
            return beat(BeatSource::Story, BeatWeight::Major, None, None);
        };
        let entered = self.state.story2.tracks.get(&p.track).map_or(p.day, |s| s.entered);
        let continuation = self.pacing_continuation(p);
        let (source, deadline, slot) = if self.upbringing_active() {
            let rank = self.upbringing_event_rank(&p.track, c, entered);
            // 经旬调度入选的轨道都登记在 activity_tracks 里（见 `upbringing_story_allowed`）；不在里面的没过旬配额。
            let slot = self
                .state
                .upbringing
                .as_ref()
                .is_some_and(|s| s.activity_tracks.contains(&p.track))
                .then(|| event_slot(t.kind, &p.track));
            let timed = rank.tier == EventTier::Timed || rank.deadline.is_some();
            let source = if continuation {
                BeatSource::Continuation
            } else if rank.low_mood {
                BeatSource::LowMood
            } else if is_letter(&p.track) {
                BeatSource::Letter
            } else {
                match slot {
                    Some(0) if timed => BeatSource::Timed,
                    Some(0) => BeatSource::Focus,
                    Some(slot) if !ordinary_event(slot, rank.tier, rank.deadline) => BeatSource::Timed,
                    Some(_) if rank.tier == EventTier::Filler => BeatSource::Filler,
                    Some(_) => BeatSource::Ordinary,
                    None => {
                        // 没过旬配额时章节自己的窗口不算数（羁绊线每章都有窗口），只看它是不是按日期开启的事件。
                        let gate = self.defs.upbringing.event_gates.get(&p.track);
                        if self.pacing_dated_event(&p.track)
                            || infer_event_tier(&p.track, gate, false) == EventTier::Timed
                        {
                            BeatSource::Timed
                        } else {
                            BeatSource::Bond
                        }
                    }
                }
            };
            (source, rank.deadline, slot)
        } else {
            let deadline = self.upbringing_event_deadline(&p.track, c, entered);
            let source = if continuation {
                BeatSource::Continuation
            } else if t.kind == TrackKind::Encounter {
                BeatSource::Encounter
            } else if deadline.is_some() {
                BeatSource::Timed
            } else {
                BeatSource::Story
            };
            (source, deadline, None)
        };
        // 主线不论怎么来的都要紧。
        let weight =
            if matches!(t.kind, TrackKind::Main | TrackKind::Guide) { BeatWeight::Key } else { source.weight() };
        beat(source, weight, deadline, slot)
    }

    /// 这一项是不是同一事件当场接着出的续章：轨道今天刚结算过上一章，接下来的章节不带新的日期条件或期限
    /// （与 `upbringing_story_settled` 保留出场许可用同一个判断），而且就在结算的当天出现。
    fn pacing_continuation(&self, p: &Pending) -> bool {
        self.state
            .story2
            .tracks
            .get(&p.track)
            .is_some_and(|s| s.chapter == p.chapter && s.entered == p.day && !s.visited.is_empty())
            && self.upbringing_direct_continuation(&p.track)
    }

    /// 引擎按日期或阶段直接开启（`refresh_upbringing_stage` 里的 `start_story2`）、不经旬调度的事件：
    /// 各阶段的入学事件、学院校历、节庆，以及志向谈话、家人告别与结业事件。
    fn pacing_dated_event(&self, key: &str) -> bool {
        let u = &self.defs.upbringing;
        self.upbringing_family().is_some_and(|f| {
            f.stages.iter().any(|s| s.entry_event.as_deref() == Some(key))
                || f.completion.as_ref().is_some_and(|c| {
                    [&c.event, &c.family_event, &c.choose_event].into_iter().flatten().any(|e| e == key)
                })
        }) || u.academies.iter().any(|a| a.calendar.iter().any(|m| m.event.as_deref() == Some(key)))
            || u.festivals.iter().any(|f| f.event.as_deref() == Some(key) || f.events.iter().any(|e| e == key))
    }

    /// 养成期在等玩家排月程时的那一个节拍；别的时候为 None。
    fn pacing_plan(&self) -> Option<Beat> {
        let s = self.state.upbringing.as_ref()?;
        if !self.upbringing_active() || s.skipping || s.phase != Phase::Plan {
            return None;
        }
        // 月初进入安排；月中换阶段会重新安排，开局可能不在 1 日。
        // U05 按周：常设课表铺不上才停下，一个月里可能停几次——按周记（周首日起算，key 带周序），免得同一件事记两次。
        let day = |date| crate::scenario::day_of(&self.defs, date).ok();
        let weekly = self.upbringing_weekly();
        let week = crate::upbringing::weekly::week_of(self.cast_date()[2]);
        let first = if weekly { crate::upbringing::weekly::week_start(week) } else { 1 };
        let since = day([s.month[0], s.month[1], first])
            .into_iter()
            .chain(s.stage_from.and_then(day))
            .chain([self.player_start_day()])
            .max()
            .unwrap_or(0)
            .min(self.day());
        Some(Beat {
            source: BeatSource::Plan,
            weight: BeatSource::Plan.weight(),
            key: if weekly {
                format!("{:04}-{:02}-w{}", s.month[0], s.month[1], week + 1)
            } else {
                format!("{:04}-{:02}", s.month[0], s.month[1])
            },
            chapter: None,
            since,
            deadline: None,
            slot: None,
        })
    }

    /// 此刻所有在等玩家回应的事：养成的月程安排、story2 待决队列的全部、经典剧情（章节或奇遇）、怪异遭遇、
    /// 幽灵船遭遇与玩家的待决海战。按（分量、来源、key、章节、出现日）排序，结果只取决于世界状态。
    ///
    /// 应用层的周界暂停不在其中（它不等回应，只等玩家开始下一周）。
    pub fn pacing_waiting(&self) -> Vec<Beat> {
        let mut out: Vec<Beat> = self.pacing_plan().into_iter().collect();
        out.extend(self.state.story2.pending.iter().map(|p| self.pacing_classify_story2(p)));
        if let Some(p) = &self.state.story.pending {
            out.push(match &p.source {
                // 经典故事线就是那一局的主线；章节一直等到玩家回应。
                StorySource::Chapter(i) => Beat {
                    source: BeatSource::Story,
                    weight: BeatWeight::Key,
                    key: self.story_def().map_or_else(|| "story".to_owned(), |s| s.key.clone()),
                    chapter: self.story_def().and_then(|s| s.chapters.get(*i as usize)).map(|c| c.key.clone()),
                    since: p.day,
                    deadline: None,
                    slot: None,
                },
                // 奇遇在出现的第二天结算时作罢（`story_expire`）。
                StorySource::Encounter(key) => Beat {
                    source: BeatSource::Encounter,
                    weight: BeatSource::Encounter.weight(),
                    key: key.clone(),
                    chapter: None,
                    since: p.day,
                    deadline: Some(p.day.saturating_add(1)),
                    slot: None,
                },
            });
        }
        if let Some((e, _)) = self.creature_pending() {
            // 怪异遭遇不会过期，一直等到玩家回应。
            out.push(Beat {
                source: BeatSource::Creature,
                weight: BeatSource::Creature.weight(),
                key: e.creature.clone(),
                chapter: None,
                since: e.day,
                deadline: None,
                slot: None,
            });
        }
        let battles = &self.state.battles;
        for p in battles.pending.values() {
            // 与应用层的待决海战列表同一口径：玩家的舰队，海盗还在。次日结算时自动开打（`battle_day`）。
            if self.state.fleets.get(&p.fleet).is_some_and(|f| f.owner == OwnerId::Player)
                && battles.pirates.contains_key(&p.pirate)
            {
                out.push(Beat {
                    source: BeatSource::Battle,
                    weight: BeatSource::Battle.weight(),
                    key: format!("battle:{}", p.id.0),
                    chapter: None,
                    since: p.day,
                    deadline: Some(p.day.saturating_add(1)),
                    slot: None,
                });
            }
        }
        out.sort_by(|a, b| {
            (a.weight, a.source, &a.key, &a.chapter, a.since).cmp(&(b.weight, b.source, &b.key, &b.chapter, b.since))
        });
        out
    }
}
