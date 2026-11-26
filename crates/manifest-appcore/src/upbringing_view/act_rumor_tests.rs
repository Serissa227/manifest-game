//! R10-K3R1：自造卡片穷举语言覆盖与遮名，不依赖正式见闻卡的数量。
use super::*;
use manifest_core::defs::{DiscoveryDef, DiscoveryKind};
use manifest_data::{
    Locale,
    worlds::{EffectiveFile, FileMode},
};
use std::sync::Arc;

#[test]
fn rumor_text_truth_table() {
    const SOURCE: &str = "upbringing/rumors/k3r1.toml";
    struct Case {
        key: String,
        body: bool,
        cover: bool,
        stale: bool,
        hidden: bool,
    }
    let root = manifest_data::find_data_dir().expect("data");
    let mut source = manifest_data::resolve_world(&root, "testbed").expect("testbed");
    let ai = manifest_data::ai_content::load_world_ai_content(&source).expect("ai");
    let mut defs = (*manifest_data::load_world(&root, "testbed").expect("defs")).clone();
    defs.rules.upbringing.act = Some(ActRules { enabled: true, stages: vec!["rumors".into()], ..Default::default() });
    defs.manual_navigation = true;
    defs.navigation.hide_unknown_ports = true;
    defs.discoveries = vec![DiscoveryDef {
        key: "fixture_hidden".into(),
        name: "fixture_hidden".into(),
        cell: defs.locations[0].cell,
        kind: DiscoveryKind::ALL[0],
        fame: 0,
        value: Default::default(),
        lore: String::new(),
    }];
    defs.upbringing.act_rumors.clear();
    let mut cases = Vec::new();
    let mut gemini = String::new();
    let mut english = String::new();
    for body in [false, true] {
        for cover in [false, true] {
            for stale in [false, true] {
                for hidden in [false, true] {
                    let key = format!("fixture_{body}_{cover}_{stale}_{hidden}");
                    let suffix = if hidden { " fixture_hidden" } else { "" };
                    let text = format!("fixture_base{suffix}");
                    defs.upbringing.act_rumors.push(ActRumorDef {
                        source: SOURCE.into(),
                        key: key.clone(),
                        heard: vec![defs.locations[0].key.clone()],
                        port: defs.locations[0].key.clone(),
                        good: String::new(),
                        kind: "demand".into(),
                        valid: [[1550, 1, 1], if stale { [1550, 1, 1] } else { [1600, 1, 1] }],
                        heard_from: None,
                        person: String::new(),
                        text: body.then_some(text.clone()),
                    });
                    if cover {
                        let id = json!([SOURCE, ["act_rumors", &key, "text"], null]).to_string();
                        let hash = if stale {
                            "blake3:stale".into()
                        } else {
                            format!("blake3:{}", blake3::hash(text.as_bytes()))
                        };
                        gemini.push_str(&format!(
                            "[entries.{}]\nsrc = {}\ntext = {}\n",
                            json!(id),
                            json!(hash),
                            json!(format!("fixture_gemini{suffix}"))
                        ));
                        english.push_str(&format!(
                            "[act_rumors.{key}]\ntext = {}\n",
                            json!(format!("fixture_en{suffix}"))
                        ));
                    }
                    cases.push(Case { key, body, cover, stale, hidden });
                }
            }
        }
    }
    let mut unheard = defs.upbringing.act_rumors[0].clone();
    unheard.key = "fixture_unheard".into();
    unheard.text = Some("fixture_unheard_body".into());
    defs.upbringing.act_rumors.push(unheard.clone());
    let mut blank = unheard;
    blank.key = "fixture_blank".into();
    blank.text = Some(" \n ".into());
    defs.upbringing.act_rumors.push(blank);

    // 只有本测试的两份覆盖落到临时目录；运行真实语言加载器过滤过期与孤立覆盖。
    let fixture = std::env::temp_dir().join(format!("manifest-k3r1-{}", std::process::id()));
    std::fs::create_dir_all(&fixture).expect("fixture directory");
    source.files.retain(|key, _| !key.starts_with("locales/"));
    for (language, text) in [("zh-gemini", gemini), ("en", english)] {
        let path = fixture.join(format!("{language}.toml"));
        std::fs::write(&path, text).expect("overlay");
        source.files.insert(
            format!("locales/{language}/{SOURCE}"),
            EffectiveFile { sources: vec![path], mode: FileMode::Replace },
        );
    }
    let defs = Arc::new(defs);
    let mut w = World::new(defs.clone(), defs.find_scenario("upbringing").expect("scenario"), 42).expect("world");
    let s = w.state.upbringing.as_mut().expect("upbringing");
    s.act.on = true;
    s.act.phase = ActPhase::Summary;
    s.act.rumors = cases.iter().map(|case| (case.key.clone(), 0)).collect();
    s.act.rumors.insert("fixture_blank".into(), 0);
    s.act.rumors.insert("fixture_removed".into(), 0);
    s.act.last_week = Some(WeekSummary {
        k3: WeekK3 { rumors: vec![cases[0].key.clone(), "fixture_removed".into()], ..Default::default() },
        ..Default::default()
    });
    let before = w.state.clone();
    let zh = manifest_data::locale::load_world_locale(&source, Locale::ZhCn, &defs, &ai);
    let en = manifest_data::locale::load_world_locale(&source, Locale::En, &defs, &ai);
    let gemini = manifest_data::locale::load_world_locale(&source, Locale::ZhCnGemini, &defs, &ai);
    assert_eq!(gemini.variant_coverage.entries, 2);
    assert_eq!(gemini.variant_coverage.stale, 2);
    println!("body | language | cover | stale | hidden | text");
    let mut rows = 0;
    for current in [&zh, &gemini, &en] {
        let ctx = Ctx::of(current, &zh, &en);
        let mut value = json!({});
        fill_k3(ctx, &w, &mut value);
        let cards = value["rumors"]["cards"].as_array().expect("cards");
        assert_eq!(cards.len(), cases.len() + 1);
        for case in &cases {
            let card = cards.iter().find(|card| card["key"] == case.key).expect("heard card");
            let prefix = match (current.locale, case.cover, case.stale) {
                (Locale::ZhCnGemini, true, false) => "fixture_gemini",
                (Locale::En, true, _) => "fixture_en",
                _ => "fixture_base",
            };
            let expected = case.body.then(|| {
                if case.hidden {
                    format!(
                        "{prefix} {}",
                        if current.locale == Locale::En { "Unknown discovery" } else { "未知发现物" }
                    )
                } else {
                    prefix.into()
                }
            });
            println!(
                "{} | {} | {} | {} | {} | {:?}",
                case.body,
                current.locale.code(),
                case.cover,
                case.stale,
                case.hidden,
                card.get("text")
            );
            assert_eq!(card.get("text").and_then(Value::as_str), expected.as_deref());
            assert_eq!(card.get("text").is_some(), case.body);
            assert_eq!(card.as_object().expect("card object").len(), 7 + usize::from(case.body));
            assert_eq!(card["port"], defs.locations[0].key);
            assert_eq!(card["kind"], "demand");
            assert_eq!(card["good"], Value::Null);
            assert_eq!(card["week"], 0);
            assert_eq!(card["expired"], case.stale);
            rows += 1;
        }
        assert!(cards.iter().find(|c| c["key"] == "fixture_blank").expect("blank card").get("text").is_none());
        assert!(!cards.iter().any(|c| c["key"] == "fixture_unheard" || c["key"] == "fixture_removed"));
        // 删卡仍有小结键引用供前端给泛称；不补造空正文或港货信息。
        assert_eq!(value["summary_k3"]["rumors"], json!([cases[0].key, "fixture_removed"]));
        assert!(texts(ctx).unwrap_or_default().keys().all(|key| !key.starts_with("act:rumor:")));
    }
    assert_eq!(rows, 48);
    assert_eq!(w.state, before);
    std::fs::remove_file(fixture.join("zh-gemini.toml")).expect("remove Gemini fixture");
    std::fs::remove_file(fixture.join("en.toml")).expect("remove English fixture");
    std::fs::remove_dir(fixture).expect("remove fixture directory");
}
