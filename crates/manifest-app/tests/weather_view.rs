//! 第四批（EXPANSION §9.1）：概览里的每日天气与当地预报、地点视图的海区。
//! 字段名与前端 `ipc/types.ts` 的 `RegionWeatherView`、`LocalWeatherView`、`DayWeatherView`、`LocView.region` 逐字一致。

use manifest_app::views;
use manifest_core::defs::EffectKind;
use manifest_core::events::{ActiveEvent, EventOrigin, EventParams};
use manifest_core::testkit::tiny_defs;
use manifest_core::world::{FleetLocation, Voyage};
use manifest_core::*;

const SKIES: [&str; 6] = ["clear", "cloudy", "rain", "fog", "storm", "snow"];

#[test]
fn overview_weather_covers_every_region_with_todays_wind() {
    let defs = manifest_data::load_default().unwrap_or_else(|e| panic!("{e}"));
    let mut w = World::new(defs.clone(), ScenarioId(0), 7).unwrap();
    for _ in 0..40 {
        w.end_day().unwrap();
    }
    let o = views::overview(&w, 1, "off".into(), None);
    assert_eq!(o.weather.len(), defs.regions.len(), "每个海区一条天气");
    assert_eq!(o.winds.len(), defs.regions.len());
    for (i, rw) in o.weather.iter().enumerate() {
        let today = w.weather_today(RegionId::from_idx(i)).unwrap();
        assert_eq!(rw.region as usize, i, "按海区序号排列");
        assert_eq!((rw.sky, rw.wind_dir, rw.wind_strength), (today.sky, today.wind_dir(), today.wind_strength()));
        // 海图上的风向箭头用当天的风
        let wind = &o.winds[i];
        assert_eq!((wind.region as usize, wind.dir, wind.strength), (i, today.wind_dir(), today.wind_strength()));
    }
    // JSON 形状：{ region, sky, wind_dir, wind_strength }，sky 为小写名
    let json = serde_json::to_value(&o).unwrap();
    for rw in json["weather"].as_array().unwrap() {
        let keys: Vec<&str> = rw.as_object().unwrap().keys().map(|k| k.as_str()).collect();
        assert_eq!(keys.len(), 4, "{rw}");
        for k in ["region", "sky", "wind_dir", "wind_strength"] {
            assert!(keys.contains(&k), "缺少 {k}：{rw}");
        }
        assert!(SKIES.contains(&rw["sky"].as_str().unwrap()), "{rw}");
    }
    // 一年里各种天况都会出现在海图上（含寒冷海区冬季的雪）
    let mut seen = std::collections::BTreeSet::new();
    for _ in 0..360 {
        w.end_day().unwrap();
        for rw in views::overview(&w, 1, "off".into(), None).weather {
            seen.insert(rw.sky.key());
        }
    }
    assert_eq!(seen.len(), 6, "一年里应当见到全部六种天况：{seen:?}");
}

fn local_json_shape(o: &views::Overview) {
    let json = serde_json::to_value(o).unwrap();
    let lw = &json["local_weather"];
    for k in ["region", "region_name", "sky", "wind_dir", "wind_strength", "forecast"] {
        assert!(lw.get(k).is_some(), "local_weather 缺少 {k}：{lw}");
    }
    assert!(SKIES.contains(&lw["sky"].as_str().unwrap()));
    for f in lw["forecast"].as_array().unwrap() {
        let keys: Vec<&str> = f.as_object().unwrap().keys().map(|k| k.as_str()).collect();
        assert_eq!(keys.len(), 4, "{f}");
        for k in ["day", "sky", "wind_dir", "wind_strength"] {
            assert!(keys.contains(&k), "预报缺少 {k}：{f}");
        }
    }
}

