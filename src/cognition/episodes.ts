/**
 * T-428: episodic causal narrative. Linear observations are grouped into
 * episodes (Goal → Hypothesis → Trajectory → Verification → Retrospective)
 * without inventing data: phases come from observation kind/text and
 * boundaries from session id, time gaps and a new goal.
 */

export type EpisodePhase = "goal" | "hypothesis" | "trajectory" | "verification" | "retrospective";

export interface EpisodeObservation {
  id?: string;
  session_id?: string;
  kind?: string;
  title?: string;
  text?: string;
  created_at?: string;
}

export interface Episode {
  id: string;
  session_id: string;
  goal?: string;
  hypothesis?: string;
  trajectory: string[];
  verification: string[];
  retrospective: string[];
  started_at: string;
  ended_at: string;
  observations: number;
}

const PHASE_PATTERNS: Array<[EpisodePhase, RegExp]> = [
  ["goal", /^\s*(goal|objective)\b/i],
  ["hypothesis", /^\s*(hypothes\w*|assum\w*|expect\w*|suspect\w*)/i],
  ["retrospective", /^\s*(retro\w*|lesson\w*|takeaway\w*|postmortem\w*)/i],
  ["verification", /^\s*(verif\w*|assert\w*|test\w*|result\w*)/i],
];

export function classifyPhase(observation: EpisodeObservation): EpisodePhase {
  const kind = String(observation.kind ?? "").toLowerCase();
  if (/verif|test|assert|result/.test(kind)) return "verification";
  if (/goal|objective|plan/.test(kind)) return "goal";
  if (/retro|lesson|postmortem/.test(kind)) return "retrospective";
  if (/hypothes|assum/.test(kind)) return "hypothesis";
  const haystack = `${observation.title ?? ""} ${observation.text ?? ""}`;
  for (const [phase, pattern] of PHASE_PATTERNS) {
    if (pattern.test(haystack)) return phase;
  }
  return "trajectory";
}

function label(observation: EpisodeObservation): string {
  return (observation.title || observation.text || observation.kind || "observation").trim();
}

export interface BuildEpisodesOptions {
  gapMinutes?: number;
}

export function buildEpisodes(
  observations: EpisodeObservation[],
  options: BuildEpisodesOptions = {},
): Episode[] {
  const gapMs = (options.gapMinutes ?? 60) * 60_000;
  const bySession = new Map<string, EpisodeObservation[]>();
  for (const observation of observations) {
    if (!observation.created_at) continue;
    const session = observation.session_id || "unscoped";
    const bucket = bySession.get(session) || [];
    bucket.push(observation);
    bySession.set(session, bucket);
  }

  const episodes: Episode[] = [];
  for (const [session, bucket] of bySession) {
    let sequence = 0;
    const ordered = [...bucket].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    let current: Episode | null = null;
    let lastTime = 0;
    for (const observation of ordered) {
      const at = Date.parse(String(observation.created_at));
      const phase = classifyPhase(observation);
      const boundary =
        !current ||
        Number.isNaN(at) ||
        (lastTime > 0 && at - lastTime > gapMs) ||
        (phase === "goal" && (current.goal || current.trajectory.length > 0));

      if (boundary) {
        current = {
          id: `ep_${session}_${++sequence}`,
          session_id: session,
          trajectory: [],
          verification: [],
          retrospective: [],
          started_at: String(observation.created_at),
          ended_at: String(observation.created_at),
          observations: 0,
        };
        episodes.push(current);
      }

      const episode = current!;
      episode.observations += 1;
      episode.ended_at = String(observation.created_at);
      lastTime = Number.isNaN(at) ? lastTime : at;

      if (phase === "goal" && !episode.goal) episode.goal = label(observation);
      else if (phase === "hypothesis" && !episode.hypothesis) episode.hypothesis = label(observation);
      else if (phase === "verification") episode.verification.push(label(observation));
      else if (phase === "retrospective") episode.retrospective.push(label(observation));
      else episode.trajectory.push(label(observation));
    }
  }

  return episodes.sort((a, b) => a.started_at.localeCompare(b.started_at));
}

export function formatEpisode(episode: Episode): string {
  const lines = [`## ${episode.goal || "Episode"}`, `Session: ${episode.session_id}`];
  if (episode.hypothesis) lines.push(`Hypothesis: ${episode.hypothesis}`);
  if (episode.trajectory.length) lines.push("Trajectory:", ...episode.trajectory.map((item) => `- ${item}`));
  if (episode.verification.length) lines.push("Verification:", ...episode.verification.map((item) => `- ${item}`));
  if (episode.retrospective.length) lines.push("Retrospective:", ...episode.retrospective.map((item) => `- ${item}`));
  return lines.join("\n");
}
