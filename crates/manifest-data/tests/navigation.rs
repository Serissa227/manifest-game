//! 导航配置按世界日历解析；经典真实航线的字节兼容另由回放与金标准验证。

use manifest_core::calendar::Calendar;
use manifest_core::nav::{NavGrid, SeaMap, Terrain};
use manifest_core::{Cell, LocId};

#[test]
fn navigation_toml_validates_projection_months_and_named_ports() {
    let map =
        SeaMap { width: 4, height: 4, wrap_x: true, terrain: vec![Terrain::Deep; 16], region: vec![u16::MAX; 16] };
    let text = "[projection]\nkind = 'equirect'\nwest = -10800\nnorth = 4320\narcmin_per_cell = 20\nlat_scale = true\n[frozen_ports]\nwhite_sea = [1, 2, 12]\n";
    let ports = [("white_sea".into(), LocId(0))];
    let rules = manifest_data::parse_navigation(text, &Calendar::default(), &map, &[], &ports).unwrap();
    assert_eq!(rules.period_count(), 12);
    let grid = NavGrid::with_rules(&map, &[], &[(LocId(0), Cell::new(0, 0))], rules).unwrap();
    assert_eq!(grid.check_port(0, LocId(0)).unwrap_err().code(), "frozen_port");
    for invalid in [
        text.replace("[1, 2, 12]", "[0]"),
        text.replace("white_sea", "unknown"),
        text.replace("4320", "9999"),
        text.replace("20", "0"),
        text.replace("equirect", "unknown"),
    ] {
        assert!(
            manifest_data::parse_navigation(&invalid, &Calendar::default(), &map, &[], &ports).is_err(),
            "{invalid}"
        );
    }
}

#[test]
fn monthly_weather_and_southern_daily_weather_use_world_calendar() {
    let mut defs = (*manifest_core::testkit::tiny_defs()).clone();
    let key = &defs.regions[0].key;
    let weather = "{wind_dir=2, wind_strength=5, current_dir=6, current_strength=2}";
    let text = format!("[regions.{key}]\nsouth=true\nfrozen_months=[1]\nweather=[{}]\n", [weather; 12].join(","));
    let calendar = Calendar::new(
        vec![31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31],
        vec![3, 3, 0, 0, 0, 1, 1, 1, 2, 2, 2, 3],
        "公元".into(),
        vec![],
    )
    .unwrap();
    let rules = manifest_data::parse_navigation(&text, &calendar, &defs.map, &defs.regions, &[]).unwrap();
    defs.regions[0].climate = manifest_core::weather::Climate::Cold;
    let grid = NavGrid::with_rules(&defs.map, &defs.regions, &[], rules).unwrap();
    let jobs = manifest_core::nav::NavTable::jobs_for(&grid, &[]);
    defs.nav = std::sync::Arc::new(manifest_core::nav::NavTable::assemble(grid, 0, &[], &jobs, vec![]));
    let mut snow = 0;
    for day in 151..243 {
        let w = manifest_core::weather::day_weather(&defs, 42, manifest_core::RegionId(0), day, manifest_core::Fx::ONE)
            .unwrap();
        assert_eq!((w.sea.current_dir, w.sea.current_strength), (6, 2));
        assert_ne!(w.sky, manifest_core::weather::Sky::Rain);
        snow += usize::from(w.sky == manifest_core::weather::Sky::Snow);
    }
    assert!(snow > 0, "南半球六月至八月有雪");
    assert!(
        manifest_data::parse_navigation(
            &text.replace("wind_dir=2", "wind_dir=8"),
            &calendar,
            &defs.map,
            &defs.regions,
            &[]
        )
        .is_err()
    );
}
