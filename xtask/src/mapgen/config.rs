//! 生成器配置：路径相对 mapgen.toml；内容配置不隐式继承经典世界。

use anyhow::{Context, Result, bail, ensure};
use serde::Deserialize;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Procedural,
    Real,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    pub version: u32,
    pub mode: Mode,
    pub width: usize,
    pub height: usize,
    #[serde(default)]
    pub wrap_x: bool,
    pub output: PathBuf,
    pub layout: Option<PathBuf>,
    pub world: Option<PathBuf>,
    /// 真实地图的采样与明确的航道补丁；不用于经典生成。
    pub real: Option<Real>,
    /// 只作为本配置选用的骨架气候缺省值；骨架中显式写出的字段优先。
    pub climate: Option<toml::Table>,
    #[serde(default)]
    pub sources: BTreeMap<String, Source>,
    #[serde(default)]
    pub naming: Naming,
    #[serde(default)]
    pub report: Report,
    #[serde(default)]
    pub screenshots: Vec<Screenshot>,
    #[serde(default)]
    pub text: Text,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Real {
    /// 手写气候区表，相对 mapgen.toml；不下载气候栅格。
    pub climate_regions: Option<PathBuf>,
    pub west: i32,
    pub north: i32,
    pub arcmin_per_cell: u32,
    pub minimum_island_km2: f64,
    pub minimum_lake_km2: f64,
    pub river_max_rank: f64,
    pub elevation_nodata: i16,
    #[serde(default)]
    pub passages: Vec<super::check::Passage>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Source {
    pub path: PathBuf,
    /// 本地文件的完整 BLAKE3；仅校验，不下载。
    pub blake3: String,
    /// 来源与许可说明，后续真实栅格化会写入来源清单。
    pub attribution: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Naming {
    #[serde(default)]
    pub fallback: String,
    #[serde(default)]
    pub areas: Vec<Area>,
}

/// 矩形统一为 [x0, y0, x1, y1]，右、下端点不包含；重叠地区按声明顺序匹配。
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Area {
    pub name: String,
    pub rect: [usize; 4],
}

impl Area {
    pub fn contains(&self, x: usize, y: usize) -> bool {
        let [x0, y0, x1, y1] = self.rect;
        (x0..x1).contains(&x) && (y0..y1).contains(&y)
    }
}

impl Naming {
    pub fn region_name(&self, x: usize, y: usize) -> &str {
        self.areas.iter().find(|a| a.contains(x, y)).map_or(&self.fallback, |a| &a.name)
    }
}

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Report {
    #[serde(default)]
    pub coasts: Vec<Coast>,
    #[serde(default)]
    pub forests: Vec<Forest>,
    #[serde(default)]
    pub areas: Vec<Area>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Coast {
    pub name: String,
    pub sea_name: String,
    pub rect: [usize; 4],
    pub seeds: Vec<[usize; 2]>,
    pub radius: u16,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Forest {
    pub name: String,
    pub rect: [usize; 4],
    pub low_elevation: f64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Screenshot {
    /// 文件名，不含扩展名与目录。
    pub name: String,
    pub origin: [usize; 2],
    pub size: [usize; 2],
}

/// 说明文字允许 {width}、{height}、{levels} 三个替换项。
#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields, default)]
pub struct Text {
    pub map: Vec<String>,
    pub relief: Vec<String>,
    pub biomes: Vec<String>,
    pub seas: Vec<String>,
    pub rivers: Vec<String>,
    pub landmarks: Vec<String>,
}

impl Text {
    pub fn render(&self, width: usize, height: usize, levels: &[f64]) -> Self {
        let levels = levels.iter().enumerate().map(|(i, v)| format!("{i} <{v:.0} 米")).collect::<Vec<_>>().join("，");
        let fill = |lines: &[String]| {
            lines
                .iter()
                .map(|s| {
                    s.replace("{width}", &width.to_string())
                        .replace("{height}", &height.to_string())
                        .replace("{levels}", &levels)
                })
                .collect()
        };
        Self {
            map: fill(&self.map),
            relief: fill(&self.relief),
            biomes: fill(&self.biomes),
            seas: fill(&self.seas),
            rivers: fill(&self.rivers),
            landmarks: fill(&self.landmarks),
        }
    }
}

impl Config {
    pub fn read(path: &Path) -> Result<Self> {
        let text = std::fs::read_to_string(path).with_context(|| format!("读取 {}", path.display()))?;
        let mut config: Self = toml::from_str(&text).with_context(|| format!("解析 {}", path.display()))?;
        config.validate()?;
        let base = path.parent().context("配置文件缺少父目录")?;
        config.output = base.join(&config.output);
        config.layout = config.layout.map(|p| base.join(p));
        config.world = config.world.map(|p| base.join(p));
        if let Some(real) = &mut config.real {
            real.climate_regions = real.climate_regions.take().map(|p| base.join(p));
        }
        for source in config.sources.values_mut() {
            source.path = base.join(&source.path);
        }
        Ok(config)
    }

    fn validate(&self) -> Result<()> {
        ensure!(self.version == 1, "mapgen.toml 的 version 目前只支持 1");
        ensure!((1..=65_535).contains(&self.width) && (1..=65_535).contains(&self.height), "地图尺寸须为 1–65535");
        ensure!(!self.output.as_os_str().is_empty(), "output 不能为空");
        if self.mode == Mode::Procedural {
            ensure!(self.width >= 10 && self.height >= 10, "程序地图尺寸至少为 10");
            ensure!(!self.wrap_x, "程序生成器尚不支持 wrap_x；环绕真实地图请使用 real");
            ensure!(self.layout.is_some() && self.world.is_some(), "procedural 需要 layout 与 world 路径");
        }
        if let Some(real) = &self.real {
            ensure!(
                (5..=21600).contains(&real.arcmin_per_cell)
                    && real.arcmin_per_cell.is_multiple_of(5)
                    && (-10800..=10800).contains(&real.west)
                    && (-5400..=5400).contains(&real.north)
                    && i64::from(real.north) - self.height as i64 * i64::from(real.arcmin_per_cell) >= -5400,
                "真实投影必须在地球范围内，并对齐ETOPO5的五角分采样"
            );
            ensure!(
                [real.minimum_island_km2, real.minimum_lake_km2, real.river_max_rank]
                    .iter()
                    .all(|v| v.is_finite() && *v >= 0.0),
                "真实地图面积阈值与河流等级必须为有限非负数"
            );
        }
        let valid_rect = |r: [usize; 4]| r[0] < r[2] && r[1] < r[3] && r[2] <= self.width && r[3] <= self.height;
        for area in self.naming.areas.iter().chain(&self.report.areas) {
            ensure!(valid_rect(area.rect), "地区 {} 的矩形越界或为空", area.name);
        }
        for coast in &self.report.coasts {
            ensure!(valid_rect(coast.rect), "沿岸统计 {} 的矩形越界或为空", coast.name);
            ensure!(coast.radius <= 256, "沿岸统计半径不能超过 256 格");
            ensure!(coast.seeds.iter().all(|p| p[0] < self.width && p[1] < self.height), "沿岸统计种子越界");
        }
        for forest in &self.report.forests {
            ensure!(valid_rect(forest.rect) && forest.low_elevation.is_finite(), "针叶林统计配置无效");
        }
        let mut names = std::collections::BTreeSet::new();
        for s in &self.screenshots {
            ensure!(
                !s.name.is_empty() && s.name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'),
                "截图名只能包含字母、数字、- 与 _"
            );
            ensure!(names.insert(&s.name), "截图名重复：{}", s.name);
            ensure!(
                s.size[0] > 0
                    && s.size[1] > 0
                    && s.origin[0].checked_add(s.size[0]).is_some_and(|v| v <= self.width)
                    && s.origin[1].checked_add(s.size[1]).is_some_and(|v| v <= self.height),
                "截图 {} 越界或为空",
                s.name
            );
        }
        for (name, source) in &self.sources {
            if source.path.as_os_str().is_empty() || source.attribution.trim().is_empty() {
                bail!("[sources.{name}] 需要非空的 path 与 attribution");
            }
            ensure!(
                source.blake3.len() == 64 && source.blake3.bytes().all(|b| b.is_ascii_hexdigit()),
                "[sources.{name}] 的 blake3 须为 64 位十六进制校验和"
            );
            ensure!(!source.path.to_string_lossy().contains("://"), "[sources.{name}] 只接受本地文件，不下载 URL");
        }
        Ok(())
    }
}
