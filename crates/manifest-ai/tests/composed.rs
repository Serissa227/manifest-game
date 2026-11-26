//! 组合事件（EXPANSION §7）：输出 Schema 由数据生成且满足严格模式；供应商侧的结构化输出
//! （Anthropic 工具调用、OpenAI json_schema）；规则裁决器对非法组合事件的拒绝；管线的缓存与预算。
//! 全部使用 wiremock，不访问任何真实服务。

use manifest_ai::adjudicator::check_composed;
use manifest_ai::pipeline::ProposalSource;
use manifest_ai::proposal::{ComposedEffectRaw as E, ComposedEventProposal};
use manifest_ai::schema::{COMPOSED_TOOL, check_strict, composed_effect_keys, output_schema};
use manifest_ai::{
    AdjudicationContext, AiMode, AiPipeline, AiSettings, Decision, HttpProvider, LlmError, LlmRequest, ModelTier,
    Proposal, Provider, ProviderConfig, ProviderKind, RuleAdjudicator, Secret, TaskRequest,
};
use manifest_core::composed::ComposedSource;
use manifest_core::defs::EffectKind;
use manifest_core::diplomacy::DiploStatus;
use manifest_core::ids::ScenarioId;
use manifest_core::{Command, StaticData, World};
use manifest_data::ProposalKind;
use std::sync::{Arc, OnceLock};
use wiremock::matchers::{body_partial_json, header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

const KEY: &str = "sk-test-composed-51d0";

fn defs() -> Arc<StaticData> {
    static DEFS: OnceLock<Arc<StaticData>> = OnceLock::new();
    DEFS.get_or_init(|| manifest_data::load_default().unwrap_or_else(|e| panic!("{e}"))).clone()
}

fn content() -> Arc<manifest_data::AiContent> {
    let dir = manifest_data::find_data_dir().unwrap();
    Arc::new(manifest_data::load_ai_content(&dir).unwrap())
}

fn world() -> World {
    World::new(defs(), ScenarioId(0), 5).unwrap()
}

fn ctx(w: &World) -> AdjudicationContext {
    AdjudicationContext {
        defs: w.defs.clone(),
        relations: w.state.relations.iter().map(|r| (r.a, r.b, r.status)).collect(),
    }
}

/// 从真实数据中挑出的对象 key。
struct Keys {
    port: String,
    traded: String,
    not_traded: String,
    city: String,
    region: String,
    peace: (String, String),
}

fn keys(w: &World) -> Keys {
    let d = &w.defs;
    let home = w.state.agents[&manifest_core::ids::OwnerId::Player].home;
    let loc = d.loc(home);
    let traded = d.good(loc.market[0].good).key.clone();
    let not_traded = d
        .good_ids()
        .find(|g| !loc.market.iter().any(|m| m.good == *g))
        .map(|g| d.good(g).key.clone())
        .expect("应有本港不交易的商品");
    let city = d.locations.iter().find(|l| !l.is_port() && !l.market.is_empty()).expect("应有内陆城市").key.clone();
    let r = w.state.relations.iter().find(|r| matches!(r.status, DiploStatus::Peace)).expect("应有和平的势力对");
    Keys {
        port: loc.key.clone(),
        traded,
        not_traded,
        city,
        region: d.regions[0].key.clone(),
        peace: (d.faction(r.a).key.clone(), d.faction(r.b).key.clone()),
    }
}

fn legal(k: &Keys) -> ComposedEventProposal {
    ComposedEventProposal {
        title: "码头大火".into(),
        narrative: "据港务厅档案记载，焦油仓在深夜起火，火借海风烧穿了半条码头街。".into(),
        effects: vec![
            E::LocationSupply { loc: k.port.clone(), mult: 0.8, days: 30 },
            E::DemandShift { loc: k.port.clone(), good: k.traded.clone(), mult: 1.3, days: 20 },
            E::RelationShift { faction_a: k.peace.0.clone(), faction_b: k.peace.1.clone(), delta: 5 },
        ],
    }
}

// ───────────────────────────── Schema ─────────────────────────────

#[test]
fn every_output_schema_is_strict_and_generated_from_data() {
    let d = defs();
    for kind in ProposalKind::ALL {
        let s = output_schema(kind, &d);
        check_strict(&s.schema).unwrap_or_else(|e| panic!("{}：{e}\n{}", kind.key(), s.schema));
        assert!(s.name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') && s.name.len() <= 64);
    }
    let s = output_schema(ProposalKind::Composed, &d);
    assert_eq!(s.name, COMPOSED_TOOL);
    // 效果词表按 effects.toml 的顺序列出，边界取自数据
    let rules = &d.composed;
    let listed = composed_effect_keys(&s.schema);
    assert_eq!(listed, rules.effects.iter().map(|b| b.effect.key().to_string()).collect::<Vec<_>>());
    assert_eq!(listed.len(), EffectKind::ALL.len(), "data/effects.toml 覆盖全部 14 种效果");
    let items = s.schema["properties"]["effects"]["items"]["anyOf"].as_array().unwrap();
    for (b, v) in rules.effects.iter().zip(items) {
        let props = &v["properties"];
        if let Some((lo, hi)) = b.mult {
            assert_eq!(props["mult"]["minimum"].as_f64().unwrap(), lo.raw() as f64 / 10_000.0);
            assert_eq!(props["mult"]["maximum"].as_f64().unwrap(), hi.raw() as f64 / 10_000.0);
        }
        if let Some((lo, hi)) = b.days {
            assert_eq!(
                (props["days"]["minimum"].as_u64(), props["days"]["maximum"].as_u64()),
                (Some(lo as u64), Some(hi as u64))
            );
        }
        if let Some((lo, hi)) = b.delta {
            assert_eq!((props["delta"]["minimum"].as_i64(), props["delta"]["maximum"].as_i64()), (Some(lo), Some(hi)));
        }
        if b.port_only {
            assert_eq!(props["loc"]["$ref"], "#/$defs/port");
        }
    }
    assert_eq!(s.schema["properties"]["effects"]["maxItems"].as_u64(), Some(rules.max_effects as u64));
    assert_eq!(s.schema["properties"]["effects"]["minItems"].as_u64(), Some(1));
    // key 目录与数据一致
    let enum_of = |name: &str| -> Vec<String> {
        s.schema["$defs"][name]["enum"].as_array().unwrap().iter().map(|v| v.as_str().unwrap().to_string()).collect()
    };
    assert_eq!(enum_of("good"), d.goods.iter().map(|g| g.key.clone()).collect::<Vec<_>>());
    assert_eq!(enum_of("region"), d.regions.iter().map(|g| g.key.clone()).collect::<Vec<_>>());
    assert_eq!(enum_of("faction"), d.factions.iter().map(|g| g.key.clone()).collect::<Vec<_>>());
    assert_eq!(enum_of("port"), d.locations.iter().filter(|l| l.is_port()).map(|l| l.key.clone()).collect::<Vec<_>>());
    // 严格检查器本身能发现问题
    let mut broken = s.schema.clone();
    broken["properties"]["effects"]["items"]["anyOf"][0]["additionalProperties"] = serde_json::json!(true);
    assert!(check_strict(&broken).is_err());
    let mut broken = s.schema.clone();
    broken["required"] = serde_json::json!(["title", "effects"]);
    assert!(check_strict(&broken).is_err());
}

/// 结构快照：每种效果分支的属性（与数据内容无关，只取决于效果类型）。
#[test]
fn composed_schema_shape_snapshot() {
    let s = output_schema(ProposalKind::Composed, &defs());
    let items = s.schema["properties"]["effects"]["items"]["anyOf"].as_array().unwrap();
    let shape: Vec<String> = items
        .iter()
        .map(|v| {
            let req: Vec<&str> = v["required"].as_array().unwrap().iter().map(|x| x.as_str().unwrap()).collect();
            req.join(",")
        })
        .collect();
    assert_eq!(
        shape,
        vec![
            "effect,good,mult,days",
            "effect,good,mult,days",
            "effect,loc,good,mult,days",
            "effect,loc,good,mult,days",
            "effect,loc,good,days",
            "effect,loc,mult,days",
            "effect,loc,mult,days",
            "effect,region,mult,days",
            "effect,region,mult,days",
            "effect,faction_a,faction_b,delta",
            "effect,faction,mult,days",
            "effect,loc,delta",
            "effect,mult,days",
            "effect,mult,days",
            // 殖民扩展追加的效果（colony_output、colony_morale、colony_growth、site_claim、discovery_rumor）
            "effect,loc,building,mult,days",
            "effect,loc,delta",
            "effect,loc,mult,days",
            "effect,loc,faction",
            "effect,discovery",
            // 势力的经济政策（第八批 E7：export_ban、import_tariff、export_tariff、subsidy）
            "effect,good,faction,days",
            "effect,good,faction,mult,days",
            "effect,good,faction,mult,days",
            "effect,loc,good,mult,days",
        ]
    );
    let root: Vec<&str> = s.schema["required"].as_array().unwrap().iter().map(|x| x.as_str().unwrap()).collect();
    assert_eq!(root, vec!["title", "narrative", "effects"]);
    // 生成的合法提案能被按 schema 解析
    let w = world();
    let p = legal(&keys(&w));
    let body = serde_json::to_value(&p).unwrap();
    assert!(Proposal::from_body(ProposalKind::Composed, body).is_ok());
}

// ───────────────────────────── 规则裁决 ─────────────────────────────

#[test]
fn legal_composed_proposal_passes_rules_and_kernel() {
    let w = world();
    let k = keys(&w);
    let p = legal(&k);
    assert!(check_composed(&p, &ctx(&w)).is_empty(), "{:?}", check_composed(&p, &ctx(&w)));
    let v = RuleAdjudicator::default().adjudicate(&Proposal::Composed(p.clone()), &ctx(&w));
    assert_eq!(v.decision, Decision::Accept);
    let effects: Vec<_> =
        p.effects.iter().map(|e| manifest_ai::resolve::resolve_composed_effect(&w.defs, e).unwrap()).collect();
    let cmd = Command::ApplyComposedEvent {
        title: p.title.clone(),
        text: p.narrative.clone(),
        effects,
        source: ComposedSource::Model,
    };
    cmd.validate(&w).unwrap();
}

/// 非法组合事件：规则裁决器逐条给出理由并拒绝。
#[test]
fn illegal_composed_proposals_are_rejected_by_the_rule_adjudicator() {
    let w = world();
    let k = keys(&w);
    let with = |effects: Vec<E>| ComposedEventProposal { effects, ..legal(&k) };
    let loc_supply = |mult: f64, days: u32| E::LocationSupply { loc: k.port.clone(), mult, days };
    let cases: Vec<(&str, ComposedEventProposal)> = vec![
        ("系数越界", with(vec![loc_supply(0.2, 30)])),
        ("天数越界", with(vec![loc_supply(0.8, 999)])),
        ("变化量越界", with(vec![E::Development { loc: k.port.clone(), delta: 40 }])),
        ("系数为 1", with(vec![loc_supply(1.0, 30)])),
        ("变化量为 0", with(vec![E::Development { loc: k.port.clone(), delta: 0 }])),
        ("不存在的地点", with(vec![E::LocationSupply { loc: "atlantis".into(), mult: 0.8, days: 30 }])),
        (
            "不存在的商品",
            with(vec![E::DemandShift { loc: k.port.clone(), good: "unobtainium".into(), mult: 1.3, days: 20 }]),
        ),
        (
            "当地不交易该商品",
            with(vec![E::SupplyShift { loc: k.port.clone(), good: k.not_traded.clone(), mult: 1.3, days: 20 }]),
        ),
        ("港口限定", with(vec![E::Development { loc: k.city.clone(), delta: 3 }])),
        (
            "两个势力相同",
            with(vec![E::RelationShift { faction_a: k.peace.0.clone(), faction_b: k.peace.0.clone(), delta: 5 }]),
        ),
        (
            "和平状态下关系剧烈恶化",
            with(vec![E::RelationShift { faction_a: k.peace.0.clone(), faction_b: k.peace.1.clone(), delta: -20 }]),
        ),
        (
            "超出总强度预算",
            with(vec![
                E::SupplyShift { loc: k.port.clone(), good: k.traded.clone(), mult: 1.8, days: 30 },
                E::RegionStorm { region: k.region.clone(), mult: 2.5, days: 30 },
            ]),
        ),
        (
            "效果过多",
            with(vec![
                loc_supply(0.9, 30),
                E::RegionStorm { region: k.region.clone(), mult: 1.1, days: 30 },
                E::InterestShift { mult: 1.1, days: 30 },
                E::IndustryEfficiency { mult: 1.1, days: 30 },
            ]),
        ),
        ("没有效果", with(vec![])),
        ("同一目标重复", with(vec![loc_supply(0.9, 30), loc_supply(0.8, 20)])),
        ("标题为空", ComposedEventProposal { title: String::new(), ..legal(&k) }),
        ("叙事夹带链接", ComposedEventProposal { narrative: "详见 https://example.com".into(), ..legal(&k) }),
        ("叙事过长", ComposedEventProposal { narrative: "长".repeat(500), ..legal(&k) }),
    ];
    assert!(cases.len() >= 10);
    for (name, p) in cases {
        let reasons = check_composed(&p, &ctx(&w));
        assert!(!reasons.is_empty(), "{name}：应有拒绝理由");
        let v = RuleAdjudicator::default().adjudicate(&Proposal::Composed(p), &ctx(&w));
        assert_eq!(v.decision, Decision::Reject, "{name}：{reasons:?}");
        assert!(v.proposal.is_none());
    }

    // 不在效果词表中的效果（数据中删去即禁用）
    let mut d = (*defs()).clone();
    d.composed.effects.retain(|b| b.effect != EffectKind::InterestShift);
    let ctx2 = AdjudicationContext { defs: Arc::new(d), relations: ctx(&w).relations };
    let reasons = check_composed(&with(vec![E::InterestShift { mult: 1.1, days: 30 }]), &ctx2);
    assert!(reasons.iter().any(|r| r.contains("不在效果词表中")), "{reasons:?}");
}

// ───────────────────────────── 供应商的结构化输出 ─────────────────────────────

fn request() -> LlmRequest {
    LlmRequest {
        system: "你是编年史官。".into(),
        user: "请构思一件事件。".into(),
        max_tokens: 700,
        tier: ModelTier::Balanced,
        hint: None,
    }
}

fn anthropic_with(server: &MockServer, models: [&str; 3]) -> HttpProvider {
    let config = ProviderConfig {
        base_url: server.uri(),
        models: models.map(String::from),
        ..ProviderConfig::anthropic_default()
    };
    HttpProvider::new(config, Secret::new(KEY)).unwrap()
}

fn tool_use_message(input: serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "id": "msg_1", "type": "message", "role": "assistant", "model": "claude-sonnet-5",
        "content": [
            {"type": "thinking", "thinking": "", "signature": "sig"},
            {"type": "tool_use", "id": "toolu_1", "name": COMPOSED_TOOL, "input": input},
        ],
        "stop_reason": "tool_use",
        "usage": {"input_tokens": 900, "output_tokens": 120},
    })
}

