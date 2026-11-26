//! 每日天气（EXPANSION §9.1）：纯函数，没有新增状态，不写进存档。
//!
//! 某海区某天的天气只由（世界种子、天数、海区序号）与当天生效的事件修正（`region_storm`）决定，
//! 随时可由种子与日期重算，所以读档、重放与预报天然一致。全部用整数与 [`Fx`] 计算，不依赖任何映射的迭代顺序。
//!
//! - **风**：每 3 天一个锚点（锚点日是 3 的倍数）。锚点风向 = 盛行风 + 偏移（−2..+2 格，偏移 0 最常见），
//!   锚点之间逐日过渡，**一天最多转 1 格（45°）**。换季时盛行风每个锚点最多转 1 格，逐步转到新季节的方向；
//!   相邻锚点的偏移之差受限（盛行风正在转向的锚点限制更严），因此相邻两天的风向最多差 1 格。
//!   风力锚点 = 季节风力 + 偏移（−3..+3，权重左右对称），夹在 0..10，逐日线性过渡，长期平均等于季节风力。
//! - **天况**：以“天气系统”成段出现。时间按 `system_days` 天分槽，每槽里恰有一个随机的换段日，
//!   所以每段长 1 到 2 × system_days − 1 天、平均 system_days 天。每段按季节与气候的权重抽一种系统：
//!   晴、多云、雨、雾，或暴风雨系统（前 1–3 天暴风雨，随后一天下雨，其余多云；暴风雨从不延续到下一段，
//!   所以连续的暴风雨最多 3 天）。寒冷海区冬季的雨改为雪。
//! - **暴风雨与受损**：暴风雨天数占比 ≈ 海区风暴概率 × 事件修正 × 气候系数 ÷ 受损基准概率（有上限）；
//!   暴风雨当天海上舰队的受损概率 = 海区风暴概率 × 事件修正 ÷ 实际的暴风雨天数占比，
//!   所以长期平均的“每舰队每天受损概率”仍等于 `storm_bp × 事件修正`，而修正越大，海图与预报上的暴风雨越多。
//!
//! 航线规划与预计航程仍按季节盛行风（气候平均）计算，见 [`crate::nav`]。

use crate::calendar::{Calendar, Season};
use crate::defs::{RegionDef, SeasonWeather, StaticData};
use crate::fixed::{Fx, mul_div, mul_div_floor};
use crate::ids::{Cell, RegionId};
use crate::rng::{Domain, Rng};
use crate::world::World;
use serde::{Deserialize, Serialize};

/// 风向锚点的间隔（天）。
pub const WIND_ANCHOR_DAYS: u32 = 3;
/// 每隔多少个风向锚点强制取偏移 0（保证回溯有界：计算某个锚点最多回看这么多个锚点）。
const WIND_RESET_ANCHORS: u32 = 8;
/// 亿分之一：暴风雨频率与受损概率的精度。
pub const E8: i64 = 100_000_000;
/// 随机数子键：风向与风力锚点。
const K_WIND: u64 = 1;
/// 随机数子键：天气系统（换段日与系统种类）。
const K_SKY: u64 = 2;

/// 天况。serde 使用小写名（clear / cloudy / rain / fog / storm / snow），与前端 `SkyKind` 一致。
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Sky {
    /// 晴
    Clear,
    /// 多云
    Cloudy,
    /// 雨
    Rain,
    /// 雾
    Fog,
    /// 暴风雨
    Storm,
    /// 雪（只出现在寒冷海区的冬季）
    Snow,
}

impl Sky {
    pub const ALL: [Sky; 6] = [Sky::Clear, Sky::Cloudy, Sky::Rain, Sky::Fog, Sky::Storm, Sky::Snow];

    /// 小写名（与 serde 一致）。
    pub fn key(self) -> &'static str {
        match self {
            Sky::Clear => "clear",
            Sky::Cloudy => "cloudy",
            Sky::Rain => "rain",
            Sky::Fog => "fog",
            Sky::Storm => "storm",
            Sky::Snow => "snow",
        }
    }

    /// 按小写名解析（数据文件用）。
    pub fn from_key(s: &str) -> Option<Sky> {
        Sky::ALL.into_iter().find(|k| k.key() == s)
    }

    /// 中文名（日志与命令行摘要用；界面有自己的字符串表）。
    pub fn name(self) -> &'static str {
        match self {
            Sky::Clear => "晴",
            Sky::Cloudy => "多云",
            Sky::Rain => "雨",
            Sky::Fog => "雾",
            Sky::Storm => "暴风雨",
            Sky::Snow => "雪",
        }
    }

    /// 航速系数：雾天 ×0.9，暴风雨 ×0.8，其余不变。
    pub fn speed_mult(self) -> Fx {
        match self {
            Sky::Fog => Fx::from_pct(90),
            Sky::Storm => Fx::from_pct(80),
            _ => Fx::ONE,
        }
    }
}

/// 海区气候（`regions.toml` 的可选字段 `climate`，缺省按纬度推断）。只允许追加。
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Climate {
    /// 温和
    Temperate,
    /// 寒冷：冬季的降水为雪
    Cold,
    /// 干燥：少雨少雾
    Arid,
    /// 热带：夏秋多暴风雨
    Tropical,
}

impl Climate {
    pub const ALL: [Climate; 4] = [Climate::Temperate, Climate::Cold, Climate::Arid, Climate::Tropical];

    pub const fn index(self) -> usize {
        match self {
            Climate::Temperate => 0,
            Climate::Cold => 1,
            Climate::Arid => 2,
            Climate::Tropical => 3,
        }
    }

    /// 数据文件中的写法。
    pub fn key(self) -> &'static str {
        match self {
            Climate::Temperate => "temperate",
            Climate::Cold => "cold",
            Climate::Arid => "arid",
            Climate::Tropical => "tropical",
        }
    }

    pub fn from_key(s: &str) -> Option<Climate> {
        Climate::ALL.into_iter().find(|c| c.key() == s)
    }

    pub fn name(self) -> &'static str {
        match self {
            Climate::Temperate => "温和",
            Climate::Cold => "寒冷",
            Climate::Arid => "干燥",
            Climate::Tropical => "热带",
        }
    }
}

/// 一种气候的天况频率（`rules.toml [weather.<气候>]`）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ClimateWeather {
    /// 四季（春夏秋冬）非暴风雨天气系统的权重：[晴, 多云, 雨, 雾]
    pub skies: [[i64; 4]; 4],
    /// 四季的暴风雨频率系数（乘在“海区风暴概率 ÷ 受损基准概率”上）
    pub storm: [Fx; 4],
}

