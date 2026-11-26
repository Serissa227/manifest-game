/// 解析合并后的世界包导航设置（独立入口，供世界加载器接线）。
/// 海区与港口用 key 绑定，避免作者依赖内部数字 ID。
pub fn parse_navigation(
    text: &str,
    calendar: &manifest_core::calendar::Calendar,
    map: &manifest_core::nav::SeaMap,
    regions: &[manifest_core::defs::RegionDef],
    ports: &[(String, manifest_core::LocId)],
) -> Result<manifest_core::nav::NavigationRules, crate::DataError> {
    use manifest_core::nav::climate::{NavigationRules, Projection, RegionClimate};
    use serde::Deserialize;
    use std::collections::BTreeMap;
    #[derive(Deserialize, Default)]
    #[serde(default, deny_unknown_fields)]
    struct Input {
        projection: Option<Projection>,
        regions: BTreeMap<String, RegionClimate>,
        frozen_ports: BTreeMap<String, Vec<u8>>,
    }
    let error = |message: String| crate::DataError {
        issues: vec![crate::DataIssue { file: "navigation.toml".into(), item: "navigation".into(), message }],
    };
    let input: Input = toml::from_str(text).map_err(|e| error(e.to_string()))?;
    let mut rules = NavigationRules {
        calendar: calendar.clone(),
        projection: input.projection,
        regions: vec![RegionClimate::default(); regions.len()],
        ..Default::default()
    };
    for (key, climate) in input.regions {
        let i = regions.iter().position(|r| r.key == key).ok_or_else(|| error(format!("未知海区 {key}")))?;
        rules.regions[i] = climate;
    }
    for (key, months) in input.frozen_ports {
        let (_, id) = ports.iter().find(|(k, _)| *k == key).ok_or_else(|| error(format!("未知港口 {key}")))?;
        rules.frozen_ports.insert(*id, months);
    }
    rules.validate(map.topology(), regions.len()).map_err(|e| error(e.to_string()))?;
    Ok(rules)
}

use manifest_core::defs::RegionDef;
use manifest_core::nav::{NavError, NavGrid, NavTable, NavigationRules, SeaMap};
use manifest_core::{Cell, LocId};
use std::collections::BTreeMap;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock, Weak};

pub const NAV_ALGORITHM_VERSION: u32 = 4;
const MAX_CACHE_BYTES: u64 = 512 * 1024 * 1024;

/// 调用方传已校验的地图、海区、港口锚地；经典世界的 rules 为 None。
#[derive(Clone, Copy)]
pub struct NavInput<'a> {
    pub world: &'a str,
    pub map: &'a SeaMap,
    pub regions: &'a [RegionDef],
    pub rules: Option<&'a NavigationRules>,
    pub loc_count: usize,
    pub ports: &'a [(LocId, Cell)],
}

#[derive(Clone, Debug)]
pub struct NavCacheOptions {
    pub directory: PathBuf,
    pub threads: usize,
}

/// 应用指定的缓存目录（桌面版：用户的本地缓存目录，见 [`use_user_cache_dir`]）。
static USER_CACHE_DIR: OnceLock<PathBuf> = OnceLock::new();

/// 桌面版把航线缓存写到用户的本地缓存目录，不写在 exe 与 data 旁（2026-11-03：解压出来的新包第一次启动不必再算一遍，
/// 程序目录只读时也能存下）。进程里只设一次；MANIFEST_NAV_CACHE_DIR 仍然优先。data 旁 cache/nav 里现成的缓存
/// （开发目录、随包附带的）照旧先读，见 [`NavCacheOptions::beside_data`]。
pub fn use_user_cache_dir(dir: PathBuf) {
    let _ = USER_CACHE_DIR.set(dir);
}

impl NavCacheOptions {
    /// MANIFEST_NAV_CACHE_DIR 可指向持久卷；桌面版指定了用户缓存目录时用它；缺省在 data 的同级 cache/nav。
    /// 建表线程：缺省 8 个；桌面版（指定了用户缓存目录）用满本机核心——第一次打开寰宇要现算航线表，
    /// 8 个线程要半分钟以上（2026-11-03 实测）。线程数不影响建出来的表（各段按原顺序收集）。
    pub fn for_data_dir(data: &Path) -> Self {
        let desktop = USER_CACHE_DIR.get();
        let threads = match desktop {
            Some(_) => std::thread::available_parallelism().map(|n| n.get()).unwrap_or(8).clamp(8, 32),
            None => 8,
        };
        Self {
            directory: std::env::var_os("MANIFEST_NAV_CACHE_DIR")
                .map(PathBuf::from)
                .or_else(|| desktop.cloned())
                .unwrap_or_else(|| Self::beside(data)),
            threads,
        }
    }

