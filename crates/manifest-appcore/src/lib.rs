//! Manifest 应用层：界面操作的处理函数、视图、设置、存档与 24 小时时钟。
//!
//! 桌面版（`manifest-app`，Tauri 2）与网页服务端（`manifest-server`）共用这一层；这里不依赖任何界面外壳，
//! 因此网页服务端可以在没有图形库的 Linux 上编译，测试也可以直接调用。
//!
//! - [`handlers`]：界面的全部操作，纯函数，只依赖 [`AppState`]（测试直接调用）。
//! - [`views`]：把世界状态整理成界面需要的结构。
//! - [`clock`]：24 小时时钟（只在应用层，不进世界状态）。
//! - [`Ticker`] / [`spawn_ticker`]：自动推进——按速度把实时折算成游戏分钟交给 [`handlers::advance_clock`]，
//!   走到 6:00 时推进一天，通过事件 `tick` 推送每日概览、事件 `clock` 推送时刻。

mod ai_text_view;
mod arcana_view;
pub mod auction_view;
pub mod captain_view;
pub mod cast_view;
pub mod clock;
pub mod codex_view;
mod creatures_view;
mod endings;
pub mod forecast;
pub mod handlers;
pub mod history_view;
pub mod items_view;
mod legend_ships_view;
pub mod navigation_view;
mod realms_view;
pub mod routing_view;
pub mod seafaring_view;
pub mod settings;
mod societies_view;
pub mod state;
pub mod story2_view;
pub mod story_log_view;
pub mod story_view;
pub mod upbringing_view;
pub mod view_cache;
pub mod views;
pub mod voyage_view;

pub use state::{AppHolder, AppPaths, AppState, Locales};

use serde::Serialize;
use std::time::Instant;

/// 应用层错误（返回给界面时序列化为文字）。
///
/// 显示文字：中文为各变体的原文；其他语言在返回界面前由 [`AppState::localize_error`] 按键与参数
/// 重新格式化为 [`AppError::Localized`]（英文见 `data/locales/en/texts.toml` 的 `[app]`、`[save]`、`[errors]`、`[reasons]`）。
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("尚未开始游戏")]
    NoGame,
    #[error("{0}")]
    Invalid(Msg),
    #[error("命令被拒绝：{0}")]
    Command(manifest_core::CommandError),
    #[error("数据错误：{0}")]
    Data(String),
    #[error("文件读写失败：{0}")]
    Io(String),
    #[error("密钥存储：{0}")]
    Key(String),
    #[error("存档：{0}")]
    Save(Msg),
    #[error("内部状态损坏")]
    Poisoned,
    /// 已按界面语言格式化好的文字
    #[error("{0}")]
    Localized(String),
}

/// 应用层的一条提示：中文原文 + 键与参数（键为 `data/texts.toml` 中的“小节.键”，如 `app.slot`、`save.read`）。
/// 没有键的提示（如内核给出的内部原因）在各语言下都显示原文。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Msg {
    pub key: &'static str,
    pub args: Vec<(&'static str, String)>,
    pub zh: String,
}

impl Msg {
    pub fn new(key: &'static str, zh: impl Into<String>) -> Msg {
        Msg { key, args: Vec::new(), zh: zh.into() }
    }

    pub fn arg(mut self, name: &'static str, value: impl Into<String>) -> Msg {
        self.args.push((name, value.into()));
        self
    }
}

impl From<String> for Msg {
    fn from(zh: String) -> Msg {
        Msg { key: "", args: Vec::new(), zh }
    }
}

impl std::fmt::Display for Msg {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.zh)
    }
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

/// 自动推进的节拍（EXPANSION.md §9.2）：按当前速度把一段实时折算成游戏分钟（1× 每天 4 秒 … 32× 每天 0.125 秒），
/// 交给 [`handlers::advance_clock`]；时钟走到 6:00 时推进一天并推送 `tick` 概览，每隔 ≥ [`clock::EMIT_INTERVAL`]
/// （实时）推送一次 `clock` 事件 `{ day, minute }`。桌面的后台线程与网页服务端的调度循环共用。
pub struct Ticker {
    pace: clock::Pace,
    last: Instant,
    last_emit: Option<Instant>,
    day_ms: u64,
}

impl Ticker {
    pub fn new(now: Instant) -> Ticker {
        Ticker { pace: clock::Pace::default(), last: now, last_emit: None, day_ms: 0 }
    }

