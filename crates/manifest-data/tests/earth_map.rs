//! B9真实earth的完整资源加载与十二周期航线。无需原始地理数据或网络。

use manifest_core::{LocId, RegionId};
use manifest_data::nav_cache::{NavCacheOptions, NavInput, load_or_build};
use manifest_data::worlds::load_map_package;
use std::path::PathBuf;

#[test]
fn earth_layers_load_and_every_unfrozen_port_pair_has_a_route_in_each_month() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data");
    let world = manifest_data::resolve_world(&root, "terra16").expect("寰宇关联真实地图");
    // 2026-11-02 起寰宇是成品世界（不再是草稿）。
    assert!(!world.manifest.draft);
    assert_eq!(world.map.as_ref().expect("earth").key, "earth");
    let full = manifest_data::load_world(&root, "terra16").expect("B10b 草稿显式完整加载");
    // 养成内容（2026-11-03）：九位主角的家乡玩伴与诺埃尔的看网老人，共 17 人（594 → 611）。
    // 公开版拿掉三位人物：611 → 608。
    assert_eq!((full.locations.len(), full.cast.persons.len()), (240, 608));
    let package = load_map_package(&root, "terra16").expect("全部真实图层严格加载");
    assert_eq!((package.map.width, package.map.height, package.map.wrap_x), (1080, 396, true));
    assert_eq!((package.regions.len(), package.ports.len(), package.cities.len()), (93, 194, 46));
    assert_eq!(package.geography.relief.len(), 1080 * 396);
    assert_eq!(package.geography.biomes.len(), 1080 * 396);
    assert!(!package.geography.rivers.is_empty());
    assert_eq!(package.geography.landmarks.len(), 32);
    let authored = manifest_data::worlds::author_content_files(&root).expect("各世界的作者分片");
    assert!(authored.iter().any(|(rel, _)| rel == "ports_iberia.toml"), "寰宇的作者分片要列进来");
    assert!(!authored.iter().any(|(rel, _)| rel == "navigation.toml"), "数值导航配置不生成虚假的译文文件");
    assert!(authored.iter().any(|(rel, _)| rel == "regions.toml"), "真实海区文案仍逐项检查");
    assert!(authored.iter().any(|(rel, _)| rel.starts_with("ports_")), "港口文案仍逐项检查");
    let all_ports = package.nav_ports();
    assert_eq!(package.ports[193].key, "aigues_mortes", "E65只在既有港口之后追加盐港");
    let ports = &all_ports[..193];
    let input = NavInput {
        world: "terra16",
        map: &package.map,
        regions: &package.regions,
        rules: Some(&package.navigation),
        // 固定 B9 基线的矩阵尺寸；这里只比较既有 193 港的全部航线。
        // 新增内陆城市不参与港间路由，真实世界的地点总数由整包测试另行检查。
        loc_count: 235,
        ports,
    };
    let started = std::time::Instant::now();
    let loaded = load_or_build(input, &NavCacheOptions::for_data_dir(&root)).expect("B4完整航线表");
    println!(
        "earth导航：来源={:?}，耗时={:.3}s，文件={}，字节={}，{:?}",
        loaded.source,
        started.elapsed().as_secs_f64(),
        loaded.cache_path.display(),
        std::fs::metadata(&loaded.cache_path).expect("缓存文件").len(),
        loaded.table.memory()
    );
    assert!(loaded.persistence_error.is_none());
    // B5b仅修正黎巴嫩沿岸27格的海区归属；十二周期路径、代价和时间统计锁定新基线。
    assert_eq!(
        blake3::hash(&loaded.table.route_bytes()).to_hex().as_str(),
        "ae6b55128abe86d3b64933f770cf7d5aab51f6a9cd6bccdc44d3281b8f33fa8b",
        "B5b黎凡特海区修正后的十二个月航线"
    );
    assert_eq!(loaded.table.grid.period_count(), 12);
    let mut checked = 0;
    for month in 0..12 {
        let frozen = |i: usize| {
            package.navigation.port_frozen(LocId::from_idx(i), month)
                || package.navigation.region_frozen(RegionId(package.map.region[package.map.idx(ports[i].1)]), month)
        };
        println!(
            "第{}月封冻例外：{:?}",
            month + 1,
            (0..ports.len()).filter(|&i| frozen(i)).map(|i| package.ports[i].key.as_str()).collect::<Vec<_>>()
        );
        for a in 0..ports.len() {
            for b in 0..ports.len() {
                if a == b {
                    continue;
                }
                let route = loaded.table.compressed_path(month, ports[a].0, ports[b].0);
                assert_eq!(
                    full.nav.compressed_path(month, ports[a].0, ports[b].0),
                    route,
                    "整包运行航线必须与 B9 基线逐条相同"
                );
                if frozen(a) || frozen(b) {
                    assert!(route.is_none(), "封冻港不可出入");
                } else {
                    assert!(
                        route.is_some(),
                        "第{}月 {} → {} 无路",
                        month + 1,
                        package.ports[a].key,
                        package.ports[b].key
                    );
                    checked += 1;
                }
            }
        }
    }
    assert!(checked > 350_000);
    // 新港口另验十二个月双向连接，既有193港矩阵的逐字节金标准保持不变。
    let new = all_ports[193];
    for month in 0..12 {
        for &(other, cell) in ports {
            let frozen = package.navigation.port_frozen(other, month)
                || package.navigation.region_frozen(RegionId(package.map.region[package.map.idx(cell)]), month);
            for (from, to) in [(new.0, other), (other, new.0)] {
                assert_eq!(
                    full.nav.compressed_path(month, from, to).is_some(),
                    !frozen,
                    "新增盐港第{}月双向航路：{}→{}",
                    month + 1,
                    from.0,
                    to.0
                );
            }
        }
    }
    assert_eq!(loaded.table.memory().legacy_expanded_paths, 0);
    println!("earth有效有向港间航线检查：{checked}；{:?}", loaded.table.memory());
}

