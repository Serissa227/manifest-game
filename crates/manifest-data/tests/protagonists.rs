//! A9：身份条件、互斥轨道、轻量人物船与出生地见识。
use manifest_core::{
    cast::{PersonKind, relations::RomanceAction},
    replay::StartParams,
    scenario::{Gender, NewGameRequest, ProtagonistIdentity},
    story2::{Condition, Story2Defs},
    *,
};
use serde_json::json;
use std::sync::{Arc, OnceLock};

fn terra() -> Arc<StaticData> {
    static DEFS: OnceLock<Arc<StaticData>> = OnceLock::new();
    DEFS.get_or_init(|| manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "terra16").unwrap()).clone()
}

fn fixture() -> World {
    let mut defs = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let d = Arc::make_mut(&mut defs);
    d.scenarios[0].start_date = [1556, 1, 1];
    d.scenarios[0].control_date = [1556, 1, 1];
    d.story2.tracks.clear();
    let mut w = World::new(defs, ScenarioId(0), 42).unwrap();
    w.state.protagonist = Some(ProtagonistIdentity {
        protagonist: Some("test_hero".into()),
        template: None,
        born: [1540, 1, 1],
        gender: Gender::F,
    });
    w
}

#[test]
fn identity_conditions_accept_shorthand_and_reject_unknown_or_ambiguous_fields() {
    let mut w = fixture();
    for raw in [
        json!({"protagonist":"test_hero"}),
        json!({"kind":"protagonist","protagonist":"test_hero"}),
        json!({"protagonist_in":["other","test_hero"]}),
    ] {
        let c: Condition = serde_json::from_value(raw).unwrap();
        assert!(w.story2_conditions(&[c], 0));
    }
    w.state.protagonist.as_mut().unwrap().protagonist = None;
    w.state.protagonist.as_mut().unwrap().template = Some("custom_pilot".into());
    let c: Condition = serde_json::from_value(json!({"protagonist":"custom_pilot"})).unwrap();
    assert!(w.story2_conditions(&[c], 0));
    for raw in [
        json!({"protagonist":"test_hero","extra":true}),
        json!({"protagonist":4}),
        json!({"romance_open":[]}),
        json!({"protagonist":"a","protagonist_in":["a"]}),
    ] {
        assert!(serde_json::from_value::<Condition>(raw).is_err());
    }
}

#[test]
fn romance_visibility_is_the_same_read_only_age_and_orientation_gate() {
    let mut w = fixture();
    for gender in [Gender::F, Gender::M] {
        w.state.protagonist.as_mut().unwrap().gender = gender;
        for year in [1553, 1556, 1557, 1558, 1559] {
            w.state.day = manifest_core::scenario::day_of(&w.defs, [year, 1, 1]).unwrap();
            for p in &w.defs.cast.persons {
                let before = w.state.clone();
                let condition = Condition::RomanceOpen { romance_open: p.key.clone() };
                assert_eq!(
                    w.story2_conditions(&[condition], 0),
                    w.validate_romance(&p.key, RomanceAction::Heart).is_ok()
                );
                assert_eq!(w.state, before);
            }
        }
    }
}

#[test]
fn filtered_choice_numbers_resolve_to_the_authored_key_and_cannot_access_hidden_choices() {
    let mut w = fixture();
    let tracks: Story2Defs = serde_json::from_value(json!({"tracks":[{
        "key":"identity_choices","name":"身份测试","kind":"request","start":"a","auto":true,
        "chapters":[{"key":"a","title":"选择","text":"身份选项测试。","choices":[
            {"key":"hidden","text":"隐藏。","next":"done","requires":[{"protagonist":"other"}],"effects":[{"kind":"flag","flag":"wrong"}]},
            {"key":"visible","text":"可见。","next":"done","requires":[{"protagonist":"test_hero"}],"effects":[{"kind":"flag","flag":"right"}]}
        ]}]}]})).unwrap();
    Arc::make_mut(&mut w.defs).story2 = tracks;
    w.refresh_story2();
    let before = w.state.clone();
    assert!(Command::StoryAnswer { owner: OwnerId::Player, choice: 1 }.apply(&mut w).is_err());
    assert_eq!(w.state, before);
    Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }.apply(&mut w).unwrap();
    assert!(w.state.story2.flags.contains("right"));
    assert!(!w.state.story2.flags.contains("wrong"));
    assert_eq!(w.state.story2.last.as_ref().unwrap().choice, Some(1));
    assert_eq!(w.state.story2.last.as_ref().unwrap().choice_key.as_deref(), Some("visible"));
}

