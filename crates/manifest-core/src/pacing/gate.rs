//! 节奏闸（P11 第二阶段）：新出场的事先过一道预算，扎堆的摊开。闸只管“什么时候出场”，不管“出不出”。
//!
//! 位置：[`World::refresh_story2`] 算出候选（选项全锁的章节不算候选，S02nZ5 起一律暂挂）之后、写回待决队列之前。
//! 规则（`rules.toml [pacing]`，[`PacingRules`]）关闭或正在跳过养成时不过闸，行为与没有闸时逐位相同。
//!
//! 规则（T 是今天）：
//! 1. 已经出过场的事原样留着：还在队列里的不动；出过场又暂时离开队列的（玩家走开了、进了别的场所），
//!    回来时仍用原来的出场日，不算新的一件，也不再记账（[`PacingState::shown`]）。
//! 2. 新候选按分类（[`World::pacing_classify_story2`]）处理：
//!    - 续章：放行，不记账；
//!    - 要紧的（[`BeatWeight::Key`]）：一律当天放行，记账——**要紧的事从不被按下**；
//!    - 可以等的（Major / Minor）：今天是它的最后一天（[`World::pacing_last_chance`]）就放行，不看上限；
//!      否则当天已放行数达到 `daily` 就按下；否则等满 `max_defer_days` 就放行；
//!      否则滚动窗口内可以等的事已放行数不到 `window_soft` 就放行；否则按下。
//!    - 同一次里多件可以等的事的先后见 [`SoftRank`]。
//! 3. 放行的事出场日是 T。按下的事不进队列：时钟不等它、界面看不见它，只记在 [`PacingState::held`] 里。
//! 4. `held` 与 `shown` 只留“轨道仍在进行、且仍停在那一章”的项。
//! 5. 别的来源的打断（怪异、幽灵船、待决海战、经典剧情）出现时各记一笔（[`World::pacing_note`]），
//!    不否决它们的生成。经典奇遇（S01 起寰宇出海后的随机小事）例外：它排在所有过闸的事后面，
//!    新一天的头一次刷新之后、今天还没有任何一件事出场且窗口上限没到时才生成
//!    （[`World::pacing_room_for_encounter`]）；没有名额就当今天没遇到，不记成“按着”。
//! 6. 日结进行到一半（收盘之后、当天最后一次刷新之前）的刷新不放行新候选，统一留到最后那一次：
//!    那一夜出现的事一起排先后，账也都记在玩家看到它们的那一天。结算一章之后、调用方收尾之前的那一次刷新
//!    （命令还没换阶段、没做正式的刷新）与养成剧本立起养成状态之前的刷新同样先不放行——
//!    半路上才成立一瞬间的候选不该占名额，也不该被记成“按着”。见 [`Refresh`]。
//!
//! 一天之内反复刷新是幂等的：出过场的不重复记账，按下的不重置起始日，账只增不减所以按下的仍然按着。

use super::{Beat, BeatSource, BeatWeight};
use crate::defs::PacingRules;
use crate::error::CoreError;
use crate::scenario::WorldDate;
use crate::story2::{Condition, Pending, Status, TrackKind};
use crate::world::World;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// 放行过的一次独立打断：哪一天出场、什么分量。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Released {
    pub day: u32,
    pub weight: BeatWeight,
}

/// 被按下、还没出场的一件事。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Held {
    pub chapter: String,
    /// 轨道进入这一章的日子：可重复的事件再回到同一章时是新的一件，旧记录就此作废。
    pub entered: u32,
    /// 头一次被按下的日子。
    pub since: u32,
}

/// 已经出过场、轨道还停在那一章的一件事。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Shown {
    pub chapter: String,
    /// 轨道进入这一章的日子（同 [`Held::entered`]）。
    pub entered: u32,
    /// 出场的日子。
    pub day: u32,
}

/// 闸的状态。规则关闭时永远是空的，不写进存档；旧档读进来也是空的（已经在待决队列里的事照旧留着）。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct PacingState {
    /// 最近放行的独立打断，只留滚动窗口内的。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub log: Vec<Released>,
    /// 被按下的事：轨道 → 章节与头一次被按下的日子（待决队列里一条轨道只有一项）。
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub held: BTreeMap<String, Held>,
    /// 出过场的事：轨道 → 章节与出场日。
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub shown: BTreeMap<String, Shown>,
}

