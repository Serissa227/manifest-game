//! 多语言（EXPANSION.md §12）：切换语言后静态数据、概览、情报（新闻、编年史、组合事件）、议价回复与
//! 命令被拒绝的原因按英文显示；专名在任何语言下都附英文写法；切换语言不改变世界状态、世界哈希、存档与重放；
//! 旧存档照常读取（其中的中文句子原样显示）。离线模板，不访问任何服务。

use manifest_ai::{AiMode, MemoryKeyStore};
use manifest_app::handlers;
use manifest_app::{AppError, AppPaths, AppState};
use manifest_core::{Command, LocId, OwnerId};
use manifest_data::Locale;
use std::path::Path;
use std::sync::Arc;

fn app(dir: &Path) -> AppState {
    let data = manifest_data::find_data_dir().expect("找到 data/");
    let st = AppState::from_data_dir(&data, Arc::new(MemoryKeyStore::default()), AppPaths::in_dir(dir)).unwrap();
    let mut s = handlers::get_settings(&st).settings;
    s.ai.mode = AiMode::Offline;
    s.autosave_days = 0;
    handlers::save_settings(&st, s).unwrap();
    st
}

fn set_language(st: &AppState, l: Option<Locale>) {
    let mut s = handlers::get_settings(st).settings;
    s.language = l;
    handlers::save_settings(st, s).unwrap();
}

fn cjk(s: &str) -> bool {
    s.chars().any(|c| ('\u{4e00}'..='\u{9fff}').contains(&c) || ('\u{3000}'..='\u{303f}').contains(&c))
}

fn loc(st: &AppState, key: &str) -> u16 {
    st.defs().locations.iter().position(|l| l.key == key).unwrap() as u16
}

#[test]
fn settings_language_defaults_to_unset_and_round_trips() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path());
    assert_eq!(handlers::get_settings(&st).settings.language, None, "未设置：前端首次启动按系统语言写入");
    assert_eq!(st.locale(), Locale::ZhCn, "后端缺省中文");
    let json = serde_json::to_value(&handlers::get_settings(&st).settings).unwrap();
    assert!(json.get("language").is_none(), "未设置时不写这个字段");
    set_language(&st, Some(Locale::En));
    let json = serde_json::to_value(&handlers::get_settings(&st).settings).unwrap();
    assert_eq!(json["language"], "en");
    // 设置文件保存后重新载入仍是英文
    let again = app(tmp.path());
    assert_eq!(again.locale(), Locale::En);
    // 旧设置文件（没有 language）照常读取
    let old: manifest_app::settings::AppSettings =
        serde_json::from_str(r#"{"speed":2,"autosave_days":30,"dev_mode":false}"#).unwrap();
    assert_eq!(old.language, None);
}

#[test]
fn static_data_follows_the_language_and_always_carries_english_names() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path());
    let vm = loc(&st, "chenggang") as usize;
    let zh = handlers::static_data(&st);
    assert_eq!(zh.locations[vm].name, "维拉马雷");
    assert_eq!(zh.locations[vm].name_en, "Villamare", "中文界面也附英文写法（双行显示）");
    assert_eq!(zh.world.currency, "金币");
    let grain = zh.goods.iter().position(|g| g.key == "grain").unwrap();
    assert_eq!((zh.goods[grain].name.as_str(), zh.goods[grain].name_en.as_str()), ("谷物", "Grain"));
    assert_eq!((zh.goods[grain].category.as_str(), zh.goods[grain].category_en.as_str()), ("粮食", "Food"));

    set_language(&st, Some(Locale::En));
    let en = handlers::static_data(&st);
    assert_eq!(en.data_hash, zh.data_hash, "数据哈希不随语言变化");
    assert_eq!((en.locations[vm].name.as_str(), en.locations[vm].name_en.as_str()), ("Villamare", "Villamare"));
    assert_eq!(en.world.currency, "gold");
    assert_eq!(en.world.era, "Mariner's Reckoning");
    assert_eq!(en.goods[grain].category, "粮食", "类别是内部键，不随语言变化");
    for l in &en.locations {
        assert!(!cjk(&l.name) && !cjk(&l.lore), "{}：{}", l.key, l.name);
    }
    for f in &en.factions {
        assert!(!cjk(&f.name));
    }
    for s in &en.scenarios {
        assert!(!cjk(&s.name) && !cjk(&s.description) && s.name == s.name_en);
    }
    for d in &en.discoveries {
        assert!(!cjk(&d.name) && !cjk(&d.lore));
    }
    // 数值与结构不变
    assert_eq!(serde_json::to_value(&en.map).unwrap(), serde_json::to_value(&zh.map).unwrap());
    assert_eq!(
        en.goods.iter().map(|g| g.base_price).collect::<Vec<_>>(),
        zh.goods.iter().map(|g| g.base_price).collect::<Vec<_>>()
    );
}

