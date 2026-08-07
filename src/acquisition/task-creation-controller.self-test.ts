import { strict as assert } from "node:assert";
import {
  isPlanDraftSubmissionReady,
  isTaskCreationSubmitReady
} from "./task-creation-controller";

assert.equal(isTaskCreationSubmitReady({
  searchConnectionId: "search-1",
  modelConnectionId: "model-1",
  approvalConfirmed: false,
  loading: false,
  submitting: false,
  completed: false
}), false);

const completedManualSubmission = {
  searchConnectionId: "search-1",
  modelConnectionId: "model-1",
  approvalConfirmed: true,
  loading: false,
  submitting: false,
  completed: true
};
assert.equal(isTaskCreationSubmitReady(completedManualSubmission), false);

const completedAiSubmission = {
  mode: "ai" as const,
  hasDraft: true,
  approvalConfirmed: true,
  loading: false,
  submitting: false,
  completed: true
};
assert.equal(isPlanDraftSubmissionReady(completedAiSubmission), false);

assert.equal(isPlanDraftSubmissionReady({
  mode: "ai",
  hasDraft: false,
  approvalConfirmed: true,
  loading: false,
  submitting: false,
  completed: false
}), false);
assert.equal(isPlanDraftSubmissionReady({
  mode: "ai",
  hasDraft: true,
  approvalConfirmed: true,
  loading: false,
  submitting: false,
  completed: false
}), true);
assert.equal(isPlanDraftSubmissionReady({
  mode: "manual",
  hasDraft: false,
  approvalConfirmed: true,
  loading: false,
  submitting: false,
  completed: false
}), true);

assert.equal(isTaskCreationSubmitReady({
  searchConnectionId: "search-1",
  modelConnectionId: "model-1",
  approvalConfirmed: true,
  loading: false,
  submitting: false,
  completed: false
}), true);

assert.equal(isTaskCreationSubmitReady({
  searchConnectionId: "search-1",
  modelConnectionId: "model-1",
  approvalConfirmed: true,
  loading: true,
  submitting: false,
  completed: false
}), false);
