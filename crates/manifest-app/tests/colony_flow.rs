//! 西幻扩展的玩家流程：直接调用处理函数（不启动窗口），走完
//! 开局 → 买建立物资 → 航行到殖民点（途中发现遗迹）→ 建立殖民地 → 建设 → 装卸 → 税率 → 达成目标 →
//! 回港报告发现 → 存档 → 读档。命令一律以界面发送的 JSON 形式构造。
//!
//! 数据用真实 data/ 的临时副本，追加一个殖民点、一个发现物、殖民地建筑与一个殖民剧本（只在临时目录中）。

use manifest_ai::{AiMode, MemoryKeyStore};
use manifest_app::handlers;
use manifest_app::views::Overview;
use manifest_app::{AppPaths, AppState};
use manifest_core::Command;
use manifest_core::ids::Cell;
use serde_json::json;
use std::path::Path;
use std::sync::Arc;

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

/// 离开局港 8–14 格、与陆地相邻、可达的海格（作为殖民点），以及再往外 2 格的发现物位置。
fn site_and_discovery(start: &str) -> (Cell, Cell) {
    let defs = manifest_data::load_shared(&manifest_data::find_data_dir().unwrap()).unwrap();
    let from = defs.loc(defs.find_loc(start).unwrap()).cell;
    let map = &defs.map;
    let reach = defs.nav.grid.reachable_from(from);
    let used: Vec<Cell> = defs.locations.iter().map(|l| l.cell).collect();
    let mut best: Option<(i64, Cell)> = None;
    for y in 0..map.height {
        for x in 0..map.width {
            let c = Cell::new(x, y);
            let (dx, dy) = (x as i64 - from.x as i64, y as i64 - from.y as i64);
            let d2 = dx * dx + dy * dy;
            if (64..=196).contains(&d2)
                && map.is_sea(c)
                && map.touches_land(c)
                && reach[map.idx(c)]
                && !used.contains(&c)
                && best.is_none_or(|(b, _)| d2 < b)
            {
                best = Some((d2, c));
            }
        }
    }
    let site = best.expect("开局港附近有可用的海岸").1;
    let step = |v: u16, o: u16, max: u16| -> u16 {
        let d = (v as i64 - o as i64).signum() * 2;
        (v as i64 + d).clamp(0, max as i64 - 1) as u16
    };
    (site, Cell::new(step(site.x, from.x, map.width), step(site.y, from.y, map.height)))
}

