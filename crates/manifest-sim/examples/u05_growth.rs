//! U05 前后对照：按自动安排跑完整个养成期，量结业时的成长、收入、技能、疲劳与心情。
//!
//! 用法：`cargo run --release -p manifest-sim --example u05_growth -- --data <data> [--families a,b] [--presets balanced,navigation] [--seeds 7,42] [--threads 3] [--strip-effects] [--no-skill-effects] [--kit | --kit-fatigue]`
//! `--kit`：开局后给主角每个装备栏穿上一件带“活动收益 / 疲劳减免”的装备（按未剥效果的数据挑，剥不剥效果穿的是同一套），
//! 量这两种效果真的生效后差多少；bot 自己不穿戴、不用消耗品、不考试，不加 `--kit` 时这两种效果碰不到。
//! 输出一行一局的 JSON，最后一行是各预设的平均。跑法与 `manifest-cli upbringing-runs` 完全相同（同一个 `run_observed`），
//! 只是多量几项；结果只取决于数据与种子。
use manifest_core::{OwnerId, StaticData, World, upbringing::ActivityKind};
use manifest_sim::upbringing_runs::{Observer, RunConfig, run_observed};
use serde_json::{Value, json};
use std::{collections::BTreeMap, path::PathBuf, sync::Arc};

const HEROES: [&str; 9] = ["mio", "lieve", "najma", "lin_wandeng", "ix_nikte", "noel", "tariq", "kaicili", "baraka"];

/// 逐日采样疲劳、心情与生病。
#[derive(Default)]
struct Daily {
    /// `--kit`：开局要穿上的（栏位，物品）。
    kit: Vec<(manifest_core::items::equipment::EquipSlot, String)>,
    equipped: i64,
    days: i64,
    fatigue: i64,
    fatigue_max: i64,
    tired60: i64,
    tired80: i64,
    mood: i64,
    mood95: i64,
    ill: i64,
}
impl Observer for Daily {
    fn prepare(&mut self, w: &mut World) {
        for (slot, item) in &self.kit {
            if w.grant_item(OwnerId::Player, item, 1).is_err() {
                continue;
            }
            let equip = manifest_core::Command::Equip {
                owner: OwnerId::Player,
                wearer: "captain".into(),
                slot: *slot,
                item: item.clone(),
            };
            if equip.apply(w).is_ok() {
                self.equipped += 1;
            }
        }
    }
    fn after_day(&mut self, w: &World) {
        let Some(s) = w.state.upbringing.as_ref() else { return };
        self.days += 1;
        self.fatigue += s.fatigue;
        self.fatigue_max = self.fatigue_max.max(s.fatigue);
        self.tired60 += i64::from(s.fatigue >= 60);
        self.tired80 += i64::from(s.fatigue >= 80);
        self.mood += s.mood;
        self.mood95 += i64::from(s.mood >= 95);
        self.ill += i64::from(s.ill_until.is_some_and(|d| w.day() < d));
    }
}

fn arg(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned()
}
fn list(s: &str) -> Vec<String> {
    s.split(',').map(|v| v.trim().to_owned()).filter(|v| !v.is_empty()).collect()
}

/// 格重（八分之几个标准格）：按旬的旧记录是整格。
fn weight_of(r: &manifest_core::upbringing::SlotResult) -> i64 {
    r.weight()
}

/// `--strip-effects`：把“活动收益”（`activity_pct`）与“疲劳减免”（`fatigue_pct`）两种效果从数据里剥掉，
/// 单独量“只按周”与“按周 + 两种效果接线”的差别。
fn strip_effects(defs: &mut StaticData) {
    use manifest_core::items::effects::{Effect, EffectKind};
    let keep =
        |list: &mut Vec<Effect>| list.retain(|e| !matches!(e.kind, EffectKind::ActivityPct | EffectKind::FatiguePct));
    for item in &mut defs.items.items {
        keep(&mut item.effects);
        keep(&mut item.uses);
    }
    for set in &mut defs.items.sets {
        keep(&mut set.bonus);
    }
    for exam in &mut defs.upbringing.exams {
        keep(&mut exam.award.effects);
    }
    for path in &mut defs.upbringing.paths {
        keep(&mut path.award.effects);
    }
    for ending in &mut defs.upbringing.endings {
        keep(&mut ending.award.effects);
    }
}

