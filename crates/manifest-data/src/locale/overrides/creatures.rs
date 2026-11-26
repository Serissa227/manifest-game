//! 怪异的显示字段；应对的闭合枚举不得由翻译改写。
use super::{FileSpec, Slot, entry};
use manifest_core::{StaticData, creatures::Response};
pub(super) fn spec(d: &StaticData) -> FileSpec {
    FileSpec::new("creatures.toml")
        .table(
            "creatures",
            d.creatures
                .creatures
                .iter()
                .enumerate()
                .map(|(i, c)| {
                    let mut fields = vec![("name", &c.name), ("text", &c.text)];
                    if let Some(v) = &c.omen_text {
                        fields.push(("omen_text", v));
                    }
                    entry(&c.key, Slot::Creature(i), &fields)
                })
                .collect(),
        )
        .table(
            "outcomes",
            d.creatures
                .creatures
                .iter()
                .enumerate()
                .flat_map(|(i, c)| {
                    c.outcomes.iter().map(move |(r, o)| {
                        entry(
                            &format!("{}:{}", c.key, response_key(*r)),
                            Slot::CreatureOutcome(i, *r),
                            &[("text", &o.text), ("reply", &o.reply)],
                        )
                    })
                })
                .collect(),
        )
}
fn response_key(r: Response) -> &'static str {
    match r {
        Response::Avoid => "avoid",
        Response::Observe => "observe",
        Response::Noise => "noise",
        Response::Stillness => "stillness",
        Response::Signal => "signal",
        Response::Recite => "recite",
        Response::Offering => "offering",
        Response::Trade => "trade",
        Response::Release => "release",
        Response::Ruse => "ruse",
        Response::Fight => "fight",
    }
}
pub(super) fn apply(d: &mut StaticData, slot: Slot, f: &str, v: String) {
    match slot {
        Slot::Creature(i) => {
            let c = &mut d.creatures.creatures[i];
            match f {
                "name" => c.name = v,
                "text" => c.text = v,
                "omen_text" => c.omen_text = Some(v),
                _ => {}
            }
        }
        Slot::CreatureOutcome(i, r) => {
            if let Some(o) = d.creatures.creatures[i].outcomes.get_mut(&r) {
                match f {
                    "text" => o.text = v,
                    "reply" => o.reply = v,
                    _ => {}
                }
            }
        }
        _ => {}
    }
}
