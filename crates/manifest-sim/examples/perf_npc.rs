//! P04：NPC 决策快照、临时分配和完整日结算的独立测量。
//!
//! `cargo run --release --locked -p manifest-sim --example perf_npc -- --world terra16
//! --out-dir build/p04/before-terra16 --days 90 --repeats 3`
//! 合成世界用 `--world synth1080`；首次生成的夹具放在输出目录。
//! 航程调用由同一份 npc.rs 的测量副本计数，并逐项核对正式入口的结果。
//! NPC 样本来自每日开盘的停港商会，先执行卸货再规划；不是 tick 内部阶段计时。
//! 日结算单独计时，分配另跑相同输入；加载、克隆、序列化和探针不计入耗时。
//!
//! 2026-10-25 开工实测（seed 42，90 日 × 3，原实现 037b526）：
//! 合成图 / terra16 的无阶段探针日结算均值为 93.95 / 163.10 ms。
//! 独立临时探针确认三个 NPC 决策入口占实际 tick 的 5.17% / 10.53%，
//! terra16 四年预推演占 11.87%；因此实施本卡的局部优化。
//! 共享机器负载波动明显，这些数字不能作为独占机器性能门禁的达标依据。
//! 后续相邻复测，原实现 → 优化版的日结算均值为合成图 46.40 → 45.60 ms、
//! terra16 156.92 → 155.47 ms；terra16 的 P95 为 191.18 → 197.02 ms，未观察到尾部改善。
//! 实际 tick 的 270 日累计 plan_days 调用为 1,703,229 → 375,927 / 4,065,939 → 1,204,899。
//! 三个 NPC 入口的调用次数逐日不变，逐日轨迹及每轮完整末态文件逐字节相同。
//! NPC 分配请求（同为 270 日）合成图为 30,606 次 / 2,614,086 B → 31,434 次 / 8,212,710 B，
//! terra16 为 34,857 次 / 27,012,594 B → 37,434 次 / 39,213,762 B。
//! 局部航程表增加临时分配，候选借用只消除全集复制及前三项权重向量；没有净分配下降。
//! 完整日结算请求字节分别增加约 0.265% / 0.081%，均值改善较小；统计不剔除慢样本，原始基线单独保留。
//! 原始 JSON、逐日轨迹、探针源码与二进制保存在 build/p04。
//! 临时探针没有进入内核提交；本工具缺省只报告明示的开盘快照采样。

pub use manifest_core::{command, commerce, defs, fixed, ids, market, open_market, rng, warehouse, world};

mod fleet {
    pub use manifest_core::fleet::{daily_supply_need, supply_margin};
    use manifest_core::{StaticData, nav::CompressedPath, world::Fleet};
    pub fn fleet_days_compressed(defs: &StaticData, fleet: &Fleet, path: &CompressedPath) -> i64 {
        super::ROUTE_CALLS.set(super::ROUTE_CALLS.get() + 1);
        manifest_core::fleet::fleet_days_compressed(defs, fleet, path)
    }
}

// 直接复用被测源码；不在生产内核加入计时器、分配器或诊断接口。
#[allow(dead_code)]
#[path = "../../manifest-core/src/npc.rs"]
mod counted_npc;

use manifest_core::npc::{self, PlannerParams};
use manifest_core::rng::{Domain, Rng};
use manifest_core::{ScenarioId, World};
use serde::Serialize;
use serde_json::json;
use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

thread_local! {
    // 缺省值仍是 None / 0，初始化不分配；避开本机 Rust 1.96 Windows GNU 的 const 初始化 lint 误报。
    static ALLOCS: Cell<Option<Allocation>> = Cell::default();
    static ROUTE_CALLS: Cell<u64> = Cell::default();
}

#[derive(Clone, Copy, Default, Serialize)]
struct Allocation {
    calls: u64,
    requested_bytes: u64,
}

fn record(size: usize) {
    let _ = ALLOCS.try_with(|slot| {
        if let Some(mut value) = slot.get() {
            value.calls += 1;
            value.requested_bytes += size as u64;
            slot.set(Some(value));
        }
    });
}

