//! 主角（姓名与外貌）：设置、校验、概览、存档读档、旧存档兼容、换新游戏后清空。
//! 主角是纯展示信息，保存在应用层（存档旁的 meta 文件），不进入世界状态，不影响世界哈希与重放。

use manifest_ai::{AiMode, MemoryKeyStore};
use manifest_app::handlers::{self, CAPTAIN_NAME_MAX, CAPTAIN_PORTRAIT_MAX, CAPTAIN_PORTRAITS, RETIRED_PORTRAIT};
use manifest_app::views::CaptainView;
use manifest_app::{AppError, AppPaths, AppState};
use serde_json::json;
use std::path::{Path, PathBuf};
use std::sync::Arc;

fn app(dir: &Path, autosave_days: u32) -> AppState {
    let data = manifest_data::find_data_dir().expect("找到 data/");
    let st = AppState::from_data_dir(&data, Arc::new(MemoryKeyStore::default()), AppPaths::in_dir(dir)).unwrap();
    let mut settings = handlers::get_settings(&st).settings;
    settings.ai.mode = AiMode::Off;
    settings.autosave_days = autosave_days;
    handlers::save_settings(&st, settings).unwrap();
    st
}

fn captain(name: &str, portrait: u32) -> CaptainView {
    CaptainView { name: name.to_string(), portrait }
}

fn state_hash(st: &AppState) -> String {
    handlers::debug(st).unwrap().state_hash
}

/// manifest-sim 的旧版本（v1）样例存档。
fn legacy_fixture() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("manifest-sim")
        .join("tests")
        .join("fixtures")
        .join("save_v1.mfsave.zst")
}

#[test]
fn set_captain_requires_a_game() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path(), 0);
    assert!(matches!(handlers::set_captain(&st, captain("林远舟", 0)), Err(AppError::NoGame)));
}

#[test]
fn set_captain_shows_in_overview_and_trims_name() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path(), 0);
    let o = handlers::new_game(&st, "newcomer", Some(7)).unwrap();
    assert_eq!(o.captain, None, "新开的一局还没有主角");
    let before = state_hash(&st);
    let log_before = handlers::debug(&st).unwrap().log_len;

    let o = handlers::set_captain(&st, captain("  林远舟 ", 3)).unwrap();
    assert_eq!(o.captain, Some(captain("林远舟", 3)), "姓名去掉首尾空白");
    assert_eq!(handlers::overview(&st).unwrap().captain, Some(captain("林远舟", 3)));

    // 主角不参与模拟：世界哈希与命令日志不变
    assert_eq!(state_hash(&st), before, "设置主角不改变世界状态");
    assert_eq!(handlers::debug(&st).unwrap().log_len, log_before, "设置主角不写命令日志");

    // 推进之后仍然在
    let o = handlers::step(&st, 2).unwrap();
    assert_eq!(o.captain, Some(captain("林远舟", 3)));

    // 可以改名、换外貌；中间的空格保留；边界值 11 号与 13 号外貌（12 号两侧）、24 号外貌（最后一种）、12 个字的姓名合法
    let twelve = "一二三四五六七八九十甲乙";
    assert_eq!(twelve.chars().count(), CAPTAIN_NAME_MAX);
    let o = handlers::set_captain(&st, captain(twelve, 11)).unwrap();
    assert_eq!(o.captain, Some(captain(twelve, 11)));
    let o = handlers::set_captain(&st, captain(twelve, 13)).unwrap();
    assert_eq!(o.captain, Some(captain(twelve, 13)));
    let o = handlers::set_captain(&st, captain(twelve, CAPTAIN_PORTRAIT_MAX)).unwrap();
    assert_eq!(o.captain, Some(captain(twelve, 24)));
    let o = handlers::set_captain(&st, captain("Anne Mercer", 0)).unwrap();
    assert_eq!(o.captain, Some(captain("Anne Mercer", 0)));

    // 返回给界面的 JSON：字段名与前端 types.ts 的 Captain 一致
    let v = serde_json::to_value(&o).unwrap();
    assert_eq!(v["captain"], json!({ "name": "Anne Mercer", "portrait": 0 }));
}

#[test]
fn captain_json_from_the_ui_deserializes() {
    // 界面以 invoke("set_captain", { captain: { name, portrait } }) 调用
    let c: CaptainView = serde_json::from_value(json!({ "name": "沈汐", "portrait": 5 })).unwrap();
    assert_eq!(c, captain("沈汐", 5));
    assert!(serde_json::from_value::<CaptainView>(json!({ "name": "沈汐", "portrait": -1 })).is_err());
    assert!(serde_json::from_value::<CaptainView>(json!({ "name": "沈汐" })).is_err());
}

