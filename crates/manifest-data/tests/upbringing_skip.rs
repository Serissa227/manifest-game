//! 跳过养成仍逐日结算完整四年；命令日志保持同一时间轴。
use manifest_core::{
    Command, OwnerId, ScenarioId, World,
    replay::{LogEntry, Source, StartParams, replay},
    upbringing::Phase,
};
#[test]
fn skip_runs_all_four_years_and_replays_default_growth_once() {
    let d = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let sid = ScenarioId::from_idx(d.scenarios.iter().position(|s| s.key == "upbringing").unwrap());
    let mut w = World::new(d.clone(), sid, 42).unwrap();
    let start = w.day();
    let target = manifest_core::scenario::day_of(&d, [1557, 1, 1]).unwrap();
    let before = w.state.clone();
    assert!(Command::SkipUpbringing { owner: OwnerId::Company(manifest_core::CompanyId(0)) }.apply(&mut w).is_err());
    assert_eq!(w.state, before);
    let skip = Command::SkipUpbringing { owner: OwnerId::Player };
    skip.apply(&mut w).unwrap();
    assert_eq!(w.day(), start);
    assert!(w.upbringing_skipping());
    let once = w.state.clone();
    assert!(skip.apply(&mut w).is_err());
    assert_eq!(w.state, once);
    let logs = vec![LogEntry { tick: start, seq: 0, source: Source::Player, command: skip.clone(), minute: None }];
    let money = w.all_money();
    let mut days = 0;
    while w.upbringing_skipping() {
        let previous = w.day();
        w.end_day().unwrap();
        assert_eq!(w.day(), previous + 1);
        days += 1;
        assert!(days <= 1460);
        assert!(w.money_conserved());
        if w.circulation_on() {
            assert_eq!(w.all_money(), money);
        }
        for agent in w.state.agents.values() {
            assert!(agent.ledger.is_balanced());
        }
    }
    assert_eq!(days, 1460);
    assert_eq!(w.day(), target);
    let s = w.state.upbringing.as_ref().unwrap();
    assert_eq!(s.phase, Phase::Done);
    assert_eq!(s.growth["navigation"], 400);
    assert_eq!(s.path.as_deref(), Some("test_path_navigation"));
    assert!(s.exams["test_exam_navigation"].passed);
    assert_eq!(s.graduation.as_ref().unwrap().ending.as_deref(), Some("test_ending_navigation"));
    assert_ne!(w.state.locations, before.locations, "四年经济有实际日结");
    let restored = World::from_snapshot(d.clone(), w.state.clone()).unwrap();
    assert_eq!(serde_json::to_vec(&restored.state).unwrap(), serde_json::to_vec(&w.state).unwrap());
    assert_eq!(restored.state_hash(), w.state_hash());
    assert_eq!(replay(d, StartParams::new(sid, 42), &logs, w.day()).unwrap().state, w.state);
    let assets = w.state.fleets.clone();
    assert!(skip.apply(&mut w).is_err());
    assert_eq!(w.state.fleets, assets);
}
#[test]
fn classic_cannot_skip_and_old_upbringing_save_defaults_are_readable() {
    let root = manifest_data::find_data_dir().unwrap();
    let d = manifest_data::load_world(&root, "classic").unwrap();
    let mut w = World::new(d, ScenarioId(0), 42).unwrap();
    let before = w.state.clone();
    assert!(Command::SkipUpbringing { owner: OwnerId::Player }.apply(&mut w).is_err());
    assert_eq!(w.state, before);
    let d = manifest_data::load_world(&root, "testbed").unwrap();
    let sid = ScenarioId::from_idx(d.scenarios.iter().position(|s| s.key == "upbringing").unwrap());
    let w = World::new(d.clone(), sid, 42).unwrap();
    let mut v = serde_json::to_value(&w.state).unwrap();
    let up = v["upbringing"].as_object_mut().unwrap();
    for key in ["skipping", "exams", "path", "graduation"] {
        up.remove(key);
    }
    let restored = World::from_snapshot(d, serde_json::from_value(v).unwrap()).unwrap();
    assert_eq!(restored.state, w.state);
}
#[test]
fn skip_opening_is_a_replayable_start_and_graduation_day_does_not_advance() {
    let mut d = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let f = &mut std::sync::Arc::make_mut(&mut d).upbringing.families[0];
    f.stages.truncate(1);
    f.graduation = [1553, 1, 2];
    let sid = ScenarioId::from_idx(d.scenarios.iter().position(|s| s.key == "upbringing").unwrap());
    let mut start = StartParams::new(sid, 42);
    start.opening = Some(manifest_core::scenario::NewGameRequest {
        world: "testbed".into(),
        scenario: "upbringing".into(),
        skip_upbringing: true,
        ..Default::default()
    });
    let w = World::from_start(d.clone(), &start, |_| {}).unwrap();
    assert_eq!(w.cast_date(), [1553, 1, 2]);
    assert_eq!(w.state.upbringing.as_ref().unwrap().phase, Phase::Done);
    assert_eq!(replay(d.clone(), start, &[], w.day()).unwrap().state, w.state);
    let mut late = World::new(d.clone(), sid, 42).unwrap();
    let day = manifest_core::scenario::day_of(&d, [1553, 1, 2]).unwrap();
    late.state.day = day;
    late.state.upbringing.as_mut().unwrap().phase = Phase::Graduation;
    Command::SkipUpbringing { owner: OwnerId::Player }.apply(&mut late).unwrap();
    assert_eq!(late.day(), day);
    assert_eq!(late.state.upbringing.as_ref().unwrap().phase, Phase::Done);
}
#[test]
fn after_graduation_the_player_place_follows_the_fleet_instead_of_the_graduation_port() {
    use manifest_core::world::{FleetLocation, RouteVoyage, Voyage};
    let mut d = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let f = &mut std::sync::Arc::make_mut(&mut d).upbringing.families[0];
    f.stages.truncate(1);
    f.graduation = [1553, 1, 2];
    let sid = ScenarioId::from_idx(d.scenarios.iter().position(|s| s.key == "upbringing").unwrap());
    let mut start = StartParams::new(sid, 42);
    start.opening = Some(manifest_core::scenario::NewGameRequest {
        world: "testbed".into(),
        scenario: "upbringing".into(),
        skip_upbringing: true,
        ..Default::default()
    });
    let mut w = World::from_start(d.clone(), &start, |_| {}).unwrap();
    assert_eq!(w.state.upbringing.as_ref().unwrap().phase, Phase::Done);
    let west = w.defs.find_loc("test_west").unwrap();
    let east = w.defs.find_loc("test_east").unwrap();
    // 结业当天船泊在结业港：人物仍在结业港，读结业港的门槛章照样成立。
    assert_eq!(w.state.cast.place, None, "有船以后不再用养成期的场所");
    assert_eq!(w.cast_player_place().map(|p| p.loc), Some(west));
    // 开到别港以后，地点条件跟着旗舰队走，不再停在结业港。
    let fleet = w.flagship(OwnerId::Player).unwrap();
    w.state.fleets.get_mut(&fleet).unwrap().location = FleetLocation::Docked(east);
    assert_eq!(w.cast_player_place().map(|p| p.loc), Some(east));
    let restored = World::from_snapshot(d, w.state.clone()).unwrap();
    assert_eq!(restored.cast_player_place().map(|p| p.loc), Some(east), "读档以后也跟着船队");
    let cell = w.defs.loc(east).cell;
    w.state.fleets.get_mut(&fleet).unwrap().location = FleetLocation::AtSea(Voyage::Route(RouteVoyage {
        dest: west,
        path: vec![cell],
        step: 0,
        leg_progress: manifest_core::Fx::ZERO,
    }));
    assert_eq!(w.cast_player_place(), None, "海上不在任何港口");
}
