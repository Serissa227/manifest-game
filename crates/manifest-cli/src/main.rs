//! Manifest 命令行：无界面模拟、重放检查、平衡测试与数据校验。

use anyhow::{Context, Result, bail};
use clap::{Parser, Subcommand};
use manifest_ai::AiMode;
use manifest_core::StaticData;
use manifest_core::ids::{OwnerId, RegionId, ScenarioId};
use manifest_core::info::InfoMode;
use manifest_core::weather::{Climate, Sky, day_weather};
use manifest_core::{Fx, World};
use manifest_sim::{AiDriver, Bot, BotKind, GameSession, stats};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

mod act_report;
mod locale_tools;
mod profile;
mod profile_upbringing;

#[derive(Parser)]
#[command(name = "manifest-cli", about = "Manifest 无界面工具")]
struct Cli {
    /// data/ 目录（默认自动查找）
    #[arg(long, global = true)]
    data: Option<PathBuf>,
    /// 世界 key（模拟、重放和平衡默认 classic；数据校验默认全部世界，含隐藏世界）
    #[arg(long, global = true)]
    world: Option<String>,
    /// 显示语言（不改变模拟用的原始定义）
    #[arg(long, global = true, default_value = "zh-CN")]
    language: String,
    #[command(subcommand)]
    command: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// 无界面模拟，输出每年摘要
    Simulate(SimulateArgs),
    /// 运行后只用命令日志重放（关闭 AI），比对状态哈希
    ReplayCheck {
        #[arg(long, default_value_t = 7)]
        seed: u64,
        #[arg(long, default_value_t = 730)]
        days: u32,
        #[arg(long, default_value = "arbitrage")]
        bot: String,
        /// 原局的 AI 模式：off / offline / mock
        #[arg(long, default_value = "off")]
        ai: String,
        /// 行情情报：carried（随船传递，新游戏的默认）/ live（实时，经典）
        #[arg(long, default_value = "carried")]
        info: String,
    },
    /// 平衡性批量模拟：种子 × 四种 bot，按第 11 节阈值判定，结果写入 docs/BALANCE.md
    Balance(BalanceArgs),
    /// 校验 data/ 目录
    ValidateData,
    /// 启动与读档的分段计时（照桌面应用的启动顺序，不开窗口）
    ProfileStartup(profile::ProfileArgs),
    /// 养成期逐日与分段计时（内核只通知步骤，计时留在命令行）。
    ProfileUpbringing(profile_upbringing::Args),
    /// 剧情可达检查：故事图的旗标来源与轨道入口（story2）加养成期静态可达（upbringing::reach），
    /// 与 manifest-data 的 upbringing_u03 两条测试同一套判定；有问题时逐条列出并以非零退出
    StoryReach,
    /// 养成期中位成长曲线（U02）：每位主角每月各项的中位预期与上界，JSON 输出
    UpbringingCurve {
        /// 家庭键（缺省为全部家庭）
        #[arg(long)]
        family: Option<String>,
    },
    /// 养成期门槛按曲线生成（U02）：输出 JSON 方案，供 tools/u02/apply_thresholds.py 写回数据
    UpbringingThresholds {
        /// 方案写入的文件（缺省打印到标准输出）
        #[arg(long)]
        out: Option<PathBuf>,
        /// 只列出与数据不一致的门槛
        #[arg(long)]
        changed: bool,
    },
    /// 养成整局（U04 审查）：主角 × 预设 × 种子按自动安排跑完，输出比赛与结局的统计（JSON）
    UpbringingRuns {
        /// 家庭键，逗号分隔（缺省为九位主角）
        #[arg(long)]
        families: Option<String>,
        /// 自动安排预设，逗号分隔
        #[arg(long, default_value = "balanced")]
        presets: String,
        /// 种子，逗号分隔
        #[arg(long, default_value = "7")]
        seeds: String,
        /// 每 n 场新开放的比赛点一次报名（0 为从不）
        #[arg(long, default_value_t = 2)]
        register_every: u32,
        /// 并行线程数
        #[arg(long, default_value_t = 4)]
        threads: usize,
    },
    /// 事件节奏审计（P11）：养成整局与出海逐日记每一次打断，统计密度、扎堆与通畅；输出中文摘要与 JSON
    PacingAudit {
        /// 家庭键，逗号分隔（缺省为全部家庭：九位主角与十二个自创出身）
        #[arg(long)]
        families: Option<String>,
        /// 自动安排预设，逗号分隔
        #[arg(long, default_value = "balanced")]
        presets: String,
        /// 种子，逗号分隔
        #[arg(long, default_value = "7,42")]
        seeds: String,
        /// 每 n 场新开放的比赛点一次报名（0 为从不；与 upbringing-runs 相同）
        #[arg(long, default_value_t = 2)]
        register_every: u32,
        /// 并行线程数
        #[arg(long, default_value_t = 4)]
        threads: usize,
        /// 出海段的天数：养成结业后接着走，另加自由航海剧本（0 = 不跑出海）
        #[arg(long, default_value_t = 365)]
        sea_days: u32,
        /// 报告写入的目录（pacing-audit.json 与 pacing-audit.md）；缺省只把摘要打印到标准输出
        #[arg(long)]
        out: Option<PathBuf>,
        /// 节奏的闸：data 照数据包的 [pacing]，on 强制开，off 强制关（关着跑出来的就是没有闸时的基线，试算给出开闸的一阶估计）
        #[arg(long, default_value = "data")]
        gate: String,
        /// 覆盖 [pacing] 的 daily：一天里最多新出场几件独立打断
        #[arg(long)]
        daily: Option<u32>,
        /// 覆盖 [pacing] 的 window_days：滚动窗口的天数
        #[arg(long)]
        window_days: Option<u32>,
        /// 覆盖 [pacing] 的 window_soft：窗口内可以等的事最多出场几件
        #[arg(long)]
        window_soft: Option<u32>,
        /// 覆盖 [pacing] 的 max_defer_days：可以等的事最久等几天
        #[arg(long)]
        max_defer_days: Option<u32>,
    },
    /// 引导链的四项静态检查及开局读模型。
    GuideReport {
        #[arg(long)]
        line: Option<String>,
        #[arg(long)]
        view: bool,
    },
    /// 养成事件周节奏的逻辑上界与固定日期入口；只读 JSON 报告
    UpbringingCadence {
        #[arg(long)]
        family: Option<String>,
    },
    /// H10b：只读领航诊断，港口对文件为 JSON 的 [[起港键,终港键],...]。
    PilotReport {
        #[arg(long)]
        pairs: Option<PathBuf>,
        /// H10b2：同时输出新旧航段的逐日风流与慢行明细。
        #[arg(long)]
        legs: bool,
        /// H10j：从 JSON / mfsave.zst 存档逐分钟重放；读取同名 .meta.json 的钟点，船况固定、不运行日结。
        #[arg(long, requires_all = ["from", "to"], conflicts_with = "pairs")]
        save: Option<PathBuf>,
        /// 起港键；有存档时须与停泊港一致，否则用自由航海剧本的船况。
        #[arg(long, requires = "to", conflicts_with = "pairs")]
        from: Option<String>,
        /// 终港键。
        #[arg(long, requires = "from")]
        to: Option<String>,
        /// 依次经过的港口键，逗号分隔；抵港当分钟续航。
        #[arg(long, value_delimiter = ',', requires = "save")]
        via: Vec<String>,
        /// 无存档诊断的出发月份（默认一月，月初出发）。
        #[arg(long, requires = "from", conflicts_with = "save", value_parser = clap::value_parser!(u32).range(1..=12))]
        month: Option<u32>,
        /// 无存档诊断的路径偏好。
        #[arg(long, requires = "from", conflicts_with = "save", value_parser = ["distance", "fastest", "coastal"])]
        pref: Option<String>,
        /// 无存档诊断只输出指定绝对日的分钟；省略时输出全程。
        #[arg(long, requires = "from", conflicts_with = "save")]
        trace_day: Option<u32>,
    },
    UpbringingActGen {
        #[arg(long)]
        family: String,
        #[arg(long)]
        write: bool,
    },
    UpbringingActReport {
        #[arg(long, default_value = "mio")]
        family: String,
        #[arg(long, conflicts_with = "seeds")]
        seed: Option<u64>,
        #[arg(long, value_delimiter = ',')]
        seeds: Option<Vec<u64>>,
        #[arg(long)]
        json: Option<PathBuf>,
        #[arg(long)]
        out: Option<PathBuf>,
        #[arg(long, value_delimiter = ',', value_parser = ["idle", "casual", "steady", "scholar", "social", "greedy", "ace"])]
        strategies: Vec<String>,
        #[arg(long)]
        save_dir: Option<PathBuf>,
        #[arg(long, value_parser = ["shuttle"])]
        sailing: Option<String>,
    },
    /// U06K1：固定种子导出澪的行动制视图（局部启用开关，不改数据）。
    UpbringingActView {
        #[arg(long,default_value_t=2,value_parser=clap::value_parser!(u32).range(0..=60))]
        weeks: u32,
        #[arg(long,default_value="plan",value_parser=["plan","free","summary","moment"])]
        stop: String,
        #[arg(long)]
        roundtrip: bool,
        #[arg(long)]
        ill: bool,
        #[arg(long)]
        voyage: Option<String>,
    },
    /// 只读存档的行动制视图及每个原挂标记的逐项开门检查，不推进或写回存档。
    UpbringingActSnapshot {
        /// 存档路径（JSON 或 .mfsave.zst，自动识别压缩）
        #[arg(long)]
        save: PathBuf,
    },
    /// 导出中文变体可覆盖字段；列表逐项导出，下标从 0 开始，缺项独立回退。
    LocaleExport {
        #[arg(long, default_value = "zh-CN-x-gemini")]
        variant: String,
        /// 相对文件路径的子串筛选，可重复传入
        #[arg(long)]
        file: Vec<String>,
    },
    /// 合并变体 JSON；有效项照写，拒绝项逐条输出且退出非零。列表下标可独立导入。
    LocaleImport {
        #[arg(long)]
        input: PathBuf,
        /// 清除来源已变化或已删除的字段，保留本次未给的其他条目
        #[arg(long)]
        prune_stale: bool,
    },
}

#[derive(clap::Args)]
struct SimulateArgs {
    #[arg(long, default_value_t = 42)]
    seed: u64,
    #[arg(long, default_value_t = 365)]
    days: u32,
    /// 开局剧本 key（默认第一个）
    #[arg(long)]
    scenario: Option<String>,
    /// 代替玩家的 bot：passive / route / arbitrage / futures
    #[arg(long, default_value = "arbitrage")]
    bot: String,
    /// AI 模式：off / offline / mock
    #[arg(long, default_value = "offline")]
    ai: String,
    /// 行情情报：carried（随船传递，新游戏的默认）/ live（实时，经典）
    #[arg(long, default_value = "carried")]
    info: String,
    #[arg(long)]
    roundtrip: bool,
}

#[derive(clap::Args)]
struct BalanceArgs {
    #[arg(long, default_value_t = 20)]
    seeds: u32,
    #[arg(long, default_value_t = 30)]
    years: u32,
    /// 并行线程数（默认为 CPU 核数）
    #[arg(long)]
    threads: Option<usize>,
    /// 报告写入的文件（默认为仓库的 docs/BALANCE.md）
    #[arg(long)]
    out: Option<PathBuf>,
    /// 行情情报：carried（随船传递，新游戏的默认）/ live（实时，经典）
    #[arg(long, default_value = "carried")]
    info: String,

    /// 平衡观测使用的剧本；寰宇默认 free_1557。
    #[arg(long)]
    scenario: Option<String>,
    /// 从养成结业后开始统计，养成期仍逐日核对货币。
    #[arg(long)]
    after_graduation: bool,
    /// 更新 BALANCE.md 对应世界的报告区间。
    #[arg(long)]
    update: bool,
}

fn data_root(dir: &Option<PathBuf>) -> Result<PathBuf> {
    dir.clone().or_else(manifest_data::find_data_dir).context("找不到 data/ 目录")
}

fn load_defs(dir: &Option<PathBuf>, world: &str) -> Result<Arc<StaticData>> {
    manifest_data::load_world(&data_root(dir)?, world).map_err(anyhow::Error::from)
}

fn scenario_id(defs: &StaticData, key: &Option<String>) -> Result<ScenarioId> {
    match key {
        None => Ok(ScenarioId(0)),
        Some(k) => defs.find_scenario(k).with_context(|| format!("未知剧本：{k}")),
    }
}

fn fmt_money(v: i64) -> String {
    let neg = v < 0;
    let digits = v.unsigned_abs().to_string();
    let mut out = String::new();
    for (i, ch) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(ch);
    }
    if neg { format!("-{out}") } else { out }
}

fn year_summary(session: &GameSession) -> String {
    let w = &session.world;
    let wr = &w.defs.rules.world;
    // 刚结束的年份（年序从 0 计）与货币单位都取自 rules.toml [world]
    let year = manifest_core::summary::year_text(wr, (w.day() / w.defs.calendar.year_days()).saturating_sub(1));
    let cur = &wr.currency;
    let player = w.state.agents.get(&OwnerId::Player);
    let cash = player.map(|a| a.cash).unwrap_or(0);
    let (alive, total) = stats::companies_alive(w);
    let (wealth, _) = stats::company_wealth(w);
    let fleets = w.state.fleets.len();
    let at_sea = w.fleets_at_sea();
    let conserved = if w.money_conserved() { "守恒" } else { "不守恒" };
    let b = &w.state.battles;
    let count = |k: &str| b.totals.get(k).copied().unwrap_or(0);
    let colonies = w.state.colonies.len();
    let colonists: i64 = w.state.colonies.values().map(|c| c.population).sum();
    let claimed =
        w.state.locations.iter().filter(|l| matches!(l.claim, Some(manifest_core::colony::Claim::Faction(_)))).count();
    format!(
        "年度摘要 {year}：玩家现金 {} {cur}，净资产 {} {cur}；商会存活 {alive}/{total}，商会净资产合计 {} {cur}；物价指数 {}；舰队 {fleets} 支（海上 {at_sea}）；殖民地 {colonies} 处（人口 {colonists}），势力占领殖民点 {claimed} 处；海盗累计 {} 支，海战累计 胜 {} / 负 {} / 脱离 {}；货币总量 {} {cur}（{conserved}）；{}",
        fmt_money(cash),
        fmt_money(stats::net_worth(w, OwnerId::Player)),
        fmt_money(wealth),
        stats::price_index(w),
        b.pirates_spawned,
        count("Won"),
        count("Lost"),
        count("Evaded"),
        fmt_money(w.total_money()),
        weather_line(w),
    )
}

/// 今天各海区的天况（年度摘要末尾）：例如“今日天气 暴风雨 2 处、雾 3 处、雪 1 处（共 23 个海区）”。
fn weather_line(w: &World) -> String {
    let n = w.defs.regions.len();
    let mut counts = [0usize; 6];
    for r in 0..n {
        if let Some(x) = w.weather_today(RegionId::from_idx(r)) {
            counts[x.sky as usize] += 1;
        }
    }
    let parts: Vec<String> = [Sky::Storm, Sky::Rain, Sky::Fog, Sky::Snow]
        .iter()
        .filter(|s| counts[**s as usize] > 0)
        .map(|s| format!("{} {} 处", s.name(), counts[*s as usize]))
        .collect();
    let text = if parts.is_empty() { "各海区无雨无雾".to_string() } else { parts.join("、") };
    format!("今日天气 {text}（共 {n} 个海区）")
}