impl PacingState {
    pub fn is_empty(&self) -> bool {
        self.log.is_empty() && self.held.is_empty() && self.shown.is_empty()
    }

    /// 账面：`today` 这一天已经放行几件，滚动窗口（含今天）内可以等的事放行了几件。
    pub fn budget(&self, rules: &PacingRules, today: u32) -> Budget {
        let mut budget = Budget::default();
        for r in &self.log {
            if r.day > today || r.day.saturating_add(rules.window_days) <= today {
                continue;
            }
            budget.today += u32::from(r.day == today);
            budget.soft += u32::from(r.weight != BeatWeight::Key);
        }
        budget
    }
}

/// 预算的账面。闸与审计的试算（`manifest-sim` 的 `pacing_audit`）共用它和 [`PacingRules::admits`]。
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Budget {
    /// 今天已经放行的独立打断（要紧的也算）。
    pub today: u32,
    /// 滚动窗口内已经放行的可以等的事。
    pub soft: u32,
}

impl Budget {
    /// 记一笔放行。
    pub fn note(&mut self, weight: BeatWeight) {
        self.today += 1;
        self.soft += u32::from(weight != BeatWeight::Key);
    }
}

impl PacingRules {
    /// 一件可以等的事此刻放不放行：最后一天不看上限；否则先看单日上限，再看等没等满，最后看窗口上限。
    pub fn admits(&self, budget: Budget, last_chance: bool, waited: u32) -> bool {
        last_chance || (budget.today < self.daily && (waited >= self.max_defer_days || budget.soft < self.window_soft))
    }
}

/// 同一次过闸的几件“可以等的事”的先后：今天是最后一天的 → 等满的（等得久的在前）→ 经旬调度入选的
/// （它们已经被旬配额筛过一次）→ Major 先于 Minor → 截止日早的 → 等得久的；再相同就按原来的稳定次序
/// （种类、轨道、章节）。
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct SoftRank {
    /// 0 最后一天，1 等满，2 其余。
    group: u8,
    /// 等满的按起始日排（早的在前）；其余为 0。
    overdue_since: u32,
    /// 没过旬配额的排在后面。
    unslotted: bool,
    weight: BeatWeight,
    deadline: u32,
    since: u32,
}

impl SoftRank {
    /// `since` 是它头一次被按下的日子（今天才来的就是今天）。
    pub fn new(rules: &PacingRules, today: u32, last_chance: bool, since: u32, beat: &Beat) -> Self {
        let overdue = today.saturating_sub(since) >= rules.max_defer_days;
        let group = if last_chance {
            0
        } else if overdue {
            1
        } else {
            2
        };
        Self {
            group,
            overdue_since: if group == 1 { since } else { 0 },
            unslotted: beat.slot.is_none(),
            weight: beat.weight,
            deadline: beat.deadline.unwrap_or(u32::MAX),
            since,
        }
    }
}

/// 审计用：一件被按着的事此刻的处境。
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct HeldBeat {
    pub track: String,
    pub chapter: String,
    /// 头一次被按下的日子。
    pub since: u32,
    /// 此刻仍是候选时的分类；不是候选（玩家不在那儿、条件暂时不满足）为 None。
    pub beat: Option<Beat>,
    /// 今天是它的最后一天。
    pub last_chance: bool,
    /// 按规则此刻本该放行。闸刚跑完时应当全是 false。
    pub due: bool,
}

/// 这一次刷新待决队列是在什么时候。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Refresh {
    /// 平常的刷新（一条命令执行完、到港、开局、读档之后）：闸照常放行与按下；日结进行到一半时不放行新候选。
    Normal,
    /// 日结末尾、新一天的头一次刷新：统一放行这一夜出现的事。
    DayStart,
    /// 结算一章之后、调用方收尾之前的那一次：只把队列理一遍，不放行也不按下新候选。
    Quiet,
}

struct Soft {
    pending: Pending,
    weight: BeatWeight,
    last_chance: bool,
    since: u32,
    entered: u32,
    rank: SoftRank,
    kind: Option<TrackKind>,
}

