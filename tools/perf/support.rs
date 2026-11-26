//! 仅供性能 examples 使用的参数、计时和进程内存探针；不接入游戏库。

use serde::Serialize;
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

pub struct Args(BTreeMap<String, String>);

impl Args {
    pub fn parse(args: impl IntoIterator<Item = String>) -> Result<Self> {
        let mut args = args.into_iter();
        let mut values = BTreeMap::new();
        while let Some(key) = args.next() {
            if !key.starts_with("--") {
                return Err(format!("参数须使用 --name value：{key}").into());
            }
            let value = args.next().ok_or_else(|| format!("参数缺少值：{key}"))?;
            if value.starts_with("--") || values.insert(key.clone(), value).is_some() {
                return Err(format!("参数重复或缺少值：{key}").into());
            }
        }
        Ok(Self(values))
    }

    pub fn required(&mut self, key: &str) -> Result<String> {
        self.0.remove(key).ok_or_else(|| format!("必须显式指定 {key}").into())
    }

    pub fn optional(&mut self, key: &str, fallback: &str) -> String {
        self.0.remove(key).unwrap_or_else(|| fallback.to_owned())
    }

    pub fn number(&mut self, key: &str, fallback: u64, min: u64, max: u64) -> Result<u64> {
        let value: u64 = self.optional(key, &fallback.to_string()).parse()?;
        if !(min..=max).contains(&value) {
            return Err(format!("{key} 必须在 {min}..={max}").into());
        }
        Ok(value)
    }

    pub fn finish(self) -> Result<()> {
        if !self.0.is_empty() {
            return Err(format!("未知参数：{:?}", self.0.keys().collect::<Vec<_>>()).into());
        }
        Ok(())
    }
}

pub fn write_json(path: &Path, value: &impl Serialize) -> Result<()> {
    // 不覆盖旧结果；一次运行的所有文件放在调用者新建的独立目录中。
    let file = std::fs::OpenOptions::new().write(true).create_new(true).open(path)?;
    let mut writer = io::BufWriter::new(file);
    serde_json::to_writer(&mut writer, value)?;
    writer.flush()?;
    Ok(())
}

pub fn output_dir(args: &mut Args) -> Result<PathBuf> {
    let path = PathBuf::from(args.required("--out-dir")?);
    std::fs::create_dir_all(&path)?;
    Ok(path.canonicalize()?)
}

pub fn skipped(root: &Path, world: &str) -> Result<Option<Value>> {
    use manifest_data::WorldError;
    let (causes, detail) = match manifest_data::resolve_world(root, world) {
        Ok(w) if w.manifest.draft => {
            let missing = !root.join("maps").join(&w.manifest.map).join("map.txt").is_file();
            let mut causes = vec!["draft world"];
            if missing {
                causes.push("missing map");
            }
            (causes, w.manifest.map)
        }
        Ok(_) => return Ok(None),
        Err(WorldError::DraftWorld(key)) => (vec!["draft world"], key),
        Err(WorldError::MissingMap(key)) => (vec!["missing map"], key),
        Err(error) => return Err(error.into()),
    };
    Ok(Some(json!({
        "schema_version": 1, "package_version": env!("CARGO_PKG_VERSION"),
        "status": "skipped", "reason": "skipped: draft world / missing map",
        "causes": causes, "detail": detail, "world": world,
        "expected_periods": if world == "terra16" { Some(12) } else { None },
        "world_fingerprint": null, "measurements": null
    })))
}

pub fn nav_memory(table: &manifest_core::nav::NavTable) -> Value {
    let m = table.memory();
    json!({
        "kind": "estimated_retained_bytes", "routes": m.paths, "path_cells": m.cells,
        "direction_segments": m.segments, "table_bytes": m.table_bytes, "grid_bytes": m.grid_bytes,
        "total_bytes": m.table_bytes + m.grid_bytes,
        "hypothetical_expanded_cell_bytes": m.expanded_cell_bytes,
        "legacy_expanded_paths": m.legacy_expanded_paths,
        "excludes": "allocator metadata and uncounted navigation rule allocations; not process RSS"
    })
}

#[derive(Clone, Copy, Serialize)]
pub struct Rss {
    pub resident_bytes: u64,
    /// 操作系统维护的本进程历史峰值，不能当作当前阶段独占的增量。
    pub process_high_water_bytes: u64,
}

