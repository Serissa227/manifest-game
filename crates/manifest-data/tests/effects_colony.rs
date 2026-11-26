//! 殖民相关的组合事件数据：data/effects.toml 的殖民地效果边界（对玩家殖民地的负面幅度有硬上限）、
//! data/templates/composed.toml 的殖民地原型与新商品池、rules.toml 的殖民竞赛节奏；故意损坏的样例被拒绝并给出可读错误。

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
fn real_colony_effects_templates_and_race_rules_are_consistent() {
    let dir = data_dir();
    let defs = manifest_data::load(&dir).unwrap_or_else(|e| panic!("{e}"));
    let rules = &defs.composed;
    for k in [
        EffectKind::ColonyOutput,
        EffectKind::ColonyMorale,
        EffectKind::ColonyGrowth,
        EffectKind::SiteClaim,
        EffectKind::DiscoveryRumor,
    ] {
        assert!(rules.bounds(k).is_some(), "效果词表应包含 {}", k.key());
    }
    // 对玩家殖民地的负面效果温和
    let (lo, _) = rules.bounds(EffectKind::ColonyOutput).unwrap().mult.unwrap();
    assert!(lo >= manifest_core::Fx::from_pct(60));
    let (dlo, _) = rules.bounds(EffectKind::ColonyMorale).unwrap().delta.unwrap();
    assert!(dlo >= -15);
    assert!(rules.colony_grace_days > 0);
    // 离线原型覆盖每种殖民效果；商品池加入了新大陆的新商品
    let content = manifest_data::load_ai_content(&dir).unwrap_or_else(|e| panic!("{e}"));
    let t = &content.templates.composed;
    let used: Vec<&str> = t.archetypes.iter().flat_map(|a| a.effects.iter().map(|e| e.effect.as_str())).collect();
    for k in ["colony_output", "colony_morale", "colony_growth", "site_claim", "discovery_rumor"] {
        assert!(used.contains(&k), "离线原型应用到 {k}");
    }
    let pool: Vec<&str> =
        t.archetypes.iter().flat_map(|a| a.effects.iter().flat_map(|e| e.goods.iter().map(String::as_str))).collect();
    for g in ["maize", "coffee", "gold_ore", "silver_ore", "rum", "jewelry", "porcelain", "whale_oil", "medicine"] {
        assert!(pool.contains(&g), "离线原型的商品池应包含新商品 {g}");
    }
    assert!(manifest_data::check_against_data(&content, &defs).is_empty());
    // 殖民竞赛有节奏限制
    let c = &defs.rules.colony;
    assert!(c.claim_start_day > 0 && c.claim_reach > 0 && c.claim_slot_years > 0 && c.claim_cooldown_days > 0);
    assert!(defs.rules.discovery.rumor_min_fame > 0);
}

#[test]
fn corrupted_colony_effects_are_rejected_with_readable_errors() {
    let cases: &[(&str, &str, &[&str])] = &[
        // 对玩家殖民地过于严厉
        ("mult = [0.75, 1.4]", "mult = [0.3, 1.4]", &["effects.toml", "effects[colony_output]", "克制"]),
        ("delta = [-8, 12]", "delta = [-40, 12]", &["effects.toml", "effects[colony_morale]", "克制"]),
        // 殖民点上的效果不能设置 port_only
        (
            "effect = \"colony_growth\"",
            "effect = \"colony_growth\"\nport_only = true",
            &["effects.toml", "effects[colony_growth]", "port_only"],
        ),
        // 一次性效果不使用天数
        (
            "effect = \"site_claim\"",
            "effect = \"site_claim\"\ndays = [10, 20]",
            &["effects.toml", "effects[site_claim]", "days"],
        ),
        ("colony_grace_days = 90", "colony_grace_days = 9000", &["effects.toml", "colony_grace_days"]),
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
    let tmp = corrupted("rules.toml", "claim_reach = 40", "claim_reach = 4000");
    let msg = manifest_data::load(tmp.path()).unwrap_err().to_string();
    assert!(msg.contains("rules.toml") && msg.contains("claim_reach"), "{msg}");
    let tmp = corrupted("rules.toml", "rumor_min_fame = 10", "rumor_min_fame = -3");
    let msg = manifest_data::load(tmp.path()).unwrap_err().to_string();
    assert!(msg.contains("rumor_min_fame"), "{msg}");
}

#[test]
fn corrupted_colony_templates_are_rejected_with_readable_errors() {
    let rel = "templates/composed.toml";
    let cases: &[(&str, &str, &[&str])] = &[
        // 殖民点上的效果与港口的地点效果不能混在一个原型里
        (
            "{ effect = \"colony_morale\", delta = [5, 10] },",
            "{ effect = \"colony_morale\", delta = [5, 10] },\n  { effect = \"location_demand\", mult = [1.1, 1.2], days = [10, 20] },",
            &["composed.toml", "archetypes[colony_founders_day]", "殖民点"],
        ),
        // 殖民地效果与占领殖民点不能混用
        (
            "  { effect = \"site_claim\" },",
            "  { effect = \"site_claim\" },\n  { effect = \"colony_morale\", delta = [2, 4] },",
            &["composed.toml", "archetypes[rival_flag]", "占领殖民点"],
        ),
        // 只有殖民地产量效果可以列建筑
        (
            "{ effect = \"colony_growth\", mult = [1.2, 1.5], days = [45, 90] },",
            "{ effect = \"colony_growth\", buildings = [\"farm\"], mult = [1.2, 1.5], days = [45, 90] },",
            &["composed.toml", "archetypes[colony_migrant_wave]", "buildings"],
        ),
        // 传闻原型不能用它提供不了的变量
        (
            "titles = [\"酒馆里的传说\", \"老水手的海图\"]",
            "titles = [\"{colony}的传说\", \"老水手的海图\"]",
            &["composed.toml", "archetypes[sailors_tale]", "{colony}"],
        ),
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
    // 与静态数据的一致性：不存在的建筑、没有产出的建筑
    let dir = data_dir();
    let defs = manifest_data::load(&dir).unwrap();
    let base = manifest_data::load_ai_content(&dir).unwrap();
    let find = |c: &manifest_data::AiContent, key: &str| -> usize {
        c.templates.composed.archetypes.iter().position(|a| a.key == key).unwrap()
    };
    for (bad, needle) in [("windmill", "不存在的殖民地建筑"), ("storehouse", "没有产出")] {
        let mut c = base.clone();
        let i = find(&c, "colony_artisans");
        c.templates.composed.archetypes[i].effects[0].buildings = vec![bad.into()];
        let issues = manifest_data::check_against_data(&c, &defs);
        assert!(
            issues.iter().any(|x| x.to_string().contains("colony_artisans") && x.message.contains(needle)),
            "{issues:?}"
        );
    }
}
