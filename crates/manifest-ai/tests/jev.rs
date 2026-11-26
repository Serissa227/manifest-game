//! 第 10 节测试 8（Jev 契约）：用 wiremock 模拟 docs/JEV_CONTRACT.md 中的 HTTP 契约，
//! 覆盖正常、超时、错误三种情况；超时与错误时回退到 RuleAdjudicator。
//! 另外验证：即使 Jev 接受了非法提案，内核校验仍会拒绝。

#![cfg(feature = "jev")]

use manifest_ai::adjudicator::JevAdjudicator;
use manifest_ai::proposal::{DirectorProposal, EventParamsRaw, EventPick, StrategyProposal};
use manifest_ai::{AdjudicationContext, AiMode, AiPipeline, AiSettings, Decision, JevConfig, Proposal, TaskRequest};
use manifest_core::ids::{OwnerId, ScenarioId};
use manifest_core::news::Intent;
use manifest_core::{Command, World};
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use wiremock::matchers::{body_partial_json, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn world() -> World {
    static DEFS: OnceLock<Arc<manifest_core::StaticData>> = OnceLock::new();
    let defs = DEFS.get_or_init(|| manifest_data::load_default().unwrap_or_else(|e| panic!("{e}"))).clone();
    World::new(defs, ScenarioId(0), 5).unwrap()
}

fn content() -> Arc<manifest_data::AiContent> {
    let dir = manifest_data::find_data_dir().unwrap();
    Arc::new(manifest_data::load_ai_content(&dir).unwrap())
}

fn ctx(w: &World) -> AdjudicationContext {
    AdjudicationContext {
        defs: w.defs.clone(),
        relations: w.state.relations.iter().map(|r| (r.a, r.b, r.status)).collect(),
    }
}

fn config(server: &MockServer, timeout_ms: u64) -> JevConfig {
    JevConfig { base_url: server.uri(), timeout_ms, min_score: 0.5 }
}

fn storm(mult: f64) -> Proposal {
    Proposal::Director(DirectorProposal {
        events: vec![EventPick {
            event: "storm_season".into(),
            params: EventParamsRaw {
                region: Some("frost_west".into()),
                mult: Some(mult),
                days: Some(60),
                ..EventParamsRaw::default()
            },
        }],
    })
}

fn unknown_event() -> Proposal {
    Proposal::Director(DirectorProposal {
        events: vec![EventPick { event: "gold_rain".into(), params: EventParamsRaw::default() }],
    })
}

async fn mount(server: &MockServer, p: &str, resp: ResponseTemplate) {
    Mock::given(method("POST")).and(path(p)).respond_with(resp).mount(server).await;
}

// ───────────────────────────── 正常 ─────────────────────────────

#[tokio::test]
async fn test8_normal_accept_reject_and_request_format() {
    let server = MockServer::start().await;
    // 请求体必须符合契约：task / kind / proposal / features
    Mock::given(method("POST"))
        .and(path("/v1/adjudicate"))
        .and(body_partial_json(serde_json::json!({
            "task": "adjudicate",
            "kind": "director",
            "proposal": {"events": [{"event": "storm_season", "params": {"region": "frost_west", "mult": 2.0, "days": 60}}]},
            "features": {"rule_decision": "Accept"},
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "verdict": "accept", "confidence": 0.93, "score": 0.88, "reasons": ["plausible"],
        })))
        .expect(1)
        .mount(&server)
        .await;
    let w = world();
    let jev = JevAdjudicator::new(config(&server, 2_000));
    let v = jev.adjudicate(&storm(2.0), &ctx(&w)).await;
    assert_eq!(v.decision, Decision::Accept);
    assert_eq!(v.via, "jev");
    assert_eq!(v.reasons, vec!["plausible".to_string()]);
    assert!((v.confidence - 0.93).abs() < 1e-9 && (v.score - 0.88).abs() < 1e-9);
    assert_eq!(v.proposal, Some(storm(2.0)));

    // 拒绝
    let server = MockServer::start().await;
    mount(
        &server,
        "/v1/adjudicate",
        ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "verdict": "reject", "confidence": 0.8, "reasons": ["too_dramatic"],
        })),
    )
    .await;
    let v = JevAdjudicator::new(config(&server, 2_000)).adjudicate(&storm(2.0), &ctx(&w)).await;
    assert_eq!(v.decision, Decision::Reject);
    assert!(v.proposal.is_none());
    assert_eq!(v.via, "jev");

    // 合理性分数低于阈值：不执行
    let server = MockServer::start().await;
    mount(
        &server,
        "/v1/adjudicate",
        ResponseTemplate::new(200)
            .set_body_json(serde_json::json!({"verdict": "accept", "confidence": 0.9, "score": 0.2})),
    )
    .await;
    let v = JevAdjudicator::new(config(&server, 2_000)).adjudicate(&storm(2.0), &ctx(&w)).await;
    assert_eq!(v.decision, Decision::Reject);
    assert!(v.reasons[0].contains("低于阈值"));
}

