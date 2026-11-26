//! 事件节奏审计（P11）：按内核 [`manifest_core::pacing`] 的统一分类给每一次打断记账，统计密度、扎堆与通畅；
//! 节奏的闸开着时另外给闸记账（按下了多少、等了几天、有没有因为按下而丢内容）。
//!
//! - **养成整局**：复用 [`crate::upbringing_runs`] 的跑法（同一套自动安排、同一套回应），只挂一个只读的观察者记账，
//!   跑法与 `upbringing-runs` 逐位相同。
//! - **出海**：寰宇的自由航海剧本由套利 bot 代替玩家；另外让每一局养成结业后带着同一个世界接着出海。
//!   每天先把一早在等回应的事一件件答掉（剧情选能选的、怪异选第一个付得起的应对、幽灵船打招呼、海战自动结算），
//!   再让 bot 行动，行动引出的事也当天答掉，然后日结。
//! - 一件事只在它头一回出现的那天记一次（[`Ledger::observe`]）：等回应的几天里、掷骰失败后重选时都不重复记；
//!   闸开着时，出过场又暂时离开队列的事回来也不重复记（闸同样不把它当成新的一件）。
//!
//! 口径：
//! - **节拍**是 [`Beat`] 的全部，含月程安排与续章；**独立打断**不含这两类——月程每月固定一次，
//!   续章是同一件事当场翻到下一页，都不算新的一次打断。扎堆、每周、每日的统计都按独立打断算。
//! - 按月、按周的分布只统计完整的月与周（周照 P10 的分法：月内 1–7、8–14、15–21、22–28、29–月末）。
//! - **预算试算**（[`Trial`]）把记下的独立打断照原来的到达日放进与内核同一套规则的闸里重放，是没开闸时的一阶估计；
//!   **闸的实测**（[`GateStats`]）是开着闸真跑出来的。
//!
//! 报告只取决于数据与种子（不含耗时），两次审计可以直接比对。

use crate::bots::{Bot, BotKind};
use crate::session::GameSession;
use crate::upbringing_runs::{self, Answered, Observer, RunConfig};
use manifest_core::defs::PacingRules;
use manifest_core::log::LogKind;
use manifest_core::pacing::{Beat, BeatSource, BeatWeight, Budget, SoftRank};
use manifest_core::scenario::WorldDate;
use manifest_core::story2::Status;
use manifest_core::{Command, OwnerId, SaveFile, StaticData, World};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write as _;
use std::sync::Arc;

// ───────────────────────────── 记账 ─────────────────────────────

/// 一次打断的身份：key、章节与出现日。
type BeatId = (String, Option<String>, u32);

fn beat_id(b: &Beat) -> BeatId {
    (b.key.clone(), b.chapter.clone(), b.since)
}

/// 记下的一次打断。
#[derive(Clone, Debug, Serialize)]
pub struct BeatRecord {
    /// 记下的那一天（世界日序号）。
    pub day: u32,
    pub date: WorldDate,
    #[serde(flatten)]
    pub beat: Beat,
    /// 闸开着时：出场之前被按下了几天（没被按过的为 None）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub held_days: Option<u32>,
    /// 闸开着时：出场那天是不是它的最后一天（可以等的事才看）。
    #[serde(skip_serializing_if = "is_false")]
    pub last_chance: bool,
}

fn is_false(value: &bool) -> bool {
    !value
}

/// 闸按着的一件事（审计这边的记号）。
struct HeldMark {
    chapter: String,
    entered: u32,
    since: u32,
    /// 等满之后因为当天名额已满又排了几天；`queued_on` 是最近一次记数的日子。
    queued: u32,
    queued_on: Option<u32>,
    /// 按着的日子里它同时也是候选（玩家在场、条件满足）的天数；`present_on` 是最近一次记数的日子。
    present: u32,
    present_on: Option<u32>,
}

/// 一局里闸的流水。
#[derive(Default)]
struct GateTally {
    /// 被按下过的件数。
    held: u32,
    /// 被按下又出场的各等了几天（按日历）、其中在场的天数，以及出场的原因（最后一天、等满、名额空出来）。
    waits: Vec<u32>,
    presents: Vec<u32>,
    reasons: [u32; 3],
    /// 按着的时候没等到出场就走掉的（轨道 key）。
    dropped: Vec<String>,
    /// 等满之后因为当天名额已满又排的天数，最多的一件。
    queued_max: u32,
    /// 闸刚跑完、按规则却该放的次数（应当为 0）。
    violations: u32,
    /// 当天的独立打断超出“max(要紧件数, 单日上限) + 最后一天放行 + 不经闸的来源”的日子。
    over_days: Vec<WorldDate>,
    /// 闸记的当天放行数与这边记下的当天独立打断数对不上的天数。
    mismatch_days: u32,
    /// 排在队首、选项全锁、后面也没有答得了的章节（`轨道#章节`）：留在队列里，不挡别人。
    locked: BTreeSet<String>,
}

/// 时钟在等、却没有可回应的事的一天。
#[derive(Clone, Debug, Serialize)]
pub struct Stall {
    pub date: WorldDate,
    pub phase: String,
    /// 当时还在等的事的件数（为 0 就是彻底卡死）。
    pub waiting: usize,
}

/// 排在队首、却一个选项也交不上的章节：跑法只好让它作罢。
/// 养成期这种章节由引擎自动作罢；出海后引擎不管，真实对局里它会一直占着队首。
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Stuck {
    pub date: WorldDate,
    /// `轨道#章节`。
    pub chapter: String,
}

/// 引擎自动作罢的理由（`refresh_story2` 写进轨道的 failure）。
const ENGINE_ABANDONED: &str = "养成期待回应的章节选项全部锁住，自动作罢";

/// 一局的账本：逐日的打断与通畅检查。挂在整局跑法上当观察者，只读世界。
#[derive(Default)]
pub struct Ledger {
    first: Option<u32>,
    last: u32,
    /// 记下的打断，按出现先后。
    pub beats: Vec<BeatRecord>,
    /// 已经记过、还在等的，连同头一回看到它的那天。
    open: BTreeMap<BeatId, u32>,
    max_wait: u32,
    stalls: Vec<Stall>,
    diverged: Vec<WorldDate>,
    bot_abandoned: u32,
    /// 正要回应的 story2 队首（`轨道#章节`），以及一个选项也交不上的那些。
    head: Option<String>,
    stuck: Vec<Stuck>,
    cleared: u32,
    unanswered: u32,
    dice_retries: u32,
    result_before: Option<(String, String, Option<String>)>,
    engine_abandoned: BTreeSet<(u32, String, String)>,
    /// 日结前仍在进行的轨道：key、章节、进入日。
    active: Vec<(String, String, u32)>,
    active_day: u32,
    /// 日结里没等到出场就走掉的章节：轨道 key 与去向（0 缺省分支、1 超时分支、2 失败）。
    auto: Vec<(String, usize)>,
    /// 闸开着时：记过的 story2 章节（出过场又暂时离开队列的，回来不重复记）。
    seen: BTreeSet<BeatId>,
    /// 闸开着时：此刻按着的事（轨道 → 记号），以及闸的流水。
    held: BTreeMap<String, HeldMark>,
    gate: GateTally,
}

impl Ledger {
    /// 看一眼此刻在等的事：新出现的各记一次，不再等的销掉（顺便量它等了几天）。
    pub fn observe(&mut self, w: &World) {
        let day = w.day();
        self.first.get_or_insert(day);
        self.last = self.last.max(day);
        let gated = w.pacing_enabled();
        let rules = &w.defs.rules.pacing;
        let waiting = w.pacing_waiting();
        let ids: BTreeSet<BeatId> = waiting.iter().map(beat_id).collect();
        let mut longest = self.max_wait;
        self.open.retain(|id, seen| {
            // 还在等的也量一下：一直没人回应的事同样算数。
            longest = longest.max(day.saturating_sub(*seen));
            ids.contains(id)
        });
        self.max_wait = longest;
        for beat in waiting {
            let id = beat_id(&beat);
            if let std::collections::btree_map::Entry::Vacant(slot) = self.open.entry(id.clone()) {
                slot.insert(day);
                // story2 的章节过闸：出过场、暂时离开队列又回来的还是原来那一件（出场日不变），不重复记。
                let through_gate = gated
                    && w.state
                        .story2
                        .pending
                        .iter()
                        .any(|p| Some(&p.chapter) == beat.chapter.as_ref() && p.track == beat.key);
                if through_gate && !self.seen.insert(id) {
                    continue;
                }
                let mut record = BeatRecord { day, date: w.cast_date(), beat, held_days: None, last_chance: false };
                if through_gate && record.beat.weight != BeatWeight::Key && independent(&record.beat) {
                    record.last_chance = w
                        .state
                        .story2
                        .pending
                        .iter()
                        .find(|p| p.track == record.beat.key && Some(&p.chapter) == record.beat.chapter.as_ref())
                        .is_some_and(|p| w.pacing_last_chance(p));
                    if let Some(mark) =
                        self.held.remove(&record.beat.key).filter(|m| Some(&m.chapter) == record.beat.chapter.as_ref())
                    {
                        let waited = day.saturating_sub(mark.since);
                        record.held_days = Some(waited);
                        self.gate.waits.push(waited);
                        self.gate.presents.push(mark.present);
                        let reason = if record.last_chance {
                            0
                        } else if waited >= rules.max_defer_days {
                            1
                        } else {
                            2
                        };
                        self.gate.reasons[reason] += 1;
                        self.gate.queued_max = self.gate.queued_max.max(mark.queued);
                    }
                }
                self.beats.push(record);
            }
        }
        if gated {
            self.observe_gate(w);
        }
        self.scan_abandoned(w);
    }

    /// 闸此刻按着什么：新按下的记一笔；不再按着、又没出场的算走掉了；顺便核对闸有没有该放不放。
    fn observe_gate(&mut self, w: &World) {
        let day = w.day();
        let rules = &w.defs.rules.pacing;
        let current = &w.state.pacing.held;
        let gone: Vec<String> = self
            .held
            .iter()
            .filter(|(track, m)| current.get(*track).is_none_or(|h| h.chapter != m.chapter || h.entered != m.entered))
            .map(|(track, _)| track.clone())
            .collect();
        for track in gone {
            self.held.remove(&track);
            self.gate.dropped.push(track);
        }
        for (track, h) in current {
            if !self.held.contains_key(track) {
                self.gate.held += 1;
                self.held.insert(
                    track.clone(),
                    HeldMark {
                        chapter: h.chapter.clone(),
                        entered: h.entered,
                        since: h.since,
                        queued: 0,
                        queued_on: None,
                        present: 0,
                        present_on: None,
                    },
                );
            }
        }
        for h in w.pacing_held() {
            if h.due {
                self.gate.violations += 1;
            }
            if h.beat.is_some()
                && let Some(mark) = self.held.get_mut(&h.track)
                && mark.present_on != Some(day)
            {
                mark.present += 1;
                mark.present_on = Some(day);
            }
            // 等满了、此刻也是候选，却还按着：只能是当天的名额已经满了（否则上面就记了一次该放没放）。
            if h.beat.is_some()
                && day.saturating_sub(h.since) >= rules.max_defer_days
                && let Some(mark) = self.held.get_mut(&h.track)
                && mark.queued_on != Some(day)
            {
                mark.queued += 1;
                mark.queued_on = Some(day);
                self.gate.queued_max = self.gate.queued_max.max(mark.queued);
            }
        }
    }

    /// 一天的回应都做完了：核对这一天的独立打断有没有超出闸的口径，闸的账与这边的账对不对得上。
    fn close_gate_day(&mut self, w: &World) {
        if w.upbringing_cadence_enabled() {
            return;
        }
        let day = w.day();
        let rules = &w.defs.rules.pacing;
        // bot 一批命令之间可能短暂放行又离开队列；闸的账仍须包含这些尚未被跑法观察的项。
        let unseen: Vec<_> = w
            .state
            .pacing
            .shown
            .iter()
            .filter(|(_, s)| s.day == day)
            .map(|(track, s)| {
                let pending = manifest_core::story2::Pending {
                    track: track.clone(),
                    chapter: s.chapter.clone(),
                    day: s.day,
                    variant: None,
                };
                BeatRecord {
                    day,
                    date: w.cast_date(),
                    beat: w.pacing_classify_story2(&pending),
                    held_days: None,
                    last_chance: w.pacing_last_chance(&pending),
                }
            })
            .filter(|b| !self.seen.contains(&beat_id(&b.beat)))
            .collect();
        let (mut total, mut key, mut exempt) = (0_u32, 0_u32, 0_u32);
        for b in self.beats.iter().rev().take_while(|b| b.day == day).chain(&unseen).filter(|b| independent(&b.beat)) {
            total += 1;
            if b.beat.weight == BeatWeight::Key {
                key += 1;
            } else if b.last_chance
                || b.beat.source == BeatSource::Creature
                || (b.beat.source == BeatSource::Encounter && b.beat.chapter.is_none())
            {
                // 最后一天的放行不看上限；怪异不经闸（只记账）。
                // 经典奇遇（S01 起寰宇出海后的奇遇）自己查名额：当天已有别的事出场、或窗口满了就不出；
                // 可它出场之后，同一天里玩家的命令再引出要紧的事照样放行，所以这条口径里仍把它算在上限之外
                // （它自己守不守“单日不叠”，由 `manifest-sim --test terra16_encounters_s01` 逐日核对）。
                exempt += 1;
            }
        }
        if total > key.max(rules.daily) + exempt {
            self.gate.over_days.push(w.cast_date());
        }
        let noted = w.state.pacing.log.iter().filter(|r| r.day == day).count() as u32;
        if noted != total {
            self.gate.mismatch_days += 1;
        }
    }

