//! 传说船只覆盖名称与待填写的显示字段。
use super::{FileSpec, Slot, entry};
use manifest_core::StaticData;
pub(super) fn spec(d: &StaticData) -> FileSpec {
    FileSpec::new("legend_ships.toml")
        .table(
            "ships",
            d.legend_ships
                .ships
                .iter()
                .enumerate()
                .map(|(i, s)| {
                    let mut fields = vec![("name", &s.name), ("lore", &s.lore), ("acquire_note", &s.acquire_note)];
                    if let Some(name) = &s.unrevealed_name {
                        fields.push(("unrevealed_name", name));
                    }
                    entry(&s.key, Slot::LegendShip(i), &fields)
                })
                .collect(),
        )
        .table(
            "traits",
            d.legend_ships
                .ships
                .iter()
                .enumerate()
                .flat_map(|(i, s)| {
                    s.trait_notes.iter().enumerate().map(move |(j, (t, n))| {
                        entry(&format!("{}:{}", s.key, t.key()), Slot::LegendShipTrait(i, j), &[("text", n)])
                    })
                })
                .collect(),
        )
}
pub(super) fn apply(d: &mut StaticData, slot: Slot, field: &str, v: String) {
    match slot {
        Slot::LegendShip(i) => {
            let s = &mut d.legend_ships.ships[i];
            match field {
                "name" => s.name = v,
                "lore" => s.lore = v,
                "acquire_note" => s.acquire_note = v,
                "unrevealed_name" => s.unrevealed_name = Some(v),
                _ => {}
            }
        }
        Slot::LegendShipTrait(i, j) => {
            if let Some((_, note)) = d.legend_ships.ships[i].trait_notes.iter_mut().nth(j) {
                *note = v
            }
        }
        _ => {}
    }
}