    /// 暂停中：清掉不足一分钟的余数，下一次推进从 `now` 起算。
    pub fn idle(&mut self, now: Instant) {
        self.pace.reset();
        self.last = now;
    }

    /// 走一小步：把上一次以来的实时折算成游戏分钟并推进。暂停或没有游戏时等同 [`Ticker::idle`]，返回 false。
    /// 推进失败时暂停游戏，并把原因（按界面语言）推送给界面。
    pub fn step(&mut self, st: &AppState, now: Instant) -> bool {
        let speed = handlers::current_speed(st);
        if speed == 0 {
            // 因为有事要玩家回应而自动停下的，回应完自动按原倍速继续（下一小步起推进）
            handlers::auto_resume(st);
            self.idle(now);
            return false;
        }
        if let Some(first) = handlers::upbringing_turbo(st) {
            self.turbo(st, now, first);
            return true;
        }
        let day_ms = handlers::current_day_ms(st);
        if self.day_ms != day_ms {
            self.pace.reset();
            self.day_ms = day_ms;
        }
        let minutes = self.pace.minutes_ms(day_ms, now.duration_since(self.last));
        self.last = now;
        if minutes == 0 {
            return true;
        }
        match handlers::advance_clock(st, minutes) {
            Ok(Some(step)) => {
                if self.last_emit.is_none_or(|t| now.duration_since(t) >= clock::EMIT_INTERVAL) {
                    handlers::emit_clock(st, &step);
                    self.last_emit = Some(now);
                }
            }
            Ok(None) => {}
            Err(e) => {
                let _ = handlers::set_speed(st, 0);
                st.emit("error", serde_json::Value::String(st.localize_error(e).to_string()));
            }
        }
        true
    }

    /// 养成期执行月计划：不按倍速，一次推进一整天，直到用完本步的实时预算 [`TURBO_BUDGET`]（至少一天）
    /// 或计划走完、遇到剧情要等玩家。每天之间释放锁，别的请求与（网页版）别的玩家不被长时间挡住。
    fn turbo(&mut self, st: &AppState, now: Instant, first: u32) {
        self.pace.reset();
        let mut minutes = first;
        let mut last = None;
        loop {
            match handlers::advance_clock(st, minutes) {
                Ok(Some(step)) => last = Some(step),
                Ok(None) => break,
                Err(e) => {
                    let _ = handlers::set_speed(st, 0);
                    st.emit("error", serde_json::Value::String(st.localize_error(e).to_string()));
                    break;
                }
            }
            if now.elapsed() >= TURBO_BUDGET {
                break;
            }
            match handlers::upbringing_turbo(st) {
                Some(m) => minutes = m,
                None => break,
            }
        }
        if let Some(step) = last {
            handlers::emit_clock(st, &step);
            self.last_emit = Some(Instant::now());
        }
        self.last = Instant::now();
    }
}

/// 养成快进时每一小步的实时预算：一天的结算比它慢时每步推进一天，快时一步推进几天。
pub const TURBO_BUDGET: std::time::Duration = std::time::Duration::from_millis(150);

/// 自动推进：后台线程每 [`clock::STEP`] 走一小步（见 [`Ticker`]）；暂停时每 [`clock::IDLE`] 查看一次速度，时钟不走。
/// 暂停时也看一眼：因为有事要玩家回应而自动停下的，回应完按原倍速继续（[`handlers::auto_resume`]，与网页服务端的调度循环一致）。
pub fn spawn_ticker(st: AppState) {
    std::thread::spawn(move || {
        let mut ticker = Ticker::new(Instant::now());
        loop {
            if handlers::current_speed(&st) == 0 {
                handlers::auto_resume(&st);
                ticker.idle(Instant::now());
                std::thread::sleep(clock::IDLE);
                ticker.idle(Instant::now());
                continue;
            }
            std::thread::sleep(clock::STEP);
            ticker.step(&st, Instant::now());
        }
    });
}

#[cfg(test)]
mod fantasy_view_tests;

pub mod quest_view;

/// 两个外壳共用的置顶命令，沿用已有提交、重放与概览流程。
pub fn pin_quest(st: &AppState, id: Option<String>) -> Result<views::Overview, AppError> {
    handlers::submit(st, manifest_core::Command::PinQuest { owner: manifest_core::OwnerId::Player, id })
        .map(|r| r.overview)
}

pub mod navigation_dests;
