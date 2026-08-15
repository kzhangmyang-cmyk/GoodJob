import { createHash } from "node:crypto";
import type { AcquisitionScope } from "./acquisition-douyin-comment-events.js";
import {
  decryptAcquisitionVisualArtifact,
  deriveAcquisitionVisualArtifactKey,
  encryptAcquisitionVisualArtifact,
  type AcquisitionVisualArtifactContext,
  type AcquisitionVisualArtifactEnvelope
} from "./acquisition-visual-artifact-crypto.js";
import { canonicalJsonStringify } from "./canonical-json.js";

export type { AcquisitionScope };

export type VisualExtractionMethod =
  | "dom"
  | "accessibility"
  | "ocr"
  | "vision";

export type VisualReaderStableErrorCode =
  | "visual_reader_not_enabled"
  | "visual_reader_session_expired"
  | "visual_reader_budget_exhausted"
  | "visual_source_invalid"
  | "visual_observation_invalid"
  | "visual_artifact_invalid"
  | "visual_extraction_method_disabled"
  | "visual_extraction_low_confidence"
  | "visual_reader_user_takeover";

export interface VisualReaderLimits {
  maxVideos: number;
  maxCommentsPerVideo: number;
  maxScrolls: number;
  maxOcrCalls: number;
  maxDurationMs: number;
}

export interface VisualReaderUsage {
  videoCount: number;
  observationCount: number;
  scrollCount: number;
  ocrCallCount: number;
  domObservationCount: number;
  accessibilityObservationCount: number;
  ocrObservationCount: number;
  lowConfidenceObservationCount: number;
  artifactCount: number;
}

export interface VisualReaderOutcome {
  status: "completed" | "partial_success" | "aborted" | "expired";
  videoCount: number;
  observationCount: number;
  domObservationCount: number;
  accessibilityObservationCount: number;
  ocrObservationCount: number;
  lowConfidenceObservationCount: number;
  artifactCount: number;
  errorCodes: VisualReaderStableErrorCode[];
}

export interface VisualReaderSession {
  sessionId: string;
  runId: string;
  planId: string;
  planVersionId: string;
  platform: "douyin";
  coverage: "authorized_visible_top_level_sample";
  status:
    | "created"
    | "collecting"
    | "completed"
    | "partial_success"
    | "aborted"
    | "expired";
  artifactUploadEnabled: boolean;
  limits: VisualReaderLimits;
  usage: VisualReaderUsage;
  outcome: VisualReaderOutcome | null;
  lastErrorCode: VisualReaderStableErrorCode | null;
  createdAt: string;
  authorizedAt: string;
  updatedAt: string;
  expiresAt: string;
  completedAt: string | null;
}

export interface DouyinVisualCommentObservationV1 {
  observationId: string;
  sessionId: string;
  sourceUrl: string;
  videoId: string;
  visibleText: string;
  textHash: string;
  displayName: string | null;
  visibleTimeText: string | null;
  likeCount: number | null;
  replyCount: number | null;
  platformCommentId: string | null;
  publicProfileUrl: string | null;
  secUid: string | null;
  extractionMethod: VisualExtractionMethod;
  fieldConfidences: {
    visibleText: number;
    displayName?: number;
    visibleTimeText?: number;
    likeCount?: number;
    replyCount?: number;
    platformCommentId?: number;
    publicProfileUrl?: number;
    secUid?: number;
  };
  viewportHash: string;
  cardBounds: { x: number; y: number; width: number; height: number };
  redactedCropHash: string | null;
  readerVersion: string;
  capturedAt: string;
}

export type VisualCommentObservation = DouyinVisualCommentObservationV1;

export interface CreateVisualReaderSessionInput {
  scope: AcquisitionScope;
  sessionId: string;
  runId: string;
  planId: string;
  planVersionId: string;
  artifactUploadEnabled: boolean;
  limits: VisualReaderLimits;
  createdAt: string;
  authorizedAt: string;
  expiresAt: string;
}

export interface VisualReaderArtifactInput {
  artifactId: string;
  observationId: string;
  mediaType: "image/webp";
  plaintext: Buffer;
  plaintextHash: string;
  byteLength: number;
  width: number;
  height: number;
  maskedRegionCount: number;
  createdAt: string;
  expiresAt: string;
}

export interface VisualReaderArtifact {
  artifactId: string;
  observationId: string;
  sessionId: string;
  mediaType: "image/webp";
  plaintext: Buffer;
  plaintextHash: string;
  byteLength: number;
  width: number;
  height: number;
  maskedRegionCount: number;
  createdAt: string;
  expiresAt: string;
}

export interface AppendVisualObservationBatchInput {
  scope: AcquisitionScope;
  sessionId: string;
  observations: Array<{
    clientObservationKey: string;
    observation: DouyinVisualCommentObservationV1;
    artifact?: VisualReaderArtifactInput;
  }>;
  usageDelta?: { scrollCount: number; ocrCallCount: number };
}

export interface AcquisitionVisualReaderRepository {
  createSession(
    input: CreateVisualReaderSessionInput
  ): Promise<VisualReaderSession>;
  appendObservationBatch(input: AppendVisualObservationBatchInput): Promise<{
    accepted: VisualCommentObservation[];
    duplicates: string[];
  }>;
  completeSession(
    scope: AcquisitionScope,
    sessionId: string,
    outcome: VisualReaderOutcome
  ): Promise<VisualReaderSession>;
  getSession(
    scope: AcquisitionScope,
    sessionId: string
  ): Promise<VisualReaderSession | null>;
  listRunObservations(
    scope: AcquisitionScope,
    runId: string,
    options: { limit: number }
  ): Promise<VisualCommentObservation[]>;
  getArtifact(
    scope: AcquisitionScope,
    artifactId: string
  ): Promise<VisualReaderArtifact | null>;
  deleteExpiredArtifacts(input: {
    before: string;
    limit: number;
  }): Promise<number>;
}

