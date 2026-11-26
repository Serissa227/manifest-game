//! 每日 tick。
//!
//! 一个 tick 等于一天，系统执行顺序固定（与 docs/ARCHITECTURE.md 一致）：
//! 1. 命令执行（由调用方在调用 [`World::end_day`] 之前逐条 `apply`）
//! 2. 生产与消耗（各地市场、城镇工坊、产业、殖民地工程与生产）
//! 3. 现货市场调整（收盘之后：城镇工坊的价值比、人口与繁荣度、本地商人的预期与囤货）
//! 4. 期货盯市与到期处理
//! 5. 舰队与商队移动（含海上与陆上风险）、海盗与海战、殖民地遭袭、探索与发现
//! 6. 事件结算（委托合同、外交关系、港口发展度、每季度势力占领殖民点）
//! 7. NPC 决策（以命令执行）
//! 8. 账本日结（工资与开销、仓租、殖民地粮食消耗与月末结算、银行、资不抵债处理、航海士、货币流通、月末与年末报表、胜负判定）

use crate::circulation::Sector;
use crate::command::{Command, CommandOutcome};
use crate::error::{CommandError, CoreError};
use crate::fixed::{Fx, Money};
use crate::ids::*;
use crate::ledger::{Account, CashClass, JournalEntry, Memo};
use crate::log::{LogEvent, LogKind};
use crate::market::Side;
use crate::npc::{PlannerParams, company_monthly, plan_load, stage_unload};
use crate::rng::{Domain, Rng};
use crate::treasury::Flow;
use crate::warehouse::Holder;
use crate::world::{FleetLocation, World};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

mod light_world;

/// 一天结束后的摘要。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DayReport {
    pub day: u32,
    pub arrivals: Vec<(FleetId, LocId)>,
    pub month_end: bool,
    pub year_end: bool,
}

impl World {
    /// 执行一个完整 tick：先按顺序执行命令，再完成当天其余步骤。
    pub fn tick(
        &mut self,
        commands: &[Command],
    ) -> Result<(Vec<Result<CommandOutcome, CommandError>>, DayReport), CoreError> {
        let results = commands.iter().map(|c| c.apply(self)).collect();
        let report = self.end_day()?;
        Ok((results, report))
    }

    /// 完成当天第 2–8 步并推进日期。
    pub fn end_day(&mut self) -> Result<DayReport, CoreError> {
        self.end_day_with(|_| true)
    }
    /// 每个新日期先交给会话执行已排期命令；返回 false 可在重放终点停止时间差。
    pub fn end_day_with(&mut self, mut opened: impl FnMut(&mut World) -> bool) -> Result<DayReport, CoreError> {
        self.end_day_observed_with(&mut opened, &mut |_| {})
    }

