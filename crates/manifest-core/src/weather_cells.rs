//! H03 天气团（`rules.toml [weather_cells]`，VOYAGE-PLAN §4.1）：让风暴和雾可以绕开。
//!
//! 海区天况仍由 [`crate::weather`] 按（种子、日期、海区）的纯函数算；开关打开时，海区级的“暴风雨 / 雾”
//! 段落改由 0–2 个天气团承载：
//!
//! - 暴风雨段落的暴风雨天：1–`max_cells` 个**风暴团**；雾的段落：1–`max_cells` 个**雾团**；
//!   普通的雨段落：0–1 个**飑**（一阵急风骤雨：团内仍是雨，风力 +`squall_wind` 级，不伤船）。
//! - 每个团的中心（1/256 格）、半径（`radius` 格）、移速（`drift` 格 / 天）在段落开始那天按新随机域
//!   [`Domain::WeatherCells`] 抽一次；之后每天顺着当天的风移动，寿命就是原来那一段天况的长度。
//!   一天之内团的位置不变（日结之间不动；画面上团内的雨幕自己翻动）。
//! - 位置天况：在团内取团的种类；团外把海区天况降一级（暴风雨 → 雨，雾 → 多云；寒冷海区冬季的雨照旧是雪）。
//!   风暴团内的受损概率 = 海区暴风雨当天的受损概率 × `storm_hit_pct`%（封顶 100%）；团外不受损。
//!
//! 全部是纯函数：不进存档、不消费别的随机流。只给玩家（含模拟器 bot）的舰队用；NPC 舰队仍取海区天况，
//! 经济与日结的性能不受影响。开关关闭（经典世界、测试夹具）时这里的函数都不会被调用。

use crate::calendar::Season;
use crate::defs::StaticData;
use crate::fixed::{Fx, mul_div};
use crate::ids::{Cell, RegionId};
use crate::navigation::SubCell;
use crate::rng::{Domain, Rng};
use crate::weather::{Climate, DayWeather, E8, Sky, day_weather_spell};
use serde::{Deserialize, Serialize};

/// 天气团规则（`rules.toml [weather_cells]`）。缺省关闭。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct WeatherCellRules {
    pub enabled: bool,
    /// 风暴团与雾团的半径（格，含两端）
    pub radius: [i64; 2],
    /// 飑的半径（格，含两端）
    pub squall_radius: [i64; 2],
    /// 每天顺风移动的格数（含两端）
    pub drift: [i64; 2],
    /// 一个海区同时最多几个风暴团或雾团（至少 1 个）
    pub max_cells: i64,
    /// 风暴团内的受损概率相对海区暴风雨当天受损概率的百分比
    pub storm_hit_pct: i64,
    /// 飑内的风力加成（级，风力封顶 10）
    pub squall_wind: i64,
    /// 航行视图里，团进入“视野 × 这个倍数”就画出来并提醒
    pub sight_mult: i64,
    /// 世界海图上只画离船这么多格以内的团（已有海图的海区里）
    pub chart_range: i64,
}

impl Default for WeatherCellRules {
    fn default() -> Self {
        Self {
            enabled: false,
            radius: [3, 8],
            squall_radius: [2, 4],
            drift: [1, 3],
            max_cells: 2,
            storm_hit_pct: 200,
            squall_wind: 3,
            sight_mult: 2,
            chart_range: 15,
        }
    }
}

impl WeatherCellRules {
    /// 数据校验用：开启时说不通的取值（字段名，问题）。关闭时不看数值。
    pub fn problems(&self) -> Vec<(&'static str, &'static str)> {
        let mut out = Vec::new();
        if !self.enabled {
            return out;
        }
        let range = |r: [i64; 2], lo: i64, hi: i64| r[0] >= lo && r[0] <= r[1] && r[1] <= hi;
        if !range(self.radius, 1, 32) {
            out.push(("radius", "须为 [小, 大]，1 ≤ 小 ≤ 大 ≤ 32"));
        }
        if !range(self.squall_radius, 1, 32) {
            out.push(("squall_radius", "须为 [小, 大]，1 ≤ 小 ≤ 大 ≤ 32"));
        }
        if !range(self.drift, 0, 10) {
            out.push(("drift", "须为 [小, 大]，0 ≤ 小 ≤ 大 ≤ 10"));
        }
        if !(1..=4).contains(&self.max_cells) {
            out.push(("max_cells", "须在 1–4 之间"));
        }
        if !(0..=1_000).contains(&self.storm_hit_pct) {
            out.push(("storm_hit_pct", "须在 0–1000 之间"));
        }
        if !(0..=10).contains(&self.squall_wind) {
            out.push(("squall_wind", "须在 0–10 之间"));
        }
        if !(1..=4).contains(&self.sight_mult) {
            out.push(("sight_mult", "须在 1–4 之间"));
        }
        if !(0..=64).contains(&self.chart_range) {
            out.push(("chart_range", "须在 0–64 之间"));
        }
        out
    }
}

