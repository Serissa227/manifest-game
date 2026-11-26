//! 殖民经济手感（真实数据，完整世界模拟）：按一套合理的经营计划运营一个殖民地若干年。
//!
//! 经营计划：在诺瓦马尔买齐建立物资 → 建立殖民地 → 农庄 → 种植园或伐木场 → 仓棚 → 码头 → 酒馆、礼拜堂 → 栅栏堡，
//! 住房不够时加盖住宅区、粮食不够时扩建农庄；一艘移民船往返于殖民港与殖民地之间运建材、粮食并运回产出出售。
//!
//! 检查：粮食自给（第二年起不再断粮、第三年起不再需要进口粮食）；人口在第 5–8 年间达到 400；
//! 第三年里每月的税收与产出价值（扣除吃掉的粮食）都超过维护费；断粮与袭击造成可感知但可恢复的损失；
//! 全程不变量成立、货币守恒，只用命令日志重放一致。

mod common;

use manifest_core::colony::food_need;
use manifest_core::defs::{BuildingKind, StaticData};
use manifest_core::ids::*;
use manifest_core::log::LogKind;
use manifest_core::testkit::check_invariants;
use manifest_core::warehouse::Holder;
use manifest_core::{Command, CommandOutcome, Fx};
use manifest_sim::GameSession;
use std::collections::BTreeMap;
use std::sync::Arc;

const P: OwnerId = OwnerId::Player;
/// 每月天数。
const MONTH: u32 = 30;

/// 一个月的记录（月末）。
#[derive(Clone, Debug, Default)]
struct Month {
    month: u32,
    pop: i64,
    morale: i64,
    housing: i64,
    food_stock: i64,
    tax: i64,
    upkeep: i64,
    /// 上月产出按基准价计的价值
    produced_value: i64,
    /// 上月吃掉的粮食按基准价计的价值
    eaten_value: i64,
    starving: bool,
    births: i64,
    immigrants: i64,
    deaths: i64,
    cash: i64,
    levels: i64,
    /// 当前每日遭袭概率（万分比）
    raid_bp: i64,
}

impl Month {
    /// 经营收支：税收 + 产出价值 − 吃掉的粮食 − 维护费。
    fn net(&self) -> i64 {
        self.tax + self.produced_value - self.eaten_value - self.upkeep
    }
}

/// 经营结果。
struct Report {
    months: Vec<Month>,
    /// 第几个月末人口首次达到 400
    reached_400: Option<u32>,
    /// 每月从殖民港运去的粮食（件）
    food_imports: BTreeMap<u32, i64>,
    raids: Vec<Raid>,
    /// 舰队沉没或搁浅后另组舰队的次数
    losses: u32,
    session: GameSession,
    colony: ColonyId,
}

/// 殖民地经理：一艘移民船往返于殖民港与殖民地。
struct Manager {
    s: GameSession,
    fleet: FleetId,
    home: LocId,
    site: LocId,
    colony: Option<ColonyId>,
    /// 固定的建设次序（建筑 key，每项升一级）
    plan: Vec<&'static str>,
    step: usize,
    food_imports: BTreeMap<u32, i64>,
    /// 断粮试验：这段时间（天）不运粮，并把殖民地仓库里的粮食装船带走
    famine: Option<(u32, u32)>,
    /// 舰队沉没或因船员不足无法出航、另组舰队的次数
    losses: u32,
    raids: Vec<Raid>,
}

/// 一次袭击。
#[derive(Clone, Copy, Debug)]
struct Raid {
    day: u32,
    pop_before: i64,
    cargo_lost: i64,
    deaths: i64,
}