impl World {
    /// 规则开没开（`rules.toml [pacing]`）。
    pub fn pacing_enabled(&self) -> bool {
        self.defs.rules.pacing.enabled
    }

    /// 闸此刻管不管事：规则开启，而且不在跳过养成。
    pub(crate) fn pacing_active(&self) -> bool {
        if self.upbringing_cadence_enabled() {
            return false;
        }
        self.pacing_enabled() && !self.upbringing_skipping()
    }

    /// 养成剧本在立起养成状态之前（开局的头一次刷新、控制日之前的预演）还分不出养成期的类别：
    /// 这时先不放行新候选，等养成立起来的那一次刷新再过闸。
    fn pacing_settled(&self) -> bool {
        self.state.upbringing.is_some()
            || !self.defs.scenarios.get(self.state.scenario.idx()).is_some_and(|s| s.upbringing)
    }

    fn pacing_date(&self, day: u32) -> WorldDate {
        let date = self.defs.calendar.date_of(day);
        [(self.defs.rules.world.start_year + i64::from(date.year) - 1) as u32, date.month, date.day]
    }

    /// 别的来源的打断出现了（怪异、幽灵船、待决海战、经典剧情与奇遇）：给玩家看到它的那一天记一笔。
    /// 这些来源都在日结里生成、第二天摆到玩家面前；规则关闭时什么都不做。
    pub(crate) fn pacing_note(&mut self, weight: BeatWeight) {
        if !self.pacing_enabled() {
            return;
        }
        let day = self.state.day.saturating_add(u32::from(self.state.closed));
        self.pacing_note_seen(weight, day);
    }

    /// 给玩家看到它的那一天（`day`）记一笔；规则关闭时什么都不做。
    pub(crate) fn pacing_note_seen(&mut self, weight: BeatWeight, day: u32) {
        if !self.pacing_enabled() {
            return;
        }
        let window = self.defs.rules.pacing.window_days;
        let log = &mut self.state.pacing.log;
        log.retain(|r| r.day.saturating_add(window) > day);
        log.push(Released { day, weight });
    }

    /// 奇遇（经典的随机小事，S01）今天有没有名额：它是最不要紧的一类，排在所有过闸的事后面——
    /// 今天还没有任何一件事出场（单日不叠），而且滚动窗口内可以等的事没到上限，才轮得到它。
    /// 在新一天的头一次刷新之后问（[`World::story_encounter_day_start`]），那时这一夜过闸的事都已经记了账。
    pub(crate) fn pacing_room_for_encounter(&self) -> bool {
        let rules = &self.defs.rules.pacing;
        let budget = self.state.pacing.budget(rules, self.state.day);
        budget.today == 0 && rules.admits(budget, false, 0)
    }

    /// 今天是不是这件事的最后一天：过了今天它就不再是候选（按日历能预知的那些）。
    ///
    /// - 分类给出的截止日到了（章节的日期条件、窗口、期限，节庆窗口，依赖最近一旬活动的事件）；
    /// - 章节条件里的季节明天就过了、年龄上限明天就超了；
    /// - 养成期：明天结业或换阶段（家乡期的事带不到学院，学院的事带不出校门），
    ///   或者事件门槛里随日期变的那几条（阶段、月份、年份、人物的年龄与是否在场）明天不再成立。
    ///
    /// 闸据此保证“按下不会让一件事错过它自己的日子”。靠别的状态成立的条件（好感、金钱、物品）预看不了，
    /// 由审计按“按下之后没出场就走掉的”来量。
    pub fn pacing_last_chance(&self, p: &Pending) -> bool {
        let deadline = self.pacing_classify_story2(p).deadline;
        self.pacing_expiring(p, deadline)
    }

