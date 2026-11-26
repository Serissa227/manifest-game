//! 多轨道故事；状态以轨道和章节 key 存储，空模块不影响经典世界。
pub mod conditions;
pub mod dice;
pub mod effects;
pub mod graph;
pub mod legacy;
pub mod objectives;
pub mod queue;
mod reconcile;
pub mod validation;
use crate::{
    cast::relations::{Bond, Relation},
    ids::LocId,
    scenario::WorldDate,
};
pub use objectives::{Objective, ObjectiveKind};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Story2Defs {
    pub tracks: Vec<TrackDef>,
    #[serde(skip)]
    pub skills: BTreeSet<String>,
    #[serde(skip)]
    pub skill_labels: Vec<SkillLabel>,
    /// 技能 key → 种类（skills.toml 的 kind）；只由加载器填，供通用失败语句按技能种类分池。
    #[serde(skip)]
    pub skill_kinds: BTreeMap<String, String>,
    /// 技能 key → 各等级的效果（skills.toml 的 effects 与 levels；K01）。只由加载器填；生效与否看 `[skill_effects]`。
    #[serde(skip)]
    pub skill_effects: crate::skills::SkillEffectTable,
    /// 草稿世界显式登记的待交付旗标（runtime_links.toml 的 pending_flags）：设置它的内容包还没交付。
    /// 只由加载器填，故事分片不能自己声明；图检查据此不报“没有来源”，但已有设置者或无人读取都报错。
    #[serde(skip)]
    pub pending_flags: BTreeSet<String>,
    /// 轨道按 key 排好序的次序，第一次用到时建（[`Story2Defs::track`] 与 [`Story2Defs::by_key`]）。
    #[serde(skip)]
    order: crate::keyed::KeyOrder,
}

/// 检定显示名；不参与技能计算或存档，source仅供当前语言覆盖。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SkillLabel {
    pub key: String,
    pub name: String,
    pub description: String,
    pub source: String,
}
impl Story2Defs {
    /// key 对应的轨道（key 重复时取 `tracks` 里靠前的那一条，与逐条比较相同）。
    ///
    /// 寰宇有八百多条轨道，而每条命令之后都要把进行中的轨道理一遍（[`crate::World::refresh_story2`]），
    /// 逐条比较 key 是平方级的；这里按排好序的次序二分（[`crate::keyed::KeyOrder`]）。
    pub fn track(&self, key: &str) -> Option<&TrackDef> {
        self.order.find(&self.tracks, key, |t| &t.key)
    }

