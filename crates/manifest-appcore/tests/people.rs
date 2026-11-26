//! I5/I5b字段、只读性与知识边界；隐藏的世界变化不能穿透到人物卡。
use manifest_appcore::{cast_view, story_log_view, views::Ctx};
use manifest_core::{
    cast::relations::Relation,
    scenario::{Gender, ProtagonistIdentity},
    *,
};
use serde_json::{Value, json};
use std::{collections::BTreeSet, sync::Arc};
const O: OwnerId = OwnerId::Player;
fn world() -> World {
    let mut defs = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let d = Arc::make_mut(&mut defs);
    d.scenarios[0].start_date = [1558, 1, 1];
    d.scenarios[0].control_date = [1558, 1, 1];
    let mut w = World::new(defs, ScenarioId(0), 42).unwrap();
    w.state.protagonist =
        Some(ProtagonistIdentity { protagonist: None, template: None, born: [1540, 1, 1], gender: Gender::F });
    w
}
fn keys(v: &Value) -> BTreeSet<&str> {
    v.as_object().unwrap().keys().map(String::as_str).collect()
}
fn expected(v: &[&'static str]) -> BTreeSet<&'static str> {
    v.iter().copied().collect()
}
fn seen(w: &mut World, person: &str) {
    w.state.cast.persons.entry(person.into()).or_default().met = true;
}
fn detail(w: &World, p: &str) -> Value {
    cast_view::person(Ctx::plain(&w.defs), w, p).unwrap()
}

#[test]
fn cards_details_and_relationships_follow_i5_fields_without_mutating_world() {
    let mut w = world();
    seen(&mut w, "classmate_a");
    seen(&mut w, "classmate_b");
    seen(&mut w, "mentor");
    w.grant_item(O, "ring", 2).unwrap();
    w.start_story2("request_grain").unwrap();
    w.change_heart("classmate_a", 50).unwrap();
    w.change_relation("classmate_a", Relation::Friends, false).unwrap();
    let before = w.state.clone();
    let ctx = Ctx::plain(&w.defs);
    let cards = cast_view::persons(ctx, &w, None);
    assert_eq!(keys(&cards), expected(&["persons"]));
    let card = cards["persons"].as_array().unwrap().iter().find(|p| p["key"] == "classmate_a").unwrap();
    assert_eq!(
        keys(card),
        expected(&[
            "key",
            "name",
            "portrait",
            "age",
            "kind",
            "role",
            // 一句话身份（11-02：玩家不知道有些 NPC 是干什么的）
            "summary",
            "where",
            "affinity",
            "heart",
            "heart_stage",
            "bond",
            "relation",
            "call_name",
            "can_recruit",
            "requests"
        ])
    );
    assert_eq!(card["age"], 18);
    assert_eq!(card["heart"], 50);
    assert_eq!(card["heart_stage"], 2);
    let d = detail(&w, "classmate_a");
    let mut detail_keys = keys(card);
    detail_keys.extend([
        "here",
        "bio_pages",
        "summary",
        "secret",
        "after",
        "likes_known",
        "dislikes_known",
        "birthday",
        "days_to_birthday",
        "memories",
        "topics",
        "gifts",
        "basis",
        "sources",
        "ties",
        "news",
    ]);
    assert_eq!(keys(&d), detail_keys);
    assert_eq!(d["here"], true);
    assert_eq!(d["days_to_birthday"], 0);
    assert_eq!(keys(&d["bio_pages"][0]), expected(&["title", "text"]));
    let gift = d["gifts"].as_array().unwrap().iter().find(|g| g["item"] == "ring").unwrap();
    assert_eq!(keys(gift), expected(&["item", "name", "qty", "reaction"]));
    assert_eq!(gift["reaction"], "unknown");
    assert_eq!(detail(&w, "mentor")["heart"], Value::Null);
    assert_eq!(detail(&w, "mentor")["requests"], 1);
    let graph = cast_view::relationships(ctx, &w);
    assert_eq!(keys(&graph), expected(&["nodes", "edges"]));
    assert_eq!(keys(&graph["nodes"][0]), expected(&["key", "name", "portrait", "kind"]));
    assert!(graph["edges"].as_array().unwrap().iter().any(|e| e["a"] == "$captain" && e["b"] == "classmate_a"));
    assert_eq!(w.state, before);
}

#[test]
fn gifts_topics_location_and_heart_use_live_command_and_identity_gates() {
    let mut w = world();
    seen(&mut w, "classmate_a");
    w.grant_item(O, "ring", 2).unwrap();
    assert_eq!(detail(&w, "classmate_a")["gifts"][0]["reaction"], "unknown");
    Command::GiveItem { owner: O, person: "classmate_a".into(), item: "ring".into(), qty: 1 }.apply(&mut w).unwrap();
    let d = detail(&w, "classmate_a");
    assert_eq!(d["gifts"][0]["reaction"], "love");
    assert_eq!(d["likes_known"].as_array().unwrap().len(), 1);
    assert!(!d["memories"].as_array().unwrap().is_empty());
    let grain = GoodId::from_idx(w.defs.goods.iter().position(|g| g.key == "grain").unwrap());
    Arc::make_mut(&mut w.defs)
        .cast
        .persons
        .iter_mut()
        .find(|p| p.key == "classmate_a")
        .unwrap()
        .likes
        .push("grain".into());
    let fleet = w.fleets_of(O).next().unwrap().id;
    w.state.fleets.get_mut(&fleet).unwrap().cargo.insert(grain, 1);
    Command::GiveGoods { owner: O, person: "classmate_a".into(), good: grain, qty: 1 }.apply(&mut w).unwrap();
    assert!(detail(&w, "classmate_a")["likes_known"].as_array().unwrap().iter().any(|s| s == &w.defs.good(grain).name));
    w.state.protagonist.as_mut().unwrap().born = [1541, 1, 1];
    assert_eq!(detail(&w, "classmate_a")["heart"], Value::Null);
    w.state.cast.place = Some(manifest_core::cast::CastPlace { loc: LocId(1), venue: String::new() });
    let before = w.state.clone();
    let d = detail(&w, "classmate_a");
    assert_eq!(d["where"], Value::Null);
    assert_eq!(d["here"], false);
    assert!(d["topics"].as_array().unwrap().iter().all(|t| t["enabled"] == false && t["blocked_reason"].is_string()));
    assert!(
        cast_view::persons(Ctx::plain(&w.defs), &w, Some(LocId(1)))["persons"]
            .as_array()
            .unwrap()
            .iter()
            .all(|p| p["key"] != "classmate_a")
    );
    w.state.cast.persons.remove("distant");
    assert!(cast_view::person(Ctx::plain(&w.defs), &w, "distant").is_none());
    assert_eq!(w.state.cast.place, before.cast.place);
}

#[test]
fn unknown_autonomous_chapters_never_replace_last_known_ties_or_disclose_future_titles() {
    let mut w = world();
    seen(&mut w, "classmate_a");
    seen(&mut w, "classmate_b");
    Command::StoryAnswer { owner: O, choice: 0 }.apply(&mut w).unwrap();
    let initial = detail(&w, "classmate_a");
    assert_eq!(initial["news"].as_array().unwrap().len(), 1);
    w.state.cast.place = Some(manifest_core::cast::CastPlace { loc: LocId(1), venue: String::new() });
    for _ in 0..4 {
        w.end_day().unwrap();
    }
    assert!(
        w.active_ties().iter().any(|t| t.a == "classmate_a" && t.b == "classmate_b" && t.kind == Relation::Partners)
    );
    let before = w.state.clone();
    let old = detail(&w, "classmate_a");
    assert_eq!(
        old["ties"].as_array().unwrap().iter().find(|t| t["person"] == "classmate_b").unwrap()["kind"],
        "friends"
    );
    let log = story_log_view::story_log(Ctx::plain(&w.defs), &w);
    let track = log["tracks"].as_array().unwrap().iter().find(|t| t["key"] == "side_letters").unwrap();
    assert_eq!(track["chapter"], "meet");
    assert_eq!(track["status"], "waiting");
    assert_eq!(w.state, before);
    w.hear_news_at(LocId(0), false);
    let new = detail(&w, "classmate_a");
    assert_eq!(new["news"].as_array().unwrap().len(), 4);
    assert_eq!(
        new["ties"].as_array().unwrap().iter().find(|t| t["person"] == "classmate_b").unwrap()["kind"],
        "partners"
    );
    assert_eq!(new["bio_pages"].as_array().unwrap().len(), 5);
    assert!(!serde_json::to_string(&new).unwrap().contains("persona"));
}

#[test]
fn task_log_exposes_objectives_deadlines_and_classic_key_adapter_read_only() {
    let mut w = world();
    seen(&mut w, "mentor");
    w.start_story2("request_grain").unwrap();
    let before = w.state.clone();
    let log = story_log_view::story_log(Ctx::plain(&w.defs), &w);
    let t = log["tracks"].as_array().unwrap().iter().find(|t| t["key"] == "request_grain").unwrap();
    assert_eq!(keys(t), expected(&["key", "name", "kind", "status", "chapter", "chapter_title", "objectives"]));
    assert_eq!(t["status"], "waiting");
    let o = &t["objectives"][0];
    assert_eq!(keys(o), expected(&["text", "done", "place", "deadline", "days_left"]));
    assert_eq!(o["deadline"], json!([1558, 1, 11]));
    assert_eq!(o["days_left"], 10);
    assert_eq!(o["done"], false);
    assert_eq!(w.state, before);
    let defs = manifest_data::load(&manifest_data::find_data_dir().unwrap()).unwrap();
    let scenario = defs.scenarios.iter().position(|s| s.story.is_some()).unwrap();
    let classic = World::new(defs, ScenarioId(scenario as u16), 42).unwrap();
    let before = classic.state.clone();
    let log = story_log_view::story_log(Ctx::plain(&classic.defs), &classic);
    assert_eq!(log["tracks"][0]["chapter"], classic.legacy_story_track().unwrap().unwrap().chapter);
    assert_eq!(classic.state, before);
}

#[test]
fn both_shells_share_implemented_query_handlers_with_argument_validation() {
    use manifest_appcore::{AppPaths, AppState, handlers};
    let dir = std::env::temp_dir().join(format!("manifest-a5-views-{}", std::process::id()));
    let st = AppState::from_data_dir(
        &manifest_data::find_data_dir().unwrap(),
        Arc::new(manifest_ai::MemoryKeyStore::default()),
        AppPaths::in_dir(&dir),
    )
    .unwrap();
    let request = serde_json::from_value(json!({"world":"testbed","scenario":"sandbox","seed":42})).unwrap();
    handlers::new_world_game(&st, request).unwrap();
    let before = handlers::debug(&st).unwrap().state_hash;
    assert!(handlers::pending::persons(&st, None).unwrap()["persons"].is_array());
    assert!(handlers::pending::relationships(&st).unwrap()["nodes"].is_array());
    assert!(handlers::pending::story_log(&st).unwrap()["tracks"].is_array());
    assert!(handlers::pending::persons(&st, Some(u16::MAX)).is_err());
    assert!(handlers::pending::person(&st, "missing".into()).is_err());
    assert_eq!(handlers::debug(&st).unwrap().state_hash, before);
}
