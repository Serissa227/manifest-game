//! NPC 商会的规则决策（也供无界面模拟中的套利 bot 复用）。
//!
//! 决策分两个阶段，每个阶段只读世界、产出命令，由调用方逐条执行：
//! 1. [`stage_unload`]：到港卖货、修船、补足船员（商会 2.0：老船换新）；
//! 2. [`stage_load`]：评估"此地买入 → 某港卖出"的每日期望收益，买货、补给并出航；
//!    没有划算的生意时原地等待，闲置过久则换港。
//!
//! 商会 2.0（ECONOMY.md 6.7，[`crate::commerce`]，只对商会、规则打开时）：目的港的卖价用商会偏好的方法预测抵达时的价格，
//! 主货之外同一目的地还有利可图的货一并装上，装着期货品种驶往交割港时开空头套保（[`plan_load`] 给出这些命令与这趟的计划），
//! 玩家近期交易量大的市场按商会的性格加分或减分。

use crate::command::Command;
use crate::commerce::{TradePlan, all_known, forecast_known, player_pressure, reaction_factor};
use crate::defs::{ForecastMethod, Reaction, StaticData};
use crate::fixed::{Fx, Money, mul_div};
use crate::fleet::{daily_supply_need, fleet_days_compressed, supply_margin};
use crate::ids::*;
use crate::market::{Side, price_mult_in, quote};
use crate::rng::Rng;
use crate::world::{Fleet, MarketEntry, World};

/// 规划参数。
#[derive(Clone, Debug)]
pub struct PlannerParams {
    /// 单次投入占现金的比例
    pub risk: Fx,
    pub preferred: Vec<GoodId>,
    pub min_margin: Fx,
    pub max_stock_share: Fx,
    pub supply_margin_days: i64,
    pub repair_below: Fx,
    /// 闲置多少天后换港
    pub idle_before_move: u32,
    /// 商会 2.0（只对商会、规则打开时）：按预测选线、一船多货、套保、老船换新、对玩家的反应
    pub v2: bool,
    /// 预测目的港价格的方法（商会 2.0）
    pub method: ForecastMethod,
    /// 对玩家的反应（商会 2.0）
    pub reaction: Reaction,
    /// 商会展望（ECONOMY.md 8.2）：各商品当天的偏向（每级看法 3%，30 天内消退）；没有展望时为空
    pub bias: Vec<(GoodId, Fx)>,
}

impl PlannerParams {
    /// 取商会当前策略与全局规则组成参数。
    pub fn for_owner(world: &World, owner: OwnerId) -> PlannerParams {
        let npc = &world.defs.rules.npc;
        let strategy = world.state.agents.get(&owner).and_then(|a| a.strategy.as_ref());
        let (risk, preferred) = match strategy {
            Some(s) => (s.risk, s.preferred.clone()),
            None => (Fx::from_pct(60), Vec::new()),
        };
        let day = world.day();
        let bias = strategy
            .and_then(|s| s.outlook.as_ref())
            .map(|o| o.views.iter().map(|(g, _)| (*g, o.bias(*g, day))).filter(|(_, b)| *b != Fx::ZERO).collect())
            .unwrap_or_default();
        let company = owner.company().and_then(|c| world.defs.companies.get(c.idx()));
        let v2 = npc.v2.enabled && company.is_some();
        PlannerParams {
            risk,
            preferred,
            min_margin: npc.min_margin,
            max_stock_share: npc.max_stock_share,
            supply_margin_days: npc.supply_margin_days,
            repair_below: npc.repair_below,
            idle_before_move: 4,
            v2,
            method: if v2 { world.company_method(owner) } else { ForecastMethod::Naive },
            reaction: if v2 { company.map(|c| c.reaction).unwrap_or_default() } else { Reaction::Neutral },
            bias,
        }
    }

    /// 商会展望给某商品的偏向（没有时为 0）。
    pub fn bias_of(&self, good: GoodId) -> Fx {
        self.bias.iter().find(|(g, _)| *g == good).map(|(_, b)| *b).unwrap_or(Fx::ZERO)
    }
}

