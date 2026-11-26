//! 发给模型的输出 JSON Schema：由代码从数据生成（效果词表与边界、各表的 key），与裁决器、内核校验同源。
//!
//! 生成的 Schema 满足 OpenAI 严格模式（`strict: true`）的要求：每个对象都是 `additionalProperties: false`，
//! 全部属性都列在 `required` 里（可以不填的参数写成可为 null）；共用的 key 目录放在 `$defs` 中用 `$ref` 引用，
//! 数值边界写成 `minimum` / `maximum`，可选对象写成 `enum`。
//! 同一份 Schema 用于 Anthropic 的工具调用（`input_schema`）、OpenAI 兼容接口的 `response_format`，也写进提示词。

use manifest_core::StaticData;
use manifest_core::defs::EffectKind;
use manifest_core::fixed::Fx;
use manifest_data::ProposalKind;
use serde_json::{Map, Value, json};
use std::collections::BTreeMap;

/// 组合事件工具的名称（Anthropic 工具调用 / OpenAI json_schema 的 name）。
pub const COMPOSED_TOOL: &str = "propose_event";

/// 一类提案的输出结构。
#[derive(Clone, Debug, PartialEq)]
pub struct OutputSchema {
    /// 工具名 / json_schema 名（只含字母、数字、下划线）
    pub name: String,
    /// 工具说明
    pub description: String,
    /// JSON Schema（根为对象）
    pub schema: Value,
}

/// 构造 Schema 时收集用到的 key 目录。
struct Builder<'a> {
    defs: &'a StaticData,
    used: BTreeMap<&'static str, Value>,
}

fn fx_num(f: Fx) -> Value {
    json!(f.raw() as f64 / Fx::SCALE as f64)
}

fn object(props: Vec<(&str, Value)>) -> Value {
    let required: Vec<Value> = props.iter().map(|(k, _)| Value::from(*k)).collect();
    let mut map = Map::new();
    for (k, v) in props {
        map.insert(k.to_string(), v);
    }
    json!({"type": "object", "properties": map, "required": required, "additionalProperties": false})
}

fn text(description: &str) -> Value {
    json!({"type": "string", "description": description})
}

fn nullable_ref(r: Value) -> Value {
    json!({"anyOf": [r, {"type": "null"}]})
}

impl<'a> Builder<'a> {
    fn new(defs: &'a StaticData) -> Self {
        Self { defs, used: BTreeMap::new() }
    }

    /// 引用一个 key 目录（首次引用时生成）。
    fn key_ref(&mut self, name: &'static str) -> Value {
        if !self.used.contains_key(name) {
            let d = self.defs;
            let (keys, description): (Vec<String>, &str) = match name {
                "loc" => (
                    d.locations.iter().filter(|l| !l.market.is_empty()).map(|l| l.key.clone()).collect(),
                    "有市场的地点 key",
                ),
                "port" => (d.locations.iter().filter(|l| l.is_port()).map(|l| l.key.clone()).collect(), "港口 key"),
                "good" => (d.goods.iter().map(|g| g.key.clone()).collect(), "商品 key"),
                "region" => (d.regions.iter().map(|r| r.key.clone()).collect(), "海区 key"),
                "faction" => (d.factions.iter().map(|f| f.key.clone()).collect(), "势力 key"),
                "site" => (d.locations.iter().filter(|l| l.is_site()).map(|l| l.key.clone()).collect(), "殖民点 key"),
                "colony_building" => (
                    std::iter::once(crate::resolve::ALL_BUILDINGS.to_string())
                        .chain(
                            d.colony_building_ids()
                                .filter(|b| manifest_core::colony::is_productive(d, *b))
                                .map(|b| d.colony_building(b).key.clone()),
                        )
                        .collect(),
                    "有产出的殖民地建筑 key，all 表示全部建筑",
                ),
                "discovery" => (d.discoveries.iter().map(|x| x.key.clone()).collect(), "发现物 key"),
                _ => (d.events.iter().map(|e| e.key.clone()).collect(), "事件类型 key"),
            };
            self.used.insert(name, json!({"type": "string", "enum": keys, "description": description}));
        }
        json!({"$ref": format!("#/$defs/{name}")})
    }

    /// 在根对象上附加 `$defs`。
    fn finish(self, mut root: Value) -> Value {
        if !self.used.is_empty()
            && let Some(obj) = root.as_object_mut()
        {
            let defs: Map<String, Value> = self.used.into_iter().map(|(k, v)| (k.to_string(), v)).collect();
            obj.insert("$defs".into(), Value::Object(defs));
        }
        root
    }

    fn director(&mut self) -> Value {
        let params = object(vec![
            ("loc", nullable_ref(self.key_ref("loc"))),
            ("good", nullable_ref(self.key_ref("good"))),
            ("region", nullable_ref(self.key_ref("region"))),
            ("faction_a", nullable_ref(self.key_ref("faction"))),
            ("faction_b", nullable_ref(self.key_ref("faction"))),
            ("mult", json!({"type": ["number", "null"]})),
            ("days", json!({"type": ["integer", "null"]})),
            ("delta", json!({"type": ["integer", "null"]})),
        ]);
        let pick = object(vec![("event", self.key_ref("event")), ("params", params)]);
        object(vec![(
            "events",
            json!({"type": "array", "items": pick, "maxItems": 3, "description": "0–3 个事件；用不到的参数填 null"}),
        )])
    }

