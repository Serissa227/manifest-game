//! I5事件、实际收益及I5b分支本地化；视图不能重新掷骰或猜测超时分支。
use manifest_appcore::{story_view::story_view_in, story2_view, views::Ctx};
use manifest_core::{
    scenario::{Gender, ProtagonistIdentity},
    story2::*,
    *,
};
use serde_json::{Value, json};
use std::sync::Arc;
const O: OwnerId = OwnerId::Player;
fn world(chapter: Value) -> World {
    let mut defs = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let d = Arc::make_mut(&mut defs);
    d.scenarios[0].start_date = [1558, 1, 1];
    d.scenarios[0].control_date = [1558, 1, 1];
    d.story2=serde_json::from_value(json!({"tracks":[{"key":"view","name":"视图样例","kind":"request","start":"a","cast":["classmate_a","classmate_b"],"chapters":[chapter]}]})).unwrap();
    d.story2.skills.insert("sailing".into());
    let mut w = World::new(defs, ScenarioId(0), 42).unwrap();
    w.state.protagonist =
        Some(ProtagonistIdentity { protagonist: None, template: None, born: [1540, 1, 1], gender: Gender::F });
    w
}
fn view(w: &World, names: &StaticData) -> Value {
    serde_json::to_value(story_view_in(Ctx::plain(names), w)).unwrap()
}
fn answer(w: &mut World) {
    Command::StoryAnswer { owner: O, choice: 0 }.apply(w).unwrap();
}

#[test]
fn pending_projects_stable_variant_speaker_queue_and_human_readable_choice_gates() {
    let mut chapter = json!({"key":"a","title":"普通标题","text":"普通正文","at":"test_west","speaker":"classmate_b","variants":[{"key":"wind","title":"海风","text":"风中的对话","speaker":"classmate_a","mood":"tender","art":"sea","night":true}],"choices":[{"key":"yes","text":"答应","next":"done","hint":"也许她会很开心","requires":[{"kind":"affinity","person":"classmate_a","ge":50}],"check":{"attr":"commerce","base":40,"per":2},"fail":{"next":"failed"}}]});
    // S02nZ5 36786f20：选项全锁的章暂挂，至少留一个可回答选项，才有待回应视图。
    let mut open = chapter["choices"][0].clone();
    open["key"] = json!("open");
    open["requires"] = json!([]);
    chapter["choices"].as_array_mut().unwrap().push(open);
    let w = world(chapter);
    let before = w.state.clone();
    let v = view(&w, &w.defs);
    let p = &v["pending"];
    assert_eq!(p["track"], "view");
    assert_eq!(p["track_name"], "视图样例");
    assert_eq!(p["kind"], "request");
    assert_eq!(p["title"], "海风");
    assert_eq!(p["text"], "风中的对话");
    assert_eq!(p["speaker"]["person"], "classmate_a");
    assert_eq!(p["speaker"]["portrait"], "test_adult");
    assert_eq!(p["mood"], "tender");
    assert_eq!(p["art"], "sea");
    assert_eq!(p["night"], true);
    assert_eq!(p["queue"], 0);
    assert!(p["place"].is_string());
    let c = &p["choices"][0];
    assert_eq!(c["key"], "yes");
    assert!(c["hint"].is_string());
    assert!(c["blocked"].is_string());
    assert!(c["requires"][0].as_str().unwrap().contains("情谊 ≥ 50"));
    assert!(!c["requires"][0].as_str().unwrap().contains("classmate_a"));
    assert_eq!(c["check"]["attr"], "commerce");
    assert_eq!(c["check"]["name"], w.defs.captain.check_name(w.defs.captain.check_index("commerce").unwrap()));
    assert_eq!(
        c["check"]["pct"],
        w.story2_check_pct(w.defs.story2.tracks[0].chapters[0].choices[0].check.as_ref().unwrap())
    );
    assert_eq!(w.state, before);
}