#[test]
fn switching_language_does_not_touch_the_world() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path());
    handlers::new_game(&st, "newcomer", Some(77)).unwrap();
    handlers::step(&st, 40).unwrap();
    let h0 = handlers::debug(&st).unwrap().state_hash;
    let zh_overview = handlers::overview(&st).unwrap();
    set_language(&st, Some(Locale::En));
    assert_eq!(handlers::debug(&st).unwrap().state_hash, h0, "切换语言不改变世界哈希");
    let en_overview = handlers::overview(&st).unwrap();
    assert_eq!(zh_overview.scenario, "白帆初扬");
    assert_eq!(en_overview.scenario, "White Sails Rising");
    assert_eq!(zh_overview.scenario_en, "White Sails Rising", "中文界面也附剧本名的英文写法");
    assert_eq!(en_overview.scenario_en, en_overview.scenario);
    assert_eq!(
        (en_overview.cash, en_overview.net_worth, en_overview.day),
        (zh_overview.cash, zh_overview.net_worth, zh_overview.day)
    );
    let lw = en_overview.local_weather.as_ref().unwrap();
    assert!(!cjk(&lw.region_name) && lw.region_name == lw.region_name_en);
    assert_eq!(zh_overview.local_weather.as_ref().unwrap().region_name_en, lw.region_name);

    // 同一种子、同样的推进：中文与英文界面得到完全相同的世界（离线模板始终按中文生成，显示时再换语言）
    let run = |l: Option<Locale>| {
        let tmp = tempfile::tempdir().unwrap();
        let st = app(tmp.path());
        set_language(&st, l);
        handlers::new_game(&st, "newcomer", Some(2026)).unwrap();
        handlers::step(&st, 60).unwrap();
        handlers::save_game(&st, "same").unwrap();
        let save = manifest_sim::storage::read(&tmp.path().join("saves").join("same.mfsave.zst")).unwrap();
        (handlers::debug(&st).unwrap().state_hash, save)
    };
    let (hz, sz) = run(None);
    let (he, se) = run(Some(Locale::En));
    assert_eq!(hz, he, "世界哈希与语言无关");
    assert_eq!(sz.to_json().unwrap(), se.to_json().unwrap(), "存档内容与语言无关");
    // 重放一致（会话存档的重放：推进到存档日之后，再执行已经排在存档当天的命令——原局在推进时就执行了它们）
    let defs = st.defs().clone();
    let replayed = manifest_sim::session::replay_to(defs, se.start, &se.log, se.snapshot.day).unwrap();
    assert_eq!(replayed.state_hash(), manifest_core::world::state_hash(&st.defs().meta.hash, &se.snapshot));
}

