//! 提案 schema：LLM（或离线模板）输出的结构化提案。所有结构都拒绝未知字段，
//! 因此"凭空给钱"之类的额外字段会在解析阶段就被拒绝。

use manifest_core::defs::EffectKind;
use manifest_data::ProposalKind;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// 事件参数（按事件效果使用其中一部分，使用数据文件中的 key）。
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct EventParamsRaw {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub loc: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub good: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub region: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub faction_a: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub faction_b: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mult: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub days: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delta: Option<i64>,
}

/// 事件导演挑选的一个事件。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct EventPick {
    /// 事件类型 key（必须在事件目录中）
    pub event: String,
    #[serde(default)]
    pub params: EventParamsRaw,
}

/// 世界事件导演：0–3 个事件。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct DirectorProposal {
    pub events: Vec<EventPick>,
}

/// 传闻文字。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct RumorProposal {
    pub text: String,
}

/// 议价回复台词。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct BargainProposal {
    pub reply: String,
}

/// 商会战略备忘。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct StrategyProposal {
    /// 风险偏好（0.2–0.8）
    pub risk: f64,
    /// 至多 3 种偏好商品 key
    pub preferred: Vec<String>,
    #[serde(default)]
    pub memo: String,
}

/// 委托合同。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ContractProposal {
    /// 发布方势力 key
    pub issuer: String,
    pub good: String,
    /// 目的港 key（须属于发布方势力）
    pub to: String,
    pub qty: i64,
    /// 期限（天）
    pub days: i64,
    /// 报酬（文）
    pub reward: i64,
}

/// 编年史。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ChronicleProposal {
    pub text: String,
}

/// 商会展望里的一条看法。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct OutlookView {
    /// 商品 key
    pub good: String,
    /// 看法：-2 很看淡、-1 看淡、1 看好、2 很看好
    pub view: i64,
}

/// 商会展望（ECONOMY.md 8.2）：至多 4 条看法、偏好的预测方法（fundamental / trend / adaptive）与一句备忘。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct OutlookProposal {
    pub views: Vec<OutlookView>,
    pub method: String,
    pub memo: String,
}

/// 纯文字（市场月报、复盘点评、身世序章）。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct TextProposal {
    pub text: String,
}

/// 复盘点评的字数上限。
pub const MAX_REVIEW_CHARS: usize = 300;
/// 身世序章的字数上限。
pub const MAX_PROLOGUE_CHARS: usize = 400;

/// 组合事件的一条效果：按 `effect` 标签区分，每种效果的参数全部必填（key 使用数据文件中的标识）。
/// 参数边界见 `data/effects.toml`；发给模型的 JSON Schema 由 [`crate::schema::output_schema`] 从数据生成。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "effect", rename_all = "snake_case", deny_unknown_fields)]
pub enum ComposedEffectRaw {
    /// 某商品在全部地点的产量
    GoodSupply { good: String, mult: f64, days: u32 },
    /// 某商品在全部地点的需求
    GoodDemand { good: String, mult: f64, days: u32 },
    /// 某地某商品的产量
    SupplyShift { loc: String, good: String, mult: f64, days: u32 },
    /// 某地某商品的需求
    DemandShift { loc: String, good: String, mult: f64, days: u32 },
    /// 某地全部商品的产量
    LocationSupply { loc: String, mult: f64, days: u32 },
    /// 某地全部商品的需求
    LocationDemand { loc: String, mult: f64, days: u32 },
    /// 某地某商品流行
    Popularity { loc: String, good: String, days: u32 },
    /// 海区风暴概率
    RegionStorm { region: String, mult: f64, days: u32 },
    /// 海区海盗概率
    RegionPirates { region: String, mult: f64, days: u32 },
    /// 两个势力的关系值
    RelationShift { faction_a: String, faction_b: String, delta: i64 },
    /// 某势力的交易税
    FactionTax { faction: String, mult: f64, days: u32 },
    /// 港口发展度
    Development { loc: String, delta: i64 },
    /// 贷款利率
    InterestShift { mult: f64, days: u32 },
    /// 产业效率
    IndustryEfficiency { mult: f64, days: u32 },
    /// 某殖民地的产量：loc 为殖民地所在的殖民点，building 为建筑 key 或 "all"（全部建筑）
    ColonyOutput { loc: String, building: String, mult: f64, days: u32 },
    /// 某殖民地的士气（一次性）
    ColonyMorale { loc: String, delta: i64 },
    /// 某殖民地的人口增长与移民
    ColonyGrowth { loc: String, mult: f64, days: u32 },
    /// 某势力占领一处无主的殖民点（一次性）
    SiteClaim { loc: String, faction: String },
    /// 某发现物的传闻：玩家得知其大致海区（一次性）
    DiscoveryRumor { discovery: String },
    /// 某势力禁止运出某商品
    ExportBan { faction: String, good: String, days: u32 },
    /// 某势力对运进来的某商品加征关税（卖出时交易税乘上系数）
    ImportTariff { faction: String, good: String, mult: f64, days: u32 },
    /// 某势力对运出去的某商品加征出口税（买入时交易税乘上系数）
    ExportTariff { faction: String, good: String, mult: f64, days: u32 },
    /// 某地某商品的产量补贴
    Subsidy { loc: String, good: String, mult: f64, days: u32 },
}

