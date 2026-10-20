export interface MutationSafetyOptions {
  allowDrastic?: boolean;
  minSafeFloor?: number;
}

export class MutationSafetyError extends Error {
  constructor(
    public readonly code: "ESUSPECT_SHRINK" | "ESUSPECT_EROSION",
    public readonly priorCount: number,
    public readonly newCount: number,
    public readonly additionsCount: number,
    message: string,
  ) {
    super(message);
    this.name = "MutationSafetyError";
  }
}

/**
 * Validates mutation safety before writing modified sets.
 * Prevents catastrophic shrinkage and slow erosion.
 */
export function verifyMutationSafety(
  priorCount: number,
  newCount: number,
  additionsCount: number,
  options?: MutationSafetyOptions,
): void {
  if (options?.allowDrastic) {
    return;
  }

  const floor = options?.minSafeFloor ?? 3;

  // Catastrophic shrink: dropping below minimum floor
  if (priorCount >= floor && newCount < floor) {
    throw new MutationSafetyError(
      "ESUSPECT_SHRINK",
      priorCount,
      newCount,
      additionsCount,
      `Mutation rejected: entry count reduced below floor (${newCount} < ${floor}, prior: ${priorCount})`,
    );
  }

  // Mass deletion check: dropping >50% of entries with 0 additions
  if (additionsCount === 0 && priorCount > 0) {
    const dropped = priorCount - newCount;
    if (dropped / priorCount > 0.5) {
      throw new MutationSafetyError(
        "ESUSPECT_SHRINK",
        priorCount,
        newCount,
        additionsCount,
        `Mutation rejected: mass deletion detected (${dropped}/${priorCount} dropped with 0 additions)`,
      );
    }
  }

  // Slow erosion check: dropping 2+ entries with 0 additions
  if (additionsCount === 0 && priorCount - newCount >= 2) {
    throw new MutationSafetyError(
      "ESUSPECT_EROSION",
      priorCount,
      newCount,
      additionsCount,
      `Mutation rejected: slow erosion detected (net drop of ${priorCount - newCount} entries with 0 additions)`,
    );
  }
}
