//! 审计真实世界或显式目录夹具上的作者轨道；输出诊断与分支路径，不改原内容。
//! 用法：story_audit --world terra16 <stories目录> <report.json>
//! 兼容：story_audit <catalog.json> <stories目录> <report.json>（testbed几何）。
#[path = "story_audit/matrix.rs"]
mod matrix;

use manifest_core::{
    captain::{AttributeDef, AttributeGroup, RatingDef},
    cast::{CastDefs, PersonDef, PersonKind, relations::TieDef},
    scenario::{Gender, ProtagonistIdentity},
    *,
};
use manifest_sim::story_bot::walk;
use serde_json::{Value, json};
use std::{collections::BTreeSet, error::Error, fs, path::Path, sync::Arc};

type Catalog = (Arc<StaticData>, Vec<Value>, Vec<Value>);

fn files(path: &Path, out: &mut Vec<std::path::PathBuf>) -> Result<(), Box<dyn Error>> {
    for entry in fs::read_dir(path)? {
        let p = entry?.path();
        if p.is_dir() {
            files(&p, out)?;
        } else if p.extension().is_some_and(|x| x == "toml") {
            out.push(p);
        }
    }
    out.sort();
    Ok(())
}

fn legacy_catalog(path: &str, data: &Path) -> Result<Catalog, Box<dyn Error>> {
    let catalog: Value = serde_json::from_str(&fs::read_to_string(path)?)?;
    let mut defs = manifest_data::load_world(data, "testbed")?;
    let d = Arc::make_mut(&mut defs);
    let mut prerequisites = Vec::new();
    if let Err(e) = manifest_data::load_world(data, "terra16") {
        prerequisites.push(json!({"file":"worlds/terra16/world.toml","error":e.to_string()}));
    }
    for raw in catalog["raw_cast"].as_array().ok_or("缺少raw_cast")? {
        if let Err(e) = serde_json::from_value::<CastDefs>(raw["data"].clone()) {
            prerequisites.push(json!({"file":raw["file"],"error":e.to_string()}));
        }
    }
    d.cast = CastDefs::default();
    let mut fixture_errors = Vec::new();
    for raw in catalog["persons"].as_array().ok_or("缺少persons")? {
        match serde_json::from_value::<PersonDef>(raw.clone()) {
            Ok(p) => d.cast.persons.push(p),
            Err(e) => fixture_errors.push(json!({"kind":"person","key":raw["key"],"error":e.to_string()})),
        }
    }
    for raw in catalog["ties"].as_array().ok_or("缺少ties")? {
        match serde_json::from_value::<TieDef>(raw.clone()) {
            Ok(t) => d.cast.ties.push(t),
            Err(e) => fixture_errors.push(json!({"kind":"tie","a":raw["a"],"b":raw["b"],"error":e.to_string()})),
        }
    }
    d.items.items.clear();
    for raw in catalog["items"].as_array().ok_or("缺少items")? {
        match serde_json::from_value::<manifest_core::items::ItemDef>(raw.clone()) {
            Ok(i) => d.items.items.push(i),
            Err(e) => fixture_errors.push(json!({"kind":"item","key":raw["key"],"error":e.to_string()})),
        }
    }
    // 目录中的实际地点使用最小地图海格；这不检验真实世界航路或旅行耗时。
    let prototype = d.locations[0].clone();
    for loc in catalog["locations"].as_array().ok_or("缺少locations")? {
        let mut p = prototype.clone();
        p.key = loc["key"].as_str().ok_or("地点缺key")?.into();
        p.name = loc["name"].as_str().ok_or("地点缺name")?.into();
        p.culture = loc["culture"].as_str().unwrap_or_default().into();
        p.kind =
            if loc["port"] == true { manifest_core::defs::LocKind::Port } else { manifest_core::defs::LocKind::City };
        p.market.clear();
        p.workshops.clear();
        p.sells.clear();
        d.locations.push(p);
    }
    let ports: Vec<_> = d
        .locations
        .iter()
        .enumerate()
        .filter(|(_, l)| l.is_port())
        .map(|(i, l)| (LocId::from_idx(i), l.cell))
        .collect();
    d.nav = manifest_core::nav::NavTable::build(&d.map, &d.regions, d.locations.len(), &ports).into();
    d.captain.attributes.clear();
    d.captain.ratings.clear();
    d.captain.groups = vec![
        AttributeGroup {
            key: "ability".into(),
            name: "本领".into(),
            range: [1, 10],
            start: 1,
            free: 0,
            creation_cap: 10,
        },
        AttributeGroup {
            key: "conduct".into(),
            name: "品行".into(),
            range: [0, 100],
            start: 50,
            free: 0,
            creation_cap: 100,
        },
    ];
    for a in catalog["attributes"].as_array().ok_or("缺少attributes")? {
        let key = a["key"].as_str().ok_or("属性缺key")?;
        d.captain.attributes.push(AttributeDef {
            key: key.into(),
            name: key.into(),
            desc: String::new(),
            group: if a["conduct"] == true { "conduct" } else { "ability" }.into(),
            hooks: Vec::new(),
            hidden: false,
        });
    }
    for r in catalog["ratings"].as_array().ok_or("缺少ratings")? {
        let key = r["key"].as_str().ok_or("评价缺key")?;
        let weights = r["weights"]
            .as_object()
            .ok_or("评价缺weights")?
            .iter()
            .map(|(k, v)| {
                Ok((d.captain.attribute_index(k).ok_or("评价引用不存在属性")?, v.as_i64().ok_or("权重不是整数")?))
            })
            .collect::<Result<Vec<_>, Box<dyn Error>>>()?;
        d.captain.ratings.push(RatingDef { key: key.into(), name: key.into(), weights });
    }
    d.story2.skills = serde_json::from_value(catalog["skills"].clone())?;
    // 目录可带所审世界在 runtime_links.toml 显式登记的待交付旗标；没有就是空，与整包加载同一套图检查。
    if let Some(flags) = catalog.get("pending_flags") {
        d.story2.pending_flags = serde_json::from_value(flags.clone())?;
    }
    d.scenarios[0].start_date = [1553, 1, 1];
    d.scenarios[0].control_date = [1553, 1, 1];
    Ok((defs, prerequisites, fixture_errors))
}

