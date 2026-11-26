//! 两种生成方式共用的输出管线；先校验整组图层，再创建目录写出。

use anyhow::{Context, Result, ensure};
use std::path::Path;

pub const FILES: [&str; 6] = ["map.txt", "relief.txt", "biomes.txt", "seas.txt", "rivers.toml", "landmarks.toml"];

pub struct Layers(pub [String; 6]);

impl Layers {
    pub fn write(&self, directory: &Path, width: usize, height: usize) -> Result<()> {
        self.validate(width, height)?;
        std::fs::create_dir_all(directory).with_context(|| format!("创建 {}", directory.display()))?;
        for (name, text) in FILES.iter().zip(&self.0) {
            let path = directory.join(name);
            std::fs::write(&path, text).with_context(|| format!("写入 {}", path.display()))?;
        }
        Ok(())
    }

    fn validate(&self, width: usize, height: usize) -> Result<()> {
        let mut grids = Vec::new();
        for (name, text) in FILES[..4].iter().zip(&self.0[..4]) {
            let rows: Vec<&str> = text.lines().filter(|l| !l.starts_with("//") && !l.is_empty()).collect();
            ensure!(
                rows.len() == height && rows.iter().all(|r| r.chars().count() == width),
                "{name} 尺寸不等于 {width} × {height}"
            );
            grids.push(rows.iter().flat_map(|r| r.chars()).collect::<Vec<_>>());
        }
        for (((&terrain, &relief), &biome), &sea) in grids[0].iter().zip(&grids[1]).zip(&grids[2]).zip(&grids[3]) {
            let land = terrain == '#';
            ensure!(matches!(terrain, '.' | '~' | '#'), "map.txt 存在无效地形代码");
            ensure!(if land { relief.is_ascii_digit() } else { relief == '.' }, "relief.txt 与海陆不一致");
            ensure!(if land { "ITBFGMKDSJWAVX".contains(biome) } else { biome == '.' }, "biomes.txt 与海陆不一致");
            ensure!(
                if land { sea == '#' } else { sea != '#' && !sea.is_whitespace() && !sea.is_control() },
                "seas.txt 与海陆不一致"
            );
        }
        for (name, text) in FILES[4..].iter().zip(&self.0[4..]) {
            let _: toml::Table = toml::from_str(text).with_context(|| format!("{name} 不是有效 TOML"))?;
        }
        Ok(())
    }
}
