//! U03：养成视图的 `budget`（本月与下月的收支预测）。
use manifest_appcore::{upbringing_view, views::Ctx};
use manifest_core::{ScenarioId, World};

#[test]
fn upbringing_view_exposes_the_month_budget() {
    let d = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let i = d.scenarios.iter().position(|s| s.key == "upbringing").unwrap();
    let w = World::new(d, ScenarioId::from_idx(i), 42).unwrap();
    let view = upbringing_view::upbringing(Ctx::plain(&w.defs), &w);
    let budget = &view["budget"];
    assert_eq!(budget["cash"], view["cash"]);
    for key in
        ["allowance", "allowance_next", "lesson_cost", "tuition_left", "tuition_next", "reserve", "spendable", "tight"]
    {
        assert!(!budget[key].is_null(), "budget.{key}");
    }
    assert_eq!(budget["allowance"], 0, "测试世界的家庭没有配零用钱");
}