    /// 养成期被引擎自动作罢的章节（日志只留最近若干条，所以每次都扫、按日期与章节去重）。
    fn scan_abandoned(&mut self, w: &World) {
        for e in &w.state.log {
            if let LogKind::Story2Abandoned { track, chapter } = &e.kind {
                self.engine_abandoned.insert((e.day, track.clone(), chapter.clone()));
            }
        }
    }

    fn last_result(w: &World) -> Option<(String, String, Option<String>)> {
        w.state.story2.last.as_ref().map(|l| (l.track.clone(), l.chapter.clone(), l.choice_key.clone()))
    }
}

impl Observer for Ledger {
    fn before_answer(&mut self, w: &World) {
        self.observe(w);
        self.result_before = Self::last_result(w);
        self.head = w.pending_story2().filter(|_| w.story2_is_front()).map(|p| format!("{}#{}", p.track, p.chapter));
    }
    fn after_answer(&mut self, w: &World, outcome: Answered) {
        match outcome {
            Answered::Abandoned => {
                self.bot_abandoned += 1;
                let chapter = self.head.take().unwrap_or_default();
                self.stuck.push(Stuck { date: w.cast_date(), chapter });
            }
            Answered::Cleared => self.cleared += 1,
            Answered::Submitted | Answered::Nothing => {}
        }
        // 掷骰失败又没有失败分支：留在原节点重选，不算新的打断。
        if w.state.story2.last.as_ref().is_some_and(|l| l.soft_fail.is_some())
            && Self::last_result(w) != self.result_before
        {
            self.dice_retries += 1;
        }
        self.observe(w);
    }
    fn before_plan(&mut self, w: &World) {
        self.observe(w);
    }
    fn before_day(&mut self, w: &World) {
        self.observe(w);
        if w.pacing_enabled() {
            self.close_gate_day(w);
        }
        if w.upbringing_waiting() {
            self.stalls.push(Stall {
                date: w.cast_date(),
                phase: w.state.upbringing.as_ref().map(|s| format!("{:?}", s.phase)).unwrap_or_default(),
                waiting: w.pacing_waiting().len(),
            });
        }
        self.active_day = w.day();
        self.active = w
            .state
            .story2
            .tracks
            .iter()
            .filter(|(_, s)| s.status == Status::Active)
            .map(|(k, s)| (k.clone(), s.chapter.clone(), s.entered))
            .collect();
    }
    fn after_day(&mut self, w: &World) {
        // 日结里没有玩家的回应：这一天里换了章节或结束的轨道，都是窗口到期后按缺省、超时分支走掉的，或者就此失败的。
        for (key, chapter, entered) in std::mem::take(&mut self.active) {
            let Some(s) = w.state.story2.tracks.get(&key) else { continue };
            if s.status == Status::Active && s.chapter == chapter && s.entered == entered {
                continue;
            }
            if s.status == Status::Failed && s.chapter == chapter {
                if s.failure.as_deref() != Some(ENGINE_ABANDONED) {
                    self.auto.push((key, 2));
                }
                continue;
            }
            let timed_out = w
                .defs
                .story2
                .track(&key)
                .and_then(|t| t.chapter(&chapter))
                .and_then(|c| w.story2_deadline(c, entered))
                .is_some_and(|d| self.active_day >= d);
            self.auto.push((key, usize::from(timed_out)));
        }
        self.scan_abandoned(w);
    }
    fn diverged(&mut self, w: &World) {
        self.diverged.push(w.cast_date());
    }
}

// ───────────────────────────── 出海的跑法 ─────────────────────────────

/// 把此刻在等回应的事一件件答掉：剧情选能选的（同养成整局的回应），怪异选第一个付得起的应对，
/// 幽灵船打招呼（她提出加入时婉拒），海战交给自动结算。答不上的留着，记一笔。
fn respond(session: &mut GameSession, ledger: &mut Ledger, ordinal: &mut u64) {
    let owner = OwnerId::Player;
    let (mut creature_stuck, mut story_locked) = (false, false);
    let mut battles_stuck = BTreeSet::new();
    for _ in 0..1_000 {
        ledger.observe(&session.world);
        let w = &session.world;
        // 闸开着时答得了的章节排在前面：队首还是一个选项也交不上，说明队列里没有答得了的——留着它，不替玩家作罢
        // （没开闸时它会一直占着队首，跑法只好让它作罢，见 [`Stuck`]）。
        if !story_locked
            && w.pacing_enabled()
            && w.story2_is_front()
            && let Some(p) = w.pending_story2()
            && w.state.story2.tracks.get(&p.track).is_some_and(|s| {
                w.defs
                    .story2
                    .track(&p.track)
                    .and_then(|t| t.chapter(&p.chapter))
                    .is_some_and(|c| w.story2_choices_locked(c, s.entered))
            })
        {
            ledger.gate.locked.insert(format!("{}#{}", p.track, p.chapter));
            story_locked = true;
        }
        if !story_locked && (w.pending_story2().is_some() || w.state.story.pending.is_some()) {
            *ordinal += 1;
            ledger.before_answer(&session.world);
            let outcome = upbringing_runs::answer(&mut session.world, *ordinal);
            ledger.after_answer(&session.world, outcome);
            continue;
        }
        let creature = (!creature_stuck)
            .then(|| w.creature_pending())
            .flatten()
            .map(|(e, c)| (e.id.clone(), c.responses.iter().copied().find(|r| w.creature_response_ready(*r).is_ok())));
        if let Some((encounter, response)) = creature {
            let answered = response.is_some_and(|response| {
                session.submit(Command::RespondCreature { owner, encounter, response }).is_ok()
            });
            if !answered {
                creature_stuck = true;
                ledger.unanswered += 1;
            }
            continue;
        }
        let battle = w
            .state
            .battles
            .pending
            .values()
            .find(|p| !battles_stuck.contains(&p.id) && w.state.fleets.get(&p.fleet).is_some_and(|f| f.owner == owner))
            .map(|p| p.id);
        if let Some(battle) = battle {
            if session.submit(Command::EngageBattle { owner, battle, tactical: false }).is_err() {
                battles_stuck.insert(battle);
                ledger.unanswered += 1;
            }
            continue;
        }
        if session.world.act_running() {
            match session.world.act_bot_step() {
                Ok(true) => continue,
                Ok(false) => {}
                Err(_) => {
                    ledger.diverged.push(session.world.cast_date());
                    return;
                }
            }
        }
        return;
    }
    ledger.diverged.push(session.world.cast_date());
}

/// 出海跑 `days` 天；返回实际跑完的天数。
fn sail(session: &mut GameSession, ledger: &mut Ledger, days: u32, errors: &mut Vec<String>) -> u32 {
    let mut bot = Bot::new(SEA_BOT);
    let mut ordinal = 0_u64;
    for done in 0..days {
        // 玩家是先看到摆在面前的事、再安排今天的航行：先把一早在等的事答掉，再让 bot 行动，行动引出的事也当天答掉。
        // （第一阶段的基线是先行动后回应：bot 一早开船离港时，当天刚出场的章节还没被看见就离开了队列，
        //   要等它回到那座港才被记下——记到了回来的那一天。）
        respond(session, ledger, &mut ordinal);
        bot.act(session);
        respond(session, ledger, &mut ordinal);
        ledger.before_day(&session.world);
        if let Err(e) = session.advance_day() {
            errors.push(format!("{:?} 日结失败：{e}", session.world.cast_date()));
            return done;
        }
        ledger.after_day(&session.world);
    }
    days
}

/// 出海段代替玩家的 bot（与 `manifest-cli simulate` 的缺省相同）。
pub const SEA_BOT: BotKind = BotKind::Arbitrage;

// ───────────────────────────── 统计 ─────────────────────────────

fn round2(x: f64) -> f64 {
    (x * 100.0).round() / 100.0
}

fn pct(part: u64, whole: u64) -> f64 {
    if whole == 0 { 0.0 } else { round2(part as f64 * 100.0 / whole as f64) }
}

fn date_at(defs: &StaticData, day: u32) -> WorldDate {
    let d = defs.calendar.date_of(day);
    [(defs.rules.world.start_year + i64::from(d.year) - 1) as u32, d.month, d.day]
}

/// 一组非负整数的分布：均值、中位、P90（都按最近秩取）与最大。
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct Dist {
    /// 样本数（月数或周数）。
    pub n: u32,
    pub total: u64,
    pub mean: f64,
    pub median: u32,
    pub p90: u32,
    pub max: u32,
}

impl Dist {
    fn of(values: &[u32]) -> Self {
        let mut v = values.to_vec();
        v.sort_unstable();
        let n = v.len();
        let total: u64 = v.iter().map(|x| u64::from(*x)).sum();
        // 最近秩：第 ceil(p × n) 个。
        let rank = |p: usize| if n == 0 { 0 } else { v[(n * p).div_ceil(100).max(1) - 1] };
        Self {
            n: n as u32,
            total,
            mean: if n == 0 { 0.0 } else { round2(total as f64 / n as f64) },
            median: rank(50),
            p90: rank(90),
            max: v.last().copied().unwrap_or(0),
        }
    }
}

/// 某一天的例子：扎堆最厉害的几天各有哪些事。
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct DayExample {
    pub run: String,
    pub date: WorldDate,
    pub count: u32,
    pub beats: Vec<String>,
}

/// 一种口径下打断在时间上的分布。
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct Spread {
    /// 观察期里的总次数（含不完整的月与周）。
    pub total: u64,
    /// 每月次数（只计完整的月）。
    pub monthly: Dist,
    /// 完整的周数，以及每周次数是 0、1、2、3、4 次及以上的周数。
    pub weeks: u32,
    pub weekly: [u32; 5],
    pub weekly_max: u32,
    /// 每周次数的均值、中位与 P90。
    pub weekly_dist: Dist,
    /// 月内第 1–5 周各自的平均次数（第 5 周是 29 日到月末的余日）。
    pub week_position: [f64; 5],
    /// 观察的天数，以及每天次数是 0、1、2、3、4 次及以上的天数。
    pub days: u32,
    pub daily: [u32; 5],
    pub day_max: u32,
    pub days_ge2: u32,
    pub days_ge3: u32,
    pub days_ge4: u32,
    /// 任意连续 7 天里最多几次。
    pub rolling7_max: u32,
    /// 最长连续多少天一次也没有。
    pub longest_quiet: u32,
    /// 月内每个日子的平均次数（下标 0 是 1 日）。
    pub day_of_month: Vec<f64>,
    /// 次数最多的几天。
    pub worst_days: Vec<DayExample>,
}

/// 一局、一种口径下的原始样本。
#[derive(Default)]
struct Sample {
    total: u64,
    months: Vec<u32>,
    weeks: Vec<(u8, u32)>,
    days: Vec<(u32, u32)>,
    rolling7: u32,
    quiet: u32,
    worst: Vec<DayExample>,
}

impl Spread {
    fn of(samples: &[Sample]) -> Self {
        let months: Vec<u32> = samples.iter().flat_map(|s| s.months.iter().copied()).collect();
        let weeks: Vec<u32> = samples.iter().flat_map(|s| s.weeks.iter().map(|(_, count)| *count)).collect();
        let mut out = Self {
            total: samples.iter().map(|s| s.total).sum(),
            monthly: Dist::of(&months),
            weekly_dist: Dist::of(&weeks),
            rolling7_max: samples.iter().map(|s| s.rolling7).max().unwrap_or(0),
            longest_quiet: samples.iter().map(|s| s.quiet).max().unwrap_or(0),
            ..Self::default()
        };
        let mut position = [(0_u64, 0_u32); 5];
        for (index, count) in samples.iter().flat_map(|s| s.weeks.iter().copied()) {
            out.weeks += 1;
            out.weekly[count.min(4) as usize] += 1;
            out.weekly_max = out.weekly_max.max(count);
            let slot = &mut position[usize::from(index.min(4))];
            *slot = (slot.0 + u64::from(count), slot.1 + 1);
        }
        for (i, (sum, n)) in position.into_iter().enumerate() {
            out.week_position[i] = if n == 0 { 0.0 } else { round2(sum as f64 / f64::from(n)) };
        }
        let mut by_dom = [(0_u64, 0_u32); 31];
        for (dom, count) in samples.iter().flat_map(|s| s.days.iter().copied()) {
            out.days += 1;
            out.daily[count.min(4) as usize] += 1;
            out.day_max = out.day_max.max(count);
            out.days_ge2 += u32::from(count >= 2);
            out.days_ge3 += u32::from(count >= 3);
            out.days_ge4 += u32::from(count >= 4);
            let slot = &mut by_dom[(dom.clamp(1, 31) - 1) as usize];
            *slot = (slot.0 + u64::from(count), slot.1 + 1);
        }
        out.day_of_month =
            by_dom.iter().map(|(sum, n)| if *n == 0 { 0.0 } else { round2(*sum as f64 / f64::from(*n)) }).collect();
        let mut worst: Vec<DayExample> = samples.iter().flat_map(|s| s.worst.iter().cloned()).collect();
        worst.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| (&a.run, a.date).cmp(&(&b.run, b.date))));
        worst.truncate(5);
        out.worst_days = worst;
        out
    }
}

