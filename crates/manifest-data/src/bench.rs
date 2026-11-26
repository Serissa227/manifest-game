//! 基准与测试支持（不属于正式接口）：
//! - [`build_nav_parallel`]：不经缓存、多线程构建航线表；
//! - [`write_synthetic_world`]：把真实 data/ 复制到临时目录，并把地图向右下扩展成大图（新增外洋、
//!   一块"新大陆"与群岛），追加海外港口、殖民点、发现物与殖民地建筑，用来测量大地图上的加载耗时、
//!   检验旧存档在扩图后的兼容性。生成的内容只用于测试，不写入 data/。

pub use crate::convert::build_nav_parallel;
pub mod synth1080;
use std::fmt::Write as _;
use std::path::Path;

/// 合成世界的规模。
#[derive(Clone, Copy, Debug)]
pub struct SyntheticSize {
    pub width: usize,
    pub height: usize,
    /// 追加的海外港口数
    pub ports: usize,
    /// 追加的殖民点数
    pub sites: usize,
    /// 追加的发现物数
    pub discoveries: usize,
}

impl Default for SyntheticSize {
    fn default() -> Self {
        SyntheticSize { width: 400, height: 170, ports: 14, sites: 40, discoveries: 24 }
    }
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for e in std::fs::read_dir(from)? {
        let e = e?;
        let p = e.path();
        let dest = to.join(e.file_name());
        if p.is_dir() {
            copy_dir(&p, &dest)?;
        } else {
            std::fs::copy(&p, &dest)?;
        }
    }
    Ok(())
}

/// 去掉 `dir` 中正式的扩展内容（海外港口与殖民点、发现物、殖民建筑、从海外港口出发的剧本，
/// 以及在海外港口酒馆等待招募的航海士），
/// 得到只有旧世界地点的“基础世界”。合成测试在它之上追加自己的扩展文件，避免与正式内容混在一起。
/// 地理图层中，逐格图层（高程、植被、海区标记）随地图一起裁剪；河流与地标（第五批的写实地理）一并去掉。
/// （主角身世 `captain.toml` 的开局效果引用新大陆的海区，裁回旧地图后这些海区不存在，所以去掉——基础世界开局不设身世；
/// 城镇工坊 `workshops.toml` 里在海外港口的条目同航海士一样去掉，旧世界的工坊保留；
/// 剧情事件（推荐角色的故事线与奇遇，`stories/`）引用新大陆的港口、海区与发现物，推荐角色的剧本需要主角身世，
/// 同样去掉，见 [`strip_stories`]。）
pub fn strip_expansion(dir: &Path) -> std::io::Result<()> {
    strip_stories(dir)?;
    let world = dir.join("world");
    let overseas = world.join("overseas.toml");
    let keys = overseas_keys(dir);
    crop_to_legacy_map(dir)?;
    for f in [
        overseas,
        world.join("discoveries.toml"),
        dir.join("colony.toml"),
        dir.join("captain.toml"),
        dir.join("locales").join("en").join("captain.toml"),
        world.join("rivers.toml"),
        world.join("landmarks.toml"),
    ] {
        if f.exists() {
            std::fs::remove_file(f)?;
        }
    }
    let scenarios = dir.join("scenarios");
    if scenarios.is_dir() {
        for e in std::fs::read_dir(&scenarios)? {
            let p = e?.path();
            let text = std::fs::read_to_string(&p).unwrap_or_default();
            let starts_overseas = text.lines().any(|l| {
                l.trim()
                    .strip_prefix("start = \"")
                    .and_then(|r| r.split('"').next())
                    .is_some_and(|k| keys.iter().any(|x| x == k))
            });
            if starts_overseas {
                std::fs::remove_file(&p)?;
            }
        }
    }
    strip_mates_at(&dir.join("mates.toml"), &keys)?;
    strip_entries_at(&dir.join("workshops.toml"), "workshops", "loc", &keys)?;
    Ok(())
}