#[cfg(windows)]
pub fn rss() -> Option<Rss> {
    use std::ffi::c_void;
    #[repr(C)]
    #[derive(Default)]
    struct Counters {
        cb: u32,
        faults: u32,
        peak_working_set: usize,
        working_set: usize,
        peak_paged_pool: usize,
        paged_pool: usize,
        peak_nonpaged_pool: usize,
        nonpaged_pool: usize,
        pagefile: usize,
        peak_pagefile: usize,
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetCurrentProcess() -> *mut c_void;
        fn K32GetProcessMemoryInfo(process: *mut c_void, counters: *mut Counters, size: u32) -> i32;
    }
    let size = std::mem::size_of::<Counters>() as u32;
    let mut counters = Counters { cb: size, ..Default::default() };
    // SAFETY: 当前进程伪句柄无需释放，缓冲区布局与 PROCESS_MEMORY_COUNTERS 一致，大小准确。
    let ok = unsafe { K32GetProcessMemoryInfo(GetCurrentProcess(), &mut counters, size) };
    (ok != 0).then_some(Rss {
        resident_bytes: counters.working_set as u64,
        process_high_water_bytes: counters.peak_working_set as u64,
    })
}

#[cfg(target_os = "linux")]
pub fn rss() -> Option<Rss> {
    let text = std::fs::read_to_string("/proc/self/status").ok()?;
    let kb = |key: &str| -> Option<u64> {
        text.lines().find_map(|line| line.strip_prefix(key))?.split_whitespace().next()?.parse().ok()
    };
    Some(Rss { resident_bytes: kb("VmRSS:")? * 1024, process_high_water_bytes: kb("VmHWM:")? * 1024 })
}

#[cfg(not(any(windows, target_os = "linux")))]
pub fn rss() -> Option<Rss> {
    None
}

#[derive(Serialize)]
pub struct Measurement {
    pub elapsed_ns: u64,
    pub rss_before: Option<Rss>,
    pub rss_after: Option<Rss>,
    /// 5ms 采样的进程 RSS 最大值，是阶段峰值的下界，不是分配器持有量。
    pub sampled_peak_rss_bytes: Option<u64>,
    pub rss_samples: usize,
    pub sample_interval_ms: u64,
}

pub fn measure<T>(operation: impl FnOnce() -> Result<T>) -> Result<(T, Measurement)> {
    let before = rss();
    let (tx, rx) = std::sync::mpsc::channel();
    let monitor = std::thread::spawn(move || {
        let mut peak = None;
        let mut samples = 0;
        loop {
            if let Some(value) = rss() {
                peak = Some(peak.unwrap_or(0).max(value.resident_bytes));
                samples += 1;
            }
            if rx.recv_timeout(Duration::from_millis(5)) != Err(std::sync::mpsc::RecvTimeoutError::Timeout) {
                break;
            }
        }
        (peak, samples)
    });
    let start = Instant::now();
    let result = operation();
    let elapsed_ns = start.elapsed().as_nanos().min(u128::from(u64::MAX)) as u64;
    let after = rss();
    let _ = tx.send(());
    let (peak, samples) = monitor.join().map_err(|_| io::Error::other("RSS 采样线程异常"))?;
    let peak = peak.into_iter().chain(before.map(|r| r.resident_bytes)).chain(after.map(|r| r.resident_bytes)).max();
    Ok((
        result?,
        Measurement {
            elapsed_ns,
            rss_before: before,
            rss_after: after,
            sampled_peak_rss_bytes: peak,
            rss_samples: samples,
            sample_interval_ms: 5,
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arguments_reject_ambiguous_or_unused_values() {
        for args in [vec!["--world"], vec!["--world", "--threads"], vec!["--world", "a", "--world", "b"]] {
            assert!(Args::parse(args.into_iter().map(str::to_owned)).is_err());
        }
        let args = Args::parse(["--typo".to_owned(), "1".to_owned()]).expect("参数");
        assert!(args.finish().is_err());
        let mut args = Args::parse(["--threads".to_owned(), "0".to_owned()]).expect("参数");
        assert!(args.number("--threads", 1, 1, 64).is_err());
    }

    #[test]
    fn measurements_keep_failure_and_rss_units() {
        assert!(measure::<()>(|| Err("故意失败".into())).is_err());
        let (answer, measured) = measure(|| Ok(42)).expect("测量");
        assert_eq!(answer, 42);
        if let Some(after) = measured.rss_after {
            assert!(after.process_high_water_bytes >= after.resident_bytes);
            assert!(measured.sampled_peak_rss_bytes.expect("有 RSS") >= after.resident_bytes);
        }
    }
}
