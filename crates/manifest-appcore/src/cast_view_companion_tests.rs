//! 同伴栏必须与完整人物页的对应字段逐字节相同，且查询不改变世界。
use super::*;

const FIELDS: &[&str] = &[
    "key",
    "name",
    "portrait",
    // 学院同伴栏也显示一句话身份
    "summary",
    "bond",
    "affinity",
    "heart",
    "heart_stage",
    "relation",
    "call_name",
    "birthday",
    "days_to_birthday",
    "likes_known",
    "dislikes_known",
    "where",
];

fn fixture() -> World {
    let defs = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let index = defs.scenarios.iter().position(|s| s.key == "upbringing").unwrap();
    World::new(defs, ScenarioId::from_idx(index), 42).unwrap()
}

fn compare(w: &World, names: &StaticData) {
    let before = w.state.clone();
    for key in names.cast.persons.iter().map(|p| p.key.as_str()).chain(["unknown_person"]) {
        let full = person(Ctx::plain(names), w, key);
        let brief = companion(Ctx::plain(names), w, key, None);
        assert_eq!(full.is_some(), brief.is_some(), "{key}");
        if let Some((full, brief)) = full.zip(brief) {
            for field in FIELDS {
                assert_eq!(
                    serde_json::to_vec(&brief[*field]).unwrap(),
                    serde_json::to_vec(&full[*field]).unwrap(),
                    "{key}.{field}"
                );
            }
        }
    }
    assert_eq!(w.state, before);
}

#[test]
fn companion_fields_match_full_person_for_known_unknown_and_protagonist() {
    let w = fixture();
    compare(&w, &w.defs);
}

#[test]
fn companion_fields_match_with_affection_preferences_birthdays_and_localized_names() {
    let mut w = fixture();
    let known: Vec<_> =
        w.defs.items.items.iter().map(|i| i.key.clone()).chain(w.defs.goods.iter().map(|g| g.key.clone())).collect();
    for state in w.state.cast.persons.values_mut() {
        state.met = true;
        state.affection.affinity = 70;
        state.affection.heart = 55;
        state.affection.bond = Some(manifest_core::cast::relations::Bond::B);
        state.interactions.likes_known.extend(known.iter().cloned());
    }
    let mut names = (*w.defs).clone();
    for p in &mut names.cast.persons {
        p.name = format!("Name {}", p.key);
        p.birthday = Some([1, 2]);
    }
    for (day, academy) in [(0, false), (365, true), (730, false)] {
        w.state.day = day;
        w.state.cast.academy = academy;
        compare(&w, &names);
    }
}

#[test]
fn companion_fields_keep_the_same_hidden_location_filtering() {
    let mut w = fixture();
    let defs = std::sync::Arc::make_mut(&mut w.defs);
    defs.manual_navigation = true;
    defs.navigation.hide_unknown_ports = true;
    let hidden = defs.locations.last().unwrap().name.clone();
    for p in &mut defs.cast.persons {
        p.name = format!("{hidden}人物");
    }
    compare(&w, &w.defs);
}
