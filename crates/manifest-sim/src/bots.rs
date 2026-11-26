//! 无界面模拟用的脚本 bot（代替玩家操作）。bot 的一切操作都以命令提交并写入日志。

use crate::session::GameSession;
use manifest_core::fixed::{Fx, Money};
use manifest_core::ids::*;
use manifest_core::market::{Side, quote};
use manifest_core::npc::{PlannerParams, stage_load, stage_unload};
use manifest_core::rng::{Domain, Rng};
use manifest_core::{Command, World};
use std::fmt;
use std::str::FromStr;

/// bot 类型。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BotKind {
    /// 什么都不做
    Passive,
    /// 在两港之间来回运固定商品
    FixedRoute,
    /// 每次靠港都寻找最佳搬运套利
    Arbitrage,
    /// 期货投机（M2 起可用）
    Futures,
}

impl BotKind {
    pub const ALL: [BotKind; 4] = [BotKind::Passive, BotKind::FixedRoute, BotKind::Arbitrage, BotKind::Futures];

    pub fn name(self) -> &'static str {
        match self {
            BotKind::Passive => "passive",
            BotKind::FixedRoute => "route",
            BotKind::Arbitrage => "arbitrage",
            BotKind::Futures => "futures",
        }
    }
}

impl fmt::Display for BotKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.name())
    }
}

impl FromStr for BotKind {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, String> {
        BotKind::ALL
            .into_iter()
            .find(|b| b.name() == s)
            .ok_or_else(|| format!("未知的 bot：{s}（可选 passive / route / arbitrage / futures）"))
    }
}

/// 固定航线：A 港买 good_ab 运到 B 港，B 港买 good_ba 运回 A 港。
#[derive(Clone, Debug)]
struct Route {
    a: LocId,
    b: LocId,
    good_ab: GoodId,
    good_ba: Option<GoodId>,
}

pub struct Bot {
    pub kind: BotKind,
    route: Option<Route>,
    destinations: std::collections::BTreeMap<FleetId, LocId>,
}

impl Bot {
    pub fn new(kind: BotKind) -> Self {
        Self { kind, route: None, destinations: Default::default() }
    }

    /// 每天推进前调用一次。
    pub fn act(&mut self, session: &mut GameSession) {
        // 无人值守模拟没有月程输入；记录一次缺省养成命令，仍由调用方逐日推进。
        if session.world.upbringing_active() {
            if !session.world.upbringing_skipping() {
                let _ = session.submit(Command::SkipUpbringing { owner: OwnerId::Player });
            }
            return;
        }
        let first = session.log().len();
        if session.world.defs.manual_navigation {
            self.resume_navigation(session);
            shore_upkeep(session);
        }
        match self.kind {
            BotKind::Passive => {}
            BotKind::Arbitrage => arbitrage(session, Fx::from_pct(80)),
            BotKind::FixedRoute => self.fixed_route(session),
            BotKind::Futures => crate::bots::futures_speculator(session),
        }
        if self.kind != BotKind::Passive {
            invest_surplus(session);
        }
        if self.kind == BotKind::Arbitrage {
            agency_orders(session);
        }
        if session.world.defs.manual_navigation {
            for entry in &session.log()[first..] {
                if let Command::Autopilot { fleet, dest, .. } = entry.command {
                    self.destinations.insert(fleet, dest);
                }
            }
        }
    }

    fn resume_navigation(&self, session: &mut GameSession) {
        use manifest_core::world::{FleetLocation, Voyage};
        for (&fleet, &dest) in &self.destinations {
            let Some(f) = session.world.state.fleets.get(&fleet) else { continue };
            if let FleetLocation::AtSea(Voyage::Manual { manual }) = &f.location
                && manual.autopilot.is_none()
                && !session.world.fleet_in_battle(fleet)
            {
                let _ = session.submit(Command::Autopilot {
                    owner: OwnerId::Player,
                    fleet,
                    dest,
                    minute: 0,
                    stop_at_known_edge: false,
                    route: None,
                });
            }
        }
    }

