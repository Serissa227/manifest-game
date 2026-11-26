//! 开放市场（`rules.toml [market.open]`，规则见 [`crate::defs::OpenMarketRules`]，决定见 docs/DECISIONS.md“开放市场”）。
//!
//! - **哪里都能卖**：打开时每个有市场的港口与内陆城市对每种商品都有市场条目。地点清单（`world/*.toml` 的 market）以外的商品
//!   是“只收不卖”的进口条目（[`crate::world::MarketEntry::extra`]）：日消耗取这种商品在各地清单里进口条目的日消耗中位数，
//!   产量 = 日消耗 × 曲线（离最近的特产地的贸易距离）——离产地近的只比基准价贵一两成，远在海外的贵到两倍半上下。
//!   价格公式不变，远近只通过均衡库存（产量 / 消耗）进入价格；这些条目不参与城镇的满足度、替代、流行与规则触发的禁运。
//! - **卖什么以特产为主**：各地向玩家与商会出售的只是清单里的特产（产量 > 消耗）与产量 / 消耗不低于 `sell_min_ratio` 的商品，
//!   另有地点自己写明也出售的商品（`world/*.toml` 的 sells：新大陆的殖民港出售殖民地的建材与口粮）；
//!   不够 `sell_min_goods` 种时按产量 / 消耗从高到低补足；没有任何地方以它为特产的商品，列出它的地方照旧出售（否则全世界都买不到）。
//!   出售清单每次从静态数据算出，不进存档，旧存档读进来立刻照新规则。
//! - **贸易距离**：港口之间取四季航线里最短的几何长度（格），内陆城市经道路相连（一格陆路折合 `road_factor` 格海路，
//!   再除以道路地形的速度系数），多段取最短路（Floyd–Warshall；定点数，结果与迭代顺序无关）。
//! - 关闭时这里什么也不做：[`sells`] 一律为真（有市场条目就能买，同旧版），也不补任何条目。

use crate::defs::{LocationDef, MarketDef, OpenMarketRules, StaticData};
use crate::fixed::Fx;
use crate::ids::{GoodId, LocId};

/// 某地是否向玩家与商会出售这种商品。开放市场关闭时一律为真（有市场条目就能买，同旧版）；
/// 打开时只有清单里的特产、产量 / 消耗够高的商品与补足的几种（见模块说明）。
pub fn sells(defs: &StaticData, loc: LocId, good: GoodId) -> bool {
    sells_with(defs, &[], loc, good)
}

/// 运行时出售判定，读不可逆的开放记录；静态调用把条件条目视为尚未开放。
pub fn sells_with(defs: &StaticData, records: &[crate::stages::MarketUnlock], loc: LocId, good: GoodId) -> bool {
    if !crate::stages::market_open(defs, records, loc, good) {
        return false;
    }
    if crate::stages::is_rare(defs, good) {
        return crate::stages::rare_source(defs, good) == Some(loc);
    }
    let r = &defs.rules.open_market;
    if !r.enabled {
        return true;
    }
    let Some(l) = defs.locations.get(loc.idx()) else { return false };
    let Some((i, m)) = l.market.iter().enumerate().find(|(_, m)| m.good == good) else { return false };
    if by_rule(r, l, m) {
        return true;
    }
    let better = l
        .market
        .iter()
        .enumerate()
        .filter(|(j, o)| sale_candidate(defs, records, loc, o.good) && ranks_before((*j, o), (i, m)))
        .count();
    better < r.sell_min_goods || !has_specialty(defs, good)
}

fn sale_candidate(defs: &StaticData, records: &[crate::stages::MarketUnlock], loc: LocId, good: GoodId) -> bool {
    crate::stages::market_open(defs, records, loc, good)
        && (!crate::stages::is_rare(defs, good) || crate::stages::rare_source(defs, good) == Some(loc))
}

/// 某地出售的商品（按作者清单的顺序）；静态查询不包括尚无开放记录的条件条目。
pub fn sale_list(defs: &StaticData, loc: LocId) -> Vec<GoodId> {
    sale_list_with(defs, &[], loc)
}

