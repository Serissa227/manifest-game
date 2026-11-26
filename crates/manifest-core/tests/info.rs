//! 第八批 E6：信息时效（docs/ECONOMY.md 第 7 节）在小型世界里的受控检查。
//! - 实时模式（缺省、旧存档）处处实时、存档里没有新字段；行情情报只能由玩家在开局时选；
//! - 离开的港口记着离开那一刻的行情，随天数变旧（日线截到快照日之前）；
//! - 消息随船走：抵达时贴到告示板上，玩家那时在场才顺便读到；行情通报按张数收费、只卖比手上新的；
//! - 商会只用自己知道的行情选线；告示板撕掉过旧的消息；按所知行情的预测只看得到快照日之前的日线。

use manifest_core::commerce::forecast_known;
use manifest_core::defs::ForecastMethod;
use manifest_core::info::{InfoMode, InfoSource, Known};
use manifest_core::npc::{PlannerParams, plan_load};
use manifest_core::rng::{Domain, Rng};
use manifest_core::testkit::{check_invariants, tiny_defs};
use manifest_core::*;
use std::sync::Arc;

const ALPHA: LocId = LocId(0);
const BETA: LocId = LocId(1);
const GAMMA: LocId = LocId(2);
const DELTA: LocId = LocId(3);
const CLOTH: GoodId = GoodId(1);
const PLAYER: OwnerId = OwnerId::Player;
/// 小型世界的两家商会：gull（本据港 alpha）与 anchor（本据港 beta）
const GULL: OwnerId = OwnerId::Company(CompanyId(0));
const ANCHOR: OwnerId = OwnerId::Company(CompanyId(1));

/// anchor 商会（只留它一家时编号是 0）。
fn anchor(w: &World) -> OwnerId {
    OwnerId::Company(CompanyId::from_idx(w.defs.companies.iter().position(|c| c.key == "anchor").unwrap()))
}

/// 没有事件、海盗与季节流行的小型世界；`only_anchor` 时只留 anchor 一家商会（消息的来路更好控制）。
fn quiet(only_anchor: bool, tweak: impl FnOnce(&mut StaticData)) -> Arc<StaticData> {
    let mut d = (*tiny_defs()).clone();
    d.rules.seasonal_popular_bp = 0;
    d.rules.pirates.spawn_scale = Fx::ZERO;
    for e in &mut d.events {
        e.max_per_year = 0;
    }
    if only_anchor {
        d.companies.retain(|c| c.key == "anchor");
        d.meta.keys.companies.retain(|k| k == "anchor");
    }
    tweak(&mut d);
    Arc::new(d)
}

fn carried(defs: Arc<StaticData>, seed: u64) -> World {
    let mut w = World::new(defs, ScenarioId(0), seed).unwrap();
    Command::SetInfoMode { owner: PLAYER, mode: InfoMode::Carried }.apply(&mut w).unwrap();
    w
}

fn player_fleet(w: &World) -> FleetId {
    w.fleets_of(PLAYER).next().unwrap().id
}

fn code(r: Result<CommandOutcome, CommandError>) -> &'static str {
    r.expect_err("应被拒绝").code()
}

/// anchor 把现金全存进银行：到港之后买不起货与补给，就停在那里（消息的来路只有这一趟）。
fn stay_put(w: &mut World) {
    let a = anchor(w);
    let cash = w.agent(a).unwrap().cash;
    Command::Deposit { owner: a, amount: cash }.apply(w).unwrap();
}

/// 推进到某支舰队停靠在某港（最多 80 天）。
fn sail_until_docked(w: &mut World, fleet: FleetId, at: LocId) {
    for _ in 0..80 {
        if w.fleet(fleet).unwrap().docked_at() == Some(at) {
            return;
        }
        w.end_day().unwrap();
        check_invariants(w).unwrap();
    }
    panic!("舰队 {fleet:?} 没有抵达 {at:?}");
}

