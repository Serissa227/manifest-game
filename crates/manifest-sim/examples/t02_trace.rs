//! T02 追查：商会跟投与套利 bot（只观测，不改任何状态之外的东西）。
//!
//! `cargo run --release --locked --offline -p manifest-sim --example t02_trace -- <数据目录> <种子> <年数> [bot]`
//!
//! 与 `balance` 相同的开局（寰宇自由航海、行情随船传递、AI 关闭、bot 代替玩家）。逐年打出：
//! - bot 的现金、净资产、买卖与出航次数、年度损益（按科目）、船队与舱位、停港不动的船队·天数；
//! - bot 的航线（按船队把“在 A 买 G、在 B 卖 G”配成一对）：成交量最大的几条、当时的市价与价差；
//! - 第一年最常跑的三条线逐年的两端现价、两端发展度、商会在两端的商馆等级、商誉与能买的货档、税率；
//! - 商会：存活、船队与舱位、累计投资、分到的分红；货币是否守恒。
use manifest_core::fixed::Money;
use manifest_core::ids::{FleetId, GoodId, LocId, OwnerId};
use manifest_core::info::InfoMode;
use manifest_core::ledger::Account;
use manifest_core::{Command, World};
use manifest_sim::balance::default_scenario;
use manifest_sim::{Bot, BotKind, GameSession, stats};
use std::collections::BTreeMap;
use std::path::PathBuf;

#[derive(Default, Clone)]
struct Lane {
    qty: i64,
    buy_value: i64,
    sell_value: i64,
}

/// 一家商会的累计（T02 第 11 节：商会存活与跟投）。
#[derive(Default)]
struct Company {
    /// 月初那天投出去的（跟投；本据港每年一次的投资若恰好落在月初也算在这里，只有 5 号商会会这样）
    follow: i64,
    /// 其余日子投出去的（每年一次的本据港投资）
    annual: i64,
    dividends: i64,
    monthly: Vec<i64>,
    /// 当前这一段负现金里最低的现金
    min_cash: i64,
    /// 倒闭：日、前一日现金、那一段负现金里最低的现金
    died: Option<(u32, i64, i64)>,
}