#[test]
fn result_new_kinds_show_actual_clipped_values_and_current_language() {
    let mut w = world(
        json!({"key":"a","title":"回报","text":"正文","choices":[{"key":"yes","text":"好","reply":"约好了","next":"done","effects":[
        {"kind":"growth","attr":"commerce","value":3},{"kind":"skill","skill":"sailing","value":4},
        {"kind":"affinity","person":"classmate_a","value":10},{"kind":"heart","person":"classmate_a","value":6},
        {"kind":"relation","person":"classmate_a","relation":"friends"},{"kind":"item","item":"ring","qty":1},
        {"kind":"memory","memory":"promise","title":"一起看海"},{"kind":"flag","flag":"helped"},{"kind":"title","title":"朋友"},
        {"kind":"letter","person":"classmate_a","text":"谢谢你"}]}]}),
    );
    w.change_affinity("classmate_a", 98).unwrap();
    answer(&mut w);
    let mut names = (*w.defs).clone();
    names.cast.persons.iter_mut().find(|p| p.key == "classmate_a").unwrap().name = "Lan".into();
    let choice = &mut names.story2.tracks[0].chapters[0].choices[0];
    choice.reply = "A promise.".into();
    for e in &mut choice.effects {
        match e {
            Effect::Memory { title, .. } => *title = "The sea".into(),
            Effect::Letter { text, .. } => *text = "Thank you".into(),
            _ => {}
        }
    }
    let before = w.state.clone();
    let v = view(&w, &names);
    assert_eq!(v["last"]["reply"], "A promise.");
    let o = v["last"]["outcomes"].as_array().unwrap();
    let get = |kind: &str| o.iter().find(|v| v["kind"] == kind).unwrap();
    assert_eq!(get("growth")["attr"], "commerce");
    assert_eq!(get("growth")["value"], 3);
    assert_eq!(get("skill")["skill"], "sailing");
    assert_eq!(get("affinity")["value"], 2);
    assert_eq!(get("affinity")["person_name"], "Lan");
    assert_eq!(get("heart")["value"], 6);
    assert_eq!(get("relation")["person"], "classmate_a");
    assert_eq!(get("relation")["relation"], "friends");
    assert_eq!(get("item")["item"], "ring");
    assert!(get("item")["item_name"].is_string());
    assert_eq!(get("memory")["memory"], "promise");
    assert_eq!(get("memory")["title"], "The sea");
    assert_eq!(get("flag")["flag"], "helped");
    assert_eq!(get("title")["title"], "朋友");
    assert_eq!(get("letter")["text"], "Thank you");
    assert_eq!(w.state, before);
}

#[test]
fn timeout_and_failed_check_news_keep_branch_identity_across_save_and_translation() {
    let mut w = world(
        json!({"key":"a","title":"限期","text":"正文","at":"test_west","window":[[1558,1,1],[1558,1,3]],"deadline_days":1,
        "default":{"next":"done","news":"默认"},"timeout":{"next":"failed","news":"超时"},"choices":[{"key":"yes","text":"好","next":"done"}]}),
    );
    w.end_day().unwrap();
    w.end_day().unwrap();
    w.hear_news_at(LocId(0), false);
    let w = World::from_snapshot(w.defs.clone(), w.state.clone()).unwrap();
    assert!(w.state.story2.news["view:a"].timeout);
    let mut names = (*w.defs).clone();
    let c = &mut names.story2.tracks[0].chapters[0];
    c.default.as_mut().unwrap().news = Some("Default".into());
    c.timeout.as_mut().unwrap().news = Some("Expired".into());
    assert_eq!(story2_view::gossip(Ctx::plain(&names), &w, None, None)["items"][0]["text"], "Expired");
    let mut check = world(
        json!({"key":"a","title":"检定","text":"正文","choices":[{"key":"yes","text":"试试","next":"done","news":"成功","check":{"attr":"commerce","base":5,"per":0},"fail":{"next":"failed","news":"失败"}}]}),
    );
    for seed in 0..100 {
        let mut trial = check.clone();
        trial.state.seed = seed;
        answer(&mut trial);
        if trial.state.story2.last.as_ref().unwrap().success == Some(false) {
            check = trial;
            break;
        }
    }
    assert_eq!(check.state.story2.last.as_ref().unwrap().success, Some(false));
    let check = World::from_snapshot(check.defs.clone(), check.state.clone()).unwrap();
    let mut names = (*check.defs).clone();
    let c = &mut names.story2.tracks[0].chapters[0].choices[0];
    c.news = Some("Succeeded".into());
    c.fail.as_mut().unwrap().news = Some("Failed".into());
    assert_eq!(view(&check, &names)["last"]["reply"], "Failed");
    assert_eq!(story2_view::gossip(Ctx::plain(&names), &check, None, None)["items"][0]["text"], "Failed");
    let mut bad = check.state.clone();
    bad.story2.news.get_mut("view:a").unwrap().timeout = true;
    assert!(World::from_snapshot(check.defs.clone(), bad).is_err());
}

#[test]
fn observed_tie_without_news_is_remembered_after_other_results_and_save() {
    let mut w = world(
        json!({"key":"a","title":"相识","text":"正文","choices":[{"key":"yes","text":"好","next":"done","effects":[{"kind":"tie","a":"classmate_a","b":"classmate_b","relation":"confidants"}]}]}),
    );
    answer(&mut w);
    w.state.story2.last = None;
    let w = World::from_snapshot(w.defs.clone(), w.state.clone()).unwrap();
    let g = manifest_appcore::cast_view::relationships(Ctx::plain(&w.defs), &w);
    assert!(
        g["edges"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["a"] == "classmate_a" && e["b"] == "classmate_b" && e["kind"] == "confidants")
    );
}

