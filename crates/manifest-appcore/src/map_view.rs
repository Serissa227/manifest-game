//! I3 公开地图资源：只从海陆、公开地理图层与尺度取值，不遍历地点、发现物或玩家状态。

use super::MapView;
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use manifest_core::StaticData;
use manifest_core::nav::Terrain;
use serde::Serialize;

/// 未提供物理尺度的旧地图按一格一单位显示；世界注册表优先使用 map.toml 的 cell_km。
pub const DEFAULT_CELL_KM: u32 = 1;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct MapProjection {
    pub kind: &'static str,
    pub west: i32,
    pub north: i32,
    pub arcmin_per_cell: u16,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct SeaLayer {
    pub encoding: &'static str,
    pub data: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct MapResource {
    pub key: String,
    pub hash: String,
    pub width: u16,
    pub height: u16,
    pub wrap_x: bool,
    pub cell_km: u32,
    pub projection: Option<MapProjection>,
    pub rows: Vec<String>,
    pub relief: Option<Vec<String>>,
    pub biomes: Option<Vec<String>>,
    pub seas: Option<SeaLayer>,
}

/// 细图层（第九批 M01“细海图”）：细海岸、细高程、细河流三个二进制文件原样（base64）下发，只给显示用。
/// 文件格式见 `manifest_data::fine_map`；没有细图层的地图（经典世界、测试地图）三项都为 None、`cells` 为 0，
/// 前端照原来的画法画。`hash` 覆盖三个文件的全部字节，前端按它缓存。
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct MapFineResource {
    pub key: String,
    pub hash: String,
    /// 每粗格的细分数（24）；没有细图层时为 0
    pub cells: u16,
    pub coast: Option<String>,
    pub elevation: Option<String>,
    pub rivers: Option<String>,
}

impl MapFineResource {
    /// 没有细图层。
    pub fn empty(key: &str) -> Self {
        Self { key: key.to_owned(), hash: String::new(), cells: 0, coast: None, elevation: None, rivers: None }
    }

    /// 读 `<地图目录>/fine/` 下的三个文件。目录不存在就是没有细图层；文件不全、读不出或与航行网格的尺寸对不上时
    /// 记一行日志、同样按没有处理（海图退回原来的画法，不因此打不开）。
    pub fn load(key: &str, dir: &std::path::Path, width: u16, height: u16) -> Self {
        use manifest_data::fine_map::{FineCoast, FineElevation, FineRivers};
        if !dir.is_dir() {
            return Self::empty(key);
        }
        let read = |name: &str| std::fs::read(dir.join(name)).map_err(|e| format!("{name}：{e}"));
        let loaded = (|| -> Result<Self, String> {
            let (coast, elevation, rivers) = (read("coast.bin")?, read("elevation.bin")?, read("rivers.bin")?);
            let decoded = FineCoast::decode(&coast).map_err(|e| e.to_string())?;
            if (decoded.width, decoded.height) != (u32::from(width), u32::from(height)) {
                return Err("细海岸与航行网格的尺寸不符".into());
            }
            let relief = FineElevation::decode(&elevation).map_err(|e| e.to_string())?;
            let per = u32::from(relief.per_cell);
            if (relief.width, relief.height) != (u32::from(width) * per, u32::from(height) * per) {
                return Err("细高程与航行网格的尺寸不符".into());
            }
            FineRivers::decode(&rivers).map_err(|e| e.to_string())?;
            let mut h = blake3::Hasher::new();
            h.update(b"manifest-map-fine-v1\0");
            for part in [&coast, &elevation, &rivers] {
                h.update(&(part.len() as u64).to_le_bytes());
                h.update(part);
            }
            Ok(Self {
                key: key.to_owned(),
                hash: h.finalize().to_hex().to_string(),
                cells: decoded.sub,
                coast: Some(STANDARD.encode(coast)),
                elevation: Some(STANDARD.encode(elevation)),
                rivers: Some(STANDARD.encode(rivers)),
            })
        })();
        loaded.unwrap_or_else(|error| {
            eprintln!("[manifest] 地图 {key:?} 的细图层不可用：{}", error.replace(['\r', '\n'], " "));
            Self::empty(key)
        })
    }
}

pub fn terrain_rows(defs: &StaticData) -> Vec<String> {
    defs.map
        .terrain
        .chunks(usize::from(defs.map.width).max(1))
        .map(|row| {
            row.iter()
                .map(|terrain| match terrain {
                    Terrain::Deep => '~',
                    Terrain::Shallow => '-',
                    Terrain::Land => '#',
                })
                .collect()
        })
        .collect()
}

impl MapResource {
    pub fn new(defs: &StaticData, cell_km: u32) -> Self {
        let map = &defs.map;
        let mut seas = Vec::with_capacity(map.region.len() * 2);
        for region in &map.region {
            // 内核以 65535 表示未划分；I3 以 0 表示未划分，其他海区从 1 开始。
            seas.extend_from_slice(&region.checked_add(1).unwrap_or(0).to_le_bytes());
        }
        let projection = defs.nav.grid.rules().and_then(|r| r.projection.as_ref()).map(|p| MapProjection {
            kind: "equirect",
            west: p.west,
            north: p.north,
            arcmin_per_cell: p.arcmin_per_cell,
        });
        let mut resource = Self {
            key: defs.map_key.clone(),
            hash: String::new(),
            width: map.width,
            height: map.height,
            wrap_x: map.wrap_x,
            cell_km,
            projection,
            rows: terrain_rows(defs),
            relief: defs.geography.relief_rows(map.width),
            // 奥术标记不能泄露秘境所在格，公开资源只呈现普通草地。
            biomes: defs
                .geography
                .biome_rows(map.width)
                .map(|rows| rows.into_iter().map(|row| row.replace('X', "G")).collect()),
            seas: Some(SeaLayer { encoding: "u16le-base64", data: STANDARD.encode(seas) }),
        };
        resource.hash = resource.content_hash();
        resource
    }

    /// 完整 BLAKE3，覆盖下发的全部字段（除了 hash 自身）。
    /// 固定 v1 域、字段顺序、小端整数、u64 长度前缀与可选值标记，避免 JSON 自引用与拼接歧义。
    pub fn content_hash(&self) -> String {
        fn bytes(h: &mut blake3::Hasher, value: &[u8]) {
            h.update(&(value.len() as u64).to_le_bytes());
            h.update(value);
        }
        fn rows(h: &mut blake3::Hasher, values: &[String]) {
            h.update(&(values.len() as u64).to_le_bytes());
            for value in values {
                bytes(h, value.as_bytes());
            }
        }
        let mut h = blake3::Hasher::new();
        h.update(b"manifest-map-resource-v1\0");
        bytes(&mut h, self.key.as_bytes());
        h.update(&self.width.to_le_bytes());
        h.update(&self.height.to_le_bytes());
        h.update(&[u8::from(self.wrap_x)]);
        h.update(&self.cell_km.to_le_bytes());
        h.update(&[u8::from(self.projection.is_some())]);
        if let Some(p) = &self.projection {
            bytes(&mut h, p.kind.as_bytes());
            h.update(&p.west.to_le_bytes());
            h.update(&p.north.to_le_bytes());
            h.update(&p.arcmin_per_cell.to_le_bytes());
        }
        rows(&mut h, &self.rows);
        for layer in [&self.relief, &self.biomes] {
            h.update(&[u8::from(layer.is_some())]);
            if let Some(layer) = layer {
                rows(&mut h, layer);
            }
        }
        h.update(&[u8::from(self.seas.is_some())]);
        if let Some(seas) = &self.seas {
            bytes(&mut h, seas.encoding.as_bytes());
            bytes(&mut h, seas.data.as_bytes());
        }
        h.finalize().to_hex().to_string()
    }

    pub fn summary(&self) -> MapView {
        MapView {
            width: self.width,
            height: self.height,
            rows: Vec::new(),
            relief: None,
            biomes: None,
            key: Some(self.key.clone()),
            hash: Some(self.hash.clone()),
            wrap_x: Some(self.wrap_x),
            external: Some(true),
        }
    }
}

pub fn static_map(defs: &StaticData) -> MapView {
    if defs.world_key != "classic" {
        return MapResource::new(defs, DEFAULT_CELL_KM).summary();
    }
    MapView {
        width: defs.map.width,
        height: defs.map.height,
        rows: terrain_rows(defs),
        relief: defs.geography.relief_rows(defs.map.width),
        biomes: defs.geography.biome_rows(defs.map.width),
        key: None,
        hash: None,
        wrap_x: None,
        external: None,
    }
}
