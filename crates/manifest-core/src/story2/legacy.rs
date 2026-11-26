//! 旧故事的无损key适配：存档仍保留原字节格式，读取时为轨道消费者换算章节编号。
use crate::{
    World,
    error::CoreError,
    story::{StoryDef, StorySource, StoryState},
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct KeyedProgress {
    pub track: String,
    pub chapter: String,
    pub visited: BTreeSet<String>,
    pub flags: BTreeSet<String>,
    pub pending: Option<String>,
    pub journal: Vec<String>,
}

impl StoryDef {
    /// 旧v1–v4缺失的StoryState默认空；pending、旗标、最近日志均保留。
    pub fn migrate_progress(&self, state: &StoryState) -> Result<KeyedProgress, CoreError> {
        let resolve = |source: &StorySource| -> Result<String, CoreError> {
            match source {
                StorySource::Chapter(i) => self
                    .chapters
                    .get(*i as usize)
                    .map(|c| c.key.clone())
                    .ok_or_else(|| CoreError::SnapshotMismatch("旧故事章节编号越界".into())),
                StorySource::Encounter(key) => Ok(format!("encounter:{key}")),
            }
        };
        if state.chapter as usize > self.chapters.len() {
            return Err(CoreError::SnapshotMismatch("旧故事进度越界".into()));
        }
        Ok(KeyedProgress {
            track: self.key.clone(),
            chapter: self.chapters.get(state.chapter as usize).map_or_else(|| "done".into(), |c| c.key.clone()),
            visited: self.chapters.iter().take(state.chapter as usize).map(|c| c.key.clone()).collect(),
            flags: state.flags.clone(),
            pending: state.pending.as_ref().map(|p| resolve(&p.source)).transpose()?,
            journal: state.journal.iter().map(|e| resolve(&e.source)).collect::<Result<_, _>>()?,
        })
    }
}
impl World {
    pub fn legacy_story_track(&self) -> Result<Option<KeyedProgress>, CoreError> {
        self.story_def().map(|d| d.migrate_progress(&self.state.story)).transpose()
    }
}
