//! 作者人物元数据的封闭引用及关系格式适配；未实现条件显式隔离。
use super::*;
use manifest_core::cast::metadata::*;
use serde::Deserialize;
use toml::Value;

pub(super) fn parse_cast(mut value: Value, _file: &str, _draft: bool) -> Result<CastDefs, String> {
    let ties = value.as_table_mut().and_then(|v| v.remove("ties"));
    let mut defs: CastDefs = value.try_into().map_err(|e: toml::de::Error| e.to_string())?;
    if let Some(ties) = ties {
        let ties = ties.as_array().ok_or("ties 必须为列表")?;
        for row in ties {
            let mut row = row.as_table().cloned().ok_or("关系必须为表")?;
            let key = row.remove("key").map(Value::try_into::<String>).transpose().map_err(|e| e.to_string())?;
            let note = row.remove("note").map(Value::try_into::<String>).transpose().map_err(|e| e.to_string())?;
            let mut deferred = None;
            if let Some(when) = row.get_mut("when")
                && let Some(table) = when.as_table()
            {
                if table.contains_key("graduation") || table.contains_key("no_promise_with_protagonist") {
                    let condition: GraduationCondition =
                        when.clone().try_into().map_err(|e: toml::de::Error| e.to_string())?;
                    if !condition.graduation
                        || condition.no_promise_with_protagonist.is_empty()
                        || condition.flag.as_ref().is_some_and(|s| s.is_empty())
                    {
                        return Err("毕业条件要求 graduation=true、非空约定人物，flag 不能空".into());
                    }
                    deferred = Some(condition);
                    *when = Value::Array(Vec::new());
                } else {
                    #[derive(Deserialize)]
                    #[serde(deny_unknown_fields)]
                    struct Flag {
                        flag: String,
                    }
                    let flag: Flag = when.clone().try_into().map_err(|e: toml::de::Error| e.to_string())?;
                    *when = Value::Array(vec![Value::Table(toml::Table::from_iter([
                        ("kind".into(), "flag".into()),
                        ("flag".into(), flag.flag.into()),
                    ]))]);
                }
            }
            let tie: relations::TieDef = Value::Table(row).try_into().map_err(|e: toml::de::Error| e.to_string())?;
            let item = key.clone().unwrap_or_else(|| format!("{}:{}", tie.a, tie.b));
            if key.is_some() || note.is_some() {
                defs.tie_metadata.push(TieMetadata {
                    key: item.clone(),
                    a: tie.a.clone(),
                    b: tie.b.clone(),
                    note: note.unwrap_or_default(),
                });
            }
            if let Some(when) = deferred {
                defs.deferred_ties.push(DeferredTie { key: item, tie, when });
            } else {
                defs.ties.push(tie);
            }
        }
    }
    Ok(defs)
}

fn keys<'a>(value: &'a Value, table: &str) -> impl Iterator<Item = String> + 'a {
    value
        .get(table)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|v| v.get("key").and_then(Value::as_str).map(str::to_owned))
}

