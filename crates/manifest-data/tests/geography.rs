//! 第五批：写实地理的数据图层（EXPANSION §10.3）——`world/relief.txt`、`world/biomes.txt`、`world/seas.txt`
//! （与 `regions.toml` 的 `mark`）、`world/rivers.toml`、`world/landmarks.toml` 的加载与校验。
//!
//! 底座是“基础世界”（正式数据去掉扩展内容并裁回 240×120，见 `manifest_data::bench::strip_expansion`），
//! 测试按其地图生成合法的图层，再逐项制造错误，断言错误信息指明文件与原因。

use manifest_core::geo::{Biome, Geography, LandmarkCategory};
use manifest_core::ids::{Cell, DiscoveryId, RegionId};
use manifest_core::weather::Climate;
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

/// 待写入的文件：（相对路径, 内容）。
type Files<'a> = Vec<(&'a str, String)>;

const LAYERS: [&str; 5] =
    ["world/relief.txt", "world/biomes.txt", "world/seas.txt", "world/rivers.toml", "world/landmarks.toml"];

fn path_of(root: &Path, rel: &str) -> PathBuf {
    rel.split('/').fold(root.to_path_buf(), |p, part| p.join(part))
}

/// 基础世界，去掉可能存在的全部地理图层（测试自己写入）。海区标记图层包括 seas.txt 与 regions.toml 各项的
/// `mark` 字段（正式数据已带标记），两者一并去掉，测试再按需写入。
fn base_copy(dst: &Path) {
    copy_dir(&data_dir(), dst);
    manifest_data::bench::strip_expansion(dst).unwrap();
    for rel in LAYERS {
        let p = path_of(dst, rel);
        if p.exists() {
            std::fs::remove_file(p).unwrap();
        }
    }
    strip_marks(dst);
}

/// 去掉 regions.toml 各海区的 `mark` 行（正式数据已带海区标记，测试按需自己写入）。
fn strip_marks(root: &Path) {
    let regions = path_of(root, "world/regions.toml");
    let text = std::fs::read_to_string(&regions).unwrap();
    let kept: String =
        text.split_inclusive('\n').filter(|l| !l.trim_start().starts_with("mark =")).collect::<Vec<_>>().concat();
    std::fs::write(regions, kept).unwrap();
}

/// 基础世界的地图（行优先的字符网格，`#` 为陆地）。
fn base_grid() -> &'static Vec<Vec<char>> {
    static GRID: std::sync::OnceLock<Vec<Vec<char>>> = std::sync::OnceLock::new();
    GRID.get_or_init(|| {
        let tmp = tempfile::tempdir().unwrap();
        base_copy(tmp.path());
        let text = std::fs::read_to_string(tmp.path().join("world").join("map.txt")).unwrap();
        text.lines()
            .map(|l| l.trim_end_matches('\r'))
            .filter(|l| !l.starts_with("//") && !l.is_empty())
            .map(|l| l.chars().collect())
            .collect()
    })
}

fn is_land(x: i64, y: i64) -> bool {
    let g = base_grid();
    y >= 0 && x >= 0 && (y as usize) < g.len() && (x as usize) < g[0].len() && g[y as usize][x as usize] == '#'
}

/// 按函数生成与地图同尺寸的字符网格（带一行注释）。
fn layer(f: impl Fn(usize, usize, bool) -> char) -> String {
    let g = base_grid();
    let mut out = String::from("// 测试图层\n");
    for (y, row) in g.iter().enumerate() {
        let line: String = row.iter().enumerate().map(|(x, ch)| f(x, y, *ch == '#')).collect();
        out.push_str(&line);
        out.push('\n');
    }
    out
}

const CODES: [char; 14] = ['I', 'T', 'B', 'F', 'G', 'M', 'K', 'D', 'S', 'J', 'W', 'A', 'V', 'X'];

fn relief_ok() -> String {
    layer(|x, y, land| if land { char::from_digit(((x * 7 + y * 3) % 10) as u32, 10).unwrap() } else { '.' })
}

fn biomes_ok() -> String {
    layer(|x, y, land| if land { CODES[(x / 5 + y / 7) % CODES.len()] } else { '.' })
}

/// 一段入海的河与一条支流所需的格子：第 y 行 x..=x+4 是陆地、x+5 是海；
/// 其上方 y−3..y−1 行、x−1..x+3 列全是陆地（支流的格子不与海相邻）。
struct RiverSpot {
    x: i64,
    y: i64,
}

fn river_spot() -> RiverSpot {
    let g = base_grid();
    let (w, h) = (g[0].len() as i64, g.len() as i64);
    for y in 4..h - 1 {
        for x in 2..w - 7 {
            let run = (0..=4).all(|d| is_land(x + d, y)) && !is_land(x + 5, y);
            let above = (y - 3..y).all(|yy| (x - 1..=x + 3).all(|xx| is_land(xx, yy)));
            if run && above {
                return RiverSpot { x, y };
            }
        }
    }
    panic!("基础世界的地图上找不到可以放河流的海岸");
}

