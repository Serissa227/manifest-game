// 生成文件：由 tools/orchestra/build.py 写出，不要手改（改采样的挑选与处理请改那个脚本，再重新运行）。
//
// 管弦版配乐的采样清单。采样来自 VS Chamber Orchestra: Community Edition（VSCO 2 CE，CC0 1.0 公有领域），
// Versilian Studios 出品：Sam Gossner、Simon Dalzell 录音，Elan Hickler / Soundemote 剪辑；
// https://github.com/sgossner/VSCO-2-CE（提交 4403009）。CC0 不要求署名，这里照样写明出处。
// 文件在 frontend/public/audio/orchestra/ 下；时间都以秒计、从文件开头算，浏览器解码后按 mark 对齐（见 bank.ts）。

/** 一个采样。 */
export interface SampleZone {
  /** 文件（相对 public/audio/orchestra/） */
  file: string;
  /** 音高（MIDI，可有小数：按实测的音准）；无音高的打击乐为 null */
  pitch: number | null;
  /** 力度层（0 最弱） */
  layer: number;
  /** 轮换序号（同一个音的几次录音轮流用） */
  rr: number;
  /** 播放时乘的增益：把这个采样校到这一组统一的响度 */
  gain: number;
  /** 长度（秒） */
  length: number;
  /** 起音标记：|x| 第一次超过峰值 0.5% 的时刻（秒）。解码后的位置减去它就是解码器多出来的延迟 */
  mark: number;
  /** 奏稳的时刻（秒）：长音的包络第一次到达持续部分典型响度的 70%（渐强慢的弱奏要一两秒）；其余为 0 */
  attack: number;
  /** 最响处（秒）：吊镲渐强这类要把最响处对准拍子 */
  peak: number;
  /** 循环段：[起点, 终点, 接缝交叉淡化的长度, 接缝两边的相关系数]（长音才有） */
  loop: readonly [number, number, number, number] | null;
  /** 文件字节数 */
  bytes: number;
  /** 内容哈希（前 8 位，URL 上带着它，换了采样浏览器不会用旧缓存） */
  hash: string;
}

/** 一组采样（一件乐器的一种奏法）。 */
export interface SampleSet {
  /** 长音（可循环）、一次性、无音高的打击乐 */
  kind: "sustain" | "shot" | "hit";
  /** 立体声 */
  stereo: boolean;
  zones: readonly SampleZone[];
}