#[tokio::test]
async fn test8_normal_modify_merges_parameter_fixes() {
    let server = MockServer::start().await;
    mount(
        &server,
        "/v1/adjudicate",
        ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "verdict": "modify", "confidence": 0.7, "score": 0.75, "reasons": ["risk_too_high"],
            "modifications": {"risk": 0.35},
        })),
    )
    .await;
    let w = world();
    let p = Proposal::Strategy(StrategyProposal { risk: 0.7, preferred: vec!["grain".into()], memo: "扩张".into() });
    let v = JevAdjudicator::new(config(&server, 2_000)).adjudicate(&p, &ctx(&w)).await;
    assert_eq!(v.decision, Decision::Modify);
    match v.proposal {
        Some(Proposal::Strategy(s)) => {
            assert_eq!(s.risk, 0.35);
            assert_eq!(s.preferred, vec!["grain".to_string()], "未修正的字段保持原样");
        }
        other => panic!("{other:?}"),
    }

    // 修正不符合 schema（例如夹带新字段）：整体拒绝
    let server = MockServer::start().await;
    mount(
        &server,
        "/v1/adjudicate",
        ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "verdict": "modify", "confidence": 0.7, "score": 0.9, "modifications": {"cash": 1000000},
        })),
    )
    .await;
    let v = JevAdjudicator::new(config(&server, 2_000)).adjudicate(&p, &ctx(&w)).await;
    assert_eq!(v.decision, Decision::Reject);
    assert!(v.reasons[0].contains("schema"));
}

#[tokio::test]
async fn test8_normal_intent_classification() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/classify"))
        .and(body_partial_json(serde_json::json!({"task": "classify_intent", "text": "看在老朋友的份上"})))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(serde_json::json!({"label": "rapport", "confidence": 0.91})),
        )
        .expect(1)
        .mount(&server)
        .await;
    let jev = JevAdjudicator::new(config(&server, 2_000));
    let (intent, conf, via) = jev.classify_intent("看在老朋友的份上", "某港").await;
    assert_eq!((intent, via.as_str()), (Intent::Rapport, "jev"));
    assert!((conf - 0.91).abs() < 1e-9);
}

// ───────────────────────────── 超时 ─────────────────────────────

#[tokio::test]
async fn test8_timeout_falls_back_to_rule_adjudicator() {
    let server = MockServer::start().await;
    let slow =
        |body: serde_json::Value| ResponseTemplate::new(200).set_body_json(body).set_delay(Duration::from_secs(3));
    mount(&server, "/v1/adjudicate", slow(serde_json::json!({"verdict": "reject", "confidence": 1.0}))).await;
    mount(&server, "/v1/classify", slow(serde_json::json!({"label": "threat", "confidence": 1.0}))).await;
    let w = world();
    let jev = JevAdjudicator::new(config(&server, 200));

    // 合法提案：规则裁决接受
    let v = jev.adjudicate(&storm(2.0), &ctx(&w)).await;
    assert_eq!(v.via, "rule(回退)");
    assert_eq!(v.decision, Decision::Accept);
    assert!(v.reasons[0].contains("超时"), "{:?}", v.reasons);
    // 越界提案：规则裁决拒绝
    let v = jev.adjudicate(&storm(9.0), &ctx(&w)).await;
    assert_eq!((v.decision, v.via.as_str()), (Decision::Reject, "rule(回退)"));

    // 意图分类回退到关键词规则
    let (intent, _, via) = jev.classify_intent("给你点好处，意思意思", "某港").await;
    assert_eq!((intent, via.as_str()), (Intent::Bribe, "rule(回退)"));
}

// ───────────────────────────── 错误 ─────────────────────────────

#[tokio::test]
async fn test8_error_responses_fall_back_to_rule_adjudicator() {
    let w = world();
    let cases = [
        ResponseTemplate::new(500).set_body_string("internal error"),
        ResponseTemplate::new(503).set_body_json(serde_json::json!({"error": "overloaded"})),
        ResponseTemplate::new(200).set_body_string("not json"),
        ResponseTemplate::new(200).set_body_json(serde_json::json!({"verdict": "maybe"})),
        ResponseTemplate::new(200).set_body_json(serde_json::json!({"label": "sarcasm"})),
    ];
    for resp in cases {
        let server = MockServer::start().await;
        mount(&server, "/v1/adjudicate", resp.clone()).await;
        mount(&server, "/v1/classify", resp).await;
        let jev = JevAdjudicator::new(config(&server, 2_000));
        let v = jev.adjudicate(&storm(2.0), &ctx(&w)).await;
        assert_eq!((v.decision, v.via.as_str()), (Decision::Accept, "rule(回退)"), "{:?}", v.reasons);
        let v = jev.adjudicate(&unknown_event(), &ctx(&w)).await;
        assert_eq!((v.decision, v.via.as_str()), (Decision::Reject, "rule(回退)"));
        let (intent, _, via) = jev.classify_intent("再便宜点，打个折", "某港").await;
        assert_eq!((intent, via.as_str()), (Intent::Discount, "rule(回退)"));
    }

    // 服务不可达
    let jev =
        JevAdjudicator::new(JevConfig { base_url: "http://127.0.0.1:9".into(), timeout_ms: 2_000, min_score: 0.5 });
    let v = jev.adjudicate(&storm(2.0), &ctx(&w)).await;
    assert_eq!(v.via, "rule(回退)");
}

