//! 海区的音乐分区接到静态视图（FRAMEWORK §15.1）：`regions[i].music` 原样给出海区创作源里写的值，界面按它选航海曲。
//! 没写的海区与没有创作源的世界（经典、测试海域）不输出这个键，海区那一段与原来逐字节相同；
//! 隐藏未知地点的世界里，按版本缓存的公共静态数据与按本局过滤的那一份共用同一个构造，同样带。

use manifest_appcore::state::world_registry::WorldRegistry;
use manifest_appcore::{AppPaths, AppState, handlers, navigation_view::visibility};
use manifest_core::StaticData;
use manifest_data::Locale;
use serde_json::{Value, json};
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data")
}

fn registry() -> &'static WorldRegistry {
    static REGISTRY: OnceLock<Arc<WorldRegistry>> = OnceLock::new();
    REGISTRY.get_or_init(|| WorldRegistry::load(&root()).expect("世界注册表"))
}

/// 抽查的几片海（海区 key → 音乐分区）：日本南岸、东海、伊比利亚外海、地中海、黎凡特、波罗的海、红海、爪哇海、加勒比。
const SAMPLES: [(&str, &str); 10] = [
    ("kuroshio", "japan"),
    ("seto_inland", "japan"),
    ("east_china_sea", "east_china_sea"),
    ("iberia", "iberian"),
    ("tyrrhenian", "mediterranean"),
    ("levant", "levant"),
    ("baltic", "hansa"),
    ("red_sea", "arabic"),
    ("java_sea", "nusantara"),
    ("east_caribbean", "caribbean"),
];

/// 静态视图 JSON 的海区一段：每片海按 id 对上定义，`music` 与创作源写的值相同（寰宇每片海都写了）。
fn assert_music(regions: &Value, defs: &StaticData, what: &str) {
    let regions = regions.as_array().expect("海区数组");
    assert_eq!(regions.len(), defs.regions.len(), "{what}");
    for (i, def) in defs.regions.iter().enumerate() {
        let written = defs.geography.places.authored.regions.get(&def.key).and_then(|r| r.music.as_deref());
        assert!(written.is_some(), "{what}：寰宇每片海都写了音乐分区：{}", def.key);
        assert_eq!(regions[i]["id"], json!(i), "{what}：{}", def.key);
        assert_eq!(regions[i]["music"].as_str(), written, "{what}：{}", def.key);
        // 与前端 ipc/types.ts 的海区视图一致：原有三个键之外只多这一个
        let mut keys: Vec<&str> = regions[i].as_object().expect("海区对象").keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(keys, ["id", "music", "name", "name_en"], "{what}：{}", def.key);
    }
    for (key, zone) in SAMPLES {
        let i = defs.regions.iter().position(|r| r.key == key).unwrap_or_else(|| panic!("没有海区 {key}"));
        assert_eq!(regions[i]["music"], json!(zone), "{what}：{key}");
    }
}

#[test]
fn terra16_static_view_carries_region_music_in_both_languages() {
    let terra = registry().get("terra16").expect("寰宇");
    for locale in Locale::ALL {
        let view = terra.static_view(locale);
        assert_eq!(view.world.key, "terra16");
        assert_music(&serde_json::to_value(view).unwrap()["regions"], &terra.defs, locale.code());
    }
}

/// 加上音乐分区之前海区视图的形状（`id / name / name_en`，原 `NamedView`）。
#[derive(serde::Serialize)]
struct RegionBefore<'a> {
    id: u16,
    name: &'a str,
    name_en: &'a str,
}

#[test]
fn worlds_without_music_omit_the_key_and_keep_the_region_bytes() {
    for world in ["classic", "testbed"] {
        let resources = registry().get(world).expect(world);
        for locale in Locale::ALL {
            let view = resources.static_view(locale);
            assert!(!view.regions.is_empty(), "{world}");
            let before: Vec<RegionBefore<'_>> =
                view.regions.iter().map(|r| RegionBefore { id: r.id, name: &r.name, name_en: &r.name_en }).collect();
            assert_eq!(
                serde_json::to_string(&view.regions).unwrap(),
                serde_json::to_string(&before).unwrap(),
                "{world} {}：海区一段逐字节不变",
                locale.code()
            );
            // 整份静态视图里都没有这个键（这两个世界的数据也不出现这个词）
            assert!(!serde_json::to_string(view).unwrap().contains("\"music\""), "{world} {}", locale.code());
        }
    }
}

#[test]
fn the_public_cached_copy_keeps_region_music_while_hiding_places() {
    let terra = registry().get("terra16").expect("寰宇");
    assert!(terra.defs.manual_navigation && terra.defs.navigation.hide_unknown_ports, "寰宇隐藏未知地点");
    for locale in Locale::ALL {
        // 网页版按版本 GET 的那一份（hub 的 serialize_world 就是这样做出来的）
        let public = visibility::public_static(terra.static_view(locale), terra.locales.ctx(locale)).unwrap();
        for field in ["locations", "discoveries", "landmarks", "roads", "exchanges", "scenarios"] {
            assert_eq!(public[field], json!([]), "{field}");
        }
        assert_music(&public["regions"], &terra.defs, locale.code());
    }
}

#[test]
fn the_per_game_filtered_static_data_keeps_region_music() {
    let dir = std::env::temp_dir().join(format!("manifest-region-music-{}", std::process::id()));
    let st = AppState::from_data_dir(&root(), Arc::new(manifest_ai::MemoryKeyStore::default()), AppPaths::in_dir(&dir))
        .unwrap();
    let mut settings = st.settings();
    settings.ai.mode = manifest_ai::AiMode::Off;
    settings.autosave_days = 0;
    handlers::save_settings(&st, settings).unwrap();
    // 经典世界（启动时的当前世界）：不带这个键
    let classic = serde_json::to_value(handlers::static_data(&st)).unwrap();
    assert_eq!(classic["world"]["key"], "classic");
    assert!(classic["regions"].as_array().unwrap().iter().all(|r| r.get("music").is_none()));

    // 选了寰宇、还没开局：地点全都未知，海区照样带音乐分区
    let selected = handlers::select_world(&st, "terra16".into()).unwrap();
    let defs = st.worlds().get("terra16").unwrap().defs.clone();
    assert_eq!(selected.world.key, "terra16");
    assert!(selected.locations.is_empty());
    assert_music(&serde_json::to_value(&selected).unwrap()["regions"], &defs, "选世界");

    // 开了局：按本局看见过的地点过滤后的那一份（桌面的 static_data 命令与网页的同名 RPC）
    let request = json!({"world":"terra16", "scenario":"mio_1553", "protagonist":"mio", "seed":42});
    handlers::new_world_game(&st, serde_json::from_value(request).unwrap()).unwrap();
    let view = handlers::static_data(&st);
    assert_eq!(view.world.key, "terra16");
    assert!(view.locations.len() < defs.locations.len(), "没见过的地点不下发");
    assert_music(&serde_json::to_value(&view).unwrap()["regions"], &defs, "本局");
    drop(st);
    let _ = std::fs::remove_dir_all(&dir);
}