/// 去掉 `dir` 中的剧情事件：故事线与奇遇（`stories/` 目录）、带主角或挂故事线的剧本（推荐角色，连同英文覆盖），
/// 以及 `captain.toml` 里只给这些推荐角色用的身世选项（`hero = "<剧本 key>"`）。
/// 测试把正式的海外内容（港口、发现物）换成自己的之前调用，免得故事引用不存在的地点与发现物；[`strip_expansion`] 已经包含这一步。
pub fn strip_stories(dir: &Path) -> std::io::Result<()> {
    let en = dir.join("locales").join("en");
    for d in [dir.join("stories"), en.join("stories")] {
        if d.is_dir() {
            std::fs::remove_dir_all(d)?;
        }
    }
    let scenarios = dir.join("scenarios");
    let mut removed: Vec<String> = Vec::new();
    if scenarios.is_dir() {
        for e in std::fs::read_dir(&scenarios)? {
            let p = e?.path();
            let text = std::fs::read_to_string(&p).unwrap_or_default();
            let story = text.lines().any(|l| {
                let l = l.trim();
                l.starts_with("story = ") || l == "[hero]"
            });
            if story {
                if let Some(key) =
                    text.lines().find_map(|l| l.trim().strip_prefix("key = \"")).and_then(|r| r.split('"').next())
                {
                    removed.push(key.to_string());
                }
                std::fs::remove_file(&p)?;
                if let Some(name) = p.file_name() {
                    let overlay = en.join("scenarios").join(name);
                    if overlay.exists() {
                        std::fs::remove_file(overlay)?;
                    }
                }
            }
        }
    }
    strip_entries_at(&dir.join("captain.toml"), "options", "hero", &removed)
}

/// `dir/world/overseas.toml` 中海外地点（港口与殖民点）的 key（简单按行读取 key = "…"，不需要完整解析）。
fn overseas_keys(dir: &Path) -> Vec<String> {
    std::fs::read_to_string(dir.join("world").join("overseas.toml"))
        .unwrap_or_default()
        .lines()
        .filter_map(|l| l.trim().strip_prefix("key = \""))
        .filter_map(|l| l.split('"').next())
        .map(str::to_string)
        .collect()
}

/// 去掉 `dir/mates.toml` 中最初在海外港口酒馆等待招募的航海士（`home` 是 `world/overseas.toml` 中的地点）。
/// 测试把正式的海外内容换成自己的（例如只留一个测试用殖民点）之前调用，免得这些航海士引用不存在的港口；
/// [`strip_expansion`] 已经包含这一步。
pub fn strip_overseas_mates(dir: &Path) -> std::io::Result<()> {
    strip_mates_at(&dir.join("mates.toml"), &overseas_keys(dir))
}

/// 去掉 `data/workshops.toml` 里在海外港口的城镇工坊（换掉海外内容的合成测试用，与 [`strip_overseas_mates`] 同理）。
pub fn strip_overseas_workshops(dir: &Path) -> std::io::Result<()> {
    strip_entries_at(&dir.join("workshops.toml"), "workshops", "loc", &overseas_keys(dir))
}

/// 去掉 `home` 在 `places` 之中的 `[[mates]]` 条目，与从海外出发的剧本同理。
fn strip_mates_at(path: &Path, places: &[String]) -> std::io::Result<()> {
    strip_entries_at(path, "mates", "home", places)
}

/// 去掉 `[[table]]` 条目中 `field` 在 `places` 之中的那些。
/// 按行切分：每个条目从 `[[table]]` 那一行（后面可以跟注释）起、到下一个条目之前为止（条目之间的注释归前一个条目）。
fn strip_entries_at(path: &Path, table: &str, field: &str, places: &[String]) -> std::io::Result<()> {
    let Ok(text) = std::fs::read_to_string(path) else { return Ok(()) };
    let header = format!("[[{table}]]");
    let prefix = format!("{field} = \"");
    let mut chunks: Vec<String> = vec![String::new()];
    for line in text.split_inclusive('\n') {
        if line.trim_start().starts_with(&header) {
            chunks.push(String::new());
        }
        if let Some(last) = chunks.last_mut() {
            last.push_str(line);
        }
    }
    let listed = |chunk: &str| {
        chunk.lines().any(|l| {
            l.trim()
                .strip_prefix(prefix.as_str())
                .and_then(|r| r.split('"').next())
                .is_some_and(|k| places.iter().any(|x| x == k))
        })
    };
    let kept: String =
        chunks.iter().enumerate().filter(|(i, c)| *i == 0 || !listed(c)).map(|(_, c)| c.as_str()).collect();
    if kept.len() != text.len() {
        std::fs::write(path, kept)?;
    }
    Ok(())
}