#[derive(Debug, PartialEq, Eq)]
enum CatalogSource {
    World(String),
    Legacy(String),
}
#[derive(Debug, PartialEq, Eq)]
struct Arguments {
    source: CatalogSource,
    stories: String,
    report: String,
}
fn arguments(args: &[String]) -> Result<Arguments, &'static str> {
    match args {
        [option, world, stories, report] if option == "--world" => Ok(Arguments {
            source: CatalogSource::World(world.clone()),
            stories: stories.clone(),
            report: report.clone(),
        }),
        [catalog, stories, report] if !catalog.starts_with("--") => Ok(Arguments {
            source: CatalogSource::Legacy(catalog.clone()),
            stories: stories.clone(),
            report: report.clone(),
        }),
        _ => Err(
            "用法：story_audit --world <world> <stories目录> <report.json>；或 story_audit <catalog.json> <stories目录> <report.json>",
        ),
    }
}

fn audit(data: &Path, args: &Arguments) -> Result<Value, Box<dyn Error>> {
    let (mut defs, prerequisites, fixture_errors, geometry) = match &args.source {
        CatalogSource::Legacy(path) => {
            let (defs, prerequisites, errors) = legacy_catalog(path, data)?;
            (defs, prerequisites, errors, "testbed synthetic locations; no voyage/economy proof".to_owned())
        }
        CatalogSource::World(world) => {
            let defs = match manifest_data::load_world(data, world) {
                Ok(defs) => defs,
                Err(error) => {
                    let draft_validation = match manifest_data::worlds::validate_draft_world(data, world) {
                        Ok(report) => serde_json::to_value(report)?,
                        Err(error) => json!({"error":error.to_string()}),
                    };
                    return Ok(json!({
                        "world":world,"status":"blocked","geometry":null,
                        "prerequisites":[{"file":format!("worlds/{world}/world.toml"),"error":error.to_string()}],
                        "draft_validation":draft_validation,
                        "runs":[]
                    }));
                }
            };
            let geometry = format!(
                "{}: real world catalog and map; story bot uses explicit movement/date/resource cheats",
                defs.map_key
            );
            (defs, Vec::new(), Vec::new(), geometry)
        }
    };
    let d = Arc::make_mut(&mut defs);
    // 每条轨道独立遍历；不让已登记的自治轨道抢走本次审计事件。
    d.story2.tracks.clear();
    let mut paths = Vec::new();
    files(Path::new(&args.stories), &mut paths)?;
    let mut parse_errors = Vec::new();
    for path in &paths {
        let source = format!("stories/{}", path.strip_prefix(&args.stories)?.to_string_lossy().replace('\\', "/"));
        match manifest_data::story2::parse_story_tracks(&fs::read_to_string(path)?, &source) {
            Ok(mut parsed) => {
                for t in &mut parsed.tracks {
                    t.auto = false;
                }
                d.story2.tracks.extend(parsed.tracks);
            }
            Err(e) => parse_errors
                .extend(e.issues.into_iter().map(|e| json!({"file":e.file,"item":e.item,"error":e.message}))),
        }
    }
    let validation_errors = manifest_data::story2::validate_story_tracks(d).err().map_or(Vec::new(), |e| {
        e.issues.into_iter().map(|e| json!({"file":e.file,"item":e.item,"error":e.message})).collect()
    });
    // 寰宇的主角剧本都从养成开局（A6 第二轮），养成月程会挡住故事机器人；有不带养成的剧本就用它（寰宇的 free_1557，同样 1553 年开局）。
    let scenario = ScenarioId(defs.scenarios.iter().position(|s| !s.upbringing).unwrap_or(0) as _);
    let mut runs = Vec::new();
    for track in &defs.story2.tracks {
        let named = (track.kind == manifest_core::story2::TrackKind::Main)
            .then(|| track.cast.iter().filter_map(|p| defs.cast.person(p)).find(|p| p.kind == PersonKind::Protagonist))
            .flatten();
        let identities: Vec<_> = if let Some(p) = named {
            vec![ProtagonistIdentity {
                protagonist: Some(p.key.clone()),
                template: None,
                born: p.born,
                gender: p.gender,
            }]
        } else {
            [Gender::F, Gender::M]
                .into_iter()
                .map(|gender| ProtagonistIdentity { protagonist: None, template: None, born: [1540, 1, 1], gender })
                .collect()
        };
        for identity in identities {
            let mut w = World::new(defs.clone(), scenario, 42)?;
            w.state.protagonist = Some(identity.clone());
            let report = walk(&w, &track.key, 4096);
            let missing: BTreeSet<_> =
                track.chapters.iter().map(|c| c.key.clone()).filter(|k| !report.reached.contains(k)).collect();
            eprintln!(
                "{} {:?}: done={}, reached={}/{}, steps={}, truncated={}",
                track.key,
                identity.gender,
                report.done,
                report.reached.len(),
                track.chapters.len(),
                report.steps.len(),
                report.truncated
            );
            runs.push(json!({"file":track.source,"identity":identity,"unreached":missing,"report":report}));
        }
    }
    Ok(
        json!({"world":defs.world_key,"status":"audited","geometry":geometry,"cast_diagnostics":defs.cast.diagnostics,"seed":42,"state_budget":4096,"files":paths.len(),"tracks":defs.story2.tracks.len(),"chapters":defs.story2.tracks.iter().map(|t|t.chapters.len()).sum::<usize>(),"prerequisites":prerequisites,"fixture_errors":fixture_errors,"parse_errors":parse_errors,"validation_errors":validation_errors,"runs":runs}),
    )
}

