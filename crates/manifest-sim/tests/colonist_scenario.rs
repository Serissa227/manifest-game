//! “新大陆开拓者”剧本的新手路线（真实数据、正式剧本数值：不放宽资金，不改船员与开局货物）。
//!
//! 脚本照剧本说明玩：开局不买任何东西，靠货舱里的木材、谷物、铁器与粮水 → 驶往最近的、能建农庄与伐木场的殖民点 →
//! 建立殖民地（驾船的最低船员之外全部留下当殖民者）→ 开工农庄，完工后开工伐木场 → 回诺瓦马尔补给 →
//! 之后边跑贸易边经营：平时用套利规划（与 NPC 商会同一套）在离诺瓦马尔 25 天以内的新大陆港口跑船，
//! 船员常备最低船员之上 6 人、粮水常备 30 天；每隔约两个月先回诺瓦马尔，买好下一项建设的建材
//! （现金宽裕时也买殖民地的消费品，自产粮食不够时买口粮），运到殖民地卸下，装走富余的产出，
//! 开工下一项建设（保留 15,000 金币跑贸易的本钱），途中减员时请殖民者上船，再回诺瓦马尔。
//!
//! 检查前 3 年：不破产（没有破产重组）、殖民地人口增长、粮食基本自给（农庄投产后不断粮、第二年起不用运粮）、
//! 至少完成 2 次建造；每天不变量成立、货币守恒，只用命令日志重放一致。
//! 另外，什么都不做的玩家至少能撑过 1 年。

mod common;

use manifest_core::colony::{food_need, raw_output};
use manifest_core::defs::{BuildingKind, StaticData};
use manifest_core::fleet::{daily_supply_need, fleet_days};
use manifest_core::ids::*;
use manifest_core::log::LogKind;
use manifest_core::npc::{PlannerParams, stage_load, stage_unload};
use manifest_core::rng::{Domain, Rng};
use manifest_core::testkit::check_invariants;
use manifest_core::warehouse::Holder;
use manifest_core::{Command, CommandOutcome, Fx};
use manifest_sim::GameSession;
use std::collections::BTreeMap;
use std::sync::Arc;

const P: OwnerId = OwnerId::Player;
const YEAR: u32 = 360;
/// 两次回殖民地之间的天数
const VISIT_EVERY: u32 = 60;
/// 扩建时保留的现金（跑贸易的本钱）
const RESERVE: i64 = 15_000;
/// 跑贸易时单程的最长天数（只在新大陆近海跑）
const MAX_LEG: i64 = 25;
/// 现金高于此值时才给殖民地买消费品
const COMFORT: i64 = 30_000;
/// 船员在最低船员之上多留的人数
const CREW_SPARE: i64 = 6;

/// 每年一行的记录。
#[derive(Clone, Debug, Default)]
struct YearLine {
    year: u32,
    cash: i64,
    net_worth: i64,
    pop: i64,
    morale: i64,
    levels: i64,
    food_stock: i64,
    food_output: i64,
    food_need: i64,
}

/// 新手开拓者：一支开局舰队，一座殖民地。
struct Pioneer {
    s: GameSession,
    fleet: FleetId,
    home: LocId,
    site: LocId,
    colony: Option<ColonyId>,
    /// 建立殖民地时的殖民者人数
    settlers: i64,
    /// 农庄投产的日期
    farm_day: Option<u32>,
    /// 下一次该回殖民地的日期
    next_visit: u32,
    /// 运往殖民地的口粮（按年序，从 0 起）
    food_imports: BTreeMap<u32, i64>,
    /// 农庄投产后断粮的天数（按年序）
    starving: BTreeMap<u32, u32>,
    /// 完工的建设（建筑 key, 等级）
    built: Vec<(String, u8)>,
    /// 舰队沉没、另组舰队的次数
    losses: u32,
    lines: Vec<YearLine>,
}