/// 真实数据；“新大陆开拓者”剧本的起始资金放宽到 30 万金币。
///
/// 这里衡量的是殖民地本身的经营手感，而不是经理跑船贸易的本事：经理只在殖民港与殖民地之间往返，
/// 产出就近卖掉（殖民港的收购价远低于旧世界），资金充裕才能让建设进度只取决于殖民地自身。
fn defs() -> Arc<StaticData> {
    let mut d = (*common::defs()).clone();
    let colonist = d.find_scenario("colonist").expect("新大陆开拓者剧本");
    d.scenarios[colonist.idx()].cash = 300_000;
    // 第三批给剧本加了开局货物与粮水、船员减到 70 人；这里仍按原来的开局（150 名船员、空货舱）衡量殖民地本身
    let s = &mut d.scenarios[colonist.idx()];
    s.crew = 150;
    s.cargo.clear();
    (s.food, s.water) = (0, 0);
    Arc::new(d)
}

impl Manager {
    fn new(defs: Arc<StaticData>, seed: u64, site: &str, plan: Vec<&'static str>) -> Manager {
        let scenario = defs.find_scenario("colonist").expect("新大陆开拓者剧本");
        let s = GameSession::new(defs.clone(), scenario, seed).unwrap();
        let fleet = s.world.fleets_of(P).next().unwrap().id;
        let home = s.world.fleet(fleet).unwrap().docked_at().unwrap();
        let site = defs.find_loc(site).expect("殖民点");
        Manager {
            s,
            fleet,
            home,
            site,
            colony: None,
            plan,
            step: 0,
            food_imports: BTreeMap::new(),
            famine: None,
            losses: 0,
            raids: Vec::new(),
        }
    }

    fn defs(&self) -> Arc<StaticData> {
        self.s.world.defs.clone()
    }

    fn good(&self, key: &str) -> GoodId {
        self.s.world.defs.find_good(key).unwrap_or_else(|| panic!("商品 {key}"))
    }

    fn cash(&self) -> i64 {
        self.s.world.agent(P).unwrap().cash
    }

    fn try_cmd(&mut self, c: Command) -> bool {
        self.s.submit(c).is_ok()
    }

    /// 在当前港口买入，买不到全部时逐步减半。
    fn buy(&mut self, good: GoodId, mut qty: i64) -> i64 {
        let mut got = 0;
        while qty > 0 {
            let free = self.s.world.fleet(self.fleet).unwrap().free_capacity();
            let q = qty.min(free);
            if q <= 0 {
                break;
            }
            match self.s.submit(Command::Buy { owner: P, fleet: self.fleet, good, qty: q, max_total: None }) {
                Ok(_) => {
                    got += q;
                    qty -= q;
                }
                Err(_) => qty = q / 2,
            }
        }
        got
    }

    fn day(&mut self) -> bool {
        let pop = self.colony.and_then(|c| self.s.world.colony(c)).map(|c| c.population);
        let r = self.s.advance_day().unwrap();
        if let Err(e) = check_invariants(&self.s.world) {
            panic!("{e}");
        }
        // 当天的袭击（日志只保留最近的若干条，所以逐日记下）
        for e in self.s.world.state.log.iter().rev().take_while(|e| e.day == r.day) {
            if let LogKind::ColonyRaided { colony, cargo_lost, deaths, .. } = &e.kind
                && Some(*colony) == self.colony
            {
                self.raids.push(Raid {
                    day: r.day,
                    pop_before: pop.unwrap_or(0),
                    cargo_lost: *cargo_lost,
                    deaths: *deaths,
                });
            }
        }
        r.month_end
    }

    /// 航行到目的地，途中每天推进，经过月末时交给调用方记录；不能出航或舰队沉没时返回 false。
    fn sail(&mut self, dest: LocId, on_month: &mut dyn FnMut(&Manager)) -> bool {
        let f = self.fleet;
        if self.s.world.fleet(f).ok().and_then(|x| x.docked_at()) == Some(dest) {
            return true;
        }
        if self.s.submit(Command::SetSail { owner: P, fleet: f, dest }).is_err() {
            self.losses += 1;
            return false;
        }
        for _ in 0..80 {
            match self.s.world.fleet(f) {
                Err(_) => {
                    self.losses += 1;
                    return false;
                }
                Ok(fl) if fl.docked_at() == Some(dest) => return true,
                Ok(_) => {}
            }
            if self.day() {
                on_month(self);
            }
        }
        false
    }