/// 快速估价：以成交区间中点的单价近似均价（不含税）；`stock` 是所知的库存（远方港口是快照里的）。
fn quick_avg(
    defs: &StaticData,
    at: (u32, LocId),
    good: GoodId,
    e: &MarketEntry,
    stock: i64,
    side: Side,
    qty: i64,
) -> Money {
    let (day, loc) = at;
    let rules = &defs.rules;
    let mid = match side {
        Side::Buy => stock - qty / 2,
        Side::Sell => stock + qty / 2,
    };
    let ratio = Fx::ratio(mid.max(0), e.target.max(1));
    let raw = rules
        .price_curve
        .eval(ratio)
        .mul(price_mult_in(defs, day, good, e, defs.loc(loc).hemisphere.season(defs.calendar.season_of(day))))
        .apply(e.base_price);
    let lo = rules.price_floor.apply(e.base_price).max(1);
    let hi = rules.price_cap.apply(e.base_price).max(lo);
    raw.clamp(lo, hi)
}

/// 能否在某地卖这种货：需要许可证的商品（军需品）要持有当地势力的许可证（与命令的校验一致）。
fn may_sell(world: &World, owner: OwnerId, loc: LocId, good: GoodId) -> bool {
    let defs = &world.defs;
    !defs.good(good).license || world.has_license(owner, world.location_faction(loc))
}

/// 航程的固定开销（工资 + 粮水）；经典保留原有整数运算次序。
pub(crate) fn journey_cost(defs: &StaticData, fleet: &Fleet, days: i64) -> Money {
    let rules = &defs.rules;
    if !rules.fractional_supplies {
        let need = daily_supply_need(defs, fleet.crew);
        return (fleet.crew * rules.crew_wage + need * (rules.food_price + rules.water_price)) * days;
    }
    fleet.crew * rules.crew_wage * days + fleet.supplies_needed(defs, days) * (rules.food_price + rules.water_price)
}

/// 阶段一：卖货、修船、补足船员。
pub fn stage_unload(world: &World, fleet_id: FleetId, params: &PlannerParams) -> Vec<Command> {
    let mut out = Vec::new();
    let Ok(fleet) = world.fleet(fleet_id) else { return out };
    let Some(here) = fleet.docked_at() else { return out };
    let owner = fleet.owner;
    let defs = &world.defs;
    let day = world.day();
    // 远方港口的行情只看自己知道的（信息时效，ECONOMY.md 第 7 节；实时模式下就是实时的）
    let sight = world.sight(owner);
    let mut destinations = None;

    for (&good, &qty) in &fleet.cargo {
        if qty <= 0 {
            continue;
        }
        // 没有许可证的军需品这里卖不了（命令会被拒）：留着去别处卖
        if !may_sell(world, owner, here, good) {
            continue;
        }
        let Ok(q_here) = quote(world, owner, here, good, Side::Sell, qty) else { continue };
        // 比较其他港口扣除路费后的价值；明显更好、且补给装得下才留货（只看卖得了的港口）
        let mut best_alt: Money = 0;
        for &(dest, days) in destinations.get_or_insert_with(|| destination_days(world, fleet, here)).iter() {
            if !may_sell(world, owner, dest, good) {
                continue;
            }
            let Some(k) = sight.market(dest, good) else { continue };
            if !trip_fits(defs, fleet, days + supply_margin(params.supply_margin_days, days)) {
                continue;
            }
            let value = quick_avg(defs, (day, dest), good, k.entry, k.stock, Side::Sell, qty) * qty
                - journey_cost(defs, fleet, days);
            best_alt = best_alt.max(value);
        }
        if best_alt > q_here.total + q_here.total / 5 {
            continue;
        }
        out.push(Command::Sell { owner, fleet: fleet_id, good, qty, min_total: None });
    }

    // 修船
    let worst = fleet.ships.iter().map(|s| Fx::ratio(s.durability, s.max_durability.max(1))).min().unwrap_or(Fx::ONE);
    if worst < params.repair_below {
        out.push(Command::Repair { owner, fleet: fleet_id });
    }

    // 商会 2.0：船龄超过上限的船在有船厂的港口换新（先买后卖，船队不会空；满五艘时先卖后买）
    if params.v2 {
        // 卖完这一港要卖的货之后还留在船上的货物与粮水
        let kept: i64 = fleet
            .cargo
            .iter()
            .filter(|(g, _)| !out.iter().any(|c| matches!(c, Command::Sell { good, .. } if good == *g)))
            .map(|(_, q)| *q)
            .sum::<i64>()
            + fleet.food
            + fleet.water;
        out.extend(retire_old_ship(world, fleet, here, kept));
    }

    // 船员补足到下限的 120%
    let min = fleet.crew_min(defs);
    let max = fleet.crew_max(defs);
    let want = (min * 6 / 5).min(max);
    if fleet.crew < want {
        out.push(Command::HireCrew { owner, fleet: fleet_id, count: want - fleet.crew });
    }
    out
}

