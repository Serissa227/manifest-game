//! S01：离线事件导演按事件类型的限定挑地点、海区与势力（寰宇的真实数据）。
//!
//! 事件类型可以限定只在某些地点、海区发生，或只针对某些势力（`events.toml` 的 locs / regions / factions）。
//! 离线导演挑出来的每一件都要落在限定之内、通过内核的事件校验；一千五百个“第 5 天”扫下来，每一种事件都被挑到过
//! （没有哪一种因为限定写得太死、永远挑不出参数）。经典世界的事件类型都不限定，导演的随机数消耗与原来相同，
//! 由经典的重放金样（`replay-check --ai mock`）守着。
use manifest_ai::offline;
use manifest_ai::resolve::resolve_event;
use manifest_core::World;
use std::collections::BTreeMap;

#[test]
fn the_offline_director_stays_inside_each_events_limits_and_reaches_every_type() {
    let root = manifest_data::find_data_dir().unwrap();
    let defs = manifest_data::load_world(&root, "terra16").unwrap();
    let content =
        manifest_data::ai_content::load_world_ai_content(&manifest_data::resolve_world(&root, "terra16").unwrap())
            .unwrap();
    let scenario = defs.find_scenario("free_1557").expect("自由航海剧本");
    let mut w = World::new(defs.clone(), scenario, 42).expect("开局预演");
    let start = w.day();
    let mut picked: BTreeMap<String, u32> = BTreeMap::new();
    let mut total = 0;
    for offset in 0..1_500u32 {
        // 只换日期取随机数（导演的随机数由种子与日期派生），不走日结：这里查的是“挑得对不对”，不是事件的后果。
        w.state.day = start + offset;
        let proposal = offline::director(&w, &content.templates);
        assert!(proposal.events.len() <= 3);
        for pick in &proposal.events {
            let (kind, params) = resolve_event(&defs, pick).unwrap_or_else(|e| panic!("{}：{e}", pick.event));
            let def = defs.event_type(kind);
            w.validate_event(kind, &params).unwrap_or_else(|e| panic!("{}：{params:?} 没过内核校验：{e}", def.key));
            if let Some(loc) = params.loc {
                assert!(
                    def.locs.is_empty() || def.locs.contains(&loc),
                    "{}：挑到了限定之外的 {}",
                    def.key,
                    defs.loc(loc).key
                );
            }
            if let Some(region) = params.region {
                assert!(def.regions.is_empty() || def.regions.contains(&region), "{}", def.key);
            }
            for faction in [params.faction_a, params.faction_b].into_iter().flatten() {
                assert!(def.factions.is_empty() || def.factions.contains(&faction), "{}", def.key);
            }
            *picked.entry(def.key.clone()).or_default() += 1;
            total += 1;
        }
    }
    assert!(total >= 1_000, "一千五百次里只挑出 {total} 件");
    for def in &defs.events {
        assert!(picked.get(&def.key).copied().unwrap_or(0) >= 5, "{} 只被挑到 {:?} 次", def.key, picked.get(&def.key));
    }
}
