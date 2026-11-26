//! 启动提速：读文件缓存、多线程预读与解析、运行时语言包，
//! 都不能改变加载的结果——与逐个读盘、逐个解析时逐字节相同；找 data/ 时 exe 旁的优先。

use manifest_data::locale::{load_world_locale, load_world_locale_lenient};
use manifest_data::worlds::EffectiveWorld;
use manifest_data::{
    Locale, find_data_dir_from, load_world, load_world_resolved, resolve_world, resolve_world_for_load,
};
use std::path::{Path, PathBuf};

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data")
}

/// 把 Debug 输出直接喂给哈希（寰宇的静态数据打印出来很大，不攒成字符串）。
struct Digest(blake3::Hasher);

impl std::fmt::Write for Digest {
    fn write_str(&mut self, s: &str) -> std::fmt::Result {
        self.0.update(s.as_bytes());
        Ok(())
    }
}

fn digest(value: &impl std::fmt::Debug) -> String {
    let mut d = Digest(blake3::Hasher::new());
    std::fmt::write(&mut d, format_args!("{value:?}")).expect("Debug 输出");
    d.0.finalize().to_hex().to_string()
}

/// 两份解析出来的世界：文件清单、每个逻辑文件读到的内容、哈希、剧本都相同。
fn assert_same_world(plain: &EffectiveWorld, cached: &EffectiveWorld) {
    assert_eq!(digest(&plain.manifest), digest(&cached.manifest));
    assert_eq!(digest(&plain.map), digest(&cached.map));
    assert_eq!(digest(&plain.files), digest(&cached.files), "有效文件与来源相同");
    for logical in plain.files.keys() {
        assert_eq!(plain.read(logical).ok(), cached.read(logical).ok(), "{logical}");
    }
    assert_eq!(plain.hash(false).unwrap(), cached.hash(false).unwrap());
    assert_eq!(plain.hash(true).unwrap(), cached.hash(true).unwrap());
    assert!(plain.validate_syntax().is_ok() && cached.validate_syntax().is_ok());
    assert_eq!(digest(&plain.scenarios().unwrap()), digest(&cached.scenarios().unwrap()));
}

#[test]
fn cached_resolution_reads_exactly_what_plain_resolution_reads() {
    for key in ["classic", "testbed", "terra16"] {
        let plain = resolve_world(&root(), key).unwrap();
        let cached = resolve_world_for_load(&root(), key).unwrap();
        assert_same_world(&plain, &cached);
    }
}

#[test]
fn static_data_is_identical_with_and_without_the_read_cache() {
    // 经典与测试海域：整份静态数据逐字节相同（不开缓存的世界照旧每次读盘、逐个解析）
    for key in ["classic", "testbed"] {
        let plain = load_world_resolved(&resolve_world(&root(), key).unwrap()).unwrap();
        let cached = load_world(&root(), key).unwrap();
        assert_eq!(digest(&*plain), digest(&*cached), "{key}");
    }
    // 寰宇：航线表很大，比对航线表之外加载出来的各部分（养成、故事、人物与历史就是多线程解析的那几处）
    let plain = load_world_resolved(&resolve_world(&root(), "terra16").unwrap()).unwrap();
    let cached = load_world(&root(), "terra16").unwrap();
    let parts = |d: &manifest_core::StaticData| {
        [
            digest(&d.meta.hash),
            digest(&d.locations),
            digest(&d.scenarios),
            digest(&d.mates),
            digest(&d.goods),
            digest(&d.cast),
            digest(&d.story2),
            digest(&d.upbringing),
            digest(&d.items),
            digest(&d.auctions),
            digest(&d.history),
            digest(&d.stories),
            digest(&d.captain),
        ]
    };
    assert_eq!(parts(&plain), parts(&cached));
    assert_eq!(plain.nav.route_bytes(), cached.nav.route_bytes());
}

#[test]
fn runtime_locale_bundles_match_the_lenient_bundles() {
    for key in ["testbed", "terra16"] {
        let world = resolve_world_for_load(&root(), key).unwrap();
        let defs = load_world_resolved(&world).unwrap();
        let ai = manifest_data::ai_content::load_world_ai_content(&world).unwrap();
        for locale in Locale::ALL {
            let (lenient, _) = load_world_locale_lenient(&world, locale, &defs, &ai);
            let runtime = load_world_locale(&world, locale, &defs, &ai);
            let shown = |b: &manifest_data::LocaleBundle| {
                let d = &b.defs;
                [
                    digest(&b.locale),
                    digest(&b.texts),
                    digest(&b.templates),
                    digest(&b.prompts),
                    digest(&b.categories),
                    digest(&b.missing),
                    digest(&d.locations),
                    digest(&d.scenarios),
                    digest(&d.mates),
                    digest(&d.goods),
                    digest(&d.cast),
                    digest(&d.story2),
                    digest(&d.upbringing),
                    digest(&d.items),
                    digest(&d.history),
                ]
            };
            assert_eq!(shown(&lenient), shown(&runtime), "{key} {}", locale.code());
        }
    }
}

#[test]
fn data_beside_the_executable_comes_before_the_working_directory() {
    let tmp = tempfile::tempdir().unwrap();
    let make = |dir: &Path| {
        std::fs::create_dir_all(dir.join("data")).unwrap();
        std::fs::write(dir.join("data/goods.toml"), "goods = []\n").unwrap();
    };
    let exe = tmp.path().join("pkg");
    let cwd = tmp.path().join("elsewhere");
    let env = tmp.path().join("env");
    let nowhere = tmp.path().join("nowhere");
    for dir in [&exe, &cwd, &env] {
        make(dir);
    }
    std::fs::create_dir_all(cwd.join("deep/inside")).unwrap();
    std::fs::create_dir_all(&nowhere).unwrap();
    let find = |env: Option<PathBuf>, exe: &Path, cwd: &Path| find_data_dir_from(env, Some(exe), Some(cwd), &nowhere);
    // 双击打包版：工作目录在别处，也先用 exe 旁的 data/
    assert_eq!(find(None, &exe, &cwd), Some(exe.join("data")));
    // exe 旁没有：照旧从工作目录往上找
    assert_eq!(find(None, &nowhere, &cwd.join("deep/inside")), Some(cwd.join("data")));
    // 环境变量仍然最先；指向的目录不是 data/ 时不算
    assert_eq!(find(Some(env.join("data")), &exe, &cwd), Some(env.join("data")));
    assert_eq!(find(Some(nowhere.clone()), &exe, &cwd), Some(exe.join("data")));
    // exe 旁只看这一层：exe 的上层有 data/ 时，仍是工作目录先
    let nested = exe.join("bin");
    std::fs::create_dir_all(&nested).unwrap();
    assert_eq!(find(None, &nested, &cwd), Some(cwd.join("data")));
    assert_eq!(find(None, &nested, &nowhere), Some(exe.join("data")));
}
