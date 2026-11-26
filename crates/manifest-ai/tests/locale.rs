//! 多语言（EXPANSION.md §12.1）：提示词带写作语言与专名对照；离线模板生成的文字带模板位置，按英文重新格式化；
//! 离线组合事件找回模板位置后译成英文；世界状态与界面语言无关。全部用 Mock，不访问任何真实服务。

use manifest_ai::pipeline::{AiOutcome, offline_tpl_for};
use manifest_ai::resolve::resolve_composed_effect;
use manifest_ai::{AiMode, AiPipeline, AiSettings, MockLlm, Proposal, Provider, RuleAdjudicator, TaskRequest, offline};
use manifest_core::diplomacy::DiploStatus;
use manifest_core::ids::*;
use manifest_core::news::{Intent, NewsFact, NewsPlan, NewsSource, YearFacts};
use manifest_core::{Command, Fx, StaticData, World};
use manifest_data::{Locale, LocaleBundle};
use std::sync::{Arc, OnceLock};

fn defs() -> Arc<StaticData> {
    static DEFS: OnceLock<Arc<StaticData>> = OnceLock::new();
    DEFS.get_or_init(|| manifest_data::load_default().unwrap_or_else(|e| panic!("{e}"))).clone()
}

fn content() -> Arc<manifest_data::AiContent> {
    let dir = manifest_data::find_data_dir().unwrap();
    Arc::new(manifest_data::load_ai_content(&dir).unwrap())
}

fn bundle(l: Locale) -> Arc<LocaleBundle> {
    manifest_data::load_locale_shared(&manifest_data::find_data_dir().unwrap(), l).unwrap_or_else(|e| panic!("{e}"))
}

fn world(seed: u64) -> World {
    World::new(defs(), ScenarioId(0), seed).unwrap()
}

fn cjk(s: &str) -> bool {
    s.chars().any(|c| ('\u{4e00}'..='\u{9fff}').contains(&c) || ('\u{3000}'..='\u{303f}').contains(&c))
}

fn mock_pipeline(locale: Option<Locale>) -> AiPipeline {
    let settings = AiSettings { mode: AiMode::Mock, ..AiSettings::default() };
    let p = AiPipeline::new(content(), &settings, Some(Provider::Mock(MockLlm::plausible())));
    match locale {
        Some(l) => p.with_locale(bundle(Locale::ZhCn), bundle(l)),
        None => p,
    }
}

#[test]
fn prompts_carry_the_writing_language_and_a_glossary() {
    let w = world(5);
    // 英文界面：英文提示词，写明语言，附专名对照
    let en = mock_pipeline(Some(Locale::En));
    assert_eq!(en.locale(), Locale::En);
    let task = en.prepare(&w, TaskRequest::Composed).expect("组合事件任务");
    assert_eq!(task.vars["language"], "English");
    let (system, user) = en.prompt_text(&task);
    assert!(system.contains("Write the title and the narrative in English"), "{system}");
    assert!(user.contains("维拉马雷 = Villamare"), "专名对照：{user}");
    assert!(user.contains("金币 = gold"), "货币也在对照里：{user}");
    assert!(!user.contains("{glossary}") && !user.contains("{language}"), "变量都已填写");
    // Schema 不变：与中文提示词里的完全一样
    let zh = mock_pipeline(None);
    let zh_task = zh.prepare(&w, TaskRequest::Composed).unwrap();
    let (zh_system, zh_user) = zh.prompt_text(&zh_task);
    let schema = serde_json::to_string(&manifest_ai::output_schema(task.kind, &w.defs).schema).unwrap();
    assert!(user.contains(&schema) && zh_user.contains(&schema));
    // 中文界面：提示词与以前完全相同（不写英文、不带对照）
    assert!(!zh_system.contains("English") && zh_task.vars["glossary"].is_empty());
    assert_eq!(zh_task.vars["language"], "Simplified Chinese");
    let zh_again = mock_pipeline(Some(Locale::ZhCn)).prepare(&w, TaskRequest::Composed).unwrap();
    assert_eq!(mock_pipeline(Some(Locale::ZhCn)).prompt_text(&zh_again), (zh_system, zh_user));
    // 其他类型也带语言
    for req in [TaskRequest::Director, TaskRequest::Contract] {
        let t = en.prepare(&w, req).unwrap();
        let (s, _) = en.prompt_text(&t);
        assert!(s.contains("English"), "{:?}：{s}", t.kind);
    }
}

