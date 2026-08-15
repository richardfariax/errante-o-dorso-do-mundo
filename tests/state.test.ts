import { describe, expect, it } from "vitest";
import { craft, createNewGame, decideWound, deriveEvent, EVENT_TIMES, objectiveFor, placeStructure, tickSurvival } from "../app/game/state";
import { validateGameState } from "../app/game/save";
import { eventVisualState, weatherForEvent } from "../app/game/events";
import { calculateDamage, weaponRange } from "../app/game/combat";

describe("gameplay rules", () => {
  it("crafts through centralized recipes and spends the exact cost", () => {
    const state = createNewGame(42);
    state.inventory.madeira = 3;
    state.inventory.fibra = 3;
    expect(craft(state, "corda", new Set()).ok).toBe(true);
    expect(craft(state, "lança", new Set()).ok).toBe(true);
    expect(state.inventory).toMatchObject({ madeira: 0, fibra: 0, corda: 0, lança: 1 });
    expect(state.weapon).toBe("lança");
  });

  it("rejects recipes when a required station is absent", () => {
    const state = createNewGame(42);
    state.inventory.madeira = 20;
    state.inventory.fibra = 20;
    state.inventory.corda = 4;
    state.inventory.cristal = 4;
    expect(craft(state, "machado", new Set())).toEqual({ ok: false, message: "Requer bancada." });
  });

  it("connects wound choices to functional symbiosis consequences", () => {
    const healer = createNewGame(42);
    healer.inventory.erva = 2;
    healer.inventory.bandagem = 1;
    expect(decideWound(healer, "healed").ok).toBe(true);
    expect(healer.symbiosis).toBe(80);
    expect(healer.colossusHealth).toBe(94);

    const harvester = createNewGame(42);
    expect(decideWound(harvester, "harvested").ok).toBe(true);
    expect(harvester.inventory.cristal).toBe(5);
    expect(harvester.symbiosis).toBe(27);
    expect(harvester.colossusHealth).toBe(54);
  });

  it("enforces dorsal weight capacity", () => {
    const state = createNewGame(42);
    state.inventory.madeira = 999;
    state.inventory.fibra = 999;
    state.inventory.corda = 999;
    state.inventory.cristal = 999;
    let attempts = 0;
    while (placeStructure(state, "balista", { x: attempts, z: 0, rotation: 0 }).ok) attempts += 1;
    expect(attempts).toBeGreaterThan(0);
    expect(state.structures.length).toBe(attempts);
  });

  it("reduces survival needs gradually and applies weather exposure", () => {
    const state = createNewGame(42);
    state.weather = "chuva";
    tickSurvival(state, 60, false, false);
    expect(state.stats.hunger).toBeGreaterThan(80);
    expect(state.stats.thirst).toBeGreaterThan(75);
    expect(state.stats.exposure).toBeGreaterThan(18);
    expect(state.stats.health).toBe(100);
  });

  it("runs a fifteen-minute event arc and prioritizes urgent objectives", () => {
    const state = createNewGame(42);
    state.elapsed = EVENT_TIMES.infestation + 1;
    state.finalWaveRemaining = 7;
    state.event = deriveEvent(state);
    expect(state.event).toBe("infestacao");
    expect(objectiveFor(state)).toBe("Defenda a ferida: 7 parasitas restantes.");
    state.elapsed = EVENT_TIMES.encounter + 1;
    state.event = deriveEvent(state);
    expect(objectiveFor(state)).toBe("Alcance a crista óssea e encare a neblina.");
    expect(EVENT_TIMES.victory).toBeGreaterThanOrEqual(900);
  });

  it("derives weather and set-piece intensity from the event clock", () => {
    expect(weatherForEvent("mergulho")).toBe("tempestade");
    expect(eventVisualState(EVENT_TIMES.divePeak, "mergulho").diveProgress).toBe(1);
    expect(eventVisualState(EVENT_TIMES.encounter + 44, "encontro").encounterEmerge).toBe(1);
  });
});

describe("save validation", () => {
  it("recovers safely from malformed data", () => {
    const state = validateGameState({ version: 1, seed: Number.NaN, inventory: { madeira: -500 }, stats: { health: "broken" }, structures: [{ type: "unknown" }] });
    expect(state.version).toBe(1);
    expect(state.inventory.madeira).toBe(0);
    expect(state.stats.health).toBe(100);
    expect(state.structures).toEqual([]);
  });

  it("falls back when the format version is unsupported", () => {
    const state = validateGameState({ version: 99, completed: true });
    expect(state.version).toBe(1);
    expect(state.completed).toBe(false);
  });
});

describe("combat balance", () => {
  it("supports charged, aerial and thrown weapon rules", () => {
    expect(weaponRange("lança", true)).toBe(24);
    expect(calculateDamage({ weapon: "machado", target: "escavador", charged: true, aerial: true, targetBelowHalfHealth: false })).toBeCloseTo(76.57);
  });

  it("rewards precise weapons against armored dorsal ticks", () => {
    const knife = calculateDamage({ weapon: "improvisada", target: "carrapato", charged: false, aerial: false, targetBelowHalfHealth: false });
    const spear = calculateDamage({ weapon: "lança", target: "carrapato", charged: false, aerial: false, targetBelowHalfHealth: false });
    expect(spear).toBeGreaterThan(knife * 3);
  });
});
