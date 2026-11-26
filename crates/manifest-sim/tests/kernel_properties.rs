//! 第 10 节测试 1（确定性）、3（账本平衡）、4（货币守恒）、5（非负），使用真实 data/。

mod common;

use manifest_core::ids::ScenarioId;
use manifest_core::testkit::check_invariants;
use manifest_sim::{Bot, BotKind, GameSession};

fn run(seed: u64, days: u32, bot: BotKind, check_every_day: bool) -> GameSession {
    let mut s = GameSession::new(common::defs(), ScenarioId(0), seed).unwrap();
    let mut bot = Bot::new(bot);
    for _ in 0..days {
        bot.act(&mut s);
        s.advance_day().unwrap();
        if check_every_day && let Err(e) = check_invariants(&s.world) {
            panic!("{e}");
        }
    }
    s
}

/// 测试 1：同种子同命令运行 365 天，状态哈希一致。
#[test]
fn test1_determinism_same_seed_same_commands_365_days() {
    let a = run(42, 365, BotKind::Arbitrage, false);
    let b = run(42, 365, BotKind::Arbitrage, false);
    assert!(!a.log().is_empty(), "bot 应当产生命令");
    assert_eq!(a.log(), b.log(), "同种子下 bot 产生的命令相同");
    assert_eq!(a.world.state_hash(), b.world.state_hash());
    // 同一份命令日志在新世界上重放，状态哈希也一致
    let replayed = a.replay().unwrap();
    assert_eq!(replayed.state_hash(), a.world.state_hash());
    // 不同种子得到不同结果
    let c = run(43, 365, BotKind::Arbitrage, false);
    assert_ne!(c.world.state_hash(), a.world.state_hash());
}

/// 测试 3、4、5：一年的完整模拟中，每天都满足账本平衡、货币守恒与非负约束。
#[test]
fn test3_4_5_invariants_hold_every_day_for_a_year() {
    for (seed, bot) in [(1, BotKind::Arbitrage), (2, BotKind::FixedRoute), (3, BotKind::Passive)] {
        let s = run(seed, 365, bot, true);
        assert!(s.world.money_conserved());
        let flows = &s.world.state.money;
        assert!(flows.total_sources() > 0 && flows.total_sinks() > 0, "一年中应有外部资金往来");
    }
}
