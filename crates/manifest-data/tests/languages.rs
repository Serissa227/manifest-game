//! 世界语言声明、整份翻译缺省与严格覆盖的回归。

use manifest_data::worlds::validate_draft_world;
use std::path::Path;

fn write(root: &Path, file: &str, text: &str) {
    let path = root.join(file);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
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
    copy(&Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data"), tmp.path());
    tmp
}

#[test]
fn english_requests_keep_available_translations_and_fall_back_for_missing_story_fields() {
    use manifest_data::Locale;
    let tmp = fixture();
    write(
        tmp.path(),
        "worlds/sample/world.toml",
        "key='sample'\nname='测试'\nmap='classic'\ninherit='classic'\nlanguages=['zh']\n",
    );
    // 两条测试轨道自动开始：U03 起，不自动开始的轨道必须有入口（start_track、bond_track 等）；这里只测翻译回退，用不着入口。
    for key in ["missing", "translated"] {
        write(
            tmp.path(),
            &format!("worlds/sample/stories/{key}.toml"),
            &format!(
                "[[tracks]]\nkey='{key}'\nname='测试'\nkind='encounter'\nstart='first'\n[[tracks.chapters]]\nkey='first'\ntitle='测试'\ntext='测试。'\n[[tracks.chapters.choices]]\nkey='ok'\ntext='继续'\nnext='done'\n"
            ),
        );
    }
    write(
        tmp.path(),
        "worlds/sample/locales/en/stories/translated.toml",
        "[tracks.translated]\nname='Test'\n[tracks.translated.chapters.first]\ntitle='Test'\ntext='Test.'\n[tracks.translated.chapters.first.choices.ok]\ntext='Continue'\n",
    );
    let world = manifest_data::resolve_world(tmp.path(), "sample").unwrap();
    let defs = manifest_data::load_world(tmp.path(), "sample").unwrap();
    let ai = manifest_data::ai_content::load_world_ai_content(&world).unwrap();
    let (en, issues) = manifest_data::locale::load_world_locale_lenient(&world, Locale::En, &defs, &ai);
    let missing = issues.iter().filter(|i| i.message == "已有英文覆盖不完整").count();
    println!("英文覆盖缺项 {missing} 条");
    assert!(issues.iter().all(|i| i.message == "已有英文覆盖不完整"), "{issues:?}");
    assert_eq!(en.locale, Locale::En);
    assert_eq!(en.defs.meta.hash, defs.meta.hash);
    let missing_tracks: Vec<_> = defs.story2.tracks.iter().filter(|t| t.source == "stories/missing.toml").collect();
    assert!(!missing_tracks.is_empty());
    for track in missing_tracks {
        let displayed = en.defs.story2.tracks.iter().find(|t| t.key == track.key).unwrap();
        assert_eq!(format!("{displayed:?}"), format!("{track:?}"));
    }
    assert!(defs.story2.tracks.iter().zip(&en.defs.story2.tracks).any(|(zh, en)| zh.name != en.name));
    let partial = "[tracks.missing]\nname='Test'\n";
    write(tmp.path(), "worlds/sample/locales/en/stories/missing.toml", partial);
    let world = manifest_data::resolve_world(tmp.path(), "sample").unwrap();
    let (_, issues) = manifest_data::locale::load_world_locale_lenient(&world, Locale::En, &defs, &ai);
    assert!(issues.iter().any(|i| i.message.contains("不完整")), "{issues:?}");
}

#[test]
fn untranslated_fragments_stay_registered_and_language_changes_refresh_coverage_cache() {
    use manifest_data::Locale;
    let tmp = fixture();
    // 这里测的是草稿分片的覆盖统计随语言声明刷新；寰宇 2026-11-02 转为成品世界，副本恢复成草稿再测
    // （成品世界的分片登记见 tests/locale.rs，已有覆盖的检查见 validate-data）。
    let manifest = tmp.path().join("worlds/terra16/world.toml");
    let text = std::fs::read_to_string(&manifest).unwrap();
    assert!(text.contains("\nhidden = false\n"), "寰宇清单的写法变了，夹具要跟着改");
    std::fs::write(&manifest, text.replacen("\nhidden = false\n", "\nhidden = true\ndraft = true\n", 1)).unwrap();
    std::fs::remove_file(tmp.path().join("worlds/terra16/texts.toml")).unwrap();
    std::fs::remove_file(tmp.path().join("worlds/terra16/cast/figures.toml")).unwrap();
    let file = "goods/06_process_inputs.toml";
    std::fs::remove_file(tmp.path().join("worlds/terra16/locales/en").join(file)).unwrap();
    let defs = manifest_data::load_shared(tmp.path()).unwrap();
    assert!(manifest_data::locale::data_files(tmp.path(), &defs).contains(&file.to_string()));
    let missing = manifest_data::coverage(tmp.path(), Locale::En).unwrap();
    println!("其它世界的英文缺项 {} 条", missing.len());
    let terra: Vec<_> = missing.iter().filter(|m| m.file.starts_with("worlds/terra16/")).collect();
    assert!(terra.is_empty(), "{terra:?}");
    let path = tmp.path().join("worlds/terra16/world.toml");
    let text = std::fs::read_to_string(&path).unwrap();
    assert!(text.contains("languages = [\"zh\"]"));
    std::fs::write(path, text.replace("languages = [\"zh\"]", "languages = [\"zh\", \"en\"]")).unwrap();
    let missing = manifest_data::coverage(tmp.path(), Locale::En).unwrap();
    assert!(missing.iter().any(|m| m.file.ends_with(file)), "{missing:?}");
}

#[test]
fn complete_terra16_loads_untranslated_story_and_keeps_translated_goods_fragments() {
    use manifest_data::Locale;
    let tmp = fixture();
    let story = "stories/bonds/bond_abdullah.toml";
    let goods = "goods/06_process_inputs.toml";
    let academy = "upbringing/academies/antwerp_laurel.toml";
    for file in [story, goods, "rules.toml", academy] {
        std::fs::remove_file(tmp.path().join("worlds/terra16/locales/en").join(file)).unwrap();
    }
    // 寰宇 2026-11-02 转为成品世界；草稿检查的夹具把副本恢复成草稿（hidden + draft，草稿不要求地图在场）。
    let manifest = tmp.path().join("worlds/terra16/world.toml");
    let text = std::fs::read_to_string(&manifest).expect("寰宇清单");
    assert!(text.contains("\nhidden = false\n"), "寰宇清单的写法变了，夹具要跟着改");
    let text = text.replacen("\nhidden = false\n", "\nhidden = true\ndraft = true\n", 1);
    // 本测试还要完整加载草稿；FIX8 的真实立绘目录不能删，沿用正式加载器的逻辑表登记。
    let text = text.replace("[tables]\n", "[tables]\nfigures = [\"cast/figures.toml\"]\n");
    std::fs::write(&manifest, text).expect("恢复草稿");
    // 后端显示文字表是转为成品世界时才加的，草稿时期没有。
    std::fs::remove_file(tmp.path().join("worlds/terra16/texts.toml")).expect("删去显示文字表");
    let report = validate_draft_world(tmp.path(), "terra16").unwrap();
    // 原有 18 片仅中文分片 + 本测试删掉英文的 4 片 = 22；C13 整合（2026-10-26）新登记的 307 片故事都只有中文，合计 329；
    // C11 收尾（2026-11-01）新加的院长人物片、知己关系片与两条新关系线（4 片）只有中文，合计 333；
    // 十个亚特兰蒂斯补章接回（2026-11-01）也只有中文，+10 = 343。
    // A10（2026-11-02）新增的 AI 提示词与含文字的离线模板只有中文（纯数值模板不计翻译片段），+33 = 376。
    // 转为成品世界（2026-11-02）时删掉 4 个只有注释的英文覆盖（runtime_links 与养成的 families / native_rules / templates），
    // 这 4 片从此只有中文，+4 = 380。
    // 养成内容（2026-11-03）：九份 <主角>_growth.toml 与七份 <主角>_growth_persons.toml 只写中文（+16），
    // 澪、纳吉玛的 events / persons 与林晚灯 events 的英文占位覆盖整份删除（+5），380 → 401。
    // 合并 G01 的三份商品、一份配方、一份工坊：再加 5 份。
    // U02 工作包 4 的战斗练习 upbringing/common_practices.toml 只写中文：+1 = 407。
    // 2026-11-04：U04 两份数据、低谷场景、比赛奖品与三份改投学院的事件，7 份只写中文的新分片 = 414。
    // S01（2026-11-10）：出海后的奇遇两份（stories/encounters_sea.toml、encounters_port.toml）只写中文，+2 = 416。
    // I01（2026-11-11）：新物品九个分片（items_*_02 / _03）只写中文，+9；I03：寰宇船只改装 ships/09_refits.toml 只写中文，+1 = 426。
    // H04（2026-11-11）：海上所见 voyage/sightings.toml 只写中文，+1 = 427。
    // H08（2026-11-11）：甲板闲话 voyage/banter.toml 只写中文，+1 = 428。
    // G02（2026-11-11）：交易品扩充的商品分片与来源配方分片只写中文，+2 = 430。
    // H02（2026-11-11）：船员情绪的三阶段 stories/voyage_crew.toml 只写中文，+1 = 431。
    // TCLEAN4：与 CLI 完整草稿的 445 对齐；这里删四份英文覆盖，因此再加三份。
    // 公开版拿掉两个人物以后少 7 片：448 → 441。
    assert_eq!(report.chinese_only_fragments, 441);
    assert!(report.translated_strings > 0);
    let world = manifest_data::resolve_world(tmp.path(), "terra16").unwrap();
    let classic = manifest_data::resolve_world(tmp.path(), "classic").unwrap();
    let defs = manifest_data::load_world(tmp.path(), "terra16").unwrap();
    let ai = manifest_data::load_ai_content(tmp.path()).unwrap();
    let (en, issues) =
        manifest_data::locale::load_world_locale_with_common_texts_lenient(&world, &classic, Locale::En, &defs, &ai);
    let missing = issues.iter().filter(|i| i.message == "已有英文覆盖不完整").count();
    println!("英文覆盖缺项 {missing} 条");
    assert!(issues.iter().all(|i| i.message == "已有英文覆盖不完整"), "{issues:?}");
    let raw: toml::Value =
        toml::from_str(&std::fs::read_to_string(tmp.path().join("worlds/terra16").join(goods)).unwrap()).unwrap();
    for row in raw["goods"].as_array().unwrap() {
        let key = row["key"].as_str().unwrap();
        let zh = defs.goods.iter().find(|g| g.key == key).unwrap();
        let translated = en.defs.goods.iter().find(|g| g.key == key).unwrap();
        assert_eq!((&translated.name, &translated.description), (&zh.name, &zh.description));
    }
    assert!(defs.goods.iter().zip(&en.defs.goods).any(|(zh, en)| zh.name != en.name));
    let zh = defs.story2.tracks.iter().find(|t| t.key == "bond_abdullah").unwrap();
    let translated = en.defs.story2.tracks.iter().find(|t| t.key == zh.key).unwrap();
    assert_eq!(format!("{translated:?}"), format!("{zh:?}"));
    let zh = defs.upbringing.academies.iter().find(|a| a.source == academy).unwrap();
    let translated = en.defs.upbringing.academies.iter().find(|a| a.key == zh.key).unwrap();
    assert_eq!(format!("{translated:?}"), format!("{zh:?}"));
    write(tmp.path(), &format!("worlds/terra16/locales/en/{story}"), "[tracks.bond_abdullah]\nname='Test'\n");
    for error in [
        validate_draft_world(tmp.path(), "terra16").map(|_| ()).unwrap_err(),
        manifest_data::load_world(tmp.path(), "terra16").map(|_| ()).unwrap_err(),
    ] {
        assert!(error.to_string().contains("bond_abdullah"), "{error}");
    }
}

/// 寰宇只做中文：人物的一句话身份（summary）是 11-02 起只写中文补上的字段，已有英文的人物缺这一项时回退中文、不算不完整；
/// 同一人物缺名字、人设等别的字段仍是校验问题。
#[test]
fn chinese_first_person_summary_falls_back_but_other_person_fields_stay_required() {
    use manifest_data::Locale;
    let tmp = fixture();
    let load = |tmp: &tempfile::TempDir| {
        let world = manifest_data::resolve_world(tmp.path(), "terra16").unwrap();
        let classic = manifest_data::resolve_world(tmp.path(), "classic").unwrap();
        let defs = manifest_data::load_world(tmp.path(), "terra16").unwrap();
        let ai = manifest_data::load_ai_content(tmp.path()).unwrap();
        let (en, issues) = manifest_data::locale::load_world_locale_with_common_texts_lenient(
            &world,
            &classic,
            Locale::En,
            &defs,
            &ai,
        );
        (defs, en, issues)
    };
    let file = "worlds/terra16/locales/en/cast/historical_04_africa.toml";
    let text = std::fs::read_to_string(tmp.path().join(file)).unwrap();
    assert!(!text.contains("summary"), "夹具前提：这一分片的英文没有一句话身份");
    let (defs, en, issues) = load(&tmp);
    let missing = issues.iter().filter(|i| i.message == "已有英文覆盖不完整").count();
    println!("英文覆盖缺项 {missing} 条");
    assert!(issues.iter().all(|i| i.message == "已有英文覆盖不完整"), "{issues:?}");
    let zh = defs.cast.persons.iter().find(|p| p.key == "gelawdewos").unwrap();
    let translated = en.defs.cast.persons.iter().find(|p| p.key == zh.key).unwrap();
    assert!(!zh.summary.is_empty());
    assert_eq!(translated.summary, zh.summary, "没有英文的一句话身份回退中文");
    assert_eq!(translated.name, "Gelawdewos", "其余字段照旧用英文");
    // 同一人物删掉英文的名字：仍报不完整
    std::fs::write(
        tmp.path().join(file),
        text.replacen(
            "name = \"Gelawdewos\"
",
            "",
            1,
        ),
    )
    .unwrap();
    let (_, _, issues) = load(&tmp);
    assert!(
        issues.iter().any(|i| i.to_string().contains("gelawdewos") && i.to_string().contains("name")),
        "{issues:?}"
    );
}

fn draft(languages: &str) -> tempfile::TempDir {
    let tmp = tempfile::tempdir().unwrap();
    write(
        tmp.path(),
        "worlds/sample/world.toml",
        &format!("key='sample'\nname='测试'\nmap='missing'\ndraft=true\n{languages}\n[tables]\npast=['past.toml']\n"),
    );
    write(
        tmp.path(),
        "worlds/sample/past.toml",
        "[[past]]\nkey='memory'\nname='往事'\nlore='测试往事。'\nsources=['测试']\n",
    );
    tmp
}

#[test]
fn chinese_only_draft_counts_untranslated_fragments_without_losing_schema_checks() {
    let tmp = draft("languages=['zh']");
    let report = validate_draft_world(tmp.path(), "sample").unwrap();
    assert_eq!(report.files, ["worlds/sample/past.toml"]);
    assert_eq!((report.translated_strings, report.chinese_only_fragments), (0, 1));
    assert_eq!(report.counts["past"], 1);
    write(
        tmp.path(),
        "worlds/sample/past.toml",
        "[[past]]\nkey='memory'\nname='往事'\nlore='测试往事。'\nsources=['测试']\nunknown=true\n",
    );
    assert!(validate_draft_world(tmp.path(), "sample").unwrap_err().to_string().contains("unknown"));
}

#[test]
fn existing_english_is_complete_display_only_and_counted_in_chinese_worlds() {
    let tmp = draft("languages=['zh']");
    let file = "worlds/sample/locales/en/past.toml";
    for text in [
        "[past.memory]\nname='Memory'\n",
        "[past.memory]\nname='Memory'\nlore='Test memory.'\nprice=5\n",
        "[past.memory]\nname='Memory'\nlore='Test memory.'\n[past.extra]\nname='Extra'\n",
        "[past.memory]\nname=''\nlore='Test memory.'\n",
        "[",
    ] {
        write(tmp.path(), file, text);
        assert!(validate_draft_world(tmp.path(), "sample").is_err(), "{text}");
    }
    write(tmp.path(), file, "[past.memory]\nname='Memory'\nlore='Test memory.'\n");
    let report = validate_draft_world(tmp.path(), "sample").unwrap();
    assert_eq!((report.translated_strings, report.chinese_only_fragments), (2, 0));
}

#[test]
fn bilingual_drafts_still_require_the_entire_english_file() {
    for declaration in ["", "languages=['zh','en']"] {
        let tmp = draft(declaration);
        let error = validate_draft_world(tmp.path(), "sample").unwrap_err().to_string();
        assert!(error.contains("past.toml"), "{error}");
    }
}

#[test]
fn language_declaration_does_not_change_classic_hash_or_defaults() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
    for key in ["classic", "testbed"] {
        let world = manifest_data::resolve_world(&root, key).unwrap();
        assert_eq!(world.manifest.languages, ["zh", "en"]);
    }
    let terra = manifest_data::resolve_world(&root, "terra16").unwrap();
    assert_eq!(terra.manifest.languages, ["zh"]);
    assert_eq!(
        manifest_data::load_shared(&root).unwrap().meta.hash,
        "76f354cdd43e6ac99e3f661ed862f7c385b901e73d39df130b420c8284a2be35"
    );
}

#[test]
fn bilingual_testbed_still_reports_missing_existing_english() {
    use manifest_data::Locale;
    let tmp = fixture();
    let world = manifest_data::resolve_world(tmp.path(), "testbed").unwrap();
    assert!(world.manifest.requires_english());
    let defs = manifest_data::load_world(tmp.path(), "testbed").unwrap();
    let ai = manifest_data::ai_content::load_world_ai_content(&world).unwrap();
    let (before, _) = manifest_data::locale::load_world_locale_lenient(&world, Locale::En, &defs, &ai);
    assert!(!before.missing.iter().any(|m| m.file == "locales/en/items.toml"));
    std::fs::remove_file(tmp.path().join("worlds/testbed/locales/en/items.toml")).unwrap();
    let world = manifest_data::resolve_world(tmp.path(), "testbed").unwrap();
    let (after, _) = manifest_data::locale::load_world_locale_lenient(&world, Locale::En, &defs, &ai);
    assert!(after.missing.iter().any(|m| m.file == "locales/en/items.toml"));
}
