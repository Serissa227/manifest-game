//! I6 的公开形状、真实日期和地区文化；反复查询不能改变世界。
use manifest_appcore::{upbringing_view, views::Ctx};
use manifest_core::{
    Command, OwnerId, ScenarioId, World,
    upbringing::{AfterChoice, PlanSlot},
};
use serde_json::{Value, json};
use std::{collections::BTreeSet, sync::Arc};
fn keys(v: &Value, expected: &[&str]) {
    assert_eq!(
        v.as_object().unwrap().keys().map(String::as_str).collect::<BTreeSet<_>>(),
        expected.iter().copied().collect()
    );
}
fn world() -> World {
    let d = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let sid = ScenarioId::from_idx(d.scenarios.iter().position(|s| s.key == "upbringing").unwrap());
    World::new(d, sid, 42).unwrap()
}
fn settle(w: &mut World) {
    while w.pending_story2().is_some() {
        Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }.apply(w).unwrap();
    }
    w.end_day().unwrap();
}
#[test]
fn full_i6_shape_exams_paths_and_culture_are_read_only() {
    let w = world();
    let state = w.state.clone();
    let view = upbringing_view::upbringing(Ctx::plain(&w.defs), &w);
    keys(
        &view,
        &[
            "agenda",
            "cadence",
            "stage",
            "stage_name",
            "home",
            "culture",
            "town",
            "academy",
            "today",
            "phase",
            "protagonist",
            "meters",
            "cash",
            "budget",
            "growth",
            "ratings",
            "skills",
            "plan",
            "lessons",
            "activities",
            "places",
            "excursions",
            "companions",
            "calendar",
            "exams",
            "path",
            "memories",
            "letters",
            "diary",
            "presets",
            "last",
            "books",
            "contests",
            // U04 工作包 4、5：折叠计数、解锁通知与年度目标卡。
            "goals",
            "hidden_count",
            "hidden_lessons",
            "unlocked_now",
        ],
    );
    assert_eq!(view["culture"], w.defs.locations.iter().find(|l| l.key == "test_west").unwrap().culture);
    // 这一阶段所在的城市（养成主画面的城镇背景按它挑）：家乡期是家乡港，名字是显示名，文化是地图上的文化
    let home = w.defs.locations.iter().find(|l| l.key == "test_west").unwrap();
    keys(&view["town"], &["key", "name", "culture"]);
    assert_eq!(view["town"]["key"], "test_west");
    assert_eq!(view["town"]["name"], home.name.as_str());
    assert_eq!(view["town"]["culture"], home.culture.as_str());
    let exam = view["exams"].as_array().unwrap().iter().find(|e| e["key"] == "test_exam_navigation").unwrap();
    keys(exam, &["key", "name", "date", "status", "pass_pct", "requirements", "progress"]);
    assert_eq!(exam["status"], "open");
    assert!(exam["pass_pct"].as_i64().is_some_and(|p| (5..=95).contains(&p)));
    let locked = view["exams"].as_array().unwrap().iter().find(|e| e["key"] == "test_exam_academy").unwrap();
    assert_eq!(locked["status"], "locked");
    assert!(locked["pass_pct"].is_null());
    keys(&view["path"], &["choose_on", "chosen", "options"]);
    assert_eq!(view["path"]["choose_on"], json!([1554, 6, 1]));
    assert_eq!(view["path"]["options"].as_array().unwrap().len(), 3);
    for p in view["path"]["options"].as_array().unwrap() {
        keys(p, &["key", "name", "desc", "hidden", "locked"]);
        assert_eq!(p["locked"], true);
    }
    for a in view["activities"].as_array().unwrap() {
        for p in a["companions"].as_array().unwrap() {
            keys(p, &["key", "name"]);
        }
    }
    assert_eq!(w.state, state);
    let mut d = w.defs.clone();
    {
        let data = Arc::make_mut(&mut d);
        data.upbringing.families[0].stages.remove(0);
        data.upbringing.families[0].stages[0].from = [1553, 1, 1];
        data.upbringing.families[0].stages[0].entry_flag = None;
        data.upbringing.families[0].stages[0].entry_event = None;
        data.upbringing.academies[0].culture = "japanese".into();
    }
    let school = World::new(d, w.state.scenario, 42).unwrap();
    let school_view = upbringing_view::upbringing(Ctx::plain(&school.defs), &school);
    assert_eq!(school_view["stage"], "academy");
    assert_eq!(school_view["culture"], "japanese");
    // 学院期：城市是学院所在的地点（town.culture 仍是地图上的文化，不随学院的文化改）
    let at = school.defs.loc(school.upbringing_location().unwrap());
    assert_eq!(school_view["town"]["key"], at.key.as_str());
    assert_eq!(school_view["town"]["culture"], at.culture.as_str());
    assert!(!school_view["lessons"].as_array().unwrap().is_empty());
}
#[test]
fn journal_uses_real_settlements_and_old_months_survive() {
    let mut w = world();
    for _ in 0..2 {
        Command::PlanMonth {
            owner: OwnerId::Player,
            slots: (0..3)
                .map(|index| PlanSlot { index, lesson: None, after: Some(AfterChoice::activity("rest")) })
                .collect(),
        }
        .apply(&mut w)
        .unwrap();
        let month = w.cast_date()[1];
        while w.cast_date()[1] == month {
            settle(&mut w);
        }
    }
    let state = w.state.clone();
    let view = upbringing_view::upbringing(Ctx::plain(&w.defs), &w);
    let diary = view["diary"].as_array().unwrap();
    assert_eq!(diary.len(), 2);
    assert_eq!(diary[0]["month"], json!([1553, 1]));
    assert_eq!(diary[1]["month"], json!([1553, 2]));
    for entry in diary {
        keys(entry, &["month", "text", "ai"]);
        assert_eq!(entry["ai"], false);
        assert!(!entry["text"].as_str().unwrap().is_empty());
    }
    assert_eq!(w.state.upbringing.as_ref().unwrap().journal.len(), 6);
    assert_eq!(w.state, state);
    assert_eq!(World::from_snapshot(w.defs.clone(), state).unwrap().state, w.state);
}
#[test]
fn memories_and_letters_use_actual_disclosure_days_and_localized_copy() {
    let initial = world();
    let mut defs = initial.defs.clone();
    {
        let d = Arc::make_mut(&mut defs);
        let t = d.story2.tracks.iter_mut().find(|t| t.key == "upbringing_note").unwrap();
        t.chapters[0].choices[0].effects.extend([
            manifest_core::story2::Effect::Memory { memory: "test_memory".into(), title: "占位回忆".into() },
            manifest_core::story2::Effect::Letter { person: "classmate_a".into(), text: "占位。".into() },
        ]);
    }
    let mut w = World::new(defs.clone(), initial.state.scenario, 42).unwrap();
    let sent = w.day();
    let source = defs.story2.tracks.iter().find(|t| t.key != "upbringing_note").unwrap();
    let id = format!("{}:{}", source.key, source.start);
    w.state.story2.news.insert(
        id.clone(),
        manifest_core::story2::News {
            success: None,
            timeout: false,
            choice: None,
            choice_key: None,
            id: id.clone(),
            day: sent,
            text: "占位来信。".into(),
            persons: vec!["classmate_a".into()],
            kind: manifest_core::story2::NewsKind::Heard,
            loc: None,
            track: source.key.clone(),
            known: false,
            read: false,
            rumor_days: 30,
        },
    );
    assert_eq!(upbringing_view::upbringing(Ctx::plain(&defs), &w)["letters"], json!([]));
    Command::PlanMonth {
        owner: OwnerId::Player,
        slots: (0..3)
            .map(|index| PlanSlot { index, lesson: None, after: Some(AfterChoice::activity("rest")) })
            .collect(),
    }
    .apply(&mut w)
    .unwrap();
    for _ in 0..10 {
        settle(&mut w);
    }
    assert_eq!(w.pending_story2().unwrap().track, "upbringing_note");
    Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }.apply(&mut w).unwrap();
    let state = w.state.clone();
    let view = upbringing_view::upbringing(Ctx::plain(&defs), &w);
    let memory = &view["memories"][0];
    keys(memory, &["key", "title", "date", "art", "line"]);
    assert_eq!(memory["date"], json!([1553, 1, 11]));
    let letter = view["letters"].as_array().unwrap().iter().find(|n| n["key"] == id).unwrap();
    keys(letter, &["key", "from", "from_name", "sent", "arrived", "title", "body", "read", "ai"]);
    assert_eq!(letter["sent"], json!([1553, 1, 1]));
    assert_eq!(letter["arrived"], json!([1553, 1, 11]));
    assert_eq!(letter["ai"], false);
    assert_eq!(letter["read"], false);
    let mut names = (*defs).clone();
    let t = names.story2.tracks.iter_mut().find(|t| t.key == "upbringing_note").unwrap();
    if let manifest_core::story2::Effect::Memory { title, .. } = &mut t.chapters[0].choices[0].effects[0] {
        *title = "Placeholder memory".into();
    }
    assert_eq!(upbringing_view::upbringing(Ctx::plain(&names), &w)["memories"][0]["title"], "Placeholder memory");
    assert_eq!(w.state, state);
    let future = w.day() + 1;
    w.state.upbringing.as_mut().unwrap().letter_arrivals.insert(id, future);
    assert!(World::from_snapshot(defs, w.state).is_err());
}