/// 商会 2.0：挑一艘超龄的船换新（同型号在这里有卖时买同型号，否则买这里买得起的最大的船）；换不起、
/// 或者换下旧船之后船员与留在船上的货物（`kept`）装不下时不换。
fn retire_old_ship(world: &World, fleet: &Fleet, here: LocId, kept: i64) -> Vec<Command> {
    let defs = &world.defs;
    let v2 = &defs.rules.npc.v2;
    // 船厂清单随发展度（T02 `[shipyard_growth]`；关闭时就是数据里的清单）
    let yard = world.shipyard(here);
    if v2.retire_years == 0 || yard.is_empty() {
        return Vec::new();
    }
    let limit = v2.retire_years * world.defs.calendar.year_days();
    let day = world.day();
    let Some((idx, old)) =
        fleet.ships.iter().enumerate().find(|(_, s)| day.saturating_sub(s.built) > limit && !defs.ship(s.kind).unique)
    else {
        return Vec::new();
    };
    let cash = world.agent(fleet.owner).map(|a| a.cash).unwrap_or(0);
    let pick = if yard.contains(&old.kind) {
        Some(old.kind)
    } else {
        yard.iter().copied().filter(|s| defs.ship(*s).price <= cash).max_by_key(|s| (defs.ship(*s).capacity, s.0))
    };
    let Some(kind) = pick.filter(|k| defs.ship(*k).price <= cash) else { return Vec::new() };
    // 换下旧船之后，船员与货物要装得下（否则卖旧船会被拒，船队越换越多）
    let new = defs.ship(kind);
    let crew_max_after = fleet.crew_max(defs) - defs.ship(old.kind).crew_max + new.crew_max;
    let capacity_after = fleet.capacity() - old.capacity + new.capacity;
    if fleet.crew > crew_max_after || kept > capacity_after {
        return Vec::new();
    }
    let owner = fleet.owner;
    let buy = Command::BuyShip { owner, fleet: fleet.id, ship_type: kind, new_fleet: false };
    let sell = Command::SellShip { owner, fleet: fleet.id, ship: idx as u8 };
    if fleet.ships.len() < crate::world::MAX_SHIPS_PER_FLEET { vec![buy, sell] } else { vec![sell, buy] }
}

/// 阶段二的结果：要执行的命令（买货、补给、出航）、出航之后的套保命令，以及这趟的计划（商会 2.0）。
#[derive(Default)]
pub struct LoadPlan {
    pub commands: Vec<Command>,
    /// 出航之后再执行、失败也不影响出航的套保命令（存保证金、开空头）
    pub hedge: Vec<Command>,
    pub plan: Option<TradePlan>,
}

impl LoadPlan {
    fn only(commands: Vec<Command>) -> LoadPlan {
        LoadPlan { commands, ..LoadPlan::default() }
    }
}

/// 一个候选生意。
struct Candidate {
    good: GoodId,
    dest: LocId,
    qty: i64,
    days: i64,
    score: i64,
}

/// 阶段二：挑选生意、买货、补给并出航。
pub fn stage_load(world: &World, fleet_id: FleetId, params: &PlannerParams, rng: &mut Rng) -> Vec<Command> {
    plan_load(world, fleet_id, params, rng).commands
}