#[test]
fn loader_rejects_unknown_empty_duplicate_and_contradictory_identity_gates() {
    let mut w = fixture();
    for gate in [
        json!({"protagonist":"missing"}),
        json!({"protagonist_in":[]}),
        json!({"protagonist_in":["missing","missing"]}),
        json!({"romance_open":"missing"}),
    ] {
        let defs: Story2Defs = serde_json::from_value(json!({"tracks":[{"key":"gates","name":"门槛测试","kind":"request","start":"a","chapters":[{"key":"a","title":"门槛","text":"门槛测试。","when":[gate],"choices":[{"key":"go","text":"继续。","next":"done"}]}]}]})).unwrap();
        Arc::make_mut(&mut w.defs).story2 = defs;
        assert!(manifest_data::story2::validate_story_tracks(&w.defs).is_err());
    }
    let d = Arc::make_mut(&mut w.defs);
    d.story2.tracks[0].chapters[0].when = vec![
        Condition::Protagonist { protagonist: "a".into() },
        Condition::ProtagonistIn { protagonist_in: vec!["b".into()] },
    ];
    assert!(manifest_core::story2::graph::validate(&d.story2).iter().any(|e| e.contains("矛盾")));
}

#[test]
fn automatic_and_explicit_track_starts_enforce_identity_without_bypassing_flags() {
    let mut w = fixture();
    let d = Arc::make_mut(&mut w.defs);
    let p = d.cast.persons.first_mut().unwrap();
    p.kind = PersonKind::Protagonist;
    p.main_track = Some("owned_main".into());
    p.npc_track = Some("owned_npc".into());
    let selected = p.key.clone();
    d.story2 = serde_json::from_value(json!({"tracks":[
        {"key":"owned_main","name":"主线测试","kind":"main","start":"a","auto":true,"chapters":[{"key":"a","title":"门槛","text":"主线门槛。","when":[{"kind":"flag","flag":"graduated"}],"choices":[{"key":"go","text":"继续。","next":"done"}]}]},
        {"key":"owned_npc","name":"配角测试","kind":"request","start":"a","auto":true,"chapters":[{"key":"a","title":"门槛","text":"配角门槛。","choices":[{"key":"go","text":"继续。","next":"done"}]}]}
    ]})).unwrap();
    w.state.protagonist.as_mut().unwrap().protagonist = Some(selected);
    w.refresh_story2();
    assert!(w.state.story2.tracks.contains_key("owned_main"));
    assert!(!w.state.story2.tracks.contains_key("owned_npc"));
    assert!(w.pending_story2().is_none());
    let before = w.state.clone();
    assert!(w.start_story2("owned_npc").is_err());
    assert_eq!(w.state, before);
    w.state.story2.flags.insert("graduated".into());
    w.refresh_story2();
    assert_eq!(w.pending_story2().unwrap().track, "owned_main");
    assert_eq!(World::from_snapshot(w.defs.clone(), w.state.clone()).unwrap().state, w.state);
}

#[test]
fn all_nine_protagonists_have_exclusive_tracks_and_non_economic_fleets() {
    let defs = terra();
    let sid = ScenarioId::from_idx(defs.scenarios.iter().position(|s| s.key == "free_1557").unwrap());
    let mut w = World::new(defs.clone(), sid, 42).unwrap();
    w.state.day = manifest_core::scenario::day_of(&defs, [1557, 1, 1]).unwrap();
    let people: Vec<_> = defs.cast.persons.iter().filter(|p| p.kind == PersonKind::Protagonist).collect();
    assert_eq!(people.len(), 9);
    for selected in &people {
        w.state.protagonist = Some(ProtagonistIdentity {
            protagonist: Some(selected.key.clone()),
            template: None,
            born: selected.born,
            gender: selected.gender,
        });
        let before = w.state.clone();
        let fleets = w.person_fleets();
        assert_eq!(fleets.len(), 8, "{}", selected.key);
        assert!(fleets.iter().all(|f| f.person != selected.key));
        assert!(w.person_place(&selected.key).is_none());
        for p in &people {
            assert_eq!(w.protagonist_track_allowed(p.main_track.as_deref().unwrap()), p.key == selected.key);
            assert_eq!(w.protagonist_track_allowed(p.npc_track.as_deref().unwrap()), p.key != selected.key);
        }
        assert_eq!(w.state, before);
    }
    w.state.protagonist = None;
    assert_eq!(w.person_fleets().len(), 9);
    w.state.agents.remove(&OwnerId::Player);
    assert_eq!(w.person_fleets().len(), 9);
    w.state.cast.persons.entry("mio".into()).or_default().alive = Some(false);
    assert_eq!(w.person_fleets().len(), 8);
    assert!(w.person_fleets().iter().all(|p| p.person != "mio"));
}

