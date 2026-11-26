//! 第八批 E2：主角身世与属性在应用层（docs/ECONOMY.md 第 5 节）。
//! 静态数据里的身世（开局向导用，按语言）、界面提交的 CreateCaptain（JSON 形式与前端一致）、概览里的主角档案、
//! 行情窗口按算学放开的追踪条数与主角本人会的奇才之法、存档读档、旧存档补建身世（不再发放开局效果）、错误的英文。

use manifest_ai::{AiMode, MemoryKeyStore};
use manifest_app::handlers;
use manifest_app::{AppError, AppPaths, AppState};
use manifest_core::{Command, CommandOutcome};
use manifest_data::Locale;
use serde_json::json;
use std::path::{Path, PathBuf};
use std::sync::Arc;

fn app(dir: &Path) -> AppState {
    let data = manifest_data::find_data_dir().expect("找到 data/");
    let st = AppState::from_data_dir(&data, Arc::new(MemoryKeyStore::default()), AppPaths::in_dir(dir)).unwrap();
    let mut settings = handlers::get_settings(&st).settings;
    settings.ai.mode = AiMode::Off;
    settings.autosave_days = 0;
    handlers::save_settings(&st, settings).unwrap();
    st
}

fn set_language(st: &AppState, locale: Locale) {
    let mut settings = handlers::get_settings(st).settings;
    settings.language = Some(locale);
    handlers::save_settings(st, settings).unwrap();
}

/// 界面发来的 CreateCaptain（与前端 store/game.ts 的写法相同）。
fn create(answers: [&str; 5], alloc: [i64; 6], month: u32, genius: Option<&str>) -> Command {
    serde_json::from_value(json!({
        "CreateCaptain": {
            "owner": "player",
            "birthday": { "year": 1480, "month": month, "day": 12 },
            "answers": answers,
            "alloc": alloc,
            "genius": genius,
        }
    }))
    .expect("前端的 JSON 能解析成命令")
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

/// 算学 1 + 2 + 1 + 2 + 1（家世、童年、少年、成年）+ 1（2 月 12 日水瓶座）= 8 → 夹到 7：开局即是算学奇才。
const PRODIGY: [&str; 5] = ["lighthouse_scribes", "dock_ledger", "university", "broker", "fortune"];

#[test]
fn static_data_describes_backgrounds_in_each_language() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path());
    let c = handlers::static_data(&st).captain.expect("数据里有身世");
    assert_eq!(c.attributes.iter().map(|a| a.key.as_str()).collect::<Vec<_>>(), manifest_core::captain::ATTRIBUTES);
    // 现行的十二星座在前（白羊座起，带首日与末日），十二个旧版星宫在后（只为旧存档保留）
    assert_eq!(c.signs.len(), 24);
    assert!(c.signs[..12].iter().all(|s| !s.legacy && s.start.is_some() && s.end.is_some()));
    assert!(c.signs[12..].iter().all(|s| s.legacy && s.start.is_none() && s.end.is_none()));
    let aries = &c.signs[0];
    assert_eq!((aries.key.as_str(), aries.name.as_str(), aries.attribute.as_str()), ("aries", "白羊座", "arms"));
    assert_eq!((aries.start, aries.end), (Some([3, 21]), Some([4, 19])));
    let capricorn = c.signs.iter().find(|s| s.key == "capricorn").unwrap();
    assert_eq!((capricorn.start, capricorn.end), (Some([12, 22]), Some([1, 19])));
    let lantern = c.signs.iter().find(|s| s.key == "lantern").unwrap();
    assert_eq!((lantern.name.as_str(), lantern.legacy), ("提灯座", true));
    // JSON 与前端的类型一致
    let v = serde_json::to_value(aries).unwrap();
    assert_eq!(v["start"], json!([3, 21]));
    assert_eq!(v["end"], json!([4, 19]));
    assert_eq!(v["legacy"], json!(false));
    assert_eq!(serde_json::to_value(lantern).unwrap()["start"], json!(null));
    assert_eq!(c.questions.len(), 5);
    assert_eq!(
        (c.points.free, c.points.creation_cap, c.points.manual_numeracy, c.points.birthday_morale),
        (5, 7, 4, 5)
    );
    assert_eq!((c.points.age_min, c.points.age_max, c.points.age_default), (16, 45, 18));
    let family = &c.questions[0];
    assert_eq!(family.title, "你的家世");
    let merchant = family.options.iter().find(|o| o.key == "merchant_house").unwrap();
    assert_eq!(merchant.name, "港口商人之家");
    assert_eq!(merchant.attrs.iter().map(|(k, v)| (k.as_str(), *v)).collect::<Vec<_>>(), vec![("commerce", 2)]);
    let v = serde_json::to_value(merchant.effect.as_ref().unwrap()).unwrap();
    assert_eq!(v, json!({ "kind": "cash_pct", "value": 10 }));
    // 海区、商品与贷款的效果带编号与数值
    let chart = c.questions[4].options.iter().find(|o| o.key == "new_world").unwrap().effect.as_ref().unwrap();
    assert_eq!((chart.kind, chart.region.is_some()), ("chart", true));
    let loan = serde_json::to_value(
        c.questions[4].options.iter().find(|o| o.key == "family_debt").unwrap().effect.as_ref().unwrap(),
    )
    .unwrap();
    assert_eq!(loan, json!({ "kind": "loan", "amount": 8000, "months": 12 }));

    set_language(&st, Locale::En);
    let en = handlers::static_data(&st).captain.unwrap();
    assert_eq!(en.questions[0].title, "Your family");
    let names: Vec<&str> = en.signs[..12].iter().map(|s| s.name.as_str()).collect();
    assert_eq!(
        names,
        [
            "Aries",
            "Taurus",
            "Gemini",
            "Cancer",
            "Leo",
            "Virgo",
            "Libra",
            "Scorpio",
            "Sagittarius",
            "Capricorn",
            "Aquarius",
            "Pisces"
        ]
    );
    assert_eq!(en.signs.iter().find(|s| s.key == "lantern").map(|s| s.name.as_str()), Some("The Lantern"));
    assert_eq!(en.attributes[4].name, "Numeracy");
}

