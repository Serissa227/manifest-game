//! P11：事件节奏审计的验收——报告能生成、每局结业、时钟不卡死，记账与统计自洽；
//! 第二阶段另加：闸开着时每天都在预算之内、按下的事都出了场、没有因为按下而丢内容，
//! 关着闸重放的预算试算与内核的闸是同一套规则。
//!
//! 这里不把具体的频率数字写成断言；只查记账本身对不对：
//! 各来源之和等于总数、周与日的分布之和等于周数与天数、分类与旬调度的位一致、同一局的结果与并行方式无关，
//! 以及“开闸之后不比没开闸差”的几条方向性比较（同一家、同一个种子）。
//! 跑法见 `manifest_sim::pacing_audit`（与 `manifest-cli pacing-audit` 同一套）。
use manifest_core::defs::PacingRules;
use manifest_core::pacing::{BeatSource, BeatWeight};
use manifest_sim::pacing_audit::{AuditConfig, Report, RunAudit, Section, Spread, Stats, audit, markdown, report_json};
use std::collections::BTreeSet;
use std::sync::{Arc, OnceLock};

/// 寰宇的数据：`[pacing]` 开着。
fn defs() -> Arc<manifest_core::StaticData> {
    static DEFS: OnceLock<Arc<manifest_core::StaticData>> = OnceLock::new();
    DEFS.get_or_init(|| manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "terra16").unwrap()).clone()
}

/// 同一份数据，把节奏规则关掉：跑出来的就是没有闸时的样子。
fn defs_off() -> Arc<manifest_core::StaticData> {
    static DEFS: OnceLock<Arc<manifest_core::StaticData>> = OnceLock::new();
    DEFS.get_or_init(|| {
        let mut d = (*defs()).clone();
        d.rules.pacing.enabled = false;
        Arc::new(d)
    })
    .clone()
}

fn config(families: &[&str], threads: usize, sea_days: u32) -> AuditConfig {
    AuditConfig {
        families: families.iter().map(|s| (*s).to_owned()).collect(),
        presets: vec!["balanced".into()],
        seeds: vec![7],
        register_every: 2,
        threads,
        sea_days,
    }
}

/// 一位主角、一个自创出身，各带 20 天出海；全文件共用这一份（闸开着）。
fn report() -> &'static Report {
    static REPORT: OnceLock<Report> = OnceLock::new();
    REPORT.get_or_init(|| audit(defs(), &config(&["mio", "custom_seville_pilot"], 2, 20)))
}

/// 没有闸的对照：同一个自创出身、同一个种子（不带出海）。
fn baseline() -> &'static Report {
    static REPORT: OnceLock<Report> = OnceLock::new();
    REPORT.get_or_init(|| audit(defs_off(), &config(&["custom_seville_pilot"], 1, 0)))
}

fn check_spread(name: &str, s: &Spread) {
    assert_eq!(s.weekly.iter().sum::<u32>(), s.weeks, "{name}：周的分布之和不等于周数");
    assert_eq!(s.daily.iter().sum::<u32>(), s.days, "{name}：日的分布之和不等于天数");
    assert_eq!(s.days_ge2, s.daily[2] + s.daily[3] + s.daily[4], "{name}");
    assert_eq!(s.days_ge3, s.daily[3] + s.daily[4], "{name}");
    assert_eq!(s.days_ge4, s.daily[4], "{name}");
    assert!(s.monthly.total <= s.total && u64::from(s.monthly.max) <= s.total, "{name}");
    assert!(s.monthly.median <= s.monthly.p90 && s.monthly.p90 <= s.monthly.max, "{name}");
    assert!(s.day_max <= s.rolling7_max && u64::from(s.rolling7_max) <= s.total, "{name}");
    assert!(s.longest_quiet <= s.days, "{name}");
    assert_eq!(s.day_max >= 2, s.days_ge2 > 0, "{name}");
    assert_eq!(s.day_of_month.len(), 31, "{name}");
    // 最挤的几天按次数从多到少，第一条就是单日最多。
    assert!(s.worst_days.windows(2).all(|p| p[0].count >= p[1].count), "{name}");
    assert_eq!(s.worst_days.first().map_or(s.day_max.min(1), |d| d.count), s.day_max, "{name}");
    for d in &s.worst_days {
        assert_eq!(d.beats.len() as u32, d.count, "{name}");
    }
}