#[test]
fn offline_candidates_stay_chinese_so_the_world_does_not_depend_on_the_language() {
    // 离线备选（世界状态的来源）不随界面语言变化；英文只在显示时重新格式化
    let w = world(11);
    let zh = mock_pipeline(None);
    let en = mock_pipeline(Some(Locale::En));
    for req in [TaskRequest::Rumor, TaskRequest::Composed, TaskRequest::Contract, TaskRequest::Director] {
        let a = zh.prepare(&w, req.clone());
        let b = en.prepare(&w, req);
        assert_eq!(a.map(|t| (t.offline, t.offline_tpl)), b.map(|t| (t.offline, t.offline_tpl)));
    }
}

#[test]
fn offline_rumors_and_replies_render_in_english() {
    let w = world(3);
    let t = &content().templates;
    let (zh, en) = (bundle(Locale::ZhCn), bundle(Locale::En));
    let none = |_: &str| None;
    let d = &w.defs;
    let loc = d.find_loc("chenggang").unwrap();
    let good = d.find_good("grain").unwrap();
    let facts = [
        NewsFact::PriceHigh { loc, good },
        NewsFact::PriceLow { loc, good },
        NewsFact::Shortage { loc, good },
        NewsFact::Relation { a: FactionId(0), b: FactionId(2), status: DiploStatus::War },
        NewsFact::EventActive { event: EventTypeId(0) },
    ];
    for fact in facts {
        let plan = NewsPlan { fact, source: NewsSource::Tavern, credibility: 50, intended_truth: true };
        let (p, tpl) = offline::rumor_with_ref(&w, &plan, t);
        let tpl = tpl.expect("离线传闻带模板位置");
        // 中文按引用重新格式化与原文逐字相同；英文没有汉字、带英文名
        assert_eq!(zh.render(&tpl, &none).as_deref(), Some(p.text.as_str()));
        let text = en.render(&tpl, &none).unwrap();
        assert!(!cjk(&text), "{text}");
        assert_eq!(p, offline::rumor(&w, &plan, t), "与原来的离线传闻相同");
        match plan.fact {
            NewsFact::Relation { .. } => assert!(text.contains("Kingdom of Esperan") && text.contains("war"), "{text}"),
            NewsFact::EventActive { .. } => assert!(text.contains(&en.defs.events[0].name), "{text}"),
            _ => assert!(text.contains("Villamare") && text.contains("Grain"), "{text}"),
        }
    }
    for intent in [Intent::Discount, Intent::Threat, Intent::Bribe, Intent::Rapport, Intent::Irrelevant] {
        let (p, tpl) = offline::bargain_with_ref(&w, intent, Fx::from_bp(350), loc, t);
        let tpl = tpl.unwrap();
        assert_eq!(zh.render(&tpl, &none).as_deref(), Some(p.reply.as_str()));
        let text = en.render(&tpl, &none).unwrap();
        assert!(!cjk(&text), "{text}");
        if intent != Intent::Irrelevant {
            assert!(text.contains("3.5%"), "{text}");
        }
    }
}

