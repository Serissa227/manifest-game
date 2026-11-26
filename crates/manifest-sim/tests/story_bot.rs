//! 机器人必须走真实回应与自动分支，不得直接把轨道标为完成。
use manifest_core::{
    scenario::{Gender, ProtagonistIdentity},
    *,
};
use manifest_sim::story_bot::walk;
use serde_json::json;
use std::sync::Arc;

fn world() -> World {
    let mut d = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let defs = Arc::make_mut(&mut d);
    defs.scenarios[0].start_date = [1553, 1, 1];
    defs.scenarios[0].control_date = [1553, 1, 1];
    World::new(d, ScenarioId(0), 42).unwrap()
}

#[test]
fn both_sample_requests_reach_success_and_timeout_through_the_kernel() {
    let w = world();
    let original = w.state.clone();
    for track in ["request_grain", "request_keepsake"] {
        let r = walk(&w, track, 100);
        assert!(r.done && r.failed && !r.truncated, "{r:?}");
        assert!(r.steps.iter().all(|s| s.error.is_none()), "{r:?}");
    }
    assert_eq!(w.state, original);
}

#[test]
fn robot_reports_age_gate_failures_and_never_changes_birthdays() {
    let mut w = world();
    w.state.protagonist =
        Some(ProtagonistIdentity { protagonist: None, template: None, born: [1540, 1, 1], gender: Gender::F });
    Arc::make_mut(&mut w.defs).story2.tracks=vec![serde_json::from_value(json!({"key":"age","name":"年龄","kind":"request","start":"a","chapters":[
        {"key":"a","title":"边界","text":"成人不能与未成年人交往。","choices":[{"key":"bad","text":"拒绝","next":"done","effects":[{"kind":"heart","person":"mentor","value":1}]}]}]})).unwrap()];
    let r = walk(&w, "age", 100);
    assert!(!r.done);
    assert!(r.steps.iter().any(|s| s.error.is_some()));
    assert_eq!(w.state.protagonist.as_ref().unwrap().born, [1540, 1, 1]);
}

#[test]
fn robot_reports_unreachable_schedule_and_state_budget_explicitly() {
    let mut w = world();
    Arc::make_mut(&mut w.defs).story2.tracks=vec![serde_json::from_value(json!({"key":"place","name":"地点","kind":"request","start":"a","chapters":[
        {"key":"a","title":"相见","text":"同日无法在两地。","at":"test_west","objectives":[{"kind":"person","person":"distant"}],"choices":[{"key":"ok","text":"继续","next":"done"}]}]})).unwrap()];
    let r = walk(&w, "place", 100);
    assert!(!r.done);
    assert!(r.steps.iter().any(|s| s.error.as_ref().is_some_and(|e| e.contains("目标仍未满足"))));
    assert!(walk(&w, "place", 0).truncated);
}

#[test]
fn robot_preserves_branch_flags_and_respects_end_track_effects() {
    let mut w = world();
    Arc::make_mut(&mut w.defs).story2.tracks=vec![serde_json::from_value(json!({"key":"flags","name":"选择","kind":"request","start":"a","chapters":[
        {"key":"a","title":"决定","text":"记住决定。","choices":[{"key":"set","text":"留下","next":"b","effects":[{"kind":"flag","flag":"stayed"}]}]},
        {"key":"b","title":"后来","text":"选择不可抹去。","choices":[{"key":"impossible","text":"未曾留下","next":"failed","requires":[{"kind":"flag","flag":"stayed","value":false}]},
            {"key":"finish","text":"结束","next":"done","effects":[{"kind":"end_track","track":"flags"}]}]}]})).unwrap()];
    let r = walk(&w, "flags", 100);
    assert!(r.done && !r.failed && !r.truncated, "{r:?}");
    assert!(r.steps.iter().any(|s| s.branch == "impossible" && s.error.is_some()));
    assert!(r.steps.iter().any(|s| s.branch == "finish" && s.error.is_none()));
}

#[test]
fn autonomous_repeats_obey_family_cooldown_and_exhaust_variants() {
    let mut w = world();
    Arc::make_mut(&mut w.defs).story2.tracks=vec![serde_json::from_value(json!({"key":"repeat","name":"港口","kind":"encounter","start":"a","chapters":[
        {"key":"a","title":"港口","text":"风帆。","once":false,"family":"dock","family_cooldown_days":2,"variants":[{"key":"a","text":"第一阵风。"},{"key":"b","text":"第二阵风。"}],
         "at":"test_west","window":[[1553,1,1],[1553,1,1]],"default":{"next":"a","effects":[{"kind":"affinity","person":"classmate_a","value":3}]},
         "choices":[{"key":"done","text":"离开","next":"done"}]}]})).unwrap()];
    w.state.story2 = Default::default();
    w.refresh_story2();
    w.end_day().unwrap();
    assert_eq!(w.affection("classmate_a").unwrap().affinity, 3);
    w.end_day().unwrap();
    assert_eq!(w.affection("classmate_a").unwrap().affinity, 3);
    w.end_day().unwrap();
    assert_eq!(w.affection("classmate_a").unwrap().affinity, 6);
    for _ in 0..4 {
        w.end_day().unwrap();
    }
    assert_eq!(w.affection("classmate_a").unwrap().affinity, 6);
    assert_eq!(w.state.story2.variants_seen.len(), 2);
}

