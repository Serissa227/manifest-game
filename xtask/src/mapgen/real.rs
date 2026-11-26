//! 真实地图入口：本地来源校验、地球图层、锚地、导航配置与可复现诊断。

use super::coast::{Point, Projection};
use super::config::Config;
use super::layers::Layers;
use super::{biomes, check, coast, elevation, fine, rivers};
use anyhow::{Context, Result, bail, ensure};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::Read;
use std::path::Path;

// 复用已验收的无依赖 PNG 编码器，经典与真实地图只编译同一份实现。
use crate::worldgen::png;

/// 地理输入列表固定；B9b另由[real].climate_regions指定必需的手写气候区表。
const REQUIRED: [&str; 4] = ["land", "lakes", "elevation", "rivers"];

pub fn check_sources(config: &Config) -> Result<()> {
    for name in REQUIRED {
        ensure!(config.sources.contains_key(name), "缺少 {name}（见 mapgen.toml 的 [sources]）");
    }
    for (name, source) in &config.sources {
        if !source.path.is_file() {
            bail!("缺少 {}：{}（见 mapgen.toml 的 [sources]）", name, source.path.display());
        }
        let mut file = std::fs::File::open(&source.path).with_context(|| format!("读取来源 {name}"))?;
        let mut hasher = blake3::Hasher::new();
        let mut buffer = [0u8; 64 * 1024];
        loop {
            let n = file.read(&mut buffer).with_context(|| format!("读取来源 {name}"))?;
            if n == 0 {
                break;
            }
            hasher.update(&buffer[..n]);
        }
        let actual = hasher.finalize().to_hex();
        ensure!(
            actual.as_str().eq_ignore_ascii_case(&source.blake3),
            "来源 {name} 校验和不符：{}（见 mapgen.toml 的 [sources]）",
            source.path.display()
        );
    }
    Ok(())
}

pub fn run(config: &Config) -> Result<()> {
    write(config, false)
}

/// 只写 `fine/` 子目录的细图层（`--fine-only`）。既有的图层里有后来手工追加的内容（锚地的追加条目与注释、
/// 随文案更新的地标说明），整套重写会把它们冲掉；只想更新细图层时用这个入口，其余文件一个字节都不碰。
pub fn run_fine_only(config: &Config) -> Result<()> {
    write(config, true)
}

fn write(config: &Config, fine_only: bool) -> Result<()> {
    check_sources(config)?;
    let generated = rasterize(config)?;
    if fine_only {
        // 细图层必须对着已提交的航行网格生成：来源或生成器变了、海陆对不上时明确失败
        let committed = std::fs::read_to_string(config.output.join("map.txt")).context("读取已提交的 map.txt")?;
        ensure!(
            committed == generated.layers.0[0],
            "--fine-only：重新栅格化的海陆与已提交的 map.txt 不一致，细图层不能对着另一张航行网格生成"
        );
    } else {
        generated.layers.write(&config.output, config.width, config.height)?;
        for (name, text) in &generated.extra {
            std::fs::write(config.output.join(name), text)?;
        }
    }
    // 细图层（M01）：追加的产物，放在 fine/ 子目录；上面那些既有图层的字节不受影响
    let fine_dir = config.output.join("fine");
    std::fs::create_dir_all(&fine_dir)?;
    std::fs::write(fine_dir.join(fine::COAST_FILE), &generated.fine.coast)?;
    std::fs::write(fine_dir.join(fine::ELEVATION_FILE), &generated.fine.elevation)?;
    std::fs::write(fine_dir.join(fine::RIVERS_FILE), &generated.fine.rivers)?;
    std::fs::write(fine_dir.join(fine::MANIFEST_FILE), &generated.fine.manifest)?;
    if !fine_only {
        let world = config.world.as_ref().context("真实地图需要 world 内容目录")?;
        std::fs::write(world.join("navigation.toml"), &generated.navigation)?;
    }
    let target = std::env::var_os("CARGO_TARGET_DIR").context("真实地图预览需要设置 CARGO_TARGET_DIR")?;
    let debug = Path::new(&target).join("earth");
    std::fs::create_dir_all(&debug)?;
    std::fs::write(debug.join("preview.png"), generated.preview.png())?;
    std::fs::write(debug.join("climate.json"), generated.climate_diagnostics)?;
    for (name, preview) in generated.seasonal_previews {
        std::fs::write(debug.join(format!("{name}.png")), preview.png())?;
    }
    for screenshot in &config.screenshots {
        let [x, y] = screenshot.origin;
        let [w, h] = screenshot.size;
        std::fs::write(
            debug.join(format!("{}.png", screenshot.name)),
            generated.preview.crop_scaled(x, y, w, h, 6).png(),
        )?;
    }
    std::fs::write(debug.join("report.json"), serde_json::to_string_pretty(&generated.report)?)?;
    std::fs::write(debug.join("fine-report.json"), serde_json::to_string_pretty(&generated.fine.report)?)?;
    // 细海岸的调试图：几处海峡与多岛海，每细格一个像素（西、南、东、北，度）
    for (name, bounds) in [
        ("fine-west-japan", [128.0, 31.0, 136.0, 36.0]),
        ("fine-bosporus", [25.0, 38.5, 30.5, 42.0]),
        ("fine-gibraltar", [-7.5, 34.5, -1.5, 38.0]),
        ("fine-denmark", [7.5, 53.5, 14.5, 58.5]),
        ("fine-malacca", [98.0, 0.0, 105.5, 6.5]),
    ] {
        let projection = Projection {
            width: config.width,
            height: config.height,
            west: config.real.as_ref().map_or(0, |r| r.west),
            north: config.real.as_ref().map_or(0, |r| r.north),
            arcmin: config.real.as_ref().map_or(1, |r| r.arcmin_per_cell),
        };
        let image = fine::preview(&generated.fine.raster, projection, &generated.terrain, bounds);
        std::fs::write(debug.join(format!("{name}.png")), image.png())?;
    }
    println!(
        "earth：{} 陆格，{} 水格，{} 港口；预览 {}",
        generated.report["land_cells"],
        generated.report["water_cells"],
        generated.report["ports"],
        debug.join("preview.png").display()
    );
    Ok(())
}

