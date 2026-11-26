//! 第 10 节测试 2（重放）、7（AI 安全）、9（离线降级）、11（密钥），使用真实 data/。
//! 全部使用 Mock LLM 或 wiremock，不访问任何真实的 LLM 服务。

mod common;

use manifest_ai::pipeline::ProposalSource;
use manifest_ai::{
    AiMode, AiOutcome, AiPipeline, AiSettings, AuditEntry, HttpProvider, MockLlm, Provider, ProviderConfig, Secret,
    TaskRequest,
};
use manifest_core::Command;
use manifest_core::SaveFile;
use manifest_core::ids::{CompanyId, OwnerId, ScenarioId};
use manifest_core::replay::Source;
use manifest_data::ProposalKind;
use manifest_sim::{AiDriver, Bot, BotKind, GameSession, storage};
use std::sync::OnceLock;

/// 第一年结束后（第 365 天）的存档，供各测试复用。玩家不行动（舰队停在母港，便于议价）。
fn year_one() -> GameSession {
    static SAVE: OnceLock<SaveFile> = OnceLock::new();
    let save = SAVE.get_or_init(|| {
        let mut s = GameSession::new(common::defs(), ScenarioId(0), 11).unwrap();
        let mut bot = Bot::new(BotKind::Passive);
        for _ in 0..365 {
            bot.act(&mut s);
            s.advance_day().unwrap();
        }
        s.to_save()
    });
    GameSession::from_save(common::defs(), save.clone()).unwrap()
}

fn pipeline_with(mode: AiMode, provider: Option<Provider>) -> AiDriver {
    let settings = AiSettings { mode, ..AiSettings::default() };
    AiDriver::new(AiPipeline::new(common::ai_content(), &settings, provider)).unwrap()
}

fn scripted(outputs: &[&str]) -> AiDriver {
    let outputs = outputs.iter().map(|s| s.to_string()).collect();
    pipeline_with(AiMode::Mock, Some(Provider::Mock(MockLlm::scripted(outputs))))
}

/// 把 AI 产出的命令排到下一个 tick 并推进一天；返回推进后的状态哈希。
fn schedule_and_advance(session: &mut GameSession, cmds: Vec<Command>) -> String {
    let tick = session.day() + 1;
    for c in cmds {
        session.schedule(tick, Source::Ai, c);
    }
    session.advance_day().unwrap();
    session.world.state_hash()
}

/// 对照组：同一局面不接受任何 AI 命令，推进一天后的状态哈希。
fn control_hash() -> String {
    let mut s = year_one();
    schedule_and_advance(&mut s, Vec::new())
}

fn stages(audit: &[AuditEntry]) -> String {
    audit.iter().map(|a| format!("[{}] {}", a.stage, a.detail)).collect::<Vec<_>>().join("\n")
}

fn first_company(session: &GameSession) -> CompanyId {
    session
        .world
        .state
        .agents
        .iter()
        .find_map(|(o, a)| match o {
            OwnerId::Company(c) if !a.bankrupt && a.strategy.is_some() => Some(*c),
            _ => None,
        })
        .unwrap()
}

// ───────────────────────────── 测试 2 ─────────────────────────────