#[tokio::test]
async fn anthropic_uses_a_forced_tool_call_and_parses_tool_use() {
    let w = world();
    let schema = output_schema(ProposalKind::Composed, &w.defs);
    let proposal = serde_json::to_value(legal(&keys(&w))).unwrap();
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/messages"))
        .and(header("x-api-key", KEY))
        .and(body_partial_json(serde_json::json!({
            "model": "claude-sonnet-5",
            "system": "你是编年史官。",
            "tool_choice": {"type": "tool", "name": COMPOSED_TOOL},
            "output_config": {"effort": "low"},
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(tool_use_message(proposal.clone())))
        .expect(1)
        .mount(&server)
        .await;
    let p = anthropic_with(&server, ["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-5"]);
    let resp = p.complete_with(&request(), Some(&schema)).await.unwrap();
    assert!(resp.structured);
    assert_eq!(serde_json::from_str::<serde_json::Value>(&resp.text).unwrap(), proposal);
    assert_eq!((resp.input_tokens, resp.output_tokens), (900, 120));
    // 请求体：工具定义带数据生成的 input_schema，max_tokens 照旧放宽
    let body: serde_json::Value = serde_json::from_slice(&server.received_requests().await.unwrap()[0].body).unwrap();
    let tools = body["tools"].as_array().unwrap();
    assert_eq!(tools.len(), 1);
    assert_eq!(tools[0]["name"], COMPOSED_TOOL);
    assert_eq!(tools[0]["input_schema"], schema.schema);
    assert!(!tools[0]["description"].as_str().unwrap().is_empty());
    assert!(body["max_tokens"].as_u64().unwrap() >= 2_800);
    assert!(body.get("response_format").is_none());
}

#[tokio::test]
async fn anthropic_models_without_forced_tool_use_get_auto_and_an_instruction() {
    let w = world();
    let schema = output_schema(ProposalKind::Composed, &w.defs);
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/messages"))
        .respond_with(ResponseTemplate::new(200).set_body_json(tool_use_message(serde_json::json!({}))))
        .mount(&server)
        .await;
    let p = anthropic_with(&server, ["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-5-5"]);
    let req = LlmRequest { tier: ModelTier::Quality, ..request() };
    p.complete_with(&req, Some(&schema)).await.unwrap();
    // 快速档（Haiku）：强制工具调用，不带 effort
    let req = LlmRequest { tier: ModelTier::Fast, ..request() };
    p.complete_with(&req, Some(&schema)).await.unwrap();
    let received = server.received_requests().await.unwrap();
    let quality: serde_json::Value = serde_json::from_slice(&received[0].body).unwrap();
    assert_eq!(quality["tool_choice"], serde_json::json!({"type": "auto"}));
    assert!(quality["system"].as_str().unwrap().contains(COMPOSED_TOOL));
    assert_eq!(quality["output_config"]["effort"], "low");
    let fast: serde_json::Value = serde_json::from_slice(&received[1].body).unwrap();
    assert_eq!(fast["tool_choice"], serde_json::json!({"type": "tool", "name": COMPOSED_TOOL}));
    assert!(fast.get("output_config").is_none());
}

#[tokio::test]
async fn anthropic_text_reply_and_structured_switch_off_fall_back_to_text() {
    let w = world();
    let schema = output_schema(ProposalKind::Composed, &w.defs);
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/messages"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "content": [{"type": "text", "text": "{\"title\":\"t\"}"}],
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 10, "output_tokens": 5},
        })))
        .mount(&server)
        .await;
    // 服务没有调用工具：退回读取文本
    let p = anthropic_with(&server, ["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-5"]);
    let resp = p.complete_with(&request(), Some(&schema)).await.unwrap();
    assert_eq!((resp.text.as_str(), resp.structured), ("{\"title\":\"t\"}", false));
    // 关闭结构化输出：请求中不带工具
    let config = ProviderConfig { base_url: server.uri(), structured: false, ..ProviderConfig::anthropic_default() };
    let p = HttpProvider::new(config, Secret::new(KEY)).unwrap();
    p.complete_with(&request(), Some(&schema)).await.unwrap();
    let received = server.received_requests().await.unwrap();
    let body: serde_json::Value = serde_json::from_slice(&received[1].body).unwrap();
    assert!(body.get("tools").is_none() && body.get("tool_choice").is_none());
}

