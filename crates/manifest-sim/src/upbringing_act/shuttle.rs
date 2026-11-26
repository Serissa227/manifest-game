//! 只用玩家命令的连续往返探针；不调用套利替身、不查看对岸真实市场。
use super::*;
use crate::session::GameSession;
use manifest_core::{FleetId, GoodId, LocId, market::Side, world::FleetLocation};

#[derive(Serialize)]
pub struct ShuttleLeg {
    pub from: String,
    pub to: String,
    pub days: u32,
    pub gross: i64,
    pub good: Option<String>,
    pub qty: i64,
    pub expected_gross: Option<i64>,
}
#[derive(Serialize)]
pub struct ShuttleProbe {
    pub strategy: &'static str,
    pub band: String,
    pub path: Option<String>,
    pub seed: u64,
    pub route: String,
    pub days: u32,
    pub legs: Vec<ShuttleLeg>,
    pub unfinished_days: Option<u32>,
    pub first_five_mean: Option<f64>,
    pub last_five_mean: Option<f64>,
    pub costs: BTreeMap<String, i64>,
    pub gross: i64,
    pub opening_gross: i64,
    pub start: i64,
    pub minimum: i64,
    pub minimum_day: u32,
    pub end: i64,
    pub max_fatigue: i64,
    pub lost_day: Option<u32>,
    pub bankrupt: bool,
    pub reorganizations: u32,
    pub fleet_events: Vec<manifest_core::log::LogEvent>,
    pub failures: BTreeMap<String, u32>,
    pub commands: BTreeMap<String, u32>,
    pub curve: Vec<i64>,
}

struct Shuttle {
    fleet: FleetId,
    home: LocId,
    other: LocId,
    dest: LocId,
    departed: Option<u32>,
    gross_before: i64,
    cargo: Option<(String, i64, i64)>,
    legs: Vec<ShuttleLeg>,
    failures: BTreeMap<String, u32>,
    commands: BTreeMap<String, u32>,
}
fn gross(w: &World) -> i64 {
    let costs = opening::costs(w);
    costs["sales"] - costs["goods"]
}
impl Shuttle {
    fn submit(&mut self, session: &mut GameSession, key: &str, command: Command) -> bool {
        match session.submit(command) {
            Ok(_) => {
                *self.commands.entry(key.into()).or_default() += 1;
                true
            }
            Err(e) => {
                *self.failures.entry(format!("{key}:{}", e.code())).or_default() += 1;
                false
            }
        }
    }
    fn sail(&mut self, session: &mut GameSession) -> bool {
        self.submit(
            session,
            "autopilot",
            Command::Autopilot {
                owner: OwnerId::Player,
                fleet: self.fleet,
                dest: self.dest,
                minute: 0,
                stop_at_known_edge: false,
                route: None,
            },
        )
    }
    fn act(&mut self, session: &mut GameSession) -> Result<(), ReportError> {
        let w = &session.world;
        let fleet = w.fleet(self.fleet)?;
        let Some(here) = fleet.docked_at() else {
            if matches!(&fleet.location, FleetLocation::AtSea(manifest_core::world::Voyage::Manual { manual }) if manual.autopilot.is_none())
            {
                self.sail(session);
            }
            return Ok(());
        };
        let cargo: Vec<_> = fleet.cargo.iter().map(|(good, qty)| (*good, *qty)).collect();
        for (good, qty) in cargo {
            self.submit(
                session,
                "sell",
                Command::Sell { owner: OwnerId::Player, fleet: self.fleet, good, qty, min_total: None },
            );
        }
        if let Some(departed) = self.departed.take() {
            let (good, qty, expected_gross) =
                self.cargo.take().map_or((None, 0, None), |(g, q, p)| (Some(g), q, Some(p)));
            self.legs.push(ShuttleLeg {
                from: session.world.defs.loc(if here == self.home { self.other } else { self.home }).key.clone(),
                to: session.world.defs.loc(here).key.clone(),
                days: session.day() - departed,
                gross: gross(&session.world) - self.gross_before,
                good,
                qty,
                expected_gross,
            });
        }
        self.dest = if here == self.home { self.other } else { self.home };
        let w = &session.world;
        let fleet = w.fleet(self.fleet)?;
        let route =
            w.planned_sea_path(fleet, fleet.cell(&w.defs), self.dest, false, w.resolve_route_pref(fleet, None)?)?;
        let days = w.navigation_path_days(self.fleet, &route.path);
        // 按界面的预计日数备下一程，多留一天处理日结边界；不另加休港日。
        let needed = fleet.supplies_needed(&w.defs, days + 1);
        let food = (needed - fleet.food).max(0);
        let water = (needed - fleet.water).max(0);
        if food + water > 0
            && !self.submit(
                session,
                "resupply",
                Command::Resupply { owner: OwnerId::Player, fleet: self.fleet, food, water },
            )
        {
            return Ok(());
        }
        let reserve = session.world.fleet(self.fleet)?.crew * session.world.defs.rules.crew_wage * (days + 1);
        // 先备粮水、留下下一程工资，再用余款修船；修船本身不推进日期。
        let repair = session.world.repair_cost(session.world.fleet(self.fleet)?);
        if repair > 0 && session.world.agent(OwnerId::Player)?.cash - repair >= reserve {
            self.submit(session, "repair", Command::Repair { owner: OwnerId::Player, fleet: self.fleet });
        }
        if let Some((good, qty, gain)) = self.batch(&session.world, here, reserve) {
            let key = session.world.defs.good(good).key.clone();
            if self.submit(
                session,
                "buy",
                Command::Buy { owner: OwnerId::Player, fleet: self.fleet, good, qty, max_total: None },
            ) {
                self.cargo = Some((key, qty, gain));
            }
        } else {
            *self.failures.entry("buy:no_profitable_known_batch".into()).or_default() += 1;
        }
        self.gross_before = gross(&session.world);
        if self.sail(session) {
            self.departed = Some(session.day());
        }
        Ok(())
    }
    fn batch(&self, w: &World, here: LocId, reserve: i64) -> Option<(GoodId, i64, i64)> {
        let fleet = w.fleet(self.fleet).ok()?;
        let budget = (w.agent(OwnerId::Player).ok()?.cash - reserve).max(0);
        let sight = w.sight(OwnerId::Player);
        let mut batches = Vec::new();
        for (&good, entry) in &w.state.locations[here.idx()].market {
            let Some(there) = sight.market(self.dest, good) else { continue };
            for qty in 1..=fleet.free_capacity().min(entry.stock) {
                let Ok(quote) = manifest_core::market::quote(w, OwnerId::Player, here, good, Side::Buy, qty) else {
                    continue;
                };
                let gain = there.price * qty - quote.total;
                let command = Command::Buy { owner: OwnerId::Player, fleet: self.fleet, good, qty, max_total: None };
                if gain > 0 && quote.total <= budget && command.validate(w).is_ok() {
                    batches.push((good, qty, gain));
                }
            }
        }
        batches.into_iter().max_by_key(|(good, qty, gain)| (*gain, std::cmp::Reverse(good.0), *qty))
    }
}

