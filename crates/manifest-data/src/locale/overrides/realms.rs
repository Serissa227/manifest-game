//! 秘境的显示字段与规则说明。
use super::{FileSpec, Slot, entry};
use manifest_core::StaticData;
pub(super) fn spec(d: &StaticData) -> FileSpec {
    FileSpec::new("realms.toml")
        .table(
            "realms",
            d.realms
                .realms
                .iter()
                .enumerate()
                .map(|(i, r)| entry(&r.key, Slot::Realm(i), &[("name", &r.name), ("hint", &r.hint)]))
                .collect(),
        )
        .table(
            "rules",
            d.realms
                .realms
                .iter()
                .enumerate()
                .flat_map(|(i, r)| {
                    r.rules
                        .iter()
                        .enumerate()
                        .map(move |(j, s)| entry(&format!("{}:{j}", r.key), Slot::RealmRule(i, j), &[("text", s)]))
                })
                .collect(),
        )
}
pub(super) fn apply(d: &mut StaticData, slot: Slot, f: &str, v: String) {
    match (slot, f) {
        (Slot::Realm(i), "name") => d.realms.realms[i].name = v,
        (Slot::Realm(i), "hint") => d.realms.realms[i].hint = v,
        (Slot::RealmRule(i, j), "text") => d.realms.realms[i].rules[j] = v,
        _ => {}
    }
}