/// 一局的观察期：每天的日期，完整的月与周。
struct Frame {
    first: u32,
    dates: Vec<WorldDate>,
    /// 完整的月在 `dates` 里的下标区间 [from, to)。
    months: Vec<(usize, usize)>,
    /// 完整的周：下标区间与它在月内的位置（0–4）。
    weeks: Vec<(usize, usize, u8)>,
}

impl Frame {
    /// 观察期 [first, end)。
    fn new(defs: &StaticData, first: u32, end: u32) -> Self {
        let dates: Vec<WorldDate> = (first..end).map(|d| date_at(defs, d)).collect();
        let n = dates.len();
        let (mut months, mut weeks) = (Vec::new(), Vec::new());
        // U05：规则里写了按周排程的世界每月固定四周（第四周 22 日到月末）；别的世界照 P10 的五段。
        let last_start = if defs.rules.upbringing.weekly.is_some() { 22 } else { 29 };
        for (i, date) in dates.iter().enumerate() {
            let len = defs.calendar.months().get(date[1] as usize - 1).copied().map_or(30, usize::from);
            let dom = date[2] as usize;
            if dom == 1 && i + len <= n {
                months.push((i, i + len));
            }
            // P10 的周：1–7、8–14、15–21、22–28、29–月末；按周排程的世界：1–7、8–14、15–21、22–月末。
            if dom % 7 == 1 && dom <= last_start {
                let last = if dom == last_start { len } else { (dom + 6).min(len) };
                let span = last + 1 - dom;
                if i + span <= n {
                    weeks.push((i, i + span, ((dom - 1) / 7) as u8));
                }
            }
        }
        Self { first, dates, months, weeks }
    }
}

/// 一局的记录，统计用。
struct RunData<'a> {
    label: String,
    family: &'a str,
    frame: Frame,
    beats: &'a [BeatRecord],
}

impl RunData<'_> {
    fn sample(&self, keep: &dyn Fn(&Beat) -> bool) -> Sample {
        let n = self.frame.dates.len();
        let mut counts = vec![0_u32; n];
        for b in self.beats.iter().filter(|b| keep(&b.beat)) {
            if let Some(slot) = b.day.checked_sub(self.frame.first).and_then(|i| counts.get_mut(i as usize)) {
                *slot += 1;
            }
        }
        let sum = |from: usize, to: usize| counts[from..to].iter().sum::<u32>();
        let mut rolling7 = 0;
        let mut window = 0_u32;
        let (mut quiet, mut run) = (0_u32, 0_u32);
        for (i, c) in counts.iter().enumerate() {
            window += c;
            if i >= 7 {
                window -= counts[i - 7];
            }
            rolling7 = rolling7.max(window);
            run = if *c == 0 { run + 1 } else { 0 };
            quiet = quiet.max(run);
        }
        let mut order: Vec<usize> = (0..n).filter(|i| counts[*i] >= 2).collect();
        order.sort_by(|a, b| counts[*b].cmp(&counts[*a]).then(a.cmp(b)));
        let worst = order
            .into_iter()
            .take(3)
            .map(|i| DayExample {
                run: self.label.clone(),
                date: self.frame.dates[i],
                count: counts[i],
                beats: self
                    .beats
                    .iter()
                    .filter(|b| b.day == self.frame.first + i as u32 && keep(&b.beat))
                    .map(|b| match &b.beat.chapter {
                        Some(c) => format!("{}:{}#{c}", b.beat.source.key(), b.beat.key),
                        None => format!("{}:{}", b.beat.source.key(), b.beat.key),
                    })
                    .collect(),
            })
            .collect();
        Sample {
            total: counts.iter().map(|c| u64::from(*c)).sum(),
            months: self.frame.months.iter().map(|(from, to)| sum(*from, *to)).collect(),
            weeks: self.frame.weeks.iter().map(|(from, to, index)| (*index, sum(*from, *to))).collect(),
            days: counts.iter().enumerate().map(|(i, c)| (self.frame.dates[i][2], *c)).collect(),
            rolling7,
            quiet,
            worst,
        }
    }
}

/// 独立打断：不含月程安排与续章。
fn independent(b: &Beat) -> bool {
    independent_source(b.source)
}

fn independent_source(source: BeatSource) -> bool {
    !matches!(source, BeatSource::Plan | BeatSource::Continuation)
}

/// 一类来源的每月分布。
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct SourceStat {
    pub total: u64,
    /// 占全部节拍的百分比。
    pub share_pct: f64,
    /// 其中没过旬配额的（`slot` 为空）。
    pub unscheduled: u64,
    pub monthly: Dist,
}

/// 一档分量的每月分布（按独立打断）。
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct WeightStat {
    pub total: u64,
    /// 占独立打断的百分比。
    pub share_pct: f64,
    pub monthly: Dist,
}

/// 一类来源里出现最多的内容族。
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct GroupCount {
    pub group: String,
    pub count: u64,
}

/// 一段（一局或若干局合计）的统计。
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct Stats {
    pub runs: u32,
    /// 观察的天数、完整的月数与周数。
    pub days: u32,
    pub months: u32,
    pub weeks: u32,
    /// 全部节拍（含月程安排与续章）的总数与每月分布。
    pub beats: u64,
    pub monthly: Dist,
    pub by_source: BTreeMap<BeatSource, SourceStat>,
    pub by_weight: BTreeMap<BeatWeight, WeightStat>,
    /// 独立打断（不含月程安排与续章）。
    pub events: Spread,
    /// 独立打断里要紧的（Key）。
    pub key: Spread,
    /// 独立打断里不要紧的（Major 与 Minor）。
    pub non_key: Spread,
    /// 独立打断里没过旬配额的（只对养成期有意义）。
    pub unscheduled: Spread,
    /// 来源是 bond 的。
    pub bond: Spread,
    /// 独立打断还能拖几天（截止日 − 出现日），按分量：没有截止日、0 天、1–3 天、4–9 天、10 天及以上各几件。
    pub slack: BTreeMap<BeatWeight, [u64; 5]>,
    /// 各来源里出现最多的内容族（每类至多 6 个）。
    pub groups: BTreeMap<BeatSource, Vec<GroupCount>>,
}

/// 一次打断的内容族：story2 的章节按轨道 key 归类，其余（月程、怪异、幽灵船、海战）就是来源本身。
fn group_of(b: &Beat, family: &str) -> String {
    if b.chapter.is_none() { b.source.key().to_owned() } else { group_of_key(&b.key, family) }
}

/// 内容族：把轨道 key 归到它的一类——本家事件取家庭名后的第一段，其余取前缀。
fn group_of_key(key: &str, family: &str) -> String {
    let word =
        |s: &str| s.split('_').find(|t| !t.is_empty() && !t.bytes().all(|c| c.is_ascii_digit())).map(str::to_owned);
    if !family.is_empty()
        && let Some(rest) = key.strip_prefix(&format!("c9_{family}_"))
    {
        return format!("c9_<家>_{}", word(rest).unwrap_or_default());
    }
    let mut parts = key.split('_');
    let head = parts.next().unwrap_or_default();
    // c8_ / c9_ / c10_ 这类批次前缀后面的一段才是内容族。
    let batch = head.len() > 1 && head.starts_with('c') && head[1..].bytes().all(|c| c.is_ascii_digit());
    match parts.next() {
        Some(second) if batch => format!("{head}_{second}"),
        _ => head.to_owned(),
    }
}

fn stats(runs: &[RunData]) -> Stats {
    let spread = |keep: &dyn Fn(&Beat) -> bool| -> Spread {
        let samples: Vec<Sample> = runs.iter().map(|r| r.sample(keep)).collect();
        Spread::of(&samples)
    };
    let all = spread(&|_| true);
    let events = spread(&independent);
    let mut by_source = BTreeMap::new();
    let mut groups = BTreeMap::new();
    for source in BeatSource::ALL {
        let s = spread(&|b| b.source == source);
        if s.total == 0 {
            continue;
        }
        let unscheduled = runs
            .iter()
            .flat_map(|r| r.beats.iter())
            .filter(|b| b.beat.source == source && b.beat.slot.is_none())
            .count() as u64;
        by_source.insert(
            source,
            SourceStat { total: s.total, share_pct: pct(s.total, all.total), unscheduled, monthly: s.monthly },
        );
        let mut tally = BTreeMap::<String, u64>::new();
        for r in runs {
            for b in r.beats.iter().filter(|b| b.beat.source == source) {
                *tally.entry(group_of(&b.beat, r.family)).or_default() += 1;
            }
        }
        let mut top: Vec<GroupCount> = tally.into_iter().map(|(group, count)| GroupCount { group, count }).collect();
        top.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.group.cmp(&b.group)));
        top.truncate(6);
        groups.insert(source, top);
    }
    let mut by_weight = BTreeMap::new();
    let mut slack = BTreeMap::new();
    for weight in BeatWeight::ALL {
        let s = spread(&|b| independent(b) && b.weight == weight);
        by_weight
            .insert(weight, WeightStat { total: s.total, share_pct: pct(s.total, events.total), monthly: s.monthly });
        let mut buckets = [0_u64; 5];
        for b in runs.iter().flat_map(|r| r.beats.iter()).filter(|b| independent(&b.beat) && b.beat.weight == weight) {
            let bucket = match b.beat.deadline.map(|d| d.saturating_sub(b.day)) {
                None => 0,
                Some(0) => 1,
                Some(1..=3) => 2,
                Some(4..=9) => 3,
                Some(_) => 4,
            };
            buckets[bucket] += 1;
        }
        slack.insert(weight, buckets);
    }
    Stats {
        runs: runs.len() as u32,
        days: all.days,
        months: all.monthly.n,
        weeks: all.weeks,
        beats: all.total,
        monthly: all.monthly,
        by_source,
        by_weight,
        key: spread(&|b| independent(b) && b.weight == BeatWeight::Key),
        non_key: spread(&|b| independent(b) && b.weight != BeatWeight::Key),
        unscheduled: spread(&|b| independent(b) && b.slot.is_none()),
        bond: spread(&|b| b.source == BeatSource::Bond),
        events,
        slack,
        groups,
    }
}

/// 预算试算的一格：把记下的独立打断照原来的到达日放进一道闸里重放，规则与内核的闸是同一套
/// （[`PacingRules::admits`] 与 [`SoftRank`]）：
///
/// - 要紧的事从不被按下：照原来的日子出场，也占当天的名额；
/// - 可以等的事：到了截止日（最后一天）放行，不看上限；否则当天已放行数达到单日上限就按下；
///   否则等满“最久等”的天数就放行；否则滚动窗口内可以等的事已放行数不到窗口上限就放行；否则按下。
///   同一天的先后也照内核：最后一天的 → 等满的（等得久的在前）→ 经旬调度入选的 → Major 先于 Minor → 截止日早的 → 等得久的。
///
/// 这是一阶估计：只挪出场的日子，不模拟推迟引起的连锁变化（后续章节、窗口与心情都照记下的走），
/// 也看不到内核按日历预看的那几种“最后一天”（换阶段、结业、季节与事件门槛的日期条件）。
/// 没开闸时用它估计开闸的效果；开着闸时把实测的记录再过一遍，应当几乎不再有被按下的。
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct Trial {
    pub daily: u32,
    pub window_days: u32,
    pub window_soft: u32,
    pub max_defer_days: u32,
    /// 到达的件数：要紧的（照出）、可以等的。
    pub key_arrivals: u64,
    pub arrivals: u64,
    /// 被按下过的可以等的事：件数、占比，等了几天（平均、P90、最久）。
    pub delayed: u64,
    pub delayed_pct: f64,
    pub mean_delay: f64,
    pub p90_delay: u32,
    pub max_delay: u32,
    /// 被按下又出场的原因：到了最后一天、等满了、名额空出来了。前两种是“破例放行”（当时窗口或当天的名额其实满着）。
    pub by_last_day: u64,
    pub by_full_wait: u64,
    pub by_budget: u64,
    /// 破例放行（最后一天 + 等满）占可以等的事的百分比。
    pub forced_pct: f64,
    /// 重放后的单日最多；超过单日上限的天数，其中不是要紧事自己顶破的（有“最后一天”的放行）。
    pub day_max: u32,
    pub days_over: u32,
    pub days_over_by_last_day: u32,
    /// 重放后任意连续 `window_days` 天里可以等的事最多几件。
    pub window_max: u32,
    /// 重放后每周可以等的事的次数（P10 的周，只计完整的周）。
    pub weekly: Dist,
    /// 观察期结束时还压着没放的件数。
    pub backlog: u64,
}

/// 闸里排队的一件可以等的事。
struct Queued {
    beat: Beat,
    /// 到达日、截止日（观察期里的下标；没有截止日为 None）。
    arrived: usize,
    deadline: Option<usize>,
    order: usize,
}

