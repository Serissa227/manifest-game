//! 草稿与运行时共用同一份原生文字字段表，避免翻译校验接受玩法覆盖。
use manifest_core::upbringing::UpbringingDefs;
pub(crate) fn native_upbringing_display(file: &str, text: &str) -> Result<toml::Table, String> {
    let mut d: UpbringingDefs = toml::from_str(text).map_err(|e| e.to_string())?;
    if d.format_version != Some(1) {
        return Err("原生养成格式版本必须为 1".into());
    }
    for f in &mut d.families {
        f.source = file.into();
    }
    for a in &mut d.activities {
        a.source = file.into();
    }
    for a in &mut d.academies {
        a.source = file.into();
        for c in &mut a.curriculum {
            c.source = file.into();
        }
        d.activities.extend(a.curriculum.iter().cloned());
    }
    for c in &mut d.contests {
        c.source = file.into();
    }
    for c in &mut d.crafts {
        c.source = file.into();
    }
    for c in &mut d.festivals {
        c.source = file.into();
    }
    for c in &mut d.excursions {
        c.source = file.into();
    }
    for c in &mut d.exams {
        c.source = file.into();
    }
    for c in &mut d.paths {
        c.source = file.into();
    }
    for c in &mut d.endings {
        c.source = file.into();
    }
    for c in &mut d.poem_lexicons {
        c.source = file.into();
    }
    for c in &mut d.notes {
        c.file = file.into();
    }
    for c in &mut d.tracks {
        c.source = file.into();
    }
    for t in &mut d.act_tides {
        t.source_file = file.into();
    }
    for r in &mut d.act_rumors {
        r.source = file.into();
    }
    for r in &mut d.lines {
        r.source = file.into();
    }
    for r in &mut d.missions {
        r.source = file.into();
    }
    for r in &mut d.act_duties {
        r.source = file.into();
    }
    for r in &mut d.act_greetings {
        r.source = file.into();
    }
    for r in &mut d.act_voyages {
        r.source = file.into();
    }
    for r in &mut d.act_review {
        r.source = file.into();
    }
    for r in &mut d.annual_goals {
        r.source = file.into();
    }
    let mut specs = super::upbringing::specs_of(&d);
    specs.push(super::story2::specs_of(&d.tracks, file));
    display(specs)
}

pub(crate) fn native_history_display(file: &str, text: &str) -> Result<toml::Table, String> {
    let mut d: manifest_core::history::HistoryDefs = toml::from_str(text).map_err(|e| e.to_string())?;
    for e in &mut d.events {
        e.source = file.into();
    }
    for c in &mut d.campaigns {
        c.source = file.into();
    }
    display(vec![super::history::specs_of(&d, file)])
}

pub(crate) fn native_ideas_display(text: &str) -> Result<toml::Table, String> {
    let d: manifest_core::ideas::IdeasDefs = toml::from_str(text).map_err(|e| e.to_string())?;
    display(vec![super::ideas::spec_of(&d)])
}

fn display(specs: Vec<super::FileSpec>) -> Result<toml::Table, String> {
    let mut out = toml::Table::new();
    for spec in specs {
        for (table, entries) in spec.keyed {
            for entry in entries {
                let fields: toml::Table = entry
                    .fields
                    .into_iter()
                    .filter(|(_, s)| !s.is_empty())
                    .map(|(key, value)| (key.into(), toml::Value::String(value)))
                    .collect();
                if fields.is_empty() {
                    continue;
                }
                let target = out.entry(table).or_insert_with(|| toml::Value::Table(toml::Table::new()));
                if let Some(target) = target.as_table_mut()
                    && target.insert(entry.key.clone(), toml::Value::Table(fields)).is_some()
                {
                    return Err(format!("重复的显示键 {table}/{}", entry.key));
                }
            }
        }
    }
    Ok(out)
}