    /// 轨道按 key 从小到大的次序（key 相同的保持 `tracks` 里的先后），连同各自的 key；次序与当前的 `tracks` 对不上时为 None。
    /// 与同样按 key 排序的状态表并排走一遍用（[`crate::World::refresh_story2`]）。
    pub(crate) fn by_key(&self) -> Option<impl Iterator<Item = (&str, &TrackDef)> + Clone + '_> {
        self.order.sorted(&self.tracks, |t| &t.key)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrackKind {
    Main,
    History,
    Request,
    Encounter,
    Guide,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Stage {
    Witness,
    Involve,
    Rumor,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrackDef {
    /// 加载器填写的分片路径，只用于显示翻译索引。
    #[serde(skip)]
    pub source: String,
    pub key: String,
    pub name: String,
    pub kind: TrackKind,
    pub start: String,
    #[serde(default = "yes")]
    pub auto: bool,
    #[serde(default)]
    pub cast: Vec<String>,
    #[serde(default)]
    pub academy: bool,
    /// 养成期放行：不属于学院、但写给养成期看的轨道显式标记。养成进行中只放行学院轨道或带此标记的轨道（任务单 U03 / A2）。
    #[serde(default)]
    pub upbringing: bool,
    pub chapters: Vec<ChapterDef>,
}
impl TrackDef {
    pub fn chapter(&self, key: &str) -> Option<&ChapterDef> {
        self.chapters.iter().find(|c| c.key == key)
    }
}
fn is_false(value: &bool) -> bool {
    !value
}
fn yes() -> bool {
    true
}
fn rumor_days() -> u32 {
    30
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChapterDef {
    pub key: String,
    pub title: String,
    pub text: String,
    #[serde(default)]
    pub when: Vec<Condition>,
    #[serde(default)]
    pub choices: Vec<Choice>,
    pub stage: Option<Stage>,
    pub window: Option<[WorldDate; 2]>,
    pub at: Option<String>,
    #[serde(default)]
    pub venue: String,
    #[serde(default)]
    pub cast: Vec<String>,
    pub speaker: Option<String>,
    pub mood: Option<String>,
    pub art: Option<String>,
    #[serde(default)]
    pub night: bool,
    pub default: Option<Branch>,
    pub news: Option<String>,
    #[serde(default = "rumor_days")]
    pub rumor_days: u32,
    #[serde(default)]
    pub objectives: Vec<Objective>,
    pub deadline: Option<WorldDate>,
    pub deadline_days: Option<u32>,
    pub timeout: Option<Branch>,
    #[serde(default = "yes")]
    pub once: bool,
    pub family: Option<String>,
    #[serde(default)]
    pub family_cooldown_days: u32,
    #[serde(default)]
    pub variants: Vec<Variant>,
    pub hint: Option<String>,
    pub go: Option<guide_defs::Go>,
    #[serde(default)]
    pub teaches: Vec<String>,
    /// 独立立绘键或人物键；缺省不指定立绘，不改变 cast。
    #[serde(default)]
    pub figure: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Variant {
    pub key: String,
    #[serde(default)]
    pub when: Vec<Condition>,
    pub title: Option<String>,
    pub text: Option<String>,
    pub speaker: Option<String>,
    pub mood: Option<String>,
    pub art: Option<String>,
    pub night: Option<bool>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Check {
    pub attr: String,
    pub base: i64,
    pub per: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Branch {
    pub next: String,
    #[serde(default)]
    pub effects: Vec<Effect>,
    pub news: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(remote = "Self", deny_unknown_fields)]
pub struct Choice {
    pub key: String,
    pub text: String,
    pub next: String,
    #[serde(default)]
    pub effects: Vec<Effect>,
    #[serde(default)]
    pub requires: Vec<Condition>,
    /// U02：`requires` 里标了 `hard = true` 的位置（只允许标在 attr / growth / skill 上），
    /// 掷骰规则打开时这些门槛仍然锁死；通用 [`Condition`] 词表不变。
    #[serde(skip)]
    pub hard: BTreeSet<usize>,
    pub hint: Option<String>,
    pub news: Option<String>,
    #[serde(default)]
    pub reply: String,
    pub check: Option<Check>,
    pub fail: Option<Branch>,
}
impl Choice {
    pub fn branch(&self) -> Branch {
        Branch { next: self.next.clone(), effects: self.effects.clone(), news: self.news.clone() }
    }
}

impl<'de> Deserialize<'de> for Choice {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let mut value = serde_json::Value::deserialize(deserializer)?;
        // `hard` 是选项门槛自己的标记：先从条件里摘下来记住位置，其余字段照旧严格校验。
        let mut hard = BTreeSet::new();
        if let Some(conditions) = value.get_mut("requires").and_then(serde_json::Value::as_array_mut) {
            for (index, condition) in conditions.iter_mut().enumerate() {
                let Some(fields) = condition.as_object_mut() else { continue };
                let Some(flag) = fields.remove("hard") else { continue };
                let flag = flag.as_bool().ok_or_else(|| serde::de::Error::custom("hard 必须是 true 或 false"))?;
                let kind = fields.get("kind").and_then(serde_json::Value::as_str);
                if !matches!(kind, Some("attr" | "growth" | "skill")) {
                    return Err(serde::de::Error::custom("hard 只能标在选项的 attr、growth、skill 门槛上"));
                }
                if flag {
                    hard.insert(index);
                }
            }
        }
        let mut choice = Self::deserialize(value).map_err(serde::de::Error::custom)?;
        choice.hard = hard;
        Ok(choice)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(remote = "Self", tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Condition {
    Date {
        from: Option<WorldDate>,
        to: Option<WorldDate>,
    },
    Flag {
        flag: String,
        #[serde(default = "yes")]
        value: bool,
    },
    At {
        at: String,
        person: Option<String>,
    },
    Age {
        person: Option<String>,
        ge: Option<u32>,
        le: Option<u32>,
    },
    Affinity {
        person: String,
        ge: i64,
    },
    Heart {
        person: String,
        ge: i64,
    },
    Bond {
        person: String,
        level: Bond,
    },
    NotBondS {
        person: String,
    },
    Wait {
        days: u32,
    },
    Season {
        season: u32,
    },
    Attr {
        attr: String,
        ge: i64,
    },
    Growth {
        attr: String,
        ge: i64,
    },
    Skill {
        skill: String,
        ge: i64,
    },
    Cash {
        ge: i64,
    },
    Fame {
        ge: i64,
    },
    Reputation {
        faction: String,
        ge: i64,
    },
    Item {
        item: String,
        qty: i64,
    },
    Equipped {
        item: String,
    },
    Mate {
        mate: String,
    },
    Relation {
        person: String,
        relation: Relation,
    },
    Tie {
        a: String,
        b: String,
        relation: Relation,
    },
    Alive {
        person: String,
        value: bool,
    },
    Read {
        work: String,
    },
    Books {
        ge: u32,
        category: Option<String>,
    },
    Gifts {
        person: String,
        count: Option<u32>,
        value: Option<i64>,
        kinds: Option<u32>,
        category: Option<String>,
        qty: Option<u64>,
    },
    Price {
        good: String,
        at: String,
        ge: Option<i64>,
        le: Option<i64>,
    },
    Location {
        culture: Option<String>,
        port: Option<bool>,
    },
    Society {
        society: String,
        ge: u8,
    },
    Spell {
        spell: String,
    },
    Lineage {
        lineage: String,
        person: Option<String>,
    },
    Protagonist {
        protagonist: String,
    },
    ProtagonistIn {
        protagonist_in: Vec<String>,
    },
    RomanceOpen {
        romance_open: String,
    },
    Visited {
        at: Option<String>,
        ge: Option<u32>,
    },
    PortsKnown {
        ge: u32,
    },
    HouseLevel {
        at: Option<String>,
        ge: u32,
    },
    Warehouse {
        at: Option<String>,
        ge: Option<u32>,
    },
    Industries {
        at: Option<String>,
        industry: Option<String>,
        ge: u32,
    },
    Ships {
        ge: u32,
    },
    ShipTier {
        ge: u32,
    },
    Mates {
        ge: u32,
    },
    Post {
        post: String,
    },
    Rank {
        at: String,
        ge: u32,
    },
    Deed {
        deed: deeds::Deed,
        ge: u32,
        #[serde(default)]
        since_entered: bool,
    },
    Any {
        any: Vec<Condition>,
    },
}

impl<'de> Deserialize<'de> for Condition {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let mut value = serde_json::Value::deserialize(deserializer)?;
        // 新条件也接受作者使用的简写；其余词表仍要求显式 kind，未知字段照旧拒绝。
        if let Some(fields) = value.as_object_mut()
            && !fields.contains_key("kind")
            && fields.len() == 1
            && let Some(kind) =
                ["protagonist", "protagonist_in", "romance_open"].into_iter().find(|key| fields.contains_key(*key))
        {
            fields.insert("kind".into(), kind.into());
        }
        Self::deserialize(value).map_err(serde::de::Error::custom)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Effect {
    Flag {
        flag: String,
        #[serde(default = "yes")]
        value: bool,
    },
    Affinity {
        person: String,
        value: i64,
    },
    Heart {
        person: String,
        value: i64,
    },
    Relation {
        person: String,
        relation: Relation,
        #[serde(default)]
        remove: bool,
    },
    Tie {
        a: String,
        b: String,
        relation: Relation,
        #[serde(default)]
        remove: bool,
    },
    Bond {
        person: String,
        level: Bond,
    },
    Letter {
        person: String,
        text: String,
    },
    Item {
        item: String,
        qty: i64,
    },
    Skill {
        skill: String,
        value: i64,
    },
    Growth {
        attr: String,
        value: i64,
    },
    Memory {
        memory: String,
        title: String,
    },
    Title {
        title: String,
    },
    StartTrack {
        track: String,
    },
    EndTrack {
        track: String,
    },
    Join {
        person: String,
    },
    Leave {
        person: String,
    },
    Schedule {
        person: String,
        at: String,
        #[serde(default)]
        venue: String,
        until: Option<WorldDate>,
    },
    Cash {
        value: i64,
    },
    Fame {
        value: i64,
    },
    Reputation {
        faction: String,
        value: i64,
    },
    Chart {
        region: String,
    },
    World {
        title: String,
        text: String,
        effects: Vec<crate::composed::ComposedEffect>,
    },
    LearnSpell {
        spell: String,
    },
    Transform {
        lineage: Option<String>,
    },
    OpenRealm {
        realm: String,
    },
    EatOtherworld {
        realm: String,
    },
    LegendShip {
        ship: String,
    },
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Story2State {
    pub tracks: BTreeMap<String, TrackState>,
    pub pending: Vec<Pending>,
    pub news: BTreeMap<String, News>,
    pub flags: BTreeSet<String>,
    pub last: Option<Story2Result>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub families: BTreeMap<String, u32>,
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    pub variants_seen: BTreeSet<(String, String, String)>,
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    pub removed_ties: BTreeSet<(String, String)>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub memories: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub known_ties: Vec<KnownTie>,
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    pub completed_objectives: BTreeSet<(String, String)>,
    /// U02：各轨道本次事件里掷骰失败过的选项；轨道结算后清掉，旧档没有这一项。
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub failed_choices: BTreeMap<String, dice::FailedChoices>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub deeds: BTreeMap<deeds::Deed, u32>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub deed_marks: BTreeMap<String, deeds::DeedMark>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pinned: Option<String>,
    /// 开过的主线种类轨道；旧档缺省为空。
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    pub opened: BTreeSet<String>,
    /// 从未开过就自动结算过的主线种类轨道。
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    pub quiet: BTreeSet<String>,
}

/// 玩家上次获知的关系；世界之后发生但未被获知的改变不覆盖此记录。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct KnownTie {
    pub a: String,
    pub b: String,
    pub kind: Option<Relation>,
    pub day: u32,
    pub source: String,
}
impl Story2State {
    pub fn is_empty(&self) -> bool {
        self == &Self::default()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Active,
    Done,
    Failed,
    /// 内容调整后停在最后一个仍存在的检查点，不重复发放已完成章节的效果。
    Waiting,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TrackState {
    pub chapter: String,
    #[serde(default)]
    pub visited: BTreeSet<String>,
    pub entered: u32,
    pub status: Status,
    pub failure: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Pending {
    pub track: String,
    pub chapter: String,
    pub day: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub variant: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NewsKind {
    Seen,
    Heard,
    Letter,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct News {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub success: Option<bool>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub timeout: bool,
    #[serde(default)]
    pub choice: Option<u32>,
    /// 稳定选项键用于内容调整后的迁移；旧档缺省仍按原索引读取。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub choice_key: Option<String>,
    pub id: String,
    pub day: u32,
    pub text: String,
    pub persons: Vec<String>,
    pub kind: NewsKind,
    pub loc: Option<LocId>,
    pub track: String,
    pub known: bool,
    pub read: bool,
    pub rumor_days: u32,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Story2Result {
    pub track: String,
    pub chapter: String,
    pub day: u32,
    pub text: String,
    pub choice: Option<u32>,
    /// 稳定选项键用于内容调整后的迁移；旧档缺省仍按原索引读取。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub choice_key: Option<String>,
    pub news: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub success: Option<bool>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub outcomes: Vec<Effect>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub variant: Option<String>,
    /// U02：掷骰规则打开时，本次回应的骰子（含原 check）；规则关闭的世界从不写入。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub roll: Option<dice::Roll>,
    /// U02：掷骰失败且选项没有 fail 分支时的通用失败；此时轨道停在原节点。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub soft_fail: Option<dice::SoftFailure>,
}

pub mod deeds;
pub mod guide_defs;
pub mod quests;

pub mod guide;

pub const FAILURE_WINDOW_UNMET: &str = "window_unmet";
pub const FAILURE_TIMEOUT_MISSING: &str = "timeout_missing";
pub const FAILURE_DEFAULT_MISSING: &str = "default_missing";
pub const FAILURE_SETTLE_FAILED: &str = "settle_failed";
