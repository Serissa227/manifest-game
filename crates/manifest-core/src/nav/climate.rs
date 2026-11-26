//! 世界包的导航周期、纬度尺度与封冻限制；不涉及 IO 或世界状态。

use super::{DIAG, MapTopology, step_len};
use crate::calendar::{Calendar, Season};
use crate::defs::{RegionDef, SeasonWeather};
use crate::{Fx, LocId, RegionId};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// 整数角分的等距圆柱投影，原点在左上角，距离取格心纬度。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Projection {
    pub kind: ProjectionKind,
    pub west: i32,
    pub north: i32,
    pub arcmin_per_cell: u16,
    #[serde(default)]
    pub lat_scale: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProjectionKind {
    #[default]
    Equirect,
}

/// 用 Q30 的余弦递推生成整度表；线性插值到半角分，最终四舍五入到万分之一。
/// 常量为 cos(1°)、sin(1°) 的 Q30 值；运行时与编译期均不使用浮点。
const fn cosine_table() -> [i64; 91] {
    let mut table = [0; 91];
    let (mut c, mut s, mut i) = (1i64 << 30, 0i64, 0);
    while i <= 90 {
        table[i] = c;
        let next = (c * 1_073_578_288 - s * 18_739_379 + (1 << 29)) >> 30;
        s = (s * 1_073_578_288 + c * 18_739_379 + (1 << 29)) >> 30;
        c = next;
        i += 1;
    }
    table[0] = 1 << 30;
    table[90] = 0;
    table
}
const COS: [i64; 91] = cosine_table();

pub fn cos_latitude(arcmin: i32) -> Fx {
    cos_half_arcmin(i64::from(arcmin) * 2)
}

fn cos_half_arcmin(latitude: i64) -> Fx {
    let a = latitude.unsigned_abs().min(10_800) as usize;
    let degree = a / 120;
    let fraction = (a % 120) as i64;
    let value = if degree == 90 { 0 } else { (COS[degree] * (120 - fraction) + COS[degree + 1] * fraction) / 120 };
    Fx((value * Fx::SCALE + (1 << 29)) >> 30)
}

impl Projection {
    pub fn latitude_half_arcmin(&self, row: u16) -> i64 {
        i64::from(self.north) * 2 - (i64::from(row) * 2 + 1) * i64::from(self.arcmin_per_cell)
    }

    pub fn row_cos(&self, row: u16) -> Fx {
        cos_half_arcmin(self.latitude_half_arcmin(row))
    }

    /// 几何距离：东西乘 cos，斜向按两个分量的整数平方根合成。
    pub fn step_length(&self, row: u16, dir: u8) -> Fx {
        if !self.lat_scale {
            return step_len(dir);
        }
        let c = self.row_cos(row).0;
        match dir % 8 {
            0 | 4 => Fx::ONE,
            2 | 6 => Fx(c),
            _ => Fx((c * c + Fx::SCALE * Fx::SCALE).isqrt()),
        }
    }

    /// B4 的高纬航行修正：速度乘 cos²，耗时与按日补给因此增加。
    /// 极点按 cos=0.01 下限处理，避免除零；几何距离仍使用真实 cos。
    pub fn travel_length(&self, row: u16, dir: u8) -> Fx {
        if !self.lat_scale {
            return step_len(dir);
        }
        let c = self.row_cos(row).0.max(100);
        let length = self.step_length(row, dir).0.max(100);
        Fx((i128::from(length) * i128::from(Fx::SCALE).pow(2) / i128::from(c * c)) as i64)
    }
}

/// 风与流均为去向：0 北，顺时针八向。I3 显示风的来向时须加 180°。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NavWeather {
    pub wind_dir: u8,
    pub wind_strength: i64,
    pub current_dir: u8,
    pub current_strength: i64,
    #[serde(default)]
    pub storm_bp: i64,
    #[serde(default)]
    pub pirate_bp: i64,
}

