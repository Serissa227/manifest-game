//! `rules.toml [weather]` 与 `regions.toml` 的 `climate` 字段：每日天气的规则与海区气候（EXPANSION §9.1）。

use super::{Issues, fx};
use crate::raw::{ClimateRaw, Dec, WeatherRulesRaw};
use manifest_core::fixed::Fx;
use manifest_core::weather::{Climate, ClimateWeather, WeatherRules};

const FILE: &str = "rules.toml";

/// 缺省的纬度分带（与 `data/rules.toml` 的初始值一致）：矩形中心行号 < 40 寒冷、< 80 温和、< 120 干燥、其余热带。
pub(super) const DEFAULT_BANDS: [i64; 3] = [40, 80, 120];

/// 转换并校验天气规则；返回（规则, 纬度分带）。没有 `[weather]` 时取默认值。
pub(super) fn convert(raw: Option<WeatherRulesRaw>, is: &mut Issues) -> (WeatherRules, [i64; 3]) {
    let Some(w) = raw else {
        return (WeatherRules::default(), DEFAULT_BANDS);
    };
    if !(2..=10).contains(&w.system_days) {
        is.push(FILE, "weather.system_days", "必须在 2 到 10 之间");
    }
    let b = w.latitude_bands;
    if b[0] < 0 || b[0] > b[1] || b[1] > b[2] {
        is.push(FILE, "weather.latitude_bands", "必须是三个不小于 0、从小到大排列的行号");
    }
    check_weights(&w.wind_dir_weights, "weather.wind_dir_weights", is);
    check_weights(&w.wind_strength_weights, "weather.wind_strength_weights", is);
    let d = &w.wind_dir_weights;
    if d[0] != d[4] || d[1] != d[3] || d.iter().any(|x| *x > d[2]) {
        is.push(FILE, "weather.wind_dir_weights", "必须左右对称，且偏移 0（中间一项）的权重最大");
    }
    let s = &w.wind_strength_weights;
    if (0..3).any(|i| s[i] != s[6 - i]) {
        is.push(FILE, "weather.wind_strength_weights", "必须左右对称（长期平均风力才等于季节风力）");
    }
    let hit = fraction_bp(w.storm_hit);
    if !(1..=10_000).contains(&hit) {
        is.push(FILE, "weather.storm_hit", "必须大于 0 且不超过 1");
    }
    let max = fraction_bp(w.storm_max);
    if !(1..=4_000).contains(&max) {
        is.push(FILE, "weather.storm_max", "必须大于 0 且不超过 0.4");
    }
    let climates = [
        climate(&w.temperate, "weather.temperate", is),
        climate(&w.cold, "weather.cold", is),
        climate(&w.arid, "weather.arid", is),
        climate(&w.tropical, "weather.tropical", is),
    ];
    let rules = WeatherRules {
        system_days: w.system_days,
        wind_dir_weights: w.wind_dir_weights,
        wind_strength_weights: w.wind_strength_weights,
        storm_hit_bp: hit,
        storm_max_bp: max,
        climates,
    };
    (rules, b)
}

fn fraction_bp(d: Dec) -> i64 {
    fx(d).raw()
}

fn check_weights(w: &[i64], item: &str, is: &mut Issues) {
    if w.iter().any(|x| *x < 0) || w.iter().sum::<i64>() <= 0 {
        is.push(FILE, item, "权重不能为负，且至少有一项大于 0");
    }
}

fn climate(c: &ClimateRaw, item: &str, is: &mut Issues) -> ClimateWeather {
    let skies = [c.spring, c.summer, c.autumn, c.winter];
    for (season, w) in ["spring", "summer", "autumn", "winter"].iter().zip(&skies) {
        check_weights(w, &format!("{item}.{season}"), is);
    }
    let storm = c.storm.map(fx);
    if storm.iter().any(|f| *f < Fx::ZERO || *f > Fx::from_int(5)) {
        is.push(FILE, format!("{item}.storm"), "暴风雨频率系数必须在 0 到 5 之间");
    }
    ClimateWeather { skies, storm }
}

/// 海区的气候：写了 `climate` 就按写的，否则按海区中心的行号与纬度分带推断
/// （有 `seas.txt` 时调用方传入实际海面外接矩形的中心，否则是 `rect` 的中心）。
pub(super) fn region_climate(
    raw: Option<&str>,
    center_y: i64,
    bands: [i64; 3],
    file: &str,
    item: &str,
    is: &mut Issues,
) -> Climate {
    if let Some(key) = raw {
        return Climate::from_key(key).unwrap_or_else(|| {
            is.push(file, item, format!("climate“{key}”无效，应为 temperate / cold / arid / tropical 之一"));
            Climate::Temperate
        });
    }
    if center_y < bands[0] {
        Climate::Cold
    } else if center_y < bands[1] {
        Climate::Temperate
    } else if center_y < bands[2] {
        Climate::Arid
    } else {
        Climate::Tropical
    }
}