/// 某所有者在各港的累计投资合计。
fn invested(w: &World, owner: OwnerId) -> i64 {
    w.state.locations.iter().filter_map(|l| l.investments.get(&owner)).sum()
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    let data = PathBuf::from(args.get(1).ok_or("数据目录")?);
    let seed: u64 = args.get(2).ok_or("种子")?.parse()?;
    let years: u32 = args.get(3).map(|s| s.parse()).transpose()?.unwrap_or(5);
    let bot: BotKind = args.get(4).map(|s| s.parse()).transpose()?.unwrap_or(BotKind::Arbitrage);
    let mut defs = manifest_data::load_world(&data, "terra16")?;
    // K01 对照（只观测）：`K01_SKILL_EFFECTS=off` 关掉技能效果；`K01_SKILLS=<1–3>` 开局给 bot 的主角每个可学的技能到这一级
    // （自由航海的开局没有技能经验，不给的话开关开不开都一样）。
    if std::env::var("K01_SKILL_EFFECTS").is_ok_and(|v| v == "off") {
        std::sync::Arc::make_mut(&mut defs).rules.skill_effects.enabled = false;
    }
    let skill_level: usize = std::env::var("K01_SKILLS").ok().and_then(|v| v.parse().ok()).unwrap_or(0);
    let scenario = default_scenario(&defs)?;
    let mut session = GameSession::new(defs.clone(), scenario, seed)?;
    session.choose_info(InfoMode::Carried)?;
    if skill_level > 0 {
        let xp: Vec<(String, i64)> = defs
            .upbringing
            .skill_profiles
            .iter()
            .filter(|(k, p)| !p.unavailable && defs.story2.skill_effects.contains_key(*k))
            .filter_map(|(k, p)| p.thresholds.get(skill_level - 1).map(|t| (k.clone(), *t)))
            .collect();
        println!("K01 开局技能：{} 个到 {skill_level} 级；技能效果开关={}", xp.len(), defs.rules.skill_effects.enabled);
        session.world.state.items.owners.entry(OwnerId::Player).or_default().skill_xp.extend(xp);
    }
    let mut player = Bot::new(bot);
    let p = OwnerId::Player;
    let year_days = defs.calendar.year_days();
    let start_net = stats::net_worth(&session.world, p);
    println!("开局 seed={seed} bot={bot} 现金={} 净资产={start_net}", session.world.agent(p)?.cash);

    // 每支船队上一次买进的货：(港, 货) -> (量, 单价)
    let mut holding: BTreeMap<(FleetId, GoodId), (LocId, i64, i64)> = BTreeMap::new();
    let mut lanes_by_year: Vec<BTreeMap<(GoodId, LocId, LocId), Lane>> = Vec::new();
    let mut tracked: Vec<(GoodId, LocId, LocId)> = Vec::new();
    let mut conserved = true;
    let daily = std::env::var("T02_DAILY").is_ok_and(|v| v == "1");
    let mut comps: BTreeMap<OwnerId, Company> = BTreeMap::new();
    let mut refusals = 0u32;
    for year in 1..=years {
        let mut lanes: BTreeMap<(GoodId, LocId, LocId), Lane> = BTreeMap::new();
        let (mut buys, mut sells, mut departures, mut idle) = (0u32, 0u32, 0u32, 0u32);
        // T03：bot 的代办成交笔数与成交额（规则关闭的世界为 0）
        let (mut agency_fills, mut agency_total) = (0u32, 0i64);
        for _ in 0..year_days {
            // 当天开盘时停港的船队与那里的市价
            let docked: BTreeMap<FleetId, LocId> =
                session.world.fleets_of(p).filter_map(|f| f.docked_at().map(|l| (f.id, l))).collect();
            let price = |w: &World, loc: LocId, g: GoodId| w.market(loc, g).map_or(0, |e| e.price);
            let before: BTreeMap<(LocId, GoodId), i64> = docked
                .values()
                .flat_map(|l| {
                    let l = *l;
                    session.world.state.locations[l.idx()].market.keys().map(move |g| (l, *g)).collect::<Vec<_>>()
                })
                .map(|(l, g)| ((l, g), price(&session.world, l, g)))
                .collect();
            let first = session.log().len();
            player.act(&mut session);
            let mut moved = std::collections::BTreeSet::new();
            for entry in &session.log()[first..] {
                match entry.command {
                    Command::Buy { fleet, good, qty, .. } => {
                        buys += 1;
                        if let Some(loc) = docked.get(&fleet) {
                            let pr = before.get(&(*loc, good)).copied().unwrap_or(0);
                            holding.insert((fleet, good), (*loc, qty, pr));
                        }
                    }
                    Command::Sell { fleet, good, qty, .. } => {
                        sells += 1;
                        if let (Some(loc), Some((from, _, bp))) = (docked.get(&fleet), holding.remove(&(fleet, good))) {
                            let sp = before.get(&(*loc, good)).copied().unwrap_or(0);
                            let lane = lanes.entry((good, from, *loc)).or_default();
                            lane.qty += qty;
                            lane.buy_value += qty * bp;
                            lane.sell_value += qty * sp;
                        }
                    }
                    Command::SetSail { fleet, .. } | Command::Autopilot { fleet, .. } => {
                        departures += 1;
                        moved.insert(fleet);
                    }
                    _ => {}
                }
            }
            idle += docked.keys().filter(|f| !moved.contains(f)).count() as u32;
            // 停港不动的船队：照规划器挑的目的地再试一次出航，记下被拒的原因（只记被拒的，每局前 10 次）
            for (fid, _) in docked.iter().filter(|(f, _)| !moved.contains(*f)) {
                if refusals >= 10 || session.world.fleet(*fid).map_or(true, |f| f.docked_at().is_none()) {
                    continue;
                }
                let params = manifest_core::npc::PlannerParams::for_owner(&session.world, p);
                let mut rng = manifest_core::rng::Rng::derive(0, 0, manifest_core::rng::Domain::Scenario, 0, 0);
                let plan = manifest_core::npc::stage_load(&session.world, *fid, &params, &mut rng);
                for cmd in plan {
                    if let Command::SetSail { dest, .. } = cmd {
                        let probe = Command::Autopilot {
                            owner: p,
                            fleet: *fid,
                            dest,
                            minute: 0,
                            stop_at_known_edge: false,
                            route: None,
                        };
                        let mut w2 = session.world.clone();
                        let r = probe.apply(&mut w2);
                        if r.is_ok() {
                            continue;
                        }
                        println!(
                            "  拒绝 d{} {:?} 去 {}：{:?}",
                            session.world.state.day,
                            fid,
                            defs.loc(dest).key,
                            r.err()
                        );
                        refusals += 1;
                    }
                }
            }
            // 逐日明细（T02_DAILY=1）：停港的船队在哪、现金、货、粮水与当天的命令
            if daily {
                for (fid, loc) in &docked {
                    let f = session.world.fleet(*fid)?;
                    let cmds: Vec<String> = session.log()[first..]
                        .iter()
                        .map(|e| format!("{:?}", e.command).chars().take(60).collect())
                        .collect();
                    println!(
                        "    d{} {} 现金={} 货={:?} 粮={} 水={} 命令={}",
                        session.world.state.day,
                        defs.loc(*loc).key,
                        session.world.agent(p)?.cash,
                        f.cargo,
                        f.food,
                        f.water,
                        cmds.join(" | ")
                    );
                }
            }
            conserved &= session.world.money_conserved();
            // 商会：推进前的现金与各港累计投资（投资变化按当天是不是月初分成“跟投”与“每年一次的本据港投资”）
            let before_cash: BTreeMap<OwnerId, (i64, bool, i64)> = session
                .world
                .state
                .agents
                .values()
                .filter(|a| a.owner.company().is_some())
                .map(|a| (a.owner, (a.cash, a.bankrupt, invested(&session.world, a.owner))))
                .collect();
            session.advance_day()?;
            conserved &= session.world.money_conserved();
            let w = &session.world;
            // 跟投与分红都在推进的这一天（推进前的日子）里结算：内核先结算当天、最后才把日子加一
            let today = w.state.day;
            let ran = today - 1;
            for f in w.state.agency.fills.iter().filter(|f| f.day == ran && f.owner == p) {
                agency_fills += 1;
                agency_total += f.total;
            }
            let month_start = defs.calendar.month_start(ran);
            for (owner, (cash0, bankrupt0, inv0)) in &before_cash {
                if *bankrupt0 {
                    continue;
                }
                let a = w.agent(*owner)?;
                let c = comps.entry(*owner).or_default();
                let delta = invested(w, *owner) - inv0;
                if delta > 0 {
                    if month_start { c.follow += delta } else { c.annual += delta }
                }
                if month_start {
                    let share: i64 =
                        w.state.house.dividends.values().filter(|r| r.day == ran).map(|r| r.share_of(*owner)).sum();
                    c.dividends += share;
                }
                // 月报在月末那天结算，推进完就是下个月 1 日
                if defs.calendar.month_start(today)
                    && let Some(r) = a.ledger.monthly.last()
                {
                    c.monthly.push(r.income.net_income);
                }
                c.min_cash = c.min_cash.min(*cash0);
                if !bankrupt0 && a.bankrupt {
                    c.died = Some((today, *cash0, c.min_cash));
                }
                if *cash0 >= 0 {
                    c.min_cash = 0;
                }
            }
        }
        let w = &session.world;
        let a = w.agent(p)?;
        let fleets: Vec<_> = w.fleets_of(p).collect();
        let cap: i64 = fleets.iter().map(|f| f.capacity()).sum();
        println!(
            "\n== 第 {year} 年末 day={} bot 现金={} 净资产={} 买={buys} 卖={sells} 出航={departures} 停港不动(船队·天)={idle} 船队={} 舱位={cap} 守恒={conserved} 代办成交={agency_fills} 代办成交额={agency_total}",
            w.state.day,
            a.cash,
            stats::net_worth(w, p),
            fleets.len()
        );
        // K01：主角身上与技能相关的几项钩子（基点或原数）与发现物的数目
        {
            use manifest_core::captain::AttrHook::*;
            let h = |k| w.attr_hook(p, k);
            println!(
                "  K01 钩子 航速={} 炮击={} 议价={} 行情窗={} 登陆={} 发现={} 好感={} 秘术={} 已发现={}",
                h(FlagshipSpeed),
                h(NavalCombat),
                h(BargainDiscount),
                h(MarketWindow),
                h(Landing),
                h(Find),
                h(AffinityGain),
                h(SpellPower),
                w.state.explore.discovered.len()
            );
        }
        for f in &fleets {
            println!(
                "  船队 {:?} 在={} 船={} 货={} 粮={} 水={} 船员={}",
                f.id,
                f.docked_at().map_or("海上".to_string(), |l| defs.loc(l).key.clone()),
                f.ships.iter().map(|s| defs.ship(s.kind).key.as_str()).collect::<Vec<_>>().join("+"),
                f.cargo.values().sum::<i64>(),
                f.food,
                f.water,
                f.crew
            );
        }
        if let Some(r) = a.ledger.yearly.last() {
            let fmt =
                |v: &[(Account, Money)]| v.iter().map(|(k, m)| format!("{k:?}={m}")).collect::<Vec<_>>().join(" ");
            println!(
                "  损益 收入[{}] 费用[{}] 净利={}",
                fmt(&r.income.revenues),
                fmt(&r.income.expenses),
                r.income.net_income
            );
        }
        let mut top: Vec<_> = lanes.iter().collect();
        top.sort_by(|x, y| y.1.qty.cmp(&x.1.qty).then(x.0.cmp(y.0)));
        for ((g, from, to), l) in top.iter().take(6) {
            let margin = if l.buy_value > 0 { (l.sell_value - l.buy_value) * 100 / l.buy_value } else { 0 };
            println!(
                "  线 {} {}→{} 量={} 买价均={} 卖价均={} 毛差={}%",
                defs.good(*g).key,
                defs.loc(*from).key,
                defs.loc(*to).key,
                l.qty,
                l.buy_value / l.qty.max(1),
                l.sell_value / l.qty.max(1),
                margin
            );
        }
        if tracked.is_empty() {
            tracked = top.iter().take(3).map(|(k, _)| **k).collect();
        }
        for (g, from, to) in &tracked {
            let side = |loc: LocId| {
                let ls = &w.state.locations[loc.idx()];
                let comps: Vec<String> = w
                    .state
                    .agents
                    .values()
                    .filter(|c| c.owner.company().is_some() && !c.bankrupt)
                    .filter_map(|c| {
                        let lv = w.house_level(c.owner, loc);
                        let acc = w.buy_access(c.owner, loc);
                        (lv > 0).then(|| {
                            format!(
                                "{:?}:lv{} gw{} tax{} canG={}",
                                c.owner,
                                lv,
                                acc.goodwill,
                                w.house_tax(c.owner, loc).raw(),
                                acc.gate(&defs, *g).is_none()
                            )
                        })
                    })
                    .collect();
                let pacc = w.buy_access(p, loc);
                format!(
                    "{} 价={} 存={} 发展={} 投资合计={} 玩家gw={} 玩家能买={} 商会商馆[{}]",
                    defs.loc(loc).key,
                    w.market(loc, *g).map_or(0, |e| e.price),
                    w.market(loc, *g).map_or(0, |e| e.stock),
                    ls.development,
                    ls.investments.values().sum::<i64>(),
                    pacc.goodwill,
                    pacc.gate(&defs, *g).is_none(),
                    comps.join("; ")
                )
            };
            println!("  追踪 {} | {} | {}", defs.good(*g).key, side(*from), side(*to));
        }
        let comps: Vec<_> = w.state.agents.values().filter(|c| c.owner.company().is_some()).collect();
        let alive = comps.iter().filter(|c| !c.bankrupt).count();
        let cfleets: Vec<_> = w.state.fleets.values().filter(|f| f.owner.company().is_some()).collect();
        let ccap: i64 = cfleets.iter().map(|f| f.capacity()).sum();
        let inv: i64 = w
            .state
            .locations
            .iter()
            .flat_map(|l| l.investments.iter())
            .filter(|(o, _)| o.company().is_some())
            .map(|(_, v)| *v)
            .sum();
        let div: i64 = comps
            .iter()
            .filter_map(|c| c.ledger.yearly.last())
            .flat_map(|r| r.income.revenues.iter())
            .filter(|(k, _)| *k == Account::HouseDividends)
            .map(|(_, v)| *v)
            .sum();
        let houses: usize =
            comps.iter().map(|c| defs.port_ids().filter(|l| w.house_level(c.owner, *l) > 0).count()).sum();
        println!(
            "  商会 存活={alive}/{} 船队={} 舱位={ccap} 累计投资={inv} 当年分红={div} 设馆(商会·港)={houses} 货币总量={}",
            comps.len(),
            cfleets.len(),
            stats::money_supply(w)
        );
        lanes_by_year.push(lanes);
    }
    // 逐家商会：倒没倒、哪天倒、倒前一天的现金（缺口）与那一段负现金里最低的一天、累计跟投 / 每年投资 / 分红、倒前半年的月净利润
    for (owner, c) in &comps {
        let last6: Vec<String> = c.monthly.iter().rev().take(6).rev().map(|v| v.to_string()).collect();
        match c.died {
            Some((day, cash, min)) => println!(
                "商会 {owner:?} 倒闭 d{day} 前一日现金={cash} 负现金最低={min} 跟投={} 每年投资={} 分红={} 倒前6月净利=[{}]",
                c.follow,
                c.annual,
                c.dividends,
                last6.join(",")
            ),
            None if session.world.agent(*owner)?.bankrupt => println!("商会 {owner:?} 观测开始前已倒闭"),
            None => println!(
                "商会 {owner:?} 存活 现金={} 跟投={} 每年投资={} 分红={} 末6月净利=[{}]",
                session.world.agent(*owner)?.cash,
                c.follow,
                c.annual,
                c.dividends,
                last6.join(",")
            ),
        }
    }
    Ok(())
}
