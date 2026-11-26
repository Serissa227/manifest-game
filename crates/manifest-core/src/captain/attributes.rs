//! 世界定义的属性、评价、岗位与封闭的效果词表。比例统一用基点，窗口、半径与数量用整数。
use super::{CaptainDefs, CaptainPoints};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AttrHook {
    FlagshipSpeed,
    SteeringPrecision,
    PositionFix,
    FogReveal,
    NavalCombat,
    Melee,
    Duel,
    FleetCoordination,
    Morale,
    FleetLimit,
    TaxDiscount,
    BargainDiscount,
    WageDiscount,
    MarketWindow,
    RecruitDiscount,
    AffinityGain,
    Audience,
    Negotiate,
    IntelReliability,
    IntelSecrecy,
    IntelDetection,
    Smuggling,
    Train,
    Healing,
    Fatigue,
    StormCheck,
    CreatureCheck,
    StudyXp,
    Appraisal,
    SpellPower,
    CheckRandom,
    Religion,
    Honor,
    Morality,
    GiftAppreciation,
    CaravanSpeed,
    CaravanRisk,
    IndustryEfficiency,
    // 物品共用钩子；已有枚举顺序保持不变。
    Upwind,
    FogSailing,
    SupplyDiscount,
    Landing,
    DiseaseGuard,
    Find,
    ChartReveal,
    Spell,
    Activity,
}
impl AttrHook {
    pub const ALL: &'static [Self] = &[
        Self::FlagshipSpeed,
        Self::SteeringPrecision,
        Self::PositionFix,
        Self::FogReveal,
        Self::NavalCombat,
        Self::Melee,
        Self::Duel,
        Self::FleetCoordination,
        Self::Morale,
        Self::FleetLimit,
        Self::TaxDiscount,
        Self::BargainDiscount,
        Self::WageDiscount,
        Self::MarketWindow,
        Self::RecruitDiscount,
        Self::AffinityGain,
        Self::Audience,
        Self::Negotiate,
        Self::IntelReliability,
        Self::IntelSecrecy,
        Self::IntelDetection,
        Self::Smuggling,
        Self::Train,
        Self::Healing,
        Self::Fatigue,
        Self::StormCheck,
        Self::CreatureCheck,
        Self::StudyXp,
        Self::Appraisal,
        Self::SpellPower,
        Self::CheckRandom,
        Self::Religion,
        Self::Honor,
        Self::Morality,
        Self::GiftAppreciation,
        Self::CaravanSpeed,
        Self::CaravanRisk,
        Self::IndustryEfficiency,
        Self::Upwind,
        Self::FogSailing,
        Self::SupplyDiscount,
        Self::Landing,
        Self::DiseaseGuard,
        Self::Find,
        Self::ChartReveal,
        Self::Spell,
        Self::Activity,
    ];
    pub fn key(self) -> &'static str {
        match self {
            Self::FlagshipSpeed => "flagship_speed",
            Self::SteeringPrecision => "steering_precision",
            Self::PositionFix => "position_fix",
            Self::FogReveal => "fog_reveal",
            Self::NavalCombat => "naval_combat",
            Self::Melee => "melee",
            Self::Duel => "duel",
            Self::FleetCoordination => "fleet_coordination",
            Self::Morale => "morale",
            Self::FleetLimit => "fleet_limit",
            Self::TaxDiscount => "tax_discount",
            Self::BargainDiscount => "bargain_discount",
            Self::WageDiscount => "wage_discount",
            Self::MarketWindow => "market_window",
            Self::RecruitDiscount => "recruit_discount",
            Self::AffinityGain => "affinity_gain",
            Self::Audience => "audience",
            Self::Negotiate => "negotiate",
            Self::IntelReliability => "intel_reliability",
            Self::IntelSecrecy => "intel_secrecy",
            Self::IntelDetection => "intel_detection",
            Self::Smuggling => "smuggling",
            Self::Train => "train",
            Self::Healing => "healing",
            Self::Fatigue => "fatigue",
            Self::StormCheck => "storm_check",
            Self::CreatureCheck => "creature_check",
            Self::StudyXp => "study_xp",
            Self::Appraisal => "appraisal",
            Self::SpellPower => "spell_power",
            Self::CheckRandom => "check_random",
            Self::Religion => "religion",
            Self::Honor => "honor",
            Self::Morality => "morality",
            Self::GiftAppreciation => "gift_appreciation",
            Self::CaravanSpeed => "caravan_speed",
            Self::CaravanRisk => "caravan_risk",
            Self::IndustryEfficiency => "industry_efficiency",
            Self::Upwind => "upwind",
            Self::FogSailing => "fog_sailing",
            Self::SupplyDiscount => "supply_discount",
            Self::Landing => "landing",
            Self::DiseaseGuard => "disease_guard",
            Self::Find => "find",
            Self::ChartReveal => "chart_reveal",
            Self::Spell => "spell",
            Self::Activity => "activity",
        }
    }
    pub fn parse(key: &str) -> Option<Self> {
        Self::ALL.iter().copied().find(|h| h.key() == key)
    }
    /// 引擎的硬上限；世界只能收紧，不得用数据放大到破坏基本规则。
    pub fn ceiling(self) -> i64 {
        match self {
            Self::FlagshipSpeed | Self::CaravanSpeed | Self::TaxDiscount | Self::WageDiscount => 1_000,
            Self::NavalCombat | Self::CaravanRisk => 5_000,
            Self::IndustryEfficiency | Self::RecruitDiscount => 2_000,
            Self::BargainDiscount => 1_000,
            Self::MarketWindow => 100,
            Self::FogReveal => 64,
            Self::FleetLimit | Self::CheckRandom => 100,
            _ => 10_000,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct AttributeRules {
    pub caps: BTreeMap<AttrHook, i64>,
}
impl AttributeRules {
    pub fn cap(&self, hook: AttrHook) -> i64 {
        self.caps.get(&hook).copied().unwrap_or(hook.ceiling()).clamp(0, hook.ceiling())
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HookDef {
    pub hook: AttrHook,
    pub per_point: i64,
    pub max: Option<i64>,
}
impl HookDef {
    pub fn value(&self, points: i64) -> i64 {
        points.max(0).saturating_mul(self.per_point).min(self.max.unwrap_or(i64::MAX))
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AttributeGroup {
    pub key: String,
    pub name: String,
    pub range: [i64; 2],
    pub start: i64,
    pub free: i64,
    pub creation_cap: i64,
}
impl AttributeGroup {
    pub fn classic(p: &CaptainPoints) -> Self {
        Self {
            key: "classic".into(),
            name: "属性".into(),
            range: [0, p.max],
            start: p.base,
            free: p.free,
            creation_cap: p.creation_cap,
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RatingDef {
    pub key: String,
    pub name: String,
    pub weights: Vec<(usize, i64)>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AbilityDef {
    pub key: String,
    pub name: String,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RoleScope {
    Owner,
    Fleet,
    Caravan,
    Industry,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LegacyRole {
    Captain,
    Accountant,
    Trader,
    CaravanLeader,
    IndustryManager,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RoleHook {
    pub effect: HookDef,
    pub ability: String,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RoleDef {
    pub key: String,
    pub name: String,
    pub ability: String,
    pub hooks: Vec<RoleHook>,
    pub scope: RoleScope,
    /// 旧命令的岗位到静态定义的桥接；新世界自定义岗位走追加的任职类型。
    pub legacy: Option<LegacyRole>,
    /// 一句“这个岗位在海上管什么”（岗位窗口显示；经典岗位与旧数据为空）
    pub desc: String,
}
pub fn classic_abilities() -> Vec<AbilityDef> {
    [("navigation", "航海"), ("trade", "交易"), ("combat", "战斗"), ("management", "管理")]
        .into_iter()
        .map(|(key, name)| AbilityDef { key: key.into(), name: name.into() })
        .collect()
}
pub fn classic_roles() -> Vec<RoleDef> {
    use AttrHook::*;
    let make = |key: &str, name: &str, ability: &str, scope, legacy, hooks: Vec<(AttrHook, &str, i64)>| RoleDef {
        key: key.into(),
        name: name.into(),
        ability: ability.into(),
        scope,
        legacy: Some(legacy),
        desc: String::new(),
        hooks: hooks
            .into_iter()
            .map(|(hook, ability, per_point)| RoleHook {
                effect: HookDef { hook, per_point, max: None },
                ability: ability.into(),
            })
            .collect(),
    };
    vec![
        make(
            "captain",
            "舰长",
            "navigation",
            RoleScope::Fleet,
            LegacyRole::Captain,
            vec![(FlagshipSpeed, "navigation", 10), (NavalCombat, "combat", 50)],
        ),
        make(
            "accountant",
            "会计",
            "management",
            RoleScope::Owner,
            LegacyRole::Accountant,
            vec![(WageDiscount, "management", 10)],
        ),
        make(
            "trader",
            "交易员",
            "trade",
            RoleScope::Owner,
            LegacyRole::Trader,
            vec![(TaxDiscount, "trade", 10), (BargainDiscount, "trade", 5)],
        ),
        make(
            "caravan_leader",
            "商队头领",
            "navigation",
            RoleScope::Caravan,
            LegacyRole::CaravanLeader,
            vec![(CaravanSpeed, "navigation", 10), (CaravanRisk, "combat", 50)],
        ),
        make(
            "industry_manager",
            "产业管理人",
            "management",
            RoleScope::Industry,
            LegacyRole::IndustryManager,
            vec![(IndustryEfficiency, "management", 20)],
        ),
    ]
}
pub fn classic_hooks(key: &str) -> Vec<HookDef> {
    use AttrHook::*;
    let pairs = match key {
        "seamanship" => vec![(FlagshipSpeed, 100)],
        "commerce" => vec![(TaxDiscount, 100)],
        "arms" => vec![(NavalCombat, 500)],
        "stewardship" => vec![(WageDiscount, 100)],
        "numeracy" => vec![(MarketWindow, 1)],
        "eloquence" => vec![(BargainDiscount, 30), (RecruitDiscount, 200)],
        _ => vec![],
    };
    pairs.into_iter().map(|(hook, per_point)| HookDef { hook, per_point, max: None }).collect()
}
impl CaptainDefs {
    /// 单个主角全部属性的钩子合计：先限制属性范围与单项 max，最后限制全局上限。
    pub fn hook_value(&self, attrs: &[i64], hook: AttrHook, rules: &AttributeRules) -> i64 {
        self.attributes
            .iter()
            .enumerate()
            .fold(0i64, |sum, (i, a)| {
                a.hooks
                    .iter()
                    .filter(|h| h.hook == hook)
                    .fold(sum, |sum, h| sum.saturating_add(h.value(self.attr_value(attrs, i))))
            })
            .min(rules.cap(hook))
    }
    pub fn attribute_index(&self, key: &str) -> Option<usize> {
        self.attributes.iter().position(|a| a.key == key).or_else(|| {
            (self.attributes.is_empty() && self.legacy)
                .then(|| super::ATTRIBUTES.iter().position(|a| *a == key))
                .flatten()
        })
    }
    pub fn group(&self, attr: usize) -> Option<&AttributeGroup> {
        let a = self.attributes.get(attr)?;
        self.groups.iter().find(|g| g.key == a.group)
    }
    pub fn check_index(&self, key: &str) -> Option<usize> {
        self.attribute_index(key)
            .or_else(|| self.ratings.iter().position(|r| r.key == key).map(|i| self.attributes.len() + i))
    }
    pub fn check_key(&self, index: usize) -> &str {
        self.attributes
            .get(index)
            .map(|a| a.key.as_str())
            .or_else(|| {
                index.checked_sub(self.attributes.len()).and_then(|i| self.ratings.get(i)).map(|r| r.key.as_str())
            })
            .unwrap_or("")
    }
    pub fn check_name(&self, index: usize) -> &str {
        self.attributes
            .get(index)
            .map(|a| a.name.as_str())
            .or_else(|| {
                index.checked_sub(self.attributes.len()).and_then(|i| self.ratings.get(i)).map(|r| r.name.as_str())
            })
            .unwrap_or("")
    }
    pub fn attr_value(&self, attrs: &[i64], index: usize) -> i64 {
        attrs
            .get(index)
            .copied()
            .map(|v| self.group(index).map_or(v, |g| v.clamp(g.range[0], g.range[1].max(g.range[0]))))
            .unwrap_or(0)
    }
    pub fn check_value(&self, attrs: &[i64], index: usize) -> i64 {
        if index < self.attributes.len() {
            return self.attr_value(attrs, index);
        }
        self.ratings.get(index - self.attributes.len()).map_or(0, |r| {
            r.weights.iter().fold(0i64, |v, (i, w)| v.saturating_add(self.attr_value(attrs, *i).saturating_mul(*w)))
        })
    }
    pub fn allocated_attrs(&self, bg: &[i64], alloc: &[i64]) -> Result<Vec<i64>, crate::error::CommandError> {
        use crate::{error::Reason, text::TextArg};
        for group in &self.groups {
            let sum = self
                .attributes
                .iter()
                .zip(alloc)
                .filter(|(a, _)| a.group == group.key)
                .try_fold(0i64, |v, (_, a)| v.checked_add(*a));
            if alloc.len() != self.attributes.len() || alloc.iter().any(|v| *v < 0) || sum != Some(group.free) {
                return Err(Reason::new(
                    "captain.points",
                    format!("{}组自由分配的点数必须正好是 {}", group.name, group.free),
                )
                .arg("free", TextArg::Int(group.free))
                .range());
            }
        }
        let attrs: Vec<i64> = bg.iter().zip(alloc).map(|(b, a)| b.saturating_add(*a)).collect();
        for (i, v) in attrs.iter().enumerate() {
            if let Some(group) = self.group(i)
                && *v > group.creation_cap
            {
                return Err(Reason::new(
                    "captain.cap",
                    format!("{}组开局时单项属性不能超过 {}", group.name, group.creation_cap),
                )
                .arg("cap", TextArg::Int(group.creation_cap))
                .range());
            }
        }
        Ok(attrs)
    }
}
