//! K01：技能效果——每种接上的效果都改变它的读取点；只有当前等级生效；与物品同受上限；开关关着时等价；旧存档照读。
//! 养成那一侧（活动收益、疲劳减免）的测试在 `upbringing/weekly/tests.rs`。
use super::*;
use crate::captain::AttrHook;
use crate::items::effects::EffectLimit;
use crate::mates::RoleTarget;
use crate::replay::StartParams;
use crate::upbringing::native_defs::SkillProfile;
use crate::{FleetId, Fx, SaveFile, ScenarioId, testkit};
use serde_json::json;
use std::sync::Arc;

const P: OwnerId = OwnerId::Player;
/// 与寰宇相同的累计阈值。
const XP: [i64; 3] = [60, 180, 360];

/// 一个技能：三级效果分别是 `values`。
fn skill(kind: EffectKind, values: [i64; 3]) -> SkillEffects {
    SkillEffects {
        max_level: 3,
        summary: vec![Effect::plain(kind, values[0])],
        levels: (0..3)
            .map(|i| SkillLevelEffects {
                level: i as u32 + 1,
                xp: XP[i],
                effects: vec![Effect::plain(kind, values[i])],
            })
            .collect(),
    }
}

/// 测试里的技能：每种接上的效果一个（比例类 3 / 6 / 9，数量类 1 / 2 / 3），再加一个没有读取点的 `chart_reveal`。
fn table() -> Vec<(&'static str, SkillEffects)> {
    use EffectKind::*;
    vec![
        ("astral", skill(FindPct, [3, 6, 9])),
        ("tide", skill(LandingPct, [3, 6, 9])),
        ("rigging", skill(SpeedPct, [2, 4, 6])),
        ("ledger", skill(PriceHint, [1, 2, 3])),
        ("sword", skill(DuelPct, [3, 6, 9])),
        ("staff", skill(BoardingPct, [3, 6, 9])),
        ("firearms", skill(GunneryPct, [3, 6, 9])),
        ("shipwright", skill(StormGuardPct, [3, 6, 9])),
        ("herbs", skill(DiseaseGuardPct, [3, 6, 9])),
        ("music", skill(MoraleDaily, [1, 2, 3])),
        ("etiquette", skill(AffinityPct, [2, 4, 6])),
        ("alchemy", skill(Arcana, [1, 2, 3])),
        ("haggle", skill(BargainPct, [2, 4, 6])),
        ("chart", skill(ChartReveal, [1, 2, 3])),
    ]
}

/// 小世界：H01 的岗位效果开着（舰队类读取点要它），技能效果按 `enabled`；没有物品模块。
fn defs(enabled: bool) -> StaticData {
    let mut d = (*testkit::tiny_defs()).clone();
    d.rules.voyage_posts.enabled = true;
    d.rules.skill_effects.enabled = enabled;
    // 开局不带航海士：岗位与主角“取较高者”，在岗的舰长会把主角的航速加成盖住
    d.scenarios[0].mates.clear();
    for (key, s) in table() {
        d.story2.skills.insert(key.into());
        d.story2.skill_effects.insert(key.into(), s);
        d.upbringing.skill_profiles.insert(
            key.into(),
            SkillProfile { thresholds: XP.to_vec(), flags: vec![], cultures: vec![], unavailable: false },
        );
    }
    d
}

fn world(d: StaticData) -> (World, FleetId) {
    let w = World::new(Arc::new(d), ScenarioId(0), 42).unwrap();
    let f = w.flagship(P).unwrap();
    (w, f)
}

fn learn(w: &mut World, key: &str, xp: i64) {
    w.state.items.owners.entry(P).or_default().skill_xp.insert(key.into(), xp);
}

/// 各读取点的数（舰队类按旗舰）。
fn readers(w: &World, f: FleetId) -> Vec<(&'static str, i64)> {
    vec![
        ("find", w.attr_hook(P, AttrHook::Find)),
        ("landing", w.attr_hook(P, AttrHook::Landing)),
        ("speed", w.fleet_speed_bonus(f).0),
        ("market_window", w.attr_hook(P, AttrHook::MarketWindow)),
        ("duel", w.post_value(f, AttrHook::Duel)),
        ("melee", w.post_value(f, AttrHook::Melee)),
        ("naval_combat", (w.fleet_combat_mult(f) - Fx::ONE).0),
        ("storm", w.post_value(f, AttrHook::StormCheck)),
        ("disease", w.post_value(f, AttrHook::DiseaseGuard)),
        ("morale", w.post_value(f, AttrHook::Morale)),
        ("affinity", w.attr_hook(P, AttrHook::AffinityGain)),
        ("spell_power", w.attr_hook(P, AttrHook::SpellPower)),
        ("bargain", w.staffed_hook(P, AttrHook::BargainDiscount, RoleTarget::Owner)),
        ("chart_reveal", w.attr_hook(P, AttrHook::ChartReveal)),
    ]
}

