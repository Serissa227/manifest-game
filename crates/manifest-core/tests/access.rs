//! 商馆、货档与商誉（T01，`rules.toml [access]`，`manifest_core::access`）在小型世界里的检查：
//! - 货档不够时拒买（`trade.rank`，世界不变），同一种货照常卖得掉；询价给出同样的拒绝；
//! - 商誉 = 声望 + 商馆加成：声望涨上去或商馆升级后逐档放开；同盟港的主人、手上有委托要的货、每港保底的货不看商誉；
//! - 商会各地商誉有起步值，本据势力的港口全开；规划器不拿锁着的货打算盘；
//! - 两处漏洞：没人投过的港口投最低额就成同盟港、每笔最低额投资保底 +1 声望——规则关闭（经典）时照旧，打开后堵上；
//! - 商馆的税率与同盟港的税率取更低的一个、免费仓位取更多的一个；发展度衰减放慢到每 6 个月 1 点；
//! - 市场深度曲线：发展度 50 以下与线性公式逐值相同、50 处相接，产量与目标库存同乘（均衡不变）；
//! - 没有这套状态的旧存档读入后有宽限期；规则关闭时世界状态里没有新字段、逐日相同；命令日志重放一致。

use manifest_core::contract::{ContractSource, ContractStatus, TransportContract};
use manifest_core::fixed::Curve;
use manifest_core::market::{Side, depth_boost, depth_factor, development_factor, quote, tax_rate};
use manifest_core::testkit::{check_invariants, tiny_defs};
use manifest_core::warehouse::Holder;
use manifest_core::*;
use std::sync::Arc;

const P: OwnerId = OwnerId::Player;
const GULL: OwnerId = OwnerId::Company(CompanyId(0));
const ANCHOR: OwnerId = OwnerId::Company(CompanyId(1));
const ALPHA: LocId = LocId(0);
const BETA: LocId = LocId(1);
const GRAIN: GoodId = GoodId(0);
const CLOTH: GoodId = GoodId(1);
const SPICE: GoodId = GoodId(2);
const IRON: GoodId = GoodId(3);

/// 小型世界打开商馆规则：谷物 0 档、棉布 1 档、香料 3 档、铁（军需）2 档；不设保底（单独一条测试看保底）。
fn defs_on() -> StaticData {
    let mut d = (*tiny_defs()).clone();
    d.rules.access.enabled = true;
    d.rules.access.floor_goods = 0;
    d.goods[CLOTH.idx()].rank = 1;
    d.goods[SPICE.idx()].rank = 3;
    d.goods[IRON.idx()].rank = 2;
    d
}

fn world_on() -> World {
    World::new(Arc::new(defs_on()), ScenarioId(0), 7).expect("开局")
}

/// 同一个世界，开局本金两百万（够把商馆投到顶；直接改现金会和账本对不上）。
fn world_rich() -> World {
    let mut d = defs_on();
    d.scenarios[0].cash = 2_000_000;
    World::new(Arc::new(d), ScenarioId(0), 7).expect("开局")
}

fn fleet(w: &World) -> FleetId {
    w.fleets_of(P).next().expect("玩家舰队").id
}

fn ok(w: &mut World, c: Command) -> CommandOutcome {
    c.apply(w).unwrap_or_else(|e| panic!("{c:?} 失败：{e}"))
}

fn buy(w: &World, good: GoodId, qty: i64) -> Command {
    Command::Buy { owner: P, fleet: fleet(w), good, qty, max_total: None }
}

fn buy_ok(w: &mut World, good: GoodId, qty: i64) {
    let c = buy(w, good, qty);
    ok(w, c);
}

fn buy_refused(w: &mut World, good: GoodId, qty: i64, code: &str) -> CommandError {
    let c = buy(w, good, qty);
    refused(w, c, code)
}

fn set_reputation(w: &mut World, owner: OwnerId, faction: FactionId, value: i64) {
    w.state.agents.get_mut(&owner).unwrap().reputation.insert(faction, value);
}

/// 被拒：错误码相符、世界状态逐位不变。
fn refused(w: &mut World, c: Command, code: &str) -> CommandError {
    let before = w.state_hash();
    let e = c.apply(w).expect_err("应被拒绝");
    assert_eq!(e.code(), code, "{e}");
    assert_eq!(w.state_hash(), before, "被拒的命令不改变世界");
    e
}

