//! 寰宇基础配置独立于经典条目，显示占位仍遵守严格英文覆盖。

#[test]
fn terra16_has_six_independent_base_files_and_exact_translations() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
    let world = manifest_data::resolve_world(&root, "terra16").expect("世界清单");
    assert!(world.manifest.inherit.is_none());
    for file in ["rules.toml", "captain.toml", "caravans.toml", "futures.toml", "events.toml", "mates.toml"] {
        world.read(file).expect(file);
        world.read(&format!("locales/en/{file}")).expect("基础英文文件");
        // rules 的覆盖使用运行态字段；条目表按每个实际来源逐字段检查，包含追加的航海士分片。
        if file != "rules.toml" {
            let base = root.canonicalize().unwrap().join("worlds/terra16");
            for source in &world.files[file].sources {
                let relative = source.strip_prefix(&base).expect("寰宇独立来源");
                let source = std::fs::read_to_string(source).expect("原文分片");
                let translated = std::fs::read_to_string(base.join("locales/en").join(relative)).expect("英文分片");
                manifest_data::worlds::validate_draft_translation(relative.to_str().unwrap(), &source, &translated)
                    .expect("分片逐字段英文覆盖");
            }
        }
        assert!(
            world.files[file]
                .sources
                .iter()
                .all(|p| p.starts_with(root.canonicalize().unwrap().join("worlds/terra16")))
        );
    }
    let mates: toml::Value = toml::from_str(&world.read("mates.toml").unwrap()).unwrap();
    let keys: Vec<_> = mates["mates"].as_array().unwrap().iter().map(|m| m["key"].as_str().unwrap()).collect();
    assert!(keys.is_empty(), "寰宇的航海士都由人物定义接入，表里不另登记：{keys:?}");
    let parsed: toml::Value = toml::from_str(&world.read("futures.toml").unwrap()).unwrap();
    for table in ["exchanges", "contracts"] {
        assert!(parsed[table].as_array().unwrap().is_empty());
    }
    // 行情事件（S01，2026-11-10 起由内容包登记，原先这张表是空的）：是寰宇自己的条目，一条也不照搬经典世界的事件。
    let keys = |text: String| -> Vec<String> {
        let parsed: toml::Value = toml::from_str(&text).unwrap();
        parsed["events"].as_array().unwrap().iter().map(|e| e["key"].as_str().unwrap().to_owned()).collect()
    };
    let classic = keys(
        manifest_data::resolve_world(&root, "classic").expect("经典世界").read("events.toml").expect("经典的事件表"),
    );
    let own = keys(world.read("events.toml").unwrap());
    assert!(classic.len() >= 20 && own.len() >= 18, "经典 {} 条，寰宇 {} 条", classic.len(), own.len());
    assert!(own.iter().all(|key| !classic.contains(key)), "寰宇的行情事件不该与经典世界的同名");
}
