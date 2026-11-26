//! 思想只开放显示文字的翻译，不接受预算或门槛覆盖。
use super::{Entry, FileSpec, Slot, entry};
use manifest_core::StaticData;
pub(super) fn spec(d: &StaticData) -> FileSpec {
    spec_of(&d.ideas)
}
pub(super) fn spec_of(d: &manifest_core::ideas::IdeasDefs) -> FileSpec {
    let mut ports = Vec::new();
    let mut modes = Vec::new();
    for (i, p) in d.ports.iter().enumerate() {
        ports.push(Entry {
            key: p.key.clone(),
            slot: Slot::IdeaPort(i),
            fields: p.hostility_note.iter().map(|s| ("hostility_note", s.clone())).collect(),
        });
        for (j, m) in p.modes.iter().enumerate() {
            modes.push(entry(
                &format!("{}:{}", p.key, manifest_core::ideas::mode_key(&m.idea, m.mode)),
                Slot::IdeaMode(i, j),
                &[("label", &m.label)],
            ));
            for (k, need) in m.needs.iter().enumerate() {
                modes.push(entry(
                    &format!("{}:{}:need{k}", p.key, manifest_core::ideas::mode_key(&m.idea, m.mode)),
                    Slot::IdeaNeed(i, j, k),
                    &[("text", need)],
                ));
            }
        }
    }
    FileSpec::new("ideas.toml")
        .table(
            "ideas",
            d.ideas
                .iter()
                .enumerate()
                .map(|(i, idea)| entry(&idea.key, Slot::Idea(i), &[("name", &idea.name)]))
                .collect(),
        )
        .table("ports", ports)
        .table("modes", modes)
}
pub(super) fn apply(d: &mut StaticData, slot: Slot, field: &str, value: String) {
    match (slot, field) {
        (Slot::Idea(i), "name") => d.ideas.ideas[i].name = value,
        (Slot::IdeaPort(i), "hostility_note") => d.ideas.ports[i].hostility_note = Some(value),
        (Slot::IdeaMode(i, j), "label") => d.ideas.ports[i].modes[j].label = value,
        (Slot::IdeaNeed(i, j, k), "text") => d.ideas.ports[i].modes[j].needs[k] = value,
        _ => {}
    }
}
