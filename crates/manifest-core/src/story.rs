//! 剧情事件（第九批）：推荐角色的**故事线**与所有船长都会遇到的**奇遇**。
//!
//! - **故事线**：带主角的开局剧本（`data/scenarios/*.toml` 的 `story`）挂一条故事线（`data/stories/<key>.toml`）。
//!   各章按顺序推进：上一章回应之后，下一章在它的触发条件全部满足的那一天出现（开局第几天之后、距上一章几天、
//!   有舰队停在某港或在某海区航行、现金 / 净资产 / 名声 / 船只数达到、某处发现物已被发现、故事标记……）。
//!   章节等玩家回应，不会过期；全部走完即故事结束（目标为“走完故事线”的剧本据此判定胜利）。
//! - **奇遇**：所有立过主角身世的对局都会遇到（`data/stories/encounters.toml`）。满足间隔时每天有小概率发生，
//!   在海上或在港口、按各自的条件与权重挑一个；当天没有回应（例如无界面模拟）就当没发生过，不产生任何效果。
//!   养成期一条都不出。开了节奏规则（`rules.toml [pacing]`）的世界里，它排在所有过闸的事后面：
//!   新一天的头一次刷新之后、当天还没有别的事出场且窗口上限没到才掷（见 [`crate::pacing`]）。
//! - **回应**：玩家以 [`crate::Command::StoryAnswer`] 选一个选项（一章或一次奇遇 1–3 个）。选项可以要付金币、交出货物，
//!   可以带一次属性检定（成功率 = 基础 + 属性 × 每点，夹在 5%–95%），效果是封闭集合（[`StoryEffect`]），
//!   范围在数据加载时校验：金币、名声、声望、士气、货物、水手、修复、损伤、粮水、发现物传闻、标出发现物、海图、
//!   航海士加入、主角属性、故事标记。效果只经内核执行，数值都来自数据。
//!
//! 只针对玩家，而且只在立过主角身世（[`crate::captain::CaptainProfile`]）的对局里：无界面模拟、平衡 bot 与没有身世的
//! 旧存档一切照旧。随机数取自独立的 [`Domain::Story`]，不影响其他随机流；什么都没发生过时状态不写进存档。

use crate::captain::ATTRIBUTES;
use crate::circulation::Sector;
use crate::error::{CommandError, CoreError, Reason};
use crate::fixed::{Money, mul_div};
use crate::ids::*;
use crate::ledger::{Account, CashClass, JournalEntry, Memo};
use crate::log::{LogEvent, LogKind};
use crate::mates::MateRole;
use crate::rng::{Domain, Rng};
use crate::treasury::Flow;
use crate::weather::Sky;
use crate::world::World;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

/// 一章或一次奇遇最多的选项数。
pub const MAX_CHOICES: usize = 3;
/// 故事面板保留的记录条数。
pub const JOURNAL_KEPT: usize = 60;
/// “标出发现物”在海图迷雾里揭开的半径（格）。
pub const REVEAL_RADIUS: i64 = 3;
/// 检定成功率的上下限（%）。
pub const CHECK_MIN_PCT: i64 = 5;
pub const CHECK_MAX_PCT: i64 = 95;

// 随机数的子键
const K_ENCOUNTER: u64 = 1;
const K_CHECK: u64 = 2;
const K_RUMOR: u64 = 3;

// ───────────────────────────── 静态数据 ─────────────────────────────

/// 剧情事件的静态数据（`data/stories/*.toml`；没有这些文件时为空，一切照旧）。
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct StoryDefs {
    pub rules: StoryRules,
    /// 故事线（按文件名顺序；带主角的剧本按下标引用）
    pub stories: Vec<StoryDef>,
    /// 奇遇（按数据文件的顺序；key 各不相同）
    pub encounters: Vec<EncounterDef>,
}

impl StoryDefs {
    pub fn story(&self, key: &str) -> Option<&StoryDef> {
        self.stories.iter().find(|s| s.key == key)
    }

    pub fn encounter(&self, key: &str) -> Option<&EncounterDef> {
        self.encounters.iter().find(|e| e.key == key)
    }
}

/// 奇遇的节奏（`encounters.toml [rules]`）。
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct StoryRules {
    /// 满足间隔时，每天遇到奇遇的概率（基点）
    pub encounter_bp: i64,
    /// 两次奇遇至少间隔的天数
    pub gap_days: u32,
    /// 开局多少天之后才会遇到奇遇
    pub first_day: u32,
}

/// 一条故事线。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoryDef {
    pub key: String,
    pub name: String,
    pub chapters: Vec<ChapterDef>,
}

/// 故事线的一章。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChapterDef {
    pub key: String,
    pub title: String,
    pub text: String,
    /// 本章出现之前显示在故事面板上的提示（下一步去哪里、做什么）
    pub hint: String,
    pub speaker: Speaker,
    /// 说话人的名字（`speaker` 为某张头像时显示；主角与航海士用各自的名字）
    pub speaker_name: String,
    /// 触发条件（全部满足才出现）
    pub when: Vec<Cond>,
    pub choices: Vec<ChoiceDef>,
}

