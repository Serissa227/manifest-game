//! 细海岸进内核（第九批 M02“细碰撞”）：读 `maps/<地图>/fine/coast.bin`，转成内核的
//! [`manifest_core::nav::FineCoast`] 挂到 `StaticData::fine_coast` 上。内核不做 IO，所以读文件在这里。
//!
//! 地图目录下没有 `fine/fine.toml` 就是没有细图层（经典世界、测试夹具）：返回 None，内核一切照粗格走。
//! 有说明文件而细海岸读不出、校验和不符、尺寸对不上或格心不是水，都是数据错误（不能悄悄退回粗格：
//! 那样同一份命令日志在两台机器上会走出不同的航迹）。
//!
//! `fine.toml` 的全文算进模拟哈希（见 `worlds/files.rs` 的 `load_map`），它记着 `coast.bin` 的 blake3；
//! 这里核对文件与记的一致，所以细海岸变了、模拟哈希一定跟着变。

use super::Issues;
use crate::fine_map;
use crate::worlds::EffectiveWorld;
use manifest_core::nav::{FineCoast, SeaMap, Terrain};
use serde::Deserialize;
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex, OnceLock};

#[derive(Deserialize)]
struct FineManifest {
    coast: CoastEntry,
}

#[derive(Deserialize)]
struct RiversManifest {
    rivers: Option<CoastEntry>,
}

#[derive(Deserialize)]
struct CoastEntry {
    file: String,
    blake3: String,
}

/// 进程内共享：同一份细海岸（按说明文件里记的校验和认）只解压、转换一次。
/// 第一次用时核对过文件的校验和与记的一致，之后同一校验和直接取。
fn shared() -> &'static Mutex<BTreeMap<String, Arc<FineCoast>>> {
    static CACHE: OnceLock<Mutex<BTreeMap<String, Arc<FineCoast>>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(BTreeMap::new()))
}

pub(super) fn load(dir: &EffectiveWorld, map: &SeaMap, is: &mut Issues) -> Option<Arc<FineCoast>> {
    let (logical, path) = dir.fine_manifest()?;
    let mut fail = |message: String| {
        is.push(logical, "coast", message);
        None
    };
    let text = match dir.source_text(path) {
        Ok(text) => text,
        Err(e) => return fail(e.to_string()),
    };
    let manifest: FineManifest = match toml::from_str(&text) {
        Ok(manifest) => manifest,
        Err(e) => return fail(format!("说明文件解析失败：{e}")),
    };
    // 文件名只能是同目录下的普通文件名
    let name = manifest.coast.file.as_str();
    if name.is_empty() || name.contains(['/', '\\', ':']) || name == "." || name == ".." {
        return fail(format!("细海岸的文件名无效：{name:?}"));
    }
    let declared = manifest.coast.blake3.to_ascii_lowercase();
    let cached = shared().lock().unwrap_or_else(|e| e.into_inner()).get(&declared).cloned();
    let coast = match cached {
        Some(coast) => coast,
        None => {
            let Some(file) = path.parent().map(|p| p.join(name)) else {
                return fail("说明文件没有所在目录".into());
            };
            let bytes = match std::fs::read(&file) {
                Ok(bytes) => bytes,
                Err(e) => return fail(format!("{name} 读取失败：{e}")),
            };
            let actual = blake3::hash(&bytes).to_hex().to_string();
            if actual != declared {
                return fail(format!("{name} 的校验和与说明文件不符（文件 {actual}，说明里记的 {declared}）"));
            }
            let kernel = fine_map::FineCoast::decode(&bytes).and_then(|coast| coast.to_kernel());
            let coast = match kernel {
                Ok(coast) => Arc::new(coast),
                Err(e) => return fail(e.to_string()),
            };
            shared().lock().unwrap_or_else(|e| e.into_inner()).insert(declared, coast.clone());
            coast
        }
    };
    if (coast.width(), coast.height()) != (map.width, map.height) {
        return fail(format!(
            "细海岸是 {}×{} 粗格，航行网格是 {}×{}",
            coast.width(),
            coast.height(),
            map.width,
            map.height
        ));
    }
    // 出港、读档修正都把船放在格心：每个可航行粗格的格心必须是水（完整的骨架约束由
    // `fine_map::verify_skeleton` 在生成时与测试里逐一验证，这里只查最要紧、也最便宜的这一条）。
    let centre = coast.fine_index(128);
    let mut dry = 0usize;
    let mut first = None;
    for (i, terrain) in map.terrain.iter().enumerate() {
        if *terrain == Terrain::Land {
            continue;
        }
        let cell = map.cell_of(i);
        if !coast.water(cell, centre, centre) {
            dry += 1;
            first.get_or_insert(cell);
        }
    }
    if let Some(cell) = first {
        return fail(format!("有 {dry} 个可航行粗格的格心在细海岸里不是水，例如 ({}, {})", cell.x, cell.y));
    }
    Some(coast)
}

