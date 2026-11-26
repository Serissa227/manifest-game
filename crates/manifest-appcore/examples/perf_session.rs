//! P01 会话与真实视图基线；只使用离线 NPC，时钟与 IO 全留在 example 层。

#[path = "../../../tools/perf/support.rs"]
mod support;

use manifest_appcore::views;
use manifest_core::{Command, OwnerId, ScenarioId, StaticData};
use manifest_sim::GameSession;
use serde_json::json;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;
use support::{Args, Result, measure, nav_memory, write_json};

fn nanos(start: Instant) -> u64 {
    start.elapsed().as_nanos().min(u128::from(u64::MAX)) as u64
}

fn distribution(samples: &[u64]) -> serde_json::Value {
    let mut sorted = samples.to_vec();
    sorted.sort_unstable();
    let n = sorted.len();
    let total: u64 = sorted.iter().sum();
    json!({
        "count": n, "total_ns": total, "mean_ns": total / n.max(1) as u64,
        "min_ns": sorted.first(), "max_ns": sorted.last(),
        "p50_ns": sorted.get(n.div_ceil(2).saturating_sub(1)),
        "p95_ns": sorted.get((n * 95).div_ceil(100).saturating_sub(1))
    })
}

fn new_session(defs: Arc<StaticData>, scenario: ScenarioId, seed: u64) -> Result<GameSession> {
    let mut session = GameSession::new(defs, scenario, seed)?;
    // 明确一条可重放的基线命令；不调用真实 LLM，不读取用户设置或存档。
    session.submit(Command::SetInfoMode { owner: OwnerId::Player, mode: manifest_core::info::InfoMode::Live })?;
    Ok(session)
}

struct Settings {
    root: PathBuf,
    world: String,
    scenario: String,
    seed: u64,
    days: u32,
    years: u32,
    queries: usize,
    out: PathBuf,
}

fn run(settings: Settings) -> Result<()> {
    let Settings { root, world, scenario, seed, days, years, queries, out } = settings;
    if let Some(report) = support::skipped(&root, &world)? {
        return write_json(&out.join("report.json"), &report);
    }
    let (first, cold) = measure(|| Ok(manifest_data::load_world(&root, &world)?))?;
    let (defs, warm) = measure(|| Ok(manifest_data::load_world(&root, &world)?))?;
    if first.meta.hash != defs.meta.hash {
        return Err("两次加载的世界指纹不同；测量时数据发生变化".into());
    }
    drop(first);
    let scenario = if scenario.is_empty() {
        defs.scenarios.iter().position(|s| s.key == "sandbox").unwrap_or(0)
    } else {
        defs.scenarios.iter().position(|s| s.key == scenario).ok_or("未知剧本")?
    };
    if scenario >= defs.scenarios.len() {
        return Err("世界没有可运行的剧本".into());
    }
    let days =
        if years == 0 { days } else { defs.calendar.year_days().checked_mul(years).ok_or("模拟天数溢出")? };
    let before = support::rss();
    let (mut session, initialization) = measure(|| new_session(defs.clone(), ScenarioId(scenario as u16), seed))?;
    let mut ticks = Vec::with_capacity(days as usize);
    let (_, simulation) = measure(|| {
        for _ in 0..days {
            let start = Instant::now();
            session.advance_day()?;
            ticks.push(nanos(start));
        }
        Ok(())
    })?;
    let after = support::rss();
    let state_hash = session.world.state_hash();
    let mut build = Vec::with_capacity(queries);
    let mut serialize = Vec::with_capacity(queries);
    let mut overview_bytes = Vec::new();
    for _ in 0..queries {
        let start = Instant::now();
        let overview = views::overview(&session.world, 0, "off".into(), None);
        build.push(nanos(start));
        let start = Instant::now();
        overview_bytes = serde_json::to_vec(&overview)?;
        serialize.push(nanos(start));
        std::hint::black_box(&overview_bytes);
    }
    // 分析和压缩在 Node 工具层完成，原始字节保持 Rust 的序列化顺序。
    use std::io::Write;
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(out.join("overview.json"))?
        .write_all(&overview_bytes)?;
    write_json(&out.join("static.json"), &views::static_view(&defs))?;
    write_json(&out.join("fog.json"), &views::fog_rows(&session.world))?;
    write_json(&out.join("command-log.json"), &session.log())?;
    write_json(&out.join("retained-event-log.json"), &session.world.state.log)?;
    write_json(
        &out.join("report.json"),
        &json!({
            "schema_version": 1, "package_version": env!("CARGO_PKG_VERSION"),
            "status": "ok", "case": "session", "world": world,
            "world_fingerprint": defs.meta.hash, "state_hash_blake3": state_hash,
            "seed": seed.to_string(), "scenario": defs.scenarios[scenario].key,
            "cells": defs.map.terrain.len(), "ports": defs.port_ids().count(),
            "periods": defs.nav.grid.period_count(), "calendar_months": defs.calendar.months().len(),
            "calendar_year_days": defs.calendar.year_days(), "days": days, "years_requested": years,
            "loading": {"cold_process": cold, "warm_in_process": warm,
                "api": "manifest_data::load_world", "warm_kind": "reparse with runtime in-process navigation cache",
                "thread_control": "runtime loader chooses its own workers; runner Threads controls B4 nav case only"},
            "initialization": initialization, "simulation": simulation, "daily_settlement": distribution(&ticks),
            "session_threads": 1, "external_ai": false,
            "overview": {"queries": queries, "build": distribution(&build), "serialize": distribution(&serialize),
                "view_api": "views::overview (plain Chinese, no translated names or handler envelope)",
                "json_bytes": overview_bytes.len(), "sample_day": session.day()},
            "navigation_memory": nav_memory(&defs.nav),
            "session_rss": {"before": before, "after": after,
                "note": "same process, includes shared definitions and allocator retention; not per-player capacity"},
            "command_log_entries": session.log().len(), "retained_event_log_entries": session.world.state.log.len(),
            "log_scope": "complete command log and bounded retained world event log, not all historical events",
            "pending_metrics": {"map_resource": "unavailable: B6", "fog_delta": "unavailable: B6",
                "navigation_preview": "unavailable: B7/B8"}
        }),
    )
}