#[test]
fn offline_chronicles_render_in_english() {
    let w = world(7);
    let t = &content().templates;
    let (zh, en) = (bundle(Locale::ZhCn), bundle(Locale::En));
    let none = |_: &str| None;
    let facts = YearFacts {
        year: 0,
        events: vec![EventTypeId(0), EventTypeId(0), EventTypeId(2)],
        wars: vec![(FactionId(0), FactionId(2))],
        bankrupt: vec![OwnerId::Company(CompanyId(1))],
        richest: Some(OwnerId::Player),
        player_net_worth: 123_456,
        composed: vec![],
    };
    let (p, tpl) = offline::chronicle_with_ref(&w, &facts, t);
    let tpl = tpl.expect("离线编年史带模板位置");
    assert_eq!(tpl.parts.len(), 5, "开篇、事件、战事、破产、结语");
    assert_eq!(zh.render(&tpl, &none).as_deref(), Some(p.text.as_str()), "中文逐字相同");
    let text = en.render(&tpl, &none).unwrap();
    assert!(!cjk(&text), "{text}");
    assert!(text.contains("1502") && text.contains("123,456 gold") && text.contains("your trading house"), "{text}");
    assert!(text.contains("the Kingdom of Esperan and the Sultanate of Qadir"), "{text}");
    // 平静的一年：没有事件、没有最富有者
    let quiet = YearFacts { year: 1, player_net_worth: 5, ..YearFacts::default() };
    let (q, tpl) = offline::chronicle_with_ref(&w, &quiet, t);
    let tpl = tpl.unwrap();
    assert_eq!(zh.render(&tpl, &none).as_deref(), Some(q.text.as_str()));
    let text = en.render(&tpl, &none).unwrap();
    assert!(text.contains("nothing of note") && text.contains("no one") && text.contains("1503"), "{text}");
}

#[test]
fn offline_composed_events_are_recovered_and_translated() {
    let t = &content().templates;
    let (zh, en) = (bundle(Locale::ZhCn), bundle(Locale::En));
    let mut seen = std::collections::BTreeSet::new();
    for seed in 0..60u64 {
        let mut w = world(seed);
        let Some(p) = offline::composed(&w, t) else { continue };
        let effects: Vec<_> = p.effects.iter().map(|e| resolve_composed_effect(&w.defs, e).unwrap()).collect();
        let cmd = Command::ApplyComposedEvent {
            title: p.title.clone(),
            text: p.narrative.clone(),
            effects,
            source: manifest_core::composed::ComposedSource::Template,
        };
        // 命令在下一天执行（与会话排期一致）
        w.end_day().unwrap();
        if cmd.apply(&mut w).is_err() {
            continue;
        }
        let rec = w.state.events.composed.last().unwrap().clone();
        let back = manifest_data::locale::localize_composed(&zh, &zh, &rec, None).expect("中文找回自身");
        assert_eq!((back.title.as_str(), back.text.as_str()), (rec.title.as_str(), rec.text.as_str()));
        let out = manifest_data::locale::localize_composed(&zh, &en, &rec, None).expect("找回模板位置");
        assert!(!cjk(&out.title) && !cjk(&out.text), "{} / {}", out.title, out.text);
        assert!(out.text.len() > 20);
        seen.insert(rec.title.clone());
    }
    assert!(seen.len() >= 5, "应覆盖多种原型：{seen:?}");
    // 模型写的事件对不上任何模板：显示原文
    let mut w = world(1);
    let p = offline::composed(&w, t).unwrap();
    let effects: Vec<_> = p.effects.iter().map(|e| resolve_composed_effect(&w.defs, e).unwrap()).collect();
    w.end_day().unwrap();
    let cmd = Command::ApplyComposedEvent {
        title: "雾中的来客".into(),
        text: "一艘挂着陌生旗帜的船驶入港口，带来了远方的消息。".into(),
        effects,
        source: manifest_core::composed::ComposedSource::Model,
    };
    cmd.apply(&mut w).unwrap();
    let rec = w.state.events.composed.last().unwrap();
    assert!(manifest_data::locale::localize_composed(&zh, &en, rec, None).is_none());
}

