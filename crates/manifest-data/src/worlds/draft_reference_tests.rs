use super::*;
fn empty_report() -> DraftValidation {
    DraftValidation {
        key: "test".into(), files: vec![], counts: BTreeMap::new(), translated_strings: 0, chinese_only_fragments: 0,
        resolved_references: 0, unresolved: vec![], cast_diagnostics: Vec::new(),
    }
}

#[test]
fn delivered_c6_c8_nested_references_are_closed_even_when_target_tables_are_absent() {
    for (table, text, target, field) in [
        ("academies", "mentor_roles = { lesson_mentor = 'missing' }", "persons", "mentor_roles.lesson_mentor"),
        ("academies", "where = 'missing'", "locations", "where"),
        ("persons", "academy = 'missing'", "academies", "academy"),
        ("activities", "skills = [{ skill = 'missing', xp = 1 }]", "skills", "skills[0].skill"),
        ("vignettes", "when = { activity = 'missing' }", "activities", "when.activity"),
        ("vignettes", "when = { festival = 'missing' }", "festivals", "when.festival"),
        ("outings", "tools = ['missing']", "items", "tools[0]"),
        ("exams", "requirements = { rating = { key = 'missing', min = 50 } }", "ratings", "requirements.rating.key"),
        ("exams", "retake = { remediation = ['missing'] }", "activities", "retake.remediation[0]"),
        ("academies", "graduation = { promise_at = 'missing' }", "places", "graduation.promise_at"),
    ] {
        let value: Value = toml::from_str(text).unwrap();
        let row = Row { file: "upbringing/test.toml".into(), table: table.into(), key: "test".into(), value };
        let symbols = BTreeMap::new();
        let mut report = empty_report();
        let error = check_author_references(&row, &row.value, "", &symbols, &mut report).unwrap_err().to_string();
        assert!(error.contains(field) && error.contains(target) && error.contains("missing"), "{error}");
        assert!(report.unresolved.is_empty(), "封闭引用不能降成草稿提示");
        let symbols = BTreeMap::from([(target.into(), BTreeSet::from(["missing".into()]))]);
        let mut report = empty_report();
        check_author_references(&row, &row.value, "", &symbols, &mut report).unwrap();
        assert_eq!(report.resolved_references, 1, "{table}: {field}");
        assert!(report.unresolved.is_empty());
    }
}

#[test]
fn c6_schedule_locations_are_required_and_c5_history_keeps_its_existing_draft_boundary() {
    let mut row = Row {
        file: "cast/person.toml".into(), table: "persons".into(), key: "person".into(),
        value: toml::from_str("kind = 'story'").unwrap(),
    };
    let mut report = empty_report();
    assert!(reference(&row,"schedule[0].at","locations","missing",&BTreeMap::new(),&mut report).is_err());
    row.value = toml::from_str("kind = 'historical'").unwrap();
    reference(&row,"schedule[0].at","locations","missing",&BTreeMap::new(),&mut report).unwrap();
    assert_eq!(report.unresolved.len(),1);
}

#[test]
fn academy_courses_cannot_reuse_an_activity_or_another_academys_course_key() {
    let row = Row { file: "upbringing/academy.toml".into(), table: "academies".into(), key: "academy".into(), value: Value::Table(toml::Table::new()) };
    let mut keys = BTreeSet::from([("activities".to_owned(),"job".to_owned())]);
    assert!(register_course_key(&row,"job",&mut keys).is_err());
    register_course_key(&row,"lesson",&mut keys).unwrap();
    assert!(register_course_key(&row,"lesson",&mut keys).is_err());
}

#[test]
fn explicit_external_tie_does_not_declare_a_person_for_other_rows() {
    let mut row=Row { file:"cast/ties.toml".into(),table:"ties".into(),key:"pending".into(),value:Value::Table(toml::Table::new()) };
    let symbols=BTreeMap::from([("external_tie:pending".into(),BTreeSet::from(["missing".into()]))]);
    let mut report=empty_report();
    reference(&row,"b","persons","missing",&symbols,&mut report).unwrap();
    assert_eq!(report.unresolved.len(),1);
    assert_eq!(report.resolved_references,0);
    row.key="other_tie".into();
    assert!(reference(&row,"b","persons","missing",&symbols,&mut report).is_err());
    row.key="pending".into();row.table="academies".into();
    assert!(reference(&row,"mentor","persons","missing",&symbols,&mut report).is_err());
}

#[test]
fn dynamic_excursion_requires_closed_binding_and_other_empty_locations_are_rejected() {
    let mut row = Row { file: "upbringing/test.toml".into(), table: "excursions".into(), key: "test".into(),
        value: toml::from_str("at = ''\nwhere = { academies = ['academy'] }").unwrap() };
    let symbols = BTreeMap::from([("academies".into(), BTreeSet::from(["academy".into()]))]);
    check_author_references(&row, &row.value, "", &symbols, &mut empty_report()).unwrap();
    assert!(check_author_references(&row, &row.value, "", &BTreeMap::new(), &mut empty_report()).is_err());
    row.value = toml::from_str("at = ''").unwrap();
    assert!(check_author_references(&row, &row.value, "", &symbols, &mut empty_report()).is_err());
    row.table = "activities".into();
    row.value = toml::from_str("at = ''\nwhere = { academies = ['academy'] }").unwrap();
    assert!(check_author_references(&row, &row.value, "", &symbols, &mut empty_report()).is_err());
}
