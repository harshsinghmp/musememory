/**
 * T-430: Ebbinghaus-style forgetting with utility reinforcement.
 *
 * Unverified candidates decay on a short half-life; confirmed memories use a
 * long one. Successful verification (for example a green test run) extends the
 * effective half-life instead of resetting the clock.
 */

export interface DecayInput {
  status?: string;
  verification?: { level?: string };
}

export interface DecayOptions {
  candidateHalfLifeDays?: number;
  confirmedHalfLifeDays?: number;
  floor?: number;
  reinforcement?: number;
}

export interface DecayResult {
  retention: number;
  halfLifeDays: number;
  unverified: boolean;
}

export function ebbinghausRetention(ageDays: number, halfLifeDays: number, floor = 0): number {
  if (ageDays <= 0) return 1;
  if (halfLifeDays <= 0) return floor;
  return Math.max(floor, Math.pow(0.5, ageDays / halfLifeDays));
}

export function computeRetention(
  entry: DecayInput,
  ageDays: number,
  options: DecayOptions = {},
): DecayResult {
  const candidate = entry.status === "candidate" && !entry.verification?.level;
  const baseHalfLife = candidate
    ? options.candidateHalfLifeDays ?? 7
    : options.confirmedHalfLifeDays ?? 90;
  const reinforcement = Math.max(0, options.reinforcement ?? 0);
  // A green verification extends the half-life; it does not rewind the age.
  const halfLifeDays = baseHalfLife * (1 + reinforcement);
  const retention = ebbinghausRetention(ageDays, halfLifeDays, options.floor ?? 0);
  return { retention, halfLifeDays, unverified: candidate };
}

export function sortByRetention<T extends DecayInput>(
  items: Array<{ entry: T; ageDays: number }>,
  options: DecayOptions = {},
): Array<{ entry: T; retention: number; unverified: boolean }> {
  return items
    .map(({ entry, ageDays }) => {
      const result = computeRetention(entry, ageDays, options);
      return { entry, retention: result.retention, unverified: result.unverified };
    })
    .sort((a, b) => b.retention - a.retention);
}