struct Generated {
    layers: Layers,
    /// 航行网格（`#` 陆、`~` 浅、`.` 深），细图层的调试图用
    terrain: Vec<char>,
    fine: fine::Output,
    extra: BTreeMap<String, String>,
    navigation: String,
    preview: png::Canvas,
    seasonal_previews: BTreeMap<String, png::Canvas>,
    climate_diagnostics: String,
    report: serde_json::Value,
}

fn table(path: &Path) -> Result<toml::Table> {
    toml::from_str(&std::fs::read_to_string(path)?).with_context(|| format!("解析 {}", path.display()))
}

fn authored(world: &Path, group: &str) -> Result<Vec<toml::Value>> {
    let manifest = table(&world.join("world.toml"))?;
    let files = manifest
        .get("tables")
        .and_then(|v| v.get(group))
        .and_then(toml::Value::as_array)
        .with_context(|| format!("world.toml 未登记 {group}"))?;
    let mut rows = Vec::new();
    for file in files {
        let file = file.as_str().context("分片路径不是字符串")?;
        ensure!(!file.contains(['\\', ':']) && file.split('/').all(|p| !p.is_empty() && p != ".."), "分片路径越界");
        let t = table(&world.join(file))?;
        rows.extend(
            t.get(group).and_then(toml::Value::as_array).with_context(|| format!("{file} 没有 {group}"))?.clone(),
        );
    }
    Ok(rows)
}

fn places(rows: &[toml::Value]) -> Result<Vec<check::Place>> {
    rows.iter().cloned().map(|row| row.try_into().context("解析作者地点经纬度")).collect()
}

fn grid(chars: &[char], width: usize, comment: &str) -> String {
    let mut text = format!("// {comment}\n");
    for row in chars.chunks(width) {
        text.extend(row);
        text.push('\n');
    }
    text
}

#[derive(Deserialize)]
struct Region {
    key: String,
    name: String,
    climate: String,
    areas: Vec<[i32; 4]>,
}

struct SeaRegions {
    seas: Vec<char>,
    regions: String,
    navigation: String,
    counts: BTreeMap<String, usize>,
}