#[test]
fn a_new_game_records_the_background_and_shows_the_profile() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path());
    let o = handlers::new_game(&st, "newcomer", Some(7)).unwrap();
    assert_eq!(o.profile, None);
    let cash0 = o.cash;
    let book = handlers::forecast_book(&st).unwrap();
    assert_eq!(book.max_active, 12, "没有主角档案时照旧");
    assert!(!book.methods.contains(&"ar1".to_string()));

    // 港口商人之家（资金 +10%）；算学 1 + 1 + 2 + 1 + 1（2 月 12 日水瓶座）= 6，再分 1 点到 7，自选回归术
    let answers = ["merchant_house", "dock_ledger", "university", "broker", "fortune"];
    let r = handlers::submit(&st, create(answers, [0, 0, 0, 0, 1, 4], 2, Some("ar1"))).unwrap();
    assert_eq!(r.outcome, CommandOutcome::Done);
    let p = r.overview.profile.clone().expect("概览里有主角档案");
    assert_eq!(p.sign, "aquarius");
    assert_eq!(p.sign_name, "水瓶座");
    assert_eq!(p.answers, answers.map(String::from).to_vec());
    // 航海 1、交易 1 + 2 + 1 + 1 + 1 = 6、武艺 1、管理 1、算学 7、口才 1 + 4
    let attrs: Vec<i64> = p.attrs.iter().map(|(_, v)| *v).collect();
    assert_eq!(p.attrs.iter().map(|(k, _)| k.as_str()).collect::<Vec<_>>(), manifest_core::captain::ATTRIBUTES);
    assert_eq!(attrs, vec![1, 6, 1, 1, 7, 5]);
    assert_eq!(p.methods, vec!["ar1".to_string()]);
    assert_eq!(r.overview.cash, cash0 + cash0 / 10, "开局资金 +10%");

    // 行情窗口：追踪上限 3 + 算学，主角本人会的方法可用
    let book = handlers::forecast_book(&st).unwrap();
    assert_eq!(book.max_active, 10);
    assert!(book.methods.contains(&"ar1".to_string()));

    // 每局只能立一次：错误有中文与英文
    let err = handlers::submit(&st, create(answers, [0, 0, 0, 0, 1, 4], 2, None)).unwrap_err();
    assert!(err.to_string().contains("主角的身世已经立下"), "{err}");
    set_language(&st, Locale::En);
    let en =
        st.localize_error(handlers::submit(&st, create(answers, [0, 0, 0, 0, 1, 4], 2, None)).unwrap_err()).to_string();
    assert!(en.starts_with("Command rejected: ") && !en.contains('主'), "{en}");

    // 存档读档：档案还在
    handlers::save_game(&st, "hero").unwrap();
    handlers::new_game(&st, "newcomer", Some(8)).unwrap();
    assert_eq!(handlers::overview(&st).unwrap().profile, None);
    let back = handlers::load_game(&st, "hero").unwrap();
    assert_eq!(back.profile.map(|p| p.methods), Some(vec!["ar1".to_string()]));
    assert_eq!(handlers::forecast_book(&st).unwrap().max_active, 10);
}

