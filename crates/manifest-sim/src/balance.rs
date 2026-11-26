//! 平衡测试：多个种子 × 多种脚本 bot 长期运行，统计第 11 节的各项指标并按阈值判定。
//!
//! 报告内容只取决于种子与数据（不含耗时等不确定信息），因此写入 `docs/BALANCE.md` 后
//! 重复运行不会改变文件。耗时由调用方单独测量与输出。

use crate::SimError;
use crate::bots::{Bot, BotKind};
use crate::session::GameSession;
use crate::stats;
use manifest_core::StaticData;
use manifest_core::fixed::{Fx, Money};
use manifest_core::ids::{OwnerId, ScenarioId};
use manifest_core::info::InfoMode;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

/// 第 11 节的阈值（调整时须在 docs/BALANCE.md 记录旧值、新值与理由）。
#[derive(Clone, Debug)]
pub struct Thresholds {
    /// 物价指数年化变化的下限与上限（百分比）
    pub price_change_pct: (f64, f64),
    /// 单一商品卡在价格上下限的时间占比上限（百分比）
    pub bound_share_pct: f64,
    /// 30 年后 NPC 商会存活比例下限（百分比）
    pub alive_pct: f64,
    /// 单一商会占全部商会财富的上限（百分比）
    pub wealth_share_pct: f64,
    /// 套利 bot 第一年资产增长倍数上限
    pub arbitrage_growth: f64,
    /// release 构建下 10 年模拟的耗时上限（秒）
    pub ten_year_secs: f64,
}

impl Default for Thresholds {
    fn default() -> Self {
        Thresholds {
            price_change_pct: (-5.0, 8.0),
            bound_share_pct: 20.0,
            alive_pct: 50.0,
            wealth_share_pct: 80.0,
            arbitrage_growth: 50.0,
            ten_year_secs: 120.0,
        }
    }
}

/// 一局的统计。
#[derive(Clone, Debug)]
pub struct RunResult {
    pub seed: u64,
    pub bot: BotKind,
    /// 开局与每年末的物价指数
    pub index: Vec<Fx>,
    /// 开局与每年末的货币总量（先观测、不设阈值，ECONOMY.md 第 10 节）
    pub supply: Vec<Money>,
    /// 每种商品：卡在上下限的市场·天数、市场·天总数
    pub bound: Vec<(u64, u64)>,
    pub alive: usize,
    pub companies: usize,
    pub wealth_total: Money,
    pub wealth_max: Money,
    pub start_net_worth: Money,
    pub first_year_net_worth: Money,
    pub final_net_worth: Money,
    pub money_conserved: bool,
    pub battles: u32,
    pub scenario: ScenarioId,
    pub start_day: u32,
    pub audited_days: u32,
    pub trades: usize,
    pub departures: usize,
    pub first_money_failure: Option<u32>,
    /// 仅观测段的墙钟耗时；不含开局预演／养成，不参与确定性的报告正文。
    pub observation_time: std::time::Duration,
}

impl RunResult {
    /// 物价指数年化变化（百分比）。
    pub fn price_change_pct(&self) -> f64 {
        let (Some(first), Some(last)) = (self.index.first(), self.index.last()) else { return 0.0 };
        let years = (self.index.len() - 1).max(1) as f64;
        let ratio = last.raw() as f64 / (first.raw().max(1)) as f64;
        (ratio.powf(1.0 / years) - 1.0) * 100.0
    }

    /// 货币总量年化变化（百分比）。
    pub fn supply_change_pct(&self) -> f64 {
        let (Some(first), Some(last)) = (self.supply.first(), self.supply.last()) else { return 0.0 };
        let years = (self.supply.len() - 1).max(1) as f64;
        let ratio = *last as f64 / (*first).max(1) as f64;
        (ratio.max(0.0).powf(1.0 / years) - 1.0) * 100.0
    }

    /// 卡在上下限时间占比最高的商品及其占比（百分比）。
    pub fn worst_bound(&self) -> (usize, f64) {
        self.bound
            .iter()
            .enumerate()
            .map(|(g, (stuck, total))| (g, if *total == 0 { 0.0 } else { *stuck as f64 * 100.0 / *total as f64 }))
            .fold((0, 0.0), |a, b| if b.1 > a.1 { b } else { a })
    }