/// 天气规则（`rules.toml [weather]`）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WeatherRules {
    /// 天气系统的平均长度（天，2–10）
    pub system_days: u32,
    /// 风向锚点偏移 −2..+2 格的权重
    pub wind_dir_weights: [i64; 5],
    /// 风力锚点偏移 −3..+3 级的权重（左右对称，长期平均才等于季节风力）
    pub wind_strength_weights: [i64; 7],
    /// 暴风雨当天海上每支舰队受损的基准概率（万分比）
    pub storm_hit_bp: i64,
    /// 暴风雨天数占比的上限（万分比）
    pub storm_max_bp: i64,
    /// 各气候的天况频率（按 [`Climate::index`] 排列）
    pub climates: [ClimateWeather; 4],
}

impl Default for WeatherRules {
    /// 与 `data/rules.toml [weather]` 的初始值一致。
    fn default() -> Self {
        let fx = |v: [i64; 4]| v.map(Fx::from_pct);
        WeatherRules {
            system_days: 4,
            wind_dir_weights: [1, 2, 4, 2, 1],
            wind_strength_weights: [1, 2, 3, 4, 3, 2, 1],
            storm_hit_bp: 1_000,
            storm_max_bp: 3_000,
            climates: [
                ClimateWeather {
                    skies: [[45, 30, 17, 8], [55, 25, 12, 8], [40, 30, 20, 10], [35, 35, 20, 10]],
                    storm: fx([100, 100, 100, 100]),
                },
                ClimateWeather {
                    skies: [[35, 35, 20, 10], [45, 30, 15, 10], [30, 35, 25, 10], [25, 35, 30, 10]],
                    storm: fx([100, 100, 100, 100]),
                },
                ClimateWeather {
                    skies: [[70, 20, 5, 5], [80, 15, 2, 3], [70, 20, 6, 4], [60, 25, 10, 5]],
                    storm: fx([70, 70, 70, 70]),
                },
                ClimateWeather {
                    skies: [[50, 25, 20, 5], [40, 25, 30, 5], [40, 25, 30, 5], [55, 25, 15, 5]],
                    storm: fx([100, 150, 150, 100]),
                },
            ],
        }
    }
}

impl WeatherRules {
    pub fn climate(&self, c: Climate) -> &ClimateWeather {
        &self.climates[c.index()]
    }
}

/// 某海区某一天的天气。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DayWeather {
    pub region: RegionId,
    pub day: u32,
    pub sky: Sky,
    /// 当天的风与洋流：风向、风力是当天的值，洋流与风暴、海盗概率沿用季节气候；可直接传给航速公式
    pub sea: SeasonWeather,
    /// 暴风雨当天海上每支舰队受损的概率（亿分比）；其余天况为 0
    pub storm_hit_e8: i64,
}

impl DayWeather {
    /// 风的去向（0 = 北，顺时针 8 方向）。
    pub fn wind_dir(&self) -> u8 {
        self.sea.wind_dir
    }

    /// 风力 0–10。
    pub fn wind_strength(&self) -> i64 {
        self.sea.wind_strength
    }

    /// 天况带来的航速系数（雾 ×0.9，暴风雨 ×0.8）。
    pub fn speed_mult(&self) -> Fx {
        self.sky.speed_mult()
    }
}

/// 计算某海区某天的天气（纯函数）。`storm_mult` 是当天生效的事件风暴修正（`region_storm`）。
/// 海区不存在时返回 None。
pub fn day_weather(defs: &StaticData, seed: u64, region: RegionId, day: u32, storm_mult: Fx) -> Option<DayWeather> {
    day_weather_spell(defs, seed, region, day, storm_mult).map(|(w, _)| w)
}

/// 天气系统的一段（H03 天气团用）：从 `start` 天起到 `end` 天前；`storm_days` 为段首暴风雨的天数（不是暴风雨系统为 0）。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Spell {
    pub start: i64,
    pub end: i64,
    pub storm_days: i64,
}

/// 同 [`day_weather`]，另给出当天所在的天气系统段落（天气团按段生成）。
pub fn day_weather_spell(
    defs: &StaticData,
    seed: u64,
    region: RegionId,
    day: u32,
    storm_mult: Fx,
) -> Option<(DayWeather, Spell)> {
    let r = defs.regions.get(region.idx())?;
    if let Some(nav) = defs.nav.grid.rules()
        && nav.regions.get(region.idx()).is_some_and(|r| !r.weather.is_empty() || r.south)
    {
        let sea = nav.weather(&defs.regions, region, nav.period_on(day))?;
        let season = nav.season_on(region, day);
        let mut local = r.clone();
        local.seasons = [sea; 4];
        let mut rules = defs.rules.weather.clone();
        for c in &mut rules.climates {
            c.skies = [c.skies[season.index()]; 4];
            c.storm = [c.storm[season.index()]; 4];
        }
        // 风的随机域仍按绝对日期取值；气候平均由本世界的月份和半球选择。
        let (wind_dir, wind_strength) = wind_on(&defs.calendar, &rules, &local, seed, region, day);
        let (sky, storm_hit_e8, spell) = sky_on(&defs.calendar, &rules, &local, seed, region, day, storm_mult);
        let sky = match sky {
            Sky::Rain | Sky::Snow if r.climate == Climate::Cold => {
                if season == Season::Winter {
                    Sky::Snow
                } else {
                    Sky::Rain
                }
            }
            sky => sky,
        };
        return Some((
            DayWeather { region, day, sky, sea: SeasonWeather { wind_dir, wind_strength, ..sea }, storm_hit_e8 },
            spell,
        ));
    }
    let rules = &defs.rules.weather;
    let season = defs.calendar.season_of(day).index();
    let (wind_dir, wind_strength) = wind_on(&defs.calendar, rules, r, seed, region, day);
    let (sky, storm_hit_e8, spell) = sky_on(&defs.calendar, rules, r, seed, region, day, storm_mult);
    let sea = SeasonWeather { wind_dir, wind_strength, ..r.seasons[season] };
    Some((DayWeather { region, day, sky, sea, storm_hit_e8 }, spell))
}

// ── 风 ──────────────────────────────────────────────────────────────

/// 一个风向锚点的随机抽取：风向偏移（−2..+2，重置锚点为 0）与风力偏移（−3..+3）。
#[derive(Clone, Copy)]
struct WindDraw {
    dir: i64,
    strength: i64,
}

