//! 地理图层的加载与校验（EXPANSION §10.3）：`world/relief.txt`、`world/biomes.txt`、`world/seas.txt`、
//! `world/rivers.toml`、`world/landmarks.toml`，以及 `regions.toml` 各项的可选 `mark` 字段。
//!
//! 这些文件全部可选，缺失时一切按旧规则工作。字符网格与 `map.txt` 同格式：`//` 开头的行是注释，空行忽略，
//! 尺寸必须与地图一致。逐格的问题按种类汇总成一条（数量与前几个例子），避免一张图报出成千上万条。

use super::{Issues, check_keys, load_optional, lookup};
use crate::raw::{LandmarksFile, RegionRaw, RiversFile};
use crate::worlds::EffectiveWorld;
use manifest_core::geo::{Biome, LandmarkCategory, LandmarkDef, MAX_RELIEF, RiverDef, SEA_CHAR};
use manifest_core::ids::{Cell, DiscoveryId};
use manifest_core::nav::{SeaMap, Terrain};
use std::collections::BTreeMap;

pub(super) const RELIEF: &str = "world/relief.txt";
pub(super) const BIOMES: &str = "world/biomes.txt";
pub(super) const SEAS: &str = "world/seas.txt";
pub(super) const RIVERS: &str = "world/rivers.toml";
pub(super) const LANDMARKS: &str = "world/landmarks.toml";

/// `seas.txt` 中表示“未标注”的字符（海格按矩形回退）。与生成器（`cargo xtask worldgen`）的约定一致：
/// 未标注的海格可以照抄 map.txt 写 `.`（深海）或 `~`（浅海）。
const UNMARKED: [char; 2] = ['.', '~'];
/// `seas.txt` 中写在陆格上的字符（与 map.txt 的陆地一致，便于阅读）。陆格也可以写 `.`（兼容手写的图层）。
const LAND_CHAR: char = '#';
/// 不能用作海区标记的字符：未标注、陆地，以及会与 `//` 注释行混淆的斜杠。
const RESERVED_MARKS: [char; 4] = [UNMARKED[0], UNMARKED[1], LAND_CHAR, '/'];
/// 每类逐格问题列出的例子数。
const EXAMPLES: usize = 3;

/// 读取可选的文本文件：不存在时为 None；存在但读不出时报告问题并返回 None。
pub(super) fn read_optional(dir: &EffectiveWorld, rel: &str, is: &mut Issues) -> Option<String> {
    if !dir.contains(rel) {
        return None;
    }
    super::read(dir, rel, is)
}

/// 按种类收集逐格问题，最后每类汇总成一条。
#[derive(Default)]
struct CellErrors {
    kinds: BTreeMap<String, Vec<(u16, u16)>>,
}

impl CellErrors {
    fn add(&mut self, what: impl Into<String>, x: usize, y: usize) {
        self.kinds.entry(what.into()).or_default().push((x as u16, y as u16));
    }

    fn report(self, rel: &str, is: &mut Issues) -> bool {
        let ok = self.kinds.is_empty();
        for (what, cells) in self.kinds {
            let shown: Vec<String> = cells.iter().take(EXAMPLES).map(|(x, y)| format!("({x}, {y})")).collect();
            is.push(rel, "", format!("有 {} 个格子{what}，例如 {}", cells.len(), shown.join("、")));
        }
        ok
    }
}

/// 解析字符网格：尺寸必须与地图一致。返回逐格字符（行优先）；尺寸不符时报告并返回 None。
fn parse_grid(rel: &str, text: &str, width: u16, height: u16, is: &mut Issues) -> Option<Vec<char>> {
    let rows: Vec<&str> =
        text.lines().map(|l| l.trim_end_matches('\r')).filter(|l| !l.starts_with("//") && !l.is_empty()).collect();
    if rows.len() != height as usize {
        is.push(rel, "", format!("行数 {} 与地图的 {height} 行不一致（尺寸应为 {width} × {height}）", rows.len()));
        return None;
    }
    let mut cells = Vec::with_capacity(width as usize * height as usize);
    let mut bad = 0;
    for (y, row) in rows.iter().enumerate() {
        let n = row.chars().count();
        if n != width as usize {
            if bad < 5 {
                is.push(rel, format!("第 {} 行", y + 1), format!("宽度 {n} 与地图的 {width} 列不一致"));
            }
            bad += 1;
            continue;
        }
        cells.extend(row.chars());
    }
    if bad > 5 {
        is.push(rel, "", format!("共有 {bad} 行宽度与地图不一致"));
    }
    (bad == 0).then_some(cells)
}

