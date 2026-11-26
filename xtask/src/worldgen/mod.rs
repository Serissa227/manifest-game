//! `cargo xtask worldgen`：按设计骨架 `data/world/layout.toml` 确定性地生成世界地理
//! （EXPANSION.md §10.3）：map.txt、relief.txt、biomes.txt、seas.txt、rivers.toml、landmarks.toml，
//! 并给出（或用 `--write-places` 直接写回）港口、城市、殖民点、发现物的坐标，按地形给道路寻路（`--write-roads` 写回）。
//!
//! 流程：骨架有符号距离场 + 两层域扭曲 + 分形噪声 + 岩性硬度 + 脊状中尺度起伏 → 高程（台地、桌山、丘陵、
//! 逐点宽高且带山口的山脉、火山、陨石坑）→ 按降水加权的隐式 stream-power 河流侵蚀与热力侵蚀 →
//! 海岸过程（大河谷淹没成峡湾 / 溺谷 / 河口湾并做沿岸非极大值抑制、沙岸与堰洲岛、礁石与岩礁、环礁、三角洲）→
//! 海平面 → 形态学清理 → 大陆架（按海岸类型定宽）→ 气候（纬度气温加噪声与河谷增温、盛行风水汽与雨影、
//! 地中海式气候带）→ 植被（含河岸绿洲）→ 汇流量与主要河流 → 海区（沿水路最近种子）→ 地标、地点吸附与道路。
//!
//! 用法：
//!   cargo xtask worldgen                     # 生成图层到 data/world/，调试大图到 target/worldgen/
//!   cargo xtask worldgen --write-places      # 另外把地点坐标写回 ports / cities / overseas / discoveries
//!   cargo xtask worldgen --write-roads       # 另外把按地形寻路得到的道路长度与地形写回 roads.toml
//!   cargo xtask worldgen --debug <目录>      # 调试大图的输出目录
//!   cargo xtask worldgen --dry-run           # 只生成调试大图与报告，不改数据文件

mod check;
mod climate;
mod grid;
mod hydro;
mod layout;
mod noise;
mod output;
mod places;
pub(crate) mod png;
mod render;
mod roads;
mod seas;
mod shape;
mod stats;
mod terrain;

use crate::mapgen::{
    self,
    config::{Config, Mode},
    layers::Layers,
};
use anyhow::{Context, Result, bail};
use grid::Grid;
use std::fmt::Write as _;
use std::path::{Path, PathBuf};

struct Opts {
    config: Config,
    layout: PathBuf,
    world: PathBuf,
    debug: PathBuf,
    write_places: bool,
    write_roads: bool,
    dry_run: bool,
}

fn parse_opts(root: &Path, args: &[String]) -> Result<Opts> {
    let mut config_path = mapgen::classic_config(root);
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--config" | "--layout" | "--world" | "--output" | "--debug" => {
                let v = args.get(i + 1).with_context(|| format!("{} 需要一个路径参数", args[i]))?;
                if args[i] == "--config" {
                    config_path = v.into();
                }
                i += 1;
            }
            _ => {}
        }
        i += 1;
    }
    let config = Config::read(&config_path)?;
    if config.mode != Mode::Procedural {
        bail!("mapgen procedural 需要 mode = \"procedural\" 的配置");
    }
    let mut o = Opts {
        layout: config.layout.clone().context("缺少 layout")?,
        world: config.world.clone().context("缺少 world")?,
        debug: mapgen::debug_dir(root)?,
        config,
        write_places: false,
        write_roads: false,
        dry_run: false,
    };
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--write-places" => o.write_places = true,
            "--write-roads" => o.write_roads = true,
            "--dry-run" => o.dry_run = true,
            "--config" | "--layout" | "--world" | "--output" | "--debug" => {
                let v = args.get(i + 1).with_context(|| format!("{} 需要一个路径参数", args[i]))?;
                let p = PathBuf::from(v);
                match args[i].as_str() {
                    "--config" => {}
                    "--layout" => o.layout = p,
                    "--world" => {
                        o.world = p.clone();
                        o.config.output = p;
                    }
                    "--output" => o.config.output = p,
                    _ => o.debug = p,
                }
                i += 1;
            }
            other => bail!(
                "未知参数 {other}；用法：cargo xtask mapgen procedural [--config 路径] [--write-places] [--write-roads] [--dry-run] [--layout 路径] [--world 目录] [--output 目录] [--debug 目录]"
            ),
        }
        i += 1;
    }
    Ok(o)
}

