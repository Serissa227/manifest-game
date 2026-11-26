//! 时间线加载、日期、港口、边界与旧存档回归。
use manifest_core::{history::*, *};
use serde_json::json;
use std::sync::Arc;

fn defs() -> Arc<StaticData> {
    let mut defs = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let d = Arc::make_mut(&mut defs);
    d.scenarios[0].start_date = [1558, 1, 1];
    d.scenarios[0].control_date = [1558, 1, 1];
    defs
}
fn world() -> World {
    World::new(defs(), ScenarioId(0), 42).unwrap()
}
fn effect(value: serde_json::Value) -> Effect {
    serde_json::from_value(value).unwrap()
}

#[test]
fn defaults_follow_dependencies_and_latest_without_intervention() {
    let mut w = world();
    assert_eq!(w.defs.history.events.len(), 3);
    for _ in 0..4 {
        w.end_day().unwrap();
    }
    let h = &w.state.history;
    assert_eq!(
        h.chronicle.iter().map(|r| r.event.as_str()).collect::<Vec<_>>(),
        ["sample_opening", "sample_treaty", "sample_signal"]
    );
    assert_eq!(w.history_outcome("sample_signal"), Some("received"));
    assert_eq!(w.history_deviation(), 0);
    let snapshot = w.state.clone();
    let mut saved = World::from_snapshot(w.defs.clone(), snapshot).unwrap();
    for _ in 0..3 {
        w.end_day().unwrap();
        saved.end_day().unwrap();
    }
    assert_eq!(w.state_hash(), saved.state_hash());
    assert_eq!(w.state.history.chronicle.len(), 3);
}

#[test]
fn trigger_resolves_early_and_false_trigger_waits_for_latest() {
    let mut w = world();
    w.state.story2.flags.insert("history_signal".into());
    let day = w.day();
    w.end_day().unwrap();
    assert_eq!(w.state.history.events["sample_signal"].resolved_day, Some(day));
    assert!(w.history_outcome("sample_opening").is_none());
    let mut late = world();
    for _ in 0..3 {
        late.end_day().unwrap();
    }
    assert!(late.history_outcome("sample_signal").is_none());
    late.end_day().unwrap();
    assert_eq!(late.history_outcome("sample_signal"), Some("received"));
}

#[test]
fn dormant_ports_reject_goods_and_items_then_open_with_dynamic_ownership() {
    let mut d = defs();
    let dd = Arc::make_mut(&mut d);
    dd.history.ports.push(InitialPort { port: "test_west".into(), state: PortStatus::Dormant, faction: None });
    let faction = dd.factions[1].key.clone();
    let e = dd.history.events.iter_mut().find(|e| e.key == "sample_opening").unwrap();
    e.outcomes[0].effects = vec![
        effect(json!({"kind":"port_state","port":"test_west","state":"open"})),
        effect(json!({"kind":"port_owner","port":"test_west","faction":faction})),
    ];
    let mut w = World::new(d, ScenarioId(0), 42).unwrap();
    let fleet = w.flagship(OwnerId::Player).unwrap();
    let buy = Command::Buy { owner: OwnerId::Player, fleet, good: GoodId(0), qty: 1, max_total: None };
    let before = w.state.clone();
    assert!(buy.apply(&mut w).is_err());
    assert_eq!(before, w.state);
    assert!(w.market(LocId(0), GoodId(0)).is_none());
    assert!(w.item_shelf(LocId(0)).is_none());
    assert!(!w.at_item_shop(OwnerId::Player, LocId(0)));
    w.end_day().unwrap();
    w.end_day().unwrap();
    assert!(w.location_open(LocId(0)));
    assert_eq!(w.location_faction(LocId(0)), FactionId(1));
    buy.apply(&mut w).unwrap();
    assert_eq!(w.state, World::from_snapshot(w.defs.clone(), w.state.clone()).unwrap().state);
}