pub(super) fn validate_references(dir: &EffectiveWorld, defs: &CastDefs, is: &mut Issues) {
    let mut symbols: BTreeMap<&str, BTreeSet<String>> = BTreeMap::new();
    // 只读取这些关联表，不把关系里出现的引用当成定义。
    let files: Vec<String> = dir
        .files
        .keys()
        .filter(|f| f.ends_with(".toml") && !f.starts_with("locales/"))
        .filter(|file| {
            file.starts_with("upbringing/")
                || [
                    "opening_catalog.toml",
                    "regions.toml",
                    "world/regions.toml",
                    "captain.toml",
                    "skills.toml",
                    "families.toml",
                    "templates.toml",
                ]
                .contains(&file.as_str())
        })
        .cloned()
        .collect();
    // 各文件分给几个线程解析（寰宇的养成文件又多又大），再按原顺序逐个收集（2026-11-03 启动提速）
    let parsed = super::super::per_file(&files, |file, is| {
        let text = read(dir, file, is)?;
        parse::<Value>(file, &text, is)
    });
    for (file, (value, local)) in files.iter().zip(parsed) {
        is.list.extend(local.list);
        let Some(value) = value else { continue };
        for table in ["academies", "families", "templates", "regions", "knowledge_groups"] {
            symbols.entry(table).or_default().extend(keys(&value, table));
        }
        if file.starts_with("upbringing/academies/")
            && value.get("curriculum").is_some()
            && let Some(key) = value.get("key").and_then(Value::as_str)
        {
            symbols.entry("academies").or_default().insert(key.into());
        }
        // C12 的开局卡声明家庭身份及自创模板；C9/A6 另负责它们的行为。
        for row in value.get("opening_catalog").and_then(Value::as_array).into_iter().flatten() {
            if let Some(key) = row.get("family_ref").and_then(Value::as_str)
                && defs.person(key).is_some_and(|p| p.kind == PersonKind::Protagonist)
            {
                symbols.entry("families").or_default().insert(key.into());
            }
            if row.get("kind").and_then(Value::as_str) == Some("template")
                && let Some(key) = row.get("key").and_then(Value::as_str)
            {
                symbols.entry("templates").or_default().insert(key.into());
            }
        }
    }
    // cameo 是经典人物的跨世界身份来源，不能误认成寰宇中的第二个人物。
    if defs.persons.iter().any(|p| p.cameo.is_some()) {
        match crate::resolve_world(dir.data_root(), "classic") {
            Ok(classic) => {
                for file in std::iter::once("mates.toml".to_owned()).chain(classic.files_in("scenarios")) {
                    let Some(text) = read(&classic, &file, is) else { continue };
                    let Some(value) = parse::<Value>(&file, &text, is) else { continue };
                    symbols.entry("cameos").or_default().extend(keys(&value, "mates"));
                    if value.get("hero").is_some()
                        && let Some(key) = value.get("key").and_then(Value::as_str)
                    {
                        symbols.entry("cameos").or_default().insert(key.into());
                    }
                }
            }
            Err(e) => is.push("cast", "cameo", e.to_string()),
        }
    }
    let exists = |table, key: &str| symbols.get(table).is_some_and(|s| s.contains(key));
    for p in &defs.persons {
        for (field, table, key) in [
            ("academy", "academies", &p.academy),
            ("family", "families", &p.family),
            ("template", "templates", &p.template),
            ("cameo", "cameos", &p.cameo),
        ] {
            if let Some(key) = key
                && !exists(table, key)
            {
                is.push("cast", &p.key, format!("{field} 引用不存在的 {table}/{key}"));
            }
        }
        for key in &p.known_regions {
            if !exists("regions", key) && !exists("knowledge_groups", key) {
                is.push("cast", &p.key, format!("known_regions 引用不存在的海区 / 见识组 {key}"));
            }
        }
        if let Some(mate) = &p.mate {
            let mut seen = BTreeSet::new();
            for key in &mate.abilities {
                // C6 的 cold_seas / whaling 等是作者专长标签，没有能力数值；不能伪造为岗位或技能定义。
                if key.is_empty()
                    || !key.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
                    || !seen.insert(key)
                {
                    is.push("cast", &p.key, format!("mate.abilities 专长标签无效或重复：{key}"));
                }
            }
        }
    }
    for deferred in &defs.deferred_ties {
        let t = &deferred.tie;
        if t.a == t.b || defs.person(&t.a).is_none() || defs.person(&t.b).is_none() {
            is.push("cast/ties", &deferred.key, "毕业关系引用未知人物或指向自己");
        }
        if !valid_date(dir, t.since) || t.to.is_some_and(|to| !valid_date(dir, to) || to < t.since) {
            is.push("cast/ties", &deferred.key, "毕业关系日期段无效");
        }
        let mut seen = BTreeSet::new();
        for p in &deferred.when.no_promise_with_protagonist {
            if defs.person(p).is_none() || !seen.insert(p) {
                is.push("cast/ties", &deferred.key, "约定条件引用未知或重复人物");
            }
        }
    }
    let mut seen = BTreeSet::new();
    for t in &defs.tie_metadata {
        if t.key.is_empty() || !seen.insert(&t.key) {
            is.push("cast/ties", &t.key, "关系 key 为空或重复");
        }
    }
}

