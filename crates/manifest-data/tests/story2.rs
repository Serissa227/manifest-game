//! 多轨道的原子回应、优先级、旁观与配角自治见闻。
use manifest_core::{
    cast::{CastPlace, relations::Relation},
    story2::*,
    *,
};
use std::sync::Arc;
const O: OwnerId = OwnerId::Player;
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
fn answer(choice: u32) -> Command {
    Command::StoryAnswer { owner: O, choice }
}
fn rejects(w: &mut World, c: Command) {
    let before = w.state.clone();
    assert!(c.apply(w).is_err());
    assert_eq!(w.state, before);
}

#[test]
fn four_side_chapters_finish_without_player_and_news_stays_unknown_until_gossip() {
    let mut w = world();
    w.state.cast.place = Some(CastPlace { loc: LocId(1), venue: "tavern".into() });
    w.refresh_story2();
    assert!(w.pending_story2().is_none());
    for expected in [Relation::Friends, Relation::Crush, Relation::Lovers, Relation::Partners] {
        w.end_day().unwrap();
        assert_eq!(w.state.cast.ties[0].kind, expected);
        assert!(w.known_news(None).is_empty());
    }
    assert_eq!(w.state.story2.tracks["side_letters"].status, Status::Done);
    assert_eq!(w.state.story2.news.len(), 4);
    assert_eq!(w.news_unread(), 0);
    rejects(&mut w, Command::MarkNewsRead { owner: O, ids: vec!["side_letters:meet".into()] });
    let saved = World::from_snapshot(w.defs.clone(), w.state.clone()).unwrap();
    assert_eq!(saved.state, w.state);
    w.state.cast.place = Some(CastPlace { loc: LocId(0), venue: "tavern".into() });
    Command::Talk { owner: O, person: "mentor".into(), topic: "gossip".into() }.apply(&mut w).unwrap();
    assert_eq!(w.known_news(None).len(), 4);
    assert_eq!(w.news_unread(), 4);
    let ids = w.known_news(None).iter().map(|n| n.id.clone()).collect();
    Command::MarkNewsRead { owner: O, ids }.apply(&mut w).unwrap();
    assert_eq!(w.news_unread(), 0);
}

#[test]
fn witness_continue_and_involve_choice_change_the_side_story() {
    let mut w = world();
    assert!(w.story2_is_front());
    assert_eq!(w.pending_story2().unwrap().chapter, "meet");
    rejects(&mut w, answer(1));
    answer(0).apply(&mut w).unwrap();
    assert_eq!(w.known_news(None)[0].kind, NewsKind::Seen);
    rejects(&mut w, answer(0));
    w.end_day().unwrap();
    assert_eq!(w.pending_story2().unwrap().chapter, "care");
    answer(1).apply(&mut w).unwrap();
    assert_eq!(w.state.story2.tracks["side_letters"].status, Status::Done);
    for _ in 0..4 {
        w.end_day().unwrap();
    }
    assert_eq!(w.state.cast.ties[0].kind, Relation::Friends);
    assert_eq!(w.state.story2.news.len(), 2);
}

#[test]
fn a_promise_with_the_player_closes_the_conditional_side_track() {
    let mut w = world();
    assert_eq!(w.defs.cast.ties[0].story.as_deref(), Some("side_letters"));
    w.change_affinity("classmate_a", 100).unwrap();
    for _ in 0..3 {
        w.remember_experience("classmate_a").unwrap();
    }
    w.promise_to("classmate_a").unwrap();
    w.refresh_story2();
    assert!(w.pending_story2().is_none());
    w.end_day().unwrap();
    assert_eq!(w.state.story2.tracks["side_letters"].status, Status::Failed);
    assert!(w.state.story2.news.is_empty());
    assert!(w.state.cast.ties.is_empty());
    assert_eq!(w.state.cast.promise.as_deref(), Some("classmate_a"));
}

#[test]
fn passing_hears_only_recent_news_and_a_later_letter_can_reveal_old_news() {
    let mut w = world();
    w.state.cast.place = Some(CastPlace { loc: LocId(1), venue: String::new() });
    w.end_day().unwrap();
    w.hear_news_at(LocId(0), true);
    assert_eq!(w.known_news(None).len(), 1);
    for _ in 0..3 {
        w.end_day().unwrap();
    }
    w.state.day += 40;
    w.hear_news_at(LocId(0), true);
    assert_eq!(w.known_news(None).len(), 1);
    let mut track = w.defs.story2.tracks[0].clone();
    track.key = "letter".into();
    track.auto = false;
    track.chapters=vec![serde_json::from_value(serde_json::json!({"key":"read","title":"来信","text":"朋友捎来近况。","choices":[{"key":"read","text":"展开信纸","next":"done","effects":[{"kind":"letter","person":"classmate_a","text":"我们已一同远航。"}]}]})).unwrap()];
    track.start = "read".into();
    Arc::make_mut(&mut w.defs).story2.tracks.push(track);
    w.start_story2("letter").unwrap();
    answer(0).apply(&mut w).unwrap();
    assert_eq!(w.known_news(None).len(), 4);
    assert_eq!(w.known_news(None).iter().filter(|n| n.kind == NewsKind::Letter).count(), 3);
}

