//! 所有无人值守 bot 都提交一次缺省养成命令，不跳日、不漏日志。
use manifest_core::{Command, OwnerId, ScenarioId};
use manifest_sim::{
    GameSession,
    bots::{Bot, BotKind},
};

#[test]
fn unattended_bots_skip_once_and_keep_daily_economy_and_replay() {
    let root = manifest_data::find_data_dir().unwrap();
    let defs = manifest_data::load_world(&root, "testbed").unwrap();
    let sid = ScenarioId::from_idx(defs.scenarios.iter().position(|s| s.key == "upbringing").unwrap());
    for kind in BotKind::ALL {
        let mut game = GameSession::new(defs.clone(), sid, 42).unwrap();
        let start = game.day();
        let money = game.world.all_money();
        let mut bot = Bot::new(kind);
        bot.act(&mut game);
        bot.act(&mut game);
        assert_eq!(game.day(), start);
        assert!(game.world.upbringing_skipping());
        assert_eq!(game.log().len(), 1);
        assert!(matches!(game.log()[0].command, Command::SkipUpbringing { owner: OwnerId::Player }));
        for day in 1..=3 {
            bot.act(&mut game);
            game.advance_day().unwrap();
            assert_eq!(game.day(), start + day);
            assert_eq!(game.world.all_money(), money);
            manifest_core::testkit::check_invariants(&game.world).unwrap();
        }
        assert_eq!(game.log().len(), 1);
        assert!(game.world.upbringing_active());
        assert_eq!(game.world.state_hash(), game.replay().unwrap().state_hash());
    }
}
