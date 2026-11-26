//! 第 10 节测试 14（玩家流程集成）：不启动窗口，直接调用 manifest-app 的命令处理函数，
//! 走完 开局 → 买货 → 航行 → 卖货 → 开期货仓 → 平仓 → 组商队 → 存档 → 读档，每步断言状态。
//! 命令一律以界面发送的 JSON 形式构造，同时检验前后端的数据约定。

use manifest_ai::{AiMode, MemoryKeyStore, ProviderKind};
use manifest_app::handlers::{self, CaravanPlanRequest, QuoteRequest};
use manifest_app::views::{FleetView, Overview};
use manifest_app::{AppPaths, AppState};
use manifest_core::Command;
use serde_json::json;
use std::sync::Arc;

fn app(dir: &std::path::Path, mode: AiMode) -> AppState {
    let data = manifest_data::find_data_dir().expect("找到 data/");
    let st = AppState::from_data_dir(&data, Arc::new(MemoryKeyStore::default()), AppPaths::in_dir(dir)).unwrap();
    let mut settings = handlers::get_settings(&st).settings;
    settings.ai.mode = mode;
    settings.autosave_days = 0;
    handlers::save_settings(&st, settings).unwrap();
    st
}

fn cmd(v: serde_json::Value) -> Command {
    serde_json::from_value(v.clone()).unwrap_or_else(|e| panic!("命令 JSON 无法解析：{e}\n{v}"))
}

fn submit(st: &AppState, v: serde_json::Value) -> handlers::SubmitResult {
    handlers::submit(st, cmd(v.clone())).unwrap_or_else(|e| panic!("命令被拒绝：{e}\n{v}"))
}

fn fleet(o: &Overview) -> &FleetView {
    o.fleets.first().expect("玩家至少有一支舰队")
}

fn loc_id(st: &AppState, key: &str) -> u16 {
    st.defs().locations.iter().position(|l| l.key == key).unwrap() as u16
}