// ───────────────────────────── 货档：只锁买，不锁卖 ─────────────────────────────

#[test]
fn a_rank_above_your_goodwill_refuses_the_buy_and_leaves_the_world_untouched_but_you_can_still_sell() {
    let mut w = world_on();
    let f0 = w.location_faction(ALPHA);
    assert_eq!(w.goodwill(P, ALPHA), 5, "开局声望 5、没有商馆");
    // 0 档照常买
    buy_ok(&mut w, GRAIN, 5);
    // 1 档要商誉 10、3 档要 60：都被拒，世界不变
    let e = buy_refused(&mut w, CLOTH, 2, "trade.rank");
    let args = e.args();
    let arg = |name: &str| args.iter().find(|(n, _)| *n == name).map(|(_, v)| v.clone());
    assert_eq!(arg("need"), Some(TextArg::Int(10)));
    assert_eq!(arg("have"), Some(TextArg::Int(5)));
    assert_eq!(arg("short"), Some(TextArg::Int(5)));
    buy_refused(&mut w, SPICE, 1, "trade.rank");
    // 询价给出同样的拒绝；卖出的询价不受影响
    assert_eq!(quote(&w, P, ALPHA, CLOTH, Side::Buy, 2).unwrap_err().code(), "trade.rank");
    assert!(quote(&w, P, ALPHA, SPICE, Side::Sell, 2).is_ok());
    // 手上已经有的香料（剧情给的、别处买来的、商誉还够时买下的）照常卖得掉
    let fid = fleet(&w);
    set_reputation(&mut w, P, f0, 60);
    buy_ok(&mut w, SPICE, 4);
    set_reputation(&mut w, P, f0, 5);
    buy_refused(&mut w, SPICE, 1, "trade.rank");
    let cash = w.agent(P).unwrap().cash;
    ok(&mut w, Command::Sell { owner: P, fleet: fid, good: SPICE, qty: 4, min_total: None });
    assert!(w.agent(P).unwrap().cash > cash);
    assert_eq!(w.fleet(fid).unwrap().cargo.get(&SPICE), None);
    // 仓库买入走同一条校验
    ok(&mut w, Command::RentWarehouse { owner: P, loc: ALPHA, capacity: 50 });
    refused(
        &mut w,
        Command::BuyInto { owner: P, holder: Holder::Warehouse(ALPHA), good: CLOTH, qty: 1, max_total: None },
        "trade.rank",
    );
    // 声望涨到 10：1 档放开，3 档仍锁
    set_reputation(&mut w, P, f0, 10);
    buy_ok(&mut w, CLOTH, 2);
    buy_refused(&mut w, SPICE, 1, "trade.rank");
    check_invariants(&w).unwrap();
}

#[test]
fn military_goods_still_need_the_licence_on_top_of_the_rank() {
    let mut w = world_on();
    let f0 = w.location_faction(ALPHA);
    // 没有许可证：先报许可证（与旧版同一处）
    buy_refused(&mut w, IRON, 1, "trade.license");
    w.state.agents.get_mut(&P).unwrap().licenses.push(f0);
    // 有了许可证，商誉不够照样买不了
    buy_refused(&mut w, IRON, 1, "trade.rank");
    set_reputation(&mut w, P, f0, 30);
    buy_ok(&mut w, IRON, 1);
}

#[test]
fn a_trading_house_adds_goodwill_level_by_level() {
    let mut w = world_rich();
    let f0 = w.location_faction(ALPHA);
    set_reputation(&mut w, P, f0, 0);
    let r = w.defs.rules.access.clone();
    // 累计投资到各级门槛：商誉加成 0 / 10 / 25 / 45 / 70
    let mut invested = 0;
    for level in 1..=4usize {
        let need = w.house_threshold(ALPHA, level).unwrap();
        ok(&mut w, Command::InvestPort { owner: P, loc: ALPHA, amount: need - invested });
        invested = need;
        assert_eq!(w.house_level(P, ALPHA), level);
        // 投资也涨声望（每累计两万一点），商誉 = 声望 + 商馆加成
        let rep = w.reputation(P, f0);
        assert_eq!(rep, invested / 20_000, "累计 {invested}");
        assert_eq!(w.goodwill(P, ALPHA), rep + r.house_goodwill[level]);
        // 商馆只管这一座港口：别处的商誉只有声望
        assert_eq!(w.goodwill(P, LocId(2)), rep);
    }
    // 1 级（+10）开 1 档；4 级（+70）开到 3 档
    assert!(w.rank_gate(P, ALPHA, SPICE).is_none());
    assert!(w.rank_gate(P, LocId(2), SPICE).is_some(), "没有商馆的港口仍照声望");
}