/// `--kit` 的装备：每个装备栏挑一件带这两种效果的（两个饰品栏挑两件不同的），效果合计大的先，同分按 key。
/// `fatigue_only`（`--kit-fatigue`）：只按“疲劳减免”挑，量这一种效果。
fn kit_of(defs: &StaticData, fatigue_only: bool) -> Vec<(manifest_core::items::equipment::EquipSlot, String)> {
    use manifest_core::items::{effects::EffectKind, equipment::EquipSlot};
    let score = |i: &manifest_core::items::ItemDef| -> i64 {
        i.effects
            .iter()
            .filter(|e| {
                matches!(e.kind, EffectKind::FatiguePct) || (!fatigue_only && matches!(e.kind, EffectKind::ActivityPct))
            })
            .map(|e| e.value)
            .sum()
    };
    let mut out: Vec<(EquipSlot, String)> = Vec::new();
    for slot in EquipSlot::ALL {
        let mut cands: Vec<&manifest_core::items::ItemDef> =
            defs.items.items.iter().filter(|i| i.kind == slot.kind() && score(i) > 0).collect();
        cands.sort_by(|a, b| score(b).cmp(&score(a)).then_with(|| a.key.cmp(&b.key)));
        if let Some(i) = cands.into_iter().find(|i| !out.iter().any(|(_, k)| k == &i.key)) {
            out.push((slot, i.key.clone()));
        }
    }
    out
}

