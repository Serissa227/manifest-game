//! P07：轻量日结冻结经济，保留历史、月程与同一条保存／重放时间轴。
use manifest_core::{
    Command, CompanyId, CoreError, OwnerId, ScenarioId, StaticData, World,
    replay::{LogEntry, Source, StartParams, replay},
    testkit,
    upbringing::{AfterChoice, PlanSlot},
};
use serde_json::json;
use std::sync::Arc;

fn defs(light: bool) -> Arc<StaticData> {
    let mut d = (*testkit::tiny_defs()).clone();
    d.rules.upbringing.light_world = light;
    d.scenarios[0].upbringing = true;
    let at = d.locations[0].key.clone();
    d.upbringing = serde_json::from_value(json!({
        "families":[{"key":"family","name":"测试","scenario":"test","home":at,
            "born":[1489,6,1],"gender":"f","graduation":[1506,1,1],
            "stages":[{"from":[1502,1,1],"stage":"home","name":"测试","at":at}]}],
        "activities":[{"key":"rest","name":"测试","kind":"rest"}]
    }))
    .unwrap();
    Arc::new(d)
}

fn skip(w: &mut World) {
    Command::SkipUpbringing { owner: OwnerId::Player }.apply(w).unwrap();
}

#[test]
fn light_days_leave_every_economic_subsystem_idle() {
    let mut w = World::new(defs(true), ScenarioId(0), 42).unwrap();
    skip(&mut w);
    let before = w.state.clone();
    let money = w.all_money();
    for _ in 0..90 {
        w.end_day().unwrap();
        testkit::check_invariants(&w).unwrap();
        assert_eq!(w.all_money(), money);
    }
    assert_eq!(w.day(), 90);
    assert_eq!(w.state.locations, before.locations, "产销、调价、人口、工坊、投资和行情板均未日结");
    assert_eq!(w.state.fleets, before.fleets, "没有 NPC 决策、航行、补给或扩张");
    assert_eq!(w.state.caravans, before.caravans);
    assert_eq!(w.state.industries, before.industries);
    assert_eq!(w.state.colonies, before.colonies);
    assert_eq!(w.state.contracts, before.contracts);
    assert_eq!(w.state.loans, before.loans);
    assert_eq!(w.state.futures, before.futures);
    assert_eq!(w.state.circulation, before.circulation);
    assert_eq!(w.state.battles, before.battles);
    assert_eq!(w.state.money, before.money, "没有工资、租金、利息、财政或造钱");
    for (owner, agent) in &w.state.agents {
        assert_eq!(agent.cash, before.agents[owner].cash);
        assert_eq!(agent.ledger.balances, before.agents[owner].ledger.balances);
        assert_eq!(agent.ledger.monthly.len(), 3, "空月份也按日期结转，不混入结业后报表");
    }
}

#[test]
fn disabled_rule_keeps_the_full_economy_and_no_new_snapshot_fields() {
    assert!(!testkit::tiny_defs().rules.upbringing.light_world);
    assert!(!serde_json::from_value::<manifest_core::defs::UpbringingWorldRules>(json!({})).unwrap().light_world);
    assert!(serde_json::from_value::<manifest_core::defs::UpbringingWorldRules>(json!({"typo":true})).is_err());
    let d = defs(false);
    let mut w = World::new(d.clone(), ScenarioId(0), 42).unwrap();
    skip(&mut w);
    let before = w.state.clone();
    for _ in 0..30 {
        w.end_day().unwrap();
    }
    assert_ne!(w.state.locations, before.locations);
    assert_ne!(w.state.fleets, before.fleets);
    assert_ne!(
        w.agent(OwnerId::Company(CompanyId(0))).unwrap().cash,
        before.agents[&OwnerId::Company(CompanyId(0))].cash
    );
    let bytes = serde_json::to_vec(&w.state).unwrap();
    let restored = World::from_snapshot(d, serde_json::from_slice(&bytes).unwrap()).unwrap();
    assert_eq!(serde_json::to_vec(&restored.state).unwrap(), bytes);
    assert!(!String::from_utf8(bytes).unwrap().contains("light_world"));
}

