//! U04：新诗会的分值提示读取同一计分函数，未启用的旧题仍不公开私有答案。
use manifest_appcore::{upbringing_view, views::Ctx};
use manifest_core::{ScenarioId, World, contests::occurrence_key};

#[test]
fn public_poem_points_follow_the_current_occurrence_and_query_is_read_only() {
    let d = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "terra16").unwrap();
    let sid = ScenarioId::from_idx(d.scenarios.iter().position(|s| s.key == "mio_1553").unwrap());
    let w = World::new(d, sid, 42).unwrap();
    let c = w.defs.upbringing.contests.iter().find(|c| c.key == "contest_waka").unwrap();
    let date = *c.dates.iter().find(|date| w.contest_open(c, **date)).unwrap();
    let before = w.state.clone();
    let v = upbringing_view::contest(Ctx::plain(&w.defs), &w, &occurrence_key(&c.key, date)).unwrap();
    let points = w.contest_poem_points(c, date);
    assert_eq!(v["params"]["line_points"], serde_json::json!(points));
    assert_eq!(
        v["params"]["line_max"],
        serde_json::json!(points.iter().map(|line| line.iter().max().copied().unwrap()).collect::<Vec<_>>())
    );
    assert_eq!(v["params"]["max_bonus"], c.scoring.max_bonus);
    assert_eq!(w.state, before);

    let d = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let sid = ScenarioId::from_idx(d.scenarios.iter().position(|s| s.key == "upbringing").unwrap());
    let mut w = World::new(d, sid, 42).unwrap();
    let c = w
        .defs
        .upbringing
        .contests
        .iter()
        .find(|c| c.poem.is_none() && c.kind == manifest_core::contests::Kind::Poem)
        .unwrap()
        .clone();
    let date = c.dates[0];
    w.state.day = manifest_core::scenario::day_of(&w.defs, date).unwrap();
    let v = upbringing_view::contest(Ctx::plain(&w.defs), &w, &occurrence_key(&c.key, date)).unwrap();
    assert!(v["params"].get("line_points").is_none());
    assert!(v["params"].get("line_max").is_none());
    assert!(v["params"].get("max_bonus").is_none());
}