    /// data 的同级 cache/nav：[`for_data_dir`](Self::for_data_dir) 改用别的目录时，这里现成的缓存仍可只读地用上；
    /// 两者相同时为 None。
    pub fn beside_data(data: &Path) -> Option<Self> {
        if std::env::var_os("MANIFEST_NAV_CACHE_DIR").is_some() || USER_CACHE_DIR.get().is_none() {
            return None;
        }
        let options = Self::for_data_dir(data);
        let beside = Self::beside(data);
        (beside != options.directory).then_some(Self { directory: beside, threads: options.threads })
    }

    fn beside(data: &Path) -> PathBuf {
        data.parent().unwrap_or(data).join("cache").join("nav")
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CacheSource {
    Built,
    Disk,
    Memory,
}

#[derive(Debug)]
pub struct NavLoad {
    pub table: Arc<NavTable>,
    pub source: CacheSource,
    pub cache_path: PathBuf,
    /// 缓存是可丢弃的派生数据；目录只读或写盘失败时返回可用航线及诊断。
    pub persistence_error: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum NavCacheError {
    #[error(transparent)]
    Navigation(#[from] NavError),
    #[error("世界 key 只能包含英文字母、数字、下划线或连字符")]
    InvalidWorld,
    #[error("地图、地点数量或港口锚地无效")]
    InvalidInput,
}

impl NavInput<'_> {
    fn validate(&self) -> Result<(), NavCacheError> {
        if self.world.is_empty()
            || self.world.len() > 128
            || !self.world.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
        {
            return Err(NavCacheError::InvalidWorld);
        }
        let n = usize::from(self.map.width) * usize::from(self.map.height);
        if n == 0
            || self.map.terrain.len() != n
            || self.map.region.len() != n
            || self.loc_count > usize::from(u16::MAX)
            || self.regions.len() >= usize::from(u16::MAX) / 2
            || self.map.region.iter().any(|&r| r != u16::MAX && usize::from(r) >= self.regions.len())
        {
            return Err(NavCacheError::InvalidInput);
        }
        let mut seen = vec![false; self.loc_count];
        for &(id, cell) in self.ports {
            if id.idx() >= self.loc_count || seen[id.idx()] || !self.map.is_sea_in_bounds(cell) {
                return Err(NavCacheError::InvalidInput);
            }
            seen[id.idx()] = true;
        }
        if let Some(rules) = self.rules {
            rules.validate(self.map.topology(), self.regions.len())?;
        }
        Ok(())
    }

    fn grid(&self) -> Result<NavGrid, NavCacheError> {
        Ok(match self.rules {
            Some(rules) => NavGrid::with_rules(self.map, self.regions, self.ports, rules.clone())?,
            None => NavGrid::new(self.map, self.regions),
        })
    }
}

/// 长度前缀和固定小端编码避免字符串/数组拼接歧义；不读取地图之外的运行状态。
pub fn fingerprint(input: &NavInput<'_>) -> Result<String, NavCacheError> {
    input.validate()?;
    let mut h = blake3::Hasher::new();
    fn bytes(h: &mut blake3::Hasher, bytes: &[u8]) {
        h.update(&(bytes.len() as u64).to_le_bytes());
        h.update(bytes);
    }
    fn value(h: &mut blake3::Hasher, n: i64) {
        h.update(&n.to_le_bytes());
    }
    fn weather(h: &mut blake3::Hasher, w: manifest_core::defs::SeasonWeather) {
        for n in [
            i64::from(w.wind_dir),
            w.wind_strength,
            i64::from(w.current_dir),
            w.current_strength,
            w.storm_bp,
            w.pirate_bp,
        ] {
            value(h, n);
        }
    }
    bytes(&mut h, b"manifest-nav-compressed");
    value(&mut h, i64::from(NAV_ALGORITHM_VERSION));
    bytes(&mut h, input.world.as_bytes());
    value(&mut h, i64::from(input.map.width));
    value(&mut h, i64::from(input.map.height));
    value(&mut h, i64::from(input.map.wrap_x));
    for t in &input.map.terrain {
        h.update(&[*t as u8]);
    }
    for r in &input.map.region {
        h.update(&r.to_le_bytes());
    }
    value(&mut h, input.regions.len() as i64);
    for r in input.regions {
        bytes(&mut h, r.key.as_bytes());
        for c in [r.rect.0, r.rect.1, r.rect.2, r.rect.3] {
            value(&mut h, i64::from(c));
        }
        value(&mut h, r.climate.index() as i64);
        for w in r.seasons {
            weather(&mut h, w);
        }
    }
    value(&mut h, i64::from(input.rules.is_some()));
    if let Some(r) = input.rules {
        value(&mut h, r.calendar.months().len() as i64);
        for &month in r.calendar.months() {
            value(&mut h, i64::from(month));
        }
        bytes(&mut h, r.calendar.seasons());
        value(&mut h, i64::from(r.projection.is_some()));
        if let Some(p) = &r.projection {
            bytes(&mut h, b"equirect");
            for n in [i64::from(p.west), i64::from(p.north), i64::from(p.arcmin_per_cell), i64::from(p.lat_scale)] {
                value(&mut h, n);
            }
        }
        value(&mut h, r.period_count() as i64);
        value(&mut h, r.regions.len() as i64);
        for r in &r.regions {
            value(&mut h, i64::from(r.south));
            bytes(&mut h, &r.frozen_months);
            value(&mut h, r.weather.len() as i64);
            for w in &r.weather {
                weather(&mut h, (*w).into());
            }
        }
        value(&mut h, r.frozen_ports.len() as i64);
        for (id, months) in &r.frozen_ports {
            value(&mut h, i64::from(id.0));
            bytes(&mut h, months);
        }
    }
    value(&mut h, input.loc_count as i64);
    value(&mut h, input.ports.len() as i64);
    for &(id, cell) in input.ports {
        for n in [id.0, cell.x, cell.y] {
            value(&mut h, i64::from(n));
        }
    }
    Ok(h.finalize().to_hex().to_string())
}

type Tables = BTreeMap<PathBuf, Weak<NavTable>>;
fn tables() -> &'static Mutex<Tables> {
    static TABLES: OnceLock<Mutex<Tables>> = OnceLock::new();
    TABLES.get_or_init(|| Mutex::new(BTreeMap::new()))
}

/// 只找现成的航线表（进程内或磁盘缓存），找不到时为 None，不建表、不写盘。
pub fn load_existing(input: NavInput<'_>, options: &NavCacheOptions) -> Result<Option<NavLoad>, NavCacheError> {
    let key = fingerprint(&input)?;
    let path = cache_path(&input, options, &key);
    let mut cache = tables().lock().unwrap_or_else(|e| e.into_inner());
    existing(&input, &path, &key, &mut cache)
}

fn cache_path(input: &NavInput<'_>, options: &NavCacheOptions, key: &str) -> PathBuf {
    let path = options.directory.join(format!("{}-{key}.bin", input.world));
    if path.is_absolute() { path } else { std::env::current_dir().unwrap_or_default().join(path) }
}

fn existing(
    input: &NavInput<'_>,
    path: &Path,
    key: &str,
    cache: &mut Tables,
) -> Result<Option<NavLoad>, NavCacheError> {
    cache.retain(|_, table| table.strong_count() > 0);
    if let Some(table) = cache.get(path).and_then(Weak::upgrade) {
        return Ok(Some(NavLoad {
            table,
            source: CacheSource::Memory,
            cache_path: path.into(),
            persistence_error: None,
        }));
    }
    if let Some(table) = read_table(input, path, key)? {
        let table = Arc::new(table);
        cache.insert(path.to_owned(), Arc::downgrade(&table));
        return Ok(Some(NavLoad {
            table,
            source: CacheSource::Disk,
            cache_path: path.into(),
            persistence_error: None,
        }));
    }
    Ok(None)
}

/// 进程内同一世界指纹持一把锁完成读盘或建表；跨进程可以重复计算，但只原子发布完整文件。
/// 仅弱引用常驻，已关闭的世界不永久占内存；存活的 StaticData 持有强引用。
pub fn load_or_build(input: NavInput<'_>, options: &NavCacheOptions) -> Result<NavLoad, NavCacheError> {
    let key = fingerprint(&input)?;
    let path = cache_path(&input, options, &key);
    let mut cache = tables().lock().unwrap_or_else(|e| e.into_inner());
    if let Some(found) = existing(&input, &path, &key, &mut cache)? {
        return Ok(found);
    }
    let grid = input.grid()?;
    let table = Arc::new(build_parallel(grid, input.loc_count, input.ports, options.threads));
    let persistence_error = write_table(&path, &key, &table).err().map(|e| e.to_string());
    cache.insert(path.clone(), Arc::downgrade(&table));
    Ok(NavLoad { table, source: CacheSource::Built, cache_path: path, persistence_error })
}

/// 每个工作线程一次只保留一个来源港的格序列，立即压缩后收集；不攒整张未压缩表。
pub fn build_parallel(grid: NavGrid, loc_count: usize, ports: &[(LocId, Cell)], threads: usize) -> NavTable {
    let jobs = NavTable::jobs_for(&grid, ports);
    let chunk = jobs.len().div_ceil(threads.clamp(1, 64)).max(1);
    let rows = std::thread::scope(|scope| {
        let handles: Vec<_> = jobs
            .chunks(chunk)
            .map(|part| {
                let grid = &grid;
                scope.spawn(move || {
                    part.iter().map(|job| NavTable::run_compressed_job(grid, ports, job)).collect::<Vec<_>>()
                })
            })
            .collect();
        handles
            .into_iter()
            .flat_map(|h| match h.join() {
                Ok(rows) => rows,
                Err(error) => std::panic::resume_unwind(error),
            })
            .collect()
    });
    NavTable::assemble_compressed(grid, loc_count, ports, &jobs, rows)
}

fn read_table(input: &NavInput<'_>, path: &Path, key: &str) -> Result<Option<NavTable>, NavCacheError> {
    let read = || -> Option<Vec<u8>> {
        let file = std::fs::File::open(path).ok()?;
        if file.metadata().ok()?.len() > MAX_CACHE_BYTES {
            return None;
        }
        let mut bytes = Vec::new();
        file.take(MAX_CACHE_BYTES + 1).read_to_end(&mut bytes).ok()?;
        if bytes.len() < 112
            || bytes.len() as u64 > MAX_CACHE_BYTES
            || &bytes[..4] != b"MNC1"
            || bytes[4..8] != NAV_ALGORITHM_VERSION.to_le_bytes()
            || &bytes[8..72] != key.as_bytes()
        {
            return None;
        }
        let length = u64::from_le_bytes(bytes[72..80].try_into().ok()?);
        if length != (bytes.len() - 112) as u64 || blake3::hash(&bytes[112..]).as_bytes() != &bytes[80..112] {
            return None;
        }
        Some(bytes)
    };
    let Some(bytes) = read() else {
        return Ok(None);
    };
    Ok(NavTable::from_route_bytes(input.grid()?, input.loc_count, input.ports, &bytes[112..]).ok())
}

fn write_table(path: &Path, key: &str, table: &NavTable) -> io::Result<()> {
    static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);
    let parent = path.parent().ok_or_else(|| io::Error::other("缓存目录无效"))?;
    std::fs::create_dir_all(parent)?;
    let payload = table.route_bytes();
    let mut header = Vec::with_capacity(112);
    header.extend_from_slice(b"MNC1");
    header.extend_from_slice(&NAV_ALGORITHM_VERSION.to_le_bytes());
    header.extend_from_slice(key.as_bytes());
    header.extend_from_slice(&(payload.len() as u64).to_le_bytes());
    header.extend_from_slice(blake3::hash(&payload).as_bytes());
    let (temp, mut file) = loop {
        let temp =
            path.with_extension(format!("{}.{}.tmp", std::process::id(), NEXT_TEMP.fetch_add(1, Ordering::Relaxed)));
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&temp) {
            Ok(file) => break (temp, file),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    };
    let result = (|| {
        file.write_all(&header)?;
        file.write_all(&payload)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temp, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result
}
