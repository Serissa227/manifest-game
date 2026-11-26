//! H02 各条规则：附着、帆缆、船材与修理、进水、载重、疲劳、坏血病、口粮、情绪阶段、命令与存档。
use super::*;
use crate::navigation::ManualVoyage;
use crate::rng::{Domain, Rng};
use crate::weather::DayTable;
use crate::world::Fleet;
use crate::{Command, GoodId, ScenarioId, testkit};
use std::sync::Arc;

/// 小世界：H02 打开（或关着），旗舰队在海上手动航行，没有海区（不掷天气），疾病与哗变概率照常但用不到。
fn world(enabled: bool) -> (World, FleetId) {
    let mut defs = (*testkit::tiny_defs()).clone();
    defs.manual_navigation = true;
    defs.rules.voyage_wear = WearRules {
        enabled,
        antiscorbutic: vec![defs.goods[0].key.clone()],
        refit_fouling: vec![(defs.refits.first().map(|r| r.key.clone()).unwrap_or_default(), 50)],
        ..Default::default()
    };
    defs.map.region.fill(u16::MAX);
    let mut w = World::new(Arc::new(defs), ScenarioId(0), 42).unwrap();
    let id = w.flagship(OwnerId::Player).unwrap();
    let cell = w.fleet(id).unwrap().cell(&w.defs);
    let f = w.fleet_mut(id).unwrap();
    f.location = FleetLocation::AtSea(Voyage::Manual { manual: ManualVoyage::new(cell, 90) });
    f.crew = f.crew.max(40);
    f.food = 10_000;
    f.water = 10_000;
    f.morale = 100;
    f.cargo.clear();
    (w, id)
}

fn day(w: &mut World, id: FleetId) {
    let d = w.state.day;
    let mut today = DayTable::new(w);
    let mut rng = Rng::derive(w.state.seed, d, Domain::Voyage, u64::from(id.0), 0);
    w.sea_day(id, &mut rng, &mut today, None).unwrap();
    w.fleet_mut(id).unwrap().days_at_sea += 1;
    w.state.day += 1;
}

fn set(w: &mut World, id: FleetId, f: impl FnOnce(&mut FleetWear)) {
    let mut wear = w.fleet_wear(id);
    f(&mut wear);
    w.wear_store(id, wear);
}

fn fleet(w: &World, id: FleetId) -> &Fleet {
    w.fleet(id).unwrap()
}

#[test]
fn disabled_rules_leave_no_state_and_neutral_effects() {
    let (mut w, id) = world(false);
    for _ in 0..60 {
        day(&mut w, id);
    }
    assert!(w.state.voyage.is_empty());
    assert!(!serde_json::to_string(&w.state).unwrap().contains("\"voyage\""));
    assert_eq!(w.wear_speed_bp(id), 10_000);
    assert_eq!((w.wear_upwind(id), w.wear_idle_crew(id), w.ration_keep(id)), (0, 0, 100));
    assert!(!w.wear_auto_reef(id));
    assert!(w.voyage_mods(id).is_neutral());
    assert!(Command::Voyage { owner: OwnerId::Player, fleet: id, order: VoyageOrder::Scrape }.apply(&mut w).is_err());
}

#[test]
fn fouling_grows_at_sea_slows_the_fleet_and_refits_halve_it() {
    let (mut w, id) = world(true);
    for _ in 0..10 {
        day(&mut w, id);
    }
    assert_eq!(w.fleet_wear(id).fouling_points(), 10, "温和海区每天 +1");
    let slow = w.wear_speed_bp(id);
    assert!(slow < 10_000);
    // 附着 100 → 慢 15%（只看附着这一项）
    set(&mut w, id, |x| x.fouling = 100 * POINT);
    assert_eq!(w.wear_speed_bp(id), 8_500);
    // 一半的船（这里是全部的船）有包铅船底：附着涨幅减半
    let refit = crate::RefitId::from_idx(0);
    set(&mut w, id, |x| x.fouling = 0);
    w.fleet_mut(id).unwrap().ships.iter_mut().for_each(|s| s.refits.push(refit));
    for _ in 0..10 {
        day(&mut w, id);
    }
    assert_eq!(w.fleet_wear(id).fouling_points(), 5);
}

