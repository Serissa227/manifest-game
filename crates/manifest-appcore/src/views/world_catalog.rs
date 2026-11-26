//! I1 开局目录；使用作者公开卡片，旧世界没有卡片时保持原字段与回退。

use super::{ScenarioGoalView, StaticView};
use crate::state::world_registry::WorldResources;
use manifest_core::scenario::{Gender, WorldDate};
use manifest_data::Locale;
use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
pub struct WorldCatalog {
    pub current: Option<String>,
    pub worlds: Vec<WorldCard>,
}

#[derive(Clone, Debug, Serialize)]
pub struct WorldCard {
    pub key: String,
    pub languages: Vec<String>,
    pub name: String,
    pub name_en: String,
    pub tagline: String,
    pub description: String,
    pub map_key: String,
    pub era: String,
    pub start_year: i64,
    pub currency: String,
    pub months: Vec<u16>,
    pub modules: Vec<String>,
    pub scenarios: Vec<ScenarioCard>,
}

#[derive(Clone, Debug, Serialize)]
pub struct ScenarioCard {
    pub key: String,
    pub name: String,
    pub name_en: String,
    pub description: String,
    pub start_date: WorldDate,
    pub control_date: WorldDate,
    pub upbringing: bool,
    pub protagonists: Vec<ProtagonistCard>,
    pub templates: Vec<TemplateCard>,
    pub goal: ScenarioGoalView,
    pub options: ScenarioOptions,
}

#[derive(Clone, Debug, Serialize)]
pub struct ScenarioOptions {
    pub history_toggle: bool,
    pub skip_upbringing: bool,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct AcademyCard {
    pub key: String,
    pub name: String,
    pub city: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct PortraitCard {
    pub from_age: u32,
    pub asset: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct BondCard {
    pub person: String,
    pub name: String,
    pub kind: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct ProtagonistCard {
    pub key: String,
    pub name: String,
    pub name_en: Option<String>,
    pub gender: Gender,
    pub born: WorldDate,
    pub home: String,
    pub region: String,
    pub tagline: String,
    pub style: String,
    pub playstyle: String,
    pub tags: Vec<String>,
    pub difficulty: u8,
    pub strengths: Vec<String>,
    pub start_ship: String,
    pub known: Vec<String>,
    pub academy: AcademyCard,
    pub keepsake: String,
    pub portraits: Vec<PortraitCard>,
    pub bonds: Vec<BondCard>,
}

#[derive(Clone, Debug, Serialize)]
pub struct TemplateCard {
    pub key: String,
    pub name: String,
    pub home: String,
    pub family: String,
    pub activities: String,
    pub style: String,
    pub known: Vec<String>,
    pub academy: AcademyCard,
}

pub fn world_card(resources: &WorldResources, locale: Locale) -> WorldCard {
    let StaticView { world, scenarios, .. } = resources.static_view(locale);
    let ctx = resources.locales.ctx(locale);
    let label = |key: &str, zh: &str| ctx.tr.and_then(|(_, b)| b.texts.get(key)).unwrap_or(zh).to_owned();
    let classic = world.key == "classic";
    let cards = ctx
        .names
        .scenarios
        .iter()
        .zip(scenarios)
        .map(|(sc, view)| {
            let home = ctx.names.loc(sc.start_loc).name.clone();
            ScenarioCard {
                key: view.key.clone(),
                name: view.name.clone(),
                name_en: view.name_en.clone(),
                description: view.description.clone(),
                start_date: sc.start_date,
                control_date: sc.control_date,
                upbringing: sc.upbringing,
                goal: view.goal.clone(),
                options: ScenarioOptions { history_toggle: sc.timeline.is_some(), skip_upbringing: sc.upbringing },
                protagonists: sc
                    .protagonist_defs
                    .iter()
                    .filter(|p| sc.protagonists.contains(&p.key))
                    .map(|p| {
                        let fallback = manifest_core::scenario::OpeningCard {
                            name: p.key.clone(),
                            home: home.clone(),
                            difficulty: 1,
                            start_ship: sc
                                .ships
                                .first()
                                .map(|id| ctx.names.ships[id.idx()].name.clone())
                                .unwrap_or_default(),
                            ..Default::default()
                        };
                        let c = p.card.as_ref().unwrap_or(&fallback);
                        ProtagonistCard {
                            key: p.key.clone(),
                            name: c.name.clone(),
                            name_en: c.name_en.clone(),
                            gender: p.gender,
                            born: p.born,
                            home: c.home.clone(),
                            region: c.region.clone(),
                            tagline: c.tagline.clone(),
                            style: c.style.clone(),
                            playstyle: c.playstyle.clone(),
                            tags: c.tags.clone(),
                            difficulty: c.difficulty,
                            strengths: c.strengths.clone(),
                            start_ship: c.start_ship.clone(),
                            known: c.known.clone(),
                            keepsake: c.keepsake.clone(),
                            academy: AcademyCard {
                                key: c.academy.key.clone(),
                                name: c.academy.name.clone(),
                                city: c.academy.city.clone(),
                            },
                            portraits: c
                                .portraits
                                .iter()
                                .map(|p| PortraitCard { from_age: p.from_age, asset: p.asset.clone() })
                                .collect(),
                            bonds: c
                                .bonds
                                .iter()
                                .map(|b| BondCard {
                                    person: b.person.clone(),
                                    name: b.name.clone(),
                                    kind: b.kind.clone(),
                                })
                                .collect(),
                        }
                    })
                    .collect(),
                templates: sc
                    .templates
                    .iter()
                    .map(|key| {
                        let fallback = manifest_core::scenario::OpeningCard {
                            name: key.clone(),
                            home: home.clone(),
                            ..Default::default()
                        };
                        let c = sc
                            .template_defs
                            .iter()
                            .find(|t| &t.key == key)
                            .and_then(|t| t.card.as_ref())
                            .unwrap_or(&fallback);
                        TemplateCard {
                            key: key.clone(),
                            name: c.name.clone(),
                            home: c.home.clone(),
                            family: c.family.clone(),
                            activities: c.activities.clone(),
                            style: c.style.clone(),
                            known: c.known.clone(),
                            academy: AcademyCard {
                                key: c.academy.key.clone(),
                                name: c.academy.name.clone(),
                                city: c.academy.city.clone(),
                            },
                        }
                    })
                    .collect(),
            }
        })
        .collect();
    WorldCard {
        key: world.key.clone(),
        languages: world.languages.clone(),
        name: world.name.clone(),
        name_en: resources.static_view(Locale::En).world.name.clone(),
        tagline: if classic {
            label("app.classic_tagline", "从一艘船开始远航")
        } else {
            resources.catalog_text(locale).tagline.clone()
        },
        description: if classic {
            label("app.classic_description", "在群岛间贸易、探索与经营。")
        } else {
            resources.catalog_text(locale).blurb.clone()
        },
        map_key: world.map_key.clone(),
        era: world.era.clone(),
        start_year: world.start_year,
        currency: world.currency.clone(),
        months: world.calendar.months.clone(),
        modules: world.modules.clone(),
        scenarios: cards,
    }
}