fn sea_regions(world: &Path, projection: Projection, land: &[bool]) -> Result<SeaRegions> {
    let source = table(&world.join("regions.toml"))?;
    let regions: Vec<Region> = source.get("regions").context("缺少海区")?.clone().try_into()?;
    let navigation = source.get("navigation").context("缺少 navigation")?;
    let marks = (33u8..=126).map(char::from).filter(|c| !".~#/".contains(*c)).chain('α'..='ω').collect::<Vec<_>>();
    ensure!(regions.len() <= marks.len(), "海区数量超过字符集容量");
    let mut assigned = vec![usize::MAX; land.len()];
    for (ri, region) in regions.iter().enumerate() {
        for &[w, s, e, n] in &region.areas {
            ensure!(w < e && s < n, "{} 海区矩形为空或未拆接缝", region.key);
            for y in 0..projection.height {
                let lat2 = 2 * projection.north - (2 * y as i32 + 1) * projection.arcmin as i32;
                if lat2 < 2 * s || lat2 >= 2 * n {
                    continue;
                }
                for x in 0..projection.width {
                    let lon2 = 2 * projection.west + (2 * x as i32 + 1) * projection.arcmin as i32;
                    if lon2 < 2 * w || lon2 >= 2 * e {
                        continue;
                    }
                    let i = y * projection.width + x;
                    ensure!(assigned[i] == usize::MAX || assigned[i] == ri, "海区重叠 {} at {x},{y}", region.key);
                    assigned[i] = ri;
                }
            }
        }
    }
    ensure!(assigned.iter().all(|&i| i != usize::MAX), "海区没有完整覆盖投影范围");
    let mut counts = BTreeMap::new();
    let mut output = Vec::new();
    for (ri, region) in regions.iter().enumerate() {
        let cells =
            assigned.iter().enumerate().filter_map(|(i, &r)| (r == ri && !land[i]).then_some(i)).collect::<Vec<_>>();
        ensure!(!cells.is_empty(), "海区 {} 没有水格", region.key);
        counts.insert(region.key.clone(), cells.len());
        let rect = [
            cells.iter().map(|i| i % projection.width).min().context("海区为空")?,
            cells.iter().map(|i| i / projection.width).min().context("海区为空")?,
            cells.iter().map(|i| i % projection.width).max().context("海区为空")?,
            cells.iter().map(|i| i / projection.width).max().context("海区为空")?,
        ];
        let mut row = toml::Table::new();
        row.insert("key".into(), region.key.clone().into());
        row.insert("name".into(), region.name.clone().into());
        row.insert("climate".into(), region.climate.clone().into());
        row.insert("mark".into(), marks[ri].to_string().into());
        row.insert("rect".into(), toml::Value::try_from(rect)?);
        let weather = navigation
            .get("regions")
            .and_then(|v| v.get(&region.key))
            .and_then(|v| v.get("weather"))
            .and_then(toml::Value::as_array)
            .context("缺少逐月风流")?;
        ensure!(weather.len() == 12, "{} 需要十二个月", region.key);
        for (season, month) in [("spring", 3), ("summer", 6), ("autumn", 9), ("winter", 0)] {
            let w = &weather[month];
            let dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
            let integer =
                |key: &str| w.get(key).and_then(toml::Value::as_integer).with_context(|| format!("风流缺少 {key}"));
            let mut row_weather = toml::Table::new();
            for (field, key) in [("wind", "wind_dir"), ("current", "current_dir")] {
                let dir = usize::try_from(integer(key)?).context("风流方向不能为负")?;
                row_weather.insert(field.into(), dirs.get(dir).context("风流方向越界")?.to_string().into());
            }
            for key in ["wind_strength", "current_strength"] {
                row_weather.insert(key.into(), integer(key)?.into());
            }
            row_weather.insert("storm".into(), toml::Value::Float(integer("storm_bp")?.min(500) as f64 / 10000.0));
            row_weather.insert("pirate".into(), toml::Value::Float(integer("pirate_bp")?.min(500) as f64 / 10000.0));
            row.insert(season.into(), row_weather.into());
        }
        output.push(toml::Value::Table(row));
    }
    let regions = toml::Table::from_iter([("regions".into(), toml::Value::Array(output))]);
    let seas = assigned.iter().enumerate().map(|(i, &r)| if land[i] { '#' } else { marks[r] }).collect();
    Ok(SeaRegions {
        seas,
        regions: format!(
            "# 自动生成：C12海区按原顺序，逐格边界以seas.txt为准。季节兼容回退的风险上限0.05；实际逐月原值完整保留在navigation.toml。\n{}",
            toml::to_string(&regions)?
        ),
        navigation: format!(
            "# 自动导出自regions.toml的navigation子表；去向，整数角分。\n{}",
            toml::to_string(navigation)?
        ),
        counts,
    })
}