    pub fn alive_pct(&self) -> f64 {
        self.alive as f64 * 100.0 / self.companies.max(1) as f64
    }

    pub fn wealth_share_pct(&self) -> f64 {
        if self.wealth_total <= 0 { 0.0 } else { self.wealth_max as f64 * 100.0 / self.wealth_total as f64 }
    }

    pub fn first_year_growth(&self) -> f64 {
        self.first_year_net_worth as f64 / self.start_net_worth.max(1) as f64
    }
}

/// 运行一局：bot 代替玩家，关闭 AI，逐日统计。`info` 是开局选的行情情报（随船传递时 bot 与商会都只用自己知道的行情）。
pub fn run_one(
    defs: Arc<StaticData>,
    seed: u64,
    bot: BotKind,
    years: u32,
    info: InfoMode,
) -> Result<RunResult, SimError> {
    run_one_scenario(defs.clone(), seed, bot, years, info, default_scenario(&defs)?, false)
}

/// 寰宇自由航海作为经济观测入口，其他世界保持原先的首剧本。
pub fn default_scenario(defs: &StaticData) -> Result<ScenarioId, SimError> {
    if defs.world_key == "terra16" {
        defs.find_scenario("free_1557").ok_or_else(|| SimError::Storage("缺少自由航海剧本".into()))
    } else {
        Ok(ScenarioId(0))
    }
}

/// 按指定剧本运行；结业模式先逐日走完养成，再统计完整的指定年数。
pub fn run_one_scenario(
    defs: Arc<StaticData>,
    seed: u64,
    bot: BotKind,
    years: u32,
    info: InfoMode,
    scenario: ScenarioId,
    after_graduation: bool,
) -> Result<RunResult, SimError> {
    if after_graduation && !defs.scenarios.get(scenario.idx()).is_some_and(|s| s.upbringing) {
        return Err(SimError::Storage("结业观测须选择养成剧本".into()));
    }
    if defs.world_key != "classic" {
        eprintln!("平衡开局 {} seed={seed} bot={bot}；保留剧本预演", defs.world_key);
    }
    let mut session = GameSession::new(defs.clone(), scenario, seed)?;
    session.choose_info(info)?;
    let mut player = Bot::new(bot);
    let mut first_money_failure = None;
    let mut audited_days = 0;
    if after_graduation {
        if !session.world.upbringing_active() {
            return Err(SimError::Storage("结业观测须选择养成剧本".into()));
        }
        let limit = defs.calendar.year_days().saturating_mul(5);
        while session.world.upbringing_active() {
            if audited_days >= limit {
                return Err(SimError::Storage("养成未在规定学程内结业".into()));
            }
            player.act(&mut session);
            session.advance_day()?;
            audited_days += 1;
            if !session.world.money_conserved() {
                first_money_failure.get_or_insert(session.day());
            }
        }
    }
    let start_day = session.day();
    let first_log = session.log().len();
    let mut index = vec![stats::price_index(&session.world)];
    let mut supply = vec![stats::money_supply(&session.world)];
    let mut bound = vec![(0u64, 0u64); defs.goods.len()];
    let start_net_worth = stats::net_worth(&session.world, OwnerId::Player);
    let mut first_year_net_worth = start_net_worth;
    let mut money_conserved = first_money_failure.is_none();
    let observed = std::time::Instant::now();
    for _ in 0..years.saturating_mul(defs.calendar.year_days()) {
        player.act(&mut session);
        money_conserved &= session.world.money_conserved();
        session.advance_day()?;
        audited_days += 1;
        money_conserved &= session.world.money_conserved();
        if !money_conserved {
            first_money_failure.get_or_insert(session.day());
        }
        let (stuck, total) = stats::bound_counts(&session.world);
        for (g, ((lo, hi), n)) in stuck.iter().zip(total.iter()).enumerate() {
            bound[g].0 += (*lo + *hi) as u64;
            bound[g].1 += *n as u64;
        }
        if (session.day() - start_day).is_multiple_of(defs.calendar.year_days()) {
            index.push(stats::price_index(&session.world));
            supply.push(stats::money_supply(&session.world));
            money_conserved &= session.world.money_conserved();
            if index.len() == 2 {
                first_year_net_worth = stats::net_worth(&session.world, OwnerId::Player);
            }
            if defs.world_key != "classic" {
                eprintln!(
                    "平衡进度 {} seed={seed} bot={bot} year={} index={} money={money_conserved}",
                    defs.world_key,
                    index.len() - 1,
                    stats::price_index(&session.world)
                );
            }
        }
    }
    let w = &session.world;
    let observation_time = observed.elapsed();
    let (alive, companies) = stats::companies_alive(w);
    let (wealth_total, wealth_max) = stats::company_wealth(w);
    let result = RunResult {
        seed,
        bot,
        index,
        supply,
        bound,
        alive,
        companies,
        wealth_total,
        wealth_max,
        start_net_worth,
        first_year_net_worth,
        final_net_worth: stats::net_worth(w, OwnerId::Player),
        money_conserved,
        battles: w.state.battles.totals.values().sum(),
        scenario,
        start_day,
        audited_days,
        first_money_failure,
        observation_time,
        trades: session.log()[first_log..]
            .iter()
            .filter(|entry| {
                matches!(entry.command, manifest_core::Command::Buy { .. } | manifest_core::Command::Sell { .. })
            })
            .count(),
        departures: session.log()[first_log..]
            .iter()
            .filter(|entry| {
                matches!(
                    entry.command,
                    manifest_core::Command::SetSail { .. } | manifest_core::Command::Autopilot { .. }
                )
            })
            .count(),
    };
    if defs.world_key != "classic" {
        // T02 的观测（只写到标准错误，不进报告正文）：港口发展度的分布、投资与分红、玩家现金
        eprintln!("{}", investment_observation(w, seed, bot));
        eprintln!(
            "平衡完成 {} seed={seed} bot={bot} alive={}/{} net={} trades={} departures={} money_failure={:?}",
            defs.world_key,
            result.alive,
            result.companies,
            result.final_net_worth,
            result.trades,
            result.departures,
            result.first_money_failure
        );
    }
    Ok(result)
}