#[test]
fn malformed_graphs_dates_outcomes_and_effects_are_rejected() {
    let base = defs();
    for broken in [
        json!({"kind":"port_owner","port":"test_west","faction":"absent"}),
        json!({"kind":"port_state","port":"test_west","state":"sacked","days":0}),
        json!({"kind":"diplomacy","a":"cuilan","b":base.factions[1].key,"from":"Peace","to":"War"}),
        json!({"kind":"world","title":"测试","text":"边界测试。","effects":[{"effect":"SupplyShift","params":{"loc":0,"good":0,"mult":9999999,"days":10}}]}),
    ] {
        let mut d = (*base).clone();
        d.history.events[0].outcomes[0].effects = vec![effect(broken)];
        assert!(!validation::validate(&d).is_empty());
    }
    let mut d = (*base).clone();
    d.history.events[1].requires.push(Requirement { event: "sample_treaty".into(), outcome: None });
    assert!(validation::order(&d.history).is_none());
    let mut d = (*base).clone();
    d.history.events[0].date = Some([1558, 2, 30]);
    assert!(!validation::validate(&d).is_empty());
    let mut d = (*base).clone();
    d.history.events[0].outcomes[1].when = ">= 0".into();
    assert!(!validation::validate(&d).is_empty());
    assert!(serde_json::from_value::<HistoryDefs>(json!({"unknown":true})).is_err());
}

#[test]
fn diplomacy_only_follows_declared_legal_edges() {
    let mut d = defs();
    let dd = Arc::make_mut(&mut d);
    let b = dd.factions[1].key.clone();
    dd.rules.diplomacy.incident_bp = 0;
    dd.history.events[1].outcomes[0].effects =
        vec![effect(json!({"kind":"diplomacy","a":"cuilan","b":b,"from":"Peace","to":"Tension"}))];
    let mut w = World::new(d, ScenarioId(0), 42).unwrap();
    for r in &mut w.state.relations {
        r.value = 0;
        r.baseline = 0;
    }
    w.end_day().unwrap();
    w.end_day().unwrap();
    assert_eq!(w.relation(FactionId(0), FactionId(1)).unwrap().status, diplomacy::DiploStatus::Tension);
}

#[test]
fn classic_and_old_saves_have_no_history_block_and_reject_forged_state() {
    let d = manifest_data::load_shared(&manifest_data::find_data_dir().unwrap()).unwrap();
    let w = World::new(d.clone(), ScenarioId(0), 42).unwrap();
    let file = save::SaveFile::new(&d, replay::StartParams::new(ScenarioId(0), 42), w.state.clone(), vec![]);
    let json = serde_json::to_value(&file).unwrap();
    assert!(json["snapshot"].get("history").is_none());
    for version in 1..=5 {
        let mut v = json.clone();
        if version == 1 {
            v = save::downgrade_to_v1(v).unwrap();
        }
        v["version"] = version.into();
        let old = save::SaveFile::from_json(&v.to_string()).unwrap();
        assert_eq!(w.state_hash(), World::from_snapshot(d.clone(), old.snapshot).unwrap().state_hash());
    }
    let mut invalid = w.state.clone();
    invalid.history.events.insert("forged".into(), EventState::default());
    assert!(World::from_snapshot(d, invalid).is_err());
}

#[test]
fn corrupt_history_snapshots_cannot_duplicate_results() {
    let mut w = world();
    for _ in 0..4 {
        w.end_day().unwrap();
    }
    let mut bad = w.state.clone();
    bad.history.chronicle.push(bad.history.chronicle[0].clone());
    assert!(World::from_snapshot(w.defs.clone(), bad).is_err());
    let mut bad = w.state.clone();
    bad.history.events.get_mut("sample_signal").unwrap().outcome = Some("forged".into());
    assert!(World::from_snapshot(w.defs.clone(), bad).is_err());
}

