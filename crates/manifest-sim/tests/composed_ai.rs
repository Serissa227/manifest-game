//! 组合事件（EXPANSION §7）接入游戏会话：非法提案在解析或裁决阶段被拒绝且世界不变；
//! 裁决器看不到的局势（进行中的效果）由内核拒绝；Mock AI 长期运行后关闭 AI 重放一致；缓存与预算。
//! 全部使用 Mock LLM，不访问任何真实服务。

mod common;

use manifest_ai::pipeline::ProposalSource;
use manifest_ai::{AiMode, AiPipeline, AiSettings, MockLlm, Provider, TaskRequest};
use manifest_core::Command;
use manifest_core::SaveFile;
use manifest_core::composed::ComposedSource;
use manifest_core::ids::ScenarioId;
use manifest_core::replay::Source;
use manifest_sim::{AiDriver, Bot, BotKind, GameSession};
use std::sync::OnceLock;

/// 第 200 天的存档（没有 AI，玩家不行动）。
fn base() -> GameSession {
    static SAVE: OnceLock<SaveFile> = OnceLock::new();
    let save = SAVE.get_or_init(|| {
        let mut s = GameSession::new(common::defs(), ScenarioId(0), 23).unwrap();
        for _ in 0..200 {
            s.advance_day().unwrap();
        }
        s.to_save()
    });
    GameSession::from_save(common::defs(), save.clone()).unwrap()
}

fn scripted(outputs: &[String]) -> AiDriver {
    let settings = AiSettings { mode: AiMode::Mock, ..AiSettings::default() };
    let provider = Provider::Mock(MockLlm::scripted(outputs.to_vec()));
    AiDriver::new(AiPipeline::new(common::ai_content(), &settings, Some(provider))).unwrap()
}

fn schedule_and_advance(s: &mut GameSession, cmds: Vec<Command>) -> String {
    let tick = s.day() + 1;
    for c in cmds {
        s.schedule(tick, Source::Ai, c);
    }
    s.advance_day().unwrap();
    s.world.state_hash()
}

struct Keys {
    port: String,
    traded: String,
    not_traded: String,
    region: String,
    fa: String,
    fb: String,
}

fn keys(s: &GameSession) -> Keys {
    let d = &s.world.defs;
    let home = s.world.state.agents[&manifest_core::ids::OwnerId::Player].home;
    let loc = d.loc(home);
    let r = s
        .world
        .state
        .relations
        .iter()
        .find(|r| matches!(r.status, manifest_core::diplomacy::DiploStatus::Peace))
        .expect("应有和平的势力对");
    Keys {
        port: loc.key.clone(),
        traded: d.good(loc.market[0].good).key.clone(),
        not_traded: d
            .good_ids()
            .find(|g| !loc.market.iter().any(|m| m.good == *g))
            .map(|g| d.good(g).key.clone())
            .unwrap(),
        region: d.regions[0].key.clone(),
        fa: d.faction(r.a).key.clone(),
        fb: d.faction(r.b).key.clone(),
    }
}

fn event(effects: serde_json::Value) -> String {
    serde_json::json!({"title": "港口传闻", "narrative": "据港务厅档案记载，码头上的消息传得飞快。", "effects": effects}).to_string()
}

