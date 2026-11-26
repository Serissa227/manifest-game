//! C10 的实际世界接线与严格语言边界。
use manifest_data::worlds;
use std::{collections::BTreeMap, path::PathBuf};

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data")
}

#[test]
fn terra16_native_history_and_ideas_load_without_injection() {
    let d = manifest_data::load_world(&root(), "terra16").expect("寰宇正式加载通路");
    assert_eq!(d.history.events.len(), 169);
    assert_eq!(d.history.campaigns.len(), 1);
    assert_eq!(d.history.campaigns[0].vars.len(), 17);
    assert_eq!(d.ideas.ideas.len(), 16);
    assert_eq!(d.ideas.ports.len(), 19);
    assert!(manifest_core::history::validation::validate(&d).is_empty());
    assert!(manifest_core::ideas::validation::validate(&d).is_empty());
}

#[test]
fn native_history_translation_rejects_missing_text_and_gameplay_overrides() {
    let dir = root().join("worlds/terra16");
    for file in ["history/main_childhood.toml", "history/liaodong.toml", "ideas.toml"] {
        let source = std::fs::read_to_string(dir.join(file)).expect("原文");
        let english = std::fs::read_to_string(dir.join("locales/en").join(file)).expect("英文");
        assert!(worlds::validate_draft_translation(file, &source, &english).expect("完整覆盖") > 0);
        assert!(worlds::validate_draft_translation(file, &source, "").is_err());
        let mut altered: toml::Value = toml::from_str(&english).expect("英文 TOML");
        altered.as_table_mut().expect("表").insert("balance".into(), toml::Value::Integer(999));
        assert!(worlds::validate_draft_translation(file, &source, &toml::to_string(&altered).expect("覆盖")).is_err());
        assert!(
            worlds::validate_draft_translation(file, &(source + "\nunknown_native_field = 1\n"), &english).is_err()
        );
    }
}

fn inaccessible_levers(d: &manifest_core::StaticData) -> Vec<String> {
    use manifest_core::history::{Effect, HistoryEffect, PortStatus};
    let start_year = u32::try_from(d.rules.world.start_year).expect("世界起始年");
    let day = |date| manifest_core::scenario::day_of(d, date).expect("窗口日期");
    let mut opens = BTreeMap::<String, u32>::new();
    for (key, place) in &d.geography.places.authored.locations {
        if let Some(dormant) = &place.dormant {
            opens.insert(key.clone(), day([dormant.until.max(start_year), 1, 1]));
        }
    }
    for port in d.history.ports.iter().filter(|p| p.state == PortStatus::Dormant) {
        // 结算当天的命令先执行，开放效果要到下一世界日才能被玩家使用。
        let first = d.history.events.iter().filter(|e| {
            e.outcomes.iter().flat_map(|o| &o.effects).any(|effect| {
                matches!(effect, Effect::History(HistoryEffect::PortState { port: key, state: PortStatus::Open, .. }) if key == &port.port)
            })
        }).map(|e| day(e.deadline()).saturating_add(1)).min().unwrap_or(u32::MAX);
        let authored = opens.entry(port.port.clone()).or_default();
        *authored = (*authored).max(first);
    }
    let mut errors = Vec::new();
    for e in &d.history.events {
        let Some([from, to]) = e.window else { continue };
        for l in &e.levers {
            let end = day(l.deadline.map_or(to, |date| date.min(to)));
            let first = l
                .port
                .iter()
                .chain(&l.from)
                .fold(day(from), |start, port| start.max(opens.get(port).copied().unwrap_or(0)));
            let available = end.checked_sub(first).map_or(0, |days| days.saturating_add(1));
            if available < l.days.max(1) {
                errors.push(format!("{}:{}：港口开放后只剩{available}日，需要{}日", e.key, l.key, l.days.max(1)));
            }
        }
    }
    errors
}

#[test]
fn every_terra16_lever_has_time_after_its_ports_open() {
    let mut d = manifest_data::load_world(&root(), "terra16").expect("寰宇正式加载通路");
    let errors = inaccessible_levers(&d);
    assert!(errors.is_empty(), "{errors:?}");
    // 复现本次实际发现的两种坏数据：整个窗口未开放，以及开放后不足60日练兵。
    let defs = std::sync::Arc::make_mut(&mut d);
    for e in &mut defs.history.events {
        if e.key == "l05_sarhu" {
            e.levers.iter_mut().find(|l| l.key == "deliver_liaodong_dispatch").expect("密札").from =
                Some("yuegang".into());
        }
        if e.key == "l09_guangning_fall" {
            e.levers.iter_mut().find(|l| l.key == "train_gunners").expect("练兵").port = Some("yuegang".into());
        }
    }
    let errors = inaccessible_levers(&d);
    assert_eq!(errors.len(), 2, "{errors:?}");
    assert!(errors.iter().any(|e| e.starts_with("l05_sarhu:deliver_liaodong_dispatch：")));
    assert!(errors.iter().any(|e| e.starts_with("l09_guangning_fall:train_gunners：")));
}

/// I03：寰宇的 16 项船只改装。
#[test]
fn terra16_has_sixteen_well_formed_refits() {
    let d = manifest_data::load_world(&root(), "terra16").expect("寰宇正式加载通路");
    assert_eq!(d.refits.len(), 16);
    let keys: std::collections::BTreeSet<_> = d.refits.iter().map(|r| r.key.as_str()).collect();
    assert_eq!(keys.len(), 16, "key 互不相同");
    for r in &d.refits {
        assert!(r.price > 0, "{}", r.key);
        assert!(r.capacity >= 0 && r.durability >= 0 && r.guns >= 0 && r.speed.raw() >= 0, "{}", r.key);
        assert!(r.capacity > 0 || r.durability > 0 || r.guns > 0 || r.speed.raw() > 0, "{} 至少要有一个加成", r.key);
    }
    let speed: i64 = d.refits.iter().map(|r| r.speed.raw()).sum();
    assert!(speed <= manifest_core::fixed::Fx::ONE.raw(), "航速加成总和不超过 1.0");
    assert!(d.refits.iter().map(|r| r.capacity).sum::<i64>() <= 80);
}
