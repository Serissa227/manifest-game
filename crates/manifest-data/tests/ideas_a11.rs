//! A11：真实三个按钮的日期边界、原有出发港语义与日期校验。
use manifest_core::{
    Command, OwnerId, ScenarioId, StaticData, World, ideas::Mode, scenario::day_of, world::FleetLocation,
};
use std::sync::{Arc, OnceLock};
#[path = "support/history.rs"]
mod fixture;

fn defs() -> Arc<StaticData> {
    static DEFS: OnceLock<Arc<StaticData>> = OnceLock::new();
    DEFS.get_or_init(|| manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "terra16").unwrap()).clone()
}

#[test]
fn three_authored_modes_are_disabled_before_and_enabled_on_their_start_dates() {
    let d = defs();
    assert_eq!(d.ideas.ports.iter().flat_map(|p| &p.modes).filter(|m| m.from_date.is_some()).count(), 3);
    for (port, mode, year) in
        [("funai", Mode::School, 1580), ("nagasaki", Mode::Charity, 1583), ("macao", Mode::Charity, 1569)]
    {
        let p = d.ideas.port(port).unwrap();
        let m = p.modes.iter().find(|m| m.idea == "catholic" && m.mode == mode).unwrap();
        assert_eq!(m.from_date, Some([year, 1, 1]));
        let sid = ScenarioId::from_idx(d.scenarios.iter().position(|s| s.key == "free_1557").unwrap());
        let mut w = World::new(d.clone(), sid, 42).unwrap();
        if port == "macao" {
            // 澳门还需按既有历史事件正式开港，单独改年份不会结算这条历史。
            w.state.day = day_of(&d, [1557, 12, 31]).unwrap();
            w.end_day().unwrap();
            assert_eq!(w.history_outcome("h13_guangzhou_agreement"), Some("macao_settlement"));
        }
        let loc = d.find_loc(port).unwrap();
        let fleet = w.flagship(OwnerId::Player).unwrap();
        w.fleet_mut(fleet).unwrap().location = FleetLocation::Docked(loc);
        let delta = m.cost.max(10_000);
        w.state.agents.get_mut(&OwnerId::Player).unwrap().cash += delta;
        w.state.money.initial += delta;
        w.state.story2.flags.extend(p.permission.clone());
        for skill in p.language.iter().chain(m.skill.iter()) {
            w.state.items.owners.entry(OwnerId::Player).or_default().skill_xp.insert(skill.clone(), 10_000);
        }
        for (good, qty) in &m.goods {
            w.fleet_mut(fleet).unwrap().cargo.insert(d.find_good(good).unwrap(), *qty);
        }
        let command = Command::Propagate { owner: OwnerId::Player, idea: "catholic".into(), loc, mode };
        w.state.day = day_of(&d, [year - 1, 12, 31]).unwrap();
        assert!(w.location_open(loc), "{port}：日期门槛测试须先满足港口开放条件");
        let before = w.state.clone();
        assert!(
            matches!(command.validate(&w), Err(manifest_core::CommandError::Precondition(reason))
            if !reason.trim().is_empty()),
            "{port}"
        );
        assert!(command.apply(&mut w).is_err());
        assert_eq!(w.state, before);
        w.state.day = day_of(&d, [year, 1, 1]).unwrap();
        command.validate(&w).unwrap_or_else(|e| panic!("{port}: {e}"));
        command.apply(&mut w).unwrap();
    }
}

#[test]
fn invalid_start_dates_are_rejected_and_legacy_from_still_names_a_port() {
    let d = defs();
    for date in [[0, 1, 1], [1580, 0, 1], [1580, 13, 1], [1580, 2, 30]] {
        let mut invalid = d.as_ref().clone();
        invalid.ideas.ports[0].modes[0].from_date = Some(date);
        assert!(!manifest_core::ideas::validation::validate(&invalid).is_empty());
    }
    let sample = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let protect = sample.ideas.ports.iter().flat_map(|p| &p.modes).find(|m| m.mode == Mode::Protect).unwrap();
    assert!(sample.find_loc(protect.from.as_deref().unwrap()).is_some());
    assert_eq!(protect.from_date, None);
}

#[test]
fn a_legacy_active_school_pauses_before_the_new_date_and_resumes_on_it() {
    let mut w = fixture::world(serde_json::json!([]));
    let owner = OwnerId::Player;
    let loc = w.defs.find_loc("test_west").unwrap();
    w.state.items.owners.entry(owner).or_default().skill_xp.insert("lang_test".into(), 2);
    w.state.cast.persons.entry("mentor".into()).or_default().affection.affinity = 60;
    // 无日期字段时仍可按原规则开始，模拟添加门槛前已经保存的活动。
    Command::Propagate { owner, idea: "sample_school".into(), loc, mode: Mode::School }.apply(&mut w).unwrap();
    Arc::make_mut(&mut w.defs).ideas.ports[0].modes.iter_mut().find(|m| m.mode == Mode::School).unwrap().from_date =
        Some([1558, 1, 3]);
    let key = manifest_core::ideas::mode_key("sample_school", Mode::School);
    w = fixture::restored(&w);
    w.end_day().unwrap();
    assert_eq!(w.cast_date(), [1558, 1, 2]);
    assert_eq!(w.state.ideas.ports[&loc].modes[&key].active[&owner].elapsed, 0);
    w.end_day().unwrap();
    assert_eq!(w.cast_date(), [1558, 1, 3]);
    assert_eq!(w.state.ideas.ports[&loc].modes[&key].active[&owner].elapsed, 0);
    // 思想活动在当日结算、推进日期之前处理；现在结算开放日。
    w.end_day().unwrap();
    assert_eq!(w.cast_date(), [1558, 1, 4]);
    assert_eq!(w.state.ideas.ports[&loc].modes[&key].active[&owner].elapsed, 1);
    assert_eq!(fixture::restored(&w).state_hash(), w.state_hash());
}