/// 一种奇遇。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EncounterDef {
    pub key: String,
    pub title: String,
    pub text: String,
    pub speaker: Speaker,
    pub speaker_name: String,
    /// 在海上还是在港口
    pub place: Place,
    /// 额外的条件（全部满足才可能遇到）
    pub when: Vec<Cond>,
    /// 同一天可能遇到的奇遇之间的权重
    pub weight: i64,
    /// 每局只遇到一次
    pub once: bool,
    /// 同一种奇遇两次之间至少间隔的天数
    pub cooldown_days: u32,
    pub choices: Vec<ChoiceDef>,
}

/// 奇遇发生的地方。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Place {
    Sea,
    Port,
}

/// 对话框里的说话人（决定显示哪张头像）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Speaker {
    /// 没有说话人（旁白）
    None,
    /// 主角本人
    Captain,
    /// 某位航海士（用他的头像与名字）
    Mate(MateId),
    /// 某张人物头像（素材 id，如 `keeper-eastern-office-a`；名字见 `speaker_name`）
    Portrait(String),
}

/// 触发条件。
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Cond {
    /// 开局第 N 天之后
    Day(u32),
    /// 距上一章结束至少 N 天（第一章不受限制）
    Wait(u32),
    /// 有玩家舰队停在这些港口之一（空表示任意港口）
    Docked(Vec<LocId>),
    /// 有玩家舰队在这些海区航行（空表示任意海区）
    AtSea(Vec<RegionId>),
    /// 现金达到
    Cash(Money),
    /// 净资产达到
    NetWorth(Money),
    /// 名声达到
    Fame(i64),
    /// 玩家的船只总数达到
    Ships(u32),
    /// 这处发现物已经被发现
    Sighted(DiscoveryId),
    /// 有这个故事标记
    Flag(String),
    /// 没有这个故事标记
    NotFlag(String),
    // ── 以下为寰宇的奇遇追加（S01）：按季节、天气与港口文化限定出场 ──
    /// 今天的季节是其中之一（[`crate::calendar::Season::index`]：0 春、1 夏、2 秋、3 冬）
    Season(Vec<u8>),
    /// 舰队所在海区今天的天况是其中之一（只对海上的舰队成立）
    Sky(Vec<Sky>),
    /// 舰队所在海区今天的风力在这个范围内（含两端，0–10；只对海上的舰队成立）
    Wind(i64, i64),
    /// 舰队停靠的港口属于这些文化圈之一（地点的 `culture`）
    Culture(Vec<String>),
}

/// 一个选项。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChoiceDef {
    pub text: String,
    /// 选了之后的叙事（可以为空）
    pub reply: String,
    /// 要付的金币（现金不够时不能选）
    pub cost: Money,
    /// 要交出的货（这支舰队货舱里不够时不能选）
    pub give: Option<(GoodId, i64)>,
    /// 属性检定
    pub check: Option<Check>,
    /// 效果（检定成功或没有检定时）
    pub effects: Vec<StoryEffect>,
    /// 检定失败时的效果与叙事
    pub fail: Vec<StoryEffect>,
    pub fail_reply: String,
}

/// 属性检定：成功率 = `base_pct` + 属性 × `per_pct`，夹在 [`CHECK_MIN_PCT`]–[`CHECK_MAX_PCT`]。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Check {
    /// 属性下标（[`ATTRIBUTES`] 的顺序）
    pub attr: usize,
    pub base_pct: i64,
    pub per_pct: i64,
}

impl Check {
    /// 某项属性下的成功率（%）。
    pub fn chance_pct(&self, attr: i64) -> i64 {
        (self.base_pct + attr * self.per_pct).clamp(CHECK_MIN_PCT, CHECK_MAX_PCT)
    }
}

/// 效果（封闭集合，范围在数据加载时校验）。作用对象是遇到这件事的舰队（没有时是旗舰队）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum StoryEffect {
    /// 金币（负数时不会扣到负数）
    Cash(Money),
    Fame(i64),
    /// 声望：指定势力，或 None 表示当地（舰队停靠的港口所属的势力；在海上时没有效果）
    Reputation(Option<FactionId>, i64),
    Morale(i64),
    /// 货物：正数装进货舱（装不下按剩余舱位截断），负数从货舱里拿走（不够时有多少拿多少）
    Goods(GoodId, i64),
    /// 水手（不超过船员上限；减少时不少于最低船员）
    Crew(i64),
    /// 修复缺损耐久的百分比
    Repair(i64),
    /// 每艘船损失最大耐久的百分比（不会因此沉没）
    Damage(i64),
    /// 粮水增减若干天
    Supplies(i64),
    /// 一条尚未发现的发现物的传闻
    Rumor,
    /// 在海图上标出这处发现物的位置
    Reveal(DiscoveryId),
    /// 这片海区的海图
    Chart(RegionId),
    /// 这位航海士加入（不收招募费）
    Mate(MateId),
    /// 主角的属性（下标、增减）
    Attr(usize, i64),
    /// 故事标记
    Flag(String),
}

