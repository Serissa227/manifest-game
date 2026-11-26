//! B10b：真实寰宇四年预推演与一年自由航海；不替换数据、不缩短世界历。
use manifest_core::scenario::NewGameRequest;
use manifest_core::{
    Command, FleetId, GoodId, LocId, OwnerId, StaticData,
    market::{self, Side},
    navigation::{
        ManualVoyage, Sail, Steering, StopKind, SubCell,
        course::{CourseInput, integrate_course},
    },
    world::{FleetLocation, Voyage},
};
use manifest_sim::{GameSession, storage};
use std::sync::{Arc, OnceLock};

fn defs() -> Arc<StaticData> {
    static DEFS: OnceLock<Arc<StaticData>> = OnceLock::new();
    DEFS.get_or_init(|| {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
        let effective = manifest_data::resolve_world(&root, "terra16").unwrap();
        // 2026-11-02 起寰宇是成品世界（不再是草稿）。
        assert!(!effective.manifest.draft);
        let defs = manifest_data::load_world(&root, "terra16").expect("真实寰宇完整加载");
        // 养成内容（2026-11-03）：九位主角的家乡玩伴与诺埃尔的看网老人，共 17 人（594 → 611）。
        // 公开版拿掉三位人物：611 → 608。
        assert_eq!(defs.cast.persons.len(), 608);
        assert_eq!(defs.locations.len(), 240);
        assert_eq!(defs.port_ids().count(), 194);
        defs
    })
    .clone()
}

fn request() -> NewGameRequest {
    NewGameRequest {
        world: "terra16".into(),
        scenario: "free_1557".into(),
        seed: Some(37),
        skip_upbringing: true,
        ..Default::default()
    }
}

/// B7 后使用真实出港和操舵。寻路只给舵手下一个航路点，位置仍由分钟积分决定。
fn sail_manual_day(game: &mut GameSession, fleet: FleetId, dest: LocId) {
    let owner = OwnerId::Player;
    if game.world.fleet(fleet).unwrap().docked_at().is_some() {
        game.submit(Command::Depart { owner, fleet, minute: 0, heading: 0 }).unwrap();
    }
    let ship = game.world.fleet(fleet).unwrap().clone();
    let FleetLocation::AtSea(Voyage::Manual { manual }) = &ship.location else { panic!("须走真实手动航行") };
    let mut predicted: ManualVoyage = manual.clone();
    let mut weather = std::collections::BTreeMap::new();
    for minute in (0..1440).step_by(30) {
        let path = game
            .defs()
            .nav
            .grid
            .find_path_on(game.day(), predicted.pos.cell(), game.defs().loc(dest).cell)
            .expect("真实伊比利亚海路");
        let waypoint = SubCell::center(*path.cells.get(1).unwrap_or_else(|| path.cells.last().unwrap()));
        let candidate = (0..360)
            .step_by(10)
            .map(|heading| {
                let steering = Steering { minute, heading: Some(heading), sail: Some(Sail::Full) };
                let course = integrate_course(
                    CourseInput {
                        defs: game.defs(),
                        fleet: &ship,
                        start: &predicted,
                        from: minute,
                        until: minute + 30,
                        steers: &[steering],
                        day: game.day(),
                        speed_bonus: game.world.fleet_speed_bonus(fleet),
                        mods: game.world.voyage_mods(fleet),
                    },
                    // H03：手动航行取位置天况（天气团开着时与海区天况不同）
                    |cell| *weather.entry(cell).or_insert_with(|| game.world.weather_at_pos(cell)),
                );
                let dx = course.voyage.pos.x - waypoint.x;
                let dy = course.voyage.pos.y - waypoint.y;
                // 第九批 M02 细碰撞之后，粗格航路点与船之间可能隔着细海岸：朝它直冲会撞岸停船、原地不动，
                // 只按离航路点的距离挑航向就会一直挑“撞岸停住”（停在原地比绕开更近），困在岸边直到断粮。
                // 像玩家一样先挑不撞岸的航向，再比距离。
                let aground = course.stops.iter().any(|s| s.kind == StopKind::Land);
                ((aground, dx * dx + dy * dy, heading), steering, course)
            })
            .min_by_key(|(score, _, _)| *score)
            .unwrap();
        let (_, steering, course) = candidate;
        game.submit(Command::Steer { owner, fleet, minute, heading: steering.heading, sail: steering.sail }).unwrap();
        predicted = course.voyage;
        if course.arrival.is_some() {
            break;
        }
    }
    assert_eq!(game.world.preview_course(fleet, &[], 0).unwrap().voyage, predicted);
}

