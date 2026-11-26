// UI strings (en): new UI phase 2 — system (settings, tutorial bubbles, error recovery). Keys start with v2.system.
// 与 zh-CN.v2-system.ts 一一对应。
import type { Translation } from "./translation";
import type { v2System as zh } from "./zh-CN.v2-system";

export const v2System: Translation<typeof zh> = {
  "v2.system.retry": "Try again",
  "v2.system.st.instant": "Applies at once · this device only",
  "v2.system.st.dirty": "Unsaved changes",
  "v2.system.st.clean": "Display and sound apply at once; other changes apply when you save",
  "v2.system.st.more": "Show details",
  "v2.system.st.daylightHelp":
    "Follow the clock: the port view, sea chart and voyage scene are tinted for dawn, day, dusk and night, and windows and street lamps light up after dark; at 4× and faster the view stays in daylight to avoid flicker. Always day: the view stays in daylight while the clock keeps running.",
  "v2.system.st.uiSkinHelp":
    "Chart room: a dark navy frame around paper panels, with larger type and buttons that work well on phones. Classic pixel: the wood-and-pixel interface from before the redesign. Looks only — gameplay and saves are untouched.",
  "v2.system.st.soundHelp":
    "Two music styles: Orchestral uses recordings of real instruments (the public-domain VSCO 2 orchestral sample library), downloaded as needed; Retro synth is synthesized live. Each culture's ports have their own tune, as do the seas by region, storms and sea battles; ambience is always synthesized. Sound effects are public-domain recordings (Kenney sound packs). Mute silences the sound effects too; to turn off only the music, drag the music volume to 0.",
  "v2.system.panelErrorFix": "Try again to redraw it. If that fails, close and reopen this window.",
};