    fn end_day_observed_with(
        &mut self,
        opened: &mut impl FnMut(&mut World) -> bool,
        observed: &mut impl FnMut(LightWorldStep),
    ) -> Result<DayReport, CoreError> {
        if self.defs.realms.is_empty() {
            let report = self.end_one_day(observed)?;
            opened(self);
            return Ok(report);
        }
        self.finish_upbringing()?;
        if self.upbringing_waiting() {
            return Err(CoreError::UpbringingPaused);
        }
        let resuming = self.state.realms.debt > 0;
        if !resuming {
            self.prepare_realm_night();
        }
        let mut report = self.end_one_day(observed)?;
        if resuming {
            self.state.realms.debt -= 1;
        }
        let mut keep_skipping = opened(self);
        let mut skipped = 0;
        while keep_skipping
            && self.state.realms.debt > 0
            && skipped < crate::realms::MAX_SKIP
            && !self.realm_skip_paused()
        {
            let next = self.end_one_day(observed)?;
            self.state.realms.debt -= 1;
            skipped += 1;
            report.day = next.day;
            report.arrivals.extend(next.arrivals);
            report.month_end |= next.month_end;
            report.year_end |= next.year_end;
            keep_skipping = opened(self);
        }
        Ok(report)
    }
    fn end_one_day(&mut self, observed: &mut impl FnMut(LightWorldStep)) -> Result<DayReport, CoreError> {
        self.finish_upbringing()?;
        if self.upbringing_waiting() {
            return Err(CoreError::UpbringingPaused);
        }
        if self.defs.rules.upbringing.light_world && self.upbringing_active() {
            return self.end_light_world_day_observed(observed);
        }
        let day = self.state.day;
        // 2. 生产与消耗
        self.market_production();
        self.workshops_run();
        self.industry_production()?;
        self.colony_production()?;
        // 3. 现货市场调整（此后记下的行情包含当天的收盘）
        self.market_adjust();
        self.state.closed = true;
        self.workshops_close();
        self.people_day();
        self.merchants_day();
        self.track_player_trades();
        // 4. 期货盯市与到期处理
        self.futures_day()?;
        // 商馆代办（T03，`[agency]`；没有挂单时什么也不做）：按当天收盘后的价格逐张成交
        self.agency_day()?;
        // 5. 舰队与商队移动
        // 前一天出现、当天没有回应的奇遇就此作罢（故事线的章节不会过期）
        self.story_expire();
        let arrivals = self.move_fleets()?;
        self.move_caravans()?;
        self.battle_day()?;
        self.colony_raids()?;
        self.finish_landing_day();
        // H05 岸上差事（规则关着、没有营地时什么也不做）
        self.finish_shore_day();
        self.explore_day();
        // 剧情事件：推荐角色的故事线与奇遇（只在立过主角身世的对局里；舰队到港、发现物都已结算）
        self.story_day();
        // H04 海上所见：过期的消失，再给海上的玩家舰队掷一次（开关关闭时什么也不做）
        self.sightings_day();
        // H06 喊话：过期的结伴、休战清掉
        self.hail_day();
        // H08 航海日志的一程（开始、到港结算）与甲板闲话（开关关闭时什么也不做）
        self.voyage_log_day();
        self.banter_day();
        // 6. 事件结算
        self.events_step()?;
        self.ideas_day()?;
        self.lineages_day();
        self.societies_day()?;
        self.creatures_day()?;
        self.history_day()?;
        self.observe_history();
        // 7. NPC 决策
        self.npc_step()?;
        // 势力的经济政策：记下特产被买走的数量，月末按规则触发
        self.policy_day()?;
        // 信息时效：在场各方记下实时的行情，撕掉告示板上过旧的消息
        self.info_day_end();
        // 8. 账本日结
        let (month_end, year_end) = self.ledger_day_end()?;
        self.close_story2_windows();
        let player_arrived: Vec<_> = arrivals
            .iter()
            .filter(|(fleet, loc)| {
                self.flagship(OwnerId::Player) == Some(*fleet)
                    && self.cast_player_place().is_some_and(|p| p.loc == *loc)
            })
            .map(|(_, loc)| *loc)
            .collect();
        for loc in player_arrived {
            self.hear_news_at(loc, true);
        }
        self.finish_upbringing_day()?;
        self.settle_due_contests()?;
        self.state.day += 1;
        self.arcana_day();
        self.legend_ships_day()?;
        self.new_upbringing_day()?;
        // 次日先处理物品阅读/补货，再处理拍卖，最后让人物与故事看到已结算的物品和账目。
        self.items_day()?;
        self.prepare_upbringing_reading();
        self.prepare_training_fleet();
        self.auctions_day()?;
        self.cast_meet_here();
        self.queue_upbringing_events();
        // 新一天的头一次刷新：节奏的闸在这里统一放行这一夜出现的事（规则关闭时就是普通的刷新）
        self.refresh_story2_day_start();
        // 开了节奏规则的世界：过闸的事排定之后，名额有剩才掷当天的奇遇（没开的世界已在第 5 步之后掷过；
        // 养成期的轻量日结不调用它，奇遇本来也不在养成期出）
        self.story_encounter_day_start();
        self.finish_upbringing()?;
        self.state.closed = false;
        Ok(DayReport { day, arrivals, month_end, year_end })
    }

    /// 第 6 步：委托合同、外交关系、港口发展度。
    fn events_step(&mut self) -> Result<(), CoreError> {
        self.contracts_step()?;
        self.diplomacy_step()?;
        self.invest_step()?;
        self.event_day();
        self.colony_claims();
        Ok(())
    }