#[test]
fn test14_full_player_flow_through_handlers() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path(), AiMode::Off);
    let statics = handlers::static_data(&st);
    assert!(statics.map.rows.len() as u16 == statics.map.height && !statics.locations.is_empty());

    // ── 开局 ──
    assert!(handlers::overview(&st).is_err(), "开局前没有游戏");
    let o = handlers::new_game(&st, "newcomer", Some(2024)).unwrap();
    assert_eq!(o.day, 0);
    let start = fleet(&o).docked.expect("开局舰队停在港口");
    assert_eq!(start, loc_id(&st, "chenggang"));
    let fid = fleet(&o).id;
    let cash0 = o.cash;
    assert!(cash0 > 0);

    // ── 选目的港：航程最短的另一个港口 ──
    let ports: Vec<u16> =
        statics.locations.iter().filter(|l| l.kind == "port" && l.id != start).map(|l| l.id).collect();
    let (dest, preview) = ports
        .iter()
        .filter_map(|d| handlers::sail_preview(&st, fid, *d).unwrap().map(|p| (*d, p)))
        .min_by_key(|(_, p)| p.days)
        .expect("应有可达的港口");
    assert!(preview.days > 0 && !preview.path.is_empty());

    // ── 买货：目的港也交易的商品中，本地最便宜的（目的港尚未到访，行情未知）──
    let here = handlers::port(&st, start).unwrap();
    let there = handlers::port(&st, dest).unwrap();
    assert!(here.known && !there.known, "只到过开局港");
    assert!(there.market.is_empty(), "未到访的港口不显示市场信息");
    let dest_goods: Vec<u16> = st.defs().loc(manifest_core::LocId(dest)).market.iter().map(|m| m.good.0).collect();
    let good = here
        .market
        .iter()
        .filter(|r| dest_goods.contains(&r.good) && !statics.goods[r.good as usize].license)
        .min_by_key(|r| r.price * 1000 / r.base_price.max(1))
        .map(|r| r.good)
        .expect("两港应有共同商品");
    let qty = 10;
    let q = handlers::quote(&st, QuoteRequest { loc: start, good, side: "buy".into(), qty }).unwrap();
    assert_eq!(q.qty, qty);
    let r =
        submit(&st, json!({"Buy": {"owner": "player", "fleet": fid, "good": good, "qty": qty, "max_total": q.total}}));
    assert_eq!(r.overview.cash, cash0 - q.total, "现金按预估总额减少");
    let cargo = fleet(&r.overview).cargo.iter().find(|c| c.good == good).unwrap();
    assert_eq!(cargo.qty, qty);
    assert!(cargo.avg_cost > 0);
    let after_buy = handlers::port(&st, start).unwrap();
    let row = after_buy.market.iter().find(|m| m.good == good).unwrap();
    assert_eq!(row.held, qty);
    assert!(row.price >= here.market.iter().find(|m| m.good == good).unwrap().price, "买入推高价格");

    // ── 补给并出航 ──
    let f = fleet(&r.overview);
    let (food, water) = ((preview.supplies - f.food).max(0), (preview.supplies - f.water).max(0));
    if food + water > 0 {
        submit(&st, json!({"Resupply": {"owner": "player", "fleet": fid, "food": food, "water": water}}));
    }
    let r = submit(&st, json!({"SetSail": {"owner": "player", "fleet": fid, "dest": dest}}));
    assert!(matches!(r.outcome, manifest_core::CommandOutcome::Sailed { .. }));
    let f = fleet(&r.overview);
    assert_eq!((f.docked, f.dest), (None, Some(dest)), "舰队已出航");

    // ── 航行到港 ──
    let mut arrived = false;
    for _ in 0..(preview.days * 2 + 20) {
        let o = handlers::step(&st, 1).unwrap();
        if fleet(&o).docked == Some(dest) {
            arrived = true;
            break;
        }
    }
    assert!(arrived, "舰队应在预计时间内到港");
    assert!(handlers::port(&st, dest).unwrap().known, "抵达后解锁市场信息");
    let o = handlers::overview(&st).unwrap();
    assert!(fleet(&o).days_at_sea == 0 || fleet(&o).docked.is_some());

    // ── 卖货 ──
    let cash_before = o.cash;
    let q = handlers::quote(&st, QuoteRequest { loc: dest, good, side: "sell".into(), qty }).unwrap();
    let r =
        submit(&st, json!({"Sell": {"owner": "player", "fleet": fid, "good": good, "qty": qty, "min_total": q.total}}));
    assert_eq!(r.overview.cash, cash_before + q.total, "现金按预估总额增加");
    assert!(fleet(&r.overview).cargo.iter().all(|c| c.good != good), "货已卖完");

    // ── 期货：存保证金 → 开仓 → 盯市 → 平仓 → 取回保证金 ──
    let fv = handlers::futures(&st).unwrap();
    let c = fv.contracts.iter().max_by_key(|c| c.days_left).expect("应有可交易的期货合约").clone();
    let ex = &statics.exchanges[c.exchange as usize];
    let margin = (c.mark * c.lot * ex.initial_margin_bp / 10_000) * 3 + 1_000;
    let r = submit(&st, json!({"DepositMargin": {"owner": "player", "exchange": c.exchange, "amount": margin}}));
    let cash_after_deposit = r.overview.cash;
    let fv = handlers::futures(&st).unwrap();
    assert_eq!(fv.accounts[c.exchange as usize].balance, margin);
    submit(&st, json!({"TradeFutures": {"owner": "player", "contract": c.id, "lots": 1}}));
    let fv = handlers::futures(&st).unwrap();
    let pos = fv.contracts.iter().find(|x| x.id == c.id).and_then(|x| x.position.clone()).expect("已开仓");
    assert_eq!(pos.lots, 1);
    assert!(fv.accounts[c.exchange as usize].initial_requirement > 0);
    handlers::step(&st, 2).unwrap();
    submit(&st, json!({"TradeFutures": {"owner": "player", "contract": c.id, "lots": -1}}));
    let fv = handlers::futures(&st).unwrap();
    assert!(fv.contracts.iter().find(|x| x.id == c.id).unwrap().position.is_none(), "已平仓");
    let balance = fv.accounts[c.exchange as usize].balance;
    assert!(balance > 0);
    let r = submit(&st, json!({"WithdrawMargin": {"owner": "player", "exchange": c.exchange, "amount": balance}}));
    assert!(r.overview.cash >= cash_after_deposit, "保证金取回现金账户");
    assert_eq!(handlers::futures(&st).unwrap().accounts[c.exchange as usize].balance, 0);

    // ── 商队：在开局港组建 → 装货 → 走陆路到内陆城市 ──
    let city = loc_id(&st, "lancheng");
    let plan = handlers::caravan_plan(
        &st,
        CaravanPlanRequest { animal: 0, count: 4, guards: 2, from: start, to: city, cargo_value: 5_000 },
    )
    .unwrap()
    .expect("开局港与兰城之间有道路");
    assert!(plan.days > 0 && plan.distance > 0 && !plan.legs.is_empty());
    assert!((0..10_000).contains(&plan.risk_bp));
    let r = submit(&st, json!({"FormCaravan": {"owner": "player", "at": start, "animal": 0, "count": 4}}));
    let cid = match r.outcome {
        manifest_core::CommandOutcome::CaravanFormed { caravan } => caravan.0,
        other => panic!("{other:?}"),
    };
    submit(&st, json!({"SetGuards": {"owner": "player", "caravan": cid, "guards": 2}}));
    let here = handlers::port(&st, start).unwrap();
    assert!(!handlers::port(&st, city).unwrap().known, "兰城尚未到访");
    let city_goods: Vec<u16> = st.defs().loc(manifest_core::LocId(city)).market.iter().map(|m| m.good.0).collect();
    let cargo_good = here
        .market
        .iter()
        .find(|m| city_goods.contains(&m.good) && !statics.goods[m.good as usize].license)
        .map(|m| m.good)
        .expect("开局港与兰城应有共同商品");
    submit(
        &st,
        json!({"BuyInto": {"owner": "player", "holder": {"Caravan": cid}, "good": cargo_good, "qty": 5, "max_total": null}}),
    );
    let r = submit(&st, json!({"CaravanTravel": {"owner": "player", "caravan": cid, "dest": city}}));
    let cv = r.overview.caravans.iter().find(|c| c.id == cid).unwrap();
    assert!(cv.at.is_none() && cv.dest == Some(city), "商队已上路");
    let mut arrived = false;
    for _ in 0..(plan.days * 2 + 10) {
        let o = handlers::step(&st, 1).unwrap();
        if o.caravans.iter().find(|c| c.id == cid).and_then(|c| c.at) == Some(city) {
            arrived = true;
            break;
        }
    }
    assert!(arrived, "商队应到达兰城");
    let city_view = handlers::port(&st, city).unwrap();
    assert!(city_view.caravans_here.contains(&cid));
    assert!(city_view.known && !city_view.market.is_empty(), "商队到达后解锁兰城的市场信息");

    // ── 报表与情报可查询 ──
    let reports = handlers::reports(&st).unwrap();
    assert!(!reports.trend.is_empty());
    assert!(reports.current.total_assets > 0);
    assert!(!handlers::intel(&st).unwrap().log.is_empty());
    let dbg = handlers::debug(&st).unwrap();
    assert!(dbg.money_conserved, "货币守恒");

    // ── 存档 → 继续玩 → 读档 ──
    let saved = handlers::save_game(&st, "flow").unwrap();
    let saved_hash = handlers::debug(&st).unwrap().state_hash;
    assert_eq!(saved.day, dbg.day);
    assert!(handlers::list_saves(&st).unwrap().iter().any(|s| s.slot == "flow" && s.day == saved.day));
    handlers::step(&st, 5).unwrap();
    assert_ne!(handlers::debug(&st).unwrap().state_hash, saved_hash);
    let o = handlers::load_game(&st, "flow").unwrap();
    assert_eq!(o.day, saved.day);
    let after = handlers::debug(&st).unwrap();
    assert_eq!(after.state_hash, saved_hash, "读档后状态与存档时一致");
    assert!(o.caravans.iter().any(|c| c.id == cid && c.at == Some(city)));
    // 读档后可以继续游戏
    handlers::step(&st, 3).unwrap();
    assert_eq!(handlers::overview(&st).unwrap().day, saved.day + 3);
}