#[test]
fn rigging_wears_by_sail_in_storms_and_widens_the_dead_zone() {
    let (w0, id) = world(true);
    let r = &w0.defs.rules.voyage_wear;
    let storm = |sail: Sail| -> i64 {
        let (mut w, id) = world(true);
        if let FleetLocation::AtSea(Voyage::Manual { manual }) = &mut w.fleet_mut(id).unwrap().location {
            manual.sail = sail;
        }
        let mut wx = crate::weather::DayWeather {
            region: crate::RegionId(0),
            day: 0,
            sky: crate::weather::Sky::Storm,
            storm_hit_e8: 0,
            sea: crate::defs::SeasonWeather {
                wind_dir: 0,
                wind_strength: 9,
                current_dir: 0,
                current_strength: 0,
                storm_bp: 0,
                pirate_bp: 0,
            },
        };
        wx.day = w.state.day;
        set(&mut w, id, |x| x.orders.auto_repair = false);
        w.wear_sea_day(id, Some(&wx)).unwrap();
        100 - w.fleet_wear(id).rigging_points()
    };
    assert_eq!(storm(Sail::Full), r.rigging_storm[0]);
    assert_eq!(storm(Sail::Half), r.rigging_storm[1]);
    assert_eq!(storm(Sail::Furled), r.rigging_storm[2]);
    let (mut w, _) = world(true);
    set(&mut w, id, |x| x.rigging_wear = 40 * POINT);
    assert_eq!(w.wear_upwind(id), 4);
    // 帆缆 60：航速 ×(70 + 18)%
    assert_eq!(w.wear_speed_bp(id), 8_800);
}

#[test]
fn sea_repair_spends_timber_and_stops_at_seventy_percent() {
    let (mut w, id) = world(true);
    set(&mut w, id, |x| {
        // 帆缆 65（低于修理线 70）
        x.rigging_wear = 35 * POINT;
        x.timber = 3;
    });
    let max = fleet(&w, id).ships[0].max_durability;
    w.fleet_mut(id).unwrap().ships[0].durability = max * 69 / 100;
    day(&mut w, id);
    let x = w.fleet_wear(id);
    assert_eq!((x.timber, x.rigging_points()), (1, 70));
    assert_eq!(fleet(&w, id).ships[0].durability, max * 70 / 100, "只修到 70%");
    // 关掉自动修理就不花船材
    set(&mut w, id, |x| x.orders.auto_repair = false);
    day(&mut w, id);
    assert_eq!(w.fleet_wear(id).timber, 1);
}

#[test]
fn a_hull_below_thirty_percent_leaks_every_day() {
    let (mut w, id) = world(true);
    let max = fleet(&w, id).ships[0].max_durability;
    w.fleet_mut(id).unwrap().ships[0].durability = max / 4;
    day(&mut w, id);
    assert_eq!(fleet(&w, id).ships[0].durability, max / 4 - (max / 100).max(1));
    assert!(w.state.log.iter().any(|e| matches!(e.kind, LogKind::VoyageWear { event: WearEvent::Leak, .. })));
}

#[test]
fn heavy_cargo_slows_up_to_ten_percent() {
    let (mut w, id) = world(true);
    let cap = fleet(&w, id).capacity();
    let f = w.fleet_mut(id).unwrap();
    f.cargo.insert(GoodId(1), cap * 60 / 100);
    assert_eq!(w.load_slow_pct(id), 0);
    w.fleet_mut(id).unwrap().cargo.insert(GoodId(1), cap * 80 / 100);
    assert_eq!(w.load_slow_pct(id), 5);
    w.fleet_mut(id).unwrap().cargo.insert(GoodId(1), cap);
    assert_eq!(w.load_slow_pct(id), 10);
}

#[test]
fn fatigue_follows_pace_rests_in_port_and_slows_when_tired() {
    let (mut w, id) = world(true);
    set(&mut w, id, |x| x.orders.pace = Pace::Hard);
    for _ in 0..5 {
        day(&mut w, id);
    }
    assert_eq!(w.fleet_wear(id).fatigue, 20);
    set(&mut w, id, |x| x.orders.pace = Pace::Easy);
    day(&mut w, id);
    assert_eq!(w.fleet_wear(id).fatigue, 17);
    set(&mut w, id, |x| {
        x.orders.pace = Pace::Normal;
        x.fatigue = 60;
    });
    assert_eq!(w.wear_speed_bp(id), 9_500);
    set(&mut w, id, |x| x.fatigue = 90);
    assert_eq!(w.wear_speed_bp(id), 8_800);
    w.wear_port_day(id);
    assert_eq!(w.fleet_wear(id).fatigue, 70);
}