impl From<SeasonWeather> for NavWeather {
    fn from(w: SeasonWeather) -> Self {
        Self {
            wind_dir: w.wind_dir,
            wind_strength: w.wind_strength,
            current_dir: w.current_dir,
            current_strength: w.current_strength,
            storm_bp: w.storm_bp,
            pirate_bp: w.pirate_bp,
        }
    }
}

impl From<NavWeather> for SeasonWeather {
    fn from(w: NavWeather) -> Self {
        Self {
            wind_dir: w.wind_dir,
            wind_strength: w.wind_strength,
            current_dir: w.current_dir,
            current_strength: w.current_strength,
            storm_bp: w.storm_bp,
            pirate_bp: w.pirate_bp,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct RegionClimate {
    /// 空表示沿用 RegionDef；1 组全年、4 组当地春夏秋冬、12 组一月至十二月。
    pub weather: Vec<NavWeather>,
    pub south: bool,
    /// 公历式月序号，从 1 开始；不随南半球季节再次平移。
    pub frozen_months: Vec<u8>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct NavigationRules {
    pub calendar: Calendar,
    pub projection: Option<Projection>,
    pub regions: Vec<RegionClimate>,
    pub frozen_ports: BTreeMap<LocId, Vec<u8>>,
}

#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum NavError {
    #[error("导航配置无效：{0}")]
    InvalidConfig(String),
    #[error("海区封冻")]
    FrozenRegion,
    #[error("港口封冻")]
    FrozenPort,
    #[error("航线不可达")]
    Unreachable,
    #[error("导航周期不存在")]
    InvalidPeriod,
}

impl NavError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidConfig(_) => "invalid_nav_config",
            Self::FrozenRegion => "frozen_region",
            Self::FrozenPort => "frozen_port",
            Self::Unreachable => "unreachable",
            Self::InvalidPeriod => "invalid_nav_period",
        }
    }
}

impl NavigationRules {
    pub fn period_count(&self) -> usize {
        if !self.frozen_ports.is_empty()
            || self.regions.iter().any(|r| r.weather.len() == 12 || !r.frozen_months.is_empty())
        {
            12
        } else {
            4
        }
    }

    pub fn period_on(&self, day: u32) -> usize {
        if self.period_count() == 12 {
            self.calendar.date_of(day).month as usize - 1
        } else {
            self.calendar.season_of(day).index()
        }
    }

    pub fn season_on(&self, region: RegionId, day: u32) -> Season {
        let north = self.calendar.season_of(day).index();
        let south = self.regions.get(region.idx()).is_some_and(|r| r.south);
        Season::ALL[(north + if south { 2 } else { 0 }) % 4]
    }

    pub fn weather(&self, regions: &[RegionDef], region: RegionId, period: usize) -> Option<SeasonWeather> {
        if period >= self.period_count() {
            return None;
        }
        let base = regions.get(region.idx())?;
        let r = self.regions.get(region.idx());
        let season = if self.period_count() == 12 { *self.calendar.seasons().get(period)? as usize } else { period };
        let season = (season + if r.is_some_and(|r| r.south) { 2 } else { 0 }) % 4;
        Some(match r.map(|r| r.weather.as_slice()).unwrap_or_default() {
            [one] => (*one).into(),
            weather if weather.len() == 4 => weather[season].into(),
            weather if weather.len() == 12 => weather[period].into(),
            _ => base.seasons[season],
        })
    }

    pub fn region_frozen(&self, region: RegionId, period: usize) -> bool {
        self.regions.get(region.idx()).is_some_and(|r| r.frozen_months.contains(&((period + 1) as u8)))
    }

    pub fn port_frozen(&self, port: LocId, period: usize) -> bool {
        self.frozen_ports.get(&port).is_some_and(|months| months.contains(&((period + 1) as u8)))
    }