fn wind_draw(rules: &WeatherRules, seed: u64, region: RegionId, anchor: u32) -> WindDraw {
    let day = anchor.wrapping_mul(WIND_ANCHOR_DAYS);
    let mut rng = Rng::derive(seed, day, Domain::Weather, region.0 as u64, K_WIND);
    let dir = rng.weighted(&rules.wind_dir_weights).unwrap_or(2) as i64 - 2;
    let strength = rng.weighted(&rules.wind_strength_weights).unwrap_or(3) as i64 - 3;
    WindDraw { dir: if anchor.is_multiple_of(WIND_RESET_ANCHORS) { 0 } else { dir }, strength }
}

/// 从 a 转到 b 的带符号格数（−3..+4，取较短的一侧；恰好相反时记为 +4）。
fn rotation(a: u8, b: u8) -> i64 {
    let d = (b as i64 - a as i64).rem_euclid(8);
    if d > 4 { d - 8 } else { d }
}

/// 锚点的有效盛行风：换季后每个锚点最多转 1 格（新季节的第一个锚点就转 1 格），逐步转到新季节的盛行风；
/// 恰好反向（转 4 格）时顺时针转。转向最多用 4 个锚点（12 天）；极短季节可能还没转完就再次换季。
fn prevailing(calendar: &Calendar, r: &RegionDef, anchor: u32) -> u8 {
    let day = anchor.wrapping_mul(WIND_ANCHOR_DAYS);
    let season = calendar.season_of(day).index();
    let (elapsed, previous) = calendar.season_elapsed(day);
    let from = r.seasons[previous.index()].wind_dir;
    let to = r.seasons[season].wind_dir;
    let since = (elapsed / WIND_ANCHOR_DAYS) as i64;
    let turn = rotation(from, to);
    let steps = (since + 1).min(turn.abs());
    (from as i64 + turn.signum() * steps).rem_euclid(8) as u8
}

/// 锚点 a 的偏移上限：相邻锚点的偏移之差不超过它；盛行风正在转向的锚点少 1 格，
/// 季节足以完成转向时，使锚点间的总风向差不超过 3 格、逐日最多转 1 格。
/// 极短季节可能让盛行风锚点反向，此时固定随机偏移，防止出现负宽度的夹取范围。
fn offset_width(calendar: &Calendar, r: &RegionDef, anchor: u32) -> i64 {
    if anchor == 0 {
        return 3;
    }
    (3 - rotation(prevailing(calendar, r, anchor - 1), prevailing(calendar, r, anchor)).abs()).max(0)
}

/// 锚点 a 的风向偏移（−2..+2）以及 a 与 a+1 两个锚点的抽取。
///
/// 偏移由抽取值夹到“上一锚点偏移 ± 上限”之内；当抽取值无论上一锚点如何都在范围内（|抽取| + 2 ≤ 上限）时，
/// 偏移就等于抽取值，回溯到此为止。每 8 个锚点的抽取固定为 0，所以最多回看 8 个锚点。
fn wind_offsets(
    calendar: &Calendar,
    rules: &WeatherRules,
    r: &RegionDef,
    seed: u64,
    region: RegionId,
    anchor: u32,
) -> [(i64, WindDraw); 2] {
    let mut chain: Vec<(i64, i64)> = Vec::new();
    let mut i = anchor;
    let first = wind_draw(rules, seed, region, anchor);
    loop {
        let raw = if i == anchor { first.dir } else { wind_draw(rules, seed, region, i).dir };
        let width = offset_width(calendar, r, i);
        chain.push((raw, width));
        if raw.abs() + 2 <= width || i.is_multiple_of(WIND_RESET_ANCHORS) {
            break;
        }
        i -= 1;
    }
    let mut off = 0;
    for (k, (raw, width)) in chain.iter().rev().enumerate() {
        off = if k == 0 { *raw } else { (*raw).clamp(off - width, off + width) };
    }
    let next = wind_draw(rules, seed, region, anchor.wrapping_add(1));
    let width = offset_width(calendar, r, anchor.wrapping_add(1));
    let next_off = if anchor.wrapping_add(1).is_multiple_of(WIND_RESET_ANCHORS) {
        0
    } else {
        next.dir.clamp(off - width, off + width)
    };
    [(off, first), (next_off, next)]
}

/// 锚点风力：季节风力 + 偏移。偏移按离 0 级与 10 级的距离对称收窄（季节风力 9 级时只在 8–10 级之间变化），
/// 对称的偏移分布经对称收窄后均值仍为 0，所以长期平均恰好等于季节风力。
fn anchor_strength(calendar: &Calendar, r: &RegionDef, anchor: u32, off: i64) -> i64 {
    let season = calendar.season_of(anchor.wrapping_mul(WIND_ANCHOR_DAYS)).index();
    let base = r.seasons[season].wind_strength.clamp(0, 10);
    let room = base.min(10 - base).min(3);
    base + off.clamp(-room, room)
}

/// 当天的风向与风力。
fn wind_on(
    calendar: &Calendar,
    rules: &WeatherRules,
    r: &RegionDef,
    seed: u64,
    region: RegionId,
    day: u32,
) -> (u8, i64) {
    let a = day / WIND_ANCHOR_DAYS;
    let t = (day % WIND_ANCHOR_DAYS) as i64;
    let span = WIND_ANCHOR_DAYS as i64;
    let [(off_a, draw_a), (off_b, draw_b)] = wind_offsets(calendar, rules, r, seed, region, a);
    let (pa, pb) = (prevailing(calendar, r, a), prevailing(calendar, r, a.wrapping_add(1)));
    // 两个锚点之间的风向差，逐日按比例过渡；极短季节的盛行风转向可达 4 格。
    let delta = rotation(pa, pb) + off_b - off_a;
    let dir = (pa as i64 + off_a + mul_div(delta, t, span)).rem_euclid(8) as u8;
    let sa = anchor_strength(calendar, r, a, draw_a.strength);
    let sb = anchor_strength(calendar, r, a.wrapping_add(1), draw_b.strength);
    let strength = (sa + mul_div(sb - sa, t, span)).clamp(0, 10);
    (dir, strength)
}

// ── 天况 ────────────────────────────────────────────────────────────

/// 一个天气槽的随机抽取：换段日（槽内偏移）、系统种类的两个均匀数、暴风雨持续天数。
#[derive(Clone, Copy)]
struct SkyDraw {
    offset: i64,
    storm_u: i64,
    kind_u: i64,
    storm_days: i64,
}

