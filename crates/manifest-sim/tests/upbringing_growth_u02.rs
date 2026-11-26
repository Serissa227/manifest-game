//! U02 工作包 4：认真玩要好过跳过、每类评价都有路可练。全部按同一条中位成长曲线断言。
use manifest_core::{
    StaticData,
    upbringing::{RatingRequirement, growth::annual_cap_at},
};
use manifest_sim::{
    upbringing_curve::{GrowthCurve, MONTHS, Measure},
    upbringing_thresholds::{Locator, curves, generate},
};
use std::sync::{Arc, OnceLock};

fn terra() -> Arc<StaticData> {
    static DEFS: OnceLock<Arc<StaticData>> = OnceLock::new();
    DEFS.get_or_init(|| manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "terra16").unwrap()).clone()
}

/// 能练的属性：不含品行、生日运气与要觉醒的秘术。
fn trainable(d: &StaticData) -> Vec<String> {
    d.captain
        .attributes
        .iter()
        .enumerate()
        .filter(|(i, a)| a.key != "fortune" && a.key != "arcana" && d.captain.group(*i).unwrap().key != "conduct")
        .map(|(_, a)| a.key.clone())
        .collect()
}

#[test]
fn four_balanced_years_beat_skipping_by_at_least_twenty_percent() {
    let d = terra();
    let keys = trainable(&d);
    for f in &d.upbringing.families {
        let c = GrowthCurve::new(&d, &f.key).unwrap();
        let played: i64 = keys.iter().map(|k| c.median_at(Measure::Growth, k, MONTHS)).sum();
        let skipped: i64 =
            keys.iter().map(|k| f.completion.as_ref().unwrap().defaults.growth.get(k).copied().unwrap_or(0)).sum();
        assert!(played * 10 >= skipped * 12, "{}：均衡四年 {played} 不到跳过缺省 {skipped} 的 1.2 倍", f.key);
    }
}

#[test]
fn a_specialist_reaches_level_eight_in_every_personal_strength() {
    let d = terra();
    for f in &d.upbringing.families {
        let c = GrowthCurve::new(&d, &f.key).unwrap();
        for key in f
            .initial_points
            .keys()
            .filter(|k| d.captain.attribute_index(k).is_some_and(|i| d.captain.group(i).unwrap().key != "conduct"))
        {
            let level = c.upper(Measure::Level, key, [1557, 1, 1]);
            assert!(level >= 8, "{} 专攻 {key} 四年只到 {level} 级", f.key);
        }
    }
}

#[test]
fn annual_caps_rise_with_age_and_a_balanced_year_never_hits_them() {
    let d = terra();
    let rules = &d.upbringing.rules;
    assert_eq!(rules.annual_growth_cap_by_age, vec![[12, 250], [13, 300], [14, 350], [15, 400]]);
    assert_eq!(annual_cap_at(rules, Some(11)), 250);
    assert_eq!(annual_cap_at(rules, Some(16)), 400);
    assert_eq!(annual_cap_at(rules, None), rules.annual_growth_cap);
    let keys = trainable(&d);
    for f in &d.upbringing.families {
        let c = GrowthCurve::new(&d, &f.key).unwrap();
        for year in 0..4usize {
            let age = 1553 + year as i64 - i64::from(f.born[0]) - 1;
            for k in &keys {
                let gain = c.median_at(Measure::Growth, k, year * 12 + 12) - c.median_at(Measure::Growth, k, year * 12);
                assert!(gain < annual_cap_at(rules, Some(age)), "{} 第 {year} 年 {k} 均衡成长 {gain} 碰到上限", f.key);
            }
        }
    }
}

#[test]
fn combat_rating_has_practices_to_train_it() {
    let d = terra();
    for key in ["gunnery_drill", "command_drill", "watch_keeping"] {
        let a = d.upbringing.activity(key).unwrap_or_else(|| panic!("缺少练习 {key}"));
        assert!(a.unlock.attrs.is_empty() && a.unlock.flag.is_none(), "{key} 不该有门槛");
    }
    for f in &d.upbringing.families {
        let c = GrowthCurve::new(&d, &f.key).unwrap();
        for key in ["gunnery", "command"] {
            let gain = c.median_at(Measure::Growth, key, MONTHS) - c.median_at(Measure::Growth, key, 0);
            assert!(gain >= 100, "{} 四年 {key} 只涨 {gain}", f.key);
        }
        assert!(
            c.median(Measure::Rating, "naval", [1557, 1, 1]) > c.median(Measure::Rating, "naval", [1553, 1, 1]),
            "{} 的战斗评价四年不动",
            f.key
        );
    }
}

