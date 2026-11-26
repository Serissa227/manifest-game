//! 草稿和运行时采用相同的嵌套稳定键；覆盖不能带入玩法字段或恢复已撤销的 C7 登记。
#[test]
fn nested_story_translation_requires_every_text_and_rejects_gameplay_and_unknown_keys() {
    let source = r#"
[[tracks]]
key = "track"
name = "占位"
[[tracks.chapters]]
key = "chapter"
title = "占位"
text = "占位"
[[tracks.chapters.choices]]
key = "choice"
text = "占位"
reply = "占位"
effects = [{ kind = "affinity", person = "a", value = 1 }, { kind = "memory", memory = "one", title = "占位" }]
"#;
    let english = r#"
[tracks.track]
name = "Placeholder"
[tracks.track.chapters.chapter]
title = "Placeholder"
text = "Placeholder"
[tracks.track.chapters.chapter.choices.choice]
text = "Placeholder"
reply = "Placeholder"
effects = [{}, { title = "Placeholder" }]
"#;
    let validate =
        |english: &str| manifest_data::worlds::validate_draft_translation("stories/nested/track.toml", source, english);
    assert_eq!(validate(english).unwrap(), 6);
    for broken in [
        english.replace("reply = \"Placeholder\"", ""),
        english.replace("chapters.chapter]", "chapters.unknown]"),
        english.replace("effects = [{},", "effects = [{ value = 99 },"),
        english.replace("effects = [{},", "effects = ["),
    ] {
        assert!(validate(&broken).is_err(), "{broken}");
    }
}

#[test]
fn explicitly_registered_story_fragments_have_their_executable_translation_schema() {
    let dir = manifest_data::find_data_dir().unwrap();
    let defs = manifest_data::load(&dir).unwrap();
    let registered = manifest_data::locale::data_files(&dir, &defs);
    // 寰宇登记的 C7（Claude 重写版）羁绊线与配角线，与测试世界显式登记的故事分片并存检查。
    assert!(registered.iter().any(|p| p == "stories/bonds/bond_abdullah.toml"));
    assert!(registered.iter().any(|p| p == "stories/npc/tie_zubayda_amina.toml"));
    assert!(registered.iter().any(|p| p == "stories/upbringing.toml"));
    assert!(registered.iter().any(|p| p == "stories/academy_entry.toml"));
    // 另用显式登记的临时世界检验嵌套物理路径，以及坏分片被排除。
    let tmp = tempfile::tempdir().unwrap();
    let world = tmp.path().join("worlds/story_fixture");
    let source = std::fs::read_to_string(dir.join("worlds/testbed/stories/tracks.toml")).unwrap();
    let mut manifest: toml::Value =
        toml::from_str(&std::fs::read_to_string(dir.join("worlds/testbed/world.toml")).unwrap()).unwrap();
    let paths = ["stories/bonds/bond_abdullah.toml", "stories/npc/tie_zubayda_amina.toml"];
    manifest["tables"]["stories"] =
        toml::Value::Array(paths.iter().map(|p| toml::Value::String((*p).into())).collect());
    for rel in paths {
        let path = world.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, &source).unwrap();
    }
    std::fs::write(world.join("world.toml"), toml::to_string(&manifest).unwrap()).unwrap();
    let registered = manifest_data::locale::data_files(tmp.path(), &defs);
    for rel in paths {
        assert!(registered.iter().any(|p| p == rel));
    }
    std::fs::write(world.join(paths[1]), "bad = true").unwrap();
    let registered = manifest_data::locale::data_files(tmp.path(), &defs);
    assert!(registered.iter().any(|p| p == paths[0]));
    assert!(!registered.iter().any(|p| p == paths[1]));
}
