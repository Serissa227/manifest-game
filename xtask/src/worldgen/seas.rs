//! 海区划分：每个海格归到沿水路（八方向、不斜穿陆角）最近的种子点所属的海区，
//! 于是边界自然落在海峡与岬角之间；再做几遍多数平滑去掉锯齿。

use super::grid::{Grid, N8};
use std::cmp::Reverse;
use std::collections::BinaryHeap;

/// `seeds[i]` 是第 i 个海区的种子点。返回每格的海区下标（陆格为 u16::MAX）。
pub fn partition(land: &Grid<bool>, seeds: &[Vec<(usize, usize)>]) -> Grid<u16> {
    let (w, h) = (land.w, land.h);
    let mut owner = Grid::new(w, h, u16::MAX);
    let mut dist = vec![u64::MAX; w * h];
    let mut heap = BinaryHeap::new();
    for (r, list) in seeds.iter().enumerate() {
        for &(x, y) in list {
            if x < w && y < h && !land.get(x, y) {
                let i = y * w + x;
                dist[i] = 0;
                owner.v[i] = r as u16;
                heap.push(Reverse((0u64, r as u16, i)));
            }
        }
    }
    while let Some(Reverse((d, r, i))) = heap.pop() {
        if d > dist[i] || owner.v[i] != r {
            continue;
        }
        let (x, y) = (i % w, i / w);
        for (k, &(dx, dy)) in N8.iter().enumerate() {
            let (nx, ny) = (x as i32 + dx, y as i32 + dy);
            if !land.inside(nx, ny) {
                continue;
            }
            let (ux, uy) = (nx as usize, ny as usize);
            if land.get(ux, uy) {
                continue;
            }
            if dx != 0 && dy != 0 && land.get(ux, y) && land.get(x, uy) {
                continue;
            }
            let step = if k % 2 == 1 { 1414 } else { 1000 };
            let j = uy * w + ux;
            let nd = d + step;
            if nd < dist[j] || (nd == dist[j] && r < owner.v[j]) {
                dist[j] = nd;
                owner.v[j] = r;
                heap.push(Reverse((nd, r, j)));
            }
        }
    }
    // 多数平滑：某格八邻中有 ≥ 5 个属于同一个别的海区，就改过去（种子格不动）
    let seed_cells: Vec<usize> =
        seeds.iter().flatten().filter(|&&(x, y)| x < w && y < h).map(|&(x, y)| y * w + x).collect();
    for _ in 0..3 {
        let prev = owner.clone();
        for y in 0..h {
            for x in 0..w {
                let i = y * w + x;
                if land.get(x, y) || seed_cells.contains(&i) {
                    continue;
                }
                let mut counts: Vec<(u16, u32)> = Vec::new();
                for &(dx, dy) in &N8 {
                    if let Some(r) = prev.at(x as i32 + dx, y as i32 + dy)
                        && r != u16::MAX
                    {
                        match counts.iter_mut().find(|(k, _)| *k == r) {
                            Some(c) => c.1 += 1,
                            None => counts.push((r, 1)),
                        }
                    }
                }
                if let Some(&(r, n)) = counts.iter().max_by_key(|(k, n)| (*n, Reverse(*k)))
                    && n >= 5
                    && r != prev.v[i]
                {
                    owner.v[i] = r;
                }
            }
        }
    }
    owner
}

/// 第 i 个海区的标记字符：a–z，然后 A–Z（避开 . ~ #）。
pub fn mark_of(i: usize) -> char {
    const MARKS: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    MARKS.get(i).map(|&b| b as char).unwrap_or('?')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn regions_split_at_a_strait() {
        // 两个水域由一条 1 格宽的海峡相连
        let mut land = Grid::new(21, 9, true);
        for y in 1..8 {
            for x in 1..9 {
                land.set(x, y, false);
            }
            for x in 12..20 {
                land.set(x, y, false);
            }
        }
        for x in 9..12 {
            land.set(x, 4, false);
        }
        let owner = partition(&land, &[vec![(3, 4)], vec![(17, 4)]]);
        assert_eq!(owner.get(2, 2), 0);
        assert_eq!(owner.get(18, 6), 1);
        assert_eq!(owner.get(0, 0), u16::MAX);
        assert_eq!(mark_of(0), 'a');
        assert_eq!(mark_of(26), 'A');
    }
}
