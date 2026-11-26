//! 只覆盖秘术显示文字。
use super::{FileSpec, Slot, entry};
use manifest_core::StaticData;
pub(super) fn spec(d: &StaticData) -> FileSpec {
    FileSpec::new("arcana.toml")
        .table(
            "schools",
            d.arcana
                .schools
                .iter()
                .enumerate()
                .map(|(i, s)| entry(&s.key, Slot::ArcanaSchool(i), &[("name", &s.name)]))
                .collect(),
        )
        .table(
            "spells",
            d.arcana
                .spells
                .iter()
                .enumerate()
                .map(|(i, s)| {
                    entry(
                        &s.key,
                        Slot::ArcanaSpell(i),
                        &[("name", &s.name), ("desc", &s.desc), ("cost_note", &s.cost_note)],
                    )
                })
                .collect(),
        )
}
pub(super) fn apply(d: &mut StaticData, slot: Slot, field: &str, v: String) {
    match (slot, field) {
        (Slot::ArcanaSchool(i), "name") => d.arcana.schools[i].name = v,
        (Slot::ArcanaSpell(i), f) => {
            let s = &mut d.arcana.spells[i];
            match f {
                "name" => s.name = v,
                "desc" => s.desc = v,
                "cost_note" => s.cost_note = v,
                _ => {}
            }
        }
        _ => {}
    }
}