fn trial(runs: &[RunData], rules: &PacingRules) -> Trial {
    let mut t = Trial {
        daily: rules.daily,
        window_days: rules.window_days,
        window_soft: rules.window_soft,
        max_defer_days: rules.max_defer_days,
        ..Trial::default()
    };
    let mut delays: Vec<u32> = Vec::new();
    let mut weekly: Vec<u32> = Vec::new();
    let window = rules.window_days.max(1) as usize;
    for r in runs {
        let n = r.frame.dates.len();
        let mut arrivals: Vec<Vec<Queued>> = (0..n).map(|_| Vec::new()).collect();
        let mut keys = vec![0_u32; n];
        for (order, b) in r.beats.iter().enumerate().filter(|(_, b)| independent(&b.beat)) {
            let Some(i) = b.day.checked_sub(r.frame.first).map(|i| i as usize).filter(|i| *i < n) else { continue };
            if b.beat.weight == BeatWeight::Key {
                keys[i] += 1;
                t.key_arrivals += 1;
                continue;
            }
            t.arrivals += 1;
            let deadline = b.beat.deadline.map(|d| (d.saturating_sub(r.frame.first) as usize).max(i));
            arrivals[i].push(Queued { beat: b.beat.clone(), arrived: i, deadline, order });
        }
        let mut queue: Vec<Queued> = Vec::new();
        // 每天放行的可以等的事（滚动窗口与每周的统计都从这里数）。
        let mut soft = vec![0_u32; n];
        for (i, arrived) in arrivals.iter_mut().enumerate() {
            queue.append(arrived);
            let in_window: u32 = soft[i.saturating_sub(window - 1)..i].iter().sum();
            let mut budget = Budget { today: keys[i], soft: in_window };
            let last = |q: &Queued| q.deadline.is_some_and(|d| d <= i);
            queue.sort_by_key(|q| (SoftRank::new(rules, i as u32, last(q), q.arrived as u32, &q.beat), q.order));
            let mut kept = Vec::new();
            let mut forced_last = false;
            for q in queue.drain(..) {
                let waited = (i - q.arrived) as u32;
                if !rules.admits(budget, last(&q), waited) {
                    kept.push(q);
                    continue;
                }
                if waited > 0 {
                    delays.push(waited);
                    if last(&q) {
                        t.by_last_day += 1;
                    } else if waited >= rules.max_defer_days {
                        t.by_full_wait += 1;
                    } else {
                        t.by_budget += 1;
                    }
                }
                forced_last |= last(&q) && budget.today >= rules.daily;
                budget.note(q.beat.weight);
                soft[i] += 1;
            }
            // 头一回被按下的在这里计数：今天到、今天没出的。
            t.delayed += kept.iter().filter(|q| q.arrived == i).count() as u64;
            queue = kept;
            t.day_max = t.day_max.max(budget.today);
            t.days_over += u32::from(budget.today > rules.daily);
            t.days_over_by_last_day += u32::from(budget.today > rules.daily && forced_last);
            t.window_max = t.window_max.max(in_window + soft[i]);
        }
        t.backlog += queue.len() as u64;
        weekly.extend(r.frame.weeks.iter().map(|(from, to, _)| soft[*from..*to].iter().sum::<u32>()));
    }
    let total: u64 = delays.iter().map(|d| u64::from(*d)).sum();
    t.delayed_pct = pct(t.delayed, t.arrivals);
    t.mean_delay = if delays.is_empty() { 0.0 } else { round2(total as f64 / delays.len() as f64) };
    let dist = Dist::of(&delays);
    t.p90_delay = dist.p90;
    t.max_delay = dist.max;
    t.forced_pct = pct(t.by_last_day + t.by_full_wait, t.arrivals);
    t.weekly = Dist::of(&weekly);
    t
}

/// 预算试算的网格。没开闸时：单日上限试 1–3，窗口上限从“刚好大于可以等的事的周均到达数”起试三档
/// （再小就放不完、越攒越多），最久等一旬与三周，窗口天数照规则；规则里写的那一格不在网格里就补上。
/// 开着闸时只按规则把实测的记录再过一遍。
fn trials(runs: &[RunData], non_key: &Spread, rules: &PacingRules) -> Vec<Trial> {
    if rules.enabled {
        return vec![trial(runs, rules)];
    }
    let floor = non_key.weekly_dist.mean.floor() as u32 + 1;
    let mut grid = Vec::new();
    for daily in [1, 2, 3] {
        for window_soft in floor..floor + 3 {
            for max_defer_days in [10, 21] {
                grid.push(PacingRules { daily, window_soft, max_defer_days, ..rules.clone() });
            }
        }
    }
    if !grid.contains(rules) {
        grid.push(rules.clone());
    }
    grid.iter().map(|rules| trial(runs, rules)).collect()
}

/// 闸的实测（规则开着时才有）：按下了多少、等了几天、为什么放行、有没有因为按下而丢内容，以及闸自己守不守规矩。
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct GateStats {
    /// 出场的可以等的事（独立打断里分量不是要紧的）。
    pub soft: u64,
    /// 被按下过的件数（出了场的、期末还按着的、按着的时候走掉的都算），以及占全部可以等的事的百分比。
    pub held: u64,
    pub held_pct: f64,
    /// 被按下又出场的：件数与等了几天（按日历，从头一次被按下到出场）。
    pub released: u64,
    pub wait: Dist,
    /// 其中它同时也是候选（玩家在场、条件满足）的天数：出海后章节多绑着港口，玩家走开的日子不算闸在按着它。
    pub present: Dist,
    /// 被按下又出场的原因：到了最后一天、等满了、名额空出来了。
    pub by_last_day: u64,
    pub by_full_wait: u64,
    pub by_budget: u64,
    /// 没被按过、出场那天正好是最后一天的（闸不看上限放行）。
    pub fresh_last_day: u64,
    /// 期末仍按着的。
    pub still_held: u64,
    /// 按着的时候没等到出场就走掉的（轨道换了章节、结束或失败），合计与按内容族。
    pub dropped: u64,
    pub dropped_groups: BTreeMap<String, u32>,
    /// 等满之后因为当天名额已满又排了几天，最多的一件。
    pub queued_days_max: u32,
    /// 闸刚跑完、按规则却该放的次数（应当为 0）。
    pub violations: u32,
    /// 当天的独立打断超出“max(当天要紧件数, 单日上限) + 最后一天放行 + 不经闸的来源”的天数（应当为 0）。
    pub over_days: u32,
    pub over_examples: Vec<String>,
    /// 闸记的当天放行数与审计记下的当天独立打断数对不上的天数。
    pub mismatch_days: u32,
    /// 选项全锁、留在队列末尾等条件的章节（`轨道#章节`）各出现在几局里。
    pub locked: BTreeMap<String, u32>,
}

/// “通畅”检查的计数。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Flow {
    pub runs: u32,
    /// 养成：结业的局数；出海：跑满天数的局数。
    pub finished: u32,
    /// 出错停下的局数。
    pub failed: u32,
    /// 时钟在等、却没有可回应的事的天数。
    pub stalls: u32,
    /// 同一天回应不收敛的天数。
    pub diverged: u32,
    /// 一件事从出现到被答掉（或不再等）最久隔了几天。
    pub max_wait_days: u32,
    /// 养成期所有选项都被硬条件锁住、被引擎自动作罢的章节（`Story2Abandoned`）。
    pub engine_abandoned: u32,
    /// 跑法里一个选项也交不上、只好作罢的 story2 章节。
    pub bot_abandoned: u32,
    /// 跑法里清掉的旧式剧情。
    pub cleared: u32,
    /// 出海时答不上、留到过期的事（怪异、幽灵船、海战）。
    pub unanswered: u32,
    /// 没等到出场，窗口到期后按缺省分支走掉的章节。
    pub auto_default: u32,
    /// 没等到出场，期限到了按超时分支走掉的章节。
    pub auto_timeout: u32,
    /// 窗口到期时条件仍不满足（或缺分支）而失败的章节。
    pub auto_failed: u32,
    /// 掷骰失败后留在原处重选的次数（不计入打断）。
    pub dice_retries: u32,
}

impl Flow {
    fn add(&mut self, o: &Flow) {
        self.runs += o.runs;
        self.finished += o.finished;
        self.failed += o.failed;
        self.stalls += o.stalls;
        self.diverged += o.diverged;
        self.max_wait_days = self.max_wait_days.max(o.max_wait_days);
        self.engine_abandoned += o.engine_abandoned;
        self.bot_abandoned += o.bot_abandoned;
        self.cleared += o.cleared;
        self.unanswered += o.unanswered;
        self.auto_default += o.auto_default;
        self.auto_timeout += o.auto_timeout;
        self.auto_failed += o.auto_failed;
        self.dice_retries += o.dice_retries;
    }
}

/// 一局的审计结果。
#[derive(Clone, Debug, Serialize)]
pub struct RunAudit {
    /// 家庭 key；自由航海是剧本 key。
    pub family: String,
    /// 养成的自动安排预设；出海是 bot 的名字。
    pub preset: String,
    pub seed: u64,
    pub start: WorldDate,
    /// 观察期的最后一天之后的那一天。
    pub end: WorldDate,
    /// 养成：是否结业；出海：是否跑满天数。
    pub finished: bool,
    pub errors: Vec<String>,
    pub stalls: Vec<Stall>,
    pub diverged: Vec<WorldDate>,
    /// 排在队首、却一个选项也交不上的章节。
    pub stuck: Vec<Stuck>,
    pub flow: Flow,
    /// 养成期写好的限时内容：出场了几条 / 门槛日期到了的有几条（按 `c9_<家>_<类>_*` 的门槛 key 统计）。
    pub coverage: BTreeMap<String, [u32; 2]>,
    /// 没等到出场就走掉的章节，按内容族：缺省分支、超时分支、失败各几章。
    pub auto_settled: BTreeMap<String, [u32; 3]>,
    /// 闸的实测（规则开着时才有）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gate: Option<GateStats>,
    pub stats: Stats,
    #[serde(skip)]
    beats: Vec<BeatRecord>,
    #[serde(skip)]
    window: (u32, u32),
    /// 被按下又出场的各等了几天、其中在场的天数（合计时要原始样本）。
    #[serde(skip)]
    waits: Vec<u32>,
    #[serde(skip)]
    presents: Vec<u32>,
}

impl RunAudit {
    /// 这一局记下的全部打断，按出现先后。
    pub fn beats(&self) -> &[BeatRecord] {
        &self.beats
    }

    fn label(&self) -> String {
        format!("{}/{}/{}", self.family, self.preset, self.seed)
    }

    fn data<'a>(&'a self, defs: &StaticData) -> RunData<'a> {
        RunData {
            label: self.label(),
            family: &self.family,
            frame: Frame::new(defs, self.window.0, self.window.1),
            beats: &self.beats,
        }
    }
}

/// 写好的限时内容的几类（门槛 key：`c9_<家>_<类>_*`）。
const COVERAGE_PARTS: [&str; 4] = ["family_bond", "festival", "birthday", "critical"];

/// 一局是谁跑的。
struct Runner<'a> {
    family: &'a str,
    preset: &'a str,
    seed: u64,
    /// 养成整局跑完时的世界：据此统计限时内容的覆盖（出海段不统计，为 None）。
    graduate: Option<&'a World>,
}

