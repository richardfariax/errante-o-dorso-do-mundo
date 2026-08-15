import { getRecipe, getStructure, ITEM_IDS, type ItemId, type StructureId } from "./data";

export const SAVE_VERSION = 1;
export const EVENT_TIMES = {
  rain: 150,
  dive: 330,
  diveLoss: 372,
  divePeak: 390,
  infestation: 540,
  alpha: 650,
  encounter: 840,
  victory: 900,
} as const;

export type WeaponId = "improvisada" | "lança" | "machado" | "arco";
export type EventId = "despertar" | "chuva" | "mergulho" | "infestacao" | "encontro" | "conclusao";
export type WeatherId = "limpo" | "chuva" | "tempestade";

export interface PlayerStats {
  health: number;
  stamina: number;
  hunger: number;
  thirst: number;
  exposure: number;
  infection: number;
}

export interface SavedStructure {
  id: string;
  type: StructureId;
  x: number;
  z: number;
  rotation: number;
  health: number;
}

export interface GameState {
  version: typeof SAVE_VERSION;
  seed: number;
  elapsed: number;
  player: { x: number; z: number; rotation: number };
  stats: PlayerStats;
  inventory: Record<ItemId, number>;
  weapon: WeaponId;
  symbiosis: number;
  colossusHealth: number;
  event: EventId;
  weather: WeatherId;
  collectedResources: string[];
  structures: SavedStructure[];
  defeatedEnemies: string[];
  woundDecision: "undecided" | "healed" | "harvested";
  finalWaveRemaining: number;
  completed: boolean;
}

export interface ActionResult {
  readonly ok: boolean;
  readonly message: string;
}

const emptyInventory = (): Record<ItemId, number> =>
  Object.fromEntries(ITEM_IDS.map((id) => [id, 0])) as Record<ItemId, number>;

export function createNewGame(seed = Math.floor(Math.random() * 999_999)): GameState {
  const inventory = emptyInventory();
  inventory.fruta = 1;
  inventory.fibra = 1;
  return {
    version: SAVE_VERSION,
    seed,
    elapsed: 0,
    player: { x: 0, z: 107, rotation: Math.PI },
    stats: { health: 100, stamina: 100, hunger: 88, thirst: 84, exposure: 12, infection: 0 },
    inventory,
    weapon: "improvisada",
    symbiosis: 55,
    colossusHealth: 72,
    event: "despertar",
    weather: "limpo",
    collectedResources: [],
    structures: [],
    defeatedEnemies: [],
    woundDecision: "undecided",
    finalWaveRemaining: 0,
    completed: false,
  };
}

export function hasCost(inventory: Readonly<Record<ItemId, number>>, cost: Readonly<Partial<Record<ItemId, number>>>): boolean {
  return ITEM_IDS.every((id) => (inventory[id] ?? 0) >= (cost[id] ?? 0));
}

function spendCost(inventory: Record<ItemId, number>, cost: Readonly<Partial<Record<ItemId, number>>>): void {
  ITEM_IDS.forEach((id) => {
    inventory[id] -= cost[id] ?? 0;
  });
}

export function addItem(state: GameState, item: ItemId, amount: number): void {
  state.inventory[item] = Math.max(0, state.inventory[item] + amount);
}

export function craft(state: GameState, recipeId: string, stations: ReadonlySet<StructureId>): ActionResult {
  const recipe = getRecipe(recipeId);
  if (!recipe) return { ok: false, message: "Receita desconhecida." };
  if (recipe.station && !stations.has(recipe.station)) return { ok: false, message: `Requer ${recipe.station}.` };
  if (!hasCost(state.inventory, recipe.cost)) return { ok: false, message: "Faltam materiais." };
  spendCost(state.inventory, recipe.cost);
  ITEM_IDS.forEach((id) => {
    state.inventory[id] += recipe.output[id] ?? 0;
  });
  if (recipe.id === "lança") state.weapon = "lança";
  if (recipe.id === "machado") state.weapon = "machado";
  if (recipe.id === "arco") state.weapon = "arco";
  return { ok: true, message: `${recipe.name} fabricado.` };
}

export function placeStructure(
  state: GameState,
  type: StructureId,
  position: { x: number; z: number; rotation: number },
): ActionResult {
  const definition = getStructure(type);
  if (!hasCost(state.inventory, definition.cost)) return { ok: false, message: "Faltam materiais para construir." };
  const totalWeight = state.structures.reduce((sum, structure) => sum + getStructure(structure.type).weight, 0);
  const capacity = 36 + Math.round(state.symbiosis * 0.24);
  if (totalWeight + definition.weight > capacity) return { ok: false, message: "O dorso não suporta mais peso aqui." };
  spendCost(state.inventory, definition.cost);
  state.structures.push({
    id: `${type}-${Math.round(state.elapsed * 1000)}-${state.structures.length}`,
    type,
    x: position.x,
    z: position.z,
    rotation: position.rotation,
    health: 100,
  });
  state.symbiosis = Math.max(0, state.symbiosis - definition.weight * 0.12);
  return { ok: true, message: `${definition.name} construída.` };
}

export function dismantleStructure(state: GameState, structureId: string): ActionResult {
  const index = state.structures.findIndex((structure) => structure.id === structureId);
  if (index < 0) return { ok: false, message: "Estrutura não encontrada." };
  const [structure] = state.structures.splice(index, 1);
  const definition = getStructure(structure.type);
  ITEM_IDS.forEach((id) => {
    state.inventory[id] += Math.floor((definition.cost[id] ?? 0) * 0.75);
  });
  state.symbiosis = Math.min(100, state.symbiosis + definition.weight * 0.06);
  return { ok: true, message: `${definition.name} desmontada; 75% dos materiais recuperados.` };
}

