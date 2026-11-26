//! 西幻扩展的数据层：可选文件（world/overseas.toml、colony.toml、world/discoveries.toml）、新字段与校验、
//! 地点编号顺序，以及合成的 400×170 大地图上的加载（航线表在进程内共享）。

use manifest_core::defs::{BuildingKind, DiscoveryKind, LocKind, SiteTerrain};
use manifest_core::ids::Cell;
use std::path::{Path, PathBuf};
use std::time::Instant;

/// 待写入的文件：（相对路径, 内容, 是否追加）。
type Files<'a> = Vec<(&'a str, String, bool)>;

fn data_dir() -> PathBuf {
    manifest_data::find_data_dir().expect("找到 data/")
}

fn copy_dir(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for e in std::fs::read_dir(from).unwrap() {
        let e = e.unwrap();
        let p = e.path();
        let dest = to.join(e.file_name());
        if p.is_dir() {
            copy_dir(&p, &dest);
        } else {
            std::fs::copy(&p, &dest).unwrap();
        }
    }
}

fn path_of(root: &Path, rel: &str) -> PathBuf {
    rel.split('/').fold(root.to_path_buf(), |p, part| p.join(part))
}

/// 基础世界地图上几处可用作殖民点或海外港口的海格：与陆地相邻、与港口连通、不与已有地点重合。
fn free_coast_cells(n: usize) -> Vec<Cell> {
    let defs = base_defs();
    let map = &defs.map;
    let reach = defs.nav.grid.reachable_from(defs.loc(manifest_core::ids::LocId(0)).cell);
    let used: Vec<Cell> = defs.locations.iter().map(|l| l.cell).collect();
    let mut out = Vec::new();
    for y in (2..map.height).step_by(7) {
        for x in (2..map.width).step_by(5) {
            let c = Cell::new(x, y);
            if map.is_sea(c) && map.touches_land(c) && reach[map.idx(c)] && !used.contains(&c) {
                out.push(c);
                if out.len() == n {
                    return out;
                }
            }
        }
    }
    out
}

/// 一处合法的殖民点。
fn site(key: &str, c: Cell, extra: &str) -> String {
    format!(
        "\n[[sites]]\nkey = \"{key}\"\nname = \"测试殖民点\"\npos = [{}, {}]\nterrain = \"forest\"\nfertility = 60\nhazard = 30\nresources = [ {{ good = \"timber\", richness = 70 }} ]\n{extra}\n",
        c.x, c.y
    )
}

/// 复制一份 data/ 并写入（或追加到）若干文件，加载后返回结果。
/// 基础世界：正式数据去掉扩展内容（海外地点、发现物、殖民建筑与从海外出发的剧本），
/// 测试在它之上写入自己的扩展文件。
fn base_copy(dst: &Path) {
    copy_dir(&data_dir(), dst);
    manifest_data::bench::strip_expansion(dst).unwrap();
}

/// 基础世界的静态数据（进程内只加载一次）。
fn base_defs() -> std::sync::Arc<manifest_core::StaticData> {
    static BASE: std::sync::OnceLock<std::sync::Arc<manifest_core::StaticData>> = std::sync::OnceLock::new();
    BASE.get_or_init(|| {
        let tmp = tempfile::tempdir().unwrap();
        base_copy(tmp.path());
        manifest_data::load(tmp.path()).unwrap_or_else(|e| panic!("{e}"))
    })
    .clone()
}

fn load_with(files: &[(&str, &str, bool)]) -> Result<std::sync::Arc<manifest_core::StaticData>, String> {
    let tmp = tempfile::tempdir().unwrap();
    base_copy(tmp.path());
    for (rel, text, append) in files {
        let p = path_of(tmp.path(), rel);
        let mut body = if *append { std::fs::read_to_string(&p).unwrap_or_default() } else { String::new() };
        body.push_str(text);
        std::fs::write(&p, body).unwrap();
    }
    manifest_data::load(tmp.path()).map_err(|e| e.to_string())
}