/// 达到 max_tokens 时工具参数可能不完整：视为失败（上层改用离线模板），不当作结构化结果。
#[tokio::test]
async fn anthropic_tool_call_cut_off_by_max_tokens_is_an_error() {
    let w = world();
    let schema = output_schema(ProposalKind::Composed, &w.defs);
    let server = MockServer::start().await;
    let mut truncated = tool_use_message(serde_json::json!({"title": "码头"}));
    truncated["stop_reason"] = serde_json::json!("max_tokens");
    Mock::given(method("POST"))
        .and(path("/v1/messages"))
        .respond_with(ResponseTemplate::new(200).set_body_json(truncated))
        .mount(&server)
        .await;
    let p = anthropic_with(&server, ["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-5"]);
    assert!(matches!(p.complete_with(&request(), Some(&schema)).await, Err(LlmError::BadResponse(_))));
}

fn openai(server: &MockServer) -> HttpProvider {
    let config = ProviderConfig {
        kind: ProviderKind::OpenAiCompatible,
        base_url: server.uri(),
        models: ["m-fast".into(), "m-balanced".into(), "m-quality".into()],
        timeout_secs: 10,
        structured: true,
        reasoning: None,
    };
    HttpProvider::new(config, Secret::new(KEY)).unwrap()
}