    /// 第 7 步：NPC 商会按规则决策，决策以命令执行。
    fn npc_step(&mut self) -> Result<(), CoreError> {
        // 商会跟投（T02，`[npc_invest]`；关闭时什么也不做）：每月 1 日，用上个月记下的成交额挑港口
        self.npc_invest_step()?;
        let day = self.state.day;
        let seed = self.state.seed;
        let companies: Vec<OwnerId> = self
            .state
            .agents
            .values()
            .filter(|a| !a.bankrupt && a.owner.company().is_some())
            .map(|a| a.owner)
            .collect();
        for owner in companies {
            let params = PlannerParams::for_owner(self, owner);
            let fleets: Vec<FleetId> =
                self.fleets_of(owner).filter(|f| f.docked_at().is_some()).map(|f| f.id).collect();
            for fid in fleets {
                let mut rng = Rng::derive(seed, day, Domain::Company, fid.0 as u64, 0);
                for cmd in stage_unload(self, fid, &params) {
                    let result = cmd.apply(self);
                    // 商会 2.0：卖出主货时核对出航时的预测、平掉套保
                    if let (Command::Sell { good, .. }, Some(q)) = (&cmd, crate::commerce::traded(&result)) {
                        let q = q.clone();
                        self.review_sale(fid, *good, &q);
                    }
                }
                let load = plan_load(self, fid, &params, &mut rng);
                let mut sailed = true;
                for cmd in load.commands {
                    if cmd.apply(self).is_err() {
                        sailed = false;
                        break;
                    }
                }
                // 商会 2.0：出航之后开套保（失败不影响出航），记下这趟的计划
                if sailed && let Some(mut plan) = load.plan {
                    for cmd in load.hedge {
                        let ok = cmd.apply(self).is_ok();
                        if let (true, Command::TradeFutures { contract, lots, .. }) = (ok, &cmd) {
                            plan.hedge = Some((*contract, *lots));
                        }
                    }
                    if let Ok(f) = self.fleet_mut(fid)
                        && f.docked_at().is_none()
                    {
                        f.plan = Some(plan);
                    }
                }
            }
            self.company_expand(owner)?;
            self.company_review(owner)?;
            let mut rng = Rng::derive(seed, day, Domain::Company, 0, owner.company().map(|c| c.0 as u64).unwrap_or(0));
            for cmd in company_monthly(self, owner, &mut rng) {
                let _ = cmd.apply(self);
            }
        }
        Ok(())
    }

    /// 商会扩张：现金充裕时在本据港买船组建新舰队。
    fn company_expand(&mut self, owner: OwnerId) -> Result<(), CoreError> {
        let Some(cid) = owner.company() else { return Ok(()) };
        // 每家商会每月检查一次，错开日期
        if self.defs.calendar.date_of(self.state.day).day - 1
            != (cid.0 as u32 * 7) % self.defs.calendar.month_days(self.state.day)
        {
            return Ok(());
        }
        let npc = self.defs.rules.npc.clone();
        let fleet_count = self.fleets_of(owner).count();
        // 舰队上限（商会 2.0 随净资产增长）
        if fleet_count >= self.company_fleet_cap(owner) {
            return Ok(());
        }
        let agent = self.agent(owner)?;
        let (cash, home) = (agent.cash, agent.home);
        // 没有舰队时只要买得起就重建；否则需要现金达到船价的若干倍
        let multiple = if fleet_count == 0 { Fx::ONE } else { npc.expand_cash_multiple };
        // 船厂清单随发展度（T02 `[shipyard_growth]`；关闭时就是数据里的清单）
        let best = self
            .shipyard(home)
            .into_iter()
            .filter(|s| multiple.apply(self.defs.ship(*s).price) <= cash)
            .max_by_key(|s| (self.defs.ship(*s).capacity, s.0));
        if let Some(ship_type) = best {
            let _ = Command::FoundFleet { owner, at: home, ship_type }.apply(self);
        }
        Ok(())
    }

