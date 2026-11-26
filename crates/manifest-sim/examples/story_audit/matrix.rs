//! 注册分片矩阵的流式文件输出；中断后已完成的身份报告仍可审阅。
use manifest_core::{World, story2::Status};
use manifest_sim::story_bot::{matrix, walk};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    error::Error,
    fs::{self, File},
    io::{BufWriter, Write},
    path::Path,
};

pub fn run(args: &[String]) -> Result<(), Box<dyn Error>> {
    if args.len() < 2 {
        return Err("用法：--matrix <world> <report_dir> [--batch N] [--protagonist KEY] [--template KEY] [--track KEY] [--states N] [--days N]".into());
    }
    let world = &args[0];
    let output = Path::new(&args[1]);
    let mut batch = None;
    let mut protagonists = BTreeSet::new();
    let mut templates = BTreeSet::new();
    let mut tracks = BTreeSet::new();
    let mut max_states = 4096;
    let mut days = None;
    let mut options = args[2..].chunks_exact(2);
    for pair in &mut options {
        match pair[0].as_str() {
            "--batch" => batch = Some(pair[1].parse::<usize>()?),
            "--protagonist" => {
                protagonists.insert(pair[1].clone());
            }
            "--template" => {
                templates.insert(pair[1].clone());
            }
            "--track" => {
                tracks.insert(pair[1].clone());
            }
            "--states" => max_states = pair[1].parse::<usize>()?,
            "--days" => days = Some(pair[1].parse::<u32>()?),
            option => return Err(format!("未知矩阵选项 {option}").into()),
        }
    }
    if !options.remainder().is_empty() {
        return Err("矩阵选项缺少参数".into());
    }
    let defs = manifest_data::load_world(&manifest_data::find_data_dir().ok_or("找不到 data 目录")?, world)?;
    let all_cases = matrix::cases(&defs);
    for (keys, template) in [(&protagonists, false), (&templates, true)] {
        for key in keys {
            if !all_cases.iter().any(|c| c.key == *key && c.template == template) {
                return Err(format!("未知矩阵身份 {key}").into());
            }
        }
    }
    for key in &tracks {
        if defs.story2.track(key).is_none() {
            return Err(format!("未知注册轨道 {key}").into());
        }
    }
    let cases: Vec<_> = all_cases
        .into_iter()
        .filter(|c| {
            batch.is_none_or(|b| c.batch == b)
                && (protagonists.is_empty() && templates.is_empty()
                    || if c.template { templates.contains(&c.key) } else { protagonists.contains(&c.key) })
        })
        .collect();
    if cases.is_empty() {
        return Err("矩阵选择没有身份".into());
    }
    fs::create_dir_all(output)?;
    let catalog: Vec<_> =
        defs.story2.tracks.iter().map(|t| json!({"key":t.key,"file":t.source,"chapters":t.chapters.len()})).collect();
    fs::write(
        output.join("manifest.json"),
        serde_json::to_vec_pretty(
            &json!({"world":world,"hash":defs.meta.hash,"cases":cases,"tracks":catalog,"max_states":max_states,"days":days,"registration":"world.toml resolved tables","cast_diagnostics":defs.cast.diagnostics,"cheat_context":{"auto_tracks":false,"selected_track_only":true,"deadlines":"kernel_current_day","external_flags":"listed_per_track","birthdays_and_romance_rules":"unchanged","checks":"actual deterministic outcome for seed 42; stochastic alternatives are not exhaustive"}}),
        )?,
    )?;
    let isolated = matrix::isolated_defs(&defs);
    let mut summaries = Vec::new();
    let mut coverage: BTreeMap<String, usize> = defs
        .story2
        .tracks
        .iter()
        .filter(|t| tracks.is_empty() || tracks.contains(&t.key))
        .map(|t| (t.key.clone(), 0))
        .collect();
    let mut fixes = Vec::<Value>::new();
    for diagnostic in &defs.cast.diagnostics {
        fixes.push(json!({"category":"content_wiring","file":diagnostic.file,"entry":diagnostic.item,"field":diagnostic.field,"target":diagnostic.target,"reason":diagnostic.kind}));
    }
    for case in cases {
        let gender = match case.gender {
            manifest_core::scenario::Gender::F => "f",
            manifest_core::scenario::Gender::M => "m",
        };
        let id = format!("{}_{gender}", case.key);
        eprintln!("matrix batch={} case={id}: ordinary", case.batch);
        let start = matrix::start(&defs, &case)?;
        let initial = World::from_start(defs.clone(), &start, |_| {})?;
        let horizon = days.unwrap_or_else(|| {
            initial
                .upbringing_family()
                .and_then(|f| manifest_core::scenario::day_of(&defs, f.graduation).ok())
                .unwrap_or(initial.day())
                .saturating_sub(initial.day())
                .saturating_add(defs.calendar.year_days())
        });
        let (ordinary_world, ordinary) = matrix::ordinary(initial.clone(), horizon);
        let snapshot = World::from_snapshot(defs.clone(), ordinary_world.state.clone());
        let snapshot_ok = snapshot.is_ok();
        let replay = matrix::replay_ordinary(defs.clone(), start, &ordinary);
        let replay_ok = replay.as_ref().is_ok_and(|w| w.state_hash() == ordinary_world.state_hash());
        fs::write(
            output.join(format!("{id}.ordinary.json")),
            serde_json::to_vec_pretty(
                &json!({"case":case,"report":ordinary,"snapshot_ok":snapshot_ok,"snapshot_error":snapshot.err().map(|e|e.to_string()),"replay_ok":replay_ok,"replay_error":replay.err().map(|e|e.to_string())}),
            )?,
        )?;
        if !snapshot_ok || !replay_ok {
            return Err(format!("{id}: 普通命令保存或重放检查失败").into());
        }
        let mut seed = initial;
        seed.defs = isolated.clone();
        let mut writer = BufWriter::new(File::create(output.join(format!("{id}.cheat.jsonl")))?);
        let mut done = 0;
        let mut clean = 0;
        let mut blocked = 0;
        let mut truncated = 0;
        let mut excluded = 0;
        let mut errors = 0;
        for (track_index, track) in defs.story2.tracks.iter().enumerate() {
            if track_index % 100 == 0 {
                eprintln!(
                    "matrix progress={id}: registered={track_index}/{} attempted={} terminal={done} blocked={blocked}",
                    defs.story2.tracks.len(),
                    done + blocked
                );
            }
            if !tracks.is_empty() && !tracks.contains(&track.key) {
                continue;
            }
            if !matrix::relevant(&seed, track) {
                excluded += 1;
                serde_json::to_writer(
                    &mut writer,
                    &json!({"case":id,"mode":"identity_exclusion","file":track.source,"track":track.key,"reason":"outside protagonist, family or academy applicability"}),
                )?;
                writeln!(writer)?;
                continue;
            }
            *coverage.entry(track.key.clone()).or_default() += 1;
            let (prepared, prerequisites) = match matrix::cheat_seed(&seed, &track.key) {
                Ok(seed) => seed,
                Err(error) => {
                    blocked += 1;
                    errors += 1;
                    fixes.push(json!({"category":"native_context","case":id,"file":track.source,"entry":track.key,"field":"prerequisites","reason":error.to_string()}));
                    serde_json::to_writer(
                        &mut writer,
                        &json!({"case":id,"mode":"cheat_reachability","file":track.source,"track":track.key,"error":error.to_string()}),
                    )?;
                    writeln!(writer)?;
                    writer.flush()?;
                    continue;
                }
            };
            let report = walk(&prepared, &track.key, max_states);
            done += usize::from(report.done);
            clean +=
                usize::from(report.done && !report.truncated && report.steps.iter().all(|step| step.error.is_none()));
            blocked += usize::from(!report.done);
            truncated += usize::from(report.truncated);
            let ordinary_status = if ordinary.completed_by_answer.contains(&track.key) {
                "completed_by_answer"
            } else if ordinary.done.contains(&track.key) {
                "done_automatically"
            } else if ordinary.failed.contains(&track.key) {
                "failed"
            } else if ordinary_world.state.story2.tracks.get(&track.key).is_some_and(|t| t.status == Status::Active) {
                "active"
            } else {
                "unreached_by_strategy"
            };
            for step in report.steps.iter().filter(|s| s.error.is_some()) {
                errors += 1;
                fixes.push(json!({"category":"branch_review","case":id,"file":track.source,"entry":track.key,"field":format!("{}.{}",step.chapter,step.branch),"reason":step.error,"path":step.path,"mode":"cheat_reachability"}));
            }
            if !report.done && !report.truncated && report.steps.iter().all(|s| s.error.is_none()) {
                fixes.push(json!({"category":"terminal_unreached","case":id,"file":track.source,"entry":track.key,"field":"branches","reason":"没有到达 done；检查空分支、身份排除或正常失败落点","reached":report.reached}));
            }
            if report.truncated {
                fixes.push(json!({"category":"audit_budget","case":id,"file":track.source,"entry":track.key,"field":"state_budget","reason":"预算耗尽，未证明全部分支"}));
            }
            serde_json::to_writer(
                &mut writer,
                &json!({"case":id,"mode":"cheat_reachability","file":track.source,"prerequisites":prerequisites,"ordinary_status":ordinary_status,"report":report}),
            )?;
            writeln!(writer)?;
            writer.flush()?;
        }
        writer.flush()?;
        drop(writer);
        if let Some(reason) = &ordinary.blocked {
            fixes.push(json!({"category":"ordinary_strategy","case":id,"file":case.request.scenario,"entry":case.key,"field":"ordinary","reason":reason}));
        }
        summaries.push(json!({"case":id,"batch":case.batch,"ordinary":{"done":ordinary.done.len(),"completed_by_answer":ordinary.completed_by_answer.len(),"answered_tracks":ordinary.answered_chapters.len(),"failed":ordinary.failed.len(),"graduated":ordinary.graduated,"blocked":ordinary.blocked,"days":ordinary.until-ordinary.from,"replay_ok":replay_ok,"snapshot_ok":snapshot_ok},"cheat":{"terminal_reached":done,"all_attempted_paths_passed":clean,"blocked":blocked,"truncated":truncated,"excluded":excluded,"branch_errors":errors}}));
        fs::write(output.join("summary.json"), serde_json::to_vec_pretty(&summaries)?)?;
        fs::write(output.join("content-fixes.json"), serde_json::to_vec_pretty(&fixes)?)?;
        fs::write(output.join("coverage.json"), serde_json::to_vec_pretty(&coverage)?)?;
        eprintln!(
            "matrix case={id}: ordinary_done={} cheat_done={done} blocked={blocked} truncated={truncated}",
            ordinary.completed_by_answer.len()
        );
    }
    Ok(())
}
