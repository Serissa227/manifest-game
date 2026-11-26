//! 离线故事工具与世界加载器共用的严格解析入口。
use crate::{DataError, DataIssue};
use manifest_core::{
    StaticData,
    story2::{Story2Defs, graph, validation},
};

pub fn parse_story_tracks(text: &str, source: &str) -> Result<Story2Defs, DataError> {
    let mut defs: Story2Defs = toml::from_str(text).map_err(|e| DataError {
        issues: vec![DataIssue {
            file: source.into(),
            item: "tracks".into(),
            message: format!("故事2.0格式错误：{e}"),
        }],
    })?;
    for track in &mut defs.tracks {
        track.source = source.into();
    }
    Ok(defs)
}

pub fn validate_story_tracks(defs: &StaticData) -> Result<(), DataError> {
    let issues: Vec<_> = validation::validate(defs)
        .into_iter()
        .chain(graph::validate_world(defs))
        .map(|message| {
            let key = message.split(':').next().unwrap_or_default();
            DataIssue {
                file: defs.story2.track(key).map_or("stories", |t| t.source.as_str()).into(),
                item: key.into(),
                message,
            }
        })
        .collect();
    if issues.is_empty() { Ok(()) } else { Err(DataError { issues }) }
}
