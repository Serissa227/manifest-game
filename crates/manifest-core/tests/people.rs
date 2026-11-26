//! 第八批 E4：人口、繁荣度与需求层级（docs/ECONOMY.md 6.4）的受控实验。使用内核自带的小型世界，
//! 去掉 NPC 商会（没有贸易）、随机的流行与目录事件，只看一个港口的供货、满足度、繁荣度与人口之间的回路：
//! - 长期供货充足的港口繁荣、人口增长，奢侈与舒适品的需求随之变大；断了主食的港口陷入饥荒与萧条、人口减少；
//! - 人口始终在开局人口的上下限之内；市况有滞回；同组商品按价格分摊需求（单一商品不超过八成）；
//! - 雇船员从当地人口里招，人手不足时拒绝且状态不变；遣散的船员留在当地；
//! - 头一年只学参照；旧存档打开规则后从头一年学起；存档往返与重放一致；规则关闭时没有人口。

use manifest_core::defs::NeedTier;
use manifest_core::people::{Condition, People, next_condition};
use manifest_core::replay::{StartParams, replay};
use manifest_core::save::SaveFile;
use manifest_core::testkit::{check_invariants, tiny_defs};
use manifest_core::*;
use std::sync::Arc;

const P: OwnerId = OwnerId::Player;
const ALPHA: LocId = LocId(0);
const BETA: LocId = LocId(1);
/// 小型世界的商品：谷物（必需）、棉布（舒适）、香料（奢侈）、铁（生产资料）
const GRAIN: GoodId = GoodId(0);
const CLOTH: GoodId = GoodId(1);
const SPICE: GoodId = GoodId(2);
const IRON: GoodId = GoodId(3);

/// 安静的小型世界：打开人口规则，去掉商会、流行、目录事件与海盗；商品按层级标好；`tweak` 再做其他修改。
fn defs_with(tweak: impl FnOnce(&mut StaticData)) -> Arc<StaticData> {
    let mut d = (*tiny_defs()).clone();
    d.rules.population.enabled = true;
    d.companies.clear();
    d.meta.keys.companies.clear();
    d.rules.seasonal_popular_bp = 0;
    d.rules.pirates.spawn_scale = Fx::ZERO;
    for e in &mut d.events {
        e.max_per_year = 0;
    }
    d.goods[GRAIN.idx()].need = Some(NeedTier::Essential);
    d.goods[CLOTH.idx()].need = Some(NeedTier::Comfort);
    d.goods[SPICE.idx()].need = Some(NeedTier::Luxury);
    tweak(&mut d);
    Arc::new(d)
}

fn people(w: &World, loc: LocId) -> &People {
    w.people(loc).expect("港口有人口")
}

/// 跑 n 天，每天检查不变量；`each` 在每天结算之前调用（模拟持续的供货或断供）。
fn run(w: &mut World, days: u32, mut each: impl FnMut(&mut World)) {
    for _ in 0..days {
        each(w);
        w.end_day().unwrap();
        check_invariants(w).unwrap_or_else(|e| panic!("{e}"));
    }
}

/// 把某地某商品的库存补到目标库存的 `pct`%（玩家与商会长期供货的效果）。
fn top_up(w: &mut World, loc: LocId, good: GoodId, pct: i64) {
    let e = w.state.locations[loc.idx()].market.get_mut(&good).unwrap();
    e.stock = e.stock.max(e.target * pct / 100);
}

fn ok(w: &mut World, c: Command) -> CommandOutcome {
    c.apply(w).unwrap_or_else(|e| panic!("{c:?} 失败：{e}"))
}

fn fleet(w: &World) -> FleetId {
    w.fleets_of(P).next().unwrap().id
}

