//! S01：寰宇出海后的奇遇——整局跑法里的验收（真实数据，跑法与 `manifest-cli pacing-audit` 相同）。
//!
//! - 养成期一条奇遇都不出（林晚灯一整局，四年）；结业后接着出海、自由航海两段都遇得到；
//! - 奇遇守自己的规矩：相邻两次至少隔 `gap_days` 天；出场的那个早上没有别的事同时出场（单日不叠）；
//!   一年内同一条不重复；每一件都被跑法答掉了（没有一条因为选项交不上被清掉）；
//! - 同种子两次结果相同，换一颗种子不同；
//! - 林晚灯五条同窗羁绊线的第一章都出了场（把地点从月港改到漳州城之前，一章也不出）。
//!
//! 每条奇遇、每个选项的结算与出场条件的可达判定是枚举式的，在 `manifest-data --test terra16_encounters_s01`。
use manifest_core::pacing::{BeatSource, BeatWeight};
use manifest_sim::pacing_audit::{AuditConfig, BeatRecord, Report, RunAudit, audit, audit_free_sea};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, OnceLock};

const SEA_DAYS: u32 = 150;

fn defs() -> Arc<manifest_core::StaticData> {
    static DEFS: OnceLock<Arc<manifest_core::StaticData>> = OnceLock::new();
    DEFS.get_or_init(|| manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "terra16").unwrap()).clone()
}

/// 林晚灯一整局养成，结业后出海 150 天；外加自由航海 150 天。全文件共用这一份。
fn report() -> &'static Report {
    static REPORT: OnceLock<Report> = OnceLock::new();
    REPORT.get_or_init(|| {
        audit(
            defs(),
            &AuditConfig {
                families: vec!["lin_wandeng".into()],
                presets: vec!["balanced".into()],
                seeds: vec![7],
                register_every: 2,
                threads: 2,
                sea_days: SEA_DAYS,
            },
        )
    })
}

/// 旧式剧情里的奇遇：来源是奇遇、没有章节（story2 的短事件轨道带章节）。
fn is_encounter(b: &BeatRecord) -> bool {
    b.beat.source == BeatSource::Encounter && b.beat.chapter.is_none()
}

fn encounters(run: &RunAudit) -> Vec<&BeatRecord> {
    run.beats().iter().filter(|b| is_encounter(b)).collect()
}

/// 一局出海段里的奇遇守不守规矩。
fn check_sea(label: &str, run: &RunAudit) {
    let d = defs();
    let rules = &d.stories.rules;
    let met = encounters(run);
    assert!(run.finished && run.errors.is_empty(), "{label}：{:?}", run.errors);
    assert!(!met.is_empty(), "{label}：{SEA_DAYS} 天里一件奇遇也没有");
    for b in &met {
        assert_eq!(b.beat.weight, BeatWeight::Minor, "{label}：奇遇是可以等的小事");
        assert!(d.stories.encounter(&b.beat.key).is_some(), "{label}：不认识的奇遇 {}", b.beat.key);
        assert_eq!(b.held_days, None, "{label}：奇遇不会被按着");
    }
    // 相邻两次至少隔 gap_days 天；任意七天里（连同别的可以等的事）不超过窗口上限。
    for pair in met.windows(2) {
        assert!(
            pair[1].day - pair[0].day >= rules.gap_days,
            "{label}：{} 与 {} 只隔 {} 天",
            pair[0].beat.key,
            pair[1].beat.key,
            pair[1].day - pair[0].day
        );
    }
    // 单日不叠：奇遇是那天最后一个排定的——它出场时，当天没有任何别的事已经出场。
    // 审计按出现的先后记账；同一天里排在奇遇前面的独立打断应当一件也没有。
    let mut by_day: BTreeMap<u32, Vec<&BeatRecord>> = BTreeMap::new();
    for b in run.beats() {
        by_day.entry(b.day).or_default().push(b);
    }
    for (day, beats) in &by_day {
        let Some(at) = beats.iter().position(|b| is_encounter(b)) else { continue };
        assert_eq!(beats.iter().filter(|b| is_encounter(b)).count(), 1, "{label}：第 {day} 天出了两件奇遇");
        let earlier: Vec<&str> = beats[..at]
            .iter()
            .filter(|b| !matches!(b.beat.source, BeatSource::Plan | BeatSource::Continuation))
            .map(|b| b.beat.key.as_str())
            .collect();
        // 排在前面的只可能是前几天出场、今天才头一回被看见的旧事（船回到了它所在的港）；今天新出场的不行。
        for key in earlier {
            let fresh = beats[..at].iter().any(|b| b.beat.key == key && b.beat.since >= *day);
            assert!(!fresh, "{label}：第 {day} 天 {key} 与奇遇同一个早上出场");
        }
    }
    // 一年内同一条不重复（150 天里每条至多一次）。
    let keys: BTreeSet<&str> = met.iter().map(|b| b.beat.key.as_str()).collect();
    assert_eq!(keys.len(), met.len(), "{label}：同一条奇遇重复出现");
    // 频率落在“每月几件”的量级：150 天里至少 4 件，至多每 gap_days + 1 天一件。
    assert!(met.len() >= 4, "{label}：只有 {} 件", met.len());
    assert!(met.len() as u32 <= SEA_DAYS / rules.gap_days.max(1) + 1, "{label}：{} 件", met.len());
}