    /// 第 8 步。返回（是否月末, 是否年末）。
    fn ledger_day_end(&mut self) -> Result<(bool, bool), CoreError> {
        let day = self.state.day;
        let wage = self.defs.rules.crew_wage;
        // 船员工资与商队开销按所有者汇总（货币流通：花在舰队的停泊港或这一程的目的港、商队所在的城市）
        let mut wages: BTreeMap<OwnerId, Money> = BTreeMap::new();
        let mut places: BTreeMap<OwnerId, Vec<(Sector, Money)>> = BTreeMap::new();
        for f in self.state.fleets.values().filter(|f| !self.is_training_fleet(f.id)) {
            *wages.entry(f.owner).or_insert(0) += f.crew * wage;
            places.entry(f.owner).or_default().push((self.fleet_town(f.id), f.crew * wage));
        }
        for c in self.state.caravans.values() {
            *wages.entry(c.owner).or_insert(0) += c.daily_cost(&self.defs);
            places.entry(c.owner).or_default().push((self.caravan_town(c.id), c.daily_cost(&self.defs)));
        }
        for (owner, amount) in wages {
            // 会计降低工资开销
            let amount = (Fx::ONE - self.wage_discount(owner)).apply(amount);
            if amount > 0 {
                self.book_spread(
                    owner,
                    Flow::Wages,
                    places.get(&owner).map(|v| v.as_slice()).unwrap_or(&[]),
                    JournalEntry::new(day, Memo::Wages, CashClass::Operating)
                        .dr(Account::Wages, amount)
                        .cr(Account::Cash, amount),
                )?;
            }
        }
        self.industry_day_end()?;
        self.warehouse_day_end()?;
        self.colony_consumption()?;
        let month_end = self.defs.calendar.month_end(day);
        let year_end = self.defs.calendar.year_end(day);
        if month_end {
            self.colony_month_end()?;
        }
        self.bank_day_end()?;
        self.insolvency_step()?;
        self.mates_day();
        // 主角的生日（ECONOMY.md 5.4）
        self.captain_day();
        // 商馆分红（T02，`[dividends]`；关闭时什么也不做）：每月 1 日，上个月的腹地收入都已进了钱袋
        self.dividends_month_start()?;
        // 货币流通：腹地收入与漏出，月末的财政与经济月报，次日报价用的流动性系数（ECONOMY.md 6.9）
        self.circulation_day_end()?;

        if month_end {
            self.mates_month_end()?;
            // 与算学奇才共事满一年的主角学会他的一种方法；季末没有受雇的奇才换一处酒馆（ECONOMY.md 4.3.1）
            self.captain_month_end();
            self.geniuses_wander();
            for a in self.state.agents.values_mut() {
                a.ledger.close_month_in(day, &self.defs.calendar);
            }
        }
        if year_end {
            self.record_year_facts(day);
            for a in self.state.agents.values_mut() {
                a.ledger.close_year_in(day, &self.defs.calendar);
            }
        }
        self.check_outcome();
        Ok((month_end, year_end))
    }

    /// 资不抵债：现金持续为负超过期限时，商会破产清算，玩家破产重组。
    fn insolvency_step(&mut self) -> Result<(), CoreError> {
        let limit = self.defs.rules.insolvency_days;
        let owners: Vec<OwnerId> = self.state.agents.keys().copied().collect();
        for owner in owners {
            let agent = self.agent_mut(owner)?;
            if agent.bankrupt {
                continue;
            }
            if agent.cash < 0 {
                agent.negative_days += 1;
            } else {
                agent.negative_days = 0;
            }
            if agent.negative_days >= limit {
                if owner.is_player() {
                    self.reorganize(owner)?;
                } else {
                    self.liquidate(owner)?;
                }
            }
        }
        Ok(())
    }

    /// 以现货市场价卖出某持有者中的全部货物；当地不收购的货物记为损失。
    fn dump_holder(&mut self, owner: OwnerId, holder: Holder, loc: LocId) -> Result<(), CoreError> {
        let day = self.state.day;
        let goods: Vec<(GoodId, i64)> = match holder {
            Holder::Fleet(id) => self.fleet(id)?.cargo.iter().map(|(g, q)| (*g, *q)).collect(),
            Holder::Caravan(id) => self.caravan(id)?.cargo.iter().map(|(g, q)| (*g, *q)).collect(),
            Holder::Warehouse(l) => {
                self.warehouse(owner, l).map(|w| w.stock.iter().map(|(g, q)| (*g, *q)).collect()).unwrap_or_default()
            }
        };
        for (good, qty) in goods {
            let q = if self.market(loc, good).is_some() {
                crate::market::quote(self, owner, loc, good, Side::Sell, qty).ok()
            } else {
                None
            };
            match q {
                Some(q) => {
                    self.apply_trade_to_market(&q, Some(owner));
                    self.holder_take(owner, holder, good, qty)?;
                    let cost = self.agent_mut(owner)?.book.remove(good, qty);
                    self.book_external(
                        owner,
                        Flow::Market,
                        self.town_sector(loc),
                        JournalEntry::new(day, Memo::Liquidation, CashClass::Operating)
                            .dr(Account::Cash, q.total)
                            .dr(Account::Taxes, q.tax)
                            .cr(Account::Sales, q.gross)
                            .dr(Account::CostOfGoods, cost)
                            .cr(Account::Inventory, cost),
                    )?;
                    let m = &mut self.state.money;
                    *m.sources.entry(Flow::Market).or_insert(0) += q.tax;
                    *m.sinks.entry(Flow::Tax).or_insert(0) += q.tax;
                    self.transfer(self.town_sector(loc), self.treasury_of(loc), q.tax, Flow::Tax);
                }
                None => {
                    self.holder_lose(owner, holder, good, qty)?;
                }
            }
        }
        Ok(())
    }