fn main_river(s: &RiverSpot) -> String {
    let pts: Vec<String> = (0..=4).map(|d| format!("[{}, {}]", s.x + d, s.y)).collect();
    format!("[[rivers]]\nkey = \"silver_run\"\nname = \"银川\"\npath = [{}]\nwidth = 3\n", pts.join(", "))
}

fn tributary(s: &RiverSpot) -> String {
    format!(
        "[[rivers]]\nkey = \"fern_brook\"\nname = \"蕨溪\"\npath = [[{x}, {a}], [{x}, {b}]]\nwidth = 1\n",
        x = s.x + 1,
        a = s.y - 2,
        b = s.y - 1
    )
}

const DISCOVERY: &str =
    "[[discoveries]]\nkey = \"old_gate\"\nname = \"古门\"\npos = [3, 3]\nkind = \"ruins\"\nfame = 30\nvalue = 4000\n";

const LANDMARKS_OK: &str = r#"
[[landmarks]]
key = "sunken_colossus"
name = "沉没巨像"
category = "ancient"
kind = "colossus"
pos = [10, 12]
size = [3, 2]
lore = "阿尔坎帝国的守门巨像。"
discovery = "old_gate"

[[landmarks]]
key = "glass_spires"
name = "水晶尖塔林"
category = "arcane"
kind = "crystal_spires"
pos = [20, 30]
"#;

/// 复制基础世界、写入若干文件后加载。
fn load_with(files: &[(&str, String)]) -> Result<std::sync::Arc<manifest_core::StaticData>, String> {
    let tmp = tempfile::tempdir().unwrap();
    base_copy(tmp.path());
    for (rel, text) in files {
        std::fs::write(path_of(tmp.path(), rel), text).unwrap();
    }
    manifest_data::load(tmp.path()).map_err(|e| e.to_string())
}

fn rejected(files: &[(&str, String)], needles: &[&str]) {
    let msg = match load_with(files) {
        Ok(_) => panic!("应被拒绝：{:?}", files.iter().map(|(r, _)| *r).collect::<Vec<_>>()),
        Err(e) => e,
    };
    for needle in needles {
        assert!(msg.contains(needle), "错误信息应包含“{needle}”：\n{msg}");
    }
}

/// 基础世界各海区的矩形（key, [x0, y0, x1, y1]）。
fn region_rects() -> Vec<(String, [u16; 4])> {
    let defs = load_with(&[]).unwrap_or_else(|e| panic!("{e}"));
    defs.regions.iter().map(|r| (r.key.clone(), [r.rect.0, r.rect.1, r.rect.2, r.rect.3])).collect()
}

/// 在 regions.toml 中给某个海区加上一行（如 `mark = "a"`），可同时替换它的矩形。
fn regions_with(key: &str, extra: &str, rect: Option<[u16; 4]>) -> String {
    let tmp = tempfile::tempdir().unwrap();
    base_copy(tmp.path());
    let text = std::fs::read_to_string(tmp.path().join("world").join("regions.toml")).unwrap();
    let anchor = format!("key = \"{key}\"\n");
    assert!(text.contains(&anchor), "regions.toml 中没有海区 {key}");
    let mut out = text.replacen(&anchor, &format!("{anchor}{extra}\n"), 1);
    if let Some([x0, y0, x1, y1]) = rect {
        let start = out.find(&anchor).unwrap();
        let rs = start + out[start..].find("rect = [").unwrap();
        let re = rs + out[rs..].find(']').unwrap() + 1;
        out = format!("{}rect = [{x0}, {y0}, {x1}, {y1}]{}", &out[..rs], &out[re..]);
    }
    out
}

#[test]
fn missing_layer_files_keep_the_old_rules() {
    let defs = load_with(&[]).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(defs.geography, Geography::default(), "没有图层文件时地理图层为空");
    // 海区仍按矩形：每个海格属于第一个包含它的海区
    let map = &defs.map;
    for y in 0..map.height {
        for x in 0..map.width {
            let c = Cell::new(x, y);
            let want = if map.is_sea(c) {
                defs.regions
                    .iter()
                    .position(|r| x >= r.rect.0 && x <= r.rect.2 && y >= r.rect.1 && y <= r.rect.3)
                    .map(RegionId::from_idx)
            } else {
                None
            };
            assert_eq!(map.region_of(c), want, "({x}, {y})");
        }
    }
}