#[test]
fn goods_wanted_by_an_accepted_contract_are_sold_to_you_regardless_of_rank() {
    let mut w = world_on();
    buy_refused(&mut w, SPICE, 1, "trade.rank");
    let id = ContractId(900);
    let mut contract = TransportContract {
        id,
        issuer: FactionId(0),
        good: SPICE,
        qty: 3,
        to: BETA,
        deadline: 200,
        reward: 500,
        penalty: 100,
        status: ContractStatus::Open,
        source: ContractSource::Ai,
        small: false,
        source_port: None,
        cells: 0,
        need_days: 0,
        urgency_bp: 0,
    };
    // 挂着没接的委托不算
    w.state.contracts.insert(id, contract.clone());
    assert!(w.rank_gate(P, ALPHA, SPICE).is_some());
    // 别人接的也不算
    contract.status = ContractStatus::Accepted(GULL);
    w.state.contracts.insert(id, contract.clone());
    assert!(w.rank_gate(P, ALPHA, SPICE).is_some());
    // 自己接了：这种货放行（别的货照旧）
    contract.status = ContractStatus::Accepted(P);
    w.state.contracts.insert(id, contract);
    assert_eq!(w.errand_goods(P), vec![SPICE]);
    buy_ok(&mut w, SPICE, 1);
    buy_refused(&mut w, CLOTH, 1, "trade.rank");
}

#[test]
fn each_port_keeps_its_cheapest_few_sale_goods_open() {
    let mut d = defs_on();
    // 让谷物也有档位：alpha 出售的四种货全有门槛
    d.goods[GRAIN.idx()].rank = 1;
    d.rules.access.floor_goods = 2;
    let w = World::new(Arc::new(d), ScenarioId(0), 7).unwrap();
    // 保底取货档最低、同档基准价最低的两种（军需除外）：谷物（1 档、12）与棉布（1 档、80）
    assert_eq!(manifest_core::access::floor_goods(&w.defs, ALPHA), vec![GRAIN, CLOTH]);
    let access = w.buy_access(P, ALPHA);
    assert_eq!((access.need(&w.defs, GRAIN), access.need(&w.defs, CLOTH)), (0, 0));
    assert!(access.gate(&w.defs, GRAIN).is_none() && access.gate(&w.defs, CLOTH).is_none());
    assert!(access.gate(&w.defs, SPICE).is_some());
    // 本来就是 0 档的不占保底的说明（返回的只有原本有门槛的）
    let mut d2 = defs_on();
    d2.rules.access.floor_goods = 2;
    let w2 = World::new(Arc::new(d2), ScenarioId(0), 7).unwrap();
    assert_eq!(manifest_core::access::floor_goods(&w2.defs, ALPHA), vec![CLOTH]);
}

// ───────────────────────────── 商会 ─────────────────────────────

#[test]
fn companies_start_with_goodwill_everywhere_and_are_free_under_their_home_flag() {
    let w = world_on();
    // gull 本据 alpha（势力 0）：同一势力的港口全开
    assert!(w.buy_access(GULL, ALPHA).free() && w.buy_access(GULL, LocId(2)).free());
    for g in [GRAIN, CLOTH, SPICE, IRON] {
        assert!(w.rank_gate(GULL, ALPHA, g).is_none());
    }
    // 在别的势力的港口（beta，势力 1）：商誉 30 起步——2 档以内放开，3 档的香料要再攒声望
    assert_eq!(w.goodwill(GULL, BETA), 30);
    assert!(w.rank_gate(GULL, BETA, CLOTH).is_none() && w.rank_gate(GULL, BETA, IRON).is_none());
    assert_eq!(w.rank_gate(GULL, BETA, SPICE).map(|g| (g.need, g.have)), Some((60, 30)));
    // anchor 本据 beta：反过来
    assert!(w.rank_gate(ANCHOR, BETA, SPICE).is_none() && w.rank_gate(ANCHOR, ALPHA, SPICE).is_some());
}

