//! 把提案中的 key 与数值转换为内核的标识符与定点数。裁决与最终转为命令时共用。

use crate::proposal::{ComposedEffectRaw, ContractProposal, EventPick, OutlookProposal, StrategyProposal};
use manifest_core::StaticData;
use manifest_core::composed::ComposedEffect;
use manifest_core::defs::ForecastMethod;
use manifest_core::events::EventParams;
use manifest_core::fixed::{Fx, Money};
use manifest_core::ids::*;

/// 有限且在合理范围内的小数转定点数。
pub fn fx_from_f64(v: f64) -> Option<Fx> {
    if !v.is_finite() || v.abs() > 1_000.0 {
        return None;
    }
    Some(Fx((v * Fx::SCALE as f64).round() as i64))
}

fn find<T>(what: &str, key: &Option<String>, f: impl Fn(&str) -> Option<T>) -> Result<Option<T>, String> {
    match key {
        None => Ok(None),
        Some(k) => f(k).map(Some).ok_or_else(|| format!("未知的{what}“{k}”")),
    }
}

/// 解析事件：事件类型必须在目录中，参数引用的对象必须存在（范围与前提由裁决器与内核再查）。
pub fn resolve_event(defs: &StaticData, pick: &EventPick) -> Result<(EventTypeId, EventParams), String> {
    let kind = defs.find_event(&pick.event).ok_or_else(|| format!("事件类型“{}”不在封闭集合中", pick.event))?;
    let p = &pick.params;
    let mult = match p.mult {
        None => None,
        Some(v) => Some(fx_from_f64(v).ok_or_else(|| format!("系数 {v} 无效"))?),
    };
    let params = EventParams {
        loc: find("地点", &p.loc, |k| defs.find_loc(k))?,
        good: find("商品", &p.good, |k| defs.find_good(k))?,
        region: find("海区", &p.region, |k| defs.find_region(k))?,
        faction_a: find("势力", &p.faction_a, |k| defs.find_faction(k))?,
        faction_b: find("势力", &p.faction_b, |k| defs.find_faction(k))?,
        mult,
        days: p.days,
        delta: p.delta,
        ..EventParams::default()
    };
    Ok((kind, params))
}

/// 解析委托合同。
pub fn resolve_contract(
    defs: &StaticData,
    c: &ContractProposal,
) -> Result<(FactionId, GoodId, i64, LocId, u32, Money), String> {
    let issuer = defs.find_faction(&c.issuer).ok_or_else(|| format!("未知的势力“{}”", c.issuer))?;
    let good = defs.find_good(&c.good).ok_or_else(|| format!("未知的商品“{}”", c.good))?;
    let to = defs.find_loc(&c.to).ok_or_else(|| format!("未知的地点“{}”", c.to))?;
    if !(0..=1_000).contains(&c.days) {
        return Err(format!("期限 {} 无效", c.days));
    }
    Ok((issuer, good, c.qty, to, c.days as u32, c.reward))
}

/// 殖民地产量效果中表示“全部建筑”的建筑 key。
pub const ALL_BUILDINGS: &str = "all";

