//! 调用闸门：按现实时间限制真实模型的调用。
//!
//! 预算（[`crate::AiSettings`] 的每游戏月上限）按游戏时间计：高倍速下一个游戏月只有几秒，预算挡不住现实中的花费。
//! 多人共用一个服务端、调用按各人的额度计费时，另外按现实时间给每位玩家设一道闸门：
//! 滑动窗口内的调用次数或 token 数到了上限，这次改用离线模板（与预算用完时相同）。桌面版不设闸门。

use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// 调用闸门。
pub trait CallGate: Send + Sync {
    /// 准备发出一次真实调用：放行时记下这次调用并返回 true；返回 false 时改用离线模板。
    fn try_acquire(&self) -> bool;
    /// 记下一次调用实际消耗的 token（输入 + 输出）。
    fn record(&self, tokens: u64);
}

/// 滑动窗口闸门：`window` 内的调用次数不超过 `max_calls`，token 数不超过 `max_tokens`。
pub struct WindowGate {
    window: Duration,
    max_calls: u32,
    max_tokens: u64,
    state: Mutex<WindowState>,
}

#[derive(Default)]
struct WindowState {
    calls: VecDeque<Instant>,
    tokens: VecDeque<(Instant, u64)>,
}

/// 窗口内的用量。
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct GateUsage {
    pub calls: u32,
    pub tokens: u64,
}

impl WindowGate {
    pub fn new(window: Duration, max_calls: u32, max_tokens: u64) -> WindowGate {
        WindowGate { window, max_calls, max_tokens, state: Mutex::new(WindowState::default()) }
    }

    /// 窗口长度与上限（调用次数, token 数）。
    pub fn limits(&self) -> (Duration, u32, u64) {
        (self.window, self.max_calls, self.max_tokens)
    }

    /// 当前窗口内的用量。
    pub fn usage(&self) -> GateUsage {
        self.usage_at(Instant::now())
    }

    fn usage_at(&self, now: Instant) -> GateUsage {
        let Ok(mut s) = self.state.lock() else { return GateUsage::default() };
        s.prune(now, self.window);
        GateUsage { calls: u32::try_from(s.calls.len()).unwrap_or(u32::MAX), tokens: s.token_sum() }
    }

    fn try_acquire_at(&self, now: Instant) -> bool {
        let Ok(mut s) = self.state.lock() else { return false };
        s.prune(now, self.window);
        let calls = u32::try_from(s.calls.len()).unwrap_or(u32::MAX);
        if calls >= self.max_calls || s.token_sum() >= self.max_tokens {
            return false;
        }
        s.calls.push_back(now);
        true
    }

    fn record_at(&self, now: Instant, tokens: u64) {
        if let Ok(mut s) = self.state.lock() {
            s.tokens.push_back((now, tokens));
        }
    }
}

impl WindowState {
    fn prune(&mut self, now: Instant, window: Duration) {
        let fresh = |t: &Instant| now.duration_since(*t) < window;
        while self.calls.front().is_some_and(|t| !fresh(t)) {
            self.calls.pop_front();
        }
        while self.tokens.front().is_some_and(|(t, _)| !fresh(t)) {
            self.tokens.pop_front();
        }
    }

    fn token_sum(&self) -> u64 {
        self.tokens.iter().map(|(_, n)| *n).sum()
    }
}

impl CallGate for WindowGate {
    fn try_acquire(&self) -> bool {
        self.try_acquire_at(Instant::now())
    }

    fn record(&self, tokens: u64) {
        self.record_at(Instant::now(), tokens);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calls_are_limited_within_the_window_and_freed_after_it() {
        let gate = WindowGate::new(Duration::from_secs(60), 2, 1_000_000);
        let t0 = Instant::now();
        assert!(gate.try_acquire_at(t0));
        assert!(gate.try_acquire_at(t0 + Duration::from_secs(10)));
        assert!(!gate.try_acquire_at(t0 + Duration::from_secs(20)), "窗口内第三次调用应被挡下");
        assert_eq!(gate.usage_at(t0 + Duration::from_secs(20)).calls, 2);
        // 第一次调用滑出窗口后放行一次
        assert!(gate.try_acquire_at(t0 + Duration::from_secs(61)));
        assert!(!gate.try_acquire_at(t0 + Duration::from_secs(62)));
    }

    #[test]
    fn tokens_close_the_gate_until_they_leave_the_window() {
        let gate = WindowGate::new(Duration::from_secs(60), 100, 5_000);
        let t0 = Instant::now();
        assert!(gate.try_acquire_at(t0));
        gate.record_at(t0, 4_000);
        assert!(gate.try_acquire_at(t0 + Duration::from_secs(1)), "未到 token 上限时照常放行");
        gate.record_at(t0 + Duration::from_secs(1), 1_500);
        assert!(!gate.try_acquire_at(t0 + Duration::from_secs(2)), "token 用满后挡下");
        assert_eq!(gate.usage_at(t0 + Duration::from_secs(2)).tokens, 5_500);
        // 4000 的那一笔滑出窗口后剩 1500，重新放行
        assert!(gate.try_acquire_at(t0 + Duration::from_secs(60)));
    }
}
