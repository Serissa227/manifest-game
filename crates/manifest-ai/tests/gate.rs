//! 调用闸门：按现实时间的上限挡住真实调用（改用离线模板），即使本游戏月的预算还有余量；
//! 放行的调用把实际消耗的 token 记进闸门。

use manifest_ai::pipeline::ProposalSource;
use manifest_ai::{
    AiMode, AiPipeline, AiSettings, CallGate, HttpProvider, Provider, ProviderConfig, Secret, TaskRequest, WindowGate,
};
use manifest_core::World;
use manifest_core::ids::ScenarioId;
use std::sync::Arc;
use std::time::Duration;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

#[tokio::test]
async fn the_gate_caps_real_calls_even_with_budget_left() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/messages"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": "m", "type": "message", "role": "assistant",
            "content": [{"type": "text", "text": "{\"events\":[]}"}],
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 40, "output_tokens": 2},
        })))
        .mount(&server)
        .await;
    let dir = manifest_data::find_data_dir().unwrap();
    let defs = manifest_data::load(&dir).unwrap();
    let content = Arc::new(manifest_data::load_ai_content(&dir).unwrap());
    let config = ProviderConfig { base_url: server.uri(), ..ProviderConfig::anthropic_default() };
    // 预算充足（每月 60 次），闸门一小时只放行 2 次
    let settings = AiSettings { mode: AiMode::Live, monthly_calls: 60, ..AiSettings::default() };
    let provider = HttpProvider::new(config, Secret::new("sk-test-gate")).unwrap();
    let gate = Arc::new(WindowGate::new(Duration::from_secs(3_600), 2, 1_000_000));
    let pipeline = AiPipeline::new(content, &settings, Some(Provider::Http(provider)))
        .with_call_gate(gate.clone() as Arc<dyn CallGate>);
    let world = World::new(defs, ScenarioId(0), 3).unwrap();

    let mut sources = Vec::new();
    for i in 0..4u32 {
        let mut task = pipeline.prepare(&world, TaskRequest::Director).unwrap();
        // 提示词各不相同，不会命中缓存
        task.vars.insert("summary".into(), format!("第 {i} 份摘要"));
        sources.push(pipeline.process(task).await.source);
    }
    assert_eq!(
        sources,
        vec![
            Some(ProposalSource::Llm),
            Some(ProposalSource::Llm),
            Some(ProposalSource::Offline),
            Some(ProposalSource::Offline)
        ]
    );
    assert_eq!(server.received_requests().await.unwrap().len(), 2, "闸门关上后不再发出请求");
    let used = gate.usage();
    assert_eq!((used.calls, used.tokens), (2, 84), "放行的两次调用各记 40 + 2 tokens");
    assert!(
        pipeline.audit_log().iter().any(|a| a.detail.contains("近一段时间的调用已达上限")),
        "审计日志说明改用离线模板的原因"
    );
}
