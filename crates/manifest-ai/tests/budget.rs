//! 预算：同时发出的多个请求不会超出每月调用上限（检查与记账在同一把锁内完成）。

use manifest_ai::pipeline::ProposalSource;
use manifest_ai::{AiMode, AiPipeline, AiSettings, HttpProvider, Provider, ProviderConfig, Secret, TaskRequest};
use manifest_core::World;
use manifest_core::ids::ScenarioId;
use std::sync::Arc;
use std::time::Duration;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_requests_respect_the_monthly_call_limit() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/messages"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(serde_json::json!({
                    "id": "m", "type": "message", "role": "assistant",
                    "content": [{"type": "text", "text": "{\"events\":[]}"}],
                    "stop_reason": "end_turn",
                    "usage": {"input_tokens": 10, "output_tokens": 5},
                }))
                .set_delay(Duration::from_millis(300)),
        )
        .mount(&server)
        .await;
    let dir = manifest_data::find_data_dir().unwrap();
    let defs = manifest_data::load(&dir).unwrap();
    let content = Arc::new(manifest_data::load_ai_content(&dir).unwrap());
    let config = ProviderConfig { base_url: server.uri(), ..ProviderConfig::anthropic_default() };
    let settings = AiSettings { mode: AiMode::Live, monthly_calls: 2, ..AiSettings::default() };
    let provider = HttpProvider::new(config, Secret::new("sk-test-budget")).unwrap();
    let pipeline = Arc::new(AiPipeline::new(content, &settings, Some(Provider::Http(provider))));
    let world = World::new(defs, ScenarioId(0), 3).unwrap();

    // 同一天的 5 个事件导演任务同时发出（提示词各不相同，不会命中缓存）
    let mut handles = Vec::new();
    for i in 0..5u32 {
        let mut task = pipeline.prepare(&world, TaskRequest::Director).unwrap();
        task.vars.insert("summary".into(), format!("第 {i} 份摘要"));
        let p = pipeline.clone();
        handles.push(tokio::spawn(async move { p.process(task).await }));
    }
    let mut sources = Vec::new();
    for h in handles {
        sources.push(h.await.unwrap().source);
    }
    let llm = sources.iter().filter(|s| **s == Some(ProposalSource::Llm)).count();
    let offline = sources.iter().filter(|s| **s == Some(ProposalSource::Offline)).count();
    assert_eq!((llm, offline), (2, 3), "{sources:?}");
    assert_eq!(server.received_requests().await.unwrap().len(), 2, "只发出预算允许的请求");
    let b = pipeline.budget(world.day());
    assert_eq!((b.calls_used, b.calls_limit, b.tokens_used), (2, 2, 30));
}
