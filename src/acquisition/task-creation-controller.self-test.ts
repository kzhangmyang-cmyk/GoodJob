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
  submitting: false
}), false);

assert.equal(isPlanDraftSubmissionReady({
  mode: "ai",
  hasDraft: false,
  approvalConfirmed: true,
  loading: false,
  submitting: false
}), false);
assert.equal(isPlanDraftSubmissionReady({
  mode: "ai",
  hasDraft: true,
  approvalConfirmed: true,
  loading: false,
  submitting: false
}), true);
assert.equal(isPlanDraftSubmissionReady({
  mode: "manual",
  hasDraft: false,
  approvalConfirmed: true,
  loading: false,
  submitting: false
}), true);

assert.equal(isTaskCreationSubmitReady({
  searchConnectionId: "search-1",
  modelConnectionId: "model-1",
  approvalConfirmed: true,
  loading: false,
  submitting: false
}), true);

assert.equal(isTaskCreationSubmitReady({
  searchConnectionId: "search-1",
  modelConnectionId: "model-1",
  approvalConfirmed: true,
  loading: true,
  submitting: false
}), false);