pub fn sale_list_with(defs: &StaticData, records: &[crate::stages::MarketUnlock], loc: LocId) -> Vec<GoodId> {
    let Some(l) = defs.locations.get(loc.idx()) else { return Vec::new() };
    let r = &defs.rules.open_market;
    let mut order: Vec<usize> =
        (0..l.market.len()).filter(|i| sale_candidate(defs, records, loc, l.market[*i].good)).collect();
    if !r.enabled {
        return order.into_iter().map(|i| l.market[i].good).collect();
    }
    order.sort_by(|&a, &b| {
        let (x, y) = (&l.market[a], &l.market[b]);
        (y.supply * x.demand).cmp(&(x.supply * y.demand)).then(a.cmp(&b))
    });
    let mut rank = vec![usize::MAX; l.market.len()];
    for (k, &i) in order.iter().enumerate() {
        rank[i] = k;
    }
    l.market
        .iter()
        .enumerate()
        .filter(|(i, m)| {
            rank[*i] != usize::MAX
                && (crate::stages::is_rare(defs, m.good)
                    || by_rule(r, l, m)
                    || rank[*i] < r.sell_min_goods
                    || !has_specialty(defs, m.good))
        })
        .map(|(_, m)| m.good)
        .collect()
}

impl crate::world::World {
    pub fn market_sells(&self, loc: LocId, good: GoodId) -> bool {
        sells_with(&self.defs, &self.state.unlocks, loc, good)
    }

    pub fn market_sale_list(&self, loc: LocId) -> Vec<GoodId> {
        sale_list_with(&self.defs, &self.state.unlocks, loc)
    }
}

/// 特产、产量 / 消耗不低于 `sell_min_ratio`，或是地点写明也出售的商品（[`LocationDef::sells`]）。
fn by_rule(r: &OpenMarketRules, l: &LocationDef, m: &MarketDef) -> bool {
    m.specialty || m.supply * Fx::SCALE >= r.sell_min_ratio.raw() * m.demand.max(1) || l.sells.contains(&m.good)
}

/// 清单里 `a` 是否排在 `b` 之前：产量 / 消耗更高，或一样高而在清单里更靠前。
fn ranks_before(a: (usize, &MarketDef), b: (usize, &MarketDef)) -> bool {
    let (x, y) = (a.1.supply * b.1.demand, b.1.supply * a.1.demand);
    x > y || (x == y && a.0 < b.0)
}

/// 有没有地方以这种商品为特产。
pub fn has_specialty(defs: &StaticData, good: GoodId) -> bool {
    defs.locations.iter().any(|l| l.market.iter().any(|m| m.good == good && m.specialty))
}

/// 地点之间的贸易距离（格，定点数）：`d[a][b]` 为从 a 到 b；到不了为 None。
/// 港口之间取四季航线里最短的几何长度；道路双向，一格陆路折合 `road_factor` 格海路再除以地形速度；多段取最短路。
pub fn trade_distances(defs: &StaticData) -> Vec<Vec<Option<Fx>>> {
    let n = defs.locations.len();
    let road_factor = defs.rules.open_market.road_factor;
    let mut d: Vec<Vec<Option<Fx>>> = vec![vec![None; n]; n];
    for (i, row) in d.iter_mut().enumerate() {
        row[i] = Some(Fx::ZERO);
    }
    let ports: Vec<LocId> = defs.port_ids().collect();
    for &a in &ports {
        for &b in &ports {
            if a == b {
                continue;
            }
            let best = (0..defs.nav.grid.period_count())
                .filter_map(|s| defs.nav.compressed_path(s, a, b).map(|p| p.length))
                .min();
            if let (Some(len), Some(slot)) = (best, d.get_mut(a.idx()).and_then(|r| r.get_mut(b.idx()))) {
                *slot = Some(len);
            }
        }
    }
    for road in &defs.roads {
        let w = road.length.mul(road_factor).div(road.terrain.speed().max(Fx(1)));
        for (a, b) in [(road.from.idx(), road.to.idx()), (road.to.idx(), road.from.idx())] {
            if a < n && b < n && d[a][b].is_none_or(|x| w < x) {
                d[a][b] = Some(w);
            }
        }
    }
    // Floyd–Warshall：第 k 轮里 d[k][·] 不变（d[k][k] = 0），先抄一份再逐行放宽
    for k in 0..n {
        let via_k = d[k].clone();
        for row in d.iter_mut() {
            let Some(ik) = row[k] else { continue };
            for (slot, kj) in row.iter_mut().zip(&via_k) {
                let Some(kj) = *kj else { continue };
                let via = ik + kj;
                if slot.is_none_or(|x| via < x) {
                    *slot = Some(via);
                }
            }
        }
    }
    d
}