export type AcquisitionVisualReaderRepositoryErrorCode =
  | "VISUAL_READER_INVALID_INPUT"
  | "VISUAL_READER_SESSION_CONFLICT"
  | "VISUAL_READER_SESSION_NOT_FOUND"
  | "VISUAL_READER_SESSION_EXPIRED"
  | "VISUAL_READER_SESSION_TERMINAL"
  | "VISUAL_READER_CLIENT_KEY_CONFLICT"
  | "VISUAL_READER_OBSERVATION_CONFLICT"
  | "VISUAL_READER_ARTIFACT_INVALID"
  | "VISUAL_READER_ARTIFACT_CONFLICT"
  | "VISUAL_READER_BUDGET_EXHAUSTED";

export class AcquisitionVisualReaderRepositoryError extends Error {
  constructor(readonly code: AcquisitionVisualReaderRepositoryErrorCode) {
    super(code);
    this.name = "AcquisitionVisualReaderRepositoryError";
  }
}

interface StoredArtifact {
  scope: AcquisitionScope;
  artifactId: string;
  observationId: string;
  sessionId: string;
  mediaType: "image/webp";
  plaintextHash: string;
  byteLength: number;
  width: number;
  height: number;
  maskedRegionCount: number;
  createdAt: string;
  expiresAt: string;
  envelope: AcquisitionVisualArtifactEnvelope;
}

interface MemoryState {
  sessions: Map<string, VisualReaderSession>;
  sessionInputs: Map<string, string>;
  observations: Map<string, DouyinVisualCommentObservationV1>;
  observationScopes: Map<string, AcquisitionScope & { runId: string }>;
  dedupe: Map<string, string>;
  clientKeys: Map<string, { inputHash: string; observationId: string }>;
  artifacts: Map<string, StoredArtifact>;
}

const EMPTY_USAGE: VisualReaderUsage = Object.freeze({
  videoCount: 0,
  observationCount: 0,
  scrollCount: 0,
  ocrCallCount: 0,
  domObservationCount: 0,
  accessibilityObservationCount: 0,
  ocrObservationCount: 0,
  lowConfidenceObservationCount: 0,
  artifactCount: 0
});
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const SCOPE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/u;
const DOUYIN_VIDEO_URL =
  /^https:\/\/www\.douyin\.com\/video\/[1-9][0-9]{0,31}\/?$/u;
const DOUYIN_VIDEO_ID = /^[1-9][0-9]{0,31}$/u;
const DOUYIN_PROFILE_URL =
  /^https:\/\/www\.douyin\.com\/user\/[A-Za-z0-9][A-Za-z0-9._~-]{0,127}\/?$/u;
const DOUYIN_PUBLIC_KEY = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u;
const OBSERVATION_KEYS = [
  "observationId", "sessionId", "sourceUrl", "videoId", "visibleText",
  "textHash", "displayName", "visibleTimeText", "likeCount", "replyCount",
  "platformCommentId", "publicProfileUrl", "secUid", "extractionMethod",
  "fieldConfidences", "viewportHash", "cardBounds", "redactedCropHash",
  "readerVersion", "capturedAt"
] as const;
const CONFIDENCE_KEYS = [
  "visibleText", "displayName", "visibleTimeText", "likeCount", "replyCount",
  "platformCommentId", "publicProfileUrl", "secUid"
] as const;
const CARD_BOUNDS_KEYS = ["x", "y", "width", "height"] as const;
const LIMIT_KEYS = [
  "maxVideos", "maxCommentsPerVideo", "maxScrolls", "maxOcrCalls",
  "maxDurationMs"
] as const;
const OUTCOME_KEYS = [
  "status", "videoCount", "observationCount", "domObservationCount",
  "accessibilityObservationCount", "ocrObservationCount",
  "lowConfidenceObservationCount", "artifactCount", "errorCodes"
] as const;
const USAGE_KEYS = [
  "videoCount", "observationCount", "scrollCount", "ocrCallCount",
  "domObservationCount", "accessibilityObservationCount",
  "ocrObservationCount", "lowConfidenceObservationCount", "artifactCount"
] as const;
const SESSION_KEYS = [
  "sessionId", "runId", "planId", "planVersionId", "platform", "coverage",
  "status", "artifactUploadEnabled", "limits", "usage", "outcome",
  "lastErrorCode", "createdAt", "authorizedAt", "updatedAt", "expiresAt",
  "completedAt"
] as const;
const STABLE_ERROR_CODES = new Set<VisualReaderStableErrorCode>([
  "visual_reader_not_enabled",
  "visual_reader_session_expired",
  "visual_reader_budget_exhausted",
  "visual_source_invalid",
  "visual_observation_invalid",
  "visual_artifact_invalid",
  "visual_extraction_method_disabled",
  "visual_extraction_low_confidence",
  "visual_reader_user_takeover"
]);
const TERMINAL_STATUSES = new Set<VisualReaderSession["status"]>([
  "completed",
  "partial_success",
  "aborted",
  "expired"
]);

