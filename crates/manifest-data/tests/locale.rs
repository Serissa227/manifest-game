//! 多语言（EXPANSION.md §12）：语言覆盖文件的加载与校验、英文齐全、只改显示字段、译文不影响数据哈希。

use manifest_data::{Locale, LocaleBundle, load_ai_content, load_locale};
use std::path::{Path, PathBuf};
use std::sync::Arc;

fn data_dir() -> PathBuf {
    manifest_data::find_data_dir().expect("找到 data/")
}

fn copy_dir(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for e in std::fs::read_dir(from).unwrap() {
        let e = e.unwrap();
        let p = e.path();
        let dest = to.join(e.file_name());
        if p.is_dir() {
            copy_dir(&p, &dest);
        } else {
            std::fs::copy(&p, &dest).unwrap();
        }
    }
}

fn en() -> Arc<LocaleBundle> {
    manifest_data::load_locale_shared(&data_dir(), Locale::En).unwrap_or_else(|e| panic!("{e}"))
}

/// 复制一份 data/，改写某个英文覆盖文件（`from` 为空表示整文件替换为 `to`）后加载英文，返回错误文本。
fn broken(rel: &str, from: &str, to: &str) -> String {
    let tmp = tempfile::tempdir().unwrap();
    copy_dir(&data_dir(), tmp.path());
    let path = rel.split('/').fold(tmp.path().join("locales").join("en"), |p, part| p.join(part));
    let text = if from.is_empty() {
        to.to_string()
    } else {
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.contains(from), "样例替换目标“{from}”不在 {rel} 中");
        text.replacen(from, to, 1)
    };
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).unwrap();
    }
    std::fs::write(&path, text).unwrap();
    let defs = manifest_data::load_shared(&data_dir()).unwrap();
    let ai = load_ai_content(&data_dir()).unwrap();
    match load_locale(tmp.path(), Locale::En, &defs, &ai) {
        Ok(_) => panic!("有问题的覆盖文件（{rel}）应被拒绝"),
        Err(e) => e.to_string(),
    }
}

#[test]
fn english_covers_all_current_data() {
    // 双语世界新增显示字段仍须补英文；仅中文草稿按世界声明逐分片检查。
    let b = en();
    let list: Vec<String> = b.missing.iter().map(|m| m.to_string()).collect();
    println!("英文覆盖缺失 {} 条：\n{}", list.len(), list.join("\n"));
    println!("英文覆盖统计 {} 条", manifest_data::coverage(&data_dir(), Locale::En).unwrap().len());
    // 中文就是原数据，永远齐全
    assert!(manifest_data::coverage(&data_dir(), Locale::ZhCn).unwrap().is_empty());
    // 草稿逐物理分片检查 schema、语言声明与已有覆盖的完整性。
    for key in manifest_data::worlds::all_world_keys(&data_dir()).unwrap() {
        let world = manifest_data::resolve_world(&data_dir(), &key).unwrap();
        if world.manifest.draft {
            manifest_data::worlds::validate_draft_world(&data_dir(), &key).unwrap_or_else(|error| panic!("{error}"));
        }
    }
}

