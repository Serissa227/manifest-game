//! 组合事件的数据：data/effects.toml（效果词表与边界）与 data/templates/composed.toml（离线原型）
//! 通过校验、彼此一致；故意损坏的样例会被拒绝并给出可读错误。

use manifest_core::defs::EffectKind;
use std::path::{Path, PathBuf};

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

/// 复制一份 data/，对某个文件做替换，返回临时目录。
fn corrupted(rel: &str, from: &str, to: &str) -> tempfile::TempDir {
    let tmp = tempfile::tempdir().unwrap();
    copy_dir(&data_dir(), tmp.path());
    let path = rel.split('/').fold(tmp.path().to_path_buf(), |p, part| p.join(part));
    let text = std::fs::read_to_string(&path).unwrap();
    assert!(text.contains(from), "样例替换目标“{from}”不在 {rel} 中");
    std::fs::write(&path, text.replacen(from, to, 1)).unwrap();
    tmp
}

#[test]
fn real_effects_and_templates_are_valid_and_consistent() {
    let dir = data_dir();
    let defs = manifest_data::load(&dir).unwrap_or_else(|e| panic!("{e}"));
    let rules = &defs.composed;
    let listed: Vec<EffectKind> = rules.effects.iter().map(|b| b.effect).collect();
    for k in EffectKind::ALL {
        assert!(listed.contains(&k), "效果词表应覆盖 {}", k.key());
    }
    assert!((1..=5).contains(&rules.max_effects) && rules.max_per_year > 0 && rules.budget > manifest_core::Fx::ZERO);
    let content = manifest_data::load_ai_content(&dir).unwrap_or_else(|e| panic!("{e}"));
    let t = &content.templates.composed;
    assert!(t.archetypes.len() >= 15, "至少 15 个组合事件原型");
    assert!(!t.sources.is_empty());
    let issues = manifest_data::check_against_data(&content, &defs);
    assert!(issues.is_empty(), "{}", issues.iter().map(|i| i.to_string()).collect::<Vec<_>>().join("\n"));
    // 每种效果至少被一个原型用到（离线也能覆盖整个词表的大部分）
    let used: Vec<&str> = t.archetypes.iter().flat_map(|a| a.effects.iter().map(|e| e.effect.as_str())).collect();
    let covered = EffectKind::ALL.iter().filter(|k| used.contains(&k.key())).count();
    assert!(covered >= 12, "离线原型只用到 {covered} 种效果");
}

#[test]
fn corrupted_effects_are_rejected_with_readable_errors() {
    let cases: &[(&str, &str, &[&str])] = &[
        ("max_effects = 3", "max_effects = 9", &["effects.toml", "max_effects"]),
        ("budget = 1.0", "budget = 0", &["effects.toml", "budget"]),
        ("effect = \"good_supply\"", "effect = \"gold_rain\"", &["effects.toml", "gold_rain", "效果集合"]),
        ("effect = \"good_demand\"", "effect = \"good_supply\"", &["effects.toml", "effects[good_supply]", "重复"]),
        ("mult = [0.6, 1.5]", "mult = [0.6, 9.5]", &["effects.toml", "effects[good_supply]", "mult"]),
        ("peace_delta = [-12, 25]", "peace_delta = [-40, 25]", &["effects.toml", "relation_shift", "peace_delta"]),
        ("delta = [-6, 6]", "delta = [-6, 6]\nmult = [0.5, 1.5]", &["effects.toml", "effects[development]", "mult"]),
        ("max_title_chars = 20", "max_title_chars = 20\ncolour = 1", &["effects.toml", "colour"]),
    ];
    for (from, to, needles) in cases {
        let tmp = corrupted("effects.toml", from, to);
        let msg = match manifest_data::load(tmp.path()) {
            Ok(_) => panic!("损坏的数据（effects.toml：{from} → {to}）应被拒绝"),
            Err(e) => e.to_string(),
        };
        for needle in *needles {
            assert!(msg.contains(needle), "错误信息应包含“{needle}”：\n{msg}");
        }
    }
    // 缺少文件
    let tmp = tempfile::tempdir().unwrap();
    copy_dir(&data_dir(), tmp.path());
    std::fs::remove_file(tmp.path().join("effects.toml")).unwrap();
    let msg = manifest_data::load(tmp.path()).unwrap_err().to_string();
    assert!(msg.contains("effects.toml"), "{msg}");
}

#[test]
fn corrupted_composed_templates_are_rejected_with_readable_errors() {
    let rel = "templates/composed.toml";
    let cases: &[(&str, &str, &[&str])] = &[
        (
            "\"{faction_a}的议会颁布通商特许状",
            "\"{region}的议会颁布通商特许状",
            &["composed.toml", "archetypes[trade_charter]", "{region}"],
        ),
        (
            "mult = [0.75, 0.9], days = [60, 120]",
            "mult = [0.75, 1.2], days = [60, 120]",
            &["composed.toml", "trade_charter", "跨过 1"],
        ),
        (
            "effect = \"faction_tax\", mult = [0.75, 0.9]",
            "effect = \"gold_rain\", mult = [0.75, 0.9]",
            &["composed.toml", "gold_rain"],
        ),
        ("key = \"calm_seas\"", "key = \"dock_fire\"", &["composed.toml", "key 重复"]),
        ("\"据商会往来的信札所述，\"", "\"{good}的信札：\"", &["composed.toml", "sources", "{good}"]),
    ];
    for (from, to, needles) in cases {
        let tmp = corrupted(rel, from, to);
        let msg = match manifest_data::load_ai_content(tmp.path()) {
            Ok(_) => panic!("损坏的模板（{from} → {to}）应被拒绝"),
            Err(e) => e.to_string(),
        };
        for needle in *needles {
            assert!(msg.contains(needle), "错误信息应包含“{needle}”：\n{msg}");
        }
    }
    // 与静态数据的一致性：越出 effects.toml 的边界、不存在的商品、取最大幅度时超出总强度预算
    let dir = data_dir();
    let defs = manifest_data::load(&dir).unwrap();
    let base = manifest_data::load_ai_content(&dir).unwrap();
    let find = |c: &mut manifest_data::AiContent, key: &str| -> usize {
        c.templates.composed.archetypes.iter().position(|a| a.key == key).unwrap()
    };
    let mut c = base.clone();
    let i = find(&mut c, "dock_fire");
    c.templates.composed.archetypes[i].effects[0].mult = Some([0.1, 0.2]);
    let issues = manifest_data::check_against_data(&c, &defs);
    assert!(issues.iter().any(|x| x.to_string().contains("dock_fire") && x.message.contains("mult")), "{issues:?}");
    let mut c = base.clone();
    let i = find(&mut c, "dock_fire");
    c.templates.composed.archetypes[i].effects[1].goods.push("unobtainium".into());
    let issues = manifest_data::check_against_data(&c, &defs);
    assert!(issues.iter().any(|x| x.message.contains("unobtainium")), "{issues:?}");
    let mut c = base;
    let i = find(&mut c, "storm_front");
    c.templates.composed.archetypes[i].effects[0].mult = Some([1.4, 2.4]);
    let issues = manifest_data::check_against_data(&c, &defs);
    assert!(issues.iter().any(|x| x.message.contains("总强度预算")), "{issues:?}");
}