#[test]
fn reputation_and_price_cheats_change_only_the_requested_existing_resources() {
    use manifest_core::story2::Condition;
    use manifest_sim::story_bot::Cheat;
    let base = world();
    let faction = &base.defs.factions[0].key;
    let loc = LocId(0);
    let good = *base.state.locations[0].market.keys().next().unwrap();
    for (ge, le, initial, expected) in [
        (Some(100), None, 50, 100),
        (None, Some(30), 50, 30),
        (Some(40), Some(60), 50, 50),
        (Some(70), Some(70), 50, 70),
    ] {
        let mut w = base.clone();
        w.state.locations[0].market.get_mut(&good).unwrap().price = initial;
        let mut expected_state = w.state.clone();
        expected_state.locations[0].market.get_mut(&good).unwrap().price = expected;
        let condition =
            Condition::Price { good: w.defs.good(good).key.clone(), at: w.defs.loc(loc).key.clone(), ge, le };
        Cheat::Satisfy(condition.clone()).apply(&mut w, 0).unwrap();
        assert!(w.story2_conditions(&[condition], 0));
        assert_eq!(w.state, expected_state);
    }
    let mut w = base.clone();
    let condition = Condition::Reputation { faction: faction.clone(), ge: 75 };
    let mut expected = w.state.clone();
    expected.agents.get_mut(&OwnerId::Player).unwrap().reputation.insert(FactionId(0), 75);
    Cheat::Satisfy(condition.clone()).apply(&mut w, 0).unwrap();
    assert!(w.story2_conditions(&[condition], 0));
    assert_eq!(w.state, expected);
    Cheat::Satisfy(Condition::Reputation { faction: faction.clone(), ge: 40 }).apply(&mut w, 0).unwrap();
    assert_eq!(w.state, expected, "已经满足时不能降低声望");
    for condition in [
        Condition::Reputation { faction: "missing".into(), ge: 1 },
        Condition::Reputation { faction: faction.clone(), ge: 101 },
        Condition::Price { good: "missing".into(), at: w.defs.loc(loc).key.clone(), ge: Some(1), le: None },
        Condition::Price { good: w.defs.good(good).key.clone(), at: "missing".into(), ge: None, le: Some(1) },
        Condition::Price {
            good: w.defs.good(good).key.clone(),
            at: w.defs.loc(loc).key.clone(),
            ge: Some(2),
            le: Some(1),
        },
    ] {
        assert!(Cheat::Satisfy(condition).apply(&mut w, 0).is_err());
        assert_eq!(w.state, expected);
    }
    w.state.locations[0].market.remove(&good);
    let before = w.state.clone();
    assert!(
        Cheat::Satisfy(Condition::Price {
            good: w.defs.good(good).key.clone(),
            at: w.defs.loc(loc).key.clone(),
            ge: Some(1),
            le: None,
        })
        .apply(&mut w, 0)
        .is_err()
    );
    assert_eq!(w.state, before, "不存在的货架不能凭空创建");
}

#[test]
fn audit_walk_reaches_reputation_and_both_price_bounds_through_story_answer() {
    let mut w = world();
    let good = *w.state.locations[0].market.keys().next().unwrap();
    let faction = w.defs.factions[0].key.clone();
    let at = w.defs.locations[0].key.clone();
    let good = w.defs.good(good).key.clone();
    Arc::make_mut(&mut w.defs).story2.tracks = vec![serde_json::from_value(json!({
        "key":"market_gate","name":"测试","kind":"request","start":"a","chapters":[{
            "key":"a","title":"测试","text":"价格与声望测试。",
            "when":[{"kind":"reputation","faction":faction,"ge":60}],
            "choices":[
                {"key":"lower","text":"测试","next":"done","requires":[{"kind":"price","good":good,"at":at,"ge":1000}]},
                {"key":"upper","text":"测试","next":"done","requires":[{"kind":"price","good":good,"at":at,"le":1}]},
                {"key":"bounded","text":"测试","next":"done","requires":[{"kind":"price","good":good,"at":at,"ge":70,"le":70}]}
            ]
        }]
    })).unwrap()];
    let before = w.state.clone();
    let report = walk(&w, "market_gate", 100);
    assert!(report.done && !report.failed && !report.truncated, "{report:?}");
    assert_eq!(report.steps.len(), 3);
    assert!(report.steps.iter().all(|s| s.error.is_none() && s.resolved == ["a"]), "{report:?}");
    assert_eq!(w.state, before);
}

