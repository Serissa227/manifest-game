//! B12：逐码核对双语占位，并从真实校验结果生成视图。
use super::*;
use crate::Locales;
use manifest_data::Locale;
use std::sync::Arc;

#[test]
fn every_a8_reason_has_localized_text_without_machine_codes() {
    let locales = Locales::load(&manifest_data::find_data_dir().unwrap()).unwrap();
    let reasons: Vec<_> =
        manifest_core::error::REASON_CODES.iter().filter(|(code, _)| localized_reason(code)).collect();
    assert_eq!(reasons.len(), 50);
    for locale in Locale::ALL {
        let ctx = locales.ctx(locale);
        let mut non_ascii = Vec::new();
        for (code, args) in &reasons {
            assert!(args.is_empty());
            let error = Reason::new(code, format!("未满足条件：{code}。")).rule();
            let text = ctx.error(&error);
            assert_eq!(Some(text.as_str()), locales.get(locale).texts.get(&format!("reasons.{code}")));
            assert!(!text.trim().is_empty());
            for (other, _) in &reasons {
                assert!(!text.contains(other), "{locale:?} {code}: {text}");
            }
            match locale {
                Locale::ZhCn | Locale::ZhCnGemini => {
                    assert!(text.chars().any(|c| ('\u{4e00}'..='\u{9fff}').contains(&c)))
                }
                Locale::En => {
                    if !text.is_ascii() {
                        non_ascii.push(*code);
                    }
                }
            }
        }
        println!("{locale:?} 非 ASCII 英文原因码 {} 条：{non_ascii:?}", non_ascii.len());
        // 原有错误的格式不受本卡影响。
        let error = CommandError::InsufficientCash { need: 10, have: 1 };
        assert_eq!(ctx.error(&error), locales.get(locale).command_error(&error));
    }
}

#[test]
fn blocked_views_use_current_language_and_leave_state_unchanged() {
    let root = manifest_data::find_data_dir().unwrap();
    let locales = Locales::load(&root).unwrap();
    let mut defs = manifest_data::load_world(&root, "testbed").unwrap();
    Arc::make_mut(&mut defs).arcana.spells[0].public = true;
    let mut w = World::new(defs, ScenarioId(0), 42).unwrap();
    w.state.legend_ships.known.insert("sample_legend_ship".into());
    let before = w.state.clone();
    for locale in Locale::ALL {
        let ctx = Ctx { names: &w.defs, ..locales.ctx(locale) };
        let society_error = w.can_join_society(PLAYER, "sample_society").unwrap_err();
        assert_eq!(societies(ctx, &w)["societies"][0]["blocked_reason"], ctx.error(&society_error));
        let spell_error = w.spell_ready(PLAYER, "sample_wind").unwrap_err();
        assert_eq!(crate::arcana_view::arcana(ctx, &w)["spells"][0]["blocked_reason"], ctx.error(&spell_error));
        let ship_error = w.can_commission_ship(PLAYER, "sample_legend_ship", LocId(0)).unwrap_err();
        assert_eq!(
            crate::legend_ships_view::legend_ships(ctx, &w)["ships"][0]["blocked_reason"],
            ctx.error(&ship_error)
        );
        assert_ne!(ctx.error(&society_error), society_error.code());
        assert_ne!(ctx.error(&spell_error), spell_error.code());
        assert_ne!(ctx.error(&ship_error), ship_error.code());
    }
    assert_eq!(w.state, before);
}