impl Pioneer {
    fn new(seed: u64) -> Pioneer {
        let defs = common::defs();
        let scenario = defs.find_scenario("colonist").expect("新大陆开拓者剧本");
        let s = GameSession::new(defs.clone(), scenario, seed).unwrap();
        let f = s.world.fleets_of(P).next().unwrap();
        let (fleet, home) = (f.id, f.docked_at().unwrap());
        Pioneer {
            s,
            fleet,
            home,
            site: home,
            colony: None,
            settlers: 0,
            farm_day: None,
            next_visit: 0,
            food_imports: BTreeMap::new(),
            starving: BTreeMap::new(),
            built: Vec::new(),
            losses: 0,
            lines: Vec::new(),
        }
    }

    fn defs(&self) -> Arc<StaticData> {
        self.s.world.defs.clone()
    }

    fn b(&self, key: &str) -> ColonyBuildingId {
        self.s.world.defs.find_colony_building(key).unwrap_or_else(|| panic!("殖民地建筑 {key}"))
    }

    fn cash(&self) -> i64 {
        self.s.world.agent(P).unwrap().cash
    }

    fn ok(&mut self, c: Command) -> CommandOutcome {
        self.s.submit(c.clone()).unwrap_or_else(|e| panic!("第 {} 天 {c:?} 失败：{e}", self.s.day()))
    }

    fn try_cmd(&mut self, c: Command) -> bool {
        self.s.submit(c).is_ok()
    }

    fn docked(&self) -> Option<LocId> {
        self.s.world.fleet(self.fleet).ok().and_then(|f| f.docked_at())
    }

    /// 推进一天：检查不变量，记下完工、断粮与年末情况。
    fn day(&mut self) {
        let r = self.s.advance_day().unwrap();
        if let Err(e) = check_invariants(&self.s.world) {
            panic!("{e}");
        }
        let defs = self.defs();
        for e in self.s.world.state.log.iter().rev().take_while(|e| e.day == r.day) {
            if let LogKind::ColonyBuilt { colony, building, level, .. } = &e.kind
                && Some(*colony) == self.colony
            {
                self.built.push((defs.colony_building(*building).key.clone(), *level));
            }
        }
        if let Some(c) = self.colony.and_then(|id| self.s.world.colony(id)) {
            let farm = self.b("farm");
            if self.farm_day.is_none() && c.level(farm) > 0 {
                self.farm_day = Some(r.day);
            }
            if self.farm_day.is_some() && c.starving_days > 0 {
                *self.starving.entry(r.day / YEAR).or_insert(0) += 1;
            }
        }
        if r.year_end {
            self.lines.push(self.year_line(r.day / YEAR + 1));
        }
        // 舰队沉没：在殖民港另买一艘最便宜的船继续
        if self.s.world.fleet(self.fleet).is_err() {
            self.recover();
        }
    }

    fn year_line(&self, year: u32) -> YearLine {
        let w = &self.s.world;
        let a = w.agent(P).unwrap();
        let mut line = YearLine { year, cash: a.cash, net_worth: a.ledger.equity(), ..YearLine::default() };
        if let Some(c) = self.colony.and_then(|id| w.colony(id)) {
            line.pop = c.population;
            line.morale = c.morale;
            line.levels = c.total_levels();
            line.food_stock = w.colony_food_stock(c);
            line.food_output = self.food_output();
            line.food_need = food_need(&w.defs, c.population);
        }
        line
    }

    fn recover(&mut self) {
        self.losses += 1;
        let defs = self.defs();
        let ship = defs
            .loc(self.home)
            .shipyard
            .iter()
            .copied()
            .min_by_key(|s| (defs.ship(*s).price, s.0))
            .expect("殖民港有船厂");
        let old = self.fleet;
        assert!(
            self.try_cmd(Command::FoundFleet { owner: P, at: self.home, ship_type: ship }),
            "第 {} 天舰队沉没后买不起新船",
            self.s.day()
        );
        self.fleet = self.s.world.fleets_of(P).map(|f| f.id).filter(|f| *f != old).max().unwrap();
        let f = self.s.world.fleet(self.fleet).unwrap().clone();
        let want = f.crew_min(&defs) + 2 - f.crew;
        if want > 0 {
            let _ = self.try_cmd(Command::HireCrew { owner: P, fleet: self.fleet, count: want });
        }
    }