#[test]
fn every_data_file_with_display_text_can_be_translated() {
    // 新增带显示文字的数据文件必须登记为可覆盖，英文齐全的检查才覆盖得到它
    let dir = data_dir();
    let defs = manifest_data::load_shared(&dir).unwrap();
    let registered = manifest_data::locale::data_files(&dir, &defs);
    fn walk(root: &Path, d: &Path, out: &mut Vec<String>) {
        for e in std::fs::read_dir(d).unwrap() {
            let p = e.unwrap().path();
            if p.is_dir() {
                walk(root, &p, out);
            } else if p.extension().is_some_and(|x| x == "toml") {
                let rel = p.strip_prefix(root).unwrap();
                out.push(
                    rel.components()
                        .map(|c| c.as_os_str().to_string_lossy().into_owned())
                        .collect::<Vec<_>>()
                        .join("/"),
                );
            }
        }
    }
    let mut files = Vec::new();
    walk(&dir, &dir, &mut files);
    // 本轮只读数据不变；每个世界解析一次，仍逐文件检查登记和译文。
    let mut resolved = std::collections::BTreeMap::new();
    for physical in files {
        // 第九批：物理文件仍逐个检查；新包先映射到它实际采用的逻辑表。
        // 元信息由对应的严格 schema 检查，不能把 maps/ 或 worlds/ 整目录排除。
        let parts: Vec<_> = physical.split('/').collect();
        let f = if parts.len() >= 3 && matches!(parts[0], "maps" | "worlds") {
            let rel = parts[2..].join("/");
            if parts[0] == "maps" && rel == "map.toml" {
                let text = std::fs::read_to_string(dir.join(&physical)).unwrap();
                let metadata: manifest_data::worlds::MapManifest = toml::from_str(&text).unwrap();
                assert_eq!(metadata.key, parts[1]);
                assert!(!metadata.name.trim().is_empty());
                continue;
            }
            if parts[0] == "worlds" && rel == "world.toml" {
                // 完整世界继续检查地图与继承；只允许缺少整个地图包的隐藏草稿
                // 退回严格 schema 与分片清单，不能掩盖已存在地图包的损坏。
                let text = std::fs::read_to_string(dir.join(&physical)).unwrap();
                let world: manifest_data::worlds::WorldManifest = toml::from_str(&text).unwrap();
                assert_eq!(world.key, parts[1]);
                assert!(!world.name.trim().is_empty());
                match manifest_data::resolve_world(&dir, parts[1]) {
                    Ok(effective) => {
                        assert_eq!(effective.manifest.key, parts[1]);
                        assert!(!effective.manifest.name.trim().is_empty());
                    }
                    Err(manifest_data::WorldError::MissingMap(key))
                        if world.hidden && key == world.map && !dir.join("maps").join(&key).exists() => {}
                    Err(error) => panic!("{physical} 完整世界检查失败：{error}"),
                }

                let mut fragments = std::collections::BTreeSet::new();
                for paths in world.tables.values() {
                    assert!(!paths.is_empty(), "{physical} 的条目分片清单不可为空");
                    for fragment in paths {
                        assert!(fragments.insert(fragment), "{physical} 的分片重复: {fragment}");
                        assert!(!fragment.contains(['\\', ':']));
                        assert!(
                            std::path::Path::new(fragment)
                                .components()
                                .all(|c| matches!(c, std::path::Component::Normal(_)))
                        );
                        assert!(
                            dir.join("worlds").join(parts[1]).join(fragment).is_file(),
                            "{physical} 缺少分片 {fragment}"
                        );
                    }
                }
                continue;
            }
            let rel = if parts[0] == "worlds" && !rel.starts_with("locales/") {
                let manifest_path = dir.join("worlds").join(parts[1]).join("world.toml");
                let world: manifest_data::worlds::WorldManifest =
                    toml::from_str(&std::fs::read_to_string(manifest_path).unwrap()).unwrap();
                // 必须由实际 [tables] 声明映射，不能仅按目录名前缀放行未知文件。
                // 历史与故事按物理分片登记翻译 schema，须逐路径核对，不能折叠为总表名。
                world
                    .tables
                    .iter()
                    .find_map(|(table, paths)| {
                        (paths.contains(&rel)
                            && !matches!(table.as_str(), "scenarios" | "stories" | "history" | "templates" | "prompts"))
                        .then(|| format!("{table}.toml"))
                    })
                    .unwrap_or(rel)
            } else {
                rel
            };
            if parts[0] == "maps"
                || matches!(rel.as_str(), "ports.toml" | "cities.toml" | "roads.toml" | "discoveries.toml")
            {
                format!("world/{rel}")
            } else if rel == "sites.toml" {
                "world/overseas.toml".to_owned()
            } else {
                rel
            }
        } else {
            physical.clone()
        };
        // 语言目录、AI 模板与提示词、后端显示文字另有检查
        if f.starts_with("locales/") || f.starts_with("templates/") || f.starts_with("prompts/") || f == "texts.toml" {
            continue;
        }
        // Q01 的引导清单只有稳定键与作者注释；核对实际登记和严格结构，不把它当显示文字。
        if parts.first() == Some(&"worlds") && f == "guide.toml" {
            let world = resolved
                .entry(parts[1].to_owned())
                .or_insert_with(|| manifest_data::resolve_world(&dir, parts[1]).unwrap());
            let rel = parts[2..].join("/");
            assert!(world.manifest.tables["guide"].contains(&rel));
            let source = std::fs::read_to_string(dir.join(&physical)).unwrap();
            let _: manifest_core::story2::guide_defs::GuideDefs = toml::from_str(&source).unwrap();
            continue;
        }
        let scenario_registered = parts.first() == Some(&"worlds") && f.starts_with("scenarios/") && {
            let world = resolved
                .entry(parts[1].to_owned())
                .or_insert_with(|| manifest_data::resolve_world(&dir, parts[1]).unwrap());
            let scenarios = world.scenarios().unwrap();
            assert!(!scenarios.is_empty(), "{physical} 必须解析出有效剧本元信息");
            registered.iter().any(|name| name.starts_with("scenarios/"))
        };
        let draft_fragment_registered = parts.first() == Some(&"worlds")
            && !registered.contains(&f)
            && matches!(
                f.as_str(),
                "persons.toml"
                    | "past.toml"
                    | "items.toml"
                    | "sets.toml"
                    | "auctions.toml"
                    | "ties.toml"
                    | "skills.toml"
                    | "upbringing.toml"
            )
            && {
                let world = resolved
                    .entry(parts[1].to_owned())
                    .or_insert_with(|| manifest_data::resolve_world(&dir, parts[1]).unwrap());
                assert!(world.manifest.draft, "{physical}：完整世界必须走正式的翻译资源登记");
                let rel = parts[2..].join("/");
                let table = f.trim_end_matches(".toml");
                assert!(world.manifest.tables[table].contains(&rel));
                let source = std::fs::read_to_string(dir.join(&physical)).unwrap();
                let raw: toml::Table = toml::from_str(&source).unwrap();
                assert!(!raw.is_empty());
                if table == "upbringing" && raw.contains_key("key") {
                    assert!(raw["key"].is_str() && raw["curriculum"].is_array());
                } else {
                    assert!(raw.iter().all(|(key, value)| {
                        (key == table
                            || (table == "items" && key == "book_categories")
                            || (table == "upbringing"
                                && matches!(
                                    key.as_str(),
                                    "upbringing_rules"
                                        | "ratings"
                                        | "activities"
                                        | "crafts"
                                        | "aspirations"
                                        | "contests"
                                        | "poem_lexicons"
                                        | "endings"
                                        | "vignettes"
                                        | "exams"
                                        | "outings"
                                        | "festivals"
                                )))
                            && value.is_array()
                    }));
                }
                let english = dir.join("worlds").join(parts[1]).join("locales/en").join(rel);
                if english.exists() || world.manifest.requires_english() {
                    manifest_data::worlds::validate_draft_translation(
                        &physical,
                        &source,
                        &std::fs::read_to_string(english).unwrap(),
                    )
                    .unwrap_or_else(|error| panic!("{error}"));
                }
                true
            };
        assert!(
            registered.contains(&f)
                || scenario_registered
                || draft_fragment_registered
                || manifest_data::locale::FILES_WITHOUT_DISPLAY_TEXT.contains(&f.as_str()),
            "data/{f} 没有登记为可翻译的数据文件（见 manifest-data locale/overrides.rs 的 specs）"
        );
    }
    assert!(registered.len() >= 20, "{registered:?}");
}

