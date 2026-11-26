//! H07 截图用的真实数据：在真实寰宇里摆一个“里斯本外海、有领航员、大西洋已探明”的局面，用内核与应用层视图算出
//! 航线预览（多站、几种偏好）与十二个月的季风历，写成 JSON，交给 `tools/ui-shots/screens/routing.tsx` 当 IPC 的回复。
//! 截图里的数字因此都是内核算的，不是手写的。
//!
//! `cargo run --release --locked --offline -p manifest-appcore --example routing_shots -- <输出目录>`
//! （截图约定的目录是 `local-release/h07/data`，不入库）
use base64::Engine;
use manifest_appcore::{routing_view, views::Ctx};
use manifest_core::mates::{MateRole, RoleTarget};
use manifest_core::navigation::routing::{NAVIGATOR_ROLE, RoutePref};
use manifest_core::navigation::{ManualVoyage, Sail};
use manifest_core::world::{FleetLocation, Voyage};
use manifest_core::{Cell, LocId, OwnerId, ScenarioId, World};
use serde_json::{Value, json};
use std::path::Path;
use std::sync::Arc;

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

fn write(path: &Path, value: &Value) -> Result<()> {
    std::fs::write(path, serde_json::to_vec_pretty(value)?)?;
    Ok(())
}

fn main() -> Result<()> {
    let out = std::env::args().nth(1).ok_or("需要输出目录")?;
    let out = Path::new(&out);
    std::fs::create_dir_all(out)?;
    let root = manifest_data::find_data_dir().ok_or("找不到数据目录")?;
    let defs = manifest_data::load_world(&root, "terra16")?;
    let scenario = defs.scenarios.iter().position(|s| s.key == "free_1557").ok_or("没有自由航海剧本")?;
    let mut w = World::new(Arc::clone(&defs), ScenarioId::from_idx(scenario), 7)?;
    let port = |key: &str| defs.locations.iter().position(|l| l.key == key).map(LocId::from_idx).ok_or(key.to_string());
    let (lisbon, salvador, havana) = (port("lisbon")?, port("salvador")?, port("havana")?);
    // 大西洋（西经 100° 到东经 20°、北纬 50° 到南纬 30°）已探明
    let (width, height) = (defs.map.width, defs.map.height);
    for y in 0..height {
        for x in 0..width {
            let (lon, lat) = (-180 + i32::from(x) / 3, 72 - i32::from(y) / 3);
            if (-100..=20).contains(&lon) && (-30..=50).contains(&lat) {
                let i = defs.map.idx(Cell::new(x, y));
                w.state.explore.cells[i / 64] |= 1 << (i % 64);
            }
        }
    }
    // 出发在七月（寰宇的一年从一月一日起；剧本开局的日子往后挪到七月一日）
    while defs.nav.grid.period_on(w.day()) != 6 {
        w.state.day += 1;
    }
    let id = w.fleets_of(OwnerId::Player).next().ok_or("没有玩家舰队")?.id;
    // 领航员
    let role = defs.captain.roles.iter().position(|r| r.key == NAVIGATOR_ROLE).ok_or("没有领航员岗位")? as u16;
    let mate = w.state.mates.iter_mut().find(|(_, m)| m.owner.is_none()).ok_or("没有可雇的航海士")?.1;
    mate.owner = Some(OwnerId::Player);
    mate.role = MateRole::Assigned { role, target: RoleTarget::Fleet(id) };
    // 舰队在里斯本外海三格、刚出港
    let start = defs.loc(lisbon).cell;
    let sea = (1..12)
        .map(|d| Cell::new(start.x.saturating_sub(d), start.y))
        .find(|c| defs.map.is_sea_in_bounds(*c))
        .ok_or("里斯本西边没有海")?;
    let mut manual = ManualVoyage::new(sea, 250);
    manual.sail = Sail::Full;
    let f = w.fleet_mut(id)?;
    f.location = FleetLocation::AtSea(Voyage::Manual { manual });
    f.food = 60;
    f.water = 120;
    let ctx = Ctx::plain(&defs);
    for (name, stops, pref) in [
        ("plan_havana_fastest", vec![havana], Some(RoutePref::Fastest)),
        ("plan_havana_distance", vec![havana], Some(RoutePref::Distance)),
        ("plan_havana_safe", vec![havana], Some(RoutePref::Safe)),
        ("plan_havana_coastal", vec![havana], Some(RoutePref::Coastal)),
        ("plan_salvador_havana_fastest", vec![salvador, havana], Some(RoutePref::Fastest)),
        ("plan_salvador_havana_safe", vec![salvador, havana], Some(RoutePref::Safe)),
    ] {
        let v = routing_view::route_plan(ctx, &w, id, &stops, pref)?;
        eprintln!("{name}: 全程约 {} 天，{} 段", v["days"], v["legs"].as_array().map_or(0, Vec::len));
        write(&out.join(format!("{name}.json")), &v)?;
    }
    for month in 1..=12u8 {
        let v = routing_view::monsoon(&w, Some(month));
        write(&out.join(format!("monsoon_{month}.json")), &v)?;
    }
    // 迷雾位图（与 fog_delta 同样的写法：按行优先、每字节 8 格、低位在前）
    let mut bytes = Vec::with_capacity(w.state.explore.cells.len() * 8);
    for word in &w.state.explore.cells {
        bytes.extend_from_slice(&word.to_le_bytes());
    }
    bytes.truncate((usize::from(width) * usize::from(height)).div_ceil(8));
    let meta = json!({
        "fleet": {"x": sea.x, "y": sea.y},
        // 内核的地点编号 → 键（截图页的地点表按 anchors.toml 另编号，靠键对上）
        "ids": {lisbon.0.to_string(): "lisbon", salvador.0.to_string(): "salvador", havana.0.to_string(): "havana"},
        "day": w.day(),
        "fog": base64::engine::general_purpose::STANDARD.encode(&bytes),
    });
    write(&out.join("meta.json"), &meta)?;
    eprintln!("写到了 {}", out.display());
    Ok(())
}
