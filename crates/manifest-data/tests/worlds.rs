//! 世界包继承、有效文件、分片、路径边界与经典哈希隔离。

use manifest_data::{WorldError, list_worlds, load_world, resolve_world};
use std::path::{Path, PathBuf};

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data")
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

fn fixture() -> tempfile::TempDir {
    let tmp = tempfile::tempdir().unwrap();
    copy(&root(), tmp.path());
    tmp
}

fn write(root: &Path, rel: &str, text: &str) {
    let path = root.join(rel);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

fn manifest(root: &Path, key: &str, extra: &str) {
    write(
        root,
        &format!("worlds/{key}/world.toml"),
        &format!("key = '{key}'\nname = '测试世界'\ninherit = 'classic'\nmap = 'classic'\n{extra}"),
    );
}

fn value(world: &manifest_data::worlds::EffectiveWorld, file: &str) -> toml::Value {
    toml::from_str(&world.read(file).unwrap()).unwrap()
}

#[test]
fn unrelated_worlds_maps_and_files_do_not_change_classic_or_its_cache() {
    let tmp = fixture();
    let before = manifest_data::load_shared(tmp.path()).unwrap();
    let files = resolve_world(tmp.path(), "classic").unwrap();
    let display_hash = files.hash(true).unwrap();
    assert_eq!(before.meta.hash, "76f354cdd43e6ac99e3f661ed862f7c385b901e73d39df130b420c8284a2be35");
    write(tmp.path(), "worlds/fake/world.toml", "完全损坏的其他世界");
    write(tmp.path(), "maps/fake/map.txt", "完全损坏的其他地图");
    write(tmp.path(), "notes.txt", "与加载无关的笔记");
    let after = load_world(tmp.path(), "classic").unwrap();
    assert_eq!(format!("{before:?}"), format!("{after:?}"), "StaticData 全部字段相等");
    assert!(std::sync::Arc::ptr_eq(&before, &manifest_data::load_shared(tmp.path()).unwrap()));
    assert_eq!(resolve_world(tmp.path(), "classic").unwrap().hash(true).unwrap(), display_hash);
    assert_eq!(after.world_key, "classic");
    assert_eq!(after.map_key, "classic");
}

#[test]
fn testbed_loads_and_is_hidden_from_the_catalog() {
    let defs = load_world(&root(), "testbed").unwrap();
    assert_eq!((defs.world_key.as_str(), defs.map_key.as_str()), ("testbed", "testbed"));
    assert_eq!((defs.map.width, defs.map.height), (120, 60));
    assert_eq!(defs.scenarios.len(), 3);
    assert_eq!(defs.locations.len(), 2);
    assert_eq!(defs.mates.len(), 1);
    assert_eq!(defs.mates[0].key, "sailor");
    assert!(defs.mates[0].hidden, "人物招募复用唯一航海士槽，不能出现在普通酒馆雇佣表");
    let world = resolve_world(&root(), "testbed").unwrap();
    assert!(world.map.as_ref().unwrap().wrap_x);
    assert!(!world.contains("legend.toml"));
    assert!(!world.contains("world/relief.txt"), "不同地图不继承旧图层");
    let worlds = list_worlds(&root()).unwrap();
    // 寰宇 2026-11-02 起进入开局列表；testbed 仍不出现。
    assert_eq!(worlds.iter().map(|w| w.key.as_str()).collect::<Vec<_>>(), ["classic", "terra16"]);
    assert!(worlds.iter().all(|w| w.playable));
    assert_eq!(worlds[0].scenarios.len(), 7);
}

#[test]
fn manual_navigation_is_opt_in_and_classic_stays_route() {
    let tmp = fixture();
    manifest(tmp.path(), "manual_test", "[modules]\nnavigation = 'manual'\n");
    assert!(load_world(tmp.path(), "manual_test").unwrap().manual_navigation);
    assert!(!load_world(tmp.path(), "classic").unwrap().manual_navigation);
    assert!(!load_world(tmp.path(), "testbed").unwrap().manual_navigation);
}

#[test]
fn hide_unknown_ports_module_switch_reaches_navigation_rules() {
    let tmp = fixture();
    for (key, hidden) in [("hide_ports", true), ("show_ports", false)] {
        manifest(tmp.path(), key, &format!("[modules]\nnavigation = 'manual'\nhide_unknown_ports = {hidden}\n"));
        let defs = load_world(tmp.path(), key).unwrap();
        assert!(defs.manual_navigation);
        assert_eq!(defs.navigation.hide_unknown_ports, hidden);
    }
}

#[test]
fn auction_display_headers_remain_display_only_and_protagonists_still_require_birth() {
    let tmp = fixture();
    let defs = load_world(tmp.path(), "testbed").unwrap();
    assert!(defs.auctions.people.contains_key("auction_ada"));
    assert!(defs.scenarios.iter().all(|s| s.protagonist_defs.iter().all(|p| !p.key.starts_with("auction_"))));
    write(
        tmp.path(),
        "worlds/testbed/persons.toml",
        "[[persons]]\nkey='bad_actor'\nname='测试角色'\nkind='protagonist'\ngender='f'\n",
    );
    let error = load_world(tmp.path(), "testbed").unwrap_err().to_string();
    assert!(error.contains("born"), "{error}");
}

#[test]
fn playable_world_items_translate_display_fields_and_reject_gameplay_overrides() {
    use manifest_data::Locale;
    let tmp = fixture();
    let world = resolve_world(tmp.path(), "testbed").unwrap();
    let defs = load_world(tmp.path(), "testbed").unwrap();
    let ai = manifest_data::ai_content::load_world_ai_content(&world).unwrap();
    let load = || manifest_data::locale::load_world_locale_lenient(&world, Locale::En, &defs, &ai);
    let (english, issues) = load();
    assert!(issues.iter().all(|issue| !issue.file.ends_with("items.toml")), "{issues:?}");
    assert!(english.missing.iter().all(|missing| !missing.file.ends_with("items.toml")));
    assert_eq!(english.defs.items.items[0].name, "Test sabre");
    assert_eq!(english.defs.items.book_categories[0].name, "Voyage journals");
    assert_eq!(english.defs.items.sets[0].title, "Test navigator");
    assert_eq!(english.defs.meta.hash, defs.meta.hash);
    let mut restored = english.defs.items.clone();
    for (item, original) in restored.items.iter_mut().zip(&defs.items.items) {
        item.name.clone_from(&original.name);
        item.desc.clone_from(&original.desc);
        item.lore.clone_from(&original.lore);
    }
    for (category, original) in restored.book_categories.iter_mut().zip(&defs.items.book_categories) {
        category.name.clone_from(&original.name);
    }
    for (set, original) in restored.sets.iter_mut().zip(&defs.items.sets) {
        set.name.clone_from(&original.name);
        set.title.clone_from(&original.title);
    }
    assert_eq!(format!("{restored:?}"), format!("{:?}", defs.items), "所有非显示字段保持原样");
    for invalid in [
        "[items.sabre]\nprice=999\n",
        "[items.missing]\nname='Missing'\n",
        "[items.sabre]\nname=''\n",
        "[sets.mariner]\nrequired=1\n",
    ] {
        write(tmp.path(), "worlds/testbed/locales/en/items.toml", invalid);
        let (english, issues) = load();
        assert!(issues.iter().any(|issue| issue.file.ends_with("items.toml")), "{invalid}");
        assert!(!english.missing.is_empty());
        assert_eq!(format!("{:?}", english.defs.items), format!("{:?}", defs.items));
    }
}

#[test]
fn optional_world_catalog_copy_validates_english_and_does_not_inherit_a_parents_title() {
    use manifest_data::Locale;
    let tmp = fixture();
    let before = manifest_data::load_shared(tmp.path()).unwrap();
    manifest(tmp.path(), "azure_sea", "tagline='蔚蓝海域'\nblurb='航行与贸易'\n");
    write(
        tmp.path(),
        "worlds/azure_sea/locales/en/world.toml",
        "name='Azure Sea'\ntagline='Blue horizons'\nblurb='Sailing and trade'\n",
    );
    let world = resolve_world(tmp.path(), "azure_sea").unwrap();
    let en = world.catalog_text(Locale::En).unwrap();
    assert_eq!((&*en.name, &*en.tagline, &*en.blurb), ("Azure Sea", "Blue horizons", "Sailing and trade"));
    let defs = load_world(tmp.path(), "azure_sea").unwrap();
    let ai = manifest_data::ai_content::load_world_ai_content(&world).unwrap();
    let (_, issues) = manifest_data::locale::load_world_locale_lenient(&world, Locale::En, &defs, &ai);
    assert!(issues.is_empty(), "世界英文覆盖是合法文件：{issues:?}");
    write(tmp.path(), "worlds/silver_coast/world.toml", "key='silver_coast'\nname='银色海岸'\ninherit='azure_sea'\n");
    let child = resolve_world(tmp.path(), "silver_coast").unwrap();
    assert!(!child.contains("locales/en/world.toml"));
    assert_eq!(child.catalog_text(Locale::En).unwrap().name, "Silver Coast");
    assert_eq!(child.catalog_text(Locale::ZhCn).unwrap().tagline, "启航探索这个世界");
    for invalid in ["name = 3", "map = 'other'", "name = ["] {
        write(tmp.path(), "worlds/silver_coast/locales/en/world.toml", invalid);
        assert!(matches!(resolve_world(tmp.path(), "silver_coast"), Err(WorldError::Invalid { .. })), "{invalid}");
    }
    write(tmp.path(), "worlds/silver_coast/locales/en/world.toml", "name=''\ntagline='   '\n");
    let child = resolve_world(tmp.path(), "silver_coast").unwrap();
    assert_eq!(child.catalog_text(Locale::En).unwrap().name, "Silver Coast");
    assert_eq!(child.catalog_text(Locale::En).unwrap().tagline, "Set sail and explore this world");
    assert_eq!(manifest_data::load_shared(tmp.path()).unwrap().meta.hash, before.meta.hash);
}

#[test]
fn settings_merge_deeply_and_arrays_replace() {
    let tmp = fixture();
    manifest(tmp.path(), "child", "");
    write(
        tmp.path(),
        "worlds/child/rules.toml",
        "[market]\ntarget_stock_days = 99\nprice_curve = [[0.0, 4.0], [9.0, 0.2]]\n",
    );
    write(tmp.path(), "worlds/child/texts.toml", "[example]\nnew = '新文字'\n");
    let w = resolve_world(tmp.path(), "child").unwrap();
    let merged = value(&w, "rules.toml");
    let original = value(&resolve_world(tmp.path(), "classic").unwrap(), "rules.toml");
    assert_eq!(merged["market"]["target_stock_days"].as_integer(), Some(99));
    assert_eq!(merged["market"]["price_floor"], original["market"]["price_floor"]);
    assert_eq!(merged["market"]["price_curve"].as_array().unwrap().len(), 2);
    assert_eq!(w.files["rules.toml"].sources.len(), 2);
    let defs = load_world(tmp.path(), "child").unwrap();
    assert_eq!(defs.rules.target_stock_days, 99);
}

#[test]
fn captain_settings_and_effect_boundaries_merge_but_entry_arrays_replace() {
    let tmp = fixture();
    manifest(tmp.path(), "child", "");
    let classic = resolve_world(tmp.path(), "classic").unwrap();
    for file in ["captain.toml", "effects.toml"] {
        let mut base = value(&classic, file);
        let table = base.as_table_mut().unwrap();
        let array_key = table.iter().find(|(_, v)| v.is_array()).unwrap().0.clone();
        let key = table.iter().find(|(_, v)| v.is_table()).unwrap().0.clone();
        let nested = table[&key].as_table().unwrap();
        let field = nested.keys().next().unwrap().clone();
        let replacement = nested[&field].clone();
        let patch = toml::Table::from_iter([
            (array_key.clone(), toml::Value::Array(Vec::new())),
            (key.clone(), toml::Value::Table(toml::Table::from_iter([(field, replacement)]))),
        ]);
        write(tmp.path(), &format!("worlds/child/{file}"), &toml::to_string(&patch).unwrap());
        let w = resolve_world(tmp.path(), "child").unwrap();
        let merged = value(&w, file);
        assert_eq!(merged[&key], base[&key]);
        assert!(merged[&array_key].as_array().unwrap().is_empty());
    }
}

#[test]
fn entry_files_replace_whole_tables_and_locales_fall_back_by_file() {
    let tmp = fixture();
    manifest(tmp.path(), "parent", "");
    write(tmp.path(), "worlds/parent/locales/en/goods.toml", "[[goods]]\nkey = 'grain'\nname = 'Parent grain'\n");
    write(tmp.path(), "worlds/child/world.toml", "key='child'\nname='子世界'\ninherit='parent'\n");
    write(tmp.path(), "worlds/child/mates.toml", "mates = []\n");
    let w = resolve_world(tmp.path(), "child").unwrap();
    assert!(value(&w, "mates.toml")["mates"].as_array().unwrap().is_empty());
    assert!(w.read("locales/en/goods.toml").unwrap().contains("Parent grain"));
    assert!(w.files["locales/en/ships.toml"].sources[0].ends_with("locales/en/ships.toml"));
    write(tmp.path(), "worlds/child/locales/en/goods.toml", "[[goods]]\nkey='grain'\nname='Child grain'\n");
    let child = resolve_world(tmp.path(), "child").unwrap();
    assert!(child.read("locales/en/goods.toml").unwrap().contains("Child grain"));
    assert_eq!(w.hash(false).unwrap(), child.hash(false).unwrap(), "译文不参与模拟哈希");
}

#[test]
fn ordered_fragments_preserve_ids_and_reject_duplicate_keys() {
    let tmp = fixture();
    let original = resolve_world(tmp.path(), "classic").unwrap();
    let mut goods = value(&original, "goods.toml");
    let entries = goods["goods"].as_array_mut().unwrap();
    let rest = entries.split_off(entries.len() / 2);
    write(tmp.path(), "worlds/child/parts/a.toml", &toml::to_string(&goods).unwrap());
    let other = toml::Table::from_iter([("goods".to_owned(), toml::Value::Array(rest))]);
    write(tmp.path(), "worlds/child/parts/z.toml", &toml::to_string(&other).unwrap());
    manifest(tmp.path(), "child", "[tables]\ngoods = ['parts/a.toml', 'parts/z.toml']\n");
    let defs = load_world(tmp.path(), "child").unwrap();
    assert_eq!(defs.meta.keys.goods, manifest_data::load_shared(&root()).unwrap().meta.keys.goods);
    let w = resolve_world(tmp.path(), "child").unwrap();
    assert_eq!(w.files["goods.toml"].sources.len(), 2);
    write(tmp.path(), "worlds/child/parts/z.toml", &toml::to_string(&goods).unwrap());
    assert!(matches!(resolve_world(tmp.path(), "child"), Err(WorldError::DuplicateKey { .. })));
}

#[test]
fn inherited_fragments_keep_their_original_base_and_order() {
    let tmp = fixture();
    manifest(tmp.path(), "parent", "[tables]\nitems=['parts/z.toml','parts/a.toml']\n");
    write(tmp.path(), "worlds/parent/parts/z.toml", "[[items]]\nkey='z'\n");
    write(tmp.path(), "worlds/parent/parts/a.toml", "[[items]]\nkey='a'\n");
    write(tmp.path(), "worlds/child/world.toml", "key='child'\nname='子世界'\ninherit='parent'\n");
    let w = resolve_world(tmp.path(), "child").unwrap();
    assert_eq!(value(&w, "items.toml")["items"][0]["key"].as_str(), Some("z"));
    assert!(w.files["items.toml"].sources[0].ends_with("worlds/parent/parts/z.toml"));
}

#[test]
fn a_child_can_override_a_named_scenario_fragment_without_reordering_it() {
    let tmp = fixture();
    manifest(tmp.path(), "parent", "[tables]\nscenarios=['scenarios/z.toml','scenarios/a.toml']\n");
    for (file, key) in [("z", "first"), ("a", "second")] {
        write(
            tmp.path(),
            &format!("worlds/parent/scenarios/{file}.toml"),
            &format!("key='{key}'\nname='父剧本'\nstart='chenggang'\n"),
        );
    }
    write(tmp.path(), "worlds/child/world.toml", "key='child'\nname='子世界'\ninherit='parent'\n");
    write(tmp.path(), "worlds/child/scenarios/z.toml", "key='replacement'\nname='子剧本'\nstart='chenggang'\n");
    let scenarios = resolve_world(tmp.path(), "child").unwrap().scenarios().unwrap();
    assert_eq!(scenarios.iter().map(|s| s.key.as_str()).collect::<Vec<_>>(), ["replacement", "second"]);
}

#[test]
fn only_effective_sources_and_the_selected_map_affect_world_hashes() {
    let tmp = fixture();
    manifest(tmp.path(), "child", "");
    write(tmp.path(), "worlds/child/mates.toml", "mates=[]\n");
    let hash = resolve_world(tmp.path(), "child").unwrap().hash(false).unwrap();
    write(tmp.path(), "mates.toml", "损坏但已被子世界替换的内容");
    write(tmp.path(), "maps/testbed/mapgen.toml", "seed=100\n");
    assert_eq!(resolve_world(tmp.path(), "child").unwrap().hash(false).unwrap(), hash);
    write(tmp.path(), "worlds/child/mates.toml", "# 改动实际读取的文件\nmates=[]\n");
    assert_ne!(resolve_world(tmp.path(), "child").unwrap().hash(false).unwrap(), hash);
}

#[test]
fn cycles_missing_maps_unknown_worlds_and_duplicate_world_keys_are_errors() {
    let tmp = fixture();
    assert!(matches!(load_world(tmp.path(), "missing"), Err(WorldError::UnknownWorld(_))));
    write(tmp.path(), "worlds/a/world.toml", "key='a'\nname='甲'\ninherit='b'\n");
    write(tmp.path(), "worlds/b/world.toml", "key='b'\nname='乙'\ninherit='a'\n");
    assert!(matches!(resolve_world(tmp.path(), "a"), Err(WorldError::InheritanceCycle(_))));
    write(tmp.path(), "worlds/a/world.toml", "key='a'\nname='甲'\ninherit='classic'\nmap='missing'\n");
    assert!(matches!(resolve_world(tmp.path(), "a"), Err(WorldError::MissingMap(_))));
    write(tmp.path(), "worlds/b/world.toml", "key='a'\nname='重复'\ninherit='classic'\n");
    assert!(matches!(list_worlds(tmp.path()), Err(WorldError::DuplicateKey { .. })));
}

#[test]
fn paths_cannot_escape_the_world_or_data_root() {
    let tmp = fixture();
    for path in ["../goods.toml", "/goods.toml", "C:/goods.toml", "parts/../../goods.toml", "parts\\evil.toml"] {
        manifest(tmp.path(), "child", &format!("[tables]\nitems=['{path}']\n"));
        assert!(matches!(resolve_world(tmp.path(), "child"), Err(WorldError::UnsafePath(_))), "{path}");
    }
    for key in ["../classic", "/classic", "C:/classic"] {
        assert!(matches!(resolve_world(tmp.path(), key), Err(WorldError::UnsafePath(_))));
    }
}

#[test]
fn broken_overrides_and_map_dimensions_are_rejected() {
    let tmp = fixture();
    manifest(tmp.path(), "child", "");
    write(tmp.path(), "worlds/child/rules.toml", "market = '坏类型'\n");
    assert!(load_world(tmp.path(), "child").unwrap_err().to_string().contains("类型"));
    let path = tmp.path().join("maps/testbed/map.toml");
    let text = std::fs::read_to_string(&path).unwrap().replace("width = 120", "width = 121");
    std::fs::write(path, text).unwrap();
    assert!(load_world(tmp.path(), "testbed").unwrap_err().to_string().contains("尺寸"));
}

#[test]
fn scenario_dates_and_extensions_are_parsed_without_changing_legacy_start_location() {
    let tmp = fixture();
    let path = tmp.path().join("worlds/testbed/scenarios/sandbox.toml");
    let text = std::fs::read_to_string(&path).unwrap().replace("start = \"test_west\"", "start = [1553, 1, 1]\nstart_loc = 'test_west'\ncontrol = [1557, 1, 1]\nprotagonists = ['noel']\ncustom = { templates = ['orphan'] }\nupbringing = true\ntimeline = 'main'").replace("ships = [\"swallow\"]", "ships = []").replace("crew = 14", "crew = 0");
    std::fs::write(&path, &text).unwrap();
    let w = resolve_world(tmp.path(), "testbed").unwrap();
    let scenarios = w.scenarios().unwrap();
    assert_eq!(scenarios[0].start_date, Some([1553, 1, 1]));
    assert_eq!(scenarios[0].control_date, Some([1557, 1, 1]));
    assert_eq!(scenarios[0].custom.templates, ["orphan"]);
    assert!(scenarios[0].upbringing);
    let family_path = tmp.path().join("worlds/testbed/upbringing/common.toml");
    let mut family = std::fs::read_to_string(&family_path).unwrap();
    family.push_str(
        r#"
[[families]]
key = "metadata_family"
name = "占位"
scenario = "sandbox"
home = "test_west"
born = [1540,6,1]
gender = "f"
graduation = [1558,1,1]
stages = [{from=[1553,1,1],stage="home",name="占位",at="test_west"}]
"#,
    );
    std::fs::write(&family_path, family).unwrap();
    let defs = load_world(tmp.path(), "testbed").unwrap();
    assert_eq!(defs.locations[defs.scenarios[0].start.idx()].key, "test_west");
    std::fs::write(&path, text.replace("start_loc = 'test_west'", "")).unwrap();
    assert!(load_world(tmp.path(), "testbed").unwrap_err().to_string().contains("start_loc"));
}

#[test]
fn calendars_load_from_world_metadata_and_inherit_without_changing_classic() {
    use manifest_core::calendar::{Calendar, Date, Season};
    let tmp = fixture();
    manifest(
        tmp.path(),
        "parent",
        "[calendar]\nera='公元'\nmonths=[31,28,31,30,31,30,31,31,30,31,30,31]\nseasons=[3,3,0,0,0,1,1,1,2,2,2,3]\n",
    );
    write(
        tmp.path(),
        "worlds/child/world.toml",
        "key='child'\nname='子世界'\ninherit='parent'\n[calendar]\nera='测试纪年'\n",
    );
    let defs = load_world(tmp.path(), "child").unwrap();
    assert_eq!(defs.calendar.year_days(), 365);
    assert_eq!(defs.calendar.era(), "测试纪年");
    assert_eq!(defs.calendar.date_of(59), Date { year: 1, month: 3, day: 1 });
    assert_eq!(defs.calendar.season_of(0), Season::Winter);
    let classic = load_world(tmp.path(), "classic").unwrap();
    assert_eq!(classic.calendar, Calendar::default());
    assert_eq!(classic.meta.hash, "76f354cdd43e6ac99e3f661ed862f7c385b901e73d39df130b420c8284a2be35");
}

#[test]
fn invalid_calendar_settings_and_impossible_scenario_dates_fail_loading() {
    let tmp = fixture();
    for fields in ["months=[]", "months=[0]", "seasons=[9]", "month_names=['孤月']", "era=''", "leap='julian'"] {
        manifest(tmp.path(), "child", &format!("[calendar]\n{fields}\n"));
        assert!(load_world(tmp.path(), "child").is_err(), "{fields}");
    }
    let path = tmp.path().join("worlds/testbed/scenarios/sandbox.toml");
    let text = std::fs::read_to_string(&path)
        .unwrap()
        .replace("start = \"test_west\"", "start=[1553,2,29]\nstart_loc='test_west'");
    std::fs::write(&path, text).unwrap();
    assert!(load_world(tmp.path(), "testbed").unwrap_err().to_string().contains("日期不存在"));
}

#[test]
fn hidden_incomplete_worlds_do_not_load_resources_during_catalog_enumeration() {
    let tmp = fixture();
    let draft = "key='unfinished'\nname='未完成草稿'\nmap='pending'\nhidden=true\n";
    write(tmp.path(), "worlds/unfinished/world.toml", draft);
    let catalog = list_worlds(tmp.path()).unwrap();
    // 寰宇 2026-11-02 起是成品世界，照常列出；隐藏的未完成包不列出。
    assert_eq!(catalog.iter().map(|w| w.key.as_str()).collect::<Vec<_>>(), ["classic", "terra16"]);
    let all = manifest_data::worlds::all_world_keys(tmp.path()).unwrap();
    assert!(all.iter().any(|key| key == "testbed"));
    assert!(all.iter().any(|key| key == "unfinished"));
    assert!(load_world(tmp.path(), "testbed").is_ok());
    assert!(matches!(load_world(tmp.path(), "unfinished"), Err(WorldError::MissingMap(key)) if key == "pending"));
    // 隐藏只影响目录展示，不能让直接加载绕过地图校验。
    assert!(matches!(resolve_world(tmp.path(), "unfinished"), Err(WorldError::MissingMap(key)) if key == "pending"));
    write(tmp.path(), "worlds/unfinished/world.toml", &draft.replace("hidden=true", "hidden=false"));
    assert!(matches!(list_worlds(tmp.path()), Err(WorldError::MissingMap(key)) if key == "pending"));
}

#[test]
fn hidden_worlds_still_cannot_duplicate_a_declared_key() {
    let tmp = fixture();
    write(tmp.path(), "worlds/duplicate/world.toml", "key='classic'\nname='重复世界'\nhidden=true\n");
    assert!(matches!(list_worlds(tmp.path()), Err(WorldError::DuplicateKey { key, .. }) if key == "classic"));
}

fn draft_fixture() -> tempfile::TempDir {
    let tmp = tempfile::tempdir().expect("草稿检查目录");
    copy(&root().join("worlds/terra16"), &tmp.path().join("worlds/terra16"));
    // B10 的 cameo 要验证经典原身份；只补身份目录，仍不提供地图或经济配置。
    std::fs::copy(root().join("mates.toml"), tmp.path().join("mates.toml")).expect("经典人物来源");
    copy(&root().join("scenarios"), &tmp.path().join("scenarios"));
    // 寰宇 2026-11-02 转为成品世界；草稿检查的夹具把副本恢复成草稿（hidden + draft，草稿不要求地图在场）。
    let manifest = tmp.path().join("worlds/terra16/world.toml");
    let text = std::fs::read_to_string(&manifest).expect("寰宇清单");
    assert!(text.contains("\nhidden = false\n"), "寰宇清单的写法变了，夹具要跟着改");
    std::fs::write(&manifest, text.replacen("\nhidden = false\n", "\nhidden = true\ndraft = true\n", 1))
        .expect("恢复草稿");
    // 后端显示文字表是转为成品世界时才加的，草稿时期没有。
    std::fs::remove_file(tmp.path().join("worlds/terra16/texts.toml")).expect("删去显示文字表");
    std::fs::remove_file(tmp.path().join("worlds/terra16/cast/figures.toml")).expect("草稿不带 FIX8 的立绘辅助目录");
    tmp
}

fn change_draft(tmp: &Path, file: &str, from: &str, to: &str) {
    let path = tmp.join("worlds/terra16").join(file);
    let text = std::fs::read_to_string(&path).expect("源分片");
    assert!(text.contains(from), "{file} 的反例没有匹配 {from}");
    std::fs::write(path, text.replacen(from, to, 1)).expect("写反例");
}

#[test]
fn native_history_references_and_person_fates_are_closed() {
    let tmp = draft_fixture();
    for (file, from, to, symbol) in [
        ("history/main_childhood.toml", "port = \"st_nicholas\"", "port = \"missing_port\"", "ports/missing_port"),
        (
            "history/liaodong.toml",
            "faction = \"later_jin\"",
            "faction = \"missing_faction\"",
            "factions/missing_faction",
        ),
        (
            "history/liaodong.toml",
            "goods = [\"paper\", \"books\"]",
            "goods = [\"missing_good\", \"books\"]",
            "goods/missing_good",
        ),
        ("history/liaodong.toml", "with = \"xie_qingyan\"", "with = \"missing_person\"", "persons/missing_person"),
        (
            "history/liaodong.toml",
            "event = \"l20_haicheng_open_seas\"",
            "event = \"missing_event\"",
            "events/missing_event",
        ),
        (
            "history/liaodong.toml",
            "outcome = \"broad_open_seas\"",
            "outcome = \"missing_outcome\"",
            "history_outcomes/l20_haicheng_open_seas:missing_outcome",
        ),
        ("ideas.toml", "campaign = \"liaodong\"", "campaign = \"missing_campaign\"", "campaigns/missing_campaign"),
        (
            "cast/historical_01_europe.toml",
            "event = \"h49_three_kings\"",
            "event = \"missing_fate\"",
            "events/missing_fate",
        ),
    ] {
        let path = tmp.path().join("worlds/terra16").join(file);
        let original = std::fs::read_to_string(&path).expect("原始数据");
        change_draft(tmp.path(), file, from, to);
        let error = manifest_data::worlds::validate_draft_world(tmp.path(), "terra16")
            .expect_err("必须拒绝缺失的原生历史引用")
            .to_string();
        assert!(error.contains(symbol), "{file}: {error}");
        std::fs::write(path, original).expect("恢复该反例，独立检查下一个引用");
    }
}

#[test]
fn draft_validation_covers_every_fragment_and_reports_references_without_a_map() {
    let tmp = draft_fixture();
    let report = manifest_data::worlds::validate_draft_world(tmp.path(), "terra16").expect("严格草稿检查");
    println!("TCLEAN4 counts: files={} {:?}", report.files.len(), report.counts);
    // 362个既有文件 + E65的5个新表分片及两个固定文件（+7，既有mates.toml改为表登记）+ C9 的 71 片 + C10 六份历史分片与一份思想定义（+7）+ C11 两轮 18 片 = 465；
    // C13 整合（2026-10-26）登记主线、模板小线、NPC 线、主角关系线与请托共 307 片 = 772；
    // C11 收尾（2026-11-01）接回 C7 的 6 条关系线、新写 2 条，加院长人物片与知己关系片（+10）= 782；
    // 十个亚特兰蒂斯补章接回（2026-11-01，+10）= 792；
    // A10（2026-11-02）再登记 18 份提示词与 18 份离线模板（+36），每份都要通过正式 AI 内容的严格检查 = 828；仍逐项核对精确数量。
    // 养成内容（2026-11-03）：九份 <主角>_growth.toml 与七份 <主角>_growth_persons.toml（828 → 844）。
    // 合并 G01 的三份商品、一份配方、一份工坊：再加 5 份。
    // U02 工作包 4 的战斗练习 upbringing/common_practices.toml 登记进清单：再加 1 份（849 → 850）。
    // 2026-11-04：U04 的年度目标卡、解锁练习登记回清单，加低谷场景、比赛奖品与三份改投学院的事件（澪能岛两份、莉芙印书圈一份），+7 = 857。
    // S01（2026-11-11）：出海后的奇遇两份（stories/encounters_sea.toml、encounters_port.toml；旧式故事文件，没有 tracks，
    // 按生产加载器的 schema 检查）原 857 → 859；条目另计在 encounters 一项里，不进 tracks。
    // I01（2026-11-11）：新物品九个分片（items_*_02 / _03）再加 9 = 868。
    // I03（2026-11-11）：寰宇船只改装一个分片（ships/09_refits.toml）再加 1 = 869。
    // H04（2026-11-11）：海上所见一个分片（voyage/sightings.toml）再加 1 = 870。
    // H08（2026-11-11）：甲板闲话一个分片（voyage/banter.toml）再加 1 = 871。
    // G02（2026-11-11）：交易品扩充的商品分片与来源配方分片，再加 2 = 873。
    // H02（2026-11-11）：船员情绪的三阶段一个分片（stories/voyage_crew.toml，旧式奇遇文件）再加 1 = 874。
    // S02nZ：按合入主线后的实际分片与固定文件清单更新计数。
    // U06K / U06C / U07 / Q01：当前 880 个登记分片与 10 个固定文件。
    // 公开版拿掉两个人物以后少 17 份：890 → 873。
    assert_eq!(report.files.len(), 873);
    // H02（2026-11-11）：船员情绪的三阶段各三套（怨言、怠工、哗变），+9 = 56。
    assert_eq!(report.counts.get("encounters"), Some(&56));
    for (table, count) in [
        ("ports", 194),
        ("cities", 46),
        ("roads", 56),
        // 公开版拿掉两个人物以后：发现物 100 → 99、人物 611 → 608、物品 951 → 942、船型 37 → 35、
        // 航海士 2 → 0、关系 237 → 227、轨道 6125 → 6089。
        ("discoveries", 99),
        ("sites", 32),
        // 养成内容（2026-11-03）：九位主角的家乡玩伴与诺埃尔的看网老人（594 → 611）。
        ("persons", 608),
        ("past", 53),
        // 2026-11-04：辨识类比赛第 1 名的六件新奖品（731 → 737）。
        ("items", 942),
        ("sets", 18),
        ("auctions", 5),
        // G02（2026-11-11）：交易品扩充 60 种（159 → 219）。
        ("goods", 219),
        ("ships", 35),
        ("mates", 0),
        // 关系 166 条 + C7 整合：拆段 15 条、新线 53 条；轨道 = A6 第二轮的养成短事件与缺文占位 1251 + C7 的 153 个故事分片 249 + 后续各包 = 5428；
        // C13 整合（2026-10-26）新登记的 307 片里有 386 条轨道（主线与旁轨、18 条地区轨道、NPC 脊轨与交汇旁轨、关系线、请托）= 5814；
        // 收尾修正删去 kaicili 的两条探亲轨道（5814 → 5812）。
        // C11 收尾（2026-11-01）：关系 234 → 237；轨道加接回的 6 条与新写的 2 条（5812 → 5820）。
        // 十个亚特兰蒂斯补章各一条轨道（5820 → 5830），外加 main_mio 末尾的旁轨 main_mio_fan_left
        // （扇子留在律法柱下的局顶替 c07 / c10，5830 → 5831）。
        // 养成内容（2026-11-03）：九位主角的新手旬、家乡玩伴、书信、年度大事、第一次远足与澪的失败后续（5831 → 5932）。
        ("ties", 227),
        // 2026-11-04：改投学院的两件改投事件与能岛版 52 条、印书圈版 20 条，加三段低谷场景（5932 → 6009）。
        // 2026-11-12：剧情增写（docs/STORY-REWRITE.md）九家新增养成人物线 60 条、主线旁轨 25 条（6009 → 6094）。
        ("tracks", 6089),
        ("skills", 100),
        // 养成内容（2026-11-03）：八家年度大事解锁的新活动（420 → 428）。
        // U04 工作包 4（2026-11-03）：每家 7 个随属性、技能、年龄解锁的练习，21 家共 147 个（428 → 575）。
        // U02 工作包 4 的三项战斗练习（common_practices.toml）登记进清单：+3。
        // 2026-11-04：今晚的包不载入 U04 的解锁练习（2755ca2b，数据暂存在 tools/u04/pending/），先减去 147 = 431；
        // 登记回清单后为 578（2026-11-04 文案写好后登记回来）。
        ("activities", 605),
        ("academies", 23),
        ("festivals", 88),
        // 养成内容（2026-11-03）：新轨道里带门槛的（4372 → 4449）。
        // U03 工作包 3：黄墩与苏玛的信路 c9_zhangzhou_giri_letters 补一条学院短事件门槛（4449 → 4450）。
        // 2026-11-04：改投学院的改投事件 2、能岛版 52、印书圈版 20 条门槛（4450 → 4524；低谷场景不进门槛）。
        // 2026-11-12：剧情增写的 60 条养成人物线各带一条门槛（4524 → 4584）。
        ("event_gates", 4584),
        ("excursions", 26),
        ("crafts", 18),
        ("exams", 29),
        ("contests", 30),
        ("endings", 272),
        ("events", 169),
        ("campaigns", 1),
        ("ideas", 16),
        ("idea_ports", 19),
    ] {
        assert_eq!(report.counts[table], count, "{table}");
    }
    // U04 工作包 5（2026-11-03）：年度目标卡，21 家 × 4 年 × 3 张 = 252。
    // 2026-11-04：今晚的包不载入（2755ca2b，数据暂存在 tools/u04/pending/），草稿里一张都没有；登记回清单后改回 252。
    // 文案写好后登记回来，另加改投学院的路线卡 3 张（澪两张、莉芙一张）= 255。
    assert_eq!(report.counts.get("annual_goals"), Some(&255));
    assert!(report.translated_strings > 5000);
    assert!(report.resolved_references > 2000);
    assert!(!report.unresolved.iter().any(|r| r.table == "factions"));
    use manifest_core::cast::metadata::DiagnosticKind;
    // A6 第二轮已支持毕业类条件（含 C7 新线的 14 条恋人段），不再有等 A6 的诊断
    assert_eq!(report.cast_diagnostics.iter().filter(|d| d.kind == DiagnosticKind::WaitingA6).count(), 0);
    // C13 整合（2026-10-26）交付主角卡的 main_track / npc_track 与 C13 的关系线；C11 收尾（2026-11-01）交付最后八条关系线以后，
    // 人物卡与关系引用的轨道全部存在，不再有待交付诊断。
    let pending: std::collections::BTreeSet<_> = report
        .cast_diagnostics
        .iter()
        .filter(|d| d.kind == DiagnosticKind::PendingTrack)
        .map(|d| (d.file.as_str(), d.field.as_str(), d.target.as_str()))
        .collect();
    assert_eq!(pending, std::collections::BTreeSet::new());
    // 未解析的轨道引用用自由船长模板的 main_track（free_captain，scenarios/openings.toml）。
    for (table, key) in [("events", "H13"), ("tracks", "free_captain")] {
        let reference =
            report.unresolved.iter().find(|r| r.table == table && r.key == key).expect("未解析引用必须逐项列出");
        assert!(!reference.file.is_empty() && !reference.item.is_empty() && !reference.field.is_empty());
    }
    assert!(!report.unresolved.iter().any(|r| r.table == "locations" && r.key == "brussels_city"));
    assert_eq!(report.counts["offstage"], 174);
    assert_eq!(report.counts["offstage_regions"], 9);
    assert!(report.unresolved.iter().all(|r| r.table != "goods" && r.table != "ships" && r.table != "items"));
    write(tmp.path(), "maps/earth/map.toml", "故意损坏地图，已提供的资源也必须检查");
    assert!(
        manifest_data::worlds::validate_draft_world(tmp.path(), "terra16").is_err(),
        "B9：草稿不得掩盖已存在的坏地图"
    );
    std::fs::remove_file(tmp.path().join("maps/earth/map.toml")).expect("移除测试坏地图");
    let second = manifest_data::worlds::validate_draft_world(tmp.path(), "terra16").expect("未提供地图的草稿仍可校验");
    assert_eq!(serde_json::to_value(&report).unwrap(), serde_json::to_value(&second).unwrap());
    assert!(matches!(manifest_data::load_world(tmp.path(), "terra16"), Err(manifest_data::WorldError::DraftWorld(_))));
    assert!(manifest_data::list_worlds(tmp.path()).unwrap().iter().all(|world| world.key != "terra16"));
}

#[test]
fn draft_validation_rejects_bad_schema_ranges_dates_and_closed_references() {
    for (file, from, to, reason) in [
        ("ports_iberia.toml", "[[ports]]", "[[ports]]\nunknown_field = true", "未知字段"),
        ("ports_iberia.toml", "[[ports]]", "[[cities]]", "不属于"),
        ("ports_iberia.toml", "lonlat = [", "lonlat = [999,", "lonlat"),
        ("ports_iberia.toml", "supply = ", "supply = -", "supply"),
        ("ports_iberia.toml", "good = \"", "good = \"typo_", "不存在的 goods"),
        ("cast/historical_01_europe.toml", "from = [1553, 1, 1]", "from = [1553, 2, 31]", "date"),
        ("cast/historical_01_europe.toml", "to = [1555, 12, 31]", "to = [1552, 12, 31]", "日程"),
        ("cast/historical_01_europe.toml", "born = [1500, 1, 1]", "born = [-1, 1, 1]", "birth"),
        ("cast/historical_01_europe.toml", "key = \"charles_v\"", "key = \"philip_ii\"", "key 重复"),
        ("cast/historical_01_europe.toml", "history = { born =", "history = { unknown = 1, born =", "未知字段"),
        ("items/books_01_classics.toml", "kind = \"book\"", "kind = \"unknown\"", "kind"),
        ("items/books_01_classics.toml", "category = \"", "category = \"typo_", "不存在的 book_categories"),
        ("auctions.toml", "month = 3", "month = 13", "月份"),
        ("auctions.toml", "item = \"venice_voyage_concession\"", "item = \"missing_lot\"", "不存在的 items"),
    ] {
        let tmp = draft_fixture();
        change_draft(tmp.path(), file, from, to);
        if file == "auctions.toml" && to == "item = \"missing_lot\"" {
            change_draft(
                tmp.path(),
                "locales/en/auctions.toml",
                ".lots.venice_voyage_concession]",
                ".lots.missing_lot]",
            );
            assert_auction_translation_valid(tmp.path());
        }
        let error =
            manifest_data::worlds::validate_draft_world(tmp.path(), "terra16").expect_err("必须拒绝坏草稿").to_string();
        if reason == "不存在的 items" {
            assert!(error.contains("lots.item") && error.contains("items/missing_lot"), "{error}");
        }
        assert!(error.contains(reason), "{file}：{error}，预期 {reason}");
    }
}

#[test]
fn draft_validation_rejects_missing_or_orphan_fragments_and_translations() {
    for (file, from, to, reason) in [
        ("world.toml", "ports = [", "misspelled_ports = [", "schema"),
        ("world.toml", "cities = [\"cities.toml\"]", "cities = [\"ports_iberia.toml\"]", "重复"),
        ("locales/en/cast/historical_01_europe.toml", "name = \"Charles V\"", "name = \"查理五世\"", "英文"),
        (
            "locales/en/cast/historical_01_europe.toml",
            "name = \"Charles V\"",
            "name = \"Charles V\"\nsalary = 999",
            "不能覆盖",
        ),
        ("locales/en/cast/historical_00_past.toml", "lore = ", "unknown_lore = ", "不能覆盖"),
    ] {
        let tmp = draft_fixture();
        change_draft(tmp.path(), file, from, to);
        let error = manifest_data::worlds::validate_draft_world(tmp.path(), "terra16")
            .expect_err("清单和翻译不可漏查")
            .to_string();
        assert!(error.contains(reason), "{file}：{error}");
    }
    for file in ["new_fragment.toml", "items/new_fragment.toml", "locales/en/items/orphan.toml"] {
        let tmp = draft_fixture();
        write(tmp.path(), &format!("worlds/terra16/{file}"), "[[items]]\nkey='orphan'\n");
        let error = manifest_data::worlds::validate_draft_world(tmp.path(), "terra16")
            .expect_err("未登记文件不可漏查")
            .to_string();
        assert!(error.contains("登记"), "{error}");
    }
    // C11 新分片只有中文；此处隔离双语城市分片，防止先报别的缺译文件而未检查 cities。
    let tmp = tempfile::tempdir().unwrap();
    let source: toml::Value =
        toml::from_str(&std::fs::read_to_string(root().join("worlds/terra16/world.toml")).unwrap()).unwrap();
    let art = toml::Value::Table(toml::Table::from_iter([("art".into(), source["art"].clone())]));
    write(
        tmp.path(),
        "worlds/terra16/world.toml",
        &format!(
            "key='terra16'\nname='双语城市校验'\nmap='missing'\ndraft=true\nlanguages=['zh','en']\n[tables]\ncities=['cities.toml']\n{}",
            toml::to_string(&art).unwrap()
        ),
    );
    for file in ["cities.toml", "locales/en/cities.toml"] {
        write(
            tmp.path(),
            &format!("worlds/terra16/{file}"),
            &std::fs::read_to_string(root().join("worlds/terra16").join(file)).unwrap(),
        );
    }
    manifest_data::worlds::validate_draft_world(tmp.path(), "terra16").expect("独立双语城市夹具应完整");
    std::fs::remove_file(tmp.path().join("worlds/terra16/locales/en/cities.toml")).unwrap();
    assert!(
        manifest_data::worlds::validate_draft_world(tmp.path(), "terra16")
            .unwrap_err()
            .to_string()
            .contains("cities.toml")
    );
}

#[test]
fn complete_worlds_cannot_use_the_draft_validator() {
    assert!(
        manifest_data::worlds::validate_draft_world(&root(), "classic").unwrap_err().to_string().contains("完整世界")
    );
    let tmp = fixture();
    write(tmp.path(), "maps/testbed/map.txt", "坏地图");
    assert!(manifest_data::load_world(tmp.path(), "testbed").is_err());
    assert!(manifest_data::worlds::validate_draft_world(tmp.path(), "testbed").is_err());
}

#[test]
fn draft_validation_rejects_registered_fragments_overwritten_by_a_logical_alias() {
    let tmp = draft_fixture();
    change_draft(tmp.path(), "world.toml", "[tables]", "[tables]\noverseas = [\"junk.toml\"]");
    write(tmp.path(), "worlds/terra16/junk.toml", "[[unknown_table]]\nkey='junk'\n");
    let error = manifest_data::worlds::validate_draft_world(tmp.path(), "terra16")
        .expect_err("sites 不能掩盖 overseas 分片")
        .to_string();
    assert!(error.contains("junk.toml") && error.contains("未被消费"), "{error}");
}

#[test]
fn draft_validation_allows_a_child_to_replace_inherited_fragments() {
    let tmp = tempfile::tempdir().expect("继承草稿目录");
    write(
        tmp.path(),
        "worlds/parent/world.toml",
        "key='parent'\nname='父世界'\nmap='missing'\ndraft=true\n[tables]\npast=['old.toml']\n",
    );
    // 父分片缺少英文，也缺少作者字段；被整个替换后不参与子世界校验。
    write(tmp.path(), "worlds/parent/old.toml", "[[past]]\nkey='old'\n");
    assert!(manifest_data::worlds::validate_draft_world(tmp.path(), "parent").is_err());
    write(
        tmp.path(),
        "worlds/child/world.toml",
        "key='child'\nname='子世界'\ninherit='parent'\ndraft=true\n[tables]\npast=['new.toml']\n",
    );
    write(
        tmp.path(),
        "worlds/child/new.toml",
        "[[past]]\nkey='new'\nname='新往事'\nsources=['旧信']\nlore='信里的往事。'\n",
    );
    write(
        tmp.path(),
        "worlds/child/locales/en/new.toml",
        "[past.new]\nname='New memory'\nlore='A memory preserved in a letter.'\n",
    );
    let report = manifest_data::worlds::validate_draft_world(tmp.path(), "child").expect("允许有效的继承覆盖");
    assert_eq!(report.files, ["worlds/child/new.toml"]);
    assert_eq!(report.counts["past"], 1);
}

#[test]
fn draft_validation_rejects_new_cast_and_upbringing_schema_and_translation_errors() {
    for (file, from, to, reason) in [
        ("cast/protagonists.toml", "birthday = [", "birthday = [99,", "birthday"),
        ("cast/ties.toml", "kind = \"friends\"", "kind = \"typo\"", "kind"),
        ("cast/ties.toml", "no_promise_with_protagonist = [", "no_promise_with_protagonis = [", "未知字段"),
        // 旧 C7 的关系作废后，未知字段与年龄区间的反例改在现有的旗标关系（澪与莉芙、十王会议）上做，检查的意图不变；
        // 毕业类条件归 A6 第二轮，眼下按“等 A6”诊断、不做严格解析，所以不拿它做反例
        (
            "cast/ties.toml",
            "when = { flag = \"atlantis_council_met\" }",
            "when = { flg = \"atlantis_council_met\" }",
            "未知字段",
        ),
        (
            "cast/ties.toml",
            "key = \"mio_wandeng\"",
            "key = \"mio_wandeng\"\nwhen = { persons = [{ person = \"amaia\", age = [18, 1] }] }",
            "age",
        ),
        ("skills.toml", "max_level = 3", "max_level = \"3\"", "max_level"),
        ("upbringing/common_activities.toml", "\"cost\" = 8", "\"cost\" = -8", "cost"),
        (
            "upbringing/academies/antwerp_laurel.toml",
            "\"board\" = false",
            "\"board\" = false\nunknown_field = true",
            "未知字段",
        ),
        ("upbringing/academies/antwerp_laurel.toml", "\"date\" = [1554, 1, 10]", "\"date\" = [1554, 2, 31]", "date"),
        ("locales/en/upbringing/common.toml", "\"text\" = ", "unknown_note = ", "不能覆盖"),
        ("locales/en/cast/protagonists.toml", "rank = \"C\"", "rank = \"B\"", "稳定标识"),
        (
            "locales/en/upbringing/common_activities.toml",
            "[activities.\"lesson_navigation\"]",
            "[activities.\"lesson_navigation\"]\ncost = 0",
            "不能覆盖",
        ),
    ] {
        let tmp = draft_fixture();
        change_draft(tmp.path(), file, from, to);
        let error = manifest_data::worlds::validate_draft_world(tmp.path(), "terra16")
            .expect_err("新登记分片必须严格校验")
            .to_string();
        assert!(error.contains(reason), "{file}：{error}，预期 {reason}");
    }
}

fn assert_auction_translation_valid(root: &Path) {
    let base = root.join("worlds/terra16");
    manifest_data::worlds::validate_draft_translation(
        "auctions.toml",
        &std::fs::read_to_string(base.join("auctions.toml")).expect("拍卖原文"),
        &std::fs::read_to_string(base.join("locales/en/auctions.toml")).expect("拍卖英文"),
    )
    .expect("封闭引用反例的英文须先通过");
}

#[test]
fn draft_validation_rejects_missing_special_item_after_matching_english_key() {
    let tmp = draft_fixture();
    change_draft(
        tmp.path(),
        "auctions.toml",
        "[[auctions.specials]]\nitem = \"legend_ship_plan\"",
        "[[auctions.specials]]\nitem = \"missing_special\"",
    );
    change_draft(tmp.path(), "locales/en/auctions.toml", ".specials.legend_ship_plan]", ".specials.missing_special]");
    assert_auction_translation_valid(tmp.path());
    let error = manifest_data::worlds::validate_draft_world(tmp.path(), "terra16")
        .expect_err("特别拍品必须引用已定义物品")
        .to_string();
    assert!(error.contains("specials.item") && error.contains("不存在的 items/missing_special"), "{error}");
}

#[test]
fn draft_sites_share_the_location_namespace_with_ports_and_cities() {
    for duplicate in ["lisbon", "potosi"] {
        let tmp = draft_fixture();
        change_draft(tmp.path(), "sites.toml", "key = \"site_wonder_naruto\"", &format!("key = \"{duplicate}\""));
        change_draft(
            tmp.path(),
            "locales/en/sites.toml",
            "[sites.site_wonder_naruto]",
            &format!("[sites.{duplicate}]"),
        );
        let error =
            manifest_data::worlds::validate_draft_world(tmp.path(), "terra16").expect_err("港口、城市、地标不能重名");
        assert!(
            matches!(error, manifest_data::WorldError::DuplicateKey { ref file, ref key } if file.ends_with("sites.toml") && key == duplicate),
            "{error}"
        );
    }
}

#[test]
fn draft_location_references_can_resolve_to_sites() {
    let tmp = draft_fixture();
    let path = tmp.path().join("worlds/terra16/roads.toml");
    let mut roads: toml::Value = toml::from_str(&std::fs::read_to_string(&path).expect("道路原文")).expect("道路表");
    roads["roads"][0]["to"] = toml::Value::String("site_wonder_naruto".into());
    std::fs::write(path, toml::to_string(&roads).expect("写道路引用")).expect("道路反例");
    let report = manifest_data::worlds::validate_draft_world(tmp.path(), "terra16").expect("地标应进入地点符号表");
    assert!(
        !report
            .unresolved
            .iter()
            .any(|reference| reference.table == "locations" && reference.key == "site_wonder_naruto")
    );
}
