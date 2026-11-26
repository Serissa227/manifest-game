//! I5b 的公开字段、未知见闻隔离及旧故事兼容。
use manifest_appcore::{story_view::story_view_in, story2_view, views::Ctx};
use manifest_core::*;
use serde_json::{Value, json};
use std::{collections::BTreeSet, sync::Arc};
const O: OwnerId = OwnerId::Player;
fn world() -> World {
    let mut defs = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let d = Arc::make_mut(&mut defs);
    d.scenarios[0].start_date = [1558, 1, 1];
    d.scenarios[0].control_date = [1558, 1, 1];
    World::new(defs, ScenarioId(0), 42).unwrap()
}
fn keys(value: &Value) -> BTreeSet<&str> {
    value.as_object().unwrap().keys().map(String::as_str).collect()
}

#[test]
fn side_event_continue_news_and_unread_match_i5b_and_views_are_read_only() {
    let mut w = world();
    let before = w.state.clone();
    let view = serde_json::to_value(story_view_in(Ctx::plain(&w.defs), &w)).unwrap();
    let event = &view["pending"];
    assert_eq!(event["kind"], "side");
    assert_eq!(event["track"], "side_letters");
    assert_eq!(event["choices"], json!([]));
    assert_eq!(event["cast"].as_array().unwrap().len(), 2);
    assert_eq!(event["speaker"]["person"], "classmate_a");
    assert_eq!(event["speaker"]["kind"], "portrait");
    assert_eq!(event["speaker"]["asset"], "test_adult");
    assert_eq!(event["cast"][0]["portrait"], "test_adult");
    assert_eq!(keys(&event["cast"][0]), ["person", "name", "portrait"].into_iter().collect());
    assert_eq!(view["news_unread"], 0);
    assert_eq!(w.state, before);
    Command::StoryAnswer { owner: O, choice: 0 }.apply(&mut w).unwrap();
    let gossip = story2_view::gossip(Ctx::plain(&w.defs), &w, None, None);
    assert_eq!(gossip["unread"], 1);
    let item = &gossip["items"][0];
    assert_eq!(
        keys(item),
        ["id", "day", "text", "persons", "kind", "place", "track", "track_name", "read"].into_iter().collect()
    );
    assert_eq!(item["id"], "side_letters:meet");
    assert_eq!(item["day"], json!([1558, 1, 1]));
    assert_eq!(item["kind"], "seen");
    let view = serde_json::to_value(story_view_in(Ctx::plain(&w.defs), &w)).unwrap();
    assert_eq!(view["last"]["outcomes"][0]["kind"], "news");
    assert_eq!(view["last"]["outcomes"][0]["text"], item["text"]);
    Command::MarkNewsRead { owner: O, ids: vec!["side_letters:meet".into()] }.apply(&mut w).unwrap();
    assert_eq!(story2_view::gossip(Ctx::plain(&w.defs), &w, None, None)["unread"], 0);
}

#[test]
fn gossip_filters_unknown_place_limit_and_uses_translated_display_text() {
    let mut w = world();
    w.state.cast.place = Some(manifest_core::cast::CastPlace { loc: LocId(1), venue: String::new() });
    for _ in 0..4 {
        w.end_day().unwrap();
    }
    assert_eq!(story2_view::gossip(Ctx::plain(&w.defs), &w, None, None), json!({"items":[],"unread":0}));
    w.hear_news_at(LocId(0), false);
    assert_eq!(story2_view::gossip(Ctx::plain(&w.defs), &w, Some(LocId(1)), None)["items"], json!([]));
    assert_eq!(story2_view::gossip(Ctx::plain(&w.defs), &w, None, Some(2))["items"].as_array().unwrap().len(), 2);
    let mut names = (*w.defs).clone();
    let t = names.story2.tracks.iter_mut().find(|t| t.key == "side_letters").unwrap();
    t.name = "Letters".into();
    t.chapters[3].news = Some("They set sail together.".into());
    t.chapters[3].default.as_mut().unwrap().news = None;
    let before = w.state.clone();
    let view = story2_view::gossip(Ctx::plain(&names), &w, None, None);
    assert_eq!(view["items"][0]["text"], "They set sail together.");
    assert_eq!(view["items"][0]["track_name"], "Letters");
    assert_eq!(w.state, before);
}

#[test]
fn i5_commands_round_trip_the_frontend_names_and_classic_has_no_new_state() {
    for v in [
        json!({"Talk":{"owner":"player","person":"mentor","topic":"chat"}}),
        json!({"GiveGoods":{"owner":"player","person":"mentor","good":0,"qty":1}}),
        json!({"RecruitPerson":{"owner":"player","person":"sailor"}}),
        json!({"RequestAudience":{"owner":"player","person":"historian"}}),
        json!({"MarkNewsRead":{"owner":"player","ids":[]}}),
    ] {
        let command: Command = serde_json::from_value(v.clone()).unwrap();
        assert_eq!(command.owner(), Some(O));
        assert_eq!(serde_json::to_value(command).unwrap(), v);
    }
    let d = manifest_data::load(&manifest_data::find_data_dir().unwrap()).unwrap();
    let w = World::new(d, ScenarioId(0), 42).unwrap();
    assert!(serde_json::to_value(&w.state).unwrap().get("story2").is_none());
    assert!(serde_json::to_value(story_view_in(Ctx::plain(&w.defs), &w)).unwrap().get("news_unread").is_none());
}