function fail(code: AcquisitionVisualReaderRepositoryErrorCode): never {
  throw new AcquisitionVisualReaderRepositoryError(code);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function scopeKey(scope: AcquisitionScope) {
  return `${scope.ownerId}\u0000${scope.teamId}`;
}

function sessionKey(scope: AcquisitionScope, sessionId: string) {
  return `${scopeKey(scope)}\u0000${sessionId}`;
}

function observationKey(scope: AcquisitionScope, observationId: string) {
  return `${scopeKey(scope)}\u0000${observationId}`;
}

function artifactKey(scope: AcquisitionScope, artifactId: string) {
  return `${scopeKey(scope)}\u0000${artifactId}`;
}

function clientKey(
  scope: AcquisitionScope,
  sessionId: string,
  key: string
) {
  return `${scopeKey(scope)}\u0000${sessionId}\u0000${key}`;
}

function canonical(value: unknown) {
  const result = canonicalJsonStringify(value);
  if (typeof result !== "string") fail("VISUAL_READER_INVALID_INPUT");
  return result;
}

function hashCanonical(value: unknown) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export function visualObservationInputHash(input: {
  observation: DouyinVisualCommentObservationV1;
  artifact?: VisualReaderArtifactInput;
}) {
  return hashCanonical({
    observation: input.observation,
    artifact: input.artifact ? {
      ...input.artifact,
      plaintext: input.artifact.plaintext.toString("base64")
    } : null
  });
}

function isoInstant(value: string) {
  if (typeof value !== "string") fail("VISUAL_READER_INVALID_INPUT");
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) {
    fail("VISUAL_READER_INVALID_INPUT");
  }
  return time;
}

export function assertVisualReaderScope(
  scope: unknown
): asserts scope is AcquisitionScope {
  if (!recordWithKeys(scope, ["ownerId", "teamId"])
    || typeof scope.ownerId !== "string"
    || !SCOPE_IDENTIFIER.test(scope.ownerId)
    || typeof scope.teamId !== "string"
    || !SCOPE_IDENTIFIER.test(scope.teamId)) {
    fail("VISUAL_READER_INVALID_INPUT");
  }
}

function validIdentifier(value: string) {
  return typeof value === "string" && IDENTIFIER.test(value);
}

export function assertVisualReaderIdentifier(
  value: unknown
): asserts value is string {
  if (typeof value !== "string" || !validIdentifier(value)) {
    fail("VISUAL_READER_INVALID_INPUT");
  }
}

function recordWithKeys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = []
): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key))
    && actual.every((key) => allowed.has(key));
}

function nullableVisibleString(value: unknown) {
  return value === null
    || (typeof value === "string"
      && value.length >= 1
      && value.length <= 255
      && /\S/u.test(value));
}

function nullableCount(value: unknown) {
  return value === null
    || (Number.isSafeInteger(value)
      && Number(value) >= 0
      && Number(value) <= 2_147_483_647);
}

function validateLimits(limits: VisualReaderLimits) {
  if (!recordWithKeys(limits, LIMIT_KEYS)) {
    fail("VISUAL_READER_INVALID_INPUT");
  }
  const bounds = {
    maxVideos: [1, 10],
    maxCommentsPerVideo: [1, 30],
    maxScrolls: [0, 5],
    maxOcrCalls: [0, 10],
    maxDurationMs: [1, 120_000]
  } as const;
  for (const [key, [minimum, maximum]] of Object.entries(bounds)) {
    const value = limits[key as keyof VisualReaderLimits];
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
      fail("VISUAL_READER_INVALID_INPUT");
    }
  }
}

function validateCreateInput(input: CreateVisualReaderSessionInput) {
  if (!recordWithKeys(input, [
    "scope", "sessionId", "runId", "planId", "planVersionId",
    "artifactUploadEnabled", "limits", "createdAt", "authorizedAt",
    "expiresAt"
  ])) fail("VISUAL_READER_INVALID_INPUT");
  assertVisualReaderScope(input.scope);
  for (const value of [
    input.sessionId,
    input.runId,
    input.planId,
    input.planVersionId
  ]) {
    if (!validIdentifier(value)) fail("VISUAL_READER_INVALID_INPUT");
  }
  if (typeof input.artifactUploadEnabled !== "boolean") {
    fail("VISUAL_READER_INVALID_INPUT");
  }
  validateLimits(input.limits);
  const createdAt = isoInstant(input.createdAt);
  const authorizedAt = isoInstant(input.authorizedAt);
  const expiresAt = isoInstant(input.expiresAt);
  if (authorizedAt < createdAt
    || expiresAt <= authorizedAt
    || expiresAt - authorizedAt > input.limits.maxDurationMs) {
    fail("VISUAL_READER_INVALID_INPUT");
  }
}

export function assertCreateVisualReaderSessionInput(
  input: CreateVisualReaderSessionInput
) {
  validateCreateInput(input);
}

export function assertAppendVisualObservationBatchInput(
  input: AppendVisualObservationBatchInput
) {
  if (!recordWithKeys(
    input,
    ["scope", "sessionId", "observations"],
    ["usageDelta"]
  )) fail("VISUAL_READER_INVALID_INPUT");
  assertVisualReaderScope(input.scope);
  assertVisualReaderIdentifier(input.sessionId);
  if (!Array.isArray(input.observations)
    || input.observations.length < 1
    || input.observations.length > 20
    || input.observations.filter((item) =>
      item && typeof item === "object" && "artifact" in item
      && item.artifact !== undefined).length > 5) {
    fail("VISUAL_READER_INVALID_INPUT");
  }
  for (const item of input.observations) {
    if (!recordWithKeys(
      item,
      ["clientObservationKey", "observation"],
      ["artifact"]
    )) fail("VISUAL_READER_INVALID_INPUT");
    assertVisualReaderIdentifier(item.clientObservationKey);
  }
  const usageDelta = input.usageDelta ?? { scrollCount: 0, ocrCallCount: 0 };
  if (!recordWithKeys(usageDelta, ["scrollCount", "ocrCallCount"])
    || !Number.isSafeInteger(usageDelta.scrollCount)
    || usageDelta.scrollCount < 0
    || !Number.isSafeInteger(usageDelta.ocrCallCount)
    || usageDelta.ocrCallCount < 0) {
    fail("VISUAL_READER_INVALID_INPUT");
  }
  return usageDelta;
}