/// 对某个文件做一次精确替换后加载，返回错误文本。
fn corrupt(rel: &str, from: &str, to: &str, extra: &[(&str, &str, bool)]) -> String {
    let tmp = tempfile::tempdir().unwrap();
    base_copy(tmp.path());
    for (r, text, append) in extra {
        let p = path_of(tmp.path(), r);
        let mut body = if *append { std::fs::read_to_string(&p).unwrap_or_default() } else { String::new() };
        body.push_str(text);
        std::fs::write(&p, body).unwrap();
    }
    let p = path_of(tmp.path(), rel);
    let text = std::fs::read_to_string(&p).unwrap();
    assert!(text.contains(from), "样例替换目标“{from}”不在 {rel} 中");
    std::fs::write(&p, text.replacen(from, to, 1)).unwrap();
    match manifest_data::load(tmp.path()) {
        Ok(_) => panic!("损坏的数据（{rel}：{from} → {to}）应被拒绝"),
        Err(e) => e.to_string(),
    }
}

#[test]
fn world_config_is_read_from_rules() {
    let defs = manifest_data::load_shared(&data_dir()).unwrap();
    let w = &defs.rules.world;
    assert_eq!((w.currency.as_str(), w.era.as_str(), w.start_year), ("金币", "航海历", 1502));
    assert_eq!(w.legacy_map, (240, 120));
    assert_eq!(w.calendar_year(1), 1502);
    assert!(!defs.rules.colony.found_materials.is_empty());
    assert!(defs.food_goods().count() >= 1, "rules.colony.food_category 对应的粮食类商品");
    assert_eq!(defs.rules.discovery.mate_fame(3), 0);
    assert_eq!(defs.rules.discovery.mate_fame(5), 40);
    // 同一目录只加载一次
    let again = manifest_data::load_shared(&data_dir()).unwrap();
    assert!(std::sync::Arc::ptr_eq(&defs, &again), "进程内共享同一份静态数据");
}

#[test]
fn optional_expansion_files_append_locations_after_cities() {
    let base = base_defs();
    let cells = free_coast_cells(3);
    assert_eq!(cells.len(), 3);
    let overseas = format!(
        "[[ports]]\nkey = \"far_haven\"\nname = \"远港\"\npos = [{}, {}]\nfaction = \"cuilan\"\ndevelopment = 20\nfounded = 1478\nlore = \"最早的殖民港。\"\nmarket = [ {{ good = \"grain\", supply = 10, demand = 10 }} ]\n{}{}",
        cells[0].x,
        cells[0].y,
        site("north_cove", cells[1], ""),
        site("south_cove", cells[2], "lore = \"雾中的河口。\""),
    );
    let colony = manifest_data::bench::SYNTHETIC_BUILDINGS;
    let discoveries = "[[discoveries]]\nkey = \"old_gate\"\nname = \"古门\"\npos = [3, 3]\nkind = \"ruins\"\nfame = 30\nvalue = 4000\nlore = \"……\"\n";
    let defs = load_with(&[
        ("world/overseas.toml", &overseas, false),
        ("colony.toml", colony, false),
        ("world/discoveries.toml", discoveries, false),
    ])
    .unwrap_or_else(|e| panic!("{e}"));
    let n = base.locations.len();
    assert_eq!(defs.locations.len(), n + 3);
    for (i, l) in base.locations.iter().enumerate() {
        assert_eq!(defs.locations[i].key, l.key, "旧地点的编号不变");
    }
    let port = &defs.locations[n];
    assert_eq!((port.key.as_str(), port.kind, port.founded), ("far_haven", LocKind::Port, Some(1478)));
    let s = &defs.locations[n + 1];
    assert_eq!((s.key.as_str(), s.kind), ("north_cove", LocKind::Site));
    let info = s.site.as_ref().unwrap();
    assert_eq!((info.terrain, info.fertility, info.hazard), (SiteTerrain::Forest, 60, 30));
    assert_eq!(defs.locations[n + 2].lore, "雾中的河口。");
    assert!(defs.nav.path(0, manifest_core::ids::LocId(0), manifest_core::ids::LocId(n as u16)).is_some());
    assert!(
        defs.nav.path(0, manifest_core::ids::LocId(0), manifest_core::ids::LocId(n as u16 + 1)).is_none(),
        "殖民点不进预计算航线表"
    );
    assert_eq!(defs.colony_buildings.len(), 14);
    assert_eq!(defs.colony_buildings[0].key, "farm");
    assert_eq!(defs.colony_buildings[13].kind, BuildingKind::Housing);
    assert_eq!(defs.discoveries[0].kind, DiscoveryKind::Ruins);
    assert_eq!(defs.meta.keys.colony_buildings.len(), 14);
    assert_eq!(defs.meta.keys.discoveries, vec!["old_gate".to_string()]);
}