/// 阶段二（带商会 2.0 的套保与计划）：挑选生意、买货、补给并出航。
pub fn plan_load(world: &World, fleet_id: FleetId, params: &PlannerParams, rng: &mut Rng) -> LoadPlan {
    let mut out: Vec<Command> = Vec::new();
    let Ok(fleet) = world.fleet(fleet_id) else { return LoadPlan::only(out) };
    let Some(here) = fleet.docked_at() else { return LoadPlan::only(out) };
    let owner = fleet.owner;
    let defs = &world.defs;
    let day = world.day();
    let Ok(agent) = world.agent(owner) else { return LoadPlan::only(out) };
    if fleet.crew < fleet.crew_min(defs) {
        return LoadPlan::only(out);
    }
    // 远方港口的行情只看自己知道的（信息时效，ECONOMY.md 第 7 节；实时模式下就是实时的）
    let sight = world.sight(owner);

    // 已有货物（上一阶段决定留下）：前往最佳卖点
    if fleet.cargo_total() > 0 {
        let mut best: Option<(LocId, Money, i64)> = None;
        for dest in defs.port_ids() {
            if dest == here {
                continue;
            }
            let Some(days) = plan_days(world, fleet, here, dest) else { continue };
            if !trip_fits(defs, fleet, days + supply_margin(params.supply_margin_days, days)) {
                continue;
            }
            let mut value = -journey_cost(defs, fleet, days);
            for (&g, &q) in &fleet.cargo {
                if let Some(k) = sight.market(dest, g).filter(|_| may_sell(world, owner, dest, g)) {
                    value += quick_avg(defs, (day, dest), g, k.entry, k.stock, Side::Sell, q) * q;
                }
            }
            if best.is_none_or(|(_, v, _)| value > v) {
                best = Some((dest, value, days));
            }
        }
        match best {
            Some((dest, _, days)) => {
                let margin = supply_margin(params.supply_margin_days, days);
                if push_supplies(&mut out, world, here, fleet, owner, days + margin, agent.cash) {
                    out.push(Command::SetSail { owner, fleet: fleet_id, dest });
                }
            }
            None => {
                // 哪里都去不了：就地卖掉能卖的货
                for (&good, &qty) in &fleet.cargo {
                    if world.market(here, good).is_some() && may_sell(world, owner, here, good) {
                        out.push(Command::Sell { owner, fleet: fleet_id, good, qty, min_total: None });
                    }
                }
            }
        }
        return LoadPlan::only(out);
    }

    let budget = params.risk.apply(agent.cash.max(0));
    let mut options: Vec<Candidate> = Vec::new();
    let Some(here_state) = world.state.locations.get(here.idx()) else { return LoadPlan::only(out) };
    let reaction_strength = defs.rules.npc.v2.player_reaction;
    // 开放市场：只买这里出售的商品（特产为主），卖到哪里都行（关闭时这里有的都能买，同旧版）
    let sale = defs.rules.open_market.enabled.then(|| world.market_sale_list(here));
    // 货档（T01）：商誉不够的货这里不卖给自己，不拿来打算盘（规则关闭时什么都不锁）
    let access = world.access_on().then(|| world.buy_access(owner, here));
    let mut destinations = None;
    for (&good, e_here) in &here_state.market {
        // 势力的出口禁令：这里买不走
        if e_here.stock <= 0 || world.rare_good(good) || world.export_banned(here, good) {
            continue;
        }
        if e_here.extra || sale.as_ref().is_some_and(|s| !s.contains(&good)) {
            continue;
        }
        if access.as_ref().is_some_and(|a| a.gate(defs, good).is_some()) {
            continue;
        }
        let here_price = e_here.price.max(1);
        for &(dest, days) in destinations.get_or_insert_with(|| destination_days(world, fleet, here)).iter() {
            let Some(k_dest) = sight.market(dest, good) else { continue };
            // 需要许可证的商品：两端势力的许可证都要持有
            if defs.good(good).license
                && (!world.has_license(owner, world.location_faction(here))
                    || !world.has_license(owner, world.location_faction(dest)))
            {
                continue;
            }
            // 目的港的卖价：旧版看所知的价；商会 2.0 用偏好的方法预测抵达时的价（从所知行情的日期算起：航程加上过时的天数）
            let dest_now = k_dest.price.max(1);
            let forecast =
                if params.v2 { forecast_known(defs, &k_dest, days + k_dest.age, params.method) } else { dest_now };
            // 商会展望：看好的商品预期偏高、看淡的偏低（ECONOMY.md 8.2；没有展望时不变）
            let bias = params.bias_of(good);
            let dest_price = if bias == Fx::ZERO { forecast } else { (Fx::ONE + bias).apply(forecast).max(1) };
            // 粗筛：目的地价格要明显高于此地
            if dest_price * 10 < here_price * 11 {
                continue;
            }
            let supplies_units = fleet.supplies_space(defs, days + supply_margin(params.supply_margin_days, days));
            let room = fleet.free_capacity() - supplies_units.max(0) + fleet.food + fleet.water;
            let max_by_stock = params.max_stock_share.apply(e_here.stock);
            let max_by_cash = budget / here_price;
            let q_max = room.min(max_by_stock).min(max_by_cash);
            if q_max <= 0 {
                continue;
            }
            for q in [q_max, q_max / 2] {
                if q <= 0 {
                    continue;
                }
                let buy = quick_avg(defs, (day, here), good, e_here, e_here.stock, Side::Buy, q) * q;
                let mut sell = quick_avg(defs, (day, dest), good, k_dest.entry, k_dest.stock, Side::Sell, q) * q;
                if params.v2 || bias != Fx::ZERO {
                    sell = mul_div(sell, dest_price, dest_now);
                }
                let costs = journey_cost(defs, fleet, days) + buy / 10;
                let profit = sell - buy - costs;
                if profit <= params.min_margin.apply(buy) {
                    continue;
                }
                let mut score = profit / (days + 1);
                if params.preferred.contains(&good) {
                    score = score * 6 / 5;
                }
                if params.v2 && params.reaction != Reaction::Neutral {
                    // 玩家近期在这两处这种货上交易得多：跟进型加分，回避型减分
                    let pressure = player_pressure(e_here).max(player_pressure(k_dest.entry));
                    score = reaction_factor(params.reaction, reaction_strength, pressure).apply(score);
                }
                options.push(Candidate { good, dest, qty: q, days, score });
            }
        }
    }

    if options.is_empty() {
        // 没有划算的生意：闲置过久则换一个港口看看
        if fleet_idle_long(fleet, params)
            && let Some((dest, days)) = reposition_target(
                world,
                fleet,
                destinations.get_or_insert_with(|| destination_days(world, fleet, here)),
                params.supply_margin_days,
                rng,
            )
        {
            let margin = supply_margin(params.supply_margin_days, days);
            if push_supplies(&mut out, world, here, fleet, owner, days + margin, agent.cash) {
                out.push(Command::SetSail { owner, fleet: fleet_id, dest });
            }
        }
        return LoadPlan::only(out);
    }

    // 在前几名中按分数加权随机挑选，让不同商会的选择有差异
    options.sort_by(|a, b| b.score.cmp(&a.score).then(a.good.cmp(&b.good)).then(a.dest.cmp(&b.dest)));
    let top = &options[..options.len().min(3)];
    let mut weights = [0; 3];
    for (weight, candidate) in weights.iter_mut().zip(top) {
        *weight = candidate.score.max(1);
    }
    let pick = rng.weighted(&weights[..top.len()]).unwrap_or(0);
    let o = &options[pick];

    // 用精确报价确认
    let Ok(q) = quote(world, owner, here, o.good, Side::Buy, o.qty) else { return LoadPlan::only(out) };
    let supply_cost = 2
        * fleet.supplies_needed(defs, o.days + supply_margin(params.supply_margin_days, o.days))
        * (defs.rules.food_price + defs.rules.water_price);
    if q.total + supply_cost > agent.cash {
        return LoadPlan::only(out);
    }
    out.push(Command::Buy { owner, fleet: fleet_id, good: o.good, qty: o.qty, max_total: Some(q.total) });
    let mut spent = q.total;
    let mut plan = None;
    let mut hedge = Vec::new();
    if params.v2 {
        // 一船多货：同一目的地、其余有利可图的货（每种取评分最高的一条），装进剩下的舱位与预算
        let supplies_units = fleet.supplies_space(defs, o.days + supply_margin(params.supply_margin_days, o.days));
        let mut room = fleet.free_capacity() - supplies_units.max(0) + fleet.food + fleet.water - o.qty;
        let mut seen = vec![o.good];
        for c in options.iter().filter(|c| c.dest == o.dest) {
            if seen.contains(&c.good) || room <= 0 || seen.len() >= 3 {
                continue;
            }
            seen.push(c.good);
            let Some(e) = world.market(here, c.good) else { continue };
            let qty = c.qty.min(room).min((budget - spent).max(0) / e.price.max(1));
            if qty <= 0 {
                continue;
            }
            let Ok(q2) = quote(world, owner, here, c.good, Side::Buy, qty) else { continue };
            if spent + q2.total + supply_cost > agent.cash {
                continue;
            }
            out.push(Command::Buy { owner, fleet: fleet_id, good: c.good, qty, max_total: Some(q2.total) });
            spent += q2.total;
            room -= qty;
        }
        let forecasts = sight.market(o.dest, o.good).map(|k| all_known(defs, &k, o.days + k.age)).unwrap_or([0; 3]);
        plan = Some(TradePlan { dest: o.dest, good: o.good, forecasts, hedge: None });
        if defs.rules.npc.v2.hedge {
            hedge = hedge_commands(world, owner, o.good, o.dest, o.qty, o.days);
        }
    }
    let margin = supply_margin(params.supply_margin_days, o.days);
    if !push_supplies(&mut out, world, here, fleet, owner, o.days + margin, agent.cash - spent) {
        return LoadPlan::default();
    }
    out.push(Command::SetSail { owner, fleet: fleet_id, dest: o.dest });
    LoadPlan { commands: out, hedge, plan }
}