/// 高程图层：陆格为 `0`–`9`，海格为 `.`。文件不存在时返回空。
pub(super) fn load_relief(dir: &EffectiveWorld, map: &SeaMap, is: &mut Issues) -> Vec<Option<u8>> {
    let Some(text) = read_optional(dir, RELIEF, is) else { return Vec::new() };
    let Some(grid) = parse_grid(RELIEF, &text, map.width, map.height, is) else { return Vec::new() };
    let mut errors = CellErrors::default();
    let w = map.width as usize;
    let layer: Vec<Option<u8>> = grid
        .iter()
        .enumerate()
        .map(|(i, &ch)| {
            let (x, y) = (i % w, i / w);
            let land = map.terrain[i] == Terrain::Land;
            let digit = ch.to_digit(10).filter(|d| *d <= u32::from(MAX_RELIEF)).map(|d| d as u8);
            match (land, ch, digit) {
                (true, _, Some(d)) => Some(d),
                (true, SEA_CHAR, _) => {
                    errors.add("是陆格却没有高程（map.txt 为 #，应写 0–9）", x, y);
                    None
                }
                (false, SEA_CHAR, _) => None,
                (false, _, Some(_)) => {
                    errors.add("是海格却写了高程（高程只能写在陆格上，海格应为 .）", x, y);
                    None
                }
                (_, other, None) => {
                    errors.add(format!("写了未知字符“{other}”（只能用 0–9 与 .）"), x, y);
                    None
                }
            }
        })
        .collect();
    if errors.report(RELIEF, is) { layer } else { Vec::new() }
}

/// 植被 / 地貌图层：陆格为 I T B F G M K D S J W A V X 之一，海格为 `.`。文件不存在时返回空。
pub(super) fn load_biomes(dir: &EffectiveWorld, map: &SeaMap, is: &mut Issues) -> Vec<Option<Biome>> {
    let Some(text) = read_optional(dir, BIOMES, is) else { return Vec::new() };
    let Some(grid) = parse_grid(BIOMES, &text, map.width, map.height, is) else { return Vec::new() };
    let codes = Biome::ALL.iter().map(|b| b.code().to_string()).collect::<Vec<_>>().join(" ");
    let mut errors = CellErrors::default();
    let w = map.width as usize;
    let layer: Vec<Option<Biome>> = grid
        .iter()
        .enumerate()
        .map(|(i, &ch)| {
            let (x, y) = (i % w, i / w);
            let land = map.terrain[i] == Terrain::Land;
            match (land, ch, Biome::from_code(ch)) {
                (true, _, Some(b)) => Some(b),
                (true, SEA_CHAR, _) => {
                    errors.add(format!("是陆格却没有植被代码（应为 {codes} 之一）"), x, y);
                    None
                }
                (false, SEA_CHAR, _) => None,
                (false, _, Some(_)) => {
                    errors.add("是海格却写了植被代码（植被只能写在陆格上，海格应为 .）", x, y);
                    None
                }
                (_, other, None) => {
                    errors.add(format!("写了未知的植被代码“{other}”（应为 {codes} 之一，海格为 .）"), x, y);
                    None
                }
            }
        })
        .collect();
    if errors.report(BIOMES, is) { layer } else { Vec::new() }
}

/// 校验各海区的 `mark`：单个字符、不是保留字符、互不重复。返回每个海区的标记。
pub(super) fn region_marks(regions: &[RegionRaw], is: &mut Issues) -> Vec<Option<char>> {
    let f = "world/regions.toml";
    let mut owner: BTreeMap<char, &str> = BTreeMap::new();
    regions
        .iter()
        .map(|r| {
            let raw = r.mark.as_deref()?;
            let item = format!("regions[{}]", r.key);
            let mut chars = raw.chars();
            let (Some(c), None) = (chars.next(), chars.next()) else {
                is.push(f, &item, format!("mark “{raw}”无效：必须是单个字符（只能写一个字符）"));
                return None;
            };
            if c.is_whitespace() || c.is_control() || RESERVED_MARKS.contains(&c) {
                is.push(f, &item, format!("mark “{raw}”无效：不能是空白或保留字符 . ~ # /"));
                return None;
            }
            if let Some(other) = owner.insert(c, r.key.as_str()) {
                is.push(f, &item, format!("mark “{c}”与海区“{other}”重复"));
            }
            Some(c)
        })
        .collect()
}

