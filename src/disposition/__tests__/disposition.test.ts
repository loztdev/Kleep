import {
  NEUTRAL_DISPOSITION,
  confidenceFloor,
  mentionsRequired,
  withDefaults,
  worldBoostMultiplier,
} from "../types";

describe("DispositionMatrix — defaults & clamping", () => {
  it("withDefaults() returns neutral when nothing supplied", () => {
    expect(withDefaults()).toEqual(NEUTRAL_DISPOSITION);
    expect(withDefaults({})).toEqual(NEUTRAL_DISPOSITION);
  });

  it("clamps out-of-range values into [0, 1]", () => {
    expect(withDefaults({ skepticism: -1, literalism: 2 })).toEqual({
      skepticism: 0,
      literalism: 1,
    });
  });

  it("ignores NaN", () => {
    expect(withDefaults({ skepticism: NaN }).skepticism).toBe(0);
  });
});

describe("confidenceFloor", () => {
  it("is 0 at neutral skepticism", () => {
    expect(confidenceFloor(NEUTRAL_DISPOSITION)).toBe(0);
  });

  it("scales to 0.6 at full skepticism", () => {
    expect(confidenceFloor({ skepticism: 1, literalism: 0 })).toBeCloseTo(
      0.6,
    );
  });

  it("is linear in skepticism", () => {
    expect(confidenceFloor({ skepticism: 0.5, literalism: 0 })).toBeCloseTo(
      0.3,
    );
  });
});

describe("mentionsRequired", () => {
  it("is 1 at neutral skepticism", () => {
    expect(mentionsRequired(NEUTRAL_DISPOSITION)).toBe(1);
  });

  it("is 4 at full skepticism", () => {
    expect(mentionsRequired({ skepticism: 1, literalism: 0 })).toBe(4);
  });

  it("rounds up", () => {
    expect(mentionsRequired({ skepticism: 0.26, literalism: 0 })).toBe(2);
  });

  it("never returns less than 1", () => {
    expect(mentionsRequired({ skepticism: 0, literalism: 0 })).toBe(1);
  });
});

describe("worldBoostMultiplier", () => {
  it("is 1 at neutral literalism (no boost)", () => {
    expect(worldBoostMultiplier(NEUTRAL_DISPOSITION)).toBe(1);
  });

  it("is 3 at full literalism", () => {
    expect(worldBoostMultiplier({ skepticism: 0, literalism: 1 })).toBe(3);
  });

  it("is 2 at half literalism", () => {
    expect(worldBoostMultiplier({ skepticism: 0, literalism: 0.5 })).toBe(2);
  });
});
