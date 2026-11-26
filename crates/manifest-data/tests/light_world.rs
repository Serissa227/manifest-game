//! P07：规则缺省关闭，只由寰宇显式开启；未知键继续拒绝。
#[test]
fn only_terra16_enables_light_world() {
    let root = manifest_data::find_data_dir().unwrap();
    for (key, enabled) in [("classic", false), ("testbed", false), ("terra16", true)] {
        let defs = manifest_data::load_world(&root, key).unwrap();
        assert_eq!(defs.rules.upbringing.light_world, enabled, "{key}");
    }
}
