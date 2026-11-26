//! 账号配额跨管线、世界与进程重载保留；并发预留不能透支。
use manifest_ai::account_budget::AccountBudget;
use manifest_core::calendar::Calendar;
use std::{
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
};
struct Dir(PathBuf);
impl Dir {
    fn new() -> Self {
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "manifest-ai-budget-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }
}
impl Drop for Dir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
#[test]
fn changing_world_calendar_and_reloading_does_not_refill_the_account() {
    let dir = Dir::new();
    let path = dir.0.join("budget.json");
    let calendar = Calendar::default();
    let account = AccountBudget::load(path.clone()).unwrap();
    let first = account.bind().unwrap();
    let ticket = account.reserve(first, 29, &calendar, (2, 1000), 700).unwrap();
    account.record(ticket, 400);
    let other = account.bind().unwrap();
    let other_calendar = Calendar::new(
        vec![31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31],
        vec![0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3],
        "公历".into(),
        Vec::new(),
    )
    .unwrap();
    assert_eq!(account.status(other, 20000, &other_calendar, (2, 1000)).calls_used, 1);
    assert_eq!(account.status(other, 20000, &other_calendar, (2, 1000)).month, other_calendar.month_index(20000));
    let ticket = account.reserve(other, 20000, &other_calendar, (2, 1000), 500).unwrap();
    account.record(ticket, 200);
    assert!(account.reserve(first, 30, &calendar, (2, 1000), 0).is_none());
    assert!(account.reserve(other, 20000, &other_calendar, (2, 1000), 0).is_none());
    drop(account);
    let loaded = AccountBudget::load(path).unwrap();
    let binding = loaded.bind().unwrap();
    let b = loaded.status(binding, 0, &calendar, (2, 1000));
    assert_eq!((b.calls_used, b.tokens_used), (2, 600));
    assert!(loaded.reserve(binding, 0, &calendar, (2, 1000), 0).is_none());
    // 初次计费时只剩一天，换局不重置这一天；实际推进一天后才能进入下一期。
    assert!(loaded.reserve(binding, 1, &calendar, (2, 1000), 100).is_some());
    assert_eq!(loaded.status(binding, 1, &calendar, (2, 1000)).month, calendar.month_index(1));
}
#[test]
fn simultaneous_calls_reserve_tokens_before_any_response_arrives() {
    let account = Arc::new(AccountBudget::default());
    let binding = account.bind().unwrap();
    let workers: Vec<_> = (0..16)
        .map(|_| {
            let a = account.clone();
            std::thread::spawn(move || a.reserve(binding, 0, &Calendar::default(), (100, 1000), 700).is_some())
        })
        .collect();
    let admitted = workers.into_iter().map(|t| t.join().unwrap()).filter(|accepted| *accepted).count();
    assert_eq!(admitted, 1);
    assert_eq!(account.status(binding, 0, &Calendar::default(), (100, 1000)).tokens_used, 700);
}
#[test]
fn late_usage_cannot_refund_the_next_period_and_corruption_fails_closed() {
    let calendar = Calendar::default();
    let a = AccountBudget::default();
    let b = a.bind().unwrap();
    let old = a.reserve(b, 0, &calendar, (10, 1000), 700).unwrap();
    assert!(a.reserve(b, 30, &calendar, (10, 1000), 800).is_some());
    a.record(old, 1);
    assert_eq!(a.status(b, 30, &calendar, (10, 1000)).tokens_used, 800);
    let dir = Dir::new();
    let path = dir.0.join("bad.json");
    std::fs::write(&path, "invalid").unwrap();
    assert!(AccountBudget::load(path.clone()).is_err());
    let a = AccountBudget::load_or_blocked(path);
    let b = a.bind().unwrap();
    assert!(a.reserve(b, 0, &calendar, (10, 1000), 1).is_none());
    assert_eq!(a.status(b, 0, &calendar, (10, 1000)).calls_used, 10);
}

#[test]
fn usage_write_failure_blocks_later_remote_admission_even_after_storage_recovers() {
    let dir = Dir::new();
    let path = dir.0.join("budget.json");
    let a = AccountBudget::load(path.clone()).unwrap();
    let b = a.bind().unwrap();
    let calendar = Calendar::default();
    let ticket = a.reserve(b, 0, &calendar, (10, 1000), 700).unwrap();
    // 以目录占住临时文件名，准确模拟结算写盘失败；不依赖操作系统权限策略。
    let pending = path.with_extension("pending");
    std::fs::create_dir(&pending).unwrap();
    a.record(ticket, 800);
    std::fs::remove_dir(&pending).unwrap();
    assert!(a.reserve(b, 0, &calendar, (10, 1000), 1).is_none());
    assert_eq!(a.status(b, 0, &calendar, (10, 1000)).tokens_used, 1000);
}