/// 参考数据：按种子 1 算一年里各海区的天况占比，以及各气候的海区数。
fn weather_stats(defs: &StaticData) -> String {
    let mut counts = [0i64; 6];
    for r in 0..defs.regions.len() {
        for day in 0..defs.calendar.year_days() {
            if let Some(x) = day_weather(defs, 1, RegionId::from_idx(r), day, Fx::ONE) {
                counts[x.sky as usize] += 1;
            }
        }
    }
    let total = counts.iter().sum::<i64>().max(1);
    let skies: Vec<String> = Sky::ALL
        .iter()
        .map(|s| format!("{} {:.1}%", s.name(), counts[*s as usize] as f64 * 100.0 / total as f64))
        .collect();
    let climates: Vec<String> = Climate::ALL
        .iter()
        .map(|c| format!("{} {}", c.name(), defs.regions.iter().filter(|r| r.climate == *c).count()))
        .collect();
    format!(
        "天气（种子 1、一年）：{}；气候 {} 个海区；天气系统平均 {} 天，暴风雨当天受损基准概率 {}%",
        skies.join("、"),
        climates.join(" / "),
        defs.rules.weather.system_days,
        defs.rules.weather.storm_hit_bp / 100
    )
}

/// 解析 `--info`：carried / live。
fn parse_info(s: &str) -> Result<InfoMode> {
    match s {
        "carried" => Ok(InfoMode::Carried),
        "live" => Ok(InfoMode::Live),
        other => bail!("未知的行情情报：{other}（可选 carried / live）"),
    }
}

fn balance(defs: Arc<StaticData>, data: &Option<PathBuf>, args: BalanceArgs) -> Result<()> {
    let BalanceArgs { seeds, years, threads, out, info, scenario, after_graduation, update } = args;
    let info = parse_info(&info)?;
    let scenario = if scenario.is_some() {
        scenario_id(&defs, &scenario)?
    } else if after_graduation {
        ScenarioId(0)
    } else {
        manifest_sim::balance::default_scenario(&defs)?
    };
    use manifest_sim::balance;
    if seeds == 0 || years == 0 {
        bail!("seeds 与 years 必须大于 0");
    }
    let limit = std::env::var("MANIFEST_BALANCE_THREADS").ok().and_then(|s| s.parse::<usize>().ok()).filter(|n| *n > 0);
    let threads =
        threads.or(limit).unwrap_or_else(|| std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4));
    let threads = limit.map_or(threads, |cap| threads.min(cap));
    if threads == 0 {
        bail!("threads 必须大于 0");
    }
    println!("平衡测试：种子 1–{seeds} × 4 种 bot × {years} 年，行情情报 {}，{threads} 个线程", info.key());
    // 性能：单线程运行一局 10 年模拟
    let started = Instant::now();
    let timed = balance::run_one_scenario(defs.clone(), 42, BotKind::Arbitrage, 10, info, scenario, after_graduation)?;
    let ten_year = if defs.world_key == "classic" {
        started.elapsed().as_secs_f64()
    } else {
        timed.observation_time.as_secs_f64()
    };
    println!("10 年模拟（单线程）耗时 {ten_year:.1} 秒");
    let started = Instant::now();
    let runs = balance::run_all_scenario(defs.clone(), seeds, years, threads, info, scenario, after_graduation)?;
    println!("{} 局模拟完成，耗时 {:.1} 秒", runs.len(), started.elapsed().as_secs_f64());
    let verdicts = balance::judge(&defs, &runs, &balance::Thresholds::default(), ten_year);
    let report = balance::report(&defs, &runs, &verdicts, seeds, years, info);
    println!("{report}");
    if defs.world_key != "terra16" || update || out.is_some() {
        let path = match out {
            Some(p) => p,
            None => {
                let name = if matches!(defs.world_key.as_str(), "classic" | "terra16") {
                    "BALANCE.md".to_owned()
                } else {
                    format!("BALANCE-{}.md", defs.world_key)
                };
                data_root(data)?.parent().map(|p| p.join("docs").join(name)).context("无法确定 docs/ 目录")?
            }
        };
        let doc = if path.exists() {
            std::fs::read_to_string(&path).with_context(|| format!("无法读取 {}", path.display()))?
        } else {
            "# 平衡\n".to_owned()
        };
        // 不规整既有换行，具名世界更新必须保持经典区间的原始字节。
        let updated = balance::splice_world_report(&doc, &report, &defs.world_key);
        if updated != doc {
            std::fs::write(&path, updated).with_context(|| format!("无法写入 {}", path.display()))?;
        }
        println!("报告已写入 {}", path.display());
    }
    if !verdicts.iter().all(|v| v.pass) {
        bail!("平衡检查未通过");
    }
    Ok(())
}

fn parse_ai(s: &str) -> Result<AiMode> {
    Ok(match s {
        "off" => AiMode::Off,
        "offline" => AiMode::Offline,
        "mock" => AiMode::Mock,
        other => bail!("未知的 AI 模式：{other}（可选 off / offline / mock）"),
    })
}

fn ai_driver(dir: &Option<PathBuf>, world: &str, mode: AiMode) -> Result<Option<AiDriver>> {
    if mode == AiMode::Off {
        return Ok(None);
    }
    let data_dir = match dir {
        Some(d) => d.clone(),
        None => manifest_data::find_data_dir().context("找不到 data/ 目录")?,
    };
    let source = manifest_data::resolve_world(&data_dir, world)?;
    let content = manifest_data::ai_content::load_world_ai_content(&source)?;
    Ok(AiDriver::with_mode(Arc::new(content), mode)?)
}

/// 运行一局：bot 代替玩家，AI 按日程产生提案。每年末回调一次。
fn run(
    session: &mut GameSession,
    bot: BotKind,
    driver: &Option<AiDriver>,
    days: u32,
    mut observe: impl FnMut(&GameSession) -> Result<()>,
    mut on_year: impl FnMut(&GameSession) -> Result<()>,
) -> Result<usize> {
    let mut bot = Bot::new(bot);
    let mut ai_commands = 0;
    for _ in 0..days {
        observe(session)?;
        bot.act(session);
        observe(session)?;
        let report = session.advance_day()?;
        if let Some(d) = driver {
            ai_commands += d.run_due(session);
        }
        observe(session)?;
        if report.year_end {
            on_year(session)?;
        }
    }
    Ok(ai_commands)
}

fn simulate(defs: Arc<StaticData>, display: &StaticData, args: SimulateArgs, driver: Option<AiDriver>) -> Result<()> {
    let SimulateArgs { seed, days, scenario, bot, info, roundtrip, .. } = args;
    let scenario = scenario_id(&defs, &scenario)?;
    let bot: BotKind = bot.parse().map_err(anyhow::Error::msg)?;
    let info = parse_info(&info)?;
    let started = Instant::now();
    let name = display.scenarios[scenario.idx()].name.clone();
    let mode = driver.as_ref().map(|d| format!("{:?}", d.pipeline().mode())).unwrap_or_else(|| "Off".into());
    println!("模拟开始：种子 {seed}，剧本「{name}」，bot {bot}，AI {mode}，行情情报 {}，共 {days} 天", info.key());
    let mut session = GameSession::new(defs, scenario, seed)?;
    session.choose_info(info)?;
    let mut checks = 0;
    let mut docked_checks = 0;
    let mut sea_checks = 0;
    let mut last_day = None;
    let mut previous_location = None;
    let mut autopilot_logs = std::collections::BTreeSet::new();
    let ai_commands = run(
        &mut session,
        bot,
        &driver,
        days,
        |s| {
            // 任务单要求数全程的两种日志；世界日志会裁剪，按已有的每日单次规则去重累计。
            for event in &s.world.state.log {
                let (fleet, kind) = match &event.kind {
                    manifest_core::log::LogKind::AutopilotCreep { fleet, .. } => (*fleet, 0),
                    manifest_core::log::LogKind::AutopilotWait { fleet, .. } => (*fleet, 1),
                    _ => continue,
                };
                autopilot_logs.insert((event.day, fleet, kind));
            }
            if !roundtrip {
                return Ok(());
            }
            let docked = s.world.fleets_of(OwnerId::Player).any(|f| f.docked_at().is_some());
            let at_sea = s.world.fleets_of(OwnerId::Player).any(|f| f.docked_at().is_none());
            let location = (docked, at_sea);
            // 每五天及在港／出海变化时检查；同一天不重复做定期检查。
            if last_day.is_none_or(|day| s.day() - day >= 5) || previous_location != Some(location) {
                check_roundtrip(&s.world, s.to_save())?;
                checks += 1;
                docked_checks += u32::from(docked);
                sea_checks += u32::from(at_sea);
                last_day = Some(s.day());
            }
            previous_location = Some(location);
            Ok(())
        },
        |s| {
            println!("{}", year_summary(s));
            if !s.world.money_conserved() {
                bail!("货币不守恒");
            }
            Ok(())
        },
    )?;
    if roundtrip {
        eprintln!("roundtrip: checks={checks} docked={docked_checks} at_sea={sea_checks}");
    }
    eprintln!(
        "autopilot_logs: creep={} wait={}",
        autopilot_logs.iter().filter(|(_, _, kind)| *kind == 0).count(),
        autopilot_logs.iter().filter(|(_, _, kind)| *kind == 1).count()
    );
    println!(
        "模拟结束：第 {} 天，日志 {} 条命令（其中 AI {ai_commands} 条），新闻 {} 条，编年史 {} 篇，状态哈希 {}，耗时 {:.1} 秒",
        session.day(),
        session.log().len(),
        session.world.state.news.news.len(),
        session.world.state.news.chronicles.len(),
        session.world.state_hash(),
        started.elapsed().as_secs_f64()
    );
    Ok(())
}

fn replay_check(
    defs: Arc<StaticData>,
    seed: u64,
    days: u32,
    bot: BotKind,
    driver: Option<AiDriver>,
    info: InfoMode,
) -> Result<()> {
    let mode = driver.as_ref().map(|d| format!("{:?}", d.pipeline().mode())).unwrap_or_else(|| "Off".into());
    println!(
        "重放检查：种子 {seed}，{days} 天，bot {bot}，原局 AI {mode}，行情情报 {}；重放时关闭 AI，只读命令日志",
        info.key()
    );
    let mut session = GameSession::new(defs, ScenarioId(0), seed)?;
    session.choose_info(info)?;
    let ai_commands = run(&mut session, bot, &driver, days, |_| Ok(()), |_| Ok(()))?;
    let original = session.world.state_hash();
    let replayed = session.replay()?.state_hash();
    println!("原局状态哈希：{original}");
    println!("重放状态哈希：{replayed}（日志 {} 条命令，其中 AI {ai_commands} 条）", session.log().len());
    if original != replayed {
        bail!("重放不一致");
    }
    println!("重放一致：{original}");
    Ok(())
}

/// 主角身世（data/captain.toml）的一行摘要。
fn captain_summary(defs: &StaticData) -> String {
    let c = &defs.captain;
    if !c.enabled() {
        return "主角身世：未启用（没有 captain.toml）".into();
    }
    let p = &c.points;
    let legacy = c.signs.iter().filter(|s| s.is_legacy()).count();
    format!(
        "主角身世：属性 {} 项、星座 {} 个（另有只为旧存档保留的旧版星宫 {} 个）、身世问题 {} 道（选项 {} 个）；\
         开局年龄 {}–{} 岁（缺省 {} 岁）；起点 {}、自由分配 {} 点、开局上限 {}、开局算学 {} 即为算学奇才",
        c.attributes.len(),
        c.signs.len() - legacy,
        legacy,
        c.questions.len(),
        c.options.len(),
        p.age_min,
        p.age_max,
        p.age_default,
        p.base,
        p.free,
        p.creation_cap,
        p.genius_numeracy
    )
}

/// 第八批 E4 的经济数据（docs/ECONOMY.md 6.4、6.5）：人口、需求层级、城镇工坊与配方的投入产出。
/// 按基准价亏本（产出价值 < 原料价值）或定价远高于原料（> 2.5 倍）的加工配方逐条警告（不算校验失败）。
fn economy_summary(defs: &manifest_core::StaticData) -> Vec<String> {
    let r = &defs.rules.population;
    let towns: Vec<_> = defs.locations.iter().filter(|l| !l.is_site() && !l.market.is_empty()).collect();
    let people: i64 = towns.iter().map(|l| manifest_core::development::initial_population(defs, l.development)).sum();
    let tiers = manifest_data::need_counts(&defs.goods);
    let groups = defs.goods.iter().filter_map(|g| g.group).max().map(|g| g as usize + 1).unwrap_or(0);
    let shops: usize = defs.locations.iter().map(|l| l.workshops.len()).sum();
    let shop_towns = defs.locations.iter().filter(|l| !l.workshops.is_empty()).count();
    let rho = manifest_data::spectral_radius(&manifest_data::input_coefficients(&defs.recipes, defs.goods.len()));
    let ratios: Vec<(String, f64)> = defs
        .recipes
        .iter()
        .filter_map(|x| manifest_data::recipe_value_ratio(x, &defs.goods).map(|v| (x.key.clone(), v)))
        .collect();
    let (lo, hi) = ratios.iter().fold((f64::MAX, 0.0_f64), |(a, b), (_, v)| (a.min(*v), b.max(*v)));
    let on = |b: bool| if b { "打开" } else { "关闭" };
    let mut out = vec![
        format!(
            "人口与需求（{}）：港口与城市 {} 处，开局人口合计 {people}（发展度 × {}）；需求层级 必需 {}、舒适 {}、奢侈 {} 种，替代组 {groups} 个",
            on(r.enabled),
            towns.len(),
            r.per_development,
            tiers[0],
            tiers[1],
            tiers[2]
        ),
        format!(
            "城镇工坊（{}）：{shops} 座（{shop_towns} 处）；投入产出：加工配方 {} 个，系数矩阵谱半径 ρ = {rho:.3}（Hawkins–Simon 条件{}），按基准价的产出价值 / 原料价值 {lo:.2}–{hi:.2} 倍",
            on(defs.rules.workshops.enabled),
            ratios.len(),
            if rho < 1.0 { "成立" } else { "不成立" }
        ),
    ];
    for (key, v) in ratios.iter().filter(|(_, v)| !(1.0..=2.5).contains(v)) {
        out.push(format!(
            "  - 警告：配方“{key}”按基准价的产出价值 / 原料价值为 {v:.2} 倍（{}）",
            if *v < 1.0 { "亏本，工坊会停工" } else { "产出定价远高于原料" }
        ));
    }
    // 开放市场：各地收购全部商品，出售的以特产为主
    let om = &defs.rules.open_market;
    let markets: Vec<manifest_core::LocId> =
        defs.loc_ids().filter(|l| !defs.loc(*l).is_site() && !defs.loc(*l).market.is_empty()).collect();
    let mut sizes: Vec<usize> = markets.iter().map(|l| manifest_core::open_market::sale_list(defs, *l).len()).collect();
    sizes.sort_unstable();
    let sold: usize = sizes.iter().sum();
    let specialties: usize = markets.iter().map(|l| defs.loc(*l).market.iter().filter(|m| m.specialty).count()).sum();
    let extras: usize = manifest_core::open_market::extra_markets(defs).iter().map(|v| v.len()).sum();
    if let (Some(lo), Some(hi)) = (sizes.first(), sizes.last()) {
        out.push(format!(
            "开放市场（{}）：只收不卖的进口条目 {extras} 条；出售清单每处 {lo}–{hi} 种（中位数 {}），特产占 {}%",
            on(om.enabled),
            sizes[sizes.len() / 2],
            specialties * 100 / sold.max(1)
        ));
    }
    out
}

