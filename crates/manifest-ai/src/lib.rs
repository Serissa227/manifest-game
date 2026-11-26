//! AI 管线：LLM 提案 → 裁决（Jev 或规则）→ 内核校验 → 命令。
//!
//! LLM 永远不直接修改世界状态：它只输出结构化提案，提案经裁决与内核校验后才转为命令，
//! 由游戏会话排到未来的 tick 并写入命令日志。重放与读档只读日志，从不重新调用 LLM。

pub mod account_budget;
pub mod adjudicator;
pub mod gate;
pub mod offline;
pub mod parse;
pub mod pipeline;
pub mod proposal;
pub mod provider;
pub mod resolve;
pub mod schema;
pub mod secret;

pub use adjudicator::{AdjudicationContext, Adjudicator, Decision, JevConfig, RuleAdjudicator, Verdict};
pub use gate::{CallGate, GateUsage, WindowGate};
pub use pipeline::{AiMode, AiOutcome, AiPipeline, AiSettings, AiTask, AuditEntry, BudgetStatus, TaskRequest};
pub use proposal::{ComposedEffectRaw, ComposedEventProposal, Proposal};
pub use provider::{
    HttpProvider, LlmError, LlmRequest, LlmResponse, MockLlm, ModelTier, Provider, ProviderConfig, ProviderKind,
};
pub use schema::{OutputSchema, output_schema};
pub use secret::{KeyStore, KeyringStore, MemoryKeyStore, Secret};