    fn fixed_route(&mut self, session: &mut GameSession) {
        let owner = OwnerId::Player;
        let fleets: Vec<FleetId> = session.world.fleets_of(owner).map(|f| f.id).collect();
        let Some(&fid) = fleets.first() else { return };
        let Some(here) = session.world.fleet(fid).ok().and_then(|f| f.docked_at()) else { return };
        if self.route.is_none() {
            self.route = pick_route(&session.world, here);
        }
        let Some(route) = self.route.clone() else { return };
        // 卖掉船上的货
        let cargo: Vec<(GoodId, i64)> =
            session.world.fleet(fid).map(|f| f.cargo.iter().map(|(g, q)| (*g, *q)).collect()).unwrap_or_default();
        for (good, qty) in cargo {
            if session.world.market(here, good).is_some() {
                let _ = session.submit(Command::Sell { owner, fleet: fid, good, qty, min_total: None });
            }
        }
        maintain(session, fid);
        wear_upkeep(session, fid);
        let (good, dest) = if here == route.a {
            (Some(route.good_ab), route.b)
        } else if here == route.b {
            (route.good_ba, route.a)
        } else {
            (None, route.a)
        };
        let days = estimate(&session.world, fid, dest).unwrap_or(15);
        supply(session, fid, days + manifest_core::fleet::supply_margin(5, days));
        if let Some(good) = good {
            buy_for_trip(session, fid, here, good, Fx::from_pct(70));
        }
        let _ = sail(session, owner, fid, dest);
    }
}

fn estimate(world: &World, fid: FleetId, dest: LocId) -> Option<i64> {
    let f = world.fleet(fid).ok()?;
    world.estimate_days(f, dest)
}

/// 选择固定航线：从起始港出发，按基准价差最大的一对"此地便宜、彼地昂贵"的商品。
/// 开放市场打开时只从两端出售的商品里挑（卖到哪里都行）。
fn pick_route(world: &World, home: LocId) -> Option<Route> {
    let defs = &world.defs;
    let ratio = |loc: LocId, good: GoodId| -> Option<i64> {
        let e = world.market(loc, good)?;
        Some(e.supply * 1000 / e.demand.max(1))
    };
    let buyable = |loc: LocId, good: GoodId| {
        !manifest_core::stages::is_rare(defs, good)
            && world.market(loc, good).is_some_and(|e| !e.extra)
            && world.market_sells(loc, good)
    };
    // 货档（T01）：商誉不够、买不到的货不拿来定航线（规则关闭时什么都不锁）；每个港口的门路只算一次
    let home_access = world.buy_access(OwnerId::Player, home);
    let mut best: Option<(i64, LocId, GoodId)> = None;
    for dest in defs.port_ids() {
        if dest == home || defs.nav.compressed_path(defs.nav.grid.period_on(world.day()), home, dest).is_none() {
            continue;
        }
        if defs.manual_navigation && world.known_sea_path(defs.loc(home).cell, dest, false).is_err() {
            continue;
        }
        for good in world.state.locations[home.idx()]
            .market
            .keys()
            .filter(|g| buyable(home, **g) && home_access.gate(defs, **g).is_none())
        {
            let (Some(rh), Some(rd)) = (ratio(home, *good), ratio(dest, *good)) else { continue };
            let score = (rh - rd) * defs.good(*good).base_price;
            if best.is_none_or(|(s, _, _)| score > s) {
                best = Some((score, dest, *good));
            }
        }
    }
    let (_, b, good_ab) = best?;
    let b_access = world.buy_access(OwnerId::Player, b);
    let good_ba = world.state.locations[b.idx()]
        .market
        .keys()
        .filter(|g| buyable(b, **g) && b_access.gate(defs, **g).is_none())
        .filter_map(|g| Some((*g, ratio(b, *g)? - ratio(home, *g)?)))
        .filter(|(_, d)| *d > 0)
        .max_by_key(|(g, d)| (*d * defs.good(*g).base_price, g.0))
        .map(|(g, _)| g);
    Some(Route { a: home, b, good_ab, good_ba })
}