/// 天气团的种类。serde 用小写名，与前端一致。
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CellKind {
    /// 风暴团：团内暴风雨
    Storm,
    /// 飑：团内是雨、风更大
    Squall,
    /// 雾团
    Fog,
}

/// 某天的一个天气团。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct WeatherCell {
    /// 生出它的海区
    pub region: RegionId,
    /// 海区里的序号（0 起）
    pub index: u8,
    pub kind: CellKind,
    /// 当天的中心（1/256 格；环绕地图上横坐标已规范到图内）
    pub center: SubCell,
    /// 半径（1/256 格）
    pub radius: i64,
    /// 当天的移动方向（风的去向，0 = 北，顺时针 8 方向）
    pub dir: u8,
    /// 每天移动的距离（1/256 格）
    pub speed: i64,
    /// 团内的受损概率（亿分比，只有风暴团大于 0）
    pub storm_hit_e8: i64,
    /// 段落的头尾（第 `start` 天起到 `end` 天前；风暴团只活到段首的暴风雨天结束）
    pub start: u32,
    pub end: u32,
}

/// 天气团生成时的随机子键（同一海区同一段落里每个团各一条流）。
const K_COUNT: u64 = 0;

/// 环绕地图上两点的有符号横向差（1/256 格，取最短的一侧）。
pub fn sub_dx(defs: &StaticData, from: i64, to: i64) -> i64 {
    let delta = to - from;
    if !defs.map.wrap_x || defs.map.width == 0 {
        return delta;
    }
    let width = i64::from(defs.map.width) * SubCell::SCALE;
    let east = delta.rem_euclid(width);
    if east * 2 > width { east - width } else { east }
}

/// 两点（1/256 格）的欧氏距离平方（1/256 格²）。
pub fn sub_distance2(defs: &StaticData, a: SubCell, b: SubCell) -> i64 {
    let dx = sub_dx(defs, a.x, b.x);
    let dy = b.y - a.y;
    dx * dx + dy * dy
}

/// 寒冷海区冬季的雨是雪（与 [`crate::weather::day_weather`] 的判定一致）。
fn snowy(defs: &StaticData, region: RegionId, day: u32) -> bool {
    let Some(r) = defs.regions.get(region.idx()) else { return false };
    if r.climate != Climate::Cold {
        return false;
    }
    let season = match defs.nav.grid.rules() {
        Some(nav) if nav.regions.get(region.idx()).is_some_and(|x| !x.weather.is_empty() || x.south) => {
            nav.season_on(region, day)
        }
        _ => defs.calendar.season_of(day),
    };
    season == Season::Winter
}

/// 团外的天况：暴风雨降为雨（寒冷海区冬季为雪），雾降为多云，其余不变。
fn downgrade(defs: &StaticData, region: RegionId, day: u32, sky: Sky) -> Sky {
    match sky {
        Sky::Storm if snowy(defs, region, day) => Sky::Snow,
        Sky::Storm => Sky::Rain,
        Sky::Fog => Sky::Cloudy,
        other => other,
    }
}

/// 一格（1/256）的单位向量（万分之一）：0 = 北，顺时针 8 方向。
fn dir_vector(dir: u8) -> [i64; 2] {
    crate::navigation::course::direction(u16::from(dir % 8) * 45)
}

