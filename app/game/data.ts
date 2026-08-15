export const ITEM_IDS = [
  "madeira",
  "fibra",
  "fruta",
  "erva",
  "cristal",
  "carne-crua",
  "carne-cozida",
  "agua",
  "corda",
  "bandagem",
  "antidoto",
  "lança",
  "machado",
  "arco",
  "flecha",
  "kit-reparo",
] as const;

export type ItemId = (typeof ITEM_IDS)[number];

export interface ItemDefinition {
  readonly id: ItemId;
  readonly name: string;
  readonly icon: string;
  readonly description: string;
}

export const ITEMS: Readonly<Record<ItemId, ItemDefinition>> = {
  madeira: { id: "madeira", name: "Madeira dorsal", icon: "╱╲", description: "Leve, flexível e salgada." },
  fibra: { id: "fibra", name: "Fibra de musgo", icon: "≋", description: "Serve para amarrar e filtrar." },
  fruta: { id: "fruta", name: "Fruta de sal", icon: "●", description: "Recupera um pouco de fome e sede." },
  erva: { id: "erva", name: "Erva-lúmen", icon: "✦", description: "Planta antisséptica rara." },
  cristal: { id: "cristal", name: "Cristal neural", icon: "♦", description: "Poderoso, mas ligado ao colosso." },
  "carne-crua": { id: "carne-crua", name: "Carne crua", icon: "◒", description: "Nutritiva, com risco de infecção." },
  "carne-cozida": { id: "carne-cozida", name: "Carne cozida", icon: "◉", description: "Uma refeição segura e quente." },
  agua: { id: "agua", name: "Água filtrada", icon: "◌", description: "Recupera a sede." },
  corda: { id: "corda", name: "Corda", icon: "∞", description: "Base para ferramentas e estruturas." },
  bandagem: { id: "bandagem", name: "Bandagem", icon: "+", description: "Trata ferimentos leves." },
  antidoto: { id: "antidoto", name: "Antídoto", icon: "ϟ", description: "Combate infecções." },
  lança: { id: "lança", name: "Lança", icon: "↟", description: "Precisa, longa e arremessável." },
  machado: { id: "machado", name: "Machado", icon: "⚒", description: "Golpe pesado e corte eficiente." },
  arco: { id: "arco", name: "Arco", icon: ")", description: "Mantém predadores alados à distância." },
  flecha: { id: "flecha", name: "Flecha", icon: "↑", description: "Munição improvisada." },
  "kit-reparo": { id: "kit-reparo", name: "Kit de reparo", icon: "⌁", description: "Restaura estruturas danificadas." },
};

export interface RecipeDefinition {
  readonly id: string;
  readonly name: string;
  readonly output: Readonly<Partial<Record<ItemId, number>>>;
  readonly cost: Readonly<Partial<Record<ItemId, number>>>;
  readonly station?: "fogueira" | "bancada";
}

export const RECIPES: readonly RecipeDefinition[] = [
  { id: "corda", name: "Corda", output: { corda: 1 }, cost: { fibra: 3 } },
  { id: "lança", name: "Lança", output: { lança: 1 }, cost: { madeira: 3, corda: 1 } },
  { id: "machado", name: "Machado", output: { machado: 1 }, cost: { madeira: 3, cristal: 1, corda: 1 }, station: "bancada" },
  { id: "arco", name: "Arco", output: { arco: 1 }, cost: { madeira: 2, corda: 2 }, station: "bancada" },
  { id: "flechas", name: "Flechas ×5", output: { flecha: 5 }, cost: { madeira: 1, fibra: 1 } },
  { id: "bandagem", name: "Bandagem", output: { bandagem: 1 }, cost: { fibra: 2, erva: 1 } },
  { id: "antidoto", name: "Antídoto", output: { antidoto: 1 }, cost: { erva: 2, agua: 1 } },
  { id: "comida", name: "Carne cozida", output: { "carne-cozida": 1 }, cost: { "carne-crua": 1, madeira: 1 }, station: "fogueira" },
  { id: "kit-reparo", name: "Kit de reparo", output: { "kit-reparo": 1 }, cost: { madeira: 2, fibra: 2 }, station: "bancada" },
] as const;

export const STRUCTURE_IDS = ["fogueira", "coletor", "bancada", "bau", "abrigo", "cerca", "armadilha", "balista"] as const;
export type StructureId = (typeof STRUCTURE_IDS)[number];

export interface StructureDefinition {
  readonly id: StructureId;
  readonly name: string;
  readonly cost: Readonly<Partial<Record<ItemId, number>>>;
  readonly weight: number;
  readonly description: string;
}

export const STRUCTURES: readonly StructureDefinition[] = [
  { id: "fogueira", name: "Fogueira", cost: { madeira: 4 }, weight: 2, description: "Aquece, cozinha e afasta ameaças." },
  { id: "coletor", name: "Coletor de chuva", cost: { madeira: 3, fibra: 3 }, weight: 3, description: "Gera água durante a chuva." },
  { id: "bancada", name: "Bancada", cost: { madeira: 5, corda: 1 }, weight: 5, description: "Libera ferramentas avançadas." },
  { id: "bau", name: "Baú", cost: { madeira: 4, fibra: 1 }, weight: 4, description: "Protege recursos durante o mergulho." },
  { id: "abrigo", name: "Abrigo", cost: { madeira: 7, fibra: 4 }, weight: 8, description: "Permite descansar e reduz exposição." },
  { id: "cerca", name: "Cerca", cost: { madeira: 3 }, weight: 3, description: "Bloqueia parasitas por pouco tempo." },
  { id: "armadilha", name: "Armadilha", cost: { madeira: 2, fibra: 2 }, weight: 2, description: "Fere e atordoa um inimigo." },
  { id: "balista", name: "Balista", cost: { madeira: 8, corda: 3, cristal: 1 }, weight: 10, description: "Defesa pesada para a infestação." },
] as const;

export const getRecipe = (id: string): RecipeDefinition | undefined => RECIPES.find((recipe) => recipe.id === id);
export const getStructure = (id: StructureId): StructureDefinition => {
  const definition = STRUCTURES.find((structure) => structure.id === id);
  if (!definition) throw new Error(`Estrutura desconhecida: ${id}`);
  return definition;
};

export const formatCost = (cost: Readonly<Partial<Record<ItemId, number>>>): string =>
  ITEM_IDS.flatMap((id) => {
    const amount = cost[id];
    return amount ? [`${amount} ${ITEMS[id].name}`] : [];
  }).join(" · ");