#[test]
fn invalid_backgrounds_are_rejected_with_readable_errors() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path());
    handlers::new_game(&st, "newcomer", Some(9)).unwrap();
    let before = handlers::debug(&st).unwrap().state_hash;
    let cases: Vec<(Command, &str)> = vec![
        (create(PRODIGY, [0, 0, 0, 0, 0, 4], 2, None), "自由分配的点数必须正好是 5"),
        (create(PRODIGY, [0, 0, 0, 0, 1, 4], 2, None), "开局时单项属性不能超过 7"),
        (
            create(["merchant_house", "dock_ledger", "university", "broker", "nope"], [5, 0, 0, 0, 0, 0], 2, None),
            "每道身世问题都要回答一个选项",
        ),
        // 算学 1 + 1（水瓶座）+ 4 = 6
        (
            create(
                ["merchant_house", "fishing_boats", "naval_cadet", "navy", "fortune"],
                [0, 0, 0, 0, 4, 1],
                2,
                Some("ses"),
            ),
            "算学达到 7 才能自选一种奇才之法",
        ),
    ];
    for (cmd, text) in cases {
        let err = handlers::submit(&st, cmd).unwrap_err();
        assert!(matches!(err, AppError::Command(_)));
        assert!(err.to_string().contains(text), "应提到“{text}”：{err}");
    }
    // 年龄不对：参数写进文字
    let young: Command = serde_json::from_value(json!({
        "CreateCaptain": {
            "owner": "player",
            "birthday": { "year": 1500, "month": 1, "day": 1 },
            "answers": PRODIGY,
            "alloc": [5, 0, 0, 0, 0, 0],
        }
    }))
    .unwrap();
    let err = handlers::submit(&st, young).unwrap_err().to_string();
    assert!(err.contains("16") && err.contains("45"), "{err}");
    // 15 岁也不行（1502 − 1487）
    let fifteen: Command = serde_json::from_value(json!({
        "CreateCaptain": {
            "owner": "player",
            "birthday": { "year": 1487, "month": 1, "day": 1 },
            "answers": PRODIGY,
            "alloc": [5, 0, 0, 0, 0, 0],
        }
    }))
    .unwrap();
    assert!(handlers::submit(&st, fifteen).unwrap_err().to_string().contains("16"));
    assert_eq!(handlers::debug(&st).unwrap().state_hash, before, "被拒绝的命令不改变状态");
}