export const SAMPLE_SETS: Readonly<Record<string, SampleSet>> = {
  /** 大管，揉音长音 */
  "bn.sus": {
    kind: "sustain",
    stereo: false,
    zones: [
      { file: "bn-sus/G2-l0-r0.mp3", pitch: 42.997, layer: 0, rr: 0, gain: 0.2688, length: 2.602, mark: 0.0012, peak: 1.46, attack: 0.057, loop: [0.32, 2.4737, 0.08, 0.978], bytes: 18377, hash: "dc72a73e" },
      { file: "bn-sus/A2-l0-r0.mp3", pitch: 44.99, layer: 0, rr: 0, gain: 0.3173, length: 2.602, mark: 0.0015, peak: 0.3, attack: 0.067, loop: [0.54, 2.3135, 0.08, 0.994], bytes: 16063, hash: "ca9be552" },
      { file: "bn-sus/C3-l0-r0.mp3", pitch: 47.996, layer: 0, rr: 0, gain: 0.3124, length: 2.602, mark: 0, peak: 0.14, attack: 0.057, loop: [1.18, 2.5336, 0.08, 0.997], bytes: 18039, hash: "49b55174" },
      { file: "bn-sus/G3-l0-r0.mp3", pitch: 55, layer: 0, rr: 0, gain: 0.2196, length: 2.602, mark: 0.0017, peak: 1.72, attack: 0.127, loop: [1.32, 2.4118, 0.08, 0.992], bytes: 18585, hash: "c190cf32" },
      { file: "bn-sus/A3-l0-r0.mp3", pitch: 56.999, layer: 0, rr: 0, gain: 0.2081, length: 2.602, mark: 0.0017, peak: 2.35, attack: 0.037, loop: [0.32, 2.5381, 0.08, 0.989], bytes: 18403, hash: "753a5692" },
      { file: "bn-sus/C4-l0-r0.mp3", pitch: 59.997, layer: 0, rr: 0, gain: 0.2271, length: 2.629, mark: 0.0015, peak: 2.39, attack: 1.177, loop: [1.477, 2.49, 0.08, 0.983], bytes: 16921, hash: "f4ce9b6b" },
      { file: "bn-sus/E4-l0-r0.mp3", pitch: 64.013, layer: 0, rr: 0, gain: 0.2628, length: 2.602, mark: 0.0012, peak: 0.24, attack: 0.187, loop: [0.56, 1.6606, 0.08, 0.988], bytes: 18143, hash: "96f05803" },
      { file: "bn-sus/G4-l0-r0.mp3", pitch: 66.996, layer: 0, rr: 0, gain: 0.1999, length: 2.602, mark: 0.0006, peak: 2.15, attack: 0.397, loop: [1.497, 2.5407, 0.08, 0.984], bytes: 20772, hash: "e1da5a00" },
      { file: "bn-sus/A4-l0-r0.mp3", pitch: 68.998, layer: 0, rr: 0, gain: 0.2454, length: 2.602, mark: 0.0017, peak: 0.98, attack: 0.157, loop: [0.5, 2.5203, 0.08, 0.987], bytes: 21741, hash: "8781f6fb" },
      { file: "bn-sus/C5-l0-r0.mp3", pitch: 72.025, layer: 0, rr: 0, gain: 0.3994, length: 2.602, mark: 0.0018, peak: 1.11, attack: 0.227, loop: [1.467, 2.4994, 0.08, 0.997], bytes: 20719, hash: "65fd54ad" },
    ],
  },
  /** 低音提琴，拨奏，两个轮换 */
  "cb.pizz": {
    kind: "shot",
    stereo: false,
    zones: [
      { file: "cb-pizz/E1-l0-r1.mp3", pitch: 27.934, layer: 0, rr: 1, gain: 0.4466, length: 1.302, mark: 0, peak: 0.03, attack: 0, loop: null, bytes: 9746, hash: "8e6c60ac" },
      { file: "cb-pizz/E1-l0-r0.mp3", pitch: 27.967, layer: 0, rr: 0, gain: 0.3984, length: 1.302, mark: 0, peak: 0.54, attack: 0, loop: null, bytes: 10552, hash: "a40a1ccd" },
      { file: "cb-pizz/Fs1-l0-r0.mp3", pitch: 29.822, layer: 0, rr: 0, gain: 0.3366, length: 1.302, mark: 0.0002, peak: 0.15, attack: 0, loop: null, bytes: 10292, hash: "cee8fdc0" },
      { file: "cb-pizz/Fs1-l0-r1.mp3", pitch: 29.845, layer: 0, rr: 1, gain: 0.3416, length: 1.302, mark: 0.0016, peak: 0.14, attack: 0, loop: null, bytes: 9980, hash: "28eb0ceb" },
      { file: "cb-pizz/G1-l0-r0.mp3", pitch: 30.769, layer: 0, rr: 0, gain: 0.3956, length: 0.961, mark: 0, peak: 0.07, attack: 0, loop: null, bytes: 7824, hash: "07ca0d49" },
      { file: "cb-pizz/G1-l0-r1.mp3", pitch: 30.781, layer: 0, rr: 1, gain: 0.4526, length: 1.302, mark: 0.0001, peak: 0.08, attack: 0, loop: null, bytes: 9590, hash: "95e57cdf" },
      { file: "cb-pizz/As1-l0-r0.mp3", pitch: 33.925, layer: 0, rr: 0, gain: 0.384, length: 1.302, mark: 0.0007, peak: 0.07, attack: 0, loop: null, bytes: 9694, hash: "0f6648e2" },
      { file: "cb-pizz/As1-l0-r1.mp3", pitch: 33.958, layer: 0, rr: 1, gain: 0.4195, length: 1.302, mark: 0.0001, peak: 0.08, attack: 0, loop: null, bytes: 8654, hash: "6e51b97c" },
      { file: "cb-pizz/C2-l0-r1.mp3", pitch: 35.793, layer: 0, rr: 1, gain: 0.4888, length: 1.302, mark: 0.0002, peak: 0.1, attack: 0, loop: null, bytes: 8445, hash: "cd590f99" },
      { file: "cb-pizz/C2-l0-r0.mp3", pitch: 35.859, layer: 0, rr: 0, gain: 0.471, length: 1.302, mark: 0.0002, peak: 0.08, attack: 0, loop: null, bytes: 8810, hash: "c92be6ef" },
      { file: "cb-pizz/D2-l0-r1.mp3", pitch: 37.99, layer: 0, rr: 1, gain: 0.2527, length: 1.302, mark: 0.0013, peak: 0.12, attack: 0, loop: null, bytes: 9460, hash: "7159674d" },
      { file: "cb-pizz/D2-l0-r0.mp3", pitch: 38.057, layer: 0, rr: 0, gain: 0.2382, length: 1.302, mark: 0.0003, peak: 0.11, attack: 0, loop: null, bytes: 9225, hash: "22a28fca" },
      { file: "cb-pizz/E2-l0-r0.mp3", pitch: 39.932, layer: 0, rr: 0, gain: 0.5069, length: 1.302, mark: 0.0001, peak: 0.07, attack: 0, loop: null, bytes: 9694, hash: "8178871f" },
      { file: "cb-pizz/E2-l0-r1.mp3", pitch: 40.081, layer: 0, rr: 1, gain: 0.5328, length: 1.302, mark: 0.0001, peak: 0.08, attack: 0, loop: null, bytes: 9409, hash: "3fab11de" },
      { file: "cb-pizz/Fs2-l0-r0.mp3", pitch: 41.836, layer: 0, rr: 0, gain: 0.3374, length: 1.302, mark: 0.0003, peak: 0.15, attack: 0, loop: null, bytes: 9538, hash: "6f655579" },
      { file: "cb-pizz/Fs2-l0-r1.mp3", pitch: 41.846, layer: 0, rr: 1, gain: 0.2986, length: 1.302, mark: 0.001, peak: 0.11, attack: 0, loop: null, bytes: 9876, hash: "65885a2e" },
      { file: "cb-pizz/Gs2-l0-r1.mp3", pitch: 43.712, layer: 0, rr: 1, gain: 0.3207, length: 1.302, mark: 0.0003, peak: 0.16, attack: 0, loop: null, bytes: 8003, hash: "02e4e055" },
      { file: "cb-pizz/Gs2-l0-r0.mp3", pitch: 44.223, layer: 0, rr: 0, gain: 0.3068, length: 1.302, mark: 0.0001, peak: 0.15, attack: 0, loop: null, bytes: 7379, hash: "3027d598" },
      { file: "cb-pizz/A2-l0-r1.mp3", pitch: 45.334, layer: 0, rr: 1, gain: 0.3825, length: 1.302, mark: 0.0003, peak: 0.06, attack: 0, loop: null, bytes: 8003, hash: "cb73a932" },
      { file: "cb-pizz/A2-l0-r0.mp3", pitch: 45.414, layer: 0, rr: 0, gain: 0.3898, length: 1.302, mark: 0.0002, peak: 0.06, attack: 0, loop: null, bytes: 7640, hash: "cc4958f3" },
      { file: "cb-pizz/Cs3-l0-r0.mp3", pitch: 49.04, layer: 0, rr: 0, gain: 0.5333, length: 1.302, mark: 0.001, peak: 0.02, attack: 0, loop: null, bytes: 8888, hash: "f62438c6" },
      { file: "cb-pizz/Cs3-l0-r1.mp3", pitch: 49.092, layer: 0, rr: 1, gain: 0.533, length: 1.302, mark: 0.0017, peak: 0.02, attack: 0, loop: null, bytes: 8342, hash: "cde5f19a" },
      { file: "cb-pizz/E3-l0-r1.mp3", pitch: 52.003, layer: 0, rr: 1, gain: 0.5052, length: 1.302, mark: 0.0005, peak: 0.03, attack: 0, loop: null, bytes: 8810, hash: "f6b53076" },
      { file: "cb-pizz/E3-l0-r0.mp3", pitch: 52.014, layer: 0, rr: 0, gain: 0.5114, length: 1.302, mark: 0.0011, peak: 0.04, attack: 0, loop: null, bytes: 9044, hash: "113bf356" },
      { file: "cb-pizz/Gs3-l0-r1.mp3", pitch: 55.968, layer: 0, rr: 1, gain: 0.3681, length: 1.302, mark: 0.0004, peak: 0.17, attack: 0, loop: null, bytes: 9668, hash: "3aa38625" },
      { file: "cb-pizz/Gs3-l0-r0.mp3", pitch: 55.969, layer: 0, rr: 0, gain: 0.4013, length: 1.302, mark: 0.0005, peak: 0.11, attack: 0, loop: null, bytes: 9668, hash: "b228aa5c" },
      { file: "cb-pizz/B3-l0-r0.mp3", pitch: 58.87, layer: 0, rr: 0, gain: 0.4523, length: 1.302, mark: 0.0002, peak: 0.05, attack: 0, loop: null, bytes: 10348, hash: "3c2cb8de" },
      { file: "cb-pizz/B3-l0-r1.mp3", pitch: 58.982, layer: 0, rr: 1, gain: 0.3744, length: 1.302, mark: 0.0002, peak: 0.11, attack: 0, loop: null, bytes: 10136, hash: "43eec83f" },
    ],
  },
  /** 低音提琴，揉弦长音（与大提琴组叠低八度） */
  "cb.sus": {
    kind: "sustain",
    stereo: false,
    zones: [
      { file: "cb-sus/Fs1-l0-r0.mp3", pitch: 30.005, layer: 0, rr: 0, gain: 0.3614, length: 2.702, mark: 0.0001, peak: 0.13, attack: 0.067, loop: [0.64, 2.6075, 0.12, 0.985], bytes: 21837, hash: "040457d4" },
      { file: "cb-sus/G1-l0-r0.mp3", pitch: 30.995, layer: 0, rr: 0, gain: 0.3477, length: 2.702, mark: 0.0003, peak: 1.48, attack: 0.067, loop: [1.52, 2.602, 0.12, 0.919], bytes: 22306, hash: "f419270c" },
      { file: "cb-sus/As1-l0-r0.mp3", pitch: 34.007, layer: 0, rr: 0, gain: 0.2454, length: 2.702, mark: 0.001, peak: 1.23, attack: 0.197, loop: [0.36, 2.591, 0.12, 0.986], bytes: 20665, hash: "5133ff72" },
      { file: "cb-sus/C2-l0-r0.mp3", pitch: 36.001, layer: 0, rr: 0, gain: 0.2856, length: 2.702, mark: 0.0014, peak: 1.89, attack: 0.147, loop: [0.74, 2.6358, 0.12, 0.985], bytes: 21420, hash: "b583dc4f" },
      { file: "cb-sus/D2-l0-r0.mp3", pitch: 37.993, layer: 0, rr: 0, gain: 0.298, length: 2.702, mark: 0.0001, peak: 0.47, attack: 0.067, loop: [0.86, 1.868, 0.12, 0.964], bytes: 20536, hash: "809a84f3" },
      { file: "cb-sus/E2-l0-r0.mp3", pitch: 40.009, layer: 0, rr: 0, gain: 0.3534, length: 2.702, mark: 0.0003, peak: 0.87, attack: 0.277, loop: [0.737, 1.8409, 0.12, 0.945], bytes: 21212, hash: "af9f1a16" },
      { file: "cb-sus/Fs2-l0-r0.mp3", pitch: 41.984, layer: 0, rr: 0, gain: 0.276, length: 2.702, mark: 0.0001, peak: 2.63, attack: 0.467, loop: [0.627, 2.2388, 0.12, 0.963], bytes: 21420, hash: "f5483f7c" },
      { file: "cb-sus/Gs2-l0-r0.mp3", pitch: 44.007, layer: 0, rr: 0, gain: 0.2212, length: 2.702, mark: 0.0002, peak: 2.44, attack: 0.397, loop: [1.257, 2.586, 0.12, 0.978], bytes: 21107, hash: "53d977a8" },
      { file: "cb-sus/A2-l0-r0.mp3", pitch: 44.998, layer: 0, rr: 0, gain: 0.3052, length: 2.702, mark: 0.0009, peak: 0.66, attack: 0.257, loop: [1.097, 2.4698, 0.12, 0.985], bytes: 22442, hash: "a8150024" },
      { file: "cb-sus/Cs3-l0-r0.mp3", pitch: 48.997, layer: 0, rr: 0, gain: 0.2917, length: 2.702, mark: 0.0015, peak: 1.45, attack: 0.117, loop: [0.66, 2.5435, 0.12, 0.966], bytes: 22600, hash: "919ad92e" },
      { file: "cb-sus/E3-l0-r0.mp3", pitch: 51.998, layer: 0, rr: 0, gain: 0.2517, length: 2.702, mark: 0.0002, peak: 0.83, attack: 0.167, loop: [0.4, 2.578, 0.12, 0.98], bytes: 23257, hash: "a83a786d" },
      { file: "cb-sus/Gs3-l0-r0.mp3", pitch: 55.994, layer: 0, rr: 0, gain: 0.3356, length: 2.702, mark: 0.002, peak: 1.38, attack: 0.117, loop: [1.22, 2.3375, 0.12, 0.976], bytes: 21395, hash: "75d014c7" },
      { file: "cb-sus/B3-l0-r0.mp3", pitch: 58.991, layer: 0, rr: 0, gain: 0.2528, length: 2.702, mark: 0.0003, peak: 0.73, attack: 0.257, loop: [0.477, 2.6033, 0.12, 0.986], bytes: 22256, hash: "2c539412" },
    ],
  },
  /** 单簧管，长音 */
  "cl.sus": {
    kind: "sustain",
    stereo: false,
    zones: [
      { file: "cl-sus/D3-l0-r0.mp3", pitch: 50.017, layer: 0, rr: 0, gain: 0.2578, length: 2.602, mark: 0.0009, peak: 2.59, attack: 0.547, loop: [1.527, 2.5281, 0.08, 0.981], bytes: 21134, hash: "e36ed1be" },
      { file: "cl-sus/F3-l0-r0.mp3", pitch: 53.006, layer: 0, rr: 0, gain: 0.3016, length: 2.602, mark: 0.0006, peak: 1.24, attack: 0.157, loop: [0.32, 2.3808, 0.08, 0.976], bytes: 22955, hash: "c93f3b58" },
      { file: "cl-sus/As3-l0-r0.mp3", pitch: 58.008, layer: 0, rr: 0, gain: 0.2271, length: 2.602, mark: 0.001, peak: 0.71, attack: 0.147, loop: [0.3, 2.2383, 0.08, 0.963], bytes: 23541, hash: "cf6b37ea" },
      { file: "cl-sus/D4-l0-r0.mp3", pitch: 62.002, layer: 0, rr: 0, gain: 0.1995, length: 2.602, mark: 0.0014, peak: 2.36, attack: 0.117, loop: [1.28, 2.5405, 0.08, 0.997], bytes: 22664, hash: "d3005965" },
      { file: "cl-sus/F4-l0-r0.mp3", pitch: 65.044, layer: 0, rr: 0, gain: 0.1744, length: 2.602, mark: 0.0012, peak: 1.64, attack: 0.157, loop: [1.02, 2.5409, 0.08, 0.989], bytes: 23615, hash: "53e5bb07" },
      { file: "cl-sus/As4-l0-r0.mp3", pitch: 70.012, layer: 0, rr: 0, gain: 0.1624, length: 2.602, mark: 0.0018, peak: 0.61, attack: 0.157, loop: [0.3, 1.5684, 0.08, 0.985], bytes: 20910, hash: "c26cae9e" },
      { file: "cl-sus/D5-l0-r0.mp3", pitch: 74.016, layer: 0, rr: 0, gain: 0.2182, length: 2.602, mark: 0.0012, peak: 0.91, attack: 0.087, loop: [0.4, 1.4268, 0.08, 0.982], bytes: 22328, hash: "b2741c07" },
      { file: "cl-sus/F5-l0-r0.mp3", pitch: 77.024, layer: 0, rr: 0, gain: 0.2041, length: 2.602, mark: 0.0013, peak: 2.42, attack: 0.427, loop: [1.527, 2.5301, 0.08, 0.961], bytes: 25601, hash: "5c25ded4" },
      { file: "cl-sus/As5-l0-r0.mp3", pitch: 82.014, layer: 0, rr: 0, gain: 0.303, length: 2.602, mark: 0.0015, peak: 0.11, attack: 0.077, loop: [1.24, 2.324, 0.08, 0.973], bytes: 28585, hash: "a1133d0c" },
      { file: "cl-sus/D6-l0-r0.mp3", pitch: 86.04, layer: 0, rr: 0, gain: 0.1731, length: 2.602, mark: 0.002, peak: 1.02, attack: 0.107, loop: [0.3, 1.3088, 0.08, 0.982], bytes: 22841, hash: "e1386ef1" },
      { file: "cl-sus/F6-l0-r0.mp3", pitch: 88.988, layer: 0, rr: 0, gain: 0.1721, length: 2.602, mark: 0.0017, peak: 2.19, attack: 0.077, loop: [1.42, 2.4476, 0.08, 0.968], bytes: 23270, hash: "21d3f3cb" },
    ],
  },
  /** 长笛，揉音长音 */
  "fl.sus": {
    kind: "sustain",
    stereo: false,
    zones: [
      { file: "fl-sus/C4-l0-r0.mp3", pitch: 59.958, layer: 0, rr: 0, gain: 0.3488, length: 2.702, mark: 0.002, peak: 0.61, attack: 0.327, loop: [0.787, 2.4105, 0.08, 0.973], bytes: 23631, hash: "2ebda260" },
      { file: "fl-sus/E4-l0-r0.mp3", pitch: 63.972, layer: 0, rr: 0, gain: 0.2904, length: 2.702, mark: 0.0004, peak: 0.65, attack: 0.177, loop: [0.9, 2.589, 0.08, 0.981], bytes: 24608, hash: "65d41fb2" },
      { file: "fl-sus/A4-l0-r0.mp3", pitch: 68.977, layer: 0, rr: 0, gain: 0.3745, length: 2.702, mark: 0.002, peak: 0.15, attack: 0.077, loop: [1.4, 2.5766, 0.08, 0.953], bytes: 24978, hash: "75d3a9ab" },
      { file: "fl-sus/C5-l0-r0.mp3", pitch: 72.01, layer: 0, rr: 0, gain: 0.2548, length: 2.702, mark: 0.0019, peak: 0.74, attack: 0.047, loop: [0.64, 2.323, 0.08, 0.975], bytes: 26931, hash: "6e20fe02" },
      { file: "fl-sus/E5-l0-r0.mp3", pitch: 75.974, layer: 0, rr: 0, gain: 0.2257, length: 2.702, mark: 0.0019, peak: 1.66, attack: 0.067, loop: [0.78, 2.4539, 0.08, 0.991], bytes: 26273, hash: "103bfba1" },
      { file: "fl-sus/A5-l0-r0.mp3", pitch: 80.997, layer: 0, rr: 0, gain: 0.2071, length: 2.702, mark: 0.0016, peak: 1.03, attack: 0.057, loop: [0.94, 2.3649, 0.08, 0.98], bytes: 28669, hash: "81c8a8e3" },
      { file: "fl-sus/C6-l0-r0.mp3", pitch: 83.966, layer: 0, rr: 0, gain: 0.2053, length: 2.702, mark: 0.0016, peak: 2.31, attack: 0.077, loop: [0.64, 2.2399, 0.08, 0.973], bytes: 27777, hash: "b22a735d" },
      { file: "fl-sus/E6-l0-r0.mp3", pitch: 88.053, layer: 0, rr: 0, gain: 0.2276, length: 2.702, mark: 0.0011, peak: 2.68, attack: 0.037, loop: [0.58, 2.5727, 0.08, 0.987], bytes: 28698, hash: "01a70edf" },
      { file: "fl-sus/A6-l0-r0.mp3", pitch: 92.961, layer: 0, rr: 0, gain: 0.2125, length: 2.702, mark: 0.0014, peak: 2.56, attack: 0.197, loop: [1.06, 2.5845, 0.08, 0.985], bytes: 24897, hash: "f9cb55fd" },
      { file: "fl-sus/C7-l0-r0.mp3", pitch: 96.034, layer: 0, rr: 0, gain: 0.1739, length: 2.702, mark: 0.0013, peak: 2.2, attack: 0.097, loop: [0.42, 2.6402, 0.08, 0.988], bytes: 26299, hash: "9b5d5e11" },
    ],
  },
  /** 钟琴 */
  "glock": {
    kind: "shot",
    stereo: false,
    zones: [
      { file: "glock/G5-l0-r0.mp3", pitch: 79.081, layer: 0, rr: 0, gain: 0.4815, length: 2.002, mark: 0, peak: 0.02, attack: 0, loop: null, bytes: 12867, hash: "404e8efa" },
      { file: "glock/C6-l0-r0.mp3", pitch: 84.118, layer: 0, rr: 0, gain: 0.4695, length: 2.002, mark: 0, peak: 0.02, attack: 0, loop: null, bytes: 13180, hash: "e8ad5ea7" },
      { file: "glock/G6-l0-r0.mp3", pitch: 91.119, layer: 0, rr: 0, gain: 0.5749, length: 2.002, mark: 0.002, peak: 0.01, attack: 0, loop: null, bytes: 11541, hash: "545843da" },
      { file: "glock/C7-l0-r0.mp3", pitch: 96.154, layer: 0, rr: 0, gain: 0.6297, length: 2.002, mark: 0, peak: 0.02, attack: 0, loop: null, bytes: 11828, hash: "c9718d88" },
      { file: "glock/G7-l0-r0.mp3", pitch: 103.157, layer: 0, rr: 0, gain: 0.4652, length: 2.002, mark: 0, peak: 0.02, attack: 0, loop: null, bytes: 12587, hash: "5ce851bb" },
      { file: "glock/C8-l0-r0.mp3", pitch: 108.241, layer: 0, rr: 0, gain: 0.9825, length: 2.002, mark: 0.0013, peak: 0.01, attack: 0, loop: null, bytes: 11596, hash: "d69dd3f7" },
    ],
  },
  /** 竖琴 */
  "harp": {
    kind: "shot",
    stereo: false,
    zones: [
      { file: "harp/G1-l0-r0.mp3", pitch: 30.731, layer: 0, rr: 0, gain: 0.4728, length: 2.402, mark: 0, peak: 0.09, attack: 0, loop: null, bytes: 18664, hash: "bf67a289" },
      { file: "harp/B1-l0-r0.mp3", pitch: 34.833, layer: 0, rr: 0, gain: 0.3089, length: 2.402, mark: 0.0017, peak: 0.13, attack: 0, loop: null, bytes: 18509, hash: "29c32135" },
      { file: "harp/D2-l0-r0.mp3", pitch: 37.974, layer: 0, rr: 0, gain: 0.3551, length: 2.402, mark: 0.0016, peak: 0.09, attack: 0, loop: null, bytes: 17183, hash: "ab790768" },
      { file: "harp/F2-l0-r0.mp3", pitch: 40.928, layer: 0, rr: 0, gain: 0.3548, length: 2.402, mark: 0.0015, peak: 0.07, attack: 0, loop: null, bytes: 18197, hash: "304d03c5" },
      { file: "harp/A2-l0-r0.mp3", pitch: 44.96, layer: 0, rr: 0, gain: 0.3257, length: 2.402, mark: 0.0015, peak: 0.15, attack: 0, loop: null, bytes: 17470, hash: "690c4056" },
      { file: "harp/C3-l0-r0.mp3", pitch: 47.974, layer: 0, rr: 0, gain: 0.2644, length: 2.402, mark: 0.0001, peak: 0.05, attack: 0, loop: null, bytes: 17937, hash: "d33ca50c" },
      { file: "harp/E3-l0-r0.mp3", pitch: 51.952, layer: 0, rr: 0, gain: 0.382, length: 2.402, mark: 0.0019, peak: 0.02, attack: 0, loop: null, bytes: 17130, hash: "72903653" },
      { file: "harp/G3-l0-r0.mp3", pitch: 54.89, layer: 0, rr: 0, gain: 0.3428, length: 2.402, mark: 0.0019, peak: 0.03, attack: 0, loop: null, bytes: 15440, hash: "a4894f95" },
      { file: "harp/B3-l0-r0.mp3", pitch: 58.866, layer: 0, rr: 0, gain: 0.3076, length: 2.402, mark: 0.001, peak: 0.03, attack: 0, loop: null, bytes: 15596, hash: "c8a8fd42" },
      { file: "harp/D4-l0-r0.mp3", pitch: 61.873, layer: 0, rr: 0, gain: 0.3816, length: 2.402, mark: 0.002, peak: 0.03, attack: 0, loop: null, bytes: 15050, hash: "26e3243f" },
      { file: "harp/F4-l0-r0.mp3", pitch: 64.992, layer: 0, rr: 0, gain: 0.2566, length: 2.402, mark: 0.0015, peak: 0.05, attack: 0, loop: null, bytes: 14686, hash: "e43a3637" },
      { file: "harp/A4-l0-r0.mp3", pitch: 68.912, layer: 0, rr: 0, gain: 0.661, length: 2.402, mark: 0.0014, peak: 0.02, attack: 0, loop: null, bytes: 12528, hash: "6a962d65" },
      { file: "harp/C5-l0-r0.mp3", pitch: 71.882, layer: 0, rr: 0, gain: 0.5728, length: 2.402, mark: 0.0013, peak: 0.01, attack: 0, loop: null, bytes: 13178, hash: "7c074196" },
      { file: "harp/E5-l0-r0.mp3", pitch: 75.888, layer: 0, rr: 0, gain: 0.2769, length: 2.402, mark: 0.0015, peak: 0.06, attack: 0, loop: null, bytes: 14873, hash: "23a838aa" },
      { file: "harp/G5-l0-r0.mp3", pitch: 78.946, layer: 0, rr: 0, gain: 0.5069, length: 2.402, mark: 0.0015, peak: 0.03, attack: 0, loop: null, bytes: 16197, hash: "08bc8dd1" },
      { file: "harp/B5-l0-r0.mp3", pitch: 82.914, layer: 0, rr: 0, gain: 0.3282, length: 2.402, mark: 0.0013, peak: 0.05, attack: 0, loop: null, bytes: 16144, hash: "8a706a11" },
      { file: "harp/D6-l0-r0.mp3", pitch: 85.923, layer: 0, rr: 0, gain: 0.4997, length: 2.402, mark: 0.0018, peak: 0.03, attack: 0, loop: null, bytes: 14141, hash: "49bd1139" },
      { file: "harp/F6-l0-r0.mp3", pitch: 88.942, layer: 0, rr: 0, gain: 0.5685, length: 2.335, mark: 0.0018, peak: 0.04, attack: 0, loop: null, bytes: 16719, hash: "c10e6af7" },
      { file: "harp/A6-l0-r0.mp3", pitch: 92.809, layer: 0, rr: 0, gain: 0.5847, length: 2.402, mark: 0.002, peak: 0.03, attack: 0, loop: null, bytes: 16614, hash: "db8c9ca7" },
      { file: "harp/B6-l0-r0.mp3", pitch: 94.89, layer: 0, rr: 0, gain: 0.689, length: 2.402, mark: 0.002, peak: 0.03, attack: 0, loop: null, bytes: 16926, hash: "f0cbba51" },
      { file: "harp/D7-l0-r0.mp3", pitch: 97.918, layer: 0, rr: 0, gain: 0.6117, length: 2.196, mark: 0.0014, peak: 0.02, attack: 0, loop: null, bytes: 11646, hash: "e7bccf38" },
      { file: "harp/F7-l0-r0.mp3", pitch: 100.696, layer: 0, rr: 0, gain: 0.693, length: 1.851, mark: 0.002, peak: 0.01, attack: 0, loop: null, bytes: 9748, hash: "e76c5dae" },
    ],
  },
  /** 圆号，长音，两个力度层 */
  "hn.sus": {
    kind: "sustain",
    stereo: false,
    zones: [
      { file: "hn-sus/A1-l0-r0.mp3", pitch: 32.934, layer: 0, rr: 0, gain: 0.3253, length: 2.702, mark: 0.0011, peak: 1.07, attack: 0.147, loop: [0.68, 2.1587, 0.1, 0.95], bytes: 19471, hash: "b94c3bec" },
      { file: "hn-sus/C2-l1-r0.mp3", pitch: 35.968, layer: 1, rr: 0, gain: 0.3232, length: 2.702, mark: 0.0001, peak: 1.2, attack: 0.137, loop: [0.42, 1.7069, 0.1, 0.989], bytes: 19183, hash: "deef03e7" },
      { file: "hn-sus/C2-l0-r0.mp3", pitch: 35.977, layer: 0, rr: 0, gain: 0.2649, length: 2.702, mark: 0.0005, peak: 0.78, attack: 0.107, loop: [0.48, 2.6382, 0.1, 0.977], bytes: 19261, hash: "147b3c2f" },
      { file: "hn-sus/Ds2-l0-r0.mp3", pitch: 38.992, layer: 0, rr: 0, gain: 0.3413, length: 2.702, mark: 0.0002, peak: 0.22, attack: 0.047, loop: [0.72, 1.8651, 0.1, 0.973], bytes: 18954, hash: "f803f226" },
      { file: "hn-sus/Ds2-l1-r0.mp3", pitch: 39.006, layer: 1, rr: 0, gain: 0.3522, length: 2.702, mark: 0.0004, peak: 0.99, attack: 0.087, loop: [0.42, 2.5287, 0.1, 0.987], bytes: 19339, hash: "82e4693b" },
      { file: "hn-sus/G2-l1-r0.mp3", pitch: 42.961, layer: 1, rr: 0, gain: 0.4952, length: 2.702, mark: 0.0004, peak: 0.23, attack: 0.047, loop: [0.76, 2.1273, 0.1, 0.942], bytes: 18951, hash: "5f476cd4" },
      { file: "hn-sus/G2-l0-r0.mp3", pitch: 42.986, layer: 0, rr: 0, gain: 1.0869, length: 2.702, mark: 0.0001, peak: 0.11, attack: 0.057, loop: [1.52, 2.5296, 0.1, 0.887], bytes: 18611, hash: "0eda2552" },
      { file: "hn-sus/As2-l0-r0.mp3", pitch: 46.026, layer: 0, rr: 0, gain: 0.7343, length: 2.702, mark: 0.0002, peak: 0.14, attack: 0.067, loop: [0.5, 2.3685, 0.1, 0.988], bytes: 20093, hash: "8a22b595" },
      { file: "hn-sus/As2-l1-r0.mp3", pitch: 46.041, layer: 1, rr: 0, gain: 0.2803, length: 2.702, mark: 0.0002, peak: 0.38, attack: 0.107, loop: [0.64, 2.63, 0.1, 0.988], bytes: 19860, hash: "eeaf860e" },
      { file: "hn-sus/D3-l0-r0.mp3", pitch: 49.991, layer: 0, rr: 0, gain: 0.3289, length: 2.702, mark: 0.0006, peak: 0.32, attack: 0.167, loop: [0.74, 2.1098, 0.1, 0.992], bytes: 20979, hash: "e66b12a1" },
      { file: "hn-sus/D3-l1-r0.mp3", pitch: 50.015, layer: 1, rr: 0, gain: 0.196, length: 2.702, mark: 0.0002, peak: 1.09, attack: 0.137, loop: [0.5, 2.1675, 0.1, 0.983], bytes: 17883, hash: "582ca0e3" },
      { file: "hn-sus/F3-l1-r0.mp3", pitch: 52.999, layer: 1, rr: 0, gain: 0.2836, length: 2.702, mark: 0.0005, peak: 0.3, attack: 0.257, loop: [0.937, 2.6146, 0.1, 0.99], bytes: 18559, hash: "25c42c1e" },
      { file: "hn-sus/F3-l0-r0.mp3", pitch: 53, layer: 0, rr: 0, gain: 0.5969, length: 2.702, mark: 0.0002, peak: 0.13, attack: 0.027, loop: [1.6, 2.6252, 0.1, 0.978], bytes: 19573, hash: "ff294644" },
      { file: "hn-sus/A3-l0-r0.mp3", pitch: 56.968, layer: 0, rr: 0, gain: 0.3493, length: 2.702, mark: 0.0003, peak: 0.32, attack: 0.067, loop: [1.44, 2.637, 0.1, 0.998], bytes: 18455, hash: "fcb0132b" },
      { file: "hn-sus/A3-l1-r0.mp3", pitch: 56.99, layer: 1, rr: 0, gain: 0.3034, length: 2.702, mark: 0.0007, peak: 0.29, attack: 0.057, loop: [1.04, 2.0677, 0.1, 0.976], bytes: 18403, hash: "bc01fb6b" },
      { file: "hn-sus/C4-l1-r0.mp3", pitch: 59.985, layer: 1, rr: 0, gain: 0.2516, length: 2.702, mark: 0.0002, peak: 0.73, attack: 0.097, loop: [0.34, 2.6277, 0.1, 0.991], bytes: 18533, hash: "a338a486" },
      { file: "hn-sus/C4-l0-r0.mp3", pitch: 60.017, layer: 0, rr: 0, gain: 0.4871, length: 2.702, mark: 0.0002, peak: 0.22, attack: 0.137, loop: [1.08, 2.5998, 0.1, 0.999], bytes: 17701, hash: "599af05a" },
      { file: "hn-sus/D5-l0-r0.mp3", pitch: 74.003, layer: 0, rr: 0, gain: 0.2264, length: 2.702, mark: 0.0003, peak: 0.09, attack: 0.047, loop: [0.38, 2.4192, 0.1, 0.994], bytes: 20276, hash: "5b98e579" },
      { file: "hn-sus/F5-l0-r0.mp3", pitch: 77.01, layer: 0, rr: 0, gain: 0.1912, length: 2.702, mark: 0.0011, peak: 1.73, attack: 0.167, loop: [0.44, 2.6395, 0.1, 0.991], bytes: 24904, hash: "1a124ffd" },
    ],
  },
  /** 马林巴 */
  "marimba": {
    kind: "shot",
    stereo: false,
    zones: [
      { file: "marimba/F2-l0-r0.mp3", pitch: 40.976, layer: 0, rr: 0, gain: 0.4081, length: 1.302, mark: 0.002, peak: 0.01, attack: 0, loop: null, bytes: 7928, hash: "6e0b3f82" },
      { file: "marimba/C3-l0-r0.mp3", pitch: 47.983, layer: 0, rr: 0, gain: 0.4433, length: 1.302, mark: 0.002, peak: 0.02, attack: 0, loop: null, bytes: 7433, hash: "8e23313e" },
      { file: "marimba/G3-l0-r0.mp3", pitch: 54.99, layer: 0, rr: 0, gain: 0.3992, length: 1.302, mark: 0.002, peak: 0.01, attack: 0, loop: null, bytes: 7225, hash: "a3fa4380" },
      { file: "marimba/B3-l0-r0.mp3", pitch: 59.021, layer: 0, rr: 0, gain: 0.282, length: 1.302, mark: 0.0019, peak: 0.08, attack: 0, loop: null, bytes: 7666, hash: "099fecf7" },
      { file: "marimba/F4-l0-r0.mp3", pitch: 64.994, layer: 0, rr: 0, gain: 0.3249, length: 1.302, mark: 0.0019, peak: 0.06, attack: 0, loop: null, bytes: 7303, hash: "a5fdb325" },
      { file: "marimba/C5-l0-r0.mp3", pitch: 72.043, layer: 0, rr: 0, gain: 0.404, length: 1.302, mark: 0.002, peak: 0.03, attack: 0, loop: null, bytes: 7381, hash: "36d97263" },
      { file: "marimba/G5-l0-r0.mp3", pitch: 78.977, layer: 0, rr: 0, gain: 0.397, length: 1.302, mark: 0.002, peak: 0.02, attack: 0, loop: null, bytes: 7095, hash: "cd1bd35b" },
      { file: "marimba/B5-l0-r0.mp3", pitch: 83.001, layer: 0, rr: 0, gain: 0.3351, length: 1.302, mark: 0.002, peak: 0.02, attack: 0, loop: null, bytes: 7459, hash: "08fedba0" },
      { file: "marimba/F6-l0-r0.mp3", pitch: 88.977, layer: 0, rr: 0, gain: 0.4036, length: 1.302, mark: 0.002, peak: 0.02, attack: 0, loop: null, bytes: 7407, hash: "aaa0ffd7" },
      { file: "marimba/C7-l0-r0.mp3", pitch: 96.004, layer: 0, rr: 0, gain: 0.5935, length: 1.302, mark: 0.0019, peak: 0.01, attack: 0, loop: null, bytes: 6991, hash: "ce64cf1f" },
    ],
  },
  /** 双簧管，揉音长音，两个力度层 */
  "ob.sus": {
    kind: "sustain",
    stereo: false,
    zones: [
      { file: "ob-sus/As3-l0-r0.mp3", pitch: 58.011, layer: 0, rr: 0, gain: 0.4407, length: 2.602, mark: 0.0005, peak: 0.21, attack: 0.087, loop: [0.32, 2.0301, 0.08, 0.967], bytes: 20515, hash: "3499c863" },
      { file: "ob-sus/As3-l1-r0.mp3", pitch: 58.028, layer: 1, rr: 0, gain: 0.3566, length: 2.602, mark: 0.0002, peak: 2.48, attack: 0.047, loop: [1.02, 2.0204, 0.08, 0.776], bytes: 20461, hash: "d329009c" },
      { file: "ob-sus/D4-l0-r0.mp3", pitch: 62.003, layer: 0, rr: 0, gain: 0.2279, length: 2.602, mark: 0.0003, peak: 1.66, attack: 0.057, loop: [1.16, 2.3519, 0.08, 0.984], bytes: 20696, hash: "0e4e529e" },
      { file: "ob-sus/D4-l1-r0.mp3", pitch: 62.005, layer: 1, rr: 0, gain: 0.3463, length: 2.602, mark: 0.0002, peak: 0.08, attack: 0.037, loop: [1.16, 2.161, 0.08, 0.899], bytes: 20566, hash: "e6e6e275" },
      { file: "ob-sus/F4-l0-r0.mp3", pitch: 64.982, layer: 0, rr: 0, gain: 0.394, length: 2.602, mark: 0.0001, peak: 0.09, attack: 0.037, loop: [0.46, 2.383, 0.08, 0.972], bytes: 21323, hash: "a4f9ca5e" },
      { file: "ob-sus/F4-l1-r0.mp3", pitch: 65.008, layer: 1, rr: 0, gain: 0.3219, length: 2.602, mark: 0.0004, peak: 0.27, attack: 0.027, loop: [1.02, 2.079, 0.08, 0.976], bytes: 20250, hash: "b6fd9e72" },
      { file: "ob-sus/As4-l0-r0.mp3", pitch: 69.99, layer: 0, rr: 0, gain: 0.3076, length: 2.602, mark: 0.0005, peak: 0.19, attack: 0.057, loop: [0.66, 2.4693, 0.08, 0.982], bytes: 24014, hash: "4c183807" },
      { file: "ob-sus/As4-l1-r0.mp3", pitch: 69.993, layer: 1, rr: 0, gain: 0.3871, length: 2.602, mark: 0.0002, peak: 0.59, attack: 0.037, loop: [1.3, 2.3817, 0.08, 0.961], bytes: 22957, hash: "bef13c4a" },
      { file: "ob-sus/D5-l0-r0.mp3", pitch: 73.995, layer: 0, rr: 0, gain: 0.2969, length: 2.602, mark: 0, peak: 1.25, attack: 0.067, loop: [0.66, 2.5412, 0.08, 0.958], bytes: 23774, hash: "22f8d651" },
      { file: "ob-sus/D5-l1-r0.mp3", pitch: 74.071, layer: 1, rr: 0, gain: 0.2959, length: 2.602, mark: 0.0002, peak: 1.53, attack: 0.167, loop: [0.9, 2.4572, 0.08, 0.978], bytes: 21319, hash: "1e81b11f" },
      { file: "ob-sus/F5-l1-r0.mp3", pitch: 76.977, layer: 1, rr: 0, gain: 0.2082, length: 2.602, mark: 0.0016, peak: 0.63, attack: 0.027, loop: [0.48, 2.1889, 0.08, 0.996], bytes: 21904, hash: "088c9f9e" },
      { file: "ob-sus/F5-l0-r0.mp3", pitch: 77.038, layer: 0, rr: 0, gain: 0.2197, length: 2.602, mark: 0.0011, peak: 2.05, attack: 0.067, loop: [1.12, 2.3312, 0.08, 0.989], bytes: 22112, hash: "6a211c54" },
      { file: "ob-sus/As5-l0-r0.mp3", pitch: 81.982, layer: 0, rr: 0, gain: 0.2752, length: 2.602, mark: 0.0009, peak: 0.05, attack: 0.027, loop: [0.48, 2.1321, 0.08, 0.981], bytes: 24808, hash: "fea6d7bc" },
      { file: "ob-sus/As5-l1-r0.mp3", pitch: 82.085, layer: 1, rr: 0, gain: 0.3173, length: 2.602, mark: 0.0001, peak: 1, attack: 0.027, loop: [1.44, 2.4688, 0.08, 0.969], bytes: 24038, hash: "8ad13583" },
      { file: "ob-sus/D6-l0-r0.mp3", pitch: 86.01, layer: 0, rr: 0, gain: 0.221, length: 2.602, mark: 0.0017, peak: 0.56, attack: 0.287, loop: [0.807, 2.3956, 0.08, 0.975], bytes: 23936, hash: "595effde" },
      { file: "ob-sus/D6-l1-r0.mp3", pitch: 86.037, layer: 1, rr: 0, gain: 0.5021, length: 2.602, mark: 0.0001, peak: 0.12, attack: 0.047, loop: [1.36, 2.4505, 0.08, 0.916], bytes: 24065, hash: "0d9f531a" },
      { file: "ob-sus/F6-l1-r0.mp3", pitch: 88.98, layer: 1, rr: 0, gain: 0.3235, length: 2.602, mark: 0.0004, peak: 0.69, attack: 0.067, loop: [1.28, 2.4504, 0.08, 0.979], bytes: 25805, hash: "c2a53e70" },
      { file: "ob-sus/F6-l0-r0.mp3", pitch: 89.001, layer: 0, rr: 0, gain: 0.2784, length: 2.602, mark: 0.0005, peak: 1, attack: 0.047, loop: [0.92, 2.1725, 0.08, 0.987], bytes: 25884, hash: "f7f2b811" },
    ],
  },
  /** 大鼓 */
  "perc.bd": {
    kind: "hit",
    stereo: false,
    zones: [
      { file: "perc-bd/hit-l0-r0.mp3", pitch: null, layer: 0, rr: 0, gain: 0.6296, length: 1.602, mark: 0.0003, peak: 0.03, attack: 0, loop: null, bytes: 8004, hash: "2c97ecef" },
      { file: "perc-bd/hit-l0-r1.mp3", pitch: null, layer: 0, rr: 1, gain: 0.6471, length: 1.602, mark: 0.0003, peak: 0.03, attack: 0, loop: null, bytes: 8056, hash: "665ff90c" },
      { file: "perc-bd/hit-l1-r0.mp3", pitch: null, layer: 1, rr: 0, gain: 0.6901, length: 1.602, mark: 0.0003, peak: 0.01, attack: 0, loop: null, bytes: 8186, hash: "b7b1aa31" },
      { file: "perc-bd/hit-l1-r1.mp3", pitch: null, layer: 1, rr: 1, gain: 0.674, length: 1.602, mark: 0.0002, peak: 0.01, attack: 0, loop: null, bytes: 8238, hash: "7c4636ae" },
    ],
  },
  /** 响棒 */
  "perc.claves": {
    kind: "hit",
    stereo: false,
    zones: [
      { file: "perc-claves/hit-l0-r0.mp3", pitch: null, layer: 0, rr: 0, gain: 1.6239, length: 0.302, mark: 0.0001, peak: 0.01, attack: 0, loop: null, bytes: 2936, hash: "7a1d9cfe" },
      { file: "perc-claves/hit-l0-r1.mp3", pitch: null, layer: 0, rr: 1, gain: 1.7197, length: 0.302, mark: 0.0002, peak: 0.01, attack: 0, loop: null, bytes: 2961, hash: "d5a922a1" },
    ],
  },
  /** 对击钹 */
  "perc.crash": {
    kind: "hit",
    stereo: true,
    zones: [
      { file: "perc-crash/hit-l0-r0.mp3", pitch: null, layer: 0, rr: 0, gain: 1.0793, length: 3.002, mark: 0.0012, peak: 0.03, attack: 0, loop: null, bytes: 36522, hash: "5b1b9e4e" },
      { file: "perc-crash/hit-l1-r0.mp3", pitch: null, layer: 1, rr: 0, gain: 0.6513, length: 3.002, mark: 0, peak: 0.05, attack: 0, loop: null, bytes: 39752, hash: "54a64d05" },
    ],
  },
  /** 大锣 */
  "perc.gong": {
    kind: "hit",
    stereo: true,
    zones: [
      { file: "perc-gong/hit-l0-r0.mp3", pitch: null, layer: 0, rr: 0, gain: 0.3148, length: 6.002, mark: 0.0013, peak: 0.13, attack: 0, loop: null, bytes: 62502, hash: "2cf51fa9" },
    ],
  },
  /** 木鼓（高） */
  "perc.loghi": {
    kind: "hit",
    stereo: false,
    zones: [
      { file: "perc-loghi/hit-l0-r0.mp3", pitch: null, layer: 0, rr: 0, gain: 0.5839, length: 0.502, mark: 0.0002, peak: 0.01, attack: 0, loop: null, bytes: 3402, hash: "2110403d" },
      { file: "perc-loghi/hit-l0-r1.mp3", pitch: null, layer: 0, rr: 1, gain: 0.7544, length: 0.502, mark: 0.0002, peak: 0.01, attack: 0, loop: null, bytes: 3454, hash: "f6ff1597" },
    ],
  },
  /** 木鼓（低） */
  "perc.loglo": {
    kind: "hit",
    stereo: false,
    zones: [
      { file: "perc-loglo/hit-l0-r0.mp3", pitch: null, layer: 0, rr: 0, gain: 0.8141, length: 0.502, mark: 0.0005, peak: 0.01, attack: 0, loop: null, bytes: 3662, hash: "df02307a" },
      { file: "perc-loglo/hit-l0-r1.mp3", pitch: null, layer: 0, rr: 1, gain: 0.8229, length: 0.502, mark: 0.0002, peak: 0.01, attack: 0, loop: null, bytes: 3558, hash: "1cb59f91" },
    ],
  },
  /** 铃鼓，摇 */
  "perc.shake": {
    kind: "hit",
    stereo: false,
    zones: [
      { file: "perc-shake/hit-l0-r0.mp3", pitch: null, layer: 0, rr: 0, gain: 0.5359, length: 0.602, mark: 0.0009, peak: 0.17, attack: 0, loop: null, bytes: 7160, hash: "5a87ee53" },
      { file: "perc-shake/hit-l0-r1.mp3", pitch: null, layer: 0, rr: 1, gain: 0.5911, length: 0.602, mark: 0.002, peak: 0.08, attack: 0, loop: null, bytes: 7054, hash: "6b416caa" },
    ],
  },
  /** 沙锤 */
  "perc.shaker": {
    kind: "hit",
    stereo: false,
    zones: [
      { file: "perc-shaker/hit-l0-r0.mp3", pitch: null, layer: 0, rr: 0, gain: 1.2746, length: 0.182, mark: 0.0001, peak: 0.01, attack: 0, loop: null, bytes: 2834, hash: "b71f12ce" },
      { file: "perc-shaker/hit-l0-r1.mp3", pitch: null, layer: 0, rr: 1, gain: 1.8884, length: 0.189, mark: 0, peak: 0.02, attack: 0, loop: null, bytes: 3329, hash: "025e1c01" },
      { file: "perc-shaker/hit-l0-r2.mp3", pitch: null, layer: 0, rr: 2, gain: 1.2073, length: 0.254, mark: 0, peak: 0.03, attack: 0, loop: null, bytes: 3929, hash: "cd2ec375" },
      { file: "perc-shaker/hit-l0-r3.mp3", pitch: null, layer: 0, rr: 3, gain: 1.4419, length: 0.163, mark: 0, peak: 0.01, attack: 0, loop: null, bytes: 3226, hash: "7d4b8489" },
      { file: "perc-shaker/hit-l0-r4.mp3", pitch: null, layer: 0, rr: 4, gain: 1.5081, length: 0.16, mark: 0, peak: 0.01, attack: 0, loop: null, bytes: 2991, hash: "8aaf0a6a" },
      { file: "perc-shaker/hit-l0-r5.mp3", pitch: null, layer: 0, rr: 5, gain: 1.0437, length: 0.274, mark: 0, peak: 0.06, attack: 0, loop: null, bytes: 3930, hash: "13f3f9fb" },
      { file: "perc-shaker/hit-l0-r6.mp3", pitch: null, layer: 0, rr: 6, gain: 1.8983, length: 0.235, mark: 0, peak: 0.01, attack: 0, loop: null, bytes: 3746, hash: "8458d7f6" },
      { file: "perc-shaker/hit-l0-r7.mp3", pitch: null, layer: 0, rr: 7, gain: 1.1765, length: 0.159, mark: 0, peak: 0.05, attack: 0, loop: null, bytes: 2573, hash: "8730bfd0" },
    ],
  },
  /** 军鼓 */
  "perc.snare": {
    kind: "hit",
    stereo: false,
    zones: [
      { file: "perc-snare/hit-l0-r0.mp3", pitch: null, layer: 0, rr: 0, gain: 0.8858, length: 0.602, mark: 0.0005, peak: 0.01, attack: 0, loop: null, bytes: 5068, hash: "82dff7de" },
      { file: "perc-snare/hit-l0-r1.mp3", pitch: null, layer: 0, rr: 1, gain: 0.906, length: 0.602, mark: 0, peak: 0.01, attack: 0, loop: null, bytes: 5016, hash: "4583d8f0" },
      { file: "perc-snare/hit-l1-r0.mp3", pitch: null, layer: 1, rr: 0, gain: 1.0557, length: 0.602, mark: 0.0002, peak: 0.01, attack: 0, loop: null, bytes: 4963, hash: "3862df8a" },
      { file: "perc-snare/hit-l1-r1.mp3", pitch: null, layer: 1, rr: 1, gain: 1.0882, length: 0.602, mark: 0.0007, peak: 0.01, attack: 0, loop: null, bytes: 4885, hash: "20c4452c" },
      { file: "perc-snare/hit-l2-r0.mp3", pitch: null, layer: 2, rr: 0, gain: 1.002, length: 0.602, mark: 0.0007, peak: 0.01, attack: 0, loop: null, bytes: 4859, hash: "68545336" },
      { file: "perc-snare/hit-l2-r1.mp3", pitch: null, layer: 2, rr: 1, gain: 1.0453, length: 0.602, mark: 0.0007, peak: 0.01, attack: 0, loop: null, bytes: 4911, hash: "c6cf8584" },
    ],
  },
  /** 军鼓滚奏 */
  "perc.snareroll": {
    kind: "sustain",
    stereo: false,
    zones: [
      { file: "perc-snareroll/hit-l0-r0.mp3", pitch: null, layer: 0, rr: 0, gain: 1.0439, length: 2.402, mark: 0.0002, peak: 0.07, attack: 0.027, loop: [0.4, 1.4324, 0.1, 0.868], bytes: 20684, hash: "60a1637b" },
    ],
  },
  /** 吊镲渐强（约 3.3 秒后最响） */
  "perc.swell": {
    kind: "hit",
    stereo: true,
    zones: [
      { file: "perc-swell/hit-l0-r0.mp3", pitch: null, layer: 0, rr: 0, gain: 0.4196, length: 5.602, mark: 0.0016, peak: 3.68, attack: 0, loop: null, bytes: 74541, hash: "c7d80dc3" },
    ],
  },
  /** 铃鼓，击 */
  "perc.tamb": {
    kind: "hit",
    stereo: false,
    zones: [
      { file: "perc-tamb/hit-l0-r0.mp3", pitch: null, layer: 0, rr: 0, gain: 0.533, length: 0.602, mark: 0.0002, peak: 0.09, attack: 0, loop: null, bytes: 7392, hash: "2b0fb49c" },
      { file: "perc-tamb/hit-l0-r1.mp3", pitch: null, layer: 0, rr: 1, gain: 0.4745, length: 0.602, mark: 0.0004, peak: 0.11, attack: 0, loop: null, bytes: 7627, hash: "a648c32f" },
      { file: "perc-tamb/hit-l1-r0.mp3", pitch: null, layer: 1, rr: 0, gain: 0.6332, length: 0.602, mark: 0.0007, peak: 0.03, attack: 0, loop: null, bytes: 6870, hash: "cc929da3" },
      { file: "perc-tamb/hit-l1-r1.mp3", pitch: null, layer: 1, rr: 1, gain: 0.5171, length: 0.602, mark: 0.0002, peak: 0.02, attack: 0, loop: null, bytes: 7158, hash: "33cfa02b" },
    ],
  },
  /** 三角铁 */
  "perc.tri": {
    kind: "hit",
    stereo: false,
    zones: [
      { file: "perc-tri/hit-l0-r0.mp3", pitch: null, layer: 0, rr: 0, gain: 0.6289, length: 1.509, mark: 0.0001, peak: 0.01, attack: 0, loop: null, bytes: 11676, hash: "b7a7c5d0" },
      { file: "perc-tri/hit-l1-r0.mp3", pitch: null, layer: 1, rr: 0, gain: 0.5652, length: 1.267, mark: 0.0002, peak: 0.01, attack: 0, loop: null, bytes: 9155, hash: "ff5e94fd" },
    ],
  },
  /** 长号，长音 */
  "tb.sus": {
    kind: "sustain",
    stereo: false,
    zones: [
      { file: "tb-sus/As1-l0-r0.mp3", pitch: 33.999, layer: 0, rr: 0, gain: 0.6519, length: 2.502, mark: 0.0014, peak: 1.99, attack: 0.057, loop: [1.36, 2.4412, 0.1, 0.983], bytes: 28286, hash: "ab900760" },
      { file: "tb-sus/Cs2-l0-r0.mp3", pitch: 37, layer: 0, rr: 0, gain: 0.6203, length: 2.502, mark: 0.0015, peak: 0.26, attack: 0.057, loop: [0.38, 2.357, 0.1, 0.99], bytes: 29133, hash: "1d598529" },
      { file: "tb-sus/Ds2-l0-r0.mp3", pitch: 38.997, layer: 0, rr: 0, gain: 0.6398, length: 2.502, mark: 0.0019, peak: 1.63, attack: 0.097, loop: [0.42, 2.3745, 0.1, 0.967], bytes: 22302, hash: "27a1e89d" },
      { file: "tb-sus/F2-l0-r0.mp3", pitch: 40.995, layer: 0, rr: 0, gain: 0.5833, length: 2.502, mark: 0.0019, peak: 0.5, attack: 0.037, loop: [0.38, 2.4077, 0.1, 0.958], bytes: 20258, hash: "e3b34159" },
      { file: "tb-sus/As2-l0-r0.mp3", pitch: 46, layer: 0, rr: 0, gain: 0.5507, length: 2.502, mark: 0.0013, peak: 0.23, attack: 0.037, loop: [0.42, 2.1619, 0.1, 0.979], bytes: 28157, hash: "3f48645a" },
      { file: "tb-sus/D3-l0-r0.mp3", pitch: 50.001, layer: 0, rr: 0, gain: 0.3573, length: 2.502, mark: 0.0016, peak: 2.19, attack: 0.237, loop: [0.737, 2.3647, 0.1, 0.992], bytes: 23209, hash: "eb06d501" },
      { file: "tb-sus/F3-l0-r0.mp3", pitch: 53, layer: 0, rr: 0, gain: 0.309, length: 2.502, mark: 0.0015, peak: 2.47, attack: 0.267, loop: [0.667, 2.4194, 0.1, 0.975], bytes: 20906, hash: "809a1f5b" },
      { file: "tb-sus/C4-l0-r0.mp3", pitch: 60, layer: 0, rr: 0, gain: 0.2269, length: 2.502, mark: 0.0015, peak: 1, attack: 0.157, loop: [0.52, 2.1253, 0.1, 0.988], bytes: 21386, hash: "05424860" },
      { file: "tb-sus/Cs4-l0-r0.mp3", pitch: 61, layer: 0, rr: 0, gain: 0.238, length: 2.502, mark: 0.0016, peak: 1.42, attack: 0.237, loop: [0.777, 2.2743, 0.1, 0.988], bytes: 21409, hash: "dfef180d" },
      { file: "tb-sus/Ds4-l0-r0.mp3", pitch: 62.999, layer: 0, rr: 0, gain: 0.2166, length: 2.502, mark: 0.0016, peak: 1.68, attack: 0.417, loop: [1.317, 2.442, 0.1, 0.989], bytes: 21275, hash: "d69f9dc0" },
      { file: "tb-sus/F4-l0-r0.mp3", pitch: 65, layer: 0, rr: 0, gain: 0.2259, length: 2.502, mark: 0.0012, peak: 0.69, attack: 0.077, loop: [0.42, 1.5597, 0.1, 0.983], bytes: 21128, hash: "6c8eaeb7" },
    ],
  },
  /** 定音鼓，单击（五只鼓），两个力度层 */
  "timp.hit": {
    kind: "shot",
    stereo: false,
    zones: [
      { file: "timp-hit/drum1-l0-r0.mp3", pitch: 41.47, layer: 0, rr: 0, gain: 0.3553, length: 2.402, mark: 0.001, peak: 0.03, attack: 0, loop: null, bytes: 16324, hash: "13eb90a5" },
      { file: "timp-hit/drum1-l0-r1.mp3", pitch: 41.508, layer: 0, rr: 1, gain: 0.4155, length: 2.402, mark: 0.0013, peak: 0.03, attack: 0, loop: null, bytes: 13333, hash: "1913fa8f" },
      { file: "timp-hit/drum2-l0-r1.mp3", pitch: 46.675, layer: 0, rr: 1, gain: 0.7753, length: 2.402, mark: 0.0004, peak: 0.02, attack: 0, loop: null, bytes: 11488, hash: "caef5762" },
      { file: "timp-hit/drum2-l1-r0.mp3", pitch: 46.721, layer: 1, rr: 0, gain: 0.7591, length: 2.402, mark: 0.0005, peak: 0.02, attack: 0, loop: null, bytes: 11618, hash: "cc303961" },
      { file: "timp-hit/drum2-l0-r0.mp3", pitch: 46.863, layer: 0, rr: 0, gain: 0.8189, length: 2.402, mark: 0.0004, peak: 0.02, attack: 0, loop: null, bytes: 11332, hash: "18c327ac" },
      { file: "timp-hit/drum3-l0-r1.mp3", pitch: 49.511, layer: 0, rr: 1, gain: 0.5329, length: 2.402, mark: 0.0006, peak: 0.02, attack: 0, loop: null, bytes: 12034, hash: "c4818ace" },
      { file: "timp-hit/drum3-l0-r0.mp3", pitch: 49.52, layer: 0, rr: 0, gain: 0.5373, length: 2.402, mark: 0.0007, peak: 0.02, attack: 0, loop: null, bytes: 11904, hash: "f4e0ca52" },
      { file: "timp-hit/drum3-l1-r0.mp3", pitch: 49.57, layer: 1, rr: 0, gain: 0.5763, length: 2.402, mark: 0.0005, peak: 0.02, attack: 0, loop: null, bytes: 11670, hash: "c5cf4ffd" },
      { file: "timp-hit/drum4-l0-r0.mp3", pitch: 52.426, layer: 0, rr: 0, gain: 0.7646, length: 2.402, mark: 0.0002, peak: 0.02, attack: 0, loop: null, bytes: 11618, hash: "c07a0701" },
      { file: "timp-hit/drum4-l0-r1.mp3", pitch: 52.445, layer: 0, rr: 1, gain: 0.8099, length: 2.402, mark: 0.0004, peak: 0.02, attack: 0, loop: null, bytes: 11826, hash: "73f4f5b5" },
      { file: "timp-hit/drum4-l1-r0.mp3", pitch: 52.526, layer: 1, rr: 0, gain: 0.7466, length: 2.402, mark: 0.0002, peak: 0.02, attack: 0, loop: null, bytes: 11905, hash: "1f52fafb" },
      { file: "timp-hit/drum5-l1-r0.mp3", pitch: 54.078, layer: 1, rr: 0, gain: 0.8273, length: 2.402, mark: 0.0006, peak: 0.02, attack: 0, loop: null, bytes: 11488, hash: "37ada1ab" },
      { file: "timp-hit/drum5-l0-r0.mp3", pitch: 54.517, layer: 0, rr: 0, gain: 0.7986, length: 2.402, mark: 0.001, peak: 0.02, attack: 0, loop: null, bytes: 12138, hash: "06209d77" },
      { file: "timp-hit/drum5-l0-r1.mp3", pitch: 54.639, layer: 0, rr: 1, gain: 0.7133, length: 2.402, mark: 0.0009, peak: 0.02, attack: 0, loop: null, bytes: 12216, hash: "4492be55" },
    ],
  },
  /** 定音鼓，滚奏（五只鼓） */
  "timp.roll": {
    kind: "sustain",
    stereo: false,
    zones: [
      { file: "timp-roll/drum1-l0-r0.mp3", pitch: 41.803, layer: 0, rr: 0, gain: 0.4038, length: 3.002, mark: 0.0006, peak: 0.37, attack: 0.027, loop: [0.72, 2.8618, 0.12, 0.908], bytes: 21421, hash: "35a95fe9" },
      { file: "timp-roll/drum2-l0-r0.mp3", pitch: 47.1, layer: 0, rr: 0, gain: 0.4221, length: 3.002, mark: 0.0008, peak: 2.49, attack: 0.037, loop: [0.36, 2.8374, 0.12, 0.913], bytes: 20146, hash: "768df28e" },
      { file: "timp-roll/drum3-l0-r0.mp3", pitch: 49.4, layer: 0, rr: 0, gain: 0.3552, length: 3.002, mark: 0.001, peak: 0.73, attack: 0.027, loop: [0.46, 2.7781, 0.12, 0.907], bytes: 21291, hash: "df27940b" },
      { file: "timp-roll/drum4-l0-r0.mp3", pitch: 52.12, layer: 0, rr: 0, gain: 0.6612, length: 3.002, mark: 0.0006, peak: 0.26, attack: 0.027, loop: [0.32, 2.6333, 0.12, 0.867], bytes: 20874, hash: "16d4051d" },
      { file: "timp-roll/drum5-l0-r0.mp3", pitch: 55.608, layer: 0, rr: 0, gain: 0.5214, length: 3.002, mark: 0.0005, peak: 0.87, attack: 0.027, loop: [0.76, 1.8727, 0.12, 0.825], bytes: 22363, hash: "9fae9d01" },
    ],
  },
  /** 小号，长音 */
  "tp.sus": {
    kind: "sustain",
    stereo: false,
    zones: [
      { file: "tp-sus/F3-l0-r0.mp3", pitch: 52.979, layer: 0, rr: 0, gain: 0.7239, length: 2.502, mark: 0.0003, peak: 0.24, attack: 0.057, loop: [1.26, 2.3025, 0.08, 0.959], bytes: 22063, hash: "3a0e5e14" },
      { file: "tp-sus/A3-l0-r0.mp3", pitch: 56.973, layer: 0, rr: 0, gain: 0.505, length: 2.502, mark: 0.0003, peak: 2.32, attack: 0.037, loop: [0.52, 2.1459, 0.08, 0.988], bytes: 24085, hash: "4ded9fb9" },
      { file: "tp-sus/C4-l0-r0.mp3", pitch: 59.977, layer: 0, rr: 0, gain: 0.5066, length: 2.502, mark: 0.0006, peak: 0.46, attack: 0.027, loop: [0.82, 2.4276, 0.08, 0.979], bytes: 22407, hash: "e4c901b5" },
      { file: "tp-sus/Ds4-l0-r0.mp3", pitch: 62.995, layer: 0, rr: 0, gain: 0.436, length: 2.502, mark: 0.0002, peak: 2.39, attack: 0.127, loop: [0.6, 2.4388, 0.08, 0.986], bytes: 25730, hash: "fb5e9121" },
      { file: "tp-sus/G4-l0-r0.mp3", pitch: 67.032, layer: 0, rr: 0, gain: 0.3461, length: 2.502, mark: 0.0003, peak: 0.53, attack: 0.127, loop: [0.76, 2.3229, 0.08, 0.977], bytes: 21435, hash: "f57b085c" },
      { file: "tp-sus/As4-l0-r0.mp3", pitch: 70.005, layer: 0, rr: 0, gain: 0.3278, length: 2.502, mark: 0.0004, peak: 0.4, attack: 0.027, loop: [0.64, 2.2714, 0.08, 0.994], bytes: 19914, hash: "c0fab2d1" },
      { file: "tp-sus/D5-l0-r0.mp3", pitch: 74.028, layer: 0, rr: 0, gain: 0.2296, length: 2.502, mark: 0.0005, peak: 1.8, attack: 0.037, loop: [0.84, 2.4406, 0.08, 0.981], bytes: 20432, hash: "73ada5df" },
      { file: "tp-sus/F5-l0-r0.mp3", pitch: 76.971, layer: 0, rr: 0, gain: 0.2252, length: 2.502, mark: 0.0008, peak: 0.53, attack: 0.037, loop: [0.32, 1.9613, 0.08, 0.988], bytes: 24083, hash: "7085b17b" },
      { file: "tp-sus/A5-l0-r0.mp3", pitch: 81.017, layer: 0, rr: 0, gain: 0.2708, length: 2.502, mark: 0.0005, peak: 0.51, attack: 0.047, loop: [0.58, 2.2078, 0.08, 0.975], bytes: 23713, hash: "390478e6" },
      { file: "tp-sus/C6-l0-r0.mp3", pitch: 83.974, layer: 0, rr: 0, gain: 0.2829, length: 2.502, mark: 0.0002, peak: 0.09, attack: 0.047, loop: [0.34, 1.9601, 0.08, 0.96], bytes: 25373, hash: "f01bd9cb" },
    ],
  },
  /** 管钟（船钟、钟楼） */
  "tubular": {
    kind: "shot",
    stereo: false,
    zones: [
      { file: "tubular/C4-l0-r0.mp3", pitch: 59.8, layer: 0, rr: 0, gain: 0.3899, length: 3.202, mark: 0.0002, peak: 0.04, attack: 0, loop: null, bytes: 19082, hash: "44371c1b" },
      { file: "tubular/G4-l0-r0.mp3", pitch: 67.169, layer: 0, rr: 0, gain: 0.3915, length: 3.202, mark: 0, peak: 0.01, attack: 0, loop: null, bytes: 19216, hash: "938b985c" },
      { file: "tubular/F5-l0-r0.mp3", pitch: 77.063, layer: 0, rr: 0, gain: 0.3685, length: 3.202, mark: 0.0001, peak: 0.01, attack: 0, loop: null, bytes: 22688, hash: "a3a7a9c5" },
    ],
  },
  /** 中提琴组，揉弦长音 */
  "va.sus": {
    kind: "sustain",
    stereo: true,
    zones: [
      { file: "va-sus/C3-l0-r0.mp3", pitch: 48.007, layer: 0, rr: 0, gain: 0.3597, length: 2.702, mark: 0.0012, peak: 2.59, attack: 0.547, loop: [1.167, 2.1908, 0.15, 0.792], bytes: 51180, hash: "bf08781d" },
      { file: "va-sus/D3-l0-r0.mp3", pitch: 49.968, layer: 0, rr: 0, gain: 0.3632, length: 2.702, mark: 0.0008, peak: 2.33, attack: 0.477, loop: [0.917, 1.9745, 0.15, 0.87], bytes: 48926, hash: "37fc1e98" },
      { file: "va-sus/E3-l0-r0.mp3", pitch: 51.992, layer: 0, rr: 0, gain: 0.4012, length: 2.702, mark: 0.0019, peak: 2.51, attack: 1.237, loop: [1.417, 2.4186, 0.15, 0.852], bytes: 49707, hash: "562b3694" },
      { file: "va-sus/G3-l0-r0.mp3", pitch: 55.027, layer: 0, rr: 0, gain: 0.45, length: 2.709, mark: 0.0008, peak: 1.72, attack: 1.257, loop: [1.377, 2.5147, 0.15, 0.622], bytes: 50261, hash: "00df127f" },
      { file: "va-sus/B3-l0-r0.mp3", pitch: 58.984, layer: 0, rr: 0, gain: 0.3851, length: 2.702, mark: 0.0012, peak: 1.57, attack: 0.997, loop: [1.097, 2.4242, 0.15, 0.723], bytes: 53428, hash: "f0cc32a6" },
      { file: "va-sus/D4-l0-r0.mp3", pitch: 62.074, layer: 0, rr: 0, gain: 0.481, length: 2.702, mark: 0.0015, peak: 2.26, attack: 0.907, loop: [1.047, 2.3726, 0.15, 0.741], bytes: 49972, hash: "10897473" },
      { file: "va-sus/F4-l0-r0.mp3", pitch: 64.991, layer: 0, rr: 0, gain: 0.3791, length: 2.702, mark: 0.0014, peak: 1.93, attack: 0.597, loop: [1.157, 2.6405, 0.15, 0.753], bytes: 54578, hash: "d369e6ce" },
      { file: "va-sus/A4-l0-r0.mp3", pitch: 69.024, layer: 0, rr: 0, gain: 0.2861, length: 2.702, mark: 0.0013, peak: 0.87, attack: 0.347, loop: [0.527, 2.1394, 0.15, 0.914], bytes: 54369, hash: "9dcce22b" },
      { file: "va-sus/C5-l0-r0.mp3", pitch: 71.97, layer: 0, rr: 0, gain: 0.3862, length: 2.702, mark: 0.0011, peak: 2.03, attack: 0.757, loop: [0.977, 2.36, 0.15, 0.697], bytes: 57811, hash: "8399c1be" },
      { file: "va-sus/E5-l0-r0.mp3", pitch: 76.065, layer: 0, rr: 0, gain: 0.4274, length: 2.702, mark: 0.002, peak: 1.99, attack: 0.717, loop: [0.937, 2.5102, 0.15, 0.599], bytes: 54735, hash: "260dd8c0" },
      { file: "va-sus/G5-l0-r0.mp3", pitch: 79.04, layer: 0, rr: 0, gain: 0.3823, length: 2.702, mark: 0.0015, peak: 1.88, attack: 0.827, loop: [1.487, 2.6168, 0.15, 0.78], bytes: 56269, hash: "ed6459eb" },
      { file: "va-sus/B5-l0-r0.mp3", pitch: 83.019, layer: 0, rr: 0, gain: 0.4772, length: 2.702, mark: 0.0012, peak: 2.19, attack: 0.707, loop: [1.207, 2.318, 0.15, 0.598], bytes: 61038, hash: "261ce840" },
      { file: "va-sus/D6-l0-r0.mp3", pitch: 85.922, layer: 0, rr: 0, gain: 0.4341, length: 2.702, mark: 0.0019, peak: 1.22, attack: 0.317, loop: [0.737, 2.311, 0.15, 0.718], bytes: 60677, hash: "763415c4" },
    ],
  },
  /** 大提琴组，拨奏，两个轮换 */
  "vc.pizz": {
    kind: "shot",
    stereo: true,
    zones: [
      { file: "vc-pizz/C2-l0-r0.mp3", pitch: 35.9, layer: 0, rr: 0, gain: 0.4534, length: 1.302, mark: 0.0005, peak: 0.08, attack: 0, loop: null, bytes: 14589, hash: "6f506767" },
      { file: "vc-pizz/C2-l0-r1.mp3", pitch: 35.968, layer: 0, rr: 1, gain: 0.7609, length: 1.302, mark: 0.0003, peak: 0.05, attack: 0, loop: null, bytes: 13416, hash: "df5b99d8" },
      { file: "vc-pizz/E2-l0-r0.mp3", pitch: 39.949, layer: 0, rr: 0, gain: 0.6591, length: 1.302, mark: 0.0015, peak: 0.04, attack: 0, loop: null, bytes: 14721, hash: "48582b9a" },
      { file: "vc-pizz/E2-l0-r1.mp3", pitch: 40.032, layer: 0, rr: 1, gain: 0.6185, length: 1.302, mark: 0.0001, peak: 0.05, attack: 0, loop: null, bytes: 16915, hash: "263aa579" },
      { file: "vc-pizz/G2-l0-r1.mp3", pitch: 42.892, layer: 0, rr: 1, gain: 0.6014, length: 1.302, mark: 0.0012, peak: 0.05, attack: 0, loop: null, bytes: 14722, hash: "b07c18a8" },
      { file: "vc-pizz/G2-l0-r0.mp3", pitch: 42.978, layer: 0, rr: 0, gain: 0.438, length: 1.302, mark: 0.0014, peak: 0.06, attack: 0, loop: null, bytes: 13209, hash: "78d2132f" },
      { file: "vc-pizz/B2-l0-r0.mp3", pitch: 46.854, layer: 0, rr: 0, gain: 0.5408, length: 1.302, mark: 0.0012, peak: 0.11, attack: 0, loop: null, bytes: 14331, hash: "55da295f" },
      { file: "vc-pizz/B2-l0-r1.mp3", pitch: 46.882, layer: 0, rr: 1, gain: 0.4998, length: 1.302, mark: 0.0012, peak: 0.04, attack: 0, loop: null, bytes: 13729, hash: "f2f22516" },
      { file: "vc-pizz/D3-l0-r1.mp3", pitch: 50.031, layer: 0, rr: 1, gain: 0.804, length: 1.302, mark: 0.0007, peak: 0.07, attack: 0, loop: null, bytes: 13624, hash: "bb27eafa" },
      { file: "vc-pizz/D3-l0-r0.mp3", pitch: 50.039, layer: 0, rr: 0, gain: 0.6836, length: 1.302, mark: 0.0007, peak: 0.07, attack: 0, loop: null, bytes: 12418, hash: "787c3656" },
      { file: "vc-pizz/F3-l0-r0.mp3", pitch: 53.018, layer: 0, rr: 0, gain: 0.5558, length: 1.302, mark: 0.0015, peak: 0.06, attack: 0, loop: null, bytes: 13127, hash: "33420052" },
      { file: "vc-pizz/F3-l0-r1.mp3", pitch: 53.108, layer: 0, rr: 1, gain: 0.6783, length: 1.302, mark: 0.0004, peak: 0.05, attack: 0, loop: null, bytes: 12708, hash: "5030f3b4" },
      { file: "vc-pizz/A3-l0-r1.mp3", pitch: 57.08, layer: 0, rr: 1, gain: 0.4421, length: 1.302, mark: 0.0019, peak: 0.06, attack: 0, loop: null, bytes: 13569, hash: "abaa6d10" },
      { file: "vc-pizz/A3-l0-r0.mp3", pitch: 57.122, layer: 0, rr: 0, gain: 0.565, length: 1.302, mark: 0.0002, peak: 0.09, attack: 0, loop: null, bytes: 14146, hash: "63b629e7" },
      { file: "vc-pizz/C4-l0-r1.mp3", pitch: 59.987, layer: 0, rr: 1, gain: 0.8448, length: 1.302, mark: 0.0018, peak: 0.07, attack: 0, loop: null, bytes: 14039, hash: "f11aa579" },
      { file: "vc-pizz/C4-l0-r0.mp3", pitch: 60.018, layer: 0, rr: 0, gain: 0.6772, length: 1.302, mark: 0.0014, peak: 0.08, attack: 0, loop: null, bytes: 14512, hash: "b286bc7f" },
      { file: "vc-pizz/E4-l0-r1.mp3", pitch: 63.951, layer: 0, rr: 1, gain: 0.6694, length: 1.302, mark: 0.0012, peak: 0.08, attack: 0, loop: null, bytes: 13179, hash: "ccde96d1" },
      { file: "vc-pizz/E4-l0-r0.mp3", pitch: 64.045, layer: 0, rr: 0, gain: 0.7557, length: 1.302, mark: 0.0011, peak: 0.07, attack: 0, loop: null, bytes: 12603, hash: "f1a6eec9" },
      { file: "vc-pizz/G4-l0-r0.mp3", pitch: 67.048, layer: 0, rr: 0, gain: 0.5074, length: 1.302, mark: 0.0017, peak: 0.04, attack: 0, loop: null, bytes: 15530, hash: "56dc81a9" },
      { file: "vc-pizz/G4-l0-r1.mp3", pitch: 67.053, layer: 0, rr: 1, gain: 0.5846, length: 1.302, mark: 0.0015, peak: 0.11, attack: 0, loop: null, bytes: 14120, hash: "465645ec" },
      { file: "vc-pizz/B4-l0-r1.mp3", pitch: 71.024, layer: 0, rr: 1, gain: 0.7738, length: 1.302, mark: 0.0012, peak: 0.09, attack: 0, loop: null, bytes: 12027, hash: "91b8a658" },
      { file: "vc-pizz/B4-l0-r0.mp3", pitch: 71.028, layer: 0, rr: 0, gain: 0.7581, length: 1.302, mark: 0.0004, peak: 0.08, attack: 0, loop: null, bytes: 14463, hash: "dae744ec" },
      { file: "vc-pizz/D5-l0-r0.mp3", pitch: 74.048, layer: 0, rr: 0, gain: 0.7144, length: 1.302, mark: 0.0017, peak: 0.04, attack: 0, loop: null, bytes: 14067, hash: "b51bfc9e" },
      { file: "vc-pizz/D5-l0-r1.mp3", pitch: 74.112, layer: 0, rr: 1, gain: 0.8, length: 0.999, mark: 0.0002, peak: 0.08, attack: 0, loop: null, bytes: 10520, hash: "659999c1" },
      { file: "vc-pizz/F5-l0-r0.mp3", pitch: 77.052, layer: 0, rr: 0, gain: 0.8754, length: 1.011, mark: 0.0005, peak: 0.04, attack: 0, loop: null, bytes: 11437, hash: "d21ef893" },
      { file: "vc-pizz/F5-l0-r1.mp3", pitch: 77.103, layer: 0, rr: 1, gain: 1.0119, length: 1.302, mark: 0.0015, peak: 0.02, attack: 0, loop: null, bytes: 11065, hash: "0cc48e12" },
    ],
  },
  /** 大提琴组，跳弓 */
  "vc.spic": {
    kind: "shot",
    stereo: true,
    zones: [
      { file: "vc-spic/C2-l0-r0.mp3", pitch: 35.95, layer: 0, rr: 0, gain: 0.4699, length: 0.602, mark: 0.0019, peak: 0.08, attack: 0, loop: null, bytes: 9119, hash: "7f022b62" },
      { file: "vc-spic/E2-l0-r0.mp3", pitch: 39.956, layer: 0, rr: 0, gain: 0.7844, length: 0.602, mark: 0.0015, peak: 0.1, attack: 0, loop: null, bytes: 9354, hash: "6868d96c" },
      { file: "vc-spic/G2-l0-r0.mp3", pitch: 42.977, layer: 0, rr: 0, gain: 0.5486, length: 0.602, mark: 0.0001, peak: 0.13, attack: 0, loop: null, bytes: 10032, hash: "e9202970" },
      { file: "vc-spic/B2-l0-r0.mp3", pitch: 47.051, layer: 0, rr: 0, gain: 0.6032, length: 0.602, mark: 0.0006, peak: 0.12, attack: 0, loop: null, bytes: 9981, hash: "7347065e" },
      { file: "vc-spic/D3-l0-r0.mp3", pitch: 49.99, layer: 0, rr: 0, gain: 0.5542, length: 0.602, mark: 0.0009, peak: 0.14, attack: 0, loop: null, bytes: 10450, hash: "dc52dab2" },
      { file: "vc-spic/F3-l0-r0.mp3", pitch: 53.042, layer: 0, rr: 0, gain: 0.724, length: 0.602, mark: 0.0019, peak: 0.12, attack: 0, loop: null, bytes: 9381, hash: "8da98285" },
      { file: "vc-spic/A3-l0-r0.mp3", pitch: 57.05, layer: 0, rr: 0, gain: 0.5053, length: 0.602, mark: 0.0019, peak: 0.18, attack: 0, loop: null, bytes: 10791, hash: "1076e964" },
      { file: "vc-spic/C4-l0-r0.mp3", pitch: 60.225, layer: 0, rr: 0, gain: 0.6929, length: 0.602, mark: 0.0002, peak: 0.14, attack: 0, loop: null, bytes: 10476, hash: "7c27bad9" },
      { file: "vc-spic/E4-l0-r0.mp3", pitch: 63.891, layer: 0, rr: 0, gain: 0.5765, length: 0.602, mark: 0.0014, peak: 0.07, attack: 0, loop: null, bytes: 10346, hash: "7d9a37db" },
      { file: "vc-spic/G4-l0-r0.mp3", pitch: 66.821, layer: 0, rr: 0, gain: 0.6353, length: 0.602, mark: 0.002, peak: 0.16, attack: 0, loop: null, bytes: 10240, hash: "2c652372" },
      { file: "vc-spic/B4-l0-r0.mp3", pitch: 70.938, layer: 0, rr: 0, gain: 0.4426, length: 0.602, mark: 0.0012, peak: 0.18, attack: 0, loop: null, bytes: 10844, hash: "91405f0e" },
      { file: "vc-spic/D5-l0-r0.mp3", pitch: 74.068, layer: 0, rr: 0, gain: 0.8534, length: 0.602, mark: 0.0013, peak: 0.1, attack: 0, loop: null, bytes: 10293, hash: "99f4c178" },
      { file: "vc-spic/F5-l0-r0.mp3", pitch: 77.08, layer: 0, rr: 0, gain: 0.8978, length: 0.602, mark: 0.0016, peak: 0.07, attack: 0, loop: null, bytes: 10503, hash: "9fe9219d" },
    ],
  },
  /** 大提琴组，揉弦长音，两个力度层（弱的一层每隔一个采样点） */
  "vc.sus": {
    kind: "sustain",
    stereo: true,
    zones: [
      { file: "vc-sus/C2-l0-r0.mp3", pitch: 35.981, layer: 0, rr: 0, gain: 0.4039, length: 2.789, mark: 0.0009, peak: 2.74, attack: 1.337, loop: [1.557, 2.7202, 0.15, 0.824], bytes: 51536, hash: "e0427e0b" },
      { file: "vc-sus/C2-l1-r0.mp3", pitch: 35.985, layer: 1, rr: 0, gain: 0.4761, length: 2.702, mark: 0.0012, peak: 2.67, attack: 0.157, loop: [0.4, 1.6178, 0.15, 0.675], bytes: 51942, hash: "b8f32733" },
      { file: "vc-sus/E2-l1-r0.mp3", pitch: 39.952, layer: 1, rr: 0, gain: 0.5726, length: 2.702, mark: 0.0004, peak: 0.94, attack: 0.067, loop: [0.7, 2.1734, 0.15, 0.858], bytes: 52597, hash: "acc58602" },
      { file: "vc-sus/G2-l0-r0.mp3", pitch: 42.982, layer: 0, rr: 0, gain: 0.3233, length: 2.702, mark: 0.0012, peak: 1.25, attack: 0.397, loop: [0.697, 1.7389, 0.15, 0.917], bytes: 47195, hash: "f0d960d8" },
      { file: "vc-sus/G2-l1-r0.mp3", pitch: 42.997, layer: 1, rr: 0, gain: 0.4048, length: 2.702, mark: 0.0004, peak: 2.59, attack: 0.067, loop: [0.68, 1.7111, 0.15, 0.872], bytes: 52125, hash: "1f276230" },
      { file: "vc-sus/B2-l1-r0.mp3", pitch: 47.057, layer: 1, rr: 0, gain: 0.4065, length: 2.702, mark: 0.0012, peak: 0.34, attack: 0.117, loop: [0.78, 1.781, 0.15, 0.915], bytes: 52854, hash: "bca785b2" },
      { file: "vc-sus/D3-l1-r0.mp3", pitch: 50, layer: 1, rr: 0, gain: 0.4849, length: 2.702, mark: 0.0005, peak: 0.21, attack: 0.047, loop: [0.32, 1.5337, 0.15, 0.852], bytes: 51160, hash: "0fc9208a" },
      { file: "vc-sus/D3-l0-r0.mp3", pitch: 50.037, layer: 0, rr: 0, gain: 0.519, length: 2.702, mark: 0.0014, peak: 2.62, attack: 0.547, loop: [0.767, 2.1258, 0.15, 0.823], bytes: 48663, hash: "dc194635" },
      { file: "vc-sus/F3-l1-r0.mp3", pitch: 52.973, layer: 1, rr: 0, gain: 0.7397, length: 2.702, mark: 0.0002, peak: 1.46, attack: 0.057, loop: [1.54, 2.63, 0.15, 0.792], bytes: 56803, hash: "6d99b12b" },
      { file: "vc-sus/A3-l0-r0.mp3", pitch: 56.959, layer: 0, rr: 0, gain: 0.3599, length: 2.702, mark: 0.0015, peak: 1.44, attack: 0.307, loop: [1.107, 2.543, 0.15, 0.876], bytes: 53224, hash: "136ee4db" },
      { file: "vc-sus/A3-l1-r0.mp3", pitch: 56.976, layer: 1, rr: 0, gain: 0.6247, length: 2.702, mark: 0.0002, peak: 0.27, attack: 0.067, loop: [0.72, 2.4906, 0.15, 0.785], bytes: 56250, hash: "d78cde83" },
      { file: "vc-sus/C4-l1-r0.mp3", pitch: 59.963, layer: 1, rr: 0, gain: 0.5787, length: 2.702, mark: 0.0013, peak: 0.17, attack: 0.037, loop: [0.76, 2.6183, 0.15, 0.859], bytes: 55569, hash: "31bcd3c5" },
      { file: "vc-sus/E4-l1-r0.mp3", pitch: 63.873, layer: 1, rr: 0, gain: 0.5905, length: 2.702, mark: 0.0003, peak: 0.41, attack: 0.047, loop: [0.42, 1.5212, 0.15, 0.847], bytes: 52988, hash: "053dbe89" },
      { file: "vc-sus/E4-l0-r0.mp3", pitch: 64.047, layer: 0, rr: 0, gain: 0.592, length: 2.702, mark: 0.0013, peak: 0.67, attack: 0.147, loop: [0.3, 2.3911, 0.15, 0.834], bytes: 51757, hash: "568a58fa" },
      { file: "vc-sus/G4-l1-r0.mp3", pitch: 67.079, layer: 1, rr: 0, gain: 0.5066, length: 2.702, mark: 0.0004, peak: 1, attack: 0.037, loop: [0.3, 1.4284, 0.15, 0.707], bytes: 53219, hash: "09589c85" },
      { file: "vc-sus/B4-l0-r0.mp3", pitch: 70.959, layer: 0, rr: 0, gain: 0.5904, length: 2.702, mark: 0.0007, peak: 1.01, attack: 0.167, loop: [0.4, 1.851, 0.15, 0.708], bytes: 57835, hash: "a0bf9014" },
      { file: "vc-sus/B4-l1-r0.mp3", pitch: 71.008, layer: 1, rr: 0, gain: 0.6214, length: 2.702, mark: 0.0005, peak: 1.42, attack: 0.087, loop: [1.58, 2.611, 0.15, 0.687], bytes: 57005, hash: "8cc6675c" },
      { file: "vc-sus/D5-l1-r0.mp3", pitch: 73.937, layer: 1, rr: 0, gain: 0.5095, length: 2.702, mark: 0.0005, peak: 0.37, attack: 0.077, loop: [0.46, 2.096, 0.15, 0.733], bytes: 54788, hash: "c39bbbb4" },
      { file: "vc-sus/F5-l1-r0.mp3", pitch: 77.018, layer: 1, rr: 0, gain: 0.5448, length: 2.702, mark: 0.0002, peak: 0.6, attack: 0.057, loop: [1.02, 2.1288, 0.15, 0.616], bytes: 54682, hash: "4ab72cdb" },
      { file: "vc-sus/F5-l0-r0.mp3", pitch: 77.065, layer: 0, rr: 0, gain: 0.4302, length: 2.702, mark: 0.0019, peak: 2.6, attack: 0.487, loop: [0.787, 1.9392, 0.15, 0.77], bytes: 59840, hash: "475fedca" },
    ],
  },
  /** 小提琴组，拨奏，两个轮换 */
  "vn.pizz": {
    kind: "shot",
    stereo: true,
    zones: [
      { file: "vn-pizz/G3-l0-r0.mp3", pitch: 54.966, layer: 0, rr: 0, gain: 0.6329, length: 0.902, mark: 0.0001, peak: 0.09, attack: 0, loop: null, bytes: 14673, hash: "e4ed299a" },
      { file: "vn-pizz/G3-l0-r1.mp3", pitch: 54.969, layer: 0, rr: 1, gain: 0.5962, length: 0.902, mark: 0.0001, peak: 0.11, attack: 0, loop: null, bytes: 15167, hash: "f9b5c99c" },
      { file: "vn-pizz/A3-l0-r1.mp3", pitch: 56.939, layer: 0, rr: 1, gain: 0.8568, length: 0.902, mark: 0.0002, peak: 0.09, attack: 0, loop: null, bytes: 14515, hash: "d19ecc9b" },
      { file: "vn-pizz/A3-l0-r0.mp3", pitch: 56.998, layer: 0, rr: 0, gain: 0.5348, length: 0.902, mark: 0.0001, peak: 0.06, attack: 0, loop: null, bytes: 14227, hash: "814af377" },
      { file: "vn-pizz/B3-l0-r0.mp3", pitch: 58.958, layer: 0, rr: 0, gain: 0.9337, length: 0.902, mark: 0.0001, peak: 0.08, attack: 0, loop: null, bytes: 11462, hash: "5d8f94bf" },
      { file: "vn-pizz/B3-l0-r1.mp3", pitch: 58.979, layer: 0, rr: 1, gain: 1.1254, length: 0.902, mark: 0, peak: 0.08, attack: 0, loop: null, bytes: 13134, hash: "c8d3704f" },
      { file: "vn-pizz/D4-l0-r0.mp3", pitch: 61.889, layer: 0, rr: 0, gain: 1.1217, length: 0.902, mark: 0.0001, peak: 0.04, attack: 0, loop: null, bytes: 12140, hash: "acde14bc" },
      { file: "vn-pizz/D4-l0-r1.mp3", pitch: 61.928, layer: 0, rr: 1, gain: 0.758, length: 0.902, mark: 0.0002, peak: 0.13, attack: 0, loop: null, bytes: 12874, hash: "da2c8fbb" },
      { file: "vn-pizz/Fs4-l0-r1.mp3", pitch: 65.939, layer: 0, rr: 1, gain: 0.7069, length: 0.902, mark: 0.0002, peak: 0.13, attack: 0, loop: null, bytes: 12872, hash: "0bb2d002" },
      { file: "vn-pizz/Fs4-l0-r0.mp3", pitch: 65.95, layer: 0, rr: 0, gain: 0.715, length: 0.89, mark: 0.0001, peak: 0.09, attack: 0, loop: null, bytes: 13028, hash: "c357316e" },
      { file: "vn-pizz/A4-l0-r0.mp3", pitch: 69.012, layer: 0, rr: 0, gain: 0.5541, length: 0.902, mark: 0.0009, peak: 0.13, attack: 0, loop: null, bytes: 11854, hash: "fa2ff200" },
      { file: "vn-pizz/A4-l0-r1.mp3", pitch: 69.013, layer: 0, rr: 1, gain: 1.2448, length: 0.902, mark: 0, peak: 0.03, attack: 0, loop: null, bytes: 11982, hash: "5e364c3c" },
      { file: "vn-pizz/C5-l0-r1.mp3", pitch: 72.079, layer: 0, rr: 1, gain: 0.8005, length: 0.902, mark: 0.0003, peak: 0.04, attack: 0, loop: null, bytes: 11516, hash: "582c2159" },
      { file: "vn-pizz/C5-l0-r0.mp3", pitch: 72.109, layer: 0, rr: 0, gain: 0.9699, length: 0.902, mark: 0.0002, peak: 0.04, attack: 0, loop: null, bytes: 13108, hash: "c0a69da4" },
      { file: "vn-pizz/E5-l0-r1.mp3", pitch: 75.905, layer: 0, rr: 1, gain: 1.0109, length: 0.902, mark: 0, peak: 0.03, attack: 0, loop: null, bytes: 11019, hash: "fbfae9c8" },
      { file: "vn-pizz/E5-l0-r0.mp3", pitch: 75.986, layer: 0, rr: 0, gain: 1.2408, length: 0.832, mark: 0.0001, peak: 0.07, attack: 0, loop: null, bytes: 11802, hash: "e7070b8f" },
      { file: "vn-pizz/G5-l0-r1.mp3", pitch: 79.024, layer: 0, rr: 1, gain: 1.0583, length: 0.902, mark: 0.0003, peak: 0.09, attack: 0, loop: null, bytes: 15326, hash: "41348802" },
      { file: "vn-pizz/G5-l0-r0.mp3", pitch: 79.025, layer: 0, rr: 0, gain: 1.4239, length: 0.902, mark: 0.001, peak: 0.06, attack: 0, loop: null, bytes: 13892, hash: "80a46bf8" },
      { file: "vn-pizz/B5-l0-r1.mp3", pitch: 82.985, layer: 0, rr: 1, gain: 0.8782, length: 0.716, mark: 0.0001, peak: 0.03, attack: 0, loop: null, bytes: 12068, hash: "51ab569f" },
      { file: "vn-pizz/B5-l0-r0.mp3", pitch: 82.997, layer: 0, rr: 0, gain: 1.2956, length: 0.603, mark: 0.0002, peak: 0.08, attack: 0, loop: null, bytes: 10919, hash: "c539f214" },
      { file: "vn-pizz/D6-l0-r0.mp3", pitch: 86.127, layer: 0, rr: 0, gain: 1.0102, length: 0.642, mark: 0.001, peak: 0.02, attack: 0, loop: null, bytes: 10787, hash: "ff0b45b0" },
      { file: "vn-pizz/D6-l0-r1.mp3", pitch: 86.163, layer: 0, rr: 1, gain: 0.9656, length: 0.713, mark: 0.0011, peak: 0.09, attack: 0, loop: null, bytes: 12250, hash: "33a0e112" },
    ],
  },
  /** 小提琴组，跳弓，两个轮换 */
  "vn.spic": {
    kind: "shot",
    stereo: true,
    zones: [
      { file: "vn-spic/G3-l0-r0.mp3", pitch: 54.953, layer: 0, rr: 0, gain: 0.6279, length: 0.552, mark: 0.0018, peak: 0.2, attack: 0, loop: null, bytes: 11495, hash: "54444c14" },
      { file: "vn-spic/G3-l0-r1.mp3", pitch: 55.054, layer: 0, rr: 1, gain: 0.677, length: 0.552, mark: 0.0014, peak: 0.17, attack: 0, loop: null, bytes: 11157, hash: "e3949d89" },
      { file: "vn-spic/A3-l0-r1.mp3", pitch: 56.921, layer: 0, rr: 1, gain: 0.5612, length: 0.552, mark: 0.0013, peak: 0.2, attack: 0, loop: null, bytes: 11131, hash: "61db3cee" },
      { file: "vn-spic/A3-l0-r0.mp3", pitch: 56.952, layer: 0, rr: 0, gain: 0.5619, length: 0.552, mark: 0.0012, peak: 0.21, attack: 0, loop: null, bytes: 11547, hash: "a3538427" },
      { file: "vn-spic/B3-l0-r1.mp3", pitch: 58.829, layer: 0, rr: 1, gain: 0.7894, length: 0.552, mark: 0.0013, peak: 0.15, attack: 0, loop: null, bytes: 9876, hash: "e8645ba5" },
      { file: "vn-spic/B3-l0-r0.mp3", pitch: 58.846, layer: 0, rr: 0, gain: 0.6651, length: 0.552, mark: 0.0017, peak: 0.2, attack: 0, loop: null, bytes: 11025, hash: "40cb789f" },
      { file: "vn-spic/D4-l0-r0.mp3", pitch: 61.957, layer: 0, rr: 0, gain: 0.6708, length: 0.552, mark: 0.0016, peak: 0.19, attack: 0, loop: null, bytes: 10452, hash: "756df11a" },
      { file: "vn-spic/D4-l0-r1.mp3", pitch: 62.028, layer: 0, rr: 1, gain: 0.5809, length: 0.552, mark: 0.0016, peak: 0.16, attack: 0, loop: null, bytes: 10529, hash: "fd4003bc" },
      { file: "vn-spic/Fs4-l0-r1.mp3", pitch: 65.884, layer: 0, rr: 1, gain: 0.5348, length: 0.552, mark: 0.0018, peak: 0.29, attack: 0, loop: null, bytes: 11471, hash: "2da40ba3" },
      { file: "vn-spic/Fs4-l0-r0.mp3", pitch: 66.055, layer: 0, rr: 0, gain: 0.4963, length: 0.552, mark: 0.0015, peak: 0.19, attack: 0, loop: null, bytes: 11315, hash: "e3c38bad" },
      { file: "vn-spic/A4-l0-r0.mp3", pitch: 68.962, layer: 0, rr: 0, gain: 0.635, length: 0.552, mark: 0.0016, peak: 0.23, attack: 0, loop: null, bytes: 11313, hash: "92d739b7" },
      { file: "vn-spic/A4-l0-r1.mp3", pitch: 69.069, layer: 0, rr: 1, gain: 0.5168, length: 0.552, mark: 0.0011, peak: 0.14, attack: 0, loop: null, bytes: 10870, hash: "02e9f1e2" },
      { file: "vn-spic/C5-l0-r0.mp3", pitch: 71.899, layer: 0, rr: 0, gain: 0.8194, length: 0.552, mark: 0.0012, peak: 0.18, attack: 0, loop: null, bytes: 11314, hash: "140275f7" },
      { file: "vn-spic/C5-l0-r1.mp3", pitch: 72.053, layer: 0, rr: 1, gain: 0.6268, length: 0.552, mark: 0.0019, peak: 0.15, attack: 0, loop: null, bytes: 11418, hash: "4392470b" },
      { file: "vn-spic/E5-l0-r0.mp3", pitch: 75.909, layer: 0, rr: 0, gain: 0.7552, length: 0.552, mark: 0.0019, peak: 0.17, attack: 0, loop: null, bytes: 11915, hash: "b759dd42" },
      { file: "vn-spic/E5-l0-r1.mp3", pitch: 75.938, layer: 0, rr: 1, gain: 0.7039, length: 0.552, mark: 0.0013, peak: 0.18, attack: 0, loop: null, bytes: 12255, hash: "0060ad9e" },
      { file: "vn-spic/G5-l0-r1.mp3", pitch: 78.949, layer: 0, rr: 1, gain: 0.825, length: 0.552, mark: 0.0015, peak: 0.13, attack: 0, loop: null, bytes: 11471, hash: "54efc967" },
      { file: "vn-spic/G5-l0-r0.mp3", pitch: 78.991, layer: 0, rr: 0, gain: 0.5834, length: 0.552, mark: 0.0018, peak: 0.21, attack: 0, loop: null, bytes: 12123, hash: "3937117b" },
      { file: "vn-spic/B5-l0-r0.mp3", pitch: 82.963, layer: 0, rr: 0, gain: 0.7568, length: 0.552, mark: 0.0015, peak: 0.15, attack: 0, loop: null, bytes: 10765, hash: "ac36eb1e" },
      { file: "vn-spic/B5-l0-r1.mp3", pitch: 83.199, layer: 0, rr: 1, gain: 0.5714, length: 0.552, mark: 0.0013, peak: 0.13, attack: 0, loop: null, bytes: 11600, hash: "fc776c5a" },
      { file: "vn-spic/D6-l0-r0.mp3", pitch: 86.053, layer: 0, rr: 0, gain: 0.5948, length: 0.552, mark: 0.0011, peak: 0.11, attack: 0, loop: null, bytes: 11576, hash: "7d554a57" },
      { file: "vn-spic/D6-l0-r1.mp3", pitch: 86.151, layer: 0, rr: 1, gain: 0.4777, length: 0.552, mark: 0.0013, peak: 0.11, attack: 0, loop: null, bytes: 10583, hash: "bbaf9751" },
    ],
  },
  /** 小提琴组，揉弦长音，两个力度层 */
  "vn.sus": {
    kind: "sustain",
    stereo: true,
    zones: [
      { file: "vn-sus/G3-l1-r0.mp3", pitch: 54.965, layer: 1, rr: 0, gain: 0.5355, length: 3.002, mark: 0.0014, peak: 1.66, attack: 0.507, loop: [0.927, 2.3736, 0.15, 0.867], bytes: 67245, hash: "c0bba33d" },
      { file: "vn-sus/G3-l0-r0.mp3", pitch: 54.975, layer: 0, rr: 0, gain: 0.5977, length: 3.002, mark: 0.0013, peak: 2.86, attack: 0.877, loop: [0.977, 2.5918, 0.15, 0.791], bytes: 63217, hash: "2d0aa932" },
      { file: "vn-sus/A3-l1-r0.mp3", pitch: 56.939, layer: 1, rr: 0, gain: 0.432, length: 3.002, mark: 0.0013, peak: 2.61, attack: 0.307, loop: [0.847, 2.7118, 0.15, 0.756], bytes: 70013, hash: "d0d12f8d" },
      { file: "vn-sus/A3-l0-r0.mp3", pitch: 57.029, layer: 0, rr: 0, gain: 0.5645, length: 3.002, mark: 0.0015, peak: 2.61, attack: 1.297, loop: [1.457, 2.9044, 0.15, 0.813], bytes: 60944, hash: "1c3b981d" },
      { file: "vn-sus/B3-l0-r0.mp3", pitch: 58.997, layer: 0, rr: 0, gain: 0.6376, length: 3.569, mark: 0.0014, peak: 3.5, attack: 1.917, loop: [2.017, 3.3282, 0.15, 0.712], bytes: 72453, hash: "1c83a9d1" },
      { file: "vn-sus/B3-l1-r0.mp3", pitch: 59.028, layer: 1, rr: 0, gain: 0.5953, length: 3.002, mark: 0.0016, peak: 2.22, attack: 0.567, loop: [0.827, 2.7362, 0.15, 0.75], bytes: 68423, hash: "1d9f3f7a" },
      { file: "vn-sus/D4-l0-r0.mp3", pitch: 61.999, layer: 0, rr: 0, gain: 0.605, length: 3.129, mark: 0.001, peak: 2.84, attack: 1.477, loop: [1.577, 2.918, 0.15, 0.612], bytes: 65409, hash: "82b90759" },
      { file: "vn-sus/D4-l1-r0.mp3", pitch: 62.015, layer: 1, rr: 0, gain: 0.5414, length: 3.002, mark: 0.0011, peak: 2.91, attack: 0.197, loop: [0.48, 2.48, 0.15, 0.798], bytes: 67689, hash: "95f5066b" },
      { file: "vn-sus/Fs4-l0-r0.mp3", pitch: 65.987, layer: 0, rr: 0, gain: 0.4338, length: 3.002, mark: 0.0014, peak: 2.63, attack: 1.167, loop: [1.627, 2.9415, 0.15, 0.537], bytes: 62986, hash: "ad20c94e" },
      { file: "vn-sus/Fs4-l1-r0.mp3", pitch: 66.025, layer: 1, rr: 0, gain: 0.5708, length: 3.002, mark: 0.0015, peak: 1.19, attack: 0.597, loop: [0.877, 2.3482, 0.15, 0.542], bytes: 65426, hash: "4f32d42b" },
      { file: "vn-sus/A4-l0-r0.mp3", pitch: 68.954, layer: 0, rr: 0, gain: 0.5161, length: 3.002, mark: 0.0017, peak: 2.18, attack: 1.017, loop: [1.197, 2.8601, 0.15, 0.747], bytes: 63764, hash: "131e062a" },
      { file: "vn-sus/A4-l1-r0.mp3", pitch: 68.996, layer: 1, rr: 0, gain: 0.4285, length: 3.002, mark: 0.0016, peak: 1.85, attack: 0.267, loop: [0.367, 2.1504, 0.15, 0.76], bytes: 64490, hash: "f6415841" },
      { file: "vn-sus/C5-l1-r0.mp3", pitch: 72.017, layer: 1, rr: 0, gain: 0.4591, length: 3.002, mark: 0.0014, peak: 1.57, attack: 0.097, loop: [0.44, 2.4646, 0.15, 0.813], bytes: 63008, hash: "21b4cf8b" },
      { file: "vn-sus/C5-l0-r0.mp3", pitch: 72.042, layer: 0, rr: 0, gain: 0.3945, length: 3.002, mark: 0.0012, peak: 2.99, attack: 0.707, loop: [1.107, 2.5683, 0.15, 0.929], bytes: 65480, hash: "ba5aa156" },
      { file: "vn-sus/E5-l1-r0.mp3", pitch: 75.927, layer: 1, rr: 0, gain: 0.542, length: 3.002, mark: 0.0015, peak: 1.84, attack: 0.197, loop: [1.26, 2.6151, 0.15, 0.662], bytes: 73747, hash: "6b6f05d0" },
      { file: "vn-sus/E5-l0-r0.mp3", pitch: 76.047, layer: 0, rr: 0, gain: 0.4692, length: 3.002, mark: 0.0014, peak: 2.88, attack: 0.907, loop: [1.047, 2.619, 0.15, 0.472], bytes: 71325, hash: "f053d961" },
      { file: "vn-sus/G5-l1-r0.mp3", pitch: 78.993, layer: 1, rr: 0, gain: 0.5375, length: 3.002, mark: 0.002, peak: 2.44, attack: 0.597, loop: [1.497, 2.7651, 0.15, 0.519], bytes: 74433, hash: "c80e859a" },
      { file: "vn-sus/G5-l0-r0.mp3", pitch: 79.041, layer: 0, rr: 0, gain: 0.5018, length: 3.002, mark: 0.0009, peak: 2.5, attack: 1.237, loop: [1.557, 2.851, 0.15, 0.643], bytes: 72213, hash: "b59709e0" },
      { file: "vn-sus/B5-l1-r0.mp3", pitch: 82.99, layer: 1, rr: 0, gain: 0.5577, length: 3.002, mark: 0.0009, peak: 2.72, attack: 0.347, loop: [1.007, 2.6493, 0.15, 0.647], bytes: 67043, hash: "d141fb0a" },
      { file: "vn-sus/B5-l0-r0.mp3", pitch: 83.049, layer: 0, rr: 0, gain: 0.4536, length: 3.002, mark: 0.0014, peak: 2.95, attack: 1.157, loop: [1.257, 2.87, 0.15, 0.491], bytes: 69229, hash: "6c3a790f" },
      { file: "vn-sus/D6-l0-r0.mp3", pitch: 86.025, layer: 0, rr: 0, gain: 0.4839, length: 3.002, mark: 0.0011, peak: 1.76, attack: 0.767, loop: [1.347, 2.8889, 0.15, 0.725], bytes: 69334, hash: "09511a4c" },
      { file: "vn-sus/D6-l1-r0.mp3", pitch: 86.081, layer: 1, rr: 0, gain: 0.5531, length: 3.002, mark: 0.0011, peak: 1.24, attack: 0.497, loop: [1.097, 2.7132, 0.15, 0.549], bytes: 60810, hash: "14b2545b" },
    ],
  },
  /** 小提琴组，颤弓 */
  "vn.trem": {
    kind: "sustain",
    stereo: true,
    zones: [
      { file: "vn-trem/G3-l0-r0.mp3", pitch: 55.049, layer: 0, rr: 0, gain: 1.4463, length: 2.602, mark: 0.0015, peak: 0.25, attack: 0.047, loop: [0.5, 1.6244, 0.1, 0.731], bytes: 53064, hash: "10ac071a" },
      { file: "vn-trem/A3-l0-r0.mp3", pitch: 56.959, layer: 0, rr: 0, gain: 0.8819, length: 2.602, mark: 0.002, peak: 0.44, attack: 0.047, loop: [0.5, 2.2956, 0.1, 0.808], bytes: 60674, hash: "eaa41427" },
      { file: "vn-trem/B3-l0-r0.mp3", pitch: 58.944, layer: 0, rr: 0, gain: 0.7842, length: 2.602, mark: 0.0016, peak: 0.44, attack: 0.107, loop: [0.54, 2.1976, 0.1, 0.659], bytes: 59474, hash: "4d7504ca" },
      { file: "vn-trem/D4-l0-r0.mp3", pitch: 61.879, layer: 0, rr: 0, gain: 1.0926, length: 2.602, mark: 0.0015, peak: 0.28, attack: 0.067, loop: [0.62, 2.2418, 0.1, 0.628], bytes: 57443, hash: "444952c4" },
      { file: "vn-trem/A4-l0-r0.mp3", pitch: 69.013, layer: 0, rr: 0, gain: 0.8352, length: 2.602, mark: 0.001, peak: 0.3, attack: 0.087, loop: [0.36, 2.5385, 0.1, 0.797], bytes: 58798, hash: "49eb0be4" },
      { file: "vn-trem/C5-l0-r0.mp3", pitch: 72.006, layer: 0, rr: 0, gain: 1.2378, length: 2.602, mark: 0.0014, peak: 0.22, attack: 0.077, loop: [0.76, 2.2358, 0.1, 0.769], bytes: 60461, hash: "2272161d" },
      { file: "vn-trem/E5-l0-r0.mp3", pitch: 76.01, layer: 0, rr: 0, gain: 0.6839, length: 2.602, mark: 0.002, peak: 0.23, attack: 0.067, loop: [0.62, 2.031, 0.1, 0.598], bytes: 65594, hash: "298977c6" },
      { file: "vn-trem/G5-l0-r0.mp3", pitch: 78.988, layer: 0, rr: 0, gain: 1.1288, length: 2.602, mark: 0.0015, peak: 0.24, attack: 0.047, loop: [0.5, 2.4493, 0.1, 0.631], bytes: 61169, hash: "1a7365cb" },
      { file: "vn-trem/B5-l0-r0.mp3", pitch: 83.048, layer: 0, rr: 0, gain: 1.1236, length: 2.602, mark: 0.0014, peak: 0.24, attack: 0.047, loop: [0.68, 1.7232, 0.1, 0.642], bytes: 53872, hash: "671ab8da" },
      { file: "vn-trem/D6-l0-r0.mp3", pitch: 86.091, layer: 0, rr: 0, gain: 0.5233, length: 2.602, mark: 0.0014, peak: 0.26, attack: 0.027, loop: [0.54, 1.8607, 0.1, 0.611], bytes: 60388, hash: "c6fca276" },
    ],
  },
};
