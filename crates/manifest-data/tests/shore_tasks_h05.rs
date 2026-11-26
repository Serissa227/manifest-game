//! H05 岸与锚地在真实寰宇数据上：细河流进了内核、开关打开；沿岸的锚地按地貌与河流分出能做、做不了的差事；
//! 测试世界（testbed）开关关着、没有细河流。不调用网络，只读已提交的 `data/`。

use manifest_core::geo::Biome;
use manifest_core::nav::Terrain;
use manifest_core::navigation::{ManualVoyage, Sail};
use manifest_core::seafaring::{ShoreBlock, ShoreTask};
use manifest_core::world::{FleetLocation, Voyage};
use manifest_core::{Cell, OwnerId, ScenarioId, StaticData, World};
use std::collections::BTreeMap;
use std::sync::{Arc, OnceLock};

fn root() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data")
}

fn terra() -> Arc<StaticData> {
    static DEFS: OnceLock<Arc<StaticData>> = OnceLock::new();
    DEFS.get_or_init(|| manifest_data::load_world(&root(), "terra16").expect("真实寰宇完整加载")).clone()
}

/// 沿岸的海格（离陆地 1 格以内、可航行），按下标抽样。
fn coastal(defs: &StaticData, every: usize) -> Vec<Cell> {
    let map = &defs.map;
    (0..map.terrain.len())
        .filter(|i| map.terrain[*i] != Terrain::Land)
        .map(|i| map.cell_of(i))
        .filter(|c| {
            (0..8u8).any(|d| map.topology().neighbor(*c, d).is_some_and(|n| map.terrain[map.idx(n)] == Terrain::Land))
        })
        .step_by(every)
        .collect()
}

#[test]
fn terra16_turns_shore_tasks_on_and_loads_the_fine_rivers() {
    let defs = terra();
    assert!(defs.rules.shore_tasks.enabled);
    let rivers = &defs.geography.fine_rivers;
    assert!(rivers.len() > 5_000, "细河流经过的粗格：{}", rivers.len());
    assert!(rivers.windows(2).all(|w| w[0] < w[1]), "升序、不重复");
    assert!(rivers.iter().all(|i| (*i as usize) < defs.map.terrain.len()));
    // 河大多在陆上
    let on_land = rivers.iter().filter(|i| defs.map.terrain[**i as usize] == Terrain::Land).count();
    assert!(on_land * 10 > rivers.len() * 8, "陆上 {on_land} / {}", rivers.len());
}

#[test]
fn testbed_has_no_shore_tasks_and_no_fine_rivers() {
    let defs = manifest_data::load_world(&root(), "testbed").expect("测试世界");
    assert!(!defs.rules.shore_tasks.enabled);
    assert!(defs.geography.fine_rivers.is_empty());
}

#[test]
fn terra16_anchorages_split_by_biome_and_river() {
    let defs = terra();
    let scenario = defs.scenarios.iter().position(|s| s.key == "free_1557").expect("自由航海剧本");
    let mut w = World::new(defs.clone(), ScenarioId::from_idx(scenario), 7).expect("寰宇新世界");
    let id = w.flagship(OwnerId::Player).expect("旗舰队");
    // V01 的开局水量已达到汲水上限；地貌分类用空水舱核对，避免被 Full 遮住。
    w.fleet_mut(id).unwrap().water = 0;
    let mut tally: BTreeMap<(ShoreTask, Option<ShoreBlock>), usize> = BTreeMap::new();
    let mut river_days = Vec::new();
    for cell in coastal(&defs, 7) {
        let mut manual = ManualVoyage::new(cell, 0);
        manual.sail = Sail::Furled;
        w.fleet_mut(id).unwrap().location = FleetLocation::AtSea(Voyage::Manual { manual });
        let site = w.shore_site(cell);
        assert!(site.coast);
        for o in w.shore_options(id) {
            *tally.entry((o.task, o.block)).or_default() += 1;
            if o.task == ShoreTask::Water && o.block.is_none() {
                river_days.push((site.river, o.days));
            }
            // 地貌条件：荒漠、冰原采不到吃的；有林才能伐木
            if o.task == ShoreTask::Forage && o.block.is_none() {
                assert!(site.biomes.iter().any(|b| !matches!(b, Biome::Desert | Biome::IceSheet)), "{cell:?}");
            }
            if o.task == ShoreTask::Timber && o.block == Some(ShoreBlock::NoForest) {
                assert!(!site.biomes.iter().any(|b| matches!(b, Biome::Boreal | Biome::Broadleaf | Biome::Rainforest)));
            }
        }
    }
    let n = |task, block| tally.get(&(task, block)).copied().unwrap_or(0);
    // 寰宇的海岸各种地貌都有：每件差事都有能做的地方，也都有做不了的地方
    assert!(n(ShoreTask::Water, None) > 100, "{tally:?}");
    assert!(n(ShoreTask::Water, Some(ShoreBlock::NoFreshWater)) > 10, "{tally:?}");
    assert!(n(ShoreTask::Forage, None) > 100, "{tally:?}");
    assert!(n(ShoreTask::Forage, Some(ShoreBlock::NoForage)) > 10, "{tally:?}");
    assert!(n(ShoreTask::Timber, None) > 100, "{tally:?}");
    assert!(n(ShoreTask::Timber, Some(ShoreBlock::NoForest)) > 100, "{tally:?}");
    // 有河的锚地一天汲满，没河的两天；两种都不少
    assert!(river_days.iter().all(|(river, days)| *days == if *river { 1 } else { 2 }));
    assert!(river_days.iter().filter(|(r, _)| *r).count() > 50);
    assert!(river_days.iter().filter(|(r, _)| !*r).count() > 50);
    // 船底干净时倾船刮底用不着
    assert_eq!(n(ShoreTask::Careen, None), 0);
}
