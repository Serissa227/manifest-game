//! Jev 契约中的组合事件（docs/JEV_CONTRACT.md）：请求体、修正合并；Jev 接受了越界的组合事件时内核仍然拒绝。

#![cfg(feature = "jev")]

use manifest_ai::adjudicator::JevAdjudicator;
use manifest_ai::proposal::{ComposedEffectRaw as E, ComposedEventProposal};
use manifest_ai::{AdjudicationContext, AiMode, AiPipeline, AiSettings, Decision, JevConfig, Proposal, TaskRequest};
use manifest_core::ids::ScenarioId;
use manifest_core::{Command, World};
use std::sync::Arc;
use wiremock::matchers::{body_partial_json, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn world() -> World {
    World::new(manifest_data::load_default().unwrap_or_else(|e| panic!("{e}")), ScenarioId(0), 5).unwrap()
}

fn ctx(w: &World) -> AdjudicationContext {
    AdjudicationContext {
        defs: w.defs.clone(),
        relations: w.state.relations.iter().map(|r| (r.a, r.b, r.status)).collect(),
    }
}

fn config(server: &MockServer) -> JevConfig {
    JevConfig { base_url: server.uri(), timeout_ms: 2_000, min_score: 0.5 }
}

fn storm(region: &str, mult: f64) -> Proposal {
    Proposal::Composed(ComposedEventProposal {
        title: "风暴季".into(),
        narrative: "老水手说今年的风暴季来得格外早。".into(),
        effects: vec![E::RegionStorm { region: region.into(), mult, days: 30 }],
    })
}

#[tokio::test]
async fn jev_receives_composed_proposals_and_its_fixes_are_reparsed() {
    let w = world();
    let region = w.defs.regions[0].key.clone();
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/adjudicate"))
        .and(body_partial_json(serde_json::json!({
            "task": "adjudicate",
            "kind": "composed",
            "proposal": {"title": "风暴季", "effects": [{"effect": "region_storm", "region": region, "mult": 2.0, "days": 30}]},
            "features": {"rule_decision": "Accept"},
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "verdict": "modify", "confidence": 0.8, "score": 0.8, "reasons": ["too_strong"],
            "modifications": {"effects": [{"effect": "region_storm", "region": region, "mult": 1.5, "days": 30}]},
        })))
        .expect(1)
        .mount(&server)
        .await;
    let v = JevAdjudicator::new(config(&server)).adjudicate(&storm(&region, 2.0), &ctx(&w)).await;
    assert_eq!((v.decision, v.via.as_str()), (Decision::Modify, "jev"));
    assert_eq!(v.proposal, Some(storm(&region, 1.5)));

    // 修正夹带了效果词表以外的字段：不符合 schema，整体拒绝
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/adjudicate"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "verdict": "modify", "confidence": 0.8, "score": 0.9,
            "modifications": {"effects": [{"effect": "grant_money", "amount": 100000}]},
        })))
        .mount(&server)
        .await;
    let v = JevAdjudicator::new(config(&server)).adjudicate(&storm(&region, 2.0), &ctx(&w)).await;
    assert_eq!(v.decision, Decision::Reject);
}

/// Jev 接受了越界的组合事件（系数超出 effects.toml 的边界）：内核校验仍然拒绝，不产生命令。
#[tokio::test]
async fn jev_accepting_an_out_of_bounds_composed_event_is_still_rejected_by_the_kernel() {
    let w = world();
    let region = w.defs.regions[0].key.clone();
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/adjudicate"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(serde_json::json!({"verdict": "accept", "confidence": 1.0, "score": 1.0})),
        )
        .mount(&server)
        .await;
    let dir = manifest_data::find_data_dir().unwrap();
    let content = Arc::new(manifest_data::load_ai_content(&dir).unwrap());
    let settings = AiSettings { mode: AiMode::Offline, jev: Some(config(&server)), ..AiSettings::default() };
    let pipeline = AiPipeline::new(content, &settings, None);
    let mut task = pipeline.prepare(&w, TaskRequest::Composed).unwrap();
    task.offline = Some(storm(&region, 9.0));
    let outcome = pipeline.process(task).await;
    let verdict = outcome.verdict.clone().unwrap();
    assert_eq!((verdict.decision, verdict.via.as_str()), (Decision::Accept, "jev"));
    let cmds: Vec<Command> = pipeline.finalize(&w, &outcome);
    assert!(cmds.is_empty(), "{cmds:?}");
    assert!(pipeline.audit_log().iter().any(|a| a.stage == "内核校验" && a.detail.contains("拒绝")));
}
