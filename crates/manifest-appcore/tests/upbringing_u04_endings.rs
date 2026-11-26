//! U04：结业视图保留冻结的差距，查询不能改动结业状态。
use manifest_appcore::{upbringing_view, views::Ctx};
use manifest_core::{Command, OwnerId, ScenarioId, World, upbringing::*};
use std::sync::Arc;

#[test]
fn weighted_graduation_exposes_main_supplements_and_two_frozen_near_misses() {
    let mut d = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let data = Arc::make_mut(&mut d);
    data.upbringing.families[0].graduation = [1553, 1, 2];
    data.upbringing.families[0].stages.truncate(1);
    let mut main = data.upbringing.endings[0].clone();
    main.key = "u04_main".into();
    main.family = None;
    main.requirements = Requirements::default();
    main.weights.flags.insert("fixture".into(), 1);
    let mut side = main.clone();
    side.key = "u04_side".into();
    side.supplementary = true;
    side.award = Award::default();
    let mut near = main.clone();
    near.key = "u04_near".into();
    near.requirements.flag = Some("missing".into());
    let mut second = near.clone();
    second.key = "u04_second".into();
    second.requirements.flag = Some("missing_second".into());
    data.upbringing.endings = vec![main, side, near, second];
    let sid = ScenarioId::from_idx(d.scenarios.iter().position(|s| s.key == "upbringing").unwrap());
    let mut w = World::new(d, sid, 42).unwrap();
    Command::PlanMonth {
        owner: OwnerId::Player,
        slots: (0..3)
            .map(|index| PlanSlot { index, lesson: None, after: Some(AfterChoice::activity("rest")) })
            .collect(),
    }
    .apply(&mut w)
    .unwrap();
    w.end_day().unwrap();
    let before = w.state.clone();
    let view = upbringing_view::upbringing(Ctx::plain(&w.defs), &w);
    assert_eq!(view["phase"], "done");
    assert!(view["plan"]["month"].is_array());
    assert_eq!(view["plan"]["editable"], false);
    assert!(view["protagonist"].is_object());
    assert_eq!(view["ending"]["key"], "u04_main");
    assert_eq!(view["supplementary"].as_array().unwrap().len(), 1);
    assert_eq!(view["supplementary"][0]["key"], "u04_side");
    let near = view["near_miss"].as_array().unwrap();
    assert_eq!(near.len(), 2);
    // 11-04 起差项带显示名（剧情条件说不清，给 null）与是否上限，界面照它写人话。
    assert_eq!(
        near[0]["missing"][0],
        serde_json::json!({"key":"flag:missing","label":null,"have":0,"need":1,"max":false})
    );
    assert_eq!(w.state, before);
}
