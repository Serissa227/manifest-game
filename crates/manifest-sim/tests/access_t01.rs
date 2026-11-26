//! T01 商馆、货档与市场深度在真实寰宇里的整局检查（自由航海 1557）：
//! - 全部剧情（请托、主线、羁绊）要你运的货：那一章进行中时对这种货放行，哪里出售就能在哪里买；
//! - 没有这套状态的旧存档读得进来、有 360 天宽限，存档版本不升；
//! - 套利 bot 在货档下照样成交，商会照样买货（包括本据势力港口里的高档货），整局可以从命令日志重放。
use manifest_core::info::InfoMode;
use manifest_core::open_market::sale_list;
use manifest_core::story2::{ObjectiveKind, Status, TrackState};
use manifest_core::{Command, GoodId, LocId, OwnerId, SaveFile, StaticData};
use manifest_sim::{Bot, BotKind, GameSession, stats};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, OnceLock};

const P: OwnerId = OwnerId::Player;

fn defs() -> Arc<StaticData> {
    static DATA: OnceLock<Arc<StaticData>> = OnceLock::new();
    DATA.get_or_init(|| {
        manifest_data::load_world(&std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data"), "terra16")
            .expect("真实寰宇")
    })
    .clone()
}

/// 自由航海 1557：预演走完、玩家刚接手的那一天。
fn free_sailing(seed: u64) -> GameSession {
    let defs = defs();
    let scenario = defs.find_scenario("free_1557").expect("自由航海剧本");
    let mut game = GameSession::new(defs, scenario, seed).expect("开局");
    game.choose_info(InfoMode::Carried).expect("行情情报");
    game
}

#[test]
fn every_good_a_story_asks_you_to_deliver_can_be_bought_while_that_chapter_is_active() {
    let defs = defs();
    let mut game = free_sailing(5);
    let w = &mut game.world;
    assert!(w.access_on() && w.access_grace_left().is_none(), "新开局没有宽限期");
    let good_id = |key: &str| defs.goods.iter().position(|g| g.key == key).map(GoodId::from_idx);
    let markets: Vec<LocId> =
        defs.loc_ids().filter(|l| !defs.loc(*l).is_site() && !defs.loc(*l).market.is_empty()).collect();
    let opening = w.state.clone();
    let (mut deliveries, mut ranked, mut locked_without) = (0, 0, 0);
    let mut nowhere = BTreeSet::new();
    for track in &defs.story2.tracks {
        for chapter in &track.chapters {
            let wanted: Vec<GoodId> = chapter
                .objectives
                .iter()
                .filter_map(|o| match &o.kind {
                    ObjectiveKind::Goods { good, .. } => Some(good_id(good).expect("目标里的货在商品表里")),
                    _ => None,
                })
                .collect();
            if wanted.is_empty() {
                continue;
            }
            // 按本章明写的已到达/已访问地点摆前提；不预开条件货，也不提高港口发展度。
            w.state = opening.clone();
            let required = chapter.at.iter().chain(chapter.when.iter().filter_map(|c| match c {
                manifest_core::story2::Condition::At { at, person: None }
                | manifest_core::story2::Condition::Visited { at: Some(at), .. } => Some(at),
                _ => None,
            }));
            for at in required {
                if let Some(loc) = defs.find_loc(at) {
                    w.state.explore.visited.insert(loc);
                }
            }
            w.stage_unlocks_day();
            let mut sold_at: BTreeMap<GoodId, Vec<LocId>> = BTreeMap::new();
            for loc in &markets {
                for good in w.market_sale_list(*loc) {
                    sold_at.entry(good).or_default().push(*loc);
                }
            }
            // 没有这件事时，这些货在各处照档位锁不锁
            let before: Vec<usize> = wanted
                .iter()
                .map(|g| sold_at.get(g).map_or(0, |ls| ls.iter().filter(|l| w.rank_gate(P, **l, *g).is_some()).count()))
                .collect();
            // 这一章进行中
            w.state.story2.tracks.insert(
                track.key.clone(),
                TrackState {
                    chapter: chapter.key.clone(),
                    visited: BTreeSet::new(),
                    entered: w.day(),
                    status: Status::Active,
                    failure: None,
                },
            );
            let errands = w.errand_goods(P);
            for (g, locked) in wanted.iter().zip(before) {
                deliveries += 1;
                ranked += usize::from(defs.good(*g).rank > 0);
                locked_without += usize::from(locked > 0);
                assert!(errands.contains(g), "{} / {}：{} 应当放行", track.key, chapter.key, defs.good(*g).key);
                let Some(places) = sold_at.get(g) else {
                    // 没有港口出售的货（只能靠产业、剧情或别的来路）：记下来，不在这里判
                    println!(
                        "{} / {} / {}：本章前提下没有出售港（{}）",
                        track.key,
                        chapter.key,
                        defs.good(*g).key,
                        track.source
                    );
                    nowhere.insert(defs.good(*g).key.clone());
                    continue;
                };
                for l in places {
                    assert!(
                        w.rank_gate(P, *l, *g).is_none(),
                        "{} / {}：{} 在 {} 仍被货档锁着",
                        track.key,
                        chapter.key,
                        defs.good(*g).key,
                        defs.loc(*l).key
                    );
                }
            }
            w.state.story2.tracks.remove(&track.key);
        }
    }
    println!(
        "剧情交货目标 {deliveries} 条，其中有档位的货 {ranked} 条、没有这件事时在某处被锁的 {locked_without} 条；进行中一律放行。没有港口出售的货：{nowhere:?}"
    );
    assert!(deliveries >= 100, "寰宇有一百多条交货目标");
    assert!(locked_without > 0, "放行确实起了作用（否则这条测试什么也没查）");
    assert!(nowhere.is_empty(), "交货目标里的货都要有地方出售：{nowhere:?}");
}

#[test]
fn an_old_save_without_the_state_loads_with_a_grace_period_and_keeps_its_version() {
    let defs = defs();
    let game = free_sailing(6);
    let day = game.day();
    let save = game.to_save();
    assert_eq!(save.version, manifest_core::save::SAVE_VERSION);
    assert_eq!(manifest_core::save::SAVE_VERSION, 5, "不升存档版本：新字段都有缺省值");
    // 造一份“这条规则之前”的存档：状态里没有 access，货物表与今天的相同（只许末尾追加）
    let mut value = serde_json::to_value(&save).unwrap();
    let snapshot = value["snapshot"].as_object_mut().unwrap();
    assert!(snapshot.remove("access").is_some(), "新开局的存档里有这套状态");
    let old = SaveFile::from_json(&value.to_string()).expect("旧存档读得进来");
    old.check_compatible(&defs).expect("key 表兼容");
    let mut loaded = GameSession::from_save(defs.clone(), old).expect("旧存档接着玩");
    let grace = defs.rules.access.grace_days;
    assert_eq!(loaded.world.state.access.since, Some(day));
    assert_eq!(loaded.world.state.access.grace_until, Some(day + grace));
    assert_eq!(loaded.world.access_grace_left(), Some(grace));
    // 宽限期里什么都不锁；新开局的同一个世界里则有锁着的货
    let locked = |w: &manifest_core::World| {
        defs.loc_ids()
            .filter(|l| !defs.loc(*l).market.is_empty())
            .flat_map(|l| sale_list(&defs, l).into_iter().map(move |g| (l, g)))
            .filter(|(l, g)| w.rank_gate(P, *l, *g).is_some())
            .count()
    };
    assert_eq!(locked(&loaded.world), 0);
    assert!(locked(&game.world) > 500, "新开局的玩家有许多货要慢慢放开");
    // 接着玩几天、再存再读：宽限期不重新起算
    for _ in 0..3 {
        loaded.advance_day().unwrap();
    }
    let again = GameSession::from_save(defs.clone(), loaded.to_save()).unwrap();
    assert_eq!(again.world.state.access, loaded.world.state.access);
    assert_eq!(again.world.access_grace_left(), Some(grace - 3));
}

#[test]
fn bots_and_companies_keep_trading_under_the_rule_and_the_game_replays() {
    let defs = defs();
    let mut game = free_sailing(37);
    let mut bot = Bot::new(BotKind::Arbitrage);
    let first = game.log().len();
    let (alive_start, total) = stats::companies_alive(&game.world);
    // 商会买走的件数，按货档
    let mut npc_by_rank = [0i64; 4];
    for _ in 0..90 {
        bot.act(&mut game);
        game.advance_day().unwrap();
        assert!(game.world.money_conserved(), "第 {} 天资金守恒", game.day());
        let day = game.day() - 1;
        for ls in game.world.state.locations.iter() {
            for (g, e) in ls.market.iter() {
                if e.flow.day == day && e.flow.npc_bought > 0 {
                    npc_by_rank[usize::from(defs.good(*g).rank)] += e.flow.npc_bought;
                }
            }
        }
    }
    let buys: Vec<GoodId> = game.log()[first..]
        .iter()
        .filter_map(|e| match e.command {
            Command::Buy { good, .. } => Some(good),
            _ => None,
        })
        .collect();
    let sells = game.log()[first..].iter().filter(|e| matches!(e.command, Command::Sell { .. })).count();
    let (alive, _) = stats::companies_alive(&game.world);
    println!(
        "90 天：bot 买入 {} 笔（{} 种货）、卖出 {sells} 笔，净资产 {}；商会按货档买走 {npc_by_rank:?} 件，存活 {alive}/{total}（开局 {alive_start}）",
        buys.len(),
        buys.iter().collect::<BTreeSet<_>>().len(),
        stats::net_worth(&game.world, P)
    );
    assert!(!buys.is_empty() && sells > 0, "bot 在货档下仍然真成交");
    assert!(npc_by_rank.iter().sum::<i64>() > 0, "商会照样买货");
    assert!(npc_by_rank[2] + npc_by_rank[3] > 0, "商会买得到细货与珍货（本据势力的港口全开、别处商誉 30 起步）");
    // 整局从命令日志重放，状态逐位相同
    let replayed = game.replay().expect("重放");
    assert_eq!(replayed.state_hash(), game.world.state_hash(), "重放一致");
}