struct CountingAllocator;
// 安全：所有操作及布局原样转交 System，线程局部计数自身不分配内存。
unsafe impl GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let ptr = unsafe { System.alloc(layout) };
        if !ptr.is_null() {
            record(layout.size());
        }
        ptr
    }
    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        let ptr = unsafe { System.alloc_zeroed(layout) };
        if !ptr.is_null() {
            record(layout.size());
        }
        ptr
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        let ptr = unsafe { System.realloc(ptr, layout, new_size) };
        if !ptr.is_null() {
            record(new_size);
        }
        ptr
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        unsafe { System.dealloc(ptr, layout) };
    }
}

#[global_allocator]
static ALLOCATOR: CountingAllocator = CountingAllocator;

#[derive(Default, Serialize)]
struct Samples {
    ns: Vec<u64>,
    allocations: Allocation,
}

impl Samples {
    fn time<T>(&mut self, f: impl FnOnce() -> T) -> T {
        let start = Instant::now();
        let result = f();
        self.ns.push(start.elapsed().as_nanos() as u64);
        result
    }
    fn allocated<T>(&mut self, f: impl FnOnce() -> T) -> T {
        assert!(ALLOCS.get().is_none(), "分配测量不可嵌套");
        ALLOCS.set(Some(Allocation::default()));
        let result = f();
        let value = ALLOCS.replace(None).expect("测量区间");
        self.allocations.calls += value.calls;
        self.allocations.requested_bytes += value.requested_bytes;
        result
    }
    fn report(&self) -> serde_json::Value {
        let mut ns = self.ns.clone();
        ns.sort_unstable();
        let n = ns.len();
        let total: u64 = ns.iter().sum();
        json!({"calls": n, "total_ns": total, "mean_ns": total / n.max(1) as u64,
            "p50_ns": ns.get(n.div_ceil(2).saturating_sub(1)),
            "p95_ns": ns.get((n * 95).div_ceil(100).saturating_sub(1)),
            "allocation": self.allocations})
    }
}

#[derive(Default)]
struct Probe {
    unload: Samples,
    load: Samples,
    monthly: Samples,
    fleet_days_calls: u64,
}

fn same(a: &impl Serialize, b: &impl Serialize) -> Result<()> {
    if serde_json::to_vec(a)? != serde_json::to_vec(b)? {
        return Err("计数副本与正式入口的逐项结果不一致".into());
    }
    Ok(())
}

impl Probe {
    fn snapshot(&mut self, world: &World) -> Result<serde_json::Value> {
        let mut copy = world.clone();
        let mut trace = Vec::new();
        ROUTE_CALLS.set(0);
        let owners: Vec<_> = copy
            .state
            .agents
            .values()
            .filter(|a| !a.bankrupt && a.owner.company().is_some())
            .map(|a| a.owner)
            .collect();
        for owner in owners {
            let params = PlannerParams::for_owner(&copy, owner);
            let counted = counted_npc::PlannerParams::for_owner(&copy, owner);
            let fleets: Vec<_> = copy.fleets_of(owner).filter(|f| f.docked_at().is_some()).map(|f| f.id).collect();
            for fid in fleets {
                let unload = self.unload.time(|| npc::stage_unload(&copy, fid, &params));
                let again = self.unload.allocated(|| npc::stage_unload(&copy, fid, &params));
                same(&unload, &again)?;
                same(&unload, &counted_npc::stage_unload(&copy, fid, &counted))?;
                for cmd in &unload {
                    let _ = cmd.apply(&mut copy);
                }
                let make_rng = || Rng::derive(copy.state.seed, copy.day(), Domain::Company, u64::from(fid.0), 0);
                let mut rng = make_rng();
                let load = self.load.time(|| npc::plan_load(&copy, fid, &params, &mut rng));
                let next = rng.next_u64();
                let mut rng = make_rng();
                let again = self.load.allocated(|| npc::plan_load(&copy, fid, &params, &mut rng));
                same(
                    &(&load.commands, &load.hedge, &load.plan, next),
                    &(&again.commands, &again.hedge, &again.plan, rng.next_u64()),
                )?;
                let mut rng = make_rng();
                let measured = counted_npc::plan_load(&copy, fid, &counted, &mut rng);
                same(
                    &(&load.commands, &load.hedge, &load.plan, next),
                    &(&measured.commands, &measured.hedge, &measured.plan, rng.next_u64()),
                )?;
                trace.push(json!({"fleet":fid, "unload":unload, "commands":load.commands,
                    "hedge":load.hedge, "plan":load.plan, "rng_next":next}));
            }
            let make_rng = || {
                Rng::derive(
                    copy.state.seed,
                    copy.day(),
                    Domain::Company,
                    0,
                    owner.company().map_or(0, |c| u64::from(c.0)),
                )
            };
            let monthly = self.monthly.time(|| npc::company_monthly(&copy, owner, &mut make_rng()));
            let again = self.monthly.allocated(|| npc::company_monthly(&copy, owner, &mut make_rng()));
            same(&monthly, &again)?;
            trace.push(json!({"owner":owner,"monthly":monthly}));
        }
        self.fleet_days_calls += ROUTE_CALLS.get();
        Ok(json!(trace))
    }
}

