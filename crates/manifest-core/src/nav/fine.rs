//! 细海岸（第九批 M02“细碰撞”）：每个粗格（航行网格的一格）细分成 `sub × sub` 个细格，
//! 内核只问一件事——“某粗格的某细格是不是水”。
//!
//! 由 `manifest-data` 读好 `data/maps/<地图>/fine/coast.bin` 后建成，挂在 [`crate::StaticData::fine_coast`] 上；
//! 没有细图层的世界（经典世界、测试夹具）为 `None`，一切照粗格走。内核这里不做 IO、不用浮点。
//!
//! 存法与文件里的“粗格类别表 + 混合块”相同，只是每细格压成 1 位（水 / 不是水；湖算水）：
//! 每粗格一个 `u32`（0 整格是水、1 整格是陆、`n + 2` 指向第 n 个混合块），混合块每块 `ceil(sub² / 64)` 个 `u64`。
//! 寰宇（1080 × 396 粗格、22 676 个混合格、sub = 24）约占 3.3 MB，按细格 O(1) 随机访问。
//!
//! 只有玩家手动航行的碰撞与领航用它（`navigation/`）；航线表、出航寻路与 NPC 仍沿粗格格心走，
//! 地图导出时的“骨架”保证那些线上都是水（见 `manifest_data::fine_map::verify_skeleton`）。

use crate::Cell;

/// 一个粗格在细层里的类别。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FineKind {
    /// 整格是水
    Water,
    /// 整格是陆
    Land,
    /// 有水有陆，要逐细格查
    Mixed,
}

#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
#[error("细海岸无效：{0}")]
pub struct FineCoastError(pub String);

const WATER: u32 = 0;
const LAND: u32 = 1;
const FIRST_BLOCK: u32 = 2;
/// 位置的定点刻度：一粗格 256 份（与 `navigation::SubCell::SCALE` 相同）。
const SCALE: i64 = 256;

#[derive(Clone, PartialEq, Eq)]
pub struct FineCoast {
    width: u16,
    height: u16,
    sub: u16,
    /// 每个混合块占的 `u64` 数
    words: usize,
    /// 每粗格：0 整格水、1 整格陆、`n + 2` 第 n 个混合块（行优先）
    cells: Vec<u32>,
    /// 混合块：每细格 1 位（1 = 水），块内行优先、字内低位在前
    bits: Vec<u64>,
}

impl std::fmt::Debug for FineCoast {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // 几兆字节的位图不往调试输出里倒
        f.debug_struct("FineCoast")
            .field("width", &self.width)
            .field("height", &self.height)
            .field("sub", &self.sub)
            .field("mixed", &self.mixed_cells())
            .finish()
    }
}

impl FineCoast {
    fn words_for(sub: u16) -> usize {
        (usize::from(sub) * usize::from(sub)).div_ceil(64)
    }

    /// 由现成的两张表建立（`manifest-data` 从文件转换时用）。
    /// `cells` 每粗格一项（0 整格水、1 整格陆、`n + 2` 第 n 个混合块），`bits` 是全部混合块。
    pub fn from_parts(
        width: u16,
        height: u16,
        sub: u16,
        cells: Vec<u32>,
        bits: Vec<u64>,
    ) -> Result<Self, FineCoastError> {
        if width == 0 || height == 0 || sub == 0 || i64::from(sub) > SCALE {
            return Err(FineCoastError("尺寸或细分数无效".into()));
        }
        if cells.len() != usize::from(width) * usize::from(height) {
            return Err(FineCoastError("粗格表的长度与尺寸不符".into()));
        }
        let words = Self::words_for(sub);
        if !bits.len().is_multiple_of(words) {
            return Err(FineCoastError("混合块的长度不是整块".into()));
        }
        let blocks = bits.len() / words;
        if cells.iter().any(|&c| c >= FIRST_BLOCK && (c - FIRST_BLOCK) as usize >= blocks) {
            return Err(FineCoastError("粗格表指向不存在的混合块".into()));
        }
        Ok(Self { width, height, sub, words, cells, bits })
    }

