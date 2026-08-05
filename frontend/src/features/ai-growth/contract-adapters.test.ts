import type {
  components,
  operations,
  paths
} from "./generated/ai-acquisition.js";

const evidence: components["schemas"]["DiscoveryEvidence"] = {
  id: "evidence_1",
  targetType: "organization",
  sourcePlatform: "douyin",
  sourceTitle: "公开页面",
  sourceSnippet: "公开摘要",
  publishedAt: null,
  fetchedAt: "2026-08-05T00:00:00Z",
  locale: "zh-CN",
  rawArtifactHash: "sha256:raw",
  contentHash: "sha256:content",
  provenance: {
    kind: "user_submitted_url",
    sourceUrl: "https://www.douyin.com/video/1",
    submittedBy: "user_1"
  },
  accessStatus: "public_content"
};

type PlanApproval =
  paths["/api/v1/acquisition/plans/{id}/approval"]["post"]["requestBody"]["content"]["application/json"];

const approval: PlanApproval = {
  decision: "approve",
  reason: "人工确认"
};

type ApprovalOperationRequest =
  operations["approveAcquisitionPlan"]["requestBody"]["content"]["application/json"];

const approvalOperation: ApprovalOperationRequest = {
  decision: "approve",
  reason: "人工确认"
};

const invalidApproval: typeof approval = {
  // @ts-expect-error The release contract accepts only an approval decision.
  decision: "reject",
  reason: "不通过"
};

void evidence;
void approval;
void approvalOperation;
void invalidApproval;
