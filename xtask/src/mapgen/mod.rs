//! `cargo xtask mapgen procedural|real --config <mapgen.toml>`。

pub mod biomes;
mod check;
pub mod coast;
pub mod config;
pub mod elevation;
mod fine;
pub mod layers;
mod real;
mod rivers;

use anyhow::{Context, Result, bail, ensure};
use config::{Config, Mode};
use std::path::{Path, PathBuf};

pub fn run(root: &Path, args: &[String]) -> Result<()> {
    match args.first().map(String::as_str) {
        Some("procedural") => crate::worldgen::run(root, &args[1..]),
        Some("real") => {
            // --fine-only：只重写 fine/ 子目录的细图层（M01），既有的图层与锚地一个字节都不碰
            let fine_only = args.len() == 4 && args[3] == "--fine-only";
            ensure!(
                (args.len() == 3 || fine_only) && args[1] == "--config",
                "用法：cargo xtask mapgen real --config data/maps/<map>/mapgen.toml [--fine-only]"
            );
            let config = Config::read(Path::new(&args[2]))?;
            ensure!(config.mode == Mode::Real, "mapgen real 需要 mode = \"real\" 的配置；不会回退为程序地图");
            if fine_only { real::run_fine_only(&config) } else { real::run(&config) }
        }
        _ => bail!(
            "用法：cargo xtask mapgen procedural [--config 路径] [worldgen 参数] | cargo xtask mapgen real --config 路径 [--fine-only]"
        ),
    }
}

pub fn classic_config(root: &Path) -> PathBuf {
    root.join("xtask/maps/classic.toml")
}

pub fn debug_dir(root: &Path) -> Result<PathBuf> {
    let target = match std::env::var_os("CARGO_TARGET_DIR").filter(|s| !s.is_empty()) {
        Some(p) => {
            let p = PathBuf::from(p);
            if p.is_absolute() { p } else { root.join(p) }
        }
        None => root.join("target"),
    };
    ensure!(target.file_name().is_some(), "无效的 CARGO_TARGET_DIR");
    Ok(target.join("worldgen"))
}

/// 骨架气候按字段覆盖当前配置的缺省值；不再有代码内的经典气候曲线。
pub fn layout_text(path: &Path, config: &Config) -> Result<String> {
    let text = std::fs::read_to_string(path).with_context(|| format!("读取 {}", path.display()))?;
    let Some(defaults) = &config.climate else { return Ok(text) };
    let mut value: toml::Table = toml::from_str(&text).with_context(|| format!("解析 {}", path.display()))?;
    let climate = value.entry("climate").or_insert_with(|| toml::Value::Table(toml::Table::new()));
    let climate = climate.as_table_mut().context("骨架 climate 应为表")?;
    for (key, value) in defaults {
        climate.entry(key).or_insert_with(|| value.clone());
    }
    toml::to_string(&value).context("合并骨架气候配置")
}

#[cfg(test)]
mod tests;