/// 当地天气与预报必须与内核的 `World::weather_on` 一致。
fn assert_local_matches(w: &World, region: RegionId) {
    let o = views::overview(w, 1, "off".into(), None);
    let lw = o.local_weather.clone().expect("有当地天气");
    assert_eq!(lw.region, region.0);
    assert_eq!(lw.region_name, w.defs.region(region).name);
    let today = w.weather_today(region).unwrap();
    assert_eq!((lw.sky, lw.wind_dir, lw.wind_strength), (today.sky, today.wind_dir(), today.wind_strength()));
    assert_eq!(lw.forecast.len(), 2, "未来两天");
    for (k, f) in lw.forecast.iter().enumerate() {
        let day = w.day() + k as u32 + 1;
        let want = w.weather_on(region, day).unwrap();
        assert_eq!(
            (f.day, f.sky, f.wind_dir, f.wind_strength),
            (day, want.sky, want.wind_dir(), want.wind_strength()),
            "第 {day} 天的预报"
        );
    }
    local_json_shape(&o);
}

#[test]
fn local_weather_follows_the_flagship_and_matches_the_kernel_forecast() {
    let mut w = World::new(tiny_defs(), ScenarioId(0), 5).unwrap();
    let defs = w.defs.clone();
    // 西海起风暴：预报按当前生效的事件修正计算
    w.state.events.active.push(ActiveEvent {
        id: 0,
        kind: EventTypeId(1),
        params: EventParams {
            region: Some(RegionId(0)),
            mult: Some(Fx::from_pct(250)),
            days: Some(60),
            ..EventParams::default()
        },
        start: 0,
        end: 60,
        effect: Some(EffectKind::RegionStorm),
        origin: EventOrigin::Catalog,
    });
    let json = serde_json::to_string(&w.state).unwrap();
    let mut w = World::from_snapshot(defs.clone(), serde_json::from_str(&json).unwrap()).unwrap();
    assert_eq!(w.storm_mult(RegionId(0)), Fx::from_pct(250));
    // 停泊在 alpha：取港口停泊格的海区（西海）
    let fid = w.fleets_of(OwnerId::Player).next().map(|f| f.id).unwrap();
    let alpha = defs.map.region_of(defs.loc(LocId(0)).cell).unwrap();
    assert_eq!(views::local_region(&w), Some(alpha));
    for _ in 0..3 {
        assert_local_matches(&w, alpha);
        w.end_day().unwrap();
    }
    // 在海上：取所在格的海区（东海）
    w.fleet_mut(fid).unwrap().location = FleetLocation::AtSea(Voyage::Route(manifest_core::world::RouteVoyage {
        dest: LocId(1),
        path: vec![Cell::new(30, 3), Cell::new(31, 3)],
        step: 0,
        leg_progress: Fx::ZERO,
    }));
    assert_eq!(views::local_region(&w), Some(RegionId(1)));
    assert_local_matches(&w, RegionId(1));
    // 没有舰队：取本据港（剧本起始港 alpha）
    w.state.fleets.clear();
    assert_eq!(w.state.agents[&OwnerId::Player].home, defs.scenarios[0].start);
    assert_eq!(views::local_region(&w), Some(alpha));
    assert_local_matches(&w, alpha);
}

#[test]
fn location_views_carry_the_region_of_their_anchorage() {
    let defs = manifest_data::load_default().unwrap_or_else(|e| panic!("{e}"));
    let statics = views::static_view(&defs);
    assert_eq!(statics.locations.len(), defs.locations.len());
    let mut ports = 0;
    for (l, v) in defs.locations.iter().zip(&statics.locations) {
        let want = if defs.map.is_sea(l.cell) { defs.map.region_of(l.cell).map(|r| r.0) } else { None };
        assert_eq!(v.region, want, "{} 的海区", l.key);
        if l.is_port() || l.is_site() {
            assert!(v.region.is_some(), "港口与殖民点停泊在海格上：{}", l.key);
            ports += 1;
        }
        if l.kind == manifest_core::defs::LocKind::City {
            assert_eq!(v.region, None, "内陆城市没有海区：{}", l.key);
        }
    }
    assert!(ports > 0);
    // JSON：region 为数字或 null
    let json = serde_json::to_value(&statics).unwrap();
    for l in json["locations"].as_array().unwrap() {
        assert!(l["region"].is_u64() || l["region"].is_null(), "{l}");
    }
}