// ───────────────────────────── 与管线、内核的衔接 ─────────────────────────────

fn jev_pipeline(server: &MockServer) -> AiPipeline {
    let settings = AiSettings { mode: AiMode::Offline, jev: Some(config(server, 2_000)), ..AiSettings::default() };
    AiPipeline::new(content(), &settings, None)
}

/// Jev 接受了非法提案（封闭集合以外的事件），内核校验仍然拒绝：不产生任何命令。
#[tokio::test]
async fn test8_jev_accepting_an_illegal_proposal_is_still_rejected_by_the_kernel() {
    let server = MockServer::start().await;
    mount(
        &server,
        "/v1/adjudicate",
        ResponseTemplate::new(200)
            .set_body_json(serde_json::json!({"verdict": "accept", "confidence": 1.0, "score": 1.0})),
    )
    .await;
    let w = world();
    let pipeline = jev_pipeline(&server);
    let mut task = pipeline.prepare(&w, TaskRequest::Director).unwrap();
    task.offline = Some(unknown_event());
    let outcome = pipeline.process(task).await;
    let verdict = outcome.verdict.clone().unwrap();
    assert_eq!((verdict.decision, verdict.via.as_str()), (Decision::Accept, "jev"));
    assert!(pipeline.finalize(&w, &outcome).is_empty());
    assert!(pipeline.audit_log().iter().any(|a| a.stage == "内核校验" && a.detail.contains("拒绝")));

    // Jev 修正出越界的战略参数：内核仍把它夹紧到允许范围
    let server = MockServer::start().await;
    mount(
        &server,
        "/v1/adjudicate",
        ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "verdict": "modify", "confidence": 1.0, "score": 1.0, "modifications": {"risk": 7.5},
        })),
    )
    .await;
    let pipeline = jev_pipeline(&server);
    let company = w.state.agents.keys().find_map(|o| o.company()).unwrap();
    let task = pipeline.prepare(&w, TaskRequest::Strategy { company }).unwrap();
    let outcome = pipeline.process(task).await;
    assert_eq!(outcome.verdict.as_ref().unwrap().decision, Decision::Modify);
    let cmds = pipeline.finalize(&w, &outcome);
    match cmds.as_slice() {
        [Command::AdjustStrategy { risk, .. }] => assert_eq!(*risk, manifest_core::news::RISK_RANGE.1),
        other => panic!("{other:?}"),
    }
    let mut applied = w.clone();
    cmds[0].apply(&mut applied).unwrap();
    let strategy = applied.state.agents[&OwnerId::Company(company)].strategy.clone().unwrap();
    assert_eq!(strategy.risk, manifest_core::news::RISK_RANGE.1);
    // 即便绕过管线直接提交越界值，内核执行时也会夹紧
    let mut direct = w.clone();
    let raw = Command::AdjustStrategy { company, risk: manifest_core::fixed::Fx::from_int(7), preferred: Vec::new() };
    raw.apply(&mut direct).unwrap();
    assert_eq!(
        direct.state.agents[&OwnerId::Company(company)].strategy.as_ref().unwrap().risk,
        manifest_core::news::RISK_RANGE.1
    );
}

/// 议价时的意图分类走 Jev；Jev 不可用时回退到关键词规则，议价照常进行。
#[tokio::test]
async fn test8_bargain_uses_jev_intent_and_falls_back() {
    let w = world();
    let loc = w.state.agents[&OwnerId::Player].home;
    let request =
        || TaskRequest::Bargain { owner: OwnerId::Player, loc, player_text: "给你点好处，便宜点".into() };

    let server = MockServer::start().await;
    mount(
        &server,
        "/v1/classify",
        ResponseTemplate::new(200).set_body_json(serde_json::json!({"label": "threat", "confidence": 0.8})),
    )
    .await;
    mount(
        &server,
        "/v1/adjudicate",
        ResponseTemplate::new(200)
            .set_body_json(serde_json::json!({"verdict": "accept", "confidence": 0.9, "score": 0.9})),
    )
    .await;
    let pipeline = jev_pipeline(&server);
    let outcome = pipeline.process(pipeline.prepare(&w, request()).unwrap()).await;
    assert_eq!(outcome.intent, Some(Intent::Threat), "采用 Jev 的分类");

    let server = MockServer::start().await;
    mount(&server, "/v1/classify", ResponseTemplate::new(502)).await;
    mount(&server, "/v1/adjudicate", ResponseTemplate::new(502)).await;
    let pipeline = jev_pipeline(&server);
    let outcome = pipeline.process(pipeline.prepare(&w, request()).unwrap()).await;
    assert_eq!(outcome.intent, Some(Intent::Bribe), "回退到关键词规则");
    assert_eq!(outcome.verdict.as_ref().unwrap().via, "rule(回退)");
    assert!(outcome.accepted().is_some());
}