fn sky_draw(seed: u64, region: RegionId, slot: i64, g: i64) -> SkyDraw {
    let day = (slot * g).clamp(0, u32::MAX as i64) as u32;
    let mut rng = Rng::derive(seed, day, Domain::Weather, region.0 as u64, K_SKY);
    let offset = rng.below(g as u64) as i64;
    let storm_u = rng.below(E8 as u64) as i64;
    let kind_u = rng.below(E8 as u64) as i64;
    let storm_days = rng.range(1, 3);
    SkyDraw { offset, storm_u, kind_u, storm_days }
}

/// 暴风雨系统的几何：一段中暴风雨天数 = min(持续天数, 段长 − 1)，段长 = g + 下一槽偏移 − 本槽偏移。
/// 返回（全部组合的暴风雨天数之和, 组合数 × g），两者之比即“每抽到一次暴风雨系统，平均每天是暴风雨的比例”。
pub fn storm_geometry(system_days: u32) -> (i64, i64) {
    let g = system_days.max(2) as i64;
    let mut sum = 0;
    for o1 in 0..g {
        for o2 in 0..g {
            let len = g + o2 - o1;
            for k in 1..=3 {
                sum += k.min(len - 1);
            }
        }
    }
    (sum, 3 * g * g * g)
}

/// 某海区某季的暴风雨参数：（暴风雨系统的抽中概率, 暴风雨当天的受损概率），均为亿分比。
///
/// 目标“每日受损概率” = storm_bp × 事件修正；暴风雨天数占比 = 目标 × 气候系数 ÷ 受损基准概率（封顶），
/// 受损概率 = 目标 ÷ 实际占比。两者相乘恰为目标（受损概率封顶 100% 时除外）。
pub fn storm_params(rules: &WeatherRules, r: &RegionDef, season: usize, storm_mult: Fx) -> (i64, i64) {
    let season = season % 4;
    let target = r.seasons[season].storm_bp.max(0) * storm_mult.raw().max(0);
    if target == 0 {
        return (0, 0);
    }
    let factor = rules.climate(r.climate).storm[season].raw().max(0);
    let freq = mul_div(target, factor, rules.storm_hit_bp.max(1)).min(rules.storm_max_bp.max(0) * 10_000);
    let (num, den) = storm_geometry(rules.system_days);
    let pick = mul_div(freq, den, num).clamp(0, E8);
    let actual = mul_div(pick, num, den);
    if actual <= 0 {
        return (0, 0);
    }
    (pick, mul_div(target, E8, actual).min(E8))
}

/// 当天的天况与暴风雨受损概率。
fn sky_on(
    calendar: &Calendar,
    rules: &WeatherRules,
    r: &RegionDef,
    seed: u64,
    region: RegionId,
    day: u32,
    storm_mult: Fx,
) -> (Sky, i64, Spell) {
    let g = rules.system_days.max(2) as i64;
    let d = day as i64;
    // 槽 j 覆盖 [(j − 1)·g, j·g)；段 j 从槽 j 的换段日开始，到槽 j + 1 的换段日结束
    let j = d / g + 1;
    let this = sky_draw(seed, region, j, g);
    let this_start = (j - 1) * g + this.offset;
    let (draw, start, end) = if d >= this_start {
        let next = sky_draw(seed, region, j + 1, g);
        (this, this_start, j * g + next.offset)
    } else {
        let prev = sky_draw(seed, region, j - 1, g);
        (prev, (j - 2) * g + prev.offset, this_start)
    };
    let len = end - start;
    let pos = d - start;
    // 天气系统的种类按它开始那天的季节抽取
    let season = calendar.season_of(start.max(0) as u32).index();
    let (storm_pick, storm_hit) = storm_params(rules, r, season, storm_mult);
    let mut spell = Spell { start, end, storm_days: 0 };
    let sky = if draw.storm_u < storm_pick {
        let storm_days = draw.storm_days.min(len - 1);
        spell.storm_days = storm_days;
        if pos < storm_days {
            Sky::Storm
        } else if pos == storm_days {
            Sky::Rain
        } else {
            Sky::Cloudy
        }
    } else {
        let weights = &rules.climate(r.climate).skies[season];
        let total: i64 = weights.iter().map(|w| (*w).max(0)).sum();
        // 向下取整：kind_u ∈ [0, 1e8) 恰好均匀地映射到 [0, total)
        let mut pick = mul_div_floor(draw.kind_u, total, E8);
        let mut kind = Sky::Clear;
        for (w, s) in weights.iter().zip([Sky::Clear, Sky::Cloudy, Sky::Rain, Sky::Fog]) {
            let w = (*w).max(0);
            if pick < w {
                kind = s;
                break;
            }
            pick -= w;
        }
        kind
    };
    // 寒冷海区冬季的降水是雪（按当天的季节判断，雪只会出现在冬季）
    let sky = if sky == Sky::Rain && r.climate == Climate::Cold && calendar.season_of(day) == Season::Winter {
        Sky::Snow
    } else {
        sky
    };
    (sky, if sky == Sky::Storm { storm_hit } else { 0 }, spell)
}

// ── 世界接口 ────────────────────────────────────────────────────────

impl World {
    /// 某海区某天的天气（预报用）：按当前生效的事件修正计算，海区不存在时返回 None。
    pub fn weather_on(&self, region: RegionId, day: u32) -> Option<DayWeather> {
        day_weather(&self.defs, self.state.seed, region, day, self.storm_mult(region))
    }

    /// 某海区今天的天气。
    pub fn weather_today(&self, region: RegionId) -> Option<DayWeather> {
        self.weather_on(region, self.state.day)
    }

    /// 某格今天的天气；陆地、越界或不属于任何海区时返回 None。
    pub fn weather_at(&self, cell: Cell) -> Option<DayWeather> {
        let map = &self.defs.map;
        if !map.in_bounds(cell.x as i32, cell.y as i32) {
            return None;
        }
        map.region_of(cell).and_then(|r| self.weather_today(r))
    }

    /// H03：某格今天的**位置天况**（玩家舰队用）：天气团开着时在团内取团的种类、团外降一级；
    /// 关着时与 [`World::weather_at`] 相同。
    pub fn weather_at_pos(&self, cell: Cell) -> Option<DayWeather> {
        if !self.defs.rules.weather_cells.enabled {
            return self.weather_at(cell);
        }
        DayTable::new(self).at_pos(&self.defs, cell)
    }

    /// H03：今天离某格 `range` 格以内（团的边缘算起）的天气团，按（海区, 序号）排列。开关关着时为空。
    pub fn weather_cells_near(&self, cell: Cell, range: i64) -> Vec<crate::weather_cells::WeatherCell> {
        DayTable::new(self).cells_near(&self.defs, cell, range)
    }
}