fn check_stats(name: &str, t: &Stats) {
    let sources: u64 = t.by_source.values().map(|s| s.total).sum();
    assert_eq!(sources, t.beats, "{name}：各来源之和不等于总数");
    let monthly: u64 = t.by_source.values().map(|s| s.monthly.total).sum();
    assert_eq!(monthly, t.monthly.total, "{name}：各来源完整月份之和不等于合计");
    let aside: u64 =
        [BeatSource::Plan, BeatSource::Continuation].iter().filter_map(|s| t.by_source.get(s)).map(|s| s.total).sum();
    assert_eq!(t.events.total + aside, t.beats, "{name}：独立打断 = 全部节拍 − 月程 − 续章");
    let weights: u64 = t.by_weight.values().map(|w| w.total).sum();
    assert_eq!(weights, t.events.total, "{name}：各分量之和不等于独立打断");
    assert_eq!(t.key.total + t.non_key.total, t.events.total, "{name}");
    assert_eq!(t.by_weight[&BeatWeight::Key].total, t.key.total, "{name}");
    assert!(t.unscheduled.total <= t.events.total && t.bond.total <= t.unscheduled.total, "{name}");
    for (label, s) in [
        ("全部", &t.events),
        ("要紧", &t.key),
        ("非要紧", &t.non_key),
        ("没过旬配额", &t.unscheduled),
        ("bond", &t.bond),
    ] {
        check_spread(&format!("{name} / {label}"), s);
        assert_eq!((s.days, s.weeks, s.monthly.n), (t.days, t.weeks, t.months), "{name} / {label}");
    }
    for (source, groups) in &t.groups {
        let listed: u64 = groups.iter().map(|g| g.count).sum();
        assert!(listed <= t.by_source[source].total && groups.len() <= 6, "{name} {source:?}");
    }
}

fn check_section(name: &str, s: &Section) {
    check_stats(name, &s.total);
    assert_eq!(s.flow.runs as usize, s.runs.len(), "{name}");
    assert_eq!(s.total.runs as usize, s.runs.len(), "{name}");
    let sum = |f: &dyn Fn(&RunAudit) -> u64| s.runs.iter().map(f).sum::<u64>();
    assert_eq!(sum(&|r| r.stats.beats), s.total.beats, "{name}：各局之和不等于合计");
    assert_eq!(sum(&|r| r.beats().len() as u64), s.total.beats, "{name}：记下的条数不等于统计的总数");
    assert_eq!(sum(&|r| u64::from(r.stats.days)), u64::from(s.total.days), "{name}");
    assert_eq!(sum(&|r| u64::from(r.stats.weeks)), u64::from(s.total.weeks), "{name}");
    assert_eq!(sum(&|r| u64::from(r.stats.months)), u64::from(s.total.months), "{name}");
    for r in &s.runs {
        let label = format!("{name} {}/{}", r.family, r.seed);
        check_stats(&label, &r.stats);
        assert!(r.errors.is_empty(), "{label}：{:?}", r.errors);
        assert!(r.finished, "{label}：没有跑完，停在 {:?}", r.end);
        assert!(r.stalls.is_empty(), "{label}：时钟卡死 {:?}", r.stalls);
        assert!(r.diverged.is_empty(), "{label}：回应不收敛 {:?}", r.diverged);
        assert_eq!(r.stuck.len() as u32, r.flow.bot_abandoned, "{label}：{:?}", r.stuck);
        let auto: u32 = r.auto_settled.values().flatten().sum();
        assert_eq!(auto, r.flow.auto_default + r.flow.auto_timeout + r.flow.auto_failed, "{label}");
        // 每条记录都落在观察期里，按出现先后排。
        assert!(r.beats().windows(2).all(|p| p[0].day <= p[1].day), "{label}");
        assert!(r.beats().iter().all(|b| b.date >= r.start && b.date < r.end && b.beat.since <= b.day), "{label}");
        // 一件事只记一次。
        let ids: BTreeSet<_> = r.beats().iter().map(|b| (&b.beat.key, &b.beat.chapter, b.beat.since)).collect();
        assert_eq!(ids.len(), r.beats().len(), "{label}：同一件事记了两次");
    }
    assert_eq!((s.flow.finished, s.flow.failed, s.flow.stalls, s.flow.diverged), (s.flow.runs, 0, 0, 0), "{name}");
}