#[test]
fn live_mode_sees_everything_and_saves_nothing_new() {
    let mut w = World::new(quiet(false, |_| {}), ScenarioId(0), 1).unwrap();
    assert_eq!(w.info_mode(), InfoMode::Live);
    let f = player_fleet(&w);
    Command::SetSail { owner: PLAYER, fleet: f, dest: GAMMA }.apply(&mut w).unwrap();
    for _ in 0..30 {
        w.end_day().unwrap();
    }
    let sight = w.sight(PLAYER);
    for l in [ALPHA, BETA, GAMMA, DELTA] {
        let k = sight.market(l, CLOTH).unwrap();
        assert!(k.is_live() && k.age == 0 && k.hidden == 0);
        assert_eq!((k.price, k.stock), (w.market(l, CLOTH).unwrap().price, w.market(l, CLOTH).unwrap().stock));
    }
    assert!(w.state.fleets.values().all(|f| f.news.is_none()));
    assert!(w.state.locations.iter().all(|l| l.board.is_empty()));
    let json = serde_json::to_string(&w.state).unwrap();
    for field in ["\"info\"", "\"board\"", "\"closed\""] {
        assert!(!json.contains(field), "实时模式的存档里没有 {field}");
    }
    assert!(!serde_json::to_string(&w.state.fleets).unwrap().contains("\"news\""), "舰队不带消息");
}

#[test]
fn market_news_is_chosen_once_at_the_start_by_the_player() {
    let mut w = World::new(quiet(false, |_| {}), ScenarioId(0), 2).unwrap();
    let before = w.state.clone();
    let r = Command::SetInfoMode { owner: ANCHOR, mode: InfoMode::Carried }.apply(&mut w);
    assert_eq!(code(r), "precondition");
    assert_eq!(w.state, before, "被拒绝时状态不变");
    Command::SetInfoMode { owner: PLAYER, mode: InfoMode::Carried }.apply(&mut w).unwrap();
    assert_eq!(w.info_mode(), InfoMode::Carried);
    // 商会熟悉整个海域：记着第 0 天各地的行情；玩家什么也没记（在港的 alpha 看得到实时的）
    for c in [GULL, ANCHOR] {
        let known = &w.state.info.known[&c];
        assert_eq!(known.keys().copied().collect::<Vec<_>>(), vec![ALPHA, BETA, GAMMA, DELTA]);
        assert!(known.values().all(|s| s.day == 0 && s.source == InfoSource::Visit));
        let e = w.market(GAMMA, CLOTH).unwrap();
        assert_eq!(known[&GAMMA].good(CLOTH), Some((e.price, e.stock)));
    }
    assert!(!w.state.info.known.contains_key(&PLAYER));
    assert!(w.known_market(PLAYER, ALPHA, CLOTH).unwrap().is_live());
    assert!(w.known_market(PLAYER, GAMMA, CLOTH).is_none(), "没去过、没听说过的港口不知道行情");
    // 开局时可以改回实时：清空
    Command::SetInfoMode { owner: PLAYER, mode: InfoMode::Live }.apply(&mut w).unwrap();
    assert!(w.state.info.is_live());
    Command::SetInfoMode { owner: PLAYER, mode: InfoMode::Carried }.apply(&mut w).unwrap();
    w.end_day().unwrap();
    // 过了开局就不能再改
    let before = w.state.clone();
    assert_eq!(code(Command::SetInfoMode { owner: PLAYER, mode: InfoMode::Live }.apply(&mut w)), "info.mode_start");
    assert_eq!(w.state, before);
}

