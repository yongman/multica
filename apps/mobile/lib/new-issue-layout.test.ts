import { describe, expect, it } from "vitest";
import { newIssueMentionMaxHeight } from "./new-issue-layout";

describe("new-issue keyboard layout budget", () => {
  it.each([64, 72, 96])(
    "reserves input space with 170dp available and a %idp footer",
    (footer) => {
      const suggestions = newIssueMentionMaxHeight(170, footer);
      expect(suggestions).toBeGreaterThanOrEqual(0);
      expect(170 - footer - suggestions).toBeGreaterThanOrEqual(64);
    },
  );

  it("uses the measured, wrapped footer height and updates after keyboard dismissal", () => {
    expect(newIssueMentionMaxHeight(240, 96)).toBe(80);
    expect(newIssueMentionMaxHeight(600, 96)).toBe(220);
  });

  it("hides suggestions when controls and input need the remaining space", () => {
    expect(newIssueMentionMaxHeight(120, 72)).toBe(0);
    expect(newIssueMentionMaxHeight(0, 0)).toBe(0);
  });
});