/// 细河流进内核（H05 岸与锚地的汲水）：读 `fine/rivers.bin`，只留“河流经过哪些粗格”（格下标升序、不重复）。
/// 校验和同样记在 `fine.toml` 里（全文算进模拟哈希），这里核对文件与记的一致。没有细图层、
/// 或说明文件里没有 `[rivers]` 一节时为空。相邻两点之间按粗格补齐，免得长河段中间漏格。
pub(super) fn load_rivers(dir: &EffectiveWorld, map: &SeaMap, is: &mut Issues) -> Vec<u32> {
    static CACHE: OnceLock<Mutex<BTreeMap<String, Arc<Vec<u32>>>>> = OnceLock::new();
    let Some((logical, path)) = dir.fine_manifest() else { return Vec::new() };
    let mut fail = |message: String| {
        is.push(logical, "rivers", message);
        Vec::new()
    };
    let Ok(text) = dir.source_text(path) else { return Vec::new() };
    let entry = match toml::from_str::<RiversManifest>(&text) {
        Ok(RiversManifest { rivers: Some(entry) }) => entry,
        Ok(_) => return Vec::new(),
        Err(e) => return fail(format!("说明文件解析失败：{e}")),
    };
    let name = entry.file.as_str();
    if name.is_empty() || name.contains(['/', '\\', ':']) || name == "." || name == ".." {
        return fail(format!("细河流的文件名无效：{name:?}"));
    }
    let declared = entry.blake3.to_ascii_lowercase();
    let cache = CACHE.get_or_init(|| Mutex::new(BTreeMap::new()));
    let key = format!("{declared}:{}x{}", map.width, map.height);
    if let Some(cells) = cache.lock().unwrap_or_else(|e| e.into_inner()).get(&key).cloned() {
        return (*cells).clone();
    }
    let Some(file) = path.parent().map(|p| p.join(name)) else {
        return fail("说明文件没有所在目录".into());
    };
    let bytes = match std::fs::read(&file) {
        Ok(bytes) => bytes,
        Err(e) => return fail(format!("{name} 读取失败：{e}")),
    };
    let actual = blake3::hash(&bytes).to_hex().to_string();
    if actual != declared {
        return fail(format!("{name} 的校验和与说明文件不符（文件 {actual}，说明里记的 {declared}）"));
    }
    let rivers = match fine_map::FineRivers::decode(&bytes) {
        Ok(rivers) => rivers,
        Err(e) => return fail(e.to_string()),
    };
    if (rivers.width, rivers.height) != (u32::from(map.width), u32::from(map.height)) || rivers.sub == 0 {
        return fail(format!(
            "细河流是 {}×{} 粗格，航行网格是 {}×{}",
            rivers.width, rivers.height, map.width, map.height
        ));
    }
    let cells = river_cells(&rivers, map);
    cache.lock().unwrap_or_else(|e| e.into_inner()).insert(key, Arc::new(cells.clone()));
    cells
}

/// 细河流经过的粗格下标（升序、不重复）。坐标横向不取模，这里按地图是否环绕折回。
fn river_cells(rivers: &fine_map::FineRivers, map: &SeaMap) -> Vec<u32> {
    let sub = i64::from(rivers.sub);
    let (w, h) = (i64::from(map.width), i64::from(map.height));
    let mut out = std::collections::BTreeSet::new();
    let mut mark = |fx: i64, fy: i64| {
        let (x, y) = (fx.div_euclid(sub), fy.div_euclid(sub));
        let x = if map.wrap_x { x.rem_euclid(w) } else { x };
        if (0..w).contains(&x) && (0..h).contains(&y) {
            out.insert((y * w + x) as u32);
        }
    };
    for river in &rivers.rivers {
        for pair in river.points.windows(2) {
            let ([ax, ay], [bx, by]) = (pair[0].map(i64::from), pair[1].map(i64::from));
            // 每半格取一个点，保证不跳格
            let steps = ((bx - ax).abs().max((by - ay).abs()) * 2 / sub).max(1);
            for k in 0..=steps {
                mark(ax + (bx - ax) * k / steps, ay + (by - ay) * k / steps);
            }
        }
        if let [only] = river.points.as_slice() {
            mark(i64::from(only[0]), i64::from(only[1]));
        }
    }
    out.into_iter().collect()
}