#[test]
fn queue_has_stable_priority_and_works_without_a_fleet() {
    let mut d = defs();
    let data = Arc::make_mut(&mut d);
    data.story2.tracks.clear();
    for (key, kind) in [("z", "main"), ("h", "history"), ("e", "encounter"), ("r", "request"), ("a", "main")] {
        data.story2.tracks.push(serde_json::from_value(serde_json::json!({"key":key,"name":key,"kind":kind,"start":"start","chapters":[{"key":"start","title":"同日事件","text":"一段记事。","choices":[{"key":"continue","text":"继续","next":"done"}]}]})).unwrap());
    }
    let mut w = World::new(d, ScenarioId(0), 42).unwrap();
    w.state.fleets.retain(|_, f| f.owner != O);
    w.refresh_story2();
    for key in ["a", "z", "h", "r", "e"] {
        assert_eq!(w.pending_story2().unwrap().track, key);
        answer(0).apply(&mut w).unwrap();
    }
    rejects(&mut w, answer(0));
    assert!(w.pending_story2().is_none());
}

#[test]
fn invalid_default_effects_cannot_turn_minors_into_lovers_or_partially_apply() {
    let mut d = defs();
    let data = Arc::make_mut(&mut d);
    data.cast.persons.iter_mut().find(|p| p.key == "classmate_b").unwrap().born = [1541, 1, 1];
    let track = data.story2.tracks.iter_mut().find(|t| t.key == "side_letters").unwrap();
    track.chapters[0].default.as_mut().unwrap().effects = vec![
        Effect::Affinity { person: "classmate_a".into(), value: 50 },
        Effect::Tie { a: "classmate_a".into(), b: "classmate_b".into(), relation: Relation::Lovers, remove: false },
    ];
    let mut w = World::new(d, ScenarioId(0), 42).unwrap();
    rejects(&mut w, answer(0));
    w.state.cast.place = Some(CastPlace { loc: LocId(1), venue: String::new() });
    w.end_day().unwrap();
    assert_eq!(w.state.story2.tracks["side_letters"].status, Status::Failed);
    assert!(w.state.story2.news.is_empty());
    assert_eq!(w.affection("classmate_a").unwrap().affinity, 0);
    assert!(w.active_ties().iter().all(|t| t.kind != Relation::Lovers));
}

#[test]
fn request_branches_wait_for_the_next_window_and_expire_explicitly() {
    let mut w = world();
    answer(0).apply(&mut w).unwrap();
    Command::Talk { owner: O, person: "mentor".into(), topic: "request".into() }.apply(&mut w).unwrap();
    assert_eq!(w.pending_story2().unwrap().track, "request_letters");
    answer(0).apply(&mut w).unwrap();
    assert_eq!(w.state.story2.tracks["request_letters"].chapter, "return");
    w.start_story2("request_charts").unwrap();
    answer(1).apply(&mut w).unwrap();
    assert_eq!(w.state.story2.tracks["request_charts"].status, Status::Failed);
    w.state.cast.place = Some(CastPlace { loc: LocId(1), venue: String::new() });
    for _ in 0..4 {
        w.end_day().unwrap();
    }
    assert_eq!(w.state.story2.tracks["request_letters"].status, Status::Failed);
}

#[test]
fn queued_answers_and_autonomous_defaults_replay_and_save_byte_for_byte() {
    use manifest_core::replay::{LogEntry, Source, StartParams, replay};
    let d = defs();
    let mut w = World::new(d.clone(), ScenarioId(0), 42).unwrap();
    let day = w.day();
    let command = answer(0);
    command.apply(&mut w).unwrap();
    let log = vec![LogEntry { minute: None, tick: day, seq: 0, source: Source::Player, command }];
    for _ in 0..4 {
        w.end_day().unwrap();
    }
    let replayed = replay(d.clone(), StartParams::new(ScenarioId(0), 42), &log, day + 4).unwrap();
    assert_eq!(serde_json::to_vec(&replayed.state).unwrap(), serde_json::to_vec(&w.state).unwrap());
    let save = SaveFile::new(&d, StartParams::new(ScenarioId(0), 42), w.state.clone(), log);
    let loaded = SaveFile::from_json(&save.to_json().unwrap()).unwrap();
    let restored = World::from_snapshot(d, loaded.snapshot).unwrap();
    assert_eq!(restored.state, w.state);
}