/// 一天之内反复查询的天气表：按海区惰性计算并缓存（tick 内部使用，查询结果与 [`World::weather_today`] 相同）。
pub(crate) struct DayTable {
    seed: u64,
    day: u32,
    storm: Vec<Fx>,
    cache: Vec<Option<Option<DayWeather>>>,
    /// H03：各海区今天的天气团（惰性计算）
    cells: Vec<Option<Vec<crate::weather_cells::WeatherCell>>>,
    /// H03：各格今天的位置天况（惰性计算）
    points: std::collections::BTreeMap<Cell, Option<DayWeather>>,
}

impl DayTable {
    pub(crate) fn new(world: &World) -> DayTable {
        let n = world.defs.regions.len();
        DayTable {
            seed: world.state.seed,
            day: world.state.day,
            storm: (0..n).map(|i| world.storm_mult(RegionId::from_idx(i))).collect(),
            cache: vec![None; n],
            cells: vec![None; n],
            points: std::collections::BTreeMap::new(),
        }
    }

    /// H03：某海区今天的天气团（缓存）。
    pub(crate) fn region_cells(&mut self, defs: &StaticData, region: RegionId) -> &[crate::weather_cells::WeatherCell] {
        let m = self.storm.get(region.idx()).copied().unwrap_or(Fx::ONE);
        let (seed, day) = (self.seed, self.day);
        match self.cells.get_mut(region.idx()) {
            Some(slot) => slot.get_or_insert_with(|| crate::weather_cells::cells_of(defs, seed, region, day, m)),
            None => &[],
        }
    }

    /// H03：今天可能盖到某格的天气团（外接矩形外扩一个最大半径的海区里的团）。
    fn cells_around(&mut self, defs: &StaticData, cell: Cell, margin: i64) -> Vec<crate::weather_cells::WeatherCell> {
        let mut out = Vec::new();
        for i in 0..defs.regions.len() {
            let r = RegionId::from_idx(i);
            if crate::weather_cells::region_near(defs, r, cell, margin) {
                out.extend_from_slice(self.region_cells(defs, r));
            }
        }
        out
    }

    /// H03：今天离某格 `range` 格以内（从团的边缘算）的天气团。
    pub(crate) fn cells_near(
        &mut self,
        defs: &StaticData,
        cell: Cell,
        range: i64,
    ) -> Vec<crate::weather_cells::WeatherCell> {
        if !defs.rules.weather_cells.enabled {
            return Vec::new();
        }
        let margin = crate::weather_cells::reach(defs) + range.max(0);
        let at = crate::navigation::SubCell::center(cell);
        let mut out = self.cells_around(defs, cell, margin);
        out.retain(|c| {
            let reach = c.radius + range.max(0) * 256;
            crate::weather_cells::sub_distance2(defs, c.center, at) <= reach * reach
        });
        out
    }

    /// H03：某格今天的位置天况（开关关着时与 [`DayTable::at`] 相同）。
    pub(crate) fn at_pos(&mut self, defs: &StaticData, cell: Cell) -> Option<DayWeather> {
        if !defs.rules.weather_cells.enabled {
            return self.at(defs, cell);
        }
        if let Some(w) = self.points.get(&cell) {
            return *w;
        }
        let w = self.at(defs, cell).map(|base| {
            let margin = crate::weather_cells::reach(defs);
            let cells = self.cells_around(defs, cell, margin);
            crate::weather_cells::position_weather(defs, base, &cells, crate::navigation::SubCell::center(cell)).0
        });
        self.points.insert(cell, w);
        w
    }

    /// 某海区今天的天气。
    pub(crate) fn get(&mut self, defs: &StaticData, region: RegionId) -> Option<DayWeather> {
        let slot = self.cache.get_mut(region.idx())?;
        if let Some(w) = slot {
            return *w;
        }
        let m = self.storm.get(region.idx()).copied().unwrap_or(Fx::ONE);
        let w = day_weather(defs, self.seed, region, self.day, m);
        *slot = Some(w);
        w
    }

    /// 某格今天的天气。
    pub(crate) fn at(&mut self, defs: &StaticData, cell: Cell) -> Option<DayWeather> {
        if !defs.map.in_bounds(cell.x as i32, cell.y as i32) {
            return None;
        }
        defs.map.region_of(cell).and_then(|r| self.get(defs, r))
    }
}