/// 某地离各种商品最近的特产地（地点、贸易距离）；自己就是特产地、或到不了任何特产地时为 None。按商品编号。
pub fn nearest_producers(defs: &StaticData, loc: LocId) -> Vec<Option<(LocId, Fx)>> {
    let dist = trade_distances(defs);
    nearest_with(defs, &dist, loc)
}

fn nearest_with(defs: &StaticData, dist: &[Vec<Option<Fx>>], loc: LocId) -> Vec<Option<(LocId, Fx)>> {
    let mut out: Vec<Option<(LocId, Fx)>> = vec![None; defs.goods.len()];
    for (pi, p) in defs.locations.iter().enumerate() {
        if pi == loc.idx() {
            continue;
        }
        let Some(d) = dist.get(pi).and_then(|r| r.get(loc.idx())).copied().flatten() else { continue };
        for m in p.market.iter().filter(|m| m.specialty) {
            let Some(slot) = out.get_mut(m.good.idx()) else { continue };
            if slot.is_none_or(|(_, best)| d < best) {
                *slot = Some((LocId::from_idx(pi), d));
            }
        }
    }
    out
}

/// 各种商品的“进口”日消耗：各地清单里不是特产的条目的日消耗中位数（没有这样的条目时取全部条目的中位数），
/// 乘 `demand_scale`，至少 `min_demand`。按商品编号。
pub fn import_demands(defs: &StaticData) -> Vec<i64> {
    let r = &defs.rules.open_market;
    (0..defs.goods.len())
        .map(|gi| {
            let good = GoodId::from_idx(gi);
            let entries = defs.locations.iter().flat_map(|l| l.market.iter()).filter(|m| m.good == good);
            let mut imports: Vec<i64> = entries.clone().filter(|m| !m.specialty).map(|m| m.demand).collect();
            if imports.is_empty() {
                imports = entries.map(|m| m.demand).collect();
            }
            imports.sort_unstable();
            let median = imports.get(imports.len().saturating_sub(1) / 2).copied().unwrap_or(r.min_demand);
            r.demand_scale.apply(median).max(r.min_demand)
        })
        .collect()
}

/// 只收不卖的条目的日产量：日消耗 × 比例（四舍五入），夹在 [⌈0.3 × 日消耗⌉, 日消耗 − 1] 之间、至少 1。
pub fn extra_supply(demand: i64, ratio: Fx) -> i64 {
    let lo = (3 * demand + 9) / 10;
    let hi = (demand - 1).max(lo);
    ratio.apply(demand).clamp(lo, hi).max(1)
}