#[test]
fn overrides_change_display_fields_only() {
    let zh = manifest_data::load_shared(&data_dir()).unwrap();
    let b = en();
    let e = &b.defs;
    // 显示字段换成英文（术语表 EXPANSION.md §12.2）
    assert_eq!(e.rules.world.currency, "gold");
    assert_eq!(e.rules.world.era, "Mariner's Reckoning");
    let name = |key: &str| e.locations.iter().find(|l| l.key == key).map(|l| l.name.clone()).unwrap();
    assert_eq!(name("chenggang"), "Villamare");
    assert_eq!(e.goods[zh.find_good("grain").unwrap().idx()].name, "Grain");
    assert!(e.factions.iter().any(|f| f.name == "Yaohua Empire"));
    // 其余完全相同：条目、顺序、key、数值、位置、数据哈希
    assert_eq!(e.meta.hash, zh.meta.hash);
    assert_eq!(e.meta.keys, zh.meta.keys);
    assert_eq!(e.goods.len(), zh.goods.len());
    for (a, z) in e.goods.iter().zip(&zh.goods) {
        assert_eq!((&a.key, a.base_price, &a.category, a.tier), (&z.key, z.base_price, &z.category, z.tier));
    }
    for (a, z) in e.locations.iter().zip(&zh.locations) {
        assert_eq!((&a.key, a.cell, a.faction, a.development), (&z.key, z.cell, z.faction, z.development));
        let m = |x: &manifest_core::defs::LocationDef| {
            x.market.iter().map(|m| (m.good, m.supply, m.demand)).collect::<Vec<_>>()
        };
        assert_eq!(m(a), m(z));
    }
    for (a, z) in e.ships.iter().zip(&zh.ships) {
        assert_eq!((a.speed, a.capacity, a.guns, a.price), (z.speed, z.capacity, z.guns, z.price));
    }
    assert_eq!(e.rules.world.start_year, zh.rules.world.start_year);
    assert!(Arc::ptr_eq(&e.nav, &zh.nav), "航线表共用");
    // 每个专名都有英文（拉丁字母，不含汉字）
    let cjk = |s: &str| s.chars().any(|c| ('\u{4e00}'..='\u{9fff}').contains(&c));
    for n in e
        .locations
        .iter()
        .map(|l| &l.name)
        .chain(e.factions.iter().map(|f| &f.name))
        .chain(e.mates.iter().map(|m| &m.name))
    {
        assert!(!cjk(n), "专名应有英文：{n}");
    }
    for g in &e.goods {
        assert!(!cjk(&g.name) && !cjk(&g.description), "{}", g.key);
        assert!(!cjk(&b.category(&g.category)), "类别 {}", g.category);
    }
    for s in &e.scenarios {
        assert!(!cjk(&s.name) && !cjk(&s.description), "{}", s.key);
    }
}

