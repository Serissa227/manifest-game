//! 模型提供商的请求格式与错误处理（wiremock 模拟 Anthropic Messages API 与 OpenAI 兼容接口），
//! 以及测试 11 的一部分：错误信息中不出现密钥。

use manifest_ai::{HttpProvider, LlmError, LlmRequest, ModelTier, ProviderConfig, ProviderKind, Secret};
use std::time::Duration;
use wiremock::matchers::{body_partial_json, header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

const KEY: &str = "sk-test-provider-0c4e2b";

fn request(tier: ModelTier) -> LlmRequest {
    LlmRequest {
        system: "你是航海贸易游戏的叙事助手。".into(),
        user: "请输出 JSON。".into(),
        max_tokens: 600,
        tier,
        hint: Some(serde_json::json!({"text": "不应发送"})),
    }
}

fn anthropic(server: &MockServer) -> HttpProvider {
    let config = ProviderConfig { base_url: server.uri(), ..ProviderConfig::anthropic_default() };
    HttpProvider::new(config, Secret::new(KEY)).unwrap()
}

fn message(text: &str) -> serde_json::Value {
    serde_json::json!({
        "id": "msg_1", "type": "message", "role": "assistant", "model": "claude-sonnet-5",
        "content": [{"type": "text", "text": text}],
        "stop_reason": "end_turn",
        "usage": {"input_tokens": 321, "output_tokens": 45},
    })
}

#[tokio::test]
async fn anthropic_request_format_and_response_parsing() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/messages"))
        .and(header("x-api-key", KEY))
        .and(header("anthropic-version", "2023-06-01"))
        .and(header("content-type", "application/json"))
        .and(body_partial_json(serde_json::json!({
            "model": "claude-sonnet-5",
            "system": "你是航海贸易游戏的叙事助手。",
            "messages": [{"role": "user", "content": "请输出 JSON。"}],
            "output_config": {"effort": "low"},
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(message(r#"{"text":"港口传来消息"}"#)))
        .expect(1)
        .mount(&server)
        .await;
    let resp = anthropic(&server).complete(&request(ModelTier::Balanced)).await.unwrap();
    assert_eq!(resp.text, r#"{"text":"港口传来消息"}"#);
    assert_eq!((resp.input_tokens, resp.output_tokens), (321, 45));

    let received = server.received_requests().await.unwrap();
    let body: serde_json::Value = serde_json::from_slice(&received[0].body).unwrap();
    assert!(body["max_tokens"].as_u64().unwrap() >= 600);
    assert!(body.get("hint").is_none() && !body.to_string().contains("不应发送"), "Mock 专用的提示不发给真实提供商");
    assert!(body.get("fallbacks").is_none() && received[0].headers.get("anthropic-beta").is_none());
}

#[tokio::test]
async fn anthropic_tiers_select_models_and_options() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/messages"))
        .respond_with(ResponseTemplate::new(200).set_body_json(message("{}")))
        .mount(&server)
        .await;
    let p = anthropic(&server);
    p.complete(&request(ModelTier::Fast)).await.unwrap();
    p.complete(&request(ModelTier::Quality)).await.unwrap();
    let received = server.received_requests().await.unwrap();
    let fast: serde_json::Value = serde_json::from_slice(&received[0].body).unwrap();
    assert_eq!(fast["model"], "claude-haiku-4-5");
    assert!(fast.get("output_config").is_none(), "Haiku 不支持 effort");
    let quality: serde_json::Value = serde_json::from_slice(&received[1].body).unwrap();
    assert_eq!(quality["model"], "claude-opus-5");
    assert_eq!(quality["output_config"]["effort"], "low");
    assert_eq!(quality["fallbacks"], "default");
    assert_eq!(received[1].headers.get("anthropic-beta").unwrap(), "server-side-fallback-2026-07-01");
}

#[tokio::test]
async fn anthropic_errors_and_refusals() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/messages"))
        .respond_with(ResponseTemplate::new(429).set_body_json(serde_json::json!({
            "type": "error", "error": {"type": "rate_limit_error", "message": "Number of requests has exceeded your rate limit"},
        })))
        .up_to_n_times(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/v1/messages"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": "msg_2", "type": "message", "role": "assistant", "content": [],
            "stop_reason": "refusal", "usage": {"input_tokens": 10, "output_tokens": 0},
        })))
        .up_to_n_times(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/v1/messages"))
        .respond_with(ResponseTemplate::new(200).set_body_json(message("{}")).set_delay(Duration::from_secs(4)))
        .mount(&server)
        .await;
    let p = anthropic(&server);
    match p.complete(&request(ModelTier::Balanced)).await {
        Err(LlmError::Http { status: 429, message }) => assert!(message.contains("rate limit")),
        other => panic!("{other:?}"),
    }
    assert_eq!(p.complete(&request(ModelTier::Balanced)).await, Err(LlmError::Refused));
    let slow = HttpProvider::new(
        ProviderConfig { base_url: server.uri(), timeout_secs: 1, ..ProviderConfig::anthropic_default() },
        Secret::new(KEY),
    )
    .unwrap();
    assert_eq!(slow.complete(&request(ModelTier::Balanced)).await, Err(LlmError::Timeout));
}

#[tokio::test]
async fn openai_compatible_request_format_and_response_parsing() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .and(header("authorization", format!("Bearer {KEY}").as_str()))
        .and(body_partial_json(serde_json::json!({
            "model": "local-balanced",
            "messages": [
                {"role": "system", "content": "你是航海贸易游戏的叙事助手。"},
                {"role": "user", "content": "请输出 JSON。"},
            ],
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": "chatcmpl-1", "object": "chat.completion",
            "choices": [{"index": 0, "message": {"role": "assistant", "content": "{\"reply\":\"好说\"}"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 50, "completion_tokens": 7, "total_tokens": 57},
        })))
        .expect(1)
        .mount(&server)
        .await;
    let config = ProviderConfig {
        kind: ProviderKind::OpenAiCompatible,
        base_url: format!("{}/", server.uri()),
        models: ["local-fast".into(), "local-balanced".into(), "local-quality".into()],
        timeout_secs: 10,
        structured: true,
        reasoning: None,
    };
    let p = HttpProvider::new(config, Secret::new(KEY)).unwrap();
    let resp = p.complete(&request(ModelTier::Balanced)).await.unwrap();
    assert_eq!(resp.text, "{\"reply\":\"好说\"}");
    assert_eq!((resp.input_tokens, resp.output_tokens), (50, 7));

    // 未填写模型名
    let p = HttpProvider::new(ProviderConfig::openai_compatible_default(), Secret::new(KEY)).unwrap();
    assert_eq!(p.complete(&request(ModelTier::Fast)).await, Err(LlmError::NoModel));
}

/// 测试 11：服务端在错误信息或输出中回显密钥时，返回给上层的内容已被遮蔽。
#[tokio::test]
async fn test11_echoed_key_is_masked_in_errors_and_outputs() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .respond_with(ResponseTemplate::new(401).set_body_json(serde_json::json!({
            "error": {"message": format!("Incorrect API key provided: {KEY}"), "type": "invalid_request_error"},
        })))
        .up_to_n_times(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "choices": [{"message": {"content": format!("key={KEY}")}}],
        })))
        .mount(&server)
        .await;
    let config = ProviderConfig {
        kind: ProviderKind::OpenAiCompatible,
        base_url: server.uri(),
        models: ["m".into(), "m".into(), "m".into()],
        timeout_secs: 10,
        structured: true,
        reasoning: None,
    };
    let p = HttpProvider::new(config, Secret::new(KEY)).unwrap();
    let err = p.complete(&request(ModelTier::Fast)).await.unwrap_err();
    assert!(matches!(err, LlmError::Http { status: 401, .. }));
    assert!(!err.to_string().contains(KEY) && !format!("{err:?}").contains(KEY));
    let ok = p.complete(&request(ModelTier::Fast)).await.unwrap();
    assert_eq!(ok.text, "key=***");
}