#[test]
fn news_chronicles_and_events_are_shown_in_english() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path());
    handlers::new_game(&st, "newcomer", Some(9)).unwrap();
    handlers::step(&st, 366).unwrap();
    let zh = handlers::intel(&st).unwrap();
    set_language(&st, Some(Locale::En));
    let en = handlers::intel(&st).unwrap();
    // 离线模板写的传闻都带模板位置：英文界面全部是英文，中文界面是原文
    assert!(!en.news.is_empty(), "一年里应有传闻");
    let g = st.game().unwrap();
    let w = &g.as_ref().unwrap().session.world;
    for (a, b) in zh.news.iter().zip(&en.news) {
        assert_eq!(a.id, b.id);
        let n = w.state.news.news.iter().find(|n| n.id == a.id).unwrap();
        assert_eq!(a.text, n.text, "中文显示原文");
        assert!(n.tpl.is_some(), "离线传闻保存模板位置");
        assert!(!cjk(&b.text), "{}", b.text);
    }
    // 编年史（第一年）
    assert_eq!(en.chronicles.len(), 1, "第一年的编年史");
    assert!(!cjk(&en.chronicles[0].text) && en.chronicles[0].text.contains("1502"), "{}", en.chronicles[0].text);
    assert_eq!(zh.chronicles[0].text, w.state.news.chronicles[0].text);
    // 组合事件卡片与效果说明
    assert!(!en.composed.is_empty(), "一年里应有组合事件");
    for (a, b) in zh.composed.iter().zip(&en.composed) {
        assert_eq!(a.id, b.id);
        assert!(!cjk(&b.name) && !cjk(b.narrative.as_deref().unwrap_or("")), "{} / {:?}", b.name, b.narrative);
        for e in &b.effects {
            assert!(!cjk(&e.label) && !cjk(e.hint), "{} {}", e.label, e.hint);
            for n in [&e.loc, &e.good, &e.region, &e.faction_a, &e.faction_b].into_iter().flatten() {
                assert!(!cjk(n), "{n}");
            }
        }
    }
    // 日志中的名字与组合事件标题
    for l in &en.log {
        for (k, v) in &l.args {
            assert!(!cjk(v), "{} {k}={v}", l.kind);
        }
    }
    drop(g);
    // 航海士：名字与小传
    let mates = handlers::mates(&st).unwrap();
    for m in mates.hired.iter().chain(&mates.available) {
        assert!(!cjk(&m.name) && !cjk(&m.bio) && m.name == m.name_en);
    }
}

#[test]
fn bargain_replies_and_rejections_are_in_english() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path());
    let o = handlers::new_game(&st, "newcomer", Some(5)).unwrap();
    let here = o.fleets[0].docked.unwrap();
    set_language(&st, Some(Locale::En));
    let r = handlers::bargain(&st, here, "Come on, give me a discount, it's too expensive!".into()).unwrap();
    assert_eq!(r.intent, "discount");
    assert!(!r.reply.is_empty() && !cjk(&r.reply), "{}", r.reply);

    // 命令被拒绝：没有许可证买火炮（带错误码的原因）
    let cannon = st.defs().find_good("cannon").unwrap();
    let cmd = Command::Buy {
        owner: OwnerId::Player,
        fleet: manifest_core::FleetId(o.fleets[0].id),
        good: cannon,
        qty: 1,
        max_total: None,
    };
    let err = handlers::submit(&st, cmd.clone()).unwrap_err();
    let zh_text = err.to_string();
    assert!(zh_text.contains("许可证"), "处理函数返回的原文不变：{zh_text}");
    let en_text = st.localize_error(err).to_string();
    assert_eq!(en_text, "Command rejected: Trading this good requires a license from the local nation.");
    // 固定原因（现金不足）带参数
    let e = manifest_core::CommandError::InsufficientCash { need: 12_345, have: 10 };
    assert_eq!(
        st.localize_error(AppError::Command(e)).to_string(),
        "Command rejected: Not enough gold: need 12,345, have 10."
    );
    // 应用层提示与存档错误
    assert_eq!(handlers::save_game(&st, "bad name").unwrap().slot, "bad name");
    let slot = handlers::save_game(&st, "bad/name").unwrap_err();
    assert_eq!(slot.to_string(), "存档名不能为空，不能包含控制字符或路径分隔符。");
    assert_eq!(
        st.localize_error(slot).to_string(),
        "Save names cannot be blank or contain control characters or path separators."
    );
    let load = handlers::load_game(&st, "missing").unwrap_err();
    let text = st.localize_error(load).to_string();
    assert!(text.starts_with("Save: Could not read the save file:"), "{text}");
    // 中文界面：原样返回
    set_language(&st, Some(Locale::ZhCn));
    let err = handlers::submit(&st, cmd).unwrap_err();
    assert_eq!(st.localize_error(err).to_string(), zh_text);
}