#[test]
fn ports_and_cities_get_people_that_learn_for_a_year() {
    let defs = defs_with(|_| {});
    let mut w = World::new(defs.clone(), ScenarioId(0), 1).unwrap();
    for (i, loc) in defs.locations.iter().enumerate() {
        let p = &w.state.locations[i].people;
        if loc.is_site() {
            assert_eq!(p.pop0, 0, "殖民点没有城镇人口（有殖民地自己的人口规则）");
        } else {
            assert_eq!(p.pop0, loc.development * defs.rules.population.per_development, "{}", loc.key);
            assert_eq!((p.pop, p.prosperity, p.condition), (p.pop0, Fx::from_int(50), Condition::Stable));
        }
    }
    // 头一年：繁荣度与人口都不动，各月的参照逐月记下
    for m in 1..=12 {
        run(&mut w, 30, |_| {});
        let p = people(&w, ALPHA);
        assert_eq!((p.pop, p.prosperity), (p.pop0, Fx::from_int(50)), "第 {m} 月");
        assert_eq!(p.learned(), m == 12);
    }
    // 满足度：谷物是当地特产（库存高于目标，截断到 1），棉布与香料要靠进口（低于 1）
    let p = people(&w, ALPHA);
    assert_eq!(p.sat[0], Fx::ONE);
    assert!(p.sat[1] < Fx::from_pct(80) && p.sat[2] < Fx::from_pct(80), "{:?}", p.sat);
}

#[test]
fn a_well_supplied_port_prospers_and_grows() {
    let defs = defs_with(|_| {});
    let mut w = World::new(defs.clone(), ScenarioId(0), 2).unwrap();
    run(&mut w, 360, |_| {});
    let target_before = w.market(ALPHA, SPICE).unwrap().target;
    // 此后三年，舒适品与奢侈品一直供应充足
    let mut boom_seen = false;
    for _ in 0..36 {
        run(&mut w, 30, |w| {
            top_up(w, ALPHA, CLOTH, 120);
            top_up(w, ALPHA, SPICE, 120);
        });
        boom_seen |= people(&w, ALPHA).condition == Condition::Boom;
    }
    let p = people(&w, ALPHA);
    assert!(p.prosperity > Fx::from_int(80), "繁荣度 {:?}", p.prosperity);
    assert!(boom_seen && p.condition == Condition::Boom, "市况 {:?}", p.condition);
    // 人口：每月最多 +0.25%，三年约 +8%
    assert!(p.pop > p.pop0 * 105 / 100 && p.pop <= p.pop0 * 110 / 100, "人口 {} / {}", p.pop, p.pop0);
    // 繁荣让奢侈品的需求变大（目标库存乘需求层级系数与人口比例）
    let target_after = w.market(ALPHA, SPICE).unwrap().target;
    assert!(target_after > target_before * 15 / 10, "香料的目标库存 {target_before} → {target_after}");
    // 必需品的需求只随人口变
    let grain = w.market(ALPHA, GRAIN).unwrap();
    let base = development_target(&w, ALPHA, GRAIN);
    assert!(grain.target >= base && grain.target <= base * 111 / 100, "谷物的目标库存 {}（原本 {base}）", grain.target);
    // 其他港口没有被供货，照旧平稳
    assert_eq!(people(&w, BETA).condition, Condition::Stable);
}

/// 没有人口因素时的目标库存（发展度 × 日消耗 × 天数）。
fn development_target(w: &World, loc: LocId, good: GoodId) -> i64 {
    let e = w.market(loc, good).unwrap();
    let dev = w.state.locations[loc.idx()].development;
    market::development_factor(dev).apply(e.demand) * w.defs.rules.target_stock_days
}