#[test]
fn aspirations_follow_their_meaning_and_the_hidden_one_is_a_stretch() {
    let d = terra();
    let positional = ["naval", "mercantile", "scholarship"];
    // BALANCE.md“志向门槛”对照表（U02 工作包 4）：前三条志向里按意思换了键的 29 条；其余照旧是战斗、贸易、学识。
    // 原断言“至少 30 条”是工作包 4 先写不跑的，对照表本身就是 29 条，数据与表逐条一致（见 DECISIONS 2026-11-04）。
    let meant: std::collections::BTreeMap<&str, &str> = [
        ("baraka_path_3", "social_rating"),
        ("custom_basque_whaling_path_1", "seamanship"),
        ("custom_basque_whaling_path_3", "medicine"),
        ("custom_busan_interpreter_path_1", "social_rating"),
        ("custom_cambay_broker_path_3", "numeracy"),
        ("custom_chincha_rafts_path_1", "seamanship"),
        ("custom_fez_scholar_path_1", "social_rating"),
        ("custom_istanbul_shipyard_path_2", "social_rating"),
        ("custom_istanbul_shipyard_path_3", "astronomy"),
        ("custom_lisbon_medicine_path_1", "medicine"),
        ("custom_lubeck_accounts_path_1", "mercantile"),
        ("custom_lubeck_accounts_path_2", "social_rating"),
        ("custom_lubeck_accounts_path_3", "astronomy"),
        ("custom_murano_glass_path_1", "perception"),
        ("custom_murano_glass_path_3", "astronomy"),
        ("custom_naha_envoy_path_1", "social_rating"),
        ("custom_seville_pilot_path_1", "seamanship"),
        ("custom_seville_pilot_path_3", "social_rating"),
        ("custom_tondo_datu_path_3", "astronomy"),
        ("ix_nikte_path_1", "seamanship"),
        ("kaicili_path_1", "social_rating"),
        ("kaicili_path_3", "astronomy"),
        ("lieve_path_1", "mercantile"),
        ("lieve_path_2", "numeracy"),
        ("lin_wandeng_path_3", "social_rating"),
        ("mio_path_3", "social_rating"),
        ("najma_path_1", "astronomy"),
        ("noel_path_1", "arms"),
        ("tariq_path_3", "astronomy"),
    ]
    .into();
    let mut moved = std::collections::BTreeSet::new();
    for f in &d.upbringing.families {
        let c = f.completion.as_ref().unwrap();
        for (i, key) in c.paths.iter().take(3).enumerate() {
            let p = d.upbringing.paths.iter().find(|p| &p.key == key).unwrap();
            let k = match &p.requirements.rating {
                Some(RatingRequirement::Threshold(t)) => t.key.clone(),
                Some(RatingRequirement::Key(k)) => k.clone(),
                None => p.requirements.attr.clone().unwrap(),
            };
            assert_eq!(k, meant.get(key.as_str()).copied().unwrap_or(positional[i]), "{key} 的门槛与对照表不符");
            if k != positional[i] {
                moved.insert(key.clone());
            }
        }
    }
    assert_eq!(moved.len(), meant.len(), "对照表里换了键的志向都该在各家前三条里：{moved:?}");
    let najma = d.upbringing.paths.iter().find(|p| p.key == "najma_path_1").unwrap();
    assert_eq!(najma.requirements.attr.as_deref(), Some("astronomy"), "星路领航看观星");
    let lieve = d.upbringing.paths.iter().find(|p| p.key == "lieve_path_1").unwrap();
    assert!(
        matches!(&lieve.requirements.rating, Some(RatingRequirement::Threshold(t)) if t.key == "mercantile"),
        "海运保险商看贸易"
    );
    let c = curves(&d);
    for t in generate(&d, &c) {
        if let Locator::Requirement { owner, key, .. } = &t.locator
            && owner == "path"
            && d.upbringing.paths.iter().any(|p| &p.key == key && p.hidden)
        {
            assert!(t.stretch, "{key} 的隐藏志向应是“够一够”");
        }
    }
}

#[test]
fn exams_have_spring_and_autumn_sessions_or_the_school_calendar() {
    let d = terra();
    assert_eq!((d.upbringing.rules.exam_session_days, d.upbringing.rules.exam_notice_days), (10, 60));
    for e in &d.upbringing.exams {
        assert!(!e.dates.is_empty(), "{} 没有考期", e.key);
        match &e.academy {
            None => {
                for y in 1553..=1556 {
                    assert!(e.dates.contains(&[y, 3, 21]) && e.dates.contains(&[y, 9, 21]), "{} {y}", e.key);
                }
            }
            Some(a) => {
                let cal = &d.upbringing.academy(a).unwrap().calendar;
                for date in &e.dates {
                    assert!(
                        cal.iter().any(|m| &m.date == date)
                            || d.upbringing.academy(a).unwrap().graduation.as_ref().is_some_and(|g| &g.date == date),
                        "{} 的考期 {date:?} 不在校历上",
                        e.key
                    );
                }
            }
        }
    }
}
