//! T02 追查：手动航行的世界里，规划器按所知行情挑卖点，可能挑到玩家还没见过的港口（引航以
//! “目的地不可见”拒绝）。以前套利 bot 就此带着货停在港里、一天天付工资，几个月甚至几年不动
//! （寰宇自由航海 种子 42：第 156 天起在塞维利亚停 56 天、在加的斯停到年底，种子 5 也是去马拉加被拒）。
//! 修好以后，bot 带着货停港不动的日子不该连着超过一个月，带着货不卖的日子也不该超过三个月。
use manifest_core::OwnerId;
use manifest_core::info::InfoMode;
use manifest_sim::{Bot, BotKind, GameSession, balance};
use std::collections::BTreeMap;

#[test]
fn arbitrage_bot_never_sits_in_port_with_cargo_for_a_month() {
    let defs =
        manifest_data::load_world(&std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data"), "terra16")
            .expect("真实寰宇");
    assert!(defs.manual_navigation, "寰宇是手动航行的世界");
    let scenario = balance::default_scenario(&defs).unwrap();
    let mut session = GameSession::new(defs.clone(), scenario, 42).unwrap();
    session.choose_info(InfoMode::Carried).unwrap();
    let mut bot = Bot::new(BotKind::Arbitrage);
    // 每支船队：连续带货停在同一个港的天数
    let mut streak: BTreeMap<_, (Option<manifest_core::LocId>, u32)> = BTreeMap::new();
    let mut worst = 0u32;
    // 船上有货、却一直没卖出过的天数（不论在港还是在海上；防止在几个看得见的港口间来回跑）
    let (mut unsold, mut worst_unsold) = (0u32, 0u32);
    for _ in 0..240 {
        let first = session.log().len();
        bot.act(&mut session);
        let sold = session.log()[first..].iter().any(|e| matches!(e.command, manifest_core::Command::Sell { .. }));
        let loaded = session.world.fleets_of(OwnerId::Player).any(|f| f.cargo.values().any(|q| *q > 0));
        unsold = if sold || !loaded { 0 } else { unsold + 1 };
        worst_unsold = worst_unsold.max(unsold);
        for f in session.world.fleets_of(OwnerId::Player) {
            let stuck = f.docked_at().filter(|_| f.cargo.values().any(|q| *q > 0));
            let e = streak.entry(f.id).or_insert((None, 0));
            match stuck {
                Some(loc) if e.0 == Some(loc) => e.1 += 1,
                Some(loc) => *e = (Some(loc), 1),
                None => *e = (None, 0),
            }
            worst = worst.max(e.1);
        }
        session.advance_day().unwrap();
        assert!(session.world.money_conserved());
    }
    println!("带货停港最长连续 {worst} 天；带货不卖最长 {worst_unsold} 天");
    assert!(worst < 30, "套利 bot 带货在港里停了 {worst} 天");
    assert!(worst_unsold < 90, "套利 bot 带着货 {worst_unsold} 天没卖出过");
}