#[test]
fn valid_layers_are_loaded_and_stored() {
    let spot = river_spot();
    let rects = region_rects();
    let (first_key, [fx0, fy0, fx1, fy1]) = rects[0].clone();
    // 把第一个海区矩形内的全部海格标成 a，其余不标（矩形回退）；再把第二个海区矩形内最先的 12 个海格也标成 a
    let (_, [sx0, sy0, sx1, sy1]) = rects[1];
    let g = base_grid();
    let stolen_cells: Vec<(usize, usize)> = (sy0 as usize..=sy1 as usize)
        .flat_map(|y| (sx0 as usize..=sx1 as usize).map(move |x| (x, y)))
        .filter(|(x, y)| g[*y][*x] != '#')
        .take(12)
        .collect();
    assert!(!stolen_cells.is_empty(), "第二个海区应有海格");
    let marked = |x: usize, y: usize| {
        let (ux, uy) = (x as u16, y as u16);
        (ux >= fx0 && ux <= fx1 && uy >= fy0 && uy <= fy1) || stolen_cells.contains(&(x, y))
    };
    let seas = layer(|x, y, land| {
        if land {
            '#'
        } else if marked(x, y) {
            'a'
        } else {
            '.'
        }
    });
    let rivers = format!("# 测试河流\n{}\n{}", main_river(&spot), tributary(&spot));
    let defs = load_with(&[
        ("world/relief.txt", relief_ok()),
        ("world/biomes.txt", biomes_ok()),
        ("world/seas.txt", seas),
        ("world/regions.toml", regions_with(&first_key, "mark = \"a\"", None)),
        ("world/rivers.toml", rivers),
        ("world/discoveries.toml", DISCOVERY.to_string()),
        ("world/landmarks.toml", LANDMARKS_OK.to_string()),
    ])
    .unwrap_or_else(|e| panic!("{e}"));
    let map = &defs.map;
    let geo = &defs.geography;
    // 高程与植被：陆格有值、海格为空，与文件逐格一致
    assert_eq!(geo.relief.len(), map.terrain.len());
    assert_eq!(geo.biomes.len(), map.terrain.len());
    for y in 0..map.height {
        for x in 0..map.width {
            let c = Cell::new(x, y);
            let (ux, uy) = (x as usize, y as usize);
            if map.is_sea(c) {
                assert_eq!((geo.relief_at(map, c), geo.biome_at(map, c)), (None, None), "({x}, {y})");
            } else {
                assert_eq!(geo.relief_at(map, c), Some(((ux * 7 + uy * 3) % 10) as u8));
                assert_eq!(geo.biome_at(map, c).map(Biome::code), Some(CODES[(ux / 5 + uy / 7) % CODES.len()]));
            }
        }
    }
    let rows = geo.relief_rows(map.width).unwrap();
    assert_eq!(rows.len(), map.height as usize);
    assert!(rows.iter().all(|r| r.chars().count() == map.width as usize));
    // 海区：标记优先，未标注的海格按矩形；有 seas.txt 时矩形收紧为实际海格的外接矩形
    let second = RegionId(1);
    for y in 0..map.height {
        for x in 0..map.width {
            let c = Cell::new(x, y);
            if !map.is_sea(c) {
                continue;
            }
            if marked(x as usize, y as usize) {
                assert_eq!(map.region_of(c), Some(RegionId(0)), "({x}, {y}) 按标记属于第一个海区");
            } else if x >= sx0 && x <= sx1 && y >= sy0 && y <= sy1 {
                assert_eq!(map.region_of(c), Some(second), "({x}, {y}) 未标注，按矩形属于第二个海区");
            }
        }
    }
    for &(x, y) in &stolen_cells {
        assert_eq!(map.region_of(Cell::new(x as u16, y as u16)), Some(RegionId(0)), "被标记的格改属第一个海区");
    }
    for (ri, r) in defs.regions.iter().enumerate() {
        let cells: Vec<Cell> =
            (0..map.terrain.len()).filter(|i| map.region[*i] == ri as u16).map(|i| map.cell_of(i)).collect();
        if cells.is_empty() {
            continue;
        }
        let bbox = (
            cells.iter().map(|c| c.x).min().unwrap(),
            cells.iter().map(|c| c.y).min().unwrap(),
            cells.iter().map(|c| c.x).max().unwrap(),
            cells.iter().map(|c| c.y).max().unwrap(),
        );
        assert_eq!(r.rect, bbox, "海区 {} 的范围是其海格的外接矩形", r.key);
    }
    // 河流：干流入海，支流汇入干流
    assert_eq!(geo.rivers.len(), 2);
    let main = &geo.rivers[0];
    assert_eq!((main.key.as_str(), main.name.as_str(), main.width), ("silver_run", "银川", 3));
    assert_eq!(main.path.first(), Some(&Cell::new(spot.x as u16, spot.y as u16)));
    assert_eq!(main.path.len(), 5);
    assert_eq!(geo.rivers[1].width, 1);
    // 地标：类别、占地与发现物引用
    assert_eq!(geo.landmarks.len(), 2);
    let colossus = &geo.landmarks[0];
    assert_eq!(colossus.category, LandmarkCategory::Ancient);
    assert_eq!((colossus.cell, colossus.size), (Cell::new(10, 12), (3, 2)));
    assert_eq!(colossus.discovery, Some(DiscoveryId(0)));
    assert_eq!(colossus.kind, "colossus");
    let spires = &geo.landmarks[1];
    assert_eq!((spires.category, spires.size, spires.discovery), (LandmarkCategory::Arcane, (1, 1), None));
    assert!(spires.lore.is_empty());
    // 所有港口仍互相可达（航行只用海陆与海区）
    let ports: Vec<_> = defs.port_ids().collect();
    for &a in &ports {
        for &b in &ports {
            assert!(a == b || defs.nav.path(0, a, b).is_some());
        }
    }
}