// ───────────────────────────── 状态 ─────────────────────────────

/// 一件剧情事件的来处。
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StorySource {
    /// 故事线的第几章（下标）
    Chapter(u32),
    /// 奇遇（key）
    Encounter(String),
}

/// 等待回应的剧情事件。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoryPending {
    /// 出现的日子
    pub day: u32,
    /// 遇到这件事的舰队（效果作用于它）
    pub fleet: FleetId,
    pub source: StorySource,
}

/// 实际发生的效果（界面据此列出结果）。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StoryOutcome {
    Cash(Money),
    Fame(i64),
    Reputation(FactionId, i64),
    Morale(i64),
    Goods(GoodId, i64),
    Crew(i64),
    Repair(i64),
    Damage(i64),
    /// 粮水增减的天数
    Supplies(i64),
    Rumor(DiscoveryId),
    Reveal(DiscoveryId),
    Chart(RegionId),
    /// 航海士加入
    Mate(MateId),
    /// 这位航海士已经在别处任职，没能加入
    MateBusy(MateId),
    /// 主角属性（下标、实际增减）
    Attr(u32, i64),
}

/// 一次回应的结果。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoryResult {
    pub day: u32,
    pub fleet: FleetId,
    pub source: StorySource,
    /// 选了第几个选项；None 表示当天没有回应（奇遇就此作罢）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub choice: Option<u32>,
    /// 检定结果（没有检定时为 None）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub success: Option<bool>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub outcomes: Vec<StoryOutcome>,
}

/// 故事面板的一条记录。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoryEntry {
    pub day: u32,
    pub source: StorySource,
    pub choice: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub success: Option<bool>,
}

/// 剧情事件的状态（旧存档没有：读作什么都没发生过；什么都没发生过时不写进存档）。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoryState {
    /// 故事线已走完的章数（下一章的下标）
    #[serde(default, skip_serializing_if = "is_zero")]
    pub chapter: u32,
    /// 上一章结束的日子
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chapter_day: Option<u32>,
    /// 故事标记
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    pub flags: BTreeSet<String>,
    /// 等待回应的事件（同一时间只有一件）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending: Option<StoryPending>,
    /// 上一次回应的结果
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last: Option<StoryResult>,
    /// 各种奇遇上一次发生的日子（key → 日子）
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub seen: BTreeMap<String, u32>,
    /// 上一次奇遇发生的日子
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub encounter_day: Option<u32>,
    /// 回应过的章节与奇遇（最近 [`JOURNAL_KEPT`] 条）
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub journal: Vec<StoryEntry>,
}

fn is_zero(v: &u32) -> bool {
    *v == 0
}

impl StoryState {
    /// 什么都没发生过（与缺省状态相同）：不写进存档。
    pub fn is_pristine(&self) -> bool {
        *self == StoryState::default()
    }
}

/// `StoryAnswer` 的预检结果。
pub struct StoryPlan {
    choice: u32,
}

// ───────────────────────────── 查询 ─────────────────────────────

impl World {
    /// 剧情事件是否启用：玩家立过主角身世（无界面模拟、平衡 bot、没有身世的旧存档都不启用）。
    pub fn story_enabled(&self) -> bool {
        self.captain_profile(OwnerId::Player).is_some()
    }

    /// 本局剧本挂的故事线。
    pub fn story_def(&self) -> Option<&StoryDef> {
        let s = self.defs.scenarios.get(self.state.scenario.idx())?;
        s.story.and_then(|i| self.defs.stories.stories.get(i))
    }

    /// 故事线的进度：（已走完的章数, 总章数）；本局没有故事线时为 None。
    pub fn story_progress(&self) -> Option<(u32, u32)> {
        let def = self.story_def()?;
        let total = def.chapters.len() as u32;
        Some((self.state.story.chapter.min(total), total))
    }

    /// 故事线是否已经走完。
    pub fn story_complete(&self) -> bool {
        self.story_progress().is_some_and(|(done, total)| total > 0 && done >= total)
    }