fn write(path: &Path, text: &str) -> Result<()> {
    std::fs::write(path, text).with_context(|| format!("写入 {}", path.display()))
}

fn write_png(path: &Path, c: &png::Canvas) -> Result<()> {
    std::fs::write(path, c.png()).with_context(|| format!("写入 {}", path.display()))
}

fn nearest(t: &terrain::Terrain, p: (i64, i64), want_land: Option<bool>, coast: bool, r: i64) -> (usize, usize) {
    let (w, h) = (t.land.w as i64, t.land.h as i64);
    let mut best: Option<(i64, (usize, usize))> = None;
    for dy in -r..=r {
        for dx in -r..=r {
            let (x, y) = (p.0 + dx, p.1 + dy);
            if x < 0 || y < 0 || x >= w || y >= h {
                continue;
            }
            let (ux, uy) = (x as usize, y as usize);
            let land = t.land.get(ux, uy);
            if want_land.is_some_and(|wl| wl != land) {
                continue;
            }
            if coast && land && t.dist_sea.get(ux, uy) > 1.5 {
                continue;
            }
            let d = dx * dx + dy * dy;
            if best.is_none_or(|(b, _)| d < b) {
                best = Some((d, (ux, uy)));
            }
        }
    }
    best.map(|b| b.1).unwrap_or((p.0.clamp(0, w - 1) as usize, p.1.clamp(0, h - 1) as usize))
}

