//! 示范机器人只提交生产命令；资源准备、交通与费用也进入同一重放日志。
use manifest_core::{
    history::{LeverKind, Payload},
    ideas::Mode,
    replay::{LogEntry, Source},
    scenario::WorldDate,
    *,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Policy {
    Historical,
    Multi,
    Arms,
    Negotiation,
    Intel,
    Mission,
    Print,
    Court,
}
pub struct Report {
    pub world: World,
    pub log: Vec<LogEntry>,
    pub days: u32,
}
fn attempt(w: &mut World, log: &mut Vec<LogEntry>, command: Command) -> bool {
    let tick = w.day();
    if command.apply(w).is_err() {
        return false;
    }
    log.push(LogEntry { tick, seq: log.len() as u64, source: Source::Player, command, minute: None });
    true
}
fn buy_item(w: &mut World, log: &mut Vec<LogEntry>, loc: LocId, item: &str) {
    if w.item_available(OwnerId::Player, item) == 0 {
        attempt(w, log, Command::BuyItem { owner: OwnerId::Player, loc, item: item.into(), qty: 1, max_total: None });
    }
}
fn audience(w: &mut World, log: &mut Vec<LogEntry>, person: &str) {
    if !w.history_audience_today(OwnerId::Player, person) {
        attempt(w, log, Command::RequestAudience { owner: OwnerId::Player, person: person.into() });
    }
}
fn move_to(w: &mut World, log: &mut Vec<LogEntry>, fleet: FleetId, dest: LocId) {
    if w.fleet(fleet).is_ok_and(|f| f.docked_at().is_some_and(|at| at != dest)) {
        attempt(w, log, Command::Resupply { owner: OwnerId::Player, fleet, food: 10, water: 10 });
        attempt(w, log, Command::SetSail { owner: OwnerId::Player, fleet, dest });
    }
}
fn day(w: &mut World, log: &mut Vec<LogEntry>, policy: Policy) {
    if policy == Policy::Historical {
        return;
    }
    let owner = OwnerId::Player;
    let Some(fleet) = w.flagship(owner) else { return };
    let Some(loc) = w.fleet(fleet).ok().and_then(|f| f.docked_at()) else { return };
    let defs = w.defs.clone();
    if w.fleet(fleet).is_ok_and(|f| f.ships.iter().any(|s| s.durability < s.max_durability / 2)) {
        attempt(w, log, Command::Repair { owner, fleet });
    }
    for (id, m) in defs.mates.iter().enumerate().filter(|(_, m)| m.home == loc) {
        let id = MateId::from_idx(id);
        if w.state.mates.get(&id).is_some_and(|s| s.owner.is_none()) && !m.hidden {
            attempt(w, log, Command::HireMate { owner, mate: id });
        }
    }
    if let Some(p) = defs.ideas.port(&defs.loc(loc).key) {
        for m in &p.modes {
            if !matches!(
                (policy, m.mode),
                (Policy::Multi, _)
                    | (Policy::Mission, Mode::Mission)
                    | (Policy::Print, Mode::Print)
                    | (Policy::Court, Mode::Court)
            ) {
                continue;
            }
            if let Some(book) = &m.book {
                buy_item(w, log, loc, book)
            }
            if m.mode == Mode::Court
                && let Some(person) = &m.person
            {
                audience(w, log, person)
            }
            for item in m.items.keys() {
                buy_item(w, log, loc, item)
            }
            for (good, qty) in &m.goods {
                if let Some(good) = defs.find_good(good)
                    && w.holder_qty(owner, warehouse::Holder::Fleet(fleet), good) < *qty
                {
                    attempt(w, log, Command::Buy { owner, fleet, good, qty: *qty, max_total: None });
                }
            }
            attempt(w, log, Command::Propagate { owner, idea: m.idea.clone(), loc, mode: m.mode });
        }
    }
    for e in &defs.history.events {
        if !e.window.is_some_and(|r| r[0] <= w.cast_date() && w.cast_date() <= r[1])
            || w.history_outcome(&e.key).is_some()
        {
            continue;
        }
        for l in &e.levers {
            if !matches!(
                (policy, l.kind),
                (Policy::Multi, _)
                    | (Policy::Arms, LeverKind::Arms)
                    | (Policy::Negotiation, LeverKind::Negotiate)
                    | (Policy::Intel, LeverKind::Intel)
            ) || l.kind == LeverKind::Propagate
            {
                continue;
            }
            if w.history_lever_base_points(&e.key, &l.key) >= l.max_points {
                continue;
            }
            let Some(port) = l.port.as_ref().and_then(|k| defs.find_loc(k)) else { continue };
            let payload = match l.kind {
                LeverKind::Deliver | LeverKind::Arms | LeverKind::Relief => {
                    if loc != port {
                        continue;
                    }
                    let Some(good) = l.goods.first().and_then(|g| defs.find_good(g)) else { continue };
                    let qty = (l.value_per_point * l.max_points / defs.good(good).base_price.max(1) + 1).clamp(1, 10);
                    let have = w.holder_qty(owner, warehouse::Holder::Fleet(fleet), good);
                    if have < qty {
                        attempt(w, log, Command::Buy { owner, fleet, good, qty: qty - have, max_total: None });
                    }
                    Payload::Deliver { fleet, goods: vec![(good, qty)], donate: true }
                }
                LeverKind::Money => Payload::Money { amount: l.max_points * l.value_per_point },
                LeverKind::Negotiate => {
                    if let Some(person) = &l.with {
                        audience(w, log, person)
                    }
                    let Some(term) = l.terms.first() else { continue };
                    Payload::Negotiate { term: term.clone() }
                }
                LeverKind::Intel => {
                    let prior = w.state.history.events.get(&e.key).and_then(|s| s.contributions.get(&l.key));
                    if prior.is_some_and(|c| c.diplomacy.contains_key(&owner)) {
                        continue;
                    }
                    let taken = prior.and_then(|c| c.shipments.get(&owner)).is_some();
                    if !taken && let Some(item) = &l.item {
                        buy_item(w, log, loc, item)
                    }
                    if taken && loc != port {
                        move_to(w, log, fleet, port);
                        continue;
                    }
                    Payload::Commit {}
                }
                LeverKind::Bribe => {
                    if let Some(person) = &l.with {
                        audience(w, log, person)
                    }
                    Payload::Commit {}
                }
                _ => Payload::Commit {},
            };
            attempt(w, log, Command::Contribute { owner, event: e.key.clone(), lever: l.key.clone(), payload });
        }
    }
    if let Ok(agent) = w.agent(owner)
        && loc != agent.home
    {
        let unfinished_letter =
            defs.history.events.iter().flat_map(|e| e.levers.iter().map(move |l| (e, l))).any(|(e, l)| {
                l.kind == LeverKind::Intel
                    && w.state
                        .history
                        .events
                        .get(&e.key)
                        .and_then(|s| s.contributions.get(&l.key))
                        .is_some_and(|c| c.shipments.contains_key(&owner) && !c.diplomacy.contains_key(&owner))
            });
        if !unfinished_letter {
            let home = agent.home;
            move_to(w, log, fleet, home);
        }
    }
}
pub fn run(mut world: World, until: WorldDate, policy: Policy) -> Result<Report, CoreError> {
    let end = scenario::day_of(&world.defs, until)?;
    if end < world.day() {
        return Err(scenario::invalid("示范机器人终点早于起点"));
    }
    let days = end - world.day();
    let mut log = Vec::new();
    while world.day() < end {
        day(&mut world, &mut log, policy);
        world.end_day()?;
    }
    Ok(Report { world, log, days })
}