#[test]
fn draft_person_and_past_translations_are_exact_and_cannot_change_gameplay() {
    let source = r#"
[[persons]]
key = "historian"
name = "史家"
persona = "只谈已经发生的事情。"
schedule = []
lines = { greet = ["你好", "请坐"], gift_liked = ["多谢", "请登记"], gift_disliked = ["请收回", "无须礼物"] }
[[past]]
key = "voyager"
name = "航海者"
lore = "记在往事里的航程。"
"#;
    let english = r#"
[persons.historian]
name = "Historian"
persona = "Speak only of events that have already happened."
lines = { greet = ["Welcome", "Please sit"], gift_liked = ["Thank you", "Please record it"], gift_disliked = ["Take it back", "No gift is needed"] }
[past.voyager]
name = "Voyager"
lore = "A voyage remembered in the past."
"#;
    let check = |english: &str| manifest_data::worlds::validate_draft_translation("cast/test.toml", source, english);
    assert_eq!(check(english).unwrap(), 10);
    for (from, to) in [
        ("[persons.historian]", "[persons.typo]"),
        ("name = \"Historian\"", "name = \"Historian\"\nschedule = []"),
        ("\"Welcome\", \"Please sit\"", "\"Welcome\""),
        ("\"Welcome\"", "\"你好\""),
        ("name = \"Historian\"", "name = 42"),
        ("lore = \"A voyage remembered in the past.\"", ""),
    ] {
        assert!(english.contains(from));
        let broken = english.replacen(from, to, 1);
        assert!(check(&broken).is_err(), "必须拒绝：{to}");
    }
    assert!(check(&format!("{english}\n[extra]\nname='Unexpected'\n")).is_err());
}