#[test]
fn upbringing_runs_graduate_without_stalls_and_the_books_balance() {
    let s = &report().upbringing;
    assert_eq!(s.runs.len(), 2);
    check_section("养成", s);
    check_section("养成（没有闸）", &baseline().upbringing);
    // 跑法当天就把在等的事答完：没有一件事等过夜。
    assert_eq!(s.flow.max_wait_days, 0);
    for r in s.runs.iter().chain(&baseline().upbringing.runs) {
        let label = format!("{}/{}", r.family, r.seed);
        // 养成期只有这几类来源；出海的遭遇不会出现。
        use BeatSource::*;
        let allowed = [Plan, LowMood, Timed, Letter, Focus, Ordinary, Filler, Bond, Continuation];
        assert!(r.stats.by_source.keys().all(|k| allowed.contains(k)), "{label}：{:?}", r.stats.by_source.keys());
        // 按旬：每个月都排过月程；月程与续章以外的才算独立打断。
        // U05 按周（寰宇）：常设周课表每周一自动铺开，只有铺不上（开局、换阶段、钱不够等）才停下等排程，
        // 所以“等排程”的节拍不再每月一次；改成至少开局那一次，且每一次都落在一个具体的周（key 带周序）。
        let months: BTreeSet<&str> =
            r.beats().iter().filter(|b| b.beat.source == Plan).map(|b| b.beat.key.as_str()).collect();
        let action_mode = defs().upbringing.family(&r.family).unwrap().act;
        if defs().rules.upbringing.weekly.is_some() {
            assert!(r.stats.months >= 12, "{label}：{} 次", months.len());
            // U06K：行动制不再产生旧月/周程的 Plan 节拍。
            if !action_mode {
                assert!(!months.is_empty(), "{label}：{} 次", months.len());
            }
            assert!(months.iter().all(|k| k.contains("-w")), "{label}：{months:?}");
        } else {
            assert!(months.len() as u32 >= r.stats.months && r.stats.months >= 12, "{label}：{} 个月", months.len());
        }
        assert!(r.beats().iter().filter(|b| b.beat.source == Plan).all(|b| b.beat.weight == BeatWeight::Key));
        // 分类与旬调度的位一致：过了旬配额的才带位，bond 一律不带。
        // U06a 周节奏取代旧旬位配额；这里仍核对来源的分类位。
        for b in r.beats() {
            match b.beat.source {
                Bond | Plan => assert_eq!(b.beat.slot, None, "{label} {b:?}"),
                Focus => assert_eq!(b.beat.slot, Some(0), "{label} {b:?}"),
                Ordinary | Filler => assert_eq!(b.beat.slot, Some(1), "{label} {b:?}"),
                LowMood => assert!(b.beat.slot.is_some(), "{label} {b:?}"),
                _ => {}
            }
        }
        // 行动制的地点标记要主动访问，缺省 bot 不再保证自动羁绊非零。
        if !action_mode {
            assert!(r.stats.bond.total > 0, "{label}：没有记到不经旬调度的线");
        }
        // 养成期答不了的章节由引擎自动作罢，轮不到跑法来放弃。
        assert_eq!(r.flow.bot_abandoned, 0, "{label}：{:?}", r.stuck);
        // 没开闸的那一局不带闸的记录。
        assert_eq!(r.beats().iter().any(|b| b.held_days.is_some()), r.gate.as_ref().is_some_and(|g| g.released > 0));
    }
    // 写好的限时内容的覆盖只统计门槛日期到了、这一局的路线用得上的。
    assert!(s.coverage.values().all(|[shown, due]| shown <= due && *due > 0), "{:?}", s.coverage);
    assert!(s.runs.iter().all(|r| r.coverage.contains_key("festival")), "{:?}", s.runs[0].coverage);
    // 出海段不统计这一项。
    assert!(report().sea_after.as_ref().is_some_and(|sea| sea.coverage.is_empty()));
}