#[tokio::test]
async fn openai_uses_strict_json_schema_response_format() {
    let w = world();
    let schema = output_schema(ProposalKind::Composed, &w.defs);
    let proposal = serde_json::to_string(&legal(&keys(&w))).unwrap();
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .and(header("authorization", format!("Bearer {KEY}").as_str()))
        .and(body_partial_json(serde_json::json!({
            "model": "m-balanced",
            "response_format": {"type": "json_schema", "json_schema": {"name": COMPOSED_TOOL, "strict": true}},
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "choices": [{"index": 0, "message": {"role": "assistant", "content": proposal, "refusal": null}}],
            "usage": {"prompt_tokens": 800, "completion_tokens": 90},
        })))
        .expect(1)
        .mount(&server)
        .await;
    let resp = openai(&server).complete_with(&request(), Some(&schema)).await.unwrap();
    assert!(resp.structured);
    assert_eq!(resp.text, proposal);
    let body: serde_json::Value = serde_json::from_slice(&server.received_requests().await.unwrap()[0].body).unwrap();
    assert_eq!(body["response_format"]["json_schema"]["schema"], schema.schema);
    check_strict(&body["response_format"]["json_schema"]["schema"]).unwrap();
    assert!(body.get("tools").is_none());
}

#[tokio::test]
async fn openai_refusal_and_unsupported_structured_output() {
    let w = world();
    let schema = output_schema(ProposalKind::Composed, &w.defs);
    // 严格模式下的拒绝
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "choices": [{"message": {"content": null, "refusal": "I can't help with that."}}],
        })))
        .mount(&server)
        .await;
    assert_eq!(openai(&server).complete_with(&request(), Some(&schema)).await, Err(LlmError::Refused));

    // 服务不支持 json_schema（400）：以纯文本重发一次
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .and(body_partial_json(serde_json::json!({"response_format": {"type": "json_schema"}})))
        .respond_with(ResponseTemplate::new(400).set_body_json(serde_json::json!({
            "error": {"message": "response_format json_schema is not supported"},
        })))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "choices": [{"message": {"content": "```json\n{\"title\":\"t\"}\n```"}}],
        })))
        .mount(&server)
        .await;
    let resp = openai(&server).complete_with(&request(), Some(&schema)).await.unwrap();
    assert!(!resp.structured, "退回文本模式");
    let received = server.received_requests().await.unwrap();
    assert_eq!(received.len(), 2);
    let retry: serde_json::Value = serde_json::from_slice(&received[1].body).unwrap();
    assert!(retry.get("response_format").is_none());
}

