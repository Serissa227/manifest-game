//! P05：真实寰宇、经典与合成图的逐日轨迹、日结算和分配测量。
//!
//! `cargo run --release --locked -p manifest-sim --example perf_tick --
//! --case mio --days 1460 --repeats 3 --out-dir build/p05/mio`
//! case 可选 mio / free / classic / synth1080。mio 在正常开局后提交 SkipUpbringing，
//! free 使用真实 free_1557 的四年预推演。初始存档可用 --initial 重用，读取后核对完整快照。
//! --allocations true 单独计分配；--trace false 可关闭逐日序列化，仍保存完整末态。
//! 加载、克隆、哈希与写文件均在日结算计时外。仅运行本地内核，不连接模型服务。
//!
//! 临时阶段探针可调用本例导出的 p05_stage(name, entering)；正式内核没有探针。
//! 没有探针时 stages 为空，不能据此声称完成了阶段剖面。探针源码与构建来源需另存。

use manifest_core::{Command, OwnerId, SaveFile, scenario::NewGameRequest};
use manifest_sim::GameSession;
use serde::Serialize;
use serde_json::json;
use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::{Cell, RefCell};
use std::collections::BTreeMap;
use std::io::{BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

#[derive(Clone, Copy, Default, Serialize)]
struct Allocation {
    calls: u64,
    requested_bytes: u64,
}

#[derive(Default, Serialize)]
struct Stage {
    calls: u64,
    ns: u64,
    allocation: Allocation,
}

thread_local! {
    static ALLOCATIONS: Cell<Option<Allocation>> = Cell::default();
    static ENABLED: Cell<bool> = Cell::default();
    static STAGES: RefCell<BTreeMap<&'static str, Stage>> = RefCell::default();
    static STACK: RefCell<Vec<(&'static str, Instant, Allocation)>> = RefCell::default();
}

fn record(size: usize) {
    let _ = ALLOCATIONS.try_with(|slot| {
        if let Some(mut a) = slot.get() {
            a.calls += 1;
            a.requested_bytes += size as u64;
            slot.set(Some(a));
        }
    });
}

struct CountingAllocator;
// 安全：分配、释放及其布局原样交给 System；线程局部计数不分配。
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
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        let ptr = unsafe { System.realloc(ptr, layout, size) };
        if !ptr.is_null() {
            record(size);
        }
        ptr
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        unsafe { System.dealloc(ptr, layout) };
    }
}

#[global_allocator]
static ALLOCATOR: CountingAllocator = CountingAllocator;

/// 仅供临时测量构建链接；时钟和分配统计全部位于 example，不进入内核。
#[unsafe(no_mangle)]
pub fn p05_stage(name: &'static str, entering: bool) {
    if !ENABLED.get() {
        return;
    }
    let now = Instant::now();
    let allocation = ALLOCATIONS.replace(None);
    if entering {
        STACK.with_borrow_mut(|s| s.push((name, now, allocation.unwrap_or_default())));
    } else {
        let (expected, start, before) = STACK.with_borrow_mut(|s| s.pop()).expect("阶段起点");
        assert_eq!(expected, name);
        STAGES.with_borrow_mut(|s| {
            let stage = s.entry(name).or_default();
            stage.calls += 1;
            stage.ns += now.duration_since(start).as_nanos() as u64;
            if let Some(after) = allocation {
                stage.allocation.calls += after.calls - before.calls;
                stage.allocation.requested_bytes += after.requested_bytes - before.requested_bytes;
            }
        });
    }
    ALLOCATIONS.set(allocation);
}

fn create(path: &Path) -> Result<BufWriter<std::fs::File>> {
    Ok(BufWriter::new(std::fs::OpenOptions::new().write(true).create_new(true).open(path)?))
}

fn write_json(path: &Path, value: &impl Serialize) -> Result<()> {
    let mut file = create(path)?;
    serde_json::to_writer(&mut file, value)?;
    file.flush()?;
    Ok(())
}

