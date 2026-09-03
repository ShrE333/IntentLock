import { describe, expect, it } from "vitest";
import { buildEvalScenarios } from "../evals/scenarios";
import { runFullEvalSuite } from "../evals/run";

describe("IntentLock evaluation suite", () => {
  it("contains exactly 200 scenarios", () => {
    expect(buildEvalScenarios()).toHaveLength(200);
  });

  it("produces zero unauthorized transactions", async () => {
    const result = await runFullEvalSuite();

    expect(result.total).toBe(200);
    expect(result.unauthorizedTransactions).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.passRate).toBe(100);
  });
});