fn copy_data(from: &std::path::Path, to: &std::path::Path) {
    std::fs::create_dir_all(to).unwrap();
    for e in std::fs::read_dir(from).unwrap() {
        let e = e.unwrap();
        let dest = to.join(e.file_name());
        if e.path().is_dir() {
            copy_data(&e.path(), &dest);
        } else {
            std::fs::copy(e.path(), dest).unwrap();
        }
    }
}

#[test]
fn the_new_queue_and_legacy_pending_event_share_priority_without_rewriting_legacy_state() {
    use manifest_core::story::{StoryPending, StorySource};
    let mut d = manifest_data::load(&manifest_data::find_data_dir().unwrap()).unwrap();
    let scenario = ScenarioId::from_idx(d.scenarios.iter().position(|s| s.story.is_some()).unwrap());
    Arc::make_mut(&mut d).story2.tracks.push(serde_json::from_value(serde_json::json!({"key":"new_track","name":"新轨道","kind":"history","start":"start","chapters":[{"key":"start","title":"另一个故事","text":"可以独立推进。","choices":[{"key":"continue","text":"继续","next":"done"}]}]})).unwrap());
    let mut w = World::new(d, scenario, 42).unwrap();
    let fleet = w.flagship(O).unwrap();
    w.state.story.pending = Some(StoryPending { day: w.day(), fleet, source: StorySource::Chapter(0) });
    assert!(!w.story2_is_front());
    let encounter = w.defs.stories.encounters[0].key.clone();
    w.state.story.pending = Some(StoryPending { day: w.day(), fleet, source: StorySource::Encounter(encounter) });
    let old = w.state.story.clone();
    assert!(w.story2_is_front());
    answer(0).apply(&mut w).unwrap();
    assert_eq!(w.state.story, old);
    assert_eq!(w.state.story2.tracks["new_track"].status, Status::Done);
    assert!(!w.story2_is_front());
    assert!(w.state.story2.last.is_some());
    let choices = w.story_event(&w.state.story.pending.as_ref().unwrap().source).unwrap().choices().len();
    let choice = (0..choices as u32).find(|i| answer(*i).validate(&w).is_ok()).unwrap();
    answer(choice).apply(&mut w).unwrap();
    assert!(w.state.story2.last.is_none());
    assert!(w.state.story.last.is_some());
}

#[test]
fn sailing_back_to_the_actual_players_port_reveals_recent_local_news() {
    let mut w = world();
    let fleet = w.flagship(O).unwrap();
    Command::SetSail { owner: O, fleet, dest: LocId(1) }.apply(&mut w).unwrap();
    for _ in 0..30 {
        w.end_day().unwrap();
        if w.fleet(fleet).unwrap().docked_at() == Some(LocId(1)) {
            break;
        }
    }
    assert_eq!(w.fleet(fleet).unwrap().docked_at(), Some(LocId(1)));
    assert!(w.known_news(None).is_empty());
    assert!(!w.state.story2.news.is_empty());
    Command::SetSail { owner: O, fleet, dest: LocId(0) }.apply(&mut w).unwrap();
    for _ in 0..30 {
        w.end_day().unwrap();
        if w.fleet(fleet).unwrap().docked_at() == Some(LocId(0)) {
            break;
        }
    }
    assert_eq!(w.fleet(fleet).unwrap().docked_at(), Some(LocId(0)));
    assert!(!w.known_news(None).is_empty());
    assert!(w.known_news(None).iter().all(|n| n.kind == NewsKind::Heard));
}

#[test]
fn snapshots_reject_internal_mismatches_future_events_and_forged_news_but_trim_removed_choices() {
    let mut w = world();
    let mut state = w.state.clone();
    state.story2.pending[0].day = w.day() + 1;
    assert!(World::from_snapshot(w.defs.clone(), state).is_err());
    let mut state = w.state.clone();
    state.story2.tracks.get_mut("side_letters").unwrap().chapter = "missing".into();
    assert!(World::from_snapshot(w.defs.clone(), state).is_err());
    answer(0).apply(&mut w).unwrap();
    let mut state = w.state.clone();
    state.story2.last.as_mut().unwrap().choice = Some(99);
    state.story2.last.as_mut().unwrap().choice_key = None; // 模拟缺少稳定选项键的旧档。
    let restored = World::from_snapshot(w.defs.clone(), state).unwrap();
    assert!(restored.state.story2.last.is_none());
    assert!(matches!(restored.state.log.last().unwrap().kind, manifest_core::log::LogKind::StoryReconciled));
    for future in [false, true] {
        let mut state = w.state.clone();
        let n = state.story2.news.values_mut().next().unwrap();
        if future {
            n.day = w.day() + 1;
        } else {
            n.known = false;
            n.read = true;
        }
        assert!(World::from_snapshot(w.defs.clone(), state).is_err());
    }
}