#[test]
fn budget_trials_replay_the_baseline_without_losing_or_inventing_beats() {
    let s = &baseline().upbringing;
    let t = &s.total;
    let rules = |daily, window_soft, max_defer_days| PacingRules {
        enabled: false,
        daily,
        window_days: 7,
        window_soft,
        max_defer_days,
    };
    // 不设上限的闸什么也不挪：重放出来就是记下的样子。要紧的事在任何预算下都不挪。
    let open = s.trial(&defs_off(), &rules(u32::MAX, u32::MAX, u32::MAX));
    assert_eq!((open.key_arrivals, open.arrivals), (t.key.total, t.non_key.total));
    assert_eq!((open.delayed, open.by_last_day, open.by_full_wait, open.by_budget, open.backlog), (0, 0, 0, 0, 0));
    assert_eq!((open.day_max, open.days_over), (t.events.day_max, 0));
    assert_eq!(open.weekly, t.non_key.weekly_dist);
    // 网格：单日上限 1–3 × 窗口上限三档（从刚好大于周均到达数起）× 最久等一旬与三周；数据包里的那一格就在里面。
    let floor = t.non_key.weekly_dist.mean.floor() as u32 + 1;
    assert_eq!(s.trials.len(), 18);
    assert_eq!(s.trials.iter().map(|x| x.window_soft).min(), Some(floor));
    let shipped = &defs().rules.pacing;
    assert!(
        s.trials.iter().any(|x| {
            (x.daily, x.window_days, x.window_soft, x.max_defer_days)
                == (shipped.daily, shipped.window_days, shipped.window_soft, shipped.max_defer_days)
        }),
        "网格里没有数据包用的那一格"
    );
    for x in &s.trials {
        let label = format!("单日 {} / 窗口 {} / 最久 {}", x.daily, x.window_soft, x.max_defer_days);
        assert_eq!((x.key_arrivals, x.arrivals), (t.key.total, t.non_key.total), "{label}");
        // 被按下的事要么按三种原因之一出了场，要么期末还压着：一件不多、一件不少。
        assert_eq!(x.delayed, x.by_last_day + x.by_full_wait + x.by_budget + x.backlog, "{label}");
        assert!(x.delayed <= x.arrivals, "{label}");
        // 要紧的事照出：单日最多不会低于记录里要紧事的单日最多；超过单日上限的日子只能是要紧事自己顶破的，或者有最后一天的放行。
        assert!(x.day_max >= t.key.day_max, "{label}");
        assert!((x.days_over == 0) == (x.day_max <= x.daily) && x.days_over_by_last_day <= x.days_over, "{label}");
        assert_eq!(x.weekly.n, t.weeks, "{label}");
        assert_eq!(x.weekly.total + x.backlog, x.arrivals, "{label}：完整的周之外没有别的日子");
        assert_eq!(x, &s.trial(&defs_off(), &rules(x.daily, x.window_soft, x.max_defer_days)), "{label}");
    }
    // 预算越紧，被按下的越多。
    let delayed = |daily, window_soft, max_defer_days| {
        s.trials
            .iter()
            .find(|x| (x.daily, x.window_soft, x.max_defer_days) == (daily, window_soft, max_defer_days))
            .map(|x| x.delayed)
            .unwrap()
    };
    assert!(delayed(1, floor, 10) >= delayed(2, floor, 10) && delayed(2, floor, 10) >= delayed(3, floor, 10));
    assert!(delayed(2, floor, 10) >= delayed(2, floor + 2, 10));

    // U06a 7f68ffbd：周节奏不走旧闸；此处测旧闸的重放，明确选与旧闸记账专测相同的旧制夹具。
    let mut legacy = (*defs()).clone();
    legacy.rules.upbringing.cadence = None;
    legacy.rules.upbringing.act = None;
    let gated_report = audit(Arc::new(legacy), &config(&["mio", "custom_seville_pilot"], 2, 0));
    let gated = &gated_report.upbringing;
    assert_eq!(gated.trials.len(), 1);
    let again = &gated.trials[0];
    assert_eq!((again.daily, again.window_soft, again.max_defer_days), (2, 3, 10));
    assert_eq!((again.key_arrivals, again.arrivals), (gated.total.key.total, gated.total.non_key.total));
    assert!(again.delayed_pct <= 5.0 && again.backlog == 0, "{again:?}");
    // 出海段不做试算。
    assert!(report().sea_after.as_ref().unwrap().trials.is_empty());
}