impl ComposedEffectRaw {
    /// 效果类型。
    pub fn kind(&self) -> EffectKind {
        match self {
            ComposedEffectRaw::GoodSupply { .. } => EffectKind::GoodSupply,
            ComposedEffectRaw::GoodDemand { .. } => EffectKind::GoodDemand,
            ComposedEffectRaw::SupplyShift { .. } => EffectKind::SupplyShift,
            ComposedEffectRaw::DemandShift { .. } => EffectKind::DemandShift,
            ComposedEffectRaw::LocationSupply { .. } => EffectKind::LocationSupply,
            ComposedEffectRaw::LocationDemand { .. } => EffectKind::LocationDemand,
            ComposedEffectRaw::Popularity { .. } => EffectKind::Popularity,
            ComposedEffectRaw::RegionStorm { .. } => EffectKind::RegionStorm,
            ComposedEffectRaw::RegionPirates { .. } => EffectKind::RegionPirates,
            ComposedEffectRaw::RelationShift { .. } => EffectKind::RelationShift,
            ComposedEffectRaw::FactionTax { .. } => EffectKind::FactionTax,
            ComposedEffectRaw::Development { .. } => EffectKind::Development,
            ComposedEffectRaw::InterestShift { .. } => EffectKind::InterestShift,
            ComposedEffectRaw::IndustryEfficiency { .. } => EffectKind::IndustryEfficiency,
            ComposedEffectRaw::ColonyOutput { .. } => EffectKind::ColonyOutput,
            ComposedEffectRaw::ColonyMorale { .. } => EffectKind::ColonyMorale,
            ComposedEffectRaw::ColonyGrowth { .. } => EffectKind::ColonyGrowth,
            ComposedEffectRaw::SiteClaim { .. } => EffectKind::SiteClaim,
            ComposedEffectRaw::DiscoveryRumor { .. } => EffectKind::DiscoveryRumor,
            ComposedEffectRaw::ExportBan { .. } => EffectKind::ExportBan,
            ComposedEffectRaw::ImportTariff { .. } => EffectKind::ImportTariff,
            ComposedEffectRaw::ExportTariff { .. } => EffectKind::ExportTariff,
            ComposedEffectRaw::Subsidy { .. } => EffectKind::Subsidy,
        }
    }
}

/// 组合事件：标题、叙事与 1–N 条效果。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ComposedEventProposal {
    pub title: String,
    pub narrative: String,
    pub effects: Vec<ComposedEffectRaw>,
}

/// 任意一种提案。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum Proposal {
    Director(DirectorProposal),
    Rumor(RumorProposal),
    Bargain(BargainProposal),
    Strategy(StrategyProposal),
    Contract(ContractProposal),
    Chronicle(ChronicleProposal),
    Composed(ComposedEventProposal),
    Outlook(OutlookProposal),
    MarketReport(TextProposal),
    Review(TextProposal),
    Prologue(TextProposal),
    Persona(crate::pipeline::f9::PersonaProposal),
    Daily(crate::pipeline::f9::DailyProposal),
    Narration(TextProposal),
    Letter(crate::pipeline::f9::text::LetterProposal),
    AltChronicle(TextProposal),
    Diary(TextProposal),
    Ripple(crate::pipeline::f9::ripple::RippleProposal),
}