fn english_coverage_report(missing: usize, issues: Vec<manifest_data::DataIssue>) -> Result<String> {
    let issues: Vec<_> = issues.into_iter().filter(|issue| issue.message != "已有英文覆盖不完整").collect();
    if !issues.is_empty() {
        return Err(manifest_data::DataError { issues }.into());
    }
    Ok(format!("语言覆盖（en）校验通过：缺失 {missing} 条（缺失的条目显示中文）"))
}

fn validate_draft(data_dir: &Path, world: &str) -> Result<()> {
    let (report, missing) = manifest_data::worlds::validate_draft_world_with_english_warnings(data_dir, world)?;
    println!("{}", english_coverage_report(missing, Vec::new())?);
    println!("草稿检查：严格 schema、完整分片清单、key 唯一、已知引用与日期；地图与开局门禁保留");
    for (table, count) in &report.counts {
        println!("  {table}: {count}");
    }
    println!("仅中文的分片数：{}", report.chinese_only_fragments);
    let mut unresolved: std::collections::BTreeMap<&str, std::collections::BTreeSet<&str>> =
        std::collections::BTreeMap::new();
    for reference in &report.unresolved {
        unresolved.entry(&reference.table).or_default().insert(&reference.key);
    }
    for (table, keys) in unresolved {
        let label = if table == "events" { "event data" } else { table };
        println!("Unresolved {label}: {}", keys.into_iter().collect::<Vec<_>>().join(", "));
    }
    for reference in &report.unresolved {
        println!(
            "  待接线 {}：{}.{} -> {}/{}",
            reference.file, reference.item, reference.field, reference.table, reference.key
        );
    }
    println!(
        "草稿数据校验通过：{}；分片 {}，英文字符串 {}，已解析引用 {}，未解析引用 {}；草稿仅校验资源，不可开局",
        report.key,
        report.files.len(),
        report.translated_strings,
        report.resolved_references,
        report.unresolved.len()
    );
    Ok(())
}

fn validate(dir: &Option<PathBuf>, world: &str) -> Result<()> {
    let data_dir = match dir {
        Some(d) => d.clone(),
        None => manifest_data::find_data_dir().context("找不到 data/ 目录")?,
    };
    let source = manifest_data::resolve_world(&data_dir, world)?;
    if source.manifest.draft {
        return validate_draft(&data_dir, world);
    }
    let defs = load_defs(dir, world)?;
    let ai = manifest_data::ai_content::load_world_ai_content(&source)?;
    let texts = manifest_data::locale::load_world_locale(&source, manifest_data::Locale::ZhCn, &defs, &ai).texts;
    let placeholders = texts.placeholder_reasons();
    println!(
        "提醒：已登记原因码的中文占位 {} 条；前二十条：{}",
        placeholders.len(),
        placeholders.iter().take(20).copied().collect::<Vec<_>>().join("、")
    );
    // 组合事件的离线原型与效果词表（effects.toml）的一致性
    let issues = manifest_data::check_against_data(&ai, &defs);
    if !issues.is_empty() {
        let list: Vec<String> = issues.iter().map(|i| format!("  - {i}")).collect();
        bail!("组合事件模板与 effects.toml 不一致，共 {} 个问题：\n{}", issues.len(), list.join("\n"));
    }
    println!(
        "组合事件：效果词表 {} 种（每事件至多 {} 条，强度预算 {}，冷却 {} 天，每年至多 {} 个），离线原型 {} 个",
        defs.composed.effects.len(),
        defs.composed.max_effects,
        manifest_core::composed::fx_short(defs.composed.budget),
        defs.composed.cooldown_days,
        defs.composed.max_per_year,
        ai.templates.composed.archetypes.len()
    );
    println!(
        "AI 内容校验通过：提示词模板 {} 份（版本 {}），事件类型 {} 种",
        ai.prompts.len(),
        ai.prompts.values().map(|p| format!("{}@{}", p.kind.key(), p.version)).collect::<Vec<_>>().join(" "),
        defs.events.len()
    );
    println!("{}", weather_stats(&defs));
    println!("{}", captain_summary(&defs));
    for line in economy_summary(&defs) {
        println!("{line}");
    }
    // 地理图层（EXPANSION §10.3，均可选）
    let geo = &defs.geography;
    let has = |present: bool| if present { "有" } else { "无（按旧规则）" };
    println!(
        "地理图层：高程 {}、植被 {}、河流 {} 条、地标 {} 处",
        has(!geo.relief.is_empty()),
        has(!geo.biomes.is_empty()),
        geo.rivers.len(),
        geo.landmarks.len()
    );
    // 先中文、英文以后补；所有世界的缺译都回退中文，坏覆盖仍拒绝。
    if world == "classic" {
        let zh_texts = manifest_data::load_texts(&data_dir).map_err(|e| anyhow::anyhow!("{e}"))?;
        println!("后端显示文字（data/texts.toml）：{} 条", zh_texts.len());
    }
    // 沿用原有检查范围；testbed 等双语继承包不新增“经典译文必须匹配替换后条目”的门槛。
    let (english, issues) = if world == "classic" {
        (manifest_data::load_locale(&data_dir, manifest_data::Locale::En, &defs, &ai)?, Vec::new())
    } else if !source.manifest.requires_english() {
        manifest_data::locale::load_world_locale_lenient(&source, manifest_data::Locale::En, &defs, &ai)
    } else {
        (manifest_data::locale::load_world_locale(&source, manifest_data::Locale::En, &defs, &ai), Vec::new())
    };
    println!("{}", english_coverage_report(english.missing.len(), issues)?);
    let (variant, issues) =
        manifest_data::locale::load_world_locale_lenient(&source, manifest_data::Locale::ZhCnGemini, &defs, &ai);
    if !issues.is_empty() {
        return Err(manifest_data::DataError { issues }.into());
    }
    println!(
        "语言变体（{}）：覆盖 {} 条 / {} 字，过期 {} 条（回退中文）",
        variant.locale.code(),
        variant.variant_coverage.entries,
        variant.variant_coverage.chars,
        variant.variant_coverage.stale
    );
    let ports = defs.locations.iter().filter(|l| l.is_port()).count();
    let sites = defs.site_ids().count();
    let cities = defs.locations.len() - ports - sites;
    let processed = defs.goods.iter().filter(|g| g.tier > 0).count();
    println!(
        "数据校验通过：港口 {ports}、内陆城市 {cities}、殖民点 {sites}、商品 {}（加工品 {processed}）、船型 {}、势力 {}、商会 {}、海区 {}、剧本 {}、道路 {}、驮畜 {}、配方 {}、期货交易所 {}（合约 {}）、航海士 {}、事件类型 {}、殖民地建筑 {}、发现物 {}；地图 {}×{}；货币 {}、纪年 {} {} 年起；数据哈希 {}",
        defs.goods.len(),
        defs.ships.len(),
        defs.factions.len(),
        defs.companies.len(),
        defs.regions.len(),
        defs.scenarios.len(),
        defs.roads.len(),
        defs.animals.len(),
        defs.recipes.len(),
        defs.exchanges.len(),
        defs.futures_specs.len(),
        defs.mates.len(),
        defs.events.len(),
        defs.colony_buildings.len(),
        defs.discoveries.len(),
        defs.map.width,
        defs.map.height,
        defs.rules.world.currency,
        defs.rules.world.era,
        defs.rules.world.start_year,
        &defs.meta.hash[..16],
    );
    if !defs.upbringing.families.is_empty() || !defs.guide.lines.is_empty() {
        let reach = manifest_core::upbringing::Reachability::new(&defs);
        let mut errors = reach.unreachable();
        println!("养成静态不可达 {} 条", errors.len());
        let guide = manifest_core::story2::guide::report(&defs, &reach);
        for warning in &guide.warnings {
            println!("警告：{warning}");
        }
        println!("引导四项检查：{:?}", guide.checks);
        errors.extend(guide.errors);
        if !errors.is_empty() {
            bail!("{}", errors.join("\n"));
        }
    }
    contract_candidate_summary(&defs);
    stage_unlock_summary(&defs);
    Ok(())
}

/// 剧情可达检查：两套判定的结果合在一起打印，任何一条都算失败。
fn story_reach(defs: &StaticData) -> Result<()> {
    let graph = manifest_core::story2::graph::validate_reachability(defs);
    let upbringing = manifest_core::upbringing::Reachability::new(defs).unreachable();
    for e in &graph {
        println!("故事图：{e}");
    }
    for e in &upbringing {
        println!("养成可达：{e}");
    }
    println!("故事图问题 {} 条，养成静态不可达 {} 条", graph.len(), upbringing.len());
    if graph.is_empty() && upbringing.is_empty() { Ok(()) } else { bail!("剧情可达检查未通过") }
}