    /// 船沉了或船员不足以出航时，在殖民港另组一支舰队（卡拉克帆船）继续往返。
    fn recover(&mut self) -> bool {
        let defs = self.defs();
        let Some(ship) = defs.find_ship("tradewind") else { return false };
        let old = self.fleet;
        if self.s.submit(Command::FoundFleet { owner: P, at: self.home, ship_type: ship }).is_err() {
            return false;
        }
        let Some(new) = self.s.world.fleets_of(P).map(|f| f.id).filter(|f| *f != old).max() else { return false };
        self.fleet = new;
        let f = self.s.world.fleet(new).unwrap().clone();
        let want = f.crew_min(&defs) + 10 - f.crew;
        if want > 0 {
            let _ = self.try_cmd(Command::HireCrew { owner: P, fleet: new, count: want });
        }
        true
    }

    /// 在港口补足往返所需的粮水（建立殖民地之前船员多、只备 14 天；之后按往返一趟再多备一倍，36 天）。
    fn resupply(&mut self) {
        let f = self.s.world.fleet(self.fleet).unwrap().clone();
        let per = self.s.world.defs.rules.crew_per_supply_unit.max(1);
        let days = if self.colony.is_some() { 36 } else { 14 };
        let need = (f.crew * days + per - 1) / per;
        let (food, water) = ((need - f.food).max(0), (need - f.water).max(0));
        if food + water > 0 {
            let _ = self.try_cmd(Command::Resupply { owner: P, fleet: self.fleet, food, water });
        }
    }

    /// 殖民地各粮食建筑每天的预计产量（件）。
    fn food_output(&self) -> i64 {
        let w = &self.s.world;
        let defs = &w.defs;
        let Some(c) = self.colony.and_then(|id| w.colony(id)) else { return 0 };
        w.colony_estimates(c)
            .iter()
            .filter(|e| defs.colony_building(e.building).kind == BuildingKind::Food)
            .flat_map(|e| e.outputs.iter().map(|(_, q)| *q))
            .fold(Fx::ZERO, |a, b| a + b)
            .raw()
            / Fx::SCALE
    }

    /// 下一项建设：先建农庄；粮食不够扩建农庄；住房快满盖住宅区；否则按计划。
    fn next_build(&self) -> Option<ColonyBuildingId> {
        let w = &self.s.world;
        let defs = &w.defs;
        let c = w.colony(self.colony?)?;
        let housing = defs.find_colony_building("housing")?;
        let farm = defs.find_colony_building("farm")?;
        let max = |b: ColonyBuildingId| defs.colony_building(b).max_level;
        if c.level(farm) == 0 {
            return Some(farm);
        }
        // 住房快满时要先保证粮食够再多养 200 人（不够就先扩农庄，农庄已满级就不再扩住房）
        let crowded = c.population + 30 >= w.colony_housing(c) && c.level(housing) < max(housing);
        let food_target = food_need(defs, c.population + if crowded { 200 } else { 40 });
        if self.food_output() < food_target && c.level(farm) < max(farm) {
            return Some(farm);
        }
        if crowded && self.food_output() >= food_target {
            return Some(housing);
        }
        let mut i = self.step;
        while let Some(k) = self.plan.get(i) {
            let b = defs.find_colony_building(k)?;
            if c.level(b) < max(b) {
                return Some(b);
            }
            i += 1;
        }
        None
    }

    fn famine_now(&self) -> bool {
        self.famine.is_some_and(|(a, b)| (a..b).contains(&self.s.day()))
    }

