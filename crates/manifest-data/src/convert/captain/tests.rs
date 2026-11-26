use super::*;

#[test]
fn terra16_captain_has_complete_attributes_ratings_and_roles() {
    let raw = toml::from_str(include_str!("../../../../../data/worlds/terra16/captain.toml")).expect("寰宇属性配置");
    let calendar: Calendar = toml::from_str("months = [31,28,31,30,31,30,31,31,30,31,30,31]").expect("公历月份");
    let mut issues = Issues::default();
    let defs = convert(
        Some(raw),
        &Tables {
            rules: &AttributeRules::default(),
            calendar: &calendar,
            good_ids: &BTreeMap::new(),
            goods: &[],
            region_ids: &BTreeMap::new(),
        },
        &mut issues,
    );
    assert!(issues.list.is_empty(), "{:?}", issues.list);
    assert_eq!(defs.attributes.len(), 26);
    assert_eq!(defs.ratings.len(), 5);
    assert_eq!(defs.abilities.len(), 8);
    assert_eq!(defs.roles.len(), 11, "九个海上岗位（H01 加了瞭望长）及商队、产业岗位");
    assert!(defs.roles.iter().any(|r| r.key == "lookout" && r.scope == RoleScope::Fleet));
    assert!(defs.roles.iter().all(|r| !r.desc.is_empty()), "每个岗位都写了一句在海上管什么");
    assert_eq!(defs.attributes[..6].iter().map(|a| a.key.as_str()).collect::<Vec<_>>(), ATTRIBUTES);
    assert_eq!(defs.groups.iter().map(|g| g.free).collect::<Vec<_>>(), [6, 8, 0]);
    assert!(defs.attributes.iter().find(|a| a.key == "arcana").expect("秘术").hidden);
    assert!(defs.roles.iter().any(|r| r.key == "gunner" && r.ability == "gunnery"));
}