#[test]
fn the_planner_never_plans_around_goods_it_cannot_buy() {
    use manifest_core::npc::{PlannerParams, plan_load};
    use manifest_core::rng::{Domain, Rng};
    // beta 是香料的产地（12/4）：没有货档时，从 beta 出发的船多半装香料
    let run = |defs: StaticData| {
        let mut w = World::new(Arc::new(defs), ScenarioId(0), 3).unwrap();
        // 把 gull 的船挪到 beta（别的势力的港口）
        let fid = w.fleets_of(GULL).next().unwrap().id;
        w.state.fleets.get_mut(&fid).unwrap().location = manifest_core::world::FleetLocation::Docked(BETA);
        let params = PlannerParams::for_owner(&w, GULL);
        let mut goods = std::collections::BTreeSet::new();
        for salt in 0..40u64 {
            let mut rng = Rng::derive(3, 0, Domain::Scenario, fid.0 as u64, salt);
            for c in plan_load(&w, fid, &params, &mut rng).commands {
                if let Command::Buy { good, .. } = c {
                    goods.insert(good);
                    assert!(c.validate(&w).is_ok(), "规划出来的买入要过得了校验：{c:?}");
                }
            }
        }
        goods
    };
    let off = run((*tiny_defs()).clone());
    assert!(off.contains(&SPICE), "没有货档时会装香料：{off:?}");
    let on = run(defs_on());
    assert!(!on.contains(&SPICE), "香料（3 档）在别人的港口买不到，不该出现在计划里：{on:?}");
    assert!(!on.is_empty(), "锁住珍货之后仍有生意可做");
}

// ───────────────────────────── 两处漏洞 ─────────────────────────────

/// 漏洞一：没人投过的港口，投最低额就占 100%、立刻成同盟港。规则关闭时照旧（证实漏洞），打开后要商馆 4 级。
#[test]
fn the_minimum_investment_no_longer_buys_an_ally_port() {
    let min = tiny_defs().rules.invest.min_amount;
    // 规则关闭（经典世界）：1000 金就是同盟港
    let mut classic = World::new(tiny_defs(), ScenarioId(0), 7).unwrap();
    ok(&mut classic, Command::InvestPort { owner: P, loc: ALPHA, amount: min });
    assert_eq!(classic.state.locations[0].ally, Some(P), "旧规则：投最低额就成同盟港");
    // 规则打开：占有率 100% 也不够，要商馆够级
    let mut w = world_rich();
    let tax = tax_rate(&w, P, ALPHA);
    ok(&mut w, Command::InvestPort { owner: P, loc: ALPHA, amount: min });
    assert_eq!(w.investment_share(P, ALPHA), Fx::ONE);
    assert_eq!(w.state.locations[0].ally, None, "新规则：最低额换不来同盟港");
    assert_eq!(tax_rate(&w, P, ALPHA), tax, "也没有税率优惠");
    assert_eq!(w.warehouse_capacity(P, ALPHA), 0, "也没有免费仓位");
    // 投到商馆 4 级（135,000）才是同盟港
    let need = w.house_threshold(ALPHA, 4).unwrap();
    ok(&mut w, Command::InvestPort { owner: P, loc: ALPHA, amount: need - min - 1 });
    assert_eq!(w.state.locations[0].ally, None, "差 1 金币不到 4 级");
    ok(&mut w, Command::InvestPort { owner: P, loc: ALPHA, amount: min });
    assert_eq!(w.house_level(P, ALPHA), 4);
    assert_eq!(w.state.locations[0].ally, Some(P));
    // 同盟港的主人全档可买
    assert!(w.buy_access(P, ALPHA).free());
    check_invariants(&w).unwrap();
}