    pub fn validate(&self, topology: MapTopology, region_count: usize) -> Result<(), NavError> {
        let invalid = |text: &str| NavError::InvalidConfig(text.into());
        if self.regions.len() > region_count {
            return Err(invalid("海区数量超过地图定义"));
        }
        if self.period_count() == 12 && self.calendar.months().len() != 12 {
            return Err(invalid("逐月风场与封冻要求日历恰有十二个月"));
        }
        if let Some(p) = &self.projection
            && (p.arcmin_per_cell == 0
                || p.north.unsigned_abs() > 5400
                || p.west.unsigned_abs() > 10800
                || p.latitude_half_arcmin(topology.height.saturating_sub(1)).abs() > 10800)
        {
            return Err(invalid("投影的步长或纬度范围无效"));
        }
        for r in &self.regions {
            if ![0, 1, 4, 12].contains(&r.weather.len()) {
                return Err(invalid("风场必须为 1、4 或 12 组"));
            }
            for w in &r.weather {
                if w.wind_dir > 7
                    || w.current_dir > 7
                    || !(0..=10).contains(&w.wind_strength)
                    || !(0..=3).contains(&w.current_strength)
                    || !(0..=10000).contains(&w.storm_bp)
                    || !(0..=10000).contains(&w.pirate_bp)
                {
                    return Err(invalid("风流方向、强度或危险度越界"));
                }
            }
        }
        for months in self.regions.iter().map(|r| &r.frozen_months).chain(self.frozen_ports.values()) {
            if months.iter().any(|m| !(1..=12).contains(m)) {
                return Err(invalid("封冻月必须在 1–12 之间"));
            }
        }
        Ok(())
    }
}