#[test]
fn a_port_you_leave_is_remembered_as_it_was_and_ages() {
    let mut w = carried(quiet(false, |_| {}), 3);
    let f = player_fleet(&w);
    for _ in 0..20 {
        w.end_day().unwrap();
    }
    // 在港时是实时的
    assert!(w.known_market(PLAYER, ALPHA, CLOTH).unwrap().is_live());
    let e = w.market(ALPHA, CLOTH).unwrap();
    let (p0, s0, close0) = (e.price, e.stock, *e.history.back().unwrap());
    let left = w.day();
    Command::SetSail { owner: PLAYER, fleet: f, dest: GAMMA }.apply(&mut w).unwrap();
    let snap = w.state.info.known[&PLAYER][&ALPHA].clone();
    assert_eq!((snap.loc, snap.day, snap.source), (ALPHA, left, InfoSource::Visit));
    assert_eq!(snap.good(CLOTH), Some((p0, s0)), "记着离开那一刻的价格与库存");
    assert_eq!(w.fleet(f).unwrap().news.as_ref(), Some(&snap), "舰队带着出发港的消息上路");
    // 离开之后 alpha 的棉布卖空了：实际价格上涨，玩家看到的还是离开时的
    for _ in 0..3 {
        w.state.locations[ALPHA.idx()].market.get_mut(&CLOTH).unwrap().stock = 0;
        w.end_day().unwrap();
    }
    let e = w.market(ALPHA, CLOTH).unwrap();
    assert!(e.price > p0, "实际价格 {} 涨过了 {p0}", e.price);
    let k = w.known_market(PLAYER, ALPHA, CLOTH).unwrap();
    assert_eq!((k.price, k.stock, k.day, k.age, k.hidden), (p0, s0, Some(left), 3, 3));
    assert_eq!(k.history_len() + 3, e.history.len(), "日线截到快照日之前");
    assert_eq!(k.history().last(), Some(close0), "所知日线的最后一天就是离开前最近的收盘价");
    // 抵达 gamma：alpha 的消息贴到 gamma 的告示板上，舰队不再带着
    sail_until_docked(&mut w, f, GAMMA);
    assert_eq!(w.state.locations[GAMMA.idx()].board.get(&ALPHA), Some(&snap));
    assert!(w.fleet(f).unwrap().news.is_none());
    assert!(w.known_market(PLAYER, GAMMA, CLOTH).unwrap().is_live(), "到了 gamma 就看得到实时的");
}

#[test]
fn ships_carry_news_and_a_player_in_port_reads_it_on_arrival() {
    // 玩家留在 alpha：anchor 从 beta 驶来，带来的 beta 行情贴上 alpha 的告示板，玩家顺便读到
    let mut w = carried(quiet(true, |_| {}), 4);
    let a = w.fleets_of(anchor(&w)).next().unwrap().id;
    let sailed = w.day();
    Command::SetSail { owner: anchor(&w), fleet: a, dest: ALPHA }.apply(&mut w).unwrap();
    stay_put(&mut w);
    let news = w.fleet(a).unwrap().news.clone().expect("出航时带上 beta 的行情");
    assert_eq!((news.loc, news.day), (BETA, sailed));
    sail_until_docked(&mut w, a, ALPHA);
    assert_eq!(w.state.locations[ALPHA.idx()].board.get(&BETA).map(|s| s.day), Some(sailed));
    let heard = &w.state.info.known[&PLAYER][&BETA];
    assert_eq!((heard.day, heard.source), (sailed, InfoSource::Ship));
    assert_eq!(heard.goods, news.goods);
    assert!(!w.known_market(PLAYER, BETA, CLOTH).unwrap().is_live());

    // 玩家先走了：同样的消息贴在告示板上，玩家不在场就读不到
    let mut w = carried(quiet(true, |_| {}), 4);
    let f = player_fleet(&w);
    let a = w.fleets_of(anchor(&w)).next().unwrap().id;
    Command::SetSail { owner: PLAYER, fleet: f, dest: GAMMA }.apply(&mut w).unwrap();
    Command::SetSail { owner: anchor(&w), fleet: a, dest: ALPHA }.apply(&mut w).unwrap();
    stay_put(&mut w);
    sail_until_docked(&mut w, a, ALPHA);
    assert!(w.state.locations[ALPHA.idx()].board.contains_key(&BETA));
    assert!(w.known_market(PLAYER, BETA, CLOTH).is_none(), "不在场，读不到告示板");
}