#[test]
fn a_failed_effect_keeps_the_entire_event_unapplied() {
    let mut d = defs();
    let dd = Arc::make_mut(&mut d);
    dd.history.events[1].date = Some([1558, 1, 1]);
    dd.history.events[1].outcomes[0].effects =
        vec![effect(json!({"kind":"flag","flag":"partial"})), effect(json!({"kind":"item","item":"absent","qty":1}))];
    let mut w = World::new(d, ScenarioId(0), 42).unwrap();
    let history = w.state.history.clone();
    assert!(w.end_day().is_err());
    assert!(!w.state.story2.flags.contains("partial"));
    assert_eq!(w.state.history, history);
}

#[test]
fn historical_display_has_real_locale_registration_and_english_coverage() {
    let root = manifest_data::find_data_dir().unwrap();
    let effective = manifest_data::resolve_world(&root, "testbed").unwrap();
    let d = defs();
    let ai = manifest_data::ai_content::load_world_ai_content(&effective).unwrap();
    // 只安装本次新增的真实覆盖；testbed 整表替换的经典人物译文不属于这个夹具。
    let tmp = tempfile::tempdir().unwrap();
    std::fs::copy(root.join("texts.toml"), tmp.path().join("texts.toml")).unwrap();
    let dir = tmp.path().join("locales/en/history");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("main.toml");
    std::fs::copy(root.join("worlds/testbed/locales/en/history/main.toml"), &path).unwrap();
    let en = manifest_data::load_locale(tmp.path(), manifest_data::Locale::En, &d, &ai).unwrap();
    assert!(en.missing.iter().all(|m| !m.file.contains("history")), "{:?}", en.missing);
    assert_eq!(en.defs.history.events[0].title, "Test treaty");
    assert_eq!(en.defs.history.events[0].sides[0].name, "West");
    assert_eq!(en.defs.history.events[0].outcomes[0].chronicle, "Test treaty result.");
    assert_eq!(en.defs.history.campaigns[0].name, "Test campaign");
    assert_eq!(en.defs.history.campaigns[0].vars[0].name, "Test reserve");
    assert_eq!(en.defs.meta.hash, d.meta.hash);
    let classic = manifest_data::load_shared(&root).unwrap();
    assert!(manifest_data::locale::data_files(&root, &classic).contains(&"history/main.toml".into()));
    let bad = std::fs::read_to_string(&path)
        .unwrap()
        .replace("title = \"Test treaty\"", "title = \"Test treaty\"\nbalance = 999");
    std::fs::write(path, bad).unwrap();
    assert!(manifest_data::load_locale(tmp.path(), manifest_data::Locale::En, &d, &ai).is_err());
    let bad = std::fs::read_to_string(root.join("worlds/testbed/locales/en/history/main.toml"))
        .unwrap()
        .replace("name = \"Test campaign\"", "name = \"Test campaign\"\ninertia = 0");
    std::fs::write(dir.join("main.toml"), bad).unwrap();
    assert!(manifest_data::load_locale(tmp.path(), manifest_data::Locale::En, &d, &ai).is_err());
}

#[test]
fn a_legacy_snapshot_initializes_dormant_ports_before_the_first_command() {
    let mut d = defs();
    Arc::make_mut(&mut d).history.ports.push(InitialPort {
        port: "test_west".into(),
        state: PortStatus::Dormant,
        faction: None,
    });
    let mut state = World::new(d.clone(), ScenarioId(0), 42).unwrap().state;
    state.history = HistoryState::default();
    let mut w = World::from_snapshot(d, state).unwrap();
    assert_eq!(w.port_status(LocId(0)), PortStatus::Dormant);
    let fleet = w.flagship(OwnerId::Player).unwrap();
    assert!(
        Command::Buy { owner: OwnerId::Player, fleet, good: GoodId(0), qty: 1, max_total: None }.apply(&mut w).is_err()
    );
}