    fn strategy(&mut self) -> Value {
        let (lo, hi) = manifest_core::news::RISK_RANGE;
        object(vec![
            (
                "risk",
                json!({"type": "number", "minimum": fx_num(lo), "maximum": fx_num(hi), "description": "风险偏好"}),
            ),
            ("preferred", json!({"type": "array", "items": self.key_ref("good"), "maxItems": 3})),
            ("memo", text("不超过 60 字的备忘")),
        ])
    }

    fn outlook(&mut self) -> Value {
        let view = object(vec![
            ("good", self.key_ref("good")),
            (
                "view",
                json!({"type": "integer", "minimum": -2, "maximum": 2, "description": "-2 很看淡、-1 看淡、1 看好、2 很看好"}),
            ),
        ]);
        object(vec![
            ("views", json!({"type": "array", "items": view, "maxItems": manifest_core::commerce::OUTLOOK_MAX_VIEWS})),
            (
                "method",
                json!({"type": "string", "enum": ["fundamental", "trend", "adaptive"], "description": "偏好的预测方法：fundamental 基本面（回到往常）、trend 趋势（涨跌延续）、adaptive 适应（照最近的价）"}),
            ),
            ("memo", text("不超过 60 字的备忘")),
        ])
    }

    fn contract(&mut self) -> Value {
        object(vec![
            ("issuer", self.key_ref("faction")),
            ("good", self.key_ref("good")),
            ("to", self.key_ref("port")),
            ("qty", json!({"type": "integer", "minimum": 1, "maximum": 2000})),
            ("days", json!({"type": "integer", "minimum": 20, "maximum": 180})),
            ("reward", json!({"type": "integer", "minimum": 1, "description": "报酬（金币）"})),
        ])
    }

    /// 组合事件：效果词表中的每种效果是一个分支，参数全部必填。
    fn composed(&mut self) -> Value {
        let rules = &self.defs.composed;
        let mut variants: Vec<Value> = Vec::new();
        for b in &rules.effects {
            let k = b.effect;
            let mut props: Vec<(&str, Value)> = vec![("effect", json!({"type": "string", "enum": [k.key()]}))];
            if k.needs_loc() {
                let catalog = if k.targets_site() {
                    "site"
                } else if b.port_only {
                    "port"
                } else {
                    "loc"
                };
                props.push(("loc", self.key_ref(catalog)));
            }
            if k.allows_building() {
                props.push(("building", self.key_ref("colony_building")));
            }
            if k.needs_discovery() {
                props.push(("discovery", self.key_ref("discovery")));
            }
            if k.needs_good() {
                props.push(("good", self.key_ref("good")));
            }
            if k.needs_region() {
                props.push(("region", self.key_ref("region")));
            }
            if k.needs_faction_b() {
                props.push(("faction_a", self.key_ref("faction")));
                props.push(("faction_b", self.key_ref("faction")));
            } else if k.needs_faction_a() {
                props.push(("faction", self.key_ref("faction")));
            }
            if let (true, Some((lo, hi))) = (k.needs_mult(), b.mult) {
                props.push((
                    "mult",
                    json!({"type": "number", "minimum": fx_num(lo), "maximum": fx_num(hi), "description": "系数，1 表示不变（不能为 1）"}),
                ));
            }
            if let (true, Some((lo, hi))) = (k.needs_days(), b.days) {
                props.push(("days", json!({"type": "integer", "minimum": lo, "maximum": hi})));
            }
            if let (true, Some((lo, hi))) = (k.needs_delta(), b.delta) {
                props.push((
                    "delta",
                    json!({"type": "integer", "minimum": lo, "maximum": hi, "description": "变化量（不能为 0）"}),
                ));
            }
            let mut v = object(props);
            if let Some(obj) = v.as_object_mut() {
                obj.insert("description".into(), Value::from(format!("{}：{}", b.name, b.description)));
            }
            variants.push(v);
        }
        object(vec![
            ("title", text(&format!("事件标题，不超过 {} 字", rules.max_title_chars))),
            ("narrative", text(&format!("有历史感的叙事，不超过 {} 字", rules.max_text_chars))),
            (
                "effects",
                json!({
                    "type": "array",
                    "items": {"anyOf": variants},
                    "minItems": 1,
                    "maxItems": rules.max_effects.max(1),
                    "description": format!(
                        "1–{} 条效果；各效果 |mult − 1| 之和不超过 {}",
                        rules.max_effects,
                        manifest_core::composed::fx_short(rules.budget)
                    ),
                }),
            ),
        ])
    }
}