    /// 等待回应的事件的内容（章节或奇遇）：标题、叙事、说话人与选项。
    pub fn story_event(&self, source: &StorySource) -> Option<StoryEventRef<'_>> {
        match source {
            StorySource::Chapter(i) => self.story_def()?.chapters.get(*i as usize).map(StoryEventRef::Chapter),
            StorySource::Encounter(key) => self.defs.stories.encounter(key).map(StoryEventRef::Encounter),
        }
    }

    /// 某个选项现在能不能选：不能时返回原因（现金不够、货不够）。
    pub fn story_choice_blocker(&self, fleet: FleetId, choice: &ChoiceDef) -> Option<CommandError> {
        let cash = self.state.agents.get(&OwnerId::Player).map(|a| a.cash).unwrap_or(0);
        if choice.cost > 0 && cash < choice.cost {
            return Some(CommandError::InsufficientCash { need: choice.cost, have: cash });
        }
        if let Some((good, qty)) = choice.give {
            let have = self.state.fleets.get(&fleet).and_then(|f| f.cargo.get(&good)).copied().unwrap_or(0);
            if have < qty {
                return Some(CommandError::InsufficientCargo { have });
            }
        }
        None
    }

    /// 某个检定对主角的成功率（%）。
    pub fn story_check_pct(&self, check: &Check) -> i64 {
        check.chance_pct(
            self.captain_profile(OwnerId::Player).map_or(0, |c| self.defs.captain.check_value(&c.attrs, check.attr)),
        )
    }

    /// 条件是否满足；与舰队有关的条件（停在某港、在某海区）看 `fleet`。
    fn story_cond(&self, cond: &Cond, fleet: Option<&crate::world::Fleet>) -> bool {
        let s = &self.state.story;
        let day = self.state.day;
        let agent = self.state.agents.get(&OwnerId::Player);
        match cond {
            Cond::Day(d) => day >= *d,
            Cond::Wait(d) => s.chapter_day.is_none_or(|last| day >= last.saturating_add(*d)),
            Cond::Docked(ports) => {
                fleet.and_then(|f| f.docked_at()).is_some_and(|l| ports.is_empty() || ports.contains(&l))
            }
            Cond::AtSea(regions) => fleet.is_some_and(|f| {
                f.docked_at().is_none()
                    && (regions.is_empty()
                        || self.defs.map.region_of(f.cell(&self.defs)).is_some_and(|r| regions.contains(&r)))
            }),
            Cond::Cash(m) => agent.is_some_and(|a| a.cash >= *m),
            Cond::NetWorth(m) => agent.is_some_and(|a| a.ledger.equity() >= *m),
            Cond::Fame(n) => agent.is_some_and(|a| a.fame >= *n),
            Cond::Ships(n) => self.fleets_of(OwnerId::Player).map(|f| f.ships.len() as u32).sum::<u32>() >= *n,
            Cond::Sighted(d) => self.state.explore.discovered.contains_key(d),
            Cond::Flag(f) => s.flags.contains(f),
            Cond::NotFlag(f) => !s.flags.contains(f),
            Cond::Season(seasons) => seasons.contains(&(self.defs.calendar.season_of(day).index() as u8)),
            Cond::Sky(skies) => self.story_weather(fleet).is_some_and(|w| skies.contains(&w.sky)),
            Cond::Wind(lo, hi) => self.story_weather(fleet).is_some_and(|w| (*lo..=*hi).contains(&w.wind_strength())),
            Cond::Culture(cultures) => fleet
                .and_then(|f| f.docked_at())
                .is_some_and(|l| cultures.iter().any(|c| *c == self.defs.loc(l).culture)),
        }
    }

    /// 海上的舰队所在海区今天的天气；在港、或者那一格不属于任何海区时为 None。
    fn story_weather(&self, fleet: Option<&crate::world::Fleet>) -> Option<crate::weather::DayWeather> {
        let f = fleet.filter(|f| f.docked_at().is_none())?;
        self.weather_at(f.cell(&self.defs))
    }

    /// 满足全部条件的玩家舰队（按编号，旗舰在先；不在海战中）。没有与舰队有关的条件时就是旗舰队（它在海战中时是下一支）。
    /// `place` 另外限定舰队在海上还是在港口（奇遇用）。
    fn story_fleet(&self, when: &[Cond], place: Option<Place>) -> Option<FleetId> {
        let mut fleets: Vec<&crate::world::Fleet> = self.fleets_of(OwnerId::Player).collect();
        fleets.sort_by_key(|f| f.id);
        fleets
            .into_iter()
            .filter(|f| !self.fleet_in_battle(f.id))
            .filter(|f| match place {
                Some(Place::Sea) => f.docked_at().is_none(),
                Some(Place::Port) => f.docked_at().is_some_and(|l| self.defs.loc(l).is_port()),
                None => true,
            })
            .find(|f| when.iter().all(|c| self.story_cond(c, Some(f))))
            .map(|f| f.id)
    }
}

