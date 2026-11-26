//! 启动提速：桌面版的世界包在后台登记、开局目录里的世界在后台预先载入，
//! 列存档不为改写剧本名去载入世界；结果与就地登记、按需载入相同。

use manifest_ai::MemoryKeyStore;
use manifest_appcore::{AppError, AppPaths, AppState, handlers};
use serde_json::json;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// 临时的 data/（不含庞大的寰宇）与用户目录；测试结束时删掉。
struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let id = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("manifest-startup-{}-{id}", std::process::id()));
        fn copy(source: &Path, destination: &Path) {
            std::fs::create_dir_all(destination).unwrap();
            for entry in std::fs::read_dir(source).unwrap() {
                let entry = entry.unwrap();
                if entry.file_name() == "terra16" {
                    continue;
                }
                let target = destination.join(entry.file_name());
                if entry.file_type().unwrap().is_dir() {
                    copy(&entry.path(), &target);
                } else {
                    std::fs::copy(entry.path(), target).unwrap();
                }
            }
        }
        copy(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data"), &dir.join("data"));
        let f = Self(dir);
        // 与 worlds.rs 的坏包夹具相同：格式坏、内容坏、引用坏与一个好世界
        f.write("worlds/broken/world.toml", "key = [");
        f.write(
            "worlds/invalid_data/world.toml",
            "key='invalid_data'\nname='坏内容'\ninherit='testbed'\nhidden=false\n",
        );
        f.write("worlds/invalid_data/goods.toml", "goods = [");
        f.write(
            "worlds/invalid_reference/world.toml",
            "key='invalid_reference'\nname='坏引用'\ninherit='testbed'\nhidden=false\n",
        );
        f.write("worlds/invalid_reference/goods.toml", "goods = []");
        f.write("worlds/good_world/world.toml", "key='good_world'\nname='好世界'\ninherit='testbed'\nhidden=false\n");
        f
    }

    fn write(&self, relative: &str, text: &str) {
        let path = self.0.join("data").join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    fn app(&self, background: bool) -> AppState {
        let (data, keys, paths) =
            (self.0.join("data"), Arc::new(MemoryKeyStore::default()), AppPaths::in_dir(&self.0.join("user")));
        if background {
            AppState::from_data_dir_in_background(&data, keys, paths).unwrap()
        } else {
            AppState::from_data_dir(&data, keys, paths).unwrap()
        }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.0).unwrap();
    }
}

fn error_key(error: AppError) -> &'static str {
    match error {
        AppError::Invalid(msg) => msg.key,
        other => panic!("应返回带键的应用层错误：{other}"),
    }
}

fn request(world: &str, scenario: &str) -> handlers::NewGameRequest {
    serde_json::from_value(json!({ "world": world, "scenario": scenario, "seed": 42 })).unwrap()
}

#[test]
fn background_registration_lists_the_same_worlds_as_registering_in_place() {
    let f = Fixture::new();
    let background = f.app(true);
    // 标题画面先要的几步只用经典世界，不必等世界包登记
    assert_eq!(handlers::static_data(&background).world.key, "classic");
    assert!(handlers::list_saves(&background).unwrap().is_empty());
    let in_place = f.app(false);
    assert_eq!(background.worlds().visible(), in_place.worlds().visible());
    assert_eq!(background.worlds().visible(), ["classic", "good_world", "invalid_reference"]);
    for world in ["broken", "invalid_data", "invalid_reference"] {
        assert_eq!(
            error_key(handlers::select_world(&background, world.into()).unwrap_err()),
            error_key(handlers::select_world(&in_place, world.into()).unwrap_err()),
            "{world}"
        );
    }
    let keys =
        |st: &AppState| handlers::world_catalog(st).unwrap().worlds.into_iter().map(|w| w.key).collect::<Vec<_>>();
    assert_eq!(keys(&background), keys(&in_place));
    assert_eq!(keys(&background), ["classic", "good_world"]);
    assert_eq!(handlers::select_world(&background, "good_world".into()).unwrap().world.key, "good_world");
    let started = handlers::new_world_game(&background, request("good_world", "sandbox")).unwrap();
    let same = handlers::new_world_game(&in_place, request("good_world", "sandbox")).unwrap();
    assert_eq!(handlers::debug(&background).unwrap().state_hash, handlers::debug(&in_place).unwrap().state_hash);
    assert_eq!((started.world_key, started.day), (same.world_key, same.day));
}

#[test]
fn preloading_loads_the_listed_worlds_and_records_broken_ones() {
    let f = Fixture::new();
    let st = f.app(true);
    assert!(st.worlds().loaded("good_world").is_none(), "预先载入之前不载入");
    st.worlds().preload_visible();
    assert!(st.worlds().loaded("good_world").is_some());
    assert!(st.worlds().loaded("testbed").is_none(), "隐藏的世界不预先载入");
    assert!(st.worlds().loaded("invalid_reference").is_none());
    // 载入失败的世界照旧从开局目录里去掉
    assert_eq!(st.worlds().visible(), ["classic", "good_world"]);
}

#[test]
fn listing_saves_does_not_load_worlds_and_tells_when_each_was_written() {
    let f = Fixture::new();
    let first = f.app(false);
    handlers::new_world_game(&first, request("good_world", "sandbox")).unwrap();
    let hash = handlers::debug(&first).unwrap().state_hash;
    handlers::save_game(&first, "voyage").unwrap();
    let meta = std::fs::read_to_string(first.paths().saves_dir.join("voyage.meta.json")).unwrap();
    assert!(!meta.contains("modified"), "写入时刻不写进 meta 文件：{meta}");
    drop(first);

    // 重新启动：列存档（标题画面的“继续”“读档”）不载入存档所在的世界
    let st = f.app(true);
    let saves = handlers::list_saves(&st).unwrap();
    let voyage = saves.iter().find(|s| s.slot == "voyage").expect("存档在列表里");
    assert_eq!(voyage.world_key, "good_world");
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();
    let written = voyage.modified.expect("存档列表给出写入时刻");
    assert!(written <= now + 1 && now.saturating_sub(written) < 3600, "{written} {now}");
    assert!(st.worlds().loaded("good_world").is_none());
    // 读档时才载入；读回来的世界与存档时相同
    assert_eq!(handlers::load_game(&st, "voyage").unwrap().world_key, "good_world");
    assert!(st.worlds().loaded("good_world").is_some());
    assert_eq!(handlers::debug(&st).unwrap().state_hash, hash);
}