/// 某类提案发给模型的输出结构（从数据生成）。
pub fn output_schema(kind: ProposalKind, defs: &StaticData) -> OutputSchema {
    if kind.is_f9() {
        return OutputSchema {
            name: format!("submit_{}", kind.key()),
            description: format!("提交 {} 的封闭提案", kind.key()),
            schema: crate::pipeline::f9::schema(kind, defs),
        };
    }
    let mut b = Builder::new(defs);
    let (name, description, root) = match kind {
        ProposalKind::Ripple => unreachable!("扩展类型已提前返回"),
        ProposalKind::Persona
        | ProposalKind::Daily
        | ProposalKind::Narration
        | ProposalKind::Letter
        | ProposalKind::AltChronicle
        | ProposalKind::Diary => unreachable!("扩展类型已提前返回"),
        ProposalKind::Director => ("submit_director", "提交事件导演挑选的 0–3 个事件", b.director()),
        ProposalKind::Rumor => ("submit_rumor", "提交一句传闻", object(vec![("text", text("不超过 80 字的传闻"))])),
        ProposalKind::Bargain => {
            ("submit_bargain", "提交商人的回复台词", object(vec![("reply", text("不超过 60 字的回复"))]))
        }
        ProposalKind::Strategy => ("submit_strategy", "提交商会战略备忘", b.strategy()),
        ProposalKind::Contract => ("submit_contract", "提交一份运输委托", b.contract()),
        ProposalKind::Chronicle => {
            ("submit_chronicle", "提交一年的编年史", object(vec![("text", text("不超过 400 字的编年史"))]))
        }
        ProposalKind::Composed => (COMPOSED_TOOL, "提交一个组合事件：标题、叙事与从效果词表中组合的效果", b.composed()),
        ProposalKind::Outlook => ("submit_outlook", "提交商会下个月的展望", b.outlook()),
        ProposalKind::MarketReport => {
            ("submit_market_report", "提交一篇市场月报", object(vec![("text", text("不超过 300 字的月报"))]))
        }
        ProposalKind::Review => {
            ("submit_review", "提交一段预测复盘点评", object(vec![("text", text("不超过 300 字的点评"))]))
        }
        ProposalKind::Prologue => {
            ("submit_prologue", "提交一段身世序章", object(vec![("text", text("不超过 400 字的序章"))]))
        }
    };
    let schema = b.finish(root);
    OutputSchema { name: name.to_string(), description: description.to_string(), schema }
}

/// 检查 Schema 是否满足严格模式：每个对象都 `additionalProperties: false` 且全部属性都在 `required` 中；
/// `$ref` 都指向存在的 `$defs`。返回第一个问题的位置。
pub fn check_strict(schema: &Value) -> Result<(), String> {
    let defs = schema.get("$defs").and_then(Value::as_object).cloned().unwrap_or_default();
    fn walk(v: &Value, at: &str, defs: &Map<String, Value>) -> Result<(), String> {
        match v {
            Value::Object(o) => {
                if let Some(r) = o.get("$ref").and_then(Value::as_str) {
                    let name = r.strip_prefix("#/$defs/").ok_or_else(|| format!("{at}：不支持的引用 {r}"))?;
                    if !defs.contains_key(name) {
                        return Err(format!("{at}：引用了不存在的 {r}"));
                    }
                }
                if o.get("type").and_then(Value::as_str) == Some("object") {
                    let props =
                        o.get("properties").and_then(Value::as_object).ok_or(format!("{at}：对象缺少 properties"))?;
                    if o.get("additionalProperties") != Some(&Value::Bool(false)) {
                        return Err(format!("{at}：对象必须 additionalProperties = false"));
                    }
                    let required: Vec<&str> = o
                        .get("required")
                        .and_then(Value::as_array)
                        .map(|a| a.iter().filter_map(Value::as_str).collect())
                        .unwrap_or_default();
                    for k in props.keys() {
                        if !required.contains(&k.as_str()) {
                            return Err(format!("{at}：属性 {k} 不在 required 中"));
                        }
                    }
                    if required.len() != props.len() {
                        return Err(format!("{at}：required 与 properties 不一致"));
                    }
                }
                for (k, child) in o {
                    walk(child, &format!("{at}/{k}"), defs)?;
                }
                Ok(())
            }
            Value::Array(a) => {
                for (i, child) in a.iter().enumerate() {
                    walk(child, &format!("{at}/{i}"), defs)?;
                }
                Ok(())
            }
            _ => Ok(()),
        }
    }
    if schema.get("type").and_then(Value::as_str) != Some("object") {
        return Err("根必须是对象".into());
    }
    walk(schema, "#", &defs)
}

/// 组合事件 Schema 中列出的效果（按词表顺序）。
pub fn composed_effect_keys(schema: &Value) -> Vec<String> {
    schema["properties"]["effects"]["items"]["anyOf"]
        .as_array()
        .map(|a| a.iter().filter_map(|v| v["properties"]["effect"]["enum"][0].as_str().map(String::from)).collect())
        .unwrap_or_default()
}

/// 效果 key 是否在内核的效果集合中（供测试与诊断使用）。
pub fn is_known_effect(key: &str) -> bool {
    EffectKind::from_key(key).is_some()
}
