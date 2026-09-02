export interface CompactionInvariants {
  /** 1. High level goal of your build spec */
  highLevelGoal: string;

  /** 2. Current architecture and data flow */
  currentArchitecture: string;

  /** 3. What is already implemented and considered done */
  completedTasks: string[];

  /** 4. What is explicitly not done yet */
  openTasks: string[];

  /** 5. The next concrete task we are working on */
  nextConcreteTask: string;

  /** Optional active constraints to preserve in CURRENT.md */
  activeConstraints?: string[];

  /** Optional decisions or discoveries made during the session */
  decisionsMade?: string[];
}

export interface CompactionEvaluation {
  usedTokens: number;
  maxTokens: number;
  usagePercent: number;
  thresholdExceeded: boolean;
  prompt: string;
}

export interface HandoffResult {
  currentMdPath: string;
  invariants: CompactionInvariants;
  markdownContent: string;
  resumptionPrompt: string;
  timestamp: string;
}

export interface HarvestedMemory {
  id: string;
  type: "decision" | "fix" | "constraint" | "negative";
  title: string;
  content: string;
  source: string;
}