    /// 清算一支舰队：在港则卖货卖船，在海上则全部核销。`keep_one` 为真时保留一艘最便宜的船。
    fn liquidate_fleet(&mut self, fid: FleetId, keep_one: bool) -> Result<(), CoreError> {
        let day = self.state.day;
        let (owner, loc) = {
            let f = self.fleet(fid)?;
            (f.owner, f.docked_at())
        };
        let Some(loc) = loc else {
            if keep_one {
                return Ok(());
            }
            return self.destroy_fleet(fid);
        };
        self.dump_holder(owner, Holder::Fleet(fid), loc)?;
        let mut ships = std::mem::take(&mut self.fleet_mut(fid)?.ships);
        ships.sort_by_key(|s| (s.book_value, s.kind));
        let kept = if keep_one && !ships.is_empty() { Some(ships.remove(0)) } else { None };
        for s in ships {
            let proceeds = self.ship_resale(&s);
            let book = s.book_value;
            let mut entry = JournalEntry::new(day, Memo::Liquidation, CashClass::Investing)
                .dr(Account::Cash, proceeds)
                .cr(Account::Ships, book);
            if proceeds >= book {
                entry = entry.cr(Account::AssetGains, proceeds - book);
            } else {
                entry = entry.dr(Account::Losses, book - proceeds);
            }
            self.book_external(owner, Flow::Shipyard, self.fleet_town(fid), entry)?;
        }
        match kept {
            Some(s) => {
                let crew_max = self.defs.ship(s.kind).crew_max;
                let f = self.fleet_mut(fid)?;
                f.ships = vec![s];
                f.crew = f.crew.min(crew_max);
                let cap = f.capacity();
                f.food = f.food.min(cap / 2);
                f.water = f.water.min(cap - f.food);
                f.normalize_supplies();
            }
            None => {
                self.state.fleets.remove(&fid);
            }
        }
        Ok(())
    }

    /// 清算舰队以外的资产：期货平仓并提回保证金、仓库存货卖出、产业与商队变卖。
    fn liquidate_other_assets(&mut self, owner: OwnerId) -> Result<(), CoreError> {
        let day = self.state.day;
        // 期货
        let exchanges: Vec<ExchangeId> = (0..self.defs.exchanges.len()).map(ExchangeId::from_idx).collect();
        for ex in exchanges {
            self.force_liquidate(owner, ex)?;
            let bal = self.margin_balance(owner, ex);
            if bal > 0 {
                *self.state.futures.margin.entry(owner).or_default().entry(ex).or_insert(0) = 0;
                self.book_internal(
                    owner,
                    JournalEntry::new(day, Memo::Margin, CashClass::Operating)
                        .dr(Account::Cash, bal)
                        .cr(Account::MarginDeposits, bal),
                )?;
            }
        }
        // 仓库
        let locs: Vec<LocId> = (0..self.state.locations.len())
            .map(LocId::from_idx)
            .filter(|l| self.state.locations[l.idx()].warehouses.contains_key(&owner))
            .collect();
        for loc in locs {
            self.dump_holder(owner, Holder::Warehouse(loc), loc)?;
        }
        // 产业
        let inds: Vec<IndustryId> = self.state.industries.values().filter(|i| i.owner == owner).map(|i| i.id).collect();
        for id in inds {
            let _ = Command::SellIndustry { owner, industry: id }.apply(self);
        }
        // 殖民地：按账面价值的一半出售（仓库存货已在上面处理）
        self.sell_colonies(owner)?;
        // 商队：在城则卖货、解散；在路上则货物与驮畜损失
        let cars: Vec<CaravanId> = self.caravans_of(owner).map(|c| c.id).collect();
        for id in cars {
            match self.caravan(id)?.at() {
                Some(loc) => {
                    self.dump_holder(owner, Holder::Caravan(id), loc)?;
                    let _ = Command::DisbandCaravan { owner, caravan: id }.apply(self);
                }
                None => {
                    let goods: Vec<(GoodId, i64)> = self.caravan(id)?.cargo.iter().map(|(g, q)| (*g, *q)).collect();
                    for (g, q) in goods {
                        self.holder_lose(owner, Holder::Caravan(id), g, q)?;
                    }
                    let book = self.caravan(id)?.book_value;
                    self.book_internal(
                        owner,
                        JournalEntry::new(day, Memo::Liquidation, CashClass::Investing)
                            .dr(Account::Losses, book)
                            .cr(Account::Property, book),
                    )?;
                    self.state.caravans.remove(&id);
                }
            }
        }
        Ok(())
    }

