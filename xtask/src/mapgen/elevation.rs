//! ETOPO5 大端 i16。经度从 0° 向东，纬度从 90° 向南；海陆样本分别聚合。

use super::coast::Projection;
use anyhow::{Result, ensure};

pub const WIDTH: usize = 4320;
pub const HEIGHT: usize = 2160;

pub struct Etopo {
    samples: Vec<i16>,
    nodata: i16,
}

#[derive(Debug)]
pub struct Elevation {
    pub meters: Vec<i32>,
    /// 岛或补丁格没有同类样本时保留明确的缺测诊断，不用异类样本相抵。
    pub missing_land: usize,
    pub missing_water: usize,
    pub nodata_samples: usize,
}

impl Etopo {
    pub fn decode(bytes: &[u8], nodata: i16) -> Result<Self> {
        ensure!(bytes.len() == WIDTH * HEIGHT * 2, "ETOPO5 必须是 4320 × 2160 个大端 i16（18662400 字节）");
        Ok(Self { samples: bytes.chunks_exact(2).map(|b| i16::from_be_bytes([b[0], b[1]])).collect(), nodata })
    }

    /// 一个原始样本（列从 0° 经线向东、可取模；行从北纬 90° 向南）；越界或缺测为 None。
    pub fn sample(&self, x: i64, y: i64) -> Option<i16> {
        if !(0..HEIGHT as i64).contains(&y) {
            return None;
        }
        let value = self.samples[y as usize * WIDTH + x.rem_euclid(WIDTH as i64) as usize];
        (value != self.nodata).then_some(value)
    }

    pub fn aggregate(&self, projection: Projection, land: &[bool]) -> Result<Elevation> {
        ensure!(land.len() == projection.width * projection.height, "高程掩膜尺寸错误");
        ensure!(
            projection.arcmin.is_multiple_of(5) && projection.west % 5 == 0 && projection.north % 5 == 0,
            "ETOPO5 聚合要求投影边界及格宽对齐 5 角分"
        );
        let n = i64::from(projection.arcmin / 5);
        let mut result =
            Elevation { meters: Vec::with_capacity(land.len()), missing_land: 0, missing_water: 0, nodata_samples: 0 };
        for (i, &is_land) in land.iter().enumerate() {
            let x = i64::from(projection.west / 5) + (i % projection.width) as i64 * n;
            let y = i64::from((5400 - projection.north) / 5) + (i / projection.width) as i64 * n;
            let (mut sum, mut count) = (0i64, 0i64);
            for yy in y..y + n {
                for xx in x..x + n {
                    if let Some(value) = self.sample(xx, yy) {
                        if (value >= 0) == is_land {
                            sum += i64::from(value);
                            count += 1;
                        }
                    } else {
                        result.nodata_samples += 1;
                    }
                }
            }
            let value = if count > 0 {
                // 向下取整保证平均-200.5m不会被截成浅海边界-200m。
                sum.div_euclid(count) as i32
            } else if is_land {
                result.missing_land += 1;
                0
            } else {
                result.missing_water += 1;
                -1
            };
            result.meters.push(value);
        }
        Ok(result)
    }
}

pub fn terrain(land: bool, meters: i32) -> char {
    if land {
        '#'
    } else if meters >= -200 {
        '~'
    } else {
        '.'
    }
}

pub fn relief(meters: i32) -> char {
    let level = [100, 250, 500, 1000, 1500, 2000, 3000, 4000, 5000].iter().filter(|&&v| meters >= v).count();
    (b'0' + level as u8) as char
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn etopo_big_endian_rotation_north_origin_nodata_and_separate_aggregation() {
        let mut bytes = vec![0; WIDTH * HEIGHT * 2];
        let mut put = |x: usize, y: usize, v: i16| {
            let i = (y * WIDTH + x) * 2;
            bytes[i..i + 2].copy_from_slice(&v.to_be_bytes());
        };
        // 180°E 是输出西缘；72°N 是输入第216行，测试避免落在对称的零值上。
        for y in 216..220 {
            for x in 2160..2164 {
                put(x, y, 300);
            }
        }
        put(2160, 216, -1000);
        put(2161, 216, i16::MIN);
        put(0, 216, 1234);
        let data = Etopo::decode(&bytes, i16::MIN).expect("解码");
        assert_eq!(data.sample(0, 216), Some(1234));
        assert_eq!(data.sample(-2160, 216), Some(-1000));
        let p = Projection { width: 1, height: 1, ..Projection::earth() };
        let a = data.aggregate(p, &[true]).expect("陆地");
        let b = data.aggregate(p, &[false]).expect("海洋");
        assert_eq!(a.meters, [300]);
        assert_eq!(b.meters, [-1000]);
        assert_eq!(a.nodata_samples, 1);
        assert!(Etopo::decode(&bytes[..bytes.len() - 1], i16::MIN).is_err());
    }

    #[test]
    fn shallow_boundary_and_missing_classes_are_explicit() {
        assert_eq!(terrain(false, -200), '~');
        assert_eq!(terrain(false, -201), '.');
        assert_eq!(terrain(true, 10), '#');
        assert_eq!(relief(99), '0');
        assert_eq!(relief(100), '1');
        assert_eq!(relief(8848), '9');
        let data = Etopo { samples: vec![i16::MIN; WIDTH * HEIGHT], nodata: i16::MIN };
        let p = Projection { width: 2, height: 1, ..Projection::earth() };
        let a = data.aggregate(p, &[true, false]).expect("缺测");
        assert_eq!(a.meters, [0, -1]);
        assert_eq!((a.missing_land, a.missing_water, a.nodata_samples), (1, 1, 32));
    }

    #[test]
    fn fractional_negative_mean_stays_below_the_shallow_boundary() {
        let mut data = Etopo { samples: vec![0; WIDTH * HEIGHT], nodata: i16::MIN };
        data.samples[0] = -200;
        data.samples[1] = -201;
        let p = Projection { width: 1, height: 1, west: 0, north: 5400, arcmin: 10 };
        let a = data.aggregate(p, &[false]).expect("负数均值");
        assert_eq!(a.meters, [-201]);
        assert_eq!(terrain(false, a.meters[0]), '.');
    }
}
