//! 细图层（第九批 M01“细海图”）：细海岸、细高程、细河流三份二进制产物的格式、读写与“骨架”约束。
//!
//! 航行网格（`map.txt`）仍是权威；细图层只给显示用（下一轮也给玩家手动航行的碰撞用）。
//! 三个文件都由 `cargo xtask mapgen real` 生成，放在 `data/maps/<地图>/fine/`，全部小端：
//!
//! - `coast.bin`（细海岸）：文件头 32 字节 + 一段 zlib 流。
//!   文件头：魔数 `MFCOAST1`、u32 粗格宽、u32 粗格高、u16 每粗格细分数、u16 版本、u32 混合块数、
//!   u32 载荷解压后的字节数、u32 压缩后的字节数。
//!   载荷：先是每粗格 1 字节的类别（0 整格是海、1 整格是陆、2 整格是内陆水、3 混合），
//!   再按行优先的顺序每个混合格一块：每细格 2 位（0 海、1 陆、2 内陆水），块内行优先、字节内低位在前。
//! - `elevation.bin`（细高程）：魔数 `MFELEV01`、u32 宽、u32 高、u16 每粗格样本数、u16 版本、
//!   u32 载荷解压后的字节数、u32 压缩后的字节数；载荷是每行横向差分后做之字形编码的 u16，
//!   先放全部低字节、再放全部高字节（高字节几乎全是 0，压得小）。单位：米，海底为负。
//! - `rivers.bin`（细河流）：魔数 `MFRIVER1`、u32 粗格宽、u32 粗格高、u16 每粗格的坐标份数、u16 版本、
//!   u32 河段数、u32 载荷解压后的字节数、u32 压缩后的字节数；载荷里每段是 u8 等级、变长整数的点数、
//!   首点的之字形变长坐标，之后各点是相对上一点的之字形变长差分。坐标单位是 1/份数 格，横向不取模
//!   （跨接缝的河段照展开的坐标连着走）。

use std::collections::VecDeque;

/// 每粗格的细分数：一粗格 = 24 × 24 细格（一细格约 0.83 角分）。
pub const FINE_SUB: u16 = 24;
/// 格式版本。
pub const FINE_VERSION: u16 = 1;
/// 骨架：每个可航行粗格格心的圆的半径（细格）。
pub const SKELETON_DISC: i64 = 4;
/// 骨架：相邻可航行粗格格心连线上通道的半宽（细格）。
pub const SKELETON_HALF_WIDTH: i64 = 3;

const COAST_MAGIC: &[u8; 8] = b"MFCOAST1";
const ELEVATION_MAGIC: &[u8; 8] = b"MFELEV01";
const RIVERS_MAGIC: &[u8; 8] = b"MFRIVER1";
/// 解压上限（防坏文件把内存吃光）：三种图层都远小于它。
const MAX_PAYLOAD: usize = 256 * 1024 * 1024;

/// 细格的类别。
pub const SEA: u8 = 0;
pub const LAND: u8 = 1;
pub const LAKE: u8 = 2;
/// 粗格的类别里“混合”的记号。
pub const MIXED: u8 = 3;

/// 八个方向的位移，0 = 北，顺时针（与内核 `nav::DIRS` 相同）。
pub const DIRS: [(i64, i64); 8] = [(0, -1), (1, -1), (1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1)];

#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum FineError {
    #[error("细图层 {0}：{1}")]
    Format(&'static str, String),
    #[error("细海岸不满足骨架约束：{0}")]
    Skeleton(String),
}

fn bad(layer: &'static str, message: impl Into<String>) -> FineError {
    FineError::Format(layer, message.into())
}

fn u16_at(bytes: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([bytes[at], bytes[at + 1]])
}

fn u32_at(bytes: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]])
}

fn deflate(payload: &[u8]) -> Vec<u8> {
    miniz_oxide::deflate::compress_to_vec_zlib(payload, 9)
}

fn inflate(layer: &'static str, data: &[u8], expected: usize) -> Result<Vec<u8>, FineError> {
    if expected > MAX_PAYLOAD {
        return Err(bad(layer, "载荷过大"));
    }
    let out = miniz_oxide::inflate::decompress_to_vec_zlib_with_limit(data, expected)
        .map_err(|e| bad(layer, format!("解压失败：{e}")))?;
    if out.len() != expected {
        return Err(bad(layer, "解压后的长度与文件头不符"));
    }
    Ok(out)
}