/// 玩家可以删除存档：三个文件（存档、meta、预测簿）都删掉，列表里不再有；正在进行的这一局不受影响，再存一次就又有了；
/// 没有这个存档、存档名不合法时报错。
#[test]
fn players_can_delete_saves() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path(), AiMode::Off);
    handlers::new_game(&st, "newcomer", Some(3)).unwrap();
    handlers::save_game(&st, "keep").unwrap();
    handlers::save_game(&st, "old").unwrap();
    let dir = tmp.path().join("saves");
    assert!(
        dir.join("old.mfsave.zst").is_file()
            && dir.join("old.meta.json").is_file()
            && dir.join("old.book.json").is_file()
    );

    let left = handlers::delete_save(&st, "old").unwrap();
    assert_eq!(left.iter().map(|s| s.slot.as_str()).collect::<Vec<_>>(), ["keep"]);
    for f in ["old.mfsave.zst", "old.meta.json", "old.book.json"] {
        assert!(!dir.join(f).exists(), "{f} 已删除");
    }
    assert!(dir.join("keep.mfsave.zst").is_file(), "别的存档不动");
    // 这一局照常，再存一次就又有了
    handlers::step(&st, 1).unwrap();
    handlers::save_game(&st, "old").unwrap();
    assert!(handlers::list_saves(&st).unwrap().iter().any(|s| s.slot == "old" && s.day == 1));

    let err = handlers::delete_save(&st, "nothing").unwrap_err().to_string();
    assert!(err.contains("没有名为 nothing 的存档"), "{err}");
    assert!(handlers::delete_save(&st, "../keep").is_err(), "存档名不能包含路径");
    assert!(dir.join("keep.mfsave.zst").is_file());
}

