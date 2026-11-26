//! 技能检定显示名读取与显示覆盖，翻译不能改内部key或经验阈值。
use std::path::Path;
fn copy(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for e in std::fs::read_dir(from).unwrap() {
        let e = e.unwrap();
        let dest = to.join(e.file_name());
        if e.file_type().unwrap().is_dir() {
            copy(&e.path(), &dest)
        } else {
            std::fs::copy(e.path(), dest).unwrap();
        }
    }
}
#[test]
fn skill_check_labels_are_localized_without_changing_runtime_keys() {
    let dir = tempfile::tempdir().unwrap();
    copy(&manifest_data::find_data_dir().unwrap(), dir.path());
    std::fs::create_dir_all(dir.path().join("worlds/skill_fixture/locales/en")).unwrap();
    std::fs::write(
        dir.path().join("worlds/skill_fixture/world.toml"),
        "key='skill_fixture'\nname='技能显示夹具'\ninherit='classic'\nhidden=true\n",
    )
    .unwrap();
    std::fs::write(
        dir.path().join("worlds/skill_fixture/skills.toml"),
        "[[skills]]\nkey='sailing'\nname='航法'\ndescription='辨认风向。'\n",
    )
    .unwrap();
    std::fs::write(
        dir.path().join("worlds/skill_fixture/locales/en/skills.toml"),
        "[skills.sailing]\nname='Sailing'\ndescription='Read the wind.'\n",
    )
    .unwrap();
    let defs = manifest_data::load_world(dir.path(), "skill_fixture").unwrap();
    let ai = manifest_data::load_ai_content(dir.path()).unwrap();
    assert!(defs.story2.skills.contains("sailing"));
    assert_eq!(defs.story2.skill_labels[0].name, "航法");
    let world = manifest_data::worlds::resolve_world(dir.path(), "skill_fixture").unwrap();
    let (en, issues) = manifest_data::locale::load_world_locale_lenient(&world, manifest_data::Locale::En, &defs, &ai);
    assert!(issues.is_empty(), "{issues:?}");
    assert_eq!(en.defs.story2.skill_labels[0].name, "Sailing");
    assert_eq!(en.defs.story2.skills, defs.story2.skills);
    std::fs::write(
        dir.path().join("worlds/skill_fixture/locales/en/skills.toml"),
        "[skills.sailing]\nname='Sailing'\nkey='hacked'\n",
    )
    .unwrap();
    let (_, issues) = manifest_data::locale::load_world_locale_lenient(&world, manifest_data::Locale::En, &defs, &ai);
    assert!(!issues.is_empty());
}