#[test]
fn light_month_keeps_slots_pause_boundaries_and_replay() {
    let d = defs(true);
    let mut w = World::new(d.clone(), ScenarioId(0), 7).unwrap();
    let before = w.state.clone();
    assert!(matches!(w.end_day(), Err(CoreError::UpbringingPaused)));
    assert_eq!(w.state, before);
    let command = Command::PlanMonth {
        owner: OwnerId::Player,
        slots: (0..3)
            .map(|index| PlanSlot { index, lesson: None, after: Some(AfterChoice::activity("rest")) })
            .collect(),
    };
    command.apply(&mut w).unwrap();
    for i in 0..30 {
        let r = w.end_day().unwrap();
        assert_eq!(r.day, i);
        assert_eq!(r.month_end, i == 29);
        assert!(r.arrivals.is_empty());
        if i == 14 {
            w = World::from_snapshot(d.clone(), w.state).unwrap();
        }
    }
    assert!(w.upbringing_waiting());
    assert_eq!(w.state.upbringing.as_ref().unwrap().settled.len(), 3);
    let log = [LogEntry { tick: 0, seq: 0, source: Source::Player, command, minute: None }];
    assert_eq!(w.state, replay(d, StartParams::new(ScenarioId(0), 7), &log, w.day()).unwrap().state);
}

#[test]
fn historical_results_and_diplomacy_match_full_daily_settlement() {
    let mut full = defs(false);
    let data = Arc::make_mut(&mut full);
    data.history = serde_json::from_value(json!({"events":[{
        "key":"transfer","title":"测试历史","date":[1502,2,1],
        "history":{"date":[1502,2,1],"outcome":"changed"},
        "sides":[{"key":"a","name":"测试","faction":"crown"},{"key":"b","name":"测试","faction":"league"}],
        "outcomes":[{"key":"changed","when":">= 0","default":true,
            "effects":[{"kind":"flag","flag":"historic_change"},{"kind":"port_owner","port":"alpha","faction":"league"}]}]
    }]})).unwrap();
    data.history.order = vec![0];
    let mut light = full.clone();
    Arc::make_mut(&mut light).rules.upbringing.light_world = true;
    let mut a = World::new(full, ScenarioId(0), 42).unwrap();
    let mut b = World::new(light, ScenarioId(0), 42).unwrap();
    skip(&mut a);
    skip(&mut b);
    for _ in 0..90 {
        a.end_day().unwrap();
        b.end_day().unwrap();
        assert_eq!(a.state.history.chronicle, b.state.history.chronicle);
        assert_eq!(a.state.history.ports, b.state.history.ports);
        assert_eq!(a.state.relations, b.state.relations);
    }
    assert_eq!(b.state.history.chronicle.len(), 1);
    assert!(b.state.story2.flags.contains("historic_change"));
}

fn short_course(day: u32) -> Arc<StaticData> {
    let mut d = defs(true);
    let data = Arc::make_mut(&mut d);
    data.rules.money.enabled = true;
    // 结业会留下人物／故事旗标；夹具也须具备这两个模块，避免读档按“移除模块”清空它们。
    data.cast = serde_json::from_value(json!({"persons":[{
        "key":"teacher","name":"测试","kind":"story","gender":"f","born":[1480,1,1]
    }]}))
    .unwrap();
    data.story2 = serde_json::from_value(json!({"tracks":[{
        "key":"waiting","name":"测试","kind":"main","start":"start","auto":false,
        "chapters":[{"key":"start","title":"测试","text":"测试"}]
    }]}))
    .unwrap();
    data.upbringing.families[0].graduation = [1502, 1, day];
    data.upbringing.families[0].completion = Some(serde_json::from_value(json!({"capital":{"cash":100}})).unwrap());
    d
}