/// 细海岸：每粗格 `sub × sub` 个细格，每细格一类（海 / 陆 / 内陆水）。整格同类的粗格不存块。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FineCoast {
    pub width: u32,
    pub height: u32,
    pub sub: u16,
    /// 每粗格：0 / 1 / 2 整格同类，3 混合。
    kinds: Vec<u8>,
    /// 每粗格的块号（不是混合格时为 `u32::MAX`）。
    block_of: Vec<u32>,
    /// 混合块：每块 `block_len` 字节，每细格 2 位。
    blocks: Vec<u8>,
}

impl FineCoast {
    fn block_len(sub: u16) -> usize {
        (usize::from(sub) * usize::from(sub) * 2).div_ceil(8)
    }

    /// 由整张细格栅格（行优先，`width·sub × height·sub`，每细格 1 字节的类别）建立。
    pub fn from_raster(width: u32, height: u32, sub: u16, raster: &[u8]) -> Result<Self, FineError> {
        let (w, h, s) = (width as usize, height as usize, usize::from(sub));
        if s == 0 || raster.len() != w * s * h * s {
            return Err(bad("coast", "栅格尺寸不符"));
        }
        if raster.iter().any(|&c| c > LAKE) {
            return Err(bad("coast", "栅格里有未知的类别"));
        }
        let block_len = Self::block_len(sub);
        let mut kinds = Vec::with_capacity(w * h);
        let mut block_of = Vec::with_capacity(w * h);
        let mut blocks = Vec::new();
        for cy in 0..h {
            for cx in 0..w {
                let first = raster[cy * s * w * s + cx * s];
                let mut uniform = true;
                'scan: for fy in 0..s {
                    let row = (cy * s + fy) * w * s + cx * s;
                    for &c in &raster[row..row + s] {
                        if c != first {
                            uniform = false;
                            break 'scan;
                        }
                    }
                }
                if uniform {
                    kinds.push(first);
                    block_of.push(u32::MAX);
                    continue;
                }
                kinds.push(MIXED);
                block_of.push((blocks.len() / block_len) as u32);
                let start = blocks.len();
                blocks.resize(start + block_len, 0);
                for fy in 0..s {
                    let row = (cy * s + fy) * w * s + cx * s;
                    for fx in 0..s {
                        let bit = (fy * s + fx) * 2;
                        blocks[start + bit / 8] |= raster[row + fx] << (bit % 8);
                    }
                }
            }
        }
        Ok(Self { width, height, sub, kinds, block_of, blocks })
    }

    pub fn mixed_cells(&self) -> usize {
        self.blocks.len() / Self::block_len(self.sub)
    }

    /// 粗格的类别（0 / 1 / 2 整格同类，3 混合）。
    pub fn kind(&self, cell: usize) -> u8 {
        self.kinds[cell]
    }

    /// 细格 `(fx, fy)` 的类别；越界按陆。
    pub fn class_at(&self, fx: i64, fy: i64) -> u8 {
        let s = i64::from(self.sub);
        if fx < 0 || fy < 0 || fx >= i64::from(self.width) * s || fy >= i64::from(self.height) * s {
            return LAND;
        }
        let cell = (fy / s) as usize * self.width as usize + (fx / s) as usize;
        let kind = self.kinds[cell];
        if kind != MIXED {
            return kind;
        }
        let bit = ((fy % s) * s + fx % s) as usize * 2;
        let at = self.block_of[cell] as usize * Self::block_len(self.sub) + bit / 8;
        (self.blocks[at] >> (bit % 8)) & 3
    }

    /// 转成内核用的表示（第九批 M02“细碰撞”）：每细格压成 1 位——是不是水（湖算水），
    /// 粗格类别表与混合块的次序原样保留。按字节查表（一字节 4 个细格），寰宇两万多个混合块约几毫秒。
    pub fn to_kernel(&self) -> Result<manifest_core::nav::FineCoast, FineError> {
        let (Ok(width), Ok(height)) = (u16::try_from(self.width), u16::try_from(self.height)) else {
            return Err(bad("coast", "尺寸超出航行网格的范围"));
        };
        // 一字节里 4 个细格（各 2 位）→ 4 位“是不是水”
        let mut nibble = [0u8; 256];
        for (byte, out) in nibble.iter_mut().enumerate() {
            for i in 0..4 {
                if (byte >> (2 * i)) & 3 != usize::from(LAND) {
                    *out |= 1 << i;
                }
            }
        }
        let block_len = Self::block_len(self.sub);
        let words = (usize::from(self.sub) * usize::from(self.sub)).div_ceil(64);
        let mut bits = vec![0u64; self.mixed_cells() * words];
        for (block, out) in self.blocks.chunks_exact(block_len).zip(bits.chunks_exact_mut(words)) {
            for (j, &byte) in block.iter().enumerate() {
                out[j / 16] |= u64::from(nibble[usize::from(byte)]) << ((j % 16) * 4);
            }
        }
        let cells = self
            .kinds
            .iter()
            .zip(&self.block_of)
            .map(|(&kind, &block)| match kind {
                SEA | LAKE => 0,
                LAND => 1,
                _ => block + 2,
            })
            .collect();
        manifest_core::nav::FineCoast::from_parts(width, height, self.sub, cells, bits)
            .map_err(|e| bad("coast", e.to_string()))
    }

    /// 写成 `coast.bin` 的字节。
    pub fn encode(&self) -> Vec<u8> {
        let mut payload = Vec::with_capacity(self.kinds.len() + self.blocks.len());
        payload.extend_from_slice(&self.kinds);
        payload.extend_from_slice(&self.blocks);
        let packed = deflate(&payload);
        let mut out = Vec::with_capacity(32 + packed.len());
        out.extend_from_slice(COAST_MAGIC);
        out.extend_from_slice(&self.width.to_le_bytes());
        out.extend_from_slice(&self.height.to_le_bytes());
        out.extend_from_slice(&self.sub.to_le_bytes());
        out.extend_from_slice(&FINE_VERSION.to_le_bytes());
        out.extend_from_slice(&(self.mixed_cells() as u32).to_le_bytes());
        out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        out.extend_from_slice(&(packed.len() as u32).to_le_bytes());
        out.extend_from_slice(&packed);
        out
    }

    /// 读 `coast.bin`。
    pub fn decode(bytes: &[u8]) -> Result<Self, FineError> {
        if bytes.len() < 32 || &bytes[..8] != COAST_MAGIC {
            return Err(bad("coast", "不是细海岸文件"));
        }
        let (width, height, sub) = (u32_at(bytes, 8), u32_at(bytes, 12), u16_at(bytes, 16));
        if u16_at(bytes, 18) != FINE_VERSION {
            return Err(bad("coast", "版本不支持"));
        }
        let (mixed, raw, packed) = (u32_at(bytes, 20) as usize, u32_at(bytes, 24) as usize, u32_at(bytes, 28) as usize);
        let cells = (width as usize).checked_mul(height as usize).filter(|&n| n > 0 && n <= 64 * 1024 * 1024);
        let Some(cells) = cells else { return Err(bad("coast", "尺寸无效")) };
        if sub == 0 || sub > 64 {
            return Err(bad("coast", "细分数无效"));
        }
        let block_len = Self::block_len(sub);
        if raw != cells + mixed * block_len || bytes.len() != 32 + packed {
            return Err(bad("coast", "长度与文件头不符"));
        }
        let payload = inflate("coast", &bytes[32..], raw)?;
        let kinds = payload[..cells].to_vec();
        let blocks = payload[cells..].to_vec();
        let mut block_of = Vec::with_capacity(cells);
        let mut next = 0u32;
        for &kind in &kinds {
            match kind {
                SEA | LAND | LAKE => block_of.push(u32::MAX),
                MIXED => {
                    block_of.push(next);
                    next += 1;
                }
                _ => return Err(bad("coast", "粗格类别无效")),
            }
        }
        if next as usize != mixed {
            return Err(bad("coast", "混合块数与类别表不符"));
        }
        Ok(Self { width, height, sub, kinds, block_of, blocks })
    }
}

