//! 账号共享的游戏月账本。重建管线只换时钟锚点，不清空额度；异步结果凭期间票据结算。
use crate::pipeline::BudgetStatus;
use manifest_core::calendar::Calendar;
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
struct Ledger {
    period: u32,
    calls: u32,
    tokens: u64,
    remaining: Option<u32>,
    #[serde(skip)]
    binding: u64,
    #[serde(skip)]
    day: Option<u32>,
}

#[derive(Debug)]
pub struct Ticket {
    period: u32,
    reserved: u64,
}

pub struct AccountBudget {
    ledger: Mutex<Ledger>,
    path: Option<PathBuf>,
    blocked: AtomicBool,
}

impl Default for AccountBudget {
    fn default() -> Self {
        Self { ledger: Mutex::new(Ledger::default()), path: None, blocked: AtomicBool::new(false) }
    }
}

impl AccountBudget {
    pub fn load(path: PathBuf) -> std::io::Result<Self> {
        let ledger = match std::fs::read(&path) {
            Ok(bytes) => serde_json::from_slice::<Ledger>(&bytes).map_err(std::io::Error::other)?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ledger::default(),
            Err(e) => return Err(e),
        };
        if ledger.remaining == Some(0) {
            return Err(std::io::Error::other("invalid AI budget period"));
        }
        Ok(Self { ledger: Mutex::new(ledger), path: Some(path), blocked: AtomicBool::new(false) })
    }
    /// 账本损坏时关闭远程准入，不能通过把文件清空来重新获得额度。
    pub fn load_or_blocked(path: PathBuf) -> Self {
        Self::load(path).unwrap_or_else(|_| Self { blocked: AtomicBool::new(true), ..Self::default() })
    }
    fn persist(&self, ledger: &Ledger) -> bool {
        if self.blocked.load(Ordering::Acquire) {
            return false;
        }
        let Some(path) = &self.path else { return true };
        let Ok(bytes) = serde_json::to_vec(ledger) else {
            return false;
        };
        // 在同一目录先同步临时文件，再替换账本；写盘失败时不准许远程请求。
        let save = || -> std::io::Result<()> {
            use std::io::Write;
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let temp = path.with_extension("pending");
            let mut file = std::fs::File::create(&temp)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
            drop(file);
            std::fs::rename(temp, path)
        };
        let saved = save().is_ok();
        if !saved {
            self.blocked.store(true, Ordering::Release);
        }
        saved
    }
    pub fn bind(&self) -> Option<u64> {
        let mut ledger = self.ledger.lock().ok()?;
        ledger.binding = ledger.binding.checked_add(1)?;
        ledger.day = None;
        Some(ledger.binding)
    }
    fn advance(ledger: &mut Ledger, binding: u64, day: u32, calendar: &Calendar) -> bool {
        if ledger.binding != binding {
            return false;
        }
        let previous = ledger.day.unwrap_or(day);
        if day < previous {
            return false;
        }
        let mut delta = day - previous;
        let mut cursor = previous;
        let mut remaining = ledger
            .remaining
            .unwrap_or_else(|| calendar.month_days(day).saturating_sub(calendar.date_of(day).day - 1).max(1));
        while delta >= remaining {
            delta -= remaining;
            cursor = cursor.saturating_add(remaining);
            ledger.period = ledger.period.saturating_add(1);
            ledger.calls = 0;
            ledger.tokens = 0;
            remaining = calendar.month_days(cursor).max(1);
        }
        ledger.remaining = Some(remaining - delta);
        ledger.day = Some(day);
        true
    }
    pub fn status(&self, binding: u64, day: u32, calendar: &Calendar, limits: (u32, u64)) -> BudgetStatus {
        let Ok(mut ledger) = self.ledger.lock() else {
            return BudgetStatus {
                calls_used: limits.0,
                tokens_used: limits.1,
                calls_limit: limits.0,
                tokens_limit: limits.1,
                ..Default::default()
            };
        };
        let before = (ledger.period, ledger.calls, ledger.tokens, ledger.remaining);
        let advanced = Self::advance(&mut ledger, binding, day, calendar);
        let after = (ledger.period, ledger.calls, ledger.tokens, ledger.remaining);
        let saved = !self.blocked.load(Ordering::Acquire) && advanced && (before == after || self.persist(&ledger));
        BudgetStatus {
            // 对外保留世界月份索引；账号期间票据仅在账本内部使用。
            month: calendar.month_index(day),
            calls_used: if saved { ledger.calls } else { limits.0 },
            tokens_used: if saved { ledger.tokens } else { limits.1 },
            calls_limit: limits.0,
            tokens_limit: limits.1,
        }
    }
    pub fn reserve(
        &self,
        binding: u64,
        day: u32,
        calendar: &Calendar,
        limits: (u32, u64),
        tokens: u64,
    ) -> Option<Ticket> {
        let mut ledger = self.ledger.lock().ok()?;
        if !Self::advance(&mut ledger, binding, day, calendar)
            || ledger.calls >= limits.0
            || ledger.tokens >= limits.1
            || ledger.tokens.checked_add(tokens).is_none_or(|total| total > limits.1)
        {
            return None;
        }
        ledger.calls += 1;
        ledger.tokens += tokens;
        if !self.persist(&ledger) {
            return None;
        }
        Some(Ticket { period: ledger.period, reserved: tokens })
    }
    pub fn record(&self, ticket: Ticket, actual: u64) {
        let Ok(mut ledger) = self.ledger.lock() else {
            return;
        };
        if ledger.period != ticket.period {
            return;
        }
        ledger.tokens = ledger.tokens.saturating_sub(ticket.reserved).saturating_add(actual);
        self.persist(&ledger);
    }
}
