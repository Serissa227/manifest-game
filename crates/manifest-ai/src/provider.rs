//! LLM 提供商：OpenAI 兼容接口、Anthropic Messages API，以及测试与离线演示用的 Mock。
//!
//! 请求只包含提示词（世界摘要 + 模板），不含玩家本机的任何其他信息。密钥只出现在请求头中，
//! 错误信息与审计日志都不会包含密钥。
//!
//! 结构化输出（[`ProviderConfig::structured`]，默认开启）：调用方给出输出结构 [`OutputSchema`] 时，
//! - Anthropic 用工具调用：`tools = [{name, description, input_schema}]`、`tool_choice = {type: "tool", name}`，
//!   读取 `tool_use` 块的 `input`（不支持强制工具调用的模型改用 `auto` 并在系统提示中要求调用该工具）；
//! - OpenAI 兼容接口用 `response_format = {type: "json_schema", json_schema: {name, strict: true, schema}}`。
//!
//! 服务拒绝结构化参数（HTTP 400 / 422）时自动以纯文本重发一次；响应里没有工具调用时退回读取文本。
//! 文本结果仍由上层按"解析 → 修复一次"的流程处理。

use crate::schema::OutputSchema;
use crate::secret::Secret;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::Duration;

/// 模型档位。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ModelTier {
    /// 快速
    Fast,
    /// 均衡
    Balanced,
    /// 高质量
    Quality,
}

impl ModelTier {
    fn index(self) -> usize {
        match self {
            ModelTier::Fast => 0,
            ModelTier::Balanced => 1,
            ModelTier::Quality => 2,
        }
    }
}

/// 提供商类型。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProviderKind {
    /// OpenAI 兼容的 `/v1/chat/completions`
    OpenAiCompatible,
    /// Anthropic Messages API `/v1/messages`
    Anthropic,
}

fn default_structured() -> bool {
    true
}

/// 提供商配置（可写入设置文件；不含密钥）。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub kind: ProviderKind,
    /// 例如 `https://api.anthropic.com`；不含 `/v1/...` 路径
    pub base_url: String,
    /// 三个档位使用的模型：快速 / 均衡 / 高质量
    pub models: [String; 3],
    pub timeout_secs: u64,
    /// 结构化输出：Anthropic 用工具调用，OpenAI 兼容接口用 json_schema（默认开启；
    /// 服务不支持时可以关闭，改为纯文本输出 + 修复解析）
    #[serde(default = "default_structured")]
    pub structured: bool,
    /// OpenAI 兼容接口：三个档位各自的推理强度（请求中的 `reasoning_effort`；空字符串表示这一档不发送）。
    /// 设置后不再发送 `temperature`（推理模型不接受）。缺省为空，请求与以前相同
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<[String; 3]>,
}

impl ProviderConfig {
    /// Anthropic 的默认配置。
    pub fn anthropic_default() -> Self {
        ProviderConfig {
            kind: ProviderKind::Anthropic,
            base_url: "https://api.anthropic.com".into(),
            models: ["claude-haiku-4-5".into(), "claude-sonnet-5".into(), "claude-opus-5".into()],
            timeout_secs: 60,
            structured: true,
            reasoning: None,
        }
    }

    /// OpenAI 兼容接口的默认配置（模型名需由玩家填写）。
    pub fn openai_compatible_default() -> Self {
        ProviderConfig {
            kind: ProviderKind::OpenAiCompatible,
            base_url: "http://localhost:8080".into(),
            models: [String::new(), String::new(), String::new()],
            timeout_secs: 60,
            structured: true,
            reasoning: None,
        }
    }

    pub fn model(&self, tier: ModelTier) -> &str {
        &self.models[tier.index()]
    }
}

/// 一次生成请求。
#[derive(Clone, Debug)]
pub struct LlmRequest {
    pub system: String,
    pub user: String,
    pub max_tokens: u32,
    pub tier: ModelTier,
    /// 仅供 Mock 使用的结构化提示（真实提供商不会发送）
    pub hint: Option<serde_json::Value>,
}

/// 生成结果。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LlmResponse {
    /// 输出的 JSON 文字（结构化输出时为工具参数 / json_schema 内容）
    pub text: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    /// 是否来自结构化输出（工具调用或 json_schema）；否则为纯文本，需要解析与修复
    pub structured: bool,
}