#[test]
fn draft_nested_display_preserves_identifiers_and_leaves_skill_choices_internal() {
    let source = r#"
[[activities]]
key = "lesson"
name = "课堂"
skill_choice = { options = ["lang_arabic", "lang_latin"], xp = 12 }
tiers = [{ name = "入门", branches = [{key = "steady", name = "稳妥", cost = 4}] }]
[[contests]]
key = "verse"
name = "续诗"
params = { lines = [{prompt = "题目", options = ["远帆", "归鸟"]}] }
"#;
    let english = r#"
[activities.lesson]
name = "Lesson"
tiers = [{ name = "Beginner", branches = [{key = "steady", name = "Careful"}] }]
[contests.verse]
name = "Verse"
params = { lines = [{prompt = "Prompt", options = ["Distant sail", "Returning bird"]}] }
"#;
    let check = |text: &str| manifest_data::worlds::validate_draft_translation("nested.toml", source, text);
    assert_eq!(check(english).expect("完整显示覆盖"), 7);
    for (from, to, reason) in [
        ("key = \"steady\"", "key = \"typo\"", "稳定标识"),
        ("name = \"Careful\"", "name = \"Careful\", cost = 0", "不能覆盖"),
        ("options = [\"Distant sail\", \"Returning bird\"]", "options = [\"Distant sail\"]", "列表条数"),
        ("prompt = \"Prompt\", ", "", "缺少英文"),
        ("name = \"Lesson\"", "name = \"Lesson\"\nskill_choice = {options = [\"Arabic\", \"Latin\"]}", "不能覆盖"),
    ] {
        assert!(check(&english.replace(from, to)).expect_err("拒绝坏英文").to_string().contains(reason));
    }
}

#[test]
fn rivers_and_landmarks_are_translated_consistently() {
    // 第五批的河流与地标（world/rivers.toml、world/landmarks.toml）：名字与传说都有英文，只改显示字段
    let zh = manifest_data::load_shared(&data_dir()).unwrap();
    let b = en();
    let (zg, eg) = (&zh.geography, &b.defs.geography);
    assert!(!zg.rivers.is_empty() && !zg.landmarks.is_empty(), "正式数据有河流与地标");
    let cjk = |s: &str| s.chars().any(|c| ('\u{4e00}'..='\u{9fff}').contains(&c));
    assert_eq!(eg.rivers.len(), zg.rivers.len());
    for (a, z) in eg.rivers.iter().zip(&zg.rivers) {
        assert_eq!((&a.key, &a.path, a.width), (&z.key, &z.path, z.width), "只改名字");
        assert!(!cjk(&a.name), "河流 {} 应有英文名：{}", a.key, a.name);
    }
    let river = |key: &str| eg.rivers.iter().find(|r| r.key == key).map(|r| r.name.as_str());
    assert_eq!(river("safira"), Some("Safira River"));
    assert_eq!(river("sere"), Some("Sere River"));
    // 生成器的自动名按规则一一对应：“某河支流N” → “Tributary N of the …”，“某地小河N” → “Brook N of …”（N 为罗马数字）
    const ROMAN: [&str; 11] = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
    const CN: [&str; 11] = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
    let ordinal = |zh_name: &str, word: &str| -> Option<usize> {
        let rest = zh_name.split(word).nth(1)?;
        CN.iter().position(|c| !c.is_empty() && *c == rest)
    };
    let (mut tribs, mut brooks) = (0, 0);
    for (a, z) in eg.rivers.iter().zip(&zg.rivers) {
        if let Some(n) = ordinal(&z.name, "支流") {
            assert!(a.name.starts_with(&format!("Tributary {} of the ", ROMAN[n])), "{} → {}", z.name, a.name);
            tribs += 1;
        } else if let Some(n) = ordinal(&z.name, "小河") {
            assert!(a.name.starts_with(&format!("Brook {} of ", ROMAN[n])), "{} → {}", z.name, a.name);
            brooks += 1;
        }
    }
    assert!(tribs > 0 && brooks > 0, "支流 {tribs} 条、小河 {brooks} 条");
    assert_eq!(river("safira_trib1"), Some("Tributary I of the Safira"));
    // 地标：名字与传说都有英文；与发现物中文同名的，英文也同名
    assert_eq!(eg.landmarks.len(), zg.landmarks.len());
    for (a, z) in eg.landmarks.iter().zip(&zg.landmarks) {
        assert_eq!((&a.key, a.cell, a.size, a.discovery), (&z.key, z.cell, z.size, z.discovery), "只改显示字段");
        assert!(!cjk(&a.name) && !cjk(&a.lore), "地标 {} 应有英文：{} / {}", a.key, a.name, a.lore);
        if let Some(d) = z.discovery
            && zh.discovery(d).name == z.name
        {
            assert_eq!(a.name, b.defs.discovery(d).name, "地标 {} 与发现物同名", a.key);
        }
    }
    let landmark = |key: &str| eg.landmarks.iter().find(|l| l.key == key).unwrap();
    assert_eq!(landmark("north_colossus").name, "Northern Colossus");
    assert!(landmark("south_colossus").lore.contains("the Giant's Gate"));
}

