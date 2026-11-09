import { describe, test, expect } from "bun:test";
import { buildEpisodes, classifyPhase, formatEpisode, episodesFromObservations } from "../src/cognition/episodes.ts";

describe("T-428: episodic causal narratives", () => {
  test("classifies observations into causal phases", () => {
    expect(classifyPhase({ title: "Goal: fix login" })).toBe("goal");
    expect(classifyPhase({ title: "Goal: test the login flow" })).toBe("goal");
    expect(classifyPhase({ text: "hypothesis: token expires early" })).toBe("hypothesis");
    expect(classifyPhase({ kind: "verification", text: "tests green" })).toBe("verification");
    expect(classifyPhase({ text: "retrospective: add a regression test" })).toBe("retrospective");
    expect(classifyPhase({ text: "edited auth.ts" })).toBe("trajectory");
    // Provenance is not an outcome: a failed test command is not a verification.
    expect(classifyPhase({ kind: "test", title: "Command failure: bun test" })).toBe("trajectory");
    expect(classifyPhase({ kind: "test", phase: "verification", title: "ignored text" })).toBe("verification");
  });

  test("groups per session and splits on a new goal or a long gap", () => {
    const episodes = buildEpisodes([
      { session_id: "s1", created_at: "2026-01-01T10:00:00Z", title: "Goal: fix login" },
      { session_id: "s1", created_at: "2026-01-01T10:01:00Z", text: "hypothesis: token expires early" },
      { session_id: "s1", created_at: "2026-01-01T10:02:00Z", text: "edited auth.ts" },
      { session_id: "s1", created_at: "2026-01-01T10:03:00Z", text: "verification: tests green" },
      { session_id: "s1", created_at: "2026-01-01T10:04:00Z", text: "retrospective: add regression" },
      { session_id: "s1", created_at: "2026-01-01T12:30:00Z", title: "Goal: fix logout" },
      { session_id: "s2", created_at: "2026-01-01T10:00:00Z", title: "Goal: other session" },
    ]);

    expect(episodes.length).toBe(3);
    const login = episodes.find((episode) => episode.goal === "Goal: fix login")!;
    const logout = episodes.find((episode) => episode.goal === "Goal: fix logout")!;
    const other = episodes.find((episode) => episode.session_id === "s2")!;
    expect(login.hypothesis).toContain("token expires");
    expect(login.trajectory).toContain("edited auth.ts");
    expect(login.verification).toContain("verification: tests green");
    expect(login.retrospective).toContain("retrospective: add regression");
    expect(logout.session_id).toBe("s1");
    expect(other.goal).toBe("Goal: other session");
    expect(formatEpisode(login)).toContain("## Goal: fix login");
  });

  test("episode ids are unique within a session", () => {
    const episodes = buildEpisodes(
      [
        { session_id: "s1", created_at: "2026-01-01T10:00:00Z", title: "Goal: one" },
        { session_id: "s1", created_at: "2026-01-01T10:00:00Z", title: "Goal: two" },
      ],
      { gapMinutes: 0 },
    );
    expect(episodes.length).toBe(2);
    expect(new Set(episodes.map((episode) => episode.id)).size).toBe(2);
  });

  test("maps persisted observations and honours metadata phases", () => {
    const episodes = episodesFromObservations([
      { id: "o1", timestamp: "2026-01-01T10:00:00Z", source: "manual", project: "p", summary: "Goal: fix login", raw: "auth", metadata: { session_id: "s1" } },
      { id: "o2", timestamp: "2026-01-01T10:01:00Z", source: "test", project: "p", summary: "Command failure: bun test", raw: "red", metadata: { session_id: "s1", phase: "verification" } },
    ]);
    expect(episodes.length).toBe(1);
    expect(episodes[0].goal).toBe("Goal: fix login");
    expect(episodes[0].verification).toContain("Command failure: bun test");
  });

  test("returns nothing for an empty or undated stream", () => {
    expect(buildEpisodes([])).toEqual([]);
    expect(buildEpisodes([{ title: "no timestamp" }])).toEqual([]);
  });
});