fn finish(defs: &StaticData, run: Runner, ledger: Ledger, end: u32, finished: bool, errors: Vec<String>) -> RunAudit {
    let Runner { family, preset, seed, graduate } = run;
    let first = ledger.first.unwrap_or(end);
    // 出错停在半路时，看过的最后一天也算在观察期里。
    let end = if ledger.first.is_some() { end.max(ledger.last + 1) } else { end };
    let mut auto_settled = BTreeMap::<String, [u32; 3]>::new();
    let mut auto = [0_u32; 3];
    for (key, way) in &ledger.auto {
        auto_settled.entry(group_of_key(key, family)).or_default()[*way] += 1;
        auto[*way] += 1;
    }
    let flow = Flow {
        runs: 1,
        finished: u32::from(finished),
        failed: u32::from(!errors.is_empty()),
        stalls: ledger.stalls.len() as u32,
        diverged: ledger.diverged.len() as u32,
        max_wait_days: ledger.max_wait,
        engine_abandoned: ledger.engine_abandoned.len() as u32,
        bot_abandoned: ledger.bot_abandoned,
        cleared: ledger.cleared,
        unanswered: ledger.unanswered,
        auto_default: auto[0],
        auto_timeout: auto[1],
        auto_failed: auto[2],
        dice_retries: ledger.dice_retries,
    };
    let seen: BTreeSet<&str> = ledger.beats.iter().map(|b| b.beat.key.as_str()).collect();
    // 门槛日期至少早于结束前 30 天的才计入（最后一个月刚到的来不及出现；与 U03 的整局测试同一口径）。
    let due_by = end.saturating_sub(30);
    let mut coverage = BTreeMap::new();
    for (part, w) in COVERAGE_PARTS.iter().filter_map(|part| Some((part, graduate?))) {
        let prefix = format!("c9_{family}_{part}_");
        // 改投了别的学院的局，原学院那一路的门槛（`not_flag` 是路线旗标、或写明了别的学院）不算到期。
        let attended = |academy: &String| {
            w.upbringing_family().is_some_and(|f| f.stages.iter().any(|s| s.academy.as_ref() == Some(academy)))
        };
        let due: Vec<&String> = defs
            .upbringing
            .event_gates
            .iter()
            .filter(|(k, g)| {
                k.starts_with(&prefix)
                    && g.from.is_none_or(|d| manifest_core::scenario::day_of(defs, d).is_ok_and(|d| d <= due_by))
                    && g.not_flag.as_deref().is_none_or(|flag| !w.upbringing_flag(flag))
                    && g.academy.as_ref().is_none_or(attended)
            })
            .map(|(k, _)| k)
            .collect();
        if !due.is_empty() {
            let shown = due.iter().filter(|k| seen.contains(k.as_str())).count() as u32;
            coverage.insert((*part).to_owned(), [shown, due.len() as u32]);
        }
    }
    let gate = defs.rules.pacing.enabled.then(|| {
        let g = &ledger.gate;
        let soft =
            ledger.beats.iter().filter(|b| independent(&b.beat) && b.beat.weight != BeatWeight::Key).count() as u64;
        let (still_held, dropped) = (ledger.held.len() as u64, g.dropped.len() as u64);
        let mut dropped_groups = BTreeMap::<String, u32>::new();
        for key in &g.dropped {
            *dropped_groups.entry(group_of_key(key, family)).or_default() += 1;
        }
        GateStats {
            soft,
            held: u64::from(g.held),
            held_pct: pct(u64::from(g.held), soft + still_held + dropped),
            released: g.waits.len() as u64,
            wait: Dist::of(&g.waits),
            present: Dist::of(&g.presents),
            by_last_day: u64::from(g.reasons[0]),
            by_full_wait: u64::from(g.reasons[1]),
            by_budget: u64::from(g.reasons[2]),
            fresh_last_day: ledger.beats.iter().filter(|b| b.last_chance && b.held_days.is_none()).count() as u64,
            still_held,
            dropped,
            dropped_groups,
            queued_days_max: g.queued_max,
            violations: g.violations,
            over_days: g.over_days.len() as u32,
            over_examples: g.over_days.iter().take(5).map(|d| date_text(*d)).collect(),
            mismatch_days: g.mismatch_days,
            locked: g.locked.iter().map(|chapter| (chapter.clone(), 1)).collect(),
        }
    });
    let mut audit = RunAudit {
        family: family.to_owned(),
        preset: preset.to_owned(),
        seed,
        start: date_at(defs, first),
        end: date_at(defs, end),
        finished,
        errors,
        stalls: ledger.stalls,
        diverged: ledger.diverged,
        stuck: ledger.stuck,
        flow,
        coverage,
        auto_settled,
        gate,
        stats: Stats::default(),
        beats: ledger.beats,
        window: (first, end),
        waits: ledger.gate.waits,
        presents: ledger.gate.presents,
    };
    audit.stats = stats(&[audit.data(defs)]);
    audit
}

/// 一局养成整局的审计；`sea_days > 0` 时结业后带着同一个世界接着出海，另成一局。
pub fn audit_upbringing(defs: &Arc<StaticData>, cfg: &RunConfig, sea_days: u32) -> (RunAudit, Option<RunAudit>) {
    let mut ledger = Ledger::default();
    let (report, world) = upbringing_runs::run_observed(defs.clone(), cfg, &mut ledger);
    let end = world.as_ref().map_or(0, World::day);
    let run = Runner { family: &cfg.family, preset: &cfg.preset, seed: cfg.seed, graduate: world.as_ref() };
    let audit = finish(defs, run, ledger, end, report.graduated, report.errors);
    let sea = world.filter(|_| sea_days > 0 && audit.finished).map(|world| {
        let mut ledger = Ledger::default();
        let mut errors = Vec::new();
        let first = world.day();
        let session = upbringing_runs::start_params(defs, &cfg.family, cfg.seed)
            .ok_or_else(|| "没有这个家庭的开局参数".to_owned())
            .and_then(|start| {
                let save = SaveFile::new(defs, start, world.state, Vec::new());
                GameSession::from_save(defs.clone(), save).map_err(|e| e.to_string())
            });
        let done = match session {
            Ok(mut session) => sail(&mut session, &mut ledger, sea_days, &mut errors),
            Err(e) => {
                errors.push(format!("结业后的世界接不上出海：{e}"));
                0
            }
        };
        ledger.first.get_or_insert(first);
        let run = Runner { family: &cfg.family, preset: SEA_BOT.name(), seed: cfg.seed, graduate: None };
        finish(defs, run, ledger, first + done, done == sea_days, errors)
    });
    (audit, sea)
}

/// 自由航海的玩家在成年创建页立身世（没有身世问答的世界才有这一页，寰宇即是）：审计照做，
/// 否则“只在立过身世的对局里发生”的事（出海后的奇遇）在这一段里一件也量不到。
/// 自由点数按组平均撒开，生日取缺省年龄；有身世问答的世界（经典）照旧不立，与原来的跑法相同。
pub fn adult_captain(session: &mut GameSession) {
    let w = &session.world;
    let captain = &w.defs.captain;
    if !captain.enabled() || !captain.questions.is_empty() || w.captain_profile(OwnerId::Player).is_some() {
        return;
    }
    let mut alloc = vec![0i64; captain.attributes.len()];
    for group in &captain.groups {
        let members: Vec<usize> =
            captain.attributes.iter().enumerate().filter(|(_, a)| a.group == group.key).map(|(i, _)| i).collect();
        if members.is_empty() {
            continue;
        }
        for n in 0..group.free.max(0) as usize {
            alloc[members[n % members.len()]] += 1;
        }
    }
    let start = w.defs.rules.world.calendar_year(w.defs.calendar.date_of(w.player_start_day()).year);
    let birthday = manifest_core::captain::Birthday { year: start - captain.points.age_default, month: 6, day: 1 };
    // 立不成（数据另有约束）就照没有身世跑：这一段少量到奇遇，不让审计因此失败。
    let _ = session.submit(Command::CreateCaptain {
        owner: OwnerId::Player,
        birthday,
        answers: Vec::new(),
        alloc,
        genius: None,
    });
}

/// 自由航海剧本出海 `days` 天的审计（剧本取平衡观测的缺省：寰宇是 `free_1557`）。
pub fn audit_free_sea(defs: &Arc<StaticData>, seed: u64, days: u32) -> RunAudit {
    let mut ledger = Ledger::default();
    let mut errors = Vec::new();
    let session = crate::balance::default_scenario(defs).and_then(|scenario| {
        let mut session = GameSession::new(defs.clone(), scenario, seed)?;
        session.choose_info(manifest_core::info::InfoMode::Carried)?;
        adult_captain(&mut session);
        Ok(session)
    });
    let (key, first, done) = match session {
        Ok(mut session) => {
            let key = defs.scenarios[session.world.state.scenario.idx()].key.clone();
            let first = session.day();
            (key, first, sail(&mut session, &mut ledger, days, &mut errors))
        }
        Err(e) => {
            errors.push(format!("开局失败：{e}"));
            (String::new(), 0, 0)
        }
    };
    ledger.first.get_or_insert(first);
    let run = Runner { family: &key, preset: SEA_BOT.name(), seed, graduate: None };
    finish(defs, run, ledger, first + done, done == days, errors)
}

// ───────────────────────────── 报告 ─────────────────────────────

/// 审计的参数。
#[derive(Clone, Debug, Serialize)]
pub struct AuditConfig {
    pub families: Vec<String>,
    pub presets: Vec<String>,
    pub seeds: Vec<u64>,
    /// 每 n 场新开放的比赛点一次报名（与 `upbringing-runs` 相同）。
    pub register_every: u32,
    #[serde(skip)]
    pub threads: usize,
    /// 出海段的天数；0 表示不跑出海。
    pub sea_days: u32,
}

/// 轨道盘点：有多少轨道走哪条路来到玩家面前（只看数据，不跑模拟）。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Inventory {
    pub tracks: usize,
    /// 自动开始的轨道。
    pub auto: usize,
    /// 学院轨道（养成期放行）。
    pub academy: usize,
    /// 自动开始的学院轨道：养成期不经旬调度。
    pub auto_academy: usize,
    /// 其中没有短事件门槛的。
    pub auto_academy_ungated: usize,
    /// 有短事件门槛（每旬都是候选）的轨道。
    pub gated: usize,
    pub by_kind: BTreeMap<String, usize>,
}

fn inventory(defs: &StaticData) -> Inventory {
    let gates = &defs.upbringing.event_gates;
    let mut out = Inventory { tracks: defs.story2.tracks.len(), ..Inventory::default() };
    for t in &defs.story2.tracks {
        out.auto += usize::from(t.auto);
        out.academy += usize::from(t.academy);
        out.auto_academy += usize::from(t.auto && t.academy);
        out.auto_academy_ungated += usize::from(t.auto && t.academy && !gates.contains_key(&t.key));
        out.gated += usize::from(gates.contains_key(&t.key));
        let kind = serde_json::to_value(t.kind).ok().and_then(|v| v.as_str().map(str::to_owned)).unwrap_or_default();
        *out.by_kind.entry(kind).or_default() += 1;
    }
    out
}

/// 若干局的合计与各局。
#[derive(Clone, Debug, Serialize)]
pub struct Section {
    pub flow: Flow,
    pub coverage: BTreeMap<String, [u32; 2]>,
    /// 没等到出场就走掉的章节，按内容族：缺省分支、超时分支、失败各几章。
    pub auto_settled: BTreeMap<String, [u32; 3]>,
    /// 排在队首、却一个选项也交不上的章节（`轨道#章节`）各出现在几局里。
    pub stuck: BTreeMap<String, u32>,
    /// 闸的实测（规则开着时才有）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gate: Option<GateStats>,
    pub total: Stats,
    /// 预算试算（只对养成期做）。
    pub trials: Vec<Trial>,
    pub runs: Vec<RunAudit>,
}

impl Section {
    /// 用别的预算把这一段记下的独立打断再重放一遍（规则见 [`Trial`]；只看四个数值，不看 `enabled`）。
    pub fn trial(&self, defs: &StaticData, rules: &PacingRules) -> Trial {
        let data: Vec<RunData> = self.runs.iter().map(|r| r.data(defs)).collect();
        trial(&data, rules)
    }
}

/// 各局的闸合成一段的。
fn gate_total(runs: &[RunAudit]) -> Option<GateStats> {
    let mut total = GateStats::default();
    let (mut waits, mut presents) = (Vec::new(), Vec::new());
    let mut any = false;
    for r in runs {
        let Some(g) = &r.gate else { continue };
        any = true;
        total.soft += g.soft;
        total.held += g.held;
        total.released += g.released;
        total.by_last_day += g.by_last_day;
        total.by_full_wait += g.by_full_wait;
        total.by_budget += g.by_budget;
        total.fresh_last_day += g.fresh_last_day;
        total.still_held += g.still_held;
        total.dropped += g.dropped;
        for (group, n) in &g.dropped_groups {
            *total.dropped_groups.entry(group.clone()).or_default() += n;
        }
        total.queued_days_max = total.queued_days_max.max(g.queued_days_max);
        total.violations += g.violations;
        total.over_days += g.over_days;
        total.over_examples.extend(g.over_examples.iter().map(|date| format!("{} {date}", r.label())));
        total.mismatch_days += g.mismatch_days;
        for chapter in g.locked.keys() {
            *total.locked.entry(chapter.clone()).or_default() += 1;
        }
        waits.extend(r.waits.iter().copied());
        presents.extend(r.presents.iter().copied());
    }
    total.over_examples.truncate(5);
    total.wait = Dist::of(&waits);
    total.present = Dist::of(&presents);
    total.held_pct = pct(total.held, total.soft + total.still_held + total.dropped);
    any.then_some(total)
}

fn section(defs: &StaticData, runs: Vec<RunAudit>, upbringing: bool) -> Section {
    let mut flow = Flow::default();
    let mut coverage = BTreeMap::<String, [u32; 2]>::new();
    let mut auto_settled = BTreeMap::<String, [u32; 3]>::new();
    let mut stuck = BTreeMap::<String, u32>::new();
    for r in &runs {
        flow.add(&r.flow);
        for (part, [shown, due]) in &r.coverage {
            let e = coverage.entry(part.clone()).or_default();
            *e = [e[0] + shown, e[1] + due];
        }
        for (group, ways) in &r.auto_settled {
            let e = auto_settled.entry(group.clone()).or_default();
            *e = [e[0] + ways[0], e[1] + ways[1], e[2] + ways[2]];
        }
        for chapter in r.stuck.iter().map(|s| &s.chapter).collect::<BTreeSet<_>>() {
            *stuck.entry(chapter.clone()).or_default() += 1;
        }
    }
    let (total, trials) = {
        let data: Vec<RunData> = runs.iter().map(|r| r.data(defs)).collect();
        let total = stats(&data);
        let trials = if upbringing { trials(&data, &total.non_key, &defs.rules.pacing) } else { Vec::new() };
        (total, trials)
    };
    let gate = gate_total(&runs);
    Section { flow, coverage, auto_settled, stuck, gate, total, trials, runs }
}

