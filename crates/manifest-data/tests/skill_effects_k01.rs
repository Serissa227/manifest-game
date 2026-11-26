//! K01：寰宇技能的效果进了静态数据、校验通过、在开关打开时真的生效；经典世界不开；写错的效果报数据错误。
use manifest_core::captain::AttrHook;
use manifest_core::items::effects::EffectKind;
use manifest_core::{OwnerId, ScenarioId, World};
use std::collections::BTreeMap;
use std::path::Path;

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

#[test]
fn terra16_skill_effects_load_validate_and_apply() {
    let root = manifest_data::find_data_dir().unwrap();
    let d = manifest_data::load_world(&root, "terra16").unwrap();
    assert!(d.rules.skill_effects.enabled);
    let fx = &d.story2.skill_effects;
    assert_eq!(fx.len(), 100, "skills.toml 的一百个技能都有效果数据");
    assert_eq!(manifest_core::skills::problems(&d), Vec::<String>::new());
    // 各种类在各级里出现的技能数（调查表）：与 skills.toml 一致
    let mut kinds = BTreeMap::<&str, usize>::new();
    for s in fx.values() {
        assert_eq!(s.levels.len(), 3);
        if let Some(e) = s.levels[0].effects.first() {
            *kinds.entry(e.kind.key()).or_default() += 1;
        }
    }
    let want = [
        ("activity_pct", 12),
        ("affinity_pct", 34),
        ("arcana", 34),
        ("bargain_pct", 1),
        ("boarding_pct", 2),
        ("chart_reveal", 1),
        ("disease_guard_pct", 1),
        ("duel_pct", 3),
        ("fatigue_pct", 2),
        ("find_pct", 1),
        ("gunnery_pct", 1),
        ("landing_pct", 2),
        ("morale_daily", 1),
        ("price_hint", 2),
        ("speed_pct", 1),
        ("storm_guard_pct", 1),
    ];
    assert_eq!(kinds, want.into_iter().collect::<BTreeMap<_, _>>());
    // 疲劳减免改成了正数（原来写成 −2 / −4 / −6，汇总时负数按 0 算，等于不生效）
    assert_eq!(fx["cooking"].levels[2].effects[0].kind, EffectKind::FatiguePct);
    assert_eq!(fx["cooking"].levels[2].effects[0].value, 6);
    // 开关打开：学到天文航法第 2 级，主角的发现物探查 +6%（基点 600）；第 3 级 +9%，不是三级相加
    let mut w = World::new(d.clone(), ScenarioId(0), 7).unwrap();
    let before = w.attr_hook(OwnerId::Player, AttrHook::Find);
    let xp = |w: &mut World, v: i64| {
        w.state.items.owners.entry(OwnerId::Player).or_default().skill_xp.insert("astral_navigation".into(), v);
    };
    xp(&mut w, 180);
    assert_eq!(w.attr_hook(OwnerId::Player, AttrHook::Find), before + 600);
    xp(&mut w, 360);
    assert_eq!(w.attr_hook(OwnerId::Player, AttrHook::Find), before + 900);
    // 经典世界：没有这一节，开关关着，也没有技能数据
    let classic = manifest_data::load_world(&root, "classic").unwrap();
    assert!(!classic.rules.skill_effects.enabled && classic.story2.skill_effects.is_empty());
}

#[test]
fn bad_skill_effects_are_data_errors() {
    let root = manifest_data::find_data_dir().unwrap();
    let cases: &[(&str, &str, &[&str])] = &[
        // 不认识的效果种类
        (
            "{ level = 2, xp = 180, effects = [{ kind = \"find_pct\", value = 6 }] }",
            "{ level = 2, xp = 180, effects = [{ kind = \"find_pctt\", value = 6 }] }",
            &["skills.toml", "astral_navigation", "levels"],
        ),
        // 疲劳减免写成负数
        (
            "{ level = 1, xp = 60, effects = [{ kind = \"fatigue_pct\", value = 2 }] }",
            "{ level = 1, xp = 60, effects = [{ kind = \"fatigue_pct\", value = -2 }] }",
            &["skills.toml", "cooking", "fatigue_pct", "-2"],
        ),
        // 限定的活动不是养成活动
        (
            "{ level = 3, xp = 360, effects = [{ kind = \"activity_pct\", value = 9 }] }",
            "{ level = 3, xp = 360, effects = [{ kind = \"activity_pct\", value = 9, activity = \"tea_gathering\" }] }",
            &["tea_gathering", "不是养成活动的 key"],
        ),
        // 阈值与技能等级表不一致
        (
            "{ level = 2, xp = 180, effects = [{ kind = \"landing_pct\", value = 6 }] }",
            "{ level = 2, xp = 170, effects = [{ kind = \"landing_pct\", value = 6 }] }",
            &["skills.toml", "tide_reading", "skill_profiles"],
        ),
    ];
    for (from, to, needles) in cases {
        let tmp = tempfile::tempdir().unwrap();
        copy_dir(&root, tmp.path());
        let path = tmp.path().join("worlds").join("terra16").join("skills.toml");
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.contains(from), "样例替换目标“{from}”不在 skills.toml 中");
        std::fs::write(&path, text.replacen(from, to, 1)).unwrap();
        let msg = match manifest_data::load_world(tmp.path(), "terra16") {
            Ok(_) => panic!("写错的技能效果（{from} → {to}）应被拒绝"),
            Err(e) => e.to_string(),
        };
        for needle in *needles {
            assert!(msg.contains(needle), "错误信息应包含“{needle}”：\n{msg}");
        }
    }
}
