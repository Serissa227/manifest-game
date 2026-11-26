//! 用现有经典图层作逐字节基线；真实输入使用临时小文件，不下载地理数据。

use super::*;
use std::fs;

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).parent().expect("仓库根目录").to_path_buf()
}

fn strings(args: &[&str]) -> Vec<String> {
    args.iter().map(|s| s.to_string()).collect()
}

fn real_config(directory: &Path, sources: bool) -> PathBuf {
    let mut text = "# 真实模式的合成输入，仅测试管线\nversion = 1\nmode = 'real'\nwidth = 12\nheight = 10\nwrap_x = true\noutput = 'out'\n".to_string();
    if sources {
        let data = b"synthetic local source\n";
        let checksum = blake3::hash(data).to_hex();
        for name in ["land", "lakes", "elevation", "rivers"] {
            fs::write(directory.join(format!("{name}.bin")), data).expect("输入");
            text.push_str(&format!("\n[sources.{name}]\npath = '{name}.bin'\nblake3 = '{checksum}'\nattribution = '合成测试输入，无外部数据'\n"));
        }
    }
    let path = directory.join("mapgen.toml");
    fs::write(&path, text).expect("配置");
    path
}

#[test]
fn procedural_and_worldgen_alias_match_every_classic_byte() {
    let dir = tempfile::tempdir().expect("临时目录");
    let world = root().join("data/world");
    let output = dir.path().join("new");
    let debug = dir.path().join("debug");
    let args = vec!["--output".into(), output.display().to_string(), "--debug".into(), debug.display().to_string()];
    let mut mapgen_args = vec!["procedural".into()];
    mapgen_args.extend(args.clone());
    run(&root(), &mapgen_args).expect("mapgen procedural");
    for name in layers::FILES {
        let expected = fs::read(world.join(name)).expect("经典基线");
        let actual = fs::read(output.join(name)).expect("生成图层");
        assert_eq!(blake3::hash(&actual), blake3::hash(&expected), "{name} 字节哈希");
        assert!(actual == expected, "{name} 逐字节相等");
    }
    let before: Vec<_> = fs::read_dir(&debug)
        .expect("调试目录")
        .map(|entry| {
            let p = entry.expect("文件").path();
            let bytes = fs::read(&p).expect("调试产物");
            (p, bytes)
        })
        .collect();
    // worldgen 与 procedural 是同一入口；重跑也验证图层、截图和报告的确定性。
    crate::worldgen::run(&root(), &args).expect("worldgen 别名");
    for (path, expected) in before {
        assert!(fs::read(&path).expect("重跑输出") == expected, "{} 重跑变化", path.display());
    }
    for name in layers::FILES {
        assert!(fs::read(output.join(name)).expect("别名图层") == fs::read(world.join(name)).expect("基线"), "{name}");
    }
}

#[test]
fn real_requires_named_local_sources_and_never_creates_output_on_failure() {
    let dir = tempfile::tempdir().expect("临时目录");
    let path = real_config(dir.path(), false);
    let args = strings(&["real", "--config", path.to_str().expect("路径")]);
    let error = run(&root(), &args).expect_err("缺输入须报错").to_string();
    assert!(error.contains("缺少 land（见 mapgen.toml 的 [sources]）"), "{error}");
    assert!(!dir.path().join("out").exists());
    real_config(dir.path(), true);
    fs::remove_file(dir.path().join("land.bin")).expect("移除合成输入");
    let error = run(&root(), &args).expect_err("缺文件须报错").to_string();
    assert!(error.contains("缺少 land") && error.contains("（见 mapgen.toml 的 [sources]）"), "{error}");
    assert!(!dir.path().join("out").exists());
}

