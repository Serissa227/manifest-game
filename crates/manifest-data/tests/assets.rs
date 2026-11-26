use manifest_data::assets::{Asset, AssetFile, AssetManifest, Budget, collect, validate, webp_dimensions};
use std::path::{Path, PathBuf};

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

// 夹具用的是真实的码头场景图：2026-11-11 场景大图由 768×336 换成 1152×504，2026-11-12 第十轮 A02 再换成 1536×672，下面几处尺寸随之改。
fn fixture() -> (tempfile::TempDir, AssetManifest) {
    let dir = tempfile::tempdir().expect("临时目录");
    let file = "image.webp";
    std::fs::copy(root().join("frontend/public/scenes/dock_jp.webp"), dir.path().join(file)).expect("图片夹具");
    let manifest = AssetManifest {
        assets: vec![Asset {
            key: "scene/dock".into(),
            category: "scene".into(),
            world: "terra16".into(),
            files: vec![AssetFile {
                path: file.into(),
                dimensions: Some((1536, 672)),
                max_dimensions: None,
                bytes: None,
            }],
            fallback: None,
            license: None,
            attribution: None,
        }],
        ..AssetManifest::default()
    };
    (dir, manifest)
}

#[test]
fn missing_picture_is_an_error_even_when_other_entries_allow_fallback() {
    let (dir, mut manifest) = fixture();
    manifest.assets[0].files[0].path = "missing.webp".into();
    let mut fallback = manifest.assets[0].clone();
    fallback.key = "lore/unpainted".into();
    fallback.files.clear();
    fallback.fallback = Some("尚未绘制".into());
    manifest.assets.push(fallback);
    let report = validate(dir.path(), &manifest, "");
    assert!(report.issues.iter().any(|s| s.contains("缺资源") && s.contains("missing.webp")));
    assert_eq!(report.fallbacks["terra16"].len(), 1);
}

#[test]
fn wrong_dimensions_and_truncated_webp_are_rejected() {
    let (dir, mut manifest) = fixture();
    manifest.assets[0].files[0].dimensions = Some((384, 168));
    assert!(validate(dir.path(), &manifest, "").issues.iter().any(|s| s.contains("尺寸不对")));
    let mut bytes = std::fs::read(dir.path().join("image.webp")).expect("读取");
    assert_eq!(webp_dimensions(&bytes), Some((1536, 672)));
    bytes.pop();
    assert_eq!(webp_dimensions(&bytes), None);
}

#[test]
fn duplicate_keys_are_rejected() {
    let (dir, mut manifest) = fixture();
    manifest.assets.push(manifest.assets[0].clone());
    assert!(validate(dir.path(), &manifest, "").issues.iter().any(|s| s.contains("重复 key")));
}

#[test]
fn budget_counts_unreferenced_files_and_reports_excess() {
    let (dir, mut manifest) = fixture();
    let bytes = std::fs::metadata(dir.path().join("image.webp")).expect("元数据").len();
    std::fs::copy(dir.path().join("image.webp"), dir.path().join("orphan.webp")).expect("残留图片");
    manifest.budgets.push(Budget { name: "terra16".into(), prefix: String::new(), exclude: None, limit: bytes });
    let report = validate(dir.path(), &manifest, "");
    assert_eq!(report.budget_bytes["terra16"], 2 * bytes);
    assert!(report.issues.iter().any(|s| s.contains("预算超限")));
}

#[test]
fn orchestra_budget_matches_the_decimal_bytes_of_its_existing_pipeline() {
    let (dir, mut manifest) = fixture();
    let budget = collect(&root())
        .expect("真实清单的预算")
        .budgets
        .into_iter()
        .find(|b| b.name == "shared orchestra")
        .expect("管弦预算");
    manifest.budgets.push(budget);
    let audio = dir.path().join("audio/orchestra");
    std::fs::create_dir_all(&audio).expect("采样目录");
    let file = std::fs::File::create(audio.join("boundary.mp3")).expect("体积夹具");
    file.set_len(15_000_000).expect("既有管线以十进制 MB 计数");
    assert!(validate(dir.path(), &manifest, "").issues.is_empty());
    file.set_len(15_000_001).expect("超出一字节");
    assert!(validate(dir.path(), &manifest, "").issues.iter().any(|s| s.contains("预算超限：shared orchestra")));
}

