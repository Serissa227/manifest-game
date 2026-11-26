use super::*;

fn table() -> ClimateTable {
    ClimateTable::parse(include_str!("../../../../data/maps/earth/climate_regions.toml")).expect("手写气候区")
}

fn conditions(point: Point, meters: i32, ocean_distance: u16) -> Conditions {
    Conditions { point, meters, ocean_distance, freshwater_distance: 10, slope_moisture: 0.0, variation: 0.0 }
}

#[test]
fn degraded_biomes_use_latitude_height_and_distance_symmetrically() {
    // B9b改为先定气候区。同纬同高但不同地区不再强制得到同地貌。
    assert_eq!(classify(Climate::Rainforest, conditions([0.0, 0.0], 0, 1)), 'W');
    assert_eq!(classify(Climate::Rainforest, conditions([0.0, 0.0], 100, 20)), 'J');
    assert_eq!(classify(Climate::Desert, conditions([0.0, 25.0], 300, 20)), 'D');
    assert_eq!(classify(Climate::Desert, conditions([0.0, 25.0], 300, 1)), 'D');
    assert_eq!(classify(Climate::Broadleaf, conditions([0.0, 45.0], 200, 2)), 'F');
    assert_eq!(classify(Climate::Grassland, conditions([0.0, 45.0], 200, 20)), 'G');
    assert_eq!(classify(Climate::Rainforest, conditions([0.0, 10.0], 6000, 2)), 'A');
    assert_eq!(classify(Climate::Ice, conditions([0.0, 70.0], 1000, 2)), 'I');
    for lat in [0.0, 20.0, 40.0, 60.0, 70.0] {
        assert_eq!(snowline(lat), snowline(-lat));
        assert_eq!(
            classify(Climate::Broadleaf, conditions([0.0, lat], 300, 2)),
            classify(Climate::Broadleaf, conditions([0.0, -lat], 300, 2))
        );
    }
    assert!(DEGRADED_REASON.contains("未提供") && DEGRADED_REASON.contains("手写气候区"));
}

#[test]
fn distance_field_wraps_at_the_seam() {
    let p = Projection { width: 5, height: 1, ..Projection::earth() };
    assert_eq!(coast_distance(p, &[false, true, true, true, true]), [0, 1, 2, 2, 1]);
}

const PLACES: [(&str, Point, Climate, char, i32); 8] = [
    ("开罗", [31.24, 30.04], Climate::Desert, 'D', 30),
    ("马瑙斯", [-60.02, -3.12], Climate::Rainforest, 'J', 80),
    ("伦敦", [-0.12, 51.51], Climate::Broadleaf, 'F', 30),
    ("伊尔库茨克", [104.28, 52.29], Climate::Boreal, 'B', 450),
    ("孟买", [72.88, 19.08], Climate::Monsoon, 'J', 30),
    ("利马", [-77.04, -12.05], Climate::Desert, 'D', 150),
    ("珀斯", [115.86, -31.95], Climate::Mediterranean, 'M', 30),
    ("拉萨", [91.13, 29.65], Climate::Highland, 'A', 3650),
];

#[test]
fn known_places_have_regional_climates_and_expected_biomes() {
    let table = table();
    for (name, point, expected, code, height) in PLACES {
        let (climate, key) = table.climate(point);
        assert_eq!(climate, expected, "{name}：{key:?}");
        assert!(key.is_some(), "必须由手写区域覆盖：{name}");
        assert_eq!(classify(climate, conditions(point, height, 10)), code, "{name}");
    }
    for (point, climate) in [
        ([22.0, 0.0], Climate::Rainforest),
        ([114.0, 0.0], Climate::Rainforest),
        ([83.0, 39.0], Climate::Desert),
        ([104.0, 43.0], Climate::Desert),
        ([-110.0, 30.0], Climate::Desert),
        ([-70.0, -24.0], Climate::Desert),
        ([19.0, -24.0], Climate::Desert),
        ([130.0, -25.0], Climate::Desert),
        ([-67.0, -45.0], Climate::Desert),
        ([-102.0, 45.0], Climate::Grassland),
        ([-60.0, -34.0], Climate::Grassland),
        ([39.0, 10.0], Climate::Highland),
    ] {
        assert_eq!(table.climate(point).0, climate, "区域核心：{point:?}");
    }
}