#[test]
fn every_sea_cell_needs_a_region_by_mark_or_rect() {
    let rects = region_rects();
    let (key, [x0, y0, x1, y1]) = rects[0].clone();
    // 把第一个海区的矩形缩成它左上角的一格：原来的海格没有矩形覆盖
    let shrunk = Some([x0, y0, x0, y0]);
    rejected(&[("world/regions.toml", regions_with(&key, "", shrunk))], &["regions.toml", "不属于任何海区"]);
    // 用 seas.txt 把这些海格标成该海区，就合法了
    let seas = layer(|x, y, land| {
        let inside = (x as u16) >= x0 && (x as u16) <= x1 && (y as u16) >= y0 && (y as u16) <= y1;
        if !land && inside { 'k' } else { '.' }
    });
    let defs =
        load_with(&[("world/regions.toml", regions_with(&key, "mark = \"k\"", shrunk)), ("world/seas.txt", seas)])
            .unwrap_or_else(|e| panic!("{e}"));
    let sea_in_rect = (0..defs.map.terrain.len())
        .map(|i| defs.map.cell_of(i))
        .filter(|c| defs.map.is_sea(*c) && c.x >= x0 && c.x <= x1 && c.y >= y0 && c.y <= y1)
        .count();
    assert!(sea_in_rect > 0);
    assert!(
        (0..defs.map.terrain.len())
            .map(|i| defs.map.cell_of(i))
            .filter(|c| defs.map.is_sea(*c) && c.x >= x0 && c.x <= x1 && c.y >= y0 && c.y <= y1)
            .all(|c| defs.map.region_of(c) == Some(RegionId(0)))
    );
}

/// 没写 climate 的海区按 seas.txt 收紧后的实际海面推断气候（纬度取实际范围的中心，而不是回退矩形的中心）；
/// 写了 climate 的海区不受影响。
#[test]
fn inferred_climate_follows_the_marked_sea() {
    let rects = region_rects();
    let (first, [fx0, fy0, fx1, fy1]) = rects[0].clone();
    let second = rects[1].0.clone();
    let plain = load_with(&[]).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(plain.regions[0].climate, Climate::Cold, "第一个海区的回退矩形在北方，推断为寒冷");
    // 第一个海区原来矩形里的海格改标给第二个海区，第一个海区只标南方（行 90–110）的一片海
    let south = |x: usize, y: usize| x < 60 && (90..=110).contains(&y);
    let seas = layer(|x, y, land| {
        let in_first = (x as u16) >= fx0 && (x as u16) <= fx1 && (y as u16) >= fy0 && (y as u16) <= fy1;
        if land {
            '#'
        } else if south(x, y) {
            'a'
        } else if in_first {
            'b'
        } else {
            '.'
        }
    });
    let anchor = format!("key = \"{second}\"\n");
    let regions = regions_with(&first, "mark = \"a\"", None).replacen(&anchor, &format!("{anchor}mark = \"b\"\n"), 1);
    let defs =
        load_with(&[("world/regions.toml", regions), ("world/seas.txt", seas)]).unwrap_or_else(|e| panic!("{e}"));
    let r = &defs.regions[0];
    assert!(r.rect.1 >= 90 && r.rect.3 <= 110, "第一个海区的范围收紧到南方：{:?}", r.rect);
    assert_eq!(r.climate, Climate::Arid, "按实际海面的中心行（落在第三条纬度带）推断为干燥");
    for (a, b) in plain.regions.iter().zip(&defs.regions) {
        let explicit = std::fs::read_to_string(data_dir().join("world").join("regions.toml"))
            .unwrap()
            .split("[[regions]]")
            .any(|block| block.contains(&format!("key = \"{}\"", a.key)) && block.contains("\nclimate ="));
        if explicit {
            assert_eq!(a.climate, b.climate, "写了 climate 的海区 {} 不受 seas.txt 影响", a.key);
        }
    }
}