#[test]
fn expansion_data_errors_are_readable() {
    let cells = free_coast_cells(2);
    let ok_site = site("fine_cove", cells[0], "");
    let with = |text: String| vec![("world/overseas.toml", text, false)];
    let base = base_defs();
    let port_cell = base.loc(base.find_loc("chenggang").unwrap()).cell;
    // 地图上按行扫描的第一个陆格（地图重做后左上角不一定是陆地）
    let land = (0..base.map.terrain.len()).map(|i| base.map.cell_of(i)).find(|c| !base.map.is_sea(*c)).unwrap();
    let cases: Vec<(Files, &[&str])> = vec![
        (with(site("sunk", land, "")), &["overseas.toml", "sites[sunk]", "必须是海格"]),
        (with(site("on_port", port_cell, "")), &["sites[on_port]", "重合", "chenggang"]),
        (with(ok_site.replace("forest", "lava")), &["sites[fine_cove]", "terrain", "lava"]),
        (with(ok_site.replace("fertility = 60", "fertility = 0")), &["sites[fine_cove]", "fertility"]),
        (with(ok_site.replace("\"timber\"", "\"unobtainium\"")), &["sites[fine_cove]", "unobtainium", "商品"]),
        (with(site("chenggang", cells[1], "")), &["key 重复"]),
        (
            with(format!("[[ports]]\nkey = \"dry_port\"\nname = \"旱港\"\npos = [{}, {}]\nfaction = \"cuilan\"\ndevelopment = 10\nmarket = []\n", land.x, land.y)),
            &["overseas.toml", "ports[dry_port]", "必须是海格"],
        ),
        (
            vec![("colony.toml", "[[buildings]]\nkey = \"farm\"\nname = \"农庄\"\nkind = \"orchard\"\ncost = 1\nbuild_days = 1\nmax_level = 1\n".into(), false)],
            &["colony.toml", "buildings[farm]", "orchard"],
        ),
        (
            vec![("colony.toml", "[[buildings]]\nkey = \"farm\"\nname = \"农庄\"\nkind = \"food\"\ncost = 1\nbuild_days = 1\nmax_level = 1\n".into(), false)],
            &["buildings[farm]", "goods"],
        ),
        (
            vec![("colony.toml", "[[buildings]]\nkey = \"storehouse\"\nname = \"仓棚\"\nkind = \"storage\"\ncost = 1\nbuild_days = 1\nmax_level = 1\n".into(), false)],
            &["buildings[storehouse]", "capacity"],
        ),
        (
            vec![("colony.toml", "[[buildings]]\nkey = \"mill\"\nname = \"坊\"\nkind = \"process\"\ncost = 1\nbuild_days = 1\nmax_level = 1\noutputs = [ { good = \"sugar\", qty = 1 } ]\n".into(), false)],
            &["buildings[mill]", "inputs"],
        ),
        (
            vec![("world/discoveries.toml", "[[discoveries]]\nkey = \"far\"\nname = \"远\"\npos = [9999, 3]\nkind = \"ruins\"\nfame = 1\nvalue = 1\n".into(), false)],
            &["discoveries.toml", "discoveries[far]", "超出地图范围"],
        ),
        (
            vec![("world/discoveries.toml", "[[discoveries]]\nkey = \"odd\"\nname = \"怪\"\npos = [3, 3]\nkind = \"ghost\"\nfame = 1\nvalue = 1\n".into(), false)],
            &["discoveries[odd]", "ghost"],
        ),
    ];
    for (files, needles) in &cases {
        let files: Vec<(&str, &str, bool)> = files.iter().map(|(r, t, a)| (*r, t.as_str(), *a)).collect();
        let msg = match load_with(&files) {
            Ok(_) => panic!("应被拒绝：{files:?}"),
            Err(e) => e,
        };
        for needle in *needles {
            assert!(msg.contains(needle), "错误信息应包含“{needle}”：\n{msg}");
        }
    }
    // 对现有文件的替换
    let replace_cases: &[(&str, &str, &str, &[&str])] = &[
        (
            "factions.toml",
            "marque_price = 15000",
            "marque_price = 15000\nstyle = \"gothic\"",
            &["factions.toml", "gothic", "style"],
        ),
        ("factions.toml", "marque_price = 15000", "marque_price = 15000\ncolor = \"red\"", &["factions.toml", "color"]),
        (
            "rules.toml",
            "{ good = \"timber\", qty = 40 }",
            "{ good = \"unobtainium\", qty = 40 }",
            &["rules.toml", "colony.found_materials", "unobtainium"],
        ),
        ("rules.toml", "start_year = 1502", "start_year = 0", &["rules.toml", "world.start_year"]),
        ("rules.toml", "food_category = \"粮食\"", "food_category = \"口粮\"", &["rules.toml", "colony.food_category"]),
        (
            "scenarios/01_newcomer.toml",
            "kind = \"net_worth\"",
            "kind = \"colonies\"",
            &["01_newcomer.toml", "goal.kind"],
        ),
        ("goods.toml", "tier = 0", "tier = 0\ndescription = 5", &["goods.toml"]),
    ];
    for (rel, from, to, needles) in replace_cases {
        let msg = corrupt(rel, from, to, &[]);
        for needle in *needles {
            assert!(msg.contains(needle), "错误信息应包含“{needle}”：\n{msg}");
        }
    }
    // 道路不能连接殖民点
    let ok_site_text = site("road_end", cells[0], "");
    let msg = corrupt(
        "world/roads.toml",
        "from = \"lancheng\"",
        "from = \"road_end\"",
        &[("world/overseas.toml", ok_site_text.as_str(), false)],
    );
    assert!(msg.contains("殖民点"), "{msg}");
}