/// 一局结束时港口投资的观测（T02）：港口发展度分档的个数与最高的那一处、那里最大一家投资者的占比；
/// 商会、玩家各自的累计投资；累计分出的商馆分红；遭劫过的港口数；玩家现金。只用于前后对照，不设阈值。
fn investment_observation(w: &manifest_core::World, seed: u64, bot: BotKind) -> String {
    let defs = &w.defs;
    let development = &defs.rules.development;
    let mut buckets = vec![0usize; if development.enabled { development.stages.len() + 1 } else { 4 }];
    let mut top: Option<(i64, usize)> = None;
    let (mut company_inv, mut player_inv) = (0i64, 0i64);
    for (i, l) in defs.locations.iter().enumerate() {
        if !l.is_port() {
            continue;
        }
        let ls = &w.state.locations[i];
        let b = if development.enabled {
            usize::from(development.stage(ls.development).0)
        } else {
            match ls.development {
                d if d >= 80 => 3,
                d if d >= 65 => 2,
                d if d > 50 => 1,
                _ => 0,
            }
        };
        buckets[b] += 1;
        if top.is_none_or(|(d, _)| ls.development > d) {
            top = Some((ls.development, i));
        }
        for (o, v) in &ls.investments {
            if o.company().is_some() {
                company_inv += *v;
            } else if o.is_player() {
                player_inv += *v;
            }
        }
    }
    let (top_dev, top_key, top_share) = top
        .map(|(d, i)| {
            let inv = &w.state.locations[i].investments;
            let total: i64 = inv.values().sum();
            let max = inv.values().copied().max().unwrap_or(0);
            (d, defs.locations[i].key.clone(), if total > 0 { max * 100 / total } else { 0 })
        })
        .unwrap_or((0, String::new(), 0));
    let dividends = w.state.money.sources.get(&manifest_core::treasury::Flow::HouseDividend).copied().unwrap_or(0);
    let cash = w.state.agents.get(&OwnerId::Player).map_or(0, |a| a.cash);
    let bucket_label = if development.enabled { "stages(0..6)" } else { "<=50/51-64/65-79/80+" };
    format!(
        "平衡观测 {} seed={seed} bot={bot} ports_dev({bucket_label})={:?} top_dev={top_dev}@{top_key} top_owner_share={top_share}% \
         invest_company={company_inv} invest_player={player_inv} dividends={dividends} sacked_ports={} player_cash={cash}",
        defs.world_key,
        buckets,
        w.state.house.sacks.len()
    )
}