#[test]
fn each_connected_kind_moves_its_reader() {
    // 第 2 级（经验 180）：比例类 6%（基点 600；舰队类的岗位值按百分点 6），数量类 2。
    let expected: [(&str, &str, i64); 13] = [
        ("astral", "find", 600),
        ("tide", "landing", 600),
        ("rigging", "speed", 400),
        ("ledger", "market_window", 2),
        ("sword", "duel", 6),
        ("staff", "melee", 6),
        ("firearms", "naval_combat", 600),
        ("shipwright", "storm", 6),
        ("herbs", "disease", 6),
        ("music", "morale", 2),
        ("etiquette", "affinity", 400),
        ("alchemy", "spell_power", 2),
        ("haggle", "bargain", 400),
    ];
    let (plain, f) = world(defs(true));
    let base = readers(&plain, f);
    for (skill, reader, delta) in expected {
        let (mut w, f) = world(defs(true));
        learn(&mut w, skill, 180);
        for ((name, before), (_, after)) in base.iter().zip(readers(&w, f)) {
            let want = if *name == reader { before + delta } else { *before };
            assert_eq!(after, want, "技能 {skill} → 读取点 {name}");
        }
    }
    // 没有读取点的 chart_reveal：学了也什么都不变（不进汇总）。
    let (mut w, f) = world(defs(true));
    learn(&mut w, "chart", 360);
    assert_eq!(readers(&w, f), base);
    assert!(w.skill_effect_sources().is_empty());
    assert_eq!(w.skill_effects_now("chart"), [Effect::plain(EffectKind::ChartReveal, 3)]);
}

#[test]
fn only_the_current_level_counts() {
    for (xp, find) in [(0, 0), (59, 0), (60, 300), (179, 300), (180, 600), (360, 900), (9_999, 900)] {
        let (mut w, _) = world(defs(true));
        learn(&mut w, "astral", xp);
        // 第 3 级是 9%，不是 3 + 6 + 9。
        assert_eq!(w.attr_hook(P, AttrHook::Find), find, "经验 {xp}");
    }
    // 没写 levels 的技能取顶层 effects；0 级为空。
    let s = SkillEffects { max_level: 0, summary: vec![Effect::plain(EffectKind::FindPct, 4)], levels: vec![] };
    assert_eq!((s.at(0), s.at(2)), (&[][..], &[Effect::plain(EffectKind::FindPct, 4)][..]));
}

#[test]
fn skills_share_the_item_caps() {
    let mut d = defs(true);
    // 两件“使用中”的消耗品各给 发现物探查 30%（单件上限 30%）：与技能 9% 合计 69%，压到叠加上限 50%。
    d.items = serde_json::from_value(json!({"items":[
        {"key":"lens","name":"镜","kind":"curio","rarity":1,"price":10,"use":[{"kind":"find_pct","value":30}]},
        {"key":"map","name":"图","kind":"curio","rarity":1,"price":10,"use":[{"kind":"find_pct","value":30}]}
    ]}))
    .unwrap();
    let (mut w, _) = world(d.clone());
    learn(&mut w, "astral", 360);
    assert_eq!(w.attr_hook(P, AttrHook::Find), 900);
    assert_eq!(w.captain_effect_total(EffectKind::FindPct), EffectTotal { raw: 9, applied: 9 });
    let active = &mut w.state.items.owners.entry(P).or_default().active;
    for item in ["lens", "map"] {
        active.push(crate::items::inventory::ActiveItem { item: item.into(), until: 10_000 });
    }
    assert_eq!(w.attr_hook(P, AttrHook::Find), 5_000);
    assert_eq!(w.captain_effect_total(EffectKind::FindPct), EffectTotal { raw: 69, applied: 50 });
    // 世界收紧上限时技能同样受约束：单件 5%、合计 8%。
    d.rules.items.effects.insert(EffectKind::FindPct, EffectLimit { single: 5, total: 8 });
    let (mut w, _) = world(d);
    learn(&mut w, "astral", 360);
    assert_eq!(w.attr_hook(P, AttrHook::Find), 500);
    let active = &mut w.state.items.owners.entry(P).or_default().active;
    active.push(crate::items::inventory::ActiveItem { item: "lens".into(), until: 10_000 });
    assert_eq!(w.attr_hook(P, AttrHook::Find), 800);
}

