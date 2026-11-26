//! U04 验收（审查补写）：九位主角按自动安排跑完整个养成期。
//!
//! - 比赛：均衡玩法、每两场新开放的比赛报名一场，多个种子合计，养成期里“每年至少赢一次”的年份 ≥ 50%；
//! - 结局：九位主角 × 六个预设，结局不再集中在同一个上（打印分布表）。
//!
//! 跑法见 `manifest_sim::upbringing_runs`（与 `manifest-cli upbringing-runs` 同一套）。
use manifest_sim::upbringing_runs::{RunConfig, RunReport, run_many, years_with_win};
use std::collections::BTreeMap;
use std::sync::Arc;

const HEROES: [&str; 9] = ["mio", "lieve", "najma", "lin_wandeng", "ix_nikte", "noel", "tariq", "kaicili", "baraka"];
const PRESETS: [&str; 6] = ["balanced", "navigation", "trade", "combat", "learning", "social"];

fn defs() -> Arc<manifest_core::StaticData> {
    manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "terra16").unwrap()
}

fn threads() -> usize {
    std::thread::available_parallelism().map_or(4, |n| n.get()).min(16)
}

fn runs(presets: &[&str], seeds: &[u64]) -> Vec<RunReport> {
    let mut configs = Vec::new();
    for seed in seeds {
        for preset in presets {
            for family in HEROES {
                configs.push(RunConfig {
                    family: family.into(),
                    preset: (*preset).into(),
                    seed: *seed,
                    register_every: 2,
                });
            }
        }
    }
    let reports = run_many(defs(), &configs, threads());
    for r in &reports {
        assert!(r.errors.is_empty(), "{}/{}/{}：{:?}", r.family, r.preset, r.seed, r.errors);
        assert!(r.graduated, "{}/{}/{}：没有结业，停在 {:?}", r.family, r.preset, r.seed, r.end);
    }
    reports
}

/// 结局的类别：本家保底（00）、本家志向结局（09–11）、通用结局。
fn category(ending: &str) -> &'static str {
    if !ending.starts_with("c9_") {
        "通用"
    } else if ending.ends_with("_ending_00") {
        "本家保底"
    } else {
        "本家志向"
    }
}

#[test]
fn balanced_play_registering_half_the_contests_wins_at_least_once_in_most_years() {
    let reports = runs(&["balanced"], &[7, 42, 99]);
    let (won, years) = years_with_win(&reports);
    for r in &reports {
        let entered = r.contests.len();
        let first = r.contests.iter().filter(|c| c.rank == 1).count();
        println!(
            "{}/{}：开放 {} 场，参加 {entered}，第一 {first}，逐年 {:?}",
            r.family,
            r.seed,
            r.offered,
            r.by_year()
        );
    }
    println!("每年至少赢一次：{won}/{years}");
    assert!(won * 2 >= years, "均衡、报名一半：每年至少赢一次的年份只有 {won}/{years}");
}

#[test]
fn nine_heroes_with_different_presets_do_not_share_one_ending() {
    let reports = runs(&PRESETS, &[7]);
    let mut table = BTreeMap::<String, u32>::new();
    let mut categories = BTreeMap::<&str, u32>::new();
    for r in &reports {
        let ending = r.ending.clone().unwrap_or_else(|| "-".into());
        println!("{:<12} {:<10} 志向 {:<20} 结局 {ending}", r.family, r.preset, r.path.as_deref().unwrap_or("-"));
        *table.entry(ending.clone()).or_default() += 1;
        *categories.entry(category(&ending)).or_default() += 1;
    }
    println!("结局分布：{table:?}");
    println!("按类别：{categories:?}");
    let total = reports.len() as u32;
    // 改前：同一个通用结局“无人知晓的诗人”占 19/54；再往前是四位里三位落在“第 8 条支线”。
    let (top, most) = table.iter().max_by_key(|(_, n)| **n).map(|(k, n)| (k.clone(), *n)).unwrap();
    assert!(most * 4 <= total, "{most}/{total} 局落在同一个结局 {top}：{table:?}");
    assert!(table.len() >= 12, "54 局只有 {} 种结局：{table:?}", table.len());
    // 志向决定主结局，但没选到有专属结局的志向时，通用结局与本家保底仍然出现。
    assert!(categories.get("通用").copied().unwrap_or(0) >= 3, "{categories:?}");
    assert!(categories.get("本家保底").copied().unwrap_or(0) >= 1, "{categories:?}");
    // 每位主角换预设，结局至少有两种。
    for hero in HEROES {
        let mine: std::collections::BTreeSet<_> =
            reports.iter().filter(|r| r.family == hero).map(|r| r.ending.clone()).collect();
        assert!(mine.len() >= 2, "{hero}：六个预设都落在 {mine:?}");
    }
    // 选了志向、而这条志向有专属结局（09–11）的，主结局就是它：支线与通用结局不再盖过志向。
    let defs = defs();
    for r in &reports {
        let Some(path) = &r.path else { continue };
        let own = defs.upbringing.endings.iter().find(|e| {
            e.family.as_deref() == Some(r.family.as_str())
                && !e.supplementary
                && e.weights.aspirations.contains_key(path)
                && e.requirements.all.iter().any(|q| q.aspiration.as_deref() == Some(path.as_str()))
                && e.requirements.all.iter().all(|q| q.flag.is_none())
        });
        if let Some(own) = own {
            assert_eq!(r.ending.as_deref(), Some(own.key.as_str()), "{}/{} 选了 {path}", r.family, r.preset);
        }
    }
}
