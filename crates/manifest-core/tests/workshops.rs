//! 第八批 E4：城镇工坊（docs/ECONOMY.md 6.5）、补给口粮与委托交付（6.4）的受控实验。使用内核自带的小型世界，
//! 去掉 NPC 商会、随机的流行与目录事件。alpha 港设一座织布工坊（谷物 6 → 棉布 1，接手当地棉布均衡产量的一半）：
//! - 工坊从本地市场取原料、把产出放回，库存流量的恒等式包括工坊；家庭手工（本地生产者）的产能让出工坊的份额；
//! - 原料短缺传导到成品：谷物断收 → 工坊缺料少做 → 棉布涨价；
//! - 产出卖不掉（价值比跌破 1）时停工，行情回来后复工；产能按价值比伸缩、夹在界内；
//! - 补给的口粮从当地市场买（挑最便宜、库存够的一种），买不到时按固定价；委托交付的货物进入目的港市场；
//! - 旧存档打开工坊后生产者让出份额；存档往返与重放一致。

use manifest_core::contract::{ContractSource, ContractStatus, TransportContract};
use manifest_core::defs::WorkshopDef;
use manifest_core::market::UNIT_BP;
use manifest_core::replay::{StartParams, replay};
use manifest_core::save::SaveFile;
use manifest_core::testkit::{check_invariants, tiny_defs};
use manifest_core::warehouse::Holder;
use manifest_core::*;
use std::sync::Arc;

const P: OwnerId = OwnerId::Player;
const ALPHA: LocId = LocId(0);
const GRAIN: GoodId = GoodId(0);
const CLOTH: GoodId = GoodId(1);
const SPICE: GoodId = GoodId(2);
/// 小型世界的配方：1 号是织布（谷物 6 → 棉布 1）
const WEAVE: RecipeId = RecipeId(1);

/// 安静的小型世界：打开工坊、生产者与余数累计，alpha 设一座织布工坊；`tweak` 再做其他修改。
fn defs_with(tweak: impl FnOnce(&mut StaticData)) -> Arc<StaticData> {
    let mut d = (*tiny_defs()).clone();
    d.rules.workshops.enabled = true;
    d.rules.producers.enabled = true;
    d.rules.producers.fractional = true;
    d.companies.clear();
    d.meta.keys.companies.clear();
    d.rules.seasonal_popular_bp = 0;
    d.rules.pirates.spawn_scale = Fx::ZERO;
    for e in &mut d.events {
        e.max_per_year = 0;
    }
    d.locations[ALPHA.idx()].workshops = vec![WorkshopDef {
        recipe: WEAVE,
        output: CLOTH,
        out_qty: 1,
        inputs: vec![(GRAIN, 6)],
        share: Fx::from_pct(50),
    }];
    tweak(&mut d);
    Arc::new(d)
}

fn run(w: &mut World, days: u32, mut each: impl FnMut(&mut World)) {
    for _ in 0..days {
        each(w);
        w.end_day().unwrap();
        check_invariants(w).unwrap_or_else(|e| panic!("{e}"));
    }
}

fn entry(w: &World, good: GoodId) -> &world::MarketEntry {
    w.market(ALPHA, good).unwrap()
}

fn entry_mut(w: &mut World, good: GoodId) -> &mut world::MarketEntry {
    w.state.locations[ALPHA.idx()].market.get_mut(&good).unwrap()
}

fn shop(w: &World) -> &workshop::Workshop {
    w.workshop(ALPHA, WEAVE).expect("alpha 的织布工坊")
}

fn ok(w: &mut World, c: Command) -> CommandOutcome {
    c.apply(w).unwrap_or_else(|e| panic!("{c:?} 失败：{e}"))
}

#[test]
fn a_workshop_turns_local_inputs_into_outputs() {
    let mut w = World::new(defs_with(|_| {}), ScenarioId(0), 1).unwrap();
    run(&mut w, 1, |_| {});
    // 工坊接手棉布均衡产量（6 件 / 天）的一半，家庭手工（本地生产者）让出这一半
    assert_eq!(shop(&w).k0, 3 * UNIT_BP);
    assert_eq!(entry(&w, CLOTH).producer.k0, 3 * UNIT_BP);
    let (mut made, mut used) = (0, 0);
    for _ in 0..30 {
        let (cloth0, grain0) = (entry(&w, CLOTH).stock, entry(&w, GRAIN).stock);
        w.end_day().unwrap();
        let (c, g) = (&entry(&w, CLOTH).flow, &entry(&w, GRAIN).flow);
        // 库存流量的恒等式包括工坊的取用与产出（没有贸易）
        assert_eq!(entry(&w, CLOTH).stock - cloth0, c.produced - c.consumed + c.workshop_out - c.workshop_in);
        assert_eq!(entry(&w, GRAIN).stock - grain0, g.produced - g.consumed + g.workshop_out - g.workshop_in);
        made += c.workshop_out;
        used += g.workshop_in;
        assert_eq!(shop(&w).made, c.workshop_out);
    }
    assert!((made - 90).abs() <= 1, "一个月做了 {made} 件棉布（每天 3 件）");
    assert!((used - 6 * made).abs() <= 6, "用了 {used} 件谷物（每件棉布 6 件）");
    assert!(!shop(&w).short && !shop(&w).stopped);
}