/// 非法的组合事件：在解析或裁决阶段被拒绝，推进一天后世界与不接受任何 AI 命令的对照组一致。
#[test]
fn illegal_composed_proposals_are_rejected_and_state_is_unchanged() {
    let control = {
        let mut s = base();
        schedule_and_advance(&mut s, Vec::new())
    };
    let s0 = base();
    let k = keys(&s0);
    let port = &k.port;
    let cases: Vec<(&str, &str, String)> = vec![
        // 解析阶段：结构不符（未知字段、未知效果、缺参数、类型错误、夹带给钱）
        (
            "额外的给钱字段",
            "解析",
            serde_json::json!({"title": "t", "narrative": "n", "effects": [], "grant_money": 100000}).to_string(),
        ),
        (
            "效果里夹带现金",
            "解析",
            event(
                serde_json::json!([{"effect": "location_supply", "loc": port, "mult": 0.8, "days": 30, "cash": 5000}]),
            ),
        ),
        ("未知效果", "解析", event(serde_json::json!([{"effect": "gold_rain", "mult": 2.0, "days": 10}]))),
        ("缺少参数", "解析", event(serde_json::json!([{"effect": "location_supply", "loc": port, "mult": 0.8}]))),
        (
            "参数类型错误",
            "解析",
            event(serde_json::json!([{"effect": "location_supply", "loc": port, "mult": "big", "days": 30}])),
        ),
        ("不是 JSON", "解析", "今年风平浪静。".into()),
        // 裁决阶段：越界、未知 key、当地不交易、预算、重复、外交前提、文字
        (
            "系数越界",
            "裁决",
            event(serde_json::json!([{"effect": "location_supply", "loc": port, "mult": 0.1, "days": 30}])),
        ),
        (
            "天数越界",
            "裁决",
            event(serde_json::json!([{"effect": "region_storm", "region": k.region, "mult": 1.5, "days": 900}])),
        ),
        (
            "不存在的地点",
            "裁决",
            event(serde_json::json!([{"effect": "location_supply", "loc": "atlantis", "mult": 0.8, "days": 30}])),
        ),
        (
            "不存在的商品",
            "裁决",
            event(serde_json::json!([{"effect": "good_supply", "good": "unobtainium", "mult": 0.8, "days": 30}])),
        ),
        (
            "当地不交易该商品",
            "裁决",
            event(
                serde_json::json!([{"effect": "supply_shift", "loc": port, "good": k.not_traded, "mult": 1.3, "days": 30}]),
            ),
        ),
        (
            "超出总强度预算",
            "裁决",
            event(serde_json::json!([
                {"effect": "supply_shift", "loc": port, "good": k.traded, "mult": 1.8, "days": 30},
                {"effect": "region_pirates", "region": k.region, "mult": 2.5, "days": 30},
            ])),
        ),
        (
            "同一目标重复",
            "裁决",
            event(serde_json::json!([
                {"effect": "location_supply", "loc": port, "mult": 0.9, "days": 30},
                {"effect": "location_supply", "loc": port, "mult": 0.8, "days": 20},
            ])),
        ),
        (
            "和平状态下关系剧烈恶化",
            "裁决",
            event(
                serde_json::json!([{"effect": "relation_shift", "faction_a": k.fa, "faction_b": k.fb, "delta": -25}]),
            ),
        ),
        ("没有效果", "裁决", event(serde_json::json!([]))),
        (
            "叙事夹带链接",
            "裁决",
            serde_json::json!({"title": "t", "narrative": "详见 https://example.com",
                "effects": [{"effect": "interest_shift", "mult": 1.1, "days": 30}]})
            .to_string(),
        ),
    ];
    assert!(cases.len() >= 10);
    for (name, stage, raw) in cases {
        let mut s = base();
        let before = s.world.state_hash();
        let driver = scripted(&[raw]);
        let (outcome, cmds) = driver.run_request(&s.world, TaskRequest::Composed);
        let outcome = outcome.unwrap_or_else(|| panic!("{name}：任务应能准备"));
        assert_eq!(outcome.source, Some(ProposalSource::Llm), "{name}");
        assert!(cmds.is_empty(), "{name}：非法提案不应产生命令：{cmds:?}");
        let audit = driver.pipeline().audit_log();
        let hit = |st: &str, mark: &str| audit.iter().any(|a| a.stage == st && a.detail.contains(mark));
        let ok = match stage {
            "解析" => hit("解析", "丢弃") && outcome.verdict.is_none(),
            _ => hit("裁决", "Reject") && outcome.accepted().is_none(),
        };
        assert!(ok, "{name}：应在“{stage}”阶段被拒绝\n{audit:?}");
        assert_eq!(s.world.state_hash(), before, "{name}");
        assert_eq!(schedule_and_advance(&mut s, cmds), control, "{name}：状态应与对照组一致");
    }
}

/// 合法的组合事件改变世界；裁决器看不到的局势（同一目标上仍在进行的效果）由内核拒绝。
#[test]
fn legal_composed_event_applies_and_kernel_blocks_stacking() {
    let mut s = base();
    let k = keys(&s);
    let raw = event(serde_json::json!([
        {"effect": "location_supply", "loc": k.port, "mult": 0.8, "days": 40},
        {"effect": "demand_shift", "loc": k.port, "good": k.traded, "mult": 1.3, "days": 20},
    ]));
    let driver = scripted(&[raw.clone(), raw]);
    let (_, cmds) = driver.run_request(&s.world, TaskRequest::Composed);
    assert_eq!(cmds.len(), 1, "{:?}", driver.pipeline().audit_log());
    assert!(matches!(&cmds[0], Command::ApplyComposedEvent { source: ComposedSource::Model, .. }));
    // 开局 200 天里可能已有规则触发的势力政策（也记为组合事件）：只看这一天多了一条（开放市场之后种子 23 就有一条，见 DECISIONS）
    let before = s.world.state.events.composed.len();
    schedule_and_advance(&mut s, cmds);
    assert_eq!(s.world.state.events.composed.len(), before + 1);
    assert_eq!(s.world.state.events.composed.last().map(|r| r.source), Some(ComposedSource::Model));
    assert!(s.world.state.events.active.iter().any(|e| !e.origin.is_catalog()));
    // 冷却期内不准备任务（不消耗预算）
    assert!(driver.run_request(&s.world, TaskRequest::Composed).0.is_none());
    for _ in 0..15 {
        s.advance_day().unwrap();
    }
    // 冷却已过，但同一港口的“当地生产”效果仍在进行：裁决器接受，内核拒绝
    let (outcome, cmds) = driver.run_request(&s.world, TaskRequest::Composed);
    assert!(outcome.unwrap().accepted().is_some());
    assert!(cmds.is_empty());
    assert!(driver.pipeline().audit_log().iter().any(|a| a.stage == "内核校验" && a.detail.contains("进行中")));
}

