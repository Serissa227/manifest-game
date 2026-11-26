//! 轻量世界恢复：以当前日期的历史状态为准，不补跑被暂停的经济日。
use crate::{
    CoreError, Fx, LocId, OwnerId, World,
    circulation::Sector,
    defs::MarketDef,
    fixed::mul_div,
    ledger::{Account, CashClass, JournalEntry, Memo},
    market,
    treasury::Flow,
    world::{FleetLocation, MarketFlow},
};

impl World {
    /// 调用方分别由结业阶段和预演边界保证只执行一次；本函数不增加存档字段。
    pub(crate) fn reconcile_light_world(&mut self) -> Result<(), CoreError> {
        if !self.defs.rules.upbringing.light_world {
            return Ok(());
        }
        self.recompute_modifiers();
        self.balance_light_markets();
        // 旧养成档可能已有未结义务：按恢复日处理一次，不倒补四年利息和罚金。
        self.futures_day()?;
        self.list_futures(self.day());
        self.contracts_step()?;
        self.bank_day_end()?;
        self.return_light_companies()?;
        self.resume_light_assets();
        // 实物交割可能动过市场；最终库存仍落在同一组均衡点。
        self.balance_light_markets();
        self.state.closed = false;
        if self.info_mode() == crate::info::InfoMode::Carried {
            // 沿用开局的商会全域情报，不让四年前的报价影响第一次出航。
            // 玩家只保留原先实际获知的地点；不赠送远方情报。
            let owners: Vec<_> = self.state.agents.keys().copied().collect();
            for owner in owners {
                let locations: Vec<_> = if owner.is_player() {
                    self.state.info.known.get(&owner).into_iter().flat_map(|known| known.keys().copied()).collect()
                } else {
                    self.defs
                        .locations
                        .iter()
                        .enumerate()
                        .filter(|(_, l)| !l.market.is_empty())
                        .map(|(i, _)| LocId::from_idx(i))
                        .collect()
                };
                for loc in locations {
                    if owner.is_player() && !self.presence(owner).contains(&loc) {
                        continue;
                    }
                    self.learn(owner, self.take_snapshot(loc, crate::info::InfoSource::Visit));
                }
            }
            self.info_day_end();
        }
        if self.circulation_on() {
            let opening = self.sector_balances();
            let c = &mut self.state.circulation;
            c.opening = opening;
            c.flows.clear();
            c.production = 0;
            c.shortfall = 0;
            for treasury in c.treasuries.values_mut() {
                treasury.income = 0;
                treasury.spent = 0;
            }
        }
        self.check_outcome();
        Ok(())
    }

    fn balance_light_markets(&mut self) {
        let defs = self.defs.clone();
        let day = self.day();
        for (index, loc) in self.state.locations.iter_mut().enumerate() {
            let season = defs.locations[index].hemisphere.season(defs.calendar.season_of(day));
            let labour =
                if defs.rules.population.enabled && loc.people.pop0 > 0 { loc.people.labour() } else { Fx::ONE };
            loc.people.sat_sum = [0; 3];
            loc.people.stock_sum = 0;
            loc.people.days = 0;
            for workshop in loc.workshops.values_mut() {
                workshop.month_sum = 0;
                workshop.month_days = 0;
                workshop.made = 0;
                workshop.short = false;
            }
            loc.board.clear();
            for (good, entry) in &mut loc.market {
                let fresh = market::new_entry(
                    &defs,
                    &MarketDef { good: *good, supply: entry.supply, demand: entry.demand, specialty: entry.specialty },
                );
                entry.producer = fresh.producer;
                entry.subst_bp = 0;
                entry.liquidity = Fx::ONE;
                if entry.popular_until <= day {
                    entry.popular_until = 0;
                }
                let (population, tier, substitute) = crate::people::demand_scale(&defs, &loc.people, *good, entry);
                let scale = market::depth_factor(&defs, loc.development).mul(population).mul(tier).mul(substitute);
                entry.target = (scale.apply(entry.demand) * defs.rules.target_stock_days).max(1);
                let supply = market::supply_mult_in(&defs, *good, entry, loc.development, season).mul(labour);
                let demand = market::demand_mult_in(&defs, day, *good, entry, season);
                let production = supply.apply(entry.supply * market::UNIT_BP).max(0);
                let consumption = demand.mul(scale).apply(entry.demand * market::UNIT_BP).max(1);
                entry.stock = mul_div(entry.target, production, consumption).max(0);
                let mult = market::price_mult_in(&defs, day, *good, entry, season);
                let price =
                    defs.rules.price_curve.eval(Fx::ratio(entry.stock, entry.target)).mul(mult).apply(entry.base_price);
                let floor = defs.rules.price_floor.apply(entry.base_price).max(1);
                entry.price = price.clamp(floor, defs.rules.price_cap.apply(entry.base_price).max(floor));
                entry.history.clear();
                entry.monthly.clear();
                entry.flow = MarketFlow::default();
                entry.player_recent = 0;
                entry.month_out = 0;
                entry.merchants = Default::default();
            }
        }
    }

