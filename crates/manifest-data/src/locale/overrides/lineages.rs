//! 族裔来源与弱点的文字覆盖。
use super::{FileSpec, Slot, entry};
use manifest_core::StaticData;
pub(super) fn spec(d: &StaticData) -> FileSpec {
    FileSpec::new("lineages.toml")
        .table(
            "lineages",
            d.lineages
                .lineages
                .iter()
                .enumerate()
                .map(|(i, l)| {
                    let mut fields = vec![("name", &l.name), ("origin", &l.origin)];
                    if let Some(note) = &l.reversal_note {
                        fields.push(("reversal_note", note));
                    }
                    entry(&l.key, Slot::Lineage(i), &fields)
                })
                .collect(),
        )
        .table(
            "weaknesses",
            d.lineages
                .lineages
                .iter()
                .enumerate()
                .flat_map(|(i, l)| {
                    l.weaknesses.iter().enumerate().map(move |(j, s)| {
                        entry(&format!("{}:{j}", l.key), Slot::LineageWeakness(i, j), &[("text", s)])
                    })
                })
                .collect(),
        )
}
pub(super) fn apply(d: &mut StaticData, slot: Slot, f: &str, v: String) {
    match (slot, f) {
        (Slot::Lineage(i), f) => {
            let l = &mut d.lineages.lineages[i];
            match f {
                "name" => l.name = v,
                "origin" => l.origin = v,
                "reversal_note" => l.reversal_note = Some(v),
                _ => {}
            }
        }
        (Slot::LineageWeakness(i, j), "text") => d.lineages.lineages[i].weaknesses[j] = v,
        _ => {}
    }
}