/// 并行运行全部对局（种子 1..=seeds × 四种 bot），结果按（种子, bot）排序。
pub fn run_all(
    defs: Arc<StaticData>,
    seeds: u32,
    years: u32,
    threads: usize,
    info: InfoMode,
) -> Result<Vec<RunResult>, SimError> {
    run_all_scenario(defs.clone(), seeds, years, threads, info, default_scenario(&defs)?, false)
}

pub fn run_all_scenario(
    defs: Arc<StaticData>,
    seeds: u32,
    years: u32,
    threads: usize,
    info: InfoMode,
    scenario: ScenarioId,
    after_graduation: bool,
) -> Result<Vec<RunResult>, SimError> {
    let threads = std::env::var("MANIFEST_BALANCE_THREADS")
        .ok()
        .and_then(|s| s.parse::<usize>().ok())
        .filter(|n| *n > 0)
        .map_or(threads, |cap| threads.min(cap));
    let jobs: Vec<(u64, BotKind)> =
        (1..=seeds as u64).flat_map(|s| BotKind::ALL.iter().map(move |b| (s, *b))).collect();
    let next = AtomicUsize::new(0);
    let results: Mutex<Vec<Result<RunResult, SimError>>> = Mutex::new(Vec::new());
    std::thread::scope(|scope| {
        for _ in 0..threads.max(1).min(jobs.len().max(1)) {
            scope.spawn(|| {
                loop {
                    let i = next.fetch_add(1, Ordering::SeqCst);
                    let Some((seed, bot)) = jobs.get(i).copied() else { break };
                    let r = run_one_scenario(defs.clone(), seed, bot, years, info, scenario, after_graduation);
                    if let Ok(mut v) = results.lock() {
                        v.push(r);
                    }
                }
            });
        }
    });
    let mut out = Vec::new();
    for r in results.into_inner().map_err(|_| SimError::Storage("平衡测试线程异常".into()))? {
        out.push(r?);
    }
    out.sort_by_key(|r| (r.seed, BotKind::ALL.iter().position(|b| *b == r.bot).unwrap_or(0)));
    Ok(out)
}

/// 判定结果。
#[derive(Clone, Debug)]
pub struct Verdict {
    pub name: &'static str,
    pub value: String,
    pub threshold: String,
    pub pass: bool,
}

/// 按阈值判定。`ten_year_secs` 为调用方测得的 10 年模拟耗时。
pub fn judge(defs: &StaticData, runs: &[RunResult], t: &Thresholds, ten_year_secs: f64) -> Vec<Verdict> {
    let fmt = |v: f64| format!("{v:.2}");
    let mut out = Vec::new();
    let changes: Vec<f64> = runs.iter().map(|r| r.price_change_pct()).collect();
    let lo = changes.iter().copied().fold(f64::INFINITY, f64::min);
    let hi = changes.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    out.push(Verdict {
        name: "物价指数年化变化",
        value: format!("最低 {}%，最高 {}%", fmt(lo), fmt(hi)),
        threshold: format!("{}% 到 +{}%", t.price_change_pct.0, t.price_change_pct.1),
        pass: lo >= t.price_change_pct.0 && hi <= t.price_change_pct.1,
    });
    let (worst_good, worst_share) =
        runs.iter().map(|r| r.worst_bound()).fold((0, 0.0), |a, b| if b.1 > a.1 { b } else { a });
    out.push(Verdict {
        name: "单一商品卡在价格上下限的时间占比",
        value: format!(
            "最高 {}%（{}）",
            fmt(worst_share),
            defs.goods.get(worst_good).map(|g| g.name.as_str()).unwrap_or("")
        ),
        threshold: format!("≤ {}%", t.bound_share_pct),
        pass: worst_share <= t.bound_share_pct,
    });
    let min_alive = runs.iter().min_by(|a, b| a.alive_pct().total_cmp(&b.alive_pct()));
    out.push(Verdict {
        name: "期末 NPC 商会存活比例",
        value: min_alive.map(|r| format!("最少 {}/{}", r.alive, r.companies)).unwrap_or_default(),
        threshold: format!("≥ {}%", t.alive_pct),
        pass: runs.iter().all(|r| r.alive_pct() >= t.alive_pct),
    });
    let max_share = runs.iter().map(|r| r.wealth_share_pct()).fold(0.0, f64::max);
    out.push(Verdict {
        name: "单一商会占全部商会财富",
        value: format!("最高 {}%", fmt(max_share)),
        threshold: format!("≤ {}%", t.wealth_share_pct),
        pass: max_share <= t.wealth_share_pct,
    });
    let growth = runs.iter().filter(|r| r.bot == BotKind::Arbitrage).map(|r| r.first_year_growth()).fold(0.0, f64::max);
    out.push(Verdict {
        name: "套利 bot 第一年资产增长倍数",
        value: format!("最高 {} 倍", fmt(growth)),
        threshold: format!("≤ {} 倍", t.arbitrage_growth),
        pass: growth <= t.arbitrage_growth,
    });
    let perf = ten_year_secs <= t.ten_year_secs;
    out.push(Verdict {
        name: "release 构建下 10 年模拟耗时",
        value: if perf { format!("< {} 秒", t.ten_year_secs) } else { format!("超过 {} 秒", t.ten_year_secs) },
        threshold: format!("< {} 秒", t.ten_year_secs),
        pass: perf,
    });
    let conserved = runs.iter().filter(|r| r.money_conserved).count();
    out.push(Verdict {
        name: "货币守恒",
        value: format!("{conserved}/{} 局", runs.len()),
        threshold: "全部守恒".into(),
        pass: conserved == runs.len(),
    });
    out
}

