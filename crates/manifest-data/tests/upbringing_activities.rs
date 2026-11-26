//! 实际样例活动的闭包、区间、打工三段与英文覆盖。
use std::path::Path;
fn copy(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for e in std::fs::read_dir(from).unwrap() {
        let e = e.unwrap();
        let dest = to.join(e.file_name());
        if e.path().is_dir() {
            copy(&e.path(), &dest)
        } else {
            std::fs::copy(e.path(), dest).unwrap();
        }
    }
}
#[test]
fn sample_has_eighteen_activities_three_job_tiers_and_translated_tier_names() {
    let root = manifest_data::find_data_dir().unwrap();
    let d = manifest_data::load_world(&root, "testbed").unwrap();
    assert_eq!(d.upbringing.activities.len(), 18);
    assert_eq!(d.upbringing.rules.annual_growth_cap, 300);
    let levels = d
        .upbringing
        .activities
        .iter()
        .filter_map(|a| a.tier.as_ref())
        .map(|t| t.level)
        .collect::<std::collections::BTreeSet<_>>();
    assert_eq!(levels, std::collections::BTreeSet::from([1, 2, 3]));
    let effective = manifest_data::resolve_world(&root, "testbed").unwrap();
    let ai = manifest_data::ai_content::load_world_ai_content(&effective).unwrap();
    let (en, issues) = manifest_data::locale::load_world_locale_lenient(&effective, manifest_data::Locale::En, &d, &ai);
    assert!(issues.iter().all(|i| !i.file.contains("upbringing")), "{issues:?}");
    assert!(en.missing.iter().all(|i| !i.file.contains("upbringing")), "{:?}", en.missing);
    assert_eq!(en.defs.upbringing.activity("job_begin").unwrap().tier.as_ref().unwrap().name, "Placeholder tier");
    assert_eq!(
        en.defs.upbringing.activity("job_begin").unwrap().gains,
        d.upbringing.activity("job_begin").unwrap().gains
    );
    assert_eq!(en.defs.meta.hash, d.meta.hash);
}
#[test]
fn loader_rejects_all_activity_numeric_and_reference_boundaries() {
    let tmp = tempfile::tempdir().unwrap();
    copy(&manifest_data::find_data_dir().unwrap(), tmp.path());
    let path = tmp.path().join("worlds/testbed/upbringing/activities.toml");
    let original = std::fs::read_to_string(&path).unwrap();
    for (from, to) in [
        ("wit = [6, 10]", "missing_attr = [6, 10]"),
        ("wit = [6, 10]", "wit = [10, 6]"),
        ("cost = 2", "cost = -1"),
        ("fatigue = 6", "fatigue = 101"),
        ("kind = \"lesson\"", "kind = \"lesson\"\nmentor = \"missing\""),
        ("kind = \"lesson\"", "kind = \"lesson\"\nskills = [{ skill = \"missing\", xp = 1 }]"),
        ("ribbon = 1", "missing_item = 1"),
        ("failure_bp = 1000", "failure_bp = 10001"),
        ("income_pct = 25", "income_pct = 101"),
        ("after = 6", "after = 999"),
        ("\"upbringing_short\"", "\"missing_event\""),
        ("needs = [\"book\"]", "needs = [\"book\",\"book\"]"),
    ] {
        assert!(original.contains(from));
        std::fs::write(&path, original.replacen(from, to, 1)).unwrap();
        assert!(manifest_data::load_world(tmp.path(), "testbed").is_err(), "{from} -> {to}");
    }
    std::fs::write(&path, original).unwrap();
    let common = tmp.path().join("worlds/testbed/upbringing/common.toml");
    let original = std::fs::read_to_string(&common).unwrap();
    for to in ["annual_growth_cap = 1001", "annual_growth_cap = -1"] {
        std::fs::write(&common, original.replace("annual_growth_cap = 300", to)).unwrap();
        assert!(manifest_data::load_world(tmp.path(), "testbed").is_err());
    }
}