    /// 航行到目的地（逐日推进）；舰队沉没时返回 false。
    fn sail(&mut self, dest: LocId) -> bool {
        if self.docked() == Some(dest) {
            return true;
        }
        let fleet = self.fleet;
        self.ok(Command::SetSail { owner: P, fleet, dest });
        for _ in 0..120 {
            if self.fleet != fleet {
                return false;
            }
            if self.docked() == Some(dest) {
                return true;
            }
            self.day();
        }
        panic!("第 {} 天：120 天内没有抵达 {dest:?}", self.s.day());
    }

    /// 补足 days 天的粮水（舱位不够时装到满为止）。
    fn supply(&mut self, days: i64) {
        let f = self.s.world.fleet(self.fleet).unwrap().clone();
        let room = (f.free_capacity() + f.food + f.water) / 2;
        let need = (daily_supply_need(&self.s.world.defs, f.crew) * days).min(room);
        let (food, water) = ((need - f.food).max(0), (need - f.water).max(0));
        if food + water > 0 {
            let _ = self.try_cmd(Command::Resupply { owner: P, fleet: self.fleet, food, water });
        }
    }

    /// 在当前港口买入，买不到全部时逐步减半；返回买到的数量。
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

    /// 卖掉船上当地收购的全部货物。
    fn sell_all(&mut self) {
        let Some(here) = self.docked() else { return };
        let cargo = self.s.world.fleet(self.fleet).unwrap().cargo.clone();
        for (g, q) in cargo {
            if q > 0 && self.s.world.market(here, g).is_some() {
                let _ = self.try_cmd(Command::Sell { owner: P, fleet: self.fleet, good: g, qty: q, min_total: None });
            }
        }
    }

    /// 修船，船员补到最低船员之上留些余量（海战与疫病会减员，低于最低船员就会减速）。
    fn maintain(&mut self) {
        let defs = self.defs();
        let f = self.s.world.fleet(self.fleet).unwrap().clone();
        if f.ships.iter().any(|s| s.durability * 10 < s.max_durability * 8) {
            let _ = self.try_cmd(Command::Repair { owner: P, fleet: self.fleet });
        }
        let want = (f.crew_min(&defs) + CREW_SPARE).min(f.crew_max(&defs)) - f.crew;
        if want > 0 {
            let _ = self.try_cmd(Command::HireCrew { owner: P, fleet: self.fleet, count: want });
        }
    }

    /// 殖民地粮食建筑每天的预计产量（件）。
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

    /// 离殖民港最近、既能建农庄又能建伐木场的无主殖民点。
    fn nearest_site(&self) -> LocId {
        let w = &self.s.world;
        let defs = &w.defs;
        let f = w.fleet(self.fleet).unwrap();
        let (farm, lumber) = (defs.colony_building(self.b("farm")), defs.colony_building(self.b("lumber")));
        defs.locations
            .iter()
            .enumerate()
            .filter_map(|(i, l)| {
                let site = l.site.as_ref()?;
                let loc = LocId(i as u16);
                let timber = defs.find_good("timber")?;
                let lumber_ok = raw_output(lumber, site).is_some_and(|(g, _)| g == timber);
                if raw_output(farm, site).is_none() || !lumber_ok || w.claim_of(loc).is_some() {
                    return None;
                }
                Some((w.estimate_days(f, loc)?, loc))
            })
            .min()
            .map(|(_, loc)| loc)
            .expect("附近有可殖民地点")
    }