// ───────────────────────────── 管线：结构化输出 → 裁决 → 命令；缓存与预算 ─────────────────────────────

#[tokio::test]
async fn live_pipeline_turns_a_tool_call_into_a_composed_event_command() {
    let w = world();
    let proposal = serde_json::to_value(legal(&keys(&w))).unwrap();
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/messages"))
        .and(body_partial_json(serde_json::json!({"tool_choice": {"type": "tool", "name": COMPOSED_TOOL}})))
        .respond_with(ResponseTemplate::new(200).set_body_json(tool_use_message(proposal)))
        .mount(&server)
        .await;
    let config = ProviderConfig { base_url: server.uri(), ..ProviderConfig::anthropic_default() };
    let settings = AiSettings { mode: AiMode::Live, monthly_calls: 5, ..AiSettings::default() };
    let provider = HttpProvider::new(config, Secret::new(KEY)).unwrap();
    let pipeline = AiPipeline::new(content(), &settings, Some(Provider::Http(provider)));

    let task = pipeline.prepare(&w, TaskRequest::Composed).expect("开局时可以开始组合事件");
    assert_eq!(task.kind, ProposalKind::Composed);
    for var in ["summary", "effects", "keys", "history", "date"] {
        assert!(task.vars.contains_key(var), "缺少变量 {var}");
    }
    assert!(task.offline.is_some(), "离线模板也能生成备选");
    let outcome = pipeline.process(task).await;
    assert_eq!(outcome.source, Some(ProposalSource::Llm));
    assert_eq!(outcome.verdict.as_ref().unwrap().decision, Decision::Accept);
    let cmds = pipeline.finalize(&w, &outcome);
    match cmds.as_slice() {
        [Command::ApplyComposedEvent { title, effects, source, .. }] => {
            assert_eq!(title, "码头大火");
            assert_eq!(effects.len(), 3);
            assert_eq!(*source, ComposedSource::Model);
        }
        other => panic!("应得到一条组合事件命令：{other:?}"),
    }
    let audit = pipeline.audit_log();
    assert!(audit.iter().any(|a| a.stage == "LLM 输出" && a.detail.contains("结构化输出 propose_event")));

    // 同样的输入：命中缓存，不再请求，也不计入预算
    let again = pipeline.process(pipeline.prepare(&w, TaskRequest::Composed).unwrap()).await;
    assert_eq!(again.source, Some(ProposalSource::Cache));
    assert_eq!(server.received_requests().await.unwrap().len(), 1);
    assert_eq!(pipeline.budget(w.day()).calls_used, 1);
    // 发给服务的请求体里的提示词带有效果词表与近期历史
    let body: serde_json::Value = serde_json::from_slice(&server.received_requests().await.unwrap()[0].body).unwrap();
    let user = body["messages"][0]["content"].as_str().unwrap();
    assert!(user.contains("location_supply") && user.contains("近来的事件"), "{user}");
}