fn validate_worlds(dir: &Option<PathBuf>, world: Option<&str>) -> Result<()> {
    if let Some(world) = world {
        return validate(dir, world).with_context(|| format!("世界 {world} 校验失败"));
    }
    for world in manifest_data::worlds::validation_world_keys(&data_root(dir)?)? {
        if world != "classic" {
            println!("校验世界：{world}");
        }
        validate(dir, &world).with_context(|| format!("世界 {world} 校验失败"))?;
    }
    Ok(())
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let world = cli.world.as_deref().unwrap_or("classic");
    let language = manifest_data::Locale::parse(&cli.language).context("unknown_language")?;
    match cli.command {
        Cmd::ValidateData => validate_worlds(&cli.data, cli.world.as_deref()),
        Cmd::ProfileStartup(args) => profile::run(cli.data, args),
        Cmd::ProfileUpbringing(args) => {
            let key = cli.world.as_deref().unwrap_or("terra16");
            let defs = load_defs(&cli.data, key)?;
            let locale = locale_tools::display(&data_root(&cli.data)?, key, language, &defs)?;
            profile_upbringing::run(defs, &locale, args)
        }
        Cmd::Simulate(args) => {
            let defs = load_defs(&cli.data, world)?;
            let locale = locale_tools::display(&data_root(&cli.data)?, world, language, &defs)?;
            let driver = ai_driver(&cli.data, world, parse_ai(&args.ai)?)?;
            simulate(defs, &locale.defs, args, driver)
        }
        Cmd::ReplayCheck { seed, days, bot, ai, info } => {
            let defs = load_defs(&cli.data, world)?;
            let bot: BotKind = bot.parse().map_err(anyhow::Error::msg)?;
            let driver = ai_driver(&cli.data, world, parse_ai(&ai)?)?;
            replay_check(defs, seed, days, bot, driver, parse_info(&info)?)
        }
        Cmd::Balance(args) => balance(load_defs(&cli.data, world)?, &cli.data, args),
        Cmd::UpbringingCadence { family } => {
            let defs = load_defs(&cli.data, cli.world.as_deref().unwrap_or("terra16"))?;
            if let Some(key) = &family
                && defs.upbringing.family(key).is_none()
            {
                bail!("未知家庭 {key}");
            }
            println!(
                "{}",
                serde_json::to_string_pretty(&manifest_core::upbringing::cadence_report(&defs, family.as_deref()))?
            );
            Ok(())
        }
        Cmd::UpbringingActGen { family, write } => {
            let key = cli.world.as_deref().unwrap_or("terra16");
            let defs = load_defs(&cli.data, key)?;
            let generated = manifest_sim::upbringing_act::generate(&defs, &family)?;
            if write {
                let target = data_root(&cli.data)?
                    .join("worlds")
                    .join(key)
                    .join("upbringing")
                    .join("act")
                    .join(format!("generated_{family}.toml"));
                std::fs::write(&target, generated)?;
                println!("{}", target.display());
            } else {
                print!("{generated}");
            }
            Ok(())
        }
        Cmd::UpbringingActReport { family, seed, seeds, json, out, strategies, save_dir, sailing } => {
            let defs = load_defs(&cli.data, cli.world.as_deref().unwrap_or("terra16"))?;
            let seeds = seed.map(|seed| vec![seed]).or(seeds).unwrap_or_else(|| vec![42, 7, 202]);
            let report = manifest_sim::upbringing_act::report(
                defs,
                &family,
                &seeds,
                &strategies,
                save_dir.is_some(),
                sailing.as_deref() == Some("shuttle"),
            )?;
            let mut markdown = report.markdown();
            if let Some(path) = &out {
                std::fs::write(path, &markdown).with_context(|| format!("write {}", path.display()))?;
            }
            if let Some(dir) = save_dir {
                let app = act_report::app(&data_root(&cli.data)?, &dir)?;
                for saved in &report.graduation_saves {
                    let checked = act_report::save(&app, &saved.slot, &saved.save)?;
                    markdown.push_str(&format!("\nsave_check={}\n", serde_json::to_string(&checked)?));
                    if let Some(path) = &out {
                        std::fs::write(path, &markdown).with_context(|| format!("write {}", path.display()))?;
                    }
                }
            }
            if let Some(path) = out {
                std::fs::write(&path, &markdown).with_context(|| format!("write {}", path.display()))?;
            } else {
                print!("{markdown}");
            }
            if let Some(path) = json {
                std::fs::write(&path, serde_json::to_vec_pretty(&report)?)
                    .with_context(|| format!("write {}", path.display()))?;
            }
            Ok(())
        }
        Cmd::UpbringingActView { weeks, stop, roundtrip, ill, voyage } => {
            let key = cli.world.as_deref().unwrap_or("terra16");
            let defs = load_defs(&cli.data, key)?;
            let source = manifest_data::resolve_world(&data_root(&cli.data)?, key)?;
            let ai = manifest_data::ai_content::load_world_ai_content(&source)?;
            let locale = manifest_data::locale::load_world_locale(&source, language, &defs, &ai);
            upbringing_act_view(defs, &locale, weeks, &stop, roundtrip, ill, voyage.as_deref())
        }
        Cmd::UpbringingActSnapshot { save } => {
            let save = manifest_sim::storage::read(&save)?;
            let key = cli.world.as_deref().unwrap_or(&save.world);
            let defs = load_defs(&cli.data, key)?;
            save.check_compatible(&defs)?;
            let source = manifest_data::resolve_world(&data_root(&cli.data)?, key)?;
            let ai = manifest_data::ai_content::load_world_ai_content(&source)?;
            let locale = manifest_data::locale::load_world_locale(&source, manifest_data::Locale::ZhCn, &defs, &ai);
            let saved_data_hash = save.data.hash.clone();
            let stored = World { defs: defs.clone(), state: save.snapshot.clone() };
            let checks: Vec<_> = stored.state.upbringing.as_ref().map(|s| {
                s.act.markers.iter().filter(|(_, m)| m.hanging(s.act.week)).map(|(track, m)| {
                    let error = manifest_core::Command::DoAction { owner: OwnerId::Player, place: m.place.clone(),
                        action: manifest_core::upbringing::ActAction::Marker { track: track.clone() } }.validate(&stored).err();
                    let talk = m.person.as_deref().and_then(|person| stored.act_presence(person).map(|place| {
                        let error = manifest_core::Command::DoAction { owner: OwnerId::Player, place: place.into(),
                            action: manifest_core::upbringing::ActAction::Talk { person: person.into() } }.validate(&stored).err();
                        serde_json::json!({"person":person,"place":place,"marker":stored.act_marker_for_person(person),
                            "openable":error.is_none(),"reason":error.as_ref().map(manifest_core::CommandError::code)})
                    }));
                    let entered = stored.state.story2.tracks.get(track).map_or(stored.day(), |s| s.entered);
                    let conditions: Vec<_> = stored.defs.story2.track(track).and_then(|t| t.chapter(&m.chapter))
                        .into_iter().flat_map(|c| &c.when).map(|condition| serde_json::json!({
                            "condition":format!("{condition:?}"),"passed":stored.story2_conditions(std::slice::from_ref(condition),entered)
                        })).collect();
                    serde_json::json!({"track":track,"chapter":m.chapter,"place":m.place,
                        "openable":error.is_none(),"reason":error.as_ref().map(manifest_core::CommandError::code),
                        "visible":stored.act_marker_visible(track),"since_week":m.since_week,"expires_week":m.expires_week,
                        "conditions":conditions,"checks":stored.act_marker_checks(&m.place,track),"talk":talk})
                }).collect::<Vec<_>>()
            }).unwrap_or_default();
            let world = GameSession::from_save(defs, save)?.world;
            let ctx = manifest_appcore::views::Ctx {
                texts: Some(&locale.texts),
                ..manifest_appcore::views::Ctx::plain(&world.defs)
            };
            let mut view = manifest_appcore::upbringing_view::act::view(ctx, &world);
            view["upbringing_act_texts"] = serde_json::json!(manifest_appcore::upbringing_view::act::texts(ctx));
            view["stored_marker_checks"] = serde_json::json!(checks);
            view["data_hashes"] = serde_json::json!({"saved":saved_data_hash,"current":world.defs.meta.hash});
            println!("{}", serde_json::to_string_pretty(&view)?);
            Ok(())
        }
        Cmd::LocaleExport { variant, file } => locale_tools::export(&data_root(&cli.data)?, world, &variant, &file),
        Cmd::LocaleImport { input, prune_stale } => {
            locale_tools::import(&data_root(&cli.data)?, world, &input, prune_stale)
        }
        Cmd::StoryReach => story_reach(&*load_defs(&cli.data, cli.world.as_deref().unwrap_or("terra16"))?),
        Cmd::UpbringingCurve { family } => {
            upbringing_curve(&*load_defs(&cli.data, cli.world.as_deref().unwrap_or("terra16"))?, family.as_deref())
        }
        Cmd::UpbringingThresholds { out, changed } => {
            upbringing_thresholds(&load_defs(&cli.data, cli.world.as_deref().unwrap_or("terra16"))?, out, changed)
        }
        Cmd::UpbringingRuns { families, presets, seeds, register_every, threads } => {
            let defs = load_defs(&cli.data, cli.world.as_deref().unwrap_or("terra16"))?;
            upbringing_runs(defs, families, &presets, &seeds, register_every, threads)
        }
        Cmd::PacingAudit {
            families,
            presets,
            seeds,
            register_every,
            threads,
            sea_days,
            out,
            gate,
            daily,
            window_days,
            window_soft,
            max_defer_days,
        } => {
            let mut defs = load_defs(&cli.data, cli.world.as_deref().unwrap_or("terra16"))?;
            // 命令行覆盖数据包的节奏规则（只影响这一次审计；报告里写明用的是哪一组）。
            let mut rules = defs.rules.pacing.clone();
            rules.enabled = match gate.as_str() {
                "data" => rules.enabled,
                "on" => true,
                "off" => false,
                other => bail!("--gate 只能是 data、on 或 off：{other}"),
            };
            rules.daily = daily.unwrap_or(rules.daily);
            rules.window_days = window_days.unwrap_or(rules.window_days);
            rules.window_soft = window_soft.unwrap_or(rules.window_soft);
            rules.max_defer_days = max_defer_days.unwrap_or(rules.max_defer_days);
            if let Some((field, problem)) = rules.problems().into_iter().next() {
                bail!("节奏规则 {field} {problem}");
            }
            if rules != defs.rules.pacing {
                Arc::make_mut(&mut defs).rules.pacing = rules;
            }
            let families = match families {
                Some(list) => split_list(&list),
                None => all_families(&defs),
            };
            let config = manifest_sim::pacing_audit::AuditConfig {
                families,
                presets: split_list(&presets),
                seeds: parse_seeds(&seeds)?,
                register_every,
                threads,
                sea_days,
            };
            pacing_audit(defs, config, out)
        }
        Cmd::GuideReport { line, view } => guide_report(load_defs(&cli.data, world)?, line.as_deref(), view),
        Cmd::PilotReport { pairs, legs, save, from, to, via, month, pref, trace_day } => {
            let defs = load_defs(&cli.data, cli.world.as_deref().unwrap_or("terra16"))?;
            if let Some(save) = save {
                pilot_replay(defs, &save, from.as_deref().context("from")?, to.as_deref().context("to")?, &via)
            } else if let Some(from) = from {
                pilot_route_trace(
                    defs,
                    &from,
                    to.as_deref().context("to")?,
                    month.unwrap_or(1),
                    pref.as_deref().unwrap_or("distance"),
                    trace_day,
                )
            } else {
                pilot_report(defs, pairs.as_deref(), legs)
            }
        }
    }
}

/// 九位主角的家庭键（`upbringing-runs` 的缺省）。
const HEROES: [&str; 9] = ["mio", "lieve", "najma", "lin_wandeng", "ix_nikte", "noel", "tariq", "kaicili", "baraka"];

fn split_list(list: &str) -> Vec<String> {
    list.split(',').map(|s| s.trim().to_owned()).filter(|s| !s.is_empty()).collect()
}

fn parse_seeds(seeds: &str) -> Result<Vec<u64>> {
    split_list(seeds).iter().map(|seed| seed.parse().with_context(|| format!("种子不是整数：{seed}"))).collect()
}

/// 全部家庭：九位主角在前（照 `upbringing-runs` 的顺序），其余（自创出身）按数据里的顺序。
fn all_families(defs: &StaticData) -> Vec<String> {
    let known = |key: &str| defs.upbringing.family(key).is_some();
    let mut out: Vec<String> = HEROES.iter().filter(|k| known(k)).map(|k| (*k).to_owned()).collect();
    out.extend(defs.upbringing.families.iter().map(|f| f.key.clone()).filter(|k| !HEROES.contains(&k.as_str())));
    out
}

/// P11：事件节奏审计。报告只取决于数据、节奏规则与种子；发现不通畅（没结业、时钟卡死、回应不收敛、出错，
/// 或者闸该放不放、养成期某一天超出了闸的口径）时以失败退出。
fn pacing_audit(
    defs: Arc<StaticData>,
    config: manifest_sim::pacing_audit::AuditConfig,
    out: Option<PathBuf>,
) -> Result<()> {
    use manifest_sim::pacing_audit::{audit, markdown, report_json};
    if config.families.is_empty() || config.presets.is_empty() || config.seeds.is_empty() {
        bail!("families、presets 与 seeds 都不能为空");
    }
    for family in &config.families {
        if defs.upbringing.family(family).is_none() {
            bail!("未知家庭：{family}");
        }
    }
    let started = Instant::now();
    let report = audit(defs, &config);
    let text = markdown(&report);
    match &out {
        Some(dir) => {
            std::fs::create_dir_all(dir).with_context(|| format!("无法创建 {}", dir.display()))?;
            let json = dir.join("pacing-audit.json");
            std::fs::write(&json, report_json(&report) + "\n").with_context(|| format!("写入 {}", json.display()))?;
            let md = dir.join("pacing-audit.md");
            std::fs::write(&md, &text).with_context(|| format!("写入 {}", md.display()))?;
            eprintln!("报告已写入 {} 与 {}", json.display(), md.display());
        }
        None => println!("{text}"),
    }
    let sections = [Some(&report.upbringing), report.sea_after.as_ref(), report.sea_free.as_ref()];
    let runs: u32 = sections.iter().flatten().map(|s| s.flow.runs).sum();
    eprintln!("事件节奏审计完成：{runs} 局，耗时 {:.1} 秒", started.elapsed().as_secs_f64());
    let stuck: u32 = sections.iter().flatten().map(|s| s.flow.bot_abandoned).sum();
    if stuck > 0 {
        eprintln!("注意：有 {stuck} 次排在队首的章节一个选项也交不上（章节见报告的“通畅”一节）");
    }
    let mut blocked: Vec<String> = sections
        .iter()
        .flatten()
        .filter(|s| {
            let f = &s.flow;
            f.finished < f.runs || f.failed > 0 || f.stalls > 0 || f.diverged > 0
        })
        .map(|s| {
            let f = &s.flow;
            format!(
                "{} 局里完成 {}、出错 {}、时钟卡死 {} 天、回应不收敛 {} 天",
                f.runs, f.finished, f.failed, f.stalls, f.diverged
            )
        })
        .collect();
    // 闸自己的规矩：按着的事该放就放（三段都查）；养成期单日的独立打断不超出闸的口径。
    let violations: u32 = sections.iter().flatten().filter_map(|s| s.gate.as_ref()).map(|g| g.violations).sum();
    if violations > 0 {
        blocked.push(format!("闸刚跑完却有该放没放的事 {violations} 次"));
    }
    if let Some(g) = report.upbringing.gate.as_ref().filter(|g| g.over_days > 0) {
        blocked.push(format!("养成期有 {} 天的独立打断超出闸的口径（{}）", g.over_days, g.over_examples.join("、")));
    }
    if !blocked.is_empty() {
        bail!("事件不通畅：{}", blocked.join("；"));
    }
    Ok(())
}

/// U04 审查：养成整局的比赛与结局统计，每局一行 JSON，最后一行是汇总。
fn upbringing_runs(
    defs: Arc<StaticData>,
    families: Option<String>,
    presets: &str,
    seeds: &str,
    register_every: u32,
    threads: usize,
) -> Result<()> {
    use manifest_sim::upbringing_runs::{RunConfig, run_many};
    let families: Vec<String> = match families {
        Some(list) => list.split(',').map(|s| s.trim().to_owned()).filter(|s| !s.is_empty()).collect(),
        None => HEROES.iter().map(|s| (*s).to_owned()).collect(),
    };
    let mut configs = Vec::new();
    for seed in seeds.split(',').filter(|s| !s.trim().is_empty()) {
        let seed: u64 = seed.trim().parse().with_context(|| format!("种子不是整数：{seed}"))?;
        for preset in presets.split(',').map(str::trim).filter(|s| !s.is_empty()) {
            for family in &families {
                configs.push(RunConfig { family: family.clone(), preset: preset.into(), seed, register_every });
            }
        }
    }
    let started = Instant::now();
    let reports = run_many(defs, &configs, threads);
    for r in &reports {
        println!("{}", manifest_sim::upbringing_runs::report_json(r));
    }
    println!("{}", manifest_sim::upbringing_runs::summary_json(&reports, started.elapsed().as_secs()));
    Ok(())
}

/// U02：打印养成期中位成长曲线（每月月初；属性为成长点、技能为经验、评价为评价分）。
fn upbringing_curve(defs: &StaticData, family: Option<&str>) -> Result<()> {
    println!("{}", manifest_sim::upbringing_curve::report_json(defs, family)?);
    Ok(())
}

/// U02：按曲线生成门槛方案。
fn upbringing_thresholds(defs: &Arc<StaticData>, out: Option<PathBuf>, changed: bool) -> Result<()> {
    let curves = manifest_sim::upbringing_thresholds::curves(defs);
    let items: Vec<_> = manifest_sim::upbringing_thresholds::generate(defs, &curves)
        .into_iter()
        .filter(|t| !changed || t.new != t.old)
        .collect();
    let text = manifest_sim::upbringing_thresholds::plan_json(&items);
    match out {
        Some(path) => {
            std::fs::write(&path, text + "\n").with_context(|| format!("写入 {}", path.display()))?;
            eprintln!("门槛方案：{} 条（已写入 {}）", items.len(), path.display());
        }
        None => println!("{text}"),
    }
    Ok(())
}

/// 只运行静态推导和读模型，不运行日结或故事机器人。
fn guide_report(defs: Arc<StaticData>, line: Option<&str>, view: bool) -> Result<()> {
    let mut chosen = (*defs).clone();
    if let Some(key) = line {
        if !chosen.guide.lines.iter().any(|l| l.key == key) {
            bail!("没有引导线 {key}");
        }
        chosen.guide.lines.retain(|l| l.key == key);
    }
    if view {
        chosen.rules.quests.guide = true;
    }
    let defs = Arc::new(chosen);
    if view {
        let mut snapshots = Vec::new();
        for line in &defs.guide.lines {
            for phase in
                [manifest_core::story2::guide_defs::Phase::Upbringing, manifest_core::story2::guide_defs::Phase::Voyage]
            {
                let mut world =
                    manifest_core::story2::guide::opening_world(&defs, line, phase).map_err(anyhow::Error::msg)?;
                world.refresh_story2();
                let ctx = manifest_appcore::views::Ctx::plain(&world.defs);
                snapshots.push(serde_json::json!({"line":line.key,"phase":phase,"quest_log":manifest_appcore::quest_view::quest_log(ctx,&world),"quest_pin":manifest_appcore::quest_view::quest_pin(ctx,&world),"deeds":world.state.story2.deeds}));
            }
        }
        println!("{}", serde_json::to_string_pretty(&snapshots)?);
        return Ok(());
    }
    let reach = manifest_core::upbringing::Reachability::new(&defs);
    let report = manifest_core::story2::guide::report(&defs, &reach);
    for s in &report.steps {
        let d = defs.calendar.date_of(s.day);
        println!(
            "{} #{} {}:{} | {:?} | teaches={} | {} | day={}-{}-{} here={} cash={} known={}",
            s.line,
            s.number,
            s.track,
            s.chapter,
            s.phase,
            s.teaches.join(","),
            if s.errors.is_empty() { "OK" } else { "ERROR" },
            defs.rules.world.start_year + i64::from(d.year) - 1,
            d.month,
            d.day,
            s.here.as_deref().unwrap_or("none"),
            s.cash,
            s.known
        );
        println!("  needs: {}", s.needs.join("; "));
        println!("  gives: {}", s.gives.join("; "));
        if !s.unguaranteed.is_empty() {
            println!("  无保底：{}", s.unguaranteed.join("; "));
        }
        if !s.unjudged.is_empty() {
            println!("  未判：{}", s.unjudged.join("; "));
        }
    }
    for warning in &report.warnings {
        println!("警告：{warning}");
    }
    for error in &report.errors {
        println!("{error}");
    }
    println!("引导四项检查：{:?}", report.checks);
    if report.errors.is_empty() { Ok(()) } else { bail!("引导静态检查未通过") }
}

