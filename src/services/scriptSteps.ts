export interface ScriptStep {
  id: string;
  name: string;
  script: string;
}

let counter = 0;
export function genStepId(): string {
  if (typeof crypto !== "undefined" && (crypto as any).randomUUID) {
    return `step-${(crypto as any).randomUUID()}`;
  }
  counter += 1;
  return `step-${Date.now()}-${counter}`;
}

export function emptyStep(name: string): ScriptStep {
  return { id: genStepId(), name, script: "" };
}

/**
 * Resolve the steps for a phase. Prefer an existing steps array; otherwise
 * migrate a legacy single-blob script into one "Step 1"; otherwise empty.
 */
export function toSteps(
  steps: ScriptStep[] | undefined,
  legacyText?: string
): ScriptStep[] {
  if (Array.isArray(steps) && steps.length > 0) {
    return steps.map((s) => ({
      id: s.id || genStepId(),
      name: typeof s.name === "string" ? s.name : "",
      script: typeof s.script === "string" ? s.script : ""
    }));
  }
  if (legacyText && legacyText.trim()) {
    return [{ id: genStepId(), name: "Step 1", script: legacyText }];
  }
  return [];
}
