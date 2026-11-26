//! 第 10 节测试 10：保存后读取，状态相等；旧版本样例存档可迁移并加载。

mod common;

use manifest_core::ids::ScenarioId;
use manifest_core::save::{SAVE_VERSION, downgrade_to_v1};
use manifest_sim::{Bot, BotKind, GameSession, storage};
use std::path::PathBuf;

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests").join("fixtures").join(name)
}

fn played(days: u32) -> GameSession {
    let mut s = GameSession::new(common::defs(), ScenarioId(0), 99).unwrap();
    let mut bot = Bot::new(BotKind::Arbitrage);
    for _ in 0..days {
        bot.act(&mut s);
        s.advance_day().unwrap();
    }
    s
}

#[test]
fn save_then_load_restores_identical_state_json_and_zstd() {
    let s = played(120);
    let dir = tempfile::tempdir().unwrap();
    for (name, compress) in [("slot.mfsave", false), ("slot.mfsave.zst", true)] {
        let path = dir.path().join(name);
        storage::write(&path, &s.to_save(), compress).unwrap();
        let back = storage::read(&path).unwrap();
        assert_eq!(back, s.to_save());
        let mut loaded = GameSession::from_save(common::defs(), back).unwrap();
        assert_eq!(loaded.world.state_hash(), s.world.state_hash());
        assert_eq!(loaded.world.state, s.world.state);
        // 读档后继续推进，与不读档的原局保持一致
        let mut original = GameSession::from_save(common::defs(), s.to_save()).unwrap();
        for _ in 0..30 {
            loaded.advance_day().unwrap();
            original.advance_day().unwrap();
        }
        assert_eq!(loaded.world.state_hash(), original.world.state_hash());
        // 读档后的会话仍能只用日志重放出同样的状态
        assert_eq!(loaded.replay().unwrap().state_hash(), loaded.world.state_hash());
    }
    let plain = std::fs::metadata(dir.path().join("slot.mfsave")).unwrap().len();
    let packed = std::fs::metadata(dir.path().join("slot.mfsave.zst")).unwrap().len();
    assert!(packed < plain, "压缩存档应更小（{packed} vs {plain}）");
}

/// 固定版本（v1）的样例存档：迁移后可加载并继续运行。
/// 设置环境变量 MANIFEST_WRITE_FIXTURES=1 可重新生成样例（仅在存档格式或数据发生不兼容变化时使用）。
#[test]
fn legacy_v1_sample_save_migrates_and_loads() {
    let path = fixture("save_v1.mfsave.zst");
    if std::env::var_os("MANIFEST_WRITE_FIXTURES").is_some() {
        let s = played(20);
        let json = s.to_save().to_json().unwrap();
        let v1 = downgrade_to_v1(serde_json::from_str(&json).unwrap()).unwrap();
        let bytes =
            ruzstd::encoding::compress_to_vec(v1.to_string().as_bytes(), ruzstd::encoding::CompressionLevel::Fastest);
        std::fs::write(&path, bytes).unwrap();
    }
    let bytes = std::fs::read(&path).expect("缺少样例存档 tests/fixtures/save_v1.mfsave.zst");
    let save = storage::decode(&bytes).expect("旧版本存档应能迁移");
    assert_eq!(save.version, SAVE_VERSION);
    assert_eq!(save.snapshot.day, 20);
    let mut session = GameSession::from_save(common::defs(), save).expect("迁移后的存档应能加载");
    for _ in 0..30 {
        session.advance_day().unwrap();
    }
    assert_eq!(session.day(), 50);
    manifest_core::testkit::check_invariants(&session.world).unwrap();
}

#[test]
fn corrupted_or_foreign_saves_are_rejected() {
    assert!(storage::decode(b"not json").is_err());
    assert!(storage::decode(br#"{"format":"other","version":1}"#).is_err());
    let future = format!(r#"{{"format":"manifest-save","version":{}}}"#, SAVE_VERSION + 1);
    assert!(storage::decode(future.as_bytes()).is_err());
}