#[test]
fn broken_relief_and_biome_layers_are_rejected() {
    let g = base_grid();
    let (w, h) = (g[0].len(), g.len());
    let sea = (0..h).flat_map(|y| (0..w).map(move |x| (x, y))).find(|(x, y)| g[*y][*x] != '#').unwrap();
    let land = (0..h).flat_map(|y| (0..w).map(move |x| (x, y))).find(|(x, y)| g[*y][*x] == '#').unwrap();
    let with_cell = |text: String, (cx, cy): (usize, usize), ch: char| -> String {
        let mut rows: Vec<String> = text.lines().map(str::to_string).collect();
        // 第 0 行是注释
        let row: Vec<char> = rows[cy + 1].chars().collect();
        rows[cy + 1] = row.iter().enumerate().map(|(x, c)| if x == cx { ch } else { *c }).collect();
        rows.join("\n")
    };
    let drop_last_row = |text: String| -> String {
        let mut rows: Vec<&str> = text.lines().collect();
        rows.pop();
        rows.join("\n")
    };
    let widen_row = |text: String, y: usize| -> String {
        let mut rows: Vec<String> = text.lines().map(str::to_string).collect();
        rows[y + 1].push('.');
        rows.join("\n")
    };
    let rows_s = format!("{h}");
    let sea_s = format!("({}, {})", sea.0, sea.1);
    let land_s = format!("({}, {})", land.0, land.1);
    let cases: Vec<(&str, String, Vec<&str>)> = vec![
        ("world/relief.txt", drop_last_row(relief_ok()), vec!["relief.txt", "行数", &rows_s]),
        ("world/relief.txt", widen_row(relief_ok(), 3), vec!["relief.txt", "第 4 行", "宽度"]),
        ("world/relief.txt", with_cell(relief_ok(), sea, '5'), vec!["relief.txt", "高程只能写在陆格上", &sea_s]),
        ("world/relief.txt", with_cell(relief_ok(), land, '.'), vec!["relief.txt", "没有高程", &land_s]),
        ("world/relief.txt", with_cell(relief_ok(), land, 'x'), vec!["relief.txt", "未知字符“x”"]),
        ("world/biomes.txt", drop_last_row(biomes_ok()), vec!["biomes.txt", "行数"]),
        ("world/biomes.txt", with_cell(biomes_ok(), sea, 'G'), vec!["biomes.txt", "植被只能写在陆格上", &sea_s]),
        ("world/biomes.txt", with_cell(biomes_ok(), land, '.'), vec!["biomes.txt", "没有植被代码", &land_s]),
        ("world/biomes.txt", with_cell(biomes_ok(), land, 'Z'), vec!["biomes.txt", "未知的植被代码“Z”"]),
    ];
    for (rel, text, needles) in cases {
        rejected(&[(rel, text)], &needles);
    }
    // 大量同类问题汇总成一条（数量 + 例子），而不是逐格报告
    let msg = load_with(&[("world/relief.txt", layer(|_, _, _| '.'))]).unwrap_err();
    let land_cells = g.iter().flatten().filter(|c| **c == '#').count();
    assert!(msg.contains(&format!("有 {land_cells} 个格子是陆格却没有高程")), "{msg}");
    assert!(msg.lines().count() < 10, "逐格问题应汇总：\n{msg}");
}

#[test]
fn broken_sea_marks_are_rejected() {
    let rects = region_rects();
    let key = rects[0].0.clone();
    let g = base_grid();
    let (w, h) = (g[0].len(), g.len());
    let sea = (0..h).flat_map(|y| (0..w).map(move |x| (x, y))).find(|(x, y)| g[*y][*x] != '#').unwrap();
    let land = (0..h).flat_map(|y| (0..w).map(move |x| (x, y))).find(|(x, y)| g[*y][*x] == '#').unwrap();
    let one = |cell: (usize, usize), ch: char| layer(move |x, y, _| if (x, y) == cell { ch } else { '.' });
    let marked = regions_with(&key, "mark = \"a\"", None);
    let cases: Vec<(Files, Vec<&str>)> = vec![
        (
            vec![("world/regions.toml", regions_with(&key, "mark = \"ab\"", None))],
            vec!["regions.toml", "mark", "单个字符"],
        ),
        (vec![("world/regions.toml", regions_with(&key, "mark = \".\"", None))], vec!["regions.toml", "保留字符"]),
        (vec![("world/regions.toml", regions_with(&key, "mark = \" \"", None))], vec!["regions.toml", "保留字符"]),
        (
            vec![("world/regions.toml", {
                let text = regions_with(&key, "mark = \"a\"", None);
                let second = format!("key = \"{}\"\n", rects[1].0);
                text.replacen(&second, &format!("{second}mark = \"a\"\n"), 1)
            })],
            vec!["regions.toml", "mark “a”与海区", "重复"],
        ),
        (
            vec![("world/regions.toml", marked.clone()), ("world/seas.txt", one(land, 'a'))],
            vec!["seas.txt", "海区标记只能写在海格上"],
        ),
        (
            vec![("world/regions.toml", marked.clone()), ("world/seas.txt", one(sea, 'q'))],
            vec!["seas.txt", "标记“q”不对应"],
        ),
        (vec![("world/seas.txt", one(sea, '#'))], vec!["seas.txt", "# 只能写在陆格上"]),
        (
            vec![("world/seas.txt", {
                let t = layer(|_, _, _| '.');
                let mut rows: Vec<&str> = t.lines().collect();
                rows.pop();
                rows.join("\n")
            })],
            vec!["seas.txt", "行数"],
        ),
    ];
    for (files, needles) in cases {
        rejected(&files, &needles);
    }
    // 全部未标注的 seas.txt 与没有它时的海区归属相同
    let plain = load_with(&[]).unwrap();
    let unmarked = load_with(&[("world/seas.txt", layer(|_, _, land| if land { '#' } else { '.' }))]).unwrap();
    assert_eq!(plain.map.region, unmarked.map.region);
}

