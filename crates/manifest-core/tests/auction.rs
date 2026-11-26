//! 拍卖状态机的判别测试：稳定抽签、跨年、同价次序、拒绝原子性与真实重放。
use manifest_core::{
    auction::*,
    replay::{LogEntry, Source, StartParams, replay},
    *,
};
use std::sync::Arc;
const OWNER: OwnerId = OwnerId::Player;
fn defs() -> Arc<StaticData> {
    let mut d = (*testkit::tiny_defs()).clone();
    d.rules.money.enabled = true;
    d.items = serde_json::from_value(serde_json::json!({"items":(0..10).map(|i|serde_json::json!({
        "key":format!("item_{i}"),"name":format!("拍品{i}"),"kind":"curio","rarity":1,"price":100,"tags":["voyage"]
    })).collect::<Vec<_>>(),"book_categories":[{"key":"voyage","name":"游记"}]}))
    .unwrap();
    d.auctions.auctions.push(AuctionDef {
        key: "market".into(),
        name: "港口拍卖".into(),
        port: LocId(0),
        month: 2,
        days: 3,
        announcement_days: 20,
        preview_days: 5,
        lots_per_session: [4, 6],
        lore: "预告".into(),
        lots: (0..9)
            .map(|i| LotDef {
                item: format!("item_{i}"),
                reserve: 100,
                increment: 10,
                weight: if i == 0 { 1000 } else { 1 },
                from: (i == 8).then_some(9999),
                authenticity: if i == 0 { Authenticity::Fake } else { Authenticity::Genuine },
                after_loss: "去找得主".into(),
                fake_note: (i == 0).then(|| "查找卖家".into()),
            })
            .collect(),
        bidders: ["beta", "alpha"]
            .map(|key| BidderDef {
                person: key.into(),
                budget: 300,
                likes: vec!["voyage".into()],
                temper: Temper::Collector,
                mood_lines: vec!["举牌".into(), "斟酌".into()],
            })
            .to_vec(),
        specials: vec![SpecialDef {
            item: "item_9".into(),
            year: 1,
            once: true,
            story_hook: "一封来信".into(),
            after_loss: "询问书记".into(),
        }],
    });
    for key in ["alpha", "beta"] {
        d.auctions.people.insert(key.into(), AuctionPerson { name: key.into(), portrait: None });
    }
    Arc::new(d)
}
fn world(d: Arc<StaticData>, seed: u64) -> World {
    World::new(d, ScenarioId(0), seed).unwrap()
}
fn advance(w: &mut World, day: u32) {
    while w.day() < day {
        w.end_day().unwrap();
    }
}
fn session(w: &World) -> &Session {
    &w.state.auctions.sessions["market"]
}
fn bid(w: &World, amount: i64) -> Command {
    Command::BidAuction {
        owner: OWNER,
        auction: "market".into(),
        lot: session(w).lots.iter().find(|l| l.status == LotStatus::Bidding).unwrap().key.clone(),
        amount,
    }
}
fn pass(w: &World) -> Command {
    Command::PassAuction {
        owner: OWNER,
        auction: "market".into(),
        lot: session(w).lots.iter().find(|l| l.status == LotStatus::Bidding).unwrap().key.clone(),
    }
}
#[test]
fn annual_draw_is_seeded_weighted_unique_and_filters_years() {
    let mut a = world(defs(), 42);
    advance(&mut a, 9);
    assert!(a.state.auctions.is_empty());
    advance(&mut a, 10);
    let drawn = session(&a).clone();
    assert_eq!(drawn.phase(10, 5), Phase::Upcoming);
    assert!((4..=6).contains(&drawn.lots.len()));
    assert_eq!(drawn.lots.iter().map(|l| &l.item).collect::<std::collections::BTreeSet<_>>().len(), drawn.lots.len());
    assert!(drawn.lots.iter().any(|l| l.item == "item_0"));
    assert!(!drawn.lots.iter().any(|l| l.item == "item_8"));
    let mut shuffled = (*defs()).clone();
    shuffled.auctions.auctions[0].lots.reverse();
    shuffled.auctions.auctions[0].bidders.reverse();
    let mut b = world(Arc::new(shuffled), 42);
    advance(&mut b, 10);
    assert_eq!(session(&b), &drawn);
    let mut c = world(defs(), 7);
    advance(&mut c, 10);
    assert_ne!(session(&c).lots, drawn.lots);
    advance(&mut a, 25);
    assert_eq!(session(&a).phase(a.day(), 5), Phase::Preview);
    advance(&mut a, 30);
    assert_eq!(session(&a).phase(a.day(), 5), Phase::Open);
    advance(&mut a, 33);
    assert_eq!(session(&a).phase(a.day(), 5), Phase::Closed);
    assert!(session(&a).lots.iter().all(|l| matches!(l.status, LotStatus::Sold | LotStatus::Passed)));
    advance(&mut a, 370);
    assert_eq!(session(&a).year, 2);
    assert_ne!(session(&a).lots[0].key, drawn.lots[0].key);
}
#[test]
fn bids_reject_duplicates_and_low_cash_without_changing_a_byte() {
    let mut w = world(defs(), 42);
    advance(&mut w, 30);
    for command in [
        bid(&w, 99),
        bid(&w, i64::MAX),
        Command::BidAuction { owner: OWNER, auction: "missing".into(), lot: "old".into(), amount: 100 },
    ] {
        let before = w.state.clone();
        assert!(command.apply(&mut w).is_err());
        assert_eq!(w.state, before);
    }
    let command = bid(&w, 100);
    command.apply(&mut w).unwrap();
    let before = w.state.clone();
    assert_eq!(command.apply(&mut w).unwrap_err().code(), "auction.low_bid");
    assert_eq!(w.state, before);
    let amount = w.agent(OWNER).unwrap().cash + 1;
    let command = bid(&w, amount);
    let before = w.state.clone();
    assert_eq!(command.apply(&mut w).unwrap_err().code(), "insufficient_cash");
    assert_eq!(w.state, before);
}
#[test]
fn same_price_tie_is_stable_and_budgets_are_shared_across_lots() {
    let mut d = (*defs()).clone();
    for b in &mut d.auctions.auctions[0].bidders {
        b.budget = 100;
    }
    let mut w = world(Arc::new(d), 42);
    advance(&mut w, 30);
    pass(&w).apply(&mut w).unwrap();
    assert_eq!(session(&w).lots[0].leader.as_deref(), Some("alpha"));
    assert_eq!(session(&w).lots[0].current, Some(100));
    pass(&w).apply(&mut w).unwrap();
    assert_eq!(session(&w).lots[1].leader.as_deref(), Some("beta"));
    pass(&w).apply(&mut w).unwrap();
    assert_eq!(session(&w).lots[2].status, LotStatus::Passed);
    assert_eq!(session(&w).spent.values().sum::<i64>(), 200);
}
#[test]
fn winner_pays_the_local_purse_as_personal_expense_exactly_once() {
    let mut w = world(defs(), 42);
    advance(&mut w, 30);
    let cash = w.agent(OWNER).unwrap().cash;
    let purse = w.purse(LocId(0)).unwrap().money;
    let all = w.all_money();
    let expense = w.agent(OWNER).unwrap().ledger.balance(ledger::Account::OtherExpense);
    let item = session(&w).lots[0].item.clone();
    let cmd = bid(&w, 500);
    cmd.apply(&mut w).unwrap();
    assert_eq!(w.agent(OWNER).unwrap().cash, cash - 500);
    assert_eq!(w.purse(LocId(0)).unwrap().money, purse + 500);
    assert_eq!(w.all_money(), all);
    assert_eq!(w.item_quantity(OWNER, &item), 1);
    assert_eq!(w.agent(OWNER).unwrap().ledger.balance(ledger::Account::OtherExpense), expense + 500);
    let before = w.state.clone();
    assert_eq!(cmd.apply(&mut w).unwrap_err().code(), "auction.not_bidding");
    assert_eq!(w.state, before);
    testkit::check_invariants(&w).unwrap();
}
#[test]
fn preview_inspection_uses_books_and_is_once_per_lot() {
    let mut w = world(defs(), 42);
    advance(&mut w, 25);
    let l = session(&w).lots[0].clone();
    let baseline = w.appraisal_chance(OWNER, &l.item);
    w.state.items.owners.entry(OWNER).or_default().bibliography.insert(
        "voyage_work".into(),
        items::reading::BookRecord { key: "item_1".into(), day: 0, category: "voyage".into() },
    );
    assert_eq!(w.appraisal_chance(OWNER, &l.item), baseline + 1000);
    let cmd = Command::InspectLot { owner: OWNER, auction: "market".into(), lot: l.key.clone() };
    cmd.apply(&mut w).unwrap();
    assert!(session(&w).lots[0].inspection.is_some());
    let before = w.state.clone();
    assert_eq!(cmd.apply(&mut w).unwrap_err().code(), "auction.inspected");
    assert_eq!(w.state, before);
    assert_eq!(
        Command::BidAuction { owner: OWNER, auction: "market".into(), lot: l.key, amount: 100 }
            .validate(&w)
            .unwrap_err()
            .code(),
        "auction.not_open"
    );
}
#[test]
fn specials_need_the_flag_and_are_inserted_once_across_years_and_save() {
    let mut w = world(defs(), 42);
    w.state.story.flags.insert(special_flag("market", "item_9"));
    advance(&mut w, 10);
    assert!(session(&w).lots.iter().any(|l| l.special && l.item == "item_9"));
    assert!((4..=6).contains(&session(&w).lots.len()));
    let mut w =
        World::from_snapshot(w.defs.clone(), serde_json::from_slice(&serde_json::to_vec(&w.state).unwrap()).unwrap())
            .unwrap();
    advance(&mut w, 370);
    assert!(!session(&w).lots.iter().any(|l| l.special));
}
#[test]
fn replay_and_mid_auction_restore_keep_rounds_moods_and_settlement() {
    let d = defs();
    let mut w = world(d.clone(), 42);
    advance(&mut w, 30);
    let first = bid(&w, 100);
    first.apply(&mut w).unwrap();
    let mut restored =
        World::from_snapshot(d.clone(), serde_json::from_slice(&serde_json::to_vec(&w.state).unwrap()).unwrap())
            .unwrap();
    assert_eq!(restored.state, w.state);
    let second = pass(&w);
    second.apply(&mut w).unwrap();
    second.apply(&mut restored).unwrap();
    assert_eq!(restored.state, w.state);
    let log = vec![
        LogEntry { minute: None, tick: 30, seq: 0, source: Source::Player, command: first },
        LogEntry { minute: None, tick: 30, seq: 1, source: Source::Player, command: second },
    ];
    w.end_day().unwrap();
    let replayed = replay(d, StartParams::new(ScenarioId(0), 42), &log, 31).unwrap();
    assert_eq!(replayed.state, w.state);
}
#[test]
fn classic_omits_the_entire_auction_block_and_rejects_unknown_auctions() {
    let w = world(testkit::tiny_defs(), 42);
    let value = serde_json::to_value(&w.state).unwrap();
    assert!(value.get("auctions").is_none());
    assert_eq!(
        Command::PassAuction { owner: OWNER, auction: "market".into(), lot: "old".into() }
            .validate(&w)
            .unwrap_err()
            .code(),
        "auction.unknown"
    );
    let restored = World::from_snapshot(w.defs.clone(), serde_json::from_value(value).unwrap()).unwrap();
    assert_eq!(w.state, restored.state);
}

