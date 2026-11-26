//! E17：静态摘要、公开图层边界、海区编码与内容哈希。

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use manifest_appcore::state::world_registry::WorldRegistry;
use manifest_appcore::views::{self, MapResource};
use manifest_core::geo::Biome;
use manifest_core::nav::Terrain;
use manifest_data::Locale;
use serde_json::json;
use std::path::PathBuf;

fn registry() -> std::sync::Arc<WorldRegistry> {
    WorldRegistry::load(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data")).unwrap()
}

#[test]
fn external_summary_reuses_one_resource_across_locales_and_classic_map_bytes_stay_identical() {
    let worlds = registry();
    let classic = worlds.get("classic").unwrap();
    let d = &classic.defs;
    let legacy_rows: Vec<String> = (0..d.map.height)
        .map(|y| {
            (0..d.map.width)
                .map(|x| match d.map.terrain(manifest_core::Cell::new(x, y)) {
                    Terrain::Deep => '~',
                    Terrain::Shallow => '-',
                    Terrain::Land => '#',
                })
                .collect()
        })
        .collect();
    // 精确保留旧 MapView 的字段顺序、缺省省略与字符串字节；新字段不能出现在经典静态视图。
    let legacy = format!(
        "{{\"width\":{},\"height\":{},\"rows\":{},\"relief\":{},\"biomes\":{}}}",
        d.map.width,
        d.map.height,
        serde_json::to_string(&legacy_rows).unwrap(),
        serde_json::to_string(&d.geography.relief_rows(d.map.width).unwrap()).unwrap(),
        serde_json::to_string(&d.geography.biome_rows(d.map.width).unwrap()).unwrap()
    );
    for locale in Locale::ALL {
        assert_eq!(serde_json::to_string(&classic.static_view(locale).map).unwrap(), legacy);
    }
    let bed = worlds.get("testbed").unwrap();
    let resource = bed.map_resource();
    assert!(std::ptr::eq(resource, worlds.map_resource("testbed").unwrap()));
    assert!(std::ptr::eq(resource, worlds.map_by_hash(&resource.hash).unwrap()));
    for locale in Locale::ALL {
        let map = serde_json::to_value(&bed.static_view(locale).map).unwrap();
        assert_eq!(
            map,
            json!({"width":120,"height":60,"rows":[],"key":"testbed","hash":resource.hash,"wrap_x":true,"external":true})
        );
        assert!(serde_json::to_vec(&map).unwrap().len() < 256);
    }
    assert_eq!(resource.cell_km, 10);
    assert!(resource.projection.is_none());
    assert!(worlds.map_resource("missing").is_err());
    assert!(worlds.map_by_hash(&"0".repeat(64)).is_none());
}

#[test]
fn i3_seas_are_row_major_u16le_and_no_private_or_arcane_data_enters_the_resource() {
    let worlds = registry();
    let mut defs = (*worlds.get("testbed").unwrap().defs).clone();
    defs.map.region[0] = 74;
    defs.map.region[1] = 511;
    defs.map.region[2] = u16::MAX;
    let land = defs.map.terrain.iter().position(|t| *t == Terrain::Land).unwrap();
    defs.geography.biomes = vec![None; defs.map.terrain.len()];
    defs.geography.biomes[land] = Some(Biome::Arcane);
    defs.locations[0].name = "secret_port_marker".into();
    defs.locations[0].key = "secret_port_key".into();
    let resource = MapResource::new(&defs, 10);
    let value = serde_json::to_value(&resource).unwrap();
    assert_eq!(
        value.as_object().unwrap().keys().map(String::as_str).collect::<Vec<_>>(),
        ["biomes", "cell_km", "hash", "height", "key", "projection", "relief", "rows", "seas", "width", "wrap_x"]
    );
    assert_eq!(value["seas"]["encoding"], "u16le-base64");
    let bytes = STANDARD.decode(value["seas"]["data"].as_str().unwrap()).unwrap();
    assert_eq!(bytes.len(), 120 * 60 * 2);
    for (i, pair) in bytes.chunks_exact(2).enumerate() {
        assert_eq!(u16::from_le_bytes([pair[0], pair[1]]), defs.map.region[i].checked_add(1).unwrap_or(0));
    }
    assert_eq!(&bytes[..6], &[75, 0, 0, 2, 0, 0]);
    assert!(!value.to_string().contains("secret_port"));
    assert!(!resource.biomes.as_ref().unwrap().iter().any(|row| row.contains('X')));
    assert_eq!(resource.biomes.as_ref().unwrap()[land / 120].as_bytes()[land % 120], b'G');
    assert_eq!(resource.rows[land / 120].as_bytes()[land % 120], b'#');
    let hash = resource.hash;
    defs.locations.clear();
    defs.discoveries.clear();
    defs.meta.hash = "different_world".into();
    assert_eq!(MapResource::new(&defs, 10).hash, hash, "秘密、经济和包哈希不是地图哈希输入");
}

#[test]
fn hash_covers_every_public_field_and_ignores_only_its_own_hash() {
    let worlds = registry();
    let map = worlds.get("testbed").unwrap().map_resource().clone();
    let check = |modify: fn(&mut MapResource)| {
        let mut changed = map.clone();
        modify(&mut changed);
        assert_ne!(changed.content_hash(), map.hash);
    };
    check(|m| m.key.push('x'));
    check(|m| m.width += 1);
    check(|m| m.height += 1);
    check(|m| m.wrap_x = !m.wrap_x);
    check(|m| m.cell_km += 1);
    check(|m| m.rows[0].push('#'));
    check(|m| m.relief = Some(vec!["1".into()]));
    check(|m| m.biomes = Some(vec!["G".into()]));
    check(|m| m.seas.as_mut().unwrap().data.push('A'));
    check(|m| m.seas = None);
    check(|m| {
        m.projection =
            Some(views::map_view::MapProjection { kind: "equirect", west: -10800, north: 4320, arcmin_per_cell: 20 })
    });
    let mut changed = map.clone();
    changed.hash = "not_part_of_preimage".into();
    assert_eq!(changed.content_hash(), map.hash);
    assert_eq!(map.hash.len(), 64);
}

#[test]
fn m01_fine_layers_come_with_the_earth_map_and_are_absent_elsewhere() {
    use manifest_data::fine_map::{FINE_SUB, FineCoast, FineElevation, FineRivers};
    let worlds = registry();
    // 没有细图层的地图：空的一份（不是错误），前端照原来的画法
    for key in ["classic", "testbed"] {
        let fine = worlds.map_fine(key).unwrap();
        assert_eq!(
            serde_json::to_value(fine).unwrap(),
            json!({"key":key,"hash":"","cells":0,"coast":null,"elevation":null,"rivers":null})
        );
    }
    assert!(worlds.map_fine("missing").is_err());
    assert!(worlds.map_fine("../earth").is_err());
    // 寰宇：三个文件原样下发，hash 覆盖全部字节，尺寸与航行网格对得上
    let fine = worlds.map_fine("earth").unwrap();
    assert!(std::ptr::eq(fine, worlds.get("terra16").unwrap().map_fine()), "同一份资源只读一次盘");
    assert_eq!((fine.key.as_str(), fine.cells, fine.hash.len()), ("earth", FINE_SUB, 64));
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data/maps/earth/fine");
    let mut h = blake3::Hasher::new();
    h.update(b"manifest-map-fine-v1\0");
    for (name, sent) in [("coast.bin", &fine.coast), ("elevation.bin", &fine.elevation), ("rivers.bin", &fine.rivers)] {
        let bytes = std::fs::read(dir.join(name)).unwrap();
        assert_eq!(STANDARD.decode(sent.as_ref().unwrap()).unwrap(), bytes, "{name} 原样下发");
        h.update(&(bytes.len() as u64).to_le_bytes());
        h.update(&bytes);
    }
    assert_eq!(fine.hash, h.finalize().to_hex().to_string());
    let map = worlds.map_resource("earth").unwrap();
    let coast = FineCoast::decode(&STANDARD.decode(fine.coast.as_ref().unwrap()).unwrap()).unwrap();
    assert_eq!((coast.width, coast.height), (u32::from(map.width), u32::from(map.height)));
    let elevation = FineElevation::decode(&STANDARD.decode(fine.elevation.as_ref().unwrap()).unwrap()).unwrap();
    assert_eq!((elevation.width, elevation.height), (u32::from(map.width) * 4, u32::from(map.height) * 4));
    assert!(!FineRivers::decode(&STANDARD.decode(fine.rivers.as_ref().unwrap()).unwrap()).unwrap().rivers.is_empty());
    // 细图层不进地图资源：它的字段与哈希都不变
    let value = serde_json::to_value(map).unwrap();
    assert!(value.get("coast").is_none() && value.get("fine").is_none());
}