#[test]
fn climate_shapes_wrap_and_later_regions_take_priority() {
    let polygon = Shape::Polygon { points: vec![[170.0, 0.0], [-170.0, 0.0], [-170.0, 10.0], [170.0, 10.0]] };
    let ellipse = Shape::Ellipse { center: [179.0, 5.0], radii: [10.0, 5.0] };
    for shape in [polygon, ellipse] {
        assert!(shape.contains([179.0, 5.0]));
        assert!(shape.contains([-179.0, 5.0]));
        assert!(!shape.contains([0.0, 5.0]));
    }
    let mut table = table();
    table.regions.push(Region {
        key: "override".into(),
        name: "覆盖".into(),
        climate: Climate::Tundra,
        shape: Shape::Ellipse { center: [31.24, 30.04], radii: [2.0, 2.0] },
    });
    assert_eq!(table.climate([31.24, 30.04]), (Climate::Tundra, Some("override")));
}

#[test]
fn climate_table_rejects_invalid_and_unknown_inputs() {
    let good = include_str!("../../../../data/maps/earth/climate_regions.toml");
    for bad in [
        good.replacen("version = 1", "version = 2", 1),
        good.replacen("boundary_jitter_degrees = 0.85", "boundary_jitter_degrees = nan", 1),
        good.replacen("key = \"east_asia_broadleaf\"", "key = \"europe_broadleaf\"", 1),
        good.replacen("radii = [8,8]", "radii = [0,8]", 1),
        good.replacen("climate = \"broadleaf\"", "climate = \"typo\"", 1),
        format!("typo = 1\n{good}"),
        "version=1\nseed=1\nboundary_jitter_degrees=1\nregions=[]".into(),
        "version=1\nseed=1\nboundary_jitter_degrees=1\n[[regions]]\nkey='x'\nname='线'\nclimate='desert'\nshape={kind='polygon',points=[[0,0],[1,1],[2,2]]}".into(),
    ] { assert!(ClimateTable::parse(&bad).is_err()); }
}

#[test]
fn seeded_noise_is_continuous_periodic_and_changes_boundaries() {
    let mut a = table();
    let before = a.warped([100.1, 40.2]);
    assert_eq!(before, a.warped([100.1, 40.2]));
    let nearby = a.warped([100.1001, 40.2001]);
    assert!((before[0] - nearby[0]).abs() < 0.001 && (before[1] - nearby[1]).abs() < 0.001);
    assert!((noise(a.seed, [-180.0, 50.0], 6.0) - noise(a.seed, [180.0, 50.0], 6.0)).abs() < 1e-12);
    let first: Vec<_> = (0..600).map(|i| a.climate([20.0 + i as f64 / 20.0, 16.5]).0).collect();
    a.seed += 1;
    assert_ne!(before, a.warped([100.1, 40.2]));
    let second: Vec<_> = (0..600).map(|i| a.climate([20.0 + i as f64 / 20.0, 16.5]).0).collect();
    assert_ne!(first, second);
}

#[test]
fn continentality_rivers_and_rain_shadow_modify_moisture() {
    let c = conditions([0.0, 45.0], 100, 1);
    let inland = Conditions { ocean_distance: 50, ..c };
    assert!(moisture(Climate::Broadleaf, c) > moisture(Climate::Broadleaf, inland));
    let valley = Conditions { freshwater_distance: 0, ..inland };
    assert!(moisture(Climate::Broadleaf, valley) > moisture(Climate::Broadleaf, inland));
    let p = Projection { width: 15, height: 15, west: 0, north: 3000, arcmin: 20 };
    let mut meters = vec![0; 225];
    let ridge = 7 * p.width + 7;
    meters[ridge] = 2200;
    let windward = orographic(p, &meters, ridge, Climate::Broadleaf);
    let leeward = orographic(p, &meters, 6 * p.width + 8, Climate::Broadleaf);
    assert!(windward > 0.0 && leeward < 0.0);
    assert!(leeward >= -0.28, "同一山脊不能重复施加超过上限的雨影");
    assert_eq!(classify(Climate::Boreal, Conditions { slope_moisture: leeward, ..inland }), 'B');
    assert_eq!(classify(Climate::Broadleaf, Conditions { slope_moisture: leeward, ..inland }), 'G');
    assert_eq!(classify(Climate::Broadleaf, Conditions { slope_moisture: windward, ..inland }), 'F');
    assert_eq!(classify(Climate::Rainforest, conditions([0.0, 5.0], 2000, 1)), 'F');
}