#[test]
fn goods_progress_aggregates_duplicate_goals_and_remembers_delivery_after_consumption() {
    let mut w = world(
        json!({"key":"a","title":"交货","text":"正文","objectives":[{"kind":"goods","good":"grain","qty":2,"at":"test_west"},{"kind":"goods","good":"grain","qty":2,"at":"test_west"}],"choices":[{"key":"yes","text":"交货","next":"done"}]}),
    );
    let fleet = w.fleets_of(O).next().unwrap().id;
    let grain = GoodId::from_idx(w.defs.goods.iter().position(|g| g.key == "grain").unwrap());
    w.state.fleets.get_mut(&fleet).unwrap().cargo.insert(grain, 3);
    // 日志已由玩家接到这条请托；临时不足四份货时，两个目标都不能误报已完成。
    w.state.cast.persons.entry("classmate_a".into()).or_default().met = true;
    Arc::make_mut(&mut w.defs).story2.tracks[0].auto = false;
    let log = manifest_appcore::story_log_view::story_log(Ctx::plain(&w.defs), &w);
    assert!(log["tracks"][0]["objectives"].as_array().unwrap().iter().all(|o| o["done"] == false));
    w.state.fleets.get_mut(&fleet).unwrap().cargo.insert(grain, 4);
    w.refresh_story2();
    answer(&mut w);
    assert_eq!(w.state.fleets[&fleet].cargo.get(&grain).copied().unwrap_or(0), 0);
    w.state.story2.last = None;
    let copy = World::from_snapshot(w.defs.clone(), w.state.clone()).unwrap();
    let log = manifest_appcore::story_log_view::story_log(Ctx::plain(&copy.defs), &copy);
    assert_eq!(log["tracks"][0]["status"], "done");
    assert!(log["tracks"][0]["objectives"].as_array().unwrap().iter().all(|o| o["done"] == true));
}

#[test]
fn requirement_labels_only_name_flag_producers_the_player_knows() {
    let mut w = world(
        json!({"key":"a","title":"公开请求","text":"正文","choices":[{"key":"yes","text":"好","next":"done","requires":[{"kind":"flag","flag":"private_flag","value":false}]}]}),
    );
    let mut hidden = w.defs.story2.tracks[0].clone();
    hidden.key = "hidden".into();
    hidden.start = "h".into();
    let c = &mut hidden.chapters[0];
    c.key = "h".into();
    c.title = "尚未公开的秘密章名".into();
    c.news = Some("已经公开的见闻。".into());
    c.choices[0].requires.clear();
    c.choices[0].effects = vec![Effect::Flag { flag: "private_flag".into(), value: true }];
    Arc::make_mut(&mut w.defs).story2.tracks.push(hidden);
    w.state.story2.tracks.insert(
        "hidden".into(),
        TrackState {
            chapter: "h".into(),
            visited: ["h".into()].into(),
            entered: w.day(),
            status: Status::Done,
            failure: None,
        },
    );
    let before = w.state.clone();
    let unknown = view(&w, &w.defs);
    assert!(!unknown["pending"]["choices"][0]["requires"].to_string().contains("秘密章名"));
    assert_eq!(w.state, before);
    let news=serde_json::from_value(json!({"id":"hidden:h","day":w.day(),"text":"已经公开的见闻。","persons":[],"kind":"heard","loc":null,"track":"hidden","known":true,"read":false,"rumor_days":30,"choice":0})).unwrap();
    w.state.story2.news.insert("hidden:h".into(), news);
    let known = view(&w, &w.defs);
    assert!(known["pending"]["choices"][0]["requires"].to_string().contains("秘密章名"));
}

#[test]
fn skill_outcome_names_match_checks_for_both_label_sources_and_languages() {
    for skill in ["sailing", "navigation", "mariner"] {
        let mut w = world(json!({"key":"a","title":"技能测试","text":"测试技能名称。","choices":[
            {"key":"check","text":"检定","next":"done","check":{"attr":skill,"base":40,"per":2}},
            {"key":"gain","text":"获得经验","next":"done","effects":[{"kind":"skill","skill":skill,"value":4}]}
        ]}));
        Arc::make_mut(&mut w.defs).story2.skills.insert(skill.into());
        let mut variants = Vec::new();
        for name in ["测试技能名称", "Test skill name"] {
            let mut names = (*w.defs).clone();
            if skill == "sailing" {
                names.story2.skill_labels = vec![SkillLabel {
                    key: skill.into(),
                    name: name.into(),
                    description: String::new(),
                    source: String::new(),
                }];
            } else if let Some(attribute) = names.captain.attributes.iter_mut().find(|a| a.key == skill) {
                attribute.name = name.into();
            } else {
                names.captain.ratings.iter_mut().find(|a| a.key == skill).unwrap().name = name.into();
            }
            assert_eq!(view(&w, &names)["pending"]["choices"][0]["check"]["name"], name);
            variants.push((names, name));
        }
        Command::StoryAnswer { owner: O, choice: 1 }.apply(&mut w).unwrap();
        let before = w.state.clone();
        for (names, name) in variants {
            let result = view(&w, &names);
            let outcome = &result["last"]["outcomes"][0];
            assert_eq!(outcome["kind"], "skill");
            assert_eq!(outcome["skill"], skill);
            assert_eq!(outcome["skill_name"], name);
            assert_eq!(outcome["value"], 4);
        }
        assert_eq!(w.state, before);
    }
}