/// 章节或奇遇（等待回应的事件的内容）。
#[derive(Clone, Copy, Debug)]
pub enum StoryEventRef<'a> {
    Chapter(&'a ChapterDef),
    Encounter(&'a EncounterDef),
}

impl<'a> StoryEventRef<'a> {
    pub fn title(&self) -> &'a str {
        match self {
            StoryEventRef::Chapter(c) => &c.title,
            StoryEventRef::Encounter(e) => &e.title,
        }
    }

    pub fn text(&self) -> &'a str {
        match self {
            StoryEventRef::Chapter(c) => &c.text,
            StoryEventRef::Encounter(e) => &e.text,
        }
    }

    pub fn speaker(&self) -> &'a Speaker {
        match self {
            StoryEventRef::Chapter(c) => &c.speaker,
            StoryEventRef::Encounter(e) => &e.speaker,
        }
    }

    pub fn speaker_name(&self) -> &'a str {
        match self {
            StoryEventRef::Chapter(c) => &c.speaker_name,
            StoryEventRef::Encounter(e) => &e.speaker_name,
        }
    }

    pub fn choices(&self) -> &'a [ChoiceDef] {
        match self {
            StoryEventRef::Chapter(c) => &c.choices,
            StoryEventRef::Encounter(e) => &e.choices,
        }
    }
}

// ───────────────────────────── 每日 ─────────────────────────────

impl World {
    /// 每日（舰队移动之前）：前一天出现、当天没有回应的奇遇就此作罢（不产生任何效果）。章节不会过期。
    pub(crate) fn story_expire(&mut self) {
        let day = self.state.day;
        let Some(p) = self.state.story.pending.clone() else { return };
        if p.day >= day || !matches!(p.source, StorySource::Encounter(_)) {
            return;
        }
        self.state.story.pending = None;
        self.state.story.last = Some(StoryResult {
            day,
            fleet: p.fleet,
            source: p.source.clone(),
            choice: None,
            success: None,
            outcomes: vec![],
        });
        self.push_log(LogEvent {
            day,
            kind: LogKind::StoryResolved { fleet: p.fleet, owner: OwnerId::Player, source: p.source, choice: None },
        });
    }

    /// 每日（舰队移动、发现物之后）：下一章的条件都满足时出现；否则满足间隔时按概率遇到一次奇遇。
    pub(crate) fn story_day(&mut self) {
        if !self.story_enabled() || self.state.story.pending.is_some() {
            return;
        }
        let day = self.state.day;
        // 故事线的下一章
        let next = self.state.story.chapter;
        let chapter = self.story_def().and_then(|s| s.chapters.get(next as usize)).map(|c| c.when.clone());
        if let Some(when) = chapter
            && let Some(fleet) = self.story_fleet(&when, None)
        {
            self.state.story.pending = Some(StoryPending { day, fleet, source: StorySource::Chapter(next) });
            // 经典故事线就是那一局的主线：不论来源一律要紧（与 `pacing_waiting` 的分类一致）
            self.pacing_note(crate::pacing::BeatWeight::Key);
            return;
        }
        // 奇遇：开了节奏规则的世界留到新一天的头一次刷新之后，等过闸的事都排定了、名额有剩才出
        // （[`World::story_encounter_day_start`]）；没开的世界照旧在这里掷。
        if !self.pacing_enabled() {
            self.story_encounter(day);
        }
    }

    /// 开了节奏规则的世界：新一天的头一次刷新之后掷当天的奇遇。奇遇是最不要紧的一类，排在所有过闸的事后面——
    /// 当天还没有任何一件事出场、窗口内可以等的事也没到上限才出（[`World::pacing_room_for_encounter`]）；
    /// 它不会被“按下”，没有名额就当今天没遇到。
    ///
    /// 出现的日子照日结途中生成的口径记作昨夜结算的那一天：玩家今天看到它，今天日结时没有回应就作罢。
    pub(crate) fn story_encounter_day_start(&mut self) {
        if !self.pacing_enabled() || !self.story_enabled() || self.state.story.pending.is_some() {
            return;
        }
        let Some(settled) = self.state.day.checked_sub(1) else { return };
        self.story_encounter(settled);
    }

    /// 满足间隔时按概率遇到一次奇遇。`day` 是记在这件事上的日子（结算的那一天）。
    fn story_encounter(&mut self, day: u32) {
        // 养成期一条都不出：那几年的节奏由月程与旬调度管，奇遇是出海以后的事。
        if self.upbringing_active() {
            return;
        }
        let rules = &self.defs.stories.rules;
        if self.defs.stories.encounters.is_empty() || rules.encounter_bp <= 0 || day < rules.first_day {
            return;
        }
        if self.state.story.encounter_day.is_some_and(|d| day < d.saturating_add(rules.gap_days)) {
            return;
        }
        if self.pacing_enabled() && !self.pacing_room_for_encounter() {
            return;
        }
        let mut rng = Rng::derive(self.state.seed, day, Domain::Story, 0, K_ENCOUNTER);
        if !rng.chance_bp(rules.encounter_bp) {
            return;
        }
        let defs = self.defs.clone();
        let mut candidates: Vec<(usize, FleetId)> = Vec::new();
        for (i, e) in defs.stories.encounters.iter().enumerate() {
            // H02 船员情绪的几阶段只由规则派出，不参与每天的随机
            if defs.rules.voyage_wear.is_crisis_event(&e.key) {
                continue;
            }
            let last = self.state.story.seen.get(&e.key).copied();
            if last.is_some_and(|d| e.once || day < d.saturating_add(e.cooldown_days)) {
                continue;
            }
            if let Some(f) = self.story_fleet(&e.when, Some(e.place)) {
                candidates.push((i, f));
            }
        }
        let weights: Vec<i64> = candidates.iter().map(|(i, _)| defs.stories.encounters[*i].weight).collect();
        let Some(pick) = rng.weighted(&weights) else { return };
        let (i, fleet) = candidates[pick];
        let key = defs.stories.encounters[i].key.clone();
        let s = &mut self.state.story;
        s.seen.insert(key.clone(), day);
        s.encounter_day = Some(day);
        s.pending = Some(StoryPending { day, fleet, source: StorySource::Encounter(key) });
        // 两种时机都记在玩家看到它的那一天：日结途中是明天，新一天的头一次刷新之后就是今天。
        self.pacing_note_seen(crate::pacing::BeatSource::Encounter.weight(), day.saturating_add(1));
    }
}

