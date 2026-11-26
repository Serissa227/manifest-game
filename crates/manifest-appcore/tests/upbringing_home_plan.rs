//! 家乡阶段（一旬只有一格）的“均衡”自动安排按收获挑、三旬错开，不会三旬全排休息；
//! 别的家庭专属的活动（解锁旗标是另一个家庭某个阶段的进门旗标）不列进活动清单，自己家庭的照常列出。
use manifest_appcore::{upbringing_view, views::Ctx};
use manifest_core::{ScenarioId, StaticData, World, upbringing::ActivityKind};
use std::collections::BTreeSet;
use std::sync::Arc;

fn testbed() -> Arc<StaticData> {
    manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap()
}

fn world(defs: Arc<StaticData>) -> World {
    let i = defs.scenarios.iter().position(|s| s.key == "upbringing").unwrap();
    World::new(defs, ScenarioId::from_idx(i), 42).unwrap()
}

#[test]
fn home_balanced_plan_picks_by_gains_and_spreads_over_the_month() {
    let w = world(testbed());
    let plan = upbringing_view::auto_plan(&w, "balanced").unwrap();
    let picks: Vec<String> =
        plan["slots"].as_array().unwrap().iter().map(|s| s["after"]["activity"].as_str().unwrap().to_owned()).collect();
    assert_eq!(picks.len(), 3);
    let kind = |key: &str| w.defs.upbringing.activities.iter().find(|a| a.key == key).unwrap().kind;
    assert!(picks.iter().any(|k| kind(k) != ActivityKind::Rest), "家乡阶段不应三旬全休息：{picks:?}");
    assert!(picks.iter().collect::<BTreeSet<_>>().len() > 1, "同一个月不应三旬排同一件事：{picks:?}");
}

#[test]
fn activities_exclusive_to_another_family_are_not_listed() {
    let mut defs = (*testbed()).clone();
    let mut other = defs.upbringing.families[0].clone();
    other.key = "other_family".into();
    other.stages[0].entry_flag = Some("other_family_home".into());
    defs.upbringing.families.push(other);
    let base = defs.upbringing.activities.iter().find(|a| a.key == "train_navigation").unwrap().clone();
    let mut foreign = base.clone();
    foreign.key = "other_only".into();
    foreign.unlock.flag = Some("other_family_home".into());
    let mut own = base;
    own.key = "own_academy_only".into();
    own.unlock.flag = Some("test_enrolled".into());
    defs.upbringing.activities.extend([foreign, own]);
    let w = world(Arc::new(defs));
    let view = upbringing_view::upbringing(Ctx::plain(&w.defs), &w);
    let listed: BTreeSet<_> =
        view["activities"].as_array().unwrap().iter().map(|a| a["key"].as_str().unwrap().to_owned()).collect();
    assert!(!listed.contains("other_only"), "别的家庭专属的活动不该列出");
    assert!(listed.contains("own_academy_only"), "自己家庭以后能解锁的活动照常列出（显示为未满足）");
    assert!(listed.contains("train_navigation"));
}
