//! 人物和故事内容可调整，坏档的内部矛盾仍被拒绝；修整结果可再次存读档。
use manifest_core::{cast::relations::*, log::LogKind, replay::StartParams, story2::*, *};
use std::sync::Arc;

fn world() -> World {
    let mut d = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let defs = Arc::make_mut(&mut d);
    defs.scenarios[0].start_date = [1558, 1, 1];
    defs.scenarios[0].control_date = [1558, 1, 1];
    defs.story2.tracks = vec![serde_json::from_value(serde_json::json!({
        "key":"migration", "name":"占位", "kind":"main", "start":"first",
        "chapters":[
            {"key":"first", "title":"占位", "text":"占位", "news":"占位", "choices":[
                {"key":"continue", "text":"继续", "next":"second", "effects":[{"kind":"affinity","person":"classmate_a","value":7}]}]},
            {"key":"second", "title":"占位", "text":"占位", "choices":[
                {"key":"continue", "text":"继续", "next":"done"}]}]
    })).unwrap()];
    World::new(d, ScenarioId(0), 42).unwrap()
}

fn load(w: &World, d: Arc<StaticData>) -> World {
    let save = SaveFile::new(&w.defs, StartParams::new(ScenarioId(0), 42), w.state.clone(), Vec::new());
    let parsed = SaveFile::from_json(&save.to_json().unwrap()).unwrap();
    World::from_snapshot(d, parsed.snapshot).unwrap()
}

fn stable_and_runs(mut w: World) {
    let again = load(&w, w.defs.clone());
    assert_eq!(again.state, w.state, "同一内容二次读档不得再次修整或写日志");
    w.end_day().unwrap();
    assert_eq!(w.day(), again.day() + 1);
}

#[test]
fn removed_person_prunes_affection_promises_and_news_and_can_continue() {
    let mut w = world();
    w.change_affinity("classmate_a", 80).unwrap();
    for _ in 0..3 {
        w.remember_experience("classmate_a").unwrap();
    }
    w.promise_to("classmate_a").unwrap();
    Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }.apply(&mut w).unwrap();
    // 见闻中的人物同样由内容 key 引用。
    w.state.story2.news.values_mut().next().unwrap().persons.push("classmate_a".into());
    let mut defs = w.defs.clone();
    let d = Arc::make_mut(&mut defs);
    d.cast.persons.retain(|p| p.key != "classmate_a");
    d.cast.ties.retain(|t| t.a != "classmate_a" && t.b != "classmate_a");
    d.story2.tracks[0].chapters[0].choices[0].effects.clear();
    let loaded = load(&w, defs);
    assert!(!loaded.state.cast.persons.contains_key("classmate_a"));
    assert!(loaded.state.cast.promise.is_none());
    assert!(!loaded.state.cast.promises.contains_key("classmate_a"));
    assert!(loaded.state.story2.news.is_empty());
    assert!(loaded.state.log.iter().any(|l| l.kind == LogKind::CastReconciled));
    assert!(loaded.state.log.iter().any(|l| l.kind == LogKind::StoryReconciled));
    stable_and_runs(loaded);
}

#[test]
fn renamed_current_chapter_waits_at_surviving_checkpoint_without_duplicate_rewards() {
    let mut w = world();
    Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }.apply(&mut w).unwrap();
    let mut defs = w.defs.clone();
    let t = &mut Arc::make_mut(&mut defs).story2.tracks[0];
    t.chapters[1].key = "renamed".into();
    t.chapters[0].choices[0].next = "renamed".into();
    let mut loaded = load(&w, defs);
    assert_eq!(loaded.state.story2.tracks["migration"].chapter, "first");
    assert_eq!(loaded.state.story2.tracks["migration"].status, Status::Waiting);
    assert!(loaded.state.story2.pending.is_empty());
    for _ in 0..5 {
        loaded.end_day().unwrap();
    }
    assert_eq!(loaded.affection("classmate_a").unwrap().affinity, 7);
    assert!(Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }.apply(&mut loaded).is_err());
    stable_and_runs(loaded);
}

#[test]
fn removed_choice_and_news_chapter_are_trimmed_without_rejecting_the_save() {
    let mut w = world();
    Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }.apply(&mut w).unwrap();
    for remove_chapter in [false, true] {
        let mut defs = w.defs.clone();
        let t = &mut Arc::make_mut(&mut defs).story2.tracks[0];
        if remove_chapter {
            t.chapters.remove(0);
            t.start = "second".into();
        } else {
            t.chapters[0].choices.clear();
        }
        let loaded = load(&w, defs);
        assert!(loaded.state.story2.news.is_empty());
        assert!(loaded.state.story2.last.is_none());
        assert_eq!(loaded.state.story2.tracks["migration"].chapter, "second");
        assert_eq!(loaded.affection("classmate_a").unwrap().affinity, 7);
        stable_and_runs(loaded);
    }
}

#[test]
fn disabled_cast_and_story_modules_allow_the_old_save_to_continue() {
    let mut w = world();
    Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }.apply(&mut w).unwrap();
    let mut defs = w.defs.clone();
    Arc::make_mut(&mut defs).cast = Default::default();
    Arc::make_mut(&mut defs).story2 = Default::default();
    let loaded = load(&w, defs);
    assert!(loaded.state.cast.is_empty());
    assert!(loaded.state.story2.is_empty());
    stable_and_runs(loaded);
}