/// 漏洞二：每笔最低额的投资都保底 +1 声望。规则关闭时照旧（证实漏洞），打开后按同一港口的累计额每两万一点。
#[test]
fn splitting_an_investment_into_minimum_slices_no_longer_farms_reputation() {
    let min = tiny_defs().rules.invest.min_amount;
    let f0 = FactionId(0);
    let mut classic = World::new(tiny_defs(), ScenarioId(0), 7).unwrap();
    let before = classic.reputation(P, f0);
    for _ in 0..10 {
        ok(&mut classic, Command::InvestPort { owner: P, loc: ALPHA, amount: min });
    }
    assert_eq!(classic.reputation(P, f0) - before, 10, "旧规则：一万金拆成十笔，声望 +10");
    let mut w = world_on();
    let before = w.reputation(P, f0);
    for _ in 0..10 {
        ok(&mut w, Command::InvestPort { owner: P, loc: ALPHA, amount: min });
    }
    assert_eq!(w.reputation(P, f0) - before, 0, "新规则：累计一万，不到两万不涨");
    for _ in 0..10 {
        ok(&mut w, Command::InvestPort { owner: P, loc: ALPHA, amount: min });
    }
    assert_eq!(w.reputation(P, f0) - before, 1, "累计满两万 +1，拆不拆都一样");
    let mut whole = world_on();
    ok(&mut whole, Command::InvestPort { owner: P, loc: ALPHA, amount: 20 * min });
    assert_eq!(whole.reputation(P, f0) - before, 1);
}

#[test]
fn trading_earns_reputation_by_turnover_so_small_traders_get_somewhere() {
    // 旧规则：单笔成交额不到 5000 的生意永远不涨声望
    let mut classic = World::new(tiny_defs(), ScenarioId(0), 7).unwrap();
    let f0 = FactionId(0);
    let fid = fleet(&classic);
    let before = classic.reputation(P, f0);
    for _ in 0..8 {
        ok(&mut classic, Command::Buy { owner: P, fleet: fid, good: GRAIN, qty: 30, max_total: None });
        ok(&mut classic, Command::Sell { owner: P, fleet: fid, good: GRAIN, qty: 30, min_total: None });
    }
    assert_eq!(classic.reputation(P, f0), before);
    // 新规则：成交额累计，第 n 点要 2000 × (1 + n / 10)
    let mut w = world_on();
    let fid = fleet(&w);
    let mut turnover = 0;
    for _ in 0..60 {
        for c in [
            Command::Buy { owner: P, fleet: fid, good: GRAIN, qty: 30, max_total: None },
            Command::Sell { owner: P, fleet: fid, good: GRAIN, qty: 30, min_total: None },
        ] {
            if let CommandOutcome::Traded(q) = ok(&mut w, c) {
                turnover += q.gross;
            }
        }
    }
    // 从声望 5 起算：第 6 点要 3000，第 7 点 3200……
    let mut rep = before;
    let mut left = turnover;
    loop {
        let need = 2_000 + 2_000 * rep / 10;
        if left < need {
            break;
        }
        left -= need;
        rep += 1;
    }
    assert!(rep > before, "成交额 {turnover} 应当攒出声望");
    assert_eq!(w.reputation(P, f0), rep);
    assert_eq!(w.state.agents[&P].trade_turnover.get(&f0).copied().unwrap_or(0), left);
    check_invariants(&w).unwrap();
}

// ───────────────────────────── 税、仓位、衰减 ─────────────────────────────

