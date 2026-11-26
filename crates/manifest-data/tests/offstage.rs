//! 场外日程保留真实引用，但没有地图位置和当面互动入口。
use manifest_core::{geo::places::*, *};
use std::{path::Path, sync::Arc};

fn copy(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for e in std::fs::read_dir(from).unwrap() {
        let e = e.unwrap();
        if e.path().is_dir() {
            copy(&e.path(), &to.join(e.file_name()));
        } else {
            std::fs::copy(e.path(), to.join(e.file_name())).unwrap();
        }
    }
}

const CATALOG: &str =
    "[[offstage_regions]]\nkey='inland'\nname='内陆'\n[[offstage]]\nkey='court'\nname='场外宫廷'\nregion='inland'\n";

#[test]
fn offstage_is_loaded_without_a_map_id_and_blocks_face_to_face_commands() {
    let tmp = tempfile::tempdir().unwrap();
    copy(&manifest_data::find_data_dir().unwrap(), tmp.path());
    std::fs::write(tmp.path().join("worlds/testbed/offstage.toml"), CATALOG).unwrap();
    let file = tmp.path().join("worlds/testbed/cast/companions.toml");
    let s = std::fs::read_to_string(&file).unwrap();
    std::fs::write(&file, s.replace("at = \"test_west\"", "at = \"court\"")).unwrap();
    let mut defs = manifest_data::load_world(tmp.path(), "testbed").unwrap();
    let d = Arc::make_mut(&mut defs);
    d.scenarios[0].start_date = [1553, 1, 2];
    d.scenarios[0].control_date = [1553, 1, 2];
    // 第二位配角作为明确的场外反例，不改生产人物数据。
    let p = d.cast.persons.iter_mut().find(|p| p.key == "classmate_b").unwrap();
    for s in &mut p.schedule {
        s.at = "court".into();
    }
    assert!(!d.locations.iter().any(|l| l.key == "court"));
    assert_eq!(d.geography.places.offstage("court").unwrap().region, "inland");
    let mut w = World::new(defs, ScenarioId(0), 42).unwrap();
    assert!(w.person_alive("classmate_b"));
    assert_eq!(w.person_offstage("classmate_b").unwrap().key, "court");
    assert!(w.person_place("classmate_b").is_none());
    assert!(!w.person_here("classmate_b"));
    for command in [
        Command::Talk { owner: OwnerId::Player, person: "classmate_b".into(), topic: "chat".into() },
        Command::RequestAudience { owner: OwnerId::Player, person: "classmate_b".into() },
        Command::RecruitPerson { owner: OwnerId::Player, person: "classmate_b".into() },
    ] {
        let before = w.state.clone();
        assert!(command.apply(&mut w).is_err());
        assert_eq!(w.state, before);
    }
    assert_eq!(serde_json::to_value(&w.state).unwrap().get("offstage"), None);
    let restored = World::from_snapshot(w.defs.clone(), w.state.clone()).unwrap();
    assert_eq!(restored.person_offstage("classmate_b").unwrap().key, "court");
}

#[test]
fn offstage_rejects_typos_collisions_duplicates_and_coordinates() {
    let tmp = tempfile::tempdir().unwrap();
    copy(&manifest_data::find_data_dir().unwrap(), tmp.path());
    let file = tmp.path().join("worlds/testbed/offstage.toml");
    for bad in [
        CATALOG.replace("region='inland'", "region='typo'"),
        CATALOG.replace("key='court'", "key='test_west'"),
        format!("{CATALOG}\n[[offstage]]\nkey='court'\nname='重复'\nregion='inland'\n"),
        format!("{CATALOG}pos=[1,2]\n"),
    ] {
        std::fs::write(&file, bad).unwrap();
        assert!(manifest_data::load_world(tmp.path(), "testbed").is_err());
    }
    assert!(toml::from_str::<PlaceCatalog>("[[offstage]]\nkey='x'\nname='x'\nregion='inland'\nlonlat=[1,2]").is_err());
}

#[test]
fn terra16_schedule_keys_close_over_mapped_and_offstage_places() {
    let root = manifest_data::find_data_dir().unwrap();
    let w = manifest_data::resolve_world(&root, "terra16").unwrap();
    let cat: PlaceCatalog = toml::from_str(&w.read("offstage.toml").unwrap()).unwrap();
    assert_eq!((cat.offstage.len(), cat.offstage_regions.len()), (174, 9));
    let mut keys = std::collections::BTreeSet::new();
    for group in ["ports", "cities"] {
        let v: toml::Value = toml::from_str(&w.read(&format!("world/{group}.toml")).unwrap()).unwrap();
        for row in v[group].as_array().unwrap() {
            assert!(keys.insert(row["key"].as_str().unwrap().to_owned()));
        }
    }
    assert_eq!(keys.len(), 240);
    for p in &cat.offstage {
        assert!(keys.insert(p.key.clone()));
    }
    let mut count = 0;
    for file in w.files_in("cast").into_iter().chain(["persons.toml".into()]) {
        let text = w.read(&file).unwrap();
        let v: toml::Value = toml::from_str(&text).unwrap();
        for p in v.get("persons").and_then(|v| v.as_array()).into_iter().flatten() {
            for s in p.get("schedule").and_then(|v| v.as_array()).into_iter().flatten() {
                assert!(keys.contains(s["at"].as_str().unwrap()), "{}", p["key"]);
                count += 1;
            }
        }
    }
    // A6/C7 的 8220 段日程 + C9 新增家人各 1 段日程 = 8285；C13 整合把赛义达·胡拉 1553—1560 的一段拆成舍夫沙万与得土安两段（+1）；
    // C11 收尾（2026-11-01）：再加 5 段日程，8286 → 8291；
    // 第九批收尾 close-places 把皮埃尔·卡尔东 1557—1560 在里约、1561 起在勒阿弗尔的两段改成里约 / 萨尔瓦多 / 勒阿弗尔三段（+1）= 8292。
    // 养成内容（2026-11-03）：17 位新人物各 1 段日程，佩皮塔·蒙特罗 1553 年秋起去卡迪斯多 1 段（8292 → 8310）。
    // 公开版拿掉三位人物的日程：8310 → 8305。
    assert_eq!(count, 8305);
}
