//! I4 字段逐一核对，I9 复用同一个 ItemLine。
use manifest_appcore::{items_view, views::Ctx};
use manifest_core::*;
use serde_json::Value;
use std::collections::BTreeSet;

fn keys(value: &Value) -> BTreeSet<&str> {
    value.as_object().unwrap().keys().map(String::as_str).collect()
}
fn expected(keys: &[&'static str]) -> BTreeSet<&'static str> {
    keys.iter().copied().collect()
}

#[test]
fn inventory_and_shop_match_every_i4_field_and_are_read_only() {
    let defs = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let mut world = World::new(defs, ScenarioId(0), 42).unwrap();
    Command::BuyItem { owner: OwnerId::Player, loc: LocId(0), item: "reader".into(), qty: 1, max_total: None }
        .apply(&mut world)
        .unwrap();
    let before = world.state.clone();
    let ctx = Ctx::plain(&world.defs);
    let inv = items_view::inventory(ctx, &world);
    assert_eq!(
        keys(&inv),
        expected(&["items", "wearers", "reading", "bibliography", "sets", "gifts", "collection_value"])
    );
    let line = &inv["items"][0];
    assert_eq!(
        keys(line),
        expected(&[
            "key", "name", "kind", "rarity", "qty", "equipped", "icon", "desc", "lore", "tags", "price", "bonus",
            "effects", "set", "book", "key_item", "can_sell", "can_give", "can_use", "sources"
        ])
    );
    assert_eq!(
        keys(&line["book"]),
        expected(&["category", "category_name", "lang", "lang_name", "days", "read", "can_read", "published"])
    );
    assert_eq!(keys(&inv["wearers"][0]), expected(&["key", "name", "portrait", "slots", "attrs"]));
    assert_eq!(inv["wearers"][0]["slots"].as_array().unwrap().len(), 7);
    assert_eq!(keys(&inv["bibliography"]), expected(&["read", "categories", "recent"]));
    assert_eq!(keys(&inv["gifts"]), expected(&["count", "value", "kinds"]));
    let shop = items_view::item_shop(ctx, &world, LocId(0));
    assert_eq!(keys(&shop), expected(&["loc", "name", "restock", "offers", "sell_bp"]));
    assert_eq!(shop["restock"], serde_json::json!([1502, 2, 1]));
    for offer in shop["offers"].as_array().unwrap() {
        assert_eq!(keys(offer), expected(&["item", "stock", "price", "line", "enabled"]));
        assert_eq!(offer["line"]["key"], offer["item"]);
    }
    assert_eq!(items_view::item_shop(ctx, &world, LocId(1)), Value::Null);
    assert_eq!(world.state.clone(), before);
    assert!(manifest_appcore::views::port_view(&world, LocId(0)).shop);
}

#[test]
fn equipment_view_lists_only_changed_attributes_and_live_wearers() {
    use manifest_core::{captain::Birthday, items::equipment::EquipSlot};
    let root = manifest_data::find_data_dir().unwrap();
    let mut defs = (*manifest_data::load_world(&root, "testbed").unwrap()).clone();
    defs.mates = vec![manifest_data::load(&root).unwrap().mates[0].clone()];
    defs.mates[0].home = LocId(0);
    defs.scenarios[0].mates = vec![MateId(0)];
    let mut world = World::new(std::sync::Arc::new(defs), ScenarioId(0), 42).unwrap();
    let owner = OwnerId::Player;
    Command::CreateCaptain {
        owner,
        birthday: Birthday { year: 1484, month: 1, day: 31 },
        answers: vec!["library".into()],
        alloc: vec![1, 1, 1, 1, 1, 1, 1, 1, 0, 0],
        genius: None,
    }
    .apply(&mut world)
    .unwrap();
    world.grant_item(owner, "ring", 1).unwrap();
    Command::Equip { owner, wearer: "captain".into(), slot: EquipSlot::Accessory1, item: "ring".into() }
        .apply(&mut world)
        .unwrap();
    let inv = items_view::inventory(Ctx::plain(&world.defs), &world);
    assert_eq!(inv["wearers"].as_array().unwrap().len(), 2);
    assert_eq!(inv["wearers"][0]["attrs"], serde_json::json!([{"attr":"commerce","base":2,"equipped":3}]));
    assert_eq!(inv["wearers"][0]["slots"][3], serde_json::json!({"slot":"accessory1","item":"ring"}));
    assert_eq!(inv["items"][0]["equipped"], 1);
    assert_eq!(inv["items"][0]["can_sell"], false);
    assert_eq!(inv["items"][0]["can_give"], false);
    Command::DismissMate { owner, mate: MateId(0) }.apply(&mut world).unwrap();
    assert_eq!(items_view::inventory(Ctx::plain(&world.defs), &world)["wearers"].as_array().unwrap().len(), 1);
}

#[test]
fn reading_bibliography_and_codex_fields_match_i4_without_hidden_content() {
    use manifest_appcore::codex_view;
    let defs = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let mut world = World::new(defs, ScenarioId(0), 42).unwrap();
    let owner = OwnerId::Player;
    Command::BuyItem { owner, loc: LocId(0), item: "translation".into(), qty: 1, max_total: None }
        .apply(&mut world)
        .unwrap();
    Command::ReadBook { owner, book: "translation".into(), interpreter: None }.apply(&mut world).unwrap();
    let view = items_view::inventory(Ctx::plain(&world.defs), &world);
    assert_eq!(keys(&view["reading"]), expected(&["book", "name", "done_days", "total_days", "mode"]));
    assert_eq!(view["reading"]["mode"], "self");
    assert_eq!(view["reading"]["total_days"], 3);
    let codex = codex_view::codex(Ctx::plain(&world.defs), &world, None);
    assert_eq!(keys(&codex), expected(&["categories", "category", "entries"]));
    assert_eq!(keys(&codex["categories"][0]), expected(&["key", "name", "got", "total"]));
    let entries = codex["entries"].as_array().unwrap();
    let hidden = entries.iter().find(|v| v["key"] == "sealed_letter").unwrap();
    assert_eq!(keys(hidden), expected(&["key", "name", "state", "icon", "desc", "basis", "sources", "changed"]));
    assert_eq!(hidden["state"], "unknown");
    assert_eq!(hidden["name"], "？？？");
    assert!(hidden["icon"].is_null() && hidden["desc"].is_null() && hidden["basis"].is_null());
    assert_eq!(hidden["sources"], serde_json::json!([]));
    assert_eq!(entries.iter().find(|v| v["key"] == "translation").unwrap()["state"], "got");
    assert_eq!(entries.iter().find(|v| v["key"] == "reader").unwrap()["state"], "seen");
    for _ in 0..3 {
        world.end_day().unwrap();
    }
    let inv = items_view::inventory(Ctx::plain(&world.defs), &world);
    assert!(inv["reading"].is_null());
    assert_eq!(inv["bibliography"]["read"], 1);
    let recent = &inv["bibliography"]["recent"][0];
    assert_eq!(keys(recent), expected(&["key", "name", "on"]));
    assert_eq!(recent["key"], "translation");
    assert_eq!(recent["on"], serde_json::json!([1502, 1, 4]));
    assert_eq!(keys(&inv["bibliography"]["categories"][0]), expected(&["key", "name", "count"]));
    assert_eq!(inv["items"][0]["book"]["read"], true);
    assert_eq!(inv["items"][0]["book"]["can_read"], "no");
    let before = world.state.clone();
    let books = codex_view::codex(Ctx::plain(&world.defs), &world, Some("books"));
    assert_eq!(books["entries"].as_array().unwrap().len(), 2);
    assert_eq!(books["categories"][1]["got"], 1);
    assert_eq!(books["categories"][1]["total"], 2);
    assert_eq!(books["entries"].as_array().unwrap().iter().find(|v| v["key"] == "voyages").unwrap()["state"], "got");
    assert_eq!(world.state, before);
}

#[test]
fn all_seven_item_commands_accept_the_frontend_json_names_and_optional_fields() {
    use serde_json::json;
    for value in [
        json!({"BuyItem":{"owner":"player","loc":0,"item":"ring","qty":1,"max_total":100}}),
        json!({"SellItem":{"owner":"player","loc":0,"item":"ring","qty":1,"min_total":50}}),
        json!({"Equip":{"owner":"player","wearer":"captain","slot":"accessory2","item":"ring"}}),
        json!({"Unequip":{"owner":"player","wearer":"captain","slot":"accessory2"}}),
        json!({"UseItem":{"owner":"player","item":"tonic"}}),
        json!({"ReadBook":{"owner":"player","book":"reader"}}),
        json!({"GiveItem":{"owner":"player","person":"ines_costa","item":"reader","qty":1}}),
    ] {
        let command: Command = serde_json::from_value(value).unwrap();
        assert_eq!(command.owner(), Some(OwnerId::Player));
        let again: Command = serde_json::from_value(serde_json::to_value(&command).unwrap()).unwrap();
        assert_eq!(command, again);
    }
}

#[test]
fn shop_tab_agrees_with_local_shelf_and_captain_uses_the_saved_name() {
    use manifest_appcore::views::{CaptainView, port_view};
    let defs = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let mut world = World::new(defs, ScenarioId(0), 42).unwrap();
    let captain = CaptainView { name: "测试船长的姓名".into(), portrait: 0 };
    let inv = items_view::inventory_for(Ctx::plain(&world.defs), &world, Some(&captain));
    assert_eq!(inv["wearers"][0]["name"], captain.name);
    assert!(port_view(&world, LocId(0)).shop);
    let fleet = world.flagship(OwnerId::Player).unwrap();
    world.state.fleets.get_mut(&fleet).unwrap().location = manifest_core::world::FleetLocation::Docked(LocId(1));
    assert!(!port_view(&world, LocId(0)).shop);
    assert!(items_view::item_shop(Ctx::plain(&world.defs), &world, LocId(0)).is_null());
    world.state.fleets.get_mut(&fleet).unwrap().location = manifest_core::world::FleetLocation::Docked(LocId(0));
    world.state.items.shelves.remove(&LocId(0));
    assert!(!port_view(&world, LocId(0)).shop);
    let mut defs = (*world.defs).clone();
    defs.locations[0].kind = manifest_core::defs::LocKind::City;
    world.defs = std::sync::Arc::new(defs);
    assert!(!port_view(&world, LocId(0)).shop);
    assert!(items_view::item_shop(Ctx::plain(&world.defs), &world, LocId(0)).is_null());
}

#[test]
fn generated_i4_text_and_basis_use_the_current_language_and_frontend_keys() {
    let root = manifest_data::find_data_dir().unwrap();
    let defs = manifest_data::load_world(&root, "testbed").unwrap();
    let world = World::new(defs, ScenarioId(0), 42).unwrap();
    let mut effective = manifest_data::resolve_world(&root, "testbed").unwrap();
    // 本例只加载 I4 与错误文字的英文；testbed 的其他表沿用中文测试名称。
    effective.files.retain(|path, _| {
        !path.starts_with("locales/en/") || matches!(path.as_str(), "locales/en/items.toml" | "locales/en/texts.toml")
    });
    let ai = manifest_data::ai_content::load_world_ai_content(&effective).unwrap();
    let (zh, zh_issues) =
        manifest_data::locale::load_world_locale_lenient(&effective, manifest_data::Locale::ZhCn, &world.defs, &ai);
    let (en, en_issues) =
        manifest_data::locale::load_world_locale_lenient(&effective, manifest_data::Locale::En, &world.defs, &ai);
    assert!(zh_issues.is_empty(), "{zh_issues:?}");
    assert!(en_issues.is_empty(), "{en_issues:?}");
    let ctx = Ctx::of(&en, &zh, &en);
    let shop = items_view::item_shop(ctx, &world, LocId(0));
    assert!(shop["name"].as_str().unwrap().ends_with("Item shop"));
    let line = items_view::item_line(ctx, &world, OwnerId::Player, "compass").unwrap();
    assert_eq!(line["name"], "Test compass");
    assert_eq!(line["lore"], "A sample for testing inventory, reading and collections.");
    assert_eq!(line["effects"][0]["text"], "Sailing speed +6%");
    let book = items_view::item_line(ctx, &world, OwnerId::Player, "reader").unwrap();
    assert_eq!(book["book"]["category_name"], "Voyage journals");
    let inv = items_view::inventory(ctx, &world);
    assert_eq!(inv["sets"][0]["name"], "Apprentice mariner");
    let codex = manifest_appcore::codex_view::codex(ctx, &world, None);
    assert_eq!(codex["categories"][0]["name"], "Items");
    assert_eq!(codex["categories"][1]["name"], "Books");
    assert_eq!(items_view::basis("folklore"), "legend");
    assert_eq!(items_view::basis("invented"), "original");
    assert_eq!(items_view::basis("literary"), "literature");
    assert_eq!(items_view::basis("historical"), "historical");
}
