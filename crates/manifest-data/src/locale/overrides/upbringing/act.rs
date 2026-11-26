//! 行动制显示字段；列表按稳定条目键与原始下标逐句覆盖。
//! 英文身份名用 `[act_review."<family>:home|academy:<i>"] name`；
//! 寒暄用 `[act_greetings."<family>:<person>:<seasons>:<i>"] text`，下标从 0 开始。
use super::super::{FileSpec, Slot, entry};
use super::native::NativeSlot;
use manifest_core::upbringing::UpbringingDefs;
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug)]
pub(crate) enum ActSlot {
    Line(usize),
    Mission(usize),
    Duty(usize),
    Greeting(usize, usize),
    Voyage(usize),
    Place(usize, usize, usize),
    Rank(usize, bool, usize),
    Goal(usize),
}

pub(super) fn fields(mut spec: FileSpec, u: &UpbringingDefs, source: &str) -> FileSpec {
    let mut tables = BTreeMap::<&'static str, Vec<super::super::Entry>>::new();
    let mut add = |table: &'static str, key: String, slot: ActSlot, fields: Vec<(&'static str, &String)>| {
        tables.entry(table).or_default().push(entry(&key, Slot::UpbringingNative(NativeSlot::Act(slot)), &fields));
    };
    for (i, line) in u.lines.iter().enumerate().filter(|(_, v)| v.source == source) {
        add("lines", line.key.clone(), ActSlot::Line(i), vec![("name", &line.name)]);
    }
    for (i, m) in u.missions.iter().enumerate().filter(|(_, v)| v.source == source) {
        add("missions", m.key.clone(), ActSlot::Mission(i), vec![("text", &m.text)]);
    }
    for (i, d) in u.act_duties.iter().enumerate().filter(|(_, v)| v.source == source) {
        add("act_duties", d.key.clone(), ActSlot::Duty(i), vec![("name", &d.name), ("desc", &d.desc)]);
    }
    for (i, g) in u.act_greetings.iter().enumerate().filter(|(_, v)| v.source == source) {
        let seasons = g.seasons.iter().map(u8::to_string).collect::<Vec<_>>().join(",");
        for (j, text) in g.lines.iter().enumerate() {
            add(
                "act_greetings",
                format!("{}:{}:{seasons}:{j}", g.family, g.person),
                ActSlot::Greeting(i, j),
                vec![("text", text)],
            );
        }
    }
    for (i, v) in u.act_voyages.iter().enumerate().filter(|(_, v)| v.source == source) {
        add("act_voyages", v.key.clone(), ActSlot::Voyage(i), vec![("name", &v.name), ("desc", &v.desc)]);
        for (j, leg) in v.legs.iter().enumerate() {
            for (k, p) in leg.places.iter().enumerate() {
                let mut fields = vec![("name", &p.name)];
                if let Some(hint) = &p.hint {
                    fields.push(("hint", hint));
                }
                add("voyage_places", format!("{}:{j}:{}", v.key, p.key), ActSlot::Place(i, j, k), fields);
            }
        }
    }
    for (i, r) in u.act_review.iter().enumerate().filter(|(_, v)| v.source == source) {
        for (home, kind, names) in [(true, "home", &r.rank_names_home), (false, "academy", &r.rank_names_academy)] {
            for (j, text) in names.iter().enumerate() {
                add("act_review", format!("{}:{kind}:{j}", r.family), ActSlot::Rank(i, home, j), vec![("name", text)]);
            }
        }
    }
    for (i, g) in u.annual_goals.iter().enumerate().filter(|(_, v)| v.source == source) {
        add("annual_goals", g.key.clone(), ActSlot::Goal(i), vec![("text", &g.text)]);
    }
    for (name, entries) in tables {
        spec = spec.table(name, entries);
    }
    spec
}

pub(crate) fn list_index(slot: ActSlot) -> Option<usize> {
    match slot {
        ActSlot::Greeting(_, j) | ActSlot::Rank(_, _, j) => Some(j),
        _ => None,
    }
}

pub(super) fn apply(u: &mut UpbringingDefs, slot: ActSlot, field: &str, text: String) {
    match slot {
        ActSlot::Line(i) => u.lines[i].name = text,
        ActSlot::Mission(i) => u.missions[i].text = text,
        ActSlot::Duty(i) => match field {
            "name" => u.act_duties[i].name = text,
            _ => u.act_duties[i].desc = text,
        },
        ActSlot::Greeting(i, j) => u.act_greetings[i].lines[j] = text,
        ActSlot::Voyage(i) => match field {
            "name" => u.act_voyages[i].name = text,
            _ => u.act_voyages[i].desc = text,
        },
        ActSlot::Place(i, j, k) => {
            let p = &mut u.act_voyages[i].legs[j].places[k];
            match field {
                "name" => p.name = text,
                _ => p.hint = Some(text),
            }
        }
        ActSlot::Rank(i, home, j) => {
            if home {
                u.act_review[i].rank_names_home[j] = text;
            } else {
                u.act_review[i].rank_names_academy[j] = text;
            }
        }
        ActSlot::Goal(i) => u.annual_goals[i].text = text,
    }
}