#[test]
fn translations_do_not_change_the_data_hash() {
    let tmp = tempfile::tempdir().unwrap();
    copy_dir(&data_dir(), tmp.path());
    let before = manifest_data::load(tmp.path()).unwrap().meta.hash.clone();
    // 改译文与后端显示文字：数据哈希（进而世界哈希）不变
    let goods = tmp.path().join("locales").join("en").join("goods.toml");
    let text = std::fs::read_to_string(&goods).unwrap();
    std::fs::write(&goods, text.replacen("name = \"Grain\"", "name = \"Wheat\"", 1)).unwrap();
    let texts = tmp.path().join("texts.toml");
    let t = std::fs::read_to_string(&texts).unwrap();
    std::fs::write(&texts, format!("{t}\n# 注释改动\n")).unwrap();
    assert_eq!(manifest_data::load(tmp.path()).unwrap().meta.hash, before);
    // 显示内容随之更新
    let defs = manifest_data::load_shared(tmp.path()).unwrap();
    let ai = load_ai_content(tmp.path()).unwrap();
    let b = load_locale(tmp.path(), Locale::En, &defs, &ai).unwrap();
    assert!(b.defs.goods.iter().any(|g| g.name == "Wheat"));
    // 改原数据会改变数据哈希（对照）
    let zh_goods = tmp.path().join("goods.toml");
    let g = std::fs::read_to_string(&zh_goods).unwrap();
    std::fs::write(&zh_goods, g.replacen("name = \"谷物\"", "name = \"麦子\"", 1)).unwrap();
    assert_ne!(manifest_data::load(tmp.path()).unwrap().meta.hash, before);
}

#[test]
fn missing_entries_fall_back_to_chinese() {
    let tmp = tempfile::tempdir().unwrap();
    copy_dir(&data_dir(), tmp.path());
    let goods = tmp.path().join("locales").join("en").join("goods.toml");
    let text = std::fs::read_to_string(&goods).unwrap();
    let cut = text.replacen("[goods.timber]\nname = \"Timber\"\n", "[goods.timber]\n", 1);
    assert_ne!(cut, text, "样例替换目标应存在");
    std::fs::write(&goods, cut).unwrap();
    // 整个模板文件缺失也回退到中文
    std::fs::remove_file(tmp.path().join("locales").join("en").join("templates").join("bargain.toml")).unwrap();
    let defs = manifest_data::load_shared(tmp.path()).unwrap();
    let ai = load_ai_content(tmp.path()).unwrap();
    let b = load_locale(tmp.path(), Locale::En, &defs, &ai).unwrap();
    let timber = defs.find_good("timber").unwrap().idx();
    assert_eq!(b.defs.goods[timber].name, "木材", "缺少的字段回退到中文");
    assert!(b.defs.goods[timber].description.starts_with("Northern pine"), "其余字段照常覆盖");
    let items: Vec<String> = b.missing.iter().map(|m| format!("{}|{}", m.file, m.item)).collect();
    assert!(items.contains(&"locales/en/goods.toml|goods[timber].name".to_string()), "{items:?}");
    assert!(items.iter().any(|i| i.starts_with("locales/en/templates/bargain.toml|")), "{items:?}");
    assert_eq!(b.templates.bargain, ai.templates.bargain, "议价模板回退到中文");
}

