import { describe, it, expect } from "vitest";
import snapshot from "./case-snapshot.json";
import { readDemoCase } from "./case";
import {
  beats,
  initialReplay,
  replayReducer,
  replayFacts,
  replayHash,
  cursorFromHash,
} from "./replay";

describe("public guided replay safety", () => {
  it("requires completed canonical evidence, rejects missing or altered money", () => {
    expect(readDemoCase()).not.toBeNull();
    expect(readDemoCase(null)).toBeNull();
    expect(readDemoCase({ ...snapshot, transactions: {} })).toBeNull();
    expect(
      readDemoCase({ ...snapshot, deal: { ...snapshot.deal, fee: "1" } }),
    ).toBeNull();
    expect(readDemoCase({ ...snapshot, executionStatus: "FAILED" })).toBeNull();
  });
  it("never reports funding/payment success while transaction is confirming", () => {
    for (let i = 0; i < beats.length; i++) {
      const facts = replayFacts(i),
        beat = beats[i];
      if (beat.step === 4 && beat.phase === 1) expect(facts.funded).toBe(false);
      if (beat.step === 5 && beat.phase === 1) expect(facts.paid).toBe(false);
      if (facts.completed)
        expect(facts.lenderWithdrawn && facts.supplierWithdrawn).toBe(true);
    }
  });
  it("reaches completion without looping and pause cancels scheduled ticks", () => {
    let state = replayReducer(initialReplay, { type: "play" });
    for (let i = 0; i < beats.length + 3; i++)
      state = replayReducer(state, { type: "tick" });
    expect(state).toEqual({
      cursor: beats.length - 1,
      playing: false,
      performing: false,
    });
    const paused = replayReducer(
      replayReducer(initialReplay, { type: "goto", step: 2 }),
      { type: "pause" },
    );
    expect(replayReducer(paused, { type: "tick" })).toEqual(paused);
    expect(replayReducer(state, { type: "restart" })).toEqual(initialReplay);
  });
  it("restores every checkpoint paused, rejects invalid hashes, allows direct navigation", () => {
    for (let i = 0; i < beats.length; i++) {
      expect(cursorFromHash(replayHash(i))).toBe(i);
      expect(
        replayReducer(initialReplay, { type: "restore", cursor: i }),
      ).toEqual({ cursor: i, playing: false, performing: false });
    }
    expect(cursorFromHash("#unknown/999")).toBe(0);
    expect(
      replayReducer(initialReplay, { type: "restore", cursor: -1 }),
    ).toEqual(initialReplay);
    const final = replayReducer(initialReplay, { type: "goto", step: 6 });
    expect(replayFacts(final.cursor)).toMatchObject({
      paid: true,
      completed: false,
      lenderWithdrawn: false,
    });
  });
});
