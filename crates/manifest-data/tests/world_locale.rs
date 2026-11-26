//! 世界语言入口复用既有覆盖校验，目录与条目均来自该世界。
use manifest_data::{Locale, locale};
use std::path::PathBuf;

#[test]
fn effective_classic_locales_preserve_all_existing_display_fields() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data");
    let world = manifest_data::resolve_world(&root, "classic").unwrap();
    let defs = manifest_data::load_shared(&root).unwrap();
    let ai = manifest_data::load_ai_content(&root).unwrap();
    for language in Locale::ALL {
        let old = manifest_data::load_locale(&root, language, &defs, &ai).unwrap();
        let (new, issues) = locale::load_world_locale_lenient(&world, language, &defs, &ai);
        assert!(issues.is_empty(), "{issues:?}");
        assert_eq!(format!("{old:?}"), format!("{new:?}"));
    }
}

#[test]
fn testbed_scenarios_use_world_overrides_and_keep_world_identity() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data");
    let world = manifest_data::resolve_world(&root, "testbed").unwrap();
    let defs = manifest_data::load_world(&root, "testbed").unwrap();
    let ai = manifest_data::ai_content::load_world_ai_content(&world).unwrap();
    let (en, _) = locale::load_world_locale_lenient(&world, Locale::En, &defs, &ai);
    assert_eq!(en.defs.world_key, "testbed");
    assert_eq!(en.defs.meta.hash, defs.meta.hash);
    assert_eq!(en.defs.scenarios.iter().find(|s| s.key == "bootstrap").unwrap().name, "Four Years Later");
    assert_eq!(en.defs.locations.len(), 2);
    assert_eq!(en.defs.calendar, defs.calendar);
    assert_eq!(en.defs.captain.attributes.len(), 10);
}