/// 缓存与预算对组合事件同样生效。
#[test]
fn composed_events_use_cache_and_budget() {
    let s = base();
    let settings = AiSettings { mode: AiMode::Mock, ..AiSettings::default() };
    let driver =
        AiDriver::new(AiPipeline::new(common::ai_content(), &settings, Some(Provider::Mock(MockLlm::plausible()))))
            .unwrap();
    let a = driver.run_request(&s.world, TaskRequest::Composed);
    let b = driver.run_request(&s.world, TaskRequest::Composed);
    assert_eq!(a.0.unwrap().source, Some(ProposalSource::Llm));
    assert_eq!(b.0.unwrap().source, Some(ProposalSource::Cache));
    assert_eq!(driver.pipeline().budget(s.day()).calls_used, 1);
    assert_eq!(a.1, b.1, "缓存的结果转为同样的命令");
    assert!(matches!(a.1.as_slice(), [Command::ApplyComposedEvent { source: ComposedSource::Model, .. }]));

    let settings = AiSettings { mode: AiMode::Mock, monthly_calls: 0, ..AiSettings::default() };
    let driver =
        AiDriver::new(AiPipeline::new(common::ai_content(), &settings, Some(Provider::Mock(MockLlm::plausible()))))
            .unwrap();
    let (outcome, cmds) = driver.run_request(&s.world, TaskRequest::Composed);
    assert_eq!(outcome.unwrap().source, Some(ProposalSource::Offline));
    assert!(matches!(cmds.as_slice(), [Command::ApplyComposedEvent { source: ComposedSource::Template, .. }]));
    assert_eq!(driver.pipeline().budget(s.day()).calls_used, 0);
}

/// 730 天 Mock AI：组合事件按日程发生（冷却与年度上限内），关闭 AI 只用日志重放，状态哈希一致。
#[test]
fn composed_events_over_730_mock_days_replay_identically() {
    let driver = AiDriver::with_mode(common::ai_content(), AiMode::Mock).unwrap().unwrap();
    let mut s = GameSession::new(common::defs(), ScenarioId(0), 31).unwrap();
    let mut bot = Bot::new(BotKind::Passive);
    for _ in 0..730 {
        bot.act(&mut s);
        s.advance_day().unwrap();
        driver.run_due(&mut s);
    }
    let composed: Vec<&Command> = s
        .log()
        .iter()
        .filter(|e| e.source == Source::Ai)
        .map(|e| &e.command)
        .filter(|c| matches!(c, Command::ApplyComposedEvent { .. }))
        .collect();
    assert!(composed.len() >= 20, "两年里应有不少组合事件，实际 {}", composed.len());
    let rules = &s.world.defs.composed;
    assert!(composed.len() as u32 <= rules.max_per_year * 2 + 1);
    // 已执行的组合事件都留下了记录，且最多 max_per_year 个 / 年（规则触发的势力政策也是组合事件，但不占这个上限——第八批 E7）
    let records: Vec<_> = s
        .world
        .state
        .events
        .composed
        .iter()
        .filter(|r| r.source != manifest_core::composed::ComposedSource::Rule)
        .collect();
    assert!(!records.is_empty());
    for year in 0..2 {
        let n = records.iter().filter(|r| r.day / 360 == year).count() as u32;
        assert!(n <= rules.max_per_year, "第 {year} 年有 {n} 个组合事件");
    }
    manifest_core::testkit::check_invariants(&s.world).unwrap();
    assert!(s.world.money_conserved());
    let original = s.world.state_hash();
    assert_eq!(s.replay().unwrap().state_hash(), original);
}