impl Proposal {
    pub fn kind(&self) -> ProposalKind {
        match self {
            Proposal::Director(_) => ProposalKind::Director,
            Proposal::Rumor(_) => ProposalKind::Rumor,
            Proposal::Bargain(_) => ProposalKind::Bargain,
            Proposal::Strategy(_) => ProposalKind::Strategy,
            Proposal::Contract(_) => ProposalKind::Contract,
            Proposal::Chronicle(_) => ProposalKind::Chronicle,
            Proposal::Composed(_) => ProposalKind::Composed,
            Proposal::Outlook(_) => ProposalKind::Outlook,
            Proposal::MarketReport(_) => ProposalKind::MarketReport,
            Proposal::Review(_) => ProposalKind::Review,
            Proposal::Prologue(_) => ProposalKind::Prologue,
            Proposal::Persona(_) => ProposalKind::Persona,
            Proposal::Daily(_) => ProposalKind::Daily,
            Proposal::Narration(_) => ProposalKind::Narration,
            Proposal::Letter(_) => ProposalKind::Letter,
            Proposal::AltChronicle(_) => ProposalKind::AltChronicle,
            Proposal::Diary(_) => ProposalKind::Diary,
            Proposal::Ripple(_) => ProposalKind::Ripple,
        }
    }

    /// 提案本体的 JSON（不含类型标签），用于缓存与发给 Jev。
    pub fn body_json(&self) -> serde_json::Value {
        let v = match self {
            Proposal::Persona(p) => serde_json::to_value(p),
            Proposal::Daily(p) => serde_json::to_value(p),
            Proposal::Narration(p) => serde_json::to_value(p),
            Proposal::Letter(p) => serde_json::to_value(p),
            Proposal::AltChronicle(p) => serde_json::to_value(p),
            Proposal::Diary(p) => serde_json::to_value(p),
            Proposal::Ripple(p) => serde_json::to_value(p),

            Proposal::Director(p) => serde_json::to_value(p),
            Proposal::Rumor(p) => serde_json::to_value(p),
            Proposal::Bargain(p) => serde_json::to_value(p),
            Proposal::Strategy(p) => serde_json::to_value(p),
            Proposal::Contract(p) => serde_json::to_value(p),
            Proposal::Chronicle(p) => serde_json::to_value(p),
            Proposal::Composed(p) => serde_json::to_value(p),
            Proposal::Outlook(p) => serde_json::to_value(p),
            Proposal::MarketReport(p) | Proposal::Review(p) | Proposal::Prologue(p) => serde_json::to_value(p),
        };
        v.unwrap_or(serde_json::Value::Null)
    }

    /// 从提案本体 JSON 解析（按类型）。
    pub fn from_body(kind: ProposalKind, value: serde_json::Value) -> Result<Proposal, serde_json::Error> {
        Ok(match kind {
            ProposalKind::Persona => Proposal::Persona(serde_json::from_value(value)?),
            ProposalKind::Daily => Proposal::Daily(serde_json::from_value(value)?),
            ProposalKind::Narration => Proposal::Narration(serde_json::from_value(value)?),
            ProposalKind::Letter => Proposal::Letter(serde_json::from_value(value)?),
            ProposalKind::AltChronicle => Proposal::AltChronicle(serde_json::from_value(value)?),
            ProposalKind::Diary => Proposal::Diary(serde_json::from_value(value)?),
            ProposalKind::Ripple => Proposal::Ripple(serde_json::from_value(value)?),

            ProposalKind::Director => Proposal::Director(serde_json::from_value(value)?),
            ProposalKind::Rumor => Proposal::Rumor(serde_json::from_value(value)?),
            ProposalKind::Bargain => Proposal::Bargain(serde_json::from_value(value)?),
            ProposalKind::Strategy => Proposal::Strategy(serde_json::from_value(value)?),
            ProposalKind::Contract => Proposal::Contract(serde_json::from_value(value)?),
            ProposalKind::Chronicle => Proposal::Chronicle(serde_json::from_value(value)?),
            ProposalKind::Composed => Proposal::Composed(serde_json::from_value(value)?),
            ProposalKind::Outlook => Proposal::Outlook(serde_json::from_value(value)?),
            ProposalKind::MarketReport => Proposal::MarketReport(serde_json::from_value(value)?),
            ProposalKind::Review => Proposal::Review(serde_json::from_value(value)?),
            ProposalKind::Prologue => Proposal::Prologue(serde_json::from_value(value)?),
        })
    }
}

