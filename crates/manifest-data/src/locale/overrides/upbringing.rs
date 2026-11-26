//! 养成文字覆盖按原生分片定位，所有引用、坐标、日期和奖励只读。
pub(super) mod act;
mod milestones;
pub(super) mod native;
mod poem;
use super::{FileSpec, Slot, entry};
use manifest_core::StaticData;
use std::collections::BTreeSet;
pub(super) fn specs(defs: &StaticData) -> Vec<FileSpec> {
    specs_of(&defs.upbringing)
}
pub(super) fn specs_of(d: &manifest_core::upbringing::UpbringingDefs) -> Vec<FileSpec> {
    let sources = d
        .families
        .iter()
        .map(|f| &f.source)
        .chain(d.contests.iter().map(|c| &c.source))
        .chain(d.activities.iter().map(|a| &a.source))
        .chain(d.academies.iter().map(|a| &a.source))
        .chain(d.festivals.iter().map(|a| &a.source))
        .chain(d.excursions.iter().map(|a| &a.source))
        .chain(d.exams.iter().map(|a| &a.source))
        .chain(d.paths.iter().map(|a| &a.source))
        .chain(d.endings.iter().map(|a| &a.source))
        .chain(d.notes.iter().map(|n| &n.file))
        .chain(d.crafts.iter().map(|c| &c.source))
        .chain(d.poem_lexicons.iter().map(|l| &l.source))
        .chain(d.act_tides.iter().map(|t| &t.source_file))
        .chain(d.act_rumors.iter().map(|r| &r.source))
        .chain(d.lines.iter().map(|r| &r.source))
        .chain(d.missions.iter().map(|r| &r.source))
        .chain(d.act_duties.iter().map(|r| &r.source))
        .chain(d.act_greetings.iter().map(|r| &r.source))
        .chain(d.act_voyages.iter().map(|r| &r.source))
        .chain(d.act_review.iter().map(|r| &r.source))
        .chain(d.annual_goals.iter().map(|r| &r.source))
        .filter(|s| !s.is_empty())
        .collect::<BTreeSet<_>>();
    sources
        .into_iter()
        .map(|source| {
            let families = d.families.iter().enumerate().filter(|(_, f)| &f.source == source);
            let academies = d.academies.iter().enumerate().filter(|(_, a)| &a.source == source);
            let excursions = d.excursions.iter().enumerate().filter(|(_, a)| &a.source == source);
            let place = |key: &str, slot: Slot, p: &manifest_core::upbringing::PlaceDef| {
                let mut fields = vec![("name", &p.name)];
                if let Some(hint) = &p.hint {
                    fields.push(("hint", hint));
                }
                entry(key, slot, &fields)
            };
            act::fields(native::fields(FileSpec::new(source), d, source), d, source)
                .upbringing_poem(d, source)
                .upbringing_milestones(d, source)
                .table(
                    "contests",
                    d.contests
                        .iter()
                        .enumerate()
                        .filter(|(_, c)| &c.source == source)
                        .map(|(i, c)| entry(&c.key, Slot::UpbringingContest(i), &[("name", &c.name)]))
                        .collect(),
                )
                .table(
                    "families",
                    families
                        .clone()
                        .map(|(i, f)| entry(&f.key, Slot::UpbringingFamily(i), &[("name", &f.name)]))
                        .collect(),
                )
                .table(
                    "stages",
                    families
                        .clone()
                        .flat_map(|(i, f)| {
                            f.stages.iter().enumerate().map(move |(j, s)| {
                                entry(&format!("{}:{j}", f.key), Slot::UpbringingStage(i, j), &[("name", &s.name)])
                            })
                        })
                        .collect(),
                )
                .table(
                    "activities",
                    d.activities
                        .iter()
                        .enumerate()
                        .filter(|(_, a)| &a.source == source)
                        .map(|(i, a)| {
                            let mut fields = vec![("name", &a.name), ("description", &a.description)];
                            if let Some(tier) = &a.tier {
                                fields.push(("tier_name", &tier.name));
                            }
                            entry(&a.key, Slot::UpbringingActivity(i), &fields)
                        })
                        .collect(),
                )
                .table(
                    "academies",
                    academies
                        .clone()
                        .map(|(i, a)| entry(&a.key, Slot::UpbringingAcademy(i), &[("name", &a.name)]))
                        .collect(),
                )
                .table(
                    "places",
                    families
                        .flat_map(|(i, f)| {
                            f.places
                                .iter()
                                .enumerate()
                                .map(move |(j, p)| place(&p.key, Slot::UpbringingFamilyPlace(i, j), p))
                        })
                        .chain(academies.clone().flat_map(|(i, a)| {
                            a.places
                                .iter()
                                .enumerate()
                                .map(move |(j, p)| place(&p.key, Slot::UpbringingAcademyPlace(i, j), p))
                        }))
                        .collect(),
                )
                .table(
                    "calendar",
                    academies
                        .flat_map(|(i, a)| {
                            a.calendar.iter().enumerate().map(move |(j, m)| {
                                entry(
                                    &format!("{}:{}", a.key, m.key),
                                    Slot::UpbringingCalendar(i, j),
                                    &[("name", &m.name)],
                                )
                            })
                        })
                        .collect(),
                )
                .table(
                    "festivals",
                    d.festivals
                        .iter()
                        .enumerate()
                        .filter(|(_, f)| &f.source == source)
                        .map(|(i, f)| {
                            entry(
                                &f.key,
                                Slot::UpbringingFestival(i),
                                &[
                                    ("name", &f.name),
                                    ("customs", &f.customs),
                                    ("gift_custom", &f.gift_custom),
                                    ("date_note", &f.date_note),
                                ],
                            )
                        })
                        .collect(),
                )
                .table(
                    "excursions",
                    excursions
                        .clone()
                        .map(|(i, e)| entry(&e.key, Slot::UpbringingExcursion(i), &[("name", &e.name)]))
                        .collect(),
                )
                .table(
                    "nodes",
                    excursions
                        .flat_map(|(i, e)| {
                            e.nodes.iter().enumerate().map(move |(j, n)| {
                                let mut fields = vec![("name", &n.name)];
                                if let Some(h) = &n.hint {
                                    fields.push(("hint", h));
                                }
                                entry(&format!("{}:{}", e.key, n.key), Slot::UpbringingNode(i, j), &fields)
                            })
                        })
                        .collect(),
                )
        })
        .collect()
}

impl FileSpec {
    fn upbringing_poem(self, defs: &manifest_core::upbringing::UpbringingDefs, source: &str) -> Self {
        poem::fields(self, defs, source)
    }
}