/// 解析组合事件的一条效果：引用的对象必须存在（边界与前提由裁决器与内核再查）。
pub fn resolve_composed_effect(defs: &StaticData, e: &ComposedEffectRaw) -> Result<ComposedEffect, String> {
    use ComposedEffectRaw as R;
    let loc = |k: &str| defs.find_loc(k).ok_or_else(|| format!("未知的地点“{k}”"));
    let good = |k: &str| defs.find_good(k).ok_or_else(|| format!("未知的商品“{k}”"));
    let region = |k: &str| defs.find_region(k).ok_or_else(|| format!("未知的海区“{k}”"));
    let faction = |k: &str| defs.find_faction(k).ok_or_else(|| format!("未知的势力“{k}”"));
    let fx = |v: f64| fx_from_f64(v).ok_or_else(|| format!("系数 {v} 无效"));
    let building = |k: &str| {
        if k == ALL_BUILDINGS {
            Ok(None)
        } else {
            defs.find_colony_building(k).map(Some).ok_or_else(|| format!("未知的殖民地建筑“{k}”"))
        }
    };
    let discovery = |k: &str| defs.find_discovery(k).ok_or_else(|| format!("未知的发现物“{k}”"));
    let p = match e {
        R::GoodSupply { good: g, mult, days } | R::GoodDemand { good: g, mult, days } => {
            EventParams { good: Some(good(g)?), mult: Some(fx(*mult)?), days: Some(*days), ..EventParams::default() }
        }
        R::SupplyShift { loc: l, good: g, mult, days } | R::DemandShift { loc: l, good: g, mult, days } => {
            EventParams {
                loc: Some(loc(l)?),
                good: Some(good(g)?),
                mult: Some(fx(*mult)?),
                days: Some(*days),
                ..EventParams::default()
            }
        }
        R::LocationSupply { loc: l, mult, days } | R::LocationDemand { loc: l, mult, days } => {
            EventParams { loc: Some(loc(l)?), mult: Some(fx(*mult)?), days: Some(*days), ..EventParams::default() }
        }
        R::Popularity { loc: l, good: g, days } => {
            EventParams { loc: Some(loc(l)?), good: Some(good(g)?), days: Some(*days), ..EventParams::default() }
        }
        R::RegionStorm { region: r, mult, days } | R::RegionPirates { region: r, mult, days } => EventParams {
            region: Some(region(r)?),
            mult: Some(fx(*mult)?),
            days: Some(*days),
            ..EventParams::default()
        },
        R::RelationShift { faction_a, faction_b, delta } => EventParams {
            faction_a: Some(faction(faction_a)?),
            faction_b: Some(faction(faction_b)?),
            delta: Some(*delta),
            ..EventParams::default()
        },
        R::FactionTax { faction: f, mult, days } => EventParams {
            faction_a: Some(faction(f)?),
            mult: Some(fx(*mult)?),
            days: Some(*days),
            ..EventParams::default()
        },
        R::Development { loc: l, delta } => {
            EventParams { loc: Some(loc(l)?), delta: Some(*delta), ..EventParams::default() }
        }
        R::InterestShift { mult, days } | R::IndustryEfficiency { mult, days } => {
            EventParams { mult: Some(fx(*mult)?), days: Some(*days), ..EventParams::default() }
        }
        R::ColonyOutput { loc: l, building: b, mult, days } => EventParams {
            loc: Some(loc(l)?),
            building: building(b)?,
            mult: Some(fx(*mult)?),
            days: Some(*days),
            ..EventParams::default()
        },
        R::ColonyMorale { loc: l, delta } => {
            EventParams { loc: Some(loc(l)?), delta: Some(*delta), ..EventParams::default() }
        }
        R::ColonyGrowth { loc: l, mult, days } => {
            EventParams { loc: Some(loc(l)?), mult: Some(fx(*mult)?), days: Some(*days), ..EventParams::default() }
        }
        R::SiteClaim { loc: l, faction: f } => {
            EventParams { loc: Some(loc(l)?), faction_a: Some(faction(f)?), ..EventParams::default() }
        }
        R::DiscoveryRumor { discovery: d } => EventParams { discovery: Some(discovery(d)?), ..EventParams::default() },
        R::ExportBan { faction: f, good: g, days } => EventParams {
            faction_a: Some(faction(f)?),
            good: Some(good(g)?),
            days: Some(*days),
            ..EventParams::default()
        },
        R::ImportTariff { faction: f, good: g, mult, days } | R::ExportTariff { faction: f, good: g, mult, days } => {
            EventParams {
                faction_a: Some(faction(f)?),
                good: Some(good(g)?),
                mult: Some(fx(*mult)?),
                days: Some(*days),
                ..EventParams::default()
            }
        }
        R::Subsidy { loc: l, good: g, mult, days } => EventParams {
            loc: Some(loc(l)?),
            good: Some(good(g)?),
            mult: Some(fx(*mult)?),
            days: Some(*days),
            ..EventParams::default()
        },
    };
    Ok(ComposedEffect { effect: e.kind(), params: p })
}

