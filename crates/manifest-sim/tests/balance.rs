//! 平衡测试工具本身：报告只取决于种子与数据（与线程数、运行次数无关），判定项齐全。

mod common;

use manifest_core::info::InfoMode;
use manifest_sim::balance::{Thresholds, judge, report, run_all};

#[test]
fn balance_report_is_deterministic_and_complete() {
    let defs = common::defs();
    // 平衡测试默认按新游戏的默认（随船传递：bot 与商会都只用自己知道的行情）
    let a = run_all(defs.clone(), 2, 1, 1, InfoMode::Carried).unwrap();
    let b = run_all(defs.clone(), 2, 1, 4, InfoMode::Carried).unwrap();
    assert_eq!(a.len(), 8, "2 个种子 × 4 种 bot");
    let ra = report(&defs, &a, &judge(&defs, &a, &Thresholds::default(), 1.0), 2, 1, InfoMode::Carried);
    let rb = report(&defs, &b, &judge(&defs, &b, &Thresholds::default(), 1.0), 2, 1, InfoMode::Carried);
    assert_eq!(ra, rb, "报告与线程数无关");
    let verdicts = judge(&defs, &a, &Thresholds::default(), 1.0);
    assert_eq!(verdicts.len(), 7);
    // 只跑 1 年时，市场从开局状态走向均衡的过程占主导（物价指数第一年约上升 20%），
    // 年化变化这一项在短期内不适用；其余各项都应通过
    let (price, rest) = verdicts.split_first().unwrap();
    assert_eq!(price.name, "物价指数年化变化");
    assert!(rest.iter().all(|v| v.pass), "{verdicts:?}");
    assert!(ra.contains("平衡检查"));
    assert!(ra.contains("行情情报随船传递"), "报告写明行情情报");
    // 超时或超出阈值时判定为未通过
    let slow = judge(&defs, &a, &Thresholds::default(), 500.0);
    assert!(slow.iter().any(|v| !v.pass));
    let strict = Thresholds { arbitrage_growth: 0.5, ..Thresholds::default() };
    assert!(!judge(&defs, &a, &strict, 1.0).iter().all(|v| v.pass));
    assert!(a.iter().all(|r| r.money_conserved && r.index.len() == 2));
}
