//! 地理图层（EXPANSION.md §10.3）：高程、植被 / 地貌、河流与地标。
//!
//! 图层由 `manifest-data` 从可选文件加载并校验；航行与寻路使用海图的海陆与海区。
//! `places` 另存场外地点与作者条件，用于地点查询、港口开放年份与发现条件判断。
//! 数据没有对应文件时图层为空，一切按旧规则工作。

pub mod authored;
pub mod places;
mod survey;

use crate::ids::{Cell, DiscoveryId};
use crate::nav::SeaMap;

/// 高程等级的上限（陆格 0–9：0 海岸低地，9 最高峰）。
pub const MAX_RELIEF: u8 = 9;

/// 图层字符网格中海格的字符。
pub const SEA_CHAR: char = '.';

/// 植被 / 地貌（`biomes.txt` 的单字符代码）。
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Biome {
    /// `I` 冰原
    IceSheet,
    /// `T` 冻原
    Tundra,
    /// `B` 针叶林
    Boreal,
    /// `F` 温带阔叶林
    Broadleaf,
    /// `G` 温带草原
    Grassland,
    /// `M` 地中海灌丛
    Mediterranean,
    /// `K` 半干旱草原
    Steppe,
    /// `D` 热带沙漠
    Desert,
    /// `S` 稀树草原
    Savanna,
    /// `J` 热带雨林
    Rainforest,
    /// `W` 湿地 / 红树林
    Wetland,
    /// `A` 高山（裸岩与积雪）
    Alpine,
    /// `V` 火山地
    Volcanic,
    /// `X` 奥术地貌（奇观专用）
    Arcane,
}

impl Biome {
    pub const ALL: [Biome; 14] = [
        Biome::IceSheet,
        Biome::Tundra,
        Biome::Boreal,
        Biome::Broadleaf,
        Biome::Grassland,
        Biome::Mediterranean,
        Biome::Steppe,
        Biome::Desert,
        Biome::Savanna,
        Biome::Rainforest,
        Biome::Wetland,
        Biome::Alpine,
        Biome::Volcanic,
        Biome::Arcane,
    ];

    /// 数据文件与视图中使用的单字符代码。
    pub fn code(self) -> char {
        match self {
            Biome::IceSheet => 'I',
            Biome::Tundra => 'T',
            Biome::Boreal => 'B',
            Biome::Broadleaf => 'F',
            Biome::Grassland => 'G',
            Biome::Mediterranean => 'M',
            Biome::Steppe => 'K',
            Biome::Desert => 'D',
            Biome::Savanna => 'S',
            Biome::Rainforest => 'J',
            Biome::Wetland => 'W',
            Biome::Alpine => 'A',
            Biome::Volcanic => 'V',
            Biome::Arcane => 'X',
        }
    }

    pub fn from_code(c: char) -> Option<Biome> {
        Biome::ALL.iter().copied().find(|b| b.code() == c)
    }
}

/// 一条河流：从源头到入海口的陆格折线（相邻两点八方向相邻）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RiverDef {
    pub key: String,
    pub name: String,
    pub path: Vec<Cell>,
    /// 河宽等级 1–3
    pub width: u8,
}

/// 地标类别。
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum LandmarkCategory {
    /// 自然奇观
    Natural,
    /// 魔法奇观
    Arcane,
    /// 古代遗迹
    Ancient,
    /// 人文地标
    Civic,
}

impl LandmarkCategory {
    pub const ALL: [LandmarkCategory; 4] =
        [LandmarkCategory::Natural, LandmarkCategory::Arcane, LandmarkCategory::Ancient, LandmarkCategory::Civic];

    pub fn key(self) -> &'static str {
        match self {
            LandmarkCategory::Natural => "natural",
            LandmarkCategory::Arcane => "arcane",
            LandmarkCategory::Ancient => "ancient",
            LandmarkCategory::Civic => "civic",
        }
    }

    pub fn parse(s: &str) -> Option<LandmarkCategory> {
        LandmarkCategory::ALL.iter().copied().find(|c| c.key() == s)
    }
}

/// 地标与奇观（`landmarks.toml`）。占地为以 `cell` 为左上角、`size` 为宽高的矩形。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LandmarkDef {
    pub key: String,
    pub name: String,
    pub category: LandmarkCategory,
    /// 图标种类（美术用的自由文本，如 colossus、maelstrom）
    pub kind: String,
    /// 占地左上角
    pub cell: Cell,
    /// 占地宽高（格），至少 1 × 1
    pub size: (u16, u16),
    pub lore: String,
    /// 对应的发现物
    pub discovery: Option<DiscoveryId>,
}