#[test]
fn credits_and_declared_byte_size_must_match() {
    let (dir, mut manifest) = fixture();
    manifest.assets[0].license = Some("CC0 1.0".into());
    manifest.assets[0].attribution = Some("Kenney".into());
    manifest.assets[0].files[0].bytes = Some(1);
    let report = validate(dir.path(), &manifest, "CC0 1.0");
    assert!(report.issues.iter().any(|s| s.contains("署名")));
    assert!(report.issues.iter().any(|s| s.contains("大小不对")));
    assert!(!report.issues.iter().any(|s| s.contains("许可为空")));
}

#[test]
fn real_assets_and_all_declared_age_stages_are_valid() {
    let root = root();
    let (manifest, report) = manifest_data::assets::check_repository(&root).expect("收集真实清单");
    assert!(report.issues.is_empty(), "{}", report.issues.join("\n"));
    assert!(report.files.len() > 1900);
    assert!(manifest.references.iter().any(|r| r.world == "terra16" && r.key == "t16-mio-14"));
    assert!(manifest.references.iter().any(|r| r.world == "terra16" && r.key == "lore/court_jp"));
    assert!(
        manifest
            .references
            .iter()
            .any(|r| r.world == "classic" && r.key == "look/23" && r.asset.as_deref() == Some("portrait/captain-23"))
    );
    // 2026-11-11：41 本名著有了自己的图（《伊利亚特》是其中一本），其余的书仍按类别共用封面——两条规则各验一本。
    assert!(
        manifest.references.iter().any(|r| r.world == "terra16"
            && r.key == "item/homer_odyssey_aldine"
            && r.asset.as_deref() == Some("item/book_classics")),
        "作者分片的 read.category 须按前端规则落到共用书籍封面"
    );
    assert!(
        manifest.references.iter().any(|r| r.world == "terra16"
            && r.key == "item/homer_iliad_aldine"
            && r.asset.as_deref() == Some("item/homer_iliad_aldine")),
        "有自己的图的书先用自己的图"
    );
    assert!(report.fallbacks.contains_key("terra16"));
}

#[test]
fn authored_longitude_latitude_ports_cities_and_history_are_collected() {
    let manifest = collect(&root()).expect("真实清单");
    for (key, source) in [
        ("lore/port_bilbao", "world/ports.toml"),
        ("lore/port_paris", "world/cities.toml"),
        ("lore/event_r01_lingjigong_lectures", "history/"),
    ] {
        let reference = manifest
            .references
            .iter()
            .find(|r| r.world == "terra16" && r.key == key && r.source.starts_with(source))
            .unwrap_or_else(|| panic!("作者分片中的引用不能因没有网格坐标而漏掉：{key}"));
        assert!(reference.asset.is_some() || reference.fallback.is_some());
    }
}

#[test]
fn missing_age_stage_is_not_silently_a_programmatic_fallback() {
    let root = root();
    let mut manifest = collect(&root).expect("收集真实清单");
    manifest.assets.retain(|a| a.key != "portrait/t16-mio-14");
    let report =
        validate(&root.join("frontend/public"), &manifest, "CC0 1.0 Kenney VS Chamber Orchestra: Community Edition");
    assert!(report.issues.iter().any(|s| s.contains("引用缺失") && s.contains("t16-mio-14")));
}

#[test]
fn published_lore_requires_both_large_and_medium_pictures() {
    let (dir, mut manifest) = fixture();
    manifest.assets[0].key = "lore/creature_example".into();
    manifest.assets[0].files.push(AssetFile {
        path: "creature_example-m.webp".into(),
        dimensions: Some((384, 168)),
        max_dimensions: None,
        bytes: None,
    });
    let report = validate(dir.path(), &manifest, "");
    assert!(report.issues.iter().any(|s| s.contains("缺资源") && s.contains("creature_example-m.webp")));
}

#[test]
fn independently_cropped_blink_patch_must_fit_its_canvas() {
    let (dir, mut manifest) = fixture();
    let file = &mut manifest.assets[0].files[0];
    file.dimensions = None;
    file.max_dimensions = Some((1536, 672));
    assert!(validate(dir.path(), &manifest, "").issues.is_empty());
    manifest.assets[0].files[0].max_dimensions = Some((1535, 672));
    assert!(validate(dir.path(), &manifest, "").issues.iter().any(|s| s.contains("补丁尺寸不对")));
}
