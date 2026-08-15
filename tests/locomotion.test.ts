import { describe, expect, it } from "vitest";
import { solveLegIK, supportPelvisDrop } from "../app/game/locomotion";

describe("terrain-aware character locomotion", () => {
  it("bends the uphill knee and extends the downhill leg without tilting the body", () => {
    const uphillOffset = 0.12;
    const downhillOffset = -0.12;
    const pelvisDrop = supportPelvisDrop(uphillOffset, downhillOffset);
    const uphill = solveLegIK({ hipHeight: 1.08 + pelvisDrop, groundOffset: uphillOffset, forwardOffset: 0 });
    const downhill = solveLegIK({ hipHeight: 1.08 + pelvisDrop, groundOffset: downhillOffset, forwardOffset: 0 });

    expect(pelvisDrop).toBeLessThan(0);
    expect(uphill.kneeAngle).toBeGreaterThan(downhill.kneeAngle);
    expect(uphill.extension).toBeLessThan(downhill.extension);
    expect(downhill.extension).toBeGreaterThan(0.98);
  });

  it("keeps a flat planted stance nearly fully extended", () => {
    const planted = solveLegIK({ hipHeight: 1.08, groundOffset: 0, forwardOffset: 0 });
    expect(planted.kneeAngle).toBeLessThan(0.14);
    expect(planted.extension).toBeGreaterThan(0.995);
    expect(planted.hipAngle + planted.kneeAngle + planted.ankleCounterAngle).toBeCloseTo(0);
  });

  it("produces mirrored steps for left and right legs", () => {
    const left = solveLegIK({ hipHeight: 1.08, groundOffset: 0, forwardOffset: -0.3, swingLift: 0.1 });
    const right = solveLegIK({ hipHeight: 1.08, groundOffset: 0, forwardOffset: 0.3, swingLift: 0.1 });
    expect(left.kneeAngle).toBeCloseTo(right.kneeAngle);
    expect(left.hipAngle).not.toBeCloseTo(right.hipAngle);
  });
});
