//! 丁档探针：培养与志向选择、借款、卖货和邻港起步全部提交玩家命令。
use super::*;
use crate::session::GameSession;
use manifest_core::{FleetId, GoodId, LocId, ledger::Account, market::Side, world::FleetLocation};

pub(super) fn plan_floor(w: &mut World, path: Option<&str>) -> Result<(), ReportError> {
    // 隐藏志向先要在两年九月读到异兆；只练够公开剧情的和歌门槛。
    let poetry = if path == Some("mio_path_4") {
        match w.cast_date()[0] {
            1553 | 1554 => 120,
            _ => 0,
        }
    } else {
        0
    };
    if w.upbringing_skill_xp("poetry") < poetry
        && let Some((line, tier)) = w
            .defs
            .upbringing
            .lines
            .iter()
            .filter(|line| w.act_line_here(line) && line.skill.as_deref() == Some("poetry"))
            .flat_map(|line| (0..=1).map(move |tier| (line, tier)))
            .filter(|(line, tier)| {
                w.act_tier_open(line, *tier)
                    && w.act_tier_fee(line, *tier) * w.act_lesson_days().len() as i64 <= w.act_cash()
            })
            .max_by_key(|(_, tier)| *tier)
    {
        let slots = vec![LessonPlan { line: line.key.clone(), tier, with: None }; w.act_lesson_days().len()];
        Command::PlanLessons { owner: OwnerId::Player, slots }.apply(w)?;
        Command::StartWeek { owner: OwnerId::Player }.apply(w)?;
        return Ok(());
    }
    let target = path.and_then(|key| w.defs.upbringing.paths.iter().find(|p| p.key == key));
    let target = target.filter(|p| {
        p.requirements
            .attr
            .as_deref()
            .is_some_and(|attr| w.upbringing_projected(attr) < p.requirements.min.unwrap_or(0))
            || p.requirements.rating.as_ref().is_some_and(|rating| match rating {
                RatingRequirement::Threshold(r) => w.upbringing_rating(&r.key) < r.min,
                RatingRequirement::Key(key) => w.upbringing_rating(key) < p.requirements.min.unwrap_or(0),
            })
    });
    let line = target.and_then(|p| {
        let rating =
            p.requirements.rating.as_ref().and_then(|r| w.defs.captain.ratings.iter().find(|v| v.key == r.key()));
        w.defs
            .upbringing
            .lines
            .iter()
            .filter(|l| w.act_line_here(l) && w.act_tier_open(l, 0))
            .filter(|l| w.act_tier_fee(l, 0) * w.act_lesson_days().len() as i64 <= w.act_cash())
            .filter(|l| w.defs.upbringing.activity(&l.tiers[0].activity).is_some_and(|a| a.monthly_limit.is_none()))
            .filter_map(|line| {
                let attr = line.attr.as_deref()?;
                let weight = if p.requirements.attr.as_deref() == Some(attr) {
                    100
                } else {
                    let i = w.defs.captain.attribute_index(attr)?;
                    rating?.weights.iter().find(|(attr, _)| *attr == i).map_or(0, |(_, weight)| *weight)
                };
                if weight == 0 {
                    return None;
                }
                let next =
                    w.defs.upbringing.rules.growth_table.iter().find(|b| b.value > w.upbringing_projected(attr))?;
                Some((weight * 1000 / (next.from - w.upbringing_growth(attr)).max(1), line))
            })
            .max_by_key(|(priority, _)| *priority)
            .map(|(_, line)| line)
    });
    let Some(line) = line else { return policy::floor_week(w).map(|_| ()) };
    let slots = vec![LessonPlan { line: line.key.clone(), tier: 0, with: None }; w.act_lesson_days().len()];
    Command::PlanLessons { owner: OwnerId::Player, slots }.apply(w)?;
    Command::StartWeek { owner: OwnerId::Player }.apply(w)?;
    Ok(())
}

pub(super) fn costs(w: &World) -> BTreeMap<String, i64> {
    let ledger = &w.state.agents[&OwnerId::Player].ledger;
    [
        ("wages", Account::Wages),
        ("supplies", Account::Supplies),
        ("repairs", Account::Repairs),
        ("interest", Account::InterestExpense),
        ("sales", Account::Sales),
        ("goods", Account::CostOfGoods),
    ]
    .into_iter()
    .map(|(key, account)| {
        let value = ledger.balance(account);
        (key.into(), if account == Account::Sales { -value } else { value })
    })
    .collect()
}

pub(super) struct Opening {
    fleet: FleetId,
    home: LocId,
    nearby: LocId,
    dest: LocId,
    arrivals: u8,
    pub failures: BTreeMap<String, u32>,
}