export function visualCardBoundsHash(
  bounds: DouyinVisualCommentObservationV1["cardBounds"]
) {
  return `sha256:${createHash("sha256").update(canonical({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height
  })).digest("hex")}`;
}

function validateObservation(
  observation: DouyinVisualCommentObservationV1,
  sessionId: string
) {
  if (!recordWithKeys(observation, OBSERVATION_KEYS)
    || !validIdentifier(sessionId)
    || observation.sessionId !== sessionId
    || !validIdentifier(observation.observationId)
    || !validIdentifier(observation.sessionId)
    || typeof observation.sourceUrl !== "string"
    || observation.sourceUrl.length > 80
    || !DOUYIN_VIDEO_URL.test(observation.sourceUrl)
    || typeof observation.videoId !== "string"
    || !DOUYIN_VIDEO_ID.test(observation.videoId)
    || typeof observation.visibleText !== "string"
    || observation.visibleText.length < 1
    || observation.visibleText.length > 2_000
    || !/\S/u.test(observation.visibleText)
    || !DIGEST.test(observation.textHash)
    || !nullableVisibleString(observation.displayName)
    || !nullableVisibleString(observation.visibleTimeText)
    || !nullableCount(observation.likeCount)
    || !nullableCount(observation.replyCount)
    || (observation.platformCommentId !== null
      && (typeof observation.platformCommentId !== "string"
        || !DOUYIN_VIDEO_ID.test(observation.platformCommentId)))
    || (observation.publicProfileUrl !== null
      && (typeof observation.publicProfileUrl !== "string"
        || observation.publicProfileUrl.length > 170
        || !DOUYIN_PROFILE_URL.test(observation.publicProfileUrl)))
    || (observation.secUid !== null
      && (typeof observation.secUid !== "string"
        || !DOUYIN_PUBLIC_KEY.test(observation.secUid)))
    || !DIGEST.test(observation.viewportHash)
    || (observation.redactedCropHash !== null
      && !DIGEST.test(observation.redactedCropHash))
    || !["dom", "accessibility", "ocr", "vision"].includes(
      observation.extractionMethod
    )
    || !recordWithKeys(
      observation.fieldConfidences,
      ["visibleText"],
      CONFIDENCE_KEYS.slice(1)
    )
    || typeof observation.fieldConfidences.visibleText !== "number"
    || !Number.isFinite(observation.fieldConfidences.visibleText)
    || observation.fieldConfidences.visibleText < 0
    || observation.fieldConfidences.visibleText > 1
    || typeof observation.readerVersion !== "string"
    || observation.readerVersion.length < 1
    || observation.readerVersion.length > 100
    || !/\S/u.test(observation.readerVersion)
    || !recordWithKeys(observation.cardBounds, CARD_BOUNDS_KEYS)) {
    fail("VISUAL_READER_INVALID_INPUT");
  }
  for (const confidence of Object.values(observation.fieldConfidences)) {
    if (typeof confidence !== "number"
      || !Number.isFinite(confidence)
      || confidence < 0
      || confidence > 1) {
      fail("VISUAL_READER_INVALID_INPUT");
    }
  }
  if (`sha256:${createHash("sha256").update(observation.visibleText)
    .digest("hex")}` !== observation.textHash) {
    fail("VISUAL_READER_INVALID_INPUT");
  }
  for (const [key, value] of Object.entries(observation.cardBounds)) {
    const positive = key === "width" || key === "height";
    if (typeof value !== "number"
      || !Number.isFinite(value)
      || value < (positive ? Number.EPSILON : 0)
      || value > 8_192) {
      fail("VISUAL_READER_INVALID_INPUT");
    }
  }
  isoInstant(observation.capturedAt);
}

export function assertVisualCommentObservation(
  observation: DouyinVisualCommentObservationV1,
  sessionId: string
) {
  validateObservation(observation, sessionId);
}

function validateArtifact(
  artifact: VisualReaderArtifactInput,
  observation: DouyinVisualCommentObservationV1,
  session: VisualReaderSession
) {
  if (!session.artifactUploadEnabled
    || !validIdentifier(artifact.artifactId)
    || artifact.observationId !== observation.observationId
    || artifact.mediaType !== "image/webp"
    || !Buffer.isBuffer(artifact.plaintext)
    || artifact.plaintext.byteLength < 1
    || artifact.plaintext.byteLength > 262_144
    || artifact.byteLength !== artifact.plaintext.byteLength
    || !DIGEST.test(artifact.plaintextHash)
    || observation.redactedCropHash !== artifact.plaintextHash
    || `sha256:${createHash("sha256").update(artifact.plaintext)
      .digest("hex")}` !== artifact.plaintextHash
    || !Number.isSafeInteger(artifact.width)
    || artifact.width < 1
    || artifact.width > 8_192
    || !Number.isSafeInteger(artifact.height)
    || artifact.height < 1
    || artifact.height > 8_192
    || !Number.isSafeInteger(artifact.maskedRegionCount)
    || artifact.maskedRegionCount < 1
    || artifact.maskedRegionCount > 100) {
    fail("VISUAL_READER_ARTIFACT_INVALID");
  }
  const createdAt = isoInstant(artifact.createdAt);
  const expiresAt = isoInstant(artifact.expiresAt);
  if (expiresAt <= createdAt
    || expiresAt - createdAt > 30 * 24 * 60 * 60_000) {
    fail("VISUAL_READER_ARTIFACT_INVALID");
  }
}

export function assertVisualReaderArtifactInput(
  artifact: VisualReaderArtifactInput,
  observation: DouyinVisualCommentObservationV1,
  session: VisualReaderSession
) {
  validateArtifact(artifact, observation, session);
}