#[test]
fn graduation_uses_live_supply_demand_embargo_and_war_without_spending_a_day() {
    use manifest_core::{EventTypeId, FactionId, Fx, GoodId, LocId, defs::EffectKind, events::EventParams};
    let mut d = short_course(21);
    let data = Arc::make_mut(&mut d);
    data.locations[0].development = 50;
    data.goods[0].season_supply = [Fx::ONE; 4];
    data.goods[0].season_demand = [Fx::ONE; 4];
    data.rules.diplomacy.incident_bp = 0;
    data.rules.diplomacy.war_min_days = 10000;
    let mut ban = data.events[0].clone();
    ban.key = "test_ban".into();
    ban.effect = EffectKind::ExportBan;
    ban.mult = None;
    data.events.push(ban);
    let mut w = World::new(d.clone(), ScenarioId(0), 42).unwrap();
    skip(&mut w);
    w.state.relations[0].status = manifest_core::diplomacy::DiploStatus::War;
    w.state.relations[0].value = -100;
    Command::ApplyEvent {
        event: EventTypeId(0),
        params: EventParams {
            good: Some(GoodId(0)),
            mult: Some(Fx::from_pct(150)),
            days: Some(60),
            ..Default::default()
        },
    }
    .apply(&mut w)
    .unwrap();
    Command::ApplyEvent {
        event: EventTypeId(4),
        params: EventParams {
            loc: Some(LocId(0)),
            mult: Some(Fx::from_pct(125)),
            days: Some(30),
            ..Default::default()
        },
    }
    .apply(&mut w)
    .unwrap();
    w.end_day().unwrap();
    Command::ApplyEvent {
        event: EventTypeId(5),
        params: EventParams {
            good: Some(GoodId(0)),
            faction_a: Some(FactionId(0)),
            days: Some(60),
            ..Default::default()
        },
    }
    .apply(&mut w)
    .unwrap();
    let money = w.all_money();
    while w.upbringing_active() {
        w.end_day().unwrap();
    }
    assert_eq!(w.day(), 20);
    assert_eq!(w.all_money(), money);
    let entry = &w.state.locations[0].market[&GoodId(0)];
    assert_eq!(entry.target, 600);
    assert_eq!(entry.stock, 1440, "600 × (40 × 1.5) / (20 × 1.25)");
    assert_eq!(entry.event_supply, Fx::from_pct(150));
    assert_eq!(entry.event_demand, Fx::from_pct(125));
    assert_eq!(entry.price, manifest_core::market::current_price(&d, w.day(), GoodId(0), entry));
    assert!(w.state.events.mods.export_ban.contains(&(FactionId(0), GoodId(0))));
    assert!(w.at_war(FactionId(0)));
    assert!(w.faction_tax_mult(OwnerId::Player, FactionId(0)) > Fx::ONE);
    let owner = OwnerId::Company(CompanyId(0));
    let fleet = w.fleets_of(owner).next().unwrap().id;
    let error = Command::Buy { owner, fleet, good: GoodId(0), qty: 1, max_total: None }.apply(&mut w).unwrap_err();
    assert_eq!(error.reason().unwrap().code, "policy.export_ban");
    testkit::check_invariants(&w).unwrap();
    let state = w.state.clone();
    assert!(Command::SkipUpbringing { owner: OwnerId::Player }.apply(&mut w).is_err());
    assert_eq!(w.state, state, "不能再次触发补正或资本发放");
    assert_eq!(World::from_snapshot(d, state).unwrap().state, w.state);
    w.end_day().unwrap();
    assert!(w.state.locations[0].market.values().any(|e| e.flow.produced > 0), "结业后恢复完整经济");
}