/// 读取 `rules.toml [world] legacy_map_size`（缺省 240×120）。
fn legacy_size(dir: &Path) -> (usize, usize) {
    let rules = std::fs::read_to_string(dir.join("rules.toml")).unwrap_or_default();
    rules
        .lines()
        .find_map(|l| l.trim().strip_prefix("legacy_map_size"))
        .and_then(|r| {
            let nums: Vec<usize> = r
                .split(|c: char| !c.is_ascii_digit())
                .filter(|t| !t.is_empty())
                .filter_map(|t| t.parse().ok())
                .collect();
            (nums.len() >= 2).then(|| (nums[0], nums[1]))
        })
        .unwrap_or((240, 120))
}

/// 字符网格文件（map.txt 与各逐格图层）中的数据行（去掉注释行与空行）。
fn grid_rows(text: &str) -> Vec<Vec<char>> {
    text.lines()
        .map(|l| l.trim_end_matches('\r'))
        .filter(|l| !l.starts_with("//") && !l.is_empty())
        .map(|l| l.chars().collect())
        .collect()
}

/// 把字符网格文件裁到左上角 `lw` × `lh`（注释行保留）；文件不存在时什么都不做。
fn crop_grid(path: &Path, lw: usize, lh: usize) -> std::io::Result<()> {
    if !path.exists() {
        return Ok(());
    }
    let text = std::fs::read_to_string(path)?;
    let mut out = String::new();
    let mut rows = 0;
    for line in text.lines() {
        let line = line.trim_end_matches('\r');
        if line.starts_with("//") || line.is_empty() {
            let _ = writeln!(out, "{line}");
        } else if rows < lh {
            let _ = writeln!(out, "{}", line.chars().take(lw).collect::<String>());
            rows += 1;
        }
    }
    std::fs::write(path, out)
}

/// 取出 TOML 片段中某个整数数组字段（如 `rect = [1, 2, 3, 4]`）的数字。
fn int_field(block: &str, field: &str) -> Option<Vec<usize>> {
    block.lines().find_map(|l| l.trim().strip_prefix(field).filter(|r| r.trim_start().starts_with('='))).map(|r| {
        r.split(|c: char| !c.is_ascii_digit()).filter(|t| !t.is_empty()).filter_map(|t| t.parse().ok()).collect()
    })
}

/// 取出 TOML 片段中某个字符串字段（如 `mark = "a"`）的值。
fn str_field(block: &str, field: &str) -> Option<String> {
    block.lines().find_map(|l| {
        let rest = l.trim().strip_prefix(field)?.trim_start().strip_prefix('=')?.trim_start().strip_prefix('"')?;
        rest.split('"').next().map(str::to_string)
    })
}