function lowConfidence(observation: DouyinVisualCommentObservationV1) {
  const minimum = observation.extractionMethod === "ocr"
    || observation.extractionMethod === "vision" ? 0.90 : 0.85;
  return observation.fieldConfidences.visibleText < minimum;
}

export const visualObservationIsLowConfidence = lowConfidence;

function dedupeKey(
  scope: AcquisitionScope,
  observation: DouyinVisualCommentObservationV1
) {
  return canonical([
    scope.ownerId,
    scope.teamId,
    observation.sessionId,
    observation.sourceUrl,
    observation.viewportHash,
    visualCardBoundsHash(observation.cardBounds),
    observation.textHash
  ]);
}

export const visualObservationDedupeKey = dedupeKey;

function outcomeFromUsage(
  status: VisualReaderOutcome["status"],
  usage: VisualReaderUsage,
  errorCodes: VisualReaderStableErrorCode[]
): VisualReaderOutcome {
  return {
    status,
    videoCount: usage.videoCount,
    observationCount: usage.observationCount,
    domObservationCount: usage.domObservationCount,
    accessibilityObservationCount: usage.accessibilityObservationCount,
    ocrObservationCount: usage.ocrObservationCount,
    lowConfidenceObservationCount: usage.lowConfidenceObservationCount,
    artifactCount: usage.artifactCount,
    errorCodes: [...errorCodes]
  };
}

export const deriveVisualReaderOutcome = outcomeFromUsage;

export function assertVisualReaderOutcomeShape(
  outcome: unknown
): asserts outcome is VisualReaderOutcome {
  if (!recordWithKeys(outcome, OUTCOME_KEYS)
    || !["completed", "partial_success", "aborted", "expired"].includes(
      String(outcome.status)
    )
    || !Array.isArray(outcome.errorCodes)
    || outcome.errorCodes.length > 9
    || new Set(outcome.errorCodes).size !== outcome.errorCodes.length
    || outcome.errorCodes.some((code) =>
      typeof code !== "string"
      || !STABLE_ERROR_CODES.has(code as VisualReaderStableErrorCode))) {
    fail("VISUAL_READER_INVALID_INPUT");
  }
  for (const key of OUTCOME_KEYS.slice(1, -1)) {
    const value = outcome[key];
    if (!Number.isSafeInteger(value)
      || Number(value) < 0
      || Number(value) > (key === "videoCount" ? 10 : 300)) {
      fail("VISUAL_READER_INVALID_INPUT");
    }
  }
}

export function assertVisualReaderOutcome(
  outcome: unknown,
  usage: VisualReaderUsage
): asserts outcome is VisualReaderOutcome {
  assertVisualReaderOutcomeShape(outcome);
  const derived = outcomeFromUsage(outcome.status, usage, outcome.errorCodes);
  if (canonical(derived) !== canonical(outcome)) {
    fail("VISUAL_READER_SESSION_CONFLICT");
  }
}

export function assertVisualReaderUsage(
  usage: unknown,
  limits: VisualReaderLimits
): asserts usage is VisualReaderUsage {
  if (!recordWithKeys(usage, USAGE_KEYS)) fail("VISUAL_READER_INVALID_INPUT");
  const normalized = usage as unknown as VisualReaderUsage;
  for (const key of USAGE_KEYS) {
    const value = normalized[key];
    const maximum = key === "videoCount" ? 10
      : key === "scrollCount" ? 5
        : key === "ocrCallCount" ? 10
          : 300;
    if (!Number.isSafeInteger(value)
      || Number(value) < 0
      || Number(value) > maximum) {
      fail("VISUAL_READER_INVALID_INPUT");
    }
  }
  if (normalized.videoCount > limits.maxVideos
    || normalized.observationCount
      > limits.maxVideos * limits.maxCommentsPerVideo
    || normalized.scrollCount > limits.maxScrolls
    || normalized.ocrCallCount > limits.maxOcrCalls
    || normalized.domObservationCount
      + normalized.accessibilityObservationCount
      + normalized.ocrObservationCount > normalized.observationCount
    || normalized.ocrCallCount < normalized.ocrObservationCount
    || normalized.lowConfidenceObservationCount > normalized.observationCount
    || normalized.artifactCount > normalized.observationCount) {
    fail("VISUAL_READER_INVALID_INPUT");
  }
}

export function assertVisualReaderSession(
  session: unknown
): asserts session is VisualReaderSession {
  if (!recordWithKeys(session, SESSION_KEYS)) fail("VISUAL_READER_INVALID_INPUT");
  for (const identifier of [
    session.sessionId, session.runId, session.planId, session.planVersionId
  ]) assertVisualReaderIdentifier(identifier);
  if (session.platform !== "douyin"
    || session.coverage !== "authorized_visible_top_level_sample"
    || !["created", "collecting", "completed", "partial_success", "aborted",
      "expired"].includes(String(session.status))
    || typeof session.artifactUploadEnabled !== "boolean") {
    fail("VISUAL_READER_INVALID_INPUT");
  }
  validateLimits(session.limits as VisualReaderLimits);
  assertVisualReaderUsage(session.usage, session.limits as VisualReaderLimits);
  const createdAt = isoInstant(session.createdAt as string);
  const authorizedAt = isoInstant(session.authorizedAt as string);
  const updatedAt = isoInstant(session.updatedAt as string);
  const expiresAt = isoInstant(session.expiresAt as string);
  if (authorizedAt < createdAt
    || expiresAt <= authorizedAt
    || expiresAt - authorizedAt
      > (session.limits as VisualReaderLimits).maxDurationMs
    || updatedAt < createdAt) {
    fail("VISUAL_READER_INVALID_INPUT");
  }
  if (session.lastErrorCode !== null
    && (typeof session.lastErrorCode !== "string"
      || !STABLE_ERROR_CODES.has(
        session.lastErrorCode as VisualReaderStableErrorCode
      ))) {
    fail("VISUAL_READER_INVALID_INPUT");
  }
  const terminal = TERMINAL_STATUSES.has(
    session.status as VisualReaderSession["status"]
  );
  if (!terminal) {
    if (session.outcome !== null || session.completedAt !== null) {
      fail("VISUAL_READER_INVALID_INPUT");
    }
    return;
  }
  assertVisualReaderOutcome(session.outcome, session.usage);
  if (session.outcome.status !== session.status
    || typeof session.completedAt !== "string"
    || isoInstant(session.completedAt) !== updatedAt
    || session.lastErrorCode !== (session.outcome.errorCodes[0] ?? null)) {
    fail("VISUAL_READER_INVALID_INPUT");
  }
}