#[test]
fn lenient_loading_skips_stale_overrides() {
    // 原数据删改了条目、译文还没跟上：严格加载报告问题；宽松加载（桌面应用用）跳过有问题的覆盖，其余照常
    let tmp = tempfile::tempdir().unwrap();
    copy_dir(&data_dir(), tmp.path());
    let goods = tmp.path().join("locales").join("en").join("goods.toml");
    let text = std::fs::read_to_string(&goods).unwrap();
    std::fs::write(&goods, format!("{text}\n[goods.unobtainium]\nname = \"Unobtainium\"\n")).unwrap();
    let defs = manifest_data::load_shared(tmp.path()).unwrap();
    let ai = load_ai_content(tmp.path()).unwrap();
    assert!(load_locale(tmp.path(), Locale::En, &defs, &ai).is_err());
    let (b, issues) = manifest_data::load_locale_lenient(tmp.path(), Locale::En, &defs, &ai);
    assert_eq!(issues.len(), 1, "{issues:?}");
    assert!(issues[0].item.contains("unobtainium"));
    assert_eq!(b.defs.goods[defs.find_good("grain").unwrap().idx()].name, "Grain", "其余覆盖照常");
    let (_, shared_issues) = manifest_data::load_locale_shared_lenient(tmp.path(), Locale::En).unwrap();
    assert_eq!(shared_issues.len(), 1);
    assert!(manifest_data::load_locale_shared(tmp.path(), Locale::En).is_err());
}

#[test]
fn unknown_keys_fields_tables_and_files_are_rejected() {
    let e = broken("goods.toml", "[goods.grain]", "[goods.graiin]");
    assert!(e.contains("locales/en/goods.toml") && e.contains("goods[graiin]") && e.contains("没有这个条目"), "{e}");
    let e = broken("goods.toml", "name = \"Grain\"", "name = \"Grain\"\nbase_price = 99");
    assert!(e.contains("字段 base_price 不能覆盖"), "{e}");
    let e = broken("ships.toml", "[refits.hold]", "[refit.hold]");
    assert!(e.contains("没有这张表") && e.contains("refit"), "{e}");
    let e = broken("world/ports.toml", "[ports.chenggang]", "[ports.novamar]");
    assert!(e.contains("ports[novamar]") && e.contains("没有这个条目"), "海外港口不在 world/ports.toml 中：{e}");
    let e = broken("goods.toml", "\"粮食\" = \"Food\"", "\"口粮\" = \"Food\"");
    assert!(e.contains("categories[口粮]"), "{e}");
    let e = broken("colonies.toml", "", "[buildings.farm]\nname = \"Farm\"\n");
    assert!(e.contains("locales/en/colonies.toml") && e.contains("没有对应的原数据文件"), "{e}");
    let e = broken("scenarios/09_missing.toml", "", "name = \"Nowhere\"\n");
    assert!(e.contains("scenarios/09_missing.toml"), "{e}");
    let e = broken("scenarios/01_newcomer.toml", "name = ", "key = \"x\"\nname = ");
    assert!(e.contains("字段 key 不能覆盖"), "{e}");
}

#[test]
fn bad_values_and_syntax_are_rejected() {
    let e = broken("mates.toml", "name = \"Catalina Brisa\"", "name = \"  \"");
    assert!(e.contains("mates[lin_haiyan].name") && e.contains("不能为空"), "{e}");
    let e = broken("factions.toml", "name = \"Kingdom of Esperan\"", "name = 42");
    assert!(e.contains("应为文字"), "{e}");
    let e = broken("rules.toml", "currency = \"gold\"", "currency = \"gold");
    assert!(e.contains("locales/en/rules.toml") && e.contains("TOML 格式错误"), "{e}");
    let e = broken("rules.toml", "era = ", "start_year = 1\nera = ");
    assert!(e.contains("字段 start_year 不能覆盖"), "{e}");
}

#[test]
fn templates_must_match_the_chinese_line_by_line() {
    // 条数与中文不同：无法逐条对应
    let e =
        broken("templates/rumor.toml", "  \"A sailor swears he sold {good} in {loc} for a handsome price.\",\n", "");
    assert!(e.contains("templates/rumor.toml") && e.contains("price_high") && e.contains("条"), "{e}");
    // 不允许的参数
    let e = broken("templates/bargain.toml", "{discount} off for you.", "{good} off for you.");
    assert!(e.contains("rapport") && e.contains("{good}"), "{e}");
    // 中文没有的小节
    let e = broken("templates/chronicle.toml", "opening = [", "prologue = [\"x\"]\nopening = [");
    assert!(e.contains("prologue"), "{e}");
    // 组合事件：未知原型、条数、参数
    let e = broken("templates/composed.toml", "[archetypes.dock_fire]", "[archetypes.dock_fires]");
    assert!(e.contains("archetypes[dock_fires]") && e.contains("没有这个原型"), "{e}");
    let e = broken("templates/composed.toml", "\"Night Blaze in the {loc} Tar Store\"]", "]");
    assert!(e.contains("archetypes[dock_fire].titles"), "{e}");
    let e = broken("templates/composed.toml", "Fire on the {loc} Docks", "Fire on the {region} Docks");
    assert!(e.contains("dock_fire") && e.contains("{region}"), "港口原型没有海区效果：{e}");
    let e = broken("templates/composed.toml", "  \"{date}:\",\n", "");
    assert!(e.contains("sources"), "{e}");
}