/// 某海区某天的天气团（纯函数）。开关关闭、海区不存在或当天没有团时返回空表。
pub fn cells_of(defs: &StaticData, seed: u64, region: RegionId, day: u32, storm_mult: Fx) -> Vec<WeatherCell> {
    let rules = &defs.rules.weather_cells;
    if !rules.enabled {
        return Vec::new();
    }
    let Some((today, spell)) = day_weather_spell(defs, seed, region, day, storm_mult) else { return Vec::new() };
    let kind = match today.sky {
        Sky::Storm => CellKind::Storm,
        Sky::Fog => CellKind::Fog,
        Sky::Rain if spell.storm_days == 0 => CellKind::Squall,
        _ => return Vec::new(),
    };
    let Some(def) = defs.regions.get(region.idx()) else { return Vec::new() };
    let start = spell.start.max(0);
    let end = match kind {
        CellKind::Storm => spell.start + spell.storm_days,
        _ => spell.end,
    }
    .max(start + 1);
    let start_day = start.clamp(0, i64::from(u32::MAX)) as u32;
    let mut rng = Rng::derive(seed, start_day, Domain::WeatherCells, u64::from(region.0), K_COUNT);
    let count = match kind {
        CellKind::Squall => rng.below(2) as i64,
        _ => 1 + rng.below(rules.max_cells.max(1) as u64) as i64,
    };
    let topology = defs.map.topology();
    let (x0, y0, x1, y1) = def.rect;
    let x_end = if x0 > x1 { i64::from(x1) + i64::from(topology.width) } else { i64::from(x1) };
    let radius = if kind == CellKind::Squall { rules.squall_radius } else { rules.radius };
    let mut out = Vec::new();
    for k in 0..count {
        let mut rng = Rng::derive(seed, start_day, Domain::WeatherCells, u64::from(region.0), 1 + k as u64);
        // 中心：海区外接矩形里抽，优先落在本海区的海格上（最多试 16 次，都不行就用第一次的点）
        let mut first = None;
        let mut spot = None;
        for _ in 0..16 {
            let x = rng.range(i64::from(x0), x_end);
            let y = rng.range(i64::from(y0), i64::from(y1));
            let fx = rng.below(256) as i64;
            let fy = rng.below(256) as i64;
            let Some(c) = topology.normalize(x, y) else { continue };
            let p = SubCell { x: i64::from(c.x) * 256 + fx, y: i64::from(c.y) * 256 + fy };
            first.get_or_insert(p);
            if defs.map.is_sea(c) && defs.map.region_of(c) == Some(region) {
                spot = Some(p);
                break;
            }
        }
        let Some(mut center) = spot.or(first) else { continue };
        let r = rng.range(radius[0], radius[1].max(radius[0])) * 256 + rng.below(256) as i64 - 128;
        let speed = rng.range(rules.drift[0], rules.drift[1].max(rules.drift[0])) * 256 + rng.below(256) as i64 - 128;
        let speed = speed.max(0);
        // 从段落第一天起逐日顺风移动到今天
        let mut dir = today.sea.wind_dir;
        for d in start..i64::from(day) {
            let d = d as u32;
            let wind = day_weather_spell(defs, seed, region, d, storm_mult).map_or(dir, |(w, _)| w.sea.wind_dir);
            dir = wind;
            let [vx, vy] = dir_vector(wind);
            center.x += speed * vx / Fx::SCALE;
            center.y += speed * vy / Fx::SCALE;
        }
        dir = today.sea.wind_dir;
        // 团心不出本海区的外接矩形（漂到边上就贴着边走）：查询时只需看外接矩形外扩一个半径的海区
        center = clamp_to_rect(defs, def.rect, center);
        let storm_hit_e8 = if kind == CellKind::Storm {
            mul_div(today.storm_hit_e8, rules.storm_hit_pct.max(0), 100).min(E8)
        } else {
            0
        };
        out.push(WeatherCell {
            region,
            index: k as u8,
            kind,
            center,
            radius: r.max(64),
            dir,
            speed,
            storm_hit_e8,
            start: start_day,
            end: end.clamp(0, i64::from(u32::MAX)) as u32,
        });
    }
    out
}