/// 清单里的进口条目补背景到货（`[market.open] listed_import_inflow`，开放市场也要打开）：不是特产的条目，
/// 产量补到“日消耗 × ratio_curve(离最近特产地的贸易距离)”（同 [`extra_supply`]，只往上补、不往下改；到不了任何特产地的按曲线最远一档）。
/// 到货代表腹地的驮队与沿海的小商贩：离产地越远越少、均衡价越高（近处约 1.2 倍基准价，远在海外约 2.3 倍），
/// 而不是没人运货时库存归零、价格一直顶在上限。数据加载时调用一次（[`StaticData`] 里的产量就是补过的）；关闭时什么也不做。
pub fn apply_listed_import_inflow(defs: &mut StaticData) {
    let r = &defs.rules.open_market;
    if !r.enabled || !r.listed_import_inflow {
        return;
    }
    let dist = trade_distances(defs);
    let far = r.ratio_curve.points.last().map(|p| p.1).unwrap_or(Fx::from_pct(36));
    let mut raised = Vec::new();
    for (li, l) in defs.locations.iter().enumerate() {
        if l.is_site() || l.market.is_empty() {
            continue;
        }
        let near = nearest_with(defs, &dist, LocId::from_idx(li));
        for (mi, m) in l.market.iter().enumerate() {
            if m.specialty || m.demand <= 0 || crate::stages::is_rare(defs, m.good) {
                continue;
            }
            let ratio = match near.get(m.good.idx()).copied().flatten() {
                Some((_, x)) => r.ratio_curve.eval(x),
                None => far,
            };
            let inflow = extra_supply(m.demand, ratio);
            if inflow > m.supply {
                raised.push((li, mi, inflow));
            }
        }
    }
    for (li, mi, supply) in raised {
        defs.locations[li].market[mi].supply = supply;
    }
}

/// 开放市场打开时，各地清单以外的商品的市场参数（只收不卖的进口条目，按商品编号）；关闭时每处都是空的。
/// 殖民点与没有市场的地点没有。
pub fn extra_markets(defs: &StaticData) -> Vec<Vec<MarketDef>> {
    let r = &defs.rules.open_market;
    let n = defs.locations.len();
    if !r.enabled {
        return vec![Vec::new(); n];
    }
    let dist = trade_distances(defs);
    let demand = import_demands(defs);
    let far = r.ratio_curve.points.last().map(|p| p.1).unwrap_or(Fx::from_pct(36));
    (0..n)
        .map(|li| {
            let l = &defs.locations[li];
            if l.is_site() || l.market.is_empty() {
                return Vec::new();
            }
            let near = nearest_with(defs, &dist, LocId::from_idx(li));
            defs.good_ids()
                .filter(|g| l.listed(*g).is_none())
                .map(|g| {
                    let d = demand[g.idx()];
                    let ratio = match near[g.idx()] {
                        Some((_, x)) => r.ratio_curve.eval(x),
                        None => far,
                    };
                    MarketDef { good: g, supply: extra_supply(d, ratio), demand: d, specialty: false }
                })
                .collect()
        })
        .collect()
}

/// 只看特产、供需比门槛与地点明列出售；不含最低品种补足和无特产货的兜底。
pub fn sells_by_rule(defs: &StaticData, loc: LocId, good: GoodId) -> bool {
    let Some(l) = defs.locations.get(loc.idx()) else { return false };
    l.market.iter().find(|m| m.good == good).is_some_and(|m| by_rule(&defs.rules.open_market, l, m))
}