fn data_with_colony_content(dir: &Path) {
    copy_dir(&manifest_data::find_data_dir().unwrap(), dir);
    let (site, disc) = site_and_discovery("chenggang");
    let world = dir.join("world");
    // 下面把正式的海外内容换成一个测试用殖民点：先去掉在海外港口酒馆等待招募的航海士（英雄扩充的新航海士有一部分在海外港口）
    // 与海外港口的城镇工坊（第八批 E4）
    manifest_data::bench::strip_overseas_mates(dir).unwrap();
    manifest_data::bench::strip_overseas_workshops(dir).unwrap();
    // 剧情事件（推荐角色的故事线与奇遇）引用正式的海外港口与发现物，这个流程与它们无关，一并去掉
    manifest_data::bench::strip_stories(dir).unwrap();
    std::fs::write(
        world.join("overseas.toml"),
        format!(
            "[[sites]]\nkey = \"dawn_cove\"\nname = \"晨星湾\"\npos = [{}, {}]\nterrain = \"forest\"\nfertility = 70\nhazard = 20\nresources = [ {{ good = \"timber\", richness = 80 }}, {{ good = \"fur\", richness = 40 }} ]\nlore = \"测试用殖民点\"\n",
            site.x, site.y
        ),
    )
    .unwrap();
    std::fs::write(
        world.join("discoveries.toml"),
        format!(
            "[[discoveries]]\nkey = \"drowned_gate\"\nname = \"沉没之门\"\npos = [{}, {}]\nkind = \"ruins\"\nfame = 30\nvalue = 4000\nlore = \"测试用发现物\"\n",
            disc.x, disc.y
        ),
    )
    .unwrap();
    // 正式的地标（landmarks.toml）引用正式的发现物；这里换成了测试自己的发现物，地标一并去掉
    std::fs::remove_file(world.join("landmarks.toml")).ok();
    std::fs::write(dir.join("colony.toml"), manifest_data::bench::SYNTHETIC_BUILDINGS).unwrap();
    std::fs::write(
        dir.join("scenarios").join("04_colonist.toml"),
        "key = \"colonist\"\nname = \"开拓者\"\ndescription = \"测试剧本\"\nstart = \"chenggang\"\ncash = 60000\nships = [\"tradewind\"]\ncrew = 40\nmates = []\n\n[goal]\nkind = \"colonies\"\ntarget = 1\npopulation = 20\nyears = 10\n",
    )
    .unwrap();
    // 关闭海盗舰队，让航程与货物不受遭遇战影响（殖民地袭击另算）
    let rules = dir.join("rules.toml");
    let text = std::fs::read_to_string(&rules).unwrap();
    assert!(text.contains("spawn_scale = 8"), "rules.toml 中应有海盗出现系数");
    std::fs::write(&rules, text.replacen("spawn_scale = 8", "spawn_scale = 0", 1)).unwrap();
    // 同理关闭风暴：风暴会随机损失 0–10% 的货物，航线经过哪些海区、走几天取决于地图（EXPANSION §10 重做了地理）
    let regions = world.join("regions.toml");
    let text = std::fs::read_to_string(&regions).unwrap();
    let calm: Vec<String> =
        text.lines()
            .map(|l| {
                l.split(", ")
                    .map(|part| {
                        if part.trim_start().starts_with("storm = ") {
                            "storm = 0".to_string()
                        } else {
                            part.to_string()
                        }
                    })
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .collect();
    assert!(calm.iter().filter(|l| l.contains("storm = 0,")).count() >= 4 * 23, "每个海区四季的风暴概率都应被关闭");
    std::fs::write(&regions, calm.join("\n")).unwrap();
}

fn cmd(v: serde_json::Value) -> Command {
    serde_json::from_value(v.clone()).unwrap_or_else(|e| panic!("命令 JSON 无法解析：{e}\n{v}"))
}

fn submit(st: &AppState, v: serde_json::Value) -> handlers::SubmitResult {
    handlers::submit(st, cmd(v.clone())).unwrap_or_else(|e| panic!("命令被拒绝：{e}\n{v}"))
}

fn sail_to(st: &AppState, fleet: u32, dest: u16) -> Overview {
    submit(st, json!({"SetSail": {"owner": "player", "fleet": fleet, "dest": dest}}));
    for _ in 0..40 {
        let o = handlers::step(st, 1).unwrap();
        if o.fleets.iter().any(|f| f.id == fleet && f.docked == Some(dest)) {
            return o;
        }
    }
    panic!("40 天内没有抵达 {dest}");
}

#[test]
fn colony_and_discovery_flow_through_handlers() {
    let tmp = tempfile::tempdir().unwrap();
    let data = tmp.path().join("data");
    data_with_colony_content(&data);
    let st = AppState::from_data_dir(&data, Arc::new(MemoryKeyStore::default()), AppPaths::in_dir(tmp.path())).unwrap();
    let mut settings = handlers::get_settings(&st).settings;
    settings.ai.mode = AiMode::Off;
    settings.autosave_days = 0;
    handlers::save_settings(&st, settings).unwrap();

    // ── 静态数据：世界配置、殖民点、建筑、发现物目录 ──
    let statics = handlers::static_data(&st);
    let v = serde_json::to_value(&statics).unwrap();
    assert_eq!(
        v["world"],
        json!({
            "currency": "金币", "era": "航海历", "start_year": 1502,
            "key": "classic", "name": "经典世界", "map_key": "classic",
            "modules": [],
            "languages": ["zh", "en"],
            "calendar": {
                "months": [30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
                "seasons": [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3],
                "month_names": []
            }
        })
    );
    let site = statics.locations.iter().find(|l| l.kind == "site").expect("殖民点").clone();
    assert_eq!(site.key, "dawn_cove");
    assert_eq!(v["locations"][site.id as usize]["site"]["terrain"], json!("forest"));
    assert_eq!(statics.colony_buildings.len(), 14);
    assert_eq!(statics.colony_buildings[0].key, "farm");
    assert_eq!(statics.discoveries.len(), 1);
    assert!(v["discoveries"][0].get("x").is_none(), "目录中不透露发现物的位置");
    assert!(!statics.rules.colony_found_materials.is_empty());
    let good = |key: &str| statics.goods.iter().find(|g| g.key == key).unwrap().id;
    let (timber, grain) = (good("timber"), good("grain"));

    // ── 开局 ──
    let o = handlers::new_game(&st, "colonist", Some(77)).unwrap();
    assert_eq!((o.calendar_year, o.fame, o.colonies.len()), (1502, 0, 0));
    let goal = o.goal.as_ref().unwrap();
    assert_eq!((goal.kind, goal.target, goal.population), ("colonies", 1, Some(20)));
    let fid = o.fleets[0].id;
    let start = o.fleets[0].docked.unwrap();
    let before = handlers::site(&st, site.id).unwrap();
    assert!(!before.known && !before.can_found);
    assert!(before.reason.as_deref().unwrap_or_default().contains("探明"));
    assert!(handlers::site(&st, start).is_err(), "港口不是殖民点");

    // ── 买建立物资，航行到殖民点 ──
    submit(&st, json!({"Buy": {"owner": "player", "fleet": fid, "good": timber, "qty": 50, "max_total": null}}));
    submit(&st, json!({"Buy": {"owner": "player", "fleet": fid, "good": grain, "qty": 90, "max_total": null}}));
    submit(&st, json!({"Resupply": {"owner": "player", "fleet": fid, "food": 20, "water": 20}}));
    let preview = handlers::sail_preview(&st, fid, site.id).unwrap().expect("殖民点可达");
    assert!(preview.days >= 1 && preview.path.last() == Some(&(site.x, site.y)));
    sail_to(&st, fid, site.id);

    // 途中视野覆盖到遗迹
    let d = handlers::discoveries(&st).unwrap();
    assert_eq!(d.total, 1);
    assert_eq!(d.found.len(), 1, "航行途中发现了遗迹");
    assert!(!d.found[0].reported && d.report_at.is_empty(), "殖民点不是港口，不能报告");
    assert!(handlers::overview(&st).unwrap().discoveries_unreported == 1);

    // ── 建立殖民地 ──
    let here = handlers::site(&st, site.id).unwrap();
    assert!(here.known && here.can_found, "{:?}", here.reason);
    assert_eq!(here.fleets_here, vec![(fid, None)]);
    assert!(here.producible.iter().any(|(_, g, p)| *g == timber && *p == 80));
    let out = submit(
        &st,
        json!({"FoundColony": {"owner": "player", "fleet": fid, "site": site.id, "name": "晨星港", "settlers": 20}}),
    );
    let colony = serde_json::to_value(&out.outcome).unwrap()["ColonyFounded"]["colony"].as_u64().unwrap() as u32;
    assert_eq!(out.overview.colonies.len(), 1);
    assert_eq!(out.overview.fame, 10);
    assert!(out.overview.site_claims.iter().any(|c| c.loc == site.id && c.colony == Some(colony) && c.mine));
    let cv = handlers::colonies(&st).unwrap();
    let c = &cv.colonies[0];
    assert_eq!((c.id, c.population, c.capacity), (colony, 20, 400));
    assert!(c.stock.iter().any(|l| l.good == timber && l.qty >= 20));
    let farm = c.build_options.iter().find(|b| statics.colony_buildings[b.building as usize].key == "farm").unwrap();
    assert!(farm.ok, "{:?}", farm.reason);
    let fort = c.build_options.iter().find(|b| statics.colony_buildings[b.building as usize].key == "fort").unwrap();
    assert!(!fort.ok && !fort.missing.is_empty(), "栅栏堡的建材不够");
    assert_eq!(cv.slots_left, statics.rules.colony_max - 1);
    // 界面不能替别的商号下殖民命令
    assert!(handlers::submit(&st, cmd(json!({"AbandonColony": {"owner": "c0", "colony": colony}}))).is_err());

    // ── 建设、装卸、税率 ──
    submit(&st, json!({"BuildColony": {"owner": "player", "colony": colony, "building": farm.building}}));
    submit(
        &st,
        json!({"Transfer": {"owner": "player", "from": {"Fleet": fid}, "to": {"Warehouse": site.id}, "good": grain, "qty": 30}}),
    );
    submit(&st, json!({"SetColonyTax": {"owner": "player", "colony": colony, "rate": 2}}));
    let o = handlers::step(&st, 1).unwrap();
    let outcome = o.outcome.as_ref().expect("殖民地目标达成");
    assert_eq!(outcome.kind, "Won");
    let o = handlers::step(&st, 25).unwrap();
    assert!(o.colonies[0].construction.is_none() && o.colonies[0].food_days > 0);
    let c = &handlers::colonies(&st).unwrap().colonies[0];
    assert_eq!(c.tax, 2);
    assert!(c.buildings.iter().any(|(b, l)| *b == farm.building && *l == 1), "农庄完工");
    assert!(c.estimates.iter().any(|e| e.outputs.iter().any(|(g, q)| *g == grain && *q > 0)));

    // ── 回港报告发现 ──
    let cash = handlers::overview(&st).unwrap().cash;
    sail_to(&st, fid, start);
    let out = submit(&st, json!({"ReportDiscovery": {"owner": "player", "discovery": 0, "loc": start}}));
    assert_eq!(serde_json::to_value(&out.outcome).unwrap(), json!({"DiscoveryReported": {"reward": 4000, "fame": 30}}));
    assert_eq!(out.overview.fame, 40);
    assert!(out.overview.cash > cash);
    assert_eq!(out.overview.discoveries_unreported, 0);
    assert!(handlers::discoveries(&st).unwrap().found[0].reported);
    let intel = handlers::intel(&st).unwrap();
    let kinds: Vec<&str> = intel.log.iter().map(|l| l.kind.as_str()).collect();
    for k in ["ColonyFounded", "ColonyBuilt", "Discovered", "DiscoveryReported"] {
        assert!(kinds.contains(&k), "情报日志应有 {k}：{kinds:?}");
    }
    let built = intel.log.iter().find(|l| l.kind == "ColonyBuilt").unwrap();
    assert!(built.args.iter().any(|(f, v)| f == "building" && v == "农庄"), "建筑名已解析：{:?}", built.args);

    // ── 存档与读档 ──
    handlers::save_game(&st, "colony").unwrap();
    let before = serde_json::to_value(handlers::colonies(&st).unwrap()).unwrap();
    let o = handlers::load_game(&st, "colony").unwrap();
    assert_eq!((o.fame, o.colonies.len()), (40, 1));
    assert_eq!(serde_json::to_value(handlers::colonies(&st).unwrap()).unwrap(), before);
    handlers::step(&st, 30).unwrap();
    assert!(handlers::debug(&st).unwrap().money_conserved);
}