#[test]
fn the_gate_keeps_every_day_within_budget_and_drops_nothing() {
    // U06a（7f68ffbd）在养成期取代旧闸；这条旧闸专测显式选旧制夹具。
    let mut legacy = (*defs()).clone();
    legacy.rules.upbringing.cadence = None;
    legacy.rules.upbringing.act = None;
    let on = audit(Arc::new(legacy.clone()), &config(&["mio", "custom_seville_pilot"], 2, 0));
    legacy.rules.pacing.enabled = false;
    let off = audit(Arc::new(legacy), &config(&["custom_seville_pilot"], 1, 0));
    let report = || &on;
    let baseline = || &off;
    let rules = &defs().rules.pacing;
    assert_eq!(report().pacing, *rules);
    assert!(rules.enabled && !baseline().pacing.enabled);
    assert!(baseline().upbringing.gate.is_none() && baseline().upbringing.runs.iter().all(|r| r.gate.is_none()));
    let s = &report().upbringing;
    let g = s.gate.as_ref().expect("闸开着：养成期有闸的实测");
    // 闸守规矩：没有该放不放的，没有哪一天超出口径，账也对得上。
    assert_eq!((g.violations, g.over_days, g.mismatch_days), (0, 0, 0), "{g:?}");
    // 被按下的事都出了场：结业时没有还按着的，也没有按着的时候走掉的。
    assert!(g.held > 0, "这两局里没有一件事被按下，查不出什么");
    assert_eq!((g.released, g.still_held, g.dropped), (g.held, 0, 0), "{g:?}");
    assert_eq!(g.by_last_day + g.by_full_wait + g.by_budget, g.released);
    assert_eq!((g.wait.n as u64, g.wait.max >= 1), (g.released, true));
    // 最久也就是等满一旬，再加上因为当天名额已满多排的那几天；它是候选的日子不会比按日历算的更多。
    assert!(g.wait.max <= rules.max_defer_days + g.queued_days_max, "{g:?}");
    assert!(g.present.n == g.wait.n && g.present.total <= g.wait.total && g.present.max <= g.wait.max, "{g:?}");
    assert!(g.held <= g.soft && g.soft == s.total.non_key.total);
    for r in &s.runs {
        let label = format!("{}/{}", r.family, r.seed);
        let rg = r.gate.as_ref().expect("每局都有闸的实测");
        assert_eq!((rg.violations, rg.over_days, rg.still_held, rg.dropped), (0, 0, 0, 0), "{label}");
        // 可以等的事一天里不超过单日上限，除非有最后一天的放行。
        let late = r.beats().iter().filter(|b| b.last_chance).count() as u32;
        assert!(r.stats.non_key.day_max <= rules.daily + late, "{label}");
        // 被按下过的每一件都记着等了几天。
        let waited: Vec<u32> = r.beats().iter().filter_map(|b| b.held_days).collect();
        assert_eq!(waited.len() as u64, rg.released, "{label}");
        assert!(waited.iter().all(|d| *d >= 1), "{label}：{waited:?}");
    }

    // 同一家、同一个种子，开闸前后：都结业；内容没有少；扎堆的日子少了。
    let (on, off) = (&s.runs[1], &baseline().upbringing.runs[0]);
    assert_eq!((&on.family, on.seed), (&off.family, off.seed));
    assert!(on.finished && off.finished);
    for (part, [shown, due]) in &off.coverage {
        let [gated, gated_due] = on.coverage[part];
        assert_eq!(gated_due, *due, "{part}");
        assert!(gated >= *shown, "{part}：开闸后出场 {gated} 条，没开闸时 {shown} 条");
    }
    let (a, b) = (&on.stats, &off.stats);
    assert!(a.events.day_max <= b.events.day_max && a.events.days_ge3 < b.events.days_ge3, "{:?}", a.events.daily);
    assert!(a.non_key.day_max <= b.non_key.day_max && a.bond.day_max <= b.bond.day_max);
    // 闸只管什么时候出场：出场的总数与没开闸时相差无几，要紧的事也一样
    // （要紧的事从不被按下；别的事晚几天出场会让个别后续的事早一点或晚一点，所以不是逐件相同）。
    for (name, x, y) in [("独立打断", a.events.total, b.events.total), ("要紧的事", a.key.total, b.key.total)]
        .map(|(n, x, y)| (n, x as i64, y as i64))
    {
        assert!((x - y).abs() * 20 <= y, "{name} {x} 件，没开闸时 {y} 件");
    }
    assert!(a.key.day_max <= b.events.day_max);
    // 没有多丢羁绊线：窗口到期时条件仍不满足而失败的章节没有因为出场被推迟而变多。
    let failed = |r: &RunAudit| r.auto_settled.get("bond").map_or(0, |n| n[2]);
    assert!(failed(on) <= failed(off), "羁绊线失败 {} 章，没开闸时 {} 章", failed(on), failed(off));
}