function expiredProjection(session: VisualReaderSession, _now?: string) {
  const outcome = outcomeFromUsage(
    "expired",
    session.usage,
    ["visual_reader_session_expired"]
  );
  return {
    ...clone(session),
    status: "expired" as const,
    outcome,
    lastErrorCode: "visual_reader_session_expired" as const,
    updatedAt: session.expiresAt,
    completedAt: session.expiresAt
  };
}

export const visualReaderExpiredProjection = expiredProjection;

function activeAt(session: VisualReaderSession, now: string) {
  return !TERMINAL_STATUSES.has(session.status)
    && Date.parse(now) < Date.parse(session.expiresAt);
}

export const visualReaderSessionIsActiveAt = activeAt;

function artifactContext(stored: Omit<StoredArtifact, "envelope">):
AcquisitionVisualArtifactContext {
  return {
    ownerId: stored.scope.ownerId,
    teamId: stored.scope.teamId,
    sessionId: stored.sessionId,
    observationId: stored.observationId,
    artifactId: stored.artifactId,
    mediaType: stored.mediaType,
    plaintextHash: stored.plaintextHash,
    byteLength: stored.byteLength
  };
}

export interface InMemoryAcquisitionVisualReaderRepositoryOptions {
  masterSecret: string;
  now?: () => string;
}

