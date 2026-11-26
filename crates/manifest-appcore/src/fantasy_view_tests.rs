//! I8字段、知识隔离、夜间展示与统一处理函数。
use crate::{views::Ctx, *};
use manifest_core::*;
use serde_json::{Value, json};
use std::{
    collections::BTreeSet,
    sync::{Arc, OnceLock},
};
const O: OwnerId = OwnerId::Player;
fn defs() -> Arc<StaticData> {
    static BASE: OnceLock<Arc<StaticData>> = OnceLock::new();
    let mut defs = BASE
        .get_or_init(|| manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap())
        .clone();
    let d = Arc::make_mut(&mut defs);
    d.scenarios[0].start_date = [1558, 1, 1];
    d.scenarios[0].control_date = [1558, 1, 1];
    d.story2 = Default::default();
    d.history = Default::default();
    for p in &mut d.cast.persons {
        p.tracks.clear();
    }
    d.realms = serde_json::from_value(json!({"realms":[{
        "key":"view_realm","name":"测试秘境","basis":"original","sources":["E66视图测试"],
        "veil":{"cells":[d.loc(LocId(1)).cell],"push":1},"key_items":["ring"],"ports":["test_east"],
        "also":[{"kind":"flag","flag":"private_realm_condition","value":true}],
        "hint":"这是视图测试秘境。","rules":["这是视图测试规矩。"]
    }]}))
    .unwrap();
    defs
}
fn world() -> World {
    World::new(defs(), ScenarioId(0), 42).unwrap()
}
fn keys(v: &Value) -> BTreeSet<&str> {
    v.as_object().unwrap().keys().map(String::as_str).collect()
}
fn expected<'a>(v: &[&'a str]) -> BTreeSet<&'a str> {
    v.iter().copied().collect()
}
#[test]
fn four_views_have_exact_i8_fields_and_queries_leave_state_untouched() {
    let mut w = world();
    w.state.societies.met.insert("sample_society".into());
    w.state.arcana.learned.insert("sample_wind".into());
    w.grant_item(O, "ring", 1).unwrap();
    let before = w.state.clone();
    let locales = Locales::load(&manifest_data::find_data_dir().unwrap()).unwrap();
    let ctx = Ctx { names: &w.defs, ..locales.ctx(manifest_data::Locale::ZhCn) };
    let s = crate::societies_view::societies(ctx, &w);
    assert_eq!(keys(&s), expected(&["societies", "suspicion"]));
    assert_eq!(
        keys(&s["societies"][0]),
        expected(&[
            "key",
            "name",
            "secrecy",
            "known",
            "rank",
            "rank_name",
            "ranks",
            "trial",
            "allies",
            "enemies",
            "seat",
            "basis",
            "sources",
            "active",
            "can_join",
            "blocked_reason"
        ])
    );
    assert_eq!(keys(&s["societies"][0]["ranks"][0]), expected(&["n", "name", "requirement", "reward", "done"]));
    assert_eq!(s["societies"][0]["blocked_reason"], ctx.error(&w.can_join_society(O, "sample_society").unwrap_err()));
    assert!(!s["societies"][0]["blocked_reason"].as_str().unwrap().contains("society."));
    let a = crate::arcana_view::arcana(ctx, &w);
    assert_eq!(keys(&a), expected(&["schools", "spells"]));
    assert_eq!(keys(&a["schools"][0]), expected(&["key", "name", "level", "basis", "sources"]));
    assert_eq!(
        keys(&a["spells"][0]),
        expected(&[
            "key",
            "name",
            "school",
            "rank",
            "desc",
            "cost",
            "cooldown_left",
            "targets",
            "enabled",
            "source",
            "blocked_reason"
        ])
    );
    let ships = crate::legend_ships_view::legend_ships(ctx, &w);
    assert_eq!(keys(&ships), expected(&["ships"]));
    assert_eq!(
        keys(&ships["ships"][0]),
        expected(&[
            "key",
            "name",
            "hull",
            "traits",
            "state",
            "lore",
            "acquire",
            "basis",
            "sources",
            "can_commission",
            "blocked_reason"
        ])
    );
    assert_eq!(keys(&ships["ships"][0]["traits"][0]), expected(&["key", "name", "text"]));
    assert_eq!(
        ships["ships"][0]["hull"],
        json!(w.defs.ships.iter().find(|h| h.key == w.defs.legend_ships.ships[0].hull).unwrap().name)
    );
    assert_eq!(crate::realms_view::realms(ctx, &w), json!({"realms":[]}));
    assert_eq!(w.state, before);
    w.state.realms.states.insert("view_realm".into(), realms::RealmStatus::Heard);
    let r = crate::realms_view::realms(Ctx::plain(&w.defs), &w);
    assert_eq!(keys(&r["realms"][0]), expected(&["key", "name", "state", "hint", "key_items", "key_any", "rules"]));
    assert_eq!(keys(&r["realms"][0]["key_items"][0]), expected(&["item", "name", "have"]));
    assert_eq!(r["realms"][0]["key_items"][0]["have"], true);
    assert_eq!(r["realms"][0]["key_any"], json!([]));
    assert!(!r.to_string().contains("private_realm_condition"));
}
#[test]
fn realm_any_key_groups_show_items_and_started_tracks_without_private_flags() {
    let mut w = world();
    let d = Arc::make_mut(&mut w.defs);
    d.realms.realms[0].key_items.clear();
    d.realms.realms[0].key_any = serde_json::from_value(json!([
        {"items":["ring"],"flags":["private_key_flag"]},
        {"completed_tracks":["view_star_road"]}
    ]))
    .unwrap();
    d.story2.tracks.push(
        serde_json::from_value(
            json!({"key":"view_star_road","name":"测试星路","kind":"request","start":"a","chapters":[]}),
        )
        .unwrap(),
    );
    w.state.realms.states.insert("view_realm".into(), realms::RealmStatus::Heard);
    w.grant_item(O, "ring", 1).unwrap();
    let before = w.state.clone();
    let r = crate::realms_view::realms(Ctx::plain(&w.defs), &w);
    let any = &r["realms"][0]["key_any"];
    assert_eq!(keys(&any[0]), expected(&["items", "tracks", "met"]));
    assert_eq!(any[0]["items"][0]["have"], true);
    // 组内全部满足才算：旗标还没有，这一组不成立，旗标名也不出现在视图里。
    assert_eq!(any[0]["met"], false);
    assert!(!r.to_string().contains("private_key_flag"));
    // 线还没开始：不报线名。
    assert_eq!(any[1]["tracks"][0], json!({"name":null,"done":false}));
    assert_eq!(any[1]["met"], false);
    assert_eq!(w.state, before);
    w.state.story2.flags.insert("private_key_flag".into());
    w.state.story2.tracks.insert(
        "view_star_road".into(),
        manifest_core::story2::TrackState {
            chapter: "a".into(),
            visited: Default::default(),
            entered: 0,
            status: manifest_core::story2::Status::Done,
            failure: None,
        },
    );
    let r = crate::realms_view::realms(Ctx::plain(&w.defs), &w);
    let any = &r["realms"][0]["key_any"];
    assert_eq!(any[0]["met"], true);
    assert_eq!(any[1]["tracks"][0], json!({"name":"测试星路","done":true}));
    assert_eq!(any[1]["met"], true);
}
#[test]
fn hidden_entries_and_private_requirements_do_not_escape_as_names_or_reasons() {
    let mut w = world();
    let d = Arc::make_mut(&mut w.defs);
    let s = &mut d.societies.societies[0];
    s.secrecy = 3;
    s.knowledge = Some("secret_society_knowledge".into());
    s.ranks[0].requires =
        serde_json::from_value(json!([{"kind":"flag","flag":"private_trial_flag","value":true}])).unwrap();
    let a = &mut d.arcana.spells[0];
    a.public = false;
    let mut secret = d.legend_ships.ships[0].clone();
    secret.key = "hidden_ship".into();
    secret.name = "秘密船名".into();
    secret.acquire.blueprint = Some("sealed_letter".into());
    d.legend_ships.ships.push(secret);
    let ctx = Ctx::plain(&w.defs);
    let before = w.state.clone();
    assert_eq!(crate::societies_view::societies(ctx, &w)["societies"], json!([]));
    assert_eq!(crate::arcana_view::arcana(ctx, &w), json!({"schools":[],"spells":[]}));
    assert_eq!(crate::legend_ships_view::legend_ships(ctx, &w), json!({"ships":[]}));
    assert_eq!(w.state, before);
    w.state.societies.met.insert("sample_society".into());
    let text = crate::societies_view::societies(Ctx::plain(&w.defs), &w).to_string();
    for hidden in ["private_trial_flag", "secret_society_knowledge", "requires"] {
        assert!(!text.contains(hidden));
    }
    let identity = crate::story_log_view::requirement(
        Ctx::plain(&w.defs),
        &w,
        &story2::Condition::Lineage {
            lineage: "private_lineage_identity".into(),
            person: Some("private_person_identity".into()),
        },
    );
    assert_eq!(identity, "族裔条件");
    assert!(!identity.contains("private_lineage_identity") && !identity.contains("private_person_identity"));
}
fn app(night: bool) -> AppState {
    static N: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let n = N.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!("manifest-a8-view-{}-{n}", std::process::id()));
    let base = AppState::from_data_dir(
        &manifest_data::find_data_dir().unwrap(),
        Arc::new(manifest_ai::MemoryKeyStore::default()),
        AppPaths::in_dir(&dir),
    )
    .unwrap();
    let resources = base.worlds().get("testbed").unwrap();
    let mut defs = defs();
    let d = Arc::make_mut(&mut defs);
    d.creatures.creatures[0].when.night = night;
    d.creatures.creatures[0].knowledge = None;
    let mut locales = resources.locales.clone();
    Arc::make_mut(&mut locales.zh).defs = defs.clone();
    Arc::make_mut(&mut locales.en).defs = defs.clone();
    let st = AppState::new(
        defs,
        resources.content.clone(),
        locales,
        Arc::new(manifest_ai::MemoryKeyStore::default()),
        base.paths().clone(),
    )
    .unwrap();
    let mut settings = st.settings();
    settings.ai.mode = manifest_ai::AiMode::Off;
    settings.autosave_days = 0;
    handlers::save_settings(&st, settings).unwrap();
    handlers::new_world_game(
        &st,
        serde_json::from_value(json!({"world":"testbed","scenario":"sandbox","seed":42})).unwrap(),
    )
    .unwrap();
    st
}
#[test]
fn night_encounter_pauses_exactly_at_eighteen_without_advancing_the_core_day() {
    let st = app(true);
    handlers::set_speed(&st, 1).unwrap();
    // 新局默认08:00；先走到次日06:00，随后精确检查夜间展示边界。
    let to_next_day = crate::clock::minutes_to_day_start(handlers::overview(&st).unwrap().minute);
    let first = handlers::advance_clock(&st, to_next_day).unwrap().unwrap();
    assert_eq!(first.days, 1);
    assert_eq!(first.clock.minute, 360);
    let hash = handlers::debug(&st).unwrap().state_hash;
    let day = first.clock.day;
    assert!(handlers::overview(&st).unwrap().story.unwrap().pending.is_none());
    handlers::advance_clock(&st, 719).unwrap();
    assert_eq!(handlers::overview(&st).unwrap().minute, 1079);
    handlers::save_game(&st, "night").unwrap();
    handlers::load_game(&st, "night").unwrap();
    handlers::set_speed(&st, 1).unwrap();
    let pause = handlers::advance_clock(&st, 120).unwrap().unwrap();
    assert_eq!(pause.clock.minute, 1080);
    assert_eq!(pause.clock.day, day);
    assert_eq!(pause.days, 0);
    assert_eq!(handlers::current_speed(&st), 0);
    assert_eq!(handlers::debug(&st).unwrap().state_hash, hash);
    assert!(handlers::overview(&st).unwrap().story.unwrap().pending.is_some());
    let result = handlers::submit(&st, Command::StoryAnswer { owner: O, choice: 1 }).unwrap();
    assert!(result.overview.story.unwrap().last.is_some());
    assert!(st.game().unwrap().as_ref().unwrap().session.world.creature_pending().is_none());
}
#[test]
fn next_day_does_not_rewind_an_already_visible_night_and_daytime_stops_at_six() {
    let st = app(true);
    let after = handlers::step(&st, 1).unwrap();
    assert_eq!(after.minute, 1080);
    let hash = handlers::debug(&st).unwrap().state_hash;
    st.game().unwrap().as_mut().unwrap().minute = 1140;
    assert_eq!(handlers::step(&st, 7).unwrap().minute, 1140);
    assert_eq!(handlers::debug(&st).unwrap().state_hash, hash);
    let day = app(false);
    assert_eq!(handlers::step(&day, 7).unwrap().minute, 360);
    assert!(handlers::overview(&day).unwrap().story.unwrap().pending.is_some());
}
#[test]
fn handlers_and_direct_projections_share_codes_and_unknown_views() {
    let st = app(false);
    let game = st.game().unwrap();
    let w = &game.as_ref().unwrap().session.world;
    let ctx = st.ctx();
    let expected = [
        crate::societies_view::societies(ctx, w),
        crate::arcana_view::arcana(ctx, w),
        crate::legend_ships_view::legend_ships(ctx, w),
        crate::realms_view::realms(ctx, w),
    ];
    drop(game);
    let actual = [
        handlers::pending::societies(&st).unwrap(),
        handlers::pending::arcana(&st).unwrap(),
        handlers::pending::legend_ships(&st).unwrap(),
        handlers::pending::realms(&st).unwrap(),
    ];
    assert_eq!(actual, expected);
    let error = handlers::submit(
        &st,
        Command::CastSpell { owner: O, spell: "secret_spell".into(), target: arcana::Target::SelfTarget },
    )
    .unwrap_err();
    let AppError::Command(error) = error else { panic!("命令应返回内核错误码") };
    assert_eq!(error.code(), "arcana.unknown");
    assert!(manifest_core::error::reason_args(error.code()).is_some());
}
#[test]
fn owned_named_ships_have_an_optional_identity_and_ordinary_ships_keep_the_old_shape() {
    let st = app(false);
    let before = serde_json::to_value(handlers::overview(&st).unwrap()).unwrap();
    assert!(
        before["fleets"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|f| f["ships"].as_array().unwrap())
            .all(|s| s.get("legend").is_none())
    );
    let (fleet, name) = {
        let mut guard = st.game().unwrap();
        let w = &mut guard.as_mut().unwrap().session.world;
        let fleet = w.flagship(O).unwrap();
        let good = w.defs.find_good("grain").unwrap();
        w.grant_item(O, "ring", 1).unwrap();
        Command::Buy { owner: O, fleet, good, qty: 2, max_total: None }.apply(w).unwrap();
        Command::CommissionShip { owner: O, ship: "sample_legend_ship".into(), loc: LocId(0) }.apply(w).unwrap();
        (fleet, w.defs.legend_ships.ship("sample_legend_ship").unwrap().name.clone())
    };
    let after = serde_json::to_value(handlers::overview(&st).unwrap()).unwrap();
    let ships = &after["fleets"].as_array().unwrap().iter().find(|f| f["id"] == fleet.0).unwrap()["ships"];
    assert!(ships[0].get("legend").is_none());
    assert_eq!(ships[1]["legend"], json!({"key":"sample_legend_ship","name":name}));
}