impl DayTable {
    /// H10b：指定日子的确定性天气；事件的风暴倍数沿用当前状态。
    pub(crate) fn on(world: &World, day: u32) -> Self {
        let mut table = Self::new(world);
        table.day = day;
        table
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::calendar::{DAYS_PER_YEAR, season_of};
    const SEASON_DAYS: u32 = 90;
    use crate::defs::EffectKind;
    use crate::events::{ActiveEvent, EventOrigin, EventParams};
    use crate::ids::{EventTypeId, FleetId, LocId, OwnerId, ScenarioId};
    use crate::nav::{angle_diff, dir_between, step_len};
    use crate::testkit::tiny_defs;
    use crate::world::{FleetLocation, Voyage};
    use std::sync::Arc;

    #[test]
    fn short_seasons_keep_wind_offset_ranges_valid() {
        let mut defs = (*tiny_defs()).clone();
        defs.calendar = Calendar::new(vec![1; 4], vec![0, 1, 2, 3], "短季节".into(), vec![]).unwrap();
        for (i, season) in defs.regions[0].seasons.iter_mut().enumerate() {
            season.wind_dir = if i % 2 == 0 { 0 } else { 4 };
        }
        for day in (0..32).chain([u32::MAX]) {
            let weather = day_weather(&defs, 42, RegionId(0), day, Fx::ONE).unwrap();
            assert!(weather.sea.wind_dir < 8);
            assert!((0..=10).contains(&weather.sea.wind_strength));
            assert_eq!(Some(weather), day_weather(&defs, 42, RegionId(0), day, Fx::ONE));
        }
    }

    /// 统计用的天数（10 年）。
    const DAYS: u32 = 3_600;

    fn season(wind_dir: u8, wind_strength: i64, storm_bp: i64) -> SeasonWeather {
        SeasonWeather { wind_dir, wind_strength, current_dir: 2, current_strength: 1, storm_bp, pirate_bp: 10 }
    }

    fn region(key: &str, seasons: [SeasonWeather; 4], climate: Climate) -> RegionDef {
        RegionDef { key: key.into(), name: key.into(), rect: (0, 0, 0, 0), seasons, climate }
    }

    /// 小型世界之外再追加一批只用于天气计算的海区（不在地图上）：四种气候、不同的风暴概率与风，
    /// 其中几处换季时盛行风反向或转 90°。
    fn weather_defs() -> Arc<StaticData> {
        let mut d = (*tiny_defs()).clone();
        let extra = [
            region("calm", [season(2, 5, 15); 4], Climate::Temperate),
            region(
                "monsoon",
                [season(1, 4, 25), season(0, 6, 70), season(5, 4, 30), season(4, 5, 25)],
                Climate::Tropical,
            ),
            region("north", [season(2, 5, 20), season(1, 5, 20), season(2, 7, 40), season(6, 8, 90)], Climate::Cold),
            region("desert", [season(6, 5, 15), season(6, 6, 50), season(2, 5, 15), season(6, 5, 15)], Climate::Arid),
            region("reef", [season(6, 6, 30), season(6, 6, 80), season(0, 6, 40), season(4, 5, 30)], Climate::Tropical),
            region(
                "gale",
                [season(3, 9, 60), season(7, 1, 60), season(3, 10, 60), season(7, 0, 60)],
                Climate::Temperate,
            ),
        ];
        d.regions.extend(extra);
        Arc::new(d)
    }

    fn weather_world(seed: u64) -> World {
        World::new(weather_defs(), ScenarioId(0), seed).expect("开局")
    }

    fn regions(w: &World) -> impl Iterator<Item = RegionId> + use<> {
        (0..w.defs.regions.len()).map(RegionId::from_idx)
    }

    fn storm_event(region: RegionId, mult: Fx, id: u32) -> ActiveEvent {
        ActiveEvent {
            id,
            kind: EventTypeId(1),
            params: EventParams { region: Some(region), mult: Some(mult), days: Some(90), ..EventParams::default() },
            start: 0,
            end: u32::MAX,
            effect: Some(EffectKind::RegionStorm),
            origin: EventOrigin::Catalog,
        }
    }

    #[test]
    fn weather_is_deterministic_per_seed_day_and_region() {
        let (a, b, c) = (weather_world(7), weather_world(7), weather_world(8));
        let mut differs = 0;
        for r in regions(&a) {
            for day in (0..720).step_by(7) {
                let wa = a.weather_on(r, day).unwrap();
                assert_eq!(Some(wa), b.weather_on(r, day), "同种子同日同海区的天气必须相同");
                assert_eq!(wa.region, r);
                assert_eq!(wa.day, day);
                let wc = c.weather_on(r, day).unwrap();
                if (wa.sky, wa.wind_dir(), wa.wind_strength()) != (wc.sky, wc.wind_dir(), wc.wind_strength()) {
                    differs += 1;
                }
            }
        }
        assert!(differs > 100, "换种子后天气应明显不同，只有 {differs} 处不同");
        // 今天的天气等于按日期查询的结果；海区不存在、陆地或越界时没有天气
        assert_eq!(a.weather_today(RegionId(0)), a.weather_on(RegionId(0), a.day()));
        assert_eq!(a.weather_on(RegionId(999), 3), None);
        assert_eq!(a.weather_at(Cell::new(20, 12)), None, "岛上的陆地格没有天气");
        assert_eq!(a.weather_at(Cell::new(500, 500)), None, "越界的格没有天气");
        assert_eq!(a.weather_at(Cell::new(3, 3)), a.weather_today(RegionId(0)));
        // 洋流与季节概率沿用季节气候
        let w = a.weather_on(RegionId(3), 100).unwrap();
        let s = &a.defs.regions[3].seasons[season_of(100).index()];
        assert_eq!(
            (w.sea.current_dir, w.sea.current_strength, w.sea.storm_bp),
            (s.current_dir, s.current_strength, s.storm_bp)
        );
    }

    #[test]
    fn wind_turns_at_most_one_step_per_day() {
        for seed in [1, 2, 3] {
            let w = weather_world(seed);
            for r in regions(&w) {
                let def = &w.defs.regions[r.idx()];
                let mut prev = w.weather_on(r, 0).unwrap();
                for day in 1..DAYS {
                    let cur = w.weather_on(r, day).unwrap();
                    assert!(
                        angle_diff(prev.wind_dir(), cur.wind_dir()) <= 1,
                        "种子 {seed} 海区 {} 第 {day} 天风向从 {} 变到 {}",
                        def.key,
                        prev.wind_dir(),
                        cur.wind_dir()
                    );
                    assert!((0..=10).contains(&cur.wind_strength()));
                    // 换季 12 天之后、本季最后一个锚点之前（之后开始向下一季过渡），风向离季节盛行风最多 2 格
                    if (12..SEASON_DAYS - WIND_ANCHOR_DAYS).contains(&(day % SEASON_DAYS)) {
                        let p = def.seasons[season_of(day).index()].wind_dir;
                        assert!(
                            angle_diff(cur.wind_dir(), p) <= 2,
                            "海区 {} 第 {day} 天风向偏离盛行风超过 2 格",
                            def.key
                        );
                    }
                    prev = cur;
                }
            }
        }
    }

    #[test]
    fn wind_actually_varies_around_the_prevailing_wind() {
        let w = weather_world(11);
        let r = RegionId::from_idx(2); // calm：四季都是东风 5 级
        let (mut off_dir, mut other_strength) = (0, 0);
        for day in 0..DAYS {
            let x = w.weather_on(r, day).unwrap();
            off_dir += i32::from(x.wind_dir() != 2);
            other_strength += i32::from(x.wind_strength() != 5);
        }
        assert!(off_dir > 360 && off_dir < 2_880, "风向应围绕盛行风变化：偏离的天数 {off_dir}");
        assert!(other_strength > 360, "风力应每天变化：不同于季节风力的天数 {other_strength}");
    }

    #[test]
    fn long_run_wind_strength_equals_season_strength() {
        for seed in [4, 5] {
            let w = weather_world(seed);
            for r in regions(&w) {
                let def = &w.defs.regions[r.idx()];
                let mut sum = [0i64; 4];
                let mut n = [0i64; 4];
                for day in 0..DAYS {
                    let s = season_of(day).index();
                    sum[s] += w.weather_on(r, day).unwrap().wind_strength();
                    n[s] += 1;
                }
                for s in 0..4 {
                    // 平均值 × 10 与季节风力 × 10 相差不超过 5（即 0.5 级）
                    let avg10 = sum[s] * 10 / n[s];
                    let want10 = def.seasons[s].wind_strength * 10;
                    assert!(
                        (avg10 - want10).abs() <= 5,
                        "种子 {seed} 海区 {} 第 {s} 季平均风力 {}（×10）与季节风力 {} 相差超过 0.5 级",
                        def.key,
                        avg10,
                        def.seasons[s].wind_strength
                    );
                }
            }
        }
    }

    #[test]
    fn storm_damage_chance_averages_to_storm_bp() {
        // 多海区 × 3600 天：暴风雨导致的“每舰队每天受损概率”的长期平均 ≈ storm_bp × 事件修正（±20%）
        let mut w = weather_world(21);
        let mut expected: i64 = 0;
        let mut actual: i64 = 0;
        let mut storm_days = 0;
        for mult in [Fx::ONE, Fx::from_pct(250)] {
            w.state.events.active.clear();
            if mult != Fx::ONE {
                for r in 0..w.defs.regions.len() {
                    w.state.events.active.push(storm_event(RegionId::from_idx(r), mult, r as u32));
                }
            }
            w.recompute_modifiers();
            for r in regions(&w) {
                let def = &w.defs.regions[r.idx()];
                let (mut exp_r, mut act_r) = (0i64, 0i64);
                for day in 0..DAYS {
                    let x = w.weather_on(r, day).unwrap();
                    exp_r += def.seasons[season_of(day).index()].storm_bp * mult.raw();
                    act_r += x.storm_hit_e8;
                    if x.sky == Sky::Storm {
                        storm_days += 1;
                        assert!(x.storm_hit_e8 > 0 && x.storm_hit_e8 <= E8);
                    } else {
                        assert_eq!(x.storm_hit_e8, 0, "只有暴风雨天才可能受损");
                    }
                }
                // 单个海区的统计噪声较大，只要求在 ±50% 之内
                assert!(
                    act_r * 2 >= exp_r && act_r * 2 <= exp_r * 3,
                    "海区 {} 修正 {mult:?}：期望 {exp_r}，实际 {act_r}",
                    def.key
                );
                expected += exp_r;
                actual += act_r;
            }
        }
        assert!(storm_days > 500, "统计期内应有足够的暴风雨天：{storm_days}");
        assert!(
            actual * 10 >= expected * 8 && actual * 10 <= expected * 12,
            "长期平均受损概率 {actual} 与 storm_bp × 修正 {expected} 相差超过 20%"
        );
    }

    #[test]
    fn storm_frequency_formula_is_exact_on_average() {
        // 受损概率 × 暴风雨天数占比（解析值）= 目标；受损基准概率 10% 时暴风雨天数约为风暴概率的 10 倍
        let rules = WeatherRules::default();
        let (num, den) = storm_geometry(rules.system_days);
        assert!(num > 0 && num < den);
        let r = region("x", [season(2, 5, 60); 4], Climate::Temperate);
        let (pick, hit) = storm_params(&rules, &r, 0, Fx::ONE);
        let freq = mul_div(pick, num, den);
        let target = 60 * Fx::ONE.raw();
        assert!((mul_div(freq, hit, E8) - target).abs() <= target / 1_000, "受损概率 × 暴风雨占比应等于目标");
        assert!((freq - target * 10).abs() <= target / 100);
        // 事件修正封顶后，改为提高受损概率
        let (pick_max, hit_max) = storm_params(&rules, &r, 0, Fx::from_int(20));
        assert!(pick_max <= E8 && mul_div(pick_max, num, den) <= rules.storm_max_bp * 10_000 + 1);
        assert!(hit_max > hit);
        assert_eq!(storm_params(&rules, &r, 0, Fx::ZERO), (0, 0));
    }

    #[test]
    fn storms_last_one_to_three_days_and_skies_come_in_spells() {
        let w = weather_world(9);
        let (mut runs, mut run_days) = (0, 0);
        for r in regions(&w) {
            let mut storm_run = 0;
            let mut prev: Option<Sky> = None;
            for day in 0..DAYS {
                let sky = w.weather_on(r, day).unwrap().sky;
                if sky == Sky::Storm {
                    storm_run += 1;
                    assert!(storm_run <= 3, "暴风雨最多连续 3 天（海区 {r:?} 第 {day} 天）");
                } else {
                    storm_run = 0;
                }
                if prev != Some(sky) {
                    runs += 1;
                }
                run_days += 1;
                prev = Some(sky);
            }
        }
        // 天况成段出现：平均每段超过 2 天
        assert!(run_days > runs * 2, "天况应成段出现：{run_days} 天共 {runs} 段");
    }

    #[test]
    fn snow_only_falls_in_cold_regions_in_winter() {
        let w = weather_world(13);
        let mut cold_winter_snow = 0;
        let mut counts = [[0i64; 6]; 4];
        for r in regions(&w) {
            let def = &w.defs.regions[r.idx()];
            for day in 0..DAYS {
                let sky = w.weather_on(r, day).unwrap().sky;
                let winter = season_of(day) == Season::Winter;
                counts[def.climate.index()][sky as usize] += 1;
                if sky == Sky::Snow {
                    assert!(def.climate == Climate::Cold && winter, "海区 {} 第 {day} 天不该下雪", def.key);
                    cold_winter_snow += 1;
                }
                if def.climate == Climate::Cold && winter {
                    assert_ne!(sky, Sky::Rain, "寒冷海区冬季的降水应为雪");
                }
            }
        }
        assert!(cold_winter_snow > 30, "寒冷海区的冬季应当下雪：{cold_winter_snow} 天");
        // 干燥海区少雨少雾：雨与雾的天数占比低于温和海区
        let share = |c: Climate, s: Sky| {
            let row = &counts[c.index()];
            row[s as usize] * 1_000 / row.iter().sum::<i64>().max(1)
        };
        assert!(share(Climate::Arid, Sky::Rain) < share(Climate::Temperate, Sky::Rain));
        assert!(share(Climate::Arid, Sky::Fog) < share(Climate::Temperate, Sky::Fog));
    }

    #[test]
    fn tropical_summer_and_autumn_bring_more_storms() {
        // 同样的风暴概率下，热带海区夏秋的暴风雨天数多于温和海区（气候系数 1.5），春季相同
        let rules = WeatherRules::default();
        let t = region("t", [season(2, 5, 40); 4], Climate::Tropical);
        let m = region("m", [season(2, 5, 40); 4], Climate::Temperate);
        for s in [1, 2] {
            assert!(storm_params(&rules, &t, s, Fx::ONE).0 > storm_params(&rules, &m, s, Fx::ONE).0);
        }
        assert_eq!(storm_params(&rules, &t, 0, Fx::ONE), storm_params(&rules, &m, 0, Fx::ONE));
    }

    #[test]
    fn region_storm_modifier_raises_storm_days() {
        let count =
            |w: &World, r: RegionId| (0..DAYS).filter(|d| w.weather_on(r, *d).unwrap().sky == Sky::Storm).count();
        let mut w = weather_world(17);
        let base: Vec<usize> = regions(&w).map(|r| count(&w, r)).collect();
        // 风暴事件（经进行中事件与修正系数重算，与游戏中相同）使西海的暴风雨天数明显增加，其他海区不变
        w.state.events.active.push(storm_event(RegionId(0), Fx::from_pct(250), 0));
        w.recompute_modifiers();
        assert_eq!(w.storm_mult(RegionId(0)), Fx::from_pct(250));
        let after: Vec<usize> = regions(&w).map(|r| count(&w, r)).collect();
        assert!(after[0] * 10 > base[0] * 18, "风暴事件应使暴风雨天数增加：{} → {}", base[0], after[0]);
        assert_eq!(&after[1..], &base[1..], "其他海区的天气不受影响");
        // 风不受风暴事件影响
        let quiet = weather_world(17);
        for day in (0..360).step_by(5) {
            let (a, b) = (w.weather_on(RegionId(0), day).unwrap(), quiet.weather_on(RegionId(0), day).unwrap());
            assert_eq!((a.wind_dir(), a.wind_strength()), (b.wind_dir(), b.wind_strength()));
        }
    }

    #[test]
    fn day_table_matches_world_queries() {
        let mut w = weather_world(3);
        w.state.day = 777;
        w.state.events.active.push(storm_event(RegionId(1), Fx::from_pct(200), 0));
        w.recompute_modifiers();
        let mut table = DayTable::new(&w);
        let defs = w.defs.clone();
        for r in regions(&w) {
            assert_eq!(table.get(&defs, r), w.weather_today(r));
            assert_eq!(table.get(&defs, r), w.weather_today(r), "缓存后结果不变");
        }
        for c in [Cell::new(2, 2), Cell::new(30, 20), Cell::new(20, 12), Cell::new(99, 99)] {
            assert_eq!(table.at(&defs, c), w.weather_at(c));
        }
    }

    #[test]
    fn fleet_speed_uses_todays_wind_and_sky() {
        let mut w = World::new(tiny_defs(), ScenarioId(0), 5).expect("开局");
        let defs = w.defs.clone();
        let fid: FleetId = w.fleets_of(OwnerId::Player).next().map(|f| f.id).unwrap();
        // 西海一条自西向东的直线航线
        let path: Vec<Cell> = (1..12).map(|x| Cell::new(x, 3)).collect();
        let heading = dir_between(path[0], path[1]);
        let season_w = defs.regions[0].seasons[0];
        // 找一天：当天的风或天况与季节气候不同，航速因此不同
        let day = (0..90)
            .find(|d| {
                let x = w.weather_on(RegionId(0), *d).unwrap();
                let fleet = w.fleet(fid).unwrap();
                crate::fleet::step_speed_on(&defs, fleet, heading, Some(&x))
                    != crate::fleet::step_speed(&defs, fleet, heading, Some(&season_w))
            })
            .expect("三个月内总有一天的风与季节气候不同");
        w.state.day = day;
        {
            let f = w.fleet_mut(fid).unwrap();
            f.food = 100;
            f.water = 100;
            f.location = FleetLocation::AtSea(Voyage::Route(crate::world::RouteVoyage {
                dest: LocId(0),
                path: path.clone(),
                step: 0,
                leg_progress: Fx::ZERO,
            }));
        }
        let today = w.weather_on(RegionId(0), day).unwrap();
        let fleet = w.fleet(fid).unwrap().clone();
        let bonus = Fx::ONE + w.fleet_speed_bonus(fid);
        let speed = crate::fleet::step_speed_on(&defs, &fleet, heading, Some(&today)).mul(bonus);
        let seasonal = crate::fleet::step_speed(&defs, &fleet, heading, Some(&season_w)).mul(bonus);
        assert_ne!(speed, seasonal);
        let by_formula =
            crate::fleet::step_speed(&defs, &fleet, heading, Some(&today.sea)).mul(today.speed_mult()).mul(bonus);
        assert_eq!(speed, by_formula);
        // 按当天的航速推算一天走到哪里
        let (mut step, mut progress, mut remaining) = (0usize, Fx::ZERO, Fx::ONE);
        while remaining > Fx::ZERO && step + 1 < path.len() {
            let need = step_len(heading).div(speed) - progress;
            if need <= remaining {
                remaining -= need;
                step += 1;
                progress = Fx::ZERO;
            } else {
                progress += remaining;
                remaining = Fx::ZERO;
            }
        }
        w.move_fleets().unwrap();
        let FleetLocation::AtSea(crate::world::Voyage::Route(v)) = &w.fleet(fid).unwrap().location else {
            panic!("仍在海上")
        };
        assert_eq!((v.step, v.leg_progress), (step, progress), "航行一天的进度应按当天的风与天况计算");
    }

    #[test]
    fn weather_is_recomputed_identically_after_save_roundtrip() {
        let mut w = weather_world(31);
        w.state.events.active.push(storm_event(RegionId(0), Fx::from_pct(200), 0));
        w.recompute_modifiers();
        for _ in 0..(DAYS_PER_YEAR / 4 + 17) {
            w.end_day().unwrap();
        }
        let forecast = |w: &World| -> Vec<Option<DayWeather>> {
            regions(w).flat_map(|r| (0..3).map(move |k| (r, k))).map(|(r, k)| w.weather_on(r, w.day() + k)).collect()
        };
        let json_before = serde_json::to_string(&w.state).unwrap();
        let before = forecast(&w);
        // 计算天气不改变状态；状态里也没有天气字段
        assert_eq!(serde_json::to_string(&w.state).unwrap(), json_before);
        assert!(!json_before.contains("\"sky\"") && !json_before.contains("storm_hit"));
        let save =
            crate::SaveFile::new(&w.defs, crate::StartParams::new(ScenarioId(0), 31), w.state.clone(), Vec::new());
        let back = crate::SaveFile::from_json(&save.to_json().unwrap()).unwrap();
        let restored = World::from_snapshot(w.defs.clone(), back.snapshot).unwrap();
        assert_eq!(before, forecast(&restored), "读档后的天气（含预报与风暴事件修正）应与存档前一致");
        assert_eq!(restored.state_hash(), w.state_hash());
    }
}