#[test]
fn both_sea_legs_run_their_days_and_only_carry_sea_sources() {
    let report = report();
    let after = report.sea_after.as_ref().expect("结业后出海");
    let free = report.sea_free.as_ref().expect("自由航海");
    assert_eq!((after.runs.len(), free.runs.len()), (2, 1));
    for (name, s) in [("结业后出海", after), ("自由航海", free)] {
        check_section(name, s);
        assert_eq!(s.total.days, 20 * s.runs.len() as u32, "{name}");
        use BeatSource::*;
        let allowed = [Timed, Continuation, Story, Encounter, Creature, Battle];
        assert!(s.total.by_source.keys().all(|k| allowed.contains(k)), "{name}：{:?}", s.total.by_source.keys());
        // 出海没有旬配额。
        assert!(s.runs.iter().flat_map(|r| r.beats()).all(|b| b.beat.slot.is_none()), "{name}");
        // 闸开着：没有该放不放的；答不了的章节排在队列末尾等条件，跑法不再替玩家作罢。
        let g = s.gate.as_ref().expect("闸的实测");
        assert_eq!((g.violations, s.flow.bot_abandoned), (0, 0), "{name}：{g:?}");
        assert!(s.stuck.is_empty(), "{name}：{:?}", s.stuck);
        // 出海后章节多绑着港口：按日历可以等很久（船走开了），但人在场的日子里，被按着不超过一旬加上排队的那几天。
        assert!(g.present.max <= report.pacing.max_defer_days + g.queued_days_max, "{name}：{g:?}");
        assert!(g.present.total <= g.wait.total, "{name}：{g:?}");
        // 可以等的事一天里不超过单日上限（出海后可以等的事没有“最后一天”）。
        assert!(s.total.non_key.day_max <= report.pacing.daily, "{name}：{:?}", s.total.non_key.worst_days);
    }
    // 结业后的那一段接着养成的最后一天往下走。
    for (sea, home) in after.runs.iter().zip(&report.upbringing.runs) {
        assert_eq!((&sea.family, sea.seed, sea.start), (&home.family, home.seed, home.end));
    }
    assert_eq!(free.runs[0].family, "free_1557");
}