// ───────────────────────────── 命令 ─────────────────────────────

pub(crate) fn check_answer(world: &World, owner: OwnerId, choice: u32) -> Result<StoryPlan, CommandError> {
    if owner != OwnerId::Player {
        return Err(CommandError::Precondition("只有玩家会遇到剧情事件".into()));
    }
    let p = world
        .state
        .story
        .pending
        .as_ref()
        .ok_or_else(|| Reason::new("story.no_event", "没有正在等待回应的剧情事件").rule())?;
    let event = world
        .story_event(&p.source)
        .ok_or_else(|| Reason::new("story.no_event", "没有正在等待回应的剧情事件").rule())?;
    let c =
        event.choices().get(choice as usize).ok_or_else(|| Reason::new("story.bad_choice", "没有这个选项").rule())?;
    let fleet = answer_fleet(world, p.fleet);
    if let Some(e) = world.story_choice_blocker(fleet.unwrap_or(p.fleet), c) {
        return Err(e);
    }
    Ok(StoryPlan { choice })
}

/// 回应时效果作用的舰队：遇到这件事的舰队；它已经不在了（卖掉、沉没）时是旗舰队。
fn answer_fleet(world: &World, fleet: FleetId) -> Option<FleetId> {
    match world.state.fleets.get(&fleet) {
        Some(f) if f.owner == OwnerId::Player => Some(fleet),
        _ => world.flagship(OwnerId::Player),
    }
}

pub(crate) fn exec_answer(world: &mut World, plan: StoryPlan) -> Result<(), CoreError> {
    let Some(p) = world.state.story.pending.take() else { return Ok(()) };
    let defs = world.defs.clone();
    let choice = {
        let event = match &p.source {
            StorySource::Chapter(i) => world.story_def().and_then(|s| s.chapters.get(*i as usize)).map(|c| &c.choices),
            StorySource::Encounter(key) => defs.stories.encounter(key).map(|e| &e.choices),
        };
        match event.and_then(|c| c.get(plan.choice as usize)) {
            Some(c) => c.clone(),
            None => return Ok(()),
        }
    };
    let day = world.state.day;
    let fleet = answer_fleet(world, p.fleet);
    let mut outcomes = Vec::new();
    // 先付钱、交货
    if choice.cost > 0 {
        outcomes.extend(apply(world, fleet, &StoryEffect::Cash(-choice.cost))?);
    }
    if let Some((good, qty)) = choice.give {
        outcomes.extend(apply(world, fleet, &StoryEffect::Goods(good, -qty))?);
    }
    // 检定
    let success = choice.check.map(|c| {
        let pct = world.story_check_pct(&c);
        let a = fleet.map(|f| f.0 as u64).unwrap_or(0);
        Rng::derive(world.state.seed, day, Domain::Story, a, K_CHECK).chance_bp(pct * 100)
    });
    let effects = if success == Some(false) { &choice.fail } else { &choice.effects };
    for e in effects {
        outcomes.extend(apply(world, fleet, e)?);
    }
    // 记下进度与结果
    let s = &mut world.state.story;
    if let StorySource::Chapter(i) = p.source {
        s.chapter = i + 1;
        s.chapter_day = Some(day);
    }
    s.journal.push(StoryEntry { day, source: p.source.clone(), choice: plan.choice, success });
    if s.journal.len() > JOURNAL_KEPT {
        let excess = s.journal.len() - JOURNAL_KEPT;
        s.journal.drain(0..excess);
    }
    let at = fleet.unwrap_or(p.fleet);
    s.last =
        Some(StoryResult { day, fleet: at, source: p.source.clone(), choice: Some(plan.choice), success, outcomes });
    world.push_log(LogEvent {
        day,
        kind: LogKind::StoryResolved { fleet: at, owner: OwnerId::Player, source: p.source, choice: Some(plan.choice) },
    });
    Ok(())
}