/// 细高程：ETOPO5 的原始样本（每粗格 `per_cell × per_cell` 个），单位米，海底为负。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FineElevation {
    pub width: u32,
    pub height: u32,
    pub per_cell: u16,
    pub meters: Vec<i16>,
}

impl FineElevation {
    pub fn encode(&self) -> Vec<u8> {
        let (w, n) = (self.width as usize, self.meters.len());
        let mut payload = vec![0u8; n * 2];
        for (i, &m) in self.meters.iter().enumerate() {
            let previous = if i % w == 0 { 0 } else { self.meters[i - 1] };
            let delta = m.wrapping_sub(previous);
            // 之字形：小的正负差分都落在低字节里
            let zigzag = ((delta << 1) ^ (delta >> 15)) as u16;
            payload[i] = zigzag as u8;
            payload[n + i] = (zigzag >> 8) as u8;
        }
        let packed = deflate(&payload);
        let mut out = Vec::with_capacity(28 + packed.len());
        out.extend_from_slice(ELEVATION_MAGIC);
        out.extend_from_slice(&self.width.to_le_bytes());
        out.extend_from_slice(&self.height.to_le_bytes());
        out.extend_from_slice(&self.per_cell.to_le_bytes());
        out.extend_from_slice(&FINE_VERSION.to_le_bytes());
        out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        out.extend_from_slice(&(packed.len() as u32).to_le_bytes());
        out.extend_from_slice(&packed);
        out
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, FineError> {
        if bytes.len() < 28 || &bytes[..8] != ELEVATION_MAGIC {
            return Err(bad("elevation", "不是细高程文件"));
        }
        let (width, height, per_cell) = (u32_at(bytes, 8), u32_at(bytes, 12), u16_at(bytes, 16));
        if u16_at(bytes, 18) != FINE_VERSION {
            return Err(bad("elevation", "版本不支持"));
        }
        let (raw, packed) = (u32_at(bytes, 20) as usize, u32_at(bytes, 24) as usize);
        let n = (width as usize).checked_mul(height as usize).filter(|&n| n > 0 && n <= 64 * 1024 * 1024);
        let Some(n) = n else { return Err(bad("elevation", "尺寸无效")) };
        if per_cell == 0 || raw != n * 2 || bytes.len() != 28 + packed {
            return Err(bad("elevation", "长度与文件头不符"));
        }
        let payload = inflate("elevation", &bytes[28..], raw)?;
        let w = width as usize;
        let mut meters = Vec::with_capacity(n);
        let mut previous = 0i16;
        for i in 0..n {
            if i % w == 0 {
                previous = 0;
            }
            let zigzag = u16::from(payload[i]) | (u16::from(payload[n + i]) << 8);
            let delta = ((zigzag >> 1) as i16) ^ -((zigzag & 1) as i16);
            previous = previous.wrapping_add(delta);
            meters.push(previous);
        }
        Ok(Self { width, height, per_cell, meters })
    }
}

/// 一段细河流：等级（Natural Earth 的 scalerank，越小越大）与折线（单位 1/份数 格，横向不取模）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FineRiver {
    pub rank: u8,
    pub points: Vec<[i32; 2]>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FineRivers {
    pub width: u32,
    pub height: u32,
    pub sub: u16,
    pub rivers: Vec<FineRiver>,
}

fn put_varint(out: &mut Vec<u8>, mut value: u32) {
    while value >= 0x80 {
        out.push((value as u8) | 0x80);
        value >>= 7;
    }
    out.push(value as u8);
}

fn put_signed(out: &mut Vec<u8>, value: i32) {
    put_varint(out, ((value << 1) ^ (value >> 31)) as u32);
}

struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl Reader<'_> {
    fn byte(&mut self) -> Result<u8, FineError> {
        let b = *self.bytes.get(self.at).ok_or_else(|| bad("rivers", "载荷被截断"))?;
        self.at += 1;
        Ok(b)
    }

