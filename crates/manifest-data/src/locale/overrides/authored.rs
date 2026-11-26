//! C2 道路的途经名称数组与说明；显示覆盖仍经过精确字段校验。
use super::{DataIssue, Missing, Source};
use manifest_core::StaticData;

pub(super) fn apply(
    dir: &Source<'_>,
    root: &Source<'_>,
    prefix: &str,
    defs: &mut StaticData,
    issues: &mut Vec<DataIssue>,
    missing: &mut Vec<Missing>,
) {
    opening_cards(dir, root, prefix, defs, issues);
    if defs.geography.places.authored.roads.is_empty() {
        return;
    }
    let logical = "world/roads.toml";
    let file = format!("{prefix}/{logical}");
    let source = match dir.join(logical).read() {
        Ok(text) => text,
        Err(message) => {
            issues.push(DataIssue { file, item: "roads".into(), message });
            return;
        }
    };
    let english = match root.join(logical).read() {
        Ok(text) => text,
        Err(_) => {
            missing.extend(
                defs.geography
                    .places
                    .authored
                    .roads
                    .keys()
                    .map(|key| Missing { file: file.clone(), item: format!("roads.{key}") }),
            );
            return;
        }
    };
    if let Err(error) = crate::worlds::validate_draft_translation(logical, &source, &english) {
        issues.push(DataIssue { file, item: "roads".into(), message: error.to_string() });
        return;
    }
    let values: toml::Value = match toml::from_str(&english) {
        Ok(values) => values,
        Err(error) => {
            issues.push(DataIssue { file, item: "roads".into(), message: error.to_string() });
            return;
        }
    };
    for (key, road) in &mut defs.geography.places.authored.roads {
        if let Some(row) = values.get("roads").and_then(|r| r.get(key)) {
            if let Some(lore) = row.get("lore").and_then(toml::Value::as_str) {
                road.lore = lore.into();
            }
            if let Some(via) = row.get("via").and_then(toml::Value::as_array) {
                road.via = via.iter().filter_map(toml::Value::as_str).map(str::to_owned).collect();
            }
        }
    }
}

fn opening_cards(
    dir: &Source<'_>,
    root: &Source<'_>,
    prefix: &str,
    defs: &mut StaticData,
    issues: &mut Vec<DataIssue>,
) {
    let logical = "opening_catalog.toml";
    let Ok(source) = dir.join(logical).read() else { return };
    for (name, overlay) in root.data_overlays(logical) {
        let Ok(english) = overlay.read() else { continue };
        let file = format!("{prefix}/{name}");
        if let Err(error) = crate::worlds::validate_draft_translation(logical, &source, &english) {
            issues.push(DataIssue { file, item: "opening_catalog".into(), message: error.to_string() });
            continue;
        }
        let Ok(values) = toml::from_str::<toml::Value>(&english) else { continue };
        for scenario in &mut defs.scenarios {
            for card in scenario
                .protagonist_defs
                .iter_mut()
                .filter_map(|p| p.card.as_mut())
                .chain(scenario.template_defs.iter_mut().filter_map(|t| t.card.as_mut()))
            {
                let Some(text) =
                    values.get("opening_catalog").and_then(|v| v.get(&card.key)).and_then(|v| v.get("card"))
                else {
                    continue;
                };
                let result = (|| -> Result<_, String> {
                    let mut value = toml::Value::try_from(&*card).map_err(|e| e.to_string())?;
                    fn merge(target: &mut toml::Value, overlay: toml::Value) {
                        match (target, overlay) {
                            (toml::Value::Table(target), toml::Value::Table(overlay)) => {
                                for (key, value) in overlay {
                                    merge(target.entry(key).or_insert_with(|| value.clone()), value);
                                }
                            }
                            (toml::Value::Array(target), toml::Value::Array(overlay)) => {
                                for (target, value) in target.iter_mut().zip(overlay) {
                                    merge(target, value);
                                }
                            }
                            (target, value) => *target = value,
                        }
                    }
                    merge(&mut value, text.clone());
                    value.try_into().map_err(|e: toml::de::Error| e.to_string())
                })();
                match result {
                    Ok(translated) => *card = translated,
                    Err(error) => issues.push(DataIssue {
                        file: file.clone(),
                        item: card.key.clone(),
                        message: error.to_string(),
                    }),
                }
            }
        }
    }
}

pub(super) fn derived_mates(defs: &mut StaticData) {
    for person in &defs.cast.persons {
        if person.mate.as_ref().is_some_and(|m| m.key.is_none())
            && let Some(mate) = defs.mates.iter_mut().find(|m| m.key == person.key && m.hidden)
        {
            mate.name.clone_from(&person.name);
            mate.bio.clone_from(&person.persona);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn real_c2_english_keeps_gameplay_and_localizes_author_display_fields() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
        let effective = crate::resolve_world(&root, "terra16").unwrap();
        let d = Arc::new(crate::convert::load_effective(&effective).unwrap());
        // 只测作者显示覆盖：公共 UI/AI 作为独立渲染依赖传入，不篡改世界分片登记。
        let ai = crate::load_ai_content(&root).unwrap();
        let texts = crate::locale::load_texts(&root).unwrap();
        let source = Source::world(&effective);
        let mut issues = Vec::new();
        let english = super::super::load(
            &source,
            &source.join("locales/en"),
            "locales/en",
            crate::locale::Locale::En,
            &d,
            &ai,
            texts,
            &mut issues,
        );
        assert!(issues.is_empty(), "{issues:#?}");
        let en = &english.defs;
        assert_eq!(en.locations.len(), d.locations.len());
        let roads = |defs: &StaticData| {
            defs.roads
                .iter()
                .map(|r| (r.key.clone(), r.from, r.to, r.length, r.terrain, r.security, r.faction, r.toll))
                .collect::<Vec<_>>()
        };
        assert_eq!(roads(en), roads(&d));
        assert_ne!(en.geography.places.authored.roads, d.geography.places.authored.roads);
        for (key, road) in &d.geography.places.authored.roads {
            let translated = &en.geography.places.authored.roads[key];
            assert_eq!(translated.days, road.days);
            assert_eq!(translated.risk_bp, road.risk_bp);
            assert_eq!(translated.provenance, road.provenance);
            assert!(!translated.lore.is_empty());
        }
        for mate in en.mates.iter().filter(|m| m.hidden) {
            if let Some(person) = en.cast.persons.iter().find(|p| p.key == mate.key) {
                assert_eq!(mate.name, person.name);
                // 显式绑定的航海士保留独立 bio；其余用人物的 persona 作简介。
                if person.mate.as_ref().is_none_or(|binding| binding.key.is_none()) {
                    assert_eq!(mate.bio, person.persona);
                }
            }
        }
        assert!(
            !english.missing.iter().any(|m| m.file.ends_with("world/overseas.toml")
                || m.file.ends_with("world/roads.toml")
                || m.file.ends_with("mates.toml")
                || m.file.contains("/mates/")),
            "{:?}",
            english.missing
        );
    }
}