export function consume(state: GameState, item: ItemId): ActionResult {
  if (state.inventory[item] <= 0) return { ok: false, message: "Item indisponível." };
  if (item === "fruta") {
    state.stats.hunger = Math.min(100, state.stats.hunger + 18);
    state.stats.thirst = Math.min(100, state.stats.thirst + 10);
  } else if (item === "agua") state.stats.thirst = Math.min(100, state.stats.thirst + 42);
  else if (item === "carne-cozida") state.stats.hunger = Math.min(100, state.stats.hunger + 45);
  else if (item === "carne-crua") {
    state.stats.hunger = Math.min(100, state.stats.hunger + 25);
    state.stats.infection = Math.min(100, state.stats.infection + 24);
  } else if (item === "bandagem") {
    state.stats.health = Math.min(100, state.stats.health + 28);
    state.stats.infection = Math.max(0, state.stats.infection - 8);
  } else if (item === "antidoto") state.stats.infection = Math.max(0, state.stats.infection - 55);
  else return { ok: false, message: "Este item não é consumível." };
  state.inventory[item] -= 1;
  return { ok: true, message: "Item usado." };
}

export function decideWound(state: GameState, decision: "healed" | "harvested"): ActionResult {
  if (state.woundDecision !== "undecided") return { ok: false, message: "A ferida já foi alterada." };
  if (decision === "healed") {
    if (state.inventory.erva < 2 || state.inventory.bandagem < 1) return { ok: false, message: "Requer 2 ervas e 1 bandagem." };
    state.inventory.erva -= 2;
    state.inventory.bandagem -= 1;
    state.symbiosis = Math.min(100, state.symbiosis + 25);
    state.colossusHealth = Math.min(100, state.colossusHealth + 22);
  } else {
    addItem(state, "cristal", 5);
    addItem(state, "carne-crua", 2);
    state.symbiosis = Math.max(0, state.symbiosis - 28);
    state.colossusHealth = Math.max(0, state.colossusHealth - 18);
  }
  state.woundDecision = decision;
  return {
    ok: true,
    message: decision === "healed" ? "A pulsação se acalma. O dorso aceita seu cuidado." : "Recursos raros extraídos. O colosso recua sob seus pés.",
  };
}

export function tickSurvival(state: GameState, delta: number, sheltered: boolean, nearFire: boolean): void {
  state.elapsed += delta;
  state.stats.hunger = Math.max(0, state.stats.hunger - delta * 0.055);
  state.stats.thirst = Math.max(0, state.stats.thirst - delta * (state.weather === "chuva" ? 0.045 : 0.075));
  const exposureDelta = state.weather === "chuva" || state.weather === "tempestade" ? 0.14 : -0.1;
  state.stats.exposure = Math.min(100, Math.max(0, state.stats.exposure + delta * (sheltered ? -0.24 : nearFire ? -0.36 : exposureDelta)));
  if (state.stats.infection > 0) state.stats.infection = Math.min(100, state.stats.infection + delta * 0.025);
  const critical = state.stats.hunger <= 0 || state.stats.thirst <= 0 || state.stats.exposure >= 100 || state.stats.infection >= 100;
  if (critical) state.stats.health = Math.max(0, state.stats.health - delta * 2.2);
}

export function deriveEvent(state: GameState): EventId {
  if (state.completed) return "conclusao";
  if (state.elapsed >= EVENT_TIMES.encounter) return "encontro";
  if (state.elapsed >= EVENT_TIMES.infestation) return "infestacao";
  if (state.elapsed >= EVENT_TIMES.dive) return "mergulho";
  if (state.elapsed >= EVENT_TIMES.rain) return "chuva";
  return "despertar";
}

export function objectiveFor(state: Readonly<GameState>): string {
  if (state.completed) return "A jornada continua além da neblina.";
  if (state.event === "encontro") return "Alcance a crista óssea e encare a neblina.";
  if (state.event === "infestacao" && state.finalWaveRemaining > 0) return `Defenda a ferida: ${state.finalWaveRemaining} parasitas restantes.`;
  if (state.event === "mergulho") return "Suba para as cristas. Recursos fora de um baú serão arrastados.";
  if (state.event === "chuva" && !state.structures.some((structure) => structure.type === "coletor")) return "Construa um coletor antes que a frente de chuva passe.";
  if (state.elapsed < 18 && state.collectedResources.length === 0) return "Encontre gravetos junto à fogueira apagada.";
  if (state.inventory.lança === 0 && state.inventory.machado === 0) return "Colete madeira e fibras. Fabrique uma lança.";
  if (state.woundDecision === "undecided") return "Investigue a pulsação vermelha na Ferida Antiga.";
  if (!state.structures.some((structure) => structure.type === "coletor")) return "Construa um coletor antes que a chuva chegue.";
  return "Prepare defesas e explore as ruínas presas ao casco.";
}

export function cloneState(state: Readonly<GameState>): GameState {
  return {
    ...state,
    player: { ...state.player },
    stats: { ...state.stats },
    inventory: { ...state.inventory },
    collectedResources: [...state.collectedResources],
    structures: state.structures.map((structure) => ({ ...structure })),
    defeatedEnemies: [...state.defeatedEnemies],
  };
}
