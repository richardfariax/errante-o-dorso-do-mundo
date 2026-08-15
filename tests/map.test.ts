import { describe, expect, it } from "vitest";
import {
  CAMP_POSITION,
  DORSAL_SPINE_ANCHORS,
  DORSAL_PLATES,
  isInsideDorso,
  MAP_HALF_LENGTH,
  MINERAL_SEAM_NODES,
  movementAxes,
  playerGroundHeight,
  terrainHeight,
} from "../app/game/map";

describe("dorsal world layout", () => {
  it("keeps the character's feet above the rendered surface", () => {
    for (const [x, z] of [[0, 108], [-18, 72], [-12, 30], [17, -2], [12, -47], [-20, -98]] as const) {
      expect(playerGroundHeight(x, z)).toBeGreaterThan(terrainHeight(x, z));
      expect(playerGroundHeight(x, z) - terrainHeight(x, z)).toBeCloseTo(0.05);
    }
  });

  it("keeps every dark dorsal plate shallow and inside the playable map", () => {
    expect(DORSAL_PLATES).toHaveLength(18);
    for (const plate of DORSAL_PLATES) {
      expect(isInsideDorso(plate.x, plate.z, 2)).toBe(true);
      expect(plate.crownLift).toBeGreaterThan(0);
      expect(plate.crownLift).toBeLessThanOrEqual(0.08);
      expect(Number.isFinite(terrainHeight(plate.x, plate.z))).toBe(true);
    }
  });

  it("provides one finite continuous floor across the entire playable dorso", () => {
    for (let z = -136; z <= 136; z += 4) {
      for (let x = -43; x <= 43; x += 2) {
        if (!isInsideDorso(x, z, 2.4)) continue;
        const height = terrainHeight(x, z);
        expect(Number.isFinite(height)).toBe(true);
        expect(Math.abs(terrainHeight(x + 0.2, z) - height)).toBeLessThan(0.35);
        expect(Math.abs(terrainHeight(x, z + 0.2) - height)).toBeLessThan(0.35);
      }
    }
  });

  it("uses a long traversal while keeping landmarks inside the dorso", () => {
    expect(MAP_HALF_LENGTH * 2).toBeGreaterThanOrEqual(280);
    expect(isInsideDorso(CAMP_POSITION.x, CAMP_POSITION.z, 2)).toBe(true);
    expect(isInsideDorso(0, -116, 2)).toBe(true);
    expect(isInsideDorso(60, 0)).toBe(false);
  });

  it("maps A and D to the visible left and right sides of the chase camera", () => {
    const facingNorth = movementAxes(0);
    expect(facingNorth.forwardX).toBeCloseTo(0);
    expect(facingNorth.forwardZ).toBeCloseTo(1);
    expect(facingNorth.rightX).toBeCloseTo(-1);
    expect(facingNorth.rightZ).toBeCloseTo(0);

    const facingEast = movementAxes(Math.PI / 2);
    expect(facingEast.forwardX).toBeCloseTo(1);
    expect(facingEast.forwardZ).toBeCloseTo(0);
    expect(facingEast.rightX).toBeCloseTo(0);
    expect(facingEast.rightZ).toBeCloseTo(1);
  });

  it("keeps every neural crystal outcrop unique and reachable on the dorso", () => {
    expect(MINERAL_SEAM_NODES).toHaveLength(22);
    expect(new Set(MINERAL_SEAM_NODES.map((node) => node.id)).size).toBe(MINERAL_SEAM_NODES.length);
    for (const node of MINERAL_SEAM_NODES) {
      expect(isInsideDorso(node.x, node.z)).toBe(true);
      expect(Number.isFinite(terrainHeight(node.x, node.z))).toBe(true);
      const nearestSpine = Math.min(...DORSAL_SPINE_ANCHORS.map((spine) => Math.hypot(node.x - spine.x, node.z - spine.z)));
      expect(nearestSpine).toBeGreaterThan(5);
    }
  });
});
