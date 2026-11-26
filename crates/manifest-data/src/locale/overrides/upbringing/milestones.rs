//! 考试、志向和结局的展示覆盖；奖励标记和资本数值不可翻译。
use super::super::{FileSpec, Slot, entry};
use manifest_core::upbringing::UpbringingDefs;
impl FileSpec {
    pub(super) fn upbringing_milestones(self, d: &UpbringingDefs, source: &str) -> Self {
        let exams = d
            .exams
            .iter()
            .enumerate()
            .filter(|(_, e)| e.source == source)
            .map(|(i, e)| entry(&e.key, Slot::UpbringingExam(i), &[("name", &e.name), ("description", &e.description)]))
            .collect();
        let paths = d
            .paths
            .iter()
            .enumerate()
            .filter(|(_, p)| p.source == source)
            .map(|(i, p)| entry(&p.key, Slot::UpbringingPath(i), &[("name", &p.name), ("description", &p.description)]))
            .collect();
        let endings = d
            .endings
            .iter()
            .enumerate()
            .filter(|(_, e)| e.source == source)
            .map(|(i, e)| entry(&e.key, Slot::UpbringingEnding(i), &[("title", &e.title), ("text", &e.text)]))
            .collect();
        let mut titles = vec![];
        for (i, e) in d.exams.iter().enumerate().filter(|(_, e)| e.source == source) {
            for (j, title) in e.award.titles.iter().enumerate() {
                titles.push(entry(&format!("exam:{}:{j}", e.key), Slot::UpbringingExamTitle(i, j), &[("text", title)]));
            }
        }
        for (i, p) in d.paths.iter().enumerate().filter(|(_, p)| p.source == source) {
            for (j, title) in p.award.titles.iter().enumerate() {
                titles.push(entry(&format!("path:{}:{j}", p.key), Slot::UpbringingPathTitle(i, j), &[("text", title)]));
            }
        }
        for (i, e) in d.endings.iter().enumerate().filter(|(_, e)| e.source == source) {
            for (j, title) in e.award.titles.iter().enumerate() {
                titles.push(entry(
                    &format!("ending:{}:{j}", e.key),
                    Slot::UpbringingEndingTitle(i, j),
                    &[("text", title)],
                ));
            }
        }
        self.table("exams", exams).table("paths", paths).table("endings", endings).table("award_titles", titles)
    }
}
