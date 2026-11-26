//! E19 的固定大地图夹具：纯整数生成海岸，文件只写入调用者提供的空目录。

use manifest_core::Cell;
use manifest_core::nav::{MapTopology, SeaMap, Terrain};
use std::io;
use std::path::Path;

pub const WORLD_KEY: &str = "synth1080";
pub const WIDTH: u16 = 1080;
pub const HEIGHT: u16 = 396;
pub const PORTS: usize = 150;
pub const COMPANIES: usize = 12;

fn ellipse(topology: MapTopology, cell: Cell, center: Cell, rx: i64, ry: i64) -> bool {
    let dx = i64::from(topology.dx(center.x, cell.x));
    let dy = i64::from(cell.y) - i64::from(center.y);
    dx * dx * ry * ry + dy * dy * rx * rx <= rx * rx * ry * ry
}

fn map() -> SeaMap {
    let topology = MapTopology::new(WIDTH, HEIGHT, true);
    let mut map = SeaMap {
        width: WIDTH,
        height: HEIGHT,
        wrap_x: true,
        terrain: vec![Terrain::Deep; usize::from(WIDTH) * usize::from(HEIGHT)],
        region: vec![0; usize::from(WIDTH) * usize::from(HEIGHT)],
    };
    let continents = [(180, 135, 145, 110), (420, 270, 155, 85), (720, 150, 150, 112), (990, 265, 110, 95)];
    for y in 0..HEIGHT {
        for x in 0..WIDTH {
            let cell = Cell::new(x, y);
            let mainland = continents.iter().any(|&(cx, cy, rx, ry)| {
                // 小幅、固定的海岸起伏；不借用平台浮点或随机数状态。
                let indent = i64::from((x / 7 + y / 11) % 9);
                ellipse(topology, cell, Cell::new(cx, cy), rx - indent, ry)
            });
            let islands = (0..36u16).any(|i| {
                let center = Cell::new((45 + i * 29) % WIDTH, 30 + (i * 67) % 336);
                ellipse(topology, cell, center, 3 + i64::from(i % 5), 4 + i64::from(i % 7))
            });
            // 三格宽的横、纵水道；大陆与群岛之间保留可航行的海峡。
            let strait = (198..=200).contains(&y) || (705..=707).contains(&x);
            if (mainland || islands) && !strait {
                let idx = map.idx(cell);
                map.terrain[idx] = Terrain::Land;
            }
        }
    }
    for y in 0..HEIGHT {
        for x in 0..WIDTH {
            let cell = Cell::new(x, y);
            if map.is_sea(cell) && map.touches_land(cell) {
                let idx = map.idx(cell);
                map.terrain[idx] = Terrain::Shallow;
            }
        }
    }
    map
}

fn write(path: &Path, text: &str) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, text)
}

/// 不写文件的导航基准输入；与 B2 的海岸和锚地抽样口径相同，可按真实规模取 165 港。
pub fn navigation_fixture(port_count: usize) -> io::Result<(SeaMap, Vec<(manifest_core::LocId, Cell)>)> {
    let mut map = map();
    let reachable = map.reachable_from(Cell::new(0, 0));
    let coast: Vec<Cell> = (0..map.terrain.len())
        .filter(|&i| reachable[i] && map.terrain[i] == Terrain::Shallow)
        .map(|i| map.cell_of(i))
        .collect();
    if port_count == 0 || port_count > coast.len() || port_count > usize::from(u16::MAX) {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "合成港口数量无效"));
    }
    for i in 0..map.terrain.len() {
        map.region[i] = if map.terrain[i] == Terrain::Land { u16::MAX } else { map.cell_of(i).y / 99 };
    }
    let ports =
        (0..port_count).map(|i| (manifest_core::LocId(i as u16), coast[i * coast.len() / port_count])).collect();
    Ok((map, ports))
}