    fn varint(&mut self) -> Result<u32, FineError> {
        let mut value = 0u32;
        for shift in (0..35).step_by(7) {
            let b = self.byte()?;
            value |= u32::from(b & 0x7f) << shift;
            if b & 0x80 == 0 {
                return Ok(value);
            }
        }
        Err(bad("rivers", "变长整数过长"))
    }

    fn signed(&mut self) -> Result<i32, FineError> {
        let v = self.varint()?;
        Ok(((v >> 1) as i32) ^ -((v & 1) as i32))
    }
}

impl FineRivers {
    pub fn encode(&self) -> Vec<u8> {
        let mut payload = Vec::new();
        for river in &self.rivers {
            payload.push(river.rank);
            put_varint(&mut payload, river.points.len() as u32);
            let mut previous = [0i32; 2];
            for p in &river.points {
                put_signed(&mut payload, p[0] - previous[0]);
                put_signed(&mut payload, p[1] - previous[1]);
                previous = *p;
            }
        }
        let packed = deflate(&payload);
        let mut out = Vec::with_capacity(32 + packed.len());
        out.extend_from_slice(RIVERS_MAGIC);
        out.extend_from_slice(&self.width.to_le_bytes());
        out.extend_from_slice(&self.height.to_le_bytes());
        out.extend_from_slice(&self.sub.to_le_bytes());
        out.extend_from_slice(&FINE_VERSION.to_le_bytes());
        out.extend_from_slice(&(self.rivers.len() as u32).to_le_bytes());
        out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        out.extend_from_slice(&(packed.len() as u32).to_le_bytes());
        out.extend_from_slice(&packed);
        out
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, FineError> {
        if bytes.len() < 32 || &bytes[..8] != RIVERS_MAGIC {
            return Err(bad("rivers", "不是细河流文件"));
        }
        let (width, height, sub) = (u32_at(bytes, 8), u32_at(bytes, 12), u16_at(bytes, 16));
        if u16_at(bytes, 18) != FINE_VERSION {
            return Err(bad("rivers", "版本不支持"));
        }
        let (count, raw, packed) = (u32_at(bytes, 20) as usize, u32_at(bytes, 24) as usize, u32_at(bytes, 28) as usize);
        if sub == 0 || bytes.len() != 32 + packed {
            return Err(bad("rivers", "长度与文件头不符"));
        }
        let payload = inflate("rivers", &bytes[32..], raw)?;
        let mut reader = Reader { bytes: &payload, at: 0 };
        let mut rivers = Vec::with_capacity(count.min(1 << 20));
        for _ in 0..count {
            let rank = reader.byte()?;
            let n = reader.varint()? as usize;
            if n > payload.len() {
                return Err(bad("rivers", "点数无效"));
            }
            let mut points = Vec::with_capacity(n);
            let mut previous = [0i32; 2];
            for _ in 0..n {
                previous = [previous[0].wrapping_add(reader.signed()?), previous[1].wrapping_add(reader.signed()?)];
                points.push(previous);
            }
            rivers.push(FineRiver { rank, points });
        }
        if reader.at != payload.len() {
            return Err(bad("rivers", "载荷尾部有多余字节"));
        }
        Ok(Self { width, height, sub, rivers })
    }
}

// ───────────────────────────── 骨架约束 ─────────────────────────────

/// 航行网格上的直接相通（与内核 `SeaMap::step` 同一条规则）：两格都可航行；斜向时，夹着的两个正交格不能都是陆。
/// `navigable` 行优先；`wrap_x` 时横向取模。返回相邻格的下标。
pub fn skeleton_link(
    navigable: &[bool],
    width: usize,
    height: usize,
    wrap_x: bool,
    cell: usize,
    dir: usize,
) -> Option<usize> {
    let at = |x: i64, y: i64| -> Option<usize> {
        if y < 0 || y >= height as i64 {
            return None;
        }
        let x = if wrap_x { x.rem_euclid(width as i64) } else { x };
        (x >= 0 && x < width as i64).then(|| y as usize * width + x as usize)
    };
    if !navigable[cell] {
        return None;
    }
    let (x, y) = ((cell % width) as i64, (cell / width) as i64);
    let (dx, dy) = DIRS[dir];
    let next = at(x + dx, y + dy).filter(|&n| navigable[n])?;
    if dir % 2 == 1 {
        let a = at(x + dx, y).is_some_and(|i| navigable[i]);
        let b = at(x, y + dy).is_some_and(|i| navigable[i]);
        if !a && !b {
            return None;
        }
    }
    Some(next)
}

/// 细格中心到“粗格 `(cx, cy)` 的格心 → 沿 `(dx, dy)` 相邻粗格的格心”这条线段的距离是否不超过 `reach`（细格）。
/// 全部按加倍后的整数坐标算（细格中心是奇数、格心是 `sub` 的奇数倍），生成与验证逐格一致。
fn within(sub: i64, cx: i64, cy: i64, (dx, dy): (i64, i64), fx: i64, fy: i64, reach: i64) -> bool {
    let (px, py) = (2 * sub * cx + sub, 2 * sub * cy + sub);
    let (vx, vy) = (2 * fx + 1 - px, 2 * fy + 1 - py);
    let (ex, ey) = (2 * sub * dx, 2 * sub * dy);
    let dd = ex * ex + ey * ey;
    let r2 = 4 * reach * reach;
    if dd == 0 {
        return vx * vx + vy * vy <= r2;
    }
    let t = (vx * ex + vy * ey).clamp(0, dd);
    let (qx, qy) = (vx * dd - ex * t, vy * dd - ey * t);
    qx * qx + qy * qy <= r2 * dd * dd
}

/// 骨架的一块：粗格 `(cx, cy)` 的格心圆（`dir` 为 None），或它到 `dir` 方向相邻格的通道。
/// 逐个给出这一块覆盖的细格（展开坐标，横向可以越出地图，由调用方取模）。
pub fn skeleton_cells(sub: u16, cx: i64, cy: i64, dir: Option<usize>, mut visit: impl FnMut(i64, i64)) {
    skeleton_halo(sub, cx, cy, dir, 0, |fx, fy, _| visit(fx, fy));
}

/// 同 [`skeleton_cells`]，但连同外面 `extra` 圈一起给出：`ring` 为 0 是骨架本身（约束要求的），
/// 1 起是往外第几圈（生成器把挡路的岸挖开时顺手把两岸啃得参差一些，免得水道像尺子画的）。
pub fn skeleton_halo(sub: u16, cx: i64, cy: i64, dir: Option<usize>, extra: i64, mut visit: impl FnMut(i64, i64, i64)) {
    let s = i64::from(sub);
    let (step, reach) = match dir {
        Some(d) => (DIRS[d], SKELETON_HALF_WIDTH),
        None => ((0, 0), SKELETON_DISC),
    };
    let (ax, ay) = (s * cx + s / 2, s * cy + s / 2);
    let (bx, by) = (ax + s * step.0, ay + s * step.1);
    let outer = reach + extra.max(0);
    for fy in ay.min(by) - outer - 1..=ay.max(by) + outer {
        for fx in ax.min(bx) - outer - 1..=ax.max(bx) + outer {
            if let Some(ring) = (0..=extra.max(0)).find(|&ring| within(s, cx, cy, step, fx, fy, reach + ring)) {
                visit(fx, fy, ring);
            }
        }
    }
}

/// 骨架验证的统计。
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SkeletonStats {
    /// 可航行的粗格数
    pub cells: usize,
    /// 直接相通的相邻对（无向）
    pub links: usize,
    /// 其中要逐细格检查的（涉及的粗格不是整格水）
    pub checked_links: usize,
}

/// 逐一验证骨架约束（对全部可航行格与全部邻接）：
/// 1. 每个可航行粗格，格心圆（半径 [`SKELETON_DISC`]）里的细格都是水；
/// 2. 每一对直接相通的相邻可航行粗格，格心连线两侧 [`SKELETON_HALF_WIDTH`] 以内、落在可航行粗格里的细格都是水，
///    并且只走这些细格（四连通）就能从一个格心走到另一个格心。
pub fn verify_skeleton(coast: &FineCoast, navigable: &[bool], wrap_x: bool) -> Result<SkeletonStats, FineError> {
    let (w, h, s) = (coast.width as usize, coast.height as usize, i64::from(coast.sub));
    if navigable.len() != w * h {
        return Err(FineError::Skeleton("航行网格与细海岸的尺寸不符".into()));
    }
    let fine_w = w as i64 * s;
    let wrap = |fx: i64| if wrap_x { fx.rem_euclid(fine_w) } else { fx };
    let coarse_of = |fx: i64, fy: i64| -> Option<usize> {
        let fx = wrap(fx);
        (fx >= 0 && fx < fine_w && fy >= 0 && fy < h as i64 * s).then(|| (fy / s) as usize * w + (fx / s) as usize)
    };
    let water = |fx: i64, fy: i64| coast.class_at(wrap(fx), fy) != LAND;
    let open = |cell: usize| matches!(coast.kind(cell), SEA | LAKE);
    let mut stats = SkeletonStats::default();
    for cell in 0..w * h {
        if !navigable[cell] {
            continue;
        }
        stats.cells += 1;
        let (cx, cy) = ((cell % w) as i64, (cell / w) as i64);
        if !open(cell) {
            let mut blocked = None;
            skeleton_cells(coast.sub, cx, cy, None, |fx, fy| {
                if blocked.is_none() && !water(fx, fy) {
                    blocked = Some((fx, fy));
                }
            });
            if let Some((fx, fy)) = blocked {
                return Err(FineError::Skeleton(format!("可航行格 ({cx},{cy}) 的格心圆里有陆：细格 ({fx},{fy})")));
            }
        }
        // 每一对只查一次：东、东南、南、西南
        for (dir, &(dx, dy)) in DIRS.iter().enumerate().take(6).skip(2) {
            let Some(next) = skeleton_link(navigable, w, h, wrap_x, cell, dir) else { continue };
            stats.links += 1;
            let side = |x: i64, y: i64| coarse_of(x * s, y * s);
            // 通道只落在这两格与（斜向时）夹着的两个正交格里；其中可航行的都是整格水时不必逐细格查
            // （斜向相通时夹着的正交格至少有一个可航行，通道经它连通）
            let involved = [Some(cell), Some(next), side(cx + dx, cy), side(cx, cy + dy)];
            if involved.iter().flatten().all(|&c| !navigable[c] || open(c)) {
                continue;
            }
            stats.checked_links += 1;
            let mut channel = Vec::new();
            let mut blocked = None;
            skeleton_cells(coast.sub, cx, cy, Some(dir), |fx, fy| {
                if coarse_of(fx, fy).is_some_and(|c| navigable[c]) {
                    if water(fx, fy) {
                        channel.push((fx, fy));
                    } else if blocked.is_none() {
                        blocked = Some((fx, fy));
                    }
                }
            });
            if let Some((fx, fy)) = blocked {
                return Err(FineError::Skeleton(format!(
                    "({cx},{cy}) 到方向 {dir} 的相邻格之间的通道里有陆：细格 ({fx},{fy})"
                )));
            }
            // 通道里的细格四连通：从起点格心旁的细格走到终点格心旁的细格
            let start = (s * cx + s / 2, s * cy + s / 2);
            let goal = (start.0 + s * dx, start.1 + s * dy);
            channel.sort_unstable();
            let mut seen = vec![false; channel.len()];
            let mut queue = VecDeque::new();
            if let Ok(i) = channel.binary_search(&start) {
                seen[i] = true;
                queue.push_back(start);
            }
            let mut reached = false;
            while let Some((fx, fy)) = queue.pop_front() {
                if (fx, fy) == goal {
                    reached = true;
                    break;
                }
                for p in [(fx + 1, fy), (fx - 1, fy), (fx, fy + 1), (fx, fy - 1)] {
                    if let Ok(i) = channel.binary_search(&p)
                        && !seen[i]
                    {
                        seen[i] = true;
                        queue.push_back(p);
                    }
                }
            }
            if !reached {
                return Err(FineError::Skeleton(format!("({cx},{cy}) 到方向 {dir} 的相邻格之间没有连通的水道")));
            }
        }
    }
    Ok(stats)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coast_round_trips_and_reads_single_cells() {
        // 2 × 2 粗格、每格 4 × 4 细格：左上整格海、右上整格陆、左下混合、右下整格湖
        let (w, h, sub) = (2u32, 2u32, 4u16);
        let mut raster = vec![SEA; 8 * 8];
        for fy in 0..8 {
            for fx in 0..8 {
                raster[fy * 8 + fx] = match (fx / 4, fy / 4) {
                    (1, 0) => LAND,
                    (0, 1) => [SEA, LAND, LAKE][(fx + fy) % 3],
                    (1, 1) => LAKE,
                    _ => SEA,
                };
            }
        }
        let coast = FineCoast::from_raster(w, h, sub, &raster).expect("栅格");
        assert_eq!(coast.mixed_cells(), 1);
        assert_eq!([coast.kind(0), coast.kind(1), coast.kind(2), coast.kind(3)], [SEA, LAND, MIXED, LAKE]);
        let bytes = coast.encode();
        let back = FineCoast::decode(&bytes).expect("读回");
        assert_eq!(back, coast);
        for fy in 0..8 {
            for fx in 0..8 {
                assert_eq!(back.class_at(fx, fy), raster[(fy * 8 + fx) as usize], "({fx},{fy})");
            }
        }
        assert_eq!(back.class_at(-1, 0), LAND, "越界按陆");
        assert!(FineCoast::decode(&bytes[..bytes.len() - 1]).is_err());
        let mut broken = bytes.clone();
        broken[0] = b'X';
        assert!(FineCoast::decode(&broken).is_err());
    }

    #[test]
    fn elevation_and_rivers_round_trip() {
        let elevation = FineElevation {
            width: 5,
            height: 2,
            per_cell: 4,
            meters: vec![0, -1, 300, -8000, 8848, i16::MIN, i16::MAX, 5, -5, 0],
        };
        assert_eq!(FineElevation::decode(&elevation.encode()).expect("高程"), elevation);
        let rivers = FineRivers {
            width: 3,
            height: 2,
            sub: 24,
            rivers: vec![
                FineRiver { rank: 1, points: vec![[10, 10], [11, 12], [-3, 40], [100000, -7]] },
                FineRiver { rank: 9, points: vec![] },
            ],
        };
        assert_eq!(FineRivers::decode(&rivers.encode()).expect("河流"), rivers);
    }

    #[test]
    fn skeleton_links_follow_the_kernel_rule() {
        // 与内核 SeaMap 的寻路逐对比较：相邻两格之间有两格长的路径，当且仅当这里判定为直接相通
        use manifest_core::Cell;
        use manifest_core::nav::{SeaMap, Terrain};
        let (w, h) = (9usize, 7usize);
        for seed in 0..40u64 {
            let mut state = seed.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1;
            let mut next = || {
                state ^= state << 13;
                state ^= state >> 7;
                state ^= state << 17;
                state
            };
            let navigable: Vec<bool> = (0..w * h).map(|_| next() % 100 < 60).collect();
            for wrap in [false, true] {
                let map = SeaMap {
                    width: w as u16,
                    height: h as u16,
                    wrap_x: wrap,
                    terrain: navigable.iter().map(|&n| if n { Terrain::Deep } else { Terrain::Land }).collect(),
                    region: vec![u16::MAX; w * h],
                };
                for cell in 0..w * h {
                    for (dir, &(dx, dy)) in DIRS.iter().enumerate() {
                        let (x, y) = ((cell % w) as i64, (cell / w) as i64);
                        let (nx, ny) = (if wrap { (x + dx).rem_euclid(w as i64) } else { x + dx }, y + dy);
                        if nx < 0 || nx >= w as i64 || ny < 0 || ny >= h as i64 {
                            assert_eq!(skeleton_link(&navigable, w, h, wrap, cell, dir), None);
                            continue;
                        }
                        let (a, b) = (Cell::new(x as u16, y as u16), Cell::new(nx as u16, ny as u16));
                        let direct = map.find_path(&[], 0, a, b).is_some_and(|p| p.cells.len() == 2);
                        let ours = skeleton_link(&navigable, w, h, wrap, cell, dir);
                        assert_eq!(ours.is_some(), direct, "种子 {seed} 环绕 {wrap} 格 ({x},{y}) 方向 {dir}");
                        if let Some(n) = ours {
                            assert_eq!(n, ny as usize * w + nx as usize);
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn skeleton_verification_catches_blocked_centres_and_channels() {
        let (w, h, sub) = (3u32, 2u32, FINE_SUB);
        let s = usize::from(sub);
        let navigable = vec![true, true, false, false, true, true];
        let fw = w as usize * s;
        let mut raster = vec![SEA; fw * h as usize * s];
        // 陆格整格是陆
        for (cell, &nav) in navigable.iter().enumerate() {
            if !nav {
                let (cx, cy) = (cell % 3, cell / 3);
                for fy in 0..s {
                    for fx in 0..s {
                        raster[(cy * s + fy) * fw + cx * s + fx] = LAND;
                    }
                }
            }
        }
        let ok = FineCoast::from_raster(w, h, sub, &raster).expect("栅格");
        let stats = verify_skeleton(&ok, &navigable, false).expect("全是水，满足骨架");
        assert_eq!(stats.cells, 4);
        // (0,0)-(1,0)、(1,0)-(1,1)、(1,1)-(2,1)、(0,0)-(1,1) 斜向（夹着的 (1,0) 可航行）、(1,0)-(2,1) 斜向（夹着的 (1,1) 可航行）
        assert_eq!(stats.links, 5);
        // 格心圆里放一粒陆
        let mut centre = raster.clone();
        centre[(s / 2) * fw + s + s / 2] = LAND;
        let e = verify_skeleton(&FineCoast::from_raster(w, h, sub, &centre).expect("栅格"), &navigable, false);
        assert!(matches!(e, Err(FineError::Skeleton(_))));
        // 两格心之间的连线上放一粒陆（离两个格心都远于圆的半径）
        let mut channel = raster.clone();
        channel[(s / 2) * fw + s - 1] = LAND;
        let e = verify_skeleton(&FineCoast::from_raster(w, h, sub, &channel).expect("栅格"), &navigable, false);
        assert!(matches!(e, Err(FineError::Skeleton(_))));
        // 通道之外的陆不碍事
        let mut aside = raster.clone();
        aside[fw + s + 2] = LAND;
        verify_skeleton(&FineCoast::from_raster(w, h, sub, &aside).expect("栅格"), &navigable, false)
            .expect("通道外的陆");
    }
}