    /// 由“细格是不是水”的函数建立（测试夹具用；整格同类的粗格不存块）。
    /// `water(fx, fy)` 的坐标是整张图上的细格坐标（`0..width·sub`、`0..height·sub`）。
    pub fn from_fn(
        width: u16,
        height: u16,
        sub: u16,
        water: impl Fn(u32, u32) -> bool,
    ) -> Result<Self, FineCoastError> {
        let words = Self::words_for(sub);
        let s = u32::from(sub);
        let mut cells = Vec::with_capacity(usize::from(width) * usize::from(height));
        let mut bits = Vec::new();
        let mut block = vec![0u64; words];
        for cy in 0..u32::from(height) {
            for cx in 0..u32::from(width) {
                block.iter_mut().for_each(|w| *w = 0);
                let mut wet = 0u32;
                for fy in 0..s {
                    for fx in 0..s {
                        if water(cx * s + fx, cy * s + fy) {
                            let bit = (fy * s + fx) as usize;
                            block[bit / 64] |= 1 << (bit % 64);
                            wet += 1;
                        }
                    }
                }
                if wet == s * s {
                    cells.push(WATER);
                } else if wet == 0 {
                    cells.push(LAND);
                } else {
                    cells.push(FIRST_BLOCK + (bits.len() / words) as u32);
                    bits.extend_from_slice(&block);
                }
            }
        }
        Self::from_parts(width, height, sub, cells, bits)
    }

    pub fn width(&self) -> u16 {
        self.width
    }

    pub fn height(&self) -> u16 {
        self.height
    }

    /// 每粗格的细分数。
    pub fn sub(&self) -> u16 {
        self.sub
    }

    pub fn mixed_cells(&self) -> usize {
        self.bits.len() / self.words.max(1)
    }

    /// 两张表占的字节数。
    pub fn memory_bytes(&self) -> usize {
        self.cells.len() * 4 + self.bits.len() * 8
    }

    /// 粗格在细层里的类别；越界按陆。
    pub fn kind(&self, cell: Cell) -> FineKind {
        if cell.x >= self.width || cell.y >= self.height {
            return FineKind::Land;
        }
        match self.cells[usize::from(cell.y) * usize::from(self.width) + usize::from(cell.x)] {
            WATER => FineKind::Water,
            LAND => FineKind::Land,
            _ => FineKind::Mixed,
        }
    }

    /// 粗格 `cell` 里第 `(fx, fy)` 个细格是不是水；越界按陆。
    pub fn water(&self, cell: Cell, fx: u16, fy: u16) -> bool {
        if cell.x >= self.width || cell.y >= self.height || fx >= self.sub || fy >= self.sub {
            return false;
        }
        match self.cells[usize::from(cell.y) * usize::from(self.width) + usize::from(cell.x)] {
            WATER => true,
            LAND => false,
            block => {
                let bit = usize::from(fy) * usize::from(self.sub) + usize::from(fx);
                let at = (block - FIRST_BLOCK) as usize * self.words + bit / 64;
                self.bits[at] >> (bit % 64) & 1 == 1
            }
        }
    }

    /// 一粗格 256 份的定点位置落在哪个细格：`(粗格内的份数 · sub) / 256`。
    pub fn fine_index(&self, within: i64) -> u16 {
        (within.rem_euclid(SCALE) * i64::from(self.sub) / SCALE) as u16
    }

    /// 定点位置（一粗格 256 份，与 `navigation::SubCell` 相同）所在的细格是不是水；越界按陆。
    pub fn water_at(&self, x: i64, y: i64) -> bool {
        if x < 0 || y < 0 {
            return false;
        }
        let (cx, cy) = (x / SCALE, y / SCALE);
        if cx >= i64::from(self.width) || cy >= i64::from(self.height) {
            return false;
        }
        self.water(Cell::new(cx as u16, cy as u16), self.fine_index(x), self.fine_index(y))
    }