/// T04：仅核对开局状态与算式，不推进日结、不改变校验结论。
fn contract_candidate_summary(defs: &Arc<StaticData>) {
    use manifest_core::contract::{
        fair_reward_v2, market_reserved, nearest_source, need_days, small_candidates, small_qty,
    };
    if !defs.rules.contracts.v2.enabled {
        return;
    }
    let scenario = defs.scenarios.iter().position(|s| s.key == "mio_1553").unwrap_or(0);
    let world = match World::new(defs.clone(), ScenarioId::from_idx(scenario), 42) {
        Ok(world) => world,
        Err(error) => {
            println!("T04 summary unavailable error={error}");
            return;
        }
    };
    let mut empty = Vec::new();
    for faction in defs.faction_ids() {
        let cands = small_candidates(&world, faction);
        let key = &defs.faction(faction).key;
        if defs.rules.contracts.v2.reserve_market {
            let reserved_pairs: usize = defs
                .port_ids()
                .filter(|loc| world.location_faction(*loc) == faction)
                .map(|loc| {
                    world.state.locations[loc.idx()].market.keys().filter(|g| market_reserved(&world, loc, **g)).count()
                })
                .sum();
            println!("T04 small_candidates faction={key} count={} reserved_pairs={reserved_pairs}", cands.len());
        } else {
            println!("T04 small_candidates faction={key} count={}", cands.len());
        }
        if cands.is_empty() {
            empty.push(key.as_str());
        }
        let japanese =
            defs.port_ids().any(|l| world.location_faction(l) == faction && defs.loc(l).culture == "japanese");
        if japanese {
            for (to, good, _) in cands {
                if let Some((source, cells)) = nearest_source(defs, good, to) {
                    println!(
                        "T04 japan faction={key} to={} good={} source={} x={cells} t={}",
                        defs.loc(to).key,
                        defs.good(good).key,
                        defs.loc(source).key,
                        need_days(defs, cells)
                    );
                }
            }
        }
    }
    println!("T04 no_small_candidates count={} factions={}", empty.len(), empty.join(","));
    let r = &defs.rules.contracts.v2;
    if let Some(to) = defs.find_loc("shimoda_tosa") {
        let eligible = small_candidates(&world, world.location_faction(to));
        println!(
            "T04 shimoda candidates={} open={}",
            eligible.iter().filter(|c| c.0 == to).count(),
            world.location_open(to)
        );
        // 即使没有可发布的候选，也报出清单进口货的过滤原因与公式值，避免摘要无声省略断点。
        for (&good, _) in world.state.locations[to.idx()]
            .market
            .iter()
            .filter(|(good, e)| !e.specialty && !e.extra && !defs.good(**good).license)
        {
            let Some((source, cells)) = nearest_source(defs, good, to) else { continue };
            let need = i64::from(need_days(defs, cells));
            let sold = if r.reserve_market {
                manifest_core::open_market::sells_listed(defs, to, good)
            } else {
                manifest_core::open_market::sells(defs, to, good)
            };
            let min_cells = if r.reserve_market { r.small_min_cells } else { r.min_cells };
            let allowed = eligible.iter().any(|c| c.0 == to && c.1 == good);
            let filter = if sold && cells < min_cells && r.reserve_market {
                "destination_listed+too_near"
            } else if sold && r.reserve_market {
                "destination_listed"
            } else if sold && cells < min_cells {
                "destination_sells+too_near"
            } else if sold {
                "destination_sells"
            } else if cells < min_cells {
                "too_near"
            } else {
                "none"
            };
            let min_days = (need * r.slack_pct[0] / 100).clamp(20, 180);
            let max_days = (need * r.slack_pct[1] / 100).clamp(20, 180);
            let qty_lo = small_qty(defs, good, r.small_value[0]);
            let qty_hi = small_qty(defs, good, r.small_value[1]);
            let lo = fair_reward_v2(defs, good, qty_lo, to, max_days).unwrap_or(0);
            let hi = fair_reward_v2(defs, good, qty_hi, to, min_days).unwrap_or(0);
            println!(
                "T04 shimoda good={} source={} eligible={allowed} filter={filter} x={cells} t={need} qty={qty_lo}..{qty_hi} value={}..{} D={min_days}..{max_days} R_formula={lo}..{hi}",
                defs.good(good).key,
                defs.loc(source).key,
                defs.good(good).base_price * qty_lo,
                defs.good(good).base_price * qty_hi
            );
            if defs.good(good).key == "cloth" {
                println!(
                    "T04 shimoda cloth eligible={allowed} qty=40 R_formula={}..{}",
                    fair_reward_v2(defs, good, 40, to, max_days).unwrap_or(0),
                    fair_reward_v2(defs, good, 40, to, min_days).unwrap_or(0)
                );
            }
        }
    }
}

/// H10b：只走分钟积分，不运行经济、剧情或多种子模拟。
fn pilot_report(mut defs: Arc<StaticData>, pairs_file: Option<&Path>, legs: bool) -> Result<()> {
    use manifest_core::{
        LocId,
        mates::{MateRole, RoleTarget},
        navigation::{
            SubCell,
            routing::{NAVIGATOR_ROLE, RoutePref},
        },
        world::FleetLocation,
    };
    // 报告始终在内存副本中开启；验收失败时不改世界包的正式开关。
    Arc::make_mut(&mut defs).rules.autopilot.straighten = true;
    let defaults = [
        ("chios", "smyrna"),
        ("chios", "istanbul"),
        ("istanbul", "varna"),
        ("candia", "rhodes"),
        ("sakai", "noshima"),
        ("hakata", "funai"),
        ("nagasaki", "hirado"),
        ("malacca", "aceh_port"),
        ("malacca", "johor_port"),
        ("plymouth", "le_havre"),
        ("london", "dieppe"),
        ("copenhagen", "lubeck"),
        ("messina", "naples"),
        ("venice", "ragusa_port"),
        ("hormuz_port", "julfar"),
        ("havana", "santiago_cuba"),
        ("lisbon", "goa"),
        ("lisbon", "havana"),
        ("sakai", "hirado"),
        ("shimoda_tosa", "sakai"),
        ("london", "goa"),
        ("shimoda_tosa", "sakai"),
        ("sakai", "shimoda_tosa"),
        ("sakai", "noshima"),
        ("noshima", "sakai"),
        ("noshima", "hirado"),
        ("hirado", "noshima"),
        ("sakai", "hakata"),
        ("hakata", "sakai"),
        ("hirado", "hakata"),
        ("hakata", "hirado"),
        ("shimoda_tosa", "shimizu_tosa"),
        ("shimizu_tosa", "shimoda_tosa"),
    ];
    let pairs: Vec<[String; 2]> = match pairs_file {
        Some(path) => serde_json::from_reader(std::io::BufReader::new(std::fs::File::open(path)?))?,
        None => defaults.into_iter().map(|(a, b)| [a.into(), b.into()]).collect(),
    };
    let scenario = defs.find_scenario("free_1557").context("free_1557")?;
    let mut base = World::new(defs.clone(), scenario, 7)?;
    let mut h10b_defs = defs.clone();
    let h10b_rules = &mut Arc::make_mut(&mut h10b_defs).rules.autopilot;
    h10b_rules.weather_slack_pct = 0;
    h10b_rules.shore_lookahead_min = 0;
    h10b_rules.beat_angle_deg = 0;
    let mut baseline_defs = defs.clone();
    Arc::make_mut(&mut baseline_defs).rules.autopilot.beat_angle_deg = 0;
    let mut control_defs = defs.clone();
    Arc::make_mut(&mut control_defs).rules.autopilot.straighten = false;
    base.state.explore.cells.fill(u64::MAX);
    let fleet = base.flagship(OwnerId::Player).context("flagship")?;
    let navigator = defs.captain.roles.iter().position(|r| r.key == NAVIGATOR_ROLE).context("navigator")? as u16;
    for [from, to] in pairs {
        let loc = |key: &str| -> Result<LocId> { defs.find_loc(key).with_context(|| format!("location {key}")) };
        let (from_id, to_id) = (loc(&from)?, loc(&to)?);
        for pref in [RoutePref::Distance, RoutePref::Fastest, RoutePref::Coastal] {
            let mut world = base.clone();
            world.fleet_mut(fleet)?.location = FleetLocation::Docked(from_id);
            if pref.timed() {
                // 自由航海剧本没有已雇航海士；诊断只在内存里雇首位普通航海士。
                let id = world
                    .state
                    .mates
                    .iter()
                    .find(|(id, m)| {
                        m.owner.is_none()
                            && defs
                                .cast
                                .person(&defs.mate(**id).key)
                                .is_some_and(|p| p.mate.as_ref().is_some_and(|mate| mate.joinable))
                    })
                    .map(|(id, _)| *id)
                    .context("navigator fixture")?;
                let mate = world.state.mates.get_mut(&id).context("navigator fixture")?;
                mate.owner = Some(OwnerId::Player);
                mate.role = MateRole::Assigned { role: navigator, target: RoleTarget::Fleet(fleet) };
            }
            let f = world.fleet(fleet)?;
            let origin = SubCell::center(defs.loc(from_id).cell);
            let pref = world.resolve_route_pref(f, Some(pref))?;
            let route_start = Instant::now();
            let raw = world.planned_sea_path(f, origin.cell(), to_id, false, pref);
            let route_us = route_start.elapsed().as_micros();
            let mut pilot = match raw {
                Ok(p) => p,
                Err(e) => {
                    println!("{}", serde_json::json!({"from":from,"to":to,"pref":pref.key(),"error":e.code()}));
                    continue;
                }
            };
            let path_len = pilot.path.len();
            let old = pilot.clone();
            let mut h10b_world = world.clone();
            h10b_world.defs = h10b_defs.clone();
            let h10b_start = Instant::now();
            let (h10b_line, _) = h10b_world.straighten_measured(h10b_world.fleet(fleet)?, origin, &old, pref);
            let h10b_straighten_us = h10b_start.elapsed().as_micros();
            let mut h10b_pilot = old.clone();
            h10b_pilot.line = h10b_line;
            if let Some(line) = &h10b_pilot.line {
                h10b_pilot.step = line.corners[0] as usize;
            }
            let h10b = pilot_travel(&h10b_world, fleet, origin, to_id, h10b_pilot, legs, None)?;
            let start = Instant::now();
            let (line, stats) = world.straighten_measured(f, origin, &pilot, pref);
            let straighten_us = start.elapsed().as_micros();
            pilot.line = line;
            if let Some(line) = &pilot.line {
                pilot.step = line.corners[0] as usize;
            }
            let (coarse, line_length, corners, max_leg) = pilot_lengths(&defs, origin, &pilot);
            let mut baseline_world = world.clone();
            baseline_world.defs = baseline_defs.clone();
            // H10i：基线保留 H10h 的慢行，按旧速度重新拉直，逐日大角度换向也采用同一口径。
            let mut baseline_pilot =
                baseline_world.planned_sea_path(baseline_world.fleet(fleet)?, origin.cell(), to_id, false, pref)?;
            baseline_pilot.line =
                baseline_world.straighten(baseline_world.fleet(fleet)?, origin, &baseline_pilot, pref);
            if let Some(line) = &baseline_pilot.line {
                baseline_pilot.step = line.corners[0] as usize;
            }
            let baseline = pilot_travel(&baseline_world, fleet, origin, to_id, baseline_pilot, legs, None)?;
            let mut sailing = pilot_travel(&world, fleet, origin, to_id, pilot, legs, None)?;
            if let Some(legs) = &mut sailing.legs {
                for leg in legs.iter_mut().filter(|l| !l.straightened) {
                    if stats.weather_rejections.iter().any(|r| r.start == leg.start_step) {
                        leg.retained_reason = Some("actual_weather");
                    }
                }
            }
            // 同一条粗格路径的逐格对照也使用当前稳舵规则；历史旧法数值见 H10b2 交接表。
            let mut off = world.clone();
            off.defs = control_defs.clone();
            let control = pilot_travel(&off, fleet, origin, to_id, old, legs, None)?;
            println!(
                "{}",
                serde_json::json!({"from":from,"to":to,"pref":pref.key(),"path":path_len,
                "corners":corners,"max_leg":max_leg,"coarse_length_e4":coarse,"line_length_e4":line_length,
                "ratio":coarse as f64/line_length.max(1) as f64,"route_us":route_us,"straighten_us":straighten_us,
                "slow_sog":1,"coast_scan_limit":64,
                "coarse_lookups":stats.coarse_lookups,"fine_lookups":stats.fine_lookups,"candidates":stats.candidates,"budget_exhausted":stats.exhausted,
                "weather_rejected":stats.weather_rejections.len(),
                "weather_rejections":legs.then_some(&stats.weather_rejections),
                "h10b_straighten_us":h10b_straighten_us,"h10b":h10b,
                "baseline":baseline,"sailing":sailing,"control":control})
            );
        }
    }
    Ok(())
}

/// 与 99 行报告相同的船况、种子和寻路，只积分选中的偏好，并保留风流与逐分钟证据。
fn pilot_route_trace(
    defs: Arc<StaticData>,
    from: &str,
    to: &str,
    month: u32,
    pref: &str,
    trace_day: Option<u32>,
) -> Result<()> {
    use manifest_core::{
        mates::{MateRole, RoleTarget},
        navigation::{SubCell, routing::RoutePref},
        world::FleetLocation,
    };
    let pref = match pref {
        "fastest" => RoutePref::Fastest,
        "coastal" => RoutePref::Coastal,
        _ => RoutePref::Distance,
    };
    let mut world = World::new(defs.clone(), defs.find_scenario("free_1557").context("free_1557")?, 7)?;
    let date = defs.calendar.date_of(world.day());
    world.state.day = defs.calendar.day_of(manifest_core::calendar::Date { year: date.year, month, day: 1 })?;
    world.state.explore.cells.fill(u64::MAX);
    let fleet = world.flagship(OwnerId::Player).context("flagship")?;
    let from_id = defs.find_loc(from).context("from")?;
    let dest = defs.find_loc(to).context("to")?;
    world.fleet_mut(fleet)?.location = FleetLocation::Docked(from_id);
    if pref.timed() {
        let id = world
            .state
            .mates
            .iter()
            .find(|(id, m)| {
                m.owner.is_none()
                    && defs
                        .cast
                        .person(&defs.mate(**id).key)
                        .is_some_and(|p| p.mate.as_ref().is_some_and(|mate| mate.joinable))
            })
            .map(|(id, _)| *id)
            .context("navigator fixture")?;
        let role = defs.captain.roles.iter().position(|r| r.key == "navigator").context("navigator")? as u16;
        let mate = world.state.mates.get_mut(&id).context("navigator fixture")?;
        mate.owner = Some(OwnerId::Player);
        mate.role = MateRole::Assigned { role, target: RoleTarget::Fleet(fleet) };
    }
    let f = world.fleet(fleet)?;
    let origin = SubCell::center(defs.loc(from_id).cell);
    let mut pilot = world.planned_sea_path(f, origin.cell(), dest, false, pref)?;
    pilot.line = world.straighten(f, origin, &pilot, pref);
    if let Some(line) = &pilot.line {
        pilot.step = line.corners[0] as usize;
    }
    let travel = pilot_travel(&world, fleet, origin, dest, pilot, true, Some(trace_day.unwrap_or(0)))?;
    println!(
        "{}",
        serde_json::json!({"kind":"summary","from":from,"to":to,"month":month,"pref":pref.key(),"sailing":travel})
    );
    Ok(())
}