#[test]
fn a_raw_material_shortage_passes_down_the_chain() {
    // 同一个种子跑两遍：一遍在第 60 天起谷物断收
    let run_with = |cut: bool| {
        let mut w = World::new(defs_with(|_| {}), ScenarioId(0), 2).unwrap();
        run(&mut w, 60, |_| {});
        // 断收期间：工坊缺料少做（原料不够）或停工（原料贵到亏本）的天数；最后一个月的产出
        let (mut made, mut idle_days) = (0, 0);
        for day in 0..120 {
            if cut {
                entry_mut(&mut w, GRAIN).event_supply = Fx::ZERO;
            }
            w.end_day().unwrap();
            check_invariants(&w).unwrap();
            idle_days += (shop(&w).short || shop(&w).stopped) as i64;
            if day >= 90 {
                made += entry(&w, CLOTH).flow.workshop_out;
            }
        }
        (made, idle_days, entry(&w, CLOTH).price, entry(&w, GRAIN).price)
    };
    let (made0, idle0, cloth0, grain0) = run_with(false);
    let (made1, idle1, cloth1, grain1) = run_with(true);
    assert!(grain1 > grain0 * 2, "谷物断收后涨价：{grain0} → {grain1}");
    assert_eq!(idle0, 0, "照常供货时工坊不缺料、不停工");
    assert!(idle1 > 30 && made1 * 2 < made0, "工坊缺料或停工 {idle1} 天，最后一个月的产出 {made0} → {made1}");
    assert!(cloth1 * 10 > cloth0 * 12, "成品随之涨价：棉布 {cloth0} → {cloth1}");
}

#[test]
fn a_losing_workshop_stops_and_restarts() {
    let mut w = World::new(defs_with(|_| {}), ScenarioId(0), 3).unwrap();
    run(&mut w, 30, |_| {});
    // 棉布卖不掉：库存堆到目标库存的 6 倍，价值比跌破 1，月末停工
    run(&mut w, 60, |w| {
        let e = entry_mut(w, CLOTH);
        e.stock = e.stock.max(e.target * 6);
    });
    assert!(shop(&w).stopped, "价值比 {:?}", shop(&w).ratio);
    assert!(shop(&w).ratio < Fx::ONE);
    run(&mut w, 1, |_| {});
    assert_eq!(shop(&w).made, 0, "停工时不取原料、不出货");
    assert_eq!(entry(&w, GRAIN).flow.workshop_in, 0);
    // 积压消化之后价格回来，复工
    let mut restarted = None;
    for m in 1..=12 {
        run(&mut w, 30, |_| {});
        if !shop(&w).stopped {
            restarted = Some(m);
            break;
        }
    }
    assert!(restarted.is_some(), "一年之内应复工");
    assert!(shop(&w).ratio >= Fx::from_pct(105));
}

#[test]
fn workshop_capacity_follows_the_value_ratio_within_bounds() {
    let defs = defs_with(|d| d.rules.workshops.max_ratio = Fx::from_pct(150));
    let mut w = World::new(defs, ScenarioId(0), 4).unwrap();
    run(&mut w, 360, |_| {});
    assert!(shop(&w).learned());
    let k0 = shop(&w).k0;
    // 棉布长期紧俏（每天被买走一半库存），价值比高于往常，工坊扩产，直到上限
    for _ in 0..48 {
        run(&mut w, 30, |w| {
            let e = entry_mut(w, CLOTH);
            e.stock /= 2;
        });
        let k = shop(&w).k;
        assert!(k >= k0 / 5 && k <= k0 * 3 / 2, "产能 {k}（开局 {k0}）");
    }
    assert_eq!(shop(&w).k, k0 * 3 / 2, "产能扩到上限");
}

#[test]
fn switching_workshops_on_makes_the_producers_hand_over_their_share() {
    let off = defs_with(|d| d.rules.workshops.enabled = false);
    let mut w = World::new(off, ScenarioId(0), 5).unwrap();
    run(&mut w, 100, |_| {});
    assert_eq!(entry(&w, CLOTH).producer.k0, 6 * UNIT_BP);
    assert!(w.state.locations.iter().all(|l| l.workshops.is_empty()));
    assert!(!serde_json::to_string(&w.state).unwrap().contains("\"workshops\""));
    // 旧存档打开工坊：生产者的开局产能与现有产能按比例让出一半
    let k = entry(&w, CLOTH).producer.k;
    let mut w = World::from_snapshot(defs_with(|_| {}), w.state.clone()).unwrap();
    run(&mut w, 1, |_| {});
    let p = &entry(&w, CLOTH).producer;
    assert_eq!(p.k0, 3 * UNIT_BP);
    assert!((p.k - k / 2).abs() <= 1, "{} → {}", k, p.k);
    assert_eq!(shop(&w).k0, 3 * UNIT_BP);
}