/// 套保：主货是期货品种、目的地是它的交割港时，按货量开空头（整手，至少一手），合约取抵达五天之后最早到期的一张；
/// 保证金不够时先存够（不超过现金的两成）。
fn hedge_commands(world: &World, owner: OwnerId, good: GoodId, dest: LocId, qty: i64, days: i64) -> Vec<Command> {
    let defs = &world.defs;
    let day = world.day();
    let Some((si, spec)) = defs.futures_specs.iter().enumerate().find(|(_, s)| s.good == good && s.delivery == dest)
    else {
        return Vec::new();
    };
    let lots = qty / spec.lot.max(1);
    if lots < 1 {
        return Vec::new();
    }
    let Some(contract) = world
        .state
        .futures
        .contracts
        .values()
        .filter(|c| !c.settled && c.spec as usize == si && i64::from(c.expiry_day) >= i64::from(day) + days + 5)
        .min_by_key(|c| c.expiry_day)
    else {
        return Vec::new();
    };
    if world.position(owner, contract.id).is_some() {
        return Vec::new();
    }
    let ex = defs.exchange(spec.exchange);
    let need = ex.initial_margin.apply(lots * spec.lot * contract.mark) * 2
        + world.margin_requirement(owner, spec.exchange, ex.initial_margin);
    let have = world.margin_balance(owner, spec.exchange);
    let mut out = Vec::new();
    if need > have {
        let top_up = need - have;
        let cash = world.agent(owner).map(|a| a.cash).unwrap_or(0);
        if top_up > cash / 5 {
            return Vec::new();
        }
        out.push(Command::DepositMargin { owner, exchange: spec.exchange, amount: top_up });
    }
    out.push(Command::TradeFutures { owner, contract: contract.id, lots: -lots });
    out
}

