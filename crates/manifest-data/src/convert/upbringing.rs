//! 养成目录以显式分片顺序读取，定义的闭包由内核统一校验。
use super::{Issues, load_file, per_file};
use crate::worlds::EffectiveWorld;
use manifest_core::upbringing::UpbringingDefs;
pub(super) fn authoring_only(dir: &EffectiveWorld) -> bool {
    // A6 第一轮只支持原生运行态格式；C8 的作者草稿继续由 load_world 的严格草稿校验负责。
    // 标志表是作者契约的一部分，不能把未转换的学院/活动误当成已经接线的月程。
    dir.manifest.draft
        && dir.files_in("upbringing").iter().any(|file| {
            dir.read(file)
                .ok()
                .and_then(|text| toml::from_str::<toml::Table>(&text).ok())
                .is_some_and(|table| table.contains_key("upbringing_rules"))
        })
}

pub(super) fn load(dir: &EffectiveWorld, issues: &mut Issues) -> UpbringingDefs {
    let mut defs = UpbringingDefs::default();
    if !dir.module_enabled("upbringing") || authoring_only(dir) {
        return defs;
    }
    let mut rules_source = None;
    // A3 的身份模板由 scenario::identities 消费，不当作月程活动重复解析。
    let files: Vec<String> = dir
        .files_in("upbringing")
        .into_iter()
        .filter(|file| file != "upbringing/templates.toml" && !file.starts_with("upbringing/templates/"))
        .collect();
    // 各文件分给几个线程解析（连同下面要看的“这个文件写没写通用规则”），再按原顺序逐个合并（结果与逐个解析相同）
    let parsed = per_file(&files, |file, is| {
        let part = load_file::<UpbringingDefs>(dir, file, is)?;
        let has_rules = dir
            .read(file)
            .ok()
            .and_then(|s| toml::from_str::<toml::Table>(&s).ok())
            .is_some_and(|t| t.contains_key("rules"));
        Some((part, has_rules))
    });
    for (file, (part, local)) in files.into_iter().zip(parsed) {
        issues.list.extend(local.list);
        let Some((mut part, has_rules)) = part else {
            continue;
        };
        if part.format_version.is_some_and(|v| v != 1) {
            issues.push(&file, "format_version", "未知原生养成版本");
        }
        if part.format_version.is_some() {
            defs.format_version = part.format_version;
        }
        for n in &mut part.notes {
            n.file = file.clone();
        }
        for c in &mut part.crafts {
            c.source = file.clone();
        }
        for t in &mut part.tracks {
            t.source = file.clone();
        }
        for l in &mut part.poem_lexicons {
            l.source = file.clone();
        }
        for (flag, grant) in part.job_progress_flags {
            if defs.job_progress_flags.insert(flag.clone(), grant).is_some() {
                issues.push(&file, &flag, "打工进度旗标重复");
            }
        }
        defs.notes.extend(part.notes);
        defs.crafts.extend(part.crafts);
        defs.tracks.extend(part.tracks);
        defs.poem_lexicons.extend(part.poem_lexicons);
        for (key, gate) in part.event_gates {
            if defs.event_gates.insert(key.clone(), gate).is_some() {
                issues.push(&file, &key, "短事件门槛重复");
            }
        }
        for (key, cultures) in part.culture_aliases {
            if defs.culture_aliases.insert(key.clone(), cultures).is_some() {
                issues.push(&file, &key, "文化映射重复");
            }
        }
        for (key, profile) in part.skill_profiles {
            if defs.skill_profiles.insert(key.clone(), profile).is_some() {
                issues.push(&file, &key, "技能等级重复");
            }
        }
        if has_rules {
            if let Some(previous) = &rules_source {
                issues.push(&file, "rules", format!("通用规则已在 {previous} 定义，不能重复"));
            } else {
                defs.rules = part.rules;
                rules_source = Some(file.clone());
            }
        }
        for f in &mut part.families {
            f.source = file.clone();
        }
        for a in &mut part.activities {
            a.source = file.clone();
        }
        for academy in &mut part.academies {
            academy.source = file.clone();
            for course in &mut academy.curriculum {
                course.source = file.clone();
                if let Some(person) = course.mentor.as_ref().and_then(|role| academy.mentor_roles.get(role)) {
                    course.mentor = Some(person.clone());
                }
            }
            part.activities.extend(academy.curriculum.iter().cloned());
        }
        for festival in &mut part.festivals {
            festival.source = file.clone();
        }
        for excursion in &mut part.excursions {
            excursion.source = file.clone();
        }
        for (person, skills) in part.helpers {
            if defs.helpers.insert(person.clone(), skills).is_some() {
                issues.push(&file, "helpers", format!("同行技能重复定义：{person}"));
            }
        }
        for (person, levels) in part.helper_levels {
            if defs.helper_levels.insert(person.clone(), levels).is_some() {
                issues.push(&file, &person, "同行技能等级重复定义");
            }
        }
        defs.academies.extend(part.academies);
        defs.festivals.extend(part.festivals);
        defs.excursions.extend(part.excursions);
        for contest in &mut part.contests {
            contest.source = file.clone();
        }
        for e in &mut part.exams {
            e.source = file.clone();
        }
        for p in &mut part.paths {
            p.source = file.clone();
        }
        for e in &mut part.endings {
            e.source = file.clone();
        }
        for g in &mut part.annual_goals {
            g.source = file.clone();
        }
        defs.annual_goals.extend(part.annual_goals);
        defs.exams.extend(part.exams);
        defs.paths.extend(part.paths);
        defs.endings.extend(part.endings);
        defs.contests.extend(part.contests);
        for (family, completion) in part.completions {
            if defs.completions.insert(family.clone(), completion).is_some() {
                issues.push(&file, &family, "结业规则重复定义");
            }
        }
        // U06K1：各分片保留来源；键的闭包与跨片重复由内核统一校验。
        for item in &mut part.lines {
            item.source = file.clone();
        }
        for item in &mut part.act_places {
            item.source = file.clone();
        }
        for item in &mut part.act_timetables {
            item.source = file.clone();
        }
        for item in &mut part.act_duties {
            item.source = file.clone();
        }
        for item in &mut part.act_greetings {
            item.source = file.clone();
        }
        for item in &mut part.act_markers {
            item.source = file.clone();
        }
        defs.lines.extend(part.lines);
        defs.act_places.extend(part.act_places);
        defs.act_timetables.extend(part.act_timetables);
        defs.act_duties.extend(part.act_duties);
        defs.act_greetings.extend(part.act_greetings);
        defs.act_markers.extend(part.act_markers);
        for item in &mut part.act_line_gates {
            item.source = file.clone();
        }
        defs.act_line_gates.extend(part.act_line_gates);
        for item in &mut part.act_medians {
            item.source = file.clone();
        }
        defs.act_medians.extend(part.act_medians);
        for item in &mut part.missions {
            item.source = file.clone();
        }
        defs.missions.extend(part.missions);
        for item in &mut part.act_capital {
            item.source = file.clone();
        }
        defs.act_capital.extend(part.act_capital);
        for item in &mut part.act_review {
            item.source = file.clone();
        }
        defs.act_review.extend(part.act_review);
        for item in &mut part.act_tides {
            item.source_file = file.clone();
        }
        defs.act_tides.extend(part.act_tides);
        for item in &mut part.act_rumors {
            item.source = file.clone();
        }
        defs.act_rumors.extend(part.act_rumors);
        for item in &mut part.act_perks {
            item.source = file.clone();
        }
        defs.act_perks.extend(part.act_perks);
        for item in &mut part.act_voyages {
            item.source = file.clone();
        }
        defs.act_voyages.extend(part.act_voyages);

        defs.families.extend(part.families);
        defs.activities.extend(part.activities);
    }
    for (key, completion) in std::mem::take(&mut defs.completions) {
        if let Some(f) = defs.families.iter_mut().find(|f| f.key == key) {
            if f.completion.is_some() {
                issues.push("upbringing", &key, "结业规则重复定义");
            } else {
                f.completion = Some(completion);
            }
        } else {
            issues.push("upbringing", &key, "结业规则引用未知家庭");
        }
    }
    // 改投学院的派生家庭在结业规则并进来之后生成（派生的结业约定地点要换）。
    defs.derive_routes();
    defs
}