#[test]
fn named_openings_know_their_home_and_keep_voyage_awards_unset() {
    let defs = terra();
    for f in defs.upbringing.families.iter().filter(|f| !f.protagonists.is_empty()) {
        let sid = ScenarioId::from_idx(defs.scenarios.iter().position(|s| s.key == f.scenario).unwrap());
        let mut start = StartParams::new(sid, 42);
        start.opening = Some(NewGameRequest {
            world: "terra16".into(),
            scenario: f.scenario.clone(),
            protagonist: f.protagonists.first().cloned(),
            ..Default::default()
        });
        let w = World::from_start(defs.clone(), &start, |_| {}).unwrap();
        let home = LocId::from_idx(defs.locations.iter().position(|l| l.key == f.home).unwrap());
        assert!(w.state.explore.visited.contains(&home), "{}", f.key);
        assert!(w.state.explore.is_revealed(defs.map.idx(defs.loc(home).cell)));
        assert!(w.state.story2.flags.iter().all(|f| !f.starts_with("c12_voyage_")));
        assert!(w.person_fleets().is_empty());
    }
}

#[test]
fn authored_opening_cards_preserve_public_copy_and_apply_existing_english() {
    let defs = terra();
    let root = manifest_data::find_data_dir().unwrap();
    let effective = manifest_data::resolve_world(&root, "terra16").unwrap();
    let raw: toml::Value = toml::from_str(&effective.read("opening_catalog.toml").unwrap()).unwrap();
    let mut count = 0;
    for row in raw["opening_catalog"].as_array().unwrap() {
        let Some(card) = row.get("card") else { continue };
        let key = row["key"].as_str().unwrap();
        let actual = defs
            .scenarios
            .iter()
            .flat_map(|s| {
                s.protagonist_defs
                    .iter()
                    .filter_map(|p| p.card.as_ref())
                    .chain(s.template_defs.iter().filter_map(|t| t.card.as_ref()))
            })
            .find(|c| c.key == key)
            .unwrap();
        assert_eq!(actual.name, card["name"].as_str().unwrap());
        assert_eq!(actual.home, card["home"].as_str().unwrap());
        assert!(!actual.known.is_empty());
        assert!(!actual.academy.key.is_empty());
        count += 1;
    }
    assert_eq!(count, 21);
    let classic = manifest_data::resolve_world(&root, "classic").unwrap();
    let ai = manifest_data::load_ai_content(&root).unwrap();
    let (english, issues) = manifest_data::locale::load_world_locale_with_common_texts_lenient(
        &effective,
        &classic,
        manifest_data::Locale::En,
        &defs,
        &ai,
    );
    let missing = issues.iter().filter(|i| i.message == "已有英文覆盖不完整").count();
    println!("英文覆盖缺项 {missing} 条");
    assert!(issues.iter().all(|i| i.message == "已有英文覆盖不完整"), "{issues:?}");
    let card = |d: &StaticData| {
        d.scenarios.iter().flat_map(|s| &s.protagonist_defs).find(|p| p.key == "mio").unwrap().card.clone().unwrap()
    };
    let en = card(&english.defs);
    let zh = card(&defs);
    assert_ne!(en.name, zh.name);
    assert_eq!(en.key, zh.key);
    assert_eq!(en.gender, zh.gender);
    assert_eq!(en.born, zh.born);
    assert_eq!(
        en.bonds.iter().map(|b| &b.person).collect::<Vec<_>>(),
        zh.bonds.iter().map(|b| &b.person).collect::<Vec<_>>()
    );
}