/// 不缩放时直接保留原来的对角常量，避免定点舍入改变经典路径。
pub(super) fn row_lengths(p: Option<&Projection>, row: u16) -> ([Fx; 8], [Fx; 8]) {
    let lengths = std::array::from_fn(|d| p.map_or_else(|| step_len(d as u8), |p| p.step_length(row, d as u8)));
    let factors = std::array::from_fn(|d| {
        p.map_or(Fx::ONE, |p| p.travel_length(row, d as u8).div(if d % 2 == 0 { Fx::ONE } else { DIAG }))
    });
    (lengths, factors)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Cell;
    use crate::nav::{NavGrid, NavTable, SeaMap, Terrain};
    use crate::weather::Climate;

    fn setup() -> (SeaMap, Vec<RegionDef>) {
        let w = SeasonWeather {
            wind_dir: 2,
            wind_strength: 5,
            current_dir: 2,
            current_strength: 1,
            storm_bp: 0,
            pirate_bp: 0,
        };
        (
            SeaMap { width: 9, height: 5, wrap_x: false, terrain: vec![Terrain::Deep; 45], region: vec![0; 45] },
            vec![RegionDef {
                key: "sea".into(),
                name: "海区".into(),
                rect: (0, 0, 8, 4),
                seasons: [w; 4],
                climate: Climate::Cold,
            }],
        )
    }

    fn gregorian() -> Calendar {
        Calendar::new(
            vec![31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31],
            vec![3, 3, 0, 0, 0, 1, 1, 1, 2, 2, 2, 3],
            "公元".into(),
            vec![],
        )
        .expect("日历")
    }

    #[test]
    fn cosine_error_at_every_arcminute_and_both_hemispheres() {
        // 独立的十二位定点 Taylor 参考值，覆盖整张插值表，不把实现镜像成期望值。
        let scale = 1_000_000_000_000i128;
        let mut worst = 0;
        for arcmin in 0..=5400 {
            let x = i128::from(arcmin) * 3_141_592_653_590 / 10800;
            let (mut term, mut sum) = (scale, scale);
            for n in 1..=12 {
                term = -((term * x / scale) * x / scale) / ((2 * n - 1) * (2 * n));
                sum += term;
            }
            let got = cos_latitude(arcmin);
            worst = worst.max((i128::from(got.0) * scale - sum * 10000).abs());
            assert_eq!(got, cos_latitude(-arcmin));
        }
        assert!(worst < 5 * scale, "误差必须小于 0.0005：{worst}");
        for (degrees, expected) in [(0, 10000), (30, 8660), (60, 5000), (75, 2588), (89, 175), (90, 0)] {
            assert!((cos_latitude(degrees * 60).0 - expected).abs() <= 1);
        }
    }

    #[test]
    fn latitude_geometry_and_travel_cost_are_distinct_and_symmetric() {
        let (map, regions) = setup();
        let make = |north| {
            NavGrid::with_rules(
                &map,
                &regions,
                &[],
                NavigationRules {
                    projection: Some(Projection {
                        kind: ProjectionKind::Equirect,
                        west: 0,
                        north,
                        arcmin_per_cell: 2,
                        lat_scale: true,
                    }),
                    ..Default::default()
                },
            )
            .expect("投影")
        };
        let equator = make(5).find_path(0, Cell::new(0, 2), Cell::new(8, 2)).expect("赤道航线");
        let high = make(3605).find_path(0, Cell::new(0, 2), Cell::new(8, 2)).expect("高纬航线");
        assert!(high.length < equator.length);
        assert!(high.time_ref > equator.time_ref);
        assert!(high.estimate_days(Fx::ONE) > equator.estimate_days(Fx::ONE));
        let north =
            Projection { kind: ProjectionKind::Equirect, west: 0, north: 3601, arcmin_per_cell: 2, lat_scale: true };
        let south = Projection { north: -3599, ..north.clone() };
        for d in 0..8 {
            assert_eq!(north.travel_length(0, d), south.travel_length(0, d));
        }
        assert_eq!(north.step_length(0, 2), Fx(5000));
        assert_eq!(north.step_length(0, 1), Fx(11180));
    }

    #[test]
    fn june_and_december_monsoons_choose_different_routes() {
        let (mut map, mut regions) = setup();
        regions.push(regions[0].clone());
        regions[1].key = "south".into();
        for y in 2..5 {
            for x in 0..9 {
                map.region[y * 9 + x] = 1;
            }
        }
        for x in 1..8 {
            map.terrain[2 * 9 + x] = Terrain::Land;
        }
        let mut top = vec![NavWeather::from(regions[0].seasons[0]); 12];
        let mut bottom = top.clone();
        top[11].wind_dir = 6;
        bottom[5].wind_dir = 6;
        let rules = NavigationRules {
            calendar: gregorian(),
            regions: vec![
                RegionClimate { weather: top, ..Default::default() },
                RegionClimate { weather: bottom, ..Default::default() },
            ],
            ..Default::default()
        };
        let grid = NavGrid::with_rules(&map, &regions, &[], rules).expect("季风");
        let june = grid.find_path_on(151, Cell::new(0, 2), Cell::new(8, 2)).expect("六月");
        let december = grid.find_path_on(334, Cell::new(0, 2), Cell::new(8, 2)).expect("十二月");
        assert_ne!(june.cells, december.cells);
        assert!(june.cells.iter().any(|c| c.y == 1));
        assert!(december.cells.iter().any(|c| c.y == 3));
    }

    #[test]
    fn frozen_ports_regions_and_realtime_routes_reopen_after_thaw() {
        let (mut map, regions) = setup();
        map.wrap_x = true;
        let ports = [(LocId(0), Cell::new(0, 2)), (LocId(1), Cell::new(8, 2))];
        let mut rules = NavigationRules { calendar: gregorian(), ..Default::default() };
        rules.frozen_ports.insert(LocId(1), vec![1, 12]);
        let table = NavTable::build_with_rules(&map, &regions, 2, &ports, rules.clone()).expect("建表");
        assert!(table.path(0, LocId(0), LocId(1)).is_none());
        assert!(table.path(5, LocId(0), LocId(1)).is_some());
        assert_eq!(table.grid.check_port(0, LocId(1)), Err(NavError::FrozenPort));
        assert!(table.grid.find_path_on(0, ports[0].1, ports[1].1).is_err());
        assert!(table.grid.find_path_on(151, ports[0].1, ports[1].1).is_ok());
        rules.regions = vec![RegionClimate { frozen_months: vec![2], ..Default::default() }];
        let grid = NavGrid::with_rules(&map, &regions, &ports, rules).expect("海区冬封");
        assert_eq!(grid.find_path_on(31, ports[0].1, ports[1].1), Err(NavError::FrozenRegion));
        assert!(grid.find_path_on(59, ports[0].1, ports[1].1).is_ok());
    }

    #[test]
    fn southern_seasons_flip_but_monthly_weather_does_not() {
        let (_, regions) = setup();
        let mut seasonal = vec![NavWeather::from(regions[0].seasons[0]); 4];
        for (i, w) in seasonal.iter_mut().enumerate() {
            w.current_dir = i as u8;
        }
        let mut rules = NavigationRules {
            calendar: gregorian(),
            regions: vec![RegionClimate { south: true, weather: seasonal, ..Default::default() }],
            ..Default::default()
        };
        assert_eq!(rules.season_on(RegionId(0), 151), Season::Winter);
        assert_eq!(rules.weather(&regions, RegionId(0), 1).expect("天气").current_dir, 3);
        rules.regions[0].weather =
            (0..12).map(|m| NavWeather { current_dir: (m % 8) as u8, ..regions[0].seasons[0].into() }).collect();
        assert_eq!(rules.weather(&regions, RegionId(0), 5).expect("六月").current_dir, 5);
    }

    #[test]
    fn projected_frozen_routes_match_astar_and_dijkstra_costs() {
        let (mut map, mut regions) = setup();
        regions.push(regions[0].clone());
        for y in 0..4 {
            map.region[y * 9 + 4] = 1;
        }
        let rules = NavigationRules {
            projection: Some(Projection {
                kind: ProjectionKind::Equirect,
                west: 0,
                north: 3605,
                arcmin_per_cell: 2,
                lat_scale: true,
            }),
            regions: vec![RegionClimate::default(), RegionClimate { frozen_months: vec![1], ..Default::default() }],
            ..Default::default()
        };
        let grid = NavGrid::with_rules(&map, &regions, &[], rules).expect("投影与封冻");
        for month in [0, 5] {
            for y in 0..5 {
                let from = Cell::new(0, y);
                let targets: Vec<_> = (0..5).map(|row| Cell::new(8, row)).collect();
                let routes = grid.routes_from(month, from, &targets);
                for (target, path) in targets.iter().zip(routes) {
                    let path = path.expect("可绕行");
                    assert_eq!(grid.find_path(month, from, *target).expect("A*").cost, path.cost);
                    if month == 0 {
                        assert!(path.cells.iter().all(|c| map.region[map.idx(*c)] != 1));
                    }
                }
            }
        }
    }

    #[test]
    fn empty_rules_match_every_classic_route_and_reject_bad_inputs() {
        let (map, regions) = setup();
        let classic = NavGrid::new(&map, &regions);
        let grid = NavGrid::with_rules(&map, &regions, &[], NavigationRules::default()).expect("缺省");
        for s in 0..4 {
            for x in 0..9 {
                for y in 0..5 {
                    assert_eq!(
                        classic.find_path(s, Cell::new(0, 0), Cell::new(x, y)),
                        grid.find_path(s, Cell::new(0, 0), Cell::new(x, y))
                    );
                }
            }
        }
        assert!(grid.find_path(99, Cell::new(0, 0), Cell::new(1, 1)).is_none());
        assert!(grid.find_path(0, Cell::new(9, 0), Cell::new(1, 1)).is_none());
        let bad = NavigationRules {
            regions: vec![RegionClimate { frozen_months: vec![0], ..Default::default() }],
            ..Default::default()
        };
        assert!(NavGrid::with_rules(&map, &regions, &[], bad).is_err());
    }
}
