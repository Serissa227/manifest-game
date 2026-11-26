//! 结社显示字段白名单，条件和奖励不可由语言包改写。
use super::{FileSpec, Slot, entry};
use manifest_core::StaticData;
pub(super) fn spec(d: &StaticData) -> FileSpec {
    let mut societies = Vec::new();
    let mut ranks = Vec::new();
    for (i, s) in d.societies.societies.iter().enumerate() {
        let mut fields = vec![("name", &s.name)];
        if let Some(extended) = &s.extended {
            fields.push(("extended", extended));
        }
        societies.push(entry(&s.key, Slot::Society(i), &fields));
        for (j, r) in s.ranks.iter().enumerate() {
            let mut fields = vec![("name", &r.name), ("requirement", &r.requirement), ("reward", &r.reward)];
            if let Some(t) = &r.trial_text {
                fields.push(("trial_text", t));
            }
            ranks.push(entry(&format!("{}:{}", s.key, j + 1), Slot::SocietyRank(i, j), &fields));
        }
    }
    FileSpec::new("societies.toml").table("societies", societies).table("ranks", ranks)
}
pub(super) fn apply(d: &mut StaticData, slot: Slot, field: &str, value: String) {
    match (slot, field) {
        (Slot::Society(i), "name") => d.societies.societies[i].name = value,
        (Slot::Society(i), "extended") => d.societies.societies[i].extended = Some(value),
        (Slot::SocietyRank(i, j), f) => {
            let r = &mut d.societies.societies[i].ranks[j];
            match f {
                "name" => r.name = value,
                "requirement" => r.requirement = value,
                "reward" => r.reward = value,
                "trial_text" => r.trial_text = Some(value),
                _ => {}
            }
        }
        _ => {}
    }
}