fn create(path: &Path) -> Result<BufWriter<std::fs::File>> {
    Ok(BufWriter::new(std::fs::OpenOptions::new().write(true).create_new(true).open(path)?))
}

fn run(world: &str, out: &Path, days: u32, repeats: u32, seed: u64) -> Result<()> {
    std::fs::create_dir_all(out)?;
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
    let root = if world == "synth1080" {
        let fixture = out.join("fixture-data");
        manifest_data::bench::synth1080::write_world(&source, &fixture)?;
        fixture
    } else {
        source
    };
    let defs = manifest_data::load_world(&root, world)?;
    if world == "terra16" && defs.nav.grid.period_count() != 12 {
        return Err("真实 terra16 必须加载十二个月导航".into());
    }
    let key = if world == "terra16" { "free_1557" } else { "sandbox" };
    let scenario: ScenarioId = defs.find_scenario(key).ok_or("缺少基准剧本")?;
    eprintln!(
        "{world}: {} 港、{} 商品、{} 导航周期；初始化 {key}",
        defs.port_ids().count(),
        defs.goods.len(),
        defs.nav.grid.period_count()
    );
    let initial = World::new(defs.clone(), scenario, seed)?;
    let mut probe = Probe::default();
    let mut settlement = Samples::default();
    let mut trace = create(&out.join("trajectory.jsonl"))?;
    let mut expected_state = None;
    for repeat in 0..repeats {
        let mut current = initial.clone();
        for day in 0..days {
            let decisions = if repeat == 0 { Some(probe.snapshot(&current)?) } else { None };
            let mut allocated = (repeat == 0).then(|| current.clone());
            let report = settlement.time(|| current.end_day())?;
            if let Some(ref mut copy) = allocated {
                let again = settlement.allocated(|| copy.end_day())?;
                same(&report, &again)?;
                if current.state != copy.state {
                    return Err("分配测量改变了世界状态".into());
                }
            }
            // 只在第一轮写出完整逐日轨迹；重跑末态还会进行比较。
            if repeat == 0 {
                serde_json::to_writer(
                    &mut trace,
                    &json!({"day":current.day(), "decisions":decisions,
                    "report":report,"state_hash":current.state_hash(),"events":current.state.log}),
                )?;
                writeln!(trace)?;
            }
            if (day + 1) % 30 == 0 {
                eprintln!("{world}: 轮次 {}/{repeats}，{}/{days} 日", repeat + 1, day + 1);
            }
        }
        let mut state = create(&out.join(format!("state-{repeat}.json")))?;
        serde_json::to_writer(&mut state, &current.state)?;
        state.flush()?;
        if let Some(expected) = &expected_state {
            if expected != &current.state {
                return Err("重复测量的完整末态不同".into());
            }
        } else {
            expected_state = Some(current.state);
        }
    }
    trace.flush()?;
    let mut report = create(&out.join("report.json"))?;
    serde_json::to_writer_pretty(
        &mut report,
        &json!({
            "world":world,"world_hash":defs.meta.hash,"scenario":key,"seed":seed,
            "ports":defs.port_ids().count(),"goods":defs.goods.len(),"periods":defs.nav.grid.period_count(),
            "start_day":initial.day(),"days":days,"repeats":repeats,
            "npc_snapshot":{"unload":probe.unload.report(),"load":probe.load.report(),
                "monthly":probe.monthly.report(),"fleet_days_compressed_calls":probe.fleet_days_calls},
            "settlement":settlement.report(),
            "allocation_days":days,
            "allocation_scope":"单线程成功 alloc/alloc_zeroed/realloc 的次数与请求字节累加；不是峰值、存活字节或 RSS",
            "npc_scope":"每日开盘停港商会快照；卸货命令应用后规划；不等于 tick 内部 NPC 阶段",
            "timing_scope":"正式入口；计数副本、分配测量、克隆、初始化与序列化均在计时外",
            "decision_checks":"同份源码计数副本与正式入口逐项命令、套保、计划、RNG 后继值一致"
        }),
    )?;
    report.flush()?;
    Ok(())
}