fn main() -> Result<(), Box<dyn Error>> {
    let raw = std::env::args().skip(1).collect::<Vec<_>>();
    if raw.first().is_some_and(|arg| arg == "--matrix") {
        return matrix::run(&raw[1..]);
    }
    let args = arguments(&raw)?;
    let data = manifest_data::find_data_dir().ok_or("找不到data目录")?;
    let report = audit(&data, &args)?;
    fs::write(&args.report, serde_json::to_vec_pretty(&report)?)?;
    if report["status"] == "blocked" {
        return Err(format!("世界加载失败，前置问题已写入 {}", args.report).into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn world_mode_accepts_registered_chinese_only_stories() {
        fn copy(from: &Path, to: &Path) {
            fs::create_dir_all(to).unwrap();
            for entry in fs::read_dir(from).unwrap() {
                let entry = entry.unwrap();
                let dest = to.join(entry.file_name());
                if entry.path().is_dir() {
                    copy(&entry.path(), &dest);
                } else {
                    fs::copy(entry.path(), dest).unwrap();
                }
            }
        }
        let tmp = tempfile::tempdir().unwrap();
        copy(&manifest_data::find_data_dir().unwrap(), tmp.path());
        let base = tmp.path().join("worlds/testbed");
        let manifest = base.join("world.toml");
        let text = fs::read_to_string(&manifest).unwrap();
        fs::write(manifest, format!("languages=['zh']\n{text}")).unwrap();
        fs::remove_file(base.join("locales/en/stories/upbringing.toml")).unwrap();
        let args = Arguments {
            source: CatalogSource::World("testbed".into()),
            stories: base.join("stories").display().to_string(),
            report: "unused".into(),
        };
        let report = audit(tmp.path(), &args).unwrap();
        assert_eq!(report["status"], "audited");
        assert!(report["tracks"].as_u64().unwrap() > 0);
        assert!(!report["runs"].as_array().unwrap().is_empty());
        for field in ["prerequisites", "fixture_errors", "parse_errors", "validation_errors"] {
            assert!(report[field].as_array().unwrap().is_empty(), "{field}: {}", report[field]);
        }
    }

    #[test]
    fn both_cli_forms_and_bad_arity_are_distinguished() {
        let strings = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let a = arguments(&strings(&["--world", "terra16", "stories", "report.json"])).unwrap();
        assert_eq!(a.source, CatalogSource::World("terra16".into()));
        assert_eq!((a.stories, a.report), ("stories".into(), "report.json".into()));
        let a = arguments(&strings(&["catalog.json", "stories", "report.json"])).unwrap();
        assert_eq!(a.source, CatalogSource::Legacy("catalog.json".into()));
        assert!(arguments(&strings(&["--world", "terra16", "stories"])).is_err());
        assert!(arguments(&strings(&["--other", "terra16", "stories", "report.json"])).is_err());
    }

    #[test]
    fn unavailable_world_reports_blocker_without_substituting_a_fixture() {
        let root = manifest_data::find_data_dir().unwrap();
        let args = Arguments {
            source: CatalogSource::World("missing_world".into()),
            stories: "unused".into(),
            report: "unused".into(),
        };
        let report = audit(&root, &args).unwrap();
        assert_eq!(report["world"], "missing_world");
        assert_eq!(report["status"], "blocked");
        assert!(report["geometry"].is_null());
        assert_eq!(report["prerequisites"].as_array().unwrap().len(), 1);
        assert!(report["runs"].as_array().unwrap().is_empty());
    }

    #[test]
    fn world_mode_resolves_real_people_and_locations_and_walks_both_identities() {
        let root = manifest_data::find_data_dir().unwrap();
        let tmp = tempfile::tempdir().unwrap();
        fs::write(
            tmp.path().join("audit.toml"),
            r#"
[[tracks]]
key="audit_fixture"
name="审计样例"
kind="request"
start="ask"
auto=false
cast=["mentor"]
[[tracks.chapters]]
key="ask"
title="检查"
text="这是审计样例。"
at="test_west"
speaker="mentor"
[[tracks.chapters.choices]]
key="finish"
text="完成。"
next="done"
effects=[{kind="affinity",person="mentor",value=1}]
"#,
        )
        .unwrap();
        let args = Arguments {
            source: CatalogSource::World("testbed".into()),
            stories: tmp.path().display().to_string(),
            report: "unused".into(),
        };
        let report = audit(&root, &args).unwrap();
        assert_eq!(report["status"], "audited");
        assert_eq!(report["world"], "testbed");
        assert_eq!(report["tracks"], 1);
        for field in ["prerequisites", "fixture_errors", "parse_errors", "validation_errors"] {
            assert!(report[field].as_array().unwrap().is_empty(), "{field}: {}", report[field]);
        }
        let runs = report["runs"].as_array().unwrap();
        assert_eq!(runs.len(), 2);
        assert!(
            runs.iter().all(|run| run["report"]["done"] == true && run["unreached"].as_array().unwrap().is_empty()),
            "{runs:?}"
        );
    }
}