/// 全部地理图层。逐格图层按行优先存放，与海图同尺寸；数据没有对应文件时为空。
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Geography {
    /// 场外地点及作者地点扩展；缺省为空，不增加存档字段。
    pub places: places::PlaceCatalog,
    /// 每格高程：陆格 0–9，海格为 None
    pub relief: Vec<Option<u8>>,
    /// 每格植被 / 地貌：陆格有值，海格为 None
    pub biomes: Vec<Option<Biome>>,
    pub rivers: Vec<RiverDef>,
    pub landmarks: Vec<LandmarkDef>,
    /// 细河流（`fine/rivers.bin`）流经的粗格，按格下标升序、不重复；没有细图层时为空（H05 汲水用）
    pub fine_rivers: Vec<u32>,
}

impl Geography {
    /// 某格的高程（没有高程图层或是海格时为 None）。
    pub fn relief_at(&self, map: &SeaMap, c: Cell) -> Option<u8> {
        self.relief.get(map.idx(c)).copied().flatten()
    }

    /// 某格的植被 / 地貌（没有植被图层或是海格时为 None）。
    pub fn biome_at(&self, map: &SeaMap, c: Cell) -> Option<Biome> {
        self.biomes.get(map.idx(c)).copied().flatten()
    }

    /// 离 `c` 切比雪夫距离 `reach` 格以内有没有河（细河流，或 `rivers.toml` 的粗河流）。
    pub fn river_near(&self, map: &SeaMap, c: Cell, reach: i64) -> bool {
        let topo = map.topology();
        let near = |r: Cell| topo.chebyshev(c, r) <= reach;
        if self.rivers.iter().any(|r| r.path.iter().any(|p| near(*p))) {
            return true;
        }
        if self.fine_rivers.is_empty() {
            return false;
        }
        let reach = reach.clamp(0, 16) as i32;
        for dy in -reach..=reach {
            for dx in -reach..=reach {
                let (x, y) = (i32::from(c.x) + dx, i32::from(c.y) + dy);
                let x = if map.wrap_x { x.rem_euclid(i32::from(map.width)) } else { x };
                if !map.in_bounds(x, y) {
                    continue;
                }
                let i = map.idx(Cell::new(x as u16, y as u16)) as u32;
                if self.fine_rivers.binary_search(&i).is_ok() {
                    return true;
                }
            }
        }
        false
    }

    /// 高程图层按行输出（陆格 `0`–`9`、海格 `.`）；没有该图层时为 None。
    pub fn relief_rows(&self, width: u16) -> Option<Vec<String>> {
        rows_of(&self.relief, width, |v| v.and_then(|d| char::from_digit(u32::from(d), 10)))
    }

    /// 植被图层按行输出（陆格为代码、海格 `.`）；没有该图层时为 None。
    pub fn biome_rows(&self, width: u16) -> Option<Vec<String>> {
        rows_of(&self.biomes, width, |v| v.map(Biome::code))
    }
}

fn rows_of<T: Copy>(cells: &[T], width: u16, ch: impl Fn(T) -> Option<char>) -> Option<Vec<String>> {
    if cells.is_empty() || width == 0 {
        return None;
    }
    Some(cells.chunks(width as usize).map(|row| row.iter().map(|v| ch(*v).unwrap_or(SEA_CHAR)).collect()).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::nav::Terrain;

    #[test]
    fn biome_codes_round_trip_and_are_unique() {
        for b in Biome::ALL {
            assert_eq!(Biome::from_code(b.code()), Some(b));
        }
        let mut codes: Vec<char> = Biome::ALL.iter().map(|b| b.code()).collect();
        codes.sort_unstable();
        codes.dedup();
        assert_eq!(codes.len(), Biome::ALL.len());
        assert_eq!(Biome::from_code(SEA_CHAR), None);
        for c in LandmarkCategory::ALL {
            assert_eq!(LandmarkCategory::parse(c.key()), Some(c));
        }
        assert_eq!(LandmarkCategory::parse("magic"), None);
    }

    #[test]
    fn layers_render_as_rows() {
        let map = SeaMap {
            wrap_x: false,
            width: 3,
            height: 2,
            terrain: vec![Terrain::Land, Terrain::Deep, Terrain::Land, Terrain::Shallow, Terrain::Land, Terrain::Land],
            region: vec![u16::MAX, 0, u16::MAX, 0, u16::MAX, u16::MAX],
        };
        let geo = Geography {
            relief: vec![Some(0), None, Some(9), None, Some(4), Some(2)],
            biomes: vec![
                Some(Biome::Desert),
                None,
                Some(Biome::Alpine),
                None,
                Some(Biome::Arcane),
                Some(Biome::Wetland),
            ],
            ..Geography::default()
        };
        assert_eq!(geo.relief_rows(3), Some(vec!["0.9".to_string(), ".42".to_string()]));
        assert_eq!(geo.biome_rows(3), Some(vec!["D.A".to_string(), ".XW".to_string()]));
        assert_eq!(geo.relief_at(&map, Cell::new(2, 0)), Some(9));
        assert_eq!(geo.biome_at(&map, Cell::new(1, 0)), None);
        let empty = Geography::default();
        assert_eq!(empty.relief_rows(3), None);
        assert_eq!(empty.biome_rows(3), None);
        assert_eq!(empty.relief_at(&map, Cell::new(0, 0)), None);
    }
}