impl Opening {
    pub fn new(session: &mut GameSession) -> Result<Self, ReportError> {
        let home = session.world.state.agents[&OwnerId::Player].home;
        let fleet = session
            .world
            .fleets_of(OwnerId::Player)
            .find(|f| f.docked_at() == Some(home))
            .ok_or(ReportError::Unavailable("opening_fleet"))?
            .id;
        let nearby = session.world.defs.find_loc("shimizu_tosa").ok_or(ReportError::Unavailable("opening_port"))?;
        let mut opening = Self { fleet, home, nearby, dest: nearby, arrivals: 0, failures: BTreeMap::new() };
        opening.submit(session, "borrow", Command::Borrow { owner: OwnerId::Player, amount: 1500, months: 24 });
        Ok(opening)
    }

    fn submit(&mut self, session: &mut GameSession, step: &str, command: Command) -> bool {
        match session.submit(command) {
            Ok(_) => true,
            Err(error) => {
                *self.failures.entry(format!("{step}:{}", error.code())).or_default() += 1;
                false
            }
        }
    }

    /// 三次邻港航行后交还套利替身；只用当前港报价和玩家已知的远港行情挑货。
    pub fn act(&mut self, session: &mut GameSession) -> Result<bool, ReportError> {
        if self.arrivals >= 3 {
            return Ok(false);
        }
        let fleet = session.world.fleet(self.fleet)?;
        let Some(here) = fleet.docked_at() else {
            if matches!(&fleet.location, FleetLocation::AtSea(manifest_core::world::Voyage::Manual { manual }) if manual.autopilot.is_none())
            {
                let command = self.sail_command(&session.world);
                self.submit(session, "resume", command);
            }
            return Ok(true);
        };
        if here == self.dest {
            self.arrivals += 1;
            self.dest = if here == self.home { self.nearby } else { self.home };
        }
        let cargo: Vec<_> = fleet.cargo.iter().map(|(g, q)| (*g, *q)).collect();
        for (good, qty) in cargo {
            self.submit(
                session,
                "sell",
                Command::Sell { owner: OwnerId::Player, fleet: self.fleet, good, qty, min_total: None },
            );
        }
        if self.arrivals >= 3 {
            return Ok(false);
        }
        let fleet = session.world.fleet(self.fleet)?;
        let days = session.world.estimate_days(fleet, self.dest).unwrap_or(1).max(1);
        let needed = fleet.supplies_needed(&session.world.defs, days + 2);
        let food = (needed - fleet.food).max(0);
        let water = (needed - fleet.water).max(0);
        if food + water > 0 {
            self.submit(
                session,
                "resupply",
                Command::Resupply { owner: OwnerId::Player, fleet: self.fleet, food, water },
            );
        }
        let reserve = session.world.fleet(self.fleet)?.crew * session.world.defs.rules.crew_wage * (days + 1);
        if let Some((good, qty)) = self.batch(&session.world, here, reserve) {
            self.submit(
                session,
                "buy",
                Command::Buy { owner: OwnerId::Player, fleet: self.fleet, good, qty, max_total: None },
            );
        } else {
            *self.failures.entry("buy:no_affordable_batch".into()).or_default() += 1;
        }
        let command = self.sail_command(&session.world);
        if !self.submit(session, "depart", command) {
            // 真实开航失败保留原因，余下时间让既有替身继续尝试，不改规则或世界状态。
            self.arrivals = 3;
            return Ok(false);
        }
        Ok(true)
    }

    fn batch(&self, world: &World, here: LocId, reserve: i64) -> Option<(GoodId, i64)> {
        let fleet = world.fleet(self.fleet).ok()?;
        let budget = (world.agent(OwnerId::Player).ok()?.cash - reserve).max(0);
        let sight = world.sight(OwnerId::Player);
        world.state.locations[here.idx()]
            .market
            .iter()
            .filter_map(|(&good, entry)| {
                let there = sight.market(self.dest, good);
                for qty in (1..=fleet.free_capacity().min(entry.stock)).rev() {
                    let command =
                        Command::Buy { owner: OwnerId::Player, fleet: self.fleet, good, qty, max_total: None };
                    if let Ok(quote) = manifest_core::market::quote(world, OwnerId::Player, here, good, Side::Buy, qty)
                        && quote.total <= budget
                        && command.validate(world).is_ok()
                    {
                        return Some((there.map(|k| k.price * qty - quote.total), quote.total / qty, good, qty));
                    }
                }
                None
            })
            .max_by_key(|(gain, price, good, _)| (*gain, std::cmp::Reverse(*price), std::cmp::Reverse(good.0)))
            .map(|(_, _, good, qty)| (good, qty))
    }

    fn sail_command(&self, world: &World) -> Command {
        if world.defs.manual_navigation {
            Command::Autopilot {
                owner: OwnerId::Player,
                fleet: self.fleet,
                dest: self.dest,
                minute: 0,
                stop_at_known_edge: false,
                route: None,
            }
        } else {
            Command::SetSail { owner: OwnerId::Player, fleet: self.fleet, dest: self.dest }
        }
    }
}
