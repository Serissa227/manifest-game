//! 公开竞渡参数严格保持 I6，真实地图、目标和操舵规则留在私有定义。
use manifest_appcore::{upbringing_view, views::Ctx};
use manifest_core::{
    Cell, ScenarioId, World,
    contests::{Kind, Params, occurrence_key, race},
    navigation::Sail,
};
use std::{collections::BTreeMap, sync::Arc};
#[test]
fn race_view_localizes_choices_without_disclosing_helm_or_map() {
    let mut d = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let start = (0..d.map.height)
        .flat_map(|y| (0..d.map.width - 1).map(move |x| [x, y]))
        .find(|p| d.map.is_sea_in_bounds(Cell::new(p[0], p[1])) && d.map.is_sea_in_bounds(Cell::new(p[0] + 1, p[1])))
        .unwrap();
    let ship = d.ships[0].key.clone();
    let sid = ScenarioId::from_idx(d.scenarios.iter().position(|s| s.key == "upbringing").unwrap());
    let c = &mut Arc::make_mut(&mut d).upbringing.contests[0];
    c.kind = Kind::Race;
    c.params = Params::Race(race::Params {
        legs: vec![race::Leg {
            text: "占位航段".into(),
            options: vec![race::OptionDef { key: "east".into(), text: "占位走法".into(), risk: 15 }],
        }],
    });
    c.scoring.race = Some(race::Track {
        ship,
        start,
        option_points: BTreeMap::new(),
        failed_leg_points: 0,
        legs: vec![race::CourseLeg {
            minutes: 60,
            target: [start[0] + 1, start[1]],
            options: BTreeMap::from([("east".into(), race::Helm { heading: 90, sail: Sail::Full })]),
        }],
    });
    assert!(manifest_core::contests::validation::validate(&d).is_empty());
    let w = World::new(d.clone(), sid, 42).unwrap();
    let before = w.state.clone();
    let mut names = (*d).clone();
    let Params::Race(p) = &mut names.upbringing.contests[0].params else { unreachable!() };
    p.legs[0].text = "Placeholder leg".into();
    p.legs[0].options[0].text = "Placeholder choice".into();
    let v = upbringing_view::contest(Ctx::plain(&names), &w, &occurrence_key("test_match", [1553, 1, 5])).unwrap();
    assert_eq!(v["kind"], "race");
    assert_eq!(v["params"].as_object().unwrap().len(), 1);
    assert_eq!(
        v["params"]["legs"][0],
        serde_json::json!({"text":"Placeholder leg","options":[{"key":"east","text":"Placeholder choice","risk":15}]})
    );
    assert_eq!(before, w.state);
}