#[test]
fn shared_memory_key_does_not_reveal_an_unvisited_chapter() {
    let initial = world();
    let mut defs = initial.defs.clone();
    {
        let d = Arc::make_mut(&mut defs);
        let actual = d.story2.tracks.iter_mut().find(|t| t.key == "upbringing_note").unwrap();
        actual.chapters[0].art = Some("seen_art".into());
        actual.chapters[0].text = "已经历的占位。".into();
        actual.chapters[0].choices[0]
            .effects
            .push(manifest_core::story2::Effect::Memory {
                memory: "shared_memory".into(), title: "占位回忆".into()
            });
        let mut unseen = actual.clone();
        unseen.key = "unvisited_memory".into();
        unseen.chapters[0].text = "未经历的占位。".into();
        unseen.chapters[0].art = Some("unseen_art".into());
        d.story2.tracks.insert(0, unseen);
    }
    let mut w = World::new(defs, initial.state.scenario, 42).unwrap();
    Command::PlanMonth {
        owner: OwnerId::Player,
        slots: (0..3)
            .map(|index| PlanSlot { index, lesson: None, after: Some(AfterChoice::activity("rest")) })
            .collect(),
    }
    .apply(&mut w)
    .unwrap();
    for _ in 0..10 {
        settle(&mut w);
    }
    assert_eq!(w.pending_story2().unwrap().track, "upbringing_note");
    Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }.apply(&mut w).unwrap();
    assert!(!w.state.story2.tracks.contains_key("unvisited_memory"));
    let view = upbringing_view::upbringing(Ctx::plain(&w.defs), &w);
    let memory = &view["memories"][0];
    assert_eq!(memory["line"], "已经历的占位。");
    assert_eq!(memory["art"], "seen_art");
}