/// 测试 2：开启 Mock AI 运行 730 天，再关闭 AI 只用命令日志重放，状态哈希一致；
/// 存档后读档继续也一致（读档不重新调用 AI）。
#[test]
fn test2_replay_with_mock_ai_off_matches_original() {
    let driver = AiDriver::with_mode(common::ai_content(), AiMode::Mock).unwrap().unwrap();
    let mut s = GameSession::new(common::defs(), ScenarioId(0), 7).unwrap();
    let mut bot = Bot::new(BotKind::Arbitrage);
    let mut ai_cmds = 0;
    for _ in 0..730 {
        bot.act(&mut s);
        s.advance_day().unwrap();
        ai_cmds += driver.run_due(&mut s);
    }
    let ai_logged = s.log().iter().filter(|e| e.source == Source::Ai).count();
    assert!(ai_cmds > 100, "两年中 AI 应产生大量命令，实际 {ai_cmds}");
    assert_eq!(ai_logged, ai_cmds, "被接受的 AI 命令在排期时即写入日志");
    // 各类 AI 命令都出现过
    let has = |f: fn(&Command) -> bool| s.log().iter().any(|e| e.source == Source::Ai && f(&e.command));
    assert!(has(|c| matches!(c, Command::ApplyEvent { .. })), "应有事件导演的事件");
    assert!(has(|c| matches!(c, Command::PublishNews { .. })), "应有传闻");
    assert!(has(|c| matches!(c, Command::AdjustStrategy { .. })), "应有商会战略");
    assert!(has(|c| matches!(c, Command::OfferContract { .. })), "应有委托合同");
    assert!(has(|c| matches!(c, Command::RecordChronicle { .. })), "应有编年史");
    assert!(has(|c| matches!(c, Command::ApplyComposedEvent { .. })), "应有组合事件");
    assert!(has(|c| matches!(c, Command::SetOutlook { .. })), "应有商会展望");
    assert!(has(|c| matches!(c, Command::RecordMarketReport { .. })), "应有市场月报");
    // Mock 的部分输出需要自动修复
    assert!(driver.pipeline().audit_log().iter().any(|a| a.stage == "解析" && a.detail.contains("自动修复")));

    // 关闭 AI，只读日志重放
    let original = s.world.state_hash();
    let replayed = s.replay().unwrap();
    assert_eq!(replayed.state_hash(), original);

    // 存档 → 读档 → 两边都在关闭 AI 的情况下再走 30 天（已排期的 AI 命令从日志恢复）
    let bytes = storage::encode(&s.to_save(), true).unwrap();
    let mut loaded = GameSession::from_save(common::defs(), storage::decode(&bytes).unwrap()).unwrap();
    assert_eq!(loaded.world.state_hash(), original);
    for _ in 0..30 {
        s.advance_day().unwrap();
        loaded.advance_day().unwrap();
    }
    assert_eq!(loaded.world.state_hash(), s.world.state_hash());
    assert_eq!(s.replay().unwrap().state_hash(), s.world.state_hash());
}

// ───────────────────────────── 测试 7 ─────────────────────────────

/// 一个非法提案案例：任务类型、Mock LLM 的原始输出、说明。
struct Case {
    name: &'static str,
    /// 应当在哪一关被拒绝：解析 / 裁决
    stage: &'static str,
    request: TaskRequest,
    raw: String,
}

/// 上个月有可写事实的一个海区（市场月报用）。
fn report_region(session: &GameSession) -> manifest_core::ids::RegionId {
    *session.world.report_regions().first().expect("上个月应有值得写的海区")
}

