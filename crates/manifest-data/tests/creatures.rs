//! E61：有限应对、夜间不改结果、持续鉴定、真实延误与回放。
#[path = "support/history.rs"]
mod fixture;
use fixture::*;
use manifest_core::{creatures::*, *};
use serde_json::json;
use std::sync::Arc;
fn world() -> World {
    let mut w = fixture::world(json!([]));
    w.state.story2.flags.insert("sample_creature_known".into());
    w
}
fn respond(w: &World, response: Response) -> Command {
    Command::RespondCreature { owner: O, encounter: w.state.creatures.pending.as_ref().unwrap().id.clone(), response }
}
#[test]
fn moon_is_bounded_and_pure_for_large_dates() {
    for d in [0, 1, 29, 30, 59, 2953, 1000000, u32::MAX] {
        assert!(moon_phase(d, 0) < 8);
    }
    assert_eq!(moon_phase(0, 0), 0);
    assert_eq!(moon_phase(14, 0), 3);
    assert_eq!(moon_phase(15, 0), 4);
    for d in 0..2953 {
        assert_eq!(moon_phase(d, 0), moon_phase(d + 2953, 0));
    }
}
#[test]
fn unknown_response_and_other_encounter_reject_without_mutation() {
    let mut w = world();
    advance(&mut w, 1);
    let c = respond(&w, Response::Fight);
    reject(&mut w, c);
    reject(&mut w, Command::RespondCreature { owner: O, encounter: "absent".into(), response: Response::Avoid });
    assert!(serde_json::from_value::<Response>(json!("destroy")).is_err());
}
#[test]
fn results_are_bounded_and_identification_is_persistent() {
    let mut w = world();
    advance(&mut w, 1);
    let encounter = w.state.creatures.pending.clone();
    advance(&mut w, 3);
    assert_eq!(w.state.creatures.pending, encounter);
    let id = w.flagship(O).unwrap();
    let before = w.fleet(id).unwrap().clone();
    let c = respond(&w, Response::Observe);
    c.apply(&mut w).unwrap();
    let after = w.fleet(id).unwrap();
    assert!(after.crew >= 1);
    assert!(before.crew - after.crew <= before.crew / 5);
    for (s, b) in after.ships.iter().zip(&before.ships) {
        assert!(s.durability >= 1);
        assert!(b.durability - s.durability <= b.max_durability / 4);
    }
    assert!(w.state.story2.flags.contains("sample_creature_seen"));
    assert_eq!(w.state.creatures.specimens.values().next().unwrap().verdict, Verdict::Fake);
    reject(&mut w, c);
    let saved = restored(&w);
    assert_eq!(saved.state.creatures, w.state.creatures);
}
#[test]
fn night_only_changes_presentation_data() {
    let mut day = world();
    let mut night = day.clone();
    Arc::make_mut(&mut night.defs).creatures.creatures[0].when.night = true;
    advance(&mut day, 1);
    advance(&mut night, 1);
    assert_eq!(day.state, night.state);
    respond(&day, Response::Observe).apply(&mut day).unwrap();
    respond(&night, Response::Observe).apply(&mut night).unwrap();
    assert_eq!(day.state, night.state);
}
#[test]
fn delay_holds_route_but_consumes_supplies() {
    let mut w = world();
    advance(&mut w, 1);
    respond(&w, Response::Avoid).apply(&mut w).unwrap();
    let fleet = w.flagship(O).unwrap();
    let dest = w.defs.find_loc("test_east").unwrap();
    sail(&mut w, O, fleet, dest);
    let before = w.fleet(fleet).unwrap().clone();
    advance(&mut w, 1);
    let after = w.fleet(fleet).unwrap();
    assert_eq!(before.cell(&w.defs), after.cell(&w.defs));
    assert!(after.food < before.food);
    assert_eq!(after.days_at_sea, before.days_at_sea + 1);
    advance(&mut w, 1);
    assert!(!w.creature_delayed(fleet));
}
#[test]
fn replay_restores_exact_pending_and_verdict() {
    let mut w = world();
    advance(&mut w, 1);
    let mut other = w.clone();
    let day = w.day();
    let c = respond(&w, Response::Observe);
    c.apply(&mut w).unwrap();
    advance(&mut w, 1);
    replay::replay_onto(
        &mut other,
        &[LogEntry { tick: day, seq: 0, source: Source::Player, command: c, minute: None }],
        w.day(),
    )
    .unwrap();
    assert_eq!(other.state_hash(), w.state_hash());
    let mut bad = w.state.clone();
    bad.creatures.specimens.values_mut().next().unwrap().item = "absent".into();
    assert!(World::from_snapshot(w.defs.clone(), bad).is_err());
}
#[test]
fn invalid_losses_references_and_unspecified_outcomes_fail() {
    for n in 0..6 {
        let mut w = world();
        let d = Arc::make_mut(&mut w.defs);
        let c = &mut d.creatures.creatures[0];
        match n {
            0 => c.outcomes.get_mut(&Response::Avoid).unwrap().hull_pct = 26,
            1 => c.outcomes.get_mut(&Response::Avoid).unwrap().crew_pct = 21,
            2 => c.outcomes.get_mut(&Response::Avoid).unwrap().delay_days = 8,
            3 => c.when.moon = vec![8],
            4 => c.responses.push(Response::Fight),
            _ => c.books.push("absent".into()),
        };
        assert!(!validation::validate(d).is_empty(), "{n}");
    }
}
#[test]
fn classic_keeps_empty_creature_state_out_of_saves() {
    let d = manifest_data::load_shared(&manifest_data::find_data_dir().unwrap()).unwrap();
    let w = World::new(d, ScenarioId(0), 42).unwrap();
    assert!(serde_json::to_value(w.state).unwrap().get("creatures").is_none());
}

