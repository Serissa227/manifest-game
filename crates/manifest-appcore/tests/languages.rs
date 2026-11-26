//! 开局目录与静态视图输出同一份语言声明，目录缺译按字段回退。

use manifest_appcore::state::world_registry::WorldRegistry;
use manifest_appcore::{AppPaths, AppState, handlers};
use manifest_data::Locale;
use serde_json::json;
use std::path::{Path, PathBuf};
use std::sync::Arc;

struct Scratch(PathBuf);

impl Scratch {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("manifest-b11-languages-{}", std::process::id()));
        std::fs::create_dir(&path).unwrap();
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn copy(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let dest = to.join(entry.file_name());
        if entry.path().is_dir() {
            copy(&entry.path(), &dest);
        } else {
            std::fs::copy(entry.path(), dest).unwrap();
        }
    }
}

#[test]
fn chinese_world_catalog_and_static_views_share_languages_and_keep_field_fallback() {
    let tmp = Scratch::new();
    copy(&Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data"), tmp.path());
    let base = tmp.path().join("worlds/testbed");
    let path = base.join("world.toml");
    let text = std::fs::read_to_string(&path).unwrap().replace("hidden = true", "hidden = false");
    std::fs::write(path, format!("languages=['zh']\ntagline='中文简介'\nblurb='中文介绍'\n{text}")).unwrap();
    for english in [None, Some("name='English Testbed'\n")] {
        if let Some(english) = english {
            std::fs::write(base.join("locales/en/world.toml"), english).unwrap();
        }
        let registry = WorldRegistry::load(tmp.path()).unwrap();
        let world = registry.get("testbed").unwrap();
        let data_hash = world.defs.meta.hash.clone();
        let runtime = tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_all().build().unwrap();
        let state = AppState::with_registry(
            registry.clone(),
            Arc::new(manifest_ai::MemoryKeyStore::default()),
            AppPaths::in_dir(&tmp.path().join("user")),
            Arc::new(runtime),
        );
        for locale in Locale::ALL {
            let view = world.static_view(locale);
            assert_eq!(view.world.languages, ["zh"]);
            assert_eq!(view.data_hash, data_hash);
            let card = serde_json::to_value(manifest_appcore::views::world_catalog::world_card(world, locale)).unwrap();
            assert_eq!(card["languages"], json!(["zh"]));
            assert_eq!(card["tagline"], "中文简介");
            assert_eq!(card["description"], "中文介绍");
            let name = if locale == Locale::En && english.is_some() { "English Testbed" } else { "框架测试海域" };
            assert_eq!(card["name"], name);
            assert_eq!(view.world.name, name);
            let mut settings = state.settings();
            settings.language = Some(locale);
            handlers::save_settings(&state, settings).unwrap();
            let catalog = serde_json::to_value(handlers::world_catalog(&state).unwrap()).unwrap();
            let card = catalog["worlds"].as_array().unwrap().iter().find(|card| card["key"] == "testbed").unwrap();
            assert_eq!(card["languages"], json!(["zh"]));
            assert_eq!(card["name"], name);
            let selected = serde_json::to_value(handlers::select_world(&state, "testbed".into()).unwrap()).unwrap();
            let current = serde_json::to_value(handlers::static_data(&state)).unwrap();
            for response in [selected, current] {
                assert_eq!(response["world"]["languages"], json!(["zh"]));
                assert_eq!(response["world"]["name"], name);
                assert_eq!(response["data_hash"], data_hash);
            }
            assert_eq!(state.locale(), locale, "按字段回退不改用户语言偏好");
            let classic = handlers::select_world(&state, "classic".into()).unwrap();
            assert_eq!(classic.world.languages, ["zh", "en"]);
        }
        let worlds = serde_json::to_value(manifest_data::list_worlds(tmp.path()).unwrap()).unwrap();
        let listed = worlds.as_array().unwrap().iter().find(|world| world["key"] == "testbed").unwrap();
        assert_eq!(listed["languages"], json!(["zh"]));
        for locale in Locale::ALL {
            assert_eq!(registry.get("classic").unwrap().static_view(locale).world.languages, ["zh", "en"]);
        }
    }
}