/// 执行一条效果，返回实际发生的结果（没有效果时为空）。
pub(crate) fn apply(
    world: &mut World,
    fleet: Option<FleetId>,
    effect: &StoryEffect,
) -> Result<Option<StoryOutcome>, CoreError> {
    let day = world.state.day;
    let owner = OwnerId::Player;
    let defs = world.defs.clone();
    Ok(match effect {
        StoryEffect::Cash(v) => {
            let cash = world.agent(owner)?.cash.max(0);
            let delta = if *v < 0 { -(-*v).min(cash) } else { *v };
            if delta > 0 {
                world.book_external(
                    owner,
                    Flow::Other,
                    Sector::Hinterland,
                    JournalEntry::new(day, Memo::Other, CashClass::Operating)
                        .dr(Account::Cash, delta)
                        .cr(Account::OtherIncome, delta),
                )?;
            } else if delta < 0 {
                world.book_external(
                    owner,
                    Flow::Other,
                    Sector::Hinterland,
                    JournalEntry::new(day, Memo::Other, CashClass::Operating)
                        .dr(Account::OtherExpense, -delta)
                        .cr(Account::Cash, -delta),
                )?;
            }
            (delta != 0).then_some(StoryOutcome::Cash(delta))
        }
        StoryEffect::Fame(v) => {
            let a = world.agent_mut(owner)?;
            let before = a.fame;
            a.fame = (a.fame + v).max(0);
            let d = a.fame - before;
            (d != 0).then_some(StoryOutcome::Fame(d))
        }
        StoryEffect::Reputation(faction, v) => {
            let local = fleet
                .and_then(|f| world.state.fleets.get(&f))
                .and_then(|f| f.docked_at())
                .map(|l| world.location_faction(l));
            match faction.or(local) {
                Some(fid) => {
                    let before = world.reputation(owner, fid);
                    world.adjust_reputation(owner, fid, *v);
                    let d = world.reputation(owner, fid) - before;
                    (d != 0).then_some(StoryOutcome::Reputation(fid, d))
                }
                None => None,
            }
        }
        StoryEffect::Morale(v) => match fleet.and_then(|f| world.state.fleets.get_mut(&f)) {
            Some(f) => {
                let before = f.morale;
                f.morale = (f.morale + v).clamp(0, 100);
                let d = f.morale - before;
                (d != 0).then_some(StoryOutcome::Morale(d))
            }
            None => None,
        },
        StoryEffect::Goods(good, qty) => match fleet {
            Some(fid) if *qty > 0 => {
                let q = (*qty).min(world.fleet(fid)?.free_capacity());
                if q > 0 {
                    add_cargo(world, fid, *good, q)?;
                }
                (q > 0).then_some(StoryOutcome::Goods(*good, q))
            }
            Some(fid) if *qty < 0 => {
                let have = world.fleet(fid)?.cargo.get(good).copied().unwrap_or(0);
                let q = (-*qty).min(have);
                if q > 0 {
                    take_cargo(world, fid, *good, q)?;
                }
                (q > 0).then_some(StoryOutcome::Goods(*good, -q))
            }
            _ => None,
        },
        StoryEffect::Crew(v) => match fleet {
            Some(fid) => {
                let (min, max) = {
                    let f = world.fleet(fid)?;
                    (f.crew_min(&defs), f.crew_max(&defs))
                };
                let f = world.fleet_mut(fid)?;
                let before = f.crew;
                f.crew = if *v >= 0 { (f.crew + v).min(max.max(f.crew)) } else { (f.crew + v).max(min.min(f.crew)) };
                let d = f.crew - before;
                (d != 0).then_some(StoryOutcome::Crew(d))
            }
            None => None,
        },
        StoryEffect::Repair(pct) => match fleet {
            Some(fid) => {
                let mut any = false;
                for s in world.fleet_mut(fid)?.ships.iter_mut() {
                    let missing = (s.max_durability - s.durability).max(0);
                    if missing > 0 {
                        s.durability += mul_div(missing, (*pct).clamp(0, 100), 100).max(1).min(missing);
                        any = true;
                    }
                }
                any.then_some(StoryOutcome::Repair(*pct))
            }
            None => None,
        },
        StoryEffect::Damage(pct) => match fleet {
            Some(fid) => {
                for s in world.fleet_mut(fid)?.ships.iter_mut() {
                    let dmg = mul_div(s.max_durability, (*pct).clamp(0, 100), 100);
                    s.durability = (s.durability - dmg).max(1);
                }
                Some(StoryOutcome::Damage(*pct))
            }
            None => None,
        },
        StoryEffect::Supplies(days) => match fleet {
            Some(fid) => {
                let f = world.fleet_mut(fid)?;
                let need = crate::fleet::supplies_for_days(&defs, f.crew.max(1), days.saturating_abs());
                if *days > 0 {
                    let food = need.min(f.free_capacity() / 2);
                    f.food += food;
                    let water = need.min(f.free_capacity());
                    f.water += water;
                    (food + water > 0).then_some(StoryOutcome::Supplies(*days))
                } else {
                    let food = need.min(f.food);
                    let water = need.min(f.water);
                    f.food -= food;
                    f.water -= water;
                    f.normalize_supplies();
                    (food + water > 0).then_some(StoryOutcome::Supplies(*days))
                }
            }
            None => None,
        },
        StoryEffect::Rumor => {
            // 与开局的传闻一样不看名声门槛：尚未发现、还没有传闻、能确定大致海区的发现物里按种子挑一处
            let ids: Vec<DiscoveryId> = defs
                .discovery_ids()
                .filter(|id| {
                    !world.state.explore.discovered.contains_key(id)
                        && !world.state.explore.rumors.contains_key(id)
                        && crate::explore::discovery_region(&defs, *id).is_some()
                })
                .collect();
            if ids.is_empty() {
                None
            } else {
                let a = fleet.map(|f| f.0 as u64).unwrap_or(0);
                let mut rng = Rng::derive(world.state.seed, day, Domain::Story, a, K_RUMOR);
                let id = ids[rng.below(ids.len() as u64) as usize];
                world.record_rumor(id);
                Some(StoryOutcome::Rumor(id))
            }
        }
        StoryEffect::Reveal(d) => {
            let cell = defs.discovery(*d).cell;
            world.init_exploration();
            world.reveal_around(cell, REVEAL_RADIUS);
            Some(StoryOutcome::Reveal(*d))
        }
        StoryEffect::Chart(region) => {
            if world.state.explore.charts.contains(region) {
                None
            } else {
                crate::explore::exec_chart(world, owner, crate::explore::ChartPlan { region: *region, cost: 0 })?;
                Some(StoryOutcome::Chart(*region))
            }
        }
        StoryEffect::Mate(mate) => match world.state.mates.get(mate).map(|m| m.owner) {
            Some(None) => {
                if let Some(m) = world.state.mates.get_mut(mate) {
                    m.owner = Some(owner);
                    m.role = MateRole::None;
                    m.hired_on = Some(day);
                }
                world.refresh_trade_bonus();
                Some(StoryOutcome::Mate(*mate))
            }
            Some(Some(o)) if o == owner => None,
            Some(Some(_)) => Some(StoryOutcome::MateBusy(*mate)),
            None => None,
        },
        StoryEffect::Attr(i, v) => {
            let [lo, hi] = if defs.captain.legacy {
                [1, defs.captain.points.max.max(1)]
            } else {
                defs.captain.group(*i).map_or([0, 0], |g| g.range)
            };
            let a = world.agent_mut(owner)?;
            match a.captain.as_mut().and_then(|c| c.attrs.get_mut(*i)) {
                Some(x) => {
                    let before = *x;
                    *x = x.saturating_add(*v).clamp(lo, hi);
                    let d = *x - before;
                    (d != 0).then_some(StoryOutcome::Attr(*i as u32, d))
                }
                None => None,
            }
        }
        StoryEffect::Flag(f) => {
            world.state.story.flags.insert(f.clone());
            None
        }
    })
}