/// 生成报告（Markdown）。内容只取决于对局结果与运行参数。
pub fn report(
    defs: &StaticData,
    runs: &[RunResult],
    verdicts: &[Verdict],
    seeds: u32,
    years: u32,
    info: InfoMode,
) -> String {
    let mut s = String::new();
    let scenario_id = runs.first().map(|r| r.scenario).unwrap_or(ScenarioId(0));
    let scenario = defs.scenarios.get(scenario_id.idx()).map(|x| x.name.as_str()).unwrap_or("");
    let bots: Vec<&str> = BotKind::ALL.iter().map(|b| b.name()).collect();
    let info = match info {
        InfoMode::Live => "实时（经典）",
        InfoMode::Carried => "随船传递",
    };
    s.push_str(&format!(
        "运行参数：种子 1–{seeds} × bot（{}）× {years} 年，剧本「{scenario}」，行情情报{info}，AI 关闭；共 {} 局。\n\n",
        bots.join("、"),
        runs.len()
    ));
    s.push_str("| 指标 | 结果 | 阈值 | 判定 |\n|---|---|---|---|\n");
    for v in verdicts {
        s.push_str(&format!(
            "| {} | {} | {} | {} |\n",
            v.name,
            v.value,
            v.threshold,
            if v.pass { "通过" } else { "未通过" }
        ));
    }
    let wr = &defs.rules.world;
    s.push_str(&format!(
        "\n各 bot 的玩家净资产（{}，中位数）与海战次数（平均）：\n\n| bot | 开局 | 第 1 年末 | 期末 | 海战 |\n|---|---|---|---|---|\n",
        wr.currency
    ));
    for b in BotKind::ALL {
        let rs: Vec<&RunResult> = runs.iter().filter(|r| r.bot == b).collect();
        if rs.is_empty() {
            continue;
        }
        let median = |f: &dyn Fn(&RunResult) -> Money| {
            let mut v: Vec<Money> = rs.iter().map(|r| f(r)).collect();
            v.sort();
            v[v.len() / 2]
        };
        let battles = rs.iter().map(|r| r.battles as u64).sum::<u64>() / rs.len() as u64;
        s.push_str(&format!(
            "| {} | {} | {} | {} | {} |\n",
            b.name(),
            median(&|r| r.start_net_worth),
            median(&|r| r.first_year_net_worth),
            median(&|r| r.final_net_worth),
            battles
        ));
    }
    s.push_str("\n物价指数（全部对局平均，开局与每 5 年末）：\n\n");
    let len = runs.iter().map(|r| r.index.len()).min().unwrap_or(0);
    let mut points = Vec::new();
    let mut sample_years: Vec<_> = (0..len).step_by(5).collect();
    if defs.world_key != "classic" && len > 1 && sample_years.last() != Some(&(len - 1)) {
        sample_years.push(len - 1);
    }
    for &y in &sample_years {
        let avg = runs.iter().map(|r| r.index[y].raw()).sum::<i64>() / runs.len().max(1) as i64;
        points.push(format!(
            "{}年初 {}",
            wr.calendar_year(y as u32 + 1 + runs.first().map_or(0, |r| r.start_day / defs.calendar.year_days())),
            Fx(avg)
        ));
    }
    s.push_str(&points.join(" · "));
    s.push('\n');
    // 货币总量（ECONOMY.md 第 10 节：先观测一轮再定阈值，这里只报告）
    if !runs.is_empty() {
        let changes: Vec<f64> = runs.iter().map(|r| r.supply_change_pct()).collect();
        let lo = changes.iter().copied().fold(f64::INFINITY, f64::min);
        let hi = changes.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        let same = runs.iter().filter(|r| (r.supply_change_pct() >= 0.0) == (r.price_change_pct() >= 0.0)).count();
        s.push_str(&format!(
            "\n货币总量年化变化（观测，暂不设阈值）：最低 {lo:.2}%，最高 {hi:.2}%；与物价指数同向的对局 {same}/{}。\n",
            runs.len()
        ));
    }
    if defs.world_key != "classic" {
        s.push_str("\n物价口径：全部市场现价／各自基准价的均值；开局不是 1。年化变化比较同一局的期初与期末，不以 1 作为通胀基期。\n");
        s.push_str("\n同局开测日＝1 的比较指数：");
        let normalized: Vec<_> = sample_years
            .iter()
            .map(|&y| {
                let sum: i64 = runs.iter().map(|r| Fx::ratio(r.index[y].raw(), r.index[0].raw().max(1)).raw()).sum();
                format!("第 {y} 年 {}", Fx(sum / runs.len().max(1) as i64))
            })
            .collect();
        s.push_str(&normalized.join(" · "));
        s.push('\n');
        s.push_str(&format!(
            "\n逐日货币核对 {} 日，现货买卖 {} 次，出航／引航命令 {} 次。\n",
            runs.iter().map(|r| u64::from(r.audited_days)).sum::<u64>(),
            runs.iter().map(|r| r.trades).sum::<usize>(),
            runs.iter().map(|r| r.departures).sum::<usize>()
        ));
    }
    let all = verdicts.iter().all(|v| v.pass);
    s.push_str(if all { "\n平衡检查全部通过\n" } else { "\n平衡检查未通过\n" });
    s
}