export class InMemoryAcquisitionVisualReaderRepository
implements AcquisitionVisualReaderRepository {
  private state: MemoryState = {
    sessions: new Map(),
    sessionInputs: new Map(),
    observations: new Map(),
    observationScopes: new Map(),
    dedupe: new Map(),
    clientKeys: new Map(),
    artifacts: new Map()
  };
  private mutationTail: Promise<void> = Promise.resolve();
  private readonly masterSecret: string;
  private readonly now: () => string;

  constructor(options: InMemoryAcquisitionVisualReaderRepositoryOptions) {
    this.masterSecret = options.masterSecret;
    this.now = options.now ?? (() => new Date().toISOString());
    deriveSecretValidation(this.masterSecret);
  }

  private mutate<T>(work: () => T | Promise<T>) {
    const result = this.mutationTail.then(work);
    this.mutationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private async settledState() {
    await this.mutationTail;
    return this.state;
  }

  createSession(input: CreateVisualReaderSessionInput) {
    return this.mutate(() => {
      validateCreateInput(input);
      const key = sessionKey(input.scope, input.sessionId);
      const inputHash = hashCanonical(input);
      const existing = this.state.sessions.get(key);
      if (existing) {
        if (this.state.sessionInputs.get(key) !== inputHash) {
          fail("VISUAL_READER_SESSION_CONFLICT");
        }
        return clone(existing);
      }
      const session: VisualReaderSession = {
        sessionId: input.sessionId,
        runId: input.runId,
        planId: input.planId,
        planVersionId: input.planVersionId,
        platform: "douyin",
        coverage: "authorized_visible_top_level_sample",
        status: "created",
        artifactUploadEnabled: input.artifactUploadEnabled,
        limits: clone(input.limits),
        usage: clone(EMPTY_USAGE),
        outcome: null,
        lastErrorCode: null,
        createdAt: input.createdAt,
        authorizedAt: input.authorizedAt,
        updatedAt: input.createdAt,
        expiresAt: input.expiresAt,
        completedAt: null
      };
      this.state = {
        ...this.state,
        sessions: new Map(this.state.sessions).set(key, session),
        sessionInputs: new Map(this.state.sessionInputs).set(key, inputHash)
      };
      return clone(session);
    });
  }

  appendObservationBatch(input: AppendVisualObservationBatchInput) {
    return this.mutate(() => {
      const usageDelta = assertAppendVisualObservationBatchInput(input);
      const key = sessionKey(input.scope, input.sessionId);
      const session = this.state.sessions.get(key);
      if (!session) fail("VISUAL_READER_SESSION_NOT_FOUND");
      const now = this.now();
      isoInstant(now);
      if (Date.parse(now) >= Date.parse(session.expiresAt)
        && !TERMINAL_STATUSES.has(session.status)) {
        this.state = {
          ...this.state,
          sessions: new Map(this.state.sessions).set(
            key,
            expiredProjection(session, session.expiresAt)
          )
        };
        fail("VISUAL_READER_SESSION_EXPIRED");
      }
      if (TERMINAL_STATUSES.has(session.status)) {
        fail("VISUAL_READER_SESSION_TERMINAL");
      }

      for (const item of input.observations) {
        validateObservation(item.observation, input.sessionId);
        if (item.artifact) {
          validateArtifact(item.artifact, item.observation, session);
        }
      }

      const observations = new Map(this.state.observations);
      const observationScopes = new Map(this.state.observationScopes);
      const dedupe = new Map(this.state.dedupe);
      const clientKeys = new Map(this.state.clientKeys);
      const artifacts = new Map(this.state.artifacts);
      const accepted: DouyinVisualCommentObservationV1[] = [];
      const duplicates: string[] = [];
      const duplicateSet = new Set<string>();
      const acceptedVideoCounts = new Map<string, number>();
      for (const [storedKey, existing] of this.state.observations) {
        const storedScope = observationScopes.get(storedKey);
        if (existing.sessionId === input.sessionId
          && storedScope?.ownerId === input.scope.ownerId
          && storedScope.teamId === input.scope.teamId) {
          acceptedVideoCounts.set(
            existing.videoId,
            (acceptedVideoCounts.get(existing.videoId) ?? 0) + 1
          );
        }
      }

      for (const item of input.observations) {
        const inputHash = hashCanonical({
          observation: item.observation,
          artifact: item.artifact ? {
            ...item.artifact,
            plaintext: item.artifact.plaintext.toString("base64")
          } : null
        });
        const scopedClientKey = clientKey(
          input.scope,
          input.sessionId,
          item.clientObservationKey
        );
        const existingClient = clientKeys.get(scopedClientKey);
        if (existingClient) {
          if (existingClient.inputHash !== inputHash) {
            fail("VISUAL_READER_CLIENT_KEY_CONFLICT");
          }
          if (!duplicateSet.has(item.clientObservationKey)) {
            duplicates.push(item.clientObservationKey);
            duplicateSet.add(item.clientObservationKey);
          }
          continue;
        }
        const scopedObservationKey = observationKey(
          input.scope,
          item.observation.observationId
        );
        const existingObservation = observations.get(scopedObservationKey);
        if (existingObservation
          && canonical(existingObservation) !== canonical(item.observation)) {
          fail("VISUAL_READER_OBSERVATION_CONFLICT");
        }
        const immutableDedupeKey = dedupeKey(input.scope, item.observation);
        const duplicateObservationId = dedupe.get(immutableDedupeKey);
        if (existingObservation || duplicateObservationId) {
          clientKeys.set(scopedClientKey, {
            inputHash,
            observationId: duplicateObservationId
              ?? item.observation.observationId
          });
          duplicates.push(item.clientObservationKey);
          duplicateSet.add(item.clientObservationKey);
          continue;
        }
        if (!item.artifact && item.observation.redactedCropHash !== null) {
          fail("VISUAL_READER_ARTIFACT_INVALID");
        }

        const videoCount = (acceptedVideoCounts.get(
          item.observation.videoId
        ) ?? 0) + 1;
        acceptedVideoCounts.set(item.observation.videoId, videoCount);
        if (videoCount > session.limits.maxCommentsPerVideo
          || acceptedVideoCounts.size > session.limits.maxVideos) {
          fail("VISUAL_READER_BUDGET_EXHAUSTED");
        }

        observations.set(scopedObservationKey, clone(item.observation));
        observationScopes.set(scopedObservationKey, {
          ...input.scope,
          runId: session.runId
        });
        dedupe.set(immutableDedupeKey, item.observation.observationId);
        clientKeys.set(scopedClientKey, {
          inputHash,
          observationId: item.observation.observationId
        });
        if (item.artifact) {
          const scopedArtifactKey = artifactKey(
            input.scope,
            item.artifact.artifactId
          );
          if (artifacts.has(scopedArtifactKey)) {
            fail("VISUAL_READER_ARTIFACT_CONFLICT");
          }
          const storedWithoutEnvelope: Omit<StoredArtifact, "envelope"> = {
            scope: clone(input.scope),
            artifactId: item.artifact.artifactId,
            observationId: item.artifact.observationId,
            sessionId: input.sessionId,
            mediaType: item.artifact.mediaType,
            plaintextHash: item.artifact.plaintextHash,
            byteLength: item.artifact.byteLength,
            width: item.artifact.width,
            height: item.artifact.height,
            maskedRegionCount: item.artifact.maskedRegionCount,
            createdAt: item.artifact.createdAt,
            expiresAt: item.artifact.expiresAt
          };
          artifacts.set(scopedArtifactKey, {
            ...storedWithoutEnvelope,
            envelope: encryptAcquisitionVisualArtifact({
              masterSecret: this.masterSecret,
              context: artifactContext(storedWithoutEnvelope),
              plaintext: Buffer.from(item.artifact.plaintext)
            })
          });
        }
        accepted.push(clone(item.observation));
      }

      if (accepted.length === 0) {
        this.state = { ...this.state, clientKeys };
        return { accepted: [], duplicates };
      }
      const artifactCount = input.observations.filter((item) =>
        accepted.some((acceptedObservation) =>
          acceptedObservation.observationId === item.observation.observationId)
        && item.artifact).length;
      const acceptedOcrCount = accepted.filter((item) =>
        item.extractionMethod === "ocr").length;
      const usage: VisualReaderUsage = {
        videoCount: acceptedVideoCounts.size,
        observationCount: session.usage.observationCount + accepted.length,
        scrollCount: session.usage.scrollCount + usageDelta.scrollCount,
        ocrCallCount: session.usage.ocrCallCount
          + Math.max(usageDelta.ocrCallCount, acceptedOcrCount),
        domObservationCount: session.usage.domObservationCount
          + accepted.filter((item) => item.extractionMethod === "dom").length,
        accessibilityObservationCount:
          session.usage.accessibilityObservationCount
          + accepted.filter((item) =>
            item.extractionMethod === "accessibility").length,
        ocrObservationCount: session.usage.ocrObservationCount
          + accepted.filter((item) => item.extractionMethod === "ocr").length,
        lowConfidenceObservationCount:
          session.usage.lowConfidenceObservationCount
          + accepted.filter(lowConfidence).length,
        artifactCount: session.usage.artifactCount + artifactCount
      };
      if (usage.scrollCount > session.limits.maxScrolls
        || usage.ocrCallCount > session.limits.maxOcrCalls) {
        fail("VISUAL_READER_BUDGET_EXHAUSTED");
      }
      const nextSession: VisualReaderSession = {
        ...session,
        status: "collecting",
        usage,
        updatedAt: now
      };
      this.state = {
        ...this.state,
        sessions: new Map(this.state.sessions).set(key, nextSession),
        observations,
        observationScopes,
        dedupe,
        clientKeys,
        artifacts
      };
      return { accepted: clone(accepted), duplicates };
    });
  }

  completeSession(
    scope: AcquisitionScope,
    sessionId: string,
    outcome: VisualReaderOutcome
  ) {
    return this.mutate(() => {
      assertVisualReaderScope(scope);
      assertVisualReaderIdentifier(sessionId);
      assertVisualReaderOutcomeShape(outcome);
      const key = sessionKey(scope, sessionId);
      const session = this.state.sessions.get(key);
      if (!session) fail("VISUAL_READER_SESSION_NOT_FOUND");
      const now = this.now();
      isoInstant(now);
      const terminal = TERMINAL_STATUSES.has(session.status);
      const expiredNow = Date.parse(now) >= Date.parse(session.expiresAt);
      if (terminal) {
        if (session.outcome && canonical(session.outcome) === canonical(outcome)) {
          return clone(session);
        }
        fail("VISUAL_READER_SESSION_CONFLICT");
      }
      if (expiredNow) {
        const expired = expiredProjection(session, session.expiresAt);
        this.state = {
          ...this.state,
          sessions: new Map(this.state.sessions).set(key, expired)
        };
        if (canonical(expired.outcome) === canonical(outcome)) {
          return clone(expired);
        }
        fail("VISUAL_READER_SESSION_EXPIRED");
      }
      assertVisualReaderOutcome(outcome, session.usage);
      const derived = outcomeFromUsage(outcome.status, session.usage,
        outcome.errorCodes);
      const completed: VisualReaderSession = {
        ...session,
        status: outcome.status,
        outcome: clone(derived),
        lastErrorCode: outcome.errorCodes[0] ?? null,
        updatedAt: now,
        completedAt: now
      };
      this.state = {
        ...this.state,
        sessions: new Map(this.state.sessions).set(key, completed)
      };
      return clone(completed);
    });
  }

  getSession(scope: AcquisitionScope, sessionId: string) {
    return this.mutate(() => {
      assertVisualReaderScope(scope);
      assertVisualReaderIdentifier(sessionId);
      const key = sessionKey(scope, sessionId);
      const session = this.state.sessions.get(key);
      if (!session) return null;
      const now = this.now();
      isoInstant(now);
      if (activeAt(session, now) || TERMINAL_STATUSES.has(session.status)) {
        return clone(session);
      }
      const expired = expiredProjection(session, session.expiresAt);
      this.state = {
        ...this.state,
        sessions: new Map(this.state.sessions).set(key, expired)
      };
      return clone(expired);
    });
  }

  async listRunObservations(
    scope: AcquisitionScope,
    runId: string,
    options: { limit: number }
  ) {
    assertVisualReaderScope(scope);
    assertVisualReaderIdentifier(runId);
    if (!recordWithKeys(options, ["limit"])
      || !Number.isSafeInteger(options.limit)
      || options.limit < 1
      || options.limit > 1_000) {
      fail("VISUAL_READER_INVALID_INPUT");
    }
    const state = await this.settledState();
    return [...state.observations.entries()]
      .filter(([key]) => {
        const storedScope = state.observationScopes.get(key);
        return storedScope?.ownerId === scope.ownerId
          && storedScope.teamId === scope.teamId
          && storedScope.runId === runId;
      })
      .map(([, value]) => value)
      .sort((left, right) =>
        left.capturedAt.localeCompare(right.capturedAt)
        || left.observationId.localeCompare(right.observationId))
      .slice(0, options.limit)
      .map(clone);
  }

  async getArtifact(scope: AcquisitionScope, artifactId: string) {
    assertVisualReaderScope(scope);
    assertVisualReaderIdentifier(artifactId);
    const state = await this.settledState();
    const stored = state.artifacts.get(artifactKey(scope, artifactId));
    if (!stored || Date.parse(stored.expiresAt) <= Date.parse(this.now())) {
      return null;
    }
    const { envelope, scope: _scope, ...metadata } = stored;
    return {
      ...clone(metadata),
      plaintext: decryptAcquisitionVisualArtifact({
        masterSecret: this.masterSecret,
        context: artifactContext({ ...metadata, scope: stored.scope }),
        envelope
      })
    };
  }

  deleteExpiredArtifacts(input: { before: string; limit: number }) {
    return this.mutate(() => {
      const before = isoInstant(input.before);
      if (!Number.isSafeInteger(input.limit)
        || input.limit < 1
        || input.limit > 100) {
        fail("VISUAL_READER_INVALID_INPUT");
      }
      const expired = [...this.state.artifacts.entries()]
        .filter(([, item]) => Date.parse(item.expiresAt) <= before)
        .sort((left, right) =>
          left[1].expiresAt.localeCompare(right[1].expiresAt)
          || left[1].artifactId.localeCompare(right[1].artifactId))
        .slice(0, input.limit);
      if (expired.length === 0) return 0;
      const artifacts = new Map(this.state.artifacts);
      for (const [key] of expired) artifacts.delete(key);
      this.state = { ...this.state, artifacts };
      return expired.length;
    });
  }
}

function deriveSecretValidation(masterSecret: string) {
  deriveAcquisitionVisualArtifactKey(masterSecret);
}