pub fn run(root: &Path, args: &[String]) -> Result<()> {
    let o = parse_opts(root, args)?;
    let started = std::time::Instant::now();
    let text = mapgen::layout_text(&o.layout, &o.config)?;
    let l: layout::Layout = toml::from_str(&text).with_context(|| format!("解析 {}", o.layout.display()))?;
    if l.width < 10 || l.height < 10 {
        bail!("layout.toml 的 width / height 至少为 10");
    }
    if (l.width, l.height) != (o.config.width, o.config.height) {
        bail!("layout.toml 尺寸与 mapgen.toml 不一致");
    }
    let (w, h) = (l.width, l.height);
    let mut warns: Vec<String> = Vec::new();

    // ── 地形 ──
    let z = terrain::Zones::build(&l);
    let rain0 = climate::rough_rain(&l, &z);
    let mut t = terrain::build(&l, &z, &rain0);
    // 写了 via 的河先刻进地形（流经设定里的城市）
    let burned = hydro::burn(&l, &mut t, &mut warns);
    let clim = climate::compute(&l, &z, &t);
    let hy = hydro::route(&t, &clim.precip);
    let mut scratch = Vec::new();
    let pre_rivers = hydro::trace(&l, &t, &hy, &burned, &mut scratch);

    // ── 三角洲 ──
    let mut fans = Vec::new();
    let mut delta_meta = Vec::new();
    for d in &l.delta {
        let river = pre_rivers.iter().find(|r| r.key == d.river);
        let (apex, dir) = match (river, d.apex, d.direction) {
            // 扇顶与方向都写明时不依赖追溯结果；扇顶吸附到追溯出的河道上离它最近的格（8 格以内），
            // 河槽与汊道因此从真正的河道上分出
            (r, Some(a), Some(v)) => {
                let snap = r.and_then(|r| {
                    r.path
                        .iter()
                        .map(|&(x, y)| ((x as f64 - a[0]).powi(2) + (y as f64 - a[1]).powi(2), (x, y)))
                        .filter(|(d, _)| *d <= 64.0)
                        .min_by(|p, q| p.0.partial_cmp(&q.0).unwrap_or(std::cmp::Ordering::Equal).then(p.1.cmp(&q.1)))
                        .map(|(_, c)| (c.0 as f64, c.1 as f64))
                });
                (snap.unwrap_or((a[0], a[1])), v)
            }
            (Some(r), a, v) => {
                let n = r.path.len();
                let inset = d.inset.unwrap_or(d.length * 0.5).round() as usize;
                let ai = n.saturating_sub(1 + inset);
                let apex = a.map_or((r.path[ai].0 as f64, r.path[ai].1 as f64), |a| (a[0], a[1]));
                let mouth = r.path[n - 1];
                (apex, v.unwrap_or([mouth.0 as f64 - apex.0, mouth.1 as f64 - apex.1]))
            }
            (None, _, _) => {
                warns.push(format!("三角洲 {}：找不到河流 {}", d.name, d.river));
                continue;
            }
        };
        let len = (dir[0] * dir[0] + dir[1] * dir[1]).sqrt().max(1e-9);
        let dir = (dir[0] / len, dir[1] / len);
        let branches = (0..d.branches.len())
            .map(|k| {
                let (c, s) = terrain::DELTA_ROT[k % terrain::DELTA_ROT.len()];
                (dir.0 * c - dir.1 * s, dir.0 * s + dir.1 * c)
            })
            .collect();
        fans.push(terrain::Fan {
            apex,
            dir,
            inset: d.inset.unwrap_or(d.length * 0.5),
            length: d.length,
            spread: d.spread,
            branches,
        });
        delta_meta.push((d, apex, dir));
    }
    if !fans.is_empty() {
        terrain::add_deltas(&mut t, &l, &z, &fans);
    }
    let clim = climate::compute(&l, &z, &t);
    let hy = hydro::route(&t, &clim.precip);
    let mut rivers = hydro::trace(&l, &t, &hy, &burned, &mut warns);
    for (d, apex, dir) in &delta_meta {
        if let Some(main) = rivers.iter().find(|r| r.key == d.river).map(|r| r.path.clone()) {
            let b = hydro::branches(&t, *apex, *dir, &d.branches, l.seed, &main);
            if b.len() < d.branches.len() {
                warns.push(format!("三角洲 {}：只生成了 {} / {} 条分汊", d.name, b.len(), d.branches.len()));
            }
            rivers.extend(b);
        }
    }
    // 支流与没有命名的小河（汇流量够大的才写，多雨区门槛低、干旱区门槛高）
    let minor = hydro::minor(&l, &t, &hy, &clim.precip, &rivers, &o.config.naming);
    let (n_trib, n_brook) = (
        minor.iter().filter(|r| r.key.contains("_trib")).count(),
        minor.iter().filter(|r| r.key.starts_with("brook_")).count(),
    );
    rivers.extend(minor);

    // ── 地标 ──
    let mut arcane = Grid::new(w, h, false);
    let mut lms = Vec::new();
    for s in &l.landmark {
        let size = s.size.map(|v| (v[0].max(1) as usize, v[1].max(1) as usize));
        let (sw, sh) = size.unwrap_or((1, 1));
        let center = (s.pos[0] + sw as i64 / 2, s.pos[1] + sh as i64 / 2);
        let at_mouth = s.river.as_ref().and_then(|k| rivers.iter().find(|r| &r.key == k)).and_then(|r| r.path.last());
        let c = match (at_mouth, s.place.as_str()) {
            (Some(&m), _) => m,
            (None, "land") => nearest(&t, center, Some(true), false, 10),
            (None, "sea") => nearest(&t, center, Some(false), false, 10),
            (None, "coast") => nearest(&t, center, Some(true), true, 10),
            _ => (center.0.clamp(0, w as i64 - 1) as usize, center.1.clamp(0, h as i64 - 1) as usize),
        };
        if let (Some(k), None) = (&s.river, at_mouth) {
            warns.push(format!("地标 {}：找不到河流 {k}，按 place 吸附", s.key));
        }
        let pos = (c.0.saturating_sub(sw / 2), c.1.saturating_sub(sh / 2));
        if s.arcane_ground {
            // 奥术地貌按圆盘栅格化（不是方块）：以占地中心为圆心
            let (cx, cy) = (pos.0 as f64 + (sw as f64 - 1.0) / 2.0, pos.1 as f64 + (sh as f64 - 1.0) / 2.0);
            let rad = s.ground_radius.unwrap_or(sw.min(sh) as f64 / 2.0).max(0.0);
            let rr = rad.ceil() as i64 + 1;
            for dy in -rr..=rr {
                for dx in -rr..=rr {
                    let (x, y) = (cx.round() as i64 + dx, cy.round() as i64 + dy);
                    if x < 0 || y < 0 || x >= w as i64 || y >= h as i64 {
                        continue;
                    }
                    let d = ((x as f64 - cx).powi(2) + (y as f64 - cy).powi(2)).sqrt();
                    if d <= rad + 0.3 && t.land.get(x as usize, y as usize) {
                        arcane.set(x as usize, y as usize, true);
                    }
                }
            }
        }
        lms.push((
            output::LandmarkOut {
                key: s.key.clone(),
                name: s.name.clone(),
                category: s.category.clone(),
                kind: s.kind.clone(),
                pos,
                size,
                lore: s.lore.clone(),
                discovery: s.discovery.clone(),
            },
            c,
        ));
    }
    for (m, _) in &lms {
        if !matches!(m.category.as_str(), "natural" | "arcane" | "ancient" | "civic") {
            warns.push(format!("地标 {}：category “{}” 无效", m.key, m.category));
        }
    }

    // ── 植被与地势 ──
    let relief = climate::relief(&l, &t);
    let biomes = climate::biomes(&z, &t, &clim, &relief, &rivers, &arcane);

    // ── 海区 ──
    let regions_path = o.world.join("regions.toml");
    let keys = output::region_keys(&regions_path)?;
    let mut seeds: Vec<Vec<(usize, usize)>> = vec![Vec::new(); keys.len()];
    for r in &l.region {
        match keys.iter().position(|k| *k == r.key) {
            Some(i) => {
                for s in &r.seeds {
                    let c = (s[0].round().max(0.0) as usize, s[1].round().max(0.0) as usize);
                    if c.0 >= w || c.1 >= h || t.land.get(c.0, c.1) {
                        let n = nearest(&t, (c.0 as i64, c.1 as i64), Some(false), false, 8);
                        warns.push(format!("海区 {} 的种子 {:?} 不在海上，改用 {:?}", r.key, s, n));
                        seeds[i].push(n);
                    } else {
                        seeds[i].push(c);
                    }
                }
            }
            None => warns.push(format!("layout.toml 的海区 {} 不在 regions.toml 里", r.key)),
        }
    }
    for (i, k) in keys.iter().enumerate() {
        if seeds[i].is_empty() {
            warns.push(format!("海区 {k} 没有种子点，seas.txt 里不会有它的格"));
        }
    }
    let owner = seas::partition(&t.land, &seeds);

    // ── 地点 ──
    let place_refs = places::read_all(&o.world)?;
    let landmark_of: Vec<(String, (usize, usize))> =
        lms.iter().filter_map(|(m, c)| m.discovery.clone().map(|d| (d, *c))).collect();
    let geo = places::Geo { t: &t, biomes: &biomes, relief: &relief, rivers: &rivers, landmark_of: &landmark_of };
    let mut violations = Vec::new();
    let placed = places::snap(&l, &geo, &place_refs, &mut warns, &mut violations);
    for v in &violations {
        warns.push(v.clone());
    }

    // ── 道路：按地形寻路 ──
    let road_plan = roads::plan(&o.world, &t, &biomes, &relief, &rivers, &placed)?;
    for r in road_plan.iter().filter(|r| !r.found) {
        warns.push(format!("道路 {} — {}：两端不在同一块陆地上，找不到陆路", r.from, r.to));
    }

    // ── 输出 ──
    // 自检发现的问题：先把调试大图与报告写完，最后再报错
    let mut problems: Vec<String> = Vec::new();
    if !o.dry_run {
        let text = o.config.text.render(w, h, &l.params.relief_levels);
        let lm: Vec<output::LandmarkOut> = lms.into_iter().map(|(m, _)| m).collect();
        Layers([
            output::map_txt(&t, &text.map),
            output::relief_txt(&t, &relief, &text.relief),
            output::biomes_txt(&t, &biomes, &text.biomes),
            output::seas_txt(&t, &owner, &text.seas),
            output::rivers_toml(&rivers, &text.rivers),
            output::landmarks_toml(&lm, &text.landmarks),
        ])
        .write(&o.config.output, w, h)?;
        if o.write_places {
            let n = places::rewrite(&place_refs, &placed)?;
            println!("已改写 {n} 个地点坐标");
        }
        if o.write_roads {
            let n = roads::rewrite(&o.world, &road_plan)?;
            println!("已改写 roads.toml 的 {n} 行（道路长度与地形）");
        }
        // 输出另存时复制最终的地区与地点表；显式回写须在复制之前完成。
        if std::fs::canonicalize(&o.config.output)? != std::fs::canonicalize(&o.world)? {
            for name in ["regions.toml", "ports.toml", "cities.toml", "overseas.toml", "discoveries.toml", "roads.toml"]
            {
                let source = o.world.join(name);
                if source.is_file() {
                    std::fs::copy(&source, o.config.output.join(name))?;
                }
            }
        }
        output::ensure_marks(&o.config.output.join("regions.toml"))?;
        problems = check::check_layers(&o.config.output)?;
    }

    // ── 调试大图与报告 ──
    std::fs::create_dir_all(&o.debug).with_context(|| format!("创建 {}", o.debug.display()))?;
    let lm_marks: Vec<render::Mark> = l
        .landmark
        .iter()
        .map(|s| {
            let size = s.size.map(|v| (v[0].max(1) as usize, v[1].max(1) as usize)).unwrap_or((1, 1));
            render::Mark {
                pos: (s.pos[0].max(0) as usize, s.pos[1].max(0) as usize),
                size,
                category: s.category.clone(),
            }
        })
        .collect();
    let dots: Vec<render::Dot> = placed
        .iter()
        .map(|p| render::Dot {
            pos: p.new,
            kind: match p.kind {
                places::Kind::Port => 0,
                places::Kind::City => 1,
                places::Kind::Site => 2,
                places::Kind::Discovery => 3,
            },
        })
        .collect();
    let road_paths: Vec<Vec<(usize, usize)>> = road_plan.iter().map(|r| r.path.clone()).collect();
    let big = render::biomes(&t, &biomes, 4, &rivers, &lm_marks, &dots, &road_paths);
    write_png(&o.debug.join("biomes.png"), &big)?;
    let plain = render::biomes(&t, &biomes, 4, &rivers, &[], &[], &[]);
    write_png(&o.debug.join("biomes-plain.png"), &plain)?;
    write_png(&o.debug.join("relief.png"), &render::relief(&t, &relief, 4, &rivers))?;
    write_png(&o.debug.join("seas.png"), &render::seas(&t, &owner, 3, &seeds))?;
    write_png(&o.debug.join("flow.png"), &render::flow(&t, &hy.acc, 3))?;
    for zoom in &o.config.screenshots {
        let [x, y] = zoom.origin;
        let [zw, zh] = zoom.size;
        let c = big.crop_scaled(x * 4, y * 4, zw * 4, zh * 4, 2);
        write_png(&o.debug.join(format!("{}.png", zoom.name)), &c)?;
    }

    // 统计
    let land = t.land.v.iter().filter(|v| **v).count();
    let shallow = t.shallow.v.iter().filter(|v| **v).count();
    let mut report = String::new();
    let _ = writeln!(report, "世界生成报告（{w} × {h}，种子 {}）", l.seed);
    let _ = writeln!(
        report,
        "陆地 {:.1}%，浅海 {:.1}%，深海 {:.1}%",
        100.0 * land as f64 / (w * h) as f64,
        100.0 * shallow as f64 / (w * h) as f64,
        100.0 * (w * h - land - shallow) as f64 / (w * h) as f64
    );
    let mut codes: Vec<(u8, usize)> = Vec::new();
    for &b in &biomes.v {
        if b == climate::SEA {
            continue;
        }
        match codes.iter_mut().find(|(c, _)| *c == b) {
            Some(e) => e.1 += 1,
            None => codes.push((b, 1)),
        }
    }
    codes.sort();
    let _ = writeln!(
        report,
        "植被：{}",
        codes
            .iter()
            .map(|(c, n)| format!("{} {:.1}%", *c as char, 100.0 * *n as f64 / land.max(1) as f64))
            .collect::<Vec<_>>()
            .join("  ")
    );
    stats::report(&mut report, &t, &biomes, &o.config.report);
    if violations.is_empty() {
        let _ = writeln!(report, "殖民点地形：全部与岸上植被一致（吻合度 ≥ {}）", places::SITE_MATCH_MIN);
    } else {
        let _ = writeln!(report, "殖民点地形不符（自检会当作错误）：");
        for v in &violations {
            let _ = writeln!(report, "  {v}");
        }
    }
    let names = |v: Vec<&str>| v.join("、");
    let _ = writeln!(
        report,
        "骨架：陆块 {}；海 {}；岛屿 {}；岛弧 {}；山脉 {}；河谷 {}；火山 {}；陨石坑 {}；环礁 {}；水道 {}；浅滩 {}；分区 {} 个",
        names(l.land.iter().map(|s| s.name.as_str()).collect()),
        names(l.sea.iter().map(|s| s.name.as_str()).collect()),
        names(l.island.iter().map(|s| s.name.as_str()).collect()),
        names(l.arc.iter().map(|s| s.name.as_str()).collect()),
        names(l.range.iter().map(|s| s.name.as_str()).collect()),
        names(l.valley.iter().map(|s| s.name.as_str()).collect()),
        names(l.volcano.iter().map(|s| s.name.as_str()).collect()),
        names(l.crater.iter().map(|s| s.name.as_str()).collect()),
        names(l.atoll.iter().map(|s| s.name.as_str()).collect()),
        names(l.channel.iter().map(|s| s.name.as_str()).collect()),
        names(l.bank.iter().map(|s| s.name.as_str()).collect()),
        l.zone.iter().filter(|z| !z.name.is_empty()).count()
    );
    let _ = writeln!(report, "河流 {} 条（其中支流 {n_trib} 条、没有命名的小河 {n_brook} 条）：", rivers.len());
    for r in &rivers {
        let _ =
            writeln!(report, "  {} {} 长 {} 格 宽 {} 入海口 {:?}", r.key, r.name, r.path.len(), r.width, r.path.last());
    }
    let _ = writeln!(report, "道路（按地形寻路；长度为实际路程，括号里是两端直线距离）：");
    for r in &road_plan {
        let _ = writeln!(
            report,
            "  {} — {}：{:.0} 格（直线 {:.0}），{}{}",
            r.from,
            r.to,
            r.length,
            r.straight,
            r.terrain,
            if r.found { "" } else { "（找不到陆路）" }
        );
    }
    let _ = writeln!(report, "流量最大的河口：");
    for (c, a) in hydro::top_mouths(&t, &hy, 40) {
        let _ = writeln!(report, "  {:?} 汇流量 {a:.0}", c);
    }
    let _ = writeln!(report, "海区：");
    for (i, k) in keys.iter().enumerate() {
        let n = owner.v.iter().filter(|&&o| o == i as u16).count();
        let _ = writeln!(report, "  {} {k}: {n} 格", seas::mark_of(i));
    }
    let _ = writeln!(report, "地点：");
    for p in &placed {
        let d = ((p.new.0 as f64 - p.old.0 as f64).powi(2) + (p.new.1 as f64 - p.old.1 as f64).powi(2)).sqrt();
        let _ = writeln!(report, "  {:<22} {:?} → {:?}（移动 {d:.1} 格，{}）", p.key, p.old, p.new, p.note);
    }
    if !warns.is_empty() {
        let _ = writeln!(report, "警告：");
        for wn in &warns {
            let _ = writeln!(report, "  {wn}");
        }
    }
    write(&o.debug.join("report.txt"), &report)?;
    println!(
        "worldgen 完成（{:.1}s）：陆地 {:.1}%，河流 {} 条，地标 {} 处，警告 {} 条；调试大图与报告在 {}",
        started.elapsed().as_secs_f64(),
        100.0 * land as f64 / (w * h) as f64,
        rivers.len(),
        l.landmark.len(),
        warns.len(),
        o.debug.display()
    );
    for wn in &warns {
        println!("  警告：{wn}");
    }
    if !problems.is_empty() {
        bail!("生成的图层没有通过自检：\n  {}", problems.join("\n  "));
    }
    Ok(())
}