/// 生成失败。
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum LlmError {
    #[error("未配置模型")]
    NoModel,
    #[error("请求超时")]
    Timeout,
    #[error("网络错误：{0}")]
    Network(String),
    #[error("服务返回错误 {status}：{message}")]
    Http { status: u16, message: String },
    #[error("响应格式无法识别：{0}")]
    BadResponse(String),
    #[error("模型拒绝了请求")]
    Refused,
    #[error("Mock 没有更多预设输出")]
    Exhausted,
}

/// 经 HTTP 调用的真实提供商。
pub struct HttpProvider {
    config: ProviderConfig,
    key: Secret,
    client: reqwest::Client,
}

impl HttpProvider {
    pub fn new(config: ProviderConfig, key: Secret) -> Result<Self, LlmError> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(config.timeout_secs.max(1)))
            .build()
            .map_err(|e| LlmError::Network(e.to_string()))?;
        Ok(Self { config, key, client })
    }

    pub fn config(&self) -> &ProviderConfig {
        &self.config
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.config.base_url.trim_end_matches('/'), path)
    }

    fn map_send_error(e: reqwest::Error) -> LlmError {
        if e.is_timeout() {
            LlmError::Timeout
        } else {
            // 只保留错误类别，不带请求细节
            LlmError::Network(if e.is_connect() { "无法连接".into() } else { "请求失败".into() })
        }
    }

    async fn read_error(resp: reqwest::Response) -> LlmError {
        let status = resp.status().as_u16();
        let body: serde_json::Value = resp.json().await.unwrap_or(serde_json::Value::Null);
        // Anthropic：{"type":"error","error":{"type":..,"message":..}}；OpenAI：{"error":{"message":..}}
        let message = body["error"]["message"].as_str().or(body["error"]["type"].as_str()).unwrap_or("").to_string();
        LlmError::Http { status, message: message.chars().take(200).collect() }
    }

    /// 纯文本生成（不要求结构化输出）。
    pub async fn complete(&self, req: &LlmRequest) -> Result<LlmResponse, LlmError> {
        self.complete_with(req, None).await
    }

    /// 生成；给出输出结构且配置开启了结构化输出时，用供应商侧的机制强制格式。
    /// 服务拒绝结构化参数（HTTP 400 / 422）时以纯文本重发一次。
    pub async fn complete_with(
        &self,
        req: &LlmRequest,
        schema: Option<&OutputSchema>,
    ) -> Result<LlmResponse, LlmError> {
        let model = self.config.model(req.tier).to_string();
        if model.is_empty() {
            return Err(LlmError::NoModel);
        }
        let schema = schema.filter(|_| self.config.structured);
        let mut result = self.dispatch(&model, req, schema).await;
        if schema.is_some() && matches!(result, Err(LlmError::Http { status: 400 | 422, .. })) {
            result = self.dispatch(&model, req, None).await;
        }
        // 服务端或模型可能回显密钥：返回前一律遮蔽，保证它进不了审计日志与存档
        match result {
            Ok(mut resp) => {
                resp.text = self.redact(&resp.text);
                Ok(resp)
            }
            Err(LlmError::Http { status, message }) => Err(LlmError::Http { status, message: self.redact(&message) }),
            Err(LlmError::BadResponse(m)) => Err(LlmError::BadResponse(self.redact(&m))),
            Err(LlmError::Network(m)) => Err(LlmError::Network(self.redact(&m))),
            Err(e) => Err(e),
        }
    }

    fn redact(&self, text: &str) -> String {
        let key = self.key.expose();
        if key.is_empty() { text.to_string() } else { text.replace(key, "***") }
    }

    async fn dispatch(
        &self,
        model: &str,
        req: &LlmRequest,
        schema: Option<&OutputSchema>,
    ) -> Result<LlmResponse, LlmError> {
        match self.config.kind {
            ProviderKind::Anthropic => self.complete_anthropic(model, req, schema).await,
            ProviderKind::OpenAiCompatible => self.complete_openai(model, req, schema).await,
        }
    }

    async fn complete_anthropic(
        &self,
        model: &str,
        req: &LlmRequest,
        schema: Option<&OutputSchema>,
    ) -> Result<LlmResponse, LlmError> {
        // 思考会占用输出预算：给足 max_tokens，并对支持 effort 的模型使用低强度（生成的是短 JSON）
        let mut body = serde_json::json!({
            "model": model,
            "max_tokens": (req.max_tokens.max(256) * 4).max(4_000),
            "system": req.system,
            "messages": [{"role": "user", "content": req.user}],
        });
        let supports_effort = !model.starts_with("claude-haiku");
        if supports_effort {
            body["output_config"] = serde_json::json!({"effort": "low"});
        }
        if let Some(s) = schema {
            body["tools"] = serde_json::json!([{
                "name": s.name,
                "description": s.description,
                "input_schema": s.schema,
            }]);
            if rejects_forced_tool(model) {
                // 这些模型不接受强制工具调用：改用 auto，并在系统提示中明确要求调用该工具
                body["tool_choice"] = serde_json::json!({"type": "auto"});
                body["system"] = serde_json::Value::from(format!(
                    "{}\n请调用工具 {} 提交结果，不要直接输出文字。",
                    req.system, s.name
                ));
            } else {
                body["tool_choice"] = serde_json::json!({"type": "tool", "name": s.name});
            }
        }
        let mut builder = self
            .client
            .post(self.url("/v1/messages"))
            .header("content-type", "application/json")
            .header("x-api-key", self.key.expose())
            .header("anthropic-version", "2023-06-01");
        // Opus 5 / Fable 5 系列：安全分类器拒绝时由服务端自动改用其他模型重试
        if model.starts_with("claude-opus-5") || model.starts_with("claude-fable-5") {
            body["fallbacks"] = serde_json::json!("default");
            builder = builder.header("anthropic-beta", "server-side-fallback-2026-07-01");
        }
        let resp = builder.json(&body).send().await.map_err(Self::map_send_error)?;
        if !resp.status().is_success() {
            return Err(Self::read_error(resp).await);
        }
        let v: serde_json::Value = resp.json().await.map_err(|e| LlmError::BadResponse(e.to_string()))?;
        let stop_reason = v["stop_reason"].as_str().unwrap_or("");
        if stop_reason == "refusal" {
            return Err(LlmError::Refused);
        }
        let blocks = v["content"].as_array().ok_or_else(|| LlmError::BadResponse("缺少 content".into()))?;
        let input_tokens = v["usage"]["input_tokens"].as_u64().unwrap_or(0);
        let output_tokens = v["usage"]["output_tokens"].as_u64().unwrap_or(0);
        // 结构化输出：调用了指定工具时 stop_reason 为 tool_use，取该 tool_use 块的 input；
        // 达到 max_tokens 时工具参数可能不完整，视为失败（由上层改用离线模板）；没有调用工具时退回读取文本
        if let Some(s) = schema {
            let block =
                blocks.iter().find(|b| b["type"].as_str() == Some("tool_use") && b["name"].as_str() == Some(&s.name));
            match (stop_reason, block) {
                ("tool_use", Some(block)) => {
                    let text =
                        serde_json::to_string(&block["input"]).map_err(|e| LlmError::BadResponse(e.to_string()))?;
                    return Ok(LlmResponse { text, input_tokens, output_tokens, structured: true });
                }
                ("max_tokens", _) => return Err(LlmError::BadResponse("输出达到 max_tokens，工具参数不完整".into())),
                _ => {}
            }
        }
        let text: String = blocks
            .iter()
            .filter(|b| b["type"].as_str() == Some("text"))
            .filter_map(|b| b["text"].as_str())
            .collect::<Vec<_>>()
            .join("");
        Ok(LlmResponse { text, input_tokens, output_tokens, structured: false })
    }

    async fn complete_openai(
        &self,
        model: &str,
        req: &LlmRequest,
        schema: Option<&OutputSchema>,
    ) -> Result<LlmResponse, LlmError> {
        let mut body = serde_json::json!({
            "model": model,
            "max_tokens": req.max_tokens.max(256),
            "temperature": 0.7,
            "messages": [
                {"role": "system", "content": req.system},
                {"role": "user", "content": req.user},
            ],
        });
        if let Some(s) = schema {
            body["response_format"] = serde_json::json!({
                "type": "json_schema",
                "json_schema": {"name": s.name, "description": s.description, "strict": true, "schema": s.schema},
            });
        }
        // 推理模型：指定推理强度（推理 token 也计入 max_tokens，强度低才不会挤掉正文），并去掉它不接受的 temperature
        if let Some(effort) =
            self.config.reasoning.as_ref().map(|r| r[req.tier.index()].trim()).filter(|e| !e.is_empty())
        {
            body["reasoning_effort"] = serde_json::json!(effort);
            if let Some(obj) = body.as_object_mut() {
                obj.remove("temperature");
            }
        }
        let resp = self
            .client
            .post(self.url("/v1/chat/completions"))
            .header("content-type", "application/json")
            .bearer_auth(self.key.expose())
            .json(&body)
            .send()
            .await
            .map_err(Self::map_send_error)?;
        if !resp.status().is_success() {
            return Err(Self::read_error(resp).await);
        }
        let v: serde_json::Value = resp.json().await.map_err(|e| LlmError::BadResponse(e.to_string()))?;
        let message = &v["choices"][0]["message"];
        // 严格模式下模型拒绝时返回 refusal 字段而不是内容
        if message["refusal"].as_str().is_some_and(|r| !r.is_empty()) {
            return Err(LlmError::Refused);
        }
        let text = message["content"]
            .as_str()
            .ok_or_else(|| LlmError::BadResponse("缺少 choices[0].message.content".into()))?
            .to_string();
        Ok(LlmResponse {
            text,
            input_tokens: v["usage"]["prompt_tokens"].as_u64().unwrap_or(0),
            output_tokens: v["usage"]["completion_tokens"].as_u64().unwrap_or(0),
            structured: schema.is_some(),
        })
    }
}

