import { ITEM_IDS, STRUCTURE_IDS } from "./data";
import { createNewGame, SAVE_VERSION, type EventId, type GameState, type WeatherId, type WeaponId } from "./state";

const SAVE_KEY = "errante.save.v1";
const SETTINGS_KEY = "errante.settings.v1";

export interface GameSettings {
  masterVolume: number;
  musicVolume: number;
  effectsVolume: number;
  ambientVolume: number;
  sensitivity: number;
  invertY: boolean;
  reducedShake: boolean;
  reducedColossusMotion: boolean;
  holdToSprint: boolean;
  textScale: number;
  quality: "low" | "medium" | "high";
  showSubtitles: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  masterVolume: 0.8,
  musicVolume: 0.55,
  effectsVolume: 0.8,
  ambientVolume: 0.72,
  sensitivity: 0.55,
  invertY: false,
  reducedShake: false,
  reducedColossusMotion: false,
  holdToSprint: true,
  textScale: 1,
  quality: "high",
  showSubtitles: true,
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown, fallback: number, minimum: number, maximum: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
const stringArray = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 1000) : [];

export function validateGameState(value: unknown): GameState {
  const fallback = createNewGame();
  if (!isRecord(value) || value.version !== SAVE_VERSION) return fallback;
  const rawInventory = isRecord(value.inventory) ? value.inventory : {};
  const inventory = { ...fallback.inventory };
  ITEM_IDS.forEach((id) => {
    inventory[id] = Math.floor(finite(rawInventory[id], 0, 0, 999));
  });
  const rawStats = isRecord(value.stats) ? value.stats : {};
  const rawPlayer = isRecord(value.player) ? value.player : {};
  const allowedWeapons: readonly WeaponId[] = ["improvisada", "lança", "machado", "arco"];
  const allowedEvents: readonly EventId[] = ["despertar", "chuva", "mergulho", "infestacao", "encontro", "conclusao"];
  const allowedWeather: readonly WeatherId[] = ["limpo", "chuva", "tempestade"];
  const structures = Array.isArray(value.structures) ? value.structures.flatMap((entry, index) => {
    if (!isRecord(entry) || typeof entry.type !== "string" || !STRUCTURE_IDS.includes(entry.type as (typeof STRUCTURE_IDS)[number])) return [];
    return [{
      id: typeof entry.id === "string" ? entry.id : `restored-${index}`,
      type: entry.type as (typeof STRUCTURE_IDS)[number],
      x: finite(entry.x, 0, -46, 46),
      z: finite(entry.z, 96, -140, 140),
      rotation: finite(entry.rotation, 0, -Math.PI * 2, Math.PI * 2),
      health: finite(entry.health, 100, 0, 100),
    }];
  }).slice(0, 80) : [];
  const woundDecision = value.woundDecision === "healed" || value.woundDecision === "harvested" ? value.woundDecision : "undecided";
  return {
    version: SAVE_VERSION,
    seed: Math.floor(finite(value.seed, fallback.seed, 1, 999_999_999)),
    elapsed: finite(value.elapsed, 0, 0, 50_000),
    player: {
      x: finite(rawPlayer.x, fallback.player.x, -46, 46),
      z: finite(rawPlayer.z, fallback.player.z, -140, 140),
      rotation: finite(rawPlayer.rotation, fallback.player.rotation, -Math.PI * 2, Math.PI * 2),
    },
    stats: {
      health: finite(rawStats.health, 100, 0, 100),
      stamina: finite(rawStats.stamina, 100, 0, 100),
      hunger: finite(rawStats.hunger, 88, 0, 100),
      thirst: finite(rawStats.thirst, 84, 0, 100),
      exposure: finite(rawStats.exposure, 12, 0, 100),
      infection: finite(rawStats.infection, 0, 0, 100),
    },
    inventory,
    weapon: typeof value.weapon === "string" && allowedWeapons.includes(value.weapon as WeaponId) ? value.weapon as WeaponId : "improvisada",
    symbiosis: finite(value.symbiosis, 55, 0, 100),
    colossusHealth: finite(value.colossusHealth, 72, 0, 100),
    event: typeof value.event === "string" && allowedEvents.includes(value.event as EventId) ? value.event as EventId : "despertar",
    weather: typeof value.weather === "string" && allowedWeather.includes(value.weather as WeatherId) ? value.weather as WeatherId : "limpo",
    collectedResources: stringArray(value.collectedResources),
    structures,
    defeatedEnemies: stringArray(value.defeatedEnemies),
    woundDecision,
    finalWaveRemaining: Math.floor(finite(value.finalWaveRemaining, 0, 0, 100)),
    completed: value.completed === true,
  };
}

export function saveGame(state: Readonly<GameState>): boolean {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function loadGame(): GameState | null {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    return raw ? validateGameState(JSON.parse(raw) as unknown) : null;
  } catch {
    window.localStorage.removeItem(SAVE_KEY);
    return null;
  }
}

export function hasSave(): boolean {
  try { return window.localStorage.getItem(SAVE_KEY) !== null; } catch { return false; }
}

export function saveSettings(settings: Readonly<GameSettings>): void {
  try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* preferences remain session-only */ }
}

export function loadSettings(): GameSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (!isRecord(value)) return DEFAULT_SETTINGS;
    return {
      masterVolume: finite(value.masterVolume, DEFAULT_SETTINGS.masterVolume, 0, 1),
      musicVolume: finite(value.musicVolume, DEFAULT_SETTINGS.musicVolume, 0, 1),
      effectsVolume: finite(value.effectsVolume, DEFAULT_SETTINGS.effectsVolume, 0, 1),
      ambientVolume: finite(value.ambientVolume, DEFAULT_SETTINGS.ambientVolume, 0, 1),
      sensitivity: finite(value.sensitivity, DEFAULT_SETTINGS.sensitivity, 0.1, 1.5),
      invertY: value.invertY === true,
      reducedShake: value.reducedShake === true,
      reducedColossusMotion: value.reducedColossusMotion === true,
      holdToSprint: value.holdToSprint !== false,
      textScale: finite(value.textScale, DEFAULT_SETTINGS.textScale, 0.85, 1.4),
      quality: value.quality === "low" || value.quality === "medium" || value.quality === "high" ? value.quality : DEFAULT_SETTINGS.quality,
      showSubtitles: value.showSubtitles !== false,
    };
  } catch { return DEFAULT_SETTINGS; }
}
