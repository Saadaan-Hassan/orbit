import { describe, expect, it } from "vitest";

import { PROJECT_COLOR_PALETTE, getProjectColor } from "./project-color";

describe("getProjectColor", () => {
  it("is deterministic — the same project name always gets the same color", () => {
    expect(getProjectColor("Orbit")).toBe(getProjectColor("Orbit"));
    expect(getProjectColor("petrol-prices")).toBe(getProjectColor("petrol-prices"));
  });

  it("draws only from the 8-color palette", () => {
    for (const name of ["Orbit", "saadaan-portfolio", "mediformers", "", "a", "Project 123"]) {
      expect(PROJECT_COLOR_PALETTE).toContain(getProjectColor(name));
    }
  });

  it("gives different projects different colors most of the time", () => {
    // Not a strict guarantee (8 buckets, hash collisions are expected
    // eventually) — but these specific names should not all collapse to one
    // color, which would indicate the hash is broken (e.g. always returning 0).
    const colors = new Set(
      ["Orbit", "saadaan-portfolio", "mediformers", "petrol-prices"].map(getProjectColor),
    );
    expect(colors.size).toBeGreaterThan(1);
  });

  it("falls back to the last palette color for a null project name", () => {
    expect(getProjectColor(null)).toBe(PROJECT_COLOR_PALETTE[7]);
  });

  it("handles an empty string the same as null", () => {
    expect(getProjectColor("")).toBe(PROJECT_COLOR_PALETTE[7]);
  });
});