#[test]
fn scurvy_appears_after_the_fresh_window_and_antiscorbutic_cargo_prevents_it() {
    let (mut w, id) = world(true);
    let crew = fleet(&w, id).crew;
    set(&mut w, id, |x| x.fresh_days = 45);
    day(&mut w, id);
    let sick = w.fleet_wear(id).sick;
    assert_eq!(sick, (crew * 2 + 99) / 100);
    assert!(w.wear_idle_crew(id) == sick && w.voyage_mods(id).idle_crew == sick);
    // 货舱里有抗坏血病的货：吃掉一天的量，断鲜不涨，病号开始康复
    let good = GoodId(0);
    w.fleet_mut(id).unwrap().cargo.insert(good, 100);
    let fresh = w.fleet_wear(id).fresh_days;
    day(&mut w, id);
    let x = w.fleet_wear(id);
    assert_eq!(x.fresh_days, fresh);
    assert!(x.sick < sick);
    assert_eq!(fleet(&w, id).cargo[&good], 100 - crate::fleet::daily_supply_need(&w.defs, fleet(&w, id).crew));
    // 鱼群、采集给的鲜食：断鲜回退
    w.wear_fresh_food(id, 10);
    assert_eq!(w.fleet_wear(id).fresh_days, fresh - 10);
    // 靠港：断鲜清零
    w.wear_port_day(id);
    assert_eq!(w.fleet_wear(id).fresh_days, 0);
}

#[test]
fn rations_cut_consumption_and_morale() {
    let (mut full, id) = world(true);
    let (mut half, _) = world(true);
    set(&mut half, id, |x| x.orders.rations = Rations::Half);
    for _ in 0..20 {
        day(&mut full, id);
        day(&mut half, id);
    }
    let eaten = |w: &World| 10_000 - fleet(w, id).food;
    assert!(eaten(&half) * 2 <= eaten(&full) + 1, "{} vs {}", eaten(&half), eaten(&full));
    assert_eq!(fleet(&full, id).morale - fleet(&half, id).morale, 60);
}

#[test]
fn crisis_stages_follow_morale_and_flags_settle_them() {
    let (mut w, id) = world(true);
    let d = Arc::make_mut(&mut w.defs);
    let enc = |key: &str| crate::story::EncounterDef {
        key: key.into(),
        title: key.into(),
        text: String::new(),
        speaker: crate::story::Speaker::Captain,
        speaker_name: String::new(),
        place: crate::story::Place::Sea,
        when: vec![],
        weight: 1,
        once: false,
        cooldown_days: 365,
        choices: vec![],
    };
    for k in ["g1", "s1", "m1"] {
        d.stories.encounters.push(enc(k));
    }
    d.rules.voyage_wear.grumble_events = vec!["g1".into()];
    d.rules.voyage_wear.slowdown_events = vec!["s1".into()];
    d.rules.voyage_wear.mutiny_events = vec!["m1".into()];
    // 怨言：士气 25，事件出场一次
    w.fleet_mut(id).unwrap().morale = 25;
    day(&mut w, id);
    assert!(matches!(&w.state.story.pending, Some(p) if p.source == crate::story::StorySource::Encounter("g1".into())));
    assert!(w.fleet_wear(id).crisis.grumbled);
    w.state.story.pending = None;
    // 怠工：士气 10，航速 −20%；（间隔未满时事件等着）
    w.state.story.encounter_day = Some(0);
    w.state.day += 10;
    w.fleet_mut(id).unwrap().morale = 10;
    let before = w.wear_speed_bp(id);
    day(&mut w, id);
    assert!(w.fleet_wear(id).crisis.slowdown);
    assert_eq!(w.wear_speed_bp(id) * 100 / before.max(1), 80);
    // 选项留下“复工”的标记：下一次日结兑现
    w.state.story.pending = None;
    w.state.story.last = Some(crate::story::StoryResult {
        day: w.state.day,
        fleet: id,
        source: crate::story::StorySource::Encounter("s1".into()),
        choice: Some(0),
        success: None,
        outcomes: vec![],
    });
    w.state.story.flags.insert("voyage_back_to_work".into());
    w.wear_flags().unwrap();
    assert!(!w.fleet_wear(id).crisis.slowdown);
    // 哗变：士气 < 8 连续 3 天
    w.state.day += 10;
    for _ in 0..3 {
        w.fleet_mut(id).unwrap().morale = 5;
        day(&mut w, id);
    }
    assert!(matches!(&w.state.story.pending, Some(p) if p.source == crate::story::StorySource::Encounter("m1".into())));
    // 选了“由他们去”：沿用原来的哗变结算
    let crew = fleet(&w, id).crew;
    w.state.story.flags.insert("voyage_mutiny".into());
    w.wear_flags().unwrap();
    assert_eq!(fleet(&w, id).morale, 40);
    assert!(fleet(&w, id).crew < crew);
}