#[test]
fn snapshot_corruption_is_rejected_and_content_removal_can_be_saved_again() {
    let mut w = world(defs(), 42);
    advance(&mut w, 30);
    bid(&w, 500).apply(&mut w).unwrap();
    let mut broken = w.state.clone();
    broken.auctions.sessions.get_mut("market").unwrap().lots[0].current = Some(-1);
    assert!(World::from_snapshot(w.defs.clone(), broken).is_err());
    let mut broken = w.state.clone();
    broken.auctions.sessions.get_mut("market").unwrap().spent.insert("alpha".into(), -1);
    assert!(World::from_snapshot(w.defs.clone(), broken).is_err());
    let removed = session(&w).lots[0].item.clone();
    let mut d = (*w.defs).clone();
    d.items.items.retain(|i| i.key != removed);
    let restored = World::from_snapshot(Arc::new(d), w.state).unwrap();
    assert_eq!(session(&restored).lots[0].status, LotStatus::Withdrawn);
    let again = World::from_snapshot(restored.defs.clone(), restored.state.clone()).unwrap();
    assert_eq!(restored.state, again.state);
}

#[test]
fn appraisal_attribute_changes_the_check_and_never_invents_a_verdict() {
    use manifest_core::captain::{AttrHook, AttributeDef, Birthday, CaptainProfile, HookDef};
    let mut d = (*defs()).clone();
    d.captain.attributes.push(AttributeDef {
        key: "appraisal".into(),
        name: "鉴定".into(),
        desc: String::new(),
        group: "test".into(),
        hidden: false,
        hooks: vec![HookDef { hook: AttrHook::Appraisal, per_point: 2500, max: None }],
    });
    let mut w = world(Arc::new(d), 42);
    advance(&mut w, 25);
    let item = session(&w).lots[0].item.clone();
    assert_eq!(w.appraisal_chance(OWNER, &item), 2500);
    w.state.agents.get_mut(&OWNER).unwrap().captain = Some(CaptainProfile {
        birthday: Birthday { year: 1484, month: 1, day: 1 },
        sign: String::new(),
        answers: Vec::new(),
        attrs: vec![3],
        genius: None,
        learned: Vec::new(),
        teachers: Vec::new(),
        created: 25,
    });
    assert_eq!(w.appraisal_chance(OWNER, &item), 10000);
    for i in 0..session(&w).lots.len() {
        let lot = session(&w).lots[i].clone();
        let truth = w.defs.auctions.auctions[0].lot(&lot.item, false).unwrap().authenticity;
        Command::InspectLot { owner: OWNER, auction: "market".into(), lot: lot.key }.apply(&mut w).unwrap();
        assert_eq!(session(&w).lots[i].inspection, Some(truth));
    }
}