#[test]
fn an_old_save_can_set_its_background_once_without_start_effects() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path());
    let saves = st.paths().saves_dir.clone();
    std::fs::create_dir_all(&saves).unwrap();
    std::fs::copy(legacy_fixture(), saves.join("legacy.mfsave.zst")).expect("复制样例存档");
    let o = handlers::load_game(&st, "legacy").unwrap();
    assert_eq!(o.day, 20);
    assert_eq!(o.profile, None);
    let (cash0, loans0) = (o.cash, o.loans);
    let r = handlers::submit(
        &st,
        create(["merchant_house", "dock_ledger", "university", "broker", "family_debt"], [1, 1, 1, 1, 0, 1], 5, None),
    )
    .unwrap();
    let p = r.overview.profile.expect("补建了身世");
    assert_eq!(p.created, 20);
    // 补建身世也按现行的星座：5 月 12 日金牛座
    assert_eq!((p.sign.as_str(), p.sign_name.as_str()), ("taurus", "金牛座"));
    assert_eq!((r.overview.cash, r.overview.loans), (cash0, loans0), "资金 +10% 与贷款都不再发放");
    assert!(handlers::submit(&st, create(PRODIGY, [5, 0, 0, 0, 0, 0], 2, None)).is_err(), "只能补建一次");
}

#[test]
fn a_profile_from_an_old_version_shows_its_legacy_sign() {
    // 旧版本按出生月份判定星宫，档案里记的是旧版星宫的 key：名字照常显示（中英文），序章也照常写
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path());
    handlers::new_game(&st, "newcomer", Some(7)).unwrap();
    handlers::submit(&st, create(PRODIGY, [5, 0, 0, 0, 0, 0], 12, None)).unwrap();
    assert_eq!(handlers::overview(&st).unwrap().profile.unwrap().sign_name, "射手座", "12 月 12 日");
    {
        let mut guard = st.game().unwrap();
        let g = guard.as_mut().unwrap();
        let a = g.session.world.state.agents.get_mut(&manifest_core::OwnerId::Player).unwrap();
        a.captain.as_mut().unwrap().sign = "lantern".into();
    }
    let p = handlers::overview(&st).unwrap().profile.unwrap();
    assert_eq!((p.sign.as_str(), p.sign_name.as_str()), ("lantern", "提灯座"));
    assert!(handlers::prologue(&st).is_ok());
    set_language(&st, Locale::En);
    assert_eq!(handlers::overview(&st).unwrap().profile.unwrap().sign_name, "The Lantern");
}

#[test]
fn tavern_rumors_tell_where_the_prodigies_lodge_this_season() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path());
    handlers::new_game(&st, "newcomer", Some(12)).unwrap();
    let ports: Vec<u16> =
        handlers::static_data(&st).locations.iter().filter(|l| l.kind == "port").map(|l| l.id).collect();
    let mut heard = 0;
    for _season in 0..3 {
        // 奇才这一季实际落脚的港口
        let lodging: Vec<(String, u16)> = {
            let guard = st.game().unwrap();
            let g = guard.as_ref().unwrap();
            let w = &g.session.world;
            w.wandering_geniuses().into_iter().map(|(m, at)| (w.defs.mate(m).name.clone(), at.0)).collect()
        };
        assert_eq!(lodging.len(), 3, "卡里姆、艾瑟琳、沈知微没有受雇");
        for &loc in &ports {
            let a = handlers::port(&st, loc).unwrap().genius_rumor;
            // 同一季里不变
            assert_eq!(handlers::port(&st, loc).unwrap().genius_rumor, a);
            if let Some(r) = a {
                heard += 1;
                assert_ne!(r.loc, loc, "传闻说的是别处的奇才");
                assert!(lodging.contains(&(r.name.clone(), r.loc)), "传闻与实际一致：{r:?}");
                assert!(!r.methods.is_empty());
            }
        }
        handlers::step(&st, 90).unwrap();
    }
    // 大约三分之一的酒馆有传闻
    let total = ports.len() * 3;
    assert!(heard * 6 > total && heard * 3 < total * 2, "{heard}/{total}");
}