#[test]
fn a_port_cut_off_from_its_staples_starves_and_shrinks() {
    let defs = defs_with(|_| {});
    let mut w = World::new(defs.clone(), ScenarioId(0), 3).unwrap();
    run(&mut w, 360, |_| {});
    // 此后两年，当地的谷物颗粒无收
    let mut famine_seen = false;
    let mut conditions = Vec::new();
    for _ in 0..24 {
        run(&mut w, 30, |w| w.state.locations[ALPHA.idx()].market.get_mut(&GRAIN).unwrap().event_supply = Fx::ZERO);
        let c = people(&w, ALPHA).condition;
        famine_seen |= c == Condition::Famine;
        conditions.push(c);
    }
    let p = people(&w, ALPHA);
    assert!(famine_seen, "市况 {conditions:?}");
    assert!(p.prosperity < Fx::from_int(20), "繁荣度 {:?}", p.prosperity);
    assert!(p.pop < p.pop0 * 97 / 100 && p.pop >= p.pop0 / 2, "人口 {} / {}", p.pop, p.pop0);
    assert!(p.sat[0] < Fx::from_pct(30), "必需品满足度 {:?}", p.sat);
    // 日志记下了饥荒
    assert!(
        w.state
            .log
            .iter()
            .any(|e| matches!(e.kind, log::LogKind::PortCondition { loc: ALPHA, condition: Condition::Famine }))
    );
}

#[test]
fn labour_scales_production_with_population() {
    // 同一个种子跑两遍：一遍人口减半（劳动力 0.5），比较铁一个月的产量
    let iron_month = |halve: bool| {
        let mut w = World::new(defs_with(|_| {}), ScenarioId(0), 11).unwrap();
        if halve {
            let p = &mut w.state.locations[ALPHA.idx()].people;
            p.pop = p.pop0 / 2;
        }
        let mut made = 0;
        run(&mut w, 30, |_| {});
        for _ in 0..30 {
            w.end_day().unwrap();
            made += w.market(ALPHA, IRON).unwrap().flow.produced;
        }
        made
    };
    let (full, half) = (iron_month(false), iron_month(true));
    assert!((full - 300).abs() < 30, "满员时铁一个月约 300 件：{full}");
    assert!((half * 2 - full).abs() < 30, "人口减半时产量减半：{half} / {full}");
}

#[test]
fn population_stays_within_its_bounds() {
    for (cut, seed) in [(false, 4), (true, 5)] {
        let defs = defs_with(|d| {
            d.rules.population.growth = Fx::from_pct(5);
            d.rules.population.min_ratio = Fx::from_pct(90);
            d.rules.population.max_ratio = Fx::from_pct(110);
        });
        let mut w = World::new(defs, ScenarioId(0), seed).unwrap();
        run(&mut w, 360, |_| {});
        let mut hit = false;
        for _ in 0..36 {
            run(&mut w, 30, |w| {
                if cut {
                    w.state.locations[ALPHA.idx()].market.get_mut(&GRAIN).unwrap().event_supply = Fx::ZERO;
                } else {
                    top_up(w, ALPHA, CLOTH, 150);
                    top_up(w, ALPHA, SPICE, 150);
                }
            });
            let p = people(&w, ALPHA);
            assert!(p.pop >= p.pop0 * 9 / 10 && p.pop <= p.pop0 * 11 / 10, "人口 {} / {}", p.pop, p.pop0);
            assert!(p.prosperity >= Fx::ZERO && p.prosperity <= Fx::from_int(100));
            hit |= p.pop == if cut { p.pop0 * 9 / 10 } else { p.pop0 * 11 / 10 };
        }
        assert!(hit, "三年里人口碰到了{}", if cut { "下限" } else { "上限" });
    }
}

