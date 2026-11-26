// 全画面天气效果（components/WeatherScreen.tsx）此刻闪电的亮度：航海图上暴风雨海区的照亮（map/weatherLayer.ts）跟着它一起亮，
// 不各闪各的。只是模块里的一个数，每帧读一次，没有订阅。
let level = 0;

/** 全画面效果这一帧的闪电亮度 0..1（不闪时为 0）。 */
export function setScreenFlash(v: number): void {
  level = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
}

/** 全画面效果此刻的闪电亮度。 */
export function screenFlash(): number {
  return level;
}

let asked = 0;

/** 截图与调试用：让全画面效果下一帧就闪一次（仍然只在能闪的时候：暴风雨、开关开着、没有减少动态效果、4× 以下）。 */
export function requestFlash(): void {
  asked++;
}

/** 全画面效果每帧问一次：有没有新的“闪一次”请求（问过就清掉）。 */
export function takeFlashRequest(): boolean {
  const any = asked > 0;
  asked = 0;
  return any;
}