/// 不接受强制工具调用（`tool_choice` 为 `tool` / `any`）的 Anthropic 模型。
pub fn rejects_forced_tool(model: &str) -> bool {
    ["claude-opus-5-5", "claude-fable-5-1", "claude-mythos-5-1"].iter().any(|p| model.starts_with(p))
}

/// Mock LLM 的行为。
pub enum MockMode {
    /// 根据请求附带的结构化提示生成合理的提案（偶尔故意输出需要修复的格式）
    Plausible,
    /// 依次返回预设的原始文字（用于测试非法提案）
    Scripted(Mutex<VecDeque<String>>),
}

/// 测试与离线演示用的 Mock LLM；不访问网络，结果只取决于请求内容。
pub struct MockLlm {
    mode: MockMode,
}

impl MockLlm {
    pub fn plausible() -> Self {
        Self { mode: MockMode::Plausible }
    }

    pub fn scripted(outputs: Vec<String>) -> Self {
        Self { mode: MockMode::Scripted(Mutex::new(outputs.into())) }
    }

    pub fn complete(&self, req: &LlmRequest) -> Result<LlmResponse, LlmError> {
        let text = match &self.mode {
            MockMode::Plausible => {
                let body = req.hint.clone().unwrap_or(serde_json::Value::Null);
                let json = serde_json::to_string(&body).map_err(|e| LlmError::BadResponse(e.to_string()))?;
                // 按请求内容的哈希，约五分之一的回答包上说明文字与代码围栏，检验"自动修复"
                let h = blake3::hash(req.user.as_bytes());
                if h.as_bytes()[0].is_multiple_of(5) {
                    format!("好的，结果如下：\n```json\n{json}\n```")
                } else {
                    json
                }
            }
            MockMode::Scripted(queue) => {
                let mut q = queue.lock().map_err(|_| LlmError::Exhausted)?;
                q.pop_front().ok_or(LlmError::Exhausted)?
            }
        };
        let input_tokens = (req.system.chars().count() + req.user.chars().count()) as u64 / 2;
        let output_tokens = text.chars().count() as u64 / 2;
        Ok(LlmResponse { text, input_tokens, output_tokens, structured: false })
    }
}

/// 提供商。
pub enum Provider {
    Http(HttpProvider),
    Mock(MockLlm),
}

impl Provider {
    pub async fn complete(&self, req: &LlmRequest) -> Result<LlmResponse, LlmError> {
        self.complete_with(req, None).await
    }

    /// 生成；真实提供商在配置开启时使用结构化输出，Mock 忽略输出结构（只看请求附带的提示）。
    pub async fn complete_with(
        &self,
        req: &LlmRequest,
        schema: Option<&OutputSchema>,
    ) -> Result<LlmResponse, LlmError> {
        match self {
            Provider::Http(p) => p.complete_with(req, schema).await,
            Provider::Mock(m) => m.complete(req),
        }
    }

    /// 处理任务时是否会使用结构化输出。
    pub fn structured(&self) -> bool {
        match self {
            Provider::Http(p) => p.config().structured,
            Provider::Mock(_) => false,
        }
    }
}
