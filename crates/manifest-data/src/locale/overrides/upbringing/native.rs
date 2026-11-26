//! C8 附表按稳定键和下标覆盖文字，不允许覆盖门槛或私有分值。
use super::{FileSpec, Slot, entry};
use manifest_core::{StaticData, contests::Params};
use std::collections::BTreeMap;
#[derive(Clone, Copy, Debug)]
pub(crate) enum NativeSlot {
    Note(usize),
    Craft(usize),
    Phase(usize, usize),
    Visit(usize, usize),
    Club(usize, usize),
    Handbook(usize, u8),
    Step(usize, usize, usize),
    Lexicon(usize),
    Word(usize, usize),
    Poem(usize),
    Match(usize, usize),
    Capital(bool, usize, u8, usize),
    YouthName(usize),
    CallYou(usize, usize),
    ActTide(usize),
    ActRumor(usize),
    Act(super::act::ActSlot),
}
pub(super) fn fields(mut spec: FileSpec, u: &manifest_core::upbringing::UpbringingDefs, source: &str) -> FileSpec {
    let mut tables: BTreeMap<&'static str, Vec<super::super::Entry>> = BTreeMap::new();
    let mut add = |table: &'static str, key: String, slot: NativeSlot, fields: Vec<(&'static str, &String)>| {
        tables.entry(table).or_default().push(entry(&key, Slot::UpbringingNative(slot), &fields));
    };
    // 空称呼继续沿用主角姓名，不增加翻译缺项；人物键只取原表，不允许译文新增身份。
    for (i, family) in u.families.iter().enumerate().filter(|(_, f)| f.source == source) {
        if !family.youth_name.trim().is_empty() {
            add("family_youth_names", family.key.clone(), NativeSlot::YouthName(i), vec![("name", &family.youth_name)]);
        }
        for (j, (person, name)) in family.call_you.iter().enumerate() {
            if !name.trim().is_empty() {
                add(
                    "family_call_you",
                    format!("{}:{person}", family.key),
                    NativeSlot::CallYou(i, j),
                    vec![("name", name)],
                );
            }
        }
    }
    for (i, n) in u
        .notes
        .iter()
        .enumerate()
        .filter(|(_, n)| n.file == source && !n.source.split(':').any(|p| matches!(p, "sources" | "basis")))
    {
        add("notes", n.key.clone(), NativeSlot::Note(i), vec![("text", &n.text)]);
    }
    for (i, c) in u.crafts.iter().enumerate().filter(|(_, c)| c.source == source) {
        add(
            "crafts",
            c.key.clone(),
            NativeSlot::Craft(i),
            vec![("name", &c.name), ("failure", &c.failure), ("note", &c.note)],
        );
    }
    for (i, a) in u.academies.iter().enumerate().filter(|(_, a)| a.source == source) {
        for (j, p) in a.phases.iter().enumerate() {
            add("academy_phases", format!("{}:{j}", a.key), NativeSlot::Phase(i, j), vec![("name", &p.name)]);
        }
        for (j, v) in a.visits.iter().enumerate() {
            add("academy_visits", format!("{}:{j}", a.key), NativeSlot::Visit(i, j), vec![("note", &v.note)]);
        }
        for (j, c) in a.clubs.iter().enumerate() {
            add(
                "academy_clubs",
                format!("{}:{j}", a.key),
                NativeSlot::Club(i, j),
                vec![("name", &c.name), ("synopsis", &c.synopsis)],
            );
        }
        if let Some(w) = &a.who {
            for (index, value) in [&w.access_note, &w.alternative.note].into_iter().enumerate() {
                add(
                    "academy_handbook",
                    format!("{}:{index}", a.key),
                    NativeSlot::Handbook(i, index as u8),
                    vec![("text", value)],
                );
            }
        }
        if let Some(r) = &a.rules {
            for (index, value) in [&r.late.note, &r.fighting.note, &r.night_absence.note].into_iter().enumerate() {
                add(
                    "academy_handbook",
                    format!("{}:{}", a.key, index + 2),
                    NativeSlot::Handbook(i, index as u8 + 2),
                    vec![("text", value)],
                );
            }
        }
    }
    for (i, e) in u.excursions.iter().enumerate().filter(|(_, e)| e.source == source) {
        for (j, n) in e.nodes.iter().enumerate() {
            for (k, s) in n.steps.iter().enumerate() {
                add(
                    "outing_steps",
                    format!("{}:{}:{}", e.key, n.key, s.key),
                    NativeSlot::Step(i, j, k),
                    vec![("name", &s.name), ("text", &s.text)],
                );
            }
        }
    }
    for (i, l) in u.poem_lexicons.iter().enumerate().filter(|(_, l)| l.source == source) {
        add("poem_lexicons", l.key.clone(), NativeSlot::Lexicon(i), vec![("name", &l.name)]);
        for (j, w) in l.words.iter().enumerate() {
            add("poem_words", format!("{}:{}", l.key, w.key), NativeSlot::Word(i, j), vec![("text", &w.text)]);
        }
    }
    for (i, c) in u.contests.iter().enumerate().filter(|(_, c)| c.source == source) {
        if let Some(note) = c.poem.as_ref().and_then(|p| p.compose.note.as_ref()) {
            add("poem_notes", c.key.clone(), NativeSlot::Poem(i), vec![("text", note)]);
        }
        // C8 的 pairs 明确使用作者文字；第一轮配对牌面仍是不可翻译的资源键。
        if let Params::Match(p) = &c.params
            && c.scoring.authored_kind.as_deref() == Some("pairs")
        {
            for (j, f) in p.faces.iter().enumerate() {
                add("match_texts", format!("{}:face:{j}", c.key), NativeSlot::Match(i, j), vec![("text", f)]);
            }
        }
    }
    let capitals = u
        .families
        .iter()
        .enumerate()
        .filter(|(_, f)| f.source == source)
        .filter_map(|(i, f)| f.completion.as_ref().map(|c| (true, i, &f.key, &c.capital)))
        .chain(
            u.paths.iter().enumerate().filter(|(_, p)| p.source == source).map(|(i, p)| (false, i, &p.key, &p.capital)),
        );
    for (family, i, key, capital) in capitals {
        let table = if family { "families" } else { "paths" };
        for (j, m) in capital.mementos.iter().enumerate() {
            add(
                "capital_mementos",
                format!("{table}:{key}:{j}"),
                NativeSlot::Capital(family, i, 0, j),
                vec![("name", &m.name), ("description", &m.description)],
            );
        }
        for (kind, name, list) in [(1, "known", &capital.known), (2, "rumored", &capital.rumored)] {
            for (j, a) in list.iter().enumerate() {
                add(
                    "capital_knowledge",
                    format!("{table}:{key}:{name}:{j}"),
                    NativeSlot::Capital(family, i, kind, j),
                    vec![("name", &a.name)],
                );
            }
        }
    }
    for (i, tide) in u.act_tides.iter().enumerate().filter(|(_, t)| t.source_file == source) {
        let fields: Vec<_> = [("name", tide.name.as_ref()), ("desc", tide.desc.as_ref())]
            .into_iter()
            .filter_map(|(field, text)| text.map(|text| (field, text)))
            .collect();
        if !fields.is_empty() {
            add("act_tides", format!("{}:{}", tide.port, tide.key), NativeSlot::ActTide(i), fields);
        }
    }
    for (i, rumor) in u.act_rumors.iter().enumerate().filter(|(_, r)| r.source == source) {
        if let Some(text) = &rumor.text {
            add("act_rumors", rumor.key.clone(), NativeSlot::ActRumor(i), vec![("text", text)]);
        }
    }
    for (name, entries) in tables {
        spec = spec.table(name, entries);
    }
    spec
}
pub(crate) fn apply(d: &mut StaticData, slot: NativeSlot, field: &str, value: String) {
    let u = &mut d.upbringing;
    match slot {
        NativeSlot::YouthName(i) => u.families[i].youth_name = value,
        NativeSlot::CallYou(i, j) => {
            if let Some(name) = u.families[i].call_you.values_mut().nth(j) {
                *name = value;
            }
        }
        NativeSlot::Capital(family, i, kind, j) => {
            let capital = if family {
                u.families.get_mut(i).and_then(|f| f.completion.as_mut()).map(|c| &mut c.capital)
            } else {
                u.paths.get_mut(i).map(|p| &mut p.capital)
            };
            if let Some(c) = capital {
                match kind {
                    0 if field == "name" => c.mementos[j].name = value,
                    0 => c.mementos[j].description = value,
                    1 => c.known[j].name = value,
                    2 => c.rumored[j].name = value,
                    _ => {}
                }
            }
        }
        NativeSlot::Note(i) => u.notes[i].text = value,
        NativeSlot::Craft(i) => match field {
            "name" => u.crafts[i].name = value,
            "failure" => u.crafts[i].failure = value,
            "note" => u.crafts[i].note = value,
            _ => {}
        },
        NativeSlot::Phase(i, j) => u.academies[i].phases[j].name = value,
        NativeSlot::Visit(i, j) => u.academies[i].visits[j].note = value,
        NativeSlot::Club(i, j) => match field {
            "name" => u.academies[i].clubs[j].name = value,
            "synopsis" => u.academies[i].clubs[j].synopsis = value,
            _ => {}
        },
        NativeSlot::Handbook(i, k) => match k {
            0 => {
                if let Some(w) = &mut u.academies[i].who {
                    w.access_note = value
                }
            }
            1 => {
                if let Some(w) = &mut u.academies[i].who {
                    w.alternative.note = value
                }
            }
            2..=4 => {
                if let Some(r) = &mut u.academies[i].rules {
                    match k {
                        2 => r.late.note = value,
                        3 => r.fighting.note = value,
                        _ => r.night_absence.note = value,
                    }
                }
            }
            _ => {}
        },
        NativeSlot::Step(i, j, k) => match field {
            "name" => u.excursions[i].nodes[j].steps[k].name = value,
            "text" => u.excursions[i].nodes[j].steps[k].text = value,
            _ => {}
        },
        NativeSlot::Lexicon(i) => u.poem_lexicons[i].name = value,
        NativeSlot::Word(i, j) => u.poem_lexicons[i].words[j].text = value,
        NativeSlot::Poem(i) => {
            if let Some(p) = &mut u.contests[i].poem {
                p.compose.note = Some(value)
            }
        }
        NativeSlot::Match(i, j) => {
            if let Params::Match(p) = &mut u.contests[i].params {
                p.faces[j] = value
            }
        }
        NativeSlot::ActTide(i) => match field {
            "name" => u.act_tides[i].name = Some(value),
            "desc" => u.act_tides[i].desc = Some(value),
            _ => {}
        },
        NativeSlot::ActRumor(i) => u.act_rumors[i].text = Some(value),
        NativeSlot::Act(slot) => super::act::apply(u, slot, field, value),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::locale::overrides::{Missing, Override, apply as apply_override, missing_of, read_tables};
    use std::{collections::BTreeSet, sync::OnceLock};

    fn youth_defs() -> StaticData {
        static BASE: OnceLock<StaticData> = OnceLock::new();
        let mut defs = BASE
            .get_or_init(|| (*crate::load_world(&crate::find_data_dir().unwrap(), "terra16").unwrap()).clone())
            .clone();
        let family = defs.upbringing.families.iter_mut().find(|f| f.key == "mio").unwrap();
        family.youth_name = "base_youth".into();
        // 先出现的空值不能令后一个人物的翻译下标错位。
        family.call_you = BTreeMap::from([("ase".into(), String::new()), ("noel".into(), "base_call".into())]);
        defs
    }

    fn overlay(table: &str, key: &str, value: toml::Value) -> toml::Table {
        toml::Table::from_iter([(
            table.into(),
            toml::Value::Table(toml::Table::from_iter([(
                key.into(),
                toml::Value::Table(toml::Table::from_iter([("name".into(), value)])),
            )])),
        )])
    }

    fn read(defs: &StaticData, table: toml::Table) -> (Vec<Override>, Vec<crate::DataIssue>, Vec<Missing>) {
        let source = &defs.upbringing.family("mio").unwrap().source;
        let spec = super::super::specs_of(&defs.upbringing).into_iter().find(|s| &s.rel == source).unwrap();
        let mut out = Vec::new();
        let mut issues = Vec::new();
        let mut covered = BTreeSet::new();
        read_tables(&spec, table, source, &mut out, &mut BTreeMap::new(), &mut covered, &mut issues);
        let mut missing = Vec::new();
        missing_of(&spec, source, &covered, &BTreeSet::new(), &mut missing);
        (out, issues, missing)
    }

    fn youth_missing(missing: &[Missing]) -> usize {
        missing
            .iter()
            .filter(|m| m.item.starts_with("family_youth_names[") || m.item.starts_with("family_call_you["))
            .count()
    }

    #[test]
    fn youth_overrides_only_translate_existing_nonblank_text_and_preserve_gameplay() {
        let base = youth_defs();
        let (_, issues, missing) = read(&base, toml::Table::new());
        assert!(issues.is_empty());
        assert_eq!(youth_missing(&missing), 2);
        let youth = "é".repeat(20);
        let mut table = overlay("family_youth_names", "mio", toml::Value::String(youth.clone()));
        table.extend(overlay("family_call_you", "mio:noel", toml::Value::String("call_u01".into())));
        let (out, issues, missing) = read(&base, table);
        assert!(issues.is_empty(), "{issues:?}");
        assert_eq!(out.len(), 2);
        assert_eq!(youth_missing(&missing), 0);
        let mut localized = base.clone();
        for change in out {
            apply_override(&mut localized, &change);
        }
        let mut expected = base.upbringing.clone();
        let family = expected.families.iter_mut().find(|f| f.key == "mio").unwrap();
        family.youth_name = youth;
        family.call_you.insert("noel".into(), "call_u01".into());
        assert_eq!(format!("{:?}", localized.upbringing), format!("{expected:?}"));
        assert_eq!(localized.meta.hash, base.meta.hash);

        let mut blank = base.clone();
        let family = blank.upbringing.families.iter_mut().find(|f| f.key == "mio").unwrap();
        family.youth_name.clear();
        family.call_you.values_mut().for_each(String::clear);
        let (_, issues, missing) = read(&blank, toml::Table::new());
        assert!(issues.is_empty());
        assert_eq!(youth_missing(&missing), 0);
    }

    #[test]
    fn youth_overrides_reject_long_control_empty_and_unknown_identity_or_gameplay_fields() {
        let base = youth_defs();
        for (table, key) in [("family_youth_names", "mio"), ("family_call_you", "mio:noel")] {
            for value in [
                toml::Value::String("é".repeat(21)),
                toml::Value::String("a\nb".into()),
                toml::Value::String(String::new()),
                toml::Value::Integer(1),
            ] {
                let (out, issues, missing) = read(&base, overlay(table, key, value));
                assert!(out.is_empty());
                assert!(!issues.is_empty(), "{table}/{key}");
                assert_eq!(youth_missing(&missing), 2);
            }
        }
        for table in [
            overlay("family_youth_names", "unknown_family_u01", toml::Value::String("value".into())),
            overlay("family_call_you", "mio:unknown_person_u01", toml::Value::String("value".into())),
            "[families.mio]\ninitial_points = { seamanship = 9 }".parse().unwrap(),
        ] {
            let (out, issues, _) = read(&base, table);
            assert!(out.is_empty());
            assert!(!issues.is_empty());
        }
    }
}
