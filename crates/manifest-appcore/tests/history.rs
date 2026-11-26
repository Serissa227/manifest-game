//! I7/I8 字段、观察快照、只读查询和知识隔离。
use manifest_appcore::{history_view, views::Ctx};
use manifest_core::*;
use serde_json::{Value, json};
use std::{
    collections::BTreeSet,
    sync::{Arc, OnceLock},
};
const O: OwnerId = OwnerId::Player;
fn world() -> World {
    static DATA: OnceLock<Arc<StaticData>> = OnceLock::new();
    let mut d = DATA
        .get_or_init(|| manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap())
        .clone();
    let dd = Arc::make_mut(&mut d);
    dd.scenarios[0].start_date = [1558, 1, 1];
    dd.scenarios[0].control_date = [1558, 1, 1];
    for e in &mut dd.history.events {
        if e.date.is_some() {
            e.date = Some([1558, 1, 20]);
        } else {
            e.latest = Some([1558, 1, 23]);
        }
        if let Some(window) = &mut e.window {
            window[1] = [1558, 1, 20];
        }
        for l in &mut e.levers {
            if l.deadline.is_some() {
                l.deadline = Some([1558, 1, 19]);
            }
        }
    }
    dd.history.order = history::validation::order(&dd.history).unwrap();
    let mut w = World::new(d, ScenarioId(0), 42).unwrap();
    w.end_day().unwrap();
    w
}
fn keys(v: &Value) -> BTreeSet<&str> {
    v.as_object().unwrap().keys().map(String::as_str).collect()
}
fn expected(v: &[&'static str]) -> BTreeSet<&'static str> {
    v.iter().copied().collect()
}
fn timeline(w: &World) -> Value {
    history_view::timeline(Ctx::plain(&w.defs), w)
}
fn campaign(w: &World) -> Value {
    history_view::campaign(Ctx::plain(&w.defs), w, "sample_chain").unwrap()
}
#[test]
fn i7_and_i8_shapes_are_exact_and_queries_are_read_only() {
    let w = world();
    let before = w.state.clone();
    let t = timeline(&w);
    assert_eq!(keys(&t), expected(&["events", "deviation", "history_on"]));
    let e = t["events"].as_array().unwrap().iter().find(|e| e["key"] == "sample_opening").unwrap();
    assert_eq!(
        keys(e),
        expected(&[
            "key",
            "title",
            "summary",
            "region",
            "date",
            "window",
            "days_left",
            "status",
            "campaign",
            "sides",
            "balance",
            "levers",
            "why_hard",
            "outcome",
            "basis",
            "sources",
            "narration"
        ])
    );
    assert_eq!(keys(&e["narration"]), expected(&["opening", "progress", "ending"]));
    assert!(e["narration"].as_object().unwrap().values().all(Value::is_null));
    assert_eq!(e["status"], "active");
    assert_eq!(e["days_left"], 18);
    assert_eq!(keys(&e["sides"][0]), expected(&["key", "name", "color"]));
    assert_eq!(e["balance"]["known"], "rough");
    for lever in e["levers"].as_array().unwrap() {
        let mut fields = expected(&[
            "key", "side", "kind", "label", "where", "goods", "progress", "yours", "risk", "note", "action", "enabled",
        ]);
        if lever["enabled"] == false {
            fields.insert("blocked_reason");
        }
        assert_eq!(keys(lever), fields);
        assert_eq!(keys(&lever["progress"]), expected(&["points", "max"]));
        for g in lever["goods"].as_array().unwrap() {
            assert_eq!(keys(g), expected(&["good", "name"]));
        }
    }
    let c = campaign(&w);
    assert_eq!(keys(&c), expected(&["key", "name", "summary", "inertia", "vars", "events", "outlook"]));
    assert_eq!(
        keys(&c["vars"][0]),
        expected(&["key", "name", "kind", "court", "value", "baseline", "drift", "cap", "gates"])
    );
    assert_eq!(keys(&c["vars"][0]["value"]), expected(&["lo", "hi", "known"]));
    assert_eq!(keys(&c["events"][0]), expected(&["key", "title", "date", "status", "outcome"]));
    let west = w.defs.find_loc("test_west").unwrap();
    let i = history_view::ideas(Ctx::plain(&w.defs), &w, west).unwrap();
    assert_eq!(keys(&i), expected(&["loc", "name", "shares", "modes", "hostility", "away"]));
    assert_eq!(keys(&i["shares"][0]), expected(&["idea", "name", "share", "delta_year"]));
    for mode in i["modes"].as_array().unwrap() {
        let mut f = expected(&["mode", "idea", "label", "needs", "points", "cap", "enabled"]);
        if mode["enabled"] == false {
            f.insert("blocked_reason");
        }
        assert_eq!(keys(mode), f);
    }
    assert_eq!(keys(&history_view::chronicle(Ctx::plain(&w.defs), &w)), expected(&["entries"]));
    assert_eq!(w.state, before);
}
#[test]
fn hidden_events_people_ports_and_campaigns_never_escape_in_views() {
    let mut w = world();
    let dd = Arc::make_mut(&mut w.defs);
    for e in &mut dd.history.events {
        e.knowledge = Some("test_secret_history".into());
    }
    let t = timeline(&w);
    assert_eq!(t["events"], json!([]));
    assert_eq!(t["deviation"], 0);
    assert!(history_view::campaign(Ctx::plain(&w.defs), &w, "sample_chain").is_none());
    assert_eq!(history_view::chronicle(Ctx::plain(&w.defs), &w)["entries"], json!([]));
    w.state.story2.flags.insert("test_secret_history".into());
    assert!(!timeline(&w)["events"].as_array().unwrap().is_empty());
    w.state.cast.persons.get_mut("mentor").unwrap().met = false;
    let t = timeline(&w);
    let e = t["events"].as_array().unwrap().iter().find(|e| e["key"] == "sample_opening").unwrap();
    assert!(!e["levers"].as_array().unwrap().iter().any(|l| l["key"] == "terms" || l["key"] == "favor"));
}
#[test]
fn remote_hidden_changes_do_not_refresh_reports_and_stale_reports_become_unknown() {
    let mut w = world();
    let old = campaign(&w);
    w.state.history.campaigns.get_mut("sample_chain").unwrap().values.insert("reserve".into(), 99);
    assert_eq!(campaign(&w), old);
    let fleet = w.flagship(O).unwrap();
    let east = w.defs.find_loc("test_east").unwrap();
    Command::Resupply { owner: O, fleet, food: 10, water: 10 }.apply(&mut w).unwrap();
    Command::SetSail { owner: O, fleet, dest: east }.apply(&mut w).unwrap();
    let west = w.defs.find_loc("test_west").unwrap();
    let i = history_view::ideas(Ctx::plain(&w.defs), &w, west).unwrap();
    assert_eq!(i["shares"], json!([]));
    assert_eq!(i["modes"], json!([]));
    w.state.day += 91;
    let c = campaign(&w);
    for v in c["vars"].as_array().unwrap() {
        assert_eq!(v["value"], json!({"lo":0,"hi":100,"known":"unknown"}));
    }
}

#[test]
fn old_reports_do_not_hide_your_new_contribution_at_an_outlying_delivery_port() {
    let mut w = world();
    let event = Arc::make_mut(&mut w.defs).history.events.iter_mut().find(|e| e.key == "sample_opening").unwrap();
    for side in &mut event.sides {
        side.port = Some("test_east".into());
    }
    let observation = w.state.history.known_events["sample_opening"].clone();
    Command::Contribute {
        owner: O,
        event: "sample_opening".into(),
        lever: "fund".into(),
        payload: history::Payload::Money { amount: 100 },
    }
    .apply(&mut w)
    .unwrap();
    assert_eq!(w.state.history.known_events["sample_opening"], observation);
    let t = timeline(&w);
    let event = t["events"].as_array().unwrap().iter().find(|e| e["key"] == "sample_opening").unwrap();
    let lever = event["levers"].as_array().unwrap().iter().find(|l| l["key"] == "fund").unwrap();
    assert!(lever["yours"].as_i64().unwrap() > 0);
    assert_eq!(lever["progress"]["points"], lever["yours"]);
}
#[test]
fn resolution_chronicle_history_switch_and_classic_omission_follow_contract() {
    let mut w = world();
    for _ in 0..24 {
        w.end_day().unwrap();
    }
    let c = history_view::chronicle(Ctx::plain(&w.defs), &w);
    assert_eq!(c["entries"].as_array().unwrap().len(), 3);
    for entry in c["entries"].as_array().unwrap() {
        assert_eq!(keys(entry), expected(&["date", "text", "history", "deviates"]));
        assert_eq!(entry["deviates"], false);
    }
    let mut w = world();
    w.state.history.enabled = false;
    let t = timeline(&w);
    assert_eq!(t["history_on"], false);
    for e in t["events"].as_array().unwrap() {
        for l in e["levers"].as_array().unwrap() {
            assert_eq!(l["enabled"], false);
        }
    }
    let d = manifest_data::load(&manifest_data::find_data_dir().unwrap()).unwrap();
    let w = World::new(d, ScenarioId(0), 42).unwrap();
    assert_eq!(timeline(&w), Value::Null);
    assert_eq!(history_view::chronicle(Ctx::plain(&w.defs), &w), Value::Null);
    assert!(history_view::campaign(Ctx::plain(&w.defs), &w, "sample_chain").is_none());
    assert!(history_view::ideas(Ctx::plain(&w.defs), &w, LocId(0)).is_none());
}
#[test]
fn forecasts_use_observed_values_and_gate_names_follow_knowledge() {
    let mut w = world();
    let dd = Arc::make_mut(&mut w.defs);
    let c = &mut dd.history.campaigns[0];
    c.vars[0].idea = Some("sample_school".into());
    c.vars[0].court = Some("council".into());
    c.vars[0].gates = serde_json::from_value(json!([{"event":"sample_signal","outcome":"received","cap":60}])).unwrap();
    c.ending_event = Some("sample_treaty".into());
    c.outlooks = serde_json::from_value(
        json!([{"key":"council","name":"测试宫廷","historical":"historical","threshold":60,"priority":["reserve"]}]),
    )
    .unwrap();
    for result in ["signed", "failed"] {
        for outlook in ["historical", "sample_school"] {
            c.endings.push(serde_json::from_value(json!({"key":format!("{result}_{outlook}"),"outcome":result,"court":"council","outlook":outlook,"text":format!("{result}: {outlook}")})).unwrap());
        }
    }
    let view = campaign(&w);
    assert_eq!(view["vars"][0]["kind"], "idea");
    assert_eq!(view["vars"][0]["cap"], 60);
    assert_eq!(keys(&view["vars"][0]["gates"][0]), expected(&["event", "name", "passed"]));
    assert_eq!(view["vars"][0]["gates"][0]["passed"], Value::Null);
    assert_eq!(view["outlook"], "signed: historical");
    w.state.history.events.get_mut("sample_signal").unwrap().outcome = Some("received".into());
    let report = w.state.history.known_campaigns.get_mut("sample_chain").unwrap();
    report.exact = true;
    report.values.insert("reserve".into(), 80);
    assert_eq!(campaign(&w)["outlook"], "signed: sample_school");
    Arc::make_mut(&mut w.defs).history.events.iter_mut().find(|e| e.key == "sample_signal").unwrap().knowledge =
        Some("secret_gate".into());
    let view = campaign(&w);
    assert_eq!(view["vars"][0]["gates"], json!([]));
    assert_eq!(view["vars"][0]["cap"], Value::Null);
    assert_eq!(view["outlook"], Value::Null);
}
#[test]
fn protection_is_offered_at_its_origin_without_disclosing_destination_shares() {
    let mut w = world();
    let east = w.defs.find_loc("test_east").unwrap();
    assert!(history_view::ideas(Ctx::plain(&w.defs), &w, east).is_none());
    w.state.explore.visited.insert(east);
    let v = history_view::ideas(Ctx::plain(&w.defs), &w, east).unwrap();
    assert_eq!(v["shares"], json!([]));
    assert_eq!(v["hostility"], Value::Null);
    let modes = v["modes"].as_array().unwrap();
    assert_eq!(modes.len(), 1);
    assert_eq!(modes[0]["mode"], "protect");
    assert_eq!(modes[0]["enabled"], true);
    w.state.cast.persons.get_mut("mentor").unwrap().met = false;
    assert_eq!(history_view::ideas(Ctx::plain(&w.defs), &w, east).unwrap()["modes"], json!([]));
}

#[test]
fn forecast_uses_candidate_side_and_observed_court_bonuses() {
    for side in ["east", "west"] {
        let mut w = world();
        let dd = Arc::make_mut(&mut w.defs);
        let c = &mut dd.history.campaigns[0];
        c.ending_event = Some("sample_opening".into());
        c.vars[0].idea = Some("sample_school".into());
        c.vars[0].court = Some("council".into());
        c.outlooks = serde_json::from_value(json!([{"key":"council","name":"测试宫廷","historical":"historical","threshold":100,"priority":["reserve"]}])).unwrap();
        for result in ["opens", "partial", "closed"] {
            for outlook in ["historical", "sample_school"] {
                c.endings.push(serde_json::from_value(json!({"key":format!("{result}_{outlook}"),"outcome":result,"court":"council","outlook":outlook,"text":format!("{result}: {outlook}")})).unwrap());
            }
        }
        let e = dd.history.events.iter_mut().find(|e| e.key == "sample_opening").unwrap();
        e.base = Some(if side == "east" { -8 } else { 8 });
        e.base_vars.clear();
        e.counter = None;
        e.court = serde_json::from_value(json!({"var":"council","min":100,"fail":"downgrade"})).unwrap();
        let intervals = if side == "east" { [">= 0", "-19..-1", "<= -20"] } else { ["<= 0", "1..19", ">= 20"] };
        e.outcomes = serde_json::from_value(json!([
            {"key":"opens","when":intervals[0],"default":true},
            {"key":"partial","when":intervals[1]},
            {"key":"closed","when":intervals[2]}
        ]))
        .unwrap();
        for l in &mut e.levers {
            l.side = side.into();
            l.court_bonus = if l.key == "terms" { 20 } else { 0 };
        }
        let report = w.state.history.known_events.get_mut("sample_opening").unwrap();
        report.exact = true;
        report.values = [("supply".into(), 8), ("fund".into(), 8), ("terms".into(), 4)].into_iter().collect();
        let report = w.state.history.known_campaigns.get_mut("sample_chain").unwrap();
        report.exact = true;
        report.values.insert("council".into(), 90);
        assert!(
            history::validation::validate(&w.defs).is_empty(),
            "{side}: {:?}",
            history::validation::validate(&w.defs)
        );
        assert_eq!(campaign(&w)["outlook"], "closed: historical", "{side}");
        // 隐藏的真实朝议变化不能覆盖已经拿到的情报。
        w.state.history.campaigns.get_mut("sample_chain").unwrap().values.insert("council".into(), 0);
        assert_eq!(campaign(&w)["outlook"], "closed: historical", "{side}");
        let e = Arc::make_mut(&mut w.defs).history.events.iter_mut().find(|e| e.key == "sample_opening").unwrap();
        e.levers.iter_mut().find(|l| l.key == "terms").unwrap().court_bonus = 0;
        assert_eq!(campaign(&w)["outlook"], "partial: historical", "{side}");
        let e = Arc::make_mut(&mut w.defs).history.events.iter_mut().find(|e| e.key == "sample_opening").unwrap();
        e.court.as_mut().unwrap().fail = history::CourtFail::Cancel;
        assert_eq!(campaign(&w)["outlook"], "opens: historical", "{side}");
        let e = Arc::make_mut(&mut w.defs).history.events.iter_mut().find(|e| e.key == "sample_opening").unwrap();
        e.court = None;
        e.levers.iter_mut().find(|l| l.key == "fund").unwrap().side =
            if side == "east" { "west" } else { "east" }.into();
        assert_eq!(campaign(&w)["outlook"], "opens: historical", "不能用另一阵营的杠杆补足 need：{side}");
    }
}