    /// 下一项建设：农庄 → 伐木场 → 粮食不够扩建农庄 → 住房快满加盖住宅区 → 酒馆 → 仓棚 → 礼拜堂 → 伐木场二级。
    fn next_build(&self) -> Option<ColonyBuildingId> {
        let w = &self.s.world;
        let defs = &w.defs;
        let c = w.colony(self.colony?)?;
        let max = |b: ColonyBuildingId| defs.colony_building(b).max_level;
        let (farm, lumber, housing) = (self.b("farm"), self.b("lumber"), self.b("housing"));
        for b in [farm, lumber] {
            if c.level(b) == 0 {
                return Some(b);
            }
        }
        if self.food_output() < food_need(defs, c.population + 40) && c.level(farm) < max(farm) {
            return Some(farm);
        }
        if c.population + 20 >= w.colony_housing(c) && c.level(housing) < max(housing) {
            return Some(housing);
        }
        for (key, lvl) in [("tavern", 1), ("storehouse", 1), ("chapel", 1), ("lumber", 2)] {
            let b = self.b(key);
            if c.level(b) < lvl {
                return Some(b);
            }
        }
        None
    }

    /// 殖民地仓库与船上某商品的合计。
    fn stock(&self, g: GoodId) -> i64 {
        self.s.world.holder_qty(P, Holder::Warehouse(self.site), g)
            + self.s.world.fleet(self.fleet).map(|f| f.cargo.get(&g).copied().unwrap_or(0)).unwrap_or(0)
    }

    /// 开局：不买任何东西，驶往最近的殖民点，建立殖民地，建农庄与伐木场，回诺瓦马尔。
    fn open(&mut self) {
        let defs = self.defs();
        // 开局货物已备齐建立物资
        for (g, q) in &defs.rules.colony.found_materials {
            assert!(self.stock(*g) >= *q, "开局货舱里应有 {} {q} 件", defs.good(*g).key);
        }
        self.site = self.nearest_site();
        let days = self.s.world.estimate_days(self.s.world.fleet(self.fleet).unwrap(), self.site).unwrap();
        let f = self.s.world.fleet(self.fleet).unwrap();
        assert!(
            f.food >= daily_supply_need(&defs, f.crew) * days,
            "开局粮水够跑到 {}（{days} 天）",
            defs.loc(self.site).name
        );
        assert!(self.sail(self.site), "驶往殖民点");
        // 一路上没有任何采购与补给
        assert!(self.s.log().iter().all(|e| !matches!(e.command, Command::Buy { .. } | Command::Resupply { .. })));
        // 驾船的最低船员之外全部留下当殖民者
        let f = self.s.world.fleet(self.fleet).unwrap().clone();
        let settlers = f.crew - f.crew_min(&defs);
        let out = self.ok(Command::FoundColony {
            owner: P,
            fleet: self.fleet,
            site: self.site,
            name: "开拓者垦地".into(),
            settlers,
        });
        let CommandOutcome::ColonyFounded { colony } = out else { panic!("{out:?}") };
        self.colony = Some(colony);
        self.settlers = settlers;
        // 卸下剩余的建材与谷物，开工农庄；完工后开工伐木场
        let cargo = self.s.world.fleet(self.fleet).unwrap().cargo.clone();
        for (g, q) in cargo {
            self.ok(Command::Transfer {
                owner: P,
                from: Holder::Fleet(self.fleet),
                to: Holder::Warehouse(self.site),
                good: g,
                qty: q,
            });
        }
        for key in ["farm", "lumber"] {
            let building = self.b(key);
            self.ok(Command::BuildColony { owner: P, colony, building });
            while self.s.world.colony(colony).is_some_and(|c| c.construction.is_some()) {
                self.day();
            }
        }
        let home = self.home;
        assert!(self.sail(home), "回诺瓦马尔");
        self.next_visit = self.s.day() + VISIT_EVERY;
    }