/// 把地图裁回旧尺寸（`rules.toml [world] legacy_map_size`，缺省 240×120），逐格图层（高程、植被、海区标记）同样裁剪，
/// 并去掉在裁剪后的地图上已没有位置的海区：矩形的左上角在旧地图之外、且其 `mark` 不出现在裁剪后的 seas.txt 中。
/// 保留的海区矩形夹到旧地图范围内。第五批重做了地理（EXPANSION §10.2），裁剪结果不再逐格等于扩展前的世界，
/// 但旧世界的全部港口与城市仍落在旧尺寸内并互相可达，足以作为合成测试的底座。
fn crop_to_legacy_map(dir: &Path) -> std::io::Result<()> {
    let (lw, lh) = legacy_size(dir);
    let world = dir.join("world");
    for name in ["map.txt", "relief.txt", "biomes.txt", "seas.txt"] {
        crop_grid(&world.join(name), lw, lh)?;
    }
    let used_marks: Vec<char> = std::fs::read_to_string(world.join("seas.txt"))
        .map(|t| grid_rows(&t).into_iter().flatten().filter(|c| !matches!(c, '.' | '~' | '#')).collect())
        .unwrap_or_default();
    let regions = std::fs::read_to_string(world.join("regions.toml"))?;
    let mut kept = String::new();
    for (i, block) in regions.split("[[regions]]").enumerate() {
        if i == 0 {
            kept.push_str(block);
            continue;
        }
        let rect = int_field(block, "rect").filter(|n| n.len() >= 4);
        let inside = rect.as_ref().is_none_or(|n| n[0] < lw && n[1] < lh);
        let marked = str_field(block, "mark").and_then(|m| m.chars().next()).is_some_and(|m| used_marks.contains(&m));
        if !inside && !marked {
            continue;
        }
        kept.push_str("[[regions]]");
        match rect {
            Some(n) => {
                let clamped = format!(
                    "rect = [{}, {}, {}, {}]",
                    n[0].min(lw - 1),
                    n[1].min(lh - 1),
                    n[2].min(lw - 1),
                    n[3].min(lh - 1)
                );
                let mut replaced = false;
                for line in block.split_inclusive('\n') {
                    let is_rect = line.trim().strip_prefix("rect").is_some_and(|r| r.trim_start().starts_with('='));
                    if is_rect && !replaced {
                        kept.push_str(&clamped);
                        kept.push_str(if line.ends_with('\n') { "\n" } else { "" });
                        replaced = true;
                    } else {
                        kept.push_str(line);
                    }
                }
            }
            None => kept.push_str(block),
        }
    }
    std::fs::write(world.join("regions.toml"), kept)
}

/// 把字符网格文件扩展到 `grid` 的尺寸：左上角保留原内容，新格子按 `fill(是否陆地)` 填写；文件不存在时什么都不做。
fn extend_grid(path: &Path, grid: &[Vec<char>], fill: impl Fn(bool) -> char) -> std::io::Result<()> {
    if !path.exists() {
        return Ok(());
    }
    let text = std::fs::read_to_string(path)?;
    let old = grid_rows(&text);
    let mut out = String::new();
    for l in text.lines().filter(|l| l.starts_with("//")) {
        let _ = writeln!(out, "{l}");
    }
    for (y, row) in grid.iter().enumerate() {
        let line: String = row
            .iter()
            .enumerate()
            .map(|(x, ch)| old.get(y).and_then(|r| r.get(x)).copied().unwrap_or_else(|| fill(*ch == '#')))
            .collect();
        let _ = writeln!(out, "{line}");
    }
    std::fs::write(path, out)
}

