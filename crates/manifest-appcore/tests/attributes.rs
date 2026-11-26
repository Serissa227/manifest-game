//! I2：属性的 key、分组、评价与岗位均取自世界。
use manifest_appcore::views;
use manifest_core::captain::Birthday;
use manifest_core::{Command, OwnerId, ScenarioId, World};
use std::path::PathBuf;
#[test]
fn dynamic_attribute_json_matches_i2() {
    let d =
        manifest_data::load_world(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data"), "testbed").unwrap();
    let json = serde_json::to_value(views::static_view(&d)).unwrap();
    let c = &json["captain"];
    assert_eq!(c["attributes"].as_array().unwrap().len(), 10);
    assert_eq!(
        c["groups"][0],
        serde_json::json!({"key":"aptitude","name":"资质","range":[1,10],"start":1,"free":3,"creation_cap":7})
    );
    assert_eq!(c["attributes"][9]["group"], "conduct");
    assert_eq!(c["attributes"][9]["hidden"], true);
    assert_eq!(c["ratings"][0]["weights"], serde_json::json!([["navigation", 4], ["numeracy", 3], ["tactics", 3]]));
    assert_eq!(
        c["roles"][0],
        serde_json::json!({"key":"navigator","name":"领航员","ability":"navigation","scope":"fleet"})
    );
    assert!(c["abilities"].as_array().unwrap().contains(&serde_json::json!({"key":"astronomy","name":"观星"})));
    let year = d.rules.world.start_year - 18;
    let mut w = World::new(d, ScenarioId(0), 7).unwrap();
    Command::CreateCaptain {
        owner: OwnerId::Player,
        birthday: Birthday { year, month: 1, day: 31 },
        answers: vec!["library".into()],
        alloc: vec![1, 1, 1, 1, 1, 1, 1, 1, 0, 0],
        genius: None,
    }
    .apply(&mut w)
    .unwrap();
    let v = serde_json::to_value(views::overview(&w, 1, "off".into(), None)).unwrap();
    assert_eq!(v["profile"]["attrs"][7], serde_json::json!(["numeracy", 3]));
    assert_eq!(v["profile"]["ratings"], serde_json::json!([["mariner", 23], ["society", 62]]));
}

#[test]
fn custom_role_command_and_mate_json_keep_the_legacy_shape() {
    use manifest_core::MateId;
    let mut d = (*manifest_data::load_world(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data"), "testbed")
        .unwrap())
    .clone();
    let mut mate = manifest_core::testkit::tiny_defs().mates[0].clone();
    mate.home = d.scenarios[0].start;
    mate.abilities.insert("astronomy".into(), 83);
    d.mates = vec![mate];
    let mut w = World::new(std::sync::Arc::new(d), ScenarioId(0), 7).unwrap();
    w.state.mates.get_mut(&MateId(0)).unwrap().owner = Some(OwnerId::Player);
    let fleet = w.flagship(OwnerId::Player).unwrap();
    let command:Command=serde_json::from_value(serde_json::json!({"AssignMate":{"owner":"player","mate":0,"role":{"Assigned":{"role":0,"target":{"Fleet":fleet.0}}}}})).unwrap();
    command.apply(&mut w).unwrap();
    let v = serde_json::to_value(views::mate_view(&w, MateId(0)).unwrap()).unwrap();
    assert_eq!(v["role"], serde_json::json!({"kind":"assigned","target":fleet.0,"role":0,"scope":"fleet"}));
    assert!(v["abilities"].as_array().unwrap().contains(&serde_json::json!(["astronomy", 83])));
    assert_eq!(
        serde_json::to_value(views::role_view(manifest_core::mates::MateRole::None)).unwrap(),
        serde_json::json!({"kind":"none","target":null})
    );
}

#[test]
fn forecast_window_reads_the_hook_with_an_arbitrary_attribute_key() {
    let mut d = (*manifest_data::load_world(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data"), "testbed")
        .unwrap())
    .clone();
    d.captain.attributes[7].key = "reckoning".into();
    let year = d.rules.world.start_year - 18;
    let mut w = World::new(std::sync::Arc::new(d), ScenarioId(0), 7).unwrap();
    Command::CreateCaptain {
        owner: OwnerId::Player,
        birthday: Birthday { year, month: 1, day: 31 },
        answers: vec!["library".into()],
        alloc: vec![3, 0, 0, 0, 0, 0, 0, 5, 0, 0],
        genius: Some("ses".into()),
    }
    .apply(&mut w)
    .unwrap();
    assert_eq!(manifest_appcore::forecast::max_active(&w), 10);
}