#[test]
fn a_market_report_sells_what_the_board_knows_that_you_do_not() {
    let mut w = carried(quiet(true, |_| {}), 5);
    let f = player_fleet(&w);
    let a = w.fleets_of(anchor(&w)).next().unwrap().id;
    // 玩家去 gamma，anchor 带着 beta 的行情到 alpha；玩家回到 alpha 时告示板上有它不知道的 beta 行情
    Command::SetSail { owner: PLAYER, fleet: f, dest: GAMMA }.apply(&mut w).unwrap();
    let sailed = w.day();
    Command::SetSail { owner: anchor(&w), fleet: a, dest: ALPHA }.apply(&mut w).unwrap();
    stay_put(&mut w);
    // 不在场时买不了
    assert_eq!(code(Command::BuyMarketReport { owner: PLAYER, loc: ALPHA }.apply(&mut w)), "explore.presence");
    sail_until_docked(&mut w, f, GAMMA);
    sail_until_docked(&mut w, a, ALPHA);
    Command::SetSail { owner: PLAYER, fleet: f, dest: ALPHA }.apply(&mut w).unwrap();
    sail_until_docked(&mut w, f, ALPHA);
    assert!(w.known_market(PLAYER, BETA, CLOTH).is_none());
    // 自己带回来的 gamma 行情玩家早就知道，不算在里面
    let (locs, cost) = w.report_offer(ALPHA);
    assert_eq!(locs, vec![BETA]);
    let r = &w.defs.rules.info;
    assert_eq!(cost, r.report_base + r.report_per_port);
    let cash = w.agent(PLAYER).unwrap().cash;
    let out = Command::BuyMarketReport { owner: PLAYER, loc: ALPHA }.apply(&mut w).unwrap();
    assert_eq!(out, CommandOutcome::Paid { cost });
    assert_eq!(w.agent(PLAYER).unwrap().cash, cash - cost);
    assert_eq!(w.state.money.sinks.get(&treasury::Flow::MarketReport), Some(&cost), "费用流出世界");
    check_invariants(&w).unwrap();
    let bought = &w.state.info.known[&PLAYER][&BETA];
    assert_eq!((bought.day, bought.source), (sailed, InfoSource::Report));
    // 再买：没有更新的了；状态不变
    let before = w.state.clone();
    assert_eq!(code(Command::BuyMarketReport { owner: PLAYER, loc: ALPHA }.apply(&mut w)), "info.report_nothing");
    assert_eq!(w.state, before);
    // 现金不够
    let mut poor = carried(quiet(true, |_| {}), 5);
    let pf = player_fleet(&poor);
    let heard = poor.take_snapshot(GAMMA, InfoSource::Visit);
    poor.state.locations[ALPHA.idx()].board.insert(GAMMA, heard);
    poor.state.agents.get_mut(&PLAYER).unwrap().cash = 10;
    assert!(poor.fleet(pf).unwrap().docked_at() == Some(ALPHA));
    assert_eq!(code(Command::BuyMarketReport { owner: PLAYER, loc: ALPHA }.apply(&mut poor)), "insufficient_cash");
    // 实时模式下不需要
    let mut live = World::new(quiet(true, |_| {}), ScenarioId(0), 5).unwrap();
    assert_eq!(code(Command::BuyMarketReport { owner: PLAYER, loc: ALPHA }.apply(&mut live)), "info.live");
    // 城市里没有告示板
    assert_eq!(code(Command::BuyMarketReport { owner: PLAYER, loc: DELTA }.apply(&mut w)), "info.report_port");
}

#[test]
fn the_board_drops_news_older_than_its_limit() {
    let mut w = carried(quiet(true, |d| d.rules.info.board_days = 5), 6);
    let old = w.take_snapshot(GAMMA, InfoSource::Visit);
    w.state.locations[BETA.idx()].board.insert(GAMMA, old);
    for _ in 0..5 {
        w.end_day().unwrap();
    }
    assert!(w.state.locations[BETA.idx()].board.contains_key(&GAMMA), "第 5 天还在");
    w.end_day().unwrap();
    assert!(!w.state.locations[BETA.idx()].board.contains_key(&GAMMA), "过了 5 天撕掉");
}

