//! M01“细海图”：已提交的寰宇细图层能读、与航行网格对得上，并且满足骨架约束。无需原始地理数据或网络。

use manifest_core::nav::Terrain;
use manifest_data::fine_map::{
    FINE_SUB, FineCoast, FineElevation, FineRivers, LAKE, LAND, MIXED, SEA, skeleton_link, verify_skeleton,
};
use manifest_data::worlds::load_map_package;
use std::path::PathBuf;

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data")
}

fn fine(name: &str) -> Vec<u8> {
    std::fs::read(root().join("maps/earth/fine").join(name)).expect("已提交的细图层")
}

/// 经纬度（度）→ 细格坐标（寰宇的投影：西缘 -180°、北缘 72°、每粗格 20 角分）。
fn fine_at(lon: f64, lat: f64) -> (i64, i64) {
    let sub = f64::from(FINE_SUB);
    (((lon + 180.0) * 3.0 * sub).floor() as i64, ((72.0 - lat) * 3.0 * sub).floor() as i64)
}

#[test]
fn committed_fine_coast_keeps_the_navigation_skeleton_for_every_cell_and_link() {
    let package = load_map_package(&root(), "terra16").expect("寰宇的航行网格");
    let map = &package.map;
    let coast = FineCoast::decode(&fine("coast.bin")).expect("细海岸");
    assert_eq!((coast.width, coast.height, coast.sub), (1080, 396, FINE_SUB));
    assert_eq!((u32::from(map.width), u32::from(map.height)), (coast.width, coast.height));
    assert!(map.wrap_x);
    // 航行网格以内核的海图为准：浅海与深海都可航行
    let navigable = map.terrain.iter().map(|t| *t != Terrain::Land).collect::<Vec<_>>();
    let stats = verify_skeleton(&coast, &navigable, map.wrap_x).expect("全部可航行格与全部邻接都满足骨架约束");
    assert_eq!(stats.cells, navigable.iter().filter(|&&n| n).count());
    assert_eq!(stats.cells, 297_927);
    // 每一对直接相通的相邻格都数到了（与逐格逐方向数出来的一致）
    let (w, h) = (usize::from(map.width), usize::from(map.height));
    let links = (0..w * h)
        .map(|cell| (0..8).filter(|&dir| skeleton_link(&navigable, w, h, true, cell, dir).is_some()).count())
        .sum::<usize>();
    assert_eq!(stats.links * 2, links);
    assert!(stats.checked_links > 10_000, "沿岸的邻接要逐细格查过：{}", stats.checked_links);
    // 粗细两层大体一致：整格同类的粗格，类别与航行网格相符的占绝大多数；陆格不会整格是海洋连通的水以外的东西
    let mut agree = 0usize;
    let mut uniform = 0usize;
    for (cell, &nav) in navigable.iter().enumerate() {
        let kind = coast.kind(cell);
        if kind == MIXED {
            continue;
        }
        uniform += 1;
        if (kind == LAND) != nav {
            agree += 1;
        }
        assert!(!(nav && kind == LAND), "可航行格 {cell} 不能整格是陆");
    }
    assert!(agree * 1000 >= uniform * 995, "整格同类的粗格与航行网格一致的比例过低：{agree}/{uniform}");
    assert!(coast.mixed_cells() > 15_000 && coast.mixed_cells() < 40_000, "海岸格数：{}", coast.mixed_cells());
}

#[test]
fn committed_fine_layers_show_real_geography() {
    let coast = FineCoast::decode(&fine("coast.bin")).expect("细海岸");
    let class = |lon: f64, lat: f64| {
        let (fx, fy) = fine_at(lon, lat);
        coast.class_at(fx, fy)
    };
    // 大洋、内陆、内陆水
    assert_eq!(class(-30.0, 0.0), SEA, "大西洋中部");
    assert_eq!(class(160.0, 20.0), SEA, "太平洋");
    assert_eq!(class(90.0, 45.0), LAND, "亚洲腹地");
    assert_eq!(class(-100.0, 40.0), LAND, "北美腹地");
    // 里海在陆地数据里本来就是留出来的水面（湖泊数据不收它）：照海记，不是陆
    assert_eq!(class(51.0, 42.0), SEA, "里海是水");
    assert_eq!(class(-87.0, 47.5), LAKE, "苏必利尔湖");
    assert_eq!(class(33.0, -1.0), LAKE, "维多利亚湖");
    // 真实的海岸：粗格分不出来的窄地与海湾
    assert_eq!(class(130.6, 32.2), LAND, "九州南部");
    assert_eq!(class(129.3, 34.4), LAND, "对马");
    assert_eq!(class(135.0, 34.5), SEA, "大阪湾");
    assert_eq!(class(12.6, 41.9), LAND, "罗马");
    assert_eq!(class(18.5, 40.2), SEA, "塔兰托湾");

    let elevation = FineElevation::decode(&fine("elevation.bin")).expect("细高程");
    assert_eq!((elevation.width, elevation.height, elevation.per_cell), (4320, 1584, 4));
    let meters = |lon: f64, lat: f64| {
        let x = ((lon + 180.0) * 12.0).floor() as usize;
        let y = ((72.0 - lat) * 12.0).floor() as usize;
        elevation.meters[y * 4320 + x]
    };
    assert!(meters(86.9, 28.0) > 5000, "喜马拉雅：{}", meters(86.9, 28.0));
    assert!(meters(142.5, 11.3) < -6000, "马里亚纳海沟：{}", meters(142.5, 11.3));
    assert!(meters(3.0, 56.0) > -200 && meters(3.0, 56.0) < 0, "北海是陆架浅海：{}", meters(3.0, 56.0));
    assert!(meters(-40.0, 30.0) < -3000, "大西洋深海");

    let rivers = FineRivers::decode(&fine("rivers.bin")).expect("细河流");
    assert_eq!((rivers.width, rivers.height, rivers.sub), (1080, 396, FINE_SUB));
    assert!(rivers.rivers.len() > 1000);
    assert!(rivers.rivers.iter().all(|r| r.points.len() >= 2));
    // 纵向都在图内；横向不取模（跨接缝的河段照展开的坐标），但不会离图一整圈以上
    let (fw, fh) = (1080 * i32::from(FINE_SUB), 396 * i32::from(FINE_SUB));
    for river in &rivers.rivers {
        for p in &river.points {
            assert!(p[1] >= 0 && p[1] < fh && p[0] > -fw && p[0] < 2 * fw, "河流点越界：{p:?}");
        }
    }
    assert!(rivers.rivers.iter().any(|r| r.rank <= 1), "有大河");
}

#[test]
fn committed_fine_layers_match_their_manifest() {
    // fine.toml 记着三个文件的 BLAKE3 与长度：文件与说明要一起重新生成、一起提交
    let text = std::fs::read_to_string(root().join("maps/earth/fine/fine.toml")).expect("细图层说明");
    let manifest: toml::Table = toml::from_str(&text).expect("fine.toml");
    assert_eq!(manifest["version"].as_integer(), Some(1));
    assert_eq!(manifest["cells_per_cell"].as_integer(), Some(i64::from(FINE_SUB)));
    for layer in ["coast", "elevation", "rivers"] {
        let entry = manifest[layer].as_table().expect("图层条目");
        let bytes = fine(entry["file"].as_str().expect("文件名"));
        assert_eq!(entry["bytes"].as_integer(), Some(bytes.len() as i64), "{layer} 的长度");
        assert_eq!(entry["blake3"].as_str(), Some(blake3::hash(&bytes).to_hex().as_str()), "{layer} 的校验和");
    }
}