#[test]
fn conditions_follow_their_thresholds_with_hysteresis() {
    let r = defs_with(|_| {}).rules.population.clone();
    let (ess, stock) = (Fx::ONE, Fx::ONE);
    let s = Fx::from_int;
    let next = |cur, e, p, st| next_condition(&r, cur, e, p, st);
    // 平稳时要越过进入门槛
    assert_eq!(next(Condition::Stable, ess, s(61), stock), Condition::Stable);
    assert_eq!(next(Condition::Stable, ess, s(63), stock), Condition::Boom);
    // 已经繁荣时，要跌破解除门槛才回到平稳
    assert_eq!(next(Condition::Boom, ess, s(59), stock), Condition::Boom);
    assert_eq!(next(Condition::Boom, ess, s(57), stock), Condition::Stable);
    assert_eq!(next(Condition::Stable, ess, s(37), stock), Condition::Depression);
    assert_eq!(next(Condition::Depression, ess, s(41), stock), Condition::Depression);
    assert_eq!(next(Condition::Depression, ess, s(43), stock), Condition::Stable);
    assert_eq!(next(Condition::Stable, ess, s(50), Fx::from_pct(111)), Condition::Glut);
    assert_eq!(next(Condition::Glut, ess, s(50), Fx::from_pct(106)), Condition::Glut);
    assert_eq!(next(Condition::Glut, ess, s(50), Fx::from_pct(104)), Condition::Stable);
    assert_eq!(next(Condition::Stable, Fx::from_pct(74), s(50), stock), Condition::Famine);
    assert_eq!(next(Condition::Famine, Fx::from_pct(84), s(50), stock), Condition::Famine);
    assert_eq!(next(Condition::Famine, Fx::from_pct(86), s(50), stock), Condition::Stable);
    // 先后：饥荒 > 萧条 > 繁荣 > 过剩；排在前面的市况可以直接取代后面的
    assert_eq!(next(Condition::Boom, Fx::from_pct(70), s(70), Fx::from_pct(120)), Condition::Famine);
    assert_eq!(next(Condition::Glut, ess, s(30), Fx::from_pct(120)), Condition::Depression);
    assert_eq!(next(Condition::Glut, ess, s(70), Fx::from_pct(120)), Condition::Boom);
    assert_eq!(next(Condition::Boom, ess, s(70), Fx::from_pct(120)), Condition::Boom);
    assert_eq!(next(Condition::Boom, ess, s(55), Fx::from_pct(120)), Condition::Glut);
}

#[test]
fn substitutes_share_the_demand_by_price_and_cushion_a_shortage() {
    // 让香料与谷物同属一组必需品（同一种需求）
    let defs = defs_with(|d| {
        d.goods[SPICE.idx()].need = Some(NeedTier::Essential);
        d.goods[GRAIN.idx()].group = Some(0);
        d.goods[SPICE.idx()].group = Some(0);
    });
    let mut w = World::new(defs.clone(), ScenarioId(0), 6).unwrap();
    run(&mut w, 360, |_| {});
    let mult = |w: &World, g: GoodId| people::substitute_mult(w.market(ALPHA, g).unwrap());
    // 平常年景：各自在正常价附近，需求按原来的份额（alpha 的谷物是特产、本来就便宜，不因此多分到需求）
    let (g0, s0) = (mult(&w, GRAIN), mult(&w, SPICE));
    for m in [g0, s0] {
        assert!(m > Fx::from_pct(90) && m < Fx::from_pct(110), "谷物 {g0:?} 香料 {s0:?}");
    }
    // 谷物断收：谷物比往常贵，需求转向香料
    run(&mut w, 120, |w| w.state.locations[ALPHA.idx()].market.get_mut(&GRAIN).unwrap().event_supply = Fx::ZERO);
    let (g1, s1) = (mult(&w, GRAIN), mult(&w, SPICE));
    assert!(g1 < Fx::from_pct(80) && s1 > Fx::from_pct(120), "谷物 {g0:?} → {g1:?}，香料 {s0:?} → {s1:?}");
    // 满足度按全组合计：只看谷物会跌得更深
    let e = w.market(ALPHA, GRAIN).unwrap();
    let grain_alone = Fx::ratio(e.stock, e.target).min(Fx::ONE);
    let (sat, _) = people::satisfaction(&w.defs, &w.state.locations[ALPHA.idx()]);
    assert!(Fx(sat[0]) > grain_alone, "全组 {:?} 谷物 {grain_alone:?}", Fx(sat[0]));
    // 单一商品最多满足八成：香料便宜到白送（库存堆成山）也分不走整组的需求
    let (dg, ds) = (w.market(ALPHA, GRAIN).unwrap().demand, w.market(ALPHA, SPICE).unwrap().demand);
    run(&mut w, 120, |w| {
        let e = w.state.locations[ALPHA.idx()].market.get_mut(&SPICE).unwrap();
        e.stock = e.stock.max(e.target * 8);
    });
    let spice_share = Fx::ratio(ds, dg + ds).mul(mult(&w, SPICE));
    assert!(spice_share > Fx::from_pct(70) && spice_share <= Fx::from_pct(81), "香料占这组需求的 {spice_share:?}");
    // 组里只有一种商品的地点（没有香料市场的地方）不做替代
    for (i, ls) in w.state.locations.iter().enumerate() {
        let groups = ls.market.keys().filter(|g| defs.good(**g).group.is_some()).count();
        if groups < 2 {
            assert!(ls.market.values().all(|e| e.subst_bp == 0), "{}", defs.locations[i].key);
        }
    }
}