fn pilot_minute_json(p: &manifest_core::navigation::line_pilot::PilotMinute, day: u32) -> serde_json::Value {
    serde_json::json!({"kind":"minute","day":day,"minute":p.minute,
        "pos":p.pos,"mode":p.mode,"heading":p.heading,
        "ground_heading":pilot_bearing(p.velocity.map(|v| v as f64)),"velocity":p.velocity,
        "water_heading":pilot_bearing([p.velocity[0]-p.current[0],p.velocity[1]-p.current[1]].map(|v| v as f64)),
        "current":p.current,"aim":p.aim,"shore_blocked":p.shore_avoided,"backup":p.backup_used,"step":p.step,
        "weather":p.weather.map(|w|serde_json::json!({"region":w.region,"sky":w.sky,
            "wind_dir":w.sea.wind_dir,"wind_strength":w.sea.wind_strength,
            "current_dir":w.sea.current_dir,"current_strength":w.sea.current_strength}))})
}

#[derive(serde::Serialize)]
struct PilotTravel {
    minutes: u32,
    creep_minutes: u32,
    beat_minutes: u32,
    longest_zero_progress_minutes: u32,
    days: u32,
    arrived: bool,
    degraded: u64,
    blocked: u64,
    min_coast: Option<u16>,
    corners: usize,
    planned_turns: u32,
    turns: Vec<PilotTurns>,
    #[serde(skip_serializing_if = "Option::is_none")]
    legs: Option<Vec<PilotLeg>>,
    open_water: PilotOpenWater,
}

#[derive(Default, serde::Serialize)]
struct PilotOpenWater {
    minutes: u32,
    tack_changes: u32,
    tacks_per_day: f64,
}

#[derive(serde::Serialize)]
struct PilotTurns {
    day: u32,
    heading_changes: u32,
    large_heading_changes: u32,
    large_turn_causes: std::collections::BTreeMap<&'static str, u32>,
    tack_changes: u32,
    large_ground_turns: u32,
    planned_turns: u32,
    max_cross_track: f64,
    longest_axis_minutes: u32,
}

#[derive(serde::Serialize)]
struct PilotLeg {
    start_step: usize,
    end_step: usize,
    from: manifest_core::navigation::SubCell,
    to: manifest_core::navigation::SubCell,
    straightened: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    retained_reason: Option<&'static str>,
    length: f64,
    sailed_length: f64,
    minutes: u32,
    average_sog: f64,
    stopped_minutes: u32,
    slow_minutes: u32,
    upwind_minutes: u32,
    shore_avoidance_minutes: u32,
    current_only_minutes: u32,
    backtrack_minutes: u32,
    min_coast: Option<u16>,
    weather: Vec<PilotLegWeather>,
    #[serde(skip)]
    coast_last: Option<(i64, i64)>,
}

#[derive(serde::Serialize)]
struct PilotLegWeather {
    day: u32,
    region: Option<u16>,
    sky: Option<manifest_core::Sky>,
    wind_dir: u8,
    wind_strength: i64,
    current_dir: u8,
    current_strength: i64,
    minutes: u32,
    wind_along: f64,
    current_along: f64,
    current_across: f64,
    upwind_minutes: u32,
    stalled_minutes: u32,
}

fn pilot_delta(
    defs: &StaticData,
    a: manifest_core::navigation::SubCell,
    b: manifest_core::navigation::SubCell,
) -> [f64; 2] {
    let width = i64::from(defs.map.width) * 256;
    let mut dx = b.x - a.x;
    if defs.map.wrap_x {
        dx = (dx + width / 2).rem_euclid(width) - width / 2;
    }
    [dx as f64 / 256.0, (b.y - a.y) as f64 / 256.0]
}

fn pilot_legs(
    defs: &StaticData,
    origin: manifest_core::navigation::SubCell,
    pilot: &manifest_core::navigation::autopilot::Pilot,
) -> Vec<PilotLeg> {
    let indices: Vec<_> = pilot
        .line
        .as_ref()
        .map(|l| l.corners.iter().map(|&c| c as usize).collect())
        .unwrap_or_else(|| (1..pilot.path.len()).collect());
    let mut previous = origin;
    let mut start_step = 0;
    indices
        .into_iter()
        .map(|end_step| {
            let to = manifest_core::navigation::SubCell::center(pilot.path[end_step]);
            let [dx, dy] = pilot_delta(defs, previous, to);
            let leg = PilotLeg {
                start_step,
                end_step,
                from: previous,
                to,
                straightened: end_step > start_step + 1,
                retained_reason: if end_step > start_step + 1 {
                    None
                } else if pilot.line.is_none() {
                    Some("grid_control")
                } else {
                    Some("clearance_or_climate")
                },
                length: dx.hypot(dy),
                sailed_length: 0.0,
                minutes: 0,
                average_sog: 0.0,
                stopped_minutes: 0,
                slow_minutes: 0,
                upwind_minutes: 0,
                shore_avoidance_minutes: 0,
                current_only_minutes: 0,
                backtrack_minutes: 0,
                min_coast: None,
                weather: Vec::new(),
                coast_last: None,
            };
            previous = to;
            start_step = end_step;
            leg
        })
        .collect()
}

fn pilot_lengths(
    defs: &StaticData,
    origin: manifest_core::navigation::SubCell,
    pilot: &manifest_core::navigation::autopilot::Pilot,
) -> (u64, u64, usize, usize) {
    use manifest_core::navigation::SubCell;
    let length = |a: SubCell, b: SubCell| {
        let mut dx = b.x - a.x;
        let width = i64::from(defs.map.width) * 256;
        if defs.map.wrap_x {
            dx = (dx + width / 2).rem_euclid(width) - width / 2;
        }
        let square = i128::from(dx).pow(2) + i128::from(b.y - a.y).pow(2);
        ((square as u128 * 100_000_000).isqrt() / 256) as u64
    };
    let coarse = pilot.path.windows(2).map(|p| length(SubCell::center(p[0]), SubCell::center(p[1]))).sum();
    let indices: Vec<_> = pilot
        .line
        .as_ref()
        .map(|l| l.corners.iter().map(|&c| c as usize).collect())
        .unwrap_or_else(|| (1..pilot.path.len()).collect());
    let mut previous = origin;
    let mut line = 0;
    let mut max_leg = 0;
    let mut index = 0;
    for &next in &indices {
        let p = SubCell::center(pilot.path[next]);
        line += length(previous, p);
        max_leg = max_leg.max(next - index);
        previous = p;
        index = next;
    }
    (coarse, line, indices.len(), max_leg)
}

fn pilot_travel(
    world: &World,
    fleet: manifest_core::FleetId,
    origin: manifest_core::navigation::SubCell,
    dest: manifest_core::LocId,
    pilot: manifest_core::navigation::autopilot::Pilot,
    details: bool,
    trace_day: Option<u32>,
) -> Result<PilotTravel> {
    use manifest_core::{
        navigation::{ManualVoyage, StopKind},
        world::{FleetLocation, Voyage},
    };
    let mut world = world.clone();
    let mut manual = ManualVoyage::new(origin.cell(), 0);
    manual.pos = origin;
    manual.autopilot = Some(dest);
    let mut legs = pilot_legs(&world.defs, origin, &pilot);
    manual.pilot = Some(pilot);
    let mut out = PilotTravel {
        minutes: 0,
        creep_minutes: 0,
        beat_minutes: 0,
        longest_zero_progress_minutes: 0,
        days: 0,
        arrived: false,
        degraded: 0,
        blocked: 0,
        min_coast: None,
        corners: legs.len(),
        planned_turns: pilot_plan_turns(&world.defs, &legs),
        turns: Vec::new(),
        legs: None,
        open_water: PilotOpenWater::default(),
    };
    let mut minimum = 65u16;
    let mut last_fine = None;
    let mut previous_heading = None;
    let mut ground = PilotGroundTrack::default();
    // 净位移达到四分之一格才重新计时；锚点跨日保留，不能被换日清零。
    let mut progress_origin = origin;
    let mut progress_minute = 0;
    for _ in 0..200 {
        world.fleet_mut(fleet)?.location = FleetLocation::AtSea(Voyage::Manual { manual: manual.clone() });
        let f = world.fleet(fleet)?;
        let course = world.preview_course(fleet, &[], 0)?;
        let trace = world.pilot_course_trace(f, &manual, &course);
        out.degraded += trace.degraded;
        out.blocked += trace.blocked;
        let mut turns = PilotTurns {
            day: world.day(),
            heading_changes: 0,
            large_heading_changes: 0,
            large_turn_causes: Default::default(),
            tack_changes: 0,
            large_ground_turns: 0,
            planned_turns: 0,
            max_cross_track: 0.0,
            longest_axis_minutes: 0,
        };
        for p in trace.minutes {
            if trace_day.is_some_and(|day| day == 0 || day == world.day()) {
                println!("{}", pilot_minute_json(&p, world.day()));
            }
            let i = usize::from(p.minute);
            if let Some(next) = course.points.get(i + 1) {
                ground.observe(&world.defs, &p, next.pos, &legs, &mut turns);
            }
            out.creep_minutes += u32::from(p.mode == manifest_core::navigation::autopilot::PilotMode::Creep);
            out.beat_minutes += u32::from(p.mode == manifest_core::navigation::autopilot::PilotMode::Beat);
            let Some(leg) = legs.iter_mut().find(|l| l.end_step >= p.step) else { continue };
            let [dx, dy] = pilot_delta(&world.defs, leg.from, leg.to);
            let length = dx.hypot(dy).max(f64::EPSILON);
            let unit = [dx / length, dy / length];
            let goal_heading = dx.atan2(-dy).to_degrees().rem_euclid(360.0).round() as u16 % 360;
            let upwind = p.weather.is_some_and(|w| {
                w.sea.wind_strength > 0
                    && manifest_core::navigation::course::angle_between(
                        goal_heading,
                        (u16::from(w.sea.wind_dir) * 45 + 180) % 360,
                    ) < p.upwind_limit
            });
            let wind_dir = p.weather.map(|w| w.sea.wind_dir);
            let side = p.weather.map_or(0, |w| {
                let relative =
                    (i32::from(p.heading) - (i32::from(w.sea.wind_dir) * 45 + 180) + 180).rem_euclid(360) - 180;
                relative.signum()
            });
            // 周围 3×3 粗格均可航行且细图全水，算开阔水面；以实际处于开阔水面的分钟折算航海日。
            let cell = course.points[usize::from(p.minute)].pos.cell();
            let open = (-1..=1).all(|dy| {
                (-1..=1).all(|dx| {
                    world.defs.map.topology().normalize(i64::from(cell.x) + dx, i64::from(cell.y) + dy).is_some_and(
                        |c| {
                            world.defs.map.is_sea_in_bounds(c)
                                && world
                                    .defs
                                    .fine_coast
                                    .as_ref()
                                    .is_none_or(|f| f.kind(c) == manifest_core::nav::FineKind::Water)
                        },
                    )
                })
            });
            out.open_water.minutes += u32::from(open);
            if let Some((heading, old_side, old_upwind, old_open, old_mode, old_wind, old_step)) = previous_heading
                && heading != p.heading
            {
                turns.heading_changes += 1;
                let large = manifest_core::navigation::course::angle_between(heading, p.heading) >= 20;
                turns.large_heading_changes += u32::from(large);
                // H10i：超标日列出当分钟可观察到的变化；互斥计数合计等于大转向次数。
                if large {
                    let cause = if wind_dir != old_wind {
                        "wind"
                    } else if p.step != old_step {
                        "waypoint"
                    } else if p.mode != old_mode {
                        "mode"
                    } else if p.shore_avoided {
                        "shore"
                    } else if p.mode == manifest_core::navigation::autopilot::PilotMode::Sail {
                        "sail"
                    } else {
                        "aim"
                    };
                    *turns.large_turn_causes.entry(cause).or_default() += 1;
                }
                // 同一风向下连续帆行跨风侧的大转舵才算换舷；换海区或换日转风不算。
                if large
                    && wind_dir == old_wind
                    && p.mode == manifest_core::navigation::autopilot::PilotMode::Sail
                    && old_mode == manifest_core::navigation::autopilot::PilotMode::Sail
                    && upwind
                    && old_upwind
                    && side != 0
                    && old_side != 0
                    && side != old_side
                {
                    turns.tack_changes += 1;
                    out.open_water.tack_changes += u32::from(open && old_open);
                }
            }
            previous_heading = Some((p.heading, side, upwind, open, p.mode, wind_dir, p.step));
            if !details {
                continue;
            }
            let i = usize::from(p.minute);
            let Some(pair) = course.points.get(i..=i + 1) else { continue };
            let [mx, my] = pilot_delta(&world.defs, pair[0].pos, pair[1].pos);
            leg.sailed_length += mx.hypot(my);
            leg.minutes += 1;
            let stopped = p.velocity == [0, 0];
            leg.stopped_minutes += u32::from(stopped);
            leg.slow_minutes += u32::from((p.velocity[0] as f64).hypot(p.velocity[1] as f64) < 10_000.0);
            leg.upwind_minutes += u32::from(upwind);
            leg.shore_avoidance_minutes += u32::from(p.shore_avoided);
            leg.current_only_minutes += u32::from(p.velocity != [0, 0] && p.velocity == p.current);
            leg.backtrack_minutes += u32::from(p.velocity[0] as f64 * unit[0] + p.velocity[1] as f64 * unit[1] <= 0.0);
            if let Some(fine) = world.defs.fine_coast.as_ref() {
                let mut coast = leg.min_coast.unwrap_or(65);
                pilot_coast(&world.defs, fine, pair, &mut coast, &mut leg.coast_last);
                if coast < 65 {
                    leg.min_coast = Some(coast);
                }
            }
            let w = p.weather;
            let mut weather = PilotLegWeather {
                day: world.day(),
                region: w.map(|w| w.region.0),
                sky: w.map(|w| w.sky),
                wind_dir: w.map_or(0, |w| w.sea.wind_dir),
                wind_strength: w.map_or(0, |w| w.sea.wind_strength),
                current_dir: w.map_or(0, |w| w.sea.current_dir),
                current_strength: w.map_or(0, |w| w.sea.current_strength),
                minutes: 0,
                wind_along: 0.0,
                current_along: 0.0,
                current_across: 0.0,
                upwind_minutes: 0,
                stalled_minutes: 0,
            };
            let same = leg.weather.last().is_some_and(|last| {
                (
                    last.day,
                    last.region,
                    last.sky,
                    last.wind_dir,
                    last.wind_strength,
                    last.current_dir,
                    last.current_strength,
                ) == (
                    weather.day,
                    weather.region,
                    weather.sky,
                    weather.wind_dir,
                    weather.wind_strength,
                    weather.current_dir,
                    weather.current_strength,
                )
            });
            if same {
                weather = leg.weather.pop().context("pilot weather")?;
            }
            let wind = manifest_core::navigation::course::direction(u16::from(weather.wind_dir) * 45);
            weather.minutes += 1;
            weather.wind_along +=
                (wind[0] as f64 * unit[0] + wind[1] as f64 * unit[1]) * weather.wind_strength as f64 / 10_000.0;
            weather.current_along += (p.current[0] as f64 * unit[0] + p.current[1] as f64 * unit[1]) / 10_000.0;
            weather.current_across += (p.current[0] as f64 * -unit[1] + p.current[1] as f64 * unit[0]) / 10_000.0;
            weather.upwind_minutes += u32::from(upwind);
            weather.stalled_minutes += u32::from(stopped);
            leg.weather.push(weather);
        }
        out.turns.push(turns);
        if let Some(fine) = world.defs.fine_coast.as_ref() {
            pilot_coast(&world.defs, fine, &course.points, &mut minimum, &mut last_fine);
        }
        let stopped = course.stops.iter().find(|s| matches!(s.kind, StopKind::Port | StopKind::Land));
        let until = stopped.map_or(1440, |s| u32::from(s.minute));
        for point in course.points.iter().filter(|p| p.minute > 0 && u32::from(p.minute) <= until) {
            let at = out.minutes + u32::from(point.minute);
            let [dx, dy] = pilot_delta(&world.defs, progress_origin, point.pos);
            if dx * dx + dy * dy >= 0.25 * 0.25 {
                progress_origin = point.pos;
                progress_minute = at;
            } else {
                out.longest_zero_progress_minutes = out.longest_zero_progress_minutes.max(at - progress_minute);
            }
        }
        out.minutes += until;
        if let Some(s) = stopped {
            out.arrived = s.kind == StopKind::Port && course.arrival == Some(dest);
            break;
        }
        manual = course.voyage;
        if manual.pilot.is_none() {
            break;
        }
        world.state.day = world.state.day.saturating_add(1);
        world.state.navigation = Default::default();
    }
    if minimum < 65 {
        out.min_coast = Some(minimum);
    }
    out.days = out.minutes.div_ceil(1440);
    out.open_water.tacks_per_day =
        f64::from(out.open_water.tack_changes) * 1440.0 / f64::from(out.open_water.minutes.max(1));
    if details {
        for leg in &mut legs {
            leg.average_sog = leg.sailed_length * 1440.0 / f64::from(leg.minutes.max(1));
            for w in &mut leg.weather {
                w.wind_along /= f64::from(w.minutes);
                w.current_along /= f64::from(w.minutes);
                w.current_across /= f64::from(w.minutes);
            }
        }
        out.legs = Some(legs);
    }
    Ok(out)
}