/// 整份审计报告。
#[derive(Clone, Debug, Serialize)]
pub struct Report {
    pub world: String,
    pub data_hash: String,
    pub config: AuditConfig,
    /// 这次审计用的节奏规则（数据包里的，或者被调用方改过的）。
    pub pacing: PacingRules,
    pub sea_bot: String,
    pub inventory: Inventory,
    /// 养成整局。
    pub upbringing: Section,
    /// 养成结业后接着出海（同一个世界）。
    pub sea_after: Option<Section>,
    /// 自由航海剧本。
    pub sea_free: Option<Section>,
}

enum Job {
    Upbringing(RunConfig),
    FreeSea(u64),
}

enum Done {
    Upbringing(Box<RunAudit>, Option<Box<RunAudit>>),
    FreeSea(Box<RunAudit>),
}

/// 跑完整份审计：养成整局（家庭 × 预设 × 种子），以及 `sea_days > 0` 时的两段出海。结果按参数顺序，与线程数无关。
pub fn audit(defs: Arc<StaticData>, cfg: &AuditConfig) -> Report {
    let mut jobs = Vec::new();
    for seed in &cfg.seeds {
        for preset in &cfg.presets {
            for family in &cfg.families {
                jobs.push(Job::Upbringing(RunConfig {
                    family: family.clone(),
                    preset: preset.clone(),
                    seed: *seed,
                    register_every: cfg.register_every,
                }));
            }
        }
    }
    if cfg.sea_days > 0 {
        jobs.extend(cfg.seeds.iter().map(|seed| Job::FreeSea(*seed)));
    }
    let next = std::sync::atomic::AtomicUsize::new(0);
    let results = std::sync::Mutex::new(Vec::new());
    std::thread::scope(|scope| {
        for _ in 0..cfg.threads.max(1).min(jobs.len().max(1)) {
            scope.spawn(|| {
                loop {
                    let i = next.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    let Some(job) = jobs.get(i) else { break };
                    let done = match job {
                        Job::Upbringing(run) => {
                            let (audit, sea) = audit_upbringing(&defs, run, cfg.sea_days);
                            Done::Upbringing(Box::new(audit), sea.map(Box::new))
                        }
                        Job::FreeSea(seed) => Done::FreeSea(Box::new(audit_free_sea(&defs, *seed, cfg.sea_days))),
                    };
                    if let Ok(mut v) = results.lock() {
                        v.push((i, done));
                    }
                }
            });
        }
    });
    let mut results = results.into_inner().unwrap_or_default();
    results.sort_by_key(|(i, _)| *i);
    let (mut upbringing, mut after, mut free) = (Vec::new(), Vec::new(), Vec::new());
    for (_, done) in results {
        match done {
            Done::Upbringing(audit, sea) => {
                upbringing.push(*audit);
                after.extend(sea.map(|s| *s));
            }
            Done::FreeSea(audit) => free.push(*audit),
        }
    }
    Report {
        world: defs.world_key.clone(),
        data_hash: defs.meta.hash.clone(),
        config: cfg.clone(),
        pacing: defs.rules.pacing.clone(),
        sea_bot: SEA_BOT.name().to_owned(),
        inventory: inventory(&defs),
        upbringing: section(&defs, upbringing, true),
        sea_after: (cfg.sea_days > 0).then(|| section(&defs, after, false)),
        sea_free: (cfg.sea_days > 0).then(|| section(&defs, free, false)),
    }
}

/// 报告的 JSON（缩进排版，末尾不带换行）。
pub fn report_json(report: &Report) -> String {
    serde_json::to_string_pretty(report).unwrap_or_default()
}

fn source_name(s: BeatSource) -> &'static str {
    match s {
        BeatSource::Plan => "月程安排",
        BeatSource::LowMood => "心情低谷",
        BeatSource::Timed => "限时",
        BeatSource::Letter => "来信与新闻",
        BeatSource::Focus => "重点支线",
        BeatSource::Ordinary => "普通短事件",
        BeatSource::Filler => "日常池",
        BeatSource::Bond => "羁绊与自动线",
        BeatSource::Continuation => "续章",
        BeatSource::Story => "故事",
        BeatSource::Encounter => "奇遇",
        BeatSource::Creature => "怪异",
        BeatSource::Battle => "海战",
    }
}

fn weight_name(w: BeatWeight) -> &'static str {
    match w {
        BeatWeight::Key => "要紧（Key）",
        BeatWeight::Major => "有分量（Major）",
        BeatWeight::Minor => "点缀（Minor）",
    }
}

fn date_text(d: WorldDate) -> String {
    format!("{}-{:02}-{:02}", d[0], d[1], d[2])
}

fn share(part: u32, whole: u32) -> String {
    format!("{:.1}%", pct(u64::from(part), u64::from(whole)))
}

fn dist_cells(d: &Dist) -> String {
    format!("{:.2} | {} | {} | {}", d.mean, d.median, d.p90, d.max)
}