/// 某类提案的通用 JSON Schema（由类型推导，不含数据中的边界与 key 目录）。
/// 发给模型的 Schema 用 [`crate::schema::output_schema`]，它从数据生成并满足严格模式的要求。
pub fn schema_json(kind: ProposalKind) -> String {
    let schema = match kind {
        ProposalKind::Ripple => schemars::schema_for!(crate::pipeline::f9::ripple::RippleProposal),
        ProposalKind::Persona => schemars::schema_for!(crate::pipeline::f9::PersonaProposal),
        ProposalKind::Daily => schemars::schema_for!(crate::pipeline::f9::DailyProposal),
        ProposalKind::Letter => schemars::schema_for!(crate::pipeline::f9::text::LetterProposal),
        ProposalKind::Narration | ProposalKind::AltChronicle | ProposalKind::Diary => {
            schemars::schema_for!(TextProposal)
        }
        ProposalKind::Director => schemars::schema_for!(DirectorProposal),
        ProposalKind::Rumor => schemars::schema_for!(RumorProposal),
        ProposalKind::Bargain => schemars::schema_for!(BargainProposal),
        ProposalKind::Strategy => schemars::schema_for!(StrategyProposal),
        ProposalKind::Contract => schemars::schema_for!(ContractProposal),
        ProposalKind::Chronicle => schemars::schema_for!(ChronicleProposal),
        ProposalKind::Composed => schemars::schema_for!(ComposedEventProposal),
        ProposalKind::Outlook => schemars::schema_for!(OutlookProposal),
        ProposalKind::MarketReport | ProposalKind::Review | ProposalKind::Prologue => {
            schemars::schema_for!(TextProposal)
        }
    };
    serde_json::to_string(&schema).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn composed_effects_are_tagged_and_strict() {
        let ok = serde_json::json!({
            "title": "码头大火",
            "narrative": "夜里起火。",
            "effects": [
                {"effect": "location_supply", "loc": "a", "mult": 0.7, "days": 30},
                {"effect": "relation_shift", "faction_a": "x", "faction_b": "y", "delta": -5},
            ]
        });
        let p = Proposal::from_body(ProposalKind::Composed, ok.clone()).unwrap();
        let Proposal::Composed(c) = &p else { panic!() };
        assert_eq!(c.effects[0].kind(), EffectKind::LocationSupply);
        assert_eq!(p.body_json(), ok, "序列化回去与原文一致");
        // 未知字段、缺少参数、未知效果、错误类型都在解析阶段被拒绝
        for bad in [
            serde_json::json!({"effect": "location_supply", "loc": "a", "mult": 0.7, "days": 30, "cash": 1}),
            serde_json::json!({"effect": "location_supply", "loc": "a", "mult": 0.7}),
            serde_json::json!({"effect": "gold_rain", "mult": 2.0, "days": 3}),
            serde_json::json!({"effect": "development", "loc": "a", "delta": "big"}),
            serde_json::json!({"loc": "a", "mult": 0.7, "days": 30}),
        ] {
            let body = serde_json::json!({"title": "t", "narrative": "n", "effects": [bad]});
            assert!(Proposal::from_body(ProposalKind::Composed, body.clone()).is_err(), "{body}");
        }
        let extra = serde_json::json!({"title": "t", "narrative": "n", "effects": [], "grant": 1});
        assert!(Proposal::from_body(ProposalKind::Composed, extra).is_err());
    }
}
