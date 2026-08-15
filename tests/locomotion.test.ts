import { describe, expect, it } from "vitest";
import { characterLateralAxis, footSurfaceAlignment, solveLegIK, supportPelvisDrop } from "../app/game/locomotion";

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

  it("keeps both ankle axes neutral on flat ground", () => {
    const alignment = footSurfaceAlignment({ normalX: 0, normalY: 1, normalZ: 0, forwardX: 0, forwardZ: 1 });
    expect(alignment.pitch).toBeCloseTo(0);
    expect(alignment.roll).toBeCloseTo(0);
  });

  it("keeps anatomical left and right independent from camera-relative strafe controls", () => {
    const facingNorth = characterLateralAxis(0, 1);
    expect(facingNorth.x).toBeCloseTo(1);
    expect(facingNorth.z).toBeCloseTo(0);

    const facingEast = characterLateralAxis(1, 0);
    expect(facingEast.x).toBeCloseTo(0);
    expect(facingEast.z).toBeCloseTo(-1);
  });

  it("raises the toe when the terrain climbs in front of the character", () => {
    const slope = Math.PI / 6;
    const alignment = footSurfaceAlignment({
      normalX: 0,
      normalY: Math.cos(slope),
      normalZ: -Math.sin(slope),
      forwardX: 0,
      forwardZ: 1,
    });
    expect(alignment.pitch).toBeCloseTo(-slope);
    expect(alignment.roll).toBeCloseTo(0);
  });

  it("converts a lateral slope into ankle roll for any heading", () => {
    const slope = Math.PI / 7;
    const facingNorth = footSurfaceAlignment({
      normalX: -Math.sin(slope), normalY: Math.cos(slope), normalZ: 0, forwardX: 0, forwardZ: 1,
    });
    const facingEast = footSurfaceAlignment({
      normalX: 0, normalY: Math.cos(slope), normalZ: Math.sin(slope), forwardX: 1, forwardZ: 0,
    });
    expect(facingNorth.roll).toBeCloseTo(slope);
    expect(facingEast.roll).toBeCloseTo(slope);
  });
});
