//! U04 工作包 5：年度目标卡的数据按中位成长曲线的公式生成（`tools/u04/annual_goals.py`），并且每张都静态可能完成。
//!
//! - 公式：属性 / 技能条件 = 年初中位 + 当年中位增量 × (80 + FNV-1a("goal:<键>") % 21)%，至少比年初多 1；
//!   奖励 = 增量的一成（至少 5）；攒钱 ≥ 210；羁绊对象有羁绊线。
//! - 静态可达：每张目标在本家庭的时间轮廓下、在它那一年之内可能满足；羁绊目标另查羁绊线里给到那一级的章节
//!   在那一年年底前可能出现。
//! - 改投学院（11-04）：路线卡（`flag`）与被它换掉的原卡（`not_flag` 同一旗标）同槽位，一一配对；
//!   每家每年在走与不走路线的两种局里都恰好 3 张。
use manifest_core::{
    StaticData,
    cast::relations::Bond,
    story2::{Effect, ObjectiveKind},
    upbringing::{Constraint, Reachability, reach::constraints_of_objective},
};
use manifest_sim::upbringing_curve::{GrowthCurve, Measure};
use std::{
    collections::BTreeMap,
    sync::{Arc, OnceLock},
};

fn terra() -> Arc<StaticData> {
    static DEFS: OnceLock<Arc<StaticData>> = OnceLock::new();
    DEFS.get_or_init(|| manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "terra16").unwrap()).clone()
}

fn fnv(text: &str) -> u64 {
    text.bytes().fold(0xcbf2_9ce4_8422_2325u64, |h, b| (h ^ u64::from(b)).wrapping_mul(0x0000_0100_0000_01b3))
}

fn coef(key: &str) -> i64 {
    80 + (fnv(&format!("goal:{key}")) % 21) as i64
}

fn rank(b: Bond) -> u8 {
    match b {
        Bond::C => 1,
        Bond::B => 2,
        Bond::A => 3,
        Bond::S => 4,
    }
}

#[test]
fn every_family_has_three_goals_a_year_for_four_years() {
    let d = terra();
    // （家庭, 年份, 路线旗标——None 是没走改投的局）→ 张数
    let mut count: BTreeMap<(String, u32, Option<String>), usize> = BTreeMap::new();
    for g in &d.upbringing.annual_goals {
        let f = d.upbringing.family(&g.family).unwrap();
        let routes: Vec<Option<String>> =
            std::iter::once(None).chain(f.routes.iter().map(|r| Some(r.flag.clone()))).collect();
        for route in routes {
            let shown = g.flag.as_ref().is_none_or(|flag| route.as_ref() == Some(flag))
                && g.not_flag.as_ref().is_none_or(|flag| route.as_ref() != Some(flag));
            if shown {
                *count.entry((g.family.clone(), g.year, route)).or_default() += 1;
            }
        }
        assert!(!g.text.trim().is_empty(), "{}：目标文字没写", g.key);
        assert!(g.text.chars().count() <= 30, "{}：目标文字是一句话", g.key);
        assert_eq!(g.objectives.len(), 1, "{}", g.key);
        assert_eq!(g.rewards.len(), 1, "{}", g.key);
        if let Some(flag) = &g.flag {
            // 路线卡：键是被换掉的原卡加 _<改投学院>，原卡对同一旗标 not_flag
            let route = f.routes.iter().find(|r| &r.flag == flag).unwrap();
            let base = g.key.strip_suffix(&format!("_{}", route.academy)).unwrap_or_else(|| panic!("{}", g.key));
            let original = d.upbringing.annual_goals.iter().find(|o| o.key == base).unwrap();
            assert_eq!(original.not_flag.as_ref(), Some(flag), "{}", g.key);
            assert_eq!((original.family.as_str(), original.year), (g.family.as_str(), g.year));
        }
        if let Some(flag) = &g.not_flag {
            let route = f.routes.iter().find(|r| &r.flag == flag).unwrap();
            let paired = format!("{}_{}", g.key, route.academy);
            assert!(
                d.upbringing.annual_goals.iter().any(|o| o.key == paired && o.flag.as_ref() == Some(flag)),
                "{}",
                g.key
            );
        }
    }
    for f in &d.upbringing.families {
        for route in std::iter::once(None).chain(f.routes.iter().map(|r| Some(r.flag.clone()))) {
            for year in 1553..=1556 {
                let n = count.get(&(f.key.clone(), year, route.clone())).copied();
                assert_eq!(n, Some(3), "{} {year} {route:?}", f.key);
            }
        }
    }
    let routes: usize = d.upbringing.families.iter().map(|f| 1 + f.routes.len()).sum();
    assert_eq!(count.len(), routes * 4);
}

