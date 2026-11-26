//! E62：故事专属转化、阴晴昼夜遮蔽、实际减益与逆转。
#[path = "support/history.rs"]
mod fixture;
use fixture::*;
use manifest_core::{lineages::*, *};
use serde_json::json;
use std::sync::Arc;
fn world() -> World {
    let mut w = fixture::world(json!([]));
    for t in &mut Arc::make_mut(&mut w.defs).story2.tracks {
        t.auto = false;
    }
    w.state.story2 = Default::default();
    w
}
fn transform(w: &mut World) {
    w.start_story2("sample_transformation").unwrap();
    assert_eq!(w.state.story2.pending[0].track, "sample_transformation");
    Command::StoryAnswer { owner: O, choice: 0 }.apply(w).unwrap();
}
fn outside(w: &mut World) {
    w.state.cast.place = Some(cast::CastPlace { loc: w.defs.find_loc("test_west").unwrap(), venue: "quay".into() });
}
fn sky_day(w: &mut World, sky: weather::Sky) {
    let loc = w.defs.find_loc("test_west").unwrap();
    let cell = w.defs.loc(loc).cell;
    let day = (w.day()..w.day() + 3650)
        .find(|d| {
            let mut candidate = w.clone();
            candidate.state.day = *d;
            candidate.weather_at(cell).is_some_and(|v| v.sky == sky)
        })
        .unwrap();
    w.state.day = day;
}
#[test]
fn transform_only_exists_as_a_story_effect_and_reverse_is_a_real_choice() {
    assert!(
        serde_json::from_value::<Command>(json!({"Transform":{"owner":"Player","lineage":"sample_lineage"}})).is_err()
    );
    let mut w = world();
    assert!(w.player_lineage().is_none());
    transform(&mut w);
    assert_eq!(w.player_lineage().unwrap().key, "sample_lineage");
    assert_eq!(w.state.story2.pending[0].track, "sample_reversal");
    Command::StoryAnswer { owner: O, choice: 0 }.apply(&mut w).unwrap();
    assert!(w.player_lineage().is_none());
    assert_eq!(w.state.lineages.strain, 0);
}
#[test]
fn clear_cloudy_fog_rain_night_and_indoor_are_distinct() {
    let mut w = world();
    transform(&mut w);
    outside(&mut w);
    sky_day(&mut w, weather::Sky::Clear);
    assert!(w.lineage_exposed(720));
    assert!(!w.lineage_exposed(0));
    assert!(!w.lineage_exposed(1200));
    w.state.cast.place.as_mut().unwrap().venue = "test_library".into();
    assert!(!w.lineage_exposed(720));
    outside(&mut w);
    for sky in [weather::Sky::Cloudy, weather::Sky::Fog, weather::Sky::Rain] {
        sky_day(&mut w, sky);
        assert!(!w.lineage_exposed(720));
    }
}
#[test]
fn only_equipped_parasol_veil_and_litter_protect() {
    for tag in ["parasol", "veil", "covered_litter"] {
        let mut w = world();
        transform(&mut w);
        outside(&mut w);
        sky_day(&mut w, weather::Sky::Clear);
        let d = Arc::make_mut(&mut w.defs);
        d.items.items.iter_mut().find(|i| i.key == "ring").unwrap().tags.push(tag.into());
        w.grant_item(O, "ring", 1).unwrap();
        assert!(w.lineage_exposed(720));
        Command::Equip {
            owner: O,
            wearer: "captain".into(),
            slot: items::equipment::EquipSlot::Accessory1,
            item: "ring".into(),
        }
        .apply(&mut w)
        .unwrap();
        assert!(!w.lineage_exposed(720));
    }
}
#[test]
fn strain_has_a_cap_affects_checks_and_is_removed_by_reversal() {
    let mut w = world();
    transform(&mut w);
    outside(&mut w);
    w.state.items.owners.entry(O).or_default().skill_xp.insert("lang_test".into(), 100);
    for _ in 0..20 {
        sky_day(&mut w, weather::Sky::Clear);
        advance(&mut w, 1);
    }
    assert_eq!(w.state.lineages.strain, MAX_STRAIN);
    assert_eq!(w.story2_check_value("lang_test"), 80);
    assert_eq!(w.lineage_fleet_penalty(w.flagship(O).unwrap()), 20);
    Command::StoryAnswer { owner: O, choice: 0 }.apply(&mut w).unwrap();
    assert_eq!(w.story2_check_value("lang_test"), 100);
}
#[test]
fn night_sight_and_passive_powers_are_bounded() {
    let mut w = world();
    transform(&mut w);
    assert_eq!(w.lineage_power("night_sight", 0), 2);
    assert_eq!(w.lineage_power("night_sight", 720), 0);
    assert_eq!(w.lineage_power("ward", 720), 5);
}
#[test]
fn missing_reversal_and_repeatable_positive_rewards_are_rejected() {
    for mode in 0..3 {
        let mut w = world();
        let d = Arc::make_mut(&mut w.defs);
        match mode {
            0 => d.lineages.lineages[0].reversal = Some("absent".into()),
            1 => d.lineages.lineages[0].powers = vec![Power::Fog { pct: 21 }],
            _ => d.story2.tracks.iter_mut().find(|t| t.key == "sample_reversal").unwrap().chapters[0].choices[0]
                .effects
                .push(story2::Effect::Cash { value: 1 }),
        };
        assert!(!validation::validate(d).is_empty());
    }
}
#[test]
fn state_replays_and_rejects_unbounded_damage() {
    let mut w = world();
    let mut other = w.clone();
    w.start_story2("sample_transformation").unwrap();
    other.start_story2("sample_transformation").unwrap();
    let day = w.day();
    let cmd = Command::StoryAnswer { owner: O, choice: 0 };
    cmd.apply(&mut w).unwrap();
    advance(&mut w, 1);
    let saved = restored(&w);
    assert_eq!(saved.state_hash(), w.state_hash());
    replay::replay_onto(
        &mut other,
        &[LogEntry { tick: day, seq: 0, source: Source::Player, command: cmd, minute: None }],
        w.day(),
    )
    .unwrap();
    assert_eq!(other.state_hash(), w.state_hash());
    let mut bad = w.state.clone();
    bad.lineages.strain = 21;
    assert!(World::from_snapshot(w.defs.clone(), bad).is_err());
}
#[test]
fn classic_omits_lineages() {
    let d = manifest_data::load_shared(&manifest_data::find_data_dir().unwrap()).unwrap();
    let w = World::new(d, ScenarioId(0), 42).unwrap();
    assert!(serde_json::to_value(w.state).unwrap().get("lineages").is_none());
}