fn historical_flag_world(flag: &str, sets_true: bool) -> World {
    let mut w = world();
    Arc::make_mut(&mut w.defs).history.events[0].outcomes[0]
        .effects
        .push(history::Effect::Story(story2::Effect::Flag { flag: flag.into(), value: sets_true }));
    w
}

#[test]
fn historical_flags_prepare_chapter_and_choice_gates_without_changing_kernel_conditions() {
    let flag = "fixture_history_result";
    for in_choice in [false, true] {
        for value in [false, true] {
            let mut w = historical_flag_world(flag, true);
            let condition = json!({"kind":"flag","flag":flag,"value":value});
            let when = if in_choice { json!([]) } else { json!([condition]) };
            let requires = if in_choice { json!([condition]) } else { json!([]) };
            Arc::make_mut(&mut w.defs).story2.tracks = vec![
                serde_json::from_value(json!({
                    "key":"historical","name":"历史前提","kind":"request","start":"a","chapters":[{
                        "key":"a","title":"历史门槛","text":"测试历史结果旗标。","when":when,
                        "choices":[{"key":"finish","text":"结束","next":"done","requires":requires}]
                    }]
                }))
                .unwrap(),
            ];
            // 先制造相反的旗标状态，证明生产条件仍拒绝；准备只影响机器人的克隆。
            if !value {
                w.state.story2.flags.insert(flag.into());
            }
            let condition = serde_json::from_value(condition).unwrap();
            assert!(!w.story2_conditions(&[condition], w.day()));
            let original = w.state.clone();
            let r = walk(&w, "historical", 20);
            assert!(r.done && !r.failed && !r.truncated, "{r:?}");
            assert!(r.steps.iter().all(|s| s.error.is_none() && !s.excluded), "{r:?}");
            assert!(r.steps.iter().any(|s| s.branch == "finish" && s.next.as_deref() == Some("done")), "{r:?}");
            assert_eq!(w.state, original);
        }
    }
}

#[test]
fn historical_flags_prepare_automatic_default_branches() {
    let flag = "fixture_history_result";
    let mut w = historical_flag_world(flag, true);
    Arc::make_mut(&mut w.defs).story2.tracks = vec![
        serde_json::from_value(json!({
            "key":"historical_default","name":"历史回响","kind":"main","start":"a","chapters":[{
                "key":"a","title":"自动章节","text":"测试历史结果的自动回响。","stage":"rumor",
                "window":[[1553,1,1],[1553,1,3]],"when":[{"kind":"flag","flag":flag}],
                "default":{"next":"done"}
            }]
        }))
        .unwrap(),
    ];
    let original = w.state.clone();
    let r = walk(&w, "historical_default", 20);
    assert!(r.done && !r.failed && !r.truncated, "{r:?}");
    assert!(r.steps.iter().all(|s| s.error.is_none() && !s.excluded), "{r:?}");
    assert!(r.steps.iter().any(|s| s.branch == "default" && s.next.as_deref() == Some("done")), "{r:?}");
    assert_eq!(w.state, original);
}

#[test]
fn missing_and_clear_only_historical_flags_remain_blocked() {
    let flag = "fixture_history_result";
    for registered in [false, true] {
        let mut w = if registered { historical_flag_world(flag, false) } else { world() };
        Arc::make_mut(&mut w.defs).story2.tracks = vec![
            serde_json::from_value(json!({
                "key":"missing","name":"缺失前提","kind":"request","start":"a","chapters":[{
                    "key":"a","title":"旗标门槛","text":"测试缺少真实来源的旗标。",
                    "when":[{"kind":"flag","flag":flag}],
                    "choices":[{"key":"finish","text":"结束","next":"done"}]
                }]
            }))
            .unwrap(),
        ];
        let r = walk(&w, "missing", 20);
        assert!(!r.done && !r.failed && !r.truncated, "{r:?}");
        assert!(r.steps.iter().any(|s| s.error.as_ref().is_some_and(|e| e.contains(flag))), "{r:?}");
    }
}

#[test]
fn terra16_mio_historical_default_reaches_done() {
    let defs = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "terra16").unwrap();
    let scenario = defs.scenarios.iter().position(|s| s.key == "mio_1553").unwrap();
    let mut w = World::new(defs, ScenarioId::from_idx(scenario), 42).unwrap();
    // 此项只准备已经结业的前史，历史结果由机器人从真实历史定义识别。
    w.state.story2.flags.insert(upbringing::GRADUATED_FLAG.into());
    assert!(!w.state.story2.flags.contains("h44_shimanto_ichijo_holds_hata"));
    let original = w.state.clone();
    let r = walk(&w, "main_mio_tosa_held", 20);
    assert!(r.done && !r.failed && !r.truncated, "{r:?}");
    assert!(r.steps.iter().all(|s| s.error.is_none() && !s.excluded), "{r:?}");
    assert!(r.steps.iter().any(|s| s.branch == "default" && s.next.as_deref() == Some("done")), "{r:?}");
    assert_eq!(w.state, original);
}