    /// 细格 `f` 的中点在粗格内的份数（落在这个细格里）。
    pub fn fine_center(&self, f: u16) -> i64 {
        (i64::from(f) * SCALE + SCALE / 2) / i64::from(self.sub)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fine_coast_answers_single_cells_and_keeps_uniform_cells_blockless() {
        // 3 × 2 粗格、每格 4 × 4 细格：(0,0) 整格水、(1,0) 整格陆、(2,0) 左半水右半陆、下一行全是棋盘
        let water = |fx: u32, fy: u32| match (fx / 4, fy / 4) {
            (0, 0) => true,
            (1, 0) => false,
            (2, 0) => fx % 4 < 2,
            _ => (fx + fy).is_multiple_of(2),
        };
        let coast = FineCoast::from_fn(3, 2, 4, water).unwrap();
        assert_eq!(coast.mixed_cells(), 4);
        assert_eq!(coast.kind(Cell::new(0, 0)), FineKind::Water);
        assert_eq!(coast.kind(Cell::new(1, 0)), FineKind::Land);
        assert_eq!(coast.kind(Cell::new(2, 0)), FineKind::Mixed);
        assert_eq!(coast.kind(Cell::new(3, 0)), FineKind::Land, "越界按陆");
        for fy in 0..8u32 {
            for fx in 0..12u32 {
                let cell = Cell::new((fx / 4) as u16, (fy / 4) as u16);
                assert_eq!(coast.water(cell, (fx % 4) as u16, (fy % 4) as u16), water(fx, fy), "({fx},{fy})");
                // 定点位置：一细格 64 份，取细格里的头、中、尾三处
                for within in [0, 31, 63] {
                    let (x, y) = (i64::from(fx) * 64 + within, i64::from(fy) * 64 + within);
                    assert_eq!(coast.water_at(x, y), water(fx, fy), "位置 ({x},{y})");
                }
            }
        }
        assert!(!coast.water_at(-1, 0) && !coast.water_at(0, -1), "越界按陆");
        assert!(!coast.water_at(3 * 256, 0) && !coast.water_at(0, 2 * 256), "越界按陆");
        assert!(!coast.water(Cell::new(0, 0), 4, 0), "细格下标越界按陆");
    }

    #[test]
    fn fine_index_and_center_agree_for_the_real_subdivision() {
        let coast = FineCoast::from_fn(1, 1, 24, |_, _| true).unwrap();
        // 格心（128）落在第 12 个细格；每个细格的中点都落回自己
        assert_eq!(coast.fine_index(128), 12);
        for f in 0..24u16 {
            assert_eq!(coast.fine_index(coast.fine_center(f)), f);
        }
        for within in 0..256i64 {
            assert_eq!(i64::from(coast.fine_index(within)), within * 24 / 256);
        }
        assert_eq!(coast.memory_bytes(), 4, "整格同类不存块");
    }

    #[test]
    fn from_parts_rejects_tables_that_do_not_fit() {
        assert!(FineCoast::from_parts(0, 1, 4, vec![], vec![]).is_err());
        assert!(FineCoast::from_parts(1, 1, 0, vec![0], vec![]).is_err());
        assert!(FineCoast::from_parts(1, 1, 300, vec![0], vec![]).is_err());
        assert!(FineCoast::from_parts(2, 1, 4, vec![0], vec![]).is_err(), "粗格表太短");
        assert!(FineCoast::from_parts(1, 1, 4, vec![2], vec![]).is_err(), "指向不存在的块");
        // sub = 24 时每块 9 个字
        assert!(FineCoast::from_parts(1, 1, 24, vec![2], vec![0; 8]).is_err(), "不是整块");
        let ok = FineCoast::from_parts(1, 1, 24, vec![2], vec![u64::MAX; 9]).unwrap();
        assert!(ok.water(Cell::new(0, 0), 23, 23));
    }
}