/// anchor 在 beta 只能买到棉布，alpha 与 delta 的棉布堆成山（去了不赚），gamma 的棉布实际上卖空了（很贵）。
fn gamma_is_dear(w: &mut World) {
    for (g, e) in w.state.locations[BETA.idx()].market.iter_mut() {
        if *g != CLOTH {
            e.stock = 0;
        }
    }
    for l in [ALPHA, DELTA] {
        let e = w.state.locations[l.idx()].market.get_mut(&CLOTH).unwrap();
        e.stock = e.target * 6;
        e.price = e.base_price / 5;
    }
    let beta = w.state.locations[BETA.idx()].market.get_mut(&CLOTH).unwrap();
    beta.price = beta.base_price / 2;
    let e = w.state.locations[GAMMA.idx()].market.get_mut(&CLOTH).unwrap();
    e.stock = 0;
    e.price = e.base_price * 3;
}

#[test]
fn companies_plan_with_what_they_know() {
    let mut picks = Vec::new();
    for mode in [InfoMode::Live, InfoMode::Carried] {
        let mut w = World::new(quiet(false, |_| {}), ScenarioId(0), 7).unwrap();
        Command::SetInfoMode { owner: PLAYER, mode }.apply(&mut w).unwrap();
        gamma_is_dear(&mut w);
        if mode == InfoMode::Carried {
            // anchor 手上的行情：alpha 与 delta 的棉布堆成山（与实际相同），gamma 也是（其实已经卖空）
            let glut: Vec<(LocId, Money, i64)> = [ALPHA, DELTA, GAMMA]
                .into_iter()
                .map(|l| {
                    let e = w.market(l, CLOTH).unwrap();
                    (l, e.base_price / 5, e.target * 6)
                })
                .collect();
            let known = w.state.info.known.get_mut(&ANCHOR).unwrap();
            for (l, price, stock) in glut {
                let snap = known.get_mut(&l).unwrap();
                let i = snap.goods.iter().position(|(g, _, _)| *g == CLOTH).unwrap();
                snap.goods[i] = (CLOTH, price, stock);
            }
        }
        let fid = w.fleets_of(ANCHOR).next().unwrap().id;
        let params = PlannerParams::for_owner(&w, ANCHOR);
        let mut rng = Rng::derive(7, 0, Domain::Company, fid.0 as u64, 0);
        let load = plan_load(&w, fid, &params, &mut rng);
        let dest = load.commands.iter().find_map(|c| match c {
            Command::SetSail { dest, .. } => Some(*dest),
            _ => None,
        });
        let bought = load.commands.iter().any(|c| matches!(c, Command::Buy { good, .. } if *good == CLOTH));
        picks.push((mode, dest, bought));
    }
    assert_eq!(picks[0], (InfoMode::Live, Some(GAMMA), true), "实时：看得到 gamma 卖空了，运棉布过去");
    let (_, dest, bought) = picks[1];
    assert!(!(bought && dest == Some(GAMMA)), "随船传递：anchor 以为 gamma 也堆成山，不去：{:?}", picks[1]);
}

#[test]
fn forecasts_from_a_snapshot_only_see_the_days_before_it() {
    let w = World::new(quiet(false, |_| {}), ScenarioId(0), 8).unwrap();
    let mut e = w.market(GAMMA, CLOTH).unwrap().clone();
    // 前 20 天每天涨 5（100 → 195），后 10 天暴跌（快照之后，不知道）
    e.history = (0..20).map(|i| 100 + i * 5).chain((0..10).map(|i| 150 - i * 10)).collect();
    let k = Known { entry: &e, price: 195, stock: e.stock, day: Some(40), age: 10, hidden: 10 };
    assert_eq!(k.history_len(), 20);
    assert_eq!(k.history_at(19), Some(195));
    assert_eq!(k.history_at(20), None);
    assert_eq!(k.history().count(), 20);
    // 顺势：按所知的两周走势（每天 +5）外推 4 天：195 + 20
    assert_eq!(forecast_known(&w.defs, &k, 4, ForecastMethod::Trend), 215);
    assert_eq!(forecast_known(&w.defs, &k, 4, ForecastMethod::Naive), 195);
    // 实时的看得到暴跌：顺势往下
    let live = Known::live(&e);
    assert!(forecast_known(&w.defs, &live, 4, ForecastMethod::Trend) < e.price);
}