#[test]
fn invalid_captains_are_rejected_and_keep_the_old_one() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path(), 0);
    handlers::new_game(&st, "newcomer", Some(8)).unwrap();
    handlers::set_captain(&st, captain("顾川", 2)).unwrap();

    let thirteen = "一二三四五六七八九十甲乙丙";
    let bad = [
        captain("", 0),                            // 空
        captain("   \t ", 0),                      // 只有空白
        captain(thirteen, 0),                      // 超过 12 个字
        captain("顾\n川", 0),                      // 换行（控制字符）
        captain("顾\u{7}川", 0),                   // 响铃（控制字符）
        captain("顾\u{202E}川", 0),                // 双向文字控制符
        captain("顾\u{200B}川", 0),                // 零宽空格
        captain("顾川", CAPTAIN_PORTRAIT_MAX + 1), // 外貌越界（25）
        captain("顾川", 12),                       // 12 号停用
        captain("顾川", u32::MAX),
    ];
    for c in bad {
        let err = handlers::set_captain(&st, c.clone());
        assert!(matches!(err, Err(AppError::Invalid(_))), "应拒绝 {c:?}：{err:?}");
    }
    // 首尾空白不计入长度：12 个字加空白仍合法
    let padded = format!("  {}  ", &thirteen[..thirteen.len() - "丙".len()]);
    assert!(handlers::validate_captain(captain(&padded, 0)).is_ok());
    assert_eq!(handlers::overview(&st).unwrap().captain, Some(captain("顾川", 2)), "被拒绝时保留原来的主角");
}

#[test]
fn ordinary_portraits_are_0_to_11_and_13_to_24() {
    // 外貌 24 种：第一批的 0–11 与英雄扩充的 13–24；12 号夹在中间，已停用
    assert_eq!(CAPTAIN_PORTRAITS, 24);
    assert_eq!(CAPTAIN_PORTRAIT_MAX, 24);
    assert_eq!(RETIRED_PORTRAIT, 12);
    let ordinary: Vec<u32> = (0..=40).filter(|&p| handlers::is_ordinary_portrait(p)).collect();
    assert_eq!(ordinary, (0..=11).chain(13..=24).collect::<Vec<u32>>());
    assert_eq!(ordinary.len() as u32, CAPTAIN_PORTRAITS);
    for p in 0..=40 {
        let ok = handlers::validate_captain(captain("顾川", p)).is_ok();
        assert_eq!(ok, (0..=11).contains(&p) || (13..=24).contains(&p), "{p} 号外貌");
    }
    // 拒绝原因写明范围与例外（中文，界面按语言另有英文）
    match handlers::validate_captain(captain("顾川", 25)) {
        Err(AppError::Invalid(m)) => {
            assert_eq!(m.key, "app.captain_portrait");
            assert_eq!(m.zh, "外貌编号只能是 0–24（12 号除外）");
            assert_eq!(m.args, vec![("max", "24".to_string()), ("except", "12".to_string())]);
        }
        other => panic!("25 号应被拒绝：{other:?}"),
    }

    // 新外貌经由 set_captain 与存档往返，照常出现在存档列表里
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path(), 0);
    handlers::new_game(&st, "newcomer", Some(17)).unwrap();
    let hash = state_hash(&st);
    assert_eq!(handlers::set_captain(&st, captain("沈汐", 17)).unwrap().captain, Some(captain("沈汐", 17)));
    assert_eq!(state_hash(&st), hash, "换外貌不改变世界状态");
    handlers::save_game(&st, "new-look").unwrap();
    let list = handlers::list_saves(&st).unwrap();
    assert_eq!(list.iter().find(|s| s.slot == "new-look").and_then(|s| s.captain.clone()), Some(captain("沈汐", 17)));
    handlers::new_game(&st, "newcomer", Some(18)).unwrap();
    assert_eq!(handlers::load_game(&st, "new-look").unwrap().captain, Some(captain("沈汐", 17)));
}

#[test]
fn captain_round_trips_through_save_and_load() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path(), 0);
    handlers::new_game(&st, "newcomer", Some(11)).unwrap();
    handlers::set_captain(&st, captain("苏岚", 7)).unwrap();
    handlers::step(&st, 3).unwrap();
    let saved = handlers::save_game(&st, "hero").unwrap();
    assert_eq!(saved.captain, Some(captain("苏岚", 7)));
    let hash = state_hash(&st);

    // 存档列表带主角（开局界面据此显示头像与姓名）
    let list = handlers::list_saves(&st).unwrap();
    let info = list.iter().find(|s| s.slot == "hero").expect("存档在列表中");
    assert_eq!(info.captain, Some(captain("苏岚", 7)));

    // 改名、换一局之后读档：主角恢复为存档时的样子
    handlers::set_captain(&st, captain("别人", 1)).unwrap();
    handlers::new_game(&st, "heir", Some(12)).unwrap();
    let o = handlers::load_game(&st, "hero").unwrap();
    assert_eq!(o.captain, Some(captain("苏岚", 7)));
    assert_eq!(o.day, saved.day);
    assert_eq!(state_hash(&st), hash, "读档后世界状态与存档时一致");
    // 读档后可以继续游戏，主角仍在
    assert_eq!(handlers::step(&st, 1).unwrap().captain, Some(captain("苏岚", 7)));

    // 没有设置主角的一局，存档读档后主角为空
    handlers::new_game(&st, "newcomer", Some(13)).unwrap();
    assert_eq!(handlers::save_game(&st, "nobody").unwrap().captain, None);
    handlers::set_captain(&st, captain("临时", 0)).unwrap();
    assert_eq!(handlers::load_game(&st, "nobody").unwrap().captain, None);
}