#[test]
fn house_tax_and_ally_tax_do_not_stack_and_free_storage_takes_the_larger() {
    let mut w = world_rich();
    let f0 = w.location_faction(ALPHA);
    let r = w.defs.rules.access.clone();
    assert!(tax_rate(&w, P, ALPHA).raw() > 0);
    // 声望也降税：把它固定住，只看商馆的乘数
    let mut rates = Vec::new();
    let mut invested = 0;
    for level in 0..=3usize {
        let need = w.house_threshold(ALPHA, level).unwrap();
        if need > invested {
            ok(&mut w, Command::InvestPort { owner: P, loc: ALPHA, amount: need - invested });
            invested = need;
        }
        set_reputation(&mut w, P, f0, 0);
        rates.push(tax_rate(&w, P, ALPHA));
        assert_eq!(w.warehouse_capacity(P, ALPHA), r.house_storage[level], "{level} 级的免费仓位");
    }
    let base = rates[0];
    assert_eq!(rates[1], base, "1 级不降税");
    assert_eq!(rates[2], base.mul(r.house_tax[2]));
    assert_eq!(rates[3], base.mul(r.house_tax[3]));
    // 4 级 + 同盟港：税率取两者里更低的一个（都是 0.5），不叠乘成 0.25；仓位取更多的一个，不相加
    let need = w.house_threshold(ALPHA, 4).unwrap();
    ok(&mut w, Command::InvestPort { owner: P, loc: ALPHA, amount: need - invested });
    set_reputation(&mut w, P, f0, 0);
    assert_eq!(w.state.locations[0].ally, Some(P));
    let both = r.house_tax[4].min(w.defs.rules.invest.ally_tax);
    assert_eq!(tax_rate(&w, P, ALPHA), base.mul(both));
    let free = r.house_storage[4].max(w.defs.rules.warehouse.ally_free_capacity);
    assert_eq!(w.warehouse_capacity(P, ALPHA), free);
    // 有免费仓位就能直接往里买货、建产业，不用另租仓库
    ok(&mut w, Command::BuyInto { owner: P, holder: Holder::Warehouse(ALPHA), good: GRAIN, qty: 10, max_total: None });
    assert_eq!(w.holder_qty(P, Holder::Warehouse(ALPHA), GRAIN), 10);
    // 滞仓费也按同一个容量算：没超出就不收
    let cash = w.agent(P).unwrap().cash;
    w.end_day().unwrap();
    assert!(w.agent(P).unwrap().cash >= cash - 200, "没有按超出容量收滞仓费");
    check_invariants(&w).unwrap();
}

#[test]
fn development_above_the_start_decays_only_every_few_months() {
    let months = |every: u32| {
        let mut d = defs_on();
        d.rules.invest.decay_months = every;
        let mut w = World::new(Arc::new(d), ScenarioId(0), 7).unwrap();
        w.state.locations[0].development = 80;
        let year = w.defs.calendar.year_days();
        for _ in 0..year {
            w.end_day().unwrap();
        }
        80 - w.state.locations[0].development
    };
    assert_eq!(months(1), 12, "每月 1 点（旧规则）");
    assert_eq!(months(6), 2, "每 6 个月 1 点");
}

// ───────────────────────────── 市场深度 ─────────────────────────────

fn terra_curve() -> Curve {
    Curve::new(vec![
        (Fx::from_int(50), Fx::ONE),
        (Fx::from_int(75), Fx::from_pct(160)),
        (Fx::from_int(100), Fx::from_pct(240)),
    ])
}

#[test]
fn the_depth_curve_matches_the_old_formula_up_to_fifty_and_is_continuous_there() {
    let plain = tiny_defs();
    let mut d = (*plain).clone();
    d.rules.depth_curve = Some(terra_curve());
    for dev in -5..=110 {
        // 没有曲线：就是线性公式
        assert_eq!(depth_factor(&plain, dev), development_factor(dev), "发展度 {dev}");
        assert_eq!(depth_boost(&plain, dev), Fx::ONE);
        // 有曲线：50 以下逐值相同
        if dev <= 50 {
            assert_eq!(depth_factor(&d, dev), development_factor(dev), "发展度 {dev}");
            assert_eq!(depth_boost(&d, dev), Fx::ONE);
        }
    }
    // 50 处相接，之后更陡：50 → 1.0、75 → 1.6、100 → 2.4，逐点单调
    assert_eq!(depth_factor(&d, 50), Fx::ONE);
    assert_eq!(depth_factor(&d, 51), Fx(10_240));
    assert_eq!(depth_factor(&d, 75), Fx::from_pct(160));
    assert_eq!(depth_factor(&d, 76), Fx(16_320));
    assert_eq!(depth_factor(&d, 100), Fx::from_pct(240));
    for dev in 1..100 {
        assert!(depth_factor(&d, dev + 1) > depth_factor(&d, dev));
    }
    // 工坊跟上的倍数 = 曲线 / 线性
    assert_eq!(depth_boost(&d, 100), Fx::ratio(24_000, 14_000));
}