fn main() -> Result<()> {
    let mut args = std::env::args().skip(1);
    let mut world = "terra16".to_string();
    let mut out = None;
    let mut days = 90;
    let mut repeats = 3;
    let mut seed = 42;
    while let Some(arg) = args.next() {
        let value = args.next().ok_or("参数缺少值")?;
        match arg.as_str() {
            "--world" => world = value,
            "--out-dir" => out = Some(PathBuf::from(value)),
            "--days" => days = value.parse()?,
            "--repeats" => repeats = value.parse()?,
            "--seed" => seed = value.parse()?,
            _ => return Err(format!("未知参数 {arg}").into()),
        }
    }
    if days == 0 || repeats == 0 {
        return Err("days 和 repeats 必须为正数".into());
    }
    run(&world, &out.ok_or("必须指定 --out-dir")?, days, repeats, seed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allocation_counts_reallocation_requests_and_stops_outside_scope() {
        let mut samples = Samples::default();
        samples.allocated(|| {
            let mut values: Vec<u8> = Vec::with_capacity(8);
            values.extend_from_slice(&[0; 8]);
            values.reserve_exact(24);
            std::hint::black_box(values);
        });
        assert_eq!(samples.allocations.calls, 2);
        assert_eq!(samples.allocations.requested_bytes, 40);
        assert!(ALLOCS.get().is_none());
    }

    #[test]
    fn distribution_keeps_slow_samples() {
        let samples = Samples { ns: vec![100, 1, 2, 3, 4], ..Default::default() };
        let report = samples.report();
        assert_eq!(report["calls"], 5);
        assert_eq!(report["total_ns"], 110);
        assert_eq!(report["p50_ns"], 3);
        assert_eq!(report["p95_ns"], 100);
    }

    #[test]
    fn snapshot_counts_routes_without_mutating_the_input() {
        let world = World::new(manifest_core::testkit::tiny_defs(), ScenarioId(0), 42).expect("夹具");
        let state = world.state.clone();
        let mut probe = Probe::default();
        probe.snapshot(&world).expect("命令、套保、计划及 RNG 一致");
        assert_eq!(world.state, state);
        assert!(probe.fleet_days_calls > 0);
        assert!(!probe.load.ns.is_empty());
        let stages = probe.unload.ns.len() + probe.load.ns.len();
        let bound = 2 * world.defs.port_ids().count().saturating_sub(1) * stages;
        assert!(probe.fleet_days_calls <= bound as u64, "每阶段每个目的港至多查询当前和下一周期一次");
    }
}