    /// 在殖民港：卖掉运回的产出，补给，买下一项建设的建材与所需粮食。
    fn at_home(&mut self) {
        let defs = self.defs();
        let home = self.home;
        let f = self.s.world.fleet(self.fleet).unwrap().clone();
        for (g, q) in f.cargo.clone() {
            if q > 0 && defs.loc(home).market.iter().any(|m| m.good == g) {
                let _ = self.try_cmd(Command::Sell { owner: P, fleet: self.fleet, good: g, qty: q, min_total: None });
            }
        }
        // 修船（风暴损伤）
        let _ = self.try_cmd(Command::Repair { owner: P, fleet: self.fleet });
        // 船员因疫病或逃亡减少时在殖民港补招
        let crew_min = f.crew_min(&defs);
        if f.crew < crew_min + 6 {
            let _ = self.try_cmd(Command::HireCrew { owner: P, fleet: self.fleet, count: crew_min + 10 - f.crew });
        }
        self.resupply();
        let Some(c) = self.colony.and_then(|id| self.s.world.colony(id)).cloned() else { return };
        let stock = |m: &Manager, g: GoodId| {
            m.s.world.holder_qty(P, Holder::Warehouse(m.site), g)
                + m.s.world.fleet(m.fleet).unwrap().cargo.get(&g).copied().unwrap_or(0)
        };
        // 粮食：自产不够、存粮不足 45 天时补到 60 天（断粮试验期间不运粮）
        let need = food_need(&defs, c.population);
        let food_stock = self.s.world.colony_food_stock(&c);
        if !self.famine_now() && self.food_output() < need && food_stock < need * 45 {
            let grain = self.good("grain");
            let got = self.buy(grain, need * 60 - food_stock);
            *self.food_imports.entry(self.s.day() / MONTH).or_insert(0) += got;
        }
        // 下一项建设的建材（留出建造费与 2000 金币的余地）
        if let Some(b) = self.next_build() {
            let d = defs.colony_building(b).clone();
            let mut budget = self.cash() - d.cost - 2_000;
            for (g, q) in &d.materials {
                let missing = q - stock(self, *g);
                if missing <= 0 {
                    continue;
                }
                let price = defs.good(*g).base_price * 2;
                let affordable = (budget / price.max(1)).min(missing);
                if affordable > 0 {
                    let got = self.buy(*g, affordable);
                    budget -= got * price;
                }
            }
        }
    }

    /// 在殖民地：卸下建材与粮食，装上产出（与富余的粮食），开工下一项建设。
    fn at_site(&mut self) {
        let defs = self.defs();
        let site = self.site;
        let Some(id) = self.colony.filter(|id| self.s.world.colony(*id).is_some()) else { return };
        let famine = self.famine_now();
        let f = self.s.world.fleet(self.fleet).unwrap().clone();
        for (g, q) in f.cargo.clone() {
            let free = (self.s.world.warehouse_capacity(P, site)
                - self.s.world.warehouse(P, site).map(|w| w.used()).unwrap_or(0))
            .max(0);
            let q = q.min(free);
            if q > 0 {
                let _ = self.try_cmd(Command::Transfer {
                    owner: P,
                    from: Holder::Fleet(self.fleet),
                    to: Holder::Warehouse(site),
                    good: g,
                    qty: q,
                });
            }
        }
        // 装走产出；下一项建设要用的建材留下；粮食只留 45 天的量（断粮试验时全部带走）
        let keep: Vec<(GoodId, i64)> =
            self.next_build().map(|b| defs.colony_building(b).materials.clone()).unwrap_or_default();
        let c = self.s.world.colony(id).unwrap().clone();
        let mut food_left = if famine { 0 } else { food_need(&defs, c.population) * 45 };
        let stock: Vec<(GoodId, i64)> = self
            .s
            .world
            .warehouse(P, site)
            .map(|w| w.stock.iter().map(|(g, q)| (*g, *q)).collect())
            .unwrap_or_default();
        for (g, q) in stock {
            let mut q = q - keep.iter().find(|(k, _)| *k == g).map(|(_, n)| *n).unwrap_or(0);
            if q <= 0 {
                continue;
            }
            if defs.good(g).category == defs.rules.colony.food_category {
                let kept = q.min(food_left);
                food_left -= kept;
                q -= kept;
            }
            let free = self.s.world.fleet(self.fleet).unwrap().free_capacity();
            let q = q.min(free);
            if q > 0 {
                let _ = self.try_cmd(Command::Transfer {
                    owner: P,
                    from: Holder::Warehouse(site),
                    to: Holder::Fleet(self.fleet),
                    good: g,
                    qty: q,
                });
            }
        }
        // 断粮试验期间不开工（农庄迟迟建不起来）
        if let Some(b) = self.next_build().filter(|_| !famine) {
            let from_plan = self.plan.get(self.step).and_then(|k| defs.find_colony_building(k)) == Some(b);
            if self.try_cmd(Command::BuildColony { owner: P, colony: id, building: b }) && from_plan {
                self.step += 1;
            }
        }
    }