/// 复制 `src` 到 `dst` 并扩展成合成大世界。`src` 的地图原样保留在左上角，旧地点与各表的 key 不变；
/// `src` 里正式的扩展内容先被去掉（见 [`strip_expansion`]），再写入合成的扩展文件。
pub fn write_synthetic_world(src: &Path, dst: &Path, size: SyntheticSize) -> std::io::Result<()> {
    copy_dir(src, dst)?;
    strip_expansion(dst)?;
    let world = dst.join("world");
    let text = std::fs::read_to_string(world.join("map.txt"))?;
    let comments: Vec<&str> = text.lines().filter(|l| l.starts_with("//")).collect();
    let rows: Vec<Vec<char>> = text
        .lines()
        .map(|l| l.trim_end_matches('\r'))
        .filter(|l| !l.starts_with("//") && !l.is_empty())
        .map(|l| l.chars().collect())
        .collect();
    let (w0, h0) = (rows.first().map(|r| r.len()).unwrap_or(0), rows.len());
    let (w, h) = (size.width.max(w0 + 60), size.height.max(h0 + 20));
    // 新大陆：东部的大块陆地；群岛：南部零散小岛。四周一圈浅海。
    let continent = |x: usize, y: usize| {
        let (x0, x1, y0, y1) = (w0 + 50, w - 20, 15, h - 20);
        // 西岸有几处海湾，让海岸线不那么平直
        let bay = (y / 12) % 3 == 1 && x < x0 + 6;
        x >= x0 && x <= x1 && y >= y0 && y <= y1 && !bay
    };
    let island = |x: usize, y: usize| {
        let in_south = y >= h0 + 4 && y + 4 < h && x + 4 < w0;
        let in_ocean = x >= w0 + 6 && x + 6 < w0 + 50 && y > 4 && y + 4 < h;
        (in_south || in_ocean) && x % 23 < 3 && y % 17 < 3
    };
    let land = |x: usize, y: usize| continent(x, y) || island(x, y);
    let mut grid: Vec<Vec<char>> = vec![vec!['.'; w]; h];
    for (y, row) in grid.iter_mut().enumerate() {
        for (x, ch) in row.iter_mut().enumerate() {
            if y < h0 && x < w0 {
                *ch = rows[y][x];
            } else if land(x, y) {
                *ch = '#';
            }
        }
    }
    // 新区域中与陆地相邻的深海改为浅海
    for y in 0..h {
        for x in 0..w {
            if (y < h0 && x < w0) || grid[y][x] != '.' {
                continue;
            }
            let near = (-1i64..=1).any(|dy| {
                (-1i64..=1).any(|dx| {
                    let (nx, ny) = (x as i64 + dx, y as i64 + dy);
                    nx >= 0
                        && ny >= 0
                        && (nx as usize) < w
                        && (ny as usize) < h
                        && grid[ny as usize][nx as usize] == '#'
                })
            });
            if near {
                grid[y][x] = '~';
            }
        }
    }
    let mut map = String::new();
    for c in &comments {
        let _ = writeln!(map, "{c}");
    }
    let _ = writeln!(map, "// 合成测试地图：{w} × {h}（旧地图位于左上角）");
    for row in &grid {
        let _ = writeln!(map, "{}", row.iter().collect::<String>());
    }
    std::fs::write(world.join("map.txt"), map)?;
    // 逐格图层随地图扩展：新陆地为低地阔叶林，新海格为 .（海区按矩形回退）
    extend_grid(&world.join("relief.txt"), &grid, |land| if land { '1' } else { '.' })?;
    extend_grid(&world.join("biomes.txt"), &grid, |land| if land { 'F' } else { '.' })?;
    extend_grid(&world.join("seas.txt"), &grid, |_| '.')?;

    // 海区：新区域追加在末尾
    let mut regions = std::fs::read_to_string(world.join("regions.toml"))?;
    let weather = r#"spring = { wind = "E", wind_strength = 5, current = "E", current_strength = 1, storm = 0.003, pirate = 0.002 }
summer = { wind = "SE", wind_strength = 6, current = "E", current_strength = 1, storm = 0.004, pirate = 0.002 }
autumn = { wind = "E", wind_strength = 5, current = "E", current_strength = 1, storm = 0.003, pirate = 0.002 }
winter = { wind = "NE", wind_strength = 7, current = "E", current_strength = 1, storm = 0.006, pirate = 0.002 }"#;
    let mid = w0 + 50;
    for (key, rect) in [
        ("synth_morning_west", [w0, 0, mid - 1, h - 1]),
        ("synth_new_world", [mid, 0, w - 1, h - 1]),
        ("synth_south_isles", [0, h0, w0 - 1, h - 1]),
    ] {
        let _ = write!(
            regions,
            "\n[[regions]]\nkey = \"{key}\"\nname = \"合成海区 {key}\"\nrect = [{}, {}, {}, {}]\n{weather}\n",
            rect[0], rect[1], rect[2], rect[3]
        );
    }
    std::fs::write(world.join("regions.toml"), regions)?;

    // 海外港口：新大陆西岸；殖民点：新大陆东岸与群岛
    let is_sea = |x: usize, y: usize| grid[y][x] != '#';
    let touches = |x: usize, y: usize| {
        (-1i64..=1).any(|dy| {
            (-1i64..=1).any(|dx| {
                let (nx, ny) = (x as i64 + dx, y as i64 + dy);
                nx >= 0 && ny >= 0 && (nx as usize) < w && (ny as usize) < h && grid[ny as usize][nx as usize] == '#'
            })
        })
    };
    let coast = |x: usize, y0: usize, y1: usize, n: usize| -> Vec<(usize, usize)> {
        let mut out = Vec::new();
        let step = ((y1 - y0) / n.max(1)).max(1);
        let mut y = y0;
        while y < y1 && out.len() < n {
            // 沿行向东找第一个与陆地相邻的海格
            if let Some(cx) = (x.saturating_sub(8)..(x + 8).min(w)).find(|cx| is_sea(*cx, y) && touches(*cx, y)) {
                out.push((cx, y));
            }
            y += step;
        }
        out
    };
    let mut overseas = String::from("# 合成测试数据：海外港口与殖民点\n");
    let ports = coast(mid - 1, 18, h - 22, size.ports);
    for (i, (x, y)) in ports.iter().enumerate() {
        let _ = write!(
            overseas,
            "\n[[ports]]\nkey = \"synth_port_{i}\"\nname = \"合成港 {i}\"\npos = [{x}, {y}]\nfaction = \"cuilan\"\ndevelopment = 30\nfounded = {}\nlore = \"合成测试港口\"\nshipyard = [\"swallow\"]\nmarket = [\n  {{ good = \"grain\", supply = 20, demand = 18 }},\n  {{ good = \"timber\", supply = 25, demand = 12 }},\n  {{ good = \"cloth\", supply = 4, demand = 10 }},\n]\n",
            1470 + i
        );
    }
    let mut sites = coast(w - 20, 16, h - 22, size.sites.div_ceil(2));
    // 群岛小岛（左上角在 x ≡ 0 (mod 23)、y ≡ 0 (mod 17)）西侧中间的海格
    for y in (0..h).filter(|y| y % 17 == 1 && *y >= h0 + 4 && y + 4 < h) {
        for x in (23..w0).step_by(23).filter(|x| x + 4 < w0) {
            if sites.len() < size.sites && is_sea(x - 1, y) && touches(x - 1, y) {
                sites.push((x - 1, y));
            }
        }
    }
    let resources = ["timber", "fur", "sugarcane", "iron_ore", "tobacco", "cotton", "copper_ore", "cocoa"];
    let terrains = ["forest", "plains", "hills", "jungle", "tundra", "desert", "swamp", "island"];
    for (i, (x, y)) in sites.iter().take(size.sites).enumerate() {
        let _ = write!(
            overseas,
            "\n[[sites]]\nkey = \"synth_site_{i}\"\nname = \"合成殖民点 {i}\"\npos = [{x}, {y}]\nterrain = \"{}\"\nfertility = {}\nhazard = {}\nresources = [ {{ good = \"{}\", richness = {} }}, {{ good = \"grain\", richness = 40 }} ]\nlore = \"合成测试殖民点\"\n",
            terrains[i % terrains.len()],
            30 + (i * 7) % 60,
            10 + (i * 11) % 60,
            resources[i % resources.len()],
            40 + (i * 13) % 50
        );
    }
    std::fs::write(world.join("overseas.toml"), overseas)?;

    // 发现物：新旧区域都有
    let mut disc = String::from("# 合成测试数据：发现物\n");
    let kinds = ["ruins", "wonder", "wreck", "relic", "beast", "landmark"];
    for i in 0..size.discoveries {
        let (x, y) = if i % 2 == 0 {
            (10 + (i * 37) % (w0 - 20), 5 + (i * 19) % (h0 - 10))
        } else {
            (w0 + (i * 29) % (w - w0), (i * 23) % h)
        };
        let _ = write!(
            disc,
            "\n[[discoveries]]\nkey = \"synth_find_{i}\"\nname = \"合成发现 {i}\"\npos = [{x}, {y}]\nkind = \"{}\"\nfame = {}\nvalue = {}\nlore = \"合成测试发现物\"\n",
            kinds[i % kinds.len()],
            10 + i * 2,
            1000 + i * 250
        );
    }
    std::fs::write(world.join("discoveries.toml"), disc)?;
    std::fs::write(dst.join("colony.toml"), SYNTHETIC_BUILDINGS)?;
    Ok(())
}