/// 故事里得到的货装上舰队：按基准价记入存货（借：存货，贷：其他收入），不涉及现金。
fn add_cargo(world: &mut World, fleet: FleetId, good: GoodId, qty: i64) -> Result<(), CoreError> {
    let day = world.state.day;
    let cost = world.defs.good(good).base_price * qty;
    *world.fleet_mut(fleet)?.cargo.entry(good).or_insert(0) += qty;
    world.agent_mut(OwnerId::Player)?.book.add(good, qty, cost);
    if cost > 0 {
        world.book_internal(
            OwnerId::Player,
            JournalEntry::new(day, Memo::Other, CashClass::Operating)
                .dr(Account::Inventory, cost)
                .cr(Account::OtherIncome, cost),
        )?;
    }
    Ok(())
}

/// 从舰队货舱里拿走货物（交给别人或损失）：按平均成本转为其他费用（借：其他费用，贷：存货），不涉及现金。
pub(crate) fn take_cargo(world: &mut World, fleet: FleetId, good: GoodId, qty: i64) -> Result<(), CoreError> {
    let day = world.state.day;
    {
        let f = world.fleet_mut(fleet)?;
        let have = f.cargo.get(&good).copied().unwrap_or(0);
        let left = have - qty.min(have);
        if left == 0 {
            f.cargo.remove(&good);
        } else {
            f.cargo.insert(good, left);
        }
    }
    let cost = world.agent_mut(OwnerId::Player)?.book.remove(good, qty);
    if cost > 0 {
        world.book_internal(
            OwnerId::Player,
            JournalEntry::new(day, Memo::Other, CashClass::Operating)
                .dr(Account::OtherExpense, cost)
                .cr(Account::Inventory, cost),
        )?;
    }
    Ok(())
}

/// 属性下标对应的 key（界面与日志用）。
pub fn attr_key(i: usize) -> &'static str {
    ATTRIBUTES.get(i).copied().unwrap_or("")
}