/// 把内核的效果写回提案中的 key 形式（离线模板与测试用）；参数不齐全时返回 None。
pub fn raw_from_effect(defs: &StaticData, e: &ComposedEffect) -> Option<ComposedEffectRaw> {
    use ComposedEffectRaw as R;
    use manifest_core::defs::EffectKind as K;
    let p = &e.params;
    let loc = || p.loc.and_then(|l| defs.locations.get(l.idx())).map(|l| l.key.clone());
    let good = || p.good.and_then(|g| defs.goods.get(g.idx())).map(|g| g.key.clone());
    let region = || p.region.and_then(|r| defs.regions.get(r.idx())).map(|r| r.key.clone());
    let fa = || p.faction_a.and_then(|f| defs.factions.get(f.idx())).map(|f| f.key.clone());
    let fb = || p.faction_b.and_then(|f| defs.factions.get(f.idx())).map(|f| f.key.clone());
    let mult = || p.mult.map(|m| m.raw() as f64 / Fx::SCALE as f64);
    let building = || match p.building {
        None => Some(ALL_BUILDINGS.to_string()),
        Some(b) => defs.colony_buildings.get(b.idx()).map(|b| b.key.clone()),
    };
    let discovery = || p.discovery.and_then(|d| defs.discoveries.get(d.idx())).map(|d| d.key.clone());
    Some(match e.effect {
        K::GoodSupply => R::GoodSupply { good: good()?, mult: mult()?, days: p.days? },
        K::GoodDemand => R::GoodDemand { good: good()?, mult: mult()?, days: p.days? },
        K::SupplyShift => R::SupplyShift { loc: loc()?, good: good()?, mult: mult()?, days: p.days? },
        K::DemandShift => R::DemandShift { loc: loc()?, good: good()?, mult: mult()?, days: p.days? },
        K::LocationSupply => R::LocationSupply { loc: loc()?, mult: mult()?, days: p.days? },
        K::LocationDemand => R::LocationDemand { loc: loc()?, mult: mult()?, days: p.days? },
        K::Popularity => R::Popularity { loc: loc()?, good: good()?, days: p.days? },
        K::RegionStorm => R::RegionStorm { region: region()?, mult: mult()?, days: p.days? },
        K::RegionPirates => R::RegionPirates { region: region()?, mult: mult()?, days: p.days? },
        K::RelationShift => R::RelationShift { faction_a: fa()?, faction_b: fb()?, delta: p.delta? },
        K::FactionTax => R::FactionTax { faction: fa()?, mult: mult()?, days: p.days? },
        K::Development => R::Development { loc: loc()?, delta: p.delta? },
        K::InterestShift => R::InterestShift { mult: mult()?, days: p.days? },
        K::IndustryEfficiency => R::IndustryEfficiency { mult: mult()?, days: p.days? },
        K::ColonyOutput => R::ColonyOutput { loc: loc()?, building: building()?, mult: mult()?, days: p.days? },
        K::ColonyMorale => R::ColonyMorale { loc: loc()?, delta: p.delta? },
        K::ColonyGrowth => R::ColonyGrowth { loc: loc()?, mult: mult()?, days: p.days? },
        K::SiteClaim => R::SiteClaim { loc: loc()?, faction: fa()? },
        K::DiscoveryRumor => R::DiscoveryRumor { discovery: discovery()? },
        K::ExportBan => R::ExportBan { faction: fa()?, good: good()?, days: p.days? },
        K::ImportTariff => R::ImportTariff { faction: fa()?, good: good()?, mult: mult()?, days: p.days? },
        K::ExportTariff => R::ExportTariff { faction: fa()?, good: good()?, mult: mult()?, days: p.days? },
        K::Subsidy => R::Subsidy { loc: loc()?, good: good()?, mult: mult()?, days: p.days? },
    })
}

/// 预测方法在提案里的写法：fundamental（基本面：回归）、trend（趋势：顺势）、adaptive（适应：照旧）。
pub fn method_key(m: ForecastMethod) -> &'static str {
    match m {
        ForecastMethod::Revert => "fundamental",
        ForecastMethod::Trend => "trend",
        ForecastMethod::Naive => "adaptive",
    }
}

/// 解析后的商会展望：（商品, 看法）与偏好的预测方法（没写时为 None）。
pub type ResolvedOutlook = (Vec<(GoodId, i8)>, Option<ForecastMethod>);

/// 解析商会展望：商品 key 转成标识，看法与方法照原样（看法的范围、条数与重复由裁决器与内核查）。
pub fn resolve_outlook(defs: &StaticData, o: &OutlookProposal) -> Result<ResolvedOutlook, String> {
    let mut views = Vec::new();
    for v in &o.views {
        let g = defs.find_good(&v.good).ok_or_else(|| format!("未知的商品“{}”", v.good))?;
        let x = i8::try_from(v.view).map_err(|_| format!("看法 {} 越界", v.view))?;
        views.push((g, x));
    }
    let method = match o.method.as_str() {
        "" => None,
        other => Some(
            [ForecastMethod::Revert, ForecastMethod::Trend, ForecastMethod::Naive]
                .into_iter()
                .find(|m| method_key(*m) == other)
                .ok_or_else(|| format!("未知的预测方法“{other}”"))?,
        ),
    };
    Ok((views, method))
}

/// 解析商会战略：风险偏好转定点数，未知商品丢弃，最多保留 3 种。
pub fn resolve_strategy(defs: &StaticData, s: &StrategyProposal) -> Result<(Fx, Vec<GoodId>), String> {
    let risk = fx_from_f64(s.risk).ok_or_else(|| format!("风险偏好 {} 无效", s.risk))?;
    let mut goods: Vec<GoodId> = Vec::new();
    for k in &s.preferred {
        if let Some(g) = defs.find_good(k)
            && !goods.contains(&g)
        {
            goods.push(g);
        }
    }
    goods.truncate(3);
    Ok((risk, goods))
}
