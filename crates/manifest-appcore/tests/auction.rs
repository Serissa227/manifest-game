//! I4 / I9 固定 JSON 契约、信息边界与正式命令。
use manifest_appcore::{auction_view, codex_view, items_view, views::Ctx};
use manifest_core::*;
use serde_json::{Value, json};
use std::{collections::BTreeSet, sync::Arc};
fn world() -> World {
    let root = manifest_data::find_data_dir().unwrap();
    let defs = manifest_data::load_world(&root, "testbed").unwrap();
    World::new(defs, ScenarioId(0), 42).unwrap()
}
fn advance(w: &mut World, day: u32) {
    while w.day() < day {
        w.end_day().unwrap();
    }
}
fn keys(v: &Value) -> BTreeSet<&str> {
    v.as_object().unwrap().keys().map(String::as_str).collect()
}
fn expected(list: &[&'static str]) -> BTreeSet<&'static str> {
    list.iter().copied().collect()
}
#[test]
fn i9_has_exact_fields_and_never_discloses_truth_budgets_or_remote_lots() {
    let mut w = world();
    let before = w.state.clone();
    let ctx = Ctx::plain(&w.defs);
    assert_eq!(manifest_appcore::views::port_view(&w, LocId(0)).auction.as_deref(), Some("island_sale"));
    assert_eq!(manifest_appcore::views::port_view(&w, LocId(1)).auction, None);
    let a = auction_view::auctions(ctx, &w, None);
    assert_eq!(a["auctions"][0]["status"], "upcoming");
    assert_eq!(a["auctions"][0]["headline"], Value::Null);
    assert_eq!(w.state, before);
    assert!(auction_view::auctions(ctx, &w, Some(LocId(1)))["auctions"].as_array().unwrap().is_empty());
    advance(&mut w, 26);
    let a = auction_view::auction(Ctx::plain(&w.defs), &w, "island_sale", Some("林船长")).unwrap();
    assert_eq!(
        keys(&a),
        expected(&[
            "key",
            "name",
            "loc",
            "loc_name",
            "opens_on",
            "closes_on",
            "days_left",
            "status",
            "headline",
            "here",
            "lots",
            "cash",
            "log"
        ])
    );
    assert_eq!(a["status"], "preview");
    assert!((4..=6).contains(&a["lots"].as_array().unwrap().len()));
    let lot = &a["lots"][0];
    assert_eq!(
        keys(lot),
        expected(&[
            "key",
            "line",
            "qty",
            "status",
            "reserve",
            "increment",
            "current",
            "leader",
            "next_min",
            "bidders",
            "inspection",
            "winner",
            "after_loss",
            "enabled",
            "blocked_reason"
        ])
    );
    assert_eq!(keys(&lot["inspection"]), expected(&["done", "verdict", "note", "can_inspect"]));
    assert_eq!(keys(&lot["bidders"][0]), expected(&["key", "name", "portrait", "active", "mood"]));
    assert!(
        a["lots"].as_array().unwrap().iter().all(|l| l["inspection"]["verdict"].is_null() && l["after_loss"].is_null())
    );
    let encoded = a.to_string();
    for hidden in ["budget", "authenticity", "fake_note", "temper", "likes", "ceiling"] {
        assert!(!encoded.contains(hidden), "{hidden}");
    }
    let mut remote_defs = (*w.defs).clone();
    remote_defs.auctions.auctions[0].port = LocId(1);
    w.defs = Arc::new(remote_defs);
    let before = w.state.clone();
    let remote = auction_view::auction(Ctx::plain(&w.defs), &w, "island_sale", None).unwrap();
    assert_eq!(remote["here"], false);
    assert_eq!(remote["lots"], json!([]));
    assert_eq!(remote["log"], json!([]));
    assert_eq!(w.state, before);
}
#[test]
fn frontend_commands_inspect_bid_and_settle_with_saved_captain_name() {
    let mut w = world();
    advance(&mut w, 26);
    let key = w.state.auctions.sessions["island_sale"].lots[0].key.clone();
    let inspect: Command =
        serde_json::from_value(json!({"InspectLot":{"owner":"player","auction":"island_sale","lot":key}})).unwrap();
    inspect.apply(&mut w).unwrap();
    assert_eq!(inspect.validate(&w).unwrap_err().code(), "auction.inspected");
    advance(&mut w, 31);
    let bid: Command =
        serde_json::from_value(json!({"BidAuction":{"owner":"player","auction":"island_sale","lot":key,"amount":600}}))
            .unwrap();
    bid.apply(&mut w).unwrap();
    let view = auction_view::auction(Ctx::plain(&w.defs), &w, "island_sale", Some("林船长")).unwrap();
    assert_eq!(view["lots"][0]["winner"], json!({"key":"player","name":"林船长","you":true,"price":600}));
    assert_eq!(view["lots"][0]["status"], "sold");
    assert!(!view["log"].as_array().unwrap().is_empty());
    let next = w.state.auctions.sessions["island_sale"].lots[1].key.clone();
    let pass: Command =
        serde_json::from_value(json!({"PassAuction":{"owner":"player","auction":"island_sale","lot":next}})).unwrap();
    pass.apply(&mut w).unwrap();
    let view = auction_view::auction(Ctx::plain(&w.defs), &w, "island_sale", None).unwrap();
    assert!(view["lots"][1]["after_loss"].as_str().is_some());
    assert_eq!(bid.validate(&w).unwrap_err().code(), "auction.not_bidding");
    advance(&mut w, 34);
    assert_eq!(auction_view::auctions(Ctx::plain(&w.defs), &w, None)["auctions"][0]["status"], "closed");
    advance(&mut w, 54);
    let future = auction_view::auction(Ctx::plain(&w.defs), &w, "island_sale", None).unwrap();
    assert_eq!(future["opens_on"], json!([1503, 2, 1]));
    assert_eq!(future["status"], "upcoming");
    assert_eq!(future["lots"], json!([]));
    assert_eq!(future["headline"], Value::Null);
}
#[test]
fn auction_display_uses_real_english_overlays_without_changing_gameplay() {
    let root = manifest_data::find_data_dir().unwrap();
    let mut source = manifest_data::resolve_world(&root, "testbed").unwrap();
    source.files.retain(|key, _| {
        !key.starts_with("locales/en/")
            || ["locales/en/items.toml", "locales/en/texts.toml", "locales/en/auctions.toml", "locales/en/persons.toml"]
                .contains(&key.as_str())
    });
    let defs = manifest_data::load_world(&root, "testbed").unwrap();
    let ai = manifest_data::ai_content::load_world_ai_content(&source).unwrap();
    let (zh, zi) = manifest_data::locale::load_world_locale_lenient(&source, manifest_data::Locale::ZhCn, &defs, &ai);
    assert!(zi.is_empty(), "{zi:?}");
    let (en, ei) = manifest_data::locale::load_world_locale_lenient(&source, manifest_data::Locale::En, &defs, &ai);
    assert!(ei.is_empty(), "{ei:?}");
    let mut w = World::new(defs, ScenarioId(0), 42).unwrap();
    advance(&mut w, 31);
    let before = w.state.clone();
    let ctx = Ctx::of(&en, &zh, &en);
    let a = auction_view::auction(ctx, &w, "island_sale", Some("Captain Lin")).unwrap();
    assert_eq!(a["name"], "West Island Collection Sale");
    assert_eq!(a["lots"][0]["bidders"][0]["name"], "Ada");
    for l in a["lots"].as_array().unwrap() {
        assert!(!l["line"]["name"].as_str().unwrap().contains("测试"));
    }
    assert_eq!(w.state, before);
}
fn snapshot(name: &str, value: Value) {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/snapshots").join(format!("b5_{name}.json"));
    let text = std::fs::read_to_string(path).expect("已审阅的 I4 / I9 JSON 快照");
    assert_eq!(value, serde_json::from_str::<Value>(&text).unwrap(), "{name}");
}
#[test]
fn all_five_views_match_reviewed_json_snapshots() {
    let mut w = world();
    let mut defs = (*w.defs).clone();
    defs.items.items.retain(|i| ["ring", "reader", "future_book"].contains(&i.key.as_str()));
    defs.items.sets.clear();
    defs.auctions.auctions[0].lots.retain(|l| l.item == "ring");
    w = World::new(Arc::new(defs), ScenarioId(0), 42).unwrap();
    w.grant_item(OwnerId::Player, "ring", 1).unwrap();
    advance(&mut w, 31);
    let ctx = Ctx::plain(&w.defs);
    snapshot("inventory", items_view::inventory(ctx, &w));
    snapshot("item_shop", items_view::item_shop(ctx, &w, LocId(0)));
    snapshot("codex", codex_view::codex(ctx, &w, None));
    snapshot("auctions", auction_view::auctions(ctx, &w, None));
    snapshot("auction", auction_view::auction(ctx, &w, "island_sale", Some("林船长")).unwrap());
}

#[test]
fn port_auction_selects_current_then_next_with_stable_ties_and_year_rollover() {
    let mut w = world();
    let mut d = (*w.defs).clone();
    let base = d.auctions.auctions[0].clone();
    for (key, month) in [("march_sale", 3), ("january_z", 1), ("january_a", 1)] {
        let mut auction = base.clone();
        auction.key = key.into();
        auction.month = month;
        d.auctions.auctions.push(auction);
    }
    w.defs = Arc::new(d);
    for (day, expected) in [
        (0, "january_a"),
        (2, "january_a"),
        (3, "island_sale"),
        (26, "island_sale"),
        (31, "island_sale"),
        (33, "island_sale"),
        (34, "march_sale"),
        (59, "march_sale"),
        (62, "january_a"),
        (365, "january_a"),
    ] {
        advance(&mut w, day);
        let before = w.state.clone();
        let port = serde_json::to_value(manifest_appcore::views::port_view(&w, LocId(0))).unwrap();
        assert_eq!(port["auction"], expected, "day={day}");
        assert!(auction_view::auction(Ctx::plain(&w.defs), &w, expected, None).is_some());
        assert_eq!(w.state, before);
    }
    let port = serde_json::to_value(manifest_appcore::views::port_view(&w, LocId(1))).unwrap();
    assert!(port.get("auction").is_none());
    let mut d = (*w.defs).clone();
    d.auctions.auctions.clear();
    w.defs = Arc::new(d);
    let port = serde_json::to_value(manifest_appcore::views::port_view(&w, LocId(0))).unwrap();
    assert!(port.get("auction").is_none(), "无定义时不返回旧场次或 null");
}