fn pilot_bearing([dx, dy]: [f64; 2]) -> Option<f64> {
    (dx != 0.0 || dy != 0.0).then(|| dx.atan2(-dy).to_degrees().rem_euclid(360.0))
}

fn pilot_angle(a: f64, b: f64) -> f64 {
    ((a - b + 180.0).rem_euclid(360.0) - 180.0).abs()
}

fn pilot_plan_turns(defs: &StaticData, legs: &[PilotLeg]) -> u32 {
    legs.windows(2).filter(|pair| pilot_plan_corner(defs, &pair[0], &pair[1])).count() as u32
}

fn pilot_plan_corner(defs: &StaticData, a: &PilotLeg, b: &PilotLeg) -> bool {
    pilot_bearing(pilot_delta(defs, a.from, a.to))
        .zip(pilot_bearing(pilot_delta(defs, b.from, b.to)))
        .is_some_and(|(a, b)| pilot_angle(a, b) >= 20.0)
}

#[derive(Default)]
struct PilotGroundTrack {
    heading: Option<f64>,
    step: usize,
    axis: [u32; 2],
}

impl PilotGroundTrack {
    fn observe(
        &mut self,
        defs: &StaticData,
        p: &manifest_core::navigation::line_pilot::PilotMinute,
        next: manifest_core::navigation::SubCell,
        legs: &[PilotLeg],
        day: &mut PilotTurns,
    ) {
        // 航迹方向用分钟积分的定点速度，避免把 1/256 格端点的量化齿当成转向。
        if let Some(heading) = pilot_bearing(p.velocity.map(|v| v as f64)) {
            if self.heading.is_some_and(|old| pilot_angle(old, heading) >= 20.0) {
                day.large_ground_turns += 1;
            }
            self.heading = Some(heading);
        }
        day.planned_turns += legs
            .windows(2)
            .filter(|pair| {
                self.step <= pair[0].end_step
                    && p.step > pair[0].end_step
                    && pilot_plan_corner(defs, &pair[0], &pair[1])
            })
            .count() as u32;
        self.step = self.step.max(p.step);
        let cross = legs
            .iter()
            .map(|leg| {
                let u = pilot_delta(defs, leg.from, leg.to);
                let q = pilot_delta(defs, leg.from, p.pos);
                let len2 = u[0] * u[0] + u[1] * u[1];
                let t = ((q[0] * u[0] + q[1] * u[1]) / len2.max(f64::EPSILON)).clamp(0.0, 1.0);
                (q[0] - t * u[0]).hypot(q[1] - t * u[1])
            })
            .fold(f64::INFINITY, f64::min);
        day.max_cross_track = day.max_cross_track.max(cross);
        let delta = pilot_delta(defs, p.pos, next);
        let aim = pilot_delta(defs, p.pos, p.aim);
        for axis in 0..2 {
            // 只数应朝斜向目标前进却丢掉一个坐标分量的连续分钟；计划本就沿轴的直航不算滑岸。
            if delta[axis] == 0.0 && aim[axis].abs() >= 1.0 / 256.0 && p.velocity != [0; 2] {
                self.axis[axis] += 1;
                day.longest_axis_minutes = day.longest_axis_minutes.max(self.axis[axis]);
            } else {
                self.axis[axis] = 0;
            }
        }
    }
}

/// H10j：真实存档提供船、迷雾、种子、出发日和风暴修正；只积分航行，不运行经济与剧情。
fn pilot_replay(defs: Arc<StaticData>, save: &Path, from: &str, to: &str, via: &[String]) -> Result<()> {
    use manifest_core::navigation::{ManualVoyage, StopKind, SubCell};
    use manifest_core::world::{FleetLocation, Voyage};
    let name = save.file_name().and_then(|s| s.to_str()).context("save name")?;
    let stem = name.strip_suffix(".mfsave.zst").or_else(|| name.strip_suffix(".json")).unwrap_or(name);
    let meta = save.with_file_name(format!("{stem}.meta.json"));
    let clock = if meta.is_file() {
        let meta: serde_json::Value = serde_json::from_reader(std::fs::File::open(meta)?)?;
        meta.get("minute")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(u64::from(manifest_appcore::clock::DEFAULT_MINUTE)) as u16
    } else {
        manifest_appcore::clock::DEFAULT_MINUTE
    };
    let save = manifest_sim::storage::read(save)?;
    let mut world = GameSession::from_save(defs.clone(), save)?.world;
    let fleet = world.flagship(OwnerId::Player).context("flagship")?;
    let from = defs.find_loc(from).context("from")?;
    anyhow::ensure!(world.fleet(fleet)?.location == FleetLocation::Docked(from), "save/from mismatch");
    let mut minute = (manifest_appcore::clock::since_day_start(clock) as u16).max(world.state.navigation.settled);
    for to in via.iter().map(String::as_str).chain(std::iter::once(to)) {
        let dest = defs.find_loc(to).context("to")?;
        let f = world.fleet(fleet)?;
        let origin = SubCell::center(f.cell(&defs));
        let pref = world.resolve_route_pref(f, None)?;
        let mut pilot = world.planned_sea_path(f, origin.cell(), dest, false, pref)?;
        pilot.line = world.straighten(f, origin, &pilot, pref);
        if let Some(line) = &pilot.line {
            pilot.step = line.corners[0] as usize;
        }
        let legs = pilot_legs(&defs, origin, &pilot);
        let mut manual = ManualVoyage::new(origin.cell(), 0);
        manual.pos = origin;
        manual.autopilot = Some(dest);
        manual.pilot = Some(pilot);
        let mut ground = PilotGroundTrack::default();
        let mut days = Vec::new();
        let mut arrived = false;
        let mut duration = 0u32;
        for _ in 0..200 {
            world.fleet_mut(fleet)?.location = FleetLocation::AtSea(Voyage::Manual { manual: manual.clone() });
            world.state.navigation = Default::default();
            world.state.navigation.minute = minute;
            world.state.navigation.settled = minute;
            let course = world.preview_course(fleet, &[], minute)?;
            let trace = world.pilot_course_trace(world.fleet(fleet)?, &manual, &course);
            let mut day = PilotTurns {
                day: world.day(),
                heading_changes: 0,
                large_heading_changes: 0,
                large_turn_causes: Default::default(),
                tack_changes: 0,
                large_ground_turns: 0,
                planned_turns: 0,
                max_cross_track: 0.0,
                longest_axis_minutes: 0,
            };
            let mut heading = manual.heading;
            for p in &trace.minutes {
                if let Some(next) = course.points.get(usize::from(p.minute - minute) + 1) {
                    ground.observe(&defs, p, next.pos, &legs, &mut day);
                }
                day.heading_changes += u32::from(heading != p.heading);
                day.large_heading_changes +=
                    u32::from(manifest_core::navigation::course::angle_between(heading, p.heading) >= 20);
                heading = p.heading;
                println!(
                    "{}",
                    serde_json::json!({"kind":"minute","to":to,"day":world.day(),"minute":p.minute,
                    "pos":p.pos,"mode":p.mode,"heading":p.heading,
                    "ground_heading":pilot_bearing(p.velocity.map(|v|v as f64)),"velocity":p.velocity,
                    "water_heading":pilot_bearing([p.velocity[0]-p.current[0],p.velocity[1]-p.current[1]].map(|v|v as f64)),
                    "current":p.current,"aim":p.aim,"shore_blocked":p.shore_avoided,"backup":p.backup_used,"step":p.step})
                );
            }
            // 任务指定的接续核对：同一天中途落实、存读后再积分，逐分钟位置与领航记忆必须相同。
            let middle = minute + (1440 - minute) / 2;
            if course.stops.iter().all(|s| !matches!(s.kind, StopKind::Land | StopKind::Port) || s.minute > middle) {
                let split = world.navigation_projection(middle)?;
                let loaded =
                    World::from_snapshot(defs.clone(), serde_json::from_slice(&serde_json::to_vec(&split.state)?)?)?;
                let tail = loaded.preview_course(fleet, &[], middle)?;
                anyhow::ensure!(
                    tail.voyage == course.voyage
                        && tail.arrival == course.arrival
                        && tail.points.iter().eq(course.points.iter().filter(|p| p.minute >= middle)),
                    "split course mismatch: day {}",
                    world.day()
                );
            }
            days.push(day);
            let stop = course.stops.iter().find(|s| matches!(s.kind, StopKind::Land | StopKind::Port));
            let end = stop.map_or(1440, |s| s.minute);
            duration += u32::from(end - minute);
            if let Some(stop) = stop {
                arrived = stop.kind == StopKind::Port && course.arrival == Some(dest);
                minute = end;
                break;
            }
            manual = course.voyage;
            if manual.pilot.is_none() {
                break;
            }
            world.state.day += 1;
            minute = 0;
        }
        println!(
            "{}",
            serde_json::json!({"kind":"summary","to":to,"arrived":arrived,"minutes":duration,
            "planned_turns":pilot_plan_turns(&defs,&legs),"turns":days,"split_equal":true})
        );
        anyhow::ensure!(arrived, "replay did not arrive: {to}");
        world.fleet_mut(fleet)?.location = FleetLocation::Docked(dest);
        if minute == 1440 {
            world.state.day += 1;
            minute = 0;
        }
    }
    Ok(())
}

/// 对实际扫掠的定点位置查切比雪夫距离；得到更小的值后，后续只查可能刷新最小值的范围。
fn pilot_coast(
    defs: &StaticData,
    fine: &manifest_core::nav::FineCoast,
    points: &[manifest_core::navigation::CoursePoint],
    minimum: &mut u16,
    last_fine: &mut Option<(i64, i64)>,
) {
    let sub = i64::from(fine.sub());
    let width = i64::from(defs.map.width) * 256;
    let water = |x: i64, y: i64| {
        defs.map
            .topology()
            .normalize(x.div_euclid(sub), y.div_euclid(sub))
            .is_some_and(|c| fine.water(c, x.rem_euclid(sub) as u16, y.rem_euclid(sub) as u16))
    };
    let mut previous = points.first().map(|p| p.pos);
    for p in points {
        let a = previous.unwrap_or(p.pos);
        let mut dx = p.pos.x - a.x;
        if defs.map.wrap_x {
            dx = (dx + width / 2).rem_euclid(width) - width / 2;
        }
        let dy = p.pos.y - a.y;
        let steps = dx.abs().max(dy.abs()).max(1);
        for step in 0..=steps {
            let x = (a.x + dx * step / steps).rem_euclid(width) * sub / 256;
            let y = (a.y + dy * step / steps) * sub / 256;
            if *last_fine == Some((x, y)) {
                continue;
            }
            *last_fine = Some((x, y));
            // 开阔水面的整块细格都是水，先按粗块排除搜索方框里的陆，避免每分钟逐圈扫满 64 格。
            if i64::from(*minimum) > sub {
                let pad = (i64::from(*minimum) + sub - 1) / sub;
                if (-pad..=pad).all(|oy| {
                    (-pad..=pad).all(|ox| {
                        defs.map.topology().normalize(x.div_euclid(sub) + ox, y.div_euclid(sub) + oy).is_some_and(|c| {
                            defs.map.is_sea_in_bounds(c) && fine.kind(c) == manifest_core::nav::FineKind::Water
                        })
                    })
                }) {
                    continue;
                }
            }
            'rings: for r in 0..i64::from(*minimum) {
                for edge in -r..=r {
                    for (ox, oy) in [(edge, -r), (edge, r), (-r, edge), (r, edge)] {
                        if !water(x + ox, y + oy) {
                            *minimum = r as u16;
                            break 'rings;
                        }
                    }
                }
            }
        }
        previous = Some(p.pos);
    }
}

