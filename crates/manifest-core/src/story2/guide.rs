//! 引导链的静态资源推演；不走日结、不抽随机，遇到缺项仍按已完成继续，集中报错。
use super::{ChapterDef, Condition, Effect, ObjectiveKind, TrackDef, deeds::Deed, graph, guide_defs::*};
use crate::{
    upbringing::{Capital, Reachability},
    *,
};
use serde::Serialize;
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};

#[derive(Clone, Debug, Default, Serialize)]
pub struct GuideReport {
    pub steps: Vec<StepReport>,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
    pub checks: BTreeMap<String, usize>,
}

#[derive(Clone, Debug, Serialize)]
pub struct StepReport {
    pub line: String,
    pub phase: Phase,
    pub number: usize,
    pub track: String,
    pub chapter: String,
    pub teaches: Vec<String>,
    pub needs: Vec<String>,
    pub gives: Vec<String>,
    pub errors: Vec<String>,
    pub unguaranteed: Vec<String>,
    pub unjudged: Vec<String>,
    pub day: u32,
    pub here: Option<String>,
    pub cash: i64,
    pub known: usize,
    pub warnings: Vec<String>,
}

impl StepReport {
    fn issue(&mut self, check: &str, message: String) {
        self.errors.push(format!(
            "guide:{}:{}:{}（第 {} 步）：{check}：{message}",
            self.line, self.track, self.chapter, self.number
        ));
    }
    fn warning(&mut self, message: String) {
        self.warnings
            .push(format!("guide:{}:{}:{}（第 {} 步）：{message}", self.line, self.track, self.chapter, self.number));
    }
}

/// 家庭资本和本家庭各志向的保底交集，按最少数量取，不把互斥志向的资产叠加。
pub fn minimum_capital(defs: &StaticData, family: &crate::upbringing::FamilyDef) -> Capital {
    let Some(completion) = &family.completion else { return Capital::default() };
    let mut out = completion.capital.clone();
    let caps = std::iter::once(&completion.capital)
        .chain(
            completion
                .paths
                .iter()
                .filter_map(|key| defs.upbringing.paths.iter().find(|p| &p.key == key).map(|p| &p.capital)),
        )
        .collect::<Vec<_>>();
    for c in &caps {
        out.cash = out.cash.min(c.cash);
        out.crew = out.crew.min(c.crew);
        out.food = out.food.min(c.food);
        out.water = out.water.min(c.water);
        for (key, qty) in &mut out.cargo {
            *qty = (*qty).min(c.cargo.get(key).copied().unwrap_or(0));
        }
        for (key, qty) in &mut out.items {
            *qty = (*qty).min(c.items.get(key).copied().unwrap_or(0));
        }
        let mut remaining = c.ships.clone();
        out.ships.retain(|key| {
            if let Some(i) = remaining.iter().position(|k| k == key) {
                remaining.remove(i);
                true
            } else {
                false
            }
        });
        out.known.retain(|a| c.known.contains(a));
        out.regions.retain(|r| c.regions.contains(r));
        out.mates.retain(|m| c.mates.contains(m));
        out.allies.retain(|p| c.allies.contains(p));
    }
    out.cargo.retain(|_, q| *q > 0);
    out.items.retain(|_, q| *q > 0);
    out
}