/// 与生成器（`cargo xtask worldgen`）的约定一致：seas.txt 未标注的海格可以照抄 map.txt 写 `.` 或 `~`，陆格写 `#`；
/// `~` 不能当海区标记；河流的入海口须与海**正交**相邻（只隔着对角与海相邻的不算入海）。
#[test]
fn generator_conventions_are_followed() {
    let g = base_grid();
    let (w, h) = (g[0].len(), g.len());
    // 照抄 map.txt 的海格（. 深海、~ 浅海）作为未标注：与没有 seas.txt 时的海区归属相同
    let copied = layer(|x, y, land| if land { '#' } else { g[y][x] });
    assert!(copied.contains('~') && copied.contains('.'), "基础世界应同时有深海与浅海");
    let plain = load_with(&[]).unwrap();
    let with_copy = load_with(&[("world/seas.txt", copied)]).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(plain.map.region, with_copy.map.region);
    // 陆格写 ~ 是错的
    let land = (0..h).flat_map(|y| (0..w).map(move |x| (x, y))).find(|(x, y)| g[*y][*x] == '#').unwrap();
    rejected(
        &[(
            "world/seas.txt",
            layer(move |x, y, l| {
                if (x, y) == land {
                    '~'
                } else if l {
                    '#'
                } else {
                    '.'
                }
            }),
        )],
        &["seas.txt", "是陆格却写了浅海 ~"],
    );
    // ~ 是保留字符，不能当海区标记
    let key = region_rects()[0].0.clone();
    rejected(
        &[("world/regions.toml", regions_with(&key, "mark = \"~\"", None))],
        &["regions.toml", "mark", "保留字符"],
    );
    // 入海口只与海对角相邻：不算通海
    let sea = |x: i64, y: i64| x >= 0 && y >= 0 && (x as usize) < w && (y as usize) < h && !is_land(x, y);
    let (mx, my) = (1..h as i64 - 1)
        .flat_map(|y| (1..w as i64 - 1).map(move |x| (x, y)))
        .find(|&(x, y)| {
            is_land(x, y)
                && [(0, -1), (1, 0), (0, 1), (-1, 0)].iter().all(|(dx, dy)| is_land(x + dx, y + dy))
                && [(1, 1), (1, -1), (-1, 1), (-1, -1)].iter().any(|(dx, dy)| sea(x + dx, y + dy))
        })
        .expect("基础世界应有只与海对角相邻的陆格");
    let river = format!(
        "[[rivers]]\nkey = \"corner_run\"\nname = \"角溪\"\npath = [[{mx}, {}], [{mx}, {my}]]\nwidth = 1\n",
        my - 1
    );
    rejected(&[("world/rivers.toml", river)], &["rivers[corner_run]", "不与海相邻", "正交"]);
}

#[test]
fn broken_rivers_are_rejected() {
    let s = river_spot();
    let g = base_grid();
    let sea = (0..g.len())
        .flat_map(|y| (0..g[0].len()).map(move |x| (x, y)))
        .find(|(x, y)| g[*y][*x] != '#' && is_land(*x as i64 + 1, *y as i64))
        .unwrap();
    let river = |path: &str, width: i64| {
        format!("[[rivers]]\nkey = \"bad_run\"\nname = \"坏河\"\npath = [{path}]\nwidth = {width}\n")
    };
    let mouth = |d: i64| format!("[{}, {}]", s.x + d, s.y);
    let good_path = format!("{}, {}", mouth(3), mouth(4));
    let cases: Vec<(String, Vec<&str>)> = vec![
        (river(&good_path, 0), vec!["rivers.toml", "rivers[bad_run]", "width"]),
        (river(&good_path, 4), vec!["rivers[bad_run]", "width"]),
        (river(&mouth(4), 2), vec!["rivers[bad_run]", "至少需要 2 个点"]),
        (river(&format!("[9999, 3], {}", mouth(4)), 2), vec!["rivers[bad_run]", "超出地图范围"]),
        (river(&format!("[{}, {}], [{}, {}]", sea.0 + 1, sea.1, sea.0, sea.1), 2), vec!["rivers[bad_run]", "是海格"]),
        (river(&format!("{}, {}", mouth(0), mouth(4)), 2), vec!["rivers[bad_run]", "不相邻"]),
        (river(&format!("{}, {}", mouth(4), mouth(4)), 2), vec!["rivers[bad_run]", "不相邻"]),
        // 孤立的内陆小河：终点不与海相邻，也没有汇入通海的河流
        (tributary(&s).replace("fern_brook", "bad_run"), vec!["rivers[bad_run]", "不与海相邻"]),
        (format!("{}\n{}", main_river(&s), main_river(&s)), vec!["rivers.toml", "key 重复"]),
        (river("[1, \"north\"]", 1), vec!["rivers.toml", "TOML"]),
    ];
    for (text, needles) in cases {
        rejected(&[("world/rivers.toml", text)], &needles);
    }
    // 支流汇入通海的干流是合法的（与文件中的先后顺序无关）
    let defs = load_with(&[("world/rivers.toml", format!("{}\n{}", tributary(&s), main_river(&s)))])
        .unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(defs.geography.rivers.len(), 2);
    assert_eq!(defs.geography.rivers[0].key, "fern_brook");
}