#[test]
fn snow_and_ice_follow_latitude_height_and_opposite_hemisphere_seasons() {
    assert!(snowline(60.0) < snowline(10.0));
    let north = conditions([0.0, 55.0], 900, 20);
    let south = Conditions { point: [0.0, -55.0], ..north };
    let (snow_n, _) = season_masks(north, true, false, 0.7);
    let (snow_s, _) = season_masks(south, true, false, 0.7);
    assert_ne!(snow_n & 1, 0);
    assert_eq!(snow_n & (1 << 6), 0);
    assert_eq!(snow_s & 1, 0);
    assert_ne!(snow_s & (1 << 6), 0);
    assert_eq!(season_masks(conditions([0.0, 5.0], 0, 1), true, false, 0.8).0, 0);
    assert_eq!(season_masks(conditions([0.0, 5.0], 6000, 1), true, false, 0.8).0, 0xfff);
    let (_, ice) = season_masks(conditions([0.0, 55.0], 0, 20), false, false, 0.8);
    assert_ne!(ice & 1, 0);
    assert_eq!(ice & (1 << 6), 0);
    assert_eq!(season_masks(conditions([0.0, 10.0], -100, 0), false, true, 0.8).1, 0);
}

#[test]
fn complete_raster_is_repeatable_and_distinguishes_lakes_from_ocean() {
    let p = Projection { width: 20, height: 12, west: 0, north: 3000, arcmin: 20 };
    let mut land = vec![true; 240];
    for v in &mut land[..20] {
        *v = false;
    }
    land[170] = false;
    let meters: Vec<_> = land.iter().map(|&v| if v { 100 } else { -50 }).collect();
    let river = River { key: "test".into(), name: "河谷".into(), path: vec![[10, 6], [10, 7]], width: 1 };
    let a = rasterize(&table(), p, &land, &meters, &[river]).expect("生成");
    let b = rasterize(&table(), p, &land, &meters, &[]).expect("无河流");
    let c = rasterize(&table(), p, &land, &meters, &[]).expect("重复生成");
    assert_eq!(serde_json::to_vec(&b).expect("序列化"), serde_json::to_vec(&c).expect("序列化"));
    assert_eq!(a.biomes[170], '.');
    assert_eq!(a.ice_months[0], 0, "中纬海洋不按大陆湖泊封冻");
    assert_ne!(a.ice_months[170], 0, "内陆湖有季节封冻");
    assert!(rasterize(&table(), p, &land, &meters[..200], &[]).is_err());
}

fn committed_grid(name: &str) -> Vec<char> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().expect("仓库");
    std::fs::read_to_string(root.join("data/maps/earth").join(name))
        .expect("图层")
        .lines()
        .filter(|l| !l.starts_with("//") && !l.is_empty())
        .flat_map(str::chars)
        .collect()
}

#[test]
fn committed_biomes_match_known_places() {
    let p = Projection::earth();
    let biomes = committed_grid("biomes.txt");
    let land = committed_grid("map.txt");
    for (name, point, _, expected, _) in PLACES {
        let i = p.cell(point).expect("坐标");
        // 沿海城市允许取其正交相邻陆格，不能拿远处内陆像素冒充城市地貌。
        let i = if land[i] == '#' { i } else { p.neighbors(i).find(|&j| land[j] == '#').expect("相邻陆格") };
        assert_eq!(biomes[i], expected, "{name} at {:?}", p.center(i));
    }
}

/// 检查真正的边界：相邻纬度行的有序地貌对连续不变，且两行都为陆地。
fn longest_horizontal_boundary(grid: &[char], width: usize) -> usize {
    let mut longest = 0;
    for rows in grid.chunks(width).collect::<Vec<_>>().windows(2) {
        let (mut last, mut run) = (None, 0);
        for x in 0..width * 2 {
            let pair = (rows[0][x % width], rows[1][x % width]);
            if pair.0 == '.' || pair.1 == '.' || pair.0 == pair.1 {
                last = None;
                run = 0;
                continue;
            }
            run = if last == Some(pair) { run + 1 } else { 1 };
            last = Some(pair);
            longest = longest.max(run.min(width));
        }
    }
    longest
}

#[test]
fn no_sixty_degree_straight_biome_boundary_in_any_latitude_row() {
    let p = Projection::earth();
    let limit = 60 * 60 / p.arcmin as usize;
    let grid = committed_grid("biomes.txt");
    assert_eq!(grid.len(), p.width * p.height);
    let longest = longest_horizontal_boundary(&grid, p.width);
    assert!(longest < limit, "最长直线边界{longest}格，须短于60度（{limit}格）");
    // 负例确保测试会抓住旧式纬度直条，包含跨接缝的边界。
    let bands: Vec<_> = (0..p.width * 2).map(|i| if i < p.width { 'D' } else { 'S' }).collect();
    assert_eq!(longest_horizontal_boundary(&bands, p.width), p.width);
    let mut seam = vec!['.'; 2 * p.width];
    for x in (0..100).chain(p.width - 100..p.width) {
        seam[x] = 'B';
        seam[p.width + x] = 'T';
    }
    assert_eq!(longest_horizontal_boundary(&seam, p.width), 200);
}