pub(super) fn run(w: World, family: &str, seed: u64, port: &str) -> Result<ShuttleProbe, ReportError> {
    eprintln!("upbringing-act-report: shuttle band={} route={port} seed={seed}", w.act_capital_preview().band);
    let w = graduate(w)?;
    let band = w.act_capital_preview().band;
    let path = w.act_capital_preview().aspiration;
    let defs = w.defs.clone();
    let error = |e: crate::SimError| ReportError::Run { strategy: "shuttle", seed, detail: e.to_string() };
    let mut session = GameSession::from_save(defs, graduation_save(w, family, seed)?).map_err(error)?;
    let home = session.world.state.agents[&OwnerId::Player].home;
    let other = session.world.defs.find_loc(port).ok_or(ReportError::Unavailable("shuttle_port"))?;
    let fleet = session.world.flagship(OwnerId::Player).ok_or(ReportError::Unavailable("shuttle_fleet"))?;
    let before = opening::costs(&session.world);
    let start_day = session.day();
    let mut lost_at = None;
    let mut fleet_events = Vec::new();
    let mut curve = vec![crate::stats::net_worth(&session.world, OwnerId::Player)];
    let mut shuttle = Shuttle {
        fleet,
        home,
        other,
        dest: other,
        departed: None,
        gross_before: 0,
        cargo: None,
        legs: Vec::new(),
        failures: BTreeMap::new(),
        commands: BTreeMap::new(),
    };
    shuttle.submit(&mut session, "borrow", Command::Borrow { owner: OwnerId::Player, amount: 1500, months: 24 });
    let f = session.world.fleet(fleet)?;
    let count = f.crew - f.crew_min(&session.world.defs);
    if count > 0 {
        shuttle.submit(&mut session, "dismiss_crew", Command::DismissCrew { owner: OwnerId::Player, fleet, count });
    }
    let mut max_fatigue = session.world.fleet_wear(fleet).fatigue;
    let mut answered = 0;
    for _ in 0..120 {
        while !session.world.state.story2.pending.is_empty() || session.world.state.story.pending.is_some() {
            let command = policy::answer_story(&session.world, Strategy::Idle, answered)
                .ok_or(ReportError::Unavailable("shuttle_story"))?;
            shuttle.submit(&mut session, "story_answer", command);
            answered += 1;
        }
        if lost_at.is_none() {
            shuttle.act(&mut session)?;
        }
        session.advance_day().map_err(error)?;
        // 世界日志有长度上限；逐日收下本探针相关的既有事件，避免早期失舰原因被后续世界事件挤掉。
        for event in session.world.state.log.iter().filter(|event| event.day + 1 >= session.day()) {
            use manifest_core::log::LogKind;
            let related = match &event.kind {
                LogKind::Storm { fleet: id, .. }
                | LogKind::Disease { fleet: id, .. }
                | LogKind::Starvation { fleet: id, .. }
                | LogKind::Mutiny { fleet: id, .. }
                | LogKind::ShipSunk { fleet: id, .. }
                | LogKind::FleetLost { fleet: id, .. }
                | LogKind::VoyageWear { fleet: id, .. } => *id == fleet,
                LogKind::Bankrupt { owner } | LogKind::Reorganized { owner } => *owner == OwnerId::Player,
                _ => false,
            };
            if related && !fleet_events.contains(event) {
                fleet_events.push(event.clone());
            }
        }
        if !session.world.state.fleets.contains_key(&fleet) {
            lost_at.get_or_insert(session.day());
        }
        max_fatigue = max_fatigue.max(session.world.fleet_wear(fleet).fatigue);
        curve.push(crate::stats::net_worth(&session.world, OwnerId::Player));
    }
    // 第120天刚抵港的货也结算；不买下一批、不再出发。
    if let Some(here) = session.world.state.fleets.get(&fleet).and_then(|f| f.docked_at()) {
        let cargo: Vec<_> = session.world.fleet(fleet)?.cargo.iter().map(|(g, q)| (*g, *q)).collect();
        for (good, qty) in cargo {
            shuttle.submit(
                &mut session,
                "sell",
                Command::Sell { owner: OwnerId::Player, fleet, good, qty, min_total: None },
            );
        }
        if let Some(departed) = shuttle.departed.take() {
            let (good, qty, expected_gross) =
                shuttle.cargo.take().map_or((None, 0, None), |(g, q, p)| (Some(g), q, Some(p)));
            shuttle.legs.push(ShuttleLeg {
                from: session.world.defs.loc(if here == home { other } else { home }).key.clone(),
                to: session.world.defs.loc(here).key.clone(),
                days: session.day() - departed,
                gross: gross(&session.world) - shuttle.gross_before,
                good,
                qty,
                expected_gross,
            });
        }
        curve[120] = crate::stats::net_worth(&session.world, OwnerId::Player);
    }
    let costs: BTreeMap<_, _> = opening::costs(&session.world)
        .into_iter()
        .map(|(k, v)| {
            let delta = v - before.get(&k).copied().unwrap_or(0);
            (k, delta)
        })
        .collect();
    let total_gross = costs["sales"] - costs["goods"];
    let opening_gross = total_gross - shuttle.legs.iter().map(|l| l.gross).sum::<i64>();
    let mean = |legs: &[ShuttleLeg]| {
        (!legs.is_empty()).then(|| legs.iter().map(|l| l.gross).sum::<i64>() as f64 / legs.len() as f64)
    };
    let first_five_mean = mean(&shuttle.legs[..shuttle.legs.len().min(5)]);
    let last_five_mean = mean(&shuttle.legs[shuttle.legs.len().saturating_sub(5)..]);
    let (minimum_day, minimum) =
        curve.iter().copied().enumerate().min_by_key(|(_, v)| *v).ok_or(ReportError::Unavailable("shuttle_curve"))?;
    Ok(ShuttleProbe {
        strategy: "shuttle",
        band,
        path,
        seed,
        route: format!("shimoda_tosa:{port}"),
        days: 120,
        first_five_mean,
        last_five_mean,
        unfinished_days: shuttle.departed.map(|d| lost_at.unwrap_or(session.day()) - d),
        legs: shuttle.legs,
        costs,
        gross: total_gross,
        opening_gross,
        start: curve[0],
        minimum,
        minimum_day: minimum_day as u32,
        end: curve[120],
        max_fatigue,
        lost_day: lost_at.map(|d| d - start_day),
        bankrupt: session.world.state.agents[&OwnerId::Player].bankrupt,
        reorganizations: session.world.state.agents[&OwnerId::Player].reorganizations,
        fleet_events,
        failures: shuttle.failures,
        commands: shuttle.commands,
        curve,
    })
}
