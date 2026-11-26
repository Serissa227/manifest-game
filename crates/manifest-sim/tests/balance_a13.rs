//! A13：真实寰宇的指数基期、航海 bot 和逐日资金来源审计；只使用 Mock。
use manifest_core::auction::{LotStatus, Phase};
use manifest_core::info::InfoMode;
use manifest_core::treasury::Flow;
use manifest_core::{Command, LocId, OwnerId, ScenarioId, StaticData, World};
use manifest_sim::{AiDriver, Bot, BotKind, GameSession, balance, stats, storage};
use std::sync::{Arc, OnceLock};

const PLAYER: OwnerId = OwnerId::Player;

fn defs() -> Arc<StaticData> {
    static DATA: OnceLock<Arc<StaticData>> = OnceLock::new();
    DATA.get_or_init(|| {
        manifest_data::load_world(&std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data"), "terra16")
            .expect("真实寰宇")
    })
    .clone()
}

fn money(w: &World) -> (i64, i64, i64, i64) {
    (w.total_money(), w.state.money.total_sources(), w.state.money.total_sinks(), w.all_money())
}

fn check_money(w: &World, previous: (i64, i64, i64, i64)) {
    let now = money(w);
    assert_eq!(now.0 - previous.0, (now.1 - previous.1) - (now.2 - previous.2), "第 {} 日来源／去向", w.day());
    assert_eq!(now.3, previous.3, "第 {} 日全部部门总额", w.day());
    assert!(w.money_conserved(), "第 {} 日累计守恒", w.day());
}

fn apply(game: &mut GameSession, command: Command) {
    let previous = money(&game.world);
    game.submit(command).expect("真实命令成功");
    check_money(&game.world, previous);
}

fn reject(game: &mut GameSession, command: Command) {
    let before = game.world.state_hash();
    let log = game.log().len();
    assert!(game.submit(command).is_err(), "重复／非法操作必须拒绝");
    assert_eq!(game.world.state_hash(), before, "拒绝原子性");
    assert_eq!(game.log().len(), log);
}

fn index_groups(w: &World) -> Vec<(bool, usize, i64)> {
    [false, true]
        .into_iter()
        .map(|extra| {
            let entries: Vec<_> =
                w.state.locations.iter().flat_map(|l| l.market.values()).filter(|e| e.extra == extra).collect();
            let sum: i64 = entries.iter().map(|e| manifest_core::Fx::ratio(e.price, e.base_price.max(1)).raw()).sum();
            (extra, entries.len(), sum / entries.len().max(1) as i64)
        })
        .collect()
}

/// G01 经济重放及44种新货/现有货修补后，P07 冻结价格的实测金标准 19553 → 18500；见 BALANCE.md 寰宇记录。
/// E02/E03 更新市场后的主线实测：开局价格水平 19198 → 19110（R10-TCLEAN3，2026-11-14）：
/// 变的只是开局那一刻的水平（第 0 天就是 1.9110），一年里仍一点不动、关闭涟漪仍相同；见 BALANCE.md 同日记录。
#[test]
fn terra16_light_upbringing_keeps_opening_price_level_with_or_without_ripple() {
    let defs = defs();
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
    let source = manifest_data::resolve_world(&root, "terra16").unwrap();
    let content = Arc::new(manifest_data::ai_content::load_world_ai_content(&source).unwrap());
    let mut indices = Vec::new();
    for zero_ripple in [false, true] {
        let mut d = (*defs).clone();
        if zero_ripple {
            for event in &mut d.history.events {
                event.ripple_budget = 0;
            }
        }
        let mut game = GameSession::new(Arc::new(d), ScenarioId(0), 42).unwrap();
        game.choose_info(InfoMode::Carried).unwrap();
        let initial = stats::price_index(&game.world);
        println!("zero_ripple={zero_ripple} initial={initial} groups={:?}", index_groups(&game.world));
        assert!(initial > manifest_core::Fx::ONE, "开放市场开局已有地域价差");
        let driver = AiDriver::with_mode(content.clone(), manifest_ai::AiMode::Mock).unwrap().expect("Mock 驱动启用");
        let mut bot = Bot::new(BotKind::Arbitrage);
        for _ in 0..365 {
            let before = money(&game.world);
            bot.act(&mut game);
            game.advance_day().unwrap();
            driver.run_due(&mut game);
            check_money(&game.world, before);
        }
        let end = stats::price_index(&game.world);
        assert_eq!(end, initial, "P07：养成期不逐日生产、交易或调价，仍保留历史与 Mock 排期");
        println!(
            "zero_ripple={zero_ripple} final={end} groups={:?} relative_bp={}",
            index_groups(&game.world),
            manifest_core::Fx::ratio(end.raw(), initial.raw()).raw() - 10_000
        );
        indices.push(end);
    }
    assert_eq!(indices, vec![manifest_core::Fx(19110); 2], "养成期保留开局价格水平，关闭涟漪仍相同");
}

#[test]
fn free_1557_bots_really_trade_and_sail_through_public_commands() {
    let defs = defs();
    assert_eq!(defs.scenarios[balance::default_scenario(&defs).unwrap().idx()].key, "free_1557");
    for kind in [BotKind::FixedRoute, BotKind::Arbitrage, BotKind::Futures] {
        let r = balance::run_one(defs.clone(), 37, kind, 1, InfoMode::Carried).unwrap();
        println!(
            "{kind}: trades={} departures={} start={} final={} money={}",
            r.trades, r.departures, r.start_net_worth, r.final_net_worth, r.money_conserved
        );
        assert_eq!(r.start_day, 1460);
        assert_eq!(r.audited_days, 365);
        assert_eq!(r.index.len(), 2);
        assert!(r.money_conserved && r.first_money_failure.is_none());
        assert!(r.trades > 0 && r.departures > 0, "不能把原地等待当成贸易平衡：{kind}");
    }
}

/// 仅把自由剧本的开局港改为真实拍卖港，并增加已入账的开局资本；经济价格与门禁全部原样。
fn auction_fixture() -> GameSession {
    // 两个价格／拍卖测试共用同一次完整预演的不可变快照；各自恢复成独立世界。
    static START: OnceLock<(Arc<StaticData>, manifest_core::SaveFile)> = OnceLock::new();
    let (defs, saved) = START.get_or_init(|| {
        let mut d = (*defs()).clone();
        let port = d.auctions.get("seville_almoneda").unwrap().port;
        let scenario = d.find_scenario("free_1557").unwrap();
        d.scenarios[scenario.idx()].start = port;
        d.scenarios[scenario.idx()].start_loc = port;
        d.scenarios[scenario.idx()].cash = 2_000_000;
        let d = Arc::new(d);
        let saved = GameSession::new(d.clone(), scenario, 29).unwrap().to_save();
        (d, saved)
    });
    GameSession::from_save(defs.clone(), saved.clone()).unwrap()
}

#[test]
fn four_year_daily_items_gifts_and_auctions_have_sources_and_no_repeat_rewards() {
    let mut game = auction_fixture();
    let defs = game.defs().clone();
    let loc = defs.auctions.get("seville_almoneda").unwrap().port;
    let mut trades = 0;
    let mut gifts = 0;
    let mut affinity_gained = 0;
    let mut purchases = 0;
    let mut inspections = 0;
    let mut auction_years = std::collections::BTreeSet::new();
    for day in 0..1460 {
        // 每月真实货架只抽一次，买回再卖会消耗本金；卖出不能补回货架刷无限库存。
        if day % 30 == 0 {
            let shelf = game.world.item_shelf(loc).unwrap().clone();
            if let Some((item, &stock)) = shelf.stock.iter().find(|(_, n)| **n > 0) {
                let original = game.world.item_quantity(PLAYER, item);
                let cash = game.world.agent(PLAYER).unwrap().cash;
                apply(&mut game, Command::BuyItem { owner: PLAYER, loc, item: item.clone(), qty: 1, max_total: None });
                apply(&mut game, Command::SellItem { owner: PLAYER, loc, item: item.clone(), qty: 1, min_total: None });
                assert_eq!(game.world.item_quantity(PLAYER, item), original);
                assert!(game.world.agent(PLAYER).unwrap().cash <= cash);
                assert_eq!(game.world.item_shelf(loc).unwrap().stock[item], stock - 1);
                trades += 2;
                reject(
                    &mut game,
                    Command::SellItem { owner: PLAYER, loc, item: item.clone(), qty: i64::MAX, min_total: None },
                );
            }
            // 使用同一份日上限验证物品消耗与亲密增长；第三份不能再换好感。
            let recipient = defs
                .cast
                .persons
                .iter()
                .find(|p| game.world.person_here(&p.key) && p.audience == Default::default())
                .map(|p| p.key.clone());
            let item = game.world.item_shelf(loc).unwrap().stock.iter().find(|(_, n)| **n >= 3).map(|(k, _)| k.clone());
            if let (Some(person), Some(item)) = (recipient, item) {
                apply(&mut game, Command::BuyItem { owner: PLAYER, loc, item: item.clone(), qty: 3, max_total: None });
                let before = game.world.item_quantity(PLAYER, &item);
                let affinity = game.world.affection(&person).map_or(0, |a| a.affinity);
                let gift = Command::GiveItem { owner: PLAYER, person: person.clone(), item: item.clone(), qty: 1 };
                apply(&mut game, gift.clone());
                apply(&mut game, gift.clone());
                assert_eq!(game.world.item_quantity(PLAYER, &item), before - 2);
                let gain = game.world.affection(&person).unwrap().affinity - affinity;
                assert!(gain <= 20);
                affinity_gained += gain.max(0);
                reject(&mut game, gift);
                gifts += 2;
            }
        }
        let auction = "seville_almoneda";
        let session = game.world.state.auctions.sessions.get(auction).cloned();
        if let Some(s) = session {
            let phase = s.phase(game.day(), defs.auctions.get(auction).unwrap().preview_days);
            if matches!(phase, Phase::Preview | Phase::Open)
                && let Some(lot) = s
                    .lots
                    .iter()
                    .find(|l| l.inspection.is_none() && matches!(l.status, LotStatus::Waiting | LotStatus::Bidding))
            {
                let inspect = Command::InspectLot { owner: PLAYER, auction: auction.into(), lot: lot.key.clone() };
                apply(&mut game, inspect.clone());
                reject(&mut game, inspect);
                inspections += 1;
            }
            if phase == Phase::Open
                && !auction_years.contains(&s.year)
                && let Some(lot) = s.lots.iter().find(|l| l.status == LotStatus::Bidding)
            {
                let max = defs.auctions.get(auction).unwrap().bidders.iter().map(|b| b.budget).max().unwrap_or(0);
                let amount = lot.next_min().max(max + lot.increment);
                let before = game.world.item_quantity(PLAYER, &lot.item);
                let bid = Command::BidAuction { owner: PLAYER, auction: auction.into(), lot: lot.key.clone(), amount };
                let cash = game.world.agent(PLAYER).unwrap().cash;
                apply(&mut game, bid.clone());
                assert_eq!(game.world.item_quantity(PLAYER, &lot.item), before + 1);
                assert_eq!(game.world.agent(PLAYER).unwrap().cash, cash - amount);
                reject(&mut game, bid);
                auction_years.insert(s.year);
                purchases += 1;
            }
        }
        let previous = money(&game.world);
        game.advance_day().unwrap();
        check_money(&game.world, previous);
        if day == 730 {
            let saved = storage::decode(&storage::encode(&game.to_save(), true).unwrap()).unwrap();
            game = GameSession::from_save(defs.clone(), saved).unwrap();
        }
    }
    assert!(trades >= 90 && gifts > 0 && inspections > 0);
    assert!(affinity_gained > 0, "实际发生过正向好感增长，不能以无收益的赠礼充当防刷检查");
    assert_eq!(purchases, 4, "四年四场真实年度拍卖，不能重开同场刷拍品");
    assert_eq!(auction_years.len(), 4);
    println!(
        "1460 日：买卖 {trades}，赠礼 {gifts}（好感增量 {affinity_gained}），鉴定 {inspections}，拍得 {purchases}；逐日来源／去向和全部部门守恒"
    );
}

#[test]
fn graduation_capital_is_once_even_after_reload_and_four_years_at_sea() {
    let defs = defs();
    let mut game = GameSession::new(defs.clone(), ScenarioId(0), 41).unwrap();
    let mut bot = Bot::new(BotKind::Arbitrage);
    let mut days = 0;
    while game.world.upbringing_active() {
        let previous = money(&game.world);
        bot.act(&mut game);
        game.advance_day().unwrap();
        check_money(&game.world, previous);
        days += 1;
        assert!(days <= 1461);
    }
    assert_eq!(days, 1460);
    let granted = game.world.state.money.sources.get(&Flow::UpbringingCapital).copied().unwrap_or(0);
    assert!(granted > 0);
    reject(&mut game, Command::SkipUpbringing { owner: PLAYER });
    let saved = storage::decode(&storage::encode(&game.to_save(), true).unwrap()).unwrap();
    game = GameSession::from_save(defs.clone(), saved).unwrap();
    reject(&mut game, Command::SkipUpbringing { owner: PLAYER });
    for _ in 0..1460 {
        let previous = money(&game.world);
        bot.act(&mut game);
        game.advance_day().unwrap();
        check_money(&game.world, previous);
        assert_eq!(game.world.state.money.sources.get(&Flow::UpbringingCapital).copied().unwrap_or(0), granted);
    }
    assert!(game.log().iter().any(|entry| matches!(entry.command, Command::Autopilot { .. })), "结业后须实际出海");
    println!("养成 {days} 日 + 结业后 1460 日，资本 {granted} 只发一次");
}

#[test]
fn terra16_report_updates_preserve_classic_bytes_and_are_idempotent() {
    let original = "# 平衡\r\n<!-- BALANCE-REPORT-START -->\r\n经典报告\r\n<!-- BALANCE-REPORT-END -->\r\n";
    let first = balance::splice_world_report(original, "寰宇报告\n", "terra16");
    assert!(first.as_bytes().starts_with(original.as_bytes()));
    let second = balance::splice_world_report(&first, "新寰宇报告\n", "terra16");
    assert!(second.as_bytes().starts_with(original.as_bytes()));
    assert_eq!(balance::splice_world_report(&second, "新寰宇报告\n", "terra16"), second);
    assert_eq!(
        balance::splice_world_report(original, "经典更新\n", "classic"),
        balance::splice_report(original, "经典更新\n")
    );
}

#[test]
fn real_item_prices_cannot_become_an_unlimited_buy_sell_cycle() {
    let game = auction_fixture();
    let d = game.defs();
    for loc in d.loc_ids().filter(|id| d.loc(*id).shop) {
        for item in &d.items.items {
            assert!(
                game.world.item_buy_price(PLAYER, loc, &item.key).expect("真实条目买价")
                    >= game.world.item_sell_price(&item.key).expect("真实条目卖价"),
                "{} {:?}",
                item.key,
                loc
            );
        }
    }
    assert!(
        game.world.at_item_shop(PLAYER, LocId::from_idx(d.locations.iter().position(|l| l.key == "seville").unwrap()))
    );
}