/// 样例导出可局部启用行动制；输出 act 对象与配套文字表。
fn upbringing_act_view(
    defs: Arc<StaticData>,
    locale: &manifest_data::LocaleBundle,
    weeks: u32,
    stop: &str,
    roundtrip: bool,
    ill: bool,
    voyage: Option<&str>,
) -> Result<()> {
    use manifest_core::{
        Command,
        upbringing::{ActPhase, week_index},
    };
    use std::collections::{BTreeMap, BTreeSet};
    let mut defs = (*defs).clone();
    // 出海验收的周数是序数：第 2 周首个海上周末，第 5 周归航小结。
    let weeks = if voyage.is_some() { weeks.saturating_sub(1) } else { weeks };
    if ill && weeks == 0 {
        bail!("--ill 需要目标周大于 0，以便前一周结算生病");
    }
    let Some(r) = &mut defs.rules.upbringing.act else { bail!("世界缺少行动制规则") };
    r.enabled = true;
    if let Some(key) = voyage {
        let from = defs.upbringing.family("mio").and_then(|f| f.stages.first()).context("缺少澪的开始日")?.from;
        let v = defs.upbringing.act_voyages.iter_mut().find(|v| v.key == key).context("未知见习出海")?;
        v.start = [from[0], from[1], 8];
        v.requires = Default::default();
    }
    let problems = manifest_core::upbringing::act::validation::validate(&defs);
    if !problems.is_empty() {
        bail!("{}", problems.join("\n"));
    }
    let mut categories = BTreeMap::<String, [usize; 3]>::new();
    for index in defs.upbringing.act_index.tracks.values().filter(|i| i.family == "mio") {
        let entry = categories.entry(index.category.clone()).or_default();
        entry[0] += 1;
        entry[1] += index.chapters.len();
        entry[2] += index.chapters.values().filter(|v| **v).count();
    }
    let unresolved: Vec<_> =
        defs.upbringing.act_index.unresolved.iter().filter(|(_, f)| f.as_str() == "mio").map(|(key, _)| key).collect();
    eprintln!(
        "act_index: {}",
        serde_json::json!({"family":"mio","categories_tracks_chapters_key":categories,"unresolved":unresolved})
    );
    let scenario = defs.find_scenario("mio_1553").context("缺少澪的剧本")?;
    let mut start = manifest_core::replay::StartParams::new(scenario, 42);
    start.opening = Some(manifest_core::scenario::NewGameRequest {
        world: defs.world_key.clone(),
        scenario: "mio_1553".into(),
        seed: Some(42),
        protagonist: Some("mio".into()),
        ..Default::default()
    });
    let mut world = World::from_start(Arc::new(defs), &start, |_| {})?;
    let wanted = match stop {
        "free" => ActPhase::Free,
        "summary" => ActPhase::Summary,
        "moment" => ActPhase::Moment,
        _ => ActPhase::Plan,
    };
    let mut sample = None;
    let mut previous = None;
    let mut checked = None;
    let mut transition_week = None;
    let mut checks = 0;
    let mut voyage_checks = 0;
    let mut voyage_edges = BTreeSet::new();
    let mut answered = 0_u64;
    let mut unexplained_markers = 0;
    let mut free_marker_weeks = BTreeSet::new();
    let mut openable_key_weeks = BTreeSet::new();
    for _ in 0..50_000 {
        let week = week_index(&world.defs, world.day());
        if week > weeks || (stop == "moment" && week >= weeks) {
            break;
        }
        let ctx = manifest_appcore::views::Ctx {
            texts: Some(&locale.texts),
            current: Some(locale),
            ..manifest_appcore::views::Ctx::plain(&locale.defs)
        };
        let view = manifest_appcore::upbringing_view::act::view(ctx, &world);
        if let Some(markers) = view["markers"].as_array() {
            unexplained_markers += markers
                .iter()
                .filter(|m| {
                    m["openable"] == false && (m["reason"].as_str().is_none() || m["reason_text"].as_str().is_none())
                })
                .count();
        }
        if world.act_free_stop().is_some_and(|stop| stop.error.code() == "ub.act.free_marker") {
            free_marker_weeks.insert(week);
        }
        if world.act_phase() == ActPhase::Free
            && !world.act_sailing()
            && world.state.upbringing.as_ref().is_some_and(|s| {
                s.act.markers.iter().any(|(track, m)| {
                    m.key
                        && (m.since_week == week || m.expires_week == week)
                        && Command::DoAction {
                            owner: OwnerId::Player,
                            place: m.place.clone(),
                            action: manifest_core::upbringing::ActAction::Marker { track: track.clone() },
                        }
                        .validate(&world)
                        .is_ok()
                })
            })
        {
            openable_key_weeks.insert(week);
        }
        let stage = world.state.upbringing.as_ref().map(|s| (s.stage_from, s.phase));
        let stamp = (week, world.act_phase(), stage);
        if roundtrip && voyage.is_some() {
            let edge = world.state.upbringing.as_ref().and_then(|s| {
                s.act.voyage.as_ref().filter(|v| v.leg == 0).map(|v| format!("start:{}", v.key)).or_else(|| {
                    s.act
                        .last_week
                        .as_ref()
                        .and_then(|s| s.k3.voyage.as_ref())
                        .filter(|v| v.gate.is_some())
                        .map(|v| format!("done:{}", v.key))
                })
            });
            if let Some(edge) = edge
                && voyage_edges.insert(edge.clone())
            {
                let save = manifest_core::SaveFile::new(&world.defs, start.clone(), world.state.clone(), Vec::new());
                check_roundtrip(&world, save)?;
                checks += 1;
                voyage_checks += 1;
                eprintln!("voyage-roundtrip: edge={edge} day={} checks={voyage_checks}", world.day());
            }
        }
        if checked.as_ref().is_some_and(|(_, _, previous)| *previous != stage) {
            transition_week = Some(week);
        }
        // 普通周每三周完整检查一次；换阶段所在周和目标周完整检查，控制在十分钟内。
        let check_week = week.is_multiple_of(3) || transition_week == Some(week) || week == weeks;
        if roundtrip && check_week && checked.as_ref() != Some(&stamp) {
            let save = manifest_core::SaveFile::new(&world.defs, start.clone(), world.state.clone(), Vec::new());
            check_roundtrip(&world, save)?;
            checks += 1;
            if checked.as_ref().is_none_or(|previous| previous.0 != week) {
                eprintln!(
                    "roundtrip: day={} week={week} phase={} checks={checks}",
                    world.day(),
                    world.act_phase().key()
                );
            }
            checked = Some(stamp);
        }
        if !world.act_running() {
            bail!("行动制已退出，尚未到达目标阶段");
        }
        if !world.state.story2.pending.is_empty() || world.state.story.pending.is_some() {
            let mut choices = if world.story2_is_front() {
                let pending = world.pending_story2().context("样例剧情缺少当前章")?;
                let chapter = world
                    .defs
                    .story2
                    .track(&pending.track)
                    .and_then(|track| track.chapter(&pending.chapter))
                    .context("样例剧情缺少章节定义")?;
                let entered = world.state.story2.tracks.get(&pending.track).map_or(world.day(), |s| s.entered);
                let visible: Vec<_> =
                    chapter.choices.iter().filter(|choice| world.story2_choice_visible(choice, entered)).collect();
                if visible.is_empty() {
                    vec![0]
                } else {
                    visible
                        .iter()
                        .enumerate()
                        .filter(|(_, choice)| world.story2_conditions(&choice.requires, entered))
                        .map(|(index, _)| index as u32)
                        .collect()
                }
            } else {
                (0..manifest_core::story::MAX_CHOICES as u32).collect()
            };
            if !choices.is_empty() {
                let offset = (u64::from(world.day()) + answered) as usize % choices.len();
                choices.rotate_left(offset);
            }
            let command = choices
                .into_iter()
                .map(|choice| Command::StoryAnswer { owner: OwnerId::Player, choice })
                .find(|cmd| cmd.validate(&world).is_ok())
                .context("样例剧情没有可提交选项")?;
            command.apply(&mut world)?;
            answered += 1;
            continue;
        }
        // 样例指定的航次先报名，避免 6a / 6b 被机器人的目录顺序抢先排除。
        if let Some(key) = voyage
            && week == 0
            && world.act_phase() == ActPhase::Plan
            && world.state.upbringing.as_ref().is_some_and(|s| !s.act.voyages.contains_key(key))
        {
            Command::JoinVoyage { owner: OwnerId::Player, voyage: key.into() }.apply(&mut world)?;
            continue;
        }
        let stamp = (week, world.act_phase(), world.state.upbringing.as_ref().and_then(|s| s.stage_from));
        if roundtrip
            && previous.as_ref() != Some(&stamp)
            && world.act_phase() == ActPhase::Summary
            && let Some(summary) = world.state.upbringing.as_ref().and_then(|s| s.act.last_week.as_ref())
            && summary.week % 4 == 3
        {
            eprintln!("month-end-summary: week={} from={:?} to={:?}", summary.week, summary.from, summary.to);
        }
        if previous.as_ref() != Some(&stamp)
            && (week == weeks || stop == "moment")
            && world.act_phase() == wanted
            && (!ill || world.act_ill())
        {
            sample = Some(view);
            if stop == "moment" || voyage.is_some() {
                break;
            }
        }
        previous = Some(stamp);
        if world.act_bot_step()? {
            continue;
        }
        if roundtrip
            && (world.act_day() == 7
                || world.upbringing_family().is_some_and(|f| {
                    f.stages
                        .iter()
                        .map(|s| s.from)
                        .chain(std::iter::once(f.graduation))
                        .any(|date| manifest_core::scenario::day_of(&world.defs, date).ok() == Some(world.day() + 1))
                }))
        {
            let save = manifest_core::SaveFile::new(&world.defs, start.clone(), world.state.clone(), Vec::new());
            check_roundtrip(&world, save)?;
            checks += 1;
        }
        if ill && week + 1 == weeks && world.act_day() == 7 && !world.act_ill() {
            let r = world.act_rules().context("缺少行动制规则")?;
            let per = r.illness.pct_per_point;
            if per <= 0 {
                bail!("当前规则无法用疲劳产生必病样例");
            }
            // 周末先恢复再判病；只抬高本局疲劳，病程仍由内核按原规则写入。
            let fatigue = r.illness.at.max(r.illness.base + (100 + per - 1) / per) + r.recover.weekly;
            if let Some(s) = &mut world.state.upbringing {
                s.fatigue = fatigue;
            }
        }
        world.end_day()?;
    }
    let mut sample = sample.context("目标周没有进入指定阶段")?;
    sample["marker_audit"] = serde_json::json!({"unexplained_unopenable_markers":unexplained_markers,
        "free_marker_stop_weeks":free_marker_weeks.len(),"openable_key_marker_weeks":openable_key_weeks.len()});
    if unexplained_markers != 0 || free_marker_weeks != openable_key_weeks {
        bail!("标记验收失败：{}", sample["marker_audit"]);
    }
    let ctx = manifest_appcore::views::Ctx {
        texts: Some(&locale.texts),
        current: Some(locale),
        ..manifest_appcore::views::Ctx::plain(&locale.defs)
    };
    sample["upbringing_act_texts"] = serde_json::json!(manifest_appcore::upbringing_view::act::texts(ctx));
    sample["state_hash"] = serde_json::json!(world.state_hash());
    if roundtrip {
        eprintln!(
            "roundtrip: checks={checks} voyage_checks={voyage_checks} week={} stage={}",
            week_index(&world.defs, world.day()),
            world.act_stage_key()
        );
    }
    println!("{}", serde_json::to_string_pretty(&sample)?);
    Ok(())
}

/// E03：只报告静态内容规模，不推进世界，也不运行模拟。
fn stage_unlock_summary(defs: &StaticData) {
    let conditional: usize = defs.locations.iter().map(|l| l.unlocks.len()).sum();
    let secret = defs.goods.iter().filter(|g| g.secret).count();
    let facilities: Vec<usize> = (0..=6)
        .map(|stage| {
            let development = if stage == 0 { 1 } else { defs.rules.development.stages[stage - 1] };
            defs.port_ids().map(|loc| manifest_core::stages::facilities_at(defs, loc, development).len()).sum()
        })
        .collect();
    println!("阶段解锁：条件条目 {conditional}，隐秘货 {secret}，阶段 0–6 生效设施总数 {facilities:?}");
}

/// 在内存中走桌面读档的兼容检查与快照恢复入口，不写文件。
fn check_roundtrip(world: &World, save: manifest_core::SaveFile) -> Result<()> {
    let check = || -> Result<()> {
        let before = world.state_hash();
        let restored = GameSession::from_save(world.defs.clone(), save)?;
        let after = restored.world.state_hash();
        if before != after {
            let original = serde_json::to_value(&world.state)?;
            let restored = serde_json::to_value(&restored.world.state)?;
            let mut pair = (&original, &restored);
            let mut path = String::new();
            loop {
                match pair {
                    (serde_json::Value::Object(a), serde_json::Value::Object(b)) => {
                        let Some(key) = a.keys().chain(b.keys()).find(|key| a.get(*key) != b.get(*key)) else {
                            break;
                        };
                        path.push('/');
                        path.push_str(key);
                        pair = (&pair.0[key], &pair.1[key]);
                    }
                    (serde_json::Value::Array(a), serde_json::Value::Array(b)) => {
                        let Some(index) = (0..a.len().max(b.len())).find(|&i| a.get(i) != b.get(i)) else {
                            break;
                        };
                        path.push_str(&format!("/{index}"));
                        pair = (&pair.0[index], &pair.1[index]);
                    }
                    _ => break,
                }
            }
            bail!(
                "state_hash before={before} after={after} path={path} before_value={} after_value={}",
                pair.0,
                pair.1
            );
        }
        Ok(())
    };
    check().with_context(|| {
        let at_sea = world.fleets_of(OwnerId::Player).any(|f| f.docked_at().is_none());
        let phase = if world.act_running() {
            world.act_phase().key()
        } else if at_sea {
            "at_sea"
        } else {
            "docked"
        };
        let stage = world.state.upbringing.as_ref().map(|s| (s.stage_from, s.phase));
        format!(
            "roundtrip day={} week={} phase={phase} stage={stage:?}",
            world.day(),
            manifest_core::upbringing::week_index(&world.defs, world.day())
        )
    })
}

#[cfg(test)]
mod coverage_tests {
    use super::*;

    #[test]
    fn english_coverage_exit_truth_table() {
        for world in ["terra16", "classic", "testbed", "draft"] {
            for missing in [false, true] {
                for other_error in [false, true] {
                    let mut issues = Vec::new();
                    if missing {
                        issues.push(manifest_data::DataIssue {
                            file: "locales/en/example.toml".into(),
                            item: "name".into(),
                            message: "已有英文覆盖不完整".into(),
                        });
                    }
                    if other_error {
                        issues.push(manifest_data::DataIssue {
                            file: "example.toml".into(),
                            item: "key".into(),
                            message: "unknown_field".into(),
                        });
                    }
                    let result = english_coverage_report(usize::from(missing), issues);
                    let code = u8::from(result.is_err());
                    println!("world={world} missing={missing} other_error={other_error} exit={code} output={result:?}");
                    assert_eq!(code, u8::from(other_error));
                    match result {
                        Ok(text) => assert!(text.contains(&format!("缺失 {} 条", usize::from(missing)))),
                        Err(error) => assert!(error.to_string().contains("unknown_field")),
                    }
                }
            }
        }
    }
}
