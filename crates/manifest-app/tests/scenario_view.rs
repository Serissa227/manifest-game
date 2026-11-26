//! 开局剧本卡片与概览的新字段：
//! StaticView 的剧本带开局货物（{ good, qty }）与粮水，旧剧本为空数组与 0；
//! Overview.discovered_count 是已发现的发现物总数（含已报告，只增不减），供界面判断何时重新获取发现物列表。

use manifest_app::views;
use manifest_core::testkit::tiny_defs;
use manifest_core::*;

#[test]
fn scenario_cards_show_opening_cargo_and_supplies() {
    let defs = manifest_data::load_default().unwrap_or_else(|e| panic!("{e}"));
    let statics = views::static_view(&defs);
    let card = statics.scenarios.iter().find(|s| s.key == "colonist").expect("新大陆开拓者剧本");
    let key = |g: u16| statics.goods[g as usize].key.as_str();
    let goods: Vec<&str> = card.cargo.iter().map(|c| key(c.good)).collect();
    for g in ["timber", "grain", "ironware"] {
        assert!(goods.contains(&g), "开局货物应包含 {g}：{goods:?}");
    }
    assert!(card.cargo.iter().all(|c| c.qty > 0));
    assert!(card.food > 0 && card.water > 0);
    // JSON 形状：cargo 为 [{ good, qty }]，另有 food、water
    let json = serde_json::to_value(card).unwrap();
    let first = &json["cargo"][0];
    assert!(first["good"].is_u64() && first["qty"].is_i64(), "{json}");
    assert!(json["food"].is_i64() && json["water"].is_i64(), "{json}");
    // 旧剧本没有开局货物与粮水
    for k in ["newcomer", "heir", "sandbox"] {
        let s = statics.scenarios.iter().find(|s| s.key == k).unwrap();
        assert!(s.cargo.is_empty() && s.food == 0 && s.water == 0, "剧本 {k}");
        let json = serde_json::to_value(s).unwrap();
        assert_eq!(json["cargo"], serde_json::json!([]));
    }
}

#[test]
fn overview_counts_every_discovery_found_so_far() {
    let mut w = World::new(tiny_defs(), ScenarioId(0), 5).unwrap();
    let count = |w: &World| {
        let o = views::overview(w, 1, "off".into(), None);
        (o.discovered_count, o.discoveries_unreported)
    };
    assert_eq!(count(&w), (0, 0));
    assert!(w.defs.discoveries.len() >= 2, "小型世界至少有两处发现物");
    w.state.explore.discovered.insert(DiscoveryId(0), 3);
    w.state.explore.discovered.insert(DiscoveryId(1), 4);
    assert_eq!(count(&w), (2, 2));
    // 报告之后未报告数减少，已发现总数不变
    w.state.explore.reported.insert(DiscoveryId(0));
    assert_eq!(count(&w), (2, 1));
    let json = serde_json::to_value(views::overview(&w, 1, "off".into(), None)).unwrap();
    assert_eq!(json["discovered_count"], 2);
}
