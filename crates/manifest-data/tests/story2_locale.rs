//! 嵌套与组合key共用显示白名单，数组下标不能借译文改变玩法。
use manifest_core::story2::Story2Defs;
use serde_json::json;
use std::{path::Path, sync::Arc};

fn copy(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let dest = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy(&entry.path(), &dest);
        } else {
            std::fs::copy(entry.path(), dest).unwrap();
        }
    }
}

#[test]
fn nested_overlays_translate_branches_objectives_variants_and_effect_text_only() {
    let tmp = tempfile::tempdir().unwrap();
    copy(&manifest_data::find_data_dir().unwrap(), tmp.path());
    let mut defs = manifest_data::load(tmp.path()).unwrap();
    let mut stories:Story2Defs=serde_json::from_value(json!({"tracks":[{"key":"test","name":"轨道","kind":"request","start":"a","chapters":[
        {"key":"a","title":"开始","text":"故事开始。","objectives":[{"kind":"wait","days":2,"text":"等两天"}],
         "variants":[{"key":"wind","title":"海风","text":"迎风而立。"}],
         "default":{"next":"done","news":"默认结局","effects":[{"kind":"memory","memory":"default","title":"默认回忆"}]},
         "timeout":{"next":"failed","news":"超时结局"},
         "choices":[{"key":"yes","text":"答应","reply":"好。","next":"done","effects":[{"kind":"cash","value":3},{"kind":"memory","memory":"yes","title":"承诺"}],
         "fail":{"next":"failed","news":"失败结局"}}]}]}]})).unwrap();
    stories.tracks[0].source = "stories/nested.toml".into();
    Arc::make_mut(&mut defs).story2 = stories;
    let text = r#"
[tracks.test]
name="Track"
[tracks.test.chapters.a]
title="Beginning"
text="A story begins."
objectives=[{text="Wait two days"}]
[tracks.test.chapters.a.variants.wind]
title="Sea wind"
text="Stand in the wind."
[tracks.test.chapters.a.default]
news="Default ending"
effects=[{title="Default memory"}]
[tracks.test.chapters.a.timeout]
news="Expired"
[tracks.test.chapters.a.choices.yes]
text="Agree"
reply="Yes."
effects=[{}, {title="Promise"}]
[tracks.test.chapters.a.choices.yes.fail]
news="Failed"
"#;
    let path = tmp.path().join("locales/en/stories/nested.toml");
    std::fs::write(&path, text).unwrap();
    let ai = manifest_data::load_ai_content(tmp.path()).unwrap();
    let localized = manifest_data::load_locale(tmp.path(), manifest_data::Locale::En, &defs, &ai).unwrap();
    let c = &localized.defs.story2.tracks[0].chapters[0];
    assert_eq!(c.objectives[0].text.as_deref(), Some("Wait two days"));
    assert_eq!(c.variants[0].title.as_deref(), Some("Sea wind"));
    assert_eq!(c.choices[0].reply, "Yes.");
    assert_eq!(c.timeout.as_ref().unwrap().news.as_deref(), Some("Expired"));
    assert_eq!(c.choices[0].fail.as_ref().unwrap().news.as_deref(), Some("Failed"));
    assert!(matches!(&c.choices[0].effects[1],manifest_core::story2::Effect::Memory{title,..} if title=="Promise"));
    assert_eq!(c.choices[0].effects[0], defs.story2.tracks[0].chapters[0].choices[0].effects[0]);
    for invalid in [
        text.replace("effects=[{},", "effects=[{value=999},"),
        text.replace("Wait two days\"}", "Wait two days\",days=0}"),
        format!("{text}\n[chapters.\"test:a\"]\ntitle=\"Duplicate\"\n"),
    ] {
        std::fs::write(&path, invalid).unwrap();
        assert!(manifest_data::load_locale(tmp.path(), manifest_data::Locale::En, &defs, &ai).is_err());
    }
}