#[test]
fn terra16_four_year_bootstrap_is_deterministic_and_creates_assets_at_control() {
    let defs = defs();
    let mut progress = Vec::new();
    let game = GameSession::new_world(defs.clone(), request(), |p| progress.push(p)).unwrap();
    assert_eq!(game.start.bootstrap_days, 1460);
    assert_eq!(game.world.cast_date(), [1557, 1, 1]);
    assert_eq!(progress.len(), 1461);
    for (day, p) in progress.iter().enumerate() {
        assert_eq!((p.day, p.total), (day as u32, 1460));
    }
    assert!(game.log().is_empty());
    let scenario = &defs.scenarios[game.start.scenario.idx()];
    let player = game.world.agent(OwnerId::Player).unwrap();
    assert_eq!(player.cash, scenario.cash);
    assert!(!player.bankrupt);
    assert_eq!(player.negative_days, 0);
    for fleet in game.world.fleets_of(OwnerId::Player) {
        assert_eq!(fleet.idle_days, 0);
        assert_eq!(fleet.crew, scenario.crew);
        assert!(fleet.ships.iter().all(|ship| ship.built == game.day()));
    }
    manifest_core::testkit::check_invariants(&game.world).unwrap();
    assert_eq!(game.world.state_hash(), game.replay().unwrap().state_hash());
}