/// CLI 的视图自查和静态检查共用开局；仅重建资本，不运行养成或航海日结。
pub fn opening_world(defs: &Arc<StaticData>, line: &Line, phase: Phase) -> Result<World, String> {
    let f = defs.upbringing.family(&line.family).ok_or_else(|| format!("没有家庭 {}", line.family))?;
    let scenario = defs
        .scenarios
        .iter()
        .position(|s| s.key == f.scenario)
        .map(ScenarioId::from_idx)
        .ok_or_else(|| format!("没有剧本 {}", f.scenario))?;
    let mut w = World::new(defs.clone(), scenario, 0).map_err(|e| e.to_string())?;
    let request = crate::scenario::NewGameRequest {
        scenario: f.scenario.clone(),
        world: defs.world_key.clone(),
        protagonist: Some(line.protagonist.clone()),
        ..Default::default()
    };
    w.state.protagonist =
        crate::scenario::identity(defs, &defs.scenarios[scenario.idx()], &request).map_err(|e| e.to_string())?;
    w.init_upbringing().map_err(|e| e.to_string())?;
    w.refresh_story2();
    if phase == Phase::Upbringing {
        return Ok(w);
    }
    let capital = minimum_capital(defs, f);
    let at = capital.at.as_deref().unwrap_or(&f.home);
    let loc = defs.find_loc(at).ok_or_else(|| format!("资本地点不存在 {at}"))?;
    w.state.day = w.story2_day(f.graduation).ok_or_else(|| "结业日期无效".to_owned())?;
    w.state.fleets.retain(|_, f| f.owner != OwnerId::Player);
    let ships = capital
        .ships
        .iter()
        .map(|k| {
            defs.ships
                .iter()
                .position(|s| &s.key == k)
                .map(ShipTypeId::from_idx)
                .ok_or_else(|| format!("资本船型不存在 {k}"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let fleet = if ships.is_empty() {
        None
    } else {
        Some(w.add_opening_fleet(OwnerId::Player, loc, &ships, capital.crew).map_err(|e| e.to_string())?)
    };
    if let Some(id) = fleet {
        let f = w.state.fleets.get_mut(&id).ok_or_else(|| "资本舰队未建立".to_owned())?;
        f.food = capital.food;
        f.water = capital.water;
        for (key, qty) in &capital.cargo {
            if let Some(i) = defs.goods.iter().position(|g| &g.key == key) {
                f.cargo.insert(GoodId::from_idx(i), *qty);
            }
        }
    }
    if let Some(a) = w.state.agents.get_mut(&OwnerId::Player) {
        a.cash = capital.cash;
        a.home = loc;
    }
    w.state.cast.place =
        if fleet.is_none() { Some(crate::cast::CastPlace { loc, venue: String::new() }) } else { None };
    w.state.cast.academy = false;
    if let Some(s) = &mut w.state.upbringing {
        s.phase = crate::upbringing::Phase::Done;
    }
    for (key, qty) in &capital.items {
        w.grant_item(OwnerId::Player, key, *qty).map_err(|e| e.to_string())?;
    }
    w.grant_upbringing_extras(&capital).map_err(|e| e.to_string())?;
    for key in &capital.regions {
        let id = defs
            .regions
            .iter()
            .position(|r| &r.key == key)
            .map(RegionId::from_idx)
            .ok_or_else(|| format!("资本海区不存在 {key}"))?;
        crate::story::apply(&mut w, None, &crate::story::StoryEffect::Chart(id)).map_err(|e| e.to_string())?;
    }
    w.state.story2.flags.extend(capital.grant_once.iter().cloned());
    w.state.story2.flags.extend(crate::upbringing::GRADUATION_RESULT_FLAGS.iter().map(|s| (*s).to_owned()));
    w.state.story2.flags.insert(crate::upbringing::GRADUATED_FLAG.into());
    if let Some(c) = &f.completion {
        w.state.story2.flags.extend(c.defaults.flags.iter().cloned());
    }
    for key in &capital.mates {
        if let Some(id) = w.person_mate(key)
            && let Some(m) = w.state.mates.get_mut(&id)
        {
            m.owner = Some(OwnerId::Player);
            m.role = crate::mates::MateRole::None;
            m.hired_on = Some(w.state.day);
        }
    }
    w.state.explore.visited.insert(loc);
    w.reveal_around(defs.loc(loc).cell, 0);
    w.refresh_story2();
    Ok(w)
}

#[derive(Clone)]
struct Model {
    w: World,
    phase: Phase,
    day: u32,
    here: Option<LocId>,
    cash: i64,
    fame: i64,
    known: BTreeSet<LocId>,
    initial: BTreeSet<LocId>,
    visited: BTreeSet<LocId>,
    flags: BTreeMap<String, usize>,
    cargo: BTreeMap<GoodId, i64>,
    items: BTreeMap<String, i64>,
    ships: usize,
    tier: usize,
    mates: BTreeSet<MateId>,
    posts: BTreeSet<String>,
    warehouses: BTreeSet<LocId>,
    industries: Vec<(LocId, String)>,
    deeds: BTreeMap<Deed, u32>,
}

impl Model {
    fn new(w: World, phase: Phase) -> Self {
        let here = w.cast_player_place().map(|p| p.loc);
        let known = w
            .visible_locations()
            .filter(|id| w.defs.loc(*id).is_port())
            .chain(here.filter(|id| w.defs.loc(*id).is_port()))
            .collect::<BTreeSet<_>>();
        let mut cargo = BTreeMap::<GoodId, i64>::new();
        for f in w.fleets_of(OwnerId::Player) {
            for (g, q) in &f.cargo {
                *cargo.entry(*g).or_default() += q;
            }
        }
        let items = w
            .defs
            .items
            .items
            .iter()
            .filter_map(|i| {
                let q = w.item_quantity(OwnerId::Player, &i.key);
                (q > 0).then(|| (i.key.clone(), q))
            })
            .collect();
        Self {
            day: w.day(),
            here,
            cash: w.state.agents.get(&OwnerId::Player).map_or(0, |a| a.cash),
            fame: w.state.agents.get(&OwnerId::Player).map_or(0, |a| a.fame),
            initial: known.clone(),
            known,
            visited: w.state.explore.visited.clone(),
            flags: w.state.story2.flags.iter().map(|f| (f.clone(), 0)).collect(),
            ships: w.fleets_of(OwnerId::Player).map(|f| f.ships.len()).sum(),
            tier: w
                .fleets_of(OwnerId::Player)
                .flat_map(|f| &f.ships)
                .map(|s| w.defs.rules.shipyard_growth.tier(w.defs.ship(s.kind).price))
                .max()
                .unwrap_or(0),
            mates: w.state.mates.iter().filter(|(_, m)| m.owner == Some(OwnerId::Player)).map(|(id, _)| *id).collect(),
            posts: ["captain", "accountant", "trader", "caravan_leader", "industry_manager"]
                .into_iter()
                .map(str::to_owned)
                .chain(w.defs.captain.roles.iter().map(|r| r.key.clone()))
                .filter(|p| w.quest_post_filled(p))
                .collect(),
            warehouses: w
                .state
                .locations
                .iter()
                .enumerate()
                .filter(|(_, l)| {
                    l.warehouses.get(&OwnerId::Player).is_some_and(|v| v.rented.saturating_add(v.owned) > 0)
                })
                .map(|(i, _)| LocId::from_idx(i))
                .collect(),
            industries: w
                .state
                .industries
                .values()
                .filter(|i| i.owner == OwnerId::Player)
                .map(|i| (i.loc, w.defs.industry_types[i.kind.idx()].key.clone()))
                .collect(),
            deeds: w.state.story2.deeds.clone(),
            cargo,
            items,
            w,
            phase,
        }
    }
    fn ports(&self, at: Option<&str>) -> Vec<LocId> {
        match at {
            Some(k) => self.w.defs.find_loc(k).into_iter().collect(),
            None => self.known.iter().copied().collect(),
        }
    }
    fn port(&mut self, key: &str, step: &mut StepReport, move_to: bool) -> Option<LocId> {
        let id = self.w.defs.find_loc(key)?;
        if !self.known.contains(&id) {
            let list = |set: &BTreeSet<LocId>| {
                set.iter().map(|id| self.w.defs.loc(*id).key.as_str()).collect::<Vec<_>>().join(",")
            };
            step.issue(
                "可达",
                format!(
                    "要去 {key}，但此时还不知道这座港（开局已知：{}；前面到过：{}）",
                    list(&self.initial),
                    list(&self.visited)
                ),
            );
        }
        if move_to {
            self.here = Some(id);
            self.known.insert(id);
            self.visited.insert(id);
        }
        Some(id)
    }
    fn spend(&mut self, amount: i64, reason: &str, step: &mut StepReport) {
        let amount = amount.max(0);
        step.needs.push(format!("{reason}: {amount}"));
        if self.cash < amount {
            step.issue("可达", format!("{reason} 要现款 {amount}，开局加已得奖励减必要花费最多 {}", self.cash));
        }
        self.cash = self.cash.saturating_sub(amount);
    }
    fn house(&mut self, at: Option<&str>, ge: u32, step: &mut StepReport) {
        let ports = self.ports(at);
        let pick = ports
            .into_iter()
            .filter(|p| crate::access::investable(&self.w.defs, *p))
            .filter_map(|p| {
                self.w
                    .house_threshold(p, ge as usize)
                    .map(|v| (v.saturating_sub(self.w.invested(OwnerId::Player, p)).max(0), p))
            })
            .min();
        let Some((cost, p)) = pick else {
            step.issue("可达", "没有已知且可投资的港口或商馆档位".into());
            return;
        };
        self.spend(cost, "house_level", step);
        let total = self.w.house_threshold(p, ge as usize).unwrap_or(0);
        let total = total.max(self.w.invested(OwnerId::Player, p));
        self.w.state.locations[p.idx()].investments.insert(OwnerId::Player, total);
    }
    fn warehouse(&mut self, at: Option<&str>, ge: u32, step: &mut StepReport) {
        let ports = self.ports(at);
        let mut left = (ge as usize).saturating_sub(if at.is_some() {
            ports.iter().filter(|p| self.warehouses.contains(p)).count()
        } else {
            self.warehouses.len()
        });
        for p in ports {
            if left == 0 {
                break;
            }
            if self.warehouses.insert(p) {
                // 租约当场不付钱；静态预算预留一格一天的向下取整租金，与 warehouse_day_end 相同。
                self.spend(
                    crate::fixed::mul_div(1, self.w.defs.rules.warehouse.rent_per_100, 100),
                    "rent_warehouse",
                    step,
                );
                left -= 1;
            }
        }
        if left > 0 {
            step.issue("可达", format!("仓库还缺 {left} 处已知港"));
        }
    }
    fn industry(&mut self, at: Option<&str>, kind: Option<&str>, ge: u32, step: &mut StepReport) {
        let ports = self.ports(at);
        let mut have =
            self.industries.iter().filter(|(p, k)| ports.contains(p) && kind.is_none_or(|key| key == k)).count();
        while have < (ge as usize) {
            let pick = ports
                .iter()
                .flat_map(|p| {
                    self.w
                        .defs
                        .industry_types
                        .iter()
                        .filter(move |k| kind.is_none_or(|key| key == k.key))
                        .map(move |k| (*p, k.key.clone(), k.build_cost))
                })
                .filter(|(p, _, _)| {
                    self.w.house_level(OwnerId::Player, *p) > self.industries.iter().filter(|(at, _)| at == p).count()
                })
                .min_by_key(|(p, k, c)| (*c, *p, k.clone()));
            let Some((p, k, cost)) = pick else {
                step.issue("顺序", format!("建产业要先有 {} 的商馆和空位", at.unwrap_or("known_port")));
                break;
            };
            self.spend(cost, "build_industry", step);
            self.industries.push((p, k));
            have += 1;
        }
    }
    fn buy_ship(&mut self, at: Option<&str>, count: usize, tier: usize, step: &mut StepReport) {
        let pick = self
            .ports(at)
            .into_iter()
            .flat_map(|p| self.w.shipyard(p))
            .filter(|id| self.w.defs.rules.shipyard_growth.tier(self.w.defs.ship(*id).price) >= tier)
            .min_by_key(|id| (self.w.defs.ship(*id).price, *id));
        let Some(id) = pick else {
            step.issue("可达", format!("已知港里没有船厂卖 {tier} 档的船"));
            return;
        };
        self.spend(self.w.defs.ship(id).price.saturating_mul(count as i64), "buy_ship", step);
        self.ships = self.ships.saturating_add(count);
        self.tier = self.tier.max(self.w.defs.rules.shipyard_growth.tier(self.w.defs.ship(id).price));
    }
    fn hire_mates(&mut self, at: Option<&str>, ge: usize, step: &mut StepReport) {
        let ports = self.ports(at);
        while self.mates.len() < ge {
            let pick = self
                .w
                .state
                .mates
                .iter()
                .filter(|(id, m)| !self.mates.contains(id) && m.owner.is_none() && ports.contains(&m.at))
                .filter(|(id, m)| {
                    let d = &self.w.defs.mates[id.idx()];
                    !d.hidden && self.fame >= self.w.defs.rules.discovery.mate_fame(m.level)
                })
                .min_by_key(|(id, _)| (self.w.defs.mates[id.idx()].hire_cost, **id))
                .map(|(id, _)| *id);
            let Some(id) = pick else {
                step.issue("可达", format!("已知港没有可雇且名声门槛不超过 {} 的航海士", self.fame));
                break;
            };
            self.spend(self.w.defs.mates[id.idx()].hire_cost, "hire_mate", step);
            self.mates.insert(id);
        }
    }
    fn item(&mut self, key: &str, qty: i64, step: &mut StepReport) {
        let missing = qty.saturating_sub(self.items.get(key).copied().unwrap_or(0)).max(0);
        if missing == 0 {
            return;
        }
        let price = self
            .known
            .iter()
            .filter(|p| self.w.item_shelf(**p).is_some_and(|s| s.stock.get(key).is_some_and(|q| *q > 0)))
            .filter_map(|p| self.w.item_buy_price(OwnerId::Player, *p, key))
            .min();
        match price {
            Some(p) => self.spend(p.saturating_mul(missing), key, step),
            None => step.issue("可达", format!("{key} 前面没给，已知港也买不到")),
        }
        self.items.insert(key.into(), qty);
    }
    fn goods(&mut self, key: &str, qty: i64, step: &mut StepReport) {
        let Some(i) = self.w.defs.goods.iter().position(|g| g.key == key) else { return };
        let id = GoodId::from_idx(i);
        let missing = qty.saturating_sub(self.cargo.get(&id).copied().unwrap_or(0)).max(0);
        if missing > 0 {
            let price = self
                .known
                .iter()
                .filter(|p| crate::open_market::sale_list(&self.w.defs, **p).contains(&id))
                .filter_map(|p| self.w.state.locations[p.idx()].market.get(&id).map(|m| m.price))
                .min();
            match price {
                Some(p) => self.spend(p.saturating_mul(missing), key, step),
                None => step.issue("可达", format!("{key} 在已知港都不卖")),
            }
        }
        self.cargo.insert(id, 0);
    }
}

impl Model {
    fn deed(&mut self, d: Deed, count: u32, at: Option<&str>, step: &mut StepReport) {
        let generic =
            matches!(d, Deed::Gift | Deed::BuyItem | Deed::Equip | Deed::UseItem | Deed::ReadBook | Deed::Talk);
        if (d.upbringing() && self.phase != Phase::Upbringing)
            || (!d.upbringing() && self.phase == Phase::Upbringing && !generic)
        {
            step.issue("顺序", format!("{}：这个行为在这一期做不了", d.key()));
        }
        if d.reserved() {
            let message = format!("{}：这个行为还没有计数点（由 U06b 接入）", d.key());
            if self.w.defs.rules.quests.guide {
                step.issue("顺序", message);
            } else {
                step.warning(message);
            }
            return;
        }
        let ports = self.ports(at);
        match d {
            Deed::Buy | Deed::Sell | Deed::SellProfit => {
                let choice = ports
                    .iter()
                    .flat_map(|p| crate::open_market::sale_list(&self.w.defs, *p).into_iter().map(move |g| (*p, g)))
                    .filter(|(p, g)| self.w.buy_access(OwnerId::Player, *p).gate(&self.w.defs, *g).is_none())
                    .filter_map(|(p, g)| self.w.state.locations[p.idx()].market.get(&g).map(|m| (m.price, g)))
                    .min();
                if choice.is_none() {
                    step.issue("可达", "港口出售清单没有商誉下可买的货（含保底货）".into());
                }
                if d == Deed::Buy {
                    if let Some((price, g)) = choice {
                        self.spend(price.saturating_mul(i64::from(count)), "buy", step);
                        *self.cargo.entry(g).or_default() += i64::from(count);
                    }
                } else if !self.cargo.values().any(|q| *q > 0) && self.deeds.get(&Deed::Buy).copied().unwrap_or(0) == 0
                {
                    step.issue("顺序", "sell 要先有货物或之前的 buy".into());
                }
            }
            Deed::MarketReport => {
                if let Some(cost) = ports.iter().map(|p| self.w.report_offer(*p).1).min() {
                    self.spend(cost.saturating_mul(i64::from(count)), "market_report", step);
                } else {
                    step.issue("可达", "market_report 没有已知港".into());
                }
            }
            Deed::BuyChart => {
                if ports.is_empty() {
                    step.issue("可达", "buy_chart 没有已知港".into());
                }
                if let Some(cost) =
                    (0..self.w.defs.regions.len()).map(|i| self.w.chart_price(RegionId::from_idx(i))).min()
                {
                    self.spend(cost.saturating_mul(i64::from(count)), "buy_chart", step);
                }
            }
            Deed::License | Deed::Marque => {
                let cost = ports
                    .iter()
                    .map(|p| self.w.defs.faction(self.w.location_faction(*p)))
                    .map(|f| if d == Deed::License { f.license_price } else { f.marque_price })
                    .min();
                if let Some(cost) = cost {
                    self.spend(cost.saturating_mul(i64::from(count)), d.key(), step);
                } else {
                    step.issue("可达", format!("{} 没有已知港", d.key()));
                }
            }
            Deed::Invest => {
                if let Some(p) = ports.iter().find(|p| crate::access::investable(&self.w.defs, **p)).copied() {
                    let cost = self.w.defs.rules.invest.min_amount.saturating_mul(i64::from(count));
                    self.spend(cost, "invest", step);
                    let total = self.w.invested(OwnerId::Player, p).saturating_add(cost);
                    self.w.state.locations[p.idx()].investments.insert(OwnerId::Player, total);
                } else {
                    step.issue("可达", "invest 没有已知且可投资的港口".into());
                }
            }
            Deed::RentWarehouse => self.warehouse(at, 1, step),
            Deed::PlaceOrder => {
                if !ports.iter().any(|p| self.warehouses.contains(p) && self.w.house_level(OwnerId::Player, *p) >= 1) {
                    step.issue("顺序", "place_order 要先有同港仓库和一级商馆".into());
                }
            }
            Deed::BuildIndustry => {
                self.industry(at, None, self.industries.len().saturating_add(count as usize) as u32, step)
            }
            Deed::BuyShip => self.buy_ship(at, count as usize, 0, step),
            Deed::Refit | Deed::Repair | Deed::SellShip => {
                if self.ships == 0 {
                    step.issue("顺序", format!("{} 要先有船", d.key()));
                }
                if !ports.iter().any(|p| !self.w.shipyard(*p).is_empty()) {
                    step.issue("可达", format!("{} 要有船厂", d.key()));
                }
                if d == Deed::Refit {
                    if let Some(price) = self.w.defs.refits.iter().map(|r| r.price).min() {
                        self.spend(price.saturating_mul(i64::from(count)), "refit", step);
                    } else {
                        step.issue("可达", "没有可用改造".into());
                    }
                }
                if d == Deed::SellShip {
                    self.ships = self.ships.saturating_sub(count as usize);
                }
            }
            Deed::HireCrew => {
                if ports.is_empty() || self.ships == 0 {
                    step.issue("顺序", "hire_crew 要先有船并在已知港".into());
                }
                self.spend(self.w.defs.rules.crew_hire_cost.saturating_mul(i64::from(count)), "hire_crew", step);
            }
            Deed::HireMate => self.hire_mates(at, self.mates.len().saturating_add(count as usize), step),
            Deed::AssignMate => {
                if self.mates.is_empty() {
                    step.issue("顺序", "assign_mate 要先雇航海士".into());
                }
            }
            Deed::BidAuction => {
                let cost = self
                    .w
                    .defs
                    .auctions
                    .auctions
                    .iter()
                    .filter(|a| ports.contains(&a.port))
                    .flat_map(|a| &a.lots)
                    .map(|l| l.reserve)
                    .min();
                if let Some(cost) = cost {
                    self.spend(cost.saturating_mul(i64::from(count)), "bid_auction", step);
                } else {
                    step.issue("可达", "已知港没有拍卖".into());
                }
            }
            Deed::BuyItem => {
                let w = &self.w;
                let cost = ports
                    .iter()
                    .filter_map(|p| self.w.item_shelf(*p).map(|s| (*p, s)))
                    .flat_map(|(p, s)| {
                        s.stock
                            .iter()
                            .filter(|(_, q)| **q > 0)
                            .filter_map(move |(key, _)| w.item_buy_price(OwnerId::Player, p, key))
                    })
                    .min();
                if let Some(cost) = cost {
                    self.spend(cost.saturating_mul(i64::from(count)), "buy_item", step);
                } else {
                    step.issue("可达", "已知港没有出售物品的道具店".into());
                }
            }
            Deed::AcceptContract | Deed::DeliverContract => {
                if self.w.defs.rules.contracts.per_faction_per_month == 0 || ports.is_empty() {
                    step.issue("可达", "没有会发委托的已知港势力".into());
                }
                if d == Deed::DeliverContract && self.deeds.get(&Deed::AcceptContract).copied().unwrap_or(0) == 0 {
                    step.issue("顺序", "deliver_contract 要先 accept_contract".into());
                }
            }
            Deed::Deposit | Deed::Borrow => {
                if ports.is_empty() {
                    step.issue("可达", "银行入口需要已知港".into());
                }
            }
            Deed::Depart
            | Deed::Arrive
            | Deed::Autopilot
            | Deed::PlanRoute
            | Deed::Steer
            | Deed::Landing
            | Deed::ShoreTask
            | Deed::Nets
            | Deed::StandingOrders
            | Deed::Jettison
            | Deed::DismissCrew => {
                if self.ships == 0 {
                    step.issue("顺序", format!("{} 要先有船", d.key()));
                }
            }
            Deed::InnDay => {
                if self.here.is_none_or(|p| !self.w.defs.loc(p).is_port()) {
                    step.issue("顺序", "inn_day 要在港口".into());
                }
                // 完成日由入章日和次数下界决定，日期门槛不会重复收费天数。
                self.day = self.day.saturating_add(count);
            }
            Deed::Hail | Deed::Sighting | Deed::BattleWin | Deed::Discover => {
                step.unguaranteed.push(format!("deed:{}", d.key()));
            }
            Deed::Gift | Deed::Talk => {
                step.unjudged.push(format!("{}：人物行踪按日程", d.key()));
            }
            d if d.upbringing() => {}
            other => {
                step.unjudged.push(format!("deed:{}：前提未判", other.key()));
            }
        }
    }

    fn condition(
        &mut self,
        c: &Condition,
        line: &Line,
        step: &mut StepReport,
        entered: u32,
        base: &BTreeMap<Deed, u32>,
        acquire: bool,
    ) {
        use Condition::*;
        step.needs.push(format!("{c:?}"));
        if let HouseLevel { at: Some(at), .. } | Warehouse { at: Some(at), .. } | Industries { at: Some(at), .. } = c {
            self.port(at, step, false);
        }
        match c {
            Any { any } => {
                let mut branches = Vec::new();
                for branch in any {
                    let mut model = self.clone();
                    let mut report = StepReport {
                        needs: Vec::new(),
                        gives: Vec::new(),
                        errors: Vec::new(),
                        warnings: Vec::new(),
                        unguaranteed: Vec::new(),
                        unjudged: Vec::new(),
                        ..step.clone()
                    };
                    model.condition(branch, line, &mut report, entered, base, acquire);
                    branches.push((model, report));
                }
                let pick = branches
                    .iter()
                    .enumerate()
                    .filter(|(_, (_, report))| report.errors.is_empty())
                    .min_by_key(|(index, (model, report))| {
                        (!report.unguaranteed.is_empty(), self.cash.saturating_sub(model.cash), *index)
                    })
                    .map(|(index, _)| index);
                if pick.is_none() {
                    let errors = branches.iter().map(|(_, report)| report.errors.join("；")).collect::<Vec<_>>();
                    step.issue("顺序", format!("任一：各分支都不成立；{}", errors.join("；")));
                }
                if let Some((model, report)) = branches.into_iter().nth(pick.unwrap_or(0)) {
                    *self = model;
                    step.needs.extend(report.needs);
                    step.unguaranteed.extend(report.unguaranteed);
                    step.unjudged.extend(report.unjudged);
                    step.warnings.extend(report.warnings);
                }
            }
            Flag { flag, value } => {
                if *value && !self.flags.contains_key(flag) && !line.assumes.iter().any(|a| &a.flag == flag) {
                    let setters = self
                        .w
                        .defs
                        .story2
                        .tracks
                        .iter()
                        .flat_map(|t| t.chapters.iter().map(move |c| (t, c)))
                        .filter(|(_, c)| {
                            graph::branches(c)
                                .iter()
                                .flat_map(|b| &b.effects)
                                .any(|e| matches!(e,Effect::Flag{flag:f,value:true} if f==flag))
                        })
                        .map(|(t, c)| format!("{}:{}", t.key, c.key))
                        .collect::<Vec<_>>();
                    step.issue(
                        "顺序",
                        format!(
                            "缺旗标 {flag}：前面的步骤和开局都不给（设置者：{}）",
                            if setters.is_empty() { "无".into() } else { setters.join(",") }
                        ),
                    );
                }
                if !*value && let Some(origin) = self.flags.get(flag) {
                    step.issue("顺序", format!("要求旗标 {flag} 为假，但第 {origin} 步一定会设它"));
                }
            }
            Protagonist { protagonist } => {
                if protagonist != &line.protagonist {
                    step.issue("顺序", "主角条件与本线不符".into());
                }
            }
            ProtagonistIn { protagonist_in } => {
                if !protagonist_in.contains(&line.protagonist) {
                    step.issue("顺序", "主角条件与本线不符".into());
                }
            }
            Date { from, to } => {
                if let Some(from) = from.and_then(|d| self.w.story2_day(d)) {
                    if acquire {
                        self.day = self.day.max(from);
                    } else if self.day < from {
                        step.issue(
                            "接续",
                            format!(
                                "主线起始日 {:?} 晚于引导终态 {:?}",
                                self.world_date(from),
                                self.world_date(self.day)
                            ),
                        );
                    }
                }
                if let Some(to) = to.and_then(|d| self.w.story2_day(d))
                    && to < self.day
                {
                    step.issue(
                        "顺序",
                        format!(
                            "日期门槛 {:?} 早于这一步最早可能开始的 {:?}",
                            self.world_date(to),
                            self.world_date(self.day)
                        ),
                    );
                }
            }
            Wait { days } => self.day = self.day.max(entered.saturating_add(*days)),
            At { at, person: None } => {
                self.port(at, step, acquire);
                if !acquire && self.here != self.w.defs.find_loc(at) {
                    step.issue(
                        "接续",
                        format!(
                            "最后一步停在 {}，主线下一章在 {at}",
                            self.here.map_or("none", |p| self.w.defs.loc(p).key.as_str())
                        ),
                    );
                }
            }
            Cash { ge } => {
                if self.cash < *ge {
                    step.issue("可达", format!("要现款 {ge}，开局加已得奖励减必要花费最多 {}", self.cash));
                }
            }
            Fame { ge } => {
                if self.fame < *ge {
                    step.issue("顺序", format!("要名声 {ge}，开局加前面奖励只有 {}", self.fame));
                }
            }
            Reputation { faction, ge } => {
                let have = self
                    .w
                    .defs
                    .factions
                    .iter()
                    .position(|f| &f.key == faction)
                    .map_or(0, |i| self.w.reputation(OwnerId::Player, FactionId::from_idx(i)));
                if have < *ge {
                    step.issue("顺序", format!("{faction} 要声望 {ge}，前面保证的只有 {have}"));
                }
            }
            Rank { at, ge } => {
                if let Some(p) = self.port(at, step, false) {
                    let need = self
                        .w
                        .defs
                        .rules
                        .access
                        .rank_table(crate::access::investable(&self.w.defs, p))
                        .get(*ge as usize)
                        .copied()
                        .unwrap_or(i64::MAX);
                    let have = self.w.goodwill(OwnerId::Player, p);
                    if self.w.defs.rules.access.enabled && have < need {
                        step.issue("顺序", format!("在 {at} 要货档 {ge}（商誉 {need}），前面保证的商誉只有 {have}"));
                    }
                }
            }
            HouseLevel { at, ge } if acquire => self.house(at.as_deref(), *ge, step),
            Warehouse { at, ge } if acquire => self.warehouse(at.as_deref(), ge.unwrap_or(1), step),
            Industries { at, industry, ge } if acquire => self.industry(at.as_deref(), industry.as_deref(), *ge, step),
            Ships { ge } if acquire => {
                if self.ships < *ge as usize {
                    self.buy_ship(None, (*ge as usize) - self.ships, 0, step);
                }
            }
            ShipTier { ge } if acquire => {
                if self.tier < *ge as usize {
                    self.buy_ship(None, 1, *ge as usize, step);
                }
            }
            Mates { ge } if acquire => self.hire_mates(None, *ge as usize, step),
            Post { post } if acquire => {
                if self.mates.is_empty() {
                    step.issue("顺序", format!("岗位 {post} 要先有航海士"));
                }
                self.posts.insert(post.clone());
            }
            Item { item, qty } if acquire => self.item(item, *qty, step),
            Equipped { item } if acquire => self.item(item, 1, step),
            Visited { at: Some(at), .. } => {
                self.port(at, step, acquire);
                if !acquire && self.w.defs.find_loc(at).is_none_or(|p| !self.visited.contains(&p)) {
                    step.issue("接续", format!("还未到过 {at}"));
                }
            }
            Visited { at: None, ge } => {
                let need = ge.unwrap_or(1) as usize;
                if acquire {
                    for p in &self.known {
                        if self.visited.len() >= need {
                            break;
                        }
                        self.visited.insert(*p);
                    }
                }
                if self.visited.iter().filter(|p| self.w.defs.loc(**p).is_port()).count() < need {
                    step.issue("可达", format!("到访港数要 {need}，已知港不够"));
                }
            }
            PortsKnown { ge } => {
                if self.known.len() < *ge as usize {
                    step.issue("可达", format!("要认识 {ge} 座港，前面只保证 {} 座", self.known.len()));
                }
            }
            Deed { deed, ge, since_entered } => {
                let target =
                    if *since_entered { base.get(deed).copied().unwrap_or(0).saturating_add(*ge) } else { *ge };
                let have = self.deeds.get(deed).copied().unwrap_or(0);
                if acquire && have < target {
                    let before = self.day;
                    self.deed(*deed, target - have, step_at(step, &self.w.defs).as_deref(), step);
                    if *deed == super::deeds::Deed::InnDay {
                        self.day = before.max(entered.saturating_add(target - have));
                    }
                    self.deeds.insert(*deed, target);
                } else if !acquire && have < target {
                    step.issue("接续", format!("行为 {} 还缺 {} 次", deed.key(), target - have));
                }
            }
            Attr { .. } | Growth { .. } | Skill { .. } | Bond { .. } | Age { .. } | Affinity { .. }
                if self.phase == Phase::Upbringing => {}
            HouseLevel { .. }
            | Warehouse { .. }
            | Industries { .. }
            | Ships { .. }
            | ShipTier { .. }
            | Mates { .. }
            | Post { .. }
            | Item { .. }
            | Equipped { .. } => {
                let ok = match c {
                    HouseLevel { at, ge } => self
                        .ports(at.as_deref())
                        .iter()
                        .any(|p| self.w.house_level(OwnerId::Player, *p) >= *ge as usize),
                    Warehouse { at, ge } => {
                        self.ports(at.as_deref()).iter().filter(|p| self.warehouses.contains(p)).count()
                            >= ge.unwrap_or(1) as usize
                    }
                    Industries { at, industry, ge } => {
                        self.industries
                            .iter()
                            .filter(|(p, k)| {
                                at.as_ref().is_none_or(|a| &self.w.defs.loc(*p).key == a)
                                    && industry.as_ref().is_none_or(|i| i == k)
                            })
                            .count()
                            >= *ge as usize
                    }
                    Ships { ge } => self.ships >= *ge as usize,
                    ShipTier { ge } => self.tier >= *ge as usize,
                    Mates { ge } => self.mates.len() >= *ge as usize,
                    Post { post } => self.posts.contains(post),
                    Item { item, qty } => self.items.get(item).copied().unwrap_or(0) >= *qty,
                    Equipped { item } => self.items.get(item).copied().unwrap_or(0) > 0,
                    _ => false,
                };
                if !ok {
                    step.issue("接续", format!("主线条件还未满足 {c:?}"));
                }
            }
            other => step.unjudged.push(format!("condition:{other:?}")),
        }
    }
    fn world_date(&self, day: u32) -> [u32; 3] {
        let d = self.w.defs.calendar.date_of(day);
        [(self.w.defs.rules.world.start_year + i64::from(d.year) - 1) as u32, d.month, d.day]
    }
}

fn step_at(step: &StepReport, defs: &StaticData) -> Option<String> {
    defs.story2.track(&step.track)?.chapter(&step.chapter)?.at.clone()
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Amount {
    Cash,
    Fame,
    Reputation(String),
    Item(String),
}
#[derive(Default)]
struct Gives {
    flags: BTreeSet<String>,
    removed: BTreeSet<String>,
    amounts: BTreeMap<Amount, i64>,
    charts: BTreeSet<String>,
    joins: BTreeSet<String>,
}

fn guaranteed(c: &ChapterDef) -> Gives {
    let branches = graph::branches(c);
    let mut values = Vec::new();
    for b in branches {
        let mut give = Gives::default();
        for e in b.effects {
            let amount = match e {
                Effect::Cash { value } => Some((Amount::Cash, value)),
                Effect::Fame { value } => Some((Amount::Fame, value)),
                Effect::Reputation { faction, value } => Some((Amount::Reputation(faction), value)),
                Effect::Item { item, qty } => Some((Amount::Item(item), qty)),
                Effect::Flag { flag, value: true } => {
                    give.removed.remove(&flag);
                    give.flags.insert(flag);
                    None
                }
                Effect::Flag { flag, value: false } => {
                    give.flags.remove(&flag);
                    give.removed.insert(flag);
                    None
                }
                Effect::Chart { region } => {
                    give.charts.insert(region);
                    None
                }
                Effect::Join { person } => {
                    give.joins.insert(person);
                    None
                }
                _ => None,
            };
            if let Some((key, n)) = amount {
                let v = give.amounts.entry(key).or_default();
                *v = v.saturating_add(n);
            }
        }
        values.push(give);
    }
    let keys = values.iter().flat_map(|g| g.amounts.keys().cloned()).collect::<BTreeSet<_>>();
    let mut out =
        Gives { removed: values.iter().flat_map(|g| g.removed.iter().cloned()).collect(), ..Default::default() };
    for key in keys {
        let n = values.iter().map(|g| g.amounts.get(&key).copied().unwrap_or(0)).min().unwrap_or(0);
        out.amounts.insert(key, n);
    }
    if let Some(first) = values.first() {
        out.flags = first.flags.iter().filter(|f| values.iter().all(|g| g.flags.contains(*f))).cloned().collect();
        out.charts = first.charts.iter().filter(|f| values.iter().all(|g| g.charts.contains(*f))).cloned().collect();
        out.joins = first.joins.iter().filter(|f| values.iter().all(|g| g.joins.contains(*f))).cloned().collect();
    }
    out
}

impl Model {
    fn give(&mut self, c: &ChapterDef, step: &mut StepReport) {
        let g = guaranteed(c);
        for f in g.removed {
            self.flags.remove(&f);
        }
        for f in g.flags {
            step.gives.push(format!("flag:{f}"));
            self.flags.insert(f, step.number);
        }
        for (key, n) in g.amounts {
            if n == 0 {
                continue;
            }
            step.gives.push(format!("{key:?}:{n}"));
            match key {
                Amount::Cash => self.cash = self.cash.saturating_add(n),
                Amount::Fame => self.fame = self.fame.saturating_add(n).max(0),
                Amount::Item(k) => {
                    let v = self.items.entry(k).or_default();
                    *v = v.saturating_add(n).max(0);
                }
                Amount::Reputation(k) => {
                    if let Some(i) = self.w.defs.factions.iter().position(|f| f.key == k) {
                        let id = FactionId::from_idx(i);
                        let v = self.w.reputation(OwnerId::Player, id).saturating_add(n).clamp(-100, 100);
                        if let Some(a) = self.w.state.agents.get_mut(&OwnerId::Player) {
                            a.reputation.insert(id, v);
                        }
                    }
                }
            }
        }
        for region in g.charts {
            step.gives.push(format!("chart:{region}"));
            if let Some(id) = self.w.defs.regions.iter().position(|r| r.key == region).map(RegionId::from_idx) {
                if let Err(e) = crate::story::apply(&mut self.w, None, &crate::story::StoryEffect::Chart(id)) {
                    step.issue("可达", e.to_string());
                }
                self.known.extend(self.w.visible_locations().filter(|id| self.w.defs.loc(*id).is_port()));
            }
        }
        for person in g.joins {
            step.gives.push(format!("join:{person}"));
            if let Some(id) = self.w.person_mate(&person) {
                self.mates.insert(id);
            }
        }
    }
    fn needs(&mut self, c: &ChapterDef, line: &Line, reach: &Reachability<'_>, step: &mut StepReport, acquire: bool) {
        let entered = self.day;
        let base = self.deeds.clone();
        if let Some(at) = &c.at {
            self.condition(&Condition::At { at: at.clone(), person: None }, line, step, entered, &base, acquire);
        }
        if let Some(port) = c.go.as_ref().and_then(|g| g.port.as_ref()) {
            self.port(port, step, false);
        }
        for cond in &c.when {
            self.condition(cond, line, step, entered, &base, acquire);
        }
        let mut constraints = c
            .when
            .iter()
            .filter(|c| {
                matches!(
                    c,
                    Condition::Attr { .. }
                        | Condition::Growth { .. }
                        | Condition::Skill { .. }
                        | Condition::Bond { .. }
                        | Condition::Age { .. }
                        | Condition::Affinity { .. }
                        | Condition::Any { .. }
                )
            })
            .map(|c| crate::upbringing::reach::constraint_of_condition(c, true))
            .collect::<Vec<_>>();
        for o in &c.objectives {
            if let Some(cond) = o.kind.condition() {
                if matches!(
                    cond,
                    Condition::Attr { .. }
                        | Condition::Growth { .. }
                        | Condition::Skill { .. }
                        | Condition::Bond { .. }
                        | Condition::Age { .. }
                        | Condition::Affinity { .. }
                        | Condition::Any { .. }
                ) {
                    constraints.push(crate::upbringing::reach::constraint_of_condition(&cond, true));
                }
                self.condition(&cond, line, step, entered, &base, acquire);
            } else {
                match &o.kind {
                    ObjectiveKind::Goods { good, qty, at } => {
                        self.port(at, step, acquire);
                        if acquire {
                            self.goods(good, *qty, step);
                        } else if self
                            .w
                            .defs
                            .goods
                            .iter()
                            .position(|g| &g.key == good)
                            .is_none_or(|i| self.cargo.get(&GoodId::from_idx(i)).copied().unwrap_or(0) < *qty)
                        {
                            step.issue("接续", format!("交货还缺 {good} {qty}"));
                        }
                    }
                    ObjectiveKind::Battle { .. } | ObjectiveKind::Discovery { .. } => {
                        step.unguaranteed.push(format!("objective:{:?}", o.kind))
                    }
                    other => step.unjudged.push(format!("objective:{other:?}")),
                }
            }
        }
        if self.phase == Phase::Upbringing && !constraints.is_empty() {
            match reach.earliest_for(&line.family, &constraints, self.day, Some(true)) {
                Ok(day) => self.day = self.day.max(day),
                Err(e) => step.issue("顺序", format!("养成段：{e}")),
            }
        }
        if let Some(end) = reach.family_end(&line.family)
            && self.phase == Phase::Upbringing
            && self.day > end
        {
            step.issue(
                "接续",
                format!("养成段最早完成日 {:?} 晚于结业前一天 {:?}", self.world_date(self.day), self.world_date(end)),
            );
        }
        let due =
            self.w.story2_deadline(c, entered).into_iter().chain(c.window.and_then(|w| self.w.story2_day(w[1]))).min();
        if let Some(due) = due
            && due < self.day
        {
            step.issue(
                if acquire { "顺序" } else { "接续" },
                format!("期限 {:?} 早于最早可能完成的 {:?}", self.world_date(due), self.world_date(self.day)),
            );
        }
        if let Some(start) = c.window.and_then(|w| self.w.story2_day(w[0])) {
            self.day = self.day.max(start);
        }
        self.w.state.day = self.day;
    }
}

fn kind_key(c: &Condition) -> String {
    if matches!(c, Condition::Any { .. }) {
        return "any".into();
    }
    let name = format!("{c:?}");
    let name = name.split([' ', '{']).next().unwrap_or("");
    let mut out = String::new();
    for (i, ch) in name.chars().enumerate() {
        if ch.is_ascii_uppercase() && i > 0 {
            out.push('_');
        }
        out.push(ch.to_ascii_lowercase());
    }
    out
}

fn condition_proof(c: &Condition, kind: &str) -> bool {
    kind_key(c) == kind || matches!(c, Condition::Any { any } if any.iter().any(|c| condition_proof(c, kind)))
}

fn proof(c: &ChapterDef, p: &str) -> bool {
    match p.split_once(':') {
        Some(("panel", p)) => c.go.as_ref().and_then(|g| g.panel.as_deref()) == Some(p),
        Some(("flag", p)) => c.when.iter().any(|c| matches!(c,Condition::Flag{flag,value:true} if flag==p)),
        Some(("deed", p)) => {
            c.when.iter().flat_map(super::deeds::condition_deeds).any(|(deed, _)| deed.key() == p)
                || c.objectives
                    .iter()
                    .flat_map(|o| super::deeds::objective_deeds(&o.kind))
                    .any(|(deed, _)| deed.key() == p)
        }
        Some(("cond", p)) => {
            c.when.iter().any(|c| condition_proof(c, p))
                || c.objectives.iter().filter_map(|o| o.kind.condition()).any(|c| condition_proof(&c, p))
        }
        _ => false,
    }
}

fn reachable(t: &TrackDef, target: &str) -> bool {
    let mut seen = BTreeSet::new();
    let mut next = vec![t.start.clone()];
    while let Some(k) = next.pop() {
        if !seen.insert(k.clone()) {
            continue;
        }
        if k == target {
            return true;
        }
        if let Some(c) = t.chapter(&k) {
            next.extend(graph::branches(c).into_iter().map(|b| b.next));
        }
    }
    false
}

pub fn report(defs: &Arc<StaticData>, reach: &Reachability<'_>) -> GuideReport {
    let mut out = GuideReport::default();
    for k in ["顺序", "可达", "覆盖", "接续"] {
        out.checks.insert(k.into(), 0);
    }
    for line in &defs.guide.lines {
        let mut carry_flags = BTreeMap::new();
        let mut carry_items = BTreeMap::<String, i64>::new();
        let mut number = 0;
        let mut taught = BTreeMap::<String, Vec<(String, String, Phase)>>::new();
        for (phase, keys) in [(Phase::Upbringing, &line.upbringing), (Phase::Voyage, &line.voyage)] {
            let world = match opening_world(defs, line, phase) {
                Ok(w) => w,
                Err(e) => {
                    out.errors.push(format!("guide:{}:opening:opening（第 0 步）：可达：{e}", line.key));
                    continue;
                }
            };
            let mut s = Model::new(world, phase);
            if phase == Phase::Voyage {
                s.flags.extend(carry_flags.clone());
                for (k, q) in &carry_items {
                    let have = s.items.entry(k.clone()).or_default();
                    *have = have.saturating_add(*q);
                }
            }
            for key in keys {
                let Some(t) = defs.story2.track(key) else { continue };
                let chain = chapters(t);
                let last = chain.last().map(|c| c.key.as_str());
                for c in chain.iter().copied() {
                    number += 1;
                    let mut step = StepReport {
                        line: line.key.clone(),
                        phase,
                        number,
                        track: key.clone(),
                        chapter: c.key.clone(),
                        teaches: c.teaches.clone(),
                        needs: Vec::new(),
                        gives: Vec::new(),
                        errors: Vec::new(),
                        warnings: Vec::new(),
                        unguaranteed: Vec::new(),
                        unjudged: Vec::new(),
                        day: s.day,
                        here: None,
                        cash: s.cash,
                        known: s.known.len(),
                    };
                    if c.key == t.start {
                        if !c
                            .when
                            .iter()
                            .any(|c| matches!(c,Condition::Protagonist{protagonist} if protagonist==&line.protagonist))
                        {
                            step.issue("可达", "起始章缺本线 protagonist 条件".into());
                        }
                        if phase == Phase::Voyage {
                            let flag = defs
                                .upbringing
                                .family(&line.family)
                                .and_then(|f| f.completion.as_ref())
                                .and_then(|c| c.capital.grant_once.as_ref())
                                .map_or(crate::upbringing::GRADUATED_FLAG, |f| f.as_str());
                            if !c.when.iter().any(|c| matches!(c,Condition::Flag{flag:f,value:true} if f==flag)) {
                                step.issue("可达", format!("航海段起始章缺结业旗标 {flag}"));
                            }
                        }
                    }
                    s.needs(c, line, reach, &mut step, true);
                    for m in &c.teaches {
                        taught.entry(m.clone()).or_default().push((key.clone(), c.key.clone(), phase));
                        if let Some(m) = defs.guide.mechanics.iter().find(|x| &x.key == m)
                            && !m.proof.is_empty()
                            && !m.proof.iter().any(|p| proof(c, p))
                        {
                            step.issue("覆盖", format!("标了教 {}，但没有 {} 之一", m.key, m.proof.join(",")));
                        }
                    }
                    s.give(c, &mut step);
                    if phase == Phase::Voyage
                        && key == &line.handoff.after
                        && Some(c.key.as_str()) == last
                        && let Some(main) = defs.story2.track(&line.handoff.track)
                    {
                        if !reachable(main, &line.handoff.chapter) {
                            step.issue("接续", format!("主线 {} 的 {} 从起点不可达", main.key, line.handoff.chapter));
                        }
                        if let Some(handoff) = main.chapter(&line.handoff.chapter) {
                            s.needs(handoff, line, reach, &mut step, false);
                        }
                    }
                    step.day = s.day;
                    step.here = s.here.map(|p| defs.loc(p).key.clone());
                    step.cash = s.cash;
                    step.known = s.known.len();
                    out.errors.extend(step.errors.iter().cloned());
                    out.warnings.extend(step.warnings.iter().cloned());
                    out.steps.push(step);
                }
            }
            if phase == Phase::Upbringing {
                carry_flags = s.flags;
                carry_items = s.items;
            }
        }
        let required = match &line.coverage {
            Coverage::All(_) => defs
                .guide
                .mechanics
                .iter()
                .filter(|m| m.chain != Chain::Exempt)
                .map(|m| m.key.clone())
                .collect::<Vec<_>>(),
            Coverage::Keys(k) => k.clone(),
        };
        for key in required {
            let Some(m) = defs.guide.mechanics.iter().find(|m| m.key == key) else { continue };
            if !taught.get(&key).is_some_and(|v| v.iter().any(|(_, _, p)| *p == m.phase)) {
                out.errors.push(format!(
                    "guide:{}:coverage:{key}（第 0 步）：覆盖：线 {}：玩法 {key} 没有步骤教",
                    line.key, line.key
                ));
            }
        }
        for (m, steps) in taught {
            if steps.len() > 1 {
                out.warnings.push(format!(
                    "guide:{}:coverage:{m}：多个步骤重复教：{}",
                    line.key,
                    steps.iter().map(|(t, c, _)| format!("{t}:{c}")).collect::<Vec<_>>().join(",")
                ));
            }
        }
    }
    for e in &out.errors {
        for (k, n) in &mut out.checks {
            if e.contains(&format!("：{k}：")) {
                *n += 1;
            }
        }
    }
    out
}

pub fn validate(defs: &Arc<StaticData>, reach: &Reachability<'_>) -> Vec<String> {
    report(defs, reach).errors
}
