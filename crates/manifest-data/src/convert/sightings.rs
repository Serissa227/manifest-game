//! H04 海上所见的数据分片（`voyage/sightings.toml`，逻辑名 `sightings.toml`）：严格读入、校验，转成内核的定义表。
//! 规则（概率、距离、寿命）在 `rules.toml [sightings]`；这里只管每一种所见的样子、条件与结果。
use super::{Issues, check_keys, load_optional};
use crate::worlds::EffectiveWorld;
use manifest_core::calendar::Season;
use manifest_core::items::ItemsDefs;
use manifest_core::sightings::{Shore, SightEffects, SightKind, SightLucky, SightOption, SightWhen, SightingDef};
use manifest_core::weather::Climate;
use serde::Deserialize;

const FILE: &str = "sightings.toml";

#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct File {
    #[serde(default)]
    sightings: Vec<Raw>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Raw {
    key: String,
    kind: String,
    weight: i64,
    title: String,
    text: String,
    #[serde(default)]
    when: Option<RawWhen>,
    options: Vec<RawOption>,
}

#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawWhen {
    #[serde(default)]
    climates: Vec<String>,
    #[serde(default)]
    seasons: Vec<String>,
    shore: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawOption {
    label: String,
    result: String,
    safe: Option<String>,
    #[serde(default)]
    effects: RawEffects,
    lucky: Option<RawLucky>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawLucky {
    chance: f64,
    result: String,
    #[serde(default)]
    effects: RawEffects,
}

#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawEffects {
    #[serde(default)]
    cash: i64,
    #[serde(default)]
    morale: i64,
    crew: Option<[i64; 2]>,
    #[serde(default)]
    supplies: i64,
    #[serde(default)]
    fresh: i64,
    goods: Option<[i64; 2]>,
    item: Option<String>,
    #[serde(default)]
    damage: i64,
    #[serde(default)]
    damage_full_sail: i64,
    #[serde(default)]
    rumor: bool,
    #[serde(default)]
    chart: bool,
    #[serde(default)]
    land: i64,
    #[serde(default)]
    port: bool,
}

fn season(s: &str) -> Option<Season> {
    match s {
        "spring" => Some(Season::Spring),
        "summer" => Some(Season::Summer),
        "autumn" => Some(Season::Autumn),
        "winter" => Some(Season::Winter),
        _ => None,
    }
}

fn effects(raw: RawEffects, items: &ItemsDefs, at: &str, issues: &mut Issues) -> SightEffects {
    let range = |r: Option<[i64; 2]>, name: &str, issues: &mut Issues| {
        r.filter(|[lo, hi]| {
            let ok = *lo >= 1 && lo <= hi && *hi <= 50;
            if !ok {
                issues.push(FILE, at, format!("{name} 须为 [少, 多]，1 ≤ 少 ≤ 多 ≤ 50"));
            }
            ok
        })
    };
    if let Some(item) = &raw.item
        && items.item(item).is_none()
    {
        issues.push(FILE, at, format!("物品“{item}”不存在"));
    }
    if !(-500..=500).contains(&raw.cash)
        || !(-20..=20).contains(&raw.morale)
        || !(-5..=5).contains(&raw.supplies)
        || !(0..=30).contains(&raw.fresh)
        || !(0..=30).contains(&raw.damage)
        || !(0..=30).contains(&raw.damage_full_sail)
        || !(0..=8).contains(&raw.land)
    {
        issues.push(
            FILE,
            at,
            "数值越界：cash ±500、morale ±20、supplies ±5、fresh 0–30、damage 与 damage_full_sail 0–30、land 0–8",
        );
    }
    SightEffects {
        cash: raw.cash,
        morale: raw.morale,
        crew: range(raw.crew, "crew", issues),
        supplies: raw.supplies,
        fresh: raw.fresh,
        goods: range(raw.goods, "goods", issues),
        item: raw.item,
        damage: raw.damage,
        damage_full_sail: raw.damage_full_sail,
        rumor: raw.rumor,
        chart: raw.chart,
        land: raw.land,
        port: raw.port,
    }
}

/// 读入所见表；分片没登记时为空表。
pub(super) fn load(dir: &EffectiveWorld, items: &ItemsDefs, issues: &mut Issues) -> Vec<SightingDef> {
    let raw: File = load_optional(dir, FILE, issues).unwrap_or_default();
    check_keys(FILE, "sightings", raw.sightings.iter().map(|s| (s.key.as_str(), s.title.as_str())), issues);
    let mut out = Vec::new();
    for s in raw.sightings {
        let at = s.key.clone();
        let Some(kind) = SightKind::from_key(&s.kind) else {
            issues.push(FILE, &at, format!("没有这种所见：{}", s.kind));
            continue;
        };
        if s.weight <= 0 {
            issues.push(FILE, &at, "weight 须为正数");
        }
        if s.title.trim().is_empty() || s.text.trim().is_empty() {
            issues.push(FILE, &at, "title 与 text 不能为空");
        }
        let w = s.when.unwrap_or_default();
        let mut when = SightWhen::default();
        for c in &w.climates {
            match Climate::from_key(c) {
                Some(c) => when.climates.push(c),
                None => issues.push(FILE, &at, format!("没有这种气候：{c}")),
            }
        }
        for x in &w.seasons {
            match season(x) {
                Some(x) => when.seasons.push(x),
                None => issues.push(FILE, &at, format!("没有这个季节：{x}")),
            }
        }
        when.shore = match w.shore.as_deref() {
            None => None,
            Some("near") => Some(Shore::Near),
            Some("far") => Some(Shore::Far),
            Some(other) => {
                issues.push(FILE, &at, format!("shore 只能是 near 或 far：{other}"));
                None
            }
        };
        if s.options.is_empty() || s.options.len() > 2 {
            issues.push(FILE, &at, "每种所见要有一到两个按钮");
        }
        if kind.hazard() && s.options.len() != 1 {
            issues.push(FILE, &at, "要绕开的所见（weed / ice / reef）只能有一个按钮");
        }
        let mut options = Vec::new();
        for (i, o) in s.options.into_iter().enumerate() {
            let at = format!("{at}.options[{i}]");
            if o.label.trim().is_empty() || o.result.trim().is_empty() {
                issues.push(FILE, &at, "label 与 result 不能为空");
            }
            if o.safe.is_some() && kind != SightKind::Reef {
                issues.push(FILE, &at, "safe 只给暗礁用");
            }
            let lucky = o.lucky.map(|l| {
                if !(0.0..=0.5).contains(&l.chance) {
                    issues.push(FILE, &at, "lucky.chance 须在 0 到 0.5 之间");
                }
                SightLucky {
                    chance_bp: (l.chance.clamp(0.0, 1.0) * 10_000.0).round() as i64,
                    result: l.result,
                    effects: effects(l.effects, items, &at, issues),
                }
            });
            options.push(SightOption {
                label: o.label,
                result: o.result,
                safe: o.safe,
                effects: effects(o.effects, items, &at, issues),
                lucky,
            });
        }
        out.push(SightingDef { key: s.key, kind, weight: s.weight, title: s.title, text: s.text, when, options });
    }
    out
}