#[test]
fn attached_map_rejects_stale_anchors_navigation_and_missing_layers() {
    fn copy(from: &std::path::Path, to: &std::path::Path) {
        std::fs::create_dir_all(to).expect("目录");
        for entry in std::fs::read_dir(from).expect("文件") {
            let entry = entry.expect("条目");
            if entry.path().is_dir() {
                copy(&entry.path(), &to.join(entry.file_name()));
            } else {
                std::fs::copy(entry.path(), to.join(entry.file_name())).expect("复制");
            }
        }
    }
    let original = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data");
    let temp = tempfile::tempdir().expect("测试目录");
    copy(&original.join("worlds/terra16"), &temp.path().join("worlds/terra16"));
    copy(&original.join("maps/earth"), &temp.path().join("maps/earth"));
    for (file, old, replacement, expected) in [
        ("maps/earth/anchors.toml", "name = \"圣多明各\"", "name = \"旧名称\"", "anchors.toml"),
        ("maps/earth/anchors.toml", "key = \"santo_domingo\"", "key = \"missing_port\"", "anchors.toml"),
        ("worlds/terra16/navigation.toml", "storm_bp = 600", "storm_bp = 601", "navigation.toml"),
        ("maps/earth/relief.txt", "//", "X/", "relief.txt"),
    ] {
        let path = temp.path().join(file);
        let text = std::fs::read_to_string(&path).expect("图层原文");
        assert!(text.contains(old), "反例匹配 {file}");
        std::fs::write(&path, text.replacen(old, replacement, 1)).expect("反例");
        let error = load_map_package(temp.path(), "terra16").err().expect("拒绝损坏图层");
        assert!(error.to_string().contains(expected), "{error}");
        std::fs::write(path, text).expect("恢复本测试副本");
    }
    std::fs::remove_file(temp.path().join("maps/earth/biomes.txt")).expect("删除本测试图层");
    let error = load_map_package(temp.path(), "terra16").err().expect("拒绝缺失图层");
    assert!(error.to_string().contains("biomes.txt"), "{error}");
}