    fn pacing_expiring(&self, p: &Pending, deadline: Option<u32>) -> bool {
        let today = self.day();
        if deadline.is_some_and(|d| d <= today) {
            return true;
        }
        let Some(c) = self.defs.story2.track(&p.track).and_then(|t| t.chapter(&p.chapter)) else {
            return false;
        };
        let next = today.saturating_add(1);
        let tomorrow = self.pacing_date(next);
        let lapses = c.when.iter().any(|w| match w {
            Condition::Season { season } => self.defs.calendar.season_of(next).index() != *season as usize,
            Condition::Age { person, le: Some(le), .. } => person
                .as_ref()
                .map_or_else(
                    || self.state.protagonist.as_ref().and_then(|i| i.age_on(tomorrow)),
                    |key| self.defs.cast.person(key).and_then(|x| x.age_on(tomorrow)),
                )
                .is_some_and(|age| age > *le),
            _ => false,
        });
        if lapses {
            return true;
        }
        if !self.upbringing_active() {
            return false;
        }
        if let Some(f) = self.upbringing_family() {
            let current = self.upbringing_stage_on(self.cast_date()).map(|s| s.from);
            if tomorrow >= f.graduation
                || f.stages.iter().any(|s| s.from <= tomorrow && current.is_none_or(|from| s.from > from))
            {
                return true;
            }
        }
        self.defs.upbringing.event_gates.get(&p.track).is_some_and(|g| !self.upbringing_event_gate_dated(g, tomorrow))
    }

    /// 候选过闸，返回可以进待决队列的那些（次序由调用方排）。`candidates` 里已经在旧队列的项带着原来的出场日。
    /// 日结中途的刷新、结算一章之后半路上的刷新（见 [`Refresh`]）只留出过场的，不放行也不按下新候选。
    pub(crate) fn pacing_gate(&mut self, candidates: Vec<Pending>, mode: Refresh) -> Vec<Pending> {
        let rules = self.defs.rules.pacing.clone();
        let today = self.day();
        let open = match mode {
            Refresh::DayStart => true,
            Refresh::Normal => !self.state.closed,
            Refresh::Quiet => false,
        } && self.pacing_settled();
        let mut pacing = std::mem::take(&mut self.state.pacing);
        let tracks = &self.state.story2.tracks;
        // 记录指的是不是轨道此刻停着的这一章（同一章、同一次进入）。
        let current = |track: &str, chapter: &str, entered: u32| {
            tracks
                .get(track)
                .is_some_and(|s| s.status == Status::Active && s.chapter == chapter && s.entered == entered)
        };
        if open {
            pacing.held.retain(|track, h| current(track, &h.chapter, h.entered));
            pacing.shown.retain(|track, s| current(track, &s.chapter, s.entered));
            pacing.log.retain(|r| r.day.saturating_add(rules.window_days) > today);
        }
        let mut out = Vec::with_capacity(candidates.len());
        let mut fresh = Vec::new();
        for mut p in candidates {
            let entered = tracks.get(&p.track).map_or(p.day, |s| s.entered);
            let on_stage = self.state.story2.pending.iter().any(|q| q.track == p.track && q.chapter == p.chapter);
            let shown = pacing.shown.get(&p.track).filter(|s| current(&p.track, &s.chapter, s.entered)).map(|s| s.day);
            if on_stage {
                // 旧档、或者闸不管事时放进队列的：补一条记录，之后暂时离开队列再回来也认得。
                if open && shown.is_none() {
                    pacing.shown.insert(p.track.clone(), Shown { chapter: p.chapter.clone(), entered, day: p.day });
                }
                out.push(p);
            } else if let Some(day) = shown {
                p.day = day;
                out.push(p);
            } else {
                fresh.push((p, entered));
            }
        }
        if !open {
            self.state.pacing = pacing;
            return out;
        }
        let mut budget = pacing.budget(&rules, today);
        let mut soft = Vec::new();
        for (mut p, entered) in fresh {
            p.day = today;
            let beat = self.pacing_classify_story2(&p);
            if beat.source == BeatSource::Continuation || beat.weight == BeatWeight::Key {
                if beat.source != BeatSource::Continuation {
                    pacing.log.push(Released { day: today, weight: beat.weight });
                    budget.note(beat.weight);
                }
                pacing.held.remove(&p.track);
                pacing.shown.insert(p.track.clone(), Shown { chapter: p.chapter.clone(), entered, day: today });
                out.push(p);
                continue;
            }
            let since = pacing.held.get(&p.track).map_or(today, |h| h.since);
            let last_chance = self.pacing_expiring(&p, beat.deadline);
            soft.push(Soft {
                rank: SoftRank::new(&rules, today, last_chance, since, &beat),
                kind: self.defs.story2.track(&p.track).map(|t| t.kind),
                weight: beat.weight,
                last_chance,
                since,
                entered,
                pending: p,
            });
        }
        soft.sort_by(|a, b| {
            (a.rank, a.kind, &a.pending.track, &a.pending.chapter).cmp(&(
                b.rank,
                b.kind,
                &b.pending.track,
                &b.pending.chapter,
            ))
        });
        for s in soft {
            let p = s.pending;
            if rules.admits(budget, s.last_chance, today.saturating_sub(s.since)) {
                pacing.log.push(Released { day: today, weight: s.weight });
                budget.note(s.weight);
                pacing.held.remove(&p.track);
                pacing
                    .shown
                    .insert(p.track.clone(), Shown { chapter: p.chapter.clone(), entered: s.entered, day: today });
                out.push(p);
            } else {
                // 头一次被按下才记起始日；之后的每一次刷新都不重置（过期的记录上面已经清掉）。
                pacing.held.entry(p.track).or_insert(Held { chapter: p.chapter, entered: s.entered, since: today });
            }
        }
        self.state.pacing = pacing;
        out
    }