#[test]
fn removed_content_does_not_hide_corrupt_numeric_dates_or_lifetime_promises() {
    let w = world();
    let mut defs = w.defs.clone();
    Arc::make_mut(&mut defs).cast = Default::default();
    Arc::make_mut(&mut defs).story2 = Default::default();
    let mut states = vec![w.state.clone(); 6];
    states[0].cast.persons.entry("classmate_a".into()).or_default().affection.heart = 101;
    states[1].cast.promises.insert("classmate_a".into(), "classmate_b".into());
    states[2].story2.pending[0].day += 1;
    states[3].story2.tracks.get_mut("migration").unwrap().entered += 1;
    let duplicate = states[4].story2.pending[0].clone();
    states[4].story2.pending.push(duplicate);
    states[5].cast.ties.push(TieState {
        a: "classmate_a".into(),
        b: "classmate_b".into(),
        kind: Relation::Friends,
        since: [1557, 99, 1],
        open: false,
    });
    for state in states {
        assert!(World::from_snapshot(defs.clone(), state).is_err());
    }
}

#[test]
fn historical_basis_never_exempts_an_original_character_or_an_invented_love_affair() {
    let w = world();
    let mut a = w.defs.cast.person("classmate_a").unwrap().clone();
    let mut b = w.defs.cast.person("classmate_b").unwrap().clone();
    b.kind = cast::PersonKind::Historical;
    b.gender = scenario::Gender::M;
    b.romance.with.clear();
    let mut tie: TieDef = serde_json::from_value(serde_json::json!({
        "a":a.key,"b":b.key,"kind":"lovers","since":[1558,1,1],"basis":"historical","sources":["占位"]
    }))
    .unwrap();
    assert_eq!(initial_tie_gate(&tie, &a, &b, [1558, 1, 1]), Err(RomanceError::Historical));
    a.kind = cast::PersonKind::Historical;
    assert!(initial_tie_gate(&tie, &a, &b, [1558, 1, 1]).is_err());
    tie.kind = Relation::Partners;
    assert!(initial_tie_gate(&tie, &a, &b, [1558, 1, 1]).is_ok());
    a.kind = cast::PersonKind::Story;
    assert!(initial_tie_gate(&tie, &a, &b, [1558, 1, 1]).is_err());
}

#[test]
fn exact_birth_dates_keep_the_three_year_rule_stable_through_birthdays() {
    let w = world();
    let mut a = w.defs.cast.person("classmate_a").unwrap().clone();
    let mut b = w.defs.cast.person("classmate_b").unwrap().clone();
    a.born = [1530, 6, 1];
    for date in [[1558, 1, 1], [1558, 6, 1], [1558, 6, 2], [1559, 1, 1]] {
        b.born = [1533, 6, 1];
        assert!(romance_gate(&actor(&a, date), &actor(&b, date), RomanceAction::Heart, false).is_ok());
        b.born = [1533, 6, 2];
        assert_eq!(
            romance_gate(&actor(&a, date), &actor(&b, date), RomanceAction::Heart, false),
            Err(RomanceError::NotPeers)
        );
    }
}

#[test]
fn stable_choice_keys_survive_reordering_and_prune_a_removed_first_option() {
    let mut w = world();
    let c = &mut Arc::make_mut(&mut w.defs).story2.tracks[0].chapters[0];
    let mut other = c.choices[0].clone();
    other.key = "other".into();
    c.choices.push(other);
    Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }.apply(&mut w).unwrap();
    let mut defs = w.defs.clone();
    Arc::make_mut(&mut defs).story2.tracks[0].chapters[0].choices.swap(0, 1);
    let loaded = load(&w, defs);
    assert_eq!(loaded.state.story2.news["migration:first"].choice, Some(1));
    assert_eq!(loaded.state.story2.last.as_ref().unwrap().choice, Some(1));
    stable_and_runs(loaded);
    let mut defs = w.defs.clone();
    Arc::make_mut(&mut defs).story2.tracks[0].chapters[0].choices.remove(0);
    let loaded = load(&w, defs);
    assert!(loaded.state.story2.news.is_empty());
    assert!(loaded.state.story2.last.is_none());
    assert_eq!(loaded.affection("classmate_a").unwrap().affinity, 7);
    stable_and_runs(loaded);
}

#[test]
fn declared_mentor_blocks_static_player_and_npc_romance_consistently() {
    let mut w = world();
    let d = Arc::make_mut(&mut w.defs);
    for key in ["classmate_a", "classmate_b"] {
        let p = d.cast.persons.iter_mut().find(|p| p.key == key).unwrap();
        p.born = [1541, 1, 1];
        p.role = "可翻译的说明".into();
    }
    d.cast.ties.clear();
    let mentor: TieDef = serde_json::from_value(serde_json::json!({
        "a":"classmate_a", "b":"classmate_b", "kind":"mentor", "since":[1550,1,1]
    }))
    .unwrap();
    d.cast.ties.push(mentor.clone());
    let dating = TieDef { kind: Relation::Dating, since: [1558, 1, 1], ..mentor };
    assert_eq!(initial_tie_gate_in(&dating, &d.cast, [1558, 1, 1]), Err(RomanceError::Authority));
    d.cast.ties.push(dating);
    w.state.protagonist = Some(scenario::ProtagonistIdentity {
        protagonist: Some("classmate_a".into()),
        template: None,
        born: [1541, 1, 1],
        gender: scenario::Gender::F,
    });
    assert!(w.change_tie("classmate_a", "classmate_b", Relation::Dating).is_err());
    assert!(w.change_heart("classmate_b", 1).is_err());
    assert!(!w.active_ties().iter().any(|t| t.kind == Relation::Dating));
}