#[test]
fn crew_is_hired_from_the_local_population() {
    let defs = defs_with(|d| {
        d.rules.population.per_development = 1;
        d.rules.population.min_ratio = Fx::from_pct(50);
    });
    let mut w = World::new(defs, ScenarioId(0), 7).unwrap();
    let f = fleet(&w);
    let pop0 = people(&w, ALPHA).pop0;
    assert_eq!(pop0, 50, "alpha 发展度 50，每点 1 人");
    ok(&mut w, Command::HireCrew { owner: P, fleet: f, count: 10 });
    assert_eq!(people(&w, ALPHA).pop, 40);
    // 不能招到下限（25 人）以下：拒绝且状态不变
    let before = w.state_hash();
    let e = Command::HireCrew { owner: P, fleet: f, count: 16 }.apply(&mut w).unwrap_err();
    assert!(e.to_string().contains("人手不足"), "{e}");
    assert_eq!(w.state_hash(), before);
    ok(&mut w, Command::HireCrew { owner: P, fleet: f, count: 2 });
    assert_eq!(people(&w, ALPHA).pop, 38);
    // 遣散的船员留在当地
    ok(&mut w, Command::DismissCrew { owner: P, fleet: f, count: 5 });
    assert_eq!(people(&w, ALPHA).pop, 43);
}

#[test]
fn switched_off_there_are_no_people_and_hiring_is_unlimited() {
    let defs = defs_with(|d| {
        d.rules.population.enabled = false;
        d.rules.population.per_development = 1;
    });
    let mut w = World::new(defs, ScenarioId(0), 8).unwrap();
    assert!(w.state.locations.iter().all(|l| l.people.is_unset()));
    assert!(!serde_json::to_string(&w.state).unwrap().contains("\"people\""));
    let f = fleet(&w);
    ok(&mut w, Command::HireCrew { owner: P, fleet: f, count: 12 });
    run(&mut w, 30, |_| {});
    assert!(w.state.locations.iter().all(|l| l.people.is_unset()));
}

#[test]
fn an_old_save_starts_learning_when_people_are_turned_on() {
    let off = defs_with(|d| d.rules.population.enabled = false);
    let mut w = World::new(off, ScenarioId(0), 9).unwrap();
    run(&mut w, 100, |_| {});
    let mut w = World::from_snapshot(defs_with(|_| {}), w.state.clone()).unwrap();
    let p = people(&w, ALPHA);
    assert_eq!((p.pop, p.prosperity), (p.pop0, Fx::from_int(50)));
    assert!(!p.learned());
    run(&mut w, 390, |_| {});
    assert!(people(&w, ALPHA).learned());
}

#[test]
fn people_are_saved_and_replayed() {
    let defs = defs_with(|_| {});
    let mut w = World::new(defs.clone(), ScenarioId(0), 10).unwrap();
    run(&mut w, 500, |_| {});
    assert!(people(&w, ALPHA).learned());
    let start = StartParams::new(ScenarioId(0), 10);
    let text = SaveFile::new(&defs, start.clone(), w.state.clone(), Vec::new()).to_json().unwrap();
    assert_eq!(SaveFile::from_json(&text).unwrap().snapshot, w.state);
    assert_eq!(replay(defs, start, &[], w.day()).unwrap().state_hash(), w.state_hash());
}
