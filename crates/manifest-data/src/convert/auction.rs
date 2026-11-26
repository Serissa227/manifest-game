//! C4 拍卖数据：严格消费拍卖字段，并解析人物显示引用，不代替人物行为引擎。
use super::{Issues, check_keys, load_optional};
use crate::worlds::EffectiveWorld;
use manifest_core::{
    LocId,
    auction::*,
    defs::{LocationDef, MateDef},
    items::ItemsDefs,
};
use serde::Deserialize;
use std::collections::{BTreeMap, BTreeSet};
const FILE: &str = "auctions.toml";
#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct File {
    #[serde(default)]
    auctions: Vec<RawAuction>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawAuction {
    key: String,
    name: String,
    port: String,
    month: u32,
    days: u32,
    announcement_days: u32,
    preview_days: u32,
    lots_per_session: [usize; 2],
    consignment: bool,
    basis: String,
    sources: Vec<String>,
    lore: String,
    lots: Vec<LotDef>,
    bidders: Vec<BidderDef>,
    #[serde(default)]
    specials: Vec<SpecialDef>,
}
fn valid_key(key: &str) -> bool {
    !key.is_empty() && key.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
}
pub(super) fn load(
    dir: &EffectiveWorld,
    items: &ItemsDefs,
    locations: &[LocationDef],
    mates: &[MateDef],
    issues: &mut Issues,
) -> AuctionDefs {
    if !dir.module_enabled("auctions") || !dir.module_enabled("items") {
        return AuctionDefs::default();
    }
    let raw: File = load_optional(dir, FILE, issues).unwrap_or_default();
    if raw.auctions.is_empty() {
        return AuctionDefs::default();
    }
    let mut people: BTreeMap<_, _> =
        mates.iter().map(|m| (m.key.clone(), AuctionPerson { name: m.name.clone(), portrait: None })).collect();
    // persons.toml 可以是 C6 登记的分片合并表；这里只取拍卖所需的身份与显示字段。
    if dir.contains("persons.toml") {
        let source: toml::Table = load_optional(dir, "persons.toml", issues).unwrap_or_default();
        if let Some(persons) = source.get("persons").and_then(toml::Value::as_array) {
            let mut seen = BTreeSet::new();
            for p in persons {
                if let (Some(key), Some(name)) =
                    (p.get("key").and_then(toml::Value::as_str), p.get("name").and_then(toml::Value::as_str))
                {
                    // 显式绑定的同名航海士就是同一人；未绑定碰撞和重复人物行仍须拒绝。
                    let bound_mate = p.get("mate").and_then(|m| m.get("key")).and_then(toml::Value::as_str)
                        == Some(key)
                        && mates.iter().any(|m| m.key == key && m.name == name);
                    if !valid_key(key)
                        || name.trim().is_empty()
                        || !seen.insert(key)
                        || (people.contains_key(key) && !bound_mate)
                    {
                        issues.push("persons.toml", key, "拍卖人物 key、姓名无效或与现有身份重复");
                    } else {
                        people.insert(
                            key.into(),
                            AuctionPerson {
                                name: name.into(),
                                portrait: p.get("portrait").and_then(toml::Value::as_str).map(str::to_owned),
                            },
                        );
                    }
                } else {
                    issues.push("persons.toml", "persons", "拍卖人物必须有 key 与 name");
                }
            }
        } else {
            issues.push("persons.toml", "persons", "人物表必须为数组");
        }
    }
    check_keys(FILE, "auctions", raw.auctions.iter().map(|a| (a.key.as_str(), a.name.as_str())), issues);
    let mut auctions = Vec::new();
    for a in raw.auctions {
        let port = locations.iter().position(|l| l.key == a.port && l.is_port()).map(LocId::from_idx);
        if port.is_none() {
            issues.push(FILE, &a.key, format!("未知拍卖港口 {}", a.port));
        }
        if a.month == 0
            || a.month as usize > dir.manifest.calendar.months().len()
            || !(1..=20).contains(&a.days)
            || a.announcement_days != 20
            || a.preview_days != 5
            || a.lots_per_session != [4, 6]
            || a.consignment
        {
            issues.push(FILE, &a.key, "月份或会期无效；预告20天、预展5天、每场4–6件且不开放寄售");
        }
        if a.basis.trim().is_empty()
            || a.sources.is_empty()
            || a.sources.iter().any(|s| s.trim().is_empty())
            || a.lore.trim().is_empty()
        {
            issues.push(FILE, &a.key, "拍卖会须有出处与叙事说明");
        }
        check_keys(FILE, &format!("{}.lots", a.key), a.lots.iter().map(|l| (l.item.as_str(), l.item.as_str())), issues);
        check_keys(
            FILE,
            &format!("{}.bidders", a.key),
            a.bidders.iter().map(|b| (b.person.as_str(), b.person.as_str())),
            issues,
        );
        check_keys(
            FILE,
            &format!("{}.specials", a.key),
            a.specials.iter().map(|s| (s.item.as_str(), s.item.as_str())),
            issues,
        );
        for l in &a.lots {
            if items.item(&l.item).is_none() {
                issues.push(FILE, &a.key, format!("未知拍品 {}", l.item));
            }
            if !(1..=1_000_000_000).contains(&l.reserve)
                || !(1..=1_000_000_000).contains(&l.increment)
                || !(1..=1_000_000).contains(&l.weight)
                || l.from.is_some_and(|y| y < 1)
                || l.after_loss.trim().is_empty()
                || l.authenticity == Authenticity::Fake && l.fake_note.as_ref().is_none_or(|s| s.trim().is_empty())
            {
                issues.push(FILE, &l.item, "拍品价格、增量、权重、年份或真假提示无效");
            }
        }
        for b in &a.bidders {
            if !people.contains_key(&b.person) || b.person == "player" {
                issues.push(FILE, &a.key, format!("未知出价人物 {}", b.person));
            }
            if !(1..=1_000_000_000).contains(&b.budget)
                || b.likes.iter().any(|s| !valid_key(s))
                || b.mood_lines.is_empty()
                || b.mood_lines.iter().any(|s| s.trim().is_empty())
            {
                issues.push(FILE, &b.person, "出价人的预算、偏好或提示台词无效");
            }
        }
        for s in &a.specials {
            if items.item(&s.item).is_none()
                || s.year < 1
                || s.story_hook.trim().is_empty()
                || s.after_loss.trim().is_empty()
            {
                issues.push(FILE, &s.item, "特别拍品、年份或故事提示无效");
            }
        }
        auctions.push(AuctionDef {
            key: a.key,
            name: a.name,
            port: port.unwrap_or(LocId(0)),
            month: a.month,
            days: a.days,
            announcement_days: a.announcement_days,
            preview_days: a.preview_days,
            lots_per_session: a.lots_per_session,
            lore: a.lore,
            lots: a.lots,
            bidders: a.bidders,
            specials: a.specials,
        });
    }
    AuctionDefs { auctions, people }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn real_c4_file_uses_the_runtime_schema_and_testbed_resolves_all_references() {
        let root = crate::find_data_dir().unwrap();
        let text = std::fs::read_to_string(root.join("worlds/terra16/auctions.toml")).unwrap();
        let raw: File = toml::from_str(&text).unwrap();
        assert_eq!(raw.auctions.len(), 5);
        assert!(raw.auctions.iter().all(|a| a.lots.len() >= 12 && a.bidders.len() >= 3));
        let defs = crate::load_world(&root, "testbed").unwrap();
        assert_eq!(defs.auctions.auctions.len(), 1);
        assert_eq!(defs.auctions.auctions[0].port, LocId(0));
        assert_eq!(defs.auctions.people["auction_ada"].name, "阿达");
    }
    #[test]
    fn malformed_prices_dates_truth_and_references_are_rejected() {
        let root = crate::find_data_dir().unwrap();
        let defs = crate::load_world(&root, "testbed").unwrap();
        let original = std::fs::read_to_string(root.join("worlds/testbed/auctions.toml")).unwrap();
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("auctions.toml");
        let mut effective = crate::resolve_world(&root, "testbed").unwrap();
        effective.files.get_mut(FILE).unwrap().sources = vec![path.clone()];
        for (from, to) in [
            ("reserve = 60", "reserve = -1"),
            ("increment = 10", "increment = 0"),
            ("weight = 3", "weight = 0"),
            ("month = 2", "month = 13"),
            ("days = 3", "days = 0"),
            ("preview_days = 5", "preview_days = 6"),
            ("consignment = false", "consignment = true"),
            ("item = \"ring\"", "item = \"missing\""),
            ("port = \"test_west\"", "port = \"missing\""),
            ("person = \"auction_ada\"", "person = \"missing\""),
            ("budget = 300", "budget = -1"),
            ("temper = \"cautious\"", "temper = \"random\""),
            ("authenticity = \"genuine\"", "authenticity = \"truth\""),
            ("fake_note = \"钱币上的刻痕是后添的，可以凭包装寻找经手人。\"", "fake_note = \"\""),
            ("reserve = 60", "reserve = 60\nsecret_number = 3"),
        ] {
            assert!(original.contains(from));
            std::fs::write(&path, original.replacen(from, to, 1)).unwrap();
            let mut issues = Issues::default();
            load(&effective, &defs.items, &defs.locations, &defs.mates, &mut issues);
            assert!(!issues.list.is_empty(), "{from} → {to}");
            assert!(issues.list.iter().all(|i| i.file == FILE));
        }
        effective.manifest.modules.insert("auctions".into(), toml::Value::Boolean(false));
        let mut issues = Issues::default();
        assert!(load(&effective, &defs.items, &defs.locations, &defs.mates, &mut issues).auctions.is_empty());
        assert!(issues.list.is_empty());
    }
}
