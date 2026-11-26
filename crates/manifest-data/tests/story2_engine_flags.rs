//! 引擎设置者必须来自当前世界定义，不能靠待交付登记放行。
use manifest_core::{StaticData, history, story2::graph, upbringing};
use serde_json::json;
use std::sync::{Arc, OnceLock};

fn defs(flags: &[&str]) -> StaticData {
    static BASE: OnceLock<Arc<StaticData>> = OnceLock::new();
    let mut defs =
        BASE.get_or_init(|| manifest_data::load(&manifest_data::find_data_dir().unwrap()).unwrap()).as_ref().clone();
    defs.story2 = serde_json::from_value(json!({"tracks":[{
        "key":"reader","name":"读取旗标","kind":"request","start":"a","chapters":[{
            "key":"a","title":"测试","text":"测试旗标来源。",
            "when":flags.iter().map(|flag| json!({"kind":"flag","flag":flag})).collect::<Vec<_>>(),
            "choices":[{"key":"end","text":"结束","next":"done"}]
        }]
    }]}))
    .unwrap();
    defs.upbringing = Default::default();
    defs.history = Default::default();
    defs
}

fn family() -> upbringing::FamilyDef {
    serde_json::from_value(json!({
        "key":"fixture","name":"测试家庭","scenario":"fixture","home":"fixture",
        "born":[1540,1,1],"gender":"f","stages":[],"graduation":[1557,1,1]
    }))
    .unwrap()
}

fn assert_sourced_and_pending_rejected(defs: &mut StaticData, flags: &[&str]) {
    assert!(graph::validate_world(defs).is_empty(), "{:?}", graph::validate_world(defs));
    defs.story2.pending_flags.extend(flags.iter().map(|flag| (*flag).to_string()));
    let errors = graph::validate_world(defs);
    assert_eq!(errors.len(), flags.len(), "{errors:?}");
    for flag in flags {
        assert!(errors.iter().any(|error| error.contains("已有故事设置") && error.ends_with(flag)), "{errors:?}");
    }
    defs.story2.pending_flags.clear();
}

#[test]
fn graduation_engine_flags_require_an_upbringing_definition() {
    let flags = upbringing::ENGINE_FLAGS;
    assert!(flags.contains(&upbringing::GRADUATED_FLAG));
    let mut defs = defs(flags);
    assert_eq!(graph::validate_world(&defs).len(), flags.len());
    defs.upbringing.families.push(family());
    assert_sourced_and_pending_rejected(&mut defs, flags);
    defs.upbringing.families.clear();
    assert_eq!(graph::validate_world(&defs).len(), flags.len());
}

#[test]
fn family_and_path_capital_grant_once_flags_are_sources() {
    // 任意 key 都从定义读取，家庭默认资本与志向资本均能单独成为来源。
    for from_path in [false, true] {
        let flag = "fixture_capital";
        let mut defs = defs(&[flag]);
        assert!(graph::validate_world(&defs).iter().any(|e| e.contains("旗标没有来源")));
        let capital = json!({"grant_once":flag});
        if from_path {
            defs.upbringing.paths.push(
                serde_json::from_value(json!({
                    "key":"fixture_path","name":"测试志向","description":"测试资本。","capital":capital
                }))
                .unwrap(),
            );
        } else {
            let mut family = family();
            family.completion = Some(serde_json::from_value(json!({"capital":capital})).unwrap());
            defs.upbringing.families.push(family);
        }
        assert_sourced_and_pending_rejected(&mut defs, &[flag]);
    }
}

#[test]
fn estate_and_caravan_grant_once_flags_are_sources() {
    let flags = ["fixture_estate", "fixture_caravan"];
    let mut defs = defs(&flags);
    let mut family = family();
    family.completion = Some(
        serde_json::from_value(json!({"capital":{
            "estate":{"kind":"plantation","industry":"farm","loc":"fixture","good":"grain",
                "level":1,"workers":1,"source":"family_capital","grant_once":flags[0]},
            "caravan":{"loc":"fixture","animal":"camel","capacity":1,"guards":0,"cargo":{},
                "cash":0,"source":"family_capital","grant_once":flags[1]}
        }}))
        .unwrap(),
    );
    defs.upbringing.families.push(family);
    assert_sourced_and_pending_rejected(&mut defs, &flags);
}

#[test]
fn historical_outcome_true_effects_are_sources_but_clears_are_not() {
    let flag = "fixture_historical_outcome";
    let mut defs = defs(&[flag]);
    defs.history = serde_json::from_value(json!({"events":[{
        "key":"fixture","title":"测试历史","history":{"date":[1553,1,1],"outcome":"ending"},
        "sides":[],"outcomes":[{"key":"ending","when":"always","default":true,
            "effects":[{"kind":"flag","flag":flag}]}]
    }]}))
    .unwrap();
    assert_eq!(defs.history.outcome_flags().collect::<Vec<_>>(), vec![flag]);
    assert_sourced_and_pending_rejected(&mut defs, &[flag]);
    defs.history.events[0].outcomes[0].effects[0] =
        history::Effect::Story(manifest_core::story2::Effect::Flag { flag: flag.into(), value: false });
    assert!(defs.history.outcome_flags().next().is_none());
    assert_eq!(graph::validate_world(&defs), vec![format!("reader:a: 旗标没有来源：{flag}")]);
}

#[test]
fn terra16_loads_and_validates_without_temporary_engine_flag_declarations() {
    let root = manifest_data::find_data_dir().unwrap();
    // 2026-11-02 起寰宇是成品世界：草稿校验器拒绝它，改走生产加载（完整数据校验见 validate-data 与 xtask 第 11 项）。
    assert!(manifest_data::worlds::validate_draft_world(&root, "terra16").is_err());
    let defs = manifest_data::load_world(&root, "terra16").expect("寰宇整包生产加载");
    assert!(defs.story2.pending_flags.is_empty());
    assert!(graph::validate_world(&defs).is_empty());
    let voyage_flags: std::collections::BTreeSet<_> =
        defs.upbringing.families.iter().filter_map(|f| f.completion.as_ref()?.capital.grant_once.as_deref()).collect();
    assert_eq!(voyage_flags.len(), 21);
    assert!(defs.history.outcome_flags().any(|flag| flag == "h44_shimanto_ichijo_holds_hata"));
}