/// 合成大地图：基础世界的地图位于左上角（至少扩到 400×170），追加外洋、新大陆、群岛、
/// 14 个海外港口、40 个殖民点与 24 个发现物。
#[test]
fn synthetic_400x170_world_loads_quickly_and_keeps_old_ids() {
    let tmp = tempfile::tempdir().unwrap();
    manifest_data::bench::write_synthetic_world(&data_dir(), tmp.path(), Default::default()).unwrap();
    let started = Instant::now();
    let defs = manifest_data::load(tmp.path()).unwrap_or_else(|e| panic!("{e}"));
    let cold = started.elapsed();
    let started = Instant::now();
    let again = manifest_data::load(tmp.path()).unwrap();
    let warm = started.elapsed();
    let ports = defs.port_ids().count();
    println!(
        "[性能] 合成地图 {}×{}，港口 {ports}，殖民点 {}：首次加载 {:.0} ms，再次加载（航线表已缓存）{:.0} ms",
        defs.map.width,
        defs.map.height,
        defs.site_ids().count(),
        cold.as_secs_f64() * 1000.0,
        warm.as_secs_f64() * 1000.0
    );
    assert!(std::sync::Arc::ptr_eq(&defs.nav, &again.nav), "同一张地图的航线表在进程内共享");
    let base = base_defs();
    // 合成器在基础地图右侧至少加 60 列、下方至少加 20 行，且不小于 400×170
    let expect = ((base.map.width + 60).max(400), (base.map.height + 20).max(170));
    assert_eq!((defs.map.width, defs.map.height), expect);
    for (i, l) in base.locations.iter().enumerate() {
        assert_eq!(defs.locations[i].key, l.key, "旧地点的编号不变");
        assert_eq!(defs.locations[i].cell, l.cell, "旧坐标不变");
    }
    assert_eq!(ports, base.port_ids().count() + 14);
    assert_eq!(defs.site_ids().count(), 40);
    assert_eq!(defs.discoveries.len(), 24);
    // 新旧港口互相可达；殖民点实时寻路可达
    let old = base.port_ids().next().unwrap();
    let new_port = defs.port_ids().last().unwrap();
    assert!(defs.nav.path(0, old, new_port).is_some() && defs.nav.path(3, new_port, old).is_some());
    let site = defs.site_ids().last().unwrap();
    let p =
        defs.nav.find_path(&defs.map, &defs.regions, 0, defs.loc(old).cell, defs.loc(site).cell).expect("殖民点可达");
    assert_eq!(p.cells.last(), Some(&defs.loc(site).cell));
    // 大地图上运行一段模拟
    let mut w = manifest_core::World::new(defs.clone(), manifest_core::ScenarioId(0), 5).unwrap();
    for _ in 0..30 {
        w.end_day().unwrap();
    }
    manifest_core::testkit::check_invariants(&w).unwrap();
    assert_eq!((w.state.explore.width, w.state.explore.height), expect);
}