fn measure(defs: &StaticData, cfg: &RunConfig, kit: &[(manifest_core::items::equipment::EquipSlot, String)]) -> Value {
    let mut daily = Daily { kit: kit.to_vec(), ..Default::default() };
    let (report, world) = run_observed(Arc::new(defs.clone()), cfg, &mut daily);
    let Some(w) = world else {
        return json!({"family":cfg.family,"preset":cfg.preset,"seed":cfg.seed,"error":"开局失败"});
    };
    let s = w.state.upbringing.as_ref();
    let conduct = |i: usize| {
        defs.captain.group(i).is_some_and(|g| g.key == "conduct") || defs.captain.attributes[i].key == "fortune"
    };
    let mut growth = 0;
    let mut conduct_sum = 0;
    let mut top = 0;
    let mut levels = BTreeMap::new();
    for (i, a) in defs.captain.attributes.iter().enumerate() {
        let v = w.upbringing_growth(&a.key);
        if a.key == "arcana" {
            continue;
        }
        if conduct(i) {
            if a.key != "fortune" {
                conduct_sum += v;
            }
        } else {
            growth += v;
            let level = w.upbringing_projected(&a.key);
            top = top.max(level);
            levels.insert(a.key.clone(), level);
        }
    }
    let mut net = 0;
    let mut earned = 0;
    let mut spent = 0;
    let mut slots = 0;
    let mut slot_eighths = 0;
    let mut kinds = BTreeMap::<String, i64>::new();
    let mut failed = 0;
    for j in s.map(|s| s.journal.as_slice()).unwrap_or(&[]) {
        let weight = weight_of(&j.result);
        slots += 1;
        slot_eighths += weight;
        net += j.result.cash;
        earned += j.result.cash.max(0);
        spent += (-j.result.cash).max(0);
        failed += i64::from(j.result.success == Some(false));
        for key in &j.result.activities {
            let kind = defs.upbringing.activity(key).map_or(ActivityKind::Free, |a| a.kind);
            *kinds.entry(format!("{kind:?}").to_lowercase()).or_default() += weight;
        }
    }
    let xp: i64 = w.inventory(OwnerId::Player).map_or(0, |i| i.skill_xp.values().sum());
    let wins = report.contests.iter().filter(|c| c.rank == 1).count();
    // K01：结业时主角身上几种效果的合计（各来源先限单件）与实得（再限叠加上限），不限定活动的那一份；
    // 以及到了 1 级以上的技能数
    use manifest_core::items::effects::EffectKind as K;
    let fx = |k: K| w.captain_effect_total(k);
    let skills_lv1 = w
        .inventory(OwnerId::Player)
        .map_or(0, |i| i.skill_xp.keys().filter(|k| w.upbringing_skill_level(k) >= 1).count() as i64);
    let mut row = json!({
        "family": cfg.family, "preset": cfg.preset, "seed": cfg.seed, "graduated": report.graduated,
        "errors": report.errors, "growth": growth, "conduct": conduct_sum, "top_level": top, "levels": levels,
        "ratings": report.ratings, "skill_xp": xp, "cash_net": net, "cash_earned": earned, "cash_spent": spent,
        "cash_end": w.state.agents.get(&OwnerId::Player).map_or(0, |a| a.cash),
        "slots": slots, "slot_eighths": slot_eighths, "failed": failed, "kinds_eighths": kinds,
        "contests": report.contests.len(), "wins": wins,
        "days": daily.days, "fatigue_mean_x100": if daily.days > 0 { daily.fatigue * 100 / daily.days } else { 0 },
        "fatigue_max": daily.fatigue_max, "tired60_days": daily.tired60, "tired80_days": daily.tired80,
        "mood_mean_x100": if daily.days > 0 { daily.mood * 100 / daily.days } else { 0 }, "mood95_days": daily.mood95,
        "ill_days": daily.ill, "kit_equipped": daily.equipped,
    });
    for (name, k) in [
        ("affinity", K::AffinityPct),
        ("activity", K::ActivityPct),
        ("fatigue", K::FatiguePct),
        ("arcana", K::Arcana),
        ("find", K::FindPct),
        ("landing", K::LandingPct),
    ] {
        let t = fx(k);
        row[format!("fx_{name}_raw")] = t.raw.into();
        row[format!("fx_{name}")] = t.applied.into();
    }
    row["skills_lv1"] = skills_lv1.into();
    row
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let data = arg(&args, "--data")
        .map(PathBuf::from)
        .unwrap_or_else(|| manifest_data::find_data_dir().expect("找不到 data 目录"));
    let mut defs = manifest_data::load_world(&data, "terra16").expect("寰宇数据加载失败");
    let kit = if args.iter().any(|a| a == "--kit-fatigue") {
        kit_of(&defs, true)
    } else if args.iter().any(|a| a == "--kit") {
        kit_of(&defs, false)
    } else {
        Vec::new()
    };
    eprintln!("kit: {kit:?}");
    if args.iter().any(|a| a == "--strip-effects") {
        strip_effects(Arc::make_mut(&mut defs));
    }
    // K01：`--no-skill-effects` 关掉技能效果（寰宇缺省打开），量“技能效果生效”前后的差别
    if args.iter().any(|a| a == "--no-skill-effects") {
        Arc::make_mut(&mut defs).rules.skill_effects.enabled = false;
    }
    let families =
        arg(&args, "--families").map_or_else(|| HEROES.iter().map(|s| (*s).to_owned()).collect(), |s| list(&s));
    let presets = list(&arg(&args, "--presets").unwrap_or_else(|| "balanced".into()));
    let seeds: Vec<u64> =
        list(&arg(&args, "--seeds").unwrap_or_else(|| "7".into())).iter().map(|s| s.parse().expect("种子")).collect();
    let threads: usize = arg(&args, "--threads").and_then(|s| s.parse().ok()).unwrap_or(3).max(1);
    let mut configs = Vec::new();
    for preset in &presets {
        for family in &families {
            for seed in &seeds {
                configs.push(RunConfig {
                    family: family.clone(),
                    preset: preset.clone(),
                    seed: *seed,
                    register_every: 2,
                });
            }
        }
    }
    let next = std::sync::atomic::AtomicUsize::new(0);
    let results = std::sync::Mutex::new(vec![Value::Null; configs.len()]);
    std::thread::scope(|scope| {
        for _ in 0..threads {
            scope.spawn(|| {
                loop {
                    let i = next.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    let Some(cfg) = configs.get(i) else { break };
                    let v = measure(&defs, cfg, &kit);
                    results.lock().expect("结果锁")[i] = v;
                }
            });
        }
    });
    let results = results.into_inner().expect("结果锁");
    for r in &results {
        println!("{r}");
    }
    // 各预设的平均（整数除法）。
    let fields = [
        "growth",
        "conduct",
        "top_level",
        "skill_xp",
        "cash_net",
        "cash_earned",
        "cash_spent",
        "cash_end",
        "slots",
        "slot_eighths",
        "failed",
        "contests",
        "wins",
        "fatigue_mean_x100",
        "fatigue_max",
        "tired60_days",
        "tired80_days",
        "mood_mean_x100",
        "mood95_days",
        "ill_days",
        "kit_equipped",
        "skills_lv1",
        "fx_affinity_raw",
        "fx_affinity",
        "fx_activity_raw",
        "fx_activity",
        "fx_fatigue_raw",
        "fx_fatigue",
        "fx_arcana",
        "fx_find",
        "fx_landing",
    ];
    for preset in &presets {
        let rows: Vec<&Value> = results.iter().filter(|r| r["preset"] == preset.as_str()).collect();
        let n = rows.len().max(1) as i64;
        let mut mean = serde_json::Map::new();
        for f in fields {
            mean.insert(f.into(), (rows.iter().map(|r| r[f].as_i64().unwrap_or(0)).sum::<i64>() / n).into());
        }
        let graduated = rows.iter().filter(|r| r["graduated"] == true).count();
        println!("{}", json!({"summary": preset, "runs": rows.len(), "graduated": graduated, "mean": mean}));
    }
}