/// 把报告写入 BALANCE.md 的标记区间内（保留其余手写内容）。
pub fn splice_report(doc: &str, report: &str) -> String {
    const START: &str = "<!-- BALANCE-REPORT-START -->";
    const END: &str = "<!-- BALANCE-REPORT-END -->";
    match (doc.find(START), doc.find(END)) {
        (Some(a), Some(b)) if a < b => format!("{}{START}\n{report}{END}{}", &doc[..a], &doc[b + END.len()..]),
        _ => format!("{}\n\n## 最新报告\n{START}\n{report}{END}\n", doc.trim_end()),
    }
}

/// 具名世界使用独立标记，不覆盖经典报告或它两侧的手写内容。
pub fn splice_world_report(doc: &str, report: &str, world: &str) -> String {
    if world == "classic" {
        return splice_report(doc, report);
    }
    let start = format!("<!-- BALANCE-{world}-REPORT-START -->");
    let end = format!("<!-- BALANCE-{world}-REPORT-END -->");
    let title = if world == "terra16" { "寰宇最新报告" } else { "世界最新报告" };
    match (doc.find(&start), doc.find(&end)) {
        (Some(a), Some(b)) if a < b => format!("{}{start}\n{report}{end}{}", &doc[..a], &doc[b + end.len()..]),
        _ => format!("{doc}\n\n### {title}（{world}）\n{start}\n{report}{end}\n"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splice_keeps_manual_sections() {
        let doc = "# 平衡\n手写内容\n<!-- BALANCE-REPORT-START -->\n旧报告\n<!-- BALANCE-REPORT-END -->\n尾部\n";
        let out = splice_report(doc, "新报告\n");
        assert!(
            out.contains("手写内容") && out.contains("新报告") && !out.contains("旧报告") && out.ends_with("尾部\n")
        );
        assert_eq!(splice_report(&out, "新报告\n"), out, "重复写入结果不变");
        assert!(splice_report("# 空文档", "报告\n").contains("<!-- BALANCE-REPORT-START -->\n报告\n"));
    }
}