/// 海区标记图层：返回每格按标记指定的海区下标（未标注的格为 None，交给矩形回退）。
/// 文件不存在时返回 None；有问题时报告并返回 None。
pub(super) fn load_seas(
    dir: &EffectiveWorld,
    width: u16,
    height: u16,
    terrain: &[Terrain],
    marks: &[Option<char>],
    is: &mut Issues,
) -> Option<Vec<Option<u16>>> {
    let text = read_optional(dir, SEAS, is)?;
    let grid = parse_grid(SEAS, &text, width, height, is)?;
    let by_mark: BTreeMap<char, u16> =
        marks.iter().enumerate().filter_map(|(ri, m)| m.map(|c| (c, ri as u16))).collect();
    let mut errors = CellErrors::default();
    let w = width as usize;
    let assigned: Vec<Option<u16>> = grid
        .iter()
        .enumerate()
        .map(|(i, &ch)| {
            let (x, y) = (i % w, i / w);
            let land = terrain.get(i) == Some(&Terrain::Land);
            match (land, ch) {
                (_, '.') | (false, '~') | (true, LAND_CHAR) => None,
                (false, LAND_CHAR) => {
                    errors.add("是海格却写了 #（# 只能写在陆格上；未标注的海格写 . 或 ~）", x, y);
                    None
                }
                (true, '~') => {
                    errors.add("是陆格却写了浅海 ~（陆格写 #）", x, y);
                    None
                }
                (true, other) => {
                    errors.add(format!("是陆格却写了海区标记“{other}”（海区标记只能写在海格上）"), x, y);
                    None
                }
                (false, other) => match by_mark.get(&other) {
                    Some(ri) => Some(*ri),
                    None => {
                        errors.add(format!("的标记“{other}”不对应 regions.toml 中任何海区的 mark"), x, y);
                        None
                    }
                },
            }
        })
        .collect();
    errors.report(SEAS, is).then_some(assigned)
}

/// 某格的上下左右四邻中是否有海。入海口按生成器的约定须与海**正交**相邻：
/// 只隔着对角与海相邻时，河口会斜穿过岸角，海图上画出来像是断在岸边。
fn touches_sea(map: &SeaMap, c: Cell) -> bool {
    [0, 2, 4, 6].into_iter().filter_map(|dir| map.topology().neighbor(c, dir)).any(|n| map.is_sea(n))
}

