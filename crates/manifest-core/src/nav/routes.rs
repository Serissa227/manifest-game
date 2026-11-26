//! 航线方向段。只在调用方真正需要格序列时展开；航线统计量始终直接可读。

use super::{MapTopology, Path};
use crate::{Cell, Fx};
use std::iter::FusedIterator;

/// 低三位为方向，高十三位为步数；长于 8191 步的直线分成相邻的同向段。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DirectionRun(pub(super) u16);

impl DirectionRun {
    pub fn direction(self) -> u8 {
        (self.0 & 7) as u8
    }
    pub fn steps(self) -> u16 {
        self.0 >> 3
    }
    fn new(direction: u8, steps: u16) -> Self {
        Self((steps << 3) | u16::from(direction))
    }
}

#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum RouteError {
    #[error("航线含越界或不相邻的格子")]
    InvalidCells,
    #[error("航线缓存格式或长度无效")]
    InvalidEncoding,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CompressedPath {
    pub(super) start: Cell,
    pub(super) cell_count: u32,
    pub(super) runs: Box<[DirectionRun]>,
    pub cost: i64,
    pub length: Fx,
    pub time_ref: Fx,
    pub time_square: Fx,
    pub time_lateen: Fx,
}

impl CompressedPath {
    pub fn compress(path: &Path, topology: MapTopology) -> Result<Self, RouteError> {
        if path.cells.len() > u32::MAX as usize
            || path.cells.iter().any(|c| !topology.in_bounds(*c))
            || path
                .cells
                .windows(2)
                .any(|w| w[0] == w[1] || topology.neighbor(w[0], topology.dir_between(w[0], w[1])) != Some(w[1]))
        {
            return Err(RouteError::InvalidCells);
        }
        Ok(Self::from_valid_path(path, topology))
    }

    pub(super) fn from_valid_path(path: &Path, topology: MapTopology) -> Self {
        let mut runs: Vec<DirectionRun> = Vec::new();
        for w in path.cells.windows(2) {
            let direction = topology.dir_between(w[0], w[1]);
            if let Some(last) = runs.last_mut()
                && last.direction() == direction
                && last.steps() < 8191
            {
                *last = DirectionRun::new(direction, last.steps() + 1);
            } else {
                runs.push(DirectionRun::new(direction, 1));
            }
        }
        Self {
            start: path.cells.first().copied().unwrap_or(Cell::new(0, 0)),
            cell_count: path.cells.len() as u32,
            runs: runs.into_boxed_slice(),
            cost: path.cost,
            length: path.length,
            time_ref: path.time_ref,
            time_square: path.time_square,
            time_lateen: path.time_lateen,
        }
    }

    pub fn len(&self) -> usize {
        self.cell_count as usize
    }
    pub fn is_empty(&self) -> bool {
        self.cell_count == 0
    }
    pub fn runs(&self) -> &[DirectionRun] {
        &self.runs
    }

    pub fn cells(&self, topology: MapTopology) -> Cells<'_> {
        Cells {
            topology,
            next: (!self.is_empty()).then_some(self.start),
            runs: &self.runs,
            run: 0,
            step: 0,
            left: self.len(),
        }
    }

    pub fn expand(&self, topology: MapTopology) -> Path {
        Path {
            cells: self.cells(topology).collect(),
            cost: self.cost,
            length: self.length,
            time_ref: self.time_ref,
            time_square: self.time_square,
            time_lateen: self.time_lateen,
        }
    }

    pub fn estimate_days(&self, speed: Fx) -> i64 {
        super::ceil_days(self.time_ref, speed)
    }

    /// 直接用压缩表中的帆装统计量估算，不展开格序列。
    pub fn days_for(&self, sail: crate::defs::SailType, speed: Fx) -> i64 {
        let time = match sail {
            crate::defs::SailType::Square => self.time_square,
            crate::defs::SailType::Lateen => self.time_lateen,
        };
        super::ceil_days(time, speed)
    }

    /// 堆上方向段的精确字节数（不计分配器额外开销）。
    pub fn segment_bytes(&self) -> usize {
        std::mem::size_of_val(self.runs.as_ref())
    }
}

pub struct Cells<'a> {
    topology: MapTopology,
    next: Option<Cell>,
    runs: &'a [DirectionRun],
    run: usize,
    step: u16,
    left: usize,
}