    /// 在诺瓦马尔为殖民地采购：下一项建设的建材、殖民地的消费品，自产粮食不够时买口粮；然后驶往殖民地。
    fn supply_run(&mut self) {
        let defs = self.defs();
        self.sell_all();
        self.maintain();
        let Some(c) = self.colony.and_then(|id| self.s.world.colony(id)).cloned() else { return };
        let there = self.s.world.estimate_days(self.s.world.fleet(self.fleet).unwrap(), self.site).unwrap_or(10);
        self.supply(2 * there + 6);
        // 口粮：自产不够且存粮不足 60 天时补到 90 天
        let need = food_need(&defs, c.population);
        let food_stock = self.s.world.colony_food_stock(&c);
        if self.food_output() < need && food_stock < need * 60 {
            let grain = defs.find_good("grain").unwrap();
            let got = self.buy(grain, need * 90 - food_stock);
            *self.food_imports.entry(self.s.day() / YEAR).or_insert(0) += got;
        }
        // 下一项建设的建材（留足跑贸易的本钱）
        if let Some(b) = self.next_build() {
            let d = defs.colony_building(b).clone();
            if self.cash() >= d.cost + RESERVE {
                for (g, q) in &d.materials {
                    let missing = q - self.stock(*g);
                    if missing > 0 {
                        self.buy(*g, missing);
                    }
                }
            }
        }
        // 消费品：手头宽裕时按殖民地规则的每百人每月需求带够两个月（士气是移民的来源）
        let goods = if self.cash() >= COMFORT { defs.rules.colony.morale_goods.clone() } else { Vec::new() };
        for (g, per_100) in goods {
            let want = (c.population * per_100 + 99) / 100 * 2 - self.stock(g);
            if want > 0 && self.s.world.market(self.home, g).is_some() {
                self.buy(g, want);
            }
        }
        let site = self.site;
        if self.sail(site) {
            self.at_site();
        }
        self.next_visit = self.s.day() + VISIT_EVERY;
    }

    /// 在殖民地：卸下带来的货物，装走富余的产出（先腾出仓库），开工下一项建设，回诺瓦马尔。
    fn at_site(&mut self) {
        let defs = self.defs();
        let site = self.site;
        let Some(id) = self.colony.filter(|id| self.s.world.colony(*id).is_some()) else { return };
        let mut brought = self.s.world.fleet(self.fleet).unwrap().cargo.clone();
        self.unload(&mut brought);
        // 装走产出：口粮留 90 天，木材留 60 件备建，消费品、带来的货物与下一项建设的建材留下
        let c = self.s.world.colony(id).unwrap().clone();
        let keep: Vec<(GoodId, i64)> =
            self.next_build().map(|b| defs.colony_building(b).materials.clone()).unwrap_or_default();
        let timber = defs.find_good("timber").unwrap();
        let mut food_left = food_need(&defs, c.population) * 90;
        let stock: Vec<(GoodId, i64)> = self
            .s
            .world
            .warehouse(P, site)
            .map(|w| w.stock.iter().map(|(g, q)| (*g, *q)).collect())
            .unwrap_or_default();
        for (g, q) in stock {
            if defs.rules.colony.morale_goods.iter().any(|(k, _)| *k == g) || brought.contains_key(&g) {
                continue;
            }
            let mut q = q - keep.iter().filter(|(k, _)| *k == g).map(|(_, n)| *n).sum::<i64>();
            if g == timber {
                q -= 60;
            }
            if defs.good(g).category == defs.rules.colony.food_category {
                let kept = q.min(food_left).max(0);
                food_left -= kept;
                q -= kept;
            }
            let q = q.min(self.s.world.fleet(self.fleet).unwrap().free_capacity());
            if q > 0 {
                self.ok(Command::Transfer {
                    owner: P,
                    from: Holder::Warehouse(site),
                    to: Holder::Fleet(self.fleet),
                    good: g,
                    qty: q,
                });
            }
        }
        // 仓库腾出地方后，卸下其余带来的货物
        self.unload(&mut brought);
        // 开工下一项建设
        if let Some(b) = self.next_build() {
            let d = defs.colony_building(b).clone();
            if self.cash() >= d.cost + RESERVE {
                let _ = self.try_cmd(Command::BuildColony { owner: P, colony: id, building: b });
            }
        }
        // 途中减员、船员不足最低船员时，请殖民者上船
        let f = self.s.world.fleet(self.fleet).unwrap().clone();
        let short = f.crew_min(&defs) - f.crew;
        if short > 0 {
            self.ok(Command::HireCrew { owner: P, fleet: self.fleet, count: short });
        }
        let home = self.home;
        self.sail(home);
    }