#[test]
fn broken_landmarks_are_rejected() {
    let g = base_grid();
    let (w, h) = (g[0].len(), g.len());
    let mark = |extra: &str| {
        format!(
            "[[landmarks]]\nkey = \"odd_stone\"\nname = \"怪石\"\ncategory = \"natural\"\nkind = \"sea_stack\"\n{extra}\n"
        )
    };
    let cases: Vec<(Files, Vec<&str>)> = vec![
        (
            vec![("world/landmarks.toml", mark("pos = [5, 5]").replace("\"natural\"", "\"magical\""))],
            vec!["landmarks.toml", "landmarks[odd_stone]", "category", "magical"],
        ),
        (
            vec![("world/landmarks.toml", mark("pos = [5, 5]").replace("\"sea_stack\"", "\" \""))],
            vec!["landmarks[odd_stone]", "kind 不能为空"],
        ),
        (
            vec![("world/landmarks.toml", mark(&format!("pos = [{w}, 5]")))],
            vec!["landmarks[odd_stone]", "超出地图范围"],
        ),
        (vec![("world/landmarks.toml", mark("pos = [-1, 5]"))], vec!["landmarks[odd_stone]", "超出地图范围"]),
        (
            vec![("world/landmarks.toml", mark(&format!("pos = [{}, {}]\nsize = [2, 3]", w - 3, h - 2)))],
            vec!["landmarks[odd_stone]", "超出地图范围"],
        ),
        (vec![("world/landmarks.toml", mark("pos = [5, 5]\nsize = [0, 2]"))], vec!["landmarks[odd_stone]", "size"]),
        (
            vec![("world/landmarks.toml", mark("pos = [5, 5]\ndiscovery = \"lost_city\""))],
            vec!["landmarks[odd_stone]", "发现物", "lost_city"],
        ),
        (
            vec![("world/landmarks.toml", format!("{}\n{}", mark("pos = [5, 5]"), mark("pos = [6, 6]")))],
            vec!["landmarks.toml", "key 重复"],
        ),
        (vec![("world/landmarks.toml", mark("pos = [5, 5]\ncolour = 1"))], vec!["landmarks.toml", "colour"]),
    ];
    for (files, needles) in cases {
        rejected(&files, &needles);
    }
    // 占地正好贴着地图右下角是合法的
    let defs = load_with(&[("world/landmarks.toml", mark(&format!("pos = [{}, {}]\nsize = [3, 2]", w - 3, h - 2)))])
        .unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(defs.geography.landmarks[0].size, (3, 2));
}

/// 读取数据目录中地图的字符网格。
fn grid_of(dir: &Path) -> Vec<Vec<char>> {
    let text = std::fs::read_to_string(dir.join("world").join("map.txt")).unwrap();
    text.lines()
        .map(|l| l.trim_end_matches('\r'))
        .filter(|l| !l.starts_with("//") && !l.is_empty())
        .map(|l| l.chars().collect())
        .collect()
}