#[test]
fn terra16_one_year_free_sailing_preserves_conservation_save_and_replay() {
    let defs = defs();
    let mut game = GameSession::new_world(defs.clone(), request(), |_| {}).unwrap();
    let owner = OwnerId::Player;
    let fleet = game.world.fleets_of(owner).next().unwrap().id;
    let porto = defs.locations.iter().position(|l| l.key == "porto").map(manifest_core::LocId::from_idx).unwrap();
    let lisbon = defs.locations.iter().position(|l| l.key == "lisbon").map(manifest_core::LocId::from_idx).unwrap();
    let start = game.day();
    let mut sailed = 0;
    let mut traded = 0;
    let mut sea_days = 0;
    let mut destination = porto;
    for _ in 0..365 {
        let ship = game.world.fleet(fleet).expect("一年航海中舰队存续").clone();
        if !game.world.fleet_in_battle(fleet) {
            if let Some(here) = ship.docked_at() {
                // G01经济重做后，在里斯本和波尔图之间运航海仪器北上、木板南下。
                // 全部买卖、维护、补给与出航都走真实命令，不能靠空船往返消耗本金一年。
                let dest = if here == porto { lisbon } else { porto };
                destination = dest;
                for (&good, &qty) in &ship.cargo {
                    game.submit(Command::Sell { owner, fleet, good, qty, min_total: None }).unwrap();
                    traded += 1;
                }
                if game.world.repair_cost(&ship) > 0 {
                    game.submit(Command::Repair { owner, fleet }).unwrap();
                }
                let crew = (18 - ship.crew).max(0);
                if crew > 0 {
                    game.submit(Command::HireCrew { owner, fleet, count: crew }).unwrap();
                }
                let ship = game.world.fleet(fleet).unwrap();
                let days = game.world.estimate_days(ship, dest).expect("伊比利亚航线") + 5;
                let need = ship.supplies_needed(&defs, days);
                let (food, water) = ((need - ship.food).max(0), (need - ship.water).max(0));
                if food > 0 || water > 0 {
                    game.submit(Command::Resupply { owner, fleet, food, water }).unwrap();
                }
                if here == porto || here == lisbon {
                    // 第九批 P13 统一验证（2026-11-11）：旧脚本写死“波尔图买木板（planks）、里斯本买航海仪器（instruments）”。
                    // T01 货档（交易品逐步开放）之后，木板要商誉 10、航海仪器要商誉 60，新开局商誉为 0、宽限期只给旧存档，
                    // 两种货在新局里都买不到，一年只花不赚、现金见底。这是 T01 的规则变化，不是放宽断言：
                    // 下面的断言一条没改，只把代替玩家做买卖的脚本改成按当前货档与许可证，
                    // 在这对港口之间挑买得到、所知差价最好的货（确定的挑法：利润最高者，同分按 key 小的）。
                    let budget = game.world.agent(owner).unwrap().cash.max(0) / 2;
                    let free = game.world.fleet(fleet).unwrap().free_capacity();
                    let here_faction = game.world.location_faction(here);
                    let dest_faction = game.world.location_faction(dest);
                    let best = defs
                        .goods
                        .iter()
                        .enumerate()
                        .filter_map(|(i, def)| {
                            let good = GoodId::from_idx(i);
                            if def.license
                                && (!game.world.has_license(owner, here_faction)
                                    || !game.world.has_license(owner, dest_faction))
                            {
                                return None;
                            }
                            if game.world.rank_gate(owner, here, good).is_some() {
                                return None;
                            }
                            let entry = game.world.market(here, good)?;
                            game.world.market(dest, good)?;
                            let max_qty = free.min(entry.stock * 3 / 10).min(budget / entry.price.max(1));
                            // 测试角色按真实含税报价选非亏损货量；库存的30%不再天然有正价差。
                            (1..=max_qty)
                                .filter_map(|qty| {
                                    let buy = market::quote(&game.world, owner, here, good, Side::Buy, qty).ok()?;
                                    let sell = market::quote(&game.world, owner, dest, good, Side::Sell, qty).ok()?;
                                    (buy.total <= budget && sell.total > buy.total)
                                        .then_some((sell.total - buy.total, qty))
                                })
                                .max()
                                .map(|(profit, qty)| (profit, std::cmp::Reverse(def.key.clone()), good, qty))
                        })
                        .max();
                    if let Some((_, _, good, qty)) = best {
                        game.submit(Command::Buy { owner, fleet, good, qty, max_total: Some(budget) }).unwrap();
                        traded += 1;
                    }
                }
                sail_manual_day(&mut game, fleet, destination);
                sailed += 1;
            } else {
                sea_days += 1;
                sail_manual_day(&mut game, fleet, destination);
            }
        }
        manifest_core::testkit::check_invariants(&game.world).unwrap();
        game.advance_day().unwrap();
        manifest_core::testkit::check_invariants(&game.world).unwrap();
    }
    assert_eq!(game.day() - start, 365);
    assert_eq!(game.world.cast_date(), [1558, 1, 1]);
    assert!(sailed >= 2 && sea_days > 0, "必须实际航海，不能只在码头等待：{sailed}/{sea_days}");
    assert!(game.world.loc_known(lisbon) && game.world.loc_known(porto));
    assert!(traded > 0, "须有真实贸易维持航海");
    assert!(!game.world.agent(owner).unwrap().bankrupt);
    let saved = storage::decode(&storage::encode(&game.to_save(), true).unwrap()).unwrap();
    let loaded = GameSession::from_save(defs, saved).unwrap();
    assert_eq!(loaded.world.state, game.world.state);
    assert_eq!(loaded.replay().unwrap().state_hash(), game.world.state_hash());
    println!("terra16：365 日逐日守恒，{sailed} 次出航，{traded} 次买卖，{sea_days} 个航行日；存档与完整重放一致");
}