#[test]
fn orders_timber_scrape_and_jettison_commands() {
    let (mut w, id) = world(true);
    let o = StandingOrders { rations: Rations::Reduced, pace: Pace::Easy, ..Default::default() };
    Command::Voyage { owner: OwnerId::Player, fleet: id, order: VoyageOrder::SetOrders(o) }.apply(&mut w).unwrap();
    assert_eq!(w.fleet_wear(id).orders, o);
    assert_eq!(w.ration_keep(id), 75);
    // 海上不能买船材、刮船底；能抛货
    w.fleet_mut(id).unwrap().cargo.insert(GoodId(1), 10);
    assert!(
        Command::Voyage { owner: OwnerId::Player, fleet: id, order: VoyageOrder::BuyTimber { qty: 1 } }
            .apply(&mut w)
            .is_err()
    );
    Command::Voyage { owner: OwnerId::Player, fleet: id, order: VoyageOrder::Jettison { good: GoodId(1), qty: 4 } }
        .apply(&mut w)
        .unwrap();
    assert_eq!(fleet(&w, id).cargo[&GoodId(1)], 6);
    // 靠港：买船材（不超过上限）、刮船底
    let port = w.defs.scenarios[0].start;
    w.fleet_mut(id).unwrap().location = FleetLocation::Docked(port);
    let cap = w.timber_cap(id);
    let cash = w.agent(OwnerId::Player).unwrap().cash;
    Command::Voyage { owner: OwnerId::Player, fleet: id, order: VoyageOrder::BuyTimber { qty: cap } }
        .apply(&mut w)
        .unwrap();
    assert_eq!(w.fleet_wear(id).timber, cap);
    assert_eq!(w.agent(OwnerId::Player).unwrap().cash, cash - cap * w.defs.rules.voyage_wear.timber_price);
    assert!(
        Command::Voyage { owner: OwnerId::Player, fleet: id, order: VoyageOrder::BuyTimber { qty: 1 } }
            .apply(&mut w)
            .is_err()
    );
    set(&mut w, id, |x| x.fouling = 60 * POINT);
    let cost = w.scrape_cost(id);
    assert!(cost > 0);
    let before = w.agent(OwnerId::Player).unwrap().cash;
    Command::Voyage { owner: OwnerId::Player, fleet: id, order: VoyageOrder::Scrape }.apply(&mut w).unwrap();
    assert_eq!(w.fleet_wear(id).fouling, 0);
    assert_eq!(w.agent(OwnerId::Player).unwrap().cash, before - cost);
    // 船底干净时不能再刮
    assert!(Command::Voyage { owner: OwnerId::Player, fleet: id, order: VoyageOrder::Scrape }.apply(&mut w).is_err());
}

#[test]
fn wear_state_roundtrips_and_old_saves_without_it_load() {
    let (mut w, id) = world(true);
    for _ in 0..30 {
        day(&mut w, id);
    }
    set(&mut w, id, |x| x.timber = 7);
    let json = serde_json::to_string(&w.state).unwrap();
    assert!(json.contains("\"voyage\""));
    let back = World::from_snapshot(w.defs.clone(), serde_json::from_str(&json).unwrap()).unwrap();
    assert_eq!(back.state, w.state);
    // 旧存档：没有 voyage 这一项，读入后取缺省（全新船况）
    let mut v: serde_json::Value = serde_json::from_str(&json).unwrap();
    v.as_object_mut().unwrap().remove("voyage");
    let old = World::from_snapshot(w.defs.clone(), serde_json::from_value(v).unwrap()).unwrap();
    assert!(old.fleet_wear(id).is_pristine());
}

