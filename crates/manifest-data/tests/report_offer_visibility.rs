//! 行情通报只卖玩家已经知道的港口：隐藏未知港口的世界（寰宇）里，告示板上没望见过的港口不出现、不计价；
//! 港口都可见的世界（经典、测试海域的缺省设置）照旧全部列出。
use manifest_core::{
    LocId, ScenarioId, StaticData, World,
    info::{InfoSource, Snapshot},
};
use std::sync::Arc;

fn world(hide: bool) -> World {
    let mut defs: StaticData =
        (*manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap()).clone();
    defs.manual_navigation = hide;
    defs.navigation.hide_unknown_ports = hide;
    let i = defs.scenarios.iter().position(|s| s.key == "sandbox").unwrap();
    World::new(Arc::new(defs), ScenarioId::from_idx(i), 42).unwrap()
}

fn post(w: &mut World, at: LocId, about: LocId) {
    let day = w.state.day + 1;
    w.state.locations[at.idx()].board.insert(
        about,
        Snapshot { loc: about, day, source: InfoSource::Ship, goods: Vec::new(), condition: Default::default() },
    );
}

#[test]
fn report_offer_lists_only_visible_ports_when_unknown_ports_are_hidden() {
    let (here, there) = (LocId(0), LocId(1));
    let mut open = world(false);
    post(&mut open, here, there);
    assert_eq!(open.report_offer(here).0, vec![there]);
    let mut hidden = world(true);
    // 开局的见识（到访、望见、揭开的海图）全部清空：对岸港口成了没望见过的
    hidden.state.explore = Default::default();
    post(&mut hidden, here, there);
    assert!(!hidden.location_visible(there), "测试前提：对岸港口还没望见");
    assert_eq!(hidden.report_offer(here), (Vec::new(), 0));
    hidden.state.explore.sighted.insert(there);
    assert_eq!(hidden.report_offer(here).0, vec![there]);
}
