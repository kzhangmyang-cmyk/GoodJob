import type {
  components,
  operations,
  paths
} from "./generated/ai-acquisition.js";
import type {
  CopilotSessionCreateOperationDto,
  CopilotTaskDto,
  ProviderConnectionDto
} from "./api.js";

type Assert<T extends true> = T;

type IsRequired<T, K extends keyof T> =
  {} extends Pick<T, K> ? false : true;

type ProviderOwnerIsRequired = Assert<
  IsRequired<ProviderConnectionDto, "ownerId">
>;
type ProviderIncludesRuntimeError = Assert<
  "error" extends ProviderConnectionDto["status"] ? true : false
>;
type ProviderRejectsStaleUpdatedAt = Assert<
  "updatedAt" extends keyof ProviderConnectionDto ? false : true
>;

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

const providerConnection: ProviderConnectionDto = {
  id: "connection_1",
  ownerId: "owner_1",
  teamId: null,
  providerId: "serper",
  kind: "search",
  status: "error",
  credentialVersion: 2,
  lastHealthAt: "2026-08-05T00:00:00Z",
  lastHealthStatus: "failed",
  lastErrorCode: "PROVIDER_UNAVAILABLE",
  lastHealthMessage: "Provider unavailable",
  usage: "search",
  createdAt: "2026-08-05T00:00:00Z"
};

const sessionCreation: CopilotSessionCreateOperationDto = {
  id: "operation_1",
  kind: "copilot_session_creation",
  status: "succeeded",
  resourceId: "session_1",
  createdAt: "2026-08-05T00:00:00Z",
  completedAt: "2026-08-05T00:00:00Z"
};

const assistantToolCall: components["schemas"]["toolCall"] = {
  type: "toolCall",
  id: "tool_call_1",
  name: "query_candidates",
  arguments: {
    candidateId: "candidate_1",
    limit: 10
  }
};

const copilotTask: CopilotTaskDto = {
  id: "task_1",
  sessionId: "session_1",
  kind: "message",
  status: "succeeded",
  responseMode: "plan_draft",
  result: {
    planDraft: { objective: "Find public buying signals" },
    toolNames: ["query_candidates"]
  },
  errorCode: null,
  createdAt: "2026-08-05T00:00:00Z",
  completedAt: "2026-08-05T00:00:01Z"
};

void evidence;
void approval;
void approvalOperation;
void invalidApproval;
void providerConnection;
void sessionCreation;
void assistantToolCall;
void copilotTask;
void (null as unknown as ProviderOwnerIsRequired);
void (null as unknown as ProviderIncludesRuntimeError);
void (null as unknown as ProviderRejectsStaleUpdatedAt);