    /// 核销负现金（破产时欠款无法偿还）。
    fn write_off_debt(&mut self, owner: OwnerId) -> Result<(), CoreError> {
        let day = self.state.day;
        let cash = self.agent(owner)?.cash;
        if cash < 0 {
            self.book_external(
                owner,
                Flow::BadDebt,
                Sector::Hinterland,
                JournalEntry::new(day, Memo::Reorganization, CashClass::Financing)
                    .dr(Account::Cash, -cash)
                    .cr(Account::OtherIncome, -cash),
            )?;
        }
        Ok(())
    }

    /// NPC 商会破产清算。
    fn liquidate(&mut self, owner: OwnerId) -> Result<(), CoreError> {
        // 代办挂单先撤掉、预留金退回现金（T03；没有挂单时什么也不做）
        self.agency_cancel_all(owner)?;
        let fleets: Vec<FleetId> = self.fleets_of(owner).map(|f| f.id).collect();
        for fid in fleets {
            self.liquidate_fleet(fid, false)?;
        }
        self.liquidate_other_assets(owner)?;
        self.write_off_loans(owner)?;
        self.write_off_debt(owner)?;
        let agent = self.agent_mut(owner)?;
        agent.bankrupt = true;
        agent.negative_days = 0;
        let day = self.state.day;
        self.push_log(LogEvent { day, kind: LogKind::Bankrupt { owner } });
        Ok(())
    }

    /// 玩家破产重组：拍卖资产（保留一支舰队中最便宜的一艘船继续经营），核销欠款与贷款，信用降级，重组次数加一。
    fn reorganize(&mut self, owner: OwnerId) -> Result<(), CoreError> {
        self.agency_cancel_all(owner)?;
        let fleets: Vec<FleetId> = self.fleets_of(owner).map(|f| f.id).collect();
        let mut kept_one = false;
        for fid in fleets {
            // 保留第一支舰队（在海上的舰队无法拍卖，原样保留）
            let keep = !kept_one;
            self.liquidate_fleet(fid, keep)?;
            kept_one = true;
        }
        self.liquidate_other_assets(owner)?;
        self.write_off_loans(owner)?;
        self.write_off_debt(owner)?;
        let agent = self.agent_mut(owner)?;
        agent.reorganizations += 1;
        agent.negative_days = 0;
        agent.credit.score = (agent.credit.score - 30).max(0);
        agent.credit.defaults += 1;
        let day = self.state.day;
        self.push_log(LogEvent { day, kind: LogKind::Reorganized { owner } });
        Ok(())
    }

    /// 是否仍有舰队在海上（测试与统计用）。
    pub fn fleets_at_sea(&self) -> usize {
        self.state.fleets.values().filter(|f| matches!(f.location, FleetLocation::AtSea(_))).count()
    }
}

pub use light_world::LightWorldStep;

impl World {
    /// 日结的步骤通知；观察者只能收到步骤名，不能改世界，计时留在调用层。
    pub fn end_day_observed(&mut self, mut observed: impl FnMut(LightWorldStep)) -> Result<DayReport, CoreError> {
        self.end_day_observed_with(&mut |_| true, &mut observed)
    }
}