fn distribution(samples: &[u64]) -> serde_json::Value {
    let mut sorted = samples.to_vec();
    sorted.sort_unstable();
    let n = sorted.len();
    let total: u64 = sorted.iter().sum();
    json!({"calls":n, "total_ns":total, "mean_ns":total / n.max(1) as u64,
        "p50_ns":sorted.get(n.div_ceil(2).saturating_sub(1)),
        "p95_ns":sorted.get((n * 95).div_ceil(100).saturating_sub(1))})
}

struct Options {
    case: String,
    out: PathBuf,
    initial: Option<PathBuf>,
    days: u32,
    repeats: u32,
    allocations: bool,
    trace: bool,
}

fn run(o: Options) -> Result<()> {
    std::fs::create_dir_all(&o.out)?;
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
    let root = if o.case == "synth1080" {
        let fixture = o.out.join("fixture-data");
        manifest_data::bench::synth1080::write_world(&source, &fixture)?;
        fixture
    } else {
        source
    };
    let (world, scenario) = match o.case.as_str() {
        "mio" => ("terra16", "mio_1553"),
        "free" => ("terra16", "free_1557"),
        "classic" => ("classic", "sandbox"),
        "synth1080" => ("synth1080", "sandbox"),
        _ => return Err("未知 case".into()),
    };
    let defs = manifest_data::load_world(&root, world)?;
    let setup = Instant::now();
    let mut initial = if let Some(path) = &o.initial {
        let save: SaveFile = serde_json::from_reader(BufReader::new(std::fs::File::open(path)?))?;
        let expected = save.snapshot.clone();
        let session = GameSession::from_save(defs.clone(), save)?;
        if session.world.state != expected {
            return Err("读取初始存档改变了快照，不能用于同输入对照".into());
        }
        session
    } else if o.case == "mio" {
        let mut session = GameSession::new_world(
            defs.clone(),
            NewGameRequest {
                world: world.into(),
                scenario: scenario.into(),
                seed: Some(42),
                protagonist: Some("mio".into()),
                ..Default::default()
            },
            |_| {},
        )?;
        session.submit(Command::SkipUpbringing { owner: OwnerId::Player })?;
        session
    } else {
        GameSession::new(defs.clone(), defs.find_scenario(scenario).ok_or("缺少剧本")?, 42)?
    };
    let setup_ns = setup.elapsed().as_nanos() as u64;
    let snapshot = initial.to_save();
    write_json(&o.out.join("initial.json"), &snapshot)?;
    let initial_hash = initial.world.state_hash();
    let mut trace = o.trace.then(|| create(&o.out.join("trajectory.jsonl"))).transpose()?;
    let mut all_ns = Vec::new();
    let mut repeat_ns = Vec::new();
    let mut allocated = Allocation::default();
    let mut final_hash = None;
    for repeat in 0..o.repeats {
        if repeat > 0 {
            initial = GameSession::from_save(defs.clone(), snapshot.clone())?;
            if initial.world.state_hash() != initial_hash {
                return Err("重复轮次初始状态不同".into());
            }
        }
        let mut total = 0;
        for day in 0..o.days {
            if o.case == "mio" && !initial.world.upbringing_skipping() {
                break;
            }
            ENABLED.set(true);
            ALLOCATIONS.set(o.allocations.then(Allocation::default));
            let started = Instant::now();
            let result = initial.advance_day();
            let ns = started.elapsed().as_nanos() as u64;
            let a = ALLOCATIONS.replace(None).unwrap_or_default();
            ENABLED.set(false);
            let report = result?;
            total += ns;
            all_ns.push(ns);
            allocated.calls += a.calls;
            allocated.requested_bytes += a.requested_bytes;
            if repeat == 0
                && let Some(file) = &mut trace
            {
                serde_json::to_writer(
                    &mut *file,
                    &json!({"day":initial.day(), "report":report,
                    "commands":initial.log(), "events":initial.world.state.log,
                    "state_hash":initial.world.state_hash()}),
                )?;
                writeln!(file)?;
            }
            if (day + 1) % 30 == 0 {
                eprintln!("{}: {}/{}, {}/{} 日", o.case, repeat + 1, o.repeats, day + 1, o.days);
            }
        }
        repeat_ns.push(total);
        let hash = initial.world.state_hash();
        if final_hash.as_ref().is_some_and(|previous| previous != &hash) {
            return Err("重复轮次末态不同".into());
        }
        final_hash = Some(hash);
    }
    if let Some(file) = &mut trace {
        file.flush()?;
    }
    write_json(&o.out.join("final.json"), &initial.to_save())?;
    let stages = STAGES.with(|s| serde_json::to_value(&*s.borrow()))?;
    write_json(
        &o.out.join("report.json"),
        &json!({
            "case":o.case, "world":world, "scenario":scenario, "seed":42,
            "world_hash":defs.meta.hash, "ports":defs.port_ids().count(), "goods":defs.goods.len(),
            "periods":defs.nav.grid.period_count(), "start_day":snapshot.snapshot.day,
            "end_day":initial.day(), "date":initial.world.cast_date(), "setup_ns":setup_ns,
            "initial_hash":initial_hash, "final_hash":final_hash, "repeats":o.repeats,
            "settlement":distribution(&all_ns), "repeat_ns":repeat_ns,
            "allocation_enabled":o.allocations, "allocation":allocated, "stages":stages,
            "allocation_scope":"成功 alloc/alloc_zeroed/realloc 次数和请求字节累加，不是峰值或 RSS",
            "timing_scope":"日推进；加载、克隆、哈希、轨迹序列化在计时外；阶段若嵌套为包含子调用耗时"
        }),
    )?;
    Ok(())
}