#[test]
fn prompts_and_texts_are_checked() {
    let e = broken("prompts/rumor.toml", "Fact: {fact}", "Fact: (none)");
    assert!(e.contains("prompts/rumor.toml") && e.contains("{fact}"), "缺少必需的变量：{e}");
    let e = broken("prompts/rumor.toml", "kind = \"rumor\"", "kind = \"chronicle\"");
    assert!(e.contains("kind"), "{e}");
    let e = broken(
        "texts.toml",
        "player = \"your trading house\"",
        "player = \"your trading house\"\nplayer_alias = \"you\"",
    );
    assert!(e.contains("terms.player_alias") && e.contains("没有这一条"), "{e}");
    let e = broken(
        "texts.toml",
        "Not enough gold: need {need}, have {have}.",
        "Not enough gold: need {need}, have {cash}.",
    );
    assert!(e.contains("errors.insufficient_cash") && e.contains("{cash}"), "{e}");
    let e =
        broken("texts.toml", "seasons = [\"Spring\", \"Summer\", \"Autumn\", \"Winter\"]", "seasons = [\"Spring\"]");
    assert!(e.contains("calendar.seasons") && e.contains("4"), "{e}");
}

#[test]
fn chinese_texts_agree_with_the_kernel() {
    let zh = manifest_data::load_locale_shared(&data_dir(), Locale::ZhCn).unwrap();
    // 效果说明：data/texts.toml 的中文与内核一致
    for (key, text) in manifest_core::summary::HINTS {
        assert_eq!(zh.hint(key), *text, "hints.{key}");
    }
    // 日期与年份：中文格式化与内核的原文逐字相同
    let w = &zh.defs.rules.world;
    for day in [0, 13, 89, 90, 200, 359, 360, 1_000, 7_199] {
        assert_eq!(zh.date_text(day), manifest_core::summary::world_date_text(w, day), "day {day}");
    }
    assert_eq!(zh.year_text(3), manifest_core::summary::year_text(w, 3));
    // 英文：日期写作 “13 Mar 1502 (Spring)”，金额按千位分组
    let b = en();
    assert_eq!(b.date_text(12 + 60), "13 Mar 1502 (Spring)");
    assert_eq!(b.date_text(360 + 30 * 7), "1 Aug 1503 (Autumn)");
    assert_eq!(b.year_text(0), "1502");
    assert_eq!(b.number(12_345), "12,345");
    assert_eq!(b.number(-1_234_567), "-1,234,567");
    assert_eq!(zh.number(12_345), "12345");
    // 每个错误码都有中文与英文
    for (code, _) in manifest_core::error::REASON_CODES {
        assert!(zh.texts.get(&format!("reasons.{code}")).is_some(), "中文缺 reasons.{code}");
        assert!(b.texts.get(&format!("reasons.{code}")).is_some(), "英文缺 reasons.{code}");
    }
}

#[test]
fn locale_codes_and_system_language() {
    assert_eq!(serde_json::to_string(&Locale::ZhCn).unwrap(), "\"zh-CN\"");
    assert_eq!(serde_json::to_string(&Locale::En).unwrap(), "\"en\"");
    assert_eq!(serde_json::from_str::<Locale>("\"en\"").unwrap(), Locale::En);
    assert_eq!(Locale::parse("zh-CN"), Some(Locale::ZhCn));
    assert_eq!(Locale::from_system("zh-TW"), Locale::ZhCn);
    assert_eq!(Locale::from_system("en-US"), Locale::En);
    assert_eq!(Locale::from_system("fr"), Locale::En);
    assert_eq!(Locale::default(), Locale::ZhCn, "后端缺省中文");
}