/// 计划用的航程天数：取当前导航周期与下一周期中较长者（航程可能跨期）。
fn plan_days(world: &World, fleet: &Fleet, here: LocId, dest: LocId) -> Option<i64> {
    let defs = &world.defs;
    let s = defs.nav.grid.period_on(world.day());
    let a = fleet_days_compressed(defs, fleet, defs.nav.compressed_path(s, here, dest)?);
    let b = defs
        .nav
        .compressed_path((s + 1) % defs.nav.grid.period_count(), here, dest)
        .map(|p| fleet_days_compressed(defs, fleet, p))
        .unwrap_or(a);
    Some(a.max(b))
}

/// 只在本次决策需要时建立，按原港口顺序保留可达目的地。
/// 卸货与装货分别计算，不能跨过修船、换船或补员命令复用旧舰队的航程。
fn destination_days(world: &World, fleet: &Fleet, here: LocId) -> Vec<(LocId, i64)> {
    let mut destinations = Vec::with_capacity(world.defs.port_ids().count().saturating_sub(1));
    for dest in world.defs.port_ids() {
        if dest != here
            && let Some(days) = plan_days(world, fleet, here, dest)
        {
            destinations.push((dest, days));
        }
    }
    destinations
}

/// 现有货物加上 days 天的粮水是否装得下。
fn trip_fits(defs: &StaticData, fleet: &Fleet, days: i64) -> bool {
    fleet.cargo_total() + fleet.supplies_space(defs, days.max(1)) <= fleet.capacity()
}

