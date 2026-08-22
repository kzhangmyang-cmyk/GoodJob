import {
  createMountedAiGrowthAdvisor,
  type AiGrowthDependencies
} from "./controller.js";

export type { AiGrowthDependencies } from "./controller.js";

export function mountAiGrowthAdvisor(
  root: HTMLElement,
  dependencies: AiGrowthDependencies
): {
  enter(): void;
  leave(): void;
  dispose(): void;
} {
  return createMountedAiGrowthAdvisor(root, dependencies);
}