#[test]
fn reversal_must_remain_reachable_without_materials_or_chance() {
    for n in 0..6 {
        let mut w = world();
        let d = Arc::make_mut(&mut w.defs);
        let c = &mut d.story2.tracks.iter_mut().find(|t| t.key == "sample_reversal").unwrap().chapters[0];
        match n {
            0 => c.when.push(story2::Condition::Flag { flag: "unreachable".into(), value: true }),
            1 => c.at = Some("test_east".into()),
            2 => c.choices[0].check = Some(story2::Check { attr: "lang_test".into(), base: 0, per: 0 }),
            3 => c.choices[0].effects.insert(0, story2::Effect::Item { item: "ring".into(), qty: -1 }),
            4 => {
                c.default = Some(c.choices[0].branch());
                c.choices[0].effects.clear();
            }
            _ => c.objectives.push(serde_json::from_value(json!({"kind":"item","item":"ring","qty":1})).unwrap()),
        }
        assert!(!validation::validate(d).is_empty(), "{n}");
    }
}

#[test]
fn snapshots_cannot_apply_lineage_penalties_to_an_ordinary_captain() {
    let w = world();
    assert!(w.player_lineage().is_none());
    for n in 0..2 {
        let mut state = w.state.clone();
        if n == 0 {
            state.lineages.strain = 1;
        } else {
            state.lineages.last_day = Some(w.day());
        }
        assert!(World::from_snapshot(w.defs.clone(), state).is_err());
    }
}

#[test]
fn inherited_only_lineages_need_no_invented_cure_but_cannot_be_transformation_targets() {
    let mut w = world();
    let d = Arc::make_mut(&mut w.defs);
    d.lineages.lineages[0].reversal = None;
    d.lineages.lineages[0].reversal_note = None;
    assert!(validation::validate(d).is_empty());
    assert!(!story2::validation::validate(d).is_empty());
    w.start_story2("sample_transformation").unwrap();
    reject(&mut w, Command::StoryAnswer { owner: O, choice: 0 });
    assert!(w.player_lineage().is_none());
}
