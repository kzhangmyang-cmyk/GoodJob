import { randomUUID } from "node:crypto";

export const requiredNodeVersion = ">=22.19.0";

export function createAiModelConfigId() {
  return `ai_${randomUUID()}`;
}