#[test]
fn autosave_includes_the_captain() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path(), 5);
    handlers::new_game(&st, "newcomer", Some(21)).unwrap();
    handlers::set_captain(&st, captain("陈舟", 4)).unwrap();
    handlers::step(&st, 6).unwrap();
    let list = handlers::list_saves(&st).unwrap();
    let auto = list.iter().find(|s| s.slot == "autosave").expect("自动存档");
    assert_eq!(auto.day, 5);
    assert_eq!(auto.captain, Some(captain("陈舟", 4)));
    handlers::new_game(&st, "newcomer", Some(22)).unwrap();
    let o = handlers::load_game(&st, "autosave").unwrap();
    assert_eq!((o.day, o.captain), (5, Some(captain("陈舟", 4))));
}

#[test]
fn new_game_clears_the_captain() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path(), 0);
    handlers::new_game(&st, "newcomer", Some(31)).unwrap();
    handlers::set_captain(&st, captain("林岚", 9)).unwrap();
    let o = handlers::new_game(&st, "sandbox", Some(32)).unwrap();
    assert_eq!(o.captain, None, "换新游戏后主角清空");
    assert_eq!(handlers::overview(&st).unwrap().captain, None);
    let v = serde_json::to_value(handlers::overview(&st).unwrap()).unwrap();
    assert!(v["captain"].is_null(), "没有主角时序列化为 null");
}

#[test]
fn old_saves_without_captain_still_load() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path(), 0);
    handlers::new_game(&st, "newcomer", Some(41)).unwrap();
    handlers::set_captain(&st, captain("沈远", 6)).unwrap();
    handlers::save_game(&st, "old").unwrap();
    let saves = st.paths().saves_dir.clone();

    // 1. 旧版本的 meta（没有 captain 字段）：列表与读档照常，主角为空
    let meta = saves.join("old.meta.json");
    let mut v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&meta).unwrap()).unwrap();
    v.as_object_mut().unwrap().remove("captain");
    std::fs::write(&meta, v.to_string()).unwrap();
    let list = handlers::list_saves(&st).unwrap();
    let info = list.iter().find(|s| s.slot == "old").expect("旧 meta 仍在列表中");
    assert_eq!(info.captain, None);
    let o = handlers::load_game(&st, "old").unwrap();
    assert_eq!(o.captain, None);

    // 2. meta 中的主角不合法（例如手工改坏）：照常读档，主角为空
    v["captain"] = json!({ "name": "沈远", "portrait": 99 });
    std::fs::write(&meta, v.to_string()).unwrap();
    assert_eq!(handlers::load_game(&st, "old").unwrap().captain, None);

    // 3. meta 损坏或缺失：存档本身照常读取
    std::fs::write(&meta, "{ 不是 JSON").unwrap();
    assert_eq!(handlers::load_game(&st, "old").unwrap().captain, None);
    std::fs::remove_file(&meta).unwrap();
    assert_eq!(handlers::load_game(&st, "old").unwrap().captain, None);

    // 4. manifest-sim 的 v1 样例存档（旧格式，没有 meta）：迁移后照常读取，主角为空，可以继续游戏并设置主角
    std::fs::copy(legacy_fixture(), saves.join("legacy.mfsave.zst")).expect("复制样例存档");
    let o = handlers::load_game(&st, "legacy").unwrap();
    assert_eq!(o.day, 20);
    assert_eq!(o.captain, None);
    handlers::step(&st, 2).unwrap();
    assert_eq!(handlers::set_captain(&st, captain("新主人", 1)).unwrap().captain, Some(captain("新主人", 1)));
}

#[test]
fn scenarios_describe_start_cash_and_goal() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path(), 0);
    let statics = handlers::static_data(&st);
    let v = serde_json::to_value(&statics).unwrap();
    let newcomer = v["scenarios"].as_array().unwrap().iter().find(|s| s["key"] == "newcomer").expect("新晋船主");
    let start = newcomer["start"].as_u64().unwrap() as usize;
    assert_eq!(statics.locations[start].key, "chenggang");
    assert_eq!(newcomer["cash"], json!(15000));
    assert_eq!(newcomer["crew"], json!(14));
    assert_eq!(newcomer["mates"], json!(1));
    assert_eq!(newcomer["ships"].as_array().unwrap().len(), 1);
    assert_eq!(newcomer["goal"], json!({ "kind": "net_worth", "target": 300000, "years": 10 }));
    let sandbox = v["scenarios"].as_array().unwrap().iter().find(|s| s["key"] == "sandbox").unwrap();
    assert_eq!(sandbox["goal"], json!({ "kind": "sandbox", "target": 0, "years": null }));
    let heir = v["scenarios"].as_array().unwrap().iter().find(|s| s["key"] == "heir").unwrap();
    assert_eq!(heir["goal"]["kind"], json!("ally_ports"));
    assert_eq!(heir["goal"]["target"], json!(2));
}