#[tokio::test]
async fn composed_task_respects_budget_and_falls_back_to_templates() {
    let w = world();
    let server = MockServer::start().await;
    let config = ProviderConfig { base_url: server.uri(), ..ProviderConfig::anthropic_default() };
    let settings = AiSettings { mode: AiMode::Live, monthly_calls: 0, ..AiSettings::default() };
    let provider = HttpProvider::new(config, Secret::new(KEY)).unwrap();
    let pipeline = AiPipeline::new(content(), &settings, Some(Provider::Http(provider)));
    let outcome = pipeline.process(pipeline.prepare(&w, TaskRequest::Composed).unwrap()).await;
    assert_eq!(outcome.source, Some(ProposalSource::Offline));
    assert!(server.received_requests().await.unwrap().is_empty(), "预算为 0 时不发出请求");
    assert!(pipeline.audit_log().iter().any(|a| a.stage == "预算"));
    let cmds = pipeline.finalize(&w, &outcome);
    match cmds.as_slice() {
        [Command::ApplyComposedEvent { source, .. }] => assert_eq!(*source, ComposedSource::Template),
        other => panic!("离线模板应生成一条组合事件命令：{other:?}"),
    }
    // 冷却期内不准备任务
    let mut after = w.clone();
    cmds[0].apply(&mut after).unwrap();
    assert!(pipeline.prepare(&after, TaskRequest::Composed).is_none());
    // 离线生成是确定性的
    let a = manifest_ai::offline::composed(&w, &content().templates);
    let b = manifest_ai::offline::composed(&w, &content().templates);
    assert!(a.is_some() && a == b);
}