#[test]
fn template_refs_follow_the_accepted_text() {
    // Mock 照抄离线备选：命令带模板位置；模型改写了文字：不带
    let w = world(4);
    let p = mock_pipeline(Some(Locale::En));
    let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
    let mut day_world = w.clone();
    let task = loop {
        if let Some(t) = p.prepare(&day_world, TaskRequest::Rumor) {
            break t;
        }
        day_world.end_day().unwrap();
    };
    let outcome: AiOutcome = rt.block_on(p.process(task));
    let cmds = p.finalize(&day_world, &outcome);
    match cmds.as_slice() {
        [Command::PublishNews { text, tpl: Some(tpl), .. }] => {
            assert_eq!(Some(tpl.clone()), offline_tpl_for(&outcome, text));
        }
        other => panic!("应得到一条带模板位置的传闻：{other:?}"),
    }
    let Some(Proposal::Rumor(r)) = &outcome.task.offline else { panic!() };
    assert!(offline_tpl_for(&outcome, &format!("{}!", r.text)).is_none(), "文字不同时没有模板位置");
    // 带模板位置的命令照常序列化；旧命令（没有这个字段）照常读取
    let json = serde_json::to_string(&cmds[0]).unwrap();
    assert!(json.contains("\"tpl\""));
    let old = json.replace(&json[json.find(",\"tpl\"").unwrap()..json.len() - 2], "");
    let back: Command = serde_json::from_str(&old).unwrap();
    assert!(matches!(back, Command::PublishNews { tpl: None, .. }));
}

#[test]
fn english_haggling_is_classified() {
    let a = RuleAdjudicator::default();
    assert_eq!(a.classify_intent("Come on, give me a discount, it's too expensive!").0, Intent::Discount);
    assert_eq!(a.classify_intent("Lower the price, or else you'll regret it.").0, Intent::Threat);
    assert_eq!(a.classify_intent("Here's a little something for your trouble.").0, Intent::Bribe);
    assert_eq!(a.classify_intent("We're old friends, aren't we?").0, Intent::Rapport);
    assert_eq!(a.classify_intent("Nice weather today.").0, Intent::Irrelevant);
    // 中文照旧
    assert_eq!(a.classify_intent("便宜点吧").0, Intent::Discount);
}

#[test]
fn oversized_template_refs_are_dropped_instead_of_rejecting_the_command() {
    // 引用只用于显示：超出内核规模上限时不随命令保存（命令照常执行，显示中文原文），不能让命令被拒绝
    let w = world(4);
    let p = mock_pipeline(Some(Locale::En));
    let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
    let mut day_world = w.clone();
    let task = loop {
        if let Some(t) = p.prepare(&day_world, TaskRequest::Rumor) {
            break t;
        }
        day_world.end_day().unwrap();
    };
    let mut outcome: AiOutcome = rt.block_on(p.process(task));
    let Some(Proposal::Rumor(r)) = outcome.task.offline.clone() else { panic!("离线传闻") };
    let tpl = outcome.task.offline_tpl.clone().expect("离线传闻带模板位置");
    let huge = manifest_core::TextArg::List((0..200).map(manifest_core::TextArg::Int).collect());
    outcome.task.offline_tpl = Some(tpl.with("events", huge));
    assert!(outcome.task.offline_tpl.as_ref().unwrap().check().is_err(), "样例引用应超出上限");
    assert!(offline_tpl_for(&outcome, &r.text).is_none(), "超限的引用不保存");
    let cmds = p.finalize(&day_world, &outcome);
    let [cmd @ Command::PublishNews { tpl: None, .. }] = cmds.as_slice() else { panic!("{cmds:?}") };
    let mut after = day_world.clone();
    cmd.apply(&mut after).expect("命令照常执行");
    assert_eq!(after.state.news.news.last().map(|n| n.text.as_str()), Some(r.text.as_str()));
}
