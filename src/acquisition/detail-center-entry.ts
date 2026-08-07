export type AcquisitionDetailMode = "plan" | "candidates";

export interface AcquisitionDetailOpenRequest {
  mode: AcquisitionDetailMode;
  planId: string;
}

export function acquisitionDetailRequestForAction(
  acquisitionMode: string | undefined,
  actionId: string,
  planId: string | undefined
): AcquisitionDetailOpenRequest | null {
  const selectedPlanId = planId?.trim();
  if (acquisitionMode !== "real" || !selectedPlanId) return null;
  if (actionId === "replicaEditTask") {
    return { mode: "plan", planId: selectedPlanId };
  }
  if (actionId === "replicaCompleteTask") {
    return { mode: "candidates", planId: selectedPlanId };
  }
  return null;
}