/// 修船、补足船员。
fn maintain(session: &mut GameSession, fid: FleetId) {
    let owner = OwnerId::Player;
    let params = PlannerParams::for_owner(&session.world, owner);
    // stage_unload 的卖货部分由调用方处理；这里只取维护命令
    for cmd in stage_unload(&session.world, fid, &params) {
        if matches!(cmd, Command::Repair { .. } | Command::HireCrew { .. }) {
            let _ = session.submit(cmd);
        }
    }
}

/// H02 船况的缺省对策（规则关着时什么也不做）：船底附着超过 50 就刮，船材补满。
/// 常设命令保持缺省（足额、正常、自动全开），不另外下命令。
fn wear_upkeep(session: &mut GameSession, fid: FleetId) {
    use manifest_core::seafaring::VoyageOrder;
    let owner = OwnerId::Player;
    let world = &session.world;
    if !world.wear_applies(fid) || world.fleet(fid).ok().and_then(|f| f.docked_at()).is_none() {
        return;
    }
    let wear = world.fleet_wear(fid);
    let room = world.timber_cap(fid) - wear.timber;
    if wear.fouling_points() > 50 {
        let _ = session.submit(Command::Voyage { owner, fleet: fid, order: VoyageOrder::Scrape });
    }
    if room > 0 {
        let _ = session.submit(Command::Voyage { owner, fleet: fid, order: VoyageOrder::BuyTimber { qty: room } });
    }
}

/// H05 岸上差事的缺省对策（规则关着时什么也不做）：在海上、锚地能补的时候——
/// 粮或水不到 `SHORE_LOW_DAYS` 天就汲水 / 采集狩猎，船材不到上限的四分之一就伐木，船底附着超过 60 就倾船刮底。
/// 能做的一起派（人手不够的按这个次序先派前面的）；派了就收帆锚泊，做完第二天由 `resume_navigation` 接着领航。
const SHORE_LOW_DAYS: i64 = 10;

fn shore_upkeep(session: &mut GameSession) {
    use manifest_core::seafaring::{ShoreOrder, ShoreTask};
    let owner = OwnerId::Player;
    let world = &session.world;
    if !world.shore_enabled() {
        return;
    }
    let mut orders = Vec::new();
    for f in world.fleets_of(owner) {
        if world.state.shore.camps.contains_key(&f.id) || world.fleet_in_battle(f.id) || f.crew <= 0 {
            continue;
        }
        let options = world.shore_options(f.id);
        if options.is_empty() {
            continue;
        }
        let low = f.supplies_needed(&world.defs, SHORE_LOW_DAYS);
        let wear = world.fleet_wear(f.id);
        let wanted = [
            (ShoreTask::Water, f.water < low),
            (ShoreTask::Forage, f.food < low),
            (ShoreTask::Timber, world.wear_applies(f.id) && wear.timber * 4 < world.timber_cap(f.id)),
            (ShoreTask::Careen, world.wear_applies(f.id) && wear.fouling_points() > 60),
        ];
        // 不缺粮水时不为了船材、船底专门停：只有粮水低了要停下来，才顺带伐木、刮底
        if !wanted[..2].iter().any(|(_, w)| *w) {
            continue;
        }
        let mut hands = 0;
        let mut tasks = Vec::new();
        for (task, want) in wanted {
            let Some(o) = options.iter().find(|o| o.task == task) else { continue };
            if want && o.block.is_none() && hands + o.hands <= world.shore_working(f.id) {
                hands += o.hands;
                tasks.push(task);
            }
        }
        if tasks.iter().any(|t| matches!(t, ShoreTask::Water | ShoreTask::Forage)) {
            orders.push((f.id, tasks));
        }
    }
    for (fleet, tasks) in orders {
        let _ = session.submit(Command::Shore { owner, fleet, order: ShoreOrder::Start { tasks } });
    }
}

/// 补给到够用 days 天。
fn supply(session: &mut GameSession, fid: FleetId, days: i64) {
    let owner = OwnerId::Player;
    let Ok(f) = session.world.fleet(fid) else { return };
    let need = f.supplies_needed(&session.world.defs, days.max(1));
    let food = (need - f.food).max(0);
    let water = (need - f.water).max(0);
    if food > 0 || water > 0 {
        let _ = session.submit(Command::Resupply { owner, fleet: fid, food, water });
    }
}