#[test]
fn separate_output_copies_the_updated_place_tables_after_explicit_writeback() {
    let dir = tempfile::tempdir().expect("临时目录");
    let world = dir.path().join("world");
    fs::create_dir(&world).expect("输入目录");
    for entry in fs::read_dir(root().join("data/world")).expect("经典世界") {
        let path = entry.expect("输入文件").path();
        if path.is_file() {
            fs::copy(&path, world.join(path.file_name().expect("文件名"))).expect("隔离输入");
        }
    }
    let ports = world.join("ports.toml");
    let original = fs::read_to_string(&ports).expect("港口");
    let changed = original.replacen("pos = [53, 62]", "pos = [0, 0]", 1);
    assert_ne!(changed, original, "把维拉马雷移离骨架锚点，确保需要回写");
    fs::write(&ports, &changed).expect("改变输入坐标");
    let output = dir.path().join("output");
    let debug = dir.path().join("debug");
    run(
        &root(),
        &strings(&[
            "procedural",
            "--world",
            world.to_str().expect("世界路径"),
            "--output",
            output.to_str().expect("输出路径"),
            "--debug",
            debug.to_str().expect("调试路径"),
            "--write-places",
            "--write-roads",
        ]),
    )
    .expect("另存同时回写");
    assert_ne!(fs::read_to_string(&ports).expect("更新坐标"), changed);
    for name in ["ports.toml", "cities.toml", "overseas.toml", "discoveries.toml", "roads.toml"] {
        assert_eq!(
            fs::read(world.join(name)).expect("回写输入"),
            fs::read(output.join(name)).expect("输出表"),
            "{name}"
        );
    }
    assert_eq!(fs::read_to_string(root().join("data/world/ports.toml")).expect("仓库原数据"), original);
}

#[test]
fn real_checks_file_bytes_and_requires_explicit_rasterizer_configuration() {
    let dir = tempfile::tempdir().expect("临时目录");
    let path = real_config(dir.path(), true);
    let config = Config::read(&path).expect("配置");
    assert_eq!(config.sources["land"].path, dir.path().join("land.bin"));
    assert_eq!(config.output, dir.path().join("out"));
    real::check_sources(&config).expect("校验真实字节");
    let error = real::run(&config).expect_err("缺少投影与采样配置").to_string();
    assert!(error.contains("需要 [real]") && error.contains("不会回退"), "{error}");
    assert!(!config.output.exists());
    fs::create_dir(&config.output).expect("已有输出目录");
    fs::write(config.output.join("map.txt"), "既有地图").expect("既有地图");
    fs::write(&config.sources["land"].path, b"changed").expect("改变输入");
    let error = real::run(&config).expect_err("哈希不符").to_string();
    assert!(error.contains("来源 land 校验和不符"), "{error}");
    assert_eq!(fs::read_to_string(config.output.join("map.txt")).expect("既有输出"), "既有地图");
}

#[test]
fn malformed_modes_configs_checksums_and_screenshots_are_rejected() {
    assert!(run(&root(), &[]).is_err());
    assert!(run(&root(), &strings(&["real"])).is_err());
    assert!(run(&root(), &strings(&["real", "--config"])).is_err());
    let classic = classic_config(&root());
    let error = run(&root(), &strings(&["real", "--config", classic.to_str().expect("路径")])).expect_err("不能回退");
    assert!(error.to_string().contains("不会回退"));
    let dir = tempfile::tempdir().expect("临时目录");
    let path = real_config(dir.path(), false);
    let base = fs::read_to_string(&path).expect("配置");
    for suffix in [
        "\nunknown = 1\n",
        "\n[sources.land]\npath = 'land.bin'\nblake3 = 'wrong'\nattribution = 'test'\n",
        "\n[[screenshots]]\nname = '../escape'\norigin = [0, 0]\nsize = [1, 1]\n",
        "\n[[screenshots]]\nname = 'zoom'\norigin = [11, 0]\nsize = [2, 1]\n",
    ] {
        fs::write(&path, format!("{base}{suffix}")).expect("配置");
        assert!(Config::read(&path).is_err(), "{suffix}");
    }
    assert!(crate::worldgen::run(&root(), &strings(&["--config"])).is_err());
}

#[test]
fn shared_output_pipeline_validates_all_layers_before_writing() {
    let dir = tempfile::tempdir().expect("临时目录");
    let out = dir.path().join("out");
    let mut layers = layers::Layers(["#.\n".into(), "0.\n".into(), "F.\n".into(), "#0\n".into(), "".into(), "".into()]);
    layers.write(&out, 2, 1).expect("合成图层");
    assert_eq!(fs::read_dir(&out).expect("输出").count(), 6);
    layers.0[2] = "FF\n".into();
    assert!(layers.write(&dir.path().join("bad"), 2, 1).is_err());
    assert!(!dir.path().join("bad").exists());
    assert_eq!(fs::read(out.join("biomes.txt")).expect("既有输出"), b"F.\n");
}