    /// 把带来的货物卸进殖民地仓库（装不下的留在船上，记在 brought 里）。
    fn unload(&mut self, brought: &mut BTreeMap<GoodId, i64>) {
        let site = self.site;
        for (g, left) in brought.iter_mut() {
            let used = self.s.world.warehouse(P, site).map(|w| w.used()).unwrap_or(0);
            let q = (*left).min((self.s.world.warehouse_capacity(P, site) - used).max(0));
            if q > 0 {
                self.ok(Command::Transfer {
                    owner: P,
                    from: Holder::Fleet(self.fleet),
                    to: Holder::Warehouse(site),
                    good: *g,
                    qty: q,
                });
                *left -= q;
            }
        }
    }

    /// 某港口离殖民港的航程（本季与下一季取长者）不超过 MAX_LEG 天。
    fn near_home(&self, dest: LocId) -> bool {
        let w = &self.s.world;
        let defs = &w.defs;
        let Ok(f) = w.fleet(self.fleet) else { return false };
        let season = w.season().index();
        [season, (season + 1) % 4]
            .iter()
            .all(|s| defs.nav.path(*s, self.home, dest).is_some_and(|p| fleet_days(defs, f, p) <= MAX_LEG))
    }

    /// 跑贸易：用套利规划（与 NPC 商会同一套）挑生意，只去离殖民港不超过 MAX_LEG 天的港口（新大陆近海）。
    fn trade(&mut self) {
        self.maintain();
        // 粮水常备 30 天（遇上风暴、海战减员而减速时不至于断粮）
        self.supply(30);
        let fid = self.fleet;
        let params = PlannerParams::for_owner(&self.s.world, P);
        for cmd in stage_unload(&self.s.world, fid, &params) {
            let _ = self.s.submit(cmd);
        }
        let seed = self.s.world.state.seed;
        let mut rng = Rng::derive(seed, self.s.day(), Domain::Scenario, fid.0 as u64, 77);
        let cmds = stage_load(&self.s.world, fid, &params, &mut rng);
        let far = cmds.iter().any(|c| match c {
            Command::SetSail { dest, .. } => !self.near_home(*dest),
            _ => false,
        });
        if far {
            // 远洋的生意不做：留着的货就地卖掉
            self.sell_all();
            return;
        }
        for cmd in cmds {
            if self.s.submit(cmd).is_err() {
                break;
            }
        }
    }

    /// 玩到第 days 天。
    fn play(&mut self, days: u32) {
        self.open();
        while self.s.day() < days {
            let before = self.s.day();
            match self.docked() {
                Some(here) if here == self.site => self.at_site(),
                Some(here) if self.s.day() >= self.next_visit => {
                    if here == self.home {
                        self.supply_run();
                    } else {
                        // 先回诺瓦马尔
                        self.sell_all();
                        self.maintain();
                        let back = self
                            .s
                            .world
                            .estimate_days(self.s.world.fleet(self.fleet).unwrap(), self.home)
                            .unwrap_or(20);
                        self.supply(back + manifest_core::fleet::supply_margin(5, back));
                        let home = self.home;
                        self.sail(home);
                    }
                }
                Some(_) => self.trade(),
                None => {}
            }
            // 这一轮没有推进日期（在港等待、航行中）时推进一天
            if self.s.day() == before {
                self.day();
            }
        }
    }

    fn print(&self, name: &str) {
        println!(
            "== {name}：殖民点 {}，殖民者 {} 人，农庄投产第 {:?} 天，完工 {:?}，另组舰队 {} 次",
            self.s.world.defs.loc(self.site).key,
            self.settlers,
            self.farm_day,
            self.built,
            self.losses
        );
        println!("年 现金 净资产 人口 士气 等级 存粮 粮产 粮需");
        for l in &self.lines {
            println!(
                "{} {} {} {} {} {} {} {} {}",
                l.year, l.cash, l.net_worth, l.pop, l.morale, l.levels, l.food_stock, l.food_output, l.food_need
            );
        }
        println!("运粮 {:?}；断粮天数 {:?}", self.food_imports, self.starving);
        for r in &self.s.world.agent(P).unwrap().ledger.yearly {
            println!(
                "第 {} 年损益：收入 {:?}，费用 {:?}，净利 {}",
                r.index + 1,
                r.income.revenues,
                r.income.expenses,
                r.income.net_income
            );
        }
    }
}