#[test]
fn legacy_cargo_cash_and_closed_home_are_reconciled_without_losing_goods_or_money() {
    use manifest_core::{
        GoodId,
        history::{DynamicPort, InitialPort, PortStatus},
    };
    let mut d = short_course(2);
    let data = Arc::make_mut(&mut d);
    let home = data.companies[0].home;
    data.history.ports.push(InitialPort { port: data.loc(home).key.clone(), state: PortStatus::Open, faction: None });
    let mut w = World::new(d.clone(), ScenarioId(0), 42).unwrap();
    let owner = OwnerId::Company(CompanyId(0));
    let fleet = w.fleets_of(owner).next().unwrap().id;
    Command::Buy { owner, fleet, good: GoodId(0), qty: 2, max_total: None }.apply(&mut w).unwrap();
    let book = w.agent(owner).unwrap().book.clone();
    w.state.history.ports.insert(home, DynamicPort { status: PortStatus::Destroyed, ..Default::default() });
    let money = w.all_money();
    skip(&mut w);
    w.end_day().unwrap();
    assert!(!w.upbringing_active());
    let at = w.fleet(fleet).unwrap().docked_at().unwrap();
    assert_ne!(at, home);
    assert!(w.location_open(at));
    assert_eq!(w.port_status(home), PortStatus::Destroyed);
    assert_eq!(w.agent(owner).unwrap().cash, d.companies[0].cash);
    assert_eq!(w.agent(owner).unwrap().book, book);
    assert_eq!(w.warehouse(owner, at).unwrap().stock[&GoodId(0)], 2);
    assert_eq!(w.all_money(), money);
    assert_eq!(w.fleets_at_sea(), 0);
    testkit::check_invariants(&w).unwrap();
    assert_eq!(World::from_snapshot(d, w.state.clone()).unwrap().state, w.state);
}

#[test]
fn expired_obligations_settle_once_and_futures_cover_the_current_month() {
    use manifest_core::{
        ContractId, FactionId, GoodId, LocId,
        contract::{ContractSource, ContractStatus, TransportContract},
    };
    let mut d = short_course(2);
    Arc::make_mut(&mut d).upbringing.families[0].graduation = [1502, 2, 1];
    let mut w = World::new(d.clone(), ScenarioId(0), 42).unwrap();
    Command::Borrow { owner: OwnerId::Player, amount: 100, months: 1 }.apply(&mut w).unwrap();
    w.state.contracts.insert(
        ContractId(999),
        TransportContract {
            id: ContractId(999),
            issuer: FactionId(0),
            good: GoodId(0),
            qty: 1,
            to: LocId(0),
            deadline: 5,
            reward: 100,
            penalty: 10,
            status: ContractStatus::Accepted(OwnerId::Player),
            source: ContractSource::Ai,
            small: false,
            source_port: None,
            cells: 0,
            need_days: 0,
            urgency_bp: 0,
        },
    );
    w.state.next_contract = 1000;
    let money = w.all_money();
    skip(&mut w);
    for _ in 0..30 {
        w.end_day().unwrap();
    }
    assert_eq!(w.state.contracts[&ContractId(999)].status, ContractStatus::Failed(OwnerId::Player));
    assert_eq!(w.loan_total(OwnerId::Player), 0);
    assert!(w.state.futures.contracts.values().filter(|c| !c.settled).all(|c| c.expiry_day >= w.day()));
    assert_eq!(w.state.futures.contracts.values().filter(|c| !c.settled).count(), d.futures_specs.len() * 3);
    assert_eq!(w.all_money(), money);
    testkit::check_invariants(&w).unwrap();
}

#[test]
fn vanished_fleets_and_bankrupt_companies_are_not_resurrected() {
    use manifest_core::ledger::{Account, CashClass, JournalEntry, Memo};
    let mut w = World::new(short_course(2), ScenarioId(0), 42).unwrap();
    let owner = OwnerId::Company(CompanyId(0));
    let id = w.fleets_of(owner).next().unwrap().id;
    let lost = w.state.fleets.remove(&id).unwrap();
    w.state
        .agents
        .get_mut(&owner)
        .unwrap()
        .ledger
        .post(
            JournalEntry::new(0, Memo::Opening, CashClass::Investing)
                .dr(Account::Capital, lost.book_value())
                .cr(Account::Ships, lost.book_value()),
        )
        .unwrap();
    let dead = OwnerId::Company(CompanyId(1));
    w.state.agents.get_mut(&dead).unwrap().bankrupt = true;
    let cash = w.agent(dead).unwrap().cash;
    let fleet = w.fleets_of(dead).next().unwrap().clone();
    skip(&mut w);
    w.end_day().unwrap();
    assert!(w.fleets_of(owner).next().is_none());
    assert!(w.agent(dead).unwrap().bankrupt);
    assert_eq!(w.agent(dead).unwrap().cash, cash);
    assert_eq!(w.fleet(fleet.id).unwrap(), &fleet);
    testkit::check_invariants(&w).unwrap();
}

