// 界面字符串（en）：配乐与环境声。与 zh-CN.audio.ts 的键一一对应。
import type { Translation } from "./translation";
import type { audio as zh } from "./zh-CN.audio";

export const audio: Translation<typeof zh> = {
  musicToggle: "Music",
  musicOn: "Music on. Click to mute",
  musicOff: "Music off. Click to play",
  musicNow: "Now playing: {title}",
  musicResting: "{title} (pause between plays)",
  musicWaiting: "Click anywhere to start the music",
  musicOrchestral: "orchestral",
  musicSynth: "retro synth",
  musicStyleTag: "{line} · {style}",
  stSound: "Sound",
  stMusicVolume: "Music volume",
  stAmbienceVolume: "Ambience volume (waves, wind, rain)",
  stSfxVolume: "Sound effects volume",
  stMute: "Mute",
  stBackground: "Keep playing in the background",
  stStyle: "Music style",
  stStyleOrchestral: "Orchestral (real instruments)",
  stStyleSynth: "Retro synth",
  stStyleLoading: "Loading the orchestral samples… the retro synth plays until they are ready.",
  stTrack: "Track",
  stTrackAuto: "Follow the scene",
  stSoundHelp:
    "Two music styles: Orchestral uses recordings of real instruments (the public-domain VSCO 2 orchestral sample library), downloaded as needed; Retro synth is synthesized live. Each culture's ports have their own tune, as do the seas by region, storms and sea battles; ambience is always synthesized. Sound effects are public-domain recordings (Kenney sound packs). Mute silences the sound effects too; to turn off only the music, drag the music volume to 0. Saved on this device only; takes effect at once.",
};
