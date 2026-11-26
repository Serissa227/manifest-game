// 传说人物的草稿使用生产结构，并保留日期、字段、出处和翻译的拒绝边界。
use super::*;
#[test]
fn legend_persons_accept_unknown_year_but_reject_bad_dates_fields_and_sources() {
    let calendar = manifest_core::calendar::Calendar::default();
    let value: Value = toml::from_str(
        r#"key="visitor"
name="传说人物"
kind="legend"
gender="f"
born=[0,3,15]
culture="test"
basis="legend"
sources=["测试出处"]
persona="这是人物测试占位。""#,
    )
    .unwrap();
    assert!(check_shape(&value, "persons", "legends.toml", "persons[0]", &calendar).is_ok());
    for (field, bad) in [
        ("born", Value::Array(vec![0.into(), 13.into(), 1.into()])),
        ("sources", Value::Array(vec![])),
        ("unknown", true.into()),
        ("birthday", Value::Array(vec![1.into(), 1.into()])),
    ] {
        let mut bad_value = value.clone();
        bad_value.as_table_mut().unwrap().insert(field.into(), bad);
        assert!(check_shape(&bad_value, "persons", "legends.toml", "persons[0]", &calendar).is_err(), "{field}");
    }
    let mut ordinary = value.clone();
    ordinary["kind"] = "story".into();
    assert!(check_shape(&ordinary, "persons", "legends.toml", "persons[0]", &calendar).is_err());
}
#[test]
fn mate_biographies_need_exact_translations() {
    let source = "[[mates]]\nkey='visitor'\nname='测试人物'\nbio='这是人物简介。'";
    assert!(
        validate_draft_translation(
            "mates/extra.toml",
            source,
            "[mates.visitor]\nname='Visitor'\nbio='This is the biography.'"
        )
        .is_ok()
    );
    assert!(validate_draft_translation("mates/extra.toml", source, "[mates.visitor]\nname='Visitor'").is_err());
}