/// 只看本港特产与地点明列出售；不含供需比门槛、最低品种补足和无特产货的兜底。
pub fn sells_listed(defs: &StaticData, loc: LocId, good: GoodId) -> bool {
    let Some(l) = defs.locations.get(loc.idx()) else { return false };
    l.market.iter().find(|m| m.good == good).is_some_and(|m| m.specialty || l.sells.contains(&m.good))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testkit::tiny_defs;

    fn open(min_goods: usize) -> StaticData {
        let mut d = (*tiny_defs()).clone();
        d.rules.open_market.enabled = true;
        d.rules.open_market.sell_min_goods = min_goods;
        d
    }

    fn open_ratio(min_goods: usize, min_ratio: Fx) -> StaticData {
        let mut d = open(min_goods);
        d.rules.open_market.sell_min_ratio = min_ratio;
        d
    }

    #[test]
    fn closed_market_sells_everything_listed_and_adds_nothing() {
        let d = tiny_defs();
        assert!(!d.rules.open_market.enabled);
        for l in d.loc_ids() {
            for g in d.good_ids() {
                assert!(sells(&d, l, g));
            }
        }
        assert!(extra_markets(&d).iter().all(|v| v.is_empty()));
    }

    #[test]
    fn sale_list_is_specialties_plus_the_floor() {
        // alpha：谷物 40/20（特产）、棉布 6/12、香料 3/8、铁 10/10
        let alpha = LocId(0);
        // 只卖特产（门槛高于 1）
        let d = open_ratio(0, Fx::from_pct(150));
        assert_eq!(sale_list(&d, alpha), vec![GoodId(0)]);
        assert!(sells(&d, alpha, GoodId(0)) && !sells(&d, alpha, GoodId(1)) && !sells(&d, alpha, GoodId(3)));
        // 缺省门槛 0.75：产量 / 消耗 = 1 的铁也卖
        let d1 = open(0);
        assert_eq!(sale_list(&d1, alpha), vec![GoodId(0), GoodId(3)]);
        // 至少两种、三种：按产量 / 消耗补上（铁 1.0 > 棉布 0.5 > 香料 0.375），结果按清单的顺序
        let d2 = open_ratio(2, Fx::from_pct(150));
        assert_eq!(sale_list(&d2, alpha), vec![GoodId(0), GoodId(3)]);
        let d3 = open_ratio(3, Fx::from_pct(150));
        assert_eq!(sale_list(&d3, alpha), vec![GoodId(0), GoodId(1), GoodId(3)]);
        for (dd, l) in [(&d, alpha), (&d1, alpha), (&d2, alpha), (&d3, alpha), (&d3, LocId(1)), (&d3, LocId(2))] {
            for g in dd.good_ids() {
                assert_eq!(sells(dd, l, g), sale_list(dd, l).contains(&g), "sells 与 sale_list 一致");
            }
        }
    }

    #[test]
    fn a_location_can_name_more_goods_it_sells() {
        // 只卖特产的门槛下，alpha 原来只卖谷物；alpha 写明也卖棉布之后也卖（别处不受影响）
        let mut d = open_ratio(0, Fx::from_pct(150));
        d.locations[0].sells = vec![GoodId(1)];
        assert_eq!(sale_list(&d, LocId(0)), vec![GoodId(0), GoodId(1)]);
        assert!(sells(&d, LocId(0), GoodId(1)) && !sells(&d, LocId(2), GoodId(1)));
        // 清单里没有的照样不卖
        d.locations[0].market.retain(|m| m.good != GoodId(1));
        assert!(!sells(&d, LocId(0), GoodId(1)));
    }

    #[test]
    fn goods_nobody_specialises_in_stay_on_sale_where_listed() {
        // 门槛高于 1、不补足：只有特产在售
        let mut d = open_ratio(0, Fx::from_pct(150));
        assert!(!sells(&d, LocId(0), GoodId(2)), "alpha 的香料 3/8 原来不卖（beta 是产地）");
        // 让香料在哪里都不是特产（beta 原来 12/4）
        for l in d.locations.iter_mut() {
            for m in l.market.iter_mut().filter(|m| m.good == GoodId(2)) {
                m.supply = m.demand / 2;
                m.specialty = false;
            }
        }
        assert!(!has_specialty(&d, GoodId(2)));
        for l in [LocId(0), LocId(1), LocId(2), LocId(3)] {
            assert!(sells(&d, l, GoodId(2)), "{l:?}");
            assert!(sale_list(&d, l).contains(&GoodId(2)));
        }
    }

    /// 各地清单的（商品, 产量, 消耗, 特产）
    fn markets(d: &StaticData) -> Vec<Vec<(GoodId, i64, i64, bool)>> {
        d.locations
            .iter()
            .map(|l| l.market.iter().map(|m| (m.good, m.supply, m.demand, m.specialty)).collect())
            .collect()
    }

    #[test]
    fn listed_imports_get_a_background_inflow_by_distance_only_when_switched_on() {
        // alpha：棉布 6/12、香料 3/8 是进口（不是特产）；谷物 40/20 是特产
        let before = open(0);
        let mut off = before.clone();
        apply_listed_import_inflow(&mut off);
        assert_eq!(markets(&off), markets(&before), "开关关着时不改");
        let mut on = before.clone();
        on.rules.open_market.listed_import_inflow = true;
        apply_listed_import_inflow(&mut on);
        let dist = trade_distances(&before);
        for (li, (old, new)) in before.locations.iter().zip(&on.locations).enumerate() {
            let near = nearest_with(&before, &dist, LocId::from_idx(li));
            for (a, b) in old.market.iter().zip(&new.market) {
                assert_eq!((a.good, a.demand, a.specialty), (b.good, b.demand, b.specialty));
                if a.specialty {
                    assert_eq!(a.supply, b.supply, "特产不改");
                    continue;
                }
                let ratio =
                    near[a.good.idx()].map_or(Fx::from_pct(36), |(_, x)| before.rules.open_market.ratio_curve.eval(x));
                assert_eq!(b.supply, a.supply.max(extra_supply(a.demand, ratio)), "{li} {:?}", a.good);
                if b.supply != a.supply {
                    assert!(b.supply < b.demand, "补过的进口条目产量仍低于消耗");
                }
            }
        }
        // 至少有一条真的补了
        assert_ne!(markets(&on), markets(&before));
        // 开放市场关着时，开关打开也不改
        let mut closed = (*tiny_defs()).clone();
        closed.rules.open_market.listed_import_inflow = true;
        let snapshot = markets(&closed);
        apply_listed_import_inflow(&mut closed);
        assert_eq!(markets(&closed), snapshot);
    }

    #[test]
    fn distances_follow_sea_lanes_and_roads() {
        let d = open(0);
        let dist = trade_distances(&d);
        let (alpha, beta, delta) = (0usize, 1usize, 3usize);
        assert_eq!(dist[alpha][alpha], Some(Fx::ZERO));
        let sea = dist[alpha][beta].expect("alpha 与 beta 之间有航线");
        assert!(sea > Fx::ZERO);
        // delta（内陆城市）只经道路相连：两端的道路都有
        let to_delta = dist[alpha][delta].expect("经道路到得了 delta");
        assert!(to_delta > Fx::ZERO);
        // 三角不等式
        for i in 0..dist.len() {
            for j in 0..dist.len() {
                for k in 0..dist.len() {
                    if let (Some(ij), Some(ik), Some(kj)) = (dist[i][j], dist[i][k], dist[k][j]) {
                        assert!(ij <= ik + kj);
                    }
                }
            }
        }
        // 殖民点（sigma）不连任何地方
        assert!(dist[alpha][4].is_none());
    }

    #[test]
    fn extra_entries_cover_every_unlisted_good_with_supply_below_demand() {
        let mut d = open(0);
        // 给 gamma 去掉香料与铁：开放市场补上两条只收不卖的进口条目
        d.locations[2].market.retain(|m| m.good != GoodId(2) && m.good != GoodId(3));
        let extras = extra_markets(&d);
        assert_eq!(extras[2].iter().map(|m| m.good).collect::<Vec<_>>(), vec![GoodId(2), GoodId(3)]);
        for m in &extras[2] {
            assert!(!m.specialty && m.supply < m.demand && m.supply * 10 >= m.demand * 3, "{m:?}");
        }
        assert!(extras[0].is_empty() && extras[4].is_empty(), "清单已经齐全的地点、殖民点没有");
    }

    #[test]
    fn supply_is_clamped_into_the_allowed_band() {
        assert_eq!(extra_supply(3, Fx::from_pct(85)), 2);
        assert_eq!(extra_supply(3, Fx::from_pct(36)), 1);
        assert_eq!(extra_supply(50, Fx::from_pct(85)), 43);
        assert_eq!(extra_supply(50, Fx::from_pct(10)), 15);
        assert_eq!(extra_supply(2, Fx::ONE), 1);
    }
}