#[test]
fn story_flags_need_real_world_producers() {
    let mut w = world();
    let d = Arc::make_mut(&mut w.defs);
    d.story2.tracks.push(
        serde_json::from_value(json!({
            "key":"creature_clue_test","name":"测试线索","kind":"request","start":"first","auto":false,
            "chapters":[{"key":"first","title":"测试线索","text":"这是怪异线索测试。",
                "when":[{"kind":"flag","flag":"sample_creature_seen","value":true}],
                "choices":[{"key":"done","text":"完成测试。","next":"done"}]}]
        }))
        .unwrap(),
    );
    assert!(story2::graph::validate_world(d).is_empty());
    assert!(story2::graph::validate(&d.story2).iter().any(|e| e.contains("sample_creature_seen")));
    d.creatures.creatures[0].outcomes.get_mut(&Response::Observe).unwrap().clue = None;
    assert!(story2::graph::validate_world(d).iter().any(|e| e.contains("sample_creature_seen")));
}

#[test]
fn moon_season_weather_and_knowledge_are_real_encounter_gates() {
    for n in 0..5 {
        let mut w = world();
        let month = w.defs.calendar.date_of(w.day()).month as u8;
        let phase = moon_phase(w.day(), w.defs.creatures.moon_epoch);
        let sky = w.weather_at(w.defs.loc(w.defs.find_loc("test_west").unwrap()).cell).map(|w| w.sky);
        let c = &mut Arc::make_mut(&mut w.defs).creatures.creatures[0];
        match n {
            0 => c.when.months = vec![month % 12 + 1],
            1 => c.when.moon = vec![(phase + 1) % 8],
            2 => c.ports = vec!["test_east".into()],
            3 => {
                c.when.weather =
                    vec![if sky == Some(weather::Sky::Clear) { weather::Sky::Storm } else { weather::Sky::Clear }]
            }
            _ => {
                w.state.story2.flags.clear();
            }
        }
        advance(&mut w, 1);
        assert!(w.state.creatures.pending.is_none(), "{n}");
    }
}

#[test]
fn delayed_manual_voyage_keeps_every_minute_and_survives_reload() {
    let mut w = world();
    advance(&mut w, 1);
    respond(&w, Response::Avoid).apply(&mut w).unwrap();
    Arc::make_mut(&mut w.defs).manual_navigation = true;
    let fleet = w.flagship(O).unwrap();
    let start = navigation::ManualVoyage::new(w.fleet(fleet).unwrap().cell(&w.defs), 90);
    let pos = start.pos;
    w.fleet_mut(fleet).unwrap().location = world::FleetLocation::AtSea(world::Voyage::Manual { manual: start });
    Command::Steer { owner: O, fleet, minute: 60, heading: Some(180), sail: Some(navigation::Sail::Furled) }
        .apply(&mut w)
        .unwrap();
    let projected = w.navigation_projection(720).unwrap();
    let trace = &projected.state.navigation.traces[&fleet];
    assert_eq!(trace.points.len(), 721);
    assert!(trace.points.iter().all(|p| p.pos == pos));
    assert_eq!(restored(&projected).state_hash(), projected.state_hash());
    w.end_day().unwrap();
    let world::FleetLocation::AtSea(world::Voyage::Manual { manual }) = &w.fleet(fleet).unwrap().location else {
        panic!("延误期间仍应在海上")
    };
    assert_eq!(manual.pos, pos);
    assert_eq!(manual.heading, 180);
    assert_eq!(manual.sail, navigation::Sail::Furled);
}

#[test]
fn book_bonuses_require_distinct_nonreligious_works_and_valid_knowledge_keys() {
    for mode in 0..3 {
        let mut w = world();
        let d = Arc::make_mut(&mut w.defs);
        match mode {
            0 => d.creatures.creatures[0].knowledge = Some("invalid key".into()),
            1 => d.creatures.creatures[0].books = vec!["reader".into(), "reader".into()],
            _ => {
                d.creatures.creatures[0].books = vec!["reader".into()];
                d.items.items.iter_mut().find(|i| i.key == "reader").unwrap().tags.push("scripture".into());
            }
        }
        assert!(!validation::validate(d).is_empty(), "{mode}");
    }
}