#[test]
fn auto_reef_halves_the_sail_inside_a_storm_and_restores_it_after() {
    use crate::navigation::course::{CourseInput, integrate_course};
    let (w, id) = world(true);
    let f = fleet(&w, id);
    let start = ManualVoyage::new(f.cell(&w.defs), 90);
    let mut mods = w.voyage_mods(id);
    assert!(mods.auto_reef);
    let weather = |storm: bool| crate::weather::DayWeather {
        region: crate::RegionId(0),
        day: 0,
        sky: if storm { crate::weather::Sky::Storm } else { crate::weather::Sky::Clear },
        storm_hit_e8: 0,
        sea: crate::defs::SeasonWeather {
            wind_dir: 2,
            wind_strength: 5,
            current_dir: 0,
            current_strength: 0,
            storm_bp: 0,
            pirate_bp: 0,
        },
    };
    let run = |mods, storm| {
        integrate_course(
            CourseInput {
                defs: &w.defs,
                fleet: f,
                start: &start,
                from: 0,
                until: 60,
                steers: &[],
                day: 0,
                speed_bonus: crate::Fx::ZERO,
                mods,
            },
            |_| Some(weather(storm)),
        )
    };
    let c = run(mods, true);
    assert_eq!((c.voyage.sail, c.voyage.reefed), (Sail::Half, true));
    mods.auto_reef = false;
    assert_eq!(run(mods, true).voyage.sail, Sail::Full);
    // 出了风暴放回满帆
    let mut reefed = start.clone();
    reefed.sail = Sail::Half;
    reefed.reefed = true;
    mods.auto_reef = true;
    let c = integrate_course(
        CourseInput {
            defs: &w.defs,
            fleet: f,
            start: &reefed,
            from: 0,
            until: 10,
            steers: &[],
            day: 0,
            speed_bonus: crate::Fx::ZERO,
            mods,
        },
        |_| Some(weather(false)),
    );
    assert_eq!((c.voyage.sail, c.voyage.reefed), (Sail::Full, false));
}

#[test]
fn touching_port_by_minute_counts_as_a_port_day_even_if_the_fleet_sails_again() {
    // bot 与玩家常常当天按分钟靠港、补完货又出港：日结时舰队不在港里，也要算靠过一次港
    let (mut w, id) = world(true);
    set(&mut w, id, |x| {
        x.fresh_days = 40;
        x.fatigue = 50;
    });
    // 按分钟抵港：日结时舰队停在港里，但在港的整日结算被跳过（不额外给一整日在港收益）
    let port = w.defs.scenarios[0].start;
    w.fleet_mut(id).unwrap().location = FleetLocation::Docked(port);
    w.state.navigation.arrived.insert(id, port);
    w.move_fleets().unwrap();
    let x = w.fleet_wear(id);
    assert_eq!((x.fresh_days, x.fatigue), (0, 30));
}

#[test]
fn jettison_a_share_throws_the_cheapest_goods_first() {
    let (mut w, id) = world(true);
    let mut goods: Vec<GoodId> = w.defs.good_ids().collect();
    goods.sort_by_key(|g| w.defs.good(*g).base_price);
    let (cheap, dear) = (goods[0], goods[goods.len() - 1]);
    let f = w.fleet_mut(id).unwrap();
    f.cargo.insert(cheap, 20);
    f.cargo.insert(dear, 80);
    // 一百件的三成：先抛便宜的 20 件，再抛贵的 10 件
    Command::Voyage { owner: OwnerId::Player, fleet: id, order: VoyageOrder::JettisonShare { pct: 30 } }
        .apply(&mut w)
        .unwrap();
    let f = fleet(&w, id);
    assert_eq!((f.cargo.get(&cheap).copied(), f.cargo.get(&dear).copied()), (None, Some(70)));
    // 在港不能抛；比例越界不行
    assert!(
        Command::Voyage { owner: OwnerId::Player, fleet: id, order: VoyageOrder::JettisonShare { pct: 0 } }
            .apply(&mut w)
            .is_err()
    );
}

#[test]
fn promising_the_crew_a_port_turns_the_pilot_to_the_nearest_one() {
    let (mut w, id) = world(true);
    let cell = fleet(&w, id).cell(&w.defs);
    let topology = w.defs.map.topology();
    let nearest = w
        .visible_locations()
        .filter(|l| w.defs.loc(*l).is_port())
        .min_by_key(|l| (topology.chebyshev(w.defs.loc(*l).cell, cell), *l))
        .unwrap();
    w.state.story.last = Some(crate::story::StoryResult {
        day: w.state.day,
        fleet: id,
        source: crate::story::StorySource::Encounter("s1".into()),
        choice: Some(2),
        success: None,
        outcomes: vec![],
    });
    w.state.story.flags.insert("voyage_promise_port".into());
    w.wear_flags().unwrap();
    assert!(w.fleet_wear(id).crisis.promise_until.is_some());
    let pilot = w.state.navigation.pending.get(&id).and_then(|p| p.autopilots.last()).map(|p| p.dest);
    let logged =
        w.state.log.iter().any(|e| matches!(e.kind, LogKind::VoyageWear { event: WearEvent::HeadForPort, .. }));
    // 测试海图上最近的港口寻得到路时：领航改到那里、记一条日志
    assert_eq!(pilot, Some(nearest), "{:?}", w.state.navigation.pending.get(&id));
    assert!(logged);
}