fn section_markdown(out: &mut String, s: &Section, upbringing: bool) {
    let t = &s.total;
    let _ = writeln!(
        out,
        "共 {} 局，观察 {} 天；完整的月 {} 个、周 {} 个。全部节拍 {} 次，其中独立打断 {} 次。\n",
        t.runs, t.days, t.months, t.weeks, t.beats, t.events.total
    );
    let _ = writeln!(out, "**每月节拍，按来源**（“没过旬配额”只对养成期有意义）\n");
    let _ = writeln!(out, "| 来源 | 总数 | 占比 | 月均 | 中位 | P90 | 最大 | 没过旬配额 |");
    let _ = writeln!(out, "|---|---:|---:|---:|---:|---:|---:|---:|");
    for (source, st) in &t.by_source {
        let _ = writeln!(
            out,
            "| {}（{}） | {} | {:.1}% | {} | {} |",
            source_name(*source),
            source.key(),
            st.total,
            st.share_pct,
            dist_cells(&st.monthly),
            if upbringing && independent_source(*source) { st.unscheduled.to_string() } else { "—".into() }
        );
    }
    let _ = writeln!(out, "| 全部节拍 | {} | 100.0% | {} | — |", t.beats, dist_cells(&t.monthly));
    let _ = writeln!(
        out,
        "| 独立打断（不含月程与续章） | {} | {:.1}% | {} | {} |\n",
        t.events.total,
        pct(t.events.total, t.beats),
        dist_cells(&t.events.monthly),
        if upbringing { t.unscheduled.total.to_string() } else { "—".into() }
    );
    let _ = writeln!(out, "**每月独立打断，按分量**；右边是它们还能拖几天（截止日 − 出现日）\n");
    let _ = writeln!(
        out,
        "| 分量 | 总数 | 占比 | 月均 | 中位 | P90 | 最大 | 没有截止日 | 当天截止 | 1–3 天 | 4–9 天 | 10 天以上 |"
    );
    let _ = writeln!(out, "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
    for (weight, st) in &t.by_weight {
        let slack = t.slack.get(weight).copied().unwrap_or_default();
        let _ = writeln!(
            out,
            "| {} | {} | {:.1}% | {} | {} |",
            weight_name(*weight),
            st.total,
            st.share_pct,
            dist_cells(&st.monthly),
            slack.iter().map(u64::to_string).collect::<Vec<_>>().join(" | ")
        );
    }
    let mut spreads =
        vec![("全部独立打断", &t.events), ("要紧（Key）", &t.key), ("非要紧（Major + Minor）", &t.non_key)];
    if upbringing {
        spreads.push(("没过旬配额的", &t.unscheduled));
        spreads.push(("其中 bond", &t.bond));
    }
    let _ = writeln!(out, "\n**每周次数的分布**（周：月内 1–7、8–14、15–21、22–28、29–月末；只计完整的周）\n");
    let _ = writeln!(
        out,
        "| 口径 | 周数 | 0 次 | 1 次 | 2 次 | 3 次 | 4 次以上 | 周均 | 中位 | P90 | 一周最多 | 月内第 1–5 周的平均 |"
    );
    let _ = writeln!(out, "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|");
    for (name, sp) in &spreads {
        let _ = writeln!(
            out,
            "| {name} | {} | {} | {} | {} | {} | {} | {:.2} | {} | {} | {} | {} |",
            sp.weeks,
            share(sp.weekly[0], sp.weeks),
            share(sp.weekly[1], sp.weeks),
            share(sp.weekly[2], sp.weeks),
            share(sp.weekly[3], sp.weeks),
            share(sp.weekly[4], sp.weeks),
            sp.weekly_dist.mean,
            sp.weekly_dist.median,
            sp.weekly_dist.p90,
            sp.weekly_max,
            sp.week_position.iter().map(|x| format!("{x:.2}")).collect::<Vec<_>>().join(" / ")
        );
    }
    let _ = writeln!(out, "\n**单日与连续**\n");
    let _ = writeln!(
        out,
        "| 口径 | 天数 | 0 次 | 1 次 | 2 次 | 3 次 | 4 次以上 | 单日最多 | ≥2 的天数 | ≥3 的天数 | ≥4 的天数 | 连续 7 天最多 | 最长无打断（天） |"
    );
    let _ = writeln!(out, "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
    for (name, sp) in &spreads {
        let _ = writeln!(
            out,
            "| {name} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} |",
            sp.days,
            share(sp.daily[0], sp.days),
            share(sp.daily[1], sp.days),
            share(sp.daily[2], sp.days),
            share(sp.daily[3], sp.days),
            share(sp.daily[4], sp.days),
            sp.day_max,
            sp.days_ge2,
            sp.days_ge3,
            sp.days_ge4,
            sp.rolling7_max,
            sp.longest_quiet
        );
    }
    if t.events.total > 0 {
        let mut days: Vec<(usize, f64)> = t.events.day_of_month.iter().copied().enumerate().collect();
        days.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
        let _ = writeln!(
            out,
            "\n独立打断最集中的日子（月内几日：平均每天几次）：{}。",
            days.iter().take(6).map(|(i, x)| format!("{} 日 {x:.2}", i + 1)).collect::<Vec<_>>().join("、")
        );
    }
    if !t.events.worst_days.is_empty() {
        let _ = writeln!(out, "\n最挤的几天（独立打断）：\n");
        for d in &t.events.worst_days {
            let _ = writeln!(out, "- {} {}：{} 次——{}", d.run, date_text(d.date), d.count, d.beats.join("，"));
        }
    }
    if upbringing && !t.bond.worst_days.is_empty() {
        let _ = writeln!(out, "\nbond 最挤的几天：\n");
        for d in &t.bond.worst_days {
            let _ = writeln!(out, "- {} {}：{} 条——{}", d.run, date_text(d.date), d.count, d.beats.join("，"));
        }
    }
    let f = &s.flow;
    let _ = writeln!(out, "\n**通畅**\n");
    let _ = writeln!(out, "| 检查 | 结果 |");
    let _ = writeln!(out, "|---|---:|");
    let _ =
        writeln!(out, "| {} | {} / {} |", if upbringing { "结业的局数" } else { "跑满天数的局数" }, f.finished, f.runs);
    let _ = writeln!(out, "| 出错停下的局数 | {} |", f.failed);
    let _ = writeln!(out, "| 时钟在等、却没有可回应的事（卡死）的天数 | {} |", f.stalls);
    let _ = writeln!(out, "| 同一天回应不收敛的天数 | {} |", f.diverged);
    let _ = writeln!(out, "| 一件事从出现到答掉最久隔了几天 | {} |", f.max_wait_days);
    let _ = writeln!(out, "| 选项全被锁住、被引擎自动作罢的章节（Story2Abandoned） | {} |", f.engine_abandoned);
    let _ = writeln!(out, "| 跑法里一个选项也交不上、只好作罢的章节 | {} |", f.bot_abandoned);
    let _ = writeln!(out, "| 答不上、留到过期的怪异 / 幽灵船 / 海战 | {} |", f.unanswered);
    let _ = writeln!(out, "| 没等到出场、窗口到期按缺省分支走掉的章节 | {} |", f.auto_default);
    let _ = writeln!(out, "| 没等到出场、期限到了按超时分支走掉的章节 | {} |", f.auto_timeout);
    let _ = writeln!(out, "| 窗口到期时条件仍不满足而失败的章节 | {} |", f.auto_failed);
    let _ = writeln!(out, "| 掷骰失败后留在原处重选的次数（不计入打断） | {} |", f.dice_retries);
    if !s.stuck.is_empty() {
        let _ = writeln!(
            out,
            "\n排在队首、却一个选项也交不上的章节（出海后引擎不会替玩家作罢，真实对局里它会一直占着队首；括号里是出现的局数）：{}。",
            s.stuck.iter().map(|(chapter, n)| format!("{chapter}（{n}）")).collect::<Vec<_>>().join("、")
        );
    }
    if !s.auto_settled.is_empty() {
        let mut groups: Vec<(&String, &[u32; 3])> = s.auto_settled.iter().collect();
        groups.sort_by(|a, b| b.1.iter().sum::<u32>().cmp(&a.1.iter().sum::<u32>()).then_with(|| a.0.cmp(b.0)));
        let _ = writeln!(
            out,
            "\n没等到出场就走掉的章节，按内容族（缺省 / 超时 / 失败）：{}。",
            groups
                .iter()
                .take(8)
                .map(|(group, n)| format!("{group} {} / {} / {}", n[0], n[1], n[2]))
                .collect::<Vec<_>>()
                .join("、")
        );
    }
    if !s.coverage.is_empty() {
        let _ = writeln!(
            out,
            "\n**写好的限时内容出场了多少**（出场条数 / 门槛日期已到的条数；按 `c9_<家>_<类>_*` 的门槛 key 统计，改投了别的学院的局不计原学院那一路的门槛）\n"
        );
        let _ = writeln!(out, "| 类别 | 出场 | 到期 | 覆盖 |");
        let _ = writeln!(out, "|---|---:|---:|---:|");
        for (part, [shown, due]) in &s.coverage {
            let _ = writeln!(out, "| {part} | {shown} | {due} | {} |", share(*shown, *due));
        }
    }
    if let Some(g) = &s.gate {
        let _ = writeln!(out, "\n**闸的实测**（规则开着真跑出来的；“可以等的事”是独立打断里分量不是要紧的）\n");
        let _ = writeln!(out, "| 项 | 结果 |");
        let _ = writeln!(out, "|---|---:|");
        let _ = writeln!(out, "| 出场的可以等的事 | {} |", g.soft);
        let _ = writeln!(out, "| 被按下过的件数（占全部可以等的事） | {}（{:.1}%） |", g.held, g.held_pct);
        let _ = writeln!(
            out,
            "| 被按下又出场的：件数；等了几天（平均 / 中位 / P90 / 最久） | {}；{:.2} / {} / {} / {} |",
            g.released, g.wait.mean, g.wait.median, g.wait.p90, g.wait.max
        );
        let _ = writeln!(
            out,
            "| 其中它同时也是候选（玩家在场、条件满足）的天数（平均 / 中位 / P90 / 最久） | {:.2} / {} / {} / {} |",
            g.present.mean, g.present.median, g.present.p90, g.present.max
        );
        let _ = writeln!(
            out,
            "| 其中因为到了最后一天 / 等满了 / 名额空出来而出场 | {} / {} / {} |",
            g.by_last_day, g.by_full_wait, g.by_budget
        );
        let _ = writeln!(out, "| 没被按过、出场那天正好是最后一天的 | {} |", g.fresh_last_day);
        let _ = writeln!(out, "| 等满之后因为当天名额已满又多排的天数（最多的一件） | {} |", g.queued_days_max);
        let _ = writeln!(out, "| 期末仍按着的 | {} |", g.still_held);
        let _ = writeln!(out, "| 按着的时候没等到出场就走掉的 | {} |", g.dropped);
        let _ = writeln!(out, "| 闸刚跑完、按规则却该放的次数（应当为 0） | {} |", g.violations);
        let _ = writeln!(
            out,
            "| 单日独立打断超出“max(当天要紧件数, 单日上限) + 最后一天放行 + 不经闸的来源”的天数（应当为 0） | {} |",
            g.over_days
        );
        let _ = writeln!(out, "| 闸记的当天放行数与审计记下的当天独立打断数对不上的天数 | {} |", g.mismatch_days);
        if !g.dropped_groups.is_empty() {
            let mut groups: Vec<(&String, &u32)> = g.dropped_groups.iter().collect();
            groups.sort_by(|a, b| b.1.cmp(a.1).then_with(|| a.0.cmp(b.0)));
            let _ = writeln!(
                out,
                "\n按着的时候走掉的，按内容族：{}。",
                groups.iter().take(8).map(|(group, n)| format!("{group} {n}")).collect::<Vec<_>>().join("、")
            );
        }
        if !g.over_examples.is_empty() {
            let _ = writeln!(out, "\n超出口径的日子（至多列五个）：{}。", g.over_examples.join("、"));
        }
        if !g.locked.is_empty() {
            let _ = writeln!(
                out,
                "\n选项全锁、排在队列末尾等条件的章节（不挡后面答得了的；括号里是出现的局数）：{}。",
                g.locked.iter().map(|(chapter, n)| format!("{chapter}（{n}）")).collect::<Vec<_>>().join("、")
            );
        }
    }
    if !s.trials.is_empty() {
        let _ = writeln!(
            out,
            "\n**预算试算**（把上面记下的独立打断照原来的到达日放进一道闸里重放，规则与内核的闸是同一套：要紧的事从不被按下，照出、也占当天的名额；可以等的事到了截止日放行、不看上限，否则当天已放行数达到“单日上限”就按下，否则等满“最久等”就放行，否则窗口内可以等的事不到“窗口上限”就放行。一阶估计：只挪出场的日子，不含推迟引起的连锁变化，也看不到内核按日历预看的那几种“最后一天”。{}）\n",
            if s.gate.is_some() {
                "这一段是开着闸跑的：把实测的记录按同样的规则再过一遍，应当几乎不再有被按下的。"
            } else {
                "没开闸时用它估计开闸的效果：单日上限试 1–3，窗口上限从刚好大于可以等的事的周均到达数起试三档，最久等一旬与三周。"
            }
        );
        let _ = writeln!(
            out,
            "| 单日上限 | 窗口（天）| 窗口上限 | 最久等（天） | 可以等的到达 | 被按下 | 占比 | 平均等（天） | P90 | 最久 | 出场原因：最后一天 / 等满 / 名额 | 破例占比 | 重放后单日最多 | 超过单日上限的天数（其中有最后一天放行的） | 任意窗口内最多 | 重放后每周可以等的：均值 / P90 / 最多 | 期末积压 |"
        );
        let _ = writeln!(out, "|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---|---:|---|---:|");
        for x in &s.trials {
            let _ = writeln!(
                out,
                "| {} | {} | {} | {} | {} | {} | {:.1}% | {:.2} | {} | {} | {} / {} / {} | {:.2}% | {} | {}（{}） | {} | {:.2} / {} / {} | {} |",
                x.daily,
                x.window_days,
                x.window_soft,
                x.max_defer_days,
                x.arrivals,
                x.delayed,
                x.delayed_pct,
                x.mean_delay,
                x.p90_delay,
                x.max_delay,
                x.by_last_day,
                x.by_full_wait,
                x.by_budget,
                x.forced_pct,
                x.day_max,
                x.days_over,
                x.days_over_by_last_day,
                x.window_max,
                x.weekly.mean,
                x.weekly.p90,
                x.weekly.max,
                x.backlog
            );
        }
    }
    if !t.groups.is_empty() {
        let _ = writeln!(out, "\n**各来源里出现最多的内容族**\n");
        for (source, groups) in &t.groups {
            let _ = writeln!(
                out,
                "- {}：{}",
                source_name(*source),
                groups.iter().map(|g| format!("{} {}", g.group, g.count)).collect::<Vec<_>>().join("、")
            );
        }
    }
    let _ = writeln!(out, "\n**各局一览**（次数都按独立打断）\n");
    let _ = writeln!(
        out,
        "| 局 | 起止 | {} | 每月均值 | 每月最多 | 单日最多 | ≥3 的天数 | 连续 7 天最多 | 最长无打断 | 同日 ≥2 条 bond 的天数 | 限时内容覆盖 | 自动作罢 | 缺省走掉 | 错误 |",
        if upbringing { "结业" } else { "跑满" }
    );
    let _ = writeln!(out, "|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
    for r in &s.runs {
        let e = &r.stats.events;
        let (shown, due) = r.coverage.values().fold((0, 0), |sum, [shown, due]| (sum.0 + shown, sum.1 + due));
        let _ = writeln!(
            out,
            "| {} | {} → {} | {} | {:.2} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} |",
            r.label(),
            date_text(r.start),
            date_text(r.end),
            if r.finished { "是" } else { "否" },
            e.monthly.mean,
            e.monthly.max,
            e.day_max,
            e.days_ge3,
            e.rolling7_max,
            e.longest_quiet,
            r.stats.bond.days_ge2,
            if due > 0 { format!("{shown}/{due}（{}）", share(shown, due)) } else { "—".into() },
            r.flow.engine_abandoned,
            r.flow.auto_default + r.flow.auto_timeout,
            r.errors.len()
        );
    }
    for r in s.runs.iter().filter(|r| !r.errors.is_empty()) {
        let _ = writeln!(out, "\n- {} 的错误：{}", r.label(), r.errors.join("；"));
    }
    out.push('\n');
}

/// 给人看的中文摘要（Markdown）。
pub fn markdown(report: &Report) -> String {
    let c = &report.config;
    let mut out = String::new();
    let _ = writeln!(out, "# 事件节奏审计\n");
    let _ = writeln!(
        out,
        "- 世界：{}（数据哈希 {}）",
        report.world,
        report.data_hash.get(..16).unwrap_or(&report.data_hash)
    );
    let _ = writeln!(
        out,
        "- 养成整局：{} 家 × 预设 {} × 种子 {}，每 {} 场新开放的比赛报名一场；跑法同 `upbringing-runs`（自动安排月程，剧情在能选的选项里轮着挑，当天答完）。",
        c.families.len(),
        c.presets.join("、"),
        c.seeds.iter().map(u64::to_string).collect::<Vec<_>>().join("、"),
        c.register_every
    );
    let _ = writeln!(out, "- 家庭：{}。", c.families.join("、"));
    if c.sea_days > 0 {
        let _ = writeln!(
            out,
            "- 出海：各 {} 天，{} bot 代替玩家经营；在等回应的事当天答掉（剧情选能选的，怪异选第一个付得起的应对，幽灵船打招呼，海战自动结算）。",
            c.sea_days, report.sea_bot
        );
    } else {
        let _ = writeln!(out, "- 出海：没有跑（`--sea-days 0`）。");
    }
    let p = &report.pacing;
    let _ = writeln!(
        out,
        "- 节奏的闸：{}（单日上限 {} / {} 天窗口内可以等的事 {} 件 / 最久等 {} 天）。",
        if p.enabled { "开" } else { "关" },
        p.daily,
        p.window_days,
        p.window_soft,
        p.max_defer_days
    );
    let _ = writeln!(
        out,
        "- 口径：**节拍**含月程安排与续章；**独立打断**不含这两类（月程每月固定一次，续章是同一件事当场翻到下一页）。按月、按周的分布只计完整的月与周。分类见内核 `pacing`。\n"
    );
    let _ = writeln!(out, "## 一、养成期\n");
    section_markdown(&mut out, &report.upbringing, true);
    if let Some(s) = &report.sea_after {
        let _ = writeln!(out, "## 二、出海：养成结业后接着走\n");
        section_markdown(&mut out, s, false);
    }
    if let Some(s) = &report.sea_free {
        let _ = writeln!(out, "## 三、出海：自由航海剧本\n");
        section_markdown(&mut out, s, false);
    }
    let i = &report.inventory;
    let _ = writeln!(out, "## 附：轨道盘点\n");
    let _ = writeln!(
        out,
        "story2 轨道 {} 条（{}）：自动开始的 {} 条；学院轨道 {} 条，其中自动开始、养成期不经旬调度的 {} 条（没有短事件门槛的 {} 条）；有短事件门槛、每旬都是候选的 {} 条。",
        i.tracks,
        i.by_kind.iter().map(|(k, n)| format!("{k} {n}")).collect::<Vec<_>>().join("、"),
        i.auto,
        i.academy,
        i.auto_academy,
        i.auto_academy_ungated,
        i.gated
    );
    out
}

#[cfg(test)]
mod tests {
    //! 统计与预算试算的算术：用手算得出的小例子核对分期、分位数、连续与闸的规则。
    use super::*;
    use manifest_core::calendar::Calendar;
    use manifest_core::pacing::BeatSource::{Bond, Continuation, Letter, Ordinary, Plan, Timed};
    use manifest_core::pacing::BeatWeight::{Key, Major, Minor};

    /// 小型世界换上 365 天的日历（1 月 31 天、2 月 28 天），好核对月末余日与没有第五周的月。
    fn defs() -> StaticData {
        let mut d = (*manifest_core::testkit::tiny_defs()).clone();
        let months = vec![31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        let seasons = vec![3, 3, 0, 0, 0, 1, 1, 1, 2, 2, 2, 3];
        d.calendar = Calendar::new(months, seasons, "公元".into(), Vec::new()).unwrap();
        d
    }

    fn beat(day: u32, source: BeatSource, weight: BeatWeight, key: &str, deadline: Option<u32>) -> BeatRecord {
        let beat =
            Beat { source, weight, key: key.into(), chapter: Some("c".into()), since: day, deadline, slot: None };
        BeatRecord { day, date: [0, 0, 0], beat, held_days: None, last_chance: false }
    }

    fn run<'a>(defs: &StaticData, beats: &'a [BeatRecord], days: u32) -> RunData<'a> {
        RunData { label: "t".into(), family: "", frame: Frame::new(defs, 0, days), beats }
    }

    #[test]
    fn audit_gate_releases_truth_table() {
        let root = manifest_data::find_data_dir().unwrap();
        let mut d = (*manifest_data::load_world(&root, "testbed").unwrap()).clone();
        d.rules.pacing.enabled = true;
        d.rules.upbringing.weekly = Some(Default::default());
        d.rules.upbringing.cadence = Some(Default::default());
        let track = d.story2.tracks.first().unwrap();
        let track_key = track.key.clone();
        let chapter = track.start.clone();
        let sid = d.find_scenario("upbringing").unwrap();
        let base = World::new(Arc::new(d), sid, 42).unwrap();
        for cadence in [false, true] {
            for shown in [false, true] {
                for today in [false, true] {
                    for seen in [false, true] {
                        for observed in 0..=2 {
                            for noted in 0..=3 {
                                let mut w = base.clone();
                                w.state.day = 2;
                                Arc::make_mut(&mut w.defs).rules.upbringing.cadence.as_mut().unwrap().enabled = cadence;
                                let s = w.state.upbringing.as_mut().unwrap();
                                s.weekly.on = true;
                                s.cadence.on = true;
                                s.cadence.week = 0;
                                w.state.story2.pending.clear();
                                w.state.story2.last = None;
                                w.state.pacing.shown.clear();
                                let pending = manifest_core::story2::Pending {
                                    track: track_key.clone(),
                                    chapter: chapter.clone(),
                                    day: if today { 2 } else { 1 },
                                    variant: None,
                                };
                                let released = w.pacing_classify_story2(&pending);
                                assert!(independent(&released));
                                if shown {
                                    w.state.pacing.shown.insert(
                                        track_key.clone(),
                                        manifest_core::pacing::Shown {
                                            chapter: chapter.clone(),
                                            entered: 0,
                                            day: pending.day,
                                        },
                                    );
                                }
                                w.state.pacing.log =
                                    vec![manifest_core::pacing::Released { day: 2, weight: Key }; noted as usize];
                                let mut ledger = Ledger {
                                    beats: (0..observed)
                                        .map(|i| beat(2, BeatSource::Story, Key, &format!("other_{i}"), None))
                                        .collect(),
                                    ..Default::default()
                                };
                                if seen {
                                    ledger.seen.insert(beat_id(&released));
                                    ledger.beats.push(BeatRecord {
                                        day: 2,
                                        date: w.cast_date(),
                                        beat: released,
                                        held_days: None,
                                        last_chance: false,
                                    });
                                }
                                ledger.close_gate_day(&w);
                                let inferred = shown && today && !seen;
                                let total = observed + u32::from(seen) + u32::from(inferred);
                                let expected = u32::from(!cadence && noted != total);
                                println!(
                                    "cadence={cadence} shown={shown} today={today} seen={seen} observed={observed} noted={noted} inferred={inferred} total={total} mismatch={}",
                                    ledger.gate.mismatch_days
                                );
                                assert_eq!(ledger.gate.mismatch_days, expected);
                            }
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn frames_keep_whole_months_and_p10_weeks_only() {
        let d = defs();
        // 一月与二月是整月，三月只到 20 日。
        let f = Frame::new(&d, 0, 31 + 28 + 20);
        assert_eq!(f.dates[0][1..], [1, 1]);
        assert_eq!(f.months, [(0, 31), (31, 59)]);
        // 一月五周（末周是 29–31 日三天），二月只有四周，三月的前两周完整。
        let weeks = [
            (0, 7, 0),
            (7, 14, 1),
            (14, 21, 2),
            (21, 28, 3),
            (28, 31, 4),
            (31, 38, 0),
            (38, 45, 1),
            (45, 52, 2),
            (52, 59, 3),
            (59, 66, 0),
            (66, 73, 1),
        ];
        assert_eq!(f.weeks, weeks);
        // 从 1 月 10 日看到 2 月 9 日：没有一个整月，只有完整的周算数。
        let f = Frame::new(&d, 9, 40);
        assert!(f.months.is_empty());
        assert_eq!(f.weeks, [(5, 12, 2), (12, 19, 3), (19, 22, 4), (22, 29, 0)]);
    }

    #[test]
    fn frames_use_four_weeks_when_the_world_plans_by_week() {
        let mut d = defs();
        d.rules.upbringing.weekly = Some(Default::default());
        let f = Frame::new(&d, 0, 31 + 28);
        // 一月四周，第四周 22–31 日共十天；二月四周，第四周 22–28 日。
        assert_eq!(
            f.weeks,
            [(0, 7, 0), (7, 14, 1), (14, 21, 2), (21, 31, 3), (31, 38, 0), (38, 45, 1), (45, 52, 2), (52, 59, 3)]
        );
    }

    #[test]
    fn distributions_use_the_nearest_rank() {
        let d = Dist::of(&[10, 0, 3, 2, 9, 0, 4, 1, 2, 3]);
        assert_eq!((d.n, d.total, d.mean, d.median, d.p90, d.max), (10, 34, 3.4, 2, 9, 10));
        let one = Dist::of(&[5]);
        assert_eq!((one.n, one.mean, one.median, one.p90, one.max), (1, 5.0, 5, 5, 5));
        assert_eq!(Dist::of(&[]), Dist::default());
    }

    #[test]
    fn spreads_count_days_weeks_months_and_streaks() {
        let d = defs();
        let beats = vec![
            beat(0, Timed, Key, "a", None),
            beat(0, Bond, Major, "b", None),
            beat(0, Bond, Major, "c", None),
            // 月程与续章是节拍，不是独立打断。
            beat(0, Plan, Key, "plan", None),
            beat(5, Ordinary, Minor, "d", None),
            beat(6, Continuation, Major, "a", None),
            // 2 月 1 日与 2 月 28 日。
            beat(31, Timed, Key, "e", Some(31)),
            beat(58, Letter, Major, "f", Some(70)),
        ];
        let s = stats(&[run(&d, &beats, 59)]);
        assert_eq!((s.runs, s.days, s.months, s.weeks, s.beats), (1, 59, 2, 9, 8));
        let totals: Vec<(BeatSource, u64)> = s.by_source.iter().map(|(k, v)| (*k, v.total)).collect();
        assert_eq!(totals, [(Plan, 1), (Timed, 2), (Letter, 1), (Ordinary, 1), (Bond, 2), (Continuation, 1)]);
        let weights: Vec<u64> = s.by_weight.values().map(|w| w.total).collect();
        assert_eq!(weights, [2, 3, 1]);
        let e = &s.events;
        // 一月 4 次、二月 2 次。
        assert_eq!((e.total, e.monthly.mean, e.monthly.median, e.monthly.p90, e.monthly.max), (6, 3.0, 2, 4, 4));
        // 九个完整的周：一月第一周 4 次，二月第一周与第四周各 1 次，其余为零。
        assert_eq!((e.weekly, e.weekly_max, e.weekly_dist.total), ([6, 2, 0, 0, 1], 4, 6));
        assert_eq!(e.week_position, [2.5, 0.0, 0.0, 0.5, 0.0]);
        assert_eq!((e.daily, e.day_max), ([55, 3, 0, 1, 0], 3));
        assert_eq!((e.days_ge2, e.days_ge3, e.days_ge4), (1, 1, 0));
        // 1 月 1–7 日这七天里 4 次；最长的空档是 2 月 2 日到 27 日。
        assert_eq!((e.rolling7_max, e.longest_quiet), (4, 26));
        assert_eq!(
            (e.day_of_month[0], e.day_of_month[5], e.day_of_month[27], e.day_of_month[30]),
            (2.0, 0.5, 0.5, 0.0)
        );
        assert_eq!(e.worst_days.len(), 1);
        assert_eq!(e.worst_days[0].beats, ["timed:a#c", "bond:b#c", "bond:c#c"]);
        assert_eq!((s.key.total, s.non_key.total, s.bond.total), (2, 4, 2));
        assert_eq!((s.bond.day_max, s.bond.days_ge2), (2, 1));
        // 还能拖几天：要紧的一件没有截止日、一件当天截止；有分量的两件没有截止日、一件还有 12 天。
        assert_eq!(s.slack[&Key], [1, 1, 0, 0, 0]);
        assert_eq!(s.slack[&Major], [2, 0, 0, 0, 1]);
        assert_eq!(s.slack[&Minor], [1, 0, 0, 0, 0]);
    }

    #[test]
    fn the_trial_gate_holds_what_can_wait_and_always_releases_what_is_due() {
        let d = defs();
        let rules = |daily, window_days, window_soft, max_defer_days| PacingRules {
            enabled: false,
            daily,
            window_days,
            window_soft,
            max_defer_days,
        };
        let beats = vec![
            // 要紧的事从不被按下：三件都照原来的日子出，占满当天的名额（带不带截止日都一样）。
            beat(0, Timed, Key, "k1", None),
            beat(0, Timed, Key, "k2", None),
            beat(0, Timed, Key, "k3", Some(5)),
            beat(0, Bond, Major, "m1", None),
            beat(0, Bond, Major, "m2", None),
            beat(0, Ordinary, Minor, "n1", None),
            // 今天截止的可以等的事：不看上限，当天出。
            beat(0, Bond, Major, "due", Some(0)),
        ];
        let runs = [run(&d, &beats, 40)];
        // 一天两件、七天窗口三件、最久等十天：
        // 1 日出三件要紧的和今天截止的那件（共四件，顶破单日上限）；m1、m2 在 2 日出（窗口里就有了三件）；
        // n1 等到 8 日——1 日的那件滑出窗口——才出。
        let t = trial(&runs, &rules(2, 7, 3, 10));
        assert_eq!((t.daily, t.window_days, t.window_soft, t.max_defer_days), (2, 7, 3, 10));
        assert_eq!((t.key_arrivals, t.arrivals), (3, 4));
        assert_eq!((t.delayed, t.delayed_pct, t.mean_delay, t.p90_delay, t.max_delay), (3, 75.0, 3.0, 7, 7));
        assert_eq!((t.by_last_day, t.by_full_wait, t.by_budget, t.forced_pct), (0, 0, 3, 0.0));
        assert_eq!((t.day_max, t.days_over, t.days_over_by_last_day, t.window_max, t.backlog), (4, 1, 1, 3, 0));
        // 六个完整的周里，第一周放行三件、第二周一件。
        assert_eq!((t.weekly.n, t.weekly.total, t.weekly.median, t.weekly.p90, t.weekly.max), (6, 4, 0, 3, 3));

        // 等满了就不看窗口上限，但仍受单日上限：一天一件、窗口一件、最久等三天。
        let waiting = vec![
            beat(0, Bond, Major, "m1", None),
            beat(0, Bond, Major, "m2", None),
            beat(0, Ordinary, Minor, "n1", None),
        ];
        let t = trial(&[run(&d, &waiting, 40)], &rules(1, 30, 1, 3));
        // 1 日出 m1；m2 等满三天在 4 日出，n1 被单日上限挡到 5 日。
        assert_eq!((t.key_arrivals, t.arrivals, t.delayed), (0, 3, 2));
        assert_eq!((t.mean_delay, t.p90_delay, t.max_delay), (3.5, 4, 4));
        assert_eq!((t.by_last_day, t.by_full_wait, t.by_budget, t.forced_pct), (0, 2, 0, 66.67));
        assert_eq!((t.day_max, t.days_over, t.window_max, t.backlog), (1, 0, 3, 0));

        // 带截止日的可以等的事：按着的时候到了最后一天，照样放行。
        let closing = vec![
            beat(0, Bond, Major, "m1", None),
            beat(0, Bond, Major, "m2", Some(2)),
            beat(0, Ordinary, Minor, "n1", None),
        ];
        let t = trial(&[run(&d, &closing, 40)], &rules(1, 30, 1, 10));
        // m2 截止日早，排在 m1 前面先出；m1、n1 按着。3 日没有谁到期；m1 等满十天在 11 日出，n1 在 12 日出。
        assert_eq!((t.delayed, t.by_last_day, t.by_full_wait, t.by_budget), (2, 0, 2, 0));
        assert_eq!((t.max_delay, t.day_max, t.days_over), (11, 1, 0));
        // 两天的名额都被要紧的事占着：m2 按到 2 日（它的最后一天）破例放行，那一天顶破单日上限。
        let crowded =
            vec![beat(0, Timed, Key, "k1", None), beat(1, Timed, Key, "k2", None), beat(0, Bond, Major, "m2", Some(1))];
        let t = trial(&[run(&d, &crowded, 40)], &rules(1, 30, 1, 10));
        assert_eq!((t.delayed, t.by_last_day, t.by_full_wait, t.by_budget), (1, 1, 0, 0));
        assert_eq!((t.day_max, t.days_over, t.days_over_by_last_day, t.forced_pct), (2, 1, 1, 100.0));

        // 不设上限：什么都不挪，重放出来就是记下的样子。
        let t = trial(&runs, &rules(u32::MAX, 7, u32::MAX, u32::MAX));
        assert_eq!((t.delayed, t.by_last_day, t.by_full_wait, t.by_budget, t.backlog), (0, 0, 0, 0, 0));
        assert_eq!((t.day_max, t.days_over), (7, 0));
        // 观察期只有一天：可以等的三件还压着。
        let t = trial(&[run(&d, &beats, 1)], &rules(2, 7, 3, 10));
        assert_eq!((t.delayed, t.backlog, t.max_delay), (3, 3, 0));

        // 网格：没开闸时试 3 × 3 × 2 格，规则里写的那一格不在里面就补上；开着闸时只按规则把记录再过一遍。
        let non_key = stats(&runs).non_key;
        let grid = trials(&runs, &non_key, &rules(2, 7, 3, 10));
        assert_eq!(grid.len(), 18);
        assert!(grid.iter().all(|x| x.window_days == 7));
        assert_eq!(trials(&runs, &non_key, &rules(5, 7, 9, 30)).len(), 19);
        let on = PacingRules { enabled: true, ..rules(2, 7, 3, 10) };
        assert_eq!(trials(&runs, &non_key, &on), [trial(&runs, &on)]);
    }
}