/// 从现有数据复制共享经济定义，再生成独立的隐藏世界和地图包。
/// 输出目录必须为空，且不能与输入数据目录相互包含；不会覆盖原有数据。
pub fn write_world(source: &Path, output: &Path) -> io::Result<()> {
    std::fs::create_dir_all(output)?;
    let source = source.canonicalize()?;
    let output = output.canonicalize()?;
    if output.starts_with(&source) || source.starts_with(&output) || std::fs::read_dir(&output)?.next().is_some() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "合成夹具须写入与输入分离的空目录"));
    }
    let map = map();
    let reachable = map.reachable_from(Cell::new(0, 0));
    let coast: Vec<Cell> = (0..map.terrain.len())
        .filter(|&i| reachable[i] && map.terrain[i] == Terrain::Shallow)
        .map(|i| map.cell_of(i))
        .collect();
    if coast.len() < PORTS {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "合成地图没有足够的连通港口锚地"));
    }
    let ports: Vec<Cell> = (0..PORTS).map(|i| coast[i * coast.len() / PORTS]).collect();
    super::copy_dir(&source, &output)?;
    let maps = output.join("maps").join(WORLD_KEY);
    let world = output.join("worlds").join(WORLD_KEY);
    write(
        &maps.join("map.toml"),
        &format!(
            "# 固定合成基准图，不代表真实地理。\nkey = '{WORLD_KEY}'\nname = '合成大海图'\nwidth = {WIDTH}\nheight = {HEIGHT}\nwrap_x = true\n"
        ),
    )?;
    let mut grid = String::from("// 确定性大陆、群岛与海峡；. 深海、~ 浅海、# 陆地。\n");
    for row in map.terrain.chunks(usize::from(WIDTH)) {
        for cell in row {
            grid.push(match cell {
                Terrain::Deep => '.',
                Terrain::Shallow => '~',
                Terrain::Land => '#',
            });
        }
        grid.push('\n');
    }
    write(&maps.join("map.txt"), &grid)?;
    let mut regions = String::from("# 四个纬度海区，四季各有确定的风流。\n");
    for i in 0..4 {
        regions.push_str(&format!(
            "\n[[regions]]\nkey = 'sea_{i}'\nname = '合成海区 {i}'\nrect = [0, {}, 1079, {}]\nclimate = 'temperate'\n",
            i * 99,
            i * 99 + 98
        ));
        for (s, name) in ["spring", "summer", "autumn", "winter"].into_iter().enumerate() {
            let wind = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][(i + s * 2) % 8];
            regions.push_str(&format!("{name} = {{wind = '{wind}', wind_strength = 4, current = 'E', current_strength = 1, storm = 0, pirate = 0}}\n"));
        }
    }
    write(&maps.join("regions.toml"), &regions)?;
    write(
        &world.join("world.toml"),
        "# 固定性能夹具，继承共享经济内容，关闭引用经典地点的人物与故事。\nkey = 'synth1080'\nname = '合成大地图基准'\nmap = 'synth1080'\ninherit = 'classic'\nhidden = true\n[modules]\ncaptain = false\nstories = false\nnavigation = 'route'\n[tables]\nscenarios = ['scenarios/sandbox.toml']\n",
    )?;
    for (name, text) in [
        ("cities", "cities = []"),
        ("sites", "ports = []\nsites = []"),
        ("roads", "roads = []"),
        ("discoveries", "discoveries = []"),
        ("mates", "mates = []"),
        ("workshops", "workshops = []"),
        ("futures", "exchanges = []\ncontracts = []"),
    ] {
        write(&world.join(format!("{name}.toml")), &format!("# 测试世界不使用此表。\n{text}\n"))?;
    }
    let mut locations = String::from("# 150 个沿海锚地均与外洋连通；依行优先海岸列表等距抽取。\n");
    let goods = ["grain", "timber", "wine", "wool", "tea", "spice"];
    for (i, cell) in ports.iter().enumerate() {
        locations.push_str(&format!("\n[[ports]]\nkey = 'port_{i:03}'\nname = '合成港 {i:03}'\npos = [{}, {}]\nfaction = 'cuilan'\ndevelopment = 50\nshipyard = ['swallow', 'tradewind']\nmarket = [\n", cell.x, cell.y));
        for (g, good) in goods.iter().enumerate() {
            locations.push_str(&format!(
                "  {{good = '{good}', supply = {}, demand = {}}},\n",
                10 + (i + g * 3) % 9,
                10 + (i * 3 + g) % 9
            ));
        }
        locations.push_str("]\n");
    }
    write(&world.join("ports.toml"), &locations)?;
    let mut companies = String::from("# 十二个商会分散开局，使冒烟测试包含航行和交易。\n");
    for i in 0..COMPANIES {
        companies.push_str(&format!("\n[[companies]]\nkey = 'company_{i:02}'\nname = '合成商会 {i:02}'\nhome = 'port_{:03}'\ncash = 40000\nships = ['tradewind']\npreferred = ['grain', 'tea']\nrisk = 0.5\n", i * PORTS / COMPANIES));
    }
    write(&world.join("companies.toml"), &companies)?;
    write(
        &world.join("scenarios/sandbox.toml"),
        "# 无期限的三十日基准开局。\nkey = 'sandbox'\nname = '合成航行'\ndescription = '合成大地图冒烟测试。'\nstart = 'port_000'\ncash = 30000\nships = ['swallow']\ncrew = 14\n[goal]\nkind = 'sandbox'\n",
    )
}