/// 按新手路线玩 3 年：不破产、殖民地人口增长、粮食基本自给、至少完成 2 次建造。
fn check_three_years(seed: u64) {
    let mut p = Pioneer::new(seed);
    p.play(3 * YEAR);
    let name = format!("种子 {seed}");
    p.print(&name);
    let w = &p.s.world;
    let a = w.agent(P).unwrap();
    assert_eq!(a.reorganizations, 0, "{name}：前 3 年不应破产重组");
    assert!(!a.bankrupt, "{name}：前 3 年不应破产");
    assert!(w.state.outcome.is_none(), "{name}：前 3 年不应分出胜负：{:?}", w.state.outcome);
    let id = p.colony.expect("建立了殖民地");
    let c = w.colony(id).unwrap_or_else(|| panic!("{name}：殖民地 3 年后仍在"));
    assert!(c.population > p.settlers, "{name}：殖民地人口增长：{} → {}", p.settlers, c.population);
    // 粮食基本自给：农庄投产后不断粮，第二年起不用从殖民港运粮，自产够吃
    let starving: u32 = p.starving.values().sum();
    assert_eq!(starving, 0, "{name}：农庄投产后不应断粮：{:?}", p.starving);
    let late: i64 = p.food_imports.iter().filter(|(y, _)| **y >= 1).map(|(_, q)| q).sum();
    assert_eq!(late, 0, "{name}：第二年起粮食应当自给：{:?}", p.food_imports);
    assert!(p.food_output() >= food_need(&w.defs, c.population), "{name}：自产粮食够吃");
    // 至少完成 2 次建造（农庄与伐木场）
    assert!(p.built.len() >= 2, "{name}：至少完成 2 次建造：{:?}", p.built);
    for key in ["farm", "lumber"] {
        assert!(c.level(p.b(key)) >= 1, "{name}：建成了 {key}");
    }
    // 货币守恒；只用命令日志重放一致
    assert!(w.money_conserved());
    let replayed = p.s.replay().unwrap();
    assert_eq!(replayed.state_hash(), w.state_hash(), "{name}：只用命令日志重放一致");
}

#[test]
fn newcomer_route_founds_a_colony_and_survives_three_years() {
    for seed in [31, 42] {
        check_three_years(seed);
    }
}

#[test]
fn newcomer_route_survives_three_years_on_other_seeds() {
    for seed in [32, 44] {
        check_three_years(seed);
    }
}

/// 什么都不做：开局货物原封不动，工资与月薪照付，至少撑过一整年。
#[test]
fn idle_colonist_survives_the_first_year() {
    for seed in [41, 42] {
        let defs = common::defs();
        let scenario = defs.find_scenario("colonist").unwrap();
        let mut s = GameSession::new(defs.clone(), scenario, seed).unwrap();
        let sc = &defs.scenarios[scenario.idx()];
        let fleet = s.world.fleets_of(P).next().unwrap().clone();
        for (g, q) in &sc.cargo {
            assert_eq!(fleet.cargo.get(g).copied(), Some(*q), "开局货物装在舰队货舱");
        }
        assert_eq!((fleet.food, fleet.water), (sc.food, sc.water));
        check_invariants(&s.world).unwrap();
        for _ in 0..YEAR {
            s.advance_day().unwrap();
            if let Err(e) = check_invariants(&s.world) {
                panic!("{e}");
            }
        }
        let a = s.world.agent(P).unwrap();
        assert_eq!(a.reorganizations, 0, "种子 {seed}：什么都不做也应撑过一年");
        assert!(a.cash >= 0, "种子 {seed}：一年后现金 {}", a.cash);
        assert!(s.world.state.outcome.is_none());
    }
}