/// `bench` 的辅助函数在带地理图层的数据上仍可用：裁回旧尺寸时逐格图层随地图裁剪、河流与地标去掉、
/// 只在新区域出现的海区去掉而其标记出现在旧区域的海区保留（矩形夹到旧尺寸内）；合成大世界时逐格图层随地图扩展。
#[test]
fn bench_helpers_crop_and_extend_the_layers() {
    let src = tempfile::tempdir().unwrap();
    copy_dir(&data_dir(), src.path());
    for rel in LAYERS {
        let p = path_of(src.path(), rel);
        if p.exists() {
            std::fs::remove_file(p).unwrap();
        }
    }
    strip_marks(src.path());
    let g = grid_of(src.path());
    let (w, h) = (g[0].len(), g.len());
    let land = |x: usize, y: usize| g[y][x] == '#';
    let full_layer = |f: &dyn Fn(usize, usize, bool) -> char| -> String {
        let mut out = String::from("// 测试图层（全图）\n");
        for y in 0..h {
            out.extend((0..w).map(|x| f(x, y, land(x, y))));
            out.push('\n');
        }
        out
    };
    // 海区标记：frost_west（旧区域）标 a；giants_gate（新区域）标 g，并把旧区域东部最先找到的 5 个海格也标成 g；
    // dawn_sea（只在新区域）标 d
    let regions_text = std::fs::read_to_string(src.path().join("world").join("regions.toml")).unwrap();
    let rect_of = |key: &str| -> [usize; 4] {
        let at = regions_text.find(&format!("key = \"{key}\"")).unwrap_or_else(|| panic!("缺少海区 {key}"));
        let rs = at + regions_text[at..].find("rect = [").unwrap() + 8;
        let nums: Vec<usize> = regions_text[rs..rs + regions_text[rs..].find(']').unwrap()]
            .split(',')
            .map(|t| t.trim().parse().unwrap())
            .collect();
        [nums[0], nums[1], nums[2], nums[3]]
    };
    let inside = |r: [usize; 4], x: usize, y: usize| x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3];
    let (fw, gg, ds) = (rect_of("frost_west"), rect_of("giants_gate"), rect_of("dawn_sea"));
    let edge: Vec<(usize, usize)> =
        (200..240).rev().flat_map(|x| (0..120).map(move |y| (x, y))).filter(|(x, y)| !land(*x, *y)).take(5).collect();
    assert_eq!(edge.len(), 5, "旧区域东部应有海格");
    let seas = full_layer(&|x, y, is_land| {
        if is_land {
            '#'
        } else if edge.contains(&(x, y)) || inside(gg, x, y) {
            'g'
        } else if inside(fw, x, y) {
            'a'
        } else if inside(ds, x, y) {
            'd'
        } else {
            '.'
        }
    });
    let world = src.path().join("world");
    let relief = full_layer(&|x, y, l| if l { char::from_digit(((x + y) % 10) as u32, 10).unwrap() } else { '.' });
    std::fs::write(world.join("relief.txt"), relief).unwrap();
    std::fs::write(world.join("biomes.txt"), full_layer(&|x, _, l| if l { CODES[x % CODES.len()] } else { '.' }))
        .unwrap();
    std::fs::write(world.join("seas.txt"), seas).unwrap();
    let mut regions = regions_text.clone();
    for (key, mark) in [("frost_west", "a"), ("giants_gate", "g"), ("dawn_sea", "d")] {
        let anchor = format!("key = \"{key}\"\n");
        regions = regions.replacen(&anchor, &format!("{anchor}mark = \"{mark}\"\n"), 1);
    }
    std::fs::write(world.join("regions.toml"), regions).unwrap();
    std::fs::write(world.join("landmarks.toml"), LANDMARKS_OK.replace("discovery = \"old_gate\"\n", "")).unwrap();
    // 基础世界里找到的入海河段在完整地图上同样合法（旧区域是完整地图的左上角）
    std::fs::write(world.join("rivers.toml"), main_river(&river_spot())).unwrap();
    let full = manifest_data::load(src.path()).unwrap_or_else(|e| panic!("带图层的完整数据应能加载：{e}"));
    assert_eq!(full.geography.relief.len(), w * h);
    assert_eq!((full.geography.rivers.len(), full.geography.landmarks.len()), (1, 2));
    let gate = full.find_region("giants_gate").unwrap();
    for &(x, y) in &edge {
        assert_eq!(full.map.region_of(Cell::new(x as u16, y as u16)), Some(gate));
    }

    // 裁回旧尺寸
    let base = tempfile::tempdir().unwrap();
    copy_dir(src.path(), base.path());
    manifest_data::bench::strip_expansion(base.path()).unwrap();
    let defs = manifest_data::load(base.path()).unwrap_or_else(|e| panic!("裁剪后的基础世界应能加载：{e}"));
    let (lw, lh) = defs.rules.world.legacy_map;
    assert_eq!((defs.map.width, defs.map.height), (lw, lh));
    let geo = &defs.geography;
    assert_eq!((geo.relief.len(), geo.biomes.len()), (lw as usize * lh as usize, lw as usize * lh as usize));
    assert!(geo.rivers.is_empty() && geo.landmarks.is_empty(), "河流与地标随扩展内容去掉");
    assert_eq!(geo.relief_at(&defs.map, Cell::new(3, 4)), full.geography.relief_at(&full.map, Cell::new(3, 4)));
    let keys: Vec<&str> = defs.regions.iter().map(|r| r.key.as_str()).collect();
    assert!(keys.contains(&"giants_gate"), "标记出现在旧区域的海区保留：{keys:?}");
    assert!(!keys.contains(&"dawn_sea"), "只在新区域的海区去掉：{keys:?}");
    let gate = defs.find_region("giants_gate").unwrap();
    let r = defs.region(gate).rect;
    assert!(r.2 < lw && r.3 < lh, "保留的海区范围在旧尺寸内：{r:?}");
    for &(x, y) in &edge {
        assert_eq!(defs.map.region_of(Cell::new(x as u16, y as u16)), Some(gate));
    }

    // 合成大世界：逐格图层随地图扩展
    let big = tempfile::tempdir().unwrap();
    manifest_data::bench::write_synthetic_world(src.path(), big.path(), Default::default()).unwrap();
    let defs = manifest_data::load(big.path()).unwrap_or_else(|e| panic!("合成世界应能加载：{e}"));
    let n = defs.map.width as usize * defs.map.height as usize;
    assert_eq!((defs.geography.relief.len(), defs.geography.biomes.len()), (n, n));
    let new_land = (0..n).map(|i| defs.map.cell_of(i)).find(|c| c.x >= lw && !defs.map.is_sea(*c)).expect("新大陆");
    assert_eq!(defs.geography.relief_at(&defs.map, new_land), Some(1));
    assert_eq!(defs.geography.biome_at(&defs.map, new_land), Some(Biome::Broadleaf));
}