    /// 在殖民港买齐建立物资，驶往殖民点建立殖民地。
    fn found(&mut self, settlers: i64, on_month: &mut dyn FnMut(&Manager)) {
        let defs = self.defs();
        self.resupply();
        // 建立物资多带两成，防风暴中损失一部分货物
        for (g, q) in defs.rules.colony.found_materials.clone() {
            assert!(self.buy(g, q + q / 5) >= q, "殖民港买得到建立物资 {}", defs.good(g).key);
        }
        // 第一批口粮与农庄的木料
        let grain = self.good("grain");
        let timber = self.good("timber");
        if !self.famine_now() {
            self.buy(grain, 90);
        }
        self.buy(timber, 20);
        let site = self.site;
        assert!(self.sail(site, on_month), "驶往殖民点");
        // 途中可能因疫病、风暴或海战损失船员：殖民者不超过船员减去最低船员与 10 人余量
        let f = self.s.world.fleet(self.fleet).unwrap().clone();
        let settlers = settlers.min(f.crew - f.crew_min(&defs) - 10);
        let out = self
            .s
            .submit(Command::FoundColony { owner: P, fleet: self.fleet, site, name: "晨星垦地".into(), settlers })
            .unwrap_or_else(|e| panic!("建立殖民地失败：{e}"));
        let CommandOutcome::ColonyFounded { colony } = out else { panic!("{out:?}") };
        self.colony = Some(colony);
        // 只留最低船员与少量余量，省下工资
        let f = self.s.world.fleet(self.fleet).unwrap().clone();
        let spare = f.crew - f.crew_min(&defs) - 10;
        if spare > 0 {
            assert!(self.try_cmd(Command::DismissCrew { owner: P, fleet: self.fleet, count: spare }));
        }
        self.at_site();
    }
}

fn month_record(m: &Manager) -> Option<Month> {
    let w = &m.s.world;
    let defs = &w.defs;
    let c = w.colony(m.colony?)?;
    let price = |g: &GoodId, q: &i64| defs.good(*g).base_price * q;
    let grain = defs.find_good("grain").map(|g| defs.good(g).base_price).unwrap_or(10);
    Some(Month {
        month: w.day() / MONTH,
        pop: c.population,
        morale: c.morale,
        housing: w.colony_housing(c),
        food_stock: w.colony_food_stock(c),
        tax: c.stats.last_tax,
        upkeep: c.stats.last_upkeep,
        produced_value: c.stats.last_produced.iter().map(|(g, q)| price(g, q)).sum(),
        eaten_value: c.stats.last_food_eaten * grain,
        starving: c.starving_days > 0,
        births: c.stats.last_births,
        immigrants: c.stats.last_immigrants,
        deaths: c.stats.last_deaths,
        cash: w.agent(P).map(|a| a.cash).unwrap_or(0),
        levels: c.total_levels(),
        raid_bp: w.colony_raid_bp(c),
    })
}