#[test]
fn ui_cannot_submit_ai_or_foreign_commands() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path(), AiMode::Off);
    handlers::new_game(&st, "newcomer", Some(1)).unwrap();
    let before = handlers::debug(&st).unwrap().state_hash;
    let forbidden = [
        json!({"RecordChronicle": {"year": 0, "text": "伪造的编年史"}}),
        json!({"Deposit": {"owner": "c0", "amount": 100}}),
        json!({"AdjustStrategy": {"company": 0, "risk": 8000, "preferred": []}}),
    ];
    for v in forbidden {
        assert!(handlers::submit(&st, cmd(v.clone())).is_err(), "{v}");
    }
    // 非法数量等由内核拒绝，状态不变
    let o = handlers::overview(&st).unwrap();
    let bad = json!({"Buy": {"owner": "player", "fleet": fleet(&o).id, "good": 0, "qty": -5, "max_total": null}});
    assert!(handlers::submit(&st, cmd(bad)).is_err());
    assert_eq!(handlers::debug(&st).unwrap().state_hash, before);
    assert!(handlers::set_speed(&st, 3).is_err());
    assert_eq!(handlers::set_speed(&st, 4).unwrap().speed, 4);
    assert!(handlers::save_game(&st, "../escape").is_err(), "存档名不能包含路径");
}