/// 用一定比例的现金买货装满舱位。
fn buy_for_trip(session: &mut GameSession, fid: FleetId, here: LocId, good: GoodId, share: Fx) {
    let owner = OwnerId::Player;
    let world = &session.world;
    let (Ok(f), Ok(agent), Some(e)) = (world.fleet(fid), world.agent(owner), world.market(here, good)) else { return };
    let budget: Money = share.apply(agent.cash.max(0));
    let mut qty = f.free_capacity().min(e.stock * 3 / 10).min(budget / e.price.max(1));
    while qty > 0 {
        match quote(world, owner, here, good, Side::Buy, qty) {
            Ok(q) if q.total <= budget => break,
            _ => qty = qty * 9 / 10,
        }
    }
    if qty > 0 {
        let _ = session.submit(Command::Buy { owner, fleet: fid, good, qty, max_total: None });
    }
}

/// 套利 bot：复用 NPC 商会的规划逻辑，风险偏好更高。
pub fn arbitrage(session: &mut GameSession, risk: Fx) {
    let owner = OwnerId::Player;
    let mut params = PlannerParams::for_owner(&session.world, owner);
    params.risk = risk;
    let fleets: Vec<FleetId> =
        session.world.fleets_of(owner).filter(|f| f.docked_at().is_some()).map(|f| f.id).collect();
    let seed = session.world.state.seed;
    let day = session.day();
    for fid in fleets {
        for cmd in stage_unload(&session.world, fid, &params) {
            let _ = session.submit(cmd);
        }
        wear_upkeep(session, fid);
        let mut rng = Rng::derive(seed, day, Domain::Scenario, fid.0 as u64, 77);
        for cmd in stage_load(&session.world, fid, &params, &mut rng) {
            let result = match cmd {
                Command::SetSail { owner, fleet, dest } => {
                    sail(session, owner, fleet, dest).or_else(|e| sail_elsewhere(session, fleet).ok_or(e))
                }
                other => session.submit(other).map(|_| ()),
            };
            if result.is_err() {
                break;
            }
        }
    }
}

/// T03：有商馆代办的世界里（`[agency]` 打开），套利 bot 每月 1 日在本据港（有商馆、有仓位时）做一笔最简单的代办：
/// 那里库存最多的一种货，挂一张“均价不超过现价 3% 买进 ≤ 20 件”的买单（通常第二天就成交）；仓库里已有这种货时，
/// 再挂一张“均价高出现价 8% 以上才卖”的卖单。挂了两个月还没成交完的单先撤掉。
/// 只为让整局模拟覆盖代办的成交、预留与撤单；挂单位不够、仓库没有空位时什么也不做。规则关闭的世界命令与以前逐条相同。
fn agency_orders(session: &mut GameSession) {
    use manifest_core::agency::OrderSide;
    let world = &session.world;
    if !world.agency_on() || !world.defs.calendar.month_start(session.day()) {
        return;
    }
    let owner = OwnerId::Player;
    let Ok(agent) = world.agent(owner) else { return };
    let home = agent.home;
    // 挂了两个月还没成交完的单撤掉，腾出挂单位
    let day = session.day();
    let stale: Vec<u32> = manifest_core::agency::orders_of(world, owner, home)
        .into_iter()
        .filter(|o| day.saturating_sub(o.placed) > 60)
        .map(|o| o.id)
        .collect();
    for order in stale {
        let _ = session.submit(Command::CancelOrder { owner, order });
    }
    let world = &session.world;
    if world.agency_orders_at(owner, home) > 0 || world.agency_slots(owner, home) < 2 {
        return;
    }
    let holder = manifest_core::warehouse::Holder::Warehouse(home);
    let Some((good, price)) = world.state.locations[home.idx()]
        .market
        .iter()
        .filter(|(g, e)| {
            !e.extra
                && !world.defs.good(**g).license
                && !manifest_core::stages::is_rare(&world.defs, **g)
                && world.market_sells(home, **g)
        })
        .max_by_key(|(g, e)| (e.stock, std::cmp::Reverse(g.0)))
        .map(|(g, e)| (*g, e.price))
    else {
        return;
    };
    let room = world.holder_free(owner, holder).min(20);
    let have = world.holder_qty(owner, holder, good);
    let mut cmds = Vec::new();
    if room > 0 {
        cmds.push(Command::PlaceOrder {
            owner,
            loc: home,
            good,
            side: OrderSide::Buy,
            limit: price + price * 3 / 100 + 1,
            qty: room,
        });
    }
    if have > 0 {
        cmds.push(Command::PlaceOrder {
            owner,
            loc: home,
            good,
            side: OrderSide::Sell,
            limit: price + price * 8 / 100 + 1,
            qty: have,
        });
    }
    for c in cmds {
        let _ = session.submit(c);
    }
}