#[test]
fn goal_thresholds_and_rewards_follow_the_median_curve() {
    let d = terra();
    let mut curves = BTreeMap::new();
    for g in &d.upbringing.annual_goals {
        let c = curves.entry(g.family.clone()).or_insert_with(|| GrowthCurve::new(&d, &g.family).unwrap());
        let m0 = (g.year as usize - 1553) * 12;
        let (measure, key, need) = match &g.objectives[0].kind {
            ObjectiveKind::Growth { attr, ge } => (Measure::Growth, attr.clone(), *ge),
            ObjectiveKind::Skill { skill, ge } => (Measure::Skill, skill.clone(), *ge),
            ObjectiveKind::Cash { ge } => {
                assert!(*ge >= 210 && *ge % 10 == 0, "{}：攒钱目标 {ge}", g.key);
                assert!(matches!(&g.rewards[0], Effect::Item { qty: 1, .. }), "{}：攒钱的奖励是一件物品", g.key);
                continue;
            }
            ObjectiveKind::Bond { person, level } => {
                assert!(*level != Bond::S, "{}：年度目标不要求誓约", g.key);
                assert!(
                    d.cast.person(person).is_some_and(|p| p.bond_track.is_some()),
                    "{}：{person} 没有羁绊线",
                    g.key
                );
                assert!(matches!(&g.rewards[0], Effect::Memory { .. }), "{}：羁绊的奖励是一段回忆", g.key);
                continue;
            }
            other => panic!("{}：意外的目标种类 {other:?}", g.key),
        };
        let start = c.median_at(measure, &key, m0);
        let end = c.median_at(measure, &key, m0 + 12);
        let gain = end - start;
        assert!(gain > 0, "{}：{key} 这一年没有中位增量", g.key);
        assert_eq!(
            need,
            (start + gain * coef(&g.key) / 100).max(start + 1),
            "{}：{key} 年初 {start}、年末 {end}",
            g.key
        );
        assert!(need <= end, "{}：门槛 {need} 高过年末中位 {end}", g.key);
        let reward = (gain * 10 / 100).max(5);
        match (&g.rewards[0], measure) {
            (Effect::Growth { attr, value }, Measure::Growth) => {
                assert_eq!((attr, *value), (&key, reward), "{}", g.key);
            }
            (Effect::Skill { skill, value }, Measure::Skill) => {
                assert_eq!((skill, *value), (&key, reward), "{}", g.key);
            }
            (other, _) => panic!("{}：奖励 {other:?} 与条件不配", g.key),
        }
    }
}

#[test]
fn every_goal_is_statically_reachable_within_its_year() {
    let d = terra();
    let r = Reachability::new(&d);
    let day = |date| manifest_core::scenario::day_of(&d, date).unwrap();
    for g in &d.upbringing.annual_goals {
        let (from, to) = (day([g.year, 1, 1]), day([g.year, 12, 31]));
        let mut cs: Vec<Constraint> = g.objectives.iter().flat_map(constraints_of_objective).collect();
        cs.push(Constraint::Date { from: Some([g.year, 1, 1]), to: Some([g.year, 12, 31]) });
        let at =
            r.earliest_for(&g.family, &cs, from, Some(true)).unwrap_or_else(|e| panic!("{}：静态不可达：{e}", g.key));
        assert!(at <= to, "{}：最早 {at} 晚于年底 {to}", g.key);
        for o in &g.objectives {
            let ObjectiveKind::Bond { person, level } = &o.kind else { continue };
            let track = d.cast.person(person).and_then(|p| p.bond_track.clone()).unwrap();
            let t = d.story2.track(&track).unwrap();
            let earliest = t
                .chapters
                .iter()
                .filter(|c| {
                    manifest_core::story2::graph::branches(c).into_iter().flat_map(|b| b.effects).any(|e| {
                        matches!(e, Effect::Bond { person: p, level: l } if &p == person && rank(l) >= rank(*level))
                    })
                })
                .filter_map(|c| r.chapters.get(&(track.clone(), c.key.clone())).copied())
                .min();
            assert!(
                earliest.is_some_and(|e| e <= to),
                "{}：{person} 的羁绊线在 {} 年底前给不到 {level:?}（最早 {earliest:?}）",
                g.key,
                g.year
            );
        }
    }
}