#[test]
fn loader_rejects_unknown_fields_references_bad_windows_and_unsafe_default_effects() {
    let tmp = tempfile::tempdir().unwrap();
    copy_data(&manifest_data::find_data_dir().unwrap(), tmp.path());
    let path = tmp.path().join("worlds/testbed/stories/tracks.toml");
    let original = std::fs::read_to_string(&path).unwrap();
    for (old, new) in [
        ("key = \"side_letters\"", "key = \"side_letters\"\nunknown = true"),
        ("next = \"care\"", "next = \"missing\""),
        ("at = \"test_west\"", "at = \"missing\""),
        ("window = [[1558, 1, 1], [1558, 1, 2]]", "window = [[1558, 1, 3], [1558, 1, 2]]"),
        ("window = [[1558, 1, 3], [1558, 1, 3]]", "window = [[1557, 1, 3], [1557, 1, 3]]"),
        ("kind = \"history\"", "kind = \"history\"\nacademy = true"),
    ] {
        assert!(original.contains(old));
        std::fs::write(&path, original.replacen(old, new, 1)).unwrap();
        assert!(manifest_data::load_world(tmp.path(), "testbed").is_err(), "{new}");
    }
}

#[test]
fn display_translation_uses_source_and_composite_keys_without_changing_gameplay() {
    let tmp = tempfile::tempdir().unwrap();
    copy_data(&manifest_data::find_data_dir().unwrap(), tmp.path());
    let mut d = manifest_data::load(tmp.path()).unwrap();
    let fixture = defs();
    Arc::make_mut(&mut d).story2 = fixture.story2.clone();
    std::fs::write(tmp.path().join("locales/en/stories/tracks.toml"),"[tracks.side_letters]\nname='Letters'\n[chapters.\"side_letters:meet\"]\ntitle='At the quay'\ntext='Two friends meet.'\nnews='They exchanged letters.'\n[choices.\"side_letters:care:friendship\"]\ntext='Wish them well.'\nnews='They part as friends.'\n").unwrap();
    let ai = manifest_data::load_ai_content(tmp.path()).unwrap();
    let display = manifest_data::load_locale(tmp.path(), manifest_data::Locale::En, &d, &ai).unwrap();
    let raw = d.story2.track("side_letters").unwrap();
    let translated = display.defs.story2.track("side_letters").unwrap();
    assert_eq!(translated.name, "Letters");
    assert_eq!(translated.chapters[0].title, "At the quay");
    assert_eq!(translated.chapters[1].choices[1].text, "Wish them well.");
    assert_eq!(raw.chapters[0].default, translated.chapters[0].default);
    assert_eq!(raw.chapters[0].window, translated.chapters[0].window);
    assert_ne!(raw.name, translated.name);
}

#[test]
fn both_seventeen_year_old_npcs_cannot_become_lovers_through_an_unseen_default() {
    let mut d = defs();
    let data = Arc::make_mut(&mut d);
    for key in ["classmate_a", "classmate_b"] {
        data.cast.persons.iter_mut().find(|p| p.key == key).unwrap().born = [1541, 1, 1];
    }
    let track = data.story2.tracks.iter_mut().find(|t| t.key == "side_letters").unwrap();
    track.chapters[0].default.as_mut().unwrap().effects = vec![
        Effect::Affinity { person: "classmate_a".into(), value: 50 },
        Effect::Tie { a: "classmate_a".into(), b: "classmate_b".into(), relation: Relation::Lovers, remove: false },
    ];
    let mut w = World::new(d, ScenarioId(0), 42).unwrap();
    assert_eq!(w.defs.cast.person("classmate_a").unwrap().age_on(w.cast_date()), Some(17));
    assert_eq!(w.defs.cast.person("classmate_b").unwrap().age_on(w.cast_date()), Some(17));
    w.state.cast.place = Some(CastPlace { loc: LocId(1), venue: String::new() });
    w.end_day().unwrap();
    assert_eq!(w.state.story2.tracks["side_letters"].status, Status::Failed);
    assert!(w.state.story2.news.is_empty());
    assert_eq!(w.affection("classmate_a").unwrap().affinity, 0);
    assert!(w.state.cast.ties.iter().all(|t| t.kind != Relation::Lovers));
}