#[test]
fn sea_markers_are_unicode_scalars_but_other_layers_stay_strict() {
    let dir = tempfile::tempdir().expect("临时目录");
    let mut layers = layers::Layers(["#.\n".into(), "0.\n".into(), "F.\n".into(), "#α\n".into(), "".into(), "".into()]);
    layers.write(&dir.path().join("valid"), 2, 1).expect("93海区使用单个Unicode字符");
    layers.0[3] = "#αβ\n".into();
    assert!(layers.write(&dir.path().join("wide"), 2, 1).is_err());
    layers.0[3] = "#α\n".into();
    layers.0[2] = "α.\n".into();
    assert!(layers.write(&dir.path().join("bad"), 2, 1).is_err());
}

#[test]
fn a_different_size_and_culture_uses_only_its_own_configuration() {
    let dir = tempfile::tempdir().expect("临时目录");
    let world = dir.path().join("world");
    fs::create_dir(&world).expect("输入目录");
    for name in ["ports.toml", "cities.toml", "roads.toml"] {
        fs::write(world.join(name), "").expect("空地点表");
    }
    // 既有简单读取器的字符串采用双引号，与作者数据一致。
    fs::write(world.join("regions.toml"), "[[regions]]\nkey = \"sea\"\nrect = [0, 0, 15, 11]\n").expect("海区");
    let climate = r#"
[climate]
temperature = [[0.0, 12.0], [12.0, 20.0]]
rain_belt = [[0.0, 1.0], [12.0, 1.0]]
wind = [[0.0, 1.0], [12.0, 1.0]]
lapse = 6.0
medit = [0.0, 1.0, 2.0, 3.0]
medit_fetch = 1.0
temp_noise = 0.0
temp_noise_wavelength = 10.0
rain_noise = 0.0
valley_warmth = 0.0
"#;
    fs::write(dir.path().join("layout.toml"), "seed = 1\nwidth = 16\nheight = 12\n[params]\nerosion_iterations = 0\n[[region]]\nkey = \"sea\"\nseeds = [[0.0, 0.0]]\n").expect("骨架");
    let config = format!(
        r#"
# 小地图只有自己的命名、气候、统计范围与截图。
version = 1
mode = 'procedural'
width = 16
height = 12
layout = 'layout.toml'
world = 'world'
output = 'out'
[naming]
fallback = '试验海'
[[naming.areas]]
name = '试验北岸'
rect = [0, 0, 8, 6]
[[report.areas]]
name = '试验区域'
rect = [0, 0, 16, 12]
[[screenshots]]
name = 'zoom-test'
origin = [0, 0]
size = [8, 6]
[text]
map = ['试验地图 {{width}} × {{height}}']
{climate}
"#
    );
    let path = dir.path().join("mapgen.toml");
    fs::write(&path, config).expect("配置");
    let loaded = Config::read(&path).expect("自定义配置");
    assert_eq!(loaded.naming.region_name(0, 0), "试验北岸");
    assert_eq!(loaded.naming.region_name(8, 6), "试验海");
    let debug = dir.path().join("debug");
    run(
        &root(),
        &strings(&[
            "procedural",
            "--config",
            path.to_str().expect("配置路径"),
            "--debug",
            debug.to_str().expect("输出路径"),
        ]),
    )
    .expect("自定义地图");
    assert!(fs::read_to_string(dir.path().join("out/map.txt")).expect("地图").starts_with("// 试验地图 16 × 12\n"));
    let report = fs::read_to_string(debug.join("report.txt")).expect("报告");
    assert!(report.contains("试验区域"));
    assert!(!report.contains("维斯塔海") && !report.contains("旧世界"));
    assert!(debug.join("zoom-test.png").is_file());
    assert!(!debug.join("zoom-gate.png").exists());
    // 没有选用气候缺省值，也没有在骨架中明确写出时，禁止悄悄套用经典气候。
    let mut no_climate = loaded;
    no_climate.climate = None;
    let text = layout_text(&dir.path().join("layout.toml"), &no_climate).expect("读骨架");
    assert!(!text.contains("[climate]"));
    let mut config: toml::Table = toml::from_str(&fs::read_to_string(&path).expect("配置")).expect("配置表");
    config.remove("climate");
    fs::write(&path, toml::to_string(&config).expect("无气候配置")).expect("写配置");
    let error = run(&root(), &strings(&["procedural", "--config", path.to_str().expect("路径")]))
        .expect_err("缺少气候，必须在生成前失败");
    assert!(format!("{error:#}").contains("missing field `climate`"), "{error:#}");
}