#[test]
fn bargain_and_ai_offline_mode_in_app() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path(), AiMode::Offline);
    let o = handlers::new_game(&st, "newcomer", Some(9)).unwrap();
    let loc = fleet(&o).docked.unwrap();
    let reply = handlers::bargain(&st, loc, "老板，便宜一点吧".into()).unwrap();
    assert_eq!(reply.intent, "discount");
    assert!(!reply.reply.is_empty() && reply.accepted && reply.discount_bp > 0);
    handlers::step(&st, 1).unwrap();
    let port = handlers::port(&st, loc).unwrap();
    assert!(port.bargain.is_some(), "折扣次日生效");
    assert_eq!(port.dialogs.len(), 1);
    // 离线 AI 按日程产生内容，预算不计调用
    let o = handlers::step(&st, 40).unwrap();
    assert_eq!(o.ai_mode, "offline");
    assert!(handlers::debug(&st).unwrap().ai_commands > 1);
    assert!(!handlers::debug(&st).unwrap().audit.is_empty());
    assert_eq!(o.budget.unwrap().calls_used, 0);
}

#[test]
fn settings_and_keys_are_stored_separately() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path(), AiMode::Live);
    const KEY: &str = "sk-app-test-5d1f0a";
    let v = handlers::set_api_key(&st, ProviderKind::Anthropic, KEY.into()).unwrap();
    assert!(v.keys.iter().any(|(k, has)| *k == ProviderKind::Anthropic && *has));
    let file = std::fs::read_to_string(tmp.path().join("settings.json")).unwrap();
    assert!(!file.contains(KEY), "设置文件不含密钥");
    assert!(!serde_json::to_string(&v).unwrap().contains(KEY), "返回给界面的设置不含密钥");
    // 真实提供商模式下开局：无网络也不会阻塞，AI 在后台处理
    handlers::new_game(&st, "newcomer", Some(3)).unwrap();
    assert_eq!(handlers::overview(&st).unwrap().ai_mode, "live");
    let v = handlers::clear_api_key(&st, ProviderKind::Anthropic).unwrap();
    assert!(v.keys.iter().all(|(_, has)| !has));
    // 设置校验
    let mut bad = v.settings.clone();
    bad.speed = 3;
    assert!(handlers::save_settings(&st, bad).is_err());
    let mut ok = v.settings.clone();
    ok.autosave_days = 10;
    ok.ai.mode = AiMode::Offline;
    assert_eq!(handlers::save_settings(&st, ok).unwrap().settings.autosave_days, 10);
    // 自动存档
    handlers::new_game(&st, "newcomer", Some(3)).unwrap();
    handlers::step(&st, 12).unwrap();
    assert!(handlers::list_saves(&st).unwrap().iter().any(|s| s.slot == "autosave" && s.day == 10));
}

/// 产业：租仓库 → 建加工产业 → 备料 → 生产 → 升级、雇管理人 → 出售。
#[test]
fn industry_flow_through_handlers() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path(), AiMode::Off);
    // “继承人”剧本资金充足，可以建产业
    let o = handlers::new_game(&st, "heir", Some(77)).unwrap();
    let start = fleet(&o).docked.unwrap();
    submit(&st, json!({"RentWarehouse": {"owner": "player", "loc": start, "capacity": 400}}));
    let port = handlers::port(&st, start).unwrap();
    assert_eq!(port.warehouse.capacity, 400);
    assert_eq!(handlers::industries(&st).unwrap().sites, vec![start]);

    // 找一个投入品都能在本地买到的加工配方（开放市场：交易所收购所有的货，买得到的只是这里出售的货）
    let defs = st.defs().clone();
    let local: Vec<u16> = port.market.iter().filter(|m| m.sold).map(|m| m.good).collect();
    let mut candidates: Vec<(usize, &manifest_core::defs::RecipeDef)> = defs
        .recipes
        .iter()
        .enumerate()
        .filter(|(_, rc)| !rc.inputs.is_empty() && rc.inputs.iter().all(|(g, _)| local.contains(&g.0)))
        .collect();
    // 先试最便宜的产业，留出备料的钱
    candidates.sort_by_key(|(_, rc)| defs.industry_type(rc.industry).build_cost);
    let mut built = None;
    for (i, rc) in candidates {
        let v = json!({"BuildIndustry": {"owner": "player", "loc": start, "kind": rc.industry.0, "recipe": i}});
        if let Ok(r) = handlers::submit(&st, cmd(v)) {
            built = Some((r, i));
            break;
        }
    }
    let (r, recipe) = built.expect("开局港应能建设至少一种加工产业");
    let iid = match r.outcome {
        manifest_core::CommandOutcome::IndustryBuilt { industry } => industry.0,
        other => panic!("{other:?}"),
    };
    let rc = &defs.recipes[recipe];
    for (g, q) in &rc.inputs {
        submit(
            &st,
            json!({"BuyInto": {"owner": "player", "holder": {"Warehouse": start}, "good": g.0, "qty": q * 4, "max_total": null}}),
        );
    }
    handlers::step(&st, 3).unwrap();
    let view = handlers::industries(&st).unwrap();
    let ind = view.industries.iter().find(|i| i.id == iid).unwrap();
    assert_eq!(ind.recipe as usize, recipe);
    assert!(!ind.stalled, "备料充足时不停工");
    let stock = handlers::port(&st, start).unwrap().warehouse.stock;
    for (g, _) in &rc.outputs {
        assert!(stock.iter().any(|c| c.good == g.0 && c.qty > 0), "产出进入仓库");
    }
    submit(&st, json!({"SetManager": {"owner": "player", "industry": iid, "hired": true}}));
    submit(&st, json!({"UpgradeIndustry": {"owner": "player", "industry": iid}}));
    let ind = handlers::industries(&st).unwrap().industries.into_iter().find(|i| i.id == iid).unwrap();
    assert!(ind.manager && ind.level == 2);
    submit(&st, json!({"SellIndustry": {"owner": "player", "industry": iid}}));
    assert!(handlers::industries(&st).unwrap().industries.is_empty());
    assert!(handlers::debug(&st).unwrap().money_conserved);
}

