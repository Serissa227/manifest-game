//! 家庭缺省成长里的品行类（0–100，起点 50）不能照本领类（0–1000）的刻度写：校验拒绝越界值；
//! 即使旧数据或夹具越界，跳过养成兑现到正式属性时品行也不会超过 100。
use manifest_core::{Command, OwnerId, ScenarioId, StaticData, World};
use std::sync::Arc;

fn testbed() -> StaticData {
    (*manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap()).clone()
}

fn set_default(d: &mut StaticData, key: &str, value: i64) {
    let family = d.upbringing.families.iter_mut().find(|f| f.key == "test_family").unwrap();
    family.completion.as_mut().unwrap().defaults.growth.insert(key.into(), value);
}

#[test]
fn conduct_defaults_over_one_hundred_are_rejected() {
    let bad = "test_family: 缺省成长含未知引用或越界值";
    let mut d = testbed();
    set_default(&mut d, "honor", 300);
    assert!(manifest_core::upbringing::validation::validate(&d).iter().any(|e| e == bad));
    set_default(&mut d, "honor", 80);
    assert!(!manifest_core::upbringing::validation::validate(&d).iter().any(|e| e == bad));
    // 本领类照旧可以写到 1000
    set_default(&mut d, "navigation", 1000);
    assert!(!manifest_core::upbringing::validation::validate(&d).iter().any(|e| e == bad));
}

#[test]
fn skipping_upbringing_never_writes_conduct_above_one_hundred() {
    let mut d = testbed();
    set_default(&mut d, "honor", 300);
    let i = d.scenarios.iter().position(|s| s.key == "upbringing").unwrap();
    let mut w = World::new(Arc::new(d), ScenarioId::from_idx(i), 42).unwrap();
    Command::SkipUpbringing { owner: OwnerId::Player }.apply(&mut w).unwrap();
    // 跳过只打开开关，世界照常逐日推进到结业（测试海域的养成期四年）
    for _ in 0..2000 {
        if !w.upbringing_active() {
            break;
        }
        w.end_day().unwrap();
    }
    assert!(!w.upbringing_active(), "四年内应当结业");
    let honor = w.defs.captain.attribute_index("honor").unwrap();
    let attrs = &w.state.agents[&OwnerId::Player].captain.as_ref().unwrap().attrs;
    assert!((0..=100).contains(&attrs[honor]), "品行兑现越界：{}", attrs[honor]);
}