/// OpenAI 兼容接口的推理强度：按档位发送 `reasoning_effort` 并去掉 `temperature`；空字符串的档位两者照旧。
#[tokio::test]
async fn openai_reasoning_effort_per_tier_replaces_temperature() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "choices": [{"index": 0, "message": {"role": "assistant", "content": "{}"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 5, "completion_tokens": 1, "total_tokens": 6},
        })))
        .mount(&server)
        .await;
    let config = ProviderConfig {
        kind: ProviderKind::OpenAiCompatible,
        base_url: server.uri(),
        models: ["luna".into(), "sol".into(), "astra".into()],
        timeout_secs: 10,
        structured: true,
        reasoning: Some(["none".into(), String::new(), "low".into()]),
    };
    let p = HttpProvider::new(config, Secret::new(KEY)).unwrap();
    for tier in [ModelTier::Fast, ModelTier::Balanced, ModelTier::Quality] {
        p.complete(&request(tier)).await.unwrap();
    }
    let bodies: Vec<serde_json::Value> =
        server.received_requests().await.unwrap().iter().map(|r| serde_json::from_slice(&r.body).unwrap()).collect();
    assert_eq!(bodies.len(), 3);
    assert_eq!((bodies[0]["model"].as_str(), bodies[0]["reasoning_effort"].as_str()), (Some("luna"), Some("none")));
    assert!(bodies[0].get("temperature").is_none(), "指定推理强度时不发送 temperature");
    assert!(bodies[1].get("reasoning_effort").is_none(), "空字符串的档位不发送推理强度");
    assert_eq!(bodies[1]["temperature"], serde_json::json!(0.7));
    assert_eq!(bodies[2]["reasoning_effort"].as_str(), Some("low"));
    assert!(bodies[2].get("temperature").is_none());
    assert!(bodies.iter().all(|b| b["max_tokens"] == serde_json::json!(600)));
}