fn main() -> Result<()> {
    let mut args = Args::parse(std::env::args().skip(1))?;
    let out = support::output_dir(&mut args)?;
    let root = args.required("--data-root")?;
    let world = args.required("--world")?;
    let scenario = args.optional("--scenario", "");
    let seed = args.number("--seed", 42, 0, u64::MAX)?;
    let days = args.number("--days", 30, 1, 1_000_000)? as u32;
    let years = args.number("--years", 0, 0, 100)? as u32;
    let queries = args.number("--queries", 3, 1, 100_000)? as usize;
    args.finish()?;
    run(Settings { root: root.into(), world, scenario, seed, days, years, queries, out })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn percentile_uses_nearest_rank_without_dropping_slow_days() {
        let result = distribution(&[100, 1, 2, 3, 4]);
        assert_eq!(result["count"], 5);
        assert_eq!(result["total_ns"], 110);
        assert_eq!(result["p50_ns"], 3);
        assert_eq!(result["p95_ns"], 100);
    }

    #[test]
    fn repeated_session_and_replay_keep_state_and_both_logs() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
        let defs = manifest_data::load_world(&root, "classic").expect("经典世界");
        let mut a = new_session(defs.clone(), ScenarioId(0), 42).expect("第一局");
        let mut b = new_session(defs, ScenarioId(0), 42).expect("第二局");
        for _ in 0..3 {
            a.advance_day().expect("结算");
            b.advance_day().expect("结算");
        }
        assert_eq!(a.world.state_hash(), b.world.state_hash());
        assert_eq!(serde_json::to_vec(a.log()).expect("日志"), serde_json::to_vec(b.log()).expect("日志"));
        assert_eq!(
            serde_json::to_vec(&a.world.state.log).expect("事件"),
            serde_json::to_vec(&b.world.state.log).expect("事件")
        );
        assert_eq!(a.world.state_hash(), a.replay().expect("重放").state_hash());
    }
}