fn illegal_cases(session: &GameSession) -> Vec<Case> {
    let company = first_company(session);
    let region = report_region(session);
    let (fa, fb) = peaceful_pair(session);
    // 以离线模板的合法合同为基础改出越界版本
    let driver = pipeline_with(AiMode::Offline, None);
    let (contract, _) = driver.run_request(&session.world, TaskRequest::Contract);
    let contract = contract.and_then(|o| o.task.offline.clone()).expect("离线模板应能生成合同").body_json();
    let mut huge_reward = contract.clone();
    huge_reward["reward"] = serde_json::json!(contract["reward"].as_i64().unwrap() * 100);
    let mut tiny_reward = contract.clone();
    tiny_reward["reward"] = serde_json::json!(1);
    let mut pay_player = contract.clone();
    pay_player["pay_to_player"] = serde_json::json!(1_000_000);
    let mut negative_qty = contract.clone();
    negative_qty["qty"] = serde_json::json!(-500);
    let mut foreign_port = contract.clone();
    foreign_port["to"] = serde_json::json!("no_such_port");

    let c = |name, stage, request, raw: String| Case { name, stage, request, raw };
    vec![
        // 凭空给钱
        c("导演：额外的给钱字段", "解析", TaskRequest::Director, r#"{"events":[],"grant_money":1000000}"#.into()),
        c(
            "导演：事件参数里夹带给钱字段", "解析",
            TaskRequest::Director,
            r#"{"events":[{"event":"bumper_harvest","params":{"loc":"chenggang","good":"grain","mult":1.3,"days":40,"cash":99999}}]}"#.into(),
        ),
        c("合同：额外的付款字段", "解析", TaskRequest::Contract, pay_player.to_string()),
        c(
            "战略：额外的现金字段", "解析",
            TaskRequest::Strategy { company },
            r#"{"risk":0.5,"preferred":[],"memo":"","cash":100000000}"#.into(),
        ),
        c("议价：额外的折扣字段", "解析", bargain_request(session), r#"{"reply":"好说好说。","discount":0.9}"#.into()),
        // 参数越界
        c(
            "导演：系数越界", "裁决",
            TaskRequest::Director,
            r#"{"events":[{"event":"storm_season","params":{"region":"frost_west","mult":9.0,"days":60}}]}"#.into(),
        ),
        c(
            "导演：天数越界", "裁决",
            TaskRequest::Director,
            r#"{"events":[{"event":"storm_season","params":{"region":"frost_west","mult":2.0,"days":9999}}]}"#.into(),
        ),
        c(
            "导演：一次超过 3 个事件", "裁决",
            TaskRequest::Director,
            r#"{"events":[{"event":"festival"},{"event":"plague"},{"event":"trade_boom"},{"event":"harbor_fire"}]}"#.into(),
        ),
        c(
            "导演：和平状态下直接出现战争风声", "裁决",
            TaskRequest::Director,
            serde_json::json!({"events": [{"event": "war_scare", "params": {"faction_a": fa, "faction_b": fb, "delta": -30}}]})
                .to_string(),
        ),
        c(
            "导演：不存在的地点", "裁决",
            TaskRequest::Director,
            r#"{"events":[{"event":"bumper_harvest","params":{"loc":"atlantis","good":"grain","mult":1.3,"days":40}}]}"#.into(),
        ),
        c("合同：报酬过高", "裁决", TaskRequest::Contract, huge_reward.to_string()),
        c("合同：报酬过低", "裁决", TaskRequest::Contract, tiny_reward.to_string()),
        c("合同：数量为负", "裁决", TaskRequest::Contract, negative_qty.to_string()),
        c("合同：不存在的港口", "裁决", TaskRequest::Contract, foreign_port.to_string()),
        c("传闻：文字过长", "裁决", TaskRequest::Rumor, serde_json::json!({ "text": "听说".repeat(400) }).to_string()),
        c("传闻：夹带链接", "裁决", TaskRequest::Rumor, r#"{"text":"详情见 https://example.com"}"#.into()),
        c("编年史：空文字", "裁决", TaskRequest::Chronicle { year: 0 }, r#"{"text":""}"#.into()),
        // 商会展望与市场月报（第八批 E7）
        c(
            "展望：额外的现金字段", "解析",
            TaskRequest::Outlook { company },
            r#"{"views":[],"method":"trend","memo":"看好","cash":1000000}"#.into(),
        ),
        c(
            "展望：未知商品", "裁决",
            TaskRequest::Outlook { company },
            r#"{"views":[{"good":"unobtainium","view":1}],"method":"trend","memo":"看好"}"#.into(),
        ),
        c(
            "展望：看法越界", "裁决",
            TaskRequest::Outlook { company },
            r#"{"views":[{"good":"grain","view":3}],"method":"trend","memo":"极其看好"}"#.into(),
        ),
        c(
            "展望：看法过多", "裁决",
            TaskRequest::Outlook { company },
            r#"{"views":[{"good":"grain","view":1},{"good":"salt","view":1},{"good":"spice","view":1},{"good":"tea","view":1},{"good":"fish","view":1}],"method":"trend","memo":"全都看好"}"#.into(),
        ),
        c(
            "展望：同一商品重复", "裁决",
            TaskRequest::Outlook { company },
            r#"{"views":[{"good":"grain","view":1},{"good":"grain","view":-1}],"method":"trend","memo":"既看好又看淡"}"#.into(),
        ),
        c(
            "展望：未知的预测方法", "裁决",
            TaskRequest::Outlook { company },
            r#"{"views":[],"method":"astrology","memo":"夜观星象"}"#.into(),
        ),
        c(
            "月报：夹带链接", "裁决",
            TaskRequest::MarketReport { region },
            r#"{"text":"详见 https://example.com"}"#.into(),
        ),
        // 封闭集合以外的事件类型
        c("导演：未知事件类型", "裁决", TaskRequest::Director, r#"{"events":[{"event":"gold_rain","params":{}}]}"#.into()),
        c(
            "导演：已知与未知事件混合", "裁决",
            TaskRequest::Director,
            r#"{"events":[{"event":"festival","params":{"loc":"chenggang","mult":1.2,"days":10}},{"event":"free_ships"}]}"#.into(),
        ),
        // 格式错误的 JSON
        c("导演：截断的 JSON", "解析", TaskRequest::Director, r#"{"events":[{"event":"festival""#.into()),
        c("导演：不是 JSON", "解析", TaskRequest::Director, "今年风调雨顺，没有什么大事。".into()),
        c("导演：类型错误", "解析", TaskRequest::Director, r#"{"events":"festival"}"#.into()),
        c("战略：类型错误", "解析", TaskRequest::Strategy { company }, r#"{"risk":"high","preferred":[]}"#.into()),
        c("合同：缺少字段", "解析", TaskRequest::Contract, r#"{"issuer":"cuilan","good":"grain"}"#.into()),
        c("传闻：空输出", "解析", TaskRequest::Rumor, String::new()),
    ]
}

/// 议价要求有舰队停在当地：优先用玩家的舰队，否则用任一停港的舰队。
fn bargain_request(session: &GameSession) -> TaskRequest {
    let fleets = &session.world.state.fleets;
    let docked = fleets
        .values()
        .filter(|f| f.owner == OwnerId::Player)
        .chain(fleets.values())
        .find_map(|f| f.docked_at().map(|l| (f.owner, l)))
        .expect("应有停港的舰队");
    TaskRequest::Bargain { owner: docked.0, loc: docked.1, player_text: "老板，便宜一点吧".into() }
}

/// 当前处于和平或同盟的一对势力的 key。
fn peaceful_pair(session: &GameSession) -> (String, String) {
    use manifest_core::diplomacy::DiploStatus;
    let defs = &session.world.defs;
    let r = session
        .world
        .state
        .relations
        .iter()
        .find(|r| !matches!(r.status, DiploStatus::Tension | DiploStatus::War))
        .expect("应有和平的势力对");
    (defs.faction(r.a).key.clone(), defs.faction(r.b).key.clone())
}

/// 测试 7：Mock LLM 提出的非法提案全部被拒绝，世界状态哈希与不接受任何 AI 命令的对照组一致。
#[test]
fn test7_illegal_proposals_are_rejected_and_state_is_unchanged() {
    let base = year_one();
    let expected = control_hash();
    let cases = illegal_cases(&base);
    assert!(cases.len() >= 20);
    for case in cases {
        let mut s = year_one();
        let before = s.world.state_hash();
        let driver = scripted(&[&case.raw]);
        let (outcome, cmds) = driver.run_request(&s.world, case.request.clone());
        let audit = driver.pipeline().audit_log();
        let outcome: AiOutcome = outcome.unwrap_or_else(|| panic!("{}：任务应能准备", case.name));
        assert_eq!(outcome.source, Some(ProposalSource::Llm), "{}：应使用 Mock LLM 的输出", case.name);
        // 议价的文字合法时，折扣仍由内核按意图计算；这里的非法字段必须让整个提案被拒绝
        assert!(cmds.is_empty(), "{}：非法提案不应产生命令，得到 {cmds:?}\n{}", case.name, stages(&audit));
        let rejected_at = |stage: &str, mark: &str| audit.iter().any(|a| a.stage == stage && a.detail.contains(mark));
        let ok = match case.stage {
            "解析" => rejected_at("解析", "丢弃") && outcome.verdict.is_none(),
            _ => rejected_at("裁决", "Reject") && outcome.accepted().is_none(),
        };
        assert!(ok, "{}：应在“{}”阶段被拒绝并记入审计日志\n{}", case.name, case.stage, stages(&audit));
        assert_eq!(s.world.state_hash(), before, "{}", case.name);
        assert_eq!(schedule_and_advance(&mut s, cmds), expected, "{}：状态应与对照组一致", case.name);
    }
}

/// 测试 7 的对照：同样的通道下，合法提案会被接受并改变世界（证明上面的"不变"不是因为通道失效）；
/// 越界的战略参数按规格夹紧而不是原样执行。
#[test]
fn test7_legal_proposals_pass_and_strategy_is_clamped() {
    let expected = control_hash();
    let mut s = year_one();
    let legal = r#"{"events":[{"event":"storm_season","params":{"region":"frost_west","mult":2.0,"days":60}}]}"#;
    let driver = scripted(&[legal]);
    let (_, cmds) = driver.run_request(&s.world, TaskRequest::Director);
    assert_eq!(cmds.len(), 1, "{}", stages(&driver.pipeline().audit_log()));
    assert_ne!(schedule_and_advance(&mut s, cmds), expected);
    // 进行中的还可能有规则触发的势力政策（组合事件，第八批 E7），只看目录事件
    let catalog = s.world.state.events.active.iter().filter_map(|e| e.catalog_kind());
    assert!(catalog.map(|k| s.world.defs.event_type(k).key.clone()).any(|k| k == "storm_season"));

    let mut s = year_one();
    let company = first_company(&s);
    let driver = scripted(&[r#"{"risk":5.0,"preferred":["grain","unobtainium"],"memo":"全力扩张"}"#]);
    let (outcome, cmds) = driver.run_request(&s.world, TaskRequest::Strategy { company });
    let verdict = outcome.unwrap().verdict.unwrap();
    assert_eq!(verdict.decision, manifest_ai::Decision::Modify);
    match cmds.as_slice() {
        [Command::AdjustStrategy { risk, preferred, .. }] => {
            assert_eq!(*risk, manifest_core::news::RISK_RANGE.1, "风险偏好夹紧到上限");
            assert_eq!(preferred.len(), 1, "未知商品被丢弃");
        }
        other => panic!("应得到一条夹紧后的战略命令，得到 {other:?}"),
    }
    schedule_and_advance(&mut s, cmds);
    let agent = &s.world.state.agents[&OwnerId::Company(company)];
    assert_eq!(agent.strategy.as_ref().unwrap().risk, manifest_core::news::RISK_RANGE.1);

    // 合法的商会展望：记下看法、备忘与方法
    let mut s = year_one();
    let company = first_company(&s);
    let driver = scripted(&[r#"{"views":[{"good":"grain","view":2}],"method":"trend","memo":"看好谷物"}"#]);
    let (_, cmds) = driver.run_request(&s.world, TaskRequest::Outlook { company });
    assert!(matches!(cmds.as_slice(), [Command::SetOutlook { .. }]), "{cmds:?}");
    schedule_and_advance(&mut s, cmds);
    let o = s.world.state.agents[&OwnerId::Company(company)].strategy.as_ref().unwrap().outlook.clone().unwrap();
    assert_eq!(o.memo, "看好谷物");
    assert_eq!(o.views, vec![(s.world.defs.find_good("grain").unwrap(), 2)]);
}

/// 测试 7：内核校验是最后一道关口——即便提案通过了裁决，内核规则（冷却、频率上限、存在性）不满足时也不执行。
#[test]
fn test7_kernel_rejects_what_adjudication_cannot_see() {
    let mut s = year_one();
    // 同一事件连发两次：第二次落在冷却期内
    let pick = r#"{"events":[{"event":"storm_season","params":{"region":"frost_west","mult":2.0,"days":60}}]}"#;
    let driver = scripted(&[pick, pick]);
    let (_, first) = driver.run_request(&s.world, TaskRequest::Director);
    assert_eq!(first.len(), 1);
    schedule_and_advance(&mut s, first);
    let expected = {
        let mut c = GameSession::from_save(common::defs(), s.to_save()).unwrap();
        schedule_and_advance(&mut c, Vec::new())
    };
    let (outcome, second) = driver.run_request(&s.world, TaskRequest::Director);
    assert!(outcome.unwrap().accepted().is_some(), "裁决器只看提案本身，会接受");
    assert!(second.is_empty(), "内核校验发现冷却期未过，拒绝执行");
    assert!(driver.pipeline().audit_log().iter().any(|a| a.stage == "内核校验"));
    assert_eq!(schedule_and_advance(&mut s, second), expected);

    // 商会展望：25 天内再提，裁决器接受、内核拒绝
    let mut s = year_one();
    let company = first_company(&s);
    let view = r#"{"views":[{"good":"grain","view":1}],"method":"adaptive","memo":"看好谷物"}"#;
    let driver = scripted(&[view, view]);
    let (_, first) = driver.run_request(&s.world, TaskRequest::Outlook { company });
    assert_eq!(first.len(), 1);
    schedule_and_advance(&mut s, first);
    let (outcome, second) = driver.run_request(&s.world, TaskRequest::Outlook { company });
    assert!(outcome.unwrap().accepted().is_some());
    assert!(second.is_empty(), "内核发现展望调整过于频繁，拒绝执行");
}

/// 第八批 E7：加上商会展望（每家商会每月一次）与市场月报（每月至多两篇）之后，每月的任务数（每个任务至多调用一次模型）
/// 仍在默认预算（每月 60 次）之内；复盘点评与身世序章按需请求、结果缓存，不在日程上。
#[test]
fn scheduled_ai_calls_fit_the_default_monthly_budget() {
    let mut s = GameSession::new(common::defs(), ScenarioId(0), 5).unwrap();
    let limit = AiSettings::default().monthly_calls as usize;
    let mut per_month = vec![0usize; 12];
    let mut outlooks = 0;
    let mut reports = 0;
    for _ in 0..360 {
        let due = AiDriver::due_requests(&s.world);
        outlooks += due.iter().filter(|r| matches!(r, TaskRequest::Outlook { .. })).count();
        reports += due.iter().filter(|r| matches!(r, TaskRequest::MarketReport { .. })).count();
        per_month[(s.day() / 30) as usize] += due.len();
        s.advance_day().unwrap();
    }
    let companies = s.world.defs.companies.len();
    assert_eq!(outlooks, companies * 12, "每家商会每月一次展望");
    assert!((1..=24).contains(&reports), "月报每月至多两篇，共 {reports} 篇");
    assert!(per_month.iter().all(|n| *n <= limit), "每月的任务 {per_month:?} 超出默认预算 {limit}");
}

// ───────────────────────────── 测试 9 ─────────────────────────────

fn all_requests(session: &GameSession) -> Vec<TaskRequest> {
    vec![
        TaskRequest::Director,
        TaskRequest::Rumor,
        bargain_request(session),
        TaskRequest::Strategy { company: first_company(session) },
        TaskRequest::Contract,
        TaskRequest::Chronicle { year: 0 },
        TaskRequest::Composed,
        TaskRequest::Outlook { company: first_company(session) },
        TaskRequest::MarketReport { region: report_region(session) },
        TaskRequest::Review {
            place: "澄港的谷物".into(),
            facts: vec!["实际价格比预测高了 18%".into(), "预测期内谷物开始流行".into()],
        },
        TaskRequest::Prologue {
            captain: manifest_ai::offline::PrologueFacts {
                name: "林远舟".into(),
                sign: "白羊座".into(),
                answers: vec!["灯塔修道院的抄写员".into(), "在大学学算学与天文".into(), "去新大陆看看".into()],
                port: "澄港".into(),
            },
        },
    ]
}

fn assert_offline_covers_all_kinds(driver: &AiDriver, label: &str) {
    let s = year_one();
    let mut kinds = Vec::new();
    for req in all_requests(&s) {
        let (outcome, cmds) = driver.run_request(&s.world, req.clone());
        let outcome = outcome.unwrap_or_else(|| panic!("{label}：{req:?} 应能准备"));
        assert_eq!(outcome.source, Some(ProposalSource::Offline), "{label}：{req:?}");
        let proposal = outcome.accepted().unwrap_or_else(|| panic!("{label}：{req:?} 的离线提案应通过裁决"));
        assert_eq!(proposal.kind(), outcome.task.kind);
        if outcome.task.kind.text_only() {
            // 复盘点评与身世序章只返回文字，不产生命令
            assert!(cmds.is_empty(), "{label}：{req:?} 不应产生命令");
            let (text, tpl) = driver.pipeline().text_result(&outcome).unwrap_or_else(|| panic!("{label}：{req:?}"));
            assert!(!text.is_empty() && tpl.is_some(), "{label}：{req:?} 的离线文字带模板位置");
        } else if outcome.task.kind != ProposalKind::Director {
            assert!(!cmds.is_empty(), "{label}：{req:?} 的离线提案应能转为命令");
        }
        kinds.push(outcome.task.kind);
    }
    // 第九批类型需要人物/日常状态；保留经典世界的全部请求，再追加新世界的覆盖。
    let root = manifest_data::find_data_dir().unwrap();
    let mut defs = manifest_data::load_world(&root, "testbed").unwrap();
    let scenario = &mut std::sync::Arc::make_mut(&mut defs).scenarios[0];
    scenario.start_date = [1558, 1, 1];
    scenario.control_date = scenario.start_date;
    let mut world = manifest_core::World::new(defs, ScenarioId(0), 42).unwrap();
    world.state.cast.place = world.person_place("mentor");
    world.state.cast.persons.entry("mentor".into()).or_default().met = true;
    for request in [
        TaskRequest::Persona { owner: OwnerId::Player, person: "mentor".into(), player_text: "你好".into() },
        TaskRequest::Daily { owner: OwnerId::Player, person: "mentor".into() },
    ] {
        let (outcome, commands) = driver.run_request(&world, request.clone());
        let outcome = outcome.unwrap_or_else(|| panic!("{label}: {request:?}"));
        assert_eq!(outcome.source, Some(ProposalSource::Offline), "{label}: {request:?}");
        assert_eq!(outcome.accepted().unwrap().kind(), outcome.task.kind);
        assert_eq!(commands.len(), 1, "{label}: {request:?}");
        kinds.push(outcome.task.kind);
    }
    for (world, request) in common::f9::text_cases() {
        let (outcome, commands) = driver.run_request(&world, request.clone());
        let outcome = outcome.unwrap_or_else(|| panic!("{label}: {request:?}"));
        assert_eq!(outcome.source, Some(ProposalSource::Offline), "{label}: {request:?}");
        assert_eq!(outcome.accepted().unwrap().kind(), outcome.task.kind);
        assert_eq!(commands.len(), 1, "{label}: {request:?}");
        kinds.push(outcome.task.kind);
    }
    assert_eq!(kinds, ProposalKind::ALL.to_vec(), "每种提案类型都覆盖到");
    // 事件导演的离线模板可能挑 0 个事件；连续若干个导演日里至少有一次挑出事件
    let mut s = year_one();
    let mut events = 0;
    for _ in 0..60 {
        let (_, cmds) = driver.run_request(&s.world, TaskRequest::Director);
        events += cmds.len();
        s.advance_day().unwrap();
    }
    assert!(events > 0, "{label}：离线事件导演应能挑出事件");
    assert!(driver.pipeline().audit_log().iter().any(|a| a.stage == "离线模板"));
}

/// 测试 9：未配置 LLM 时，每种提案类型都能由离线模板生成。
#[test]
fn test9_offline_templates_generate_every_proposal_kind() {
    // 离线模式
    assert_offline_covers_all_kinds(&pipeline_with(AiMode::Offline, None), "离线模式");
    // 选择了真实提供商但未配置（没有密钥）
    assert_offline_covers_all_kinds(&pipeline_with(AiMode::Live, None), "未配置提供商");
}

/// 测试 9：提供商失败或超出预算时自动降级为离线模板。
#[test]
fn test9_provider_failure_and_budget_fall_back_to_offline() {
    // Mock 没有更多输出 → 调用失败 → 离线模板
    let driver = scripted(&[]);
    assert_offline_covers_all_kinds(&driver, "提供商失败");
    assert!(driver.pipeline().audit_log().iter().any(|a| a.stage == "降级"));

    // 预算为 0：不调用提供商
    let settings = AiSettings { mode: AiMode::Mock, monthly_calls: 0, ..AiSettings::default() };
    let driver =
        AiDriver::new(AiPipeline::new(common::ai_content(), &settings, Some(Provider::Mock(MockLlm::plausible()))))
            .unwrap();
    assert_offline_covers_all_kinds(&driver, "预算用完");
    assert!(driver.pipeline().audit_log().iter().any(|a| a.stage == "预算"));
    assert_eq!(driver.pipeline().budget(365).calls_used, 0);

    // 预算用完的当月降级，下个月恢复
    let settings = AiSettings { mode: AiMode::Mock, monthly_calls: 2, ..AiSettings::default() };
    let driver =
        AiDriver::new(AiPipeline::new(common::ai_content(), &settings, Some(Provider::Mock(MockLlm::plausible()))))
            .unwrap();
    let s = year_one();
    let sources: Vec<_> =
        all_requests(&s).into_iter().map(|r| driver.run_request(&s.world, r).0.and_then(|o| o.source)).collect();
    assert_eq!(sources.iter().filter(|x| **x == Some(ProposalSource::Llm)).count(), 2, "{sources:?}");
    assert!(sources.iter().filter(|x| **x == Some(ProposalSource::Offline)).count() >= 3);
    let b = driver.pipeline().budget(s.day());
    assert_eq!((b.calls_used, b.calls_limit), (2, 2));
    assert_eq!(driver.pipeline().budget(s.day() + 30).calls_used, 0, "新的月份预算重置");

    // 相同输入命中缓存，不再计入预算
    let settings = AiSettings { mode: AiMode::Mock, ..AiSettings::default() };
    let driver =
        AiDriver::new(AiPipeline::new(common::ai_content(), &settings, Some(Provider::Mock(MockLlm::plausible()))))
            .unwrap();
    let a = driver.run_request(&s.world, TaskRequest::Director).0.unwrap();
    let b = driver.run_request(&s.world, TaskRequest::Director).0.unwrap();
    assert_eq!(a.source, Some(ProposalSource::Llm));
    assert_eq!(b.source, Some(ProposalSource::Cache));
    assert_eq!(driver.pipeline().budget(s.day()).calls_used, 1);
}

// ───────────────────────────── 测试 11 ─────────────────────────────

const TEST_KEY: &str = "sk-ant-TEST-9f3c1e7a-DO-NOT-LEAK";

fn anthropic_reply(text: &str) -> serde_json::Value {
    serde_json::json!({
        "id": "msg_test",
        "type": "message",
        "role": "assistant",
        "model": "claude-sonnet-5",
        "content": [{"type": "text", "text": text}],
        "stop_reason": "end_turn",
        "usage": {"input_tokens": 120, "output_tokens": 40},
    })
}

/// 测试 11：密钥只出现在发往提供商的请求头中；审计日志、命令日志、存档、设置与错误信息的序列化结果中都不包含密钥。
#[test]
fn test11_api_key_never_appears_in_logs_saves_or_errors() {
    use wiremock::matchers::{header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
    let server = rt.block_on(MockServer::start());
    // 正常应答：一条合法的事件导演提案
    let director = r#"{"events":[{"event":"storm_season","params":{"region":"frost_west","mult":2.0,"days":60}}]}"#;
    rt.block_on(
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .and(header("x-api-key", TEST_KEY))
            .respond_with(ResponseTemplate::new(200).set_body_json(anthropic_reply(director)))
            .up_to_n_times(1)
            .mount(&server),
    );
    // 之后的请求：模型输出里试图回显密钥，以及服务端错误
    rt.block_on(
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(anthropic_reply(&format!(r#"{{"text":"内部消息：密钥是 {TEST_KEY}"}}"#))),
            )
            .up_to_n_times(1)
            .mount(&server),
    );
    rt.block_on(
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .respond_with(ResponseTemplate::new(401).set_body_json(serde_json::json!({
                "type": "error",
                "error": {"type": "authentication_error", "message": format!("invalid x-api-key: {TEST_KEY}")},
            })))
            .mount(&server),
    );

    let config = ProviderConfig { base_url: server.uri(), ..ProviderConfig::anthropic_default() };
    let settings = AiSettings { mode: AiMode::Live, provider: Some(config.clone()), ..AiSettings::default() };
    let provider = HttpProvider::new(config, Secret::new(TEST_KEY)).unwrap();
    let driver =
        AiDriver::new(AiPipeline::new(common::ai_content(), &settings, Some(Provider::Http(provider)))).unwrap();

    let mut s = year_one();
    let (_, cmds) = driver.run_request(&s.world, TaskRequest::Director);
    assert_eq!(cmds.len(), 1, "{}", stages(&driver.pipeline().audit_log()));
    let (echo, echo_cmds) = driver.run_request(&s.world, TaskRequest::Rumor);
    assert!(echo_cmds.is_empty(), "回显密钥的文字被裁决拒绝");
    assert!(echo.unwrap().accepted().is_none());
    let (failed, _) = driver.run_request(&s.world, TaskRequest::Contract);
    assert_eq!(failed.unwrap().source, Some(ProposalSource::Offline), "401 时降级为离线模板");
    let tick = s.day() + 1;
    for c in cmds {
        s.schedule(tick, Source::Ai, c);
    }
    s.advance_day().unwrap();

    // 服务器确实收到了密钥（证明检查的对象里本可能出现它）
    let requests = rt.block_on(server.received_requests()).unwrap();
    assert_eq!(requests.len(), 3);
    assert!(requests.iter().all(|r| r.headers.get("x-api-key").map(|v| v.to_str().unwrap()) == Some(TEST_KEY)));
    assert!(requests.iter().all(|r| !String::from_utf8_lossy(&r.body).contains(TEST_KEY)), "请求体不含密钥");

    let audit = driver.pipeline().audit_log();
    let mut serialized = vec![
        ("审计日志", serde_json::to_string(&audit).unwrap()),
        ("审计日志（Debug）", format!("{audit:?}")),
        ("命令日志", serde_json::to_string(s.log()).unwrap()),
        ("存档 JSON", String::from_utf8(storage::encode(&s.to_save(), false).unwrap()).unwrap()),
        ("设置", serde_json::to_string(&settings).unwrap()),
        ("密钥 Debug", format!("{:?}", Secret::new(TEST_KEY))),
        ("密钥 Display", format!("{}", Secret::new(TEST_KEY))),
        ("预算", serde_json::to_string(&driver.pipeline().budget(s.day())).unwrap()),
    ];
    // 直接调用提供商得到的错误信息
    let err_provider = HttpProvider::new(
        ProviderConfig { base_url: server.uri(), ..ProviderConfig::anthropic_default() },
        Secret::new(TEST_KEY),
    )
    .unwrap();
    let req = manifest_ai::LlmRequest {
        system: "s".into(),
        user: "u".into(),
        max_tokens: 100,
        tier: manifest_ai::ModelTier::Fast,
        hint: None,
    };
    let err = rt.block_on(err_provider.complete(&req)).unwrap_err();
    serialized.push(("错误 Display", err.to_string()));
    serialized.push(("错误 Debug", format!("{err:?}")));
    // 连接失败的错误
    let dead = HttpProvider::new(
        ProviderConfig {
            base_url: "http://127.0.0.1:9".into(),
            timeout_secs: 2,
            ..ProviderConfig::anthropic_default()
        },
        Secret::new(TEST_KEY),
    )
    .unwrap();
    let err = rt.block_on(dead.complete(&req)).unwrap_err();
    serialized.push(("连接错误", format!("{err} / {err:?}")));

    for (what, text) in &serialized {
        assert!(!text.contains(TEST_KEY), "{what} 中出现了测试密钥：{text}");
        assert!(!text.contains("9f3c1e7a"), "{what} 中出现了密钥片段");
    }
    assert!(stages(&audit).contains("401"), "审计日志记录了错误类别");
}