#[test]
fn the_report_renders_to_json_and_a_chinese_summary() {
    let report = report();
    let json: serde_json::Value = serde_json::from_str(&report_json(report)).unwrap();
    assert_eq!(json["world"], "terra16");
    assert_eq!(json["config"]["sea_days"], 20);
    assert_eq!(json["upbringing"]["runs"].as_array().unwrap().len(), 2);
    assert_eq!(json["upbringing"]["total"]["beats"], report.upbringing.total.beats);
    // 来源与分量用内核的名字作键。
    assert!(json["upbringing"]["total"]["by_source"]["plan"]["total"].as_u64().unwrap() > 0);
    assert!(json["upbringing"]["total"]["by_weight"]["key"].is_object());
    // 报告只取决于数据、节奏规则与种子：线程数不写进去；用的是哪一组规则写在报告里。
    assert!(json["config"].get("threads").is_none());
    assert_eq!(
        json["pacing"],
        serde_json::json!({"enabled":true,"daily":2,"window_days":7,"window_soft":3,"max_defer_days":10})
    );
    assert_eq!(json["upbringing"]["gate"]["held"], 0, "U06a 养成期不启用旧闸");
    assert!(json["upbringing"]["runs"][0]["gate"].is_object());
    let text = markdown(report);
    for heading in [
        "# 事件节奏审计",
        "## 一、养成期",
        "## 二、出海：养成结业后接着走",
        "## 三、出海：自由航海剧本",
        "## 附：轨道盘点",
    ] {
        assert!(text.contains(heading), "摘要缺少“{heading}”");
    }
    for label in [
        "节奏的闸：开（单日上限 2 / 7 天窗口内可以等的事 3 件 / 最久等 10 天）",
        "月程安排（plan）",
        "独立打断（不含月程与续章）",
        "要紧（Key）",
        "每周次数的分布",
        "单日与连续",
        "通畅",
        "闸的实测",
        "预算试算",
    ] {
        assert!(text.contains(label), "摘要缺少“{label}”");
    }
    // 没开闸的那一份写明闸关着，没有“闸的实测”，试算是一张网格。
    let plain = markdown(baseline());
    assert!(plain.contains("节奏的闸：关") && !plain.contains("闸的实测") && plain.contains("预算试算"));
    let plain: serde_json::Value = serde_json::from_str(&report_json(baseline())).unwrap();
    assert_eq!(plain["pacing"]["enabled"], false);
    assert!(plain["upbringing"].get("gate").is_none());
    // 轨道盘点与数据一致。
    let d = defs();
    assert_eq!(report.inventory.tracks, d.story2.tracks.len());
    assert_eq!(report.inventory.by_kind.values().sum::<usize>(), report.inventory.tracks);
    assert!(report.inventory.auto_academy_ungated <= report.inventory.auto_academy);
}

#[test]
fn a_run_does_not_depend_on_its_neighbours_or_the_thread_count() {
    // 同一局单独再跑一遍（一条线程、不带出海）：与并行跑出来的那一局逐字段相同。
    let alone = audit(defs(), &config(&["custom_seville_pilot"], 1, 0));
    assert!(alone.sea_after.is_none() && alone.sea_free.is_none());
    let a = serde_json::to_value(&alone.upbringing.runs[0]).unwrap();
    let b = serde_json::to_value(&report().upbringing.runs[1]).unwrap();
    assert_eq!(a, b);
    assert_eq!(alone.upbringing.runs[0].beats().len(), report().upbringing.runs[1].beats().len());
}