#[test]
fn upbringing_never_meets_an_encounter_and_the_sea_does() {
    let r = report();
    assert_eq!(r.upbringing.runs.len(), 1);
    let up = &r.upbringing.runs[0];
    assert!(up.finished && up.errors.is_empty(), "{:?}", up.errors);
    assert!(up.stats.days > 1_400, "养成整局约四年，实际 {} 天", up.stats.days);
    // 养成期：旧式剧情的奇遇一件也没有；跑法也没有清掉过旧式剧情。
    assert_eq!(
        encounters(up).len(),
        0,
        "养成期出了奇遇：{:?}",
        encounters(up).iter().map(|b| &b.beat.key).collect::<Vec<_>>()
    );
    assert_eq!(r.upbringing.flow.cleared, 0);
    // 出海两段：都遇得到，都被答掉了。
    let after = r.sea_after.as_ref().expect("结业后出海");
    let free = r.sea_free.as_ref().expect("自由航海");
    for (label, section) in [("结业后", after), ("自由航海", free)] {
        assert_eq!(section.runs.len(), 1, "{label}");
        assert_eq!(section.flow.cleared, 0, "{label}：有奇遇一个选项也交不上");
        assert_eq!((section.flow.stalls, section.flow.diverged, section.flow.failed), (0, 0, 0), "{label}");
        check_sea(label, &section.runs[0]);
        // 闸的账与审计的账逐日对得上；没有该放没放的。
        let gate = section.gate.as_ref().expect("寰宇开着节奏规则");
        assert_eq!((gate.mismatch_days, gate.violations), (0, 0), "{label}");
    }
    // 海上的与港口的都遇到过。遇到哪一种跟着船在哪里：这颗种子的自由航海里，套利 bot 头 150 天几乎都停在港里
    // （遇到的全是港口的），结业后那一段的船多半在海上（遇到的多是海上的）——所以这里看两段合起来，不看单独哪一段。
    // “海上的只在海上出、港口的只在港里出”由内核按舰队所在挑候选保证，逐条的出场条件见 manifest-data 的同名测试。
    let free_keys: Vec<&str> = encounters(&free.runs[0]).iter().map(|b| b.beat.key.as_str()).collect();
    let after_keys: Vec<&str> = encounters(&after.runs[0]).iter().map(|b| b.beat.key.as_str()).collect();
    eprintln!("自由航海 {SEA_DAYS} 天遇到的奇遇：{free_keys:?}");
    eprintln!("结业后 {SEA_DAYS} 天遇到的奇遇：{after_keys:?}");
    let both: Vec<&str> = free_keys.iter().chain(&after_keys).copied().collect();
    assert!(both.iter().any(|k| k.starts_with("sea_")), "两段出海都没有遇到海上的奇遇：{both:?}");
    assert!(both.iter().any(|k| k.starts_with("port_")), "两段出海都没有遇到港口的奇遇：{both:?}");
}

#[test]
fn lin_wandengs_five_classmate_bonds_open_in_the_academy() {
    let up = &report().upbringing.runs[0];
    let opened: BTreeSet<&str> =
        up.beats().iter().filter(|b| b.beat.chapter.as_deref() == Some("c1")).map(|b| b.beat.key.as_str()).collect();
    for bond in ["bond_chen_dong", "bond_huang_dun", "bond_xiao_man", "bond_xu_cai", "bond_zhou_yan"] {
        assert!(opened.contains(bond), "{bond} 的第一章没有出场；出场的 c1：{opened:?}");
        let b = up.beats().iter().find(|b| b.beat.key == bond && b.beat.chapter.as_deref() == Some("c1")).unwrap();
        // 窗口 1554-01-01 至 04-30，入学（1 月 10 日）以后才可能。
        assert!(b.date >= [1554, 1, 10] && b.date <= [1554, 4, 30], "{bond}：{:?}", b.date);
    }
}

#[test]
fn the_same_seed_sails_into_the_same_encounters() {
    let d = defs();
    let trace = |seed: u64, days: u32| -> Vec<(u32, String)> {
        let run = audit_free_sea(&d, seed, days);
        assert!(run.finished && run.errors.is_empty(), "{:?}", run.errors);
        run.beats().iter().map(|b| (b.day, format!("{:?}:{}", b.beat.source, b.beat.key))).collect()
    };
    let (a, b) = (trace(42, 90), trace(42, 90));
    assert_eq!(a, b, "同种子两次，逐日逐件相同");
    assert!(a.iter().any(|(_, key)| key.starts_with("Encounter:")), "{a:?}");
    // 共用的那份报告里自由航海用的是种子 7、150 天：前 90 天里遇到的日子与条目应当与种子 42 不同。
    let other: Vec<(u32, String)> = report().sea_free.as_ref().unwrap().runs[0]
        .beats()
        .iter()
        .map(|b| (b.day, format!("{:?}:{}", b.beat.source, b.beat.key)))
        .collect();
    assert_ne!(a, other[..other.len().min(a.len())].to_vec(), "换一颗种子，遇到的不该一模一样");
}