#[test]
fn a_deeper_market_scales_output_and_target_stock_together() {
    const DELTA: LocId = LocId(3);
    // delta 是内陆城市：没有商船来往，市场只随本地的产销走
    let world_at = |curve: Option<Curve>, dev: i64| {
        let mut d = (*tiny_defs()).clone();
        d.rules.depth_curve = curve;
        d.rules.production_noise_bp = 0;
        // 产销按万分之一件累计（寰宇也是这样）：小世界一天只有几件的货不会被整件取整带偏均衡
        d.rules.producers.fractional = true;
        d.locations[DELTA.idx()].development = dev;
        World::new(Arc::new(d), ScenarioId(0), 5).unwrap()
    };
    // 第一天：产量与目标库存都是线性公式下的 2.4 / 1.4 倍（发展度 100）；发展度 50 时有没有曲线都一样
    for (dev, num, den) in [(50, 1, 1), (100, 24, 14)] {
        let (mut old, mut new) = (world_at(None, dev), world_at(Some(terra_curve()), dev));
        old.end_day().unwrap();
        new.end_day().unwrap();
        for g in [GRAIN, CLOTH, SPICE, IRON] {
            let (a, b) = (old.market(DELTA, g).unwrap(), new.market(DELTA, g).unwrap());
            // 目标库存 = ⌊系数 × 日消耗⌉ × 30 天（整件取整，所以按公式逐项核对，而不是直接比倍数）
            assert_eq!(a.target, development_factor(dev).apply(a.demand) * 30, "发展度 {dev} {g:?} 的目标库存（线性）");
            assert_eq!(b.target, depth_factor(&new.defs, dev).apply(b.demand) * 30, "发展度 {dev} {g:?} 的目标库存");
            assert!((b.flow.produced * den - a.flow.produced * num).abs() <= den, "发展度 {dev} {g:?} 的产量");
        }
        if dev == 50 {
            assert_eq!(old.state_hash(), new.state_hash(), "发展度都不高于 50 时逐位相同");
        }
    }
    // 八个月后：市场更深（库存按同样的倍数变多），价格和原来一样
    let (mut old, mut new) = (world_at(None, 100), world_at(Some(terra_curve()), 100));
    for _ in 0..240 {
        old.end_day().unwrap();
        new.end_day().unwrap();
    }
    for g in [GRAIN, CLOTH, SPICE, IRON] {
        let (a, b) = (old.market(DELTA, g).unwrap(), new.market(DELTA, g).unwrap());
        // 小世界的日消耗只有几件，取整让倍数差上百分之几：库存大致是 2.4 / 1.4 倍
        assert!((b.stock * 14 - a.stock * 24).abs() * 10 <= a.stock * 24, "{g:?} 的库存 {} → {}", a.stock, b.stock);
        assert!((b.price - a.price).abs() <= 1, "{g:?} 的均衡价 {} → {}", a.price, b.price);
    }
}

// ───────────────────────────── 存档、开关与重放 ─────────────────────────────

#[test]
fn an_old_save_without_this_state_gets_a_grace_period() {
    // 旧存档：规则还没有的时候存的（状态里没有 access）
    let mut old = World::new(tiny_defs(), ScenarioId(0), 7).unwrap();
    for _ in 0..40 {
        old.end_day().unwrap();
    }
    let json = serde_json::to_string(&old.state).unwrap();
    assert!(!json.contains("\"access\""));
    let state: WorldState = serde_json::from_str(&json).unwrap();
    let mut w = World::from_snapshot(Arc::new(defs_on()), state).unwrap();
    let grace = w.defs.rules.access.grace_days;
    assert_eq!(w.state.access.since, Some(40));
    assert_eq!(w.state.access.grace_until, Some(40 + grace));
    assert_eq!(w.access_grace_left(), Some(grace));
    // 宽限期里全档可买，声望照常累积
    let f0 = w.location_faction(ALPHA);
    let rep = w.reputation(P, f0);
    assert!(w.rank_gate(P, ALPHA, SPICE).is_none());
    buy_ok(&mut w, SPICE, 2);
    buy_ok(&mut w, CLOTH, 60);
    assert!(w.reputation(P, f0) > rep, "宽限期里成交照样攒声望");
    // 存了再读：宽限期不重新起算
    let again: WorldState = serde_json::from_str(&serde_json::to_string(&w.state).unwrap()).unwrap();
    let again = World::from_snapshot(w.defs.clone(), again).unwrap();
    assert_eq!(again.state.access, w.state.access);
    // 宽限期一过照档位来
    set_reputation(&mut w, P, f0, 0);
    for _ in 0..grace - 1 {
        w.end_day().unwrap();
    }
    assert_eq!(w.access_grace_left(), Some(1));
    assert!(w.rank_gate(P, ALPHA, SPICE).is_none());
    w.end_day().unwrap();
    assert_eq!(w.access_grace_left(), None);
    assert!(w.rank_gate(P, ALPHA, SPICE).is_some());
    // 新开局没有宽限期
    let fresh = world_on();
    assert_eq!((fresh.state.access.since, fresh.state.access.grace_until), (Some(0), None));
}