/// 按计划经营 `years` 年。
fn run(
    defs: Arc<StaticData>,
    seed: u64,
    site: &str,
    plan: Vec<&'static str>,
    years: u32,
    famine: Option<(u32, u32)>,
) -> Report {
    let mut mgr = Manager::new(defs, seed, site, plan);
    mgr.famine = famine;
    let months = std::cell::RefCell::new(Vec::<Month>::new());
    let mut record = |m: &Manager| {
        if let Some(r) = month_record(m) {
            months.borrow_mut().push(r);
        }
    };
    mgr.found(110, &mut record);
    let end = years * 12 * MONTH;
    let (home, site) = (mgr.home, mgr.site);
    while mgr.s.day() < end {
        if !mgr.sail(home, &mut record) && !mgr.recover() {
            break;
        }
        mgr.at_home();
        if !mgr.sail(site, &mut record) {
            if !mgr.recover() {
                break;
            }
            continue;
        }
        mgr.at_site();
        if mgr.colony.and_then(|c| mgr.s.world.colony(c)).is_none() {
            break;
        }
    }
    let months = months.into_inner();
    let reached_400 = months.iter().find(|m| m.pop >= 400).map(|m| m.month);
    let id = mgr.colony.unwrap();
    Report {
        months,
        reached_400,
        food_imports: mgr.food_imports,
        raids: mgr.raids,
        losses: mgr.losses,
        session: mgr.s,
        colony: id,
    }
}

fn print(name: &str, r: &Report) {
    println!(
        "== {name}：人口首次达到 400 在第 {:?} 个月末；袭击 {:?}；另组舰队 {} 次",
        r.reached_400, r.raids, r.losses
    );
    println!("月 人口 住房 士气 等级 存粮 税收 维护 产值 口粮 净额 出生 移民 死亡 现金 袭击率 断粮");
    for m in &r.months {
        println!(
            "{:>3} {:>4} {:>4} {:>3} {:>3} {:>5} {:>4} {:>4} {:>6} {:>5} {:>6} {:>3} {:>3} {:>3} {:>7} {:>3} {}",
            m.month,
            m.pop,
            m.housing,
            m.morale,
            m.levels,
            m.food_stock,
            m.tax,
            m.upkeep,
            m.produced_value,
            m.eaten_value,
            m.net(),
            m.births,
            m.immigrants,
            m.deaths,
            m.cash,
            m.raid_bp,
            if m.starving { "断粮" } else { "" }
        );
    }
    println!("进口粮食：{:?}", r.food_imports);
}

fn plantation_plan() -> Vec<&'static str> {
    vec!["farm", "plantation", "storehouse", "dock", "tavern", "chapel", "fort", "plantation", "fort", "storehouse"]
}

fn lumber_plan() -> Vec<&'static str> {
    vec!["farm", "lumber", "storehouse", "dock", "tavern", "chapel", "fort", "lumber", "fort", "storehouse"]
}

/// 检查一局的经营手感。
fn check_feel(name: &str, r: &Report) {
    print(name, r);
    let months = &r.months;
    assert!(months.len() >= 8 * 12 - 2, "{name}：殖民地存续 8 年");
    // 粮食自给：第二年起不再断粮，第三年起不再需要从殖民港运粮
    assert!(months.iter().filter(|m| m.month >= 12).all(|m| !m.starving), "{name}：第二年起不应断粮");
    let late_imports: i64 = r.food_imports.iter().filter(|(m, _)| **m >= 24).map(|(_, q)| q).sum();
    assert_eq!(late_imports, 0, "{name}：第三年起粮食应当自给");
    // 人口在第 5–8 年间（第 49–96 个月）达到 400：不会太快，也不会遥遥无期
    let reached = r.reached_400.unwrap_or_else(|| panic!("{name}：8 年内人口应达到 400"));
    assert!((4 * 12 + 1..=8 * 12).contains(&reached), "{name}：人口在第 {reached} 个月达到 400，应在第 5–8 年间");
    // 第三年：每月税收与产出价值都超过维护费（扣除吃掉的粮食）
    let year3: Vec<&Month> = months.iter().filter(|m| (25..=36).contains(&m.month)).collect();
    assert!(year3.len() >= 11);
    for m in &year3 {
        assert!(m.net() > 0, "{name}：第 {} 个月入不敷出：{m:?}", m.month);
    }
    // 不变量、货币守恒与重放
    let w = &r.session.world;
    assert!(w.money_conserved());
    let replayed = r.session.replay().unwrap();
    assert_eq!(replayed.state_hash(), w.state_hash(), "{name}：只用命令日志重放一致");
    assert!(w.colony(r.colony).is_some());
}