#[test]
fn colony_site_reasons_are_localized() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path());
    handlers::new_game(&st, "newcomer", Some(3)).unwrap();
    let site = st.defs().locations.iter().position(|l| l.is_site()).unwrap() as u16;
    let zh = handlers::site(&st, site).unwrap();
    assert_eq!(zh.reason.as_deref(), Some("尚未探明这处殖民点"));
    set_language(&st, Some(Locale::En));
    let en = handlers::site(&st, site).unwrap();
    assert_eq!(en.reason.as_deref(), Some("This colony site has not been surveyed yet."));
    assert!(!cjk(&en.lore));
}

#[test]
fn old_saves_load_and_keep_their_chinese_sentences() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path());
    set_language(&st, Some(Locale::En));
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("manifest-sim")
        .join("tests")
        .join("fixtures")
        .join("save_v1.mfsave.zst");
    std::fs::create_dir_all(tmp.path().join("saves")).unwrap();
    std::fs::copy(&fixture, tmp.path().join("saves").join("old.mfsave.zst")).unwrap();
    let o = handlers::load_game(&st, "old").unwrap();
    assert!(!cjk(&o.scenario), "{}", o.scenario);
    let intel = handlers::intel(&st).unwrap();
    let g = st.game().unwrap();
    let w = &g.as_ref().unwrap().session.world;
    for n in &intel.news {
        let stored = w.state.news.news.iter().find(|x| x.id == n.id).unwrap();
        if stored.tpl.is_none() {
            assert_eq!(n.text, stored.text, "旧存档里的句子原样显示");
        }
    }
    drop(g);
    // 读档后继续运行，英文界面照常
    handlers::step(&st, 5).unwrap();
    let _ = handlers::port(&st, LocId(0).0).unwrap();
}

#[test]
fn save_list_shows_scenario_names_in_the_current_language() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path());
    handlers::new_game(&st, "heir", Some(1)).unwrap();
    handlers::save_game(&st, "slot1").unwrap();
    let meta = std::fs::read_to_string(tmp.path().join("saves").join("slot1.meta.json")).unwrap();
    assert!(meta.contains("赫伦丹的遗产") && meta.contains("\"scenario_key\":\"heir\""), "{meta}");
    set_language(&st, Some(Locale::En));
    handlers::save_game(&st, "slot2").unwrap();
    let meta2 = std::fs::read_to_string(tmp.path().join("saves").join("slot2.meta.json")).unwrap();
    assert!(meta2.contains("赫伦丹的遗产"), "meta 文件里写中文原名，与界面语言无关：{meta2}");
    let list = handlers::list_saves(&st).unwrap();
    assert!(
        list.iter().all(|s| s.scenario == "The Herendam Inheritance"),
        "{:?}",
        list.iter().map(|s| &s.scenario).collect::<Vec<_>>()
    );
}

#[test]
fn english_mock_ai_games_replay_and_reload_exactly() {
    // 英文界面 + Mock 模型（英文提示词）：命令日志重放得到同一世界，存档读回后世界哈希不变，中途切回中文也不改变世界
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path());
    let mut s = handlers::get_settings(&st).settings;
    s.ai.mode = AiMode::Mock;
    s.language = Some(Locale::En);
    handlers::save_settings(&st, s).unwrap();
    handlers::new_game(&st, "newcomer", Some(424)).unwrap();
    handlers::step(&st, 200).unwrap();
    let h = handlers::debug(&st).unwrap().state_hash;
    set_language(&st, Some(Locale::ZhCn));
    assert_eq!(handlers::debug(&st).unwrap().state_hash, h, "切换语言不改变世界哈希");
    set_language(&st, Some(Locale::En));
    handlers::save_game(&st, "mock_en").unwrap();
    let save = manifest_sim::storage::read(&tmp.path().join("saves").join("mock_en.mfsave.zst")).unwrap();
    assert!(save.log.iter().any(|e| e.source == manifest_core::Source::Ai), "应有 AI 命令");
    let replayed =
        manifest_sim::session::replay_to(st.defs().clone(), save.start, &save.log, save.snapshot.day).unwrap();
    assert_eq!(replayed.state_hash(), h, "重放一致");
    handlers::load_game(&st, "mock_en").unwrap();
    assert_eq!(handlers::debug(&st).unwrap().state_hash, h, "读档后世界哈希不变");
    let intel = handlers::intel(&st).unwrap();
    assert!(intel.news.iter().all(|n| !cjk(&n.text)), "Mock 照抄的离线传闻带模板位置，按英文显示");
}
