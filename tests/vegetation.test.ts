import { describe, expect, it } from "vitest";
import { generateTreeSkeleton, type TreePoint } from "../app/game/vegetation";

const distance = (a: TreePoint, b: TreePoint): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe("connected low-poly tree generation", () => {
  it("builds a continuous tapered trunk with varied branch orientations", () => {
    const tree = generateTreeSkeleton(42, 1);
    expect(tree.trunk).toHaveLength(3);
    expect(distance(tree.trunk[0].end, tree.trunk[1].start)).toBeCloseTo(0);
    expect(distance(tree.trunk[1].end, tree.trunk[2].start)).toBeCloseTo(0);
    expect(tree.branches).toHaveLength(7);
    const directions = tree.branches.map(({ segments }) => Math.atan2(
      segments[1].end.z - segments[0].start.z,
      segments[1].end.x - segments[0].start.x,
    ));
    expect(new Set(directions.map((angle) => angle.toFixed(2))).size).toBeGreaterThanOrEqual(6);
  });

  it("attaches every secondary twig and foliage cluster to its parent branch", () => {
    const tree = generateTreeSkeleton(9_731, 1.2);
    for (const branch of tree.branches) {
      expect(distance(branch.segments[0].end, branch.segments[1].start)).toBeCloseTo(0);
      expect(distance(branch.foliage[0].position, branch.segments[1].end)).toBeCloseTo(0);
      expect(distance(branch.foliage[1].position, branch.twigs[0].end)).toBeCloseTo(0);
      expect(distance(branch.foliage[2].position, branch.twigs[1].end)).toBeCloseTo(0);
      for (const twig of branch.twigs) {
        const parent = branch.segments[1];
        const parentLength = distance(parent.start, parent.end);
        expect(distance(parent.start, twig.start)).toBeLessThan(parentLength);
        expect(distance(twig.start, parent.end)).toBeLessThan(parentLength);
      }
    }
  });

  it("creates distinct silhouettes for different seeds", () => {
    const first = generateTreeSkeleton(100, 1);
    const second = generateTreeSkeleton(101, 1);
    const silhouetteDifference = first.branches.reduce((total, branch, index) => (
      total + distance(branch.segments[1].end, second.branches[index].segments[1].end)
    ), distance(first.trunk[2].end, second.trunk[2].end));
    expect(silhouetteDifference).toBeGreaterThan(1);
  });
});