#[test]
fn switch_off_is_the_old_path() {
    // 开关关着：学满全部技能，每个读取点与什么都没学时相同；没有物品模块时 item_hook 照旧是 0。
    let (plain, f) = world(defs(false));
    let base = readers(&plain, f);
    let (mut w, _) = world(defs(false));
    for (key, _) in table() {
        learn(&mut w, key, 360);
    }
    assert_eq!(readers(&w, f), base);
    assert!(w.skill_effect_sources().is_empty());
    assert_eq!(w.item_hook(P, "captain", AttrHook::Find, &Default::default()), 0);
    // 技能效果只给玩家主角：航海士（别的穿戴者）与别的所有者拿不到。
    let (mut on, _) = world(defs(true));
    learn(&mut on, "astral", 360);
    assert_eq!(on.item_hook(P, "captain", AttrHook::Find, &Default::default()), 900);
    let mate = on.defs.mates[0].key.clone();
    assert_eq!(on.item_hook(P, &mate, AttrHook::Find, &Default::default()), 0);
}

#[test]
fn old_saves_load_unchanged_with_the_switch_on() {
    // 开关关着时存的档（带技能经验），在开关打开的数据下照读，状态逐项相同；存档里没有新字段。
    // （物品模块关着、又不在养成期时，读档会按旧规矩清掉技能经验，所以这里登记一件物品。）
    let with_items = |enabled| {
        let mut d = defs(enabled);
        d.items = serde_json::from_value(json!({"items":[
            {"key":"lens","name":"镜","kind":"curio","rarity":1,"price":10,"use":[{"kind":"find_pct","value":30}]}
        ]}))
        .unwrap();
        d
    };
    let off = Arc::new(with_items(false));
    let mut w = World::new(off.clone(), ScenarioId(0), 42).unwrap();
    learn(&mut w, "astral", 200);
    let save = SaveFile::new(&off, StartParams::new(ScenarioId(0), 42), w.state.clone(), vec![]);
    let json = save.to_json().unwrap();
    assert!(!json.contains("skill_effects"));
    let loaded = SaveFile::from_json(&json).unwrap();
    assert_eq!(loaded.version, crate::save::SAVE_VERSION);
    let on = Arc::new(with_items(true));
    loaded.check_compatible(&on).unwrap();
    let w2 = World::from_snapshot(on, loaded.snapshot).unwrap();
    assert_eq!(w2.state, w.state);
    assert_eq!(w2.attr_hook(P, AttrHook::Find), 600);
}

#[test]
fn load_problems_catch_bad_values_and_levels() {
    let mut d = defs(true);
    assert_eq!(problems(&d), Vec::<String>::new());
    let bad = |d: &mut StaticData, key: &str, s: SkillEffects| {
        d.story2.skill_effects.insert(key.into(), s);
    };
    // 负数（疲劳减免写成了 −2）、超过单件上限、没有读取点的也不许超过 100
    bad(&mut d, "neg", skill(EffectKind::FatiguePct, [-2, -4, -6]));
    bad(&mut d, "huge", skill(EffectKind::SpeedPct, [10, 20, 31]));
    bad(&mut d, "chart2", skill(EffectKind::ChartReveal, [1, 2, 101]));
    // 逐级变低
    bad(&mut d, "down", skill(EffectKind::FindPct, [9, 6, 3]));
    // 等级跳号、阈值不递增
    let mut gap = skill(EffectKind::FindPct, [3, 6, 9]);
    gap.levels[1].level = 3;
    gap.levels[2].xp = 100;
    bad(&mut d, "gap", gap);
    // 阈值与技能等级表不一致
    bad(&mut d, "astral", {
        let mut s = skill(EffectKind::FindPct, [3, 6, 9]);
        s.levels[0].xp = 50;
        s
    });
    // 限定参数放错种类
    let mut scoped = skill(EffectKind::FindPct, [3, 6, 9]);
    scoped.levels[0].effects[0].activity = Some("rest".into());
    bad(&mut d, "scoped", scoped);
    let errors = problems(&d);
    for (key, words) in [
        ("neg", "不在 1–30"),
        ("huge", "31 不在"),
        ("chart2", "不在 1–100"),
        ("down", "比第 1 级还低"),
        ("gap", "逐级写到"),
        ("gap", "逐级递增"),
        ("astral", "skill_profiles"),
        ("scoped", "限定参数"),
    ] {
        assert!(
            errors.iter().any(|e| e.contains(&format!("技能 {key}：")) && e.contains(words)),
            "{key} {words}：{errors:?}"
        );
    }
    // 限定的活动名必须是真实的养成活动 key（复用 U05 的校验；这个小世界没有养成活动）。
    let activity = crate::upbringing::validation::effect_activity_problems(&d);
    assert!(activity.iter().any(|e| e.contains("技能 scoped（第 1 级）") && e.contains("rest")), "{activity:?}");
}