/// 手动航行的世界里，规划器挑的卖点可能是玩家还没见过的港口（它按所知的行情挑，不看海图；
/// 引航会以“目的地不可见”拒绝）。以前船队就此停在港里、带着货一天天付工资，直到行情变了才走。
/// 这里退而求其次：在看得见、有已知航路、所知价值比就地卖高出两成的港口里挑最高的一处，补足粮水开过去；
/// 一处都没有就把货就地卖掉。经典世界（没有手动航行）不走这里，命令与以前逐条相同。
fn sail_elsewhere(session: &mut GameSession, fid: FleetId) -> Option<()> {
    let world = &session.world;
    if !world.defs.manual_navigation {
        return None;
    }
    let owner = OwnerId::Player;
    let f = world.fleet(fid).ok()?;
    let here = f.docked_at()?;
    let defs = &world.defs;
    let cargo: Vec<(GoodId, i64)> = f.cargo.iter().filter(|(_, q)| **q > 0).map(|(g, q)| (*g, *q)).collect();
    if cargo.is_empty() {
        return None;
    }
    let sight = world.sight(owner);
    let mut ranked: Vec<(Money, LocId)> = defs
        .port_ids()
        .filter(|d| *d != here)
        .filter_map(|d| {
            let value: Money = cargo.iter().filter_map(|(g, q)| sight.market(d, *g).map(|k| k.price * q)).sum();
            (value > 0).then_some((value, d))
        })
        .collect();
    ranked.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    // 就地卖能拿到多少：别处要明显更好（同 stage_unload 的 1.2 倍）才值得开过去，
    // 否则到了那里规划器又惦记着那个看不见的港口，船就在几个看得见的港口之间来回跑、货一直卖不掉
    let here_value: Money =
        cargo.iter().filter_map(|(g, q)| quote(world, owner, here, *g, Side::Sell, *q).ok().map(|x| x.total)).sum();
    let start = defs.loc(here).cell;
    // 只试所知价值最高的几处（寻路要走整张海图）
    let dest = ranked
        .iter()
        .take(8)
        .filter(|(v, _)| *v > here_value + here_value / 5)
        .map(|(_, d)| *d)
        .find(|d| world.known_sea_path(start, *d, false).is_ok());
    match dest {
        Some(dest) => {
            let days = estimate(world, fid, dest).unwrap_or(15);
            supply(session, fid, days + manifest_core::fleet::supply_margin(5, days));
            sail(session, owner, fid, dest).ok()
        }
        None => {
            for (good, qty) in cargo {
                let _ = session.submit(Command::Sell { owner, fleet: fid, good, qty, min_total: None });
            }
            Some(())
        }
    }
}

/// bot 留在手上的现金（T02 的投资规则）：超出的部分才拿去投资。
pub const BOT_INVEST_RESERVE: Money = 30_000;
/// bot 每月把超出留存的现金的这一成投进本据港。
pub const BOT_INVEST_SHARE_PCT: i64 = 10;