/// 合成测试用的殖民地建筑（key 与 EXPANSION.md §4.1 的顺序一致，只用现有商品）。
pub const SYNTHETIC_BUILDINGS: &str = r#"# 合成测试数据：殖民地建筑
[[buildings]]
key = "farm"
name = "农庄"
kind = "food"
cost = 1500
materials = [ { good = "timber", qty = 20 } ]
build_days = 20
workers = 25
upkeep = 40
max_level = 3
goods = ["grain", "fish"]
output = 12

[[buildings]]
key = "plantation"
name = "种植园"
kind = "extract"
cost = 2500
materials = [ { good = "timber", qty = 30 } ]
build_days = 30
workers = 30
upkeep = 60
max_level = 3
goods = ["sugarcane", "tobacco", "cotton", "cocoa"]
output = 8

[[buildings]]
key = "lumber"
name = "伐木场"
kind = "extract"
cost = 1200
build_days = 15
workers = 20
upkeep = 30
max_level = 3
goods = ["timber"]
output = 10

[[buildings]]
key = "mine"
name = "矿坑"
kind = "extract"
cost = 3000
materials = [ { good = "timber", qty = 30 } ]
build_days = 40
workers = 35
upkeep = 80
max_level = 3
goods = ["iron_ore", "copper_ore"]
output = 6