impl Iterator for Cells<'_> {
    type Item = Cell;
    fn next(&mut self) -> Option<Cell> {
        let cell = self.next?;
        self.left = self.left.saturating_sub(1);
        if let Some(run) = self.runs.get(self.run) {
            self.next = self.topology.neighbor(cell, run.direction());
            self.step += 1;
            if self.step == run.steps() {
                self.run += 1;
                self.step = 0;
            }
        } else {
            self.next = None;
        }
        Some(cell)
    }
    fn size_hint(&self) -> (usize, Option<usize>) {
        (self.left, Some(self.left))
    }
}
impl ExactSizeIterator for Cells<'_> {}
impl FusedIterator for Cells<'_> {}

/// 旧接口只按需展开被访问的航线；新调用方用 NavTable::compressed_path 获取统计量和迭代器。
#[derive(Clone, Debug)]
pub(super) struct StoredPath {
    pub compressed: CompressedPath,
}

impl StoredPath {
    pub fn new(path: &Path, topology: MapTopology) -> Self {
        Self { compressed: CompressedPath::from_valid_path(path, topology) }
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct RouteMemory {
    pub paths: usize,
    pub cells: usize,
    pub segments: usize,
    /// 若存成 Vec<Cell>，仅格序列占用的字节数。
    pub expanded_cell_bytes: usize,
    /// 方向段、表槽位及已有兼容性展开缓冲；不包含寻路网格或分配器元数据。
    pub table_bytes: usize,
    pub legacy_expanded_paths: usize,
    pub grid_bytes: usize,
}

impl super::NavTable {
    /// 稳定的小端二进制格式；只编码方向段和统计量，网格由带指纹的输入重建。
    pub fn route_bytes(&self) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(b"MNR1");
        out.extend_from_slice(&(self.paths.len() as u32).to_le_bytes());
        out.extend_from_slice(&(self.loc_count as u32).to_le_bytes());
        for row in &self.paths {
            for path in row {
                let Some(path) = path else {
                    out.push(0);
                    continue;
                };
                out.push(1);
                let p = &path.compressed;
                let start = p.start;
                out.extend_from_slice(&start.x.to_le_bytes());
                out.extend_from_slice(&start.y.to_le_bytes());
                out.extend_from_slice(&p.cell_count.to_le_bytes());
                out.extend_from_slice(&(p.runs.len() as u32).to_le_bytes());
                for n in [p.cost, p.length.0, p.time_ref.0, p.time_square.0, p.time_lateen.0] {
                    out.extend_from_slice(&n.to_le_bytes());
                }
                for run in &p.runs {
                    out.extend_from_slice(&run.0.to_le_bytes());
                }
            }
        }
        out
    }

    /// 验证长度、槽位、端点和每一方向段的边界；全程不分配逐格路径。
    pub fn from_route_bytes(
        grid: super::NavGrid,
        loc_count: usize,
        ports: &[(crate::LocId, Cell)],
        bytes: &[u8],
    ) -> Result<Self, RouteError> {
        let bad = RouteError::InvalidEncoding;
        let mut reader = Reader(bytes);
        if reader.take::<4>()? != *b"MNR1"
            || reader.u32()? as usize != grid.period_count()
            || reader.u32()? as usize != loc_count
        {
            return Err(bad);
        }
        let slots = loc_count.checked_mul(loc_count).ok_or(bad.clone())?;
        if slots.checked_mul(grid.period_count()).ok_or(bad.clone())? > reader.0.len() {
            return Err(bad);
        }
        let mut anchors = vec![None; loc_count];
        for &(id, cell) in ports {
            *anchors.get_mut(id.idx()).ok_or(bad.clone())? = Some(cell);
        }
        let mut paths = Vec::with_capacity(grid.period_count());
        for period in 0..grid.period_count() {
            let mut row = Vec::with_capacity(slots);
            for slot in 0..slots {
                match reader.take::<1>()?[0] {
                    0 => {
                        row.push(None);
                        continue;
                    }
                    1 => {}
                    _ => return Err(bad),
                }
                let start = Cell::new(reader.u16()?, reader.u16()?);
                let cell_count = reader.u32()?;
                let run_count = reader.u32()? as usize;
                if cell_count < 2
                    || cell_count as usize > grid.class.len()
                    || run_count == 0
                    || run_count >= cell_count as usize
                    || run_count > reader.0.len() / 2
                {
                    return Err(bad);
                }
                let [cost, length, time_ref, time_square, time_lateen] =
                    [reader.i64()?, reader.i64()?, reader.i64()?, reader.i64()?, reader.i64()?];
                if [cost, length, time_ref, time_square, time_lateen].iter().any(|n| *n < 0) {
                    return Err(bad);
                }
                let mut runs = Vec::with_capacity(run_count);
                let (mut end, mut steps) = (start, 1u32);
                for _ in 0..run_count {
                    let run = DirectionRun(reader.u16()?);
                    if run.steps() == 0 {
                        return Err(bad);
                    }
                    steps = steps.checked_add(u32::from(run.steps())).ok_or(bad.clone())?;
                    let (dx, dy) = super::DIRS[run.direction() as usize];
                    // 直线的两端在界内即可保证中间不越界；东西环绕由 normalize 处理。
                    end = grid
                        .topology
                        .normalize(
                            i64::from(end.x) + i64::from(dx) * i64::from(run.steps()),
                            i64::from(end.y) + i64::from(dy) * i64::from(run.steps()),
                        )
                        .ok_or(bad.clone())?;
                    runs.push(run);
                }
                if steps != cell_count
                    || Some(start) != anchors[slot / loc_count]
                    || Some(end) != anchors[slot % loc_count]
                    || grid.check_cell(period, start).is_err()
                    || grid.check_cell(period, end).is_err()
                {
                    return Err(bad);
                }
                let compressed = CompressedPath {
                    start,
                    cell_count,
                    runs: runs.into_boxed_slice(),
                    cost,
                    length: Fx(length),
                    time_ref: Fx(time_ref),
                    time_square: Fx(time_square),
                    time_lateen: Fx(time_lateen),
                };
                row.push(Some(StoredPath { compressed }));
            }
            paths.push(row);
        }
        if !reader.0.is_empty() {
            return Err(bad);
        }
        Ok(Self { grid, loc_count, paths, expanded: Default::default() })
    }
}

struct Reader<'a>(&'a [u8]);
impl Reader<'_> {
    fn take<const N: usize>(&mut self) -> Result<[u8; N], RouteError> {
        let bytes = self.0.get(..N).ok_or(RouteError::InvalidEncoding)?;
        let value = bytes.try_into().map_err(|_| RouteError::InvalidEncoding)?;
        self.0 = &self.0[N..];
        Ok(value)
    }
    fn u16(&mut self) -> Result<u16, RouteError> {
        Ok(u16::from_le_bytes(self.take()?))
    }
    fn u32(&mut self) -> Result<u32, RouteError> {
        Ok(u32::from_le_bytes(self.take()?))
    }
    fn i64(&mut self) -> Result<i64, RouteError> {
        Ok(i64::from_le_bytes(self.take()?))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn path(cells: Vec<Cell>) -> Path {
        Path { cells, cost: 7, length: Fx(123), time_ref: Fx(234), time_square: Fx(345), time_lateen: Fx(456) }
    }

    #[test]
    fn empty_singleton_and_seam_runs_expand_exactly() {
        let topology = MapTopology::new(10, 6, true);
        for cells in [
            vec![],
            vec![Cell::new(4, 2)],
            vec![Cell::new(8, 1), Cell::new(9, 1), Cell::new(0, 1), Cell::new(1, 1), Cell::new(2, 2)],
        ] {
            let original = path(cells);
            let route = CompressedPath::compress(&original, topology).unwrap();
            assert_eq!(route.expand(topology), original);
            let mut iter = route.cells(topology);
            for (i, cell) in original.cells.iter().enumerate() {
                assert_eq!(iter.len(), original.cells.len() - i);
                assert_eq!(iter.next(), Some(*cell));
            }
            assert_eq!(iter.next(), None);
            assert_eq!(iter.len(), 0);
            assert_eq!(iter.next(), None);
        }
    }

    #[test]
    fn long_runs_split_without_overflow_and_invalid_steps_are_rejected() {
        let topology = MapTopology::new(20000, 1, false);
        let original = path((0..20000).map(|x| Cell::new(x, 0)).collect());
        let route = CompressedPath::compress(&original, topology).unwrap();
        assert_eq!(route.runs().len(), 3);
        assert_eq!(route.expand(topology), original);
        assert!(CompressedPath::compress(&path(vec![Cell::new(0, 0), Cell::new(2, 0)]), topology).is_err());
        assert!(CompressedPath::compress(&path(vec![Cell::new(0, 0), Cell::new(0, 0)]), topology).is_err());
    }
}