    fn return_light_companies(&mut self) -> Result<(), CoreError> {
        let defs = self.defs.clone();
        let day = self.day();
        for id in defs.company_ids() {
            let owner = OwnerId::Company(id);
            let Some(agent) = self.state.agents.get(&owner).filter(|a| !a.bankrupt) else {
                continue;
            };
            let company = defs.company(id);
            // 保留事件／旧档留下的归属与本据；被毁港改停同势力的开放港，再按编号兜底。
            let home = agent.home;
            let faction = self.location_faction(home);
            let at = if self.location_open(home) && defs.loc(home).is_port() {
                Some(home)
            } else {
                defs.port_ids()
                    .find(|p| self.location_open(*p) && self.location_faction(*p) == faction)
                    .or_else(|| defs.port_ids().find(|p| self.location_open(*p)))
            }
            .ok_or_else(|| CoreError::Internal("结业时没有可供商会停泊的港口".into()))?;
            let cash_delta = company.cash - agent.cash;
            if cash_delta != 0 {
                self.book_external(
                    owner,
                    Flow::Other,
                    Sector::Hinterland,
                    JournalEntry::new(day, Memo::Opening, CashClass::Financing)
                        .dr(Account::Cash, cash_delta)
                        .cr(Account::Capital, cash_delta),
                )?;
            }
            let ids: Vec<_> = self.fleets_of(owner).map(|f| f.id).collect();
            // 不复活已消失的舰队；新局整段冻结，现存首舰队就是开局配置。
            if let Some(first) = ids.first().copied() {
                let mut ships: Vec<_> = company
                    .ships
                    .iter()
                    .map(|kind| {
                        let mut ship = crate::fleet::new_ship(&defs, *kind);
                        ship.built = day;
                        ship
                    })
                    .collect();
                let fleet = self.fleet_mut(first)?;
                // 有独立身份的传说船来自真实授予，不能被普通船的补正抹掉。
                ships.extend(fleet.ships.iter().filter(|s| s.legend.is_some()).cloned());
                let delta = ships.iter().map(|s| s.book_value).sum::<i64>() - fleet.book_value();
                let cargo = std::mem::take(&mut fleet.cargo);
                fleet.ships = ships;
                fleet.crew = (fleet.crew_min(&defs) * 5 / 4).min(fleet.crew_max(&defs));
                fleet.food = 0;
                fleet.water = 0;
                if !cargo.is_empty() {
                    let warehouse = self.state.locations[at.idx()].warehouses.entry(owner).or_default();
                    for (good, quantity) in cargo {
                        *warehouse.stock.entry(good).or_default() += quantity;
                    }
                }
                if delta != 0 {
                    self.book_internal(
                        owner,
                        JournalEntry::new(day, Memo::Opening, CashClass::Investing)
                            .dr(Account::Ships, delta)
                            .cr(Account::Capital, delta),
                    )?;
                }
            }
            for id in ids {
                let fleet = self.fleet_mut(id)?;
                fleet.location = FleetLocation::Docked(at);
                fleet.days_at_sea = 0;
                fleet.idle_days = 0;
                fleet.plan = None;
                fleet.news = None;
                fleet.morale = 100;
            }
            let agent = self.agent_mut(owner)?;
            agent.home = at;
            agent.negative_days = 0;
        }
        self.prune_equipment();
        Ok(())
    }

    fn resume_light_assets(&mut self) {
        let day = self.day();
        for caravan in self.state.caravans.values_mut() {
            if let crate::caravan::CaravanLocation::OnRoad(trek) = &caravan.location
                && let Some(at) = trek.stops.get(trek.leg).copied()
            {
                caravan.location = crate::caravan::CaravanLocation::At(at);
            }
        }
        let mut completed = Vec::new();
        for colony in self.state.colonies.values_mut() {
            // 月报归零，累计遭袭次数属于已经发生的历史。
            colony.stats = crate::colony::ColonyStats { raids: colony.stats.raids, ..Default::default() };
            if colony.construction.as_ref().is_some_and(|c| c.done_day <= day)
                && let Some(construction) = colony.construction.take()
            {
                colony.buildings.insert(construction.building, construction.level);
                completed.push(crate::log::LogKind::ColonyBuilt {
                    colony: colony.id,
                    owner: colony.owner,
                    loc: colony.loc,
                    building: construction.building,
                    level: construction.level,
                });
            }
        }
        for kind in completed {
            self.push_log(crate::log::LogEvent { day, kind });
        }
        // 海盗的自然离场日期仍有效；不在接手时补打一场四年前的遭遇。
        self.state.battles.pirates.clear();
        self.state.battles.pending.clear();
        self.state.battles.tactical.clear();
        self.state.navigation = Default::default();
        self.state.creatures.pending = None;
        self.state.creatures.delays.retain(|_, until| *until > day);
    }
}