fn fleet_idle_long(fleet: &Fleet, params: &PlannerParams) -> bool {
    fleet.idle_days >= params.idle_before_move
}

/// 补给到够用 days 天（口粮的费用与补给命令同一算法：从当地市场买或按固定价）。
#[allow(clippy::too_many_arguments)]
fn push_supplies(
    out: &mut Vec<Command>,
    world: &World,
    here: LocId,
    fleet: &Fleet,
    owner: OwnerId,
    days: i64,
    cash: Money,
) -> bool {
    let want = fleet.supplies_needed(&world.defs, days.max(1));
    let food = (want - fleet.food).max(0);
    let water = (want - fleet.water).max(0);
    if food == 0 && water == 0 {
        return true;
    }
    let (food_cost, _) = crate::market::provisions_quote(world, here, food);
    let cost = food_cost + water * world.defs.rules.water_price;
    if cost > cash {
        return false;
    }
    out.push(Command::Resupply { owner, fleet: fleet.id, food, water });
    true
}

/// 换港目标：此地以外、廉价商品多的港口，距离近者优先。
fn reposition_target(
    world: &World,
    fleet: &Fleet,
    destinations: &[(LocId, i64)],
    margin: i64,
    rng: &mut Rng,
) -> Option<(LocId, i64)> {
    let defs = &world.defs;
    let sight = world.sight(fleet.owner);
    let mut cands: Vec<(LocId, i64)> = Vec::new();
    for &(dest, days) in destinations {
        if !trip_fits(defs, fleet, days + supply_margin(margin, days)) {
            continue;
        }
        let Some(ls) = world.state.locations.get(dest.idx()) else { continue };
        // 便宜程度：基准价 / 所知的价 超过 1 的部分之和（不知道行情的港口为 0；开放市场打开时只看那里出售的商品）
        let sale = defs.rules.open_market.enabled.then(|| world.market_sale_list(dest));
        let cheapness: i64 = ls
            .market
            .iter()
            .filter(|(g, e)| !world.rare_good(**g) && !e.extra && sale.as_ref().is_none_or(|s| s.contains(*g)))
            .filter_map(|(g, _)| sight.market(dest, *g))
            .map(|k| (mul_div(k.entry.base_price, 100, k.price.max(1)) - 100).max(0))
            .sum();
        cands.push((dest, (cheapness + 10) * 100 / (days + 5)));
    }
    cands.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    cands.truncate(4);
    let weights: Vec<i64> = cands.iter().map(|c| c.1.max(1)).collect();
    rng.weighted(&weights).and_then(|i| destinations.iter().copied().find(|(dest, _)| *dest == cands[i].0))
}