#[test]
fn plantation_colony_grows_into_a_self_sufficient_town() {
    let r = run(defs(), 11, "cacao_coast", plantation_plan(), 8, None);
    check_feel("可可海岸 · 种植园", &r);
}

#[test]
fn lumber_colony_grows_into_a_self_sufficient_town() {
    let r = run(defs(), 12, "emerald_bluff", lumber_plan(), 8, None);
    check_feel("翡翠岬 · 伐木场", &r);
}

/// 断粮：开局头二十天农庄迟迟建不起来，还把口粮运走——人口与士气明显下降，但补上粮食、建起农庄后能恢复。
#[test]
fn famine_hurts_noticeably_but_the_colony_recovers() {
    let r = run(defs(), 13, "cacao_coast", plantation_plan(), 4, Some((0, 20)));
    print("可可海岸 · 断粮", &r);
    let months = &r.months;
    let founded = 110;
    let starving: Vec<&Month> = months.iter().filter(|m| m.starving).collect();
    assert!(!starving.is_empty(), "断粮试验中应当断粮");
    let (worst, low_morale) =
        months.iter().take(6).fold((i64::MAX, i64::MAX), |(p, m), x| (p.min(x.pop), m.min(x.morale)));
    let loss = founded - worst;
    assert!(loss * 100 >= founded * 8, "断粮造成的人口损失应当可感知：{founded} → {worst}");
    assert!(loss * 100 <= founded * 30, "断粮造成的人口损失应当有限：{founded} → {worst}");
    assert!(low_morale <= 50, "断粮时士气下降：最低 {low_morale}");
    // 恢复：断粮结束后两年内人口回到建立时的水平以上，此后不再断粮
    let recovered = months.iter().find(|m| m.month > 2 && m.pop >= founded).map(|m| m.month);
    assert!(recovered.is_some_and(|m| m <= 26), "两年内恢复到 {founded} 人以上：{recovered:?}");
    assert!(months.iter().filter(|m| m.month >= 12).all(|m| !m.starving), "恢复后不再断粮");
    assert!(r.session.world.money_conserved());
}

/// 袭击：海盗猖獗（袭击系数取正式值的 5 倍）时殖民地屡遭袭击——每次损失人口与库存，但损失有限、一年内能恢复。
#[test]
fn raids_hurt_noticeably_but_the_colony_recovers() {
    let mut d = (*defs()).clone();
    d.rules.colony.raid_scale = Fx(d.rules.colony.raid_scale.raw() * 5);
    let r = run(Arc::new(d), 15, "cacao_coast", plantation_plan(), 8, None);
    print("可可海岸 · 海盗猖獗", &r);
    assert!(r.raids.len() >= 2, "八年里应当多次遭袭：{:?}", r.raids);
    let mut recovered = 0;
    for (i, raid) in r.raids.iter().enumerate() {
        let (day, before) = (raid.day, raid.pop_before);
        assert!(raid.deaths >= 1, "第 {day} 天的袭击应有伤亡");
        assert!(raid.deaths * 100 <= before * 10, "第 {day} 天的袭击伤亡应当有限：{}/{before}", raid.deaths);
        assert!(raid.cargo_lost > 0, "第 {day} 天的袭击应当劫走库存");
        // 一年内没有再遭袭时，一年后人口回到袭击前的水平以上
        let next = r.raids.get(i + 1).map(|x| x.day).unwrap_or(u32::MAX);
        let later = r.months.iter().find(|m| m.month * MONTH >= day + 360).map(|m| m.pop);
        if next > day + 360
            && let Some(p) = later
        {
            assert!(p >= before, "第 {day} 天遭袭后一年内应当恢复：{before} → {p}");
            recovered += 1;
        }
    }
    assert!(recovered >= 1, "至少观察到一次袭击后的恢复");
    let last = r.months.last().unwrap();
    assert!(last.pop >= 300, "屡遭袭击的殖民地仍在成长：{}", last.pop);
}
