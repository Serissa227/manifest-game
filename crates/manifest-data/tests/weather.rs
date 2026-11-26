//! 第四批（EXPANSION §9.1）：`rules.toml [weather]` 与 `regions.toml` 的 `climate` 字段的加载与校验。

use manifest_core::fixed::Fx;
use manifest_core::weather::{Climate, WeatherRules};
use std::path::{Path, PathBuf};

fn data_dir() -> PathBuf {
    manifest_data::find_data_dir().expect("找到 data/")
}

fn copy_dir(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for e in std::fs::read_dir(from).unwrap() {
        let e = e.unwrap();
        let p = e.path();
        let dest = to.join(e.file_name());
        if p.is_dir() {
            copy_dir(&p, &dest);
        } else {
            std::fs::copy(&p, &dest).unwrap();
        }
    }
}

/// 复制一份 data/，对某个文件做替换后加载。
fn load_edited(rel: &str, from: &str, to: &str) -> Result<std::sync::Arc<manifest_core::StaticData>, String> {
    let tmp = tempfile::tempdir().unwrap();
    copy_dir(&data_dir(), tmp.path());
    let path = rel.split('/').fold(tmp.path().to_path_buf(), |p, part| p.join(part));
    let text = std::fs::read_to_string(&path).unwrap();
    assert!(text.contains(from), "样例替换目标“{from}”不在 {rel} 中");
    std::fs::write(&path, text.replacen(from, to, 1)).unwrap();
    manifest_data::load(tmp.path()).map_err(|e| e.to_string())
}

fn climate_of(defs: &manifest_core::StaticData, key: &str) -> Climate {
    defs.regions.iter().find(|r| r.key == key).unwrap_or_else(|| panic!("海区 {key}")).climate
}

#[test]
fn real_weather_rules_and_climates_load() {
    let defs = manifest_data::load(&data_dir()).unwrap_or_else(|e| panic!("{e}"));
    let w = &defs.rules.weather;
    assert_eq!(w.system_days, 4);
    assert_eq!(w.storm_hit_bp, 1_000);
    assert_eq!(w.storm_max_bp, 3_000);
    assert_eq!(w.wind_dir_weights, [1, 2, 4, 2, 1]);
    assert_eq!(w.climate(Climate::Tropical).storm, [Fx::ONE, Fx::from_pct(150), Fx::from_pct(150), Fx::ONE]);
    assert_eq!(w.climate(Climate::Arid).skies[1], [80, 15, 2, 3]);
    // 内核测试用的默认值与数据文件一致
    assert_eq!(*w, WeatherRules::default(), "WeatherRules::default() 应与 data/rules.toml [weather] 一致");
    // 写明的气候
    for (key, c) in [
        ("fog_cape", Climate::Temperate),
        ("emerald", Climate::Tropical),
        ("morningstar", Climate::Temperate),
        ("south_waste", Climate::Tropical),
        ("dawn_sea", Climate::Temperate),
    ] {
        assert_eq!(climate_of(&defs, key), c, "{key}");
    }
    // 按纬度推断的气候
    for (key, c) in [
        ("frost_west", Climate::Cold),
        ("frost_reach", Climate::Cold),
        ("cuilan_sea", Climate::Temperate),
        ("silvermist", Climate::Temperate),
        ("sand_gate", Climate::Arid),
        ("red_reef", Climate::Tropical),
        ("yaohua_sea", Climate::Tropical),
    ] {
        assert_eq!(climate_of(&defs, key), c, "{key}");
    }
    // 四种气候都有海区
    for c in Climate::ALL {
        assert!(defs.regions.iter().any(|r| r.climate == c), "没有{}海区", c.name());
    }
}

#[test]
fn latitude_bands_drive_inferred_climates() {
    // 分带全为 0：没有写 climate 的海区都推断为热带，写了的保持不变
    let defs = load_edited("rules.toml", "latitude_bands = [40, 80, 120]", "latitude_bands = [0, 0, 0]")
        .unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(climate_of(&defs, "frost_west"), Climate::Tropical);
    assert_eq!(climate_of(&defs, "cuilan_sea"), Climate::Tropical);
    assert_eq!(climate_of(&defs, "south_waste"), Climate::Tropical);
    assert_eq!(climate_of(&defs, "dawn_sea"), Climate::Temperate);
    assert_eq!(climate_of(&defs, "fog_cape"), Climate::Temperate);
}

#[test]
fn missing_weather_section_falls_back_to_defaults() {
    let tmp = tempfile::tempdir().unwrap();
    copy_dir(&data_dir(), tmp.path());
    let path = tmp.path().join("rules.toml");
    let text = std::fs::read_to_string(&path).unwrap();
    let cut = text.find("\n[weather]").expect("rules.toml 有 [weather]");
    std::fs::write(&path, &text[..cut]).unwrap();
    let defs = manifest_data::load(tmp.path()).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(defs.rules.weather, WeatherRules::default());
    assert_eq!(climate_of(&defs, "frost_west"), Climate::Cold);
}

#[test]
fn corrupted_weather_data_is_rejected_with_readable_errors() {
    let cases: &[(&str, &str, &str, &[&str])] = &[
        (
            "world/regions.toml",
            "climate = \"tropical\"",
            "climate = \"polar\"",
            &["regions.toml", "regions[emerald]", "climate", "polar"],
        ),
        ("rules.toml", "system_days = 4", "system_days = 1", &["rules.toml", "weather.system_days"]),
        (
            "rules.toml",
            "wind_strength_weights = [1, 2, 3, 4, 3, 2, 1]",
            "wind_strength_weights = [1, 2, 3, 4, 3, 2, 9]",
            &["rules.toml", "weather.wind_strength_weights", "对称"],
        ),
        (
            "rules.toml",
            "wind_dir_weights = [1, 2, 4, 2, 1]",
            "wind_dir_weights = [1, 5, 4, 5, 1]",
            &["rules.toml", "weather.wind_dir_weights"],
        ),
        ("rules.toml", "storm_max = 0.30", "storm_max = 0.9", &["rules.toml", "weather.storm_max"]),
        ("rules.toml", "storm_hit = 0.10", "storm_hit = 0", &["rules.toml", "weather.storm_hit"]),
        (
            "rules.toml",
            "storm = [1.0, 1.5, 1.5, 1.0]",
            "storm = [1.0, 9.0, 1.5, 1.0]",
            &["rules.toml", "weather.tropical.storm"],
        ),
        ("rules.toml", "summer = [80, 15, 2, 3]", "summer = [0, 0, 0, 0]", &["rules.toml", "weather.arid.summer"]),
        ("rules.toml", "storm_max = 0.30", "storm_max = 0.30\nhail = 0.1", &["rules.toml", "hail"]),
    ];
    for (rel, from, to, needles) in cases {
        let msg = match load_edited(rel, from, to) {
            Ok(_) => panic!("损坏的数据（{rel}：{from} → {to}）应被拒绝"),
            Err(e) => e,
        };
        for needle in *needles {
            assert!(msg.contains(needle), "错误信息应包含“{needle}”：\n{msg}");
        }
    }
}
