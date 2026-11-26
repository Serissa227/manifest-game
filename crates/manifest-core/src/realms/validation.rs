//! 帷幕、钥匙与时间差边界；不把缺失秘境悄悄解释成开放港。
use super::*;
use crate::{StaticData, societies::validation::key};
pub fn validate(d: &StaticData) -> Vec<String> {
    let mut errors = Vec::new();
    let mut keys = BTreeSet::new();
    let mut ports = BTreeSet::new();
    let mut veils = BTreeSet::new();
    if d.realms.realms.len() > 64 {
        errors.push("秘境超过64处".into());
    }
    for r in &d.realms.realms {
        if !key(&r.key)
            || !keys.insert(&r.key)
            || r.name.trim().is_empty()
            || r.hint.trim().is_empty()
            || r.ports.is_empty()
            || r.ports.iter().any(|p| !ports.insert(p) || d.find_loc(p).is_none_or(|l| !d.loc(l).is_port()))
            || (r.key_items.is_empty() && r.key_any.is_empty())
            || r.key_any.len() > 16
            || r.key_any.iter().any(|group| !key_group(d, group))
            || r.key_items.len() > 16
            || r.key_items.iter().any(|k| d.items.item(k).is_none())
            || r.also.iter().any(|c| crate::story2::validation::condition_error(d, c).is_some())
            || !(1..=12).contains(&r.veil.push)
            || r.veil.mark.is_none() && r.veil.cells.is_empty()
            || r.veil.mark.as_ref().is_some_and(|m| !d.regions.iter().any(|v| v.key == *m))
            || r.veil.cells.iter().any(|c| !d.map.is_sea_in_bounds(*c))
            || r.knowledge.as_ref().is_some_and(|k| !key(k))
        {
            errors.push(format!("{}：秘境引用或帷幕无效", r.key));
        }
        if r.otherworld.as_ref().is_some_and(|o| {
            o.guest_nights > 365
                || !(1..=91).contains(&o.time_ratio)
                || !(1..=MAX_SKIP).contains(&o.max_skip_days)
                || o.touch_land != "warn"
                || r.rules.is_empty()
                || r.rules.iter().any(|s| s.trim().is_empty())
        }) {
            errors.push(format!("{}：彼界规矩缺警告或超出时间差上限", r.key));
        }
        // 地图海格构成真实边界；同格不能属于两个彼界。
        for c in
            (0..d.map.terrain.len()).map(|i| d.map.cell_of(i)).filter(|c| d.map.is_sea(*c) && r.veil.contains(d, *c))
        {
            if !veils.insert(c) {
                errors.push(format!("{}：帷幕海格重叠", r.key));
                break;
            }
        }
    }
    for (port, source) in &d.geography.places.authored.locations {
        if let Some(key) = &source.realm
            && d.realms.realm(key).is_some_and(|r| !r.ports.contains(port))
        {
            errors.push(format!("{port}：秘境港未列入 {key}.ports"));
        }
    }
    errors
}

fn key_group(d: &StaticData, group: &KeyGroup) -> bool {
    let count = group.items.len() + group.flags.len() + group.completed_tracks.len();
    (1..=16).contains(&count)
        && group.items.iter().all(|k| d.items.item(k).is_some())
        && group.flags.iter().all(|flag| key(flag))
        && group.completed_tracks.iter().all(|track| d.story2.track(track).is_some())
        && [&group.items, &group.flags, &group.completed_tracks]
            .into_iter()
            .all(|keys| keys.iter().collect::<BTreeSet<_>>().len() == keys.len())
}