/// 商会每月一次的经营决策：港口投资、建设产业并出售产出、期货投机与套保。
pub fn company_monthly(world: &World, owner: OwnerId, rng: &mut Rng) -> Vec<Command> {
    use crate::warehouse::Holder;
    let mut out = Vec::new();
    let Some(cid) = owner.company() else { return out };
    let day = world.day();
    if world.defs.calendar.date_of(day).day - 1 != (cid.0 as u32 * 11 + 5) % world.defs.calendar.month_days(day) {
        return out;
    }
    let defs = &world.defs;
    let npc = &defs.rules.npc;
    let Ok(agent) = world.agent(owner) else { return out };
    let home = agent.home;

    // 1. 港口投资：每年一次，投在本据港
    if world.defs.calendar.date_of(day).month - 1 == cid.0 as u32 % world.defs.calendar.months().len() as u32
        && agent.cash > npc.invest_above
    {
        let amount = npc.invest_share.apply(agent.cash).max(defs.rules.invest.min_amount);
        out.push(Command::InvestPort { owner, loc: home, amount });
    }

    // 2. 产业：还没有产业且现金充裕时，在本据港建一座采集类产业（产出为当地特产）
    let has_industry = world.state.industries.values().any(|i| i.owner == owner);
    if !has_industry && agent.cash > npc.industry_above {
        let recipe = defs.recipes.iter().enumerate().find(|(_, r)| {
            r.inputs.is_empty()
                && r.outputs.iter().all(|(g, _)| defs.loc(home).market.iter().any(|m| m.good == *g && m.specialty))
        });
        if let Some((ri, r)) = recipe {
            if world.warehouse(owner, home).is_none() {
                out.push(Command::RentWarehouse { owner, loc: home, capacity: 400 });
            }
            out.push(Command::BuildIndustry { owner, loc: home, kind: r.industry, recipe: RecipeId::from_idx(ri) });
        }
    }
    // 仓库里的产出按月卖出
    for (li, ls) in world.state.locations.iter().enumerate() {
        let Some(w) = ls.warehouses.get(&owner) else { continue };
        let loc = LocId::from_idx(li);
        for (g, q) in &w.stock {
            if *q > 0 && ls.market.contains_key(g) && !is_hedged(world, owner, *g) {
                out.push(Command::SellFrom {
                    owner,
                    holder: Holder::Warehouse(loc),
                    good: *g,
                    qty: *q,
                    min_total: None,
                });
            }
        }
    }

    // 3. 期货：风险偏好较高的商会按现货动量投机；持有交割港现货的做空套保
    if defs.futures_specs.is_empty() {
        return out;
    }
    let mut candidates: Vec<(usize, i64)> = Vec::new();
    // 交割港的现货走势只看自己知道的（信息时效）
    let sight = world.sight(owner);
    for (si, spec) in defs.futures_specs.iter().enumerate() {
        let Some(k) = sight.market(spec.delivery, spec.good) else { continue };
        let n = k.history_len();
        if n < 30 {
            continue;
        }
        let old = k.history_at(n - 30).unwrap_or(1).max(1);
        let momentum = Fx::ratio(k.price - old, old).raw();
        candidates.push((si, momentum));
    }
    // 先处理已有持仓：持有满 30 天或临近到期则平仓
    for (id, book) in &world.state.futures.positions {
        let Some(p) = book.get(&owner) else { continue };
        let Some(c) = world.state.futures.contracts.get(id) else { continue };
        if day.saturating_sub(p.opened_day) >= 30 || c.expiry_day <= day + 5 {
            out.push(Command::TradeFutures { owner, contract: *id, lots: -p.lots });
        }
    }
    if agent.strategy.as_ref().is_none_or(|s| s.risk < Fx::from_pct(50)) {
        return out;
    }
    let weights: Vec<i64> = candidates.iter().map(|(_, m)| m.abs()).collect();
    let Some(pick) = rng.weighted(&weights) else { return out };
    let (si, momentum) = candidates[pick];
    if momentum.abs() < npc.futures_momentum.raw() {
        return out;
    }
    let spec = &defs.futures_specs[si];
    let Some(contract) = world
        .state
        .futures
        .contracts
        .values()
        .filter(|c| !c.settled && c.spec as usize == si && c.expiry_day >= day + 20)
        .min_by_key(|c| c.expiry_day)
    else {
        return out;
    };
    if world.position(owner, contract.id).is_some() {
        return out;
    }
    let lots = if momentum > 0 { 2 } else { -2 };
    let ex = defs.exchange(spec.exchange);
    let need = ex.initial_margin.apply(2 * spec.lot * contract.mark) * 2
        + world.margin_requirement(owner, spec.exchange, ex.initial_margin);
    let have = world.margin_balance(owner, spec.exchange);
    if need > have {
        let top_up = need - have;
        if top_up > agent.cash / 5 {
            return out;
        }
        out.push(Command::DepositMargin { owner, exchange: spec.exchange, amount: top_up });
    }
    out.push(Command::TradeFutures { owner, contract: contract.id, lots });
    out
}

/// 是否已有该商品的期货空头（套保中的现货暂不卖出）。
fn is_hedged(world: &World, owner: OwnerId, good: GoodId) -> bool {
    world.state.futures.positions.iter().any(|(id, book)| {
        book.get(&owner).is_some_and(|p| p.lots < 0)
            && world
                .state
                .futures
                .contracts
                .get(id)
                .is_some_and(|c| world.defs.futures_specs[c.spec as usize].good == good)
    })
}