#[test]
fn with_the_rule_off_ranks_in_the_data_change_nothing() {
    // 同一份数据、货物带着档位，规则关着：与没有档位的世界逐日相同，状态里也没有新字段
    let mut ranked = (*tiny_defs()).clone();
    ranked.goods[CLOTH.idx()].rank = 1;
    ranked.goods[SPICE.idx()].rank = 3;
    let mut a = World::new(tiny_defs(), ScenarioId(0), 9).unwrap();
    let mut b = World::new(Arc::new(ranked), ScenarioId(0), 9).unwrap();
    for day in 0..120 {
        if day % 10 == 0 {
            for w in [&mut a, &mut b] {
                let fid = fleet(w);
                ok(w, Command::Buy { owner: P, fleet: fid, good: SPICE, qty: 2, max_total: None });
                ok(w, Command::Sell { owner: P, fleet: fid, good: SPICE, qty: 2, min_total: None });
                ok(w, Command::InvestPort { owner: P, loc: ALPHA, amount: 1_000 });
            }
        }
        a.end_day().unwrap();
        b.end_day().unwrap();
        assert_eq!(serde_json::to_string(&a.state).unwrap(), serde_json::to_string(&b.state).unwrap(), "第 {day} 天");
    }
    let json = serde_json::to_string(&a.state).unwrap();
    assert!(!json.contains("\"access\"") && !json.contains("trade_turnover"));
}

#[test]
fn a_game_under_the_rule_replays_from_its_command_log() {
    let defs = Arc::new(defs_on());
    let mut w = World::new(defs.clone(), ScenarioId(0), 11).unwrap();
    let mut log: Vec<(u32, Command)> = Vec::new();
    let fid = fleet(&w);
    for day in 0..90u32 {
        let mut cmds = Vec::new();
        if day % 7 == 0 {
            cmds.push(Command::Buy { owner: P, fleet: fid, good: GRAIN, qty: 20, max_total: None });
            cmds.push(Command::Sell { owner: P, fleet: fid, good: GRAIN, qty: 20, min_total: None });
            // 锁着时被拒（不进日志），放开后成交
            cmds.push(Command::Buy { owner: P, fleet: fid, good: CLOTH, qty: 1, max_total: None });
        }
        if day % 30 == 3 {
            cmds.push(Command::InvestPort { owner: P, loc: ALPHA, amount: 5_000 });
        }
        for c in cmds {
            if c.apply(&mut w).is_ok() {
                log.push((day, c));
            }
        }
        w.end_day().unwrap();
        check_invariants(&w).unwrap();
    }
    assert!(
        log.iter().any(|(_, c)| matches!(c, Command::Buy { good, .. } if *good == CLOTH)),
        "商馆建起来后买到了棉布"
    );
    let mut again = World::new(defs, ScenarioId(0), 11).unwrap();
    let mut next = log.iter().peekable();
    for day in 0..90u32 {
        while let Some((_, c)) = next.next_if(|(d, _)| *d == day) {
            c.apply(&mut again).expect("重放的命令照样成立");
        }
        again.end_day().unwrap();
    }
    assert_eq!(again.state_hash(), w.state_hash());
}