fn rasterize(config: &Config) -> Result<Generated> {
    let options = config.real.as_ref().context("真实栅格化需要 [real] 投影与采样配置；不会回退为程序地图")?;
    let climate_path = options.climate_regions.as_ref().context("真实地貌需要 [real].climate_regions 手写气候区表")?;
    let (climate_table, climate_hash) = biomes::ClimateTable::read(climate_path)?;
    ensure!(
        config.wrap_x && options.arcmin_per_cell > 0 && config.width as u32 * options.arcmin_per_cell == 21600,
        "真实地图必须东西环绕一周"
    );
    let projection = Projection {
        width: config.width,
        height: config.height,
        west: options.west,
        north: options.north,
        arcmin: options.arcmin_per_cell,
    };
    let world = config.world.as_ref().context("真实地图需要 world 内容目录")?;
    let port_rows = authored(world, "ports")?;
    let city_rows = authored(world, "cities")?;
    let ports = places(&port_rows)?;
    let cities = places(&city_rows)?;
    let sites = authored(world, "sites")?;
    let discoveries = authored(world, "discoveries")?;
    let mut protected = ports.iter().filter(|p| p.realm.is_none()).map(|p| p.lonlat).collect::<Vec<Point>>();
    for p in sites.iter().chain(&discoveries) {
        if let Some(lonlat) = p.get("lonlat") {
            protected.push(lonlat.clone().try_into()?);
        }
    }
    eprintln!("E21：读取并扫描海岸、岛屿与湖泊");
    let mut polygons = coast::polygons(&coast::read_geojson(&config.sources["land"].path)?, projection)?;
    if let Some(source) = config.sources.get("minor_islands") {
        polygons.extend(coast::polygons(&coast::read_geojson(&source.path)?, projection)?);
    }
    let mask = coast::rasterize(&polygons, projection, options.minimum_island_km2, &protected);
    let lake_source = coast::read_geojson(&config.sources["lakes"].path)?;
    let lake_polygons = coast::polygons(&lake_source, projection)?;
    let lakes = coast::rasterize(&lake_polygons, projection, options.minimum_lake_km2, &[]);
    let mut land = mask.cells;
    for (i, &lake) in lakes.cells.iter().enumerate() {
        if lake {
            land[i] = false;
        }
    }
    // 小岛保留优先于湖面半格投票，包括带地标的湖中岛。
    for &i in &mask.protected {
        land[i] = true;
    }
    let mut realm_patches = Vec::new();
    for p in ports.iter().filter(|p| p.realm.is_some()) {
        let i = projection.cell(p.lonlat).context("秘境坐标越界")?;
        land[i] = true;
        realm_patches.push(serde_json::json!({"key":p.key,"pos":[i%projection.width,i/projection.width],"basis":"设定岛，非 Natural Earth"}));
    }
    let mut patches = check::apply(projection, &mut land, &options.passages, &mask.protected)?;
    patches.extend(check::harbor_patches(
        projection,
        &mut land,
        &mask.coverage,
        &mask.protected,
        &ports,
        &options.passages,
    )?);
    if let Some(target) = std::env::var_os("CARGO_TARGET_DIR") {
        let debug = Path::new(&target).join("earth");
        std::fs::create_dir_all(&debug)?;
        let mut preview = png::Canvas::new(config.width, config.height);
        for (i, &is_land) in land.iter().enumerate() {
            preview.put(
                (i % config.width) as i64,
                (i / config.width) as i64,
                if is_land { [150, 170, 100] } else { [30, 75, 120] },
            );
        }
        std::fs::write(debug.join("preflight.png"), preview.png())?;
        std::fs::write(
            debug.join("preflight-mask.txt"),
            grid(&land.iter().map(|&l| if l { '#' } else { '.' }).collect::<Vec<_>>(), config.width, "验收前诊断海陆"),
        )?;
        std::fs::write(debug.join("preflight-europe.png"), preview.crop_scaled(504, 24, 144, 100, 8).png())?;
    }
    check::validate_passages(projection, &land, &options.passages)?;
    ensure!(mask.protected.iter().all(|&i| land[i]), "水道补丁不能删除港口或地标所保护的岛格");
    let port_anchors = check::anchors(projection, &land, &ports, true)?;
    let city_anchors = check::anchors(projection, &land, &cities, false)?;
    eprintln!("E22：聚合ETOPO5，生成降级地貌");
    let etopo = elevation::Etopo::decode(&std::fs::read(&config.sources["elevation"].path)?, options.elevation_nodata)?;
    let elevation = etopo.aggregate(projection, &land)?;
    let terrain = land.iter().zip(&elevation.meters).map(|(&l, &m)| elevation::terrain(l, m)).collect::<Vec<_>>();
    let relief = land
        .iter()
        .zip(&elevation.meters)
        .map(|(&l, &m)| if l { elevation::relief(m) } else { '.' })
        .collect::<Vec<_>>();
    eprintln!("E23：河网、海区、锚地及输出验收");
    let river_source = coast::read_geojson(&config.sources["rivers"].path)?;
    let (rivers, river_report) = rivers::rasterize(&river_source, projection, &land, options.river_max_rank)?;
    rivers::validate(projection, &land, &rivers)?;
    let climate = biomes::rasterize(&climate_table, projection, &land, &elevation.meters, &rivers)?;
    let biomes = &climate.biomes;
    let SeaRegions { seas, regions, navigation, counts: region_counts } = sea_regions(world, projection, &land)?;
    let mut landmarks = Vec::new();
    for row in &sites {
        let p: Point = row.get("lonlat").context("地标缺少坐标")?.clone().try_into()?;
        let i = projection.cell(p).context("地标越界")?;
        let mut entry = toml::Table::new();
        for key in ["key", "name", "lore", "kind"] {
            entry.insert(key.into(), row.get(key).context("地标缺少字段")?.clone());
        }
        entry.insert(
            "category".into(),
            if row.get("kind").and_then(toml::Value::as_str) == Some("cape") { "natural" } else { "civic" }.into(),
        );
        entry.insert("pos".into(), toml::Value::try_from([i % projection.width, i / projection.width])?);
        landmarks.push(entry);
    }
    #[derive(Serialize)]
    struct Rivers<'a> {
        rivers: &'a [rivers::River],
    }
    #[derive(Serialize)]
    struct Landmarks {
        landmarks: Vec<toml::Table>,
    }
    #[derive(Serialize)]
    struct Anchors<'a> {
        ports: &'a [check::Anchor],
        cities: &'a [check::Anchor],
    }
    let layers = Layers([
        grid(&terrain, config.width, "Natural Earth海陆与ETOPO5浅深；#陆地，~浅水，.深水"),
        grid(&relief, config.width, "陆地平均高程分档0–9，水格为点"),
        grid(biomes, config.width, biomes::DEGRADED_REASON),
        grid(&seas, config.width, "C12逐格海区；Unicode单字符标记，与regions.toml对应"),
        format!(
            "# Natural Earth河网；遇湖面分段，内陆水体终点与裁剪/未接通水系单独报告，不挖河运航道。\n{}",
            toml::to_string(&Rivers { rivers: &rivers })?
        ),
        format!("# C2地标按经纬度投影，发现物接线留给E24。\n{}", toml::to_string(&Landmarks { landmarks })?),
    ]);
    let mut source_table = toml::Table::new();
    source_table.insert("degraded_climate".into(), true.into());
    source_table.insert("climate_note".into(), biomes::DEGRADED_REASON.into());
    source_table.insert(
        "climate_regions".into(),
        toml::Value::Table(toml::Table::from_iter([
            ("path".into(), climate_path.file_name().context("气候区表文件名")?.to_string_lossy().to_string().into()),
            ("blake3".into(), climate_hash.clone().into()),
            ("attribution".into(), "通行的气候分区（柯本分类的大致范围）；手写轮廓，无新下载数据".into()),
            ("seed".into(), toml::Value::try_from(climate_table.seed)?),
        ])),
    );
    source_table
        .insert("coast_method".into(), "每格16条扫描线，横向精确相交长度；面积至少一半为陆地；洞使用奇偶规则".into());
    source_table.insert(
        "elevation_method".into(),
        "ETOPO5大端i16，0度向东与北纬90度起始；4×4样本中海陆分别求均值并向下取整；缺同类样本时陆地0m、水面-1m并计数"
            .into(),
    );
    let mut sources = toml::Table::new();
    for (name, source) in &config.sources {
        sources.insert(
            name.clone(),
            toml::Value::Table(toml::Table::from_iter([
                ("path".into(), source.path.to_string_lossy().to_string().into()),
                ("blake3".into(), source.blake3.clone().into()),
                ("attribution".into(), source.attribution.clone().into()),
            ])),
        );
    }
    source_table.insert("sources".into(), sources.into());
    source_table.insert("patches".into(), toml::Value::try_from(&patches)?);
    source_table.insert("realm_patches".into(), toml::Value::try_from(&realm_patches)?);
    let (_, land_sizes) = check::components(projection, &land, true);
    let (_, lake_sizes) = check::components(projection, &lakes.cells, true);
    let max_offset = port_anchors.iter().map(|a| a.offset_km).fold(0.0, f64::max);
    let report = serde_json::json!({"width":config.width,"height":config.height,"land_cells":land.iter().filter(|&&b|b).count(),"water_cells":land.iter().filter(|&&b|!b).count(),"shallow_cells":terrain.iter().filter(|&&c|c=='~').count(),"deep_cells":terrain.iter().filter(|&&c|c=='.').count(),"land_components":land_sizes.len(),"land_component_sizes":land_sizes,"lake_cells":lakes.cells.iter().filter(|&&b|b).count(),"lake_components":lake_sizes.len(),"retained_island_cells":mask.retained.len(),"protected_island_cells":mask.protected.len(),"regions":region_counts,"patches":patches,"realm_patches":realm_patches,"ports":port_anchors.len(),"cities":city_anchors.len(),"anchors":port_anchors,"city_anchors":city_anchors,"max_anchor_offset_km":max_offset,"rivers":rivers.len(),"river_report":river_report,"degraded_climate":true,"climate_note":biomes::DEGRADED_REASON,"climate_regions_blake3":climate_hash,"climate":climate.report,"elevation_missing_land":elevation.missing_land,"elevation_missing_water":elevation.missing_water,"elevation_nodata_samples":elevation.nodata_samples});
    let mut extra = BTreeMap::from([
        ("regions.toml".into(), regions),
        (
            "sources.toml".into(),
            format!("# 真实来源逐字节BLAKE3；原始输入不入仓库。\n{}", toml::to_string(&source_table)?),
        ),
        (
            "anchors.toml".into(),
            format!(
                "# 自动生成的港口锚地与陆上城址，原始C2经纬度不改。\n{}",
                toml::to_string(&Anchors { ports: &port_anchors, cities: &city_anchors })?
            ),
        ),
    ]);
    extra.insert("map.toml".into(),format!("# 寰宇等距圆柱图；详细整数投影见navigation.toml。\nkey = \"earth\"\nname = \"寰宇图\"\nwidth = {}\nheight = {}\nwrap_x = true\ncell_km = 37\nprojection = \"equirect\"\n",config.width,config.height));
    let mut preview = png::Canvas::new(config.width, config.height);
    let mut seasonal_previews = BTreeMap::from([
        ("snow-01".to_string(), png::Canvas::new(config.width, config.height)),
        ("snow-07".to_string(), png::Canvas::new(config.width, config.height)),
    ]);
    for (i, &cell) in terrain.iter().enumerate() {
        let color = if cell == '.' {
            [26, 60, 110]
        } else if cell == '~' {
            [63, 129, 159]
        } else {
            match biomes[i] {
                'I' => [232, 239, 235],
                'A' => [166, 158, 139],
                'T' => [153, 167, 141],
                'B' => [75, 111, 86],
                'D' => [211, 181, 112],
                'K' => [187, 174, 120],
                'M' => [156, 164, 100],
                'J' => [54, 113, 75],
                'F' => [90, 144, 89],
                'G' => [154, 171, 110],
                'W' => [88, 146, 116],
                _ => [127, 159, 102],
            }
        };
        preview.put((i % config.width) as i64, (i / config.width) as i64, color);
        for (name, season) in &mut seasonal_previews {
            let month = if name == "snow-01" { 0 } else { 6 };
            let seasonal_color = if climate.snow_months[i] & (1 << month) != 0 {
                [240, 241, 230]
            } else if climate.ice_months[i] & (1 << month) != 0 {
                [193, 222, 232]
            } else {
                color
            };
            season.put((i % config.width) as i64, (i / config.width) as i64, seasonal_color);
        }
    }
    for river in &rivers {
        for pair in river.path.windows(2) {
            preview.line(pair[0][0] as i64, pair[0][1] as i64, pair[1][0] as i64, pair[1][1] as i64, 1, [87, 162, 183]);
        }
    }
    for anchor in &port_anchors {
        preview.rect(anchor.pos[0] as i64, anchor.pos[1] as i64, 1, 1, [255, 80, 60]);
    }
    for anchor in &city_anchors {
        preview.put(anchor.pos[0] as i64, anchor.pos[1] as i64, [248, 220, 90]);
    }
    let climate_diagnostics =
        serde_json::to_string(&serde_json::json!({"width":config.width,"height":config.height,"climate":climate}))?;
    eprintln!("M01：细海岸、细高程与细河流");
    let fine = fine::build(&fine::Input {
        projection,
        land: &polygons,
        lakes: &lake_source,
        rivers: &river_source,
        terrain: &terrain,
        etopo: &etopo,
    })?;
    Ok(Generated { layers, terrain, fine, extra, navigation, preview, seasonal_previews, climate_diagnostics, report })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn committed_sources_track_the_current_climate_table() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().expect("仓库");
        let config = Config::read(&root.join("data/maps/earth/mapgen.toml")).expect("earth配置");
        let path = config.real.as_ref().expect("真实地图").climate_regions.as_ref().expect("气候区路径");
        let (climate, hash) = biomes::ClimateTable::read(path).expect("气候区表");
        let sources = table(&config.output.join("sources.toml")).expect("来源");
        assert_eq!(sources["degraded_climate"].as_bool(), Some(true));
        assert_eq!(sources["climate_note"].as_str(), Some(biomes::DEGRADED_REASON));
        assert_eq!(sources["climate_regions"]["path"].as_str(), path.file_name().and_then(|s| s.to_str()));
        assert_eq!(sources["climate_regions"]["blake3"].as_str(), Some(hash.as_str()));
        assert_eq!(sources["climate_regions"]["seed"].as_integer(), Some(climate.seed as i64));
        assert!(sources["climate_regions"]["attribution"].as_str().expect("来源说明").contains("通行的气候分区"));
    }

    #[test]
    fn levant_coast_matches_the_source_and_only_reassigns_the_lebanese_strip() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().expect("仓库");
        let config = Config::read(&root.join("data/maps/earth/mapgen.toml")).expect("earth配置");
        let projection = Projection::earth();
        let map = std::fs::read_to_string(config.output.join("map.txt")).expect("海陆");
        let land = map
            .lines()
            .filter(|s| !s.starts_with("//") && !s.is_empty())
            .flat_map(|s| s.chars().map(|c| c == '#'))
            .collect::<Vec<_>>();
        let generated = sea_regions(config.world.as_ref().expect("世界"), projection, &land).expect("无重叠完整分区");
        let comment = "C12逐格海区；Unicode单字符标记，与regions.toml对应";
        assert_eq!(
            grid(&generated.seas, projection.width, comment),
            std::fs::read_to_string(config.output.join("seas.txt")).expect("已提交海区")
        );
        assert_eq!(generated.regions, std::fs::read_to_string(config.output.join("regions.toml")).expect("海区表"));
        let regions = table(&config.output.join("regions.toml")).expect("海区标记");
        let mark = |key: &str| {
            regions["regions"]
                .as_array()
                .expect("海区")
                .iter()
                .find(|r| r["key"].as_str() == Some(key))
                .expect("海区 key")["mark"]
                .as_str()
                .expect("单字符")
                .chars()
                .next()
                .expect("标记")
        };
        let levant = mark("levant");
        // 贝鲁特使用正式锚地；另两项是的黎波里（黎巴嫩）与西顿近岸的海格探针。
        for (name, x, y) in [("beirut", 646, 113), ("tripoli_lebanon", 647, 112), ("sidon", 645, 115)] {
            let i = y * projection.width + x;
            assert!(!land[i], "{name} 必须是海格");
            assert_eq!(generated.seas[i], levant, "{name}");
        }
        // 反向还原唯一授权的35—36E、30—37N共边条带，再核对旧B9/B9b完整字节哈希。
        let mut before = generated.seas.clone();
        let mut changed = 0;
        for y in 105..126 {
            for x in 645..648 {
                let i = y * projection.width + x;
                if !land[i] {
                    assert_eq!(before[i], levant);
                    before[i] = mark("arabian_sea");
                    changed += 1;
                }
            }
        }
        assert_eq!(changed, 27);
        assert_eq!(
            blake3::hash(grid(&before, projection.width, comment).as_bytes()).to_hex().as_str(),
            "ade9a5a750988301de5cf8520a5e87e32b0a2368119a9c8285dc2ffcdf367a4e"
        );
    }

    #[test]
    fn b9b_preserves_non_climate_layer_hashes() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().expect("仓库");
        // B9/B9b基线；B5b仅更新黎凡特海区及dhofar已有作者名称，其他图层仍锁定原值。
        for (file, expected) in [
            ("data/maps/earth/map.txt", "17f2a13583c05565a05efbb78e678a8049eef3d9051b61bd01ec5758348e2a36"),
            ("data/maps/earth/relief.txt", "e196994e2ebe4e3a1bc437b68feb088fca2e4ccb0c1bf189343a88d7fa3009fd"),
            ("data/maps/earth/seas.txt", "259e6a0bfead05655f4cb03447a044971f86974d009d41ab4e67ead49cba08d7"),
            ("data/maps/earth/anchors.toml", "2651f1448c5ceab8083ea1297f86496c22fbfb6894946e485185022103de2d82"),
            ("data/maps/earth/regions.toml", "eba786fe6948f743383f4e888755d9e1544fffa6cc81cb5a533e38357470f3d1"),
            ("data/maps/earth/rivers.toml", "94a369f16ecbcd67e8f94b3dc91aabc473f33b4d37bc1cbd21e1366aeac027e3"),
            ("data/maps/earth/landmarks.toml", "74c04ab2320a0a26085e397d55d0f99c7c0ae3330c8c41df9b464ed165d4ff56"),
            ("data/maps/earth/map.toml", "c78850ac92b743340ab1ea025fc930ae79c88b9876b29e9544c6af172ee98ea3"),
            ("data/worlds/terra16/navigation.toml", "ef283f34d47c580445d8a215f9642ed1614f981956757c1001996435d075388c"),
        ] {
            let mut bytes = std::fs::read(root.join(file)).expect("基线图层");
            if file == "data/maps/earth/anchors.toml" {
                // E65仅新增盐港；先锁住完整新文件，再精确移除这一个条目，继续核对全部旧字节。
                assert_eq!(
                    blake3::hash(&bytes).to_hex().as_str(),
                    "9d3abefff3c4dead123a8c65d9e0931da9d78247e69cf845e38582daf1f3e790",
                    "E65完整锚地"
                );
                let addition = concat!(
                    "# E65：按现有最近空闲沿岸格规则追加，既有锚地与海陆图不变。\n",
                    "[[ports]]\n",
                    "key = \"aigues_mortes\"\n",
                    "name = \"艾格莫尔特\"\n",
                    "lonlat = [4.1606, 43.5482]\n",
                    "pos = [552, 86]\n",
                    "offset_km = 42.43\n",
                    "hint = \"s\"\n",
                    "hint_satisfied = true\n",
                    "realm = false\n\n",
                );
                let text = std::str::from_utf8(&bytes).expect("锚地UTF-8");
                assert_eq!(text.matches(addition).count(), 1, "唯一且逐字节精确的新增盐港条目");
                bytes = text.replacen(addition, "", 1).into_bytes();
            }
            let baseline = if file == "data/maps/earth/anchors.toml" {
                // B10b 只在原字节后追加四城；旧哈希继续锁住全部旧锚地，新哈希也锁住追加内容。
                assert_eq!(
                    blake3::hash(&bytes).to_hex().as_str(),
                    "7e852bcaecb778263cdf348e356dc33f565d0109e5c528954fd8081fcc5b63dc",
                    "B10b 完整锚地"
                );
                std::str::from_utf8(&bytes)
                    .expect("锚地 UTF-8")
                    .split_once("\n# B10b：补登记城市，不改港口和航线。")
                    .expect("四城追加边界")
                    .0
                    .as_bytes()
            } else {
                &bytes
            };
            assert_eq!(blake3::hash(baseline).to_hex().as_str(), expected, "{file}");
        }
    }

    #[test]
    fn committed_earth_has_all_passages_barriers_lakes_and_author_anchors() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().expect("仓库");
        let config = Config::read(&root.join("data/maps/earth/mapgen.toml")).expect("earth配置");
        let projection = Projection::earth();
        let map = std::fs::read_to_string(config.output.join("map.txt")).expect("生成地图");
        let land = map
            .lines()
            .filter(|s| !s.starts_with("//") && !s.is_empty())
            .flat_map(|s| s.chars().map(|c| c == '#'))
            .collect::<Vec<_>>();
        assert_eq!(land.len(), 1080 * 396);
        check::validate_passages(projection, &land, &config.real.as_ref().expect("配置").passages)
            .expect("全部海峡与两条陆障");
        let (labels, sizes) = check::components(projection, &land, false);
        let ocean = sizes.iter().enumerate().max_by_key(|&(_, size)| size).expect("海洋").0;
        for point in [[51.5, 41.0], [33.0, -1.0], [-69.5, -15.8]] {
            let i = projection.cell(point).expect("湖泊");
            assert!(!land[i]);
            assert_ne!(labels[i], ocean, "内陆湖不能误接海洋");
        }
        #[derive(Deserialize)]
        struct Anchors {
            ports: Vec<check::Anchor>,
            cities: Vec<check::Anchor>,
        }
        let anchors: Anchors =
            toml::from_str(&std::fs::read_to_string(config.output.join("anchors.toml")).expect("锚地")).expect("结构");
        let world = config.world.as_ref().expect("世界");
        let authored = places(&authored(world, "ports").expect("作者港口")).expect("坐标");
        assert_eq!(anchors.ports.len(), authored.len());
        for (anchor, place) in anchors.ports.iter().zip(&authored) {
            assert_eq!((&anchor.key, &anchor.name, anchor.lonlat), (&place.key, &place.name, place.lonlat));
            let i = anchor.pos[1] * projection.width + anchor.pos[0];
            assert_eq!(labels[i], ocean);
            assert!(projection.neighbors(i).any(|j| land[j]));
            let p = projection.center(i);
            assert!(
                match place.anchor_hint.as_str() {
                    "n" => p[1] >= place.lonlat[1],
                    "s" => p[1] <= place.lonlat[1],
                    "e" => p[0] >= place.lonlat[0],
                    "w" => p[0] <= place.lonlat[0],
                    "river" => true,
                    _ => false,
                },
                "{} 锚地方向",
                place.key
            );
        }
        assert_eq!(anchors.cities.len(), 46);
        let authored_cities = places(&super::authored(world, "cities").expect("作者城市")).expect("城市坐标");
        assert_eq!(anchors.cities.len(), authored_cities.len());
        for (anchor, place) in anchors.cities.iter().zip(&authored_cities) {
            assert_eq!((&anchor.key, &anchor.name, anchor.lonlat), (&place.key, &place.name, place.lonlat));
            assert!(land[anchor.pos[1] * projection.width + anchor.pos[0]]);
        }
        let sources = table(&config.output.join("sources.toml")).expect("来源");
        assert_eq!(sources["degraded_climate"].as_bool(), Some(true));
        assert_eq!(sources["sources"].as_table().expect("来源").len(), 5);
    }
}
