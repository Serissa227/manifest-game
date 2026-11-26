//! 1553→1600：真实开局资源与生产命令，缺省、六种单线和多线对照。
use manifest_core::{history::*, ideas::Mode, *};
use manifest_sim::history_bot::{self, Policy};
use serde_json::json;
use std::sync::{Arc, OnceLock};
fn data() -> Arc<StaticData> {
    static DATA: OnceLock<Arc<StaticData>> = OnceLock::new();
    DATA.get_or_init(|| {
        let mut d=manifest_data::load_world(&manifest_data::find_data_dir().unwrap(),"testbed").unwrap();
        let dd=Arc::make_mut(&mut d);
        let west=dd.find_loc("test_west").unwrap();let east=dd.find_loc("test_east").unwrap();
        let mate=dd.find_mate("sailor").unwrap();dd.mates[mate.idx()].abilities.insert("lang_test".into(),2);dd.mates[mate.idx()].abilities.insert("mentor".into(),1);
        let sc=&mut dd.scenarios[0];sc.start_date=[1553,1,1];sc.control_date=sc.start_date;sc.cash=100_000_000;sc.mates=vec![mate];
        let mut letter=dd.items.item("ring").unwrap().clone();letter.key="test_letter".into();letter.name="测试书信".into();letter.shop.as_mut().unwrap().weight=1000;dd.items.items.push(letter);
        dd.items.items.iter_mut().find(|i|i.key=="reader").unwrap().shop.as_mut().unwrap().weight=1000;
        dd.history.ports.clear();dd.history.events.clear();
        for (key,year,start) in [("gate",1558,1553),("middle",1570,1560),("final",1589,1571)] {
            dd.history.events.push(serde_json::from_value(json!({"key":key,"title":"测试历史事件","summary":"测试历史事件。","date":[year,12,20],"window":[[start,1,1],[year,12,20]],"campaign":"demo","balance":-25,"roll":0,"need":{"kinds":3},"diminish":50,
                "history":{"date":[year,12,20],"outcome":"historical"},"sides":[{"key":"west","name":"西方","faction":"cuilan","port":"test_west"},{"key":"east","name":"东方","faction":"cuilan","port":"test_east"}],
                "levers":[
                    {"key":"arms","side":"west","kind":"arms","label":"军火测试","port":"test_west","goods":["grain"],"value_per_point":10,"max_points":20},
                    {"key":"money","side":"west","kind":"money","label":"出资测试","port":"test_west","value_per_point":10,"max_points":20},
                    {"key":"relief","side":"west","kind":"relief","label":"赈济测试","port":"test_west","goods":["grain"],"value_per_point":10,"max_points":20},
                    {"key":"negotiate","side":"west","kind":"negotiate","label":"谈判测试","port":"test_west","with":"mentor","language":"lang_test","terms":["test_terms"],"cost":100,"points":20,"max_points":20},
                    {"key":"intel","side":"west","kind":"intel","label":"书信测试","port":"test_east","from":"test_west","item":"test_letter","cost":100,"points":20,"max_points":20,"deadline":[year,12,20]},
                    {"key":"mission","side":"west","kind":"propagate","label":"讲学测试","port":"test_west","idea":"sample_school","mode":"mission","max_points":20},
                    {"key":"print","side":"west","kind":"propagate","label":"印书测试","port":"test_west","idea":"sample_school","mode":"print","max_points":20},
                    {"key":"court","side":"west","kind":"propagate","label":"宫廷测试","port":"test_west","idea":"sample_school","mode":"court","max_points":20}],
                "outcomes":[{"key":"historical","when":"<= 0","default":true,"chronicle":"测试史实结果。"},{"key":"changed","when":"> 0","chronicle":"测试改变结果。"}]})).unwrap());
        }
        dd.history.campaigns=serde_json::from_value(json!([{"key":"demo","name":"测试多线战役","inertia":25,"ending_event":"final","vars":[
            {"key":"force","name":"测试力量","start":50,"drift":[[1553,50],[1600,30]]},
            {"key":"idea","name":"测试思想","start":10,"drift":[[1553,10],[1600,10]],"idea":"sample_school","court":"council","gates":[{"event":"gate","outcome":"changed","cap":40},{"event":"middle","outcome":"changed","cap":50}]}],
            "outlooks":[{"key":"council","name":"测试宫廷","historical":"historical","threshold":60,"priority":["idea"]}],
            "endings":[{"key":"hh","outcome":"historical","court":"council","outlook":"historical","text":"测试史实结局。"},{"key":"hi","outcome":"historical","court":"council","outlook":"sample_school","text":"测试思想结局。"},{"key":"ch","outcome":"changed","court":"council","outlook":"historical","text":"测试战役结局。"},{"key":"ci","outcome":"changed","court":"council","outlook":"sample_school","text":"测试组合结局。"}]}])).unwrap();
        dd.history.order=validation::order(&dd.history).unwrap();
        for p in &mut dd.ideas.ports {
            for m in &mut p.modes {m.campaign=Some("demo".into());m.var=Some("idea".into());if m.mode==Mode::Court {m.affinity=0;}}
        }
        assert_eq!(west,LocId(0));assert_ne!(west,east);
        assert!(validation::validate(dd).is_empty(),"{:?}",validation::validate(dd));
        assert!(ideas::validation::validate(dd).is_empty());
        d
    }).clone()
}
#[test]
fn no_intervention_1553_to_1600_matches_every_default_and_historical_trajectory() {
    for seed in [7, 42] {
        let mut w = World::new(data(), ScenarioId(0), seed).unwrap();
        let mut days = 0;
        for year in 1554..=1600 {
            let report = history_bot::run(w, [year, 1, 1], Policy::Historical).unwrap();
            days += report.days;
            assert!(report.log.is_empty());
            w = report.world;
            for v in &w.defs.history.campaigns[0].vars {
                assert_eq!(
                    w.campaign_value("demo", &v.key),
                    Some(v.baseline(year)),
                    "seed={seed} year={year} var={}",
                    v.key
                );
            }
        }
        assert_eq!(days, 47 * 365);
        assert_eq!(w.history_deviation(), 0);
        for e in &w.defs.history.events {
            assert_eq!(w.history_outcome(&e.key), Some(e.history.outcome.as_str()));
        }
        assert_eq!(w.campaign_outlook("demo", "council"), Some("historical".into()));
        println!("缺省 seed={seed} days={days} deviation=0 hash={}", w.state_hash());
    }
}
#[test]
fn multi_line_changes_battle_and_outlook_while_all_six_single_scripts_cannot() {
    let defs = data();
    for policy in
        [Policy::Multi, Policy::Arms, Policy::Negotiation, Policy::Intel, Policy::Mission, Policy::Print, Policy::Court]
    {
        let original = World::new(defs.clone(), ScenarioId(0), 42).unwrap();
        let report = history_bot::run(original.clone(), [1600, 1, 1], policy).unwrap();
        println!(
            "策略 {policy:?}: days={}, commands={}, battle={:?}, outlook={:?}, hash={}",
            report.days,
            report.log.len(),
            report.world.history_outcome("final"),
            report.world.campaign_outlook("demo", "council"),
            report.world.state_hash()
        );
        let changed = policy == Policy::Multi;
        assert_eq!(
            report.world.history_outcome("final"),
            Some(if changed { "changed" } else { "historical" }),
            "{policy:?}"
        );
        assert_eq!(
            report.world.campaign_outlook("demo", "council"),
            Some(if changed { "sample_school" } else { "historical" }.into()),
            "{policy:?}"
        );
        assert!(
            report.log.iter().any(|e| matches!(e.command, Command::Contribute { .. } | Command::Propagate { .. })),
            "{policy:?}没有执行贡献"
        );
        assert!(report.world.money_conserved());
        if changed {
            let mut replayed = original;
            replay::replay_onto(&mut replayed, &report.log, report.world.day()).unwrap();
            assert_eq!(replayed.state_hash(), report.world.state_hash());
            let loaded = World::from_snapshot(defs.clone(), report.world.state.clone()).unwrap();
            assert_eq!(loaded.state_hash(), report.world.state_hash());
            let years: std::collections::BTreeSet<_> = report
                .log
                .iter()
                .filter(|e| matches!(e.command, Command::Propagate { .. }))
                .map(|e| defs.calendar.date_of(e.tick).year)
                .collect();
            assert!(years.len() >= 15);
        }
    }
}
