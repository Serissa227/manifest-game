//! 严格世界实际经过转换器核对原创许可；许可不能替代出处。
use super::*;

fn issues(dir: &EffectiveWorld, file: &str) -> Issues {
    let mut issues = Issues::default();
    match file {
        "societies.toml" => {
            let _ = societies::load(dir, &mut issues);
        }
        "arcana.toml" => {
            let _ = arcana::load(dir, &mut issues);
        }
        _ => unreachable!(),
    }
    issues
}

#[test]
fn strict_fantasy_groups_need_exact_original_permission_and_nonempty_sources() {
    let root = crate::find_data_dir().unwrap();
    for (file, table) in [("societies.toml", "societies"), ("arcana.toml", "schools")] {
        let mut dir = crate::resolve_world(&root, "testbed").unwrap();
        let mut source: toml::Value = toml::from_str(&dir.read(file).unwrap()).unwrap();
        let key = source[table][0]["key"].as_str().unwrap().to_owned();
        assert!(issues(&dir, file).list.is_empty());
        dir.manifest.lore.sourcing = crate::worlds::Sourcing::Strict;
        dir.manifest.lore.allow_original = vec!["unrelated_group".into()];
        let denied = issues(&dir, file);
        assert!(denied.list.iter().any(|issue| issue.item == key && issue.message.contains("allow_original")));
        dir.manifest.lore.allow_original.push(key);
        assert!(issues(&dir, file).list.is_empty());

        source[table][0]["sources"] = toml::Value::Array(vec![]);
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join(file);
        std::fs::write(&path, toml::to_string(&source).unwrap()).unwrap();
        dir.files.get_mut(file).unwrap().sources = vec![path];
        assert!(issues(&dir, file).list.iter().any(|issue| issue.message.contains("sources")));
    }
}
