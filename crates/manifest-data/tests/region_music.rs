//! 海区的音乐分区（FRAMEWORK §15.1）：世界包登记的海区创作源（C12 `regions.toml`）里的 `music`
//! 按海区 key 对到运行时的海区上，挂在 `geography.places.authored.regions`，海区定义本身不变。
//! 没有登记创作源的世界（经典、测试海域）这张表为空。

use manifest_core::StaticData;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data")
}

fn terra() -> Arc<StaticData> {
    static DEFS: OnceLock<Arc<StaticData>> = OnceLock::new();
    DEFS.get_or_init(|| manifest_data::load_world(&root(), "terra16").expect("寰宇严格加载")).clone()
}

/// 运行时某片海的音乐分区（海区不存在时直接失败，免得把写错的 key 当成“没写”）。
fn music<'a>(d: &'a StaticData, key: &str) -> Option<&'a str> {
    assert!(d.regions.iter().any(|r| r.key == key), "运行时没有海区 {key}");
    d.geography.places.authored.regions.get(key).and_then(|r| r.music.as_deref())
}

#[test]
fn terra16_regions_carry_the_music_zone_written_in_the_authored_source() {
    let d = terra();
    for (key, zone) in [
        // 日本南岸的黑潮与濑户内海
        ("kuroshio", "japan"),
        ("seto_inland", "japan"),
        ("east_china_sea", "east_china_sea"),
        ("south_china_north", "china"),
        // 伊比利亚外海与地中海
        ("iberia", "iberian"),
        ("tyrrhenian", "mediterranean"),
        ("balearic", "mediterranean"),
        ("levant", "levant"),
        ("baltic", "hansa"),
        ("red_sea", "arabic"),
        ("java_sea", "nusantara"),
        ("east_caribbean", "caribbean"),
    ] {
        assert_eq!(music(&d, key), Some(zone), "{key}");
    }
}

#[test]
fn every_terra16_runtime_region_matches_exactly_one_authored_row() {
    // 另读一遍创作源，不经过加载器：逐行与运行时的海区比
    let world = manifest_data::resolve_world(&root(), "terra16").expect("世界清单");
    let source: toml::Value = toml::from_str(&world.read("regions.toml").expect("海区创作源")).expect("创作源 TOML");
    let rows = source["regions"].as_array().expect("作者海区");
    let d = terra();
    // 地图包的海区按创作源原顺序生成：条数、顺序、key 逐个相同
    assert_eq!(
        rows.iter().map(|r| r["key"].as_str().expect("作者海区的 key")).collect::<Vec<_>>(),
        d.regions.iter().map(|r| r.key.as_str()).collect::<Vec<_>>()
    );
    assert_eq!(d.geography.places.authored.regions.len(), d.regions.len(), "每个运行时海区对上一行，不多不少");
    for (row, region) in rows.iter().zip(&d.regions) {
        let written = row.get("music").and_then(toml::Value::as_str);
        assert!(written.is_some_and(|m| !m.trim().is_empty()), "寰宇每片海都写了音乐分区：{}", region.key);
        assert_eq!(music(&d, &region.key), written, "{}：原样保留作者写的值", region.key);
    }
}

#[test]
fn worlds_without_an_authored_region_source_have_no_music() {
    for key in ["classic", "testbed"] {
        let d = manifest_data::load_world(&root(), key).expect(key);
        assert!(!d.regions.is_empty(), "{key}");
        assert!(d.geography.places.authored.regions.is_empty(), "{key}：没有海区创作源");
    }
}

fn copy(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        // 夹具只用测试海域：不复制庞大的寰宇
        if entry.file_name() == "terra16" {
            continue;
        }
        let dest = to.join(entry.file_name());
        if entry.path().is_dir() {
            copy(&entry.path(), &dest);
        } else {
            std::fs::copy(entry.path(), dest).unwrap();
        }
    }
}

/// 继承测试海域（两片海：test_sea、test_inner）的世界包，包里放一份海区创作源。
/// 数据放在临时目录的 data/ 下，缺省的航线缓存（data 的同级 cache/nav）也就落在临时目录里。
fn fixture(regions: &str) -> (tempfile::TempDir, PathBuf) {
    let tmp = tempfile::tempdir().unwrap();
    let data = tmp.path().join("data");
    copy(&root(), &data);
    let package = data.join("worlds/music_bed");
    std::fs::create_dir_all(&package).unwrap();
    std::fs::write(package.join("world.toml"), "key = 'music_bed'\nname = '音乐分区测试'\ninherit = 'testbed'\n")
        .unwrap();
    std::fs::write(package.join("regions.toml"), regions).unwrap();
    (tmp, data)
}

#[test]
fn music_attaches_by_region_key_and_leaves_regions_and_routes_untouched() {
    // 顺序与地图包不同，其中一片海没写 music，另有一行是地图上没有的海区
    let (_tmp, data) = fixture(
        "[[regions]]\nkey = 'test_inner'\nname = '测试内洋'\n\n\
         [[regions]]\nkey = 'ghost_sea'\nname = '地图上没有的海'\nmusic = 'arctic'\n\n\
         [[regions]]\nkey = 'test_sea'\nname = '测试海'\nmusic = 'Sea-Japan'\n",
    );
    let d = manifest_data::load_world(&data, "music_bed").expect("带创作源的测试世界");
    assert_eq!(d.regions.iter().map(|r| r.key.as_str()).collect::<Vec<_>>(), ["test_sea", "test_inner"]);
    assert_eq!(music(&d, "test_sea"), Some("Sea-Japan"), "原样保留，大小写与连字符交给界面规整");
    assert_eq!(music(&d, "test_inner"), None, "没写 music 的海区");
    let authored = &d.geography.places.authored.regions;
    assert_eq!(
        authored.keys().map(String::as_str).collect::<Vec<_>>(),
        ["test_inner", "test_sea"],
        "只认运行时确有的海区"
    );

    // 音乐分区只是给界面看的内容字段：海区定义、航线表与没有创作源的同一张图完全相同
    let plain = manifest_data::load_world(&data, "testbed").expect("测试海域");
    assert!(plain.geography.places.authored.regions.is_empty());
    assert_eq!(format!("{:?}", d.regions), format!("{:?}", plain.regions));
    assert_eq!(d.nav.route_bytes(), plain.nav.route_bytes());
}

#[test]
fn a_blank_music_zone_counts_as_not_written() {
    let (_tmp, data) = fixture("[[regions]]\nkey = 'test_sea'\nname = '测试海'\nmusic = '  '\n");
    let d = manifest_data::load_world(&data, "music_bed").expect("空白的音乐分区");
    assert_eq!(music(&d, "test_sea"), None);
    assert!(d.geography.places.authored.regions.contains_key("test_sea"), "这一行仍对上了海区");
    assert_eq!(music(&d, "test_inner"), None, "创作源里没有这片海");
    assert!(!d.geography.places.authored.regions.contains_key("test_inner"));
}

#[test]
fn a_music_zone_that_is_not_text_is_rejected() {
    let (_tmp, data) = fixture("[[regions]]\nkey = 'test_sea'\nname = '测试海'\nmusic = 3\n");
    let error = manifest_data::load_world(&data, "music_bed").expect_err("music 不是文字");
    assert!(
        matches!(&error, manifest_data::worlds::WorldError::Data(e) if e.issues.iter().any(|i| {
            i.file == "regions.toml" && i.item == "regions[test_sea]" && i.message.contains("music")
        })),
        "{error}"
    );
}
