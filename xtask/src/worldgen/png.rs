//! 最小的 PNG 编码器（RGB，zlib 不压缩块），只用于生成器的调试大图。

fn crc_table() -> [u32; 256] {
    let mut t = [0u32; 256];
    for (n, slot) in t.iter_mut().enumerate() {
        let mut c = n as u32;
        for _ in 0..8 {
            c = if c & 1 != 0 { 0xedb8_8320 ^ (c >> 1) } else { c >> 1 };
        }
        *slot = c;
    }
    t
}

fn crc(table: &[u32; 256], data: &[u8]) -> u32 {
    let mut c = 0xffff_ffffu32;
    for &b in data {
        c = table[((c ^ b as u32) & 0xff) as usize] ^ (c >> 8);
    }
    c ^ 0xffff_ffff
}

fn adler(data: &[u8]) -> u32 {
    let (mut a, mut b) = (1u32, 0u32);
    for &x in data {
        a = (a + x as u32) % 65521;
        b = (b + a) % 65521;
    }
    (b << 16) | a
}

fn chunk(out: &mut Vec<u8>, table: &[u32; 256], kind: &[u8; 4], data: &[u8]) {
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    let mut body = Vec::with_capacity(4 + data.len());
    body.extend_from_slice(kind);
    body.extend_from_slice(data);
    out.extend_from_slice(&body);
    out.extend_from_slice(&crc(table, &body).to_be_bytes());
}

/// RGB 图像（每像素 3 字节）编码为 PNG。
pub fn encode_rgb(w: usize, h: usize, rgb: &[u8]) -> Vec<u8> {
    let table = crc_table();
    let mut raw = Vec::with_capacity((w * 3 + 1) * h);
    for y in 0..h {
        raw.push(0);
        raw.extend_from_slice(&rgb[y * w * 3..(y + 1) * w * 3]);
    }
    let mut z = vec![0x78, 0x01];
    let mut rest: &[u8] = &raw;
    loop {
        let n = rest.len().min(65_535);
        let last = n == rest.len();
        z.push(u8::from(last));
        z.extend_from_slice(&(n as u16).to_le_bytes());
        z.extend_from_slice(&(!(n as u16)).to_le_bytes());
        z.extend_from_slice(&rest[..n]);
        rest = &rest[n..];
        if last {
            break;
        }
    }
    z.extend_from_slice(&adler(&raw).to_be_bytes());
    let mut out = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
    let mut ihdr = Vec::new();
    ihdr.extend_from_slice(&(w as u32).to_be_bytes());
    ihdr.extend_from_slice(&(h as u32).to_be_bytes());
    ihdr.extend_from_slice(&[8, 2, 0, 0, 0]);
    chunk(&mut out, &table, b"IHDR", &ihdr);
    chunk(&mut out, &table, b"IDAT", &z);
    chunk(&mut out, &table, b"IEND", &[]);
    out
}

/// 简单的 RGB 画布。
pub struct Canvas {
    pub w: usize,
    pub h: usize,
    pub px: Vec<u8>,
}

impl Canvas {
    pub fn new(w: usize, h: usize) -> Self {
        Canvas { w, h, px: vec![0; w * h * 3] }
    }

    pub fn put(&mut self, x: i64, y: i64, c: [u8; 3]) {
        if x >= 0 && y >= 0 && (x as usize) < self.w && (y as usize) < self.h {
            let i = (y as usize * self.w + x as usize) * 3;
            self.px[i..i + 3].copy_from_slice(&c);
        }
    }

    pub fn rect(&mut self, x: i64, y: i64, w: i64, h: i64, c: [u8; 3]) {
        for yy in y..y + h {
            for xx in x..x + w {
                self.put(xx, yy, c);
            }
        }
    }

    /// 粗线段（Bresenham，线宽 `t` 像素）。
    pub fn line(&mut self, x0: i64, y0: i64, x1: i64, y1: i64, t: i64, c: [u8; 3]) {
        let (dx, dy) = ((x1 - x0).abs(), -(y1 - y0).abs());
        let (sx, sy) = (if x0 < x1 { 1 } else { -1 }, if y0 < y1 { 1 } else { -1 });
        let (mut x, mut y, mut err) = (x0, y0, dx + dy);
        loop {
            self.rect(x - t / 2, y - t / 2, t.max(1), t.max(1), c);
            if x == x1 && y == y1 {
                break;
            }
            let e2 = 2 * err;
            if e2 >= dy {
                err += dy;
                x += sx;
            }
            if e2 <= dx {
                err += dx;
                y += sy;
            }
        }
    }

    pub fn png(&self) -> Vec<u8> {
        encode_rgb(self.w, self.h, &self.px)
    }

    /// 裁剪并放大。
    pub fn crop_scaled(&self, x: usize, y: usize, w: usize, h: usize, k: usize) -> Canvas {
        let mut c = Canvas::new(w * k, h * k);
        for yy in 0..h * k {
            for xx in 0..w * k {
                let (sx, sy) = (x + xx / k, y + yy / k);
                if sx < self.w && sy < self.h {
                    let i = (sy * self.w + sx) * 3;
                    let o = (yy * c.w + xx) * 3;
                    c.px[o..o + 3].copy_from_slice(&self.px[i..i + 3]);
                }
            }
        }
        c
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn png_has_signature_and_iend() {
        let c = Canvas::new(3, 2);
        let p = c.png();
        assert_eq!(&p[..8], &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]);
        assert_eq!(&p[p.len() - 8..p.len() - 4], b"IEND");
    }
}