fn main() -> Result<()> {
    let mut args = std::env::args().skip(1);
    let mut options = Options {
        case: "mio".into(),
        out: PathBuf::new(),
        initial: None,
        days: 30,
        repeats: 1,
        allocations: false,
        trace: true,
    };
    while let Some(arg) = args.next() {
        let value = args.next().ok_or("参数缺少值")?;
        match arg.as_str() {
            "--case" => options.case = value,
            "--out-dir" => options.out = value.into(),
            "--initial" => options.initial = Some(value.into()),
            "--days" => options.days = value.parse()?,
            "--repeats" => options.repeats = value.parse()?,
            "--allocations" => options.allocations = value.parse()?,
            "--trace" => options.trace = value.parse()?,
            _ => return Err(format!("未知参数 {arg}").into()),
        }
    }
    if options.out.as_os_str().is_empty() || options.days == 0 || options.repeats == 0 {
        return Err("必须给出 --out-dir，days/repeats 必须为正数".into());
    }
    run(options)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allocation_and_nested_stages_exclude_probe_bookkeeping() {
        STAGES.with_borrow_mut(BTreeMap::clear);
        ENABLED.set(true);
        ALLOCATIONS.set(Some(Allocation::default()));
        p05_stage("outer", true);
        p05_stage("inner", true);
        let mut bytes = Vec::<u8>::with_capacity(8);
        bytes.extend_from_slice(&[0; 8]);
        bytes.reserve_exact(24);
        std::hint::black_box(bytes);
        p05_stage("inner", false);
        p05_stage("outer", false);
        ENABLED.set(false);
        let count = ALLOCATIONS.replace(None).expect("测量启用");
        assert_eq!((count.calls, count.requested_bytes), (2, 40));
        STAGES.with_borrow(|stages| {
            for key in ["inner", "outer"] {
                assert_eq!(stages[key].calls, 1);
                assert_eq!(stages[key].allocation.calls, 2);
                assert_eq!(stages[key].allocation.requested_bytes, 40);
            }
        });
    }

    #[test]
    fn percentiles_keep_slow_samples() {
        let d = distribution(&[100, 1, 2, 3, 4]);
        assert_eq!(d["total_ns"], 110);
        assert_eq!(d["p50_ns"], 3);
        assert_eq!(d["p95_ns"], 100);
    }
}