/// 正式数据就是扩展后的世界：400×170 地图，海外港口与殖民点排在城市之后，
/// 内容量达到 EXPANSION.md 的要求，每个殖民点都能从旧世界航行抵达。
/// 旧地点按 EXPANSION §10.2 的规则：key、名称、种类与顺序不变；坐标可以为贴合新海岸而移动，
/// 但旧世界的地点仍在左上的旧尺寸内，停泊格合法，全部港口四季互相可达，裁回旧尺寸后仍互相可达。
#[test]
fn real_world_is_the_expanded_colonial_world() {
    let defs = manifest_data::load_shared(&data_dir()).unwrap();
    let base = base_defs();
    assert_eq!((defs.map.width, defs.map.height), (400, 170));
    let (lw, lh) = defs.rules.world.legacy_map;
    for (i, l) in base.locations.iter().enumerate() {
        let d = &defs.locations[i];
        assert_eq!(d.key, l.key, "旧地点的编号不变");
        assert_eq!((d.name.as_str(), d.kind), (l.name.as_str(), l.kind), "旧地点 {} 的名称与种类不变", l.key);
        assert!(d.cell.x < lw && d.cell.y < lh, "旧世界地点 {} {:?} 仍在左上 {lw}×{lh} 内", d.key, d.cell);
    }
    // 停泊格合法：港口与殖民点在与陆地相邻的海格，内陆城市在陆格
    for l in &defs.locations {
        if l.is_port() || l.is_site() {
            assert!(defs.map.is_sea(l.cell) && defs.map.touches_land(l.cell), "{} 的停泊格 {:?} 不合法", l.key, l.cell);
        } else {
            assert!(!defs.map.is_sea(l.cell), "内陆城市 {} {:?} 应在陆格", l.key, l.cell);
        }
    }
    // 全部港口四季互相可达；裁回旧尺寸的基础世界里旧港口同样互相可达（bench 的前提）
    let ports: Vec<_> = defs.port_ids().collect();
    for season in 0..4 {
        for &a in &ports {
            for &b in &ports {
                assert!(a == b || defs.nav.path(season, a, b).is_some(), "季节 {season}：{a:?} → {b:?} 没有航线");
            }
        }
    }
    let old_ports: Vec<_> = base.port_ids().collect();
    assert!(old_ports.len() >= 20, "基础世界保留全部旧港口");
    for &a in &old_ports {
        for &b in &old_ports {
            assert!(a == b || base.nav.path(0, a, b).is_some(), "裁剪后 {a:?} → {b:?} 没有航线");
        }
    }
    assert!(defs.port_ids().count() >= base.port_ids().count() + 10, "海外港口至少 10 个");
    assert!(defs.site_ids().count() >= 32, "可殖民地点至少 32 个");
    assert!(defs.discoveries.len() >= 24, "发现物至少 24 个");
    assert_eq!(defs.colony_buildings.len(), 14, "殖民建筑 14 种");
    assert!(defs.goods.len() >= 71 && defs.ships.len() >= 19, "商品 ≥ 71、船型 ≥ 19");
    let reach = defs.nav.grid.reachable_from(defs.loc(manifest_core::ids::LocId(0)).cell);
    for s in defs.site_ids() {
        let l = defs.loc(s);
        assert!(reach[defs.map.idx(l.cell)], "殖民点 {} 应能从旧世界航行抵达", l.key);
    }
}
