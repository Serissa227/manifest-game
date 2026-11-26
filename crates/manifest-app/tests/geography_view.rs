//! 第五批（EXPANSION §10.3）：地理图层经 StaticView 下发。字段名与 `frontend/src/ipc/types.ts` 的约定逐字一致：
//! `map.relief` / `map.biomes`（每行一个字符串，数据没有该图层时省略）、`rivers`（key、name、path 为 [x, y] 数组、width）、
//! `landmarks`（key、name、category、kind、x、y、w、h、lore、discovery 可为 null）。

use manifest_app::views;
use manifest_core::geo::{Biome, Geography, LandmarkCategory, LandmarkDef, RiverDef};
use manifest_core::ids::{Cell, DiscoveryId};
use manifest_core::nav::Terrain;
use manifest_core::testkit::tiny_defs;
use serde_json::{Value, json};
use std::collections::BTreeSet;

fn keys(v: &Value) -> BTreeSet<String> {
    v.as_object().expect("对象").keys().cloned().collect()
}

#[test]
fn data_without_layers_sends_empty_rivers_and_landmarks_and_omits_rasters() {
    let defs = tiny_defs();
    let json = serde_json::to_value(views::static_view(&defs)).unwrap();
    assert_eq!(json["rivers"], json!([]));
    assert_eq!(json["landmarks"], json!([]));
    let map = json["map"].as_object().unwrap();
    assert!(!map.contains_key("relief") && !map.contains_key("biomes"), "没有图层时省略：{:?}", map.keys());
    assert_eq!(keys(&json["map"]), ["height", "rows", "width"].iter().map(|s| s.to_string()).collect());
}

#[test]
fn layers_are_sent_with_the_agreed_field_names() {
    let mut defs = (*tiny_defs()).clone();
    let map = defs.map.clone();
    let land = |i: usize| map.terrain[i] == Terrain::Land;
    let n = map.terrain.len();
    // 岛（x 15–24、y 8–15）：高程由海岸向中心升高，植被按列分带
    let relief: Vec<Option<u8>> = (0..n)
        .map(|i| {
            let c = map.cell_of(i);
            land(i).then(|| (c.x.abs_diff(20).max(c.y.abs_diff(12)) as u8).min(9))
        })
        .collect();
    let biomes: Vec<Option<Biome>> =
        (0..n).map(|i| land(i).then(|| if map.cell_of(i).x < 20 { Biome::Broadleaf } else { Biome::Alpine })).collect();
    defs.geography = Geography {
        places: Default::default(),
        relief,
        biomes,
        rivers: vec![RiverDef {
            key: "island_run".into(),
            name: "岛河".into(),
            path: vec![Cell::new(20, 12), Cell::new(21, 13), Cell::new(22, 14), Cell::new(23, 15)],
            width: 2,
        }],
        landmarks: vec![
            LandmarkDef {
                key: "old_tower".into(),
                name: "古塔".into(),
                category: LandmarkCategory::Ancient,
                kind: "tower".into(),
                cell: Cell::new(16, 9),
                size: (2, 3),
                lore: "帝国的瞭望塔。".into(),
                discovery: Some(DiscoveryId(1)),
            },
            LandmarkDef {
                key: "whirl".into(),
                name: "大漩涡".into(),
                category: LandmarkCategory::Natural,
                kind: "maelstrom".into(),
                cell: Cell::new(3, 20),
                size: (1, 1),
                lore: String::new(),
                discovery: None,
            },
        ],
        fine_rivers: Vec::new(),
    };
    let json = serde_json::to_value(views::static_view(&defs)).unwrap();
    // 逐格图层：每行一个字符串，陆格为代码、海格为 .
    let relief: Vec<String> = serde_json::from_value(json["map"]["relief"].clone()).unwrap();
    let biomes: Vec<String> = serde_json::from_value(json["map"]["biomes"].clone()).unwrap();
    assert_eq!((relief.len(), biomes.len()), (map.height as usize, map.height as usize));
    for (y, (r, b)) in relief.iter().zip(&biomes).enumerate() {
        let (r, b): (Vec<char>, Vec<char>) = (r.chars().collect(), b.chars().collect());
        assert_eq!((r.len(), b.len()), (map.width as usize, map.width as usize));
        for x in 0..map.width as usize {
            let i = y * map.width as usize + x;
            if land(i) {
                assert_eq!(r[x].to_digit(10).map(|d| d as u8), defs.geography.relief[i]);
                assert_eq!(Biome::from_code(b[x]), defs.geography.biomes[i]);
            } else {
                assert_eq!((r[x], b[x]), ('.', '.'), "海格 ({x}, {y})");
            }
        }
    }
    assert_eq!(&relief[12][19..22], "101");
    assert_eq!(&biomes[12][18..22], "FFAA");
    // 河流
    let river = &json["rivers"][0];
    assert_eq!(keys(river), ["key", "name", "path", "width"].iter().map(|s| s.to_string()).collect());
    assert_eq!(river["path"], json!([[20, 12], [21, 13], [22, 14], [23, 15]]));
    assert_eq!((river["key"].as_str(), river["width"].as_u64()), (Some("island_run"), Some(2)));
    // 地标：discovery 为发现物的 key，没有时为 null
    let tower = &json["landmarks"][0];
    let want: BTreeSet<String> = ["key", "name", "category", "kind", "x", "y", "w", "h", "lore", "discovery"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    assert_eq!(keys(tower), want);
    assert_eq!(
        tower,
        &json!({
            "key": "old_tower", "name": "古塔", "category": "ancient", "kind": "tower",
            "x": 16, "y": 9, "w": 2, "h": 3, "lore": "帝国的瞭望塔。",
            "discovery": defs.discoveries[1].key,
        })
    );
    let whirl = &json["landmarks"][1];
    assert_eq!(keys(whirl), want);
    assert_eq!((whirl["category"].as_str(), whirl["discovery"].is_null()), (Some("natural"), true));
    assert_eq!((whirl["w"].as_u64(), whirl["h"].as_u64()), (Some(1), Some(1)));
}