/// T02：有商馆分红的世界里（`[dividends]` 打开），bot 每月 1 日把现金超出 3 万的部分的一成投进本据港（不足最低投资额不投）。
/// 让整局模拟覆盖分红、商馆等级与跟投的排名；分红规则关闭的世界（经典）什么也不做，bot 的命令与以前逐条相同。
fn invest_surplus(session: &mut GameSession) {
    let world = &session.world;
    if !world.defs.rules.dividends.enabled || !world.defs.calendar.month_start(session.day()) {
        return;
    }
    let owner = OwnerId::Player;
    let Ok(agent) = world.agent(owner) else { return };
    let home = agent.home;
    if !world.defs.loc(home).is_port() {
        return;
    }
    let amount = manifest_core::fixed::mul_div(agent.cash - BOT_INVEST_RESERVE, BOT_INVEST_SHARE_PCT, 100);
    if amount < world.defs.rules.invest.min_amount.max(1) {
        return;
    }
    let _ = session.submit(Command::InvestPort { owner, loc: home, amount });
}

/// 手动世界走公开引航命令，遵守已知海域与港口门禁；经典世界的命令保持不变。
fn sail(
    session: &mut GameSession,
    owner: OwnerId,
    fleet: FleetId,
    dest: LocId,
) -> Result<(), manifest_core::CommandError> {
    let command = if session.world.defs.manual_navigation {
        Command::Autopilot { owner, fleet, dest, minute: 0, stop_at_known_edge: false, route: None }
    } else {
        Command::SetSail { owner, fleet, dest }
    };
    session.submit(command).map(|_| ())
}

/// 期货投机 bot：以一半风险做搬运套利，另外每周按交割港现货动量做期货投机。
pub fn futures_speculator(session: &mut GameSession) {
    arbitrage(session, Fx::from_pct(50));
    let day = session.day();
    if day % 7 != 3 {
        return;
    }
    let owner = OwnerId::Player;
    let world = &session.world;
    let defs = world.defs.clone();
    let mut orders: Vec<Command> = Vec::new();
    // 平掉持有超过 20 天或临近到期的仓位
    for (id, book) in &world.state.futures.positions {
        let Some(p) = book.get(&owner) else { continue };
        let Some(c) = world.futures_contract(*id) else { continue };
        if day.saturating_sub(p.opened_day) >= 20 || c.expiry_day <= day + 5 {
            orders.push(Command::TradeFutures { owner, contract: *id, lots: -p.lots });
        }
    }
    let cash = world.agent(owner).map(|a| a.cash).unwrap_or(0);
    // 交割港的现货走势只看自己知道的（信息时效：随船传递时是快照；实时模式下就是实时的）
    let sight = world.sight(owner);
    for (si, spec) in defs.futures_specs.iter().enumerate() {
        let Some(k) = sight.market(spec.delivery, spec.good) else { continue };
        let n = k.history_len();
        if n < 20 {
            continue;
        }
        let old = k.history_at(n - 20).unwrap_or(1).max(1);
        let momentum = Fx::ratio(k.price - old, old);
        if momentum.raw().abs() < Fx::from_pct(5).raw() {
            continue;
        }
        let Some(c) = world
            .state
            .futures
            .contracts
            .values()
            .filter(|c| !c.settled && c.spec as usize == si && c.expiry_day >= day + 25)
            .min_by_key(|c| c.expiry_day)
        else {
            continue;
        };
        if world.position(owner, c.id).is_some() {
            continue;
        }
        // 每笔投入约现金的 5% 作为保证金
        let ex = defs.exchange(spec.exchange);
        let per_lot = ex.initial_margin.apply(spec.lot * c.mark).max(1);
        let lots = (cash / 20 / per_lot).clamp(0, 20);
        if lots == 0 {
            continue;
        }
        let deposit = per_lot * lots * 2;
        orders.push(Command::DepositMargin { owner, exchange: spec.exchange, amount: deposit });
        orders.push(Command::TradeFutures {
            owner,
            contract: c.id,
            lots: if momentum > Fx::ZERO { lots } else { -lots },
        });
    }
    for cmd in orders {
        let _ = session.submit(cmd);
    }
    // 多余的保证金提回现金（保留两倍初始保证金）
    for (i, ex) in defs.exchanges.iter().enumerate() {
        let exid = ExchangeId::from_idx(i);
        let world = &session.world;
        let keep = world.margin_requirement(owner, exid, ex.initial_margin) * 2;
        let spare = world.margin_balance(owner, exid) - keep;
        if spare > 0 {
            let _ = session.submit(Command::WithdrawMargin { owner, exchange: exid, amount: spare });
        }
    }
}
