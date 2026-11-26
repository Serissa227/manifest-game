//! 图鉴跨会话与世界隔离，已解锁集合不改变新局的世界状态。
use manifest_ai::MemoryKeyStore;
use manifest_appcore::{AppPaths, AppState, handlers};
use manifest_core::{Command, OwnerId};
use serde_json::json;
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
fn directory(label: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "manifest-a6-{label}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    ))
}
fn state(dir: &Path) -> AppState {
    AppState::from_data_dir(
        &manifest_data::find_data_dir().unwrap(),
        Arc::new(MemoryKeyStore::default()),
        AppPaths::in_dir(dir),
    )
    .unwrap()
}
fn start(st: &AppState) {
    handlers::new_world_game(
        st,
        serde_json::from_value(json!({"world":"testbed","scenario":"upbringing","seed":42})).unwrap(),
    )
    .unwrap();
}
#[test]
fn endings_survive_restarting_the_app_without_entering_the_world_hash() {
    let dir = directory("endings");
    let st = state(&dir);
    assert!(handlers::pending::endings(&st).is_err());
    start(&st);
    let fresh_hash = handlers::debug(&st).unwrap().state_hash;
    let initial = handlers::pending::endings(&st).unwrap();
    assert!(initial["endings"].as_array().unwrap().iter().all(|e| e["got"] == false && e["text"].is_null()));
    handlers::submit(&st, Command::SkipUpbringing { owner: OwnerId::Player }).unwrap();
    assert!(handlers::pending::upbringing(&st).unwrap().is_null());
    let hash = handlers::debug(&st).unwrap().state_hash;
    let gallery = handlers::pending::endings(&st).unwrap();
    let rows = gallery["endings"].as_array().unwrap();
    let got = rows.iter().find(|e| e["key"] == "test_ending_navigation").unwrap();
    assert_eq!(got["got"], true);
    assert!(got["text"].is_string());
    assert_eq!(got.as_object().unwrap().len(), 5);
    assert_eq!(handlers::debug(&st).unwrap().state_hash, hash);
    let archived: serde_json::Value =
        serde_json::from_slice(&std::fs::read(dir.join("endings.json")).unwrap()).unwrap();
    assert_eq!(archived["worlds"]["testbed"], json!(["test_ending_navigation"]));
    assert!(archived["worlds"].get("classic").is_none());
    start(&st);
    assert_eq!(handlers::debug(&st).unwrap().state_hash, fresh_hash);
    assert_eq!(handlers::pending::endings(&st).unwrap(), gallery);
    drop(st);
    let restored = state(&dir);
    start(&restored);
    assert_eq!(handlers::debug(&restored).unwrap().state_hash, fresh_hash);
    assert_eq!(handlers::pending::endings(&restored).unwrap(), gallery);
    handlers::new_world_game(
        &restored,
        serde_json::from_value(json!({"world":"classic","scenario":"newcomer","seed":42})).unwrap(),
    )
    .unwrap();
    assert!(handlers::pending::endings(&restored).is_err());
}
#[test]
fn corrupt_gallery_is_reported_and_never_overwritten() {
    let dir = directory("endings-corrupt");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("endings.json"), b"not json").unwrap();
    let st = state(&dir);
    start(&st);
    let hash = handlers::debug(&st).unwrap().state_hash;
    assert!(handlers::pending::endings(&st).is_err());
    assert_eq!(std::fs::read(dir.join("endings.json")).unwrap(), b"not json");
    assert_eq!(handlers::debug(&st).unwrap().state_hash, hash);
}

#[test]
fn pending_upbringing_null_truth_table() {
    let dir = directory("truth");
    let st = state(&dir);
    start(&st);
    let base = st.game().unwrap().as_ref().unwrap().session.world.clone();
    for has_state in [false, true] {
        for action in [false, true] {
            for notices in [false, true] {
                let mut w = base.clone();
                Arc::make_mut(&mut w.defs).rules.upbringing.act.get_or_insert_with(Default::default).enabled = action;
                let s = w.state.upbringing.as_mut().unwrap();
                s.act.on = action;
                if notices {
                    s.unlocks.insert("activity:rest".into(), Some(w.state.day));
                } else {
                    s.unlocks.clear();
                }
                if !has_state {
                    w.state.upbringing = None;
                }
                assert_eq!(w.act_running(), has_state && action);
                {
                    let mut game = st.game().unwrap();
                    let game = game.as_mut().unwrap();
                    game.session.world = w;
                    game.upbringing_unlock_notices = Default::default();
                }
                let view = handlers::pending::upbringing(&st).unwrap();
                println!("has_state={has_state} action={action} notices={notices} null={}", view.is_null());
                assert_eq!(view.is_null(), !has_state);
                if has_state {
                    assert!(view.is_object());
                    assert_eq!(view["unlocked_now"].as_array().unwrap().len(), usize::from(notices));
                }
            }
        }
    }
}