/// 把一点夹进海区外接矩形（含端点格；环绕图上 x0 > x1 表示跨接缝）。
fn clamp_to_rect(defs: &StaticData, rect: (u16, u16, u16, u16), p: SubCell) -> SubCell {
    let (x0, y0, x1, y1) = rect;
    let y = p.y.clamp(i64::from(y0) * 256, i64::from(y1) * 256 + 255);
    let width = i64::from(defs.map.width) * 256;
    let (lo, hi) = (i64::from(x0) * 256, i64::from(x1) * 256 + 255);
    let x = if defs.map.wrap_x && width > 0 {
        let x = p.x.rem_euclid(width);
        if x0 <= x1 {
            if x >= lo && x <= hi {
                x
            } else if sub_dx(defs, x, lo).abs() <= sub_dx(defs, x, hi).abs() {
                lo
            } else {
                hi
            }
        } else {
            // 跨接缝：[lo, 图宽) ∪ [0, hi]
            let ux = if x < lo { x + width } else { x };
            ux.clamp(lo, hi + width).rem_euclid(width)
        }
    } else {
        p.x.clamp(lo, hi)
    };
    SubCell { x, y }
}

/// 点 `pos` 是否落在团内。
pub fn contains(defs: &StaticData, cell: &WeatherCell, pos: SubCell) -> bool {
    sub_distance2(defs, cell.center, pos) <= cell.radius * cell.radius
}

/// 团的优先级：风暴 > 飑 > 雾（重叠时取更凶的）。
fn rank(kind: CellKind) -> u8 {
    match kind {
        CellKind::Storm => 0,
        CellKind::Squall => 1,
        CellKind::Fog => 2,
    }
}

/// 位置天况：`base` 是该点所属海区当天的天气，`cells` 是附近的天气团。
pub fn position_weather(
    defs: &StaticData,
    base: DayWeather,
    cells: &[WeatherCell],
    pos: SubCell,
) -> (DayWeather, Option<CellKind>) {
    let inside = cells
        .iter()
        .filter(|c| contains(defs, c, pos))
        .min_by_key(|c| (rank(c.kind), sub_distance2(defs, c.center, pos), c.region, c.index));
    let mut w = base;
    match inside {
        Some(c) => {
            match c.kind {
                CellKind::Storm => {
                    w.sky = Sky::Storm;
                    w.storm_hit_e8 = c.storm_hit_e8;
                }
                CellKind::Fog => {
                    w.sky = Sky::Fog;
                    w.storm_hit_e8 = 0;
                }
                CellKind::Squall => {
                    w.sky = if snowy(defs, base.region, base.day) { Sky::Snow } else { Sky::Rain };
                    w.sea.wind_strength = (w.sea.wind_strength + defs.rules.weather_cells.squall_wind).clamp(0, 10);
                    w.storm_hit_e8 = 0;
                }
            }
            (w, Some(c.kind))
        }
        None => {
            w.sky = downgrade(defs, base.region, base.day, base.sky);
            w.storm_hit_e8 = 0;
            (w, None)
        }
    }
}

/// 一格周围 `margin` 格内是否可能有某海区的团：海区外接矩形向外扩 `margin` 格后是否含这一格。
pub(crate) fn region_near(defs: &StaticData, region: RegionId, cell: Cell, margin: i64) -> bool {
    let Some(r) = defs.regions.get(region.idx()) else { return false };
    let (x0, y0, x1, y1) = r.rect;
    let y = i64::from(cell.y);
    if y < i64::from(y0) - margin || y > i64::from(y1) + margin {
        return false;
    }
    let x = i64::from(cell.x);
    let width = i64::from(defs.map.width);
    let inside =
        if x0 <= x1 { x >= i64::from(x0) && x <= i64::from(x1) } else { x >= i64::from(x0) || x <= i64::from(x1) };
    if inside {
        return true;
    }
    let dist = |a: i64| {
        let d = (a - x).abs();
        if defs.map.wrap_x && width > 0 { d.min(width - d) } else { d }
    };
    dist(i64::from(x0)).min(dist(i64::from(x1))) <= margin
}

/// 团能伸出本海区外接矩形的最远格数：团心不出外接矩形，所以是最大半径 + 1。
pub(crate) fn reach(defs: &StaticData) -> i64 {
    let r = &defs.rules.weather_cells;
    r.radius[1].max(r.squall_radius[1]) + 1
}

#[cfg(test)]
#[path = "weather_cells_tests.rs"]
mod tests;
