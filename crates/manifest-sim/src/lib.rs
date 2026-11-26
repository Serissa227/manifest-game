//! 游戏会话：把内核（与后续的 AI 管线）组装成可运行的游戏。

pub mod ai;
pub mod balance;
pub mod bots;
pub mod history_bot;
pub mod pacing_audit;
pub mod session;
pub mod stats;
pub mod storage;
pub mod story_bot;
pub mod upbringing_curve;
pub mod upbringing_runs;
pub mod upbringing_thresholds;

pub use ai::AiDriver;
pub use bots::{Bot, BotKind};
pub use session::GameSession;

use manifest_core::CoreError;
use manifest_data::DataError;

/// 会话层错误。
#[derive(Debug, thiserror::Error)]
pub enum SimError {
    #[error(transparent)]
    Core(#[from] CoreError),
    #[error(transparent)]
    Data(#[from] DataError),
    #[error("存档读写失败：{0}")]
    Storage(String),
    #[error("AI：{0}")]
    Ai(String),
}

// R10-U06K2：正式门槛与三策略成长表。
pub mod upbringing_act;