#[test]
fn native_skill_thresholds_mentor_binding_and_scholarship_match_the_engine() {
    let mut w = world();
    w.state.day = manifest_core::scenario::day_of(&w.defs, [1554, 1, 1]).unwrap();
    w.state.story2.flags.insert("test_enrolled".into());
    let d = Arc::make_mut(&mut w.defs);
    d.upbringing.skill_profiles.insert(
        "lang_test".into(),
        manifest_core::upbringing::SkillProfile { thresholds: vec![60, 180, 360], ..Default::default() },
    );
    let academy = &mut d.upbringing.academies[0];
    academy.mentor_roles.insert("lesson_mentor".into(), "mentor".into());
    academy.rules = Some(
        serde_json::from_value(json!({
            "late":{"fame":0,"note":"占位。"},"fighting":{"fame":0,"note":"占位。"},"night_absence":{"fame":0,"note":"占位。"},
            "scholarship":{"rating":"mariner","min":0,"honor_min":0,"fee_discount_pct":50},
            "recommendation":{"exam":"test_exam_navigation","honor_min":0,"item":"ribbon"}
        }))
        .unwrap(),
    );
    let a = d.upbringing.activities.iter_mut().find(|a| a.key == "lesson").unwrap();
    a.cost = 12;
    a.mentor = None;
    a.mentor_role = Some("lesson_mentor".into());
    let mut remote = a.clone();
    remote.key = "remote_lesson".into();
    remote.place.academy = Some("other_academy".into());
    d.upbringing.activities.push(remote);
    w.state.items.owners.entry(OwnerId::Player).or_default().skill_xp.insert("lang_test".into(), 30);
    let view = upbringing_view::upbringing(Ctx::plain(&w.defs), &w);
    let skill = view["skills"].as_array().unwrap().iter().find(|s| s["key"] == "lang_test").unwrap();
    assert_eq!((skill["level"].as_i64(), skill["next"].as_i64()), (Some(0), Some(60)));
    let lesson = view["lessons"].as_array().unwrap().iter().find(|s| s["key"] == "lesson").unwrap();
    assert_eq!(lesson["cost"], 6);
    assert_eq!(lesson["mentor"]["key"], "mentor");
    assert!(view["lessons"].as_array().unwrap().iter().all(|s| s["key"] != "remote_lesson"));
}