/// 河流：key 合法唯一、宽度 1–3、折线至少两点且每点都是界内陆格、相邻两点八方向相邻；
/// 每条河都要“通海”——终点与海正交相邻，或终点落在（或紧邻）另一条通海河流上（支流汇入干流）。
pub(super) fn load_rivers(dir: &EffectiveWorld, map: &SeaMap, is: &mut Issues) -> Vec<RiverDef> {
    let Some(raw) = load_optional::<RiversFile>(dir, RIVERS, is) else { return Vec::new() };
    check_keys(RIVERS, "rivers", raw.rivers.iter().map(|r| (r.key.as_str(), r.name.as_str())), is);
    let mut rivers = Vec::new();
    for r in &raw.rivers {
        let item = format!("rivers[{}]", r.key);
        if !(1..=3).contains(&r.width) {
            is.push(RIVERS, &item, format!("width {} 无效，必须在 1 到 3 之间", r.width));
        }
        if r.path.len() < 2 {
            is.push(RIVERS, &item, "path 至少需要 2 个点（从源头到入海口）");
            continue;
        }
        let mut path = Vec::with_capacity(r.path.len());
        let mut ok = true;
        for (i, &[x, y]) in r.path.iter().enumerate() {
            if x < 0 || y < 0 || x >= map.width as i64 || y >= map.height as i64 {
                is.push(RIVERS, &item, format!("path 第 {} 点 [{x}, {y}] 超出地图范围", i + 1));
                ok = false;
                break;
            }
            let c = Cell::new(x as u16, y as u16);
            if map.is_sea(c) {
                is.push(RIVERS, &item, format!("path 第 {} 点 [{x}, {y}] 是海格（河流只能流经陆格）", i + 1));
                ok = false;
                break;
            }
            if let Some(&prev) = path.last()
                && map.topology().chebyshev(prev, c) != 1
            {
                is.push(
                    RIVERS,
                    &item,
                    format!("path 第 {} 点与第 {} 点 [{x}, {y}] 不相邻（相邻两点须八方向相邻）", i, i + 1),
                );
                ok = false;
                break;
            }
            path.push(c);
        }
        if ok {
            rivers.push(RiverDef { key: r.key.clone(), name: r.name.clone(), path, width: r.width.clamp(1, 3) as u8 });
        }
    }
    // 通海：先找终点与海相邻的河，再反复加入汇入已通海河流的支流，直到不再变化
    let mut reaches: Vec<bool> = rivers.iter().map(|r| r.path.last().is_some_and(|&m| touches_sea(map, m))).collect();
    loop {
        let mut changed = false;
        for i in 0..rivers.len() {
            if reaches[i] {
                continue;
            }
            let Some(&mouth) = rivers[i].path.last() else { continue };
            let joins = rivers.iter().enumerate().any(|(j, other)| {
                j != i && reaches[j] && other.path.iter().any(|&c| map.topology().chebyshev(c, mouth) <= 1)
            });
            if joins {
                reaches[i] = true;
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }
    for (r, ok) in rivers.iter().zip(&reaches) {
        if !ok && let Some(m) = r.path.last() {
            is.push(
                RIVERS,
                format!("rivers[{}]", r.key),
                format!("终点 [{}, {}] 不与海相邻，也没有汇入通海的河流（入海口须与海正交相邻）", m.x, m.y),
            );
        }
    }
    rivers
}

/// 地标：key 合法唯一、category 合法、kind 非空、占地矩形在界内、`discovery` 引用存在的发现物。
pub(super) fn load_landmarks(
    dir: &EffectiveWorld,
    map: &SeaMap,
    discovery_ids: &BTreeMap<String, DiscoveryId>,
    is: &mut Issues,
) -> Vec<LandmarkDef> {
    let Some(raw) = load_optional::<LandmarksFile>(dir, LANDMARKS, is) else { return Vec::new() };
    check_keys(LANDMARKS, "landmarks", raw.landmarks.iter().map(|l| (l.key.as_str(), l.name.as_str())), is);
    let (w, h) = (map.width as i64, map.height as i64);
    let mut out = Vec::new();
    for l in &raw.landmarks {
        let item = format!("landmarks[{}]", l.key);
        let category = LandmarkCategory::parse(&l.category).unwrap_or_else(|| {
            let all: Vec<&str> = LandmarkCategory::ALL.iter().map(|c| c.key()).collect();
            is.push(LANDMARKS, &item, format!("category “{}”无效，应为 {} 之一", l.category, all.join(" / ")));
            LandmarkCategory::Natural
        });
        if l.kind.trim().is_empty() {
            is.push(LANDMARKS, &item, "kind 不能为空");
        }
        let [x, y] = l.pos;
        let [sw, sh] = l.size.unwrap_or([1, 1]);
        if sw < 1 || sh < 1 {
            is.push(LANDMARKS, &item, format!("size [{sw}, {sh}] 无效，宽高至少为 1"));
        }
        let inside = x >= 0 && y >= 0 && x + sw.max(1) <= w && y + sh.max(1) <= h;
        if !inside {
            is.push(LANDMARKS, &item, format!("占地（左上角 [{x}, {y}]，宽高 [{sw}, {sh}]）超出地图范围（{w} × {h}）"));
        }
        let discovery = l.discovery.as_ref().and_then(|k| lookup(discovery_ids, k, LANDMARKS, &item, "发现物", is));
        let cell = if inside { Cell::new(x as u16, y as u16) } else { Cell::new(0, 0) };
        out.push(LandmarkDef {
            key: l.key.clone(),
            name: l.name.clone(),
            category,
            kind: l.kind.clone(),
            cell,
            size: (sw.clamp(1, w) as u16, sh.clamp(1, h) as u16),
            lore: l.lore.clone(),
            discovery,
        });
    }
    out
}