[[buildings]]
key = "fishery"
name = "渔场"
kind = "food"
cost = 1000
build_days = 10
workers = 15
upkeep = 25
max_level = 3
goods = ["fish"]
output = 10

[[buildings]]
key = "hunting"
name = "猎场"
kind = "extract"
cost = 900
build_days = 10
workers = 12
upkeep = 20
max_level = 2
goods = ["fur"]
output = 4

[[buildings]]
key = "distillery"
name = "酿酒坊"
kind = "process"
cost = 2000
materials = [ { good = "timber", qty = 20 } ]
build_days = 25
workers = 15
upkeep = 50
max_level = 3
inputs = [ { good = "grapes", qty = 4 } ]
outputs = [ { good = "wine", qty = 2 } ]

[[buildings]]
key = "sugarmill"
name = "糖坊"
kind = "process"
cost = 2000
materials = [ { good = "timber", qty = 20 } ]
build_days = 25
workers = 15
upkeep = 50
max_level = 3
inputs = [ { good = "sugarcane", qty = 4 } ]
outputs = [ { good = "sugar", qty = 2 } ]

[[buildings]]
key = "storehouse"
name = "仓棚"
kind = "storage"
cost = 800
materials = [ { good = "timber", qty = 15 } ]
build_days = 10
upkeep = 10
max_level = 5
capacity = 400

[[buildings]]
key = "fort"
name = "栅栏堡"
kind = "defense"
cost = 3000
materials = [ { good = "timber", qty = 40 } ]
build_days = 30
workers = 10
upkeep = 60
max_level = 3
defense = 20

[[buildings]]
key = "chapel"
name = "礼拜堂"
kind = "morale"
cost = 1800
build_days = 20
workers = 3
upkeep = 20
max_level = 2
morale = 8

[[buildings]]
key = "tavern"
name = "殖民地酒馆"
kind = "morale"
cost = 1200
build_days = 15
workers = 4
upkeep = 25
max_level = 2
morale = 6

[[buildings]]
key = "dock"
name = "码头"
kind = "dock"
cost = 2500
materials = [ { good = "timber", qty = 30 } ]
build_days = 25
workers = 10
upkeep = 40
max_level = 1

[[buildings]]
key = "housing"
name = "住宅区"
kind = "housing"
cost = 1000
materials = [ { good = "timber", qty = 20 } ]
build_days = 15
upkeep = 15
max_level = 5
housing = 150
"#;