#[test]
fn workshops_are_saved_and_replayed() {
    let defs = defs_with(|_| {});
    let mut w = World::new(defs.clone(), ScenarioId(0), 6).unwrap();
    run(&mut w, 400, |_| {});
    assert!(shop(&w).learned());
    let start = StartParams::new(ScenarioId(0), 6);
    let text = SaveFile::new(&defs, start.clone(), w.state.clone(), Vec::new()).to_json().unwrap();
    assert_eq!(SaveFile::from_json(&text).unwrap().snapshot, w.state);
    assert_eq!(replay(defs, start, &[], w.day()).unwrap().state_hash(), w.state_hash());
}

// ───────────────────────────── 补给口粮与委托交付 ─────────────────────────────

fn provisions_on(d: &mut StaticData) {
    d.rules.provisions.local = true;
    d.rules.provisions.goods = vec![GRAIN, SPICE];
    d.rules.provisions.rations = 4;
}

fn fleet(w: &World) -> FleetId {
    w.fleets_of(P).next().unwrap().id
}

#[test]
fn provisions_come_from_the_cheapest_local_staple() {
    let mut w = World::new(defs_with(provisions_on), ScenarioId(0), 7).unwrap();
    let f = fleet(&w);
    let (cash, stock, spice) = (w.agent(P).unwrap().cash, entry(&w, GRAIN).stock, entry(&w, SPICE).stock);
    let food = w.fleet(f).unwrap().food;
    let (food_cost, q) = market::provisions_quote(&w, ALPHA, 38);
    let q = q.expect("谷物比香料便宜、库存够");
    assert_eq!((q.good, q.qty), (GRAIN, 10), "38 份口粮要 10 件谷物（一件 4 份）");
    assert!(food_cost < 38 * w.defs.rules.food_price, "特产港的谷物比固定价便宜：{food_cost}");
    ok(&mut w, Command::Resupply { owner: P, fleet: f, food: 38, water: 20 });
    assert_eq!(w.agent(P).unwrap().cash, cash - food_cost - 20 * w.defs.rules.water_price);
    assert_eq!(entry(&w, GRAIN).stock, stock - 10);
    assert_eq!(entry(&w, SPICE).stock, spice);
    assert_eq!(entry(&w, GRAIN).flow.player_bought, 10);
    assert_eq!(w.fleet(f).unwrap().food, food + 38);
    check_invariants(&w).unwrap();
    // 谷物卖空了：换香料；两样都买不到时按固定价
    entry_mut(&mut w, GRAIN).stock = 3;
    let (_, q) = market::provisions_quote(&w, ALPHA, 38);
    assert_eq!(q.map(|q| q.good), Some(SPICE));
    entry_mut(&mut w, SPICE).stock = 0;
    let (cost, q) = market::provisions_quote(&w, ALPHA, 38);
    assert!(q.is_none());
    assert_eq!(cost, 38 * w.defs.rules.food_price);
    // 规则关闭：一律固定价，不动市场
    let mut w = World::new(defs_with(|_| {}), ScenarioId(0), 7).unwrap();
    let stock = entry(&w, GRAIN).stock;
    let f = fleet(&w);
    ok(&mut w, Command::Resupply { owner: P, fleet: f, food: 38, water: 0 });
    assert_eq!(entry(&w, GRAIN).stock, stock);
}

#[test]
fn contract_deliveries_enter_the_destination_market() {
    for to_market in [true, false] {
        let mut w =
            World::new(defs_with(|d| d.rules.contracts.deliver_to_market = to_market), ScenarioId(0), 8).unwrap();
        let f = fleet(&w);
        let id = ContractId(900);
        w.state.contracts.insert(
            id,
            TransportContract {
                id,
                issuer: FactionId(0),
                good: SPICE,
                qty: 2,
                to: ALPHA,
                deadline: 60,
                reward: 500,
                penalty: 100,
                status: ContractStatus::Accepted(P),
                source: ContractSource::Rule,
                small: false,
                source_port: None,
                cells: 0,
                need_days: 0,
                urgency_bp: 0,
            },
        );
        ok(&mut w, Command::Buy { owner: P, fleet: f, good: SPICE, qty: 2, max_total: None });
        let before = entry(&w, SPICE).stock;
        ok(&mut w, Command::DeliverContract { owner: P, contract: id, holder: Holder::Fleet(f) });
        assert_eq!(w.state.contracts[&id].status, ContractStatus::Completed(P));
        let after = entry(&w, SPICE);
        if to_market {
            assert_eq!((after.stock, after.flow.delivered), (before + 2, 2), "交付的香料进了 alpha 的市场");
        } else {
            assert_eq!((after.stock, after.flow.delivered), (before, 0), "规则关闭：交付的货物直接消失（同旧版）");
        }
        check_invariants(&w).unwrap();
    }
}