/// `declared` 是 runtime_links.toml 里显式登记的待交付轨道：故事分片登记以后，只有这些缺失的轨道仍记为
/// pending_track，其余缺失照旧是硬错误；登记了却已交付或没人引用的 key 也是错误。
pub(super) fn link_tracks(
    dir: &EffectiveWorld,
    cast: &mut CastDefs,
    stories: &manifest_core::story2::Story2Defs,
    declared: &BTreeSet<String>,
    is: &mut Issues,
) {
    let pending =
        dir.manifest.draft && !dir.manifest.tables.contains_key("stories") && dir.files_in("stories").is_empty();
    let declared_pending = |target: &str| dir.manifest.draft && declared.contains(target);
    let mut refs = Vec::new();
    for p in &cast.persons {
        let file = if p.source.is_empty() { "cast" } else { p.source.as_str() };
        for (field, key) in [("bond_track", &p.bond_track), ("main_track", &p.main_track), ("npc_track", &p.npc_track)]
        {
            if let Some(key) = key {
                refs.push((file, p.key.clone(), field, key.clone()));
            }
        }
        refs.extend(p.tracks.iter().map(|key| (file, p.key.clone(), "tracks", key.clone())));
    }
    for t in cast.ties.iter().chain(cast.deferred_ties.iter().map(|d| &d.tie)) {
        if let Some(key) = &t.story {
            refs.push(("cast/ties", format!("{}:{}", t.a, t.b), "story", key.clone()));
        }
    }
    let referenced: BTreeSet<String> = refs.iter().map(|(_, _, _, target)| target.clone()).collect();
    for key in declared {
        if stories.track(key).is_some() {
            is.push("runtime_links.toml", key, "轨道已经交付，请从 pending_tracks 删掉");
        } else if !referenced.contains(key) {
            is.push("runtime_links.toml", key, "pending_tracks 登记的轨道没有任何人物或关系引用");
        }
    }
    for (file, item, field, target) in refs {
        if stories.track(&target).is_some() {
            continue;
        }
        if (pending || declared_pending(&target)) && !target.is_empty() {
            cast.diagnostics.push(CastDiagnostic {
                kind: DiagnosticKind::PendingTrack,
                file: file.into(),
                item,
                field: field.into(),
                target,
            });
        } else {
            is.push(file, item, format!("{field} 轨道不存在：{target}"));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn catalog() -> (EffectiveWorld, CastDefs) {
        let world = crate::resolve_world(&crate::find_data_dir().expect("data"), "terra16").expect("世界");
        let mut defs = CastDefs::default();
        for (file, text) in world.cast_sources().expect("原始分片") {
            let raw = toml::from_str(&text).expect("TOML");
            let parsed = parse_cast(raw, &file, true).unwrap_or_else(|e| panic!("{file}: {e}"));
            defs.persons.extend(parsed.persons);
            defs.ties.extend(parsed.ties);
            defs.past.extend(parsed.past);
            defs.deferred_ties.extend(parsed.deferred_ties);
            defs.tie_metadata.extend(parsed.tie_metadata);
            defs.diagnostics.extend(parsed.diagnostics);
        }
        (world, defs)
    }

    #[test]
    fn real_cast_keeps_all_fields_and_defers_only_graduation_conditions() {
        let (world, defs) = catalog();
        // 养成内容（2026-11-03）：九位主角的家乡玩伴与诺埃尔的看网老人，共 17 人（594 → 611）。
        // 公开版拿掉三位人物：611 → 608。
        assert_eq!(defs.persons.len(), 608);
        // C7 整合：166 + 拆段 15 + 新线 53 = 234 条；其中带毕业条件的 25 + 14 条，A6 第二轮已支持毕业条件，不再有等 A6 的诊断。
        // 公开版拿掉与那三位人物相关的 10 条关系（都不带毕业条件）：活跃关系 198 → 188、合计 237 → 227。
        assert_eq!((defs.ties.len(), defs.deferred_ties.len(), defs.tie_metadata.len()), (188, 39, 227));
        assert!(defs.diagnostics.is_empty());
        let p = defs.person("ines_costa").expect("人物");
        assert!(!p.summary.is_empty() && !p.secret.is_empty() && !p.after.is_empty());
        assert_eq!(p.birthday, Some([7, 19]));
        assert_eq!(p.names[0].bond, "C");
        assert_eq!(p.lines["catchphrase"], ["剩下半行，归你。"]);
        assert_eq!(p.mate.as_ref().expect("航海士").abilities, ["trade", "eloquence"]);
        let mut is = Issues::default();
        validate_references(&world, &defs, &mut is);
        assert!(is.list.is_empty(), "{:?}", is.list);
    }

    #[test]
    fn metadata_reference_typos_are_hard_errors_even_in_draft() {
        let (world, mut defs) = catalog();
        let p = &mut defs.persons[0];
        p.academy = Some("missing_academy".into());
        p.family = Some("missing_family".into());
        p.template = Some("missing_template".into());
        p.cameo = Some("missing_cameo".into());
        p.known_regions = vec!["missing_sea".into()];
        let mut is = Issues::default();
        validate_references(&world, &defs, &mut is);
        assert_eq!(is.list.len(), 5, "{:?}", is.list);
        for field in ["academy", "family", "template", "cameo", "known_regions"] {
            assert!(is.list.iter().any(|i| i.message.contains(field)), "{field}");
        }
    }

    #[test]
    fn birthday_respects_the_world_calendar_and_does_not_change_the_birth_date() {
        let (world, defs) = catalog();
        let mut p = defs.person("ines_costa").expect("人物").clone();
        for (birthday, valid) in [(None, true), (Some([7, 19]), true), (Some([7, 20]), false), (Some([2, 29]), false)] {
            p.birthday = birthday;
            let mut is = Issues::default();
            validate_birthday(&world, "cast", &p, &mut is);
            assert_eq!(is.list.is_empty(), valid, "{birthday:?}");
        }
    }

    #[test]
    fn missing_tracks_are_pending_only_before_draft_story_registration() {
        // 真实 terra16 已登记 C7 的故事分片；“登记以前”用去掉故事清单与故事目录的副本复现，人物与关系不变。
        let (_temp, mut world) = unregistered_copy();
        let (_, mut cast) = catalog();
        let stories = manifest_core::story2::Story2Defs::default();
        let none = BTreeSet::new();
        let mut is = Issues::default();
        link_tracks(&world, &mut cast, &stories, &none, &mut is);
        assert!(is.list.is_empty());
        let pending = cast.diagnostics.iter().filter(|d| d.kind == DiagnosticKind::PendingTrack).count();
        assert!(pending > 500);
        for field in ["bond_track", "main_track", "npc_track", "tracks", "story"] {
            assert!(cast.diagnostics.iter().any(|d| d.field == field));
        }
        world.manifest.tables.insert("stories".into(), Vec::new());
        link_tracks(&world, &mut cast, &stories, &none, &mut is);
        assert_eq!(is.list.len(), pending);
    }

    #[test]
    fn declared_pending_tracks_survive_story_registration_only_when_exact() {
        let (mut world, cast) = catalog();
        // 寰宇 2026-11-02 转为成品世界；待交付清单只在草稿里生效，这里先按草稿检查，末尾再看正式发布的行为。
        world.manifest.draft = true;
        assert!(world.manifest.tables.contains_key("stories"), "真实 terra16 已登记故事分片");
        let empty = manifest_core::story2::Story2Defs::default();
        let pending_of = |cast: &CastDefs| {
            cast.diagnostics.iter().filter(|d| d.kind == DiagnosticKind::PendingTrack).cloned().collect::<Vec<_>>()
        };
        // 登记了 main_mio：主角卡的 main_track 与 tracks、关系 mio_yasuko 的 story（C13 整合 2026-10-26 由 tie_mio_yasuko 改指 main_mio）
        // 三处引用记为 pending，其余缺失全部是硬错误。
        let declared = BTreeSet::from(["main_mio".to_string()]);
        let (mut defs, mut is) = (cast.clone(), Issues::default());
        link_tracks(&world, &mut defs, &empty, &declared, &mut is);
        let pending = pending_of(&defs);
        let refs: BTreeSet<_> =
            pending.iter().map(|d| (d.target.as_str(), d.file.as_str(), d.item.as_str(), d.field.as_str())).collect();
        assert_eq!(pending.len(), 3, "{pending:?}");
        assert_eq!(
            refs,
            BTreeSet::from([
                ("main_mio", "cast", "mio", "main_track"),
                ("main_mio", "cast", "mio", "tracks"),
                ("main_mio", "cast/ties", "hirohashi_yasuko:mio", "story"),
            ])
        );
        assert!(!is.list.is_empty() && is.list.iter().all(|i| !i.message.contains("main_mio")));
        // 没人引用、或已经交付的登记都是错误，清单不能悄悄过时。
        let root = crate::find_data_dir().expect("data");
        let file = "stories/bonds/bond_abdullah.toml";
        let text = std::fs::read_to_string(root.join("worlds/terra16").join(file)).expect("故事分片");
        let delivered = crate::story2::parse_story_tracks(&text, file).expect("故事");
        for (key, message) in [("no_such_track", "没有任何人物或关系引用"), ("bond_abdullah", "已经交付")]
        {
            let declared = BTreeSet::from([key.to_string()]);
            let (mut defs, mut is) = (cast.clone(), Issues::default());
            link_tracks(&world, &mut defs, &delivered, &declared, &mut is);
            assert!(is.list.iter().any(|i| i.item == key && i.message.contains(message)), "{key}");
        }
        // 正式发布的世界不认待交付清单。
        world.manifest.draft = false;
        let (mut defs, mut is) = (cast.clone(), Issues::default());
        link_tracks(&world, &mut defs, &empty, &declared, &mut is);
        assert!(pending_of(&defs).is_empty());
        assert!(is.list.iter().any(|i| i.message.contains("main_mio")));
    }

    fn unregistered_copy() -> (tempfile::TempDir, EffectiveWorld) {
        fn copy(from: &std::path::Path, to: &std::path::Path) {
            std::fs::create_dir_all(to).expect("目录");
            for entry in std::fs::read_dir(from).expect("源目录") {
                let path = entry.expect("条目").path();
                let target = to.join(path.file_name().expect("文件名"));
                if path.is_dir() {
                    copy(&path, &target);
                } else {
                    std::fs::copy(&path, &target).expect("复制");
                }
            }
        }
        let root = crate::find_data_dir().expect("data");
        let temp = tempfile::tempdir().expect("临时目录");
        let base = temp.path().join("worlds/terra16");
        copy(&root.join("worlds/terra16"), &base);
        let manifest = base.join("world.toml");
        let text = std::fs::read_to_string(&manifest).expect("world.toml").replace("\r\n", "\n");
        let start = text.find("\nstories = [").expect("故事清单");
        let end = start + text[start..].find("\n]").expect("清单结尾") + 2;
        // 寰宇 2026-11-02 转为成品世界；“登记以前”是草稿时期的状态，副本恢复成草稿（草稿不要求地图在场）。
        let text = format!("{}{}", &text[..start], &text[end..]).replacen(
            "\nhidden = false\n",
            "\nhidden = true\ndraft = true\n",
            1,
        );
        assert!(text.contains("\ndraft = true\n"), "寰宇清单的写法变了，副本要跟着改");
        std::fs::write(&manifest, text).expect("写回");
        for dir in ["stories", "locales/en/stories"] {
            std::fs::remove_dir_all(base.join(dir)).expect("删去故事目录");
        }
        let world = crate::resolve_world(temp.path(), "terra16").expect("世界");
        assert!(!world.manifest.tables.contains_key("stories") && world.files_in("stories").is_empty());
        (temp, world)
    }

    #[test]
    fn unknown_relation_shapes_fail_closed_and_release_graduation_is_supported() {
        for draft in [true, false] {
            for (when, valid) in [
                ("{ surprise=true }", false),
                ("{graduation=true, no_promise_with_protagonist=['a','b']}", true),
                ("{graduation=true, no_promise_with_protagonist=['a','b'],flag='paired'}", true),
                ("{graduation=false, no_promise_with_protagonist=['a','b']}", false),
                ("{graduation=true, no_promise_with_protagonist=[]}", false),
                ("{graduation=true, no_promise_with_protagonist=['a','b'],surprise=true}", false),
            ] {
                let value =
                    toml::from_str(&format!("[[ties]]\na='a'\nb='b'\nkind='friends'\nsince=[1553,1,1]\nwhen={when}"))
                        .expect("TOML");
                assert_eq!(parse_cast(value, "cast/ties.toml", draft).is_ok(), valid, "{when}, draft={draft}");
            }
        }
    }
}