/// M5：通过处理函数招募与任命航海士、买海图揭开迷雾、遭遇海盗后进行战术海战。
#[test]
fn mates_charts_and_tactical_battle_through_handlers() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path(), AiMode::Off);
    let o = handlers::new_game(&st, "newcomer", Some(31)).unwrap();
    let fid = fleet(&o).id;
    let start = fleet(&o).docked.unwrap();
    assert!(o.goal.as_ref().is_some_and(|g| g.kind == "net_worth" && g.target == 300_000));
    assert!(o.outcome.is_none());

    // ── 航海士 ──
    let mates = handlers::mates(&st).unwrap();
    assert_eq!(mates.hired.len(), 1, "剧本自带一名航海士");
    assert_eq!((mates.hired[0].role.kind, mates.hired[0].role.target), ("captain", Some(fid)));
    let port = handlers::port(&st, start).unwrap();
    let candidate = port.mates_here.first().expect("开局港酒馆有航海士可招募").clone();
    let tax_before = port.tax_bp;
    submit(&st, json!({"HireMate": {"owner": "player", "mate": candidate.id}}));
    submit(&st, json!({"AssignMate": {"owner": "player", "mate": candidate.id, "role": "Trader"}}));
    let mates = handlers::mates(&st).unwrap();
    assert!(mates.hired.iter().any(|m| m.id == candidate.id && m.role.kind == "trader"));
    assert!(handlers::port(&st, start).unwrap().tax_bp < tax_before, "交易员降低交易税");
    assert!(handlers::port(&st, start).unwrap().mates_here.iter().all(|m| m.id != candidate.id));

    // ── 海图与迷雾 ──
    let fog0 = handlers::overview(&st).unwrap().fog_version;
    let rows = handlers::fog(&st).unwrap();
    assert_eq!(rows.len(), st.defs().map.height as usize);
    let chart = port.charts.iter().find(|c| !c.owned).unwrap().clone();
    submit(&st, json!({"BuyChart": {"owner": "player", "region": chart.region}}));
    let o = handlers::overview(&st).unwrap();
    assert!(o.fog_version > fog0, "海图揭开了迷雾");
    assert!(handlers::port(&st, start).unwrap().charts.iter().any(|c| c.region == chart.region && c.owned));

    // ── 遭遇海盗：出航后在舰队旁放一支海盗舰队 ──
    // 航程最远的港口，保证舰队在海上多待几天
    let dest = st
        .defs()
        .port_ids()
        .filter(|l| l.0 != start)
        .filter_map(|l| handlers::sail_preview(&st, fid, l.0).unwrap().map(|p| (l.0, p.days)))
        .max_by_key(|(_, d)| *d)
        .unwrap()
        .0;
    submit(&st, json!({"Resupply": {"owner": "player", "fleet": fid, "food": 30, "water": 30}}));
    submit(&st, json!({"SetSail": {"owner": "player", "fleet": fid, "dest": dest}}));
    handlers::set_speed(&st, 2).unwrap();
    handlers::step(&st, 1).unwrap();
    {
        let mut guard = st.game().unwrap();
        let world = &mut guard.as_mut().unwrap().session.world;
        // 沿航线前方放一串海盗，舰队驶来时必定相遇
        let path: Vec<manifest_core::Cell> = match &world.fleet(manifest_core::FleetId(fid)).unwrap().location {
            manifest_core::world::FleetLocation::AtSea(manifest_core::world::Voyage::Route(v)) => {
                v.path[v.step + 3..(v.step + 12).min(v.path.len() - 1)].to_vec()
            }
            _ => panic!("舰队应在海上"),
        };
        for cell in path {
            let Some(region) = world.defs.map.region_of(cell) else { continue };
            let kind = world.defs.rules.pirates.ships[0];
            let ship = manifest_core::fleet::new_ship(&world.defs, kind);
            let id = world.state.battles.next_pirate;
            world.state.battles.next_pirate += 1;
            world.state.battles.pirates.insert(
                id,
                manifest_core::battle::PirateFleet {
                    id,
                    region,
                    cell,
                    ships: vec![ship],
                    crew: 12,
                    until: 9_999,
                    engaged: false,
                },
            );
        }
    }
    let o = handlers::step(&st, 5).unwrap();
    let pending = o.pending_battles.first().expect("应遭遇海盗").clone();
    assert_eq!(pending.fleet, fid);
    assert_eq!(o.speed, 0, "遭遇海盗时自动暂停");
    assert!(handlers::submit(&st, cmd(json!({"SetSail": {"owner": "player", "fleet": fid, "dest": start}}))).is_err());

    // ── 战术海战 ──
    submit(&st, json!({"EngageBattle": {"owner": "player", "battle": pending.id, "tactical": true}}));
    let o = handlers::overview(&st).unwrap();
    assert_eq!(o.tactical_battles, vec![pending.id]);
    let view = handlers::battle(&st, pending.id).unwrap().expect("战术海战视图");
    assert!(!view.options.is_empty() && !view.options[0].moves.is_empty());
    let mut turns = 0;
    while let Some(v) = handlers::battle(&st, pending.id).unwrap() {
        for opt in &v.options {
            if let Some(t) = opt.fire.first() {
                submit(
                    &st,
                    json!({"TacticalCommand": {"owner": "player", "battle": pending.id, "order": {"Fire": {"unit": opt.unit, "target": t}}}}),
                );
            } else if let Some((q, r, _)) = opt.moves.last() {
                submit(
                    &st,
                    json!({"TacticalCommand": {"owner": "player", "battle": pending.id, "order": {"Move": {"unit": opt.unit, "q": q, "r": r}}}}),
                );
            }
        }
        if handlers::battle(&st, pending.id).unwrap().is_none() {
            break;
        }
        submit(&st, json!({"TacticalCommand": {"owner": "player", "battle": pending.id, "order": "EndTurn"}}));
        turns += 1;
        assert!(turns <= 40, "战斗应在回合上限内结束");
    }
    let o = handlers::overview(&st).unwrap();
    assert!(o.tactical_battles.is_empty() && o.pending_battles.is_empty());
    let intel = handlers::intel(&st).unwrap();
    assert!(intel.log.iter().any(|l| l.kind == "NavalBattle" && l.mine));
    assert!(handlers::debug(&st).unwrap().money_conserved);
}