    /// 队首的 story2 章节是不是“刚出场”，值得让时钟停一下：今天出场的，或者今天是它的最后一天。
    /// 应用层据此决定暂停、旅店提前起床与概览的 `awaiting`——同一件事只在出场那天提醒一次，最后一天再提醒一次，
    /// 中间的日子不再天天把时钟叫停。规则关闭时、养成期里（那边由 `upbringing_waiting` 管）与原来一样：
    /// 只要队首是 story2 的章节就算。
    pub fn story2_front_fresh(&self) -> bool {
        if !self.story2_is_front() {
            return false;
        }
        if !self.pacing_enabled() || self.upbringing_active() {
            return true;
        }
        self.pending_story2().is_some_and(|p| p.day >= self.day() || self.pacing_last_chance(p))
    }

    /// 审计用：此刻被按着的事，连同它现在是不是候选、今天是不是最后一天、按规则该不该放。只读。
    pub fn pacing_held(&self) -> Vec<HeldBeat> {
        let rules = &self.defs.rules.pacing;
        let today = self.day();
        let budget = self.state.pacing.budget(rules, today);
        let excluded = self.excluded_protagonist_tracks();
        self.state
            .pacing
            .held
            .iter()
            .map(|(track, h)| {
                let pending = self
                    .state
                    .story2
                    .tracks
                    .get(track)
                    .filter(|s| {
                        s.status == Status::Active
                            && s.chapter == h.chapter
                            && s.entered == h.entered
                            && !excluded.contains(track)
                    })
                    .and_then(|s| self.story2_candidate(track, s))
                    .map(|variant| Pending { track: track.clone(), chapter: h.chapter.clone(), day: today, variant });
                let beat = pending.as_ref().map(|p| self.pacing_classify_story2(p));
                let last_chance =
                    pending.as_ref().zip(beat.as_ref()).is_some_and(|(p, b)| self.pacing_expiring(p, b.deadline));
                let due = beat.as_ref().is_some_and(|b| {
                    b.source == BeatSource::Continuation
                        || b.weight == BeatWeight::Key
                        || rules.admits(budget, last_chance, today.saturating_sub(h.since))
                });
                HeldBeat { track: track.clone(), chapter: h.chapter.clone(), since: h.since, beat, last_chance, due }
            })
            .collect()
    }

    /// 读档校验：拒绝未来日期，以及“同一章既按着又出过场”这种内核不可能写出的矛盾。
    pub(crate) fn validate_pacing_snapshot(&self) -> Result<(), CoreError> {
        let (s, day) = (&self.state.pacing, self.day());
        if s.log.iter().any(|r| r.day > day)
            || s.held.values().any(|h| h.since > day)
            || s.shown.values().any(|x| x.day > day)
            || s.held
                .iter()
                .any(|(track, h)| s.shown.get(track).is_some_and(|x| x.chapter == h.chapter && x.entered == h.entered))
        {
            return Err(CoreError::SnapshotMismatch("节奏状态含未来日期或内部矛盾".into()));
        }
        Ok(())
    }
}