#[test]
fn legacy_colony_finishes_due_construction_and_keeps_its_recorded_history() {
    use manifest_core::{
        ColonyBuildingId, ColonyId, LocId,
        colony::{Colony, ColonyStats, Construction},
        log::LogKind,
    };
    let mut w = World::new(short_course(21), ScenarioId(0), 42).unwrap();
    let loc = w.defs.locations.iter().position(|l| l.site.is_some()).map(LocId::from_idx).unwrap();
    let id = ColonyId(0);
    let building = ColonyBuildingId(0);
    w.state.colonies.insert(
        id,
        Colony {
            id,
            loc,
            owner: OwnerId::Company(CompanyId(0)),
            name: "测试".into(),
            founded: 0,
            population: 100,
            morale: 70,
            buildings: Default::default(),
            construction: Some(Construction { building, level: 1, start_day: 0, done_day: 2 }),
            starving_days: 0,
            last_raid: Some(0),
            tax: 0,
            book_value: 0,
            carry: Default::default(),
            stats: ColonyStats { food_eaten: 5, raids: 7, ..Default::default() },
        },
    );
    w.state.next_colony = 1;
    w.state.locations[loc.idx()].claim = Some(manifest_core::colony::Claim::Colony(id));
    skip(&mut w);
    while w.upbringing_active() {
        w.end_day().unwrap();
    }
    let colony = &w.state.colonies[&id];
    assert!(colony.construction.is_none());
    assert_eq!(colony.level(building), 1);
    assert_eq!((colony.population, colony.morale, colony.last_raid, colony.stats.raids), (100, 70, Some(0), 7));
    assert_eq!(colony.stats.food_eaten, 0);
    assert_eq!(
        w.state
            .log
            .iter()
            .filter(|entry| matches!(entry.kind, LogKind::ColonyBuilt { colony, .. } if colony == id))
            .count(),
        1
    );
    testkit::check_invariants(&w).unwrap();
}

#[test]
fn training_voyage_keeps_working_while_npc_voyages_and_the_economy_are_frozen() {
    use manifest_core::LocId;
    let mut d = defs(true);
    let data = Arc::make_mut(&mut d);
    data.upbringing.activities[0].training_ship = Some(data.ships[0].key.clone());
    let mut w = World::new(d.clone(), ScenarioId(0), 42).unwrap();
    Command::PlanMonth {
        owner: OwnerId::Player,
        slots: (0..3)
            .map(|index| PlanSlot { index, lesson: None, after: Some(AfterChoice::activity("rest")) })
            .collect(),
    }
    .apply(&mut w)
    .unwrap();
    let student = w.state.upbringing.as_ref().unwrap().training.as_ref().unwrap().fleet;
    let npc = OwnerId::Company(CompanyId(0));
    let other = w.fleets_of(npc).next().unwrap().id;
    for (owner, fleet) in [(OwnerId::Player, student), (npc, other)] {
        Command::SetSail { owner, fleet, dest: LocId(1) }.apply(&mut w).unwrap();
    }
    let frozen = w.fleet(other).unwrap().clone();
    let before = w.fleet(student).unwrap().location.clone();
    let markets: Vec<_> = w.state.locations.iter().map(|l| l.market.clone()).collect();
    w.state.navigation.minute = 60;
    w.end_day().unwrap();
    assert_ne!(w.fleet(student).unwrap().location, before);
    assert_eq!(w.fleet(other).unwrap(), &frozen, "暂停的商会连海上补给也不能消耗");
    assert_eq!(w.state.navigation.minute, 0);
    assert_eq!(w.state.locations.iter().map(|l| l.market.clone()).collect::<Vec<_>>(), markets);
    for _ in 1..10 {
        w.end_day().unwrap();
    }
    assert!(!w.state.fleets.contains_key(&student), "第一旬结束后正常还船");
    testkit::check_invariants(&w).unwrap();
    assert_eq!(World::from_snapshot(d, w.state.clone()).unwrap().state, w.state);
}
