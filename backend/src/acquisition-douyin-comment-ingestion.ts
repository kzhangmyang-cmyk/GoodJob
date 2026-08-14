import { createHash } from "node:crypto";
import type { BuyingStage } from "./acquisition-domain.js";
import type {
  AcquisitionActorScope,
  AcquisitionDomainService
} from "./acquisition-domain-service.js";
import type {
  AcquisitionDouyinCommentEventRepository,
  DouyinCommentEvent
} from "./acquisition-douyin-comment-events.js";
import type {
  AcquisitionIndividualSignalIngestionPort
} from "./acquisition-individual-signal-ingestion.js";
import {
  isSafeAcquisitionPublicActorKey
} from "./acquisition-public-identity-resolver.js";
import {
  DOUYIN_PUBLIC_COMMENT_COVERAGE,
  DOUYIN_PUBLIC_COMMENT_PROVIDER_ID,
  DOUYIN_PUBLIC_COMMENT_PROVIDER_VERSION,
  type DouyinPublicComment,
  type DouyinPublicCommentSamplePage,
  resolveDouyinVideoId
} from "./douyin-public-comment-provider.js";

export type DouyinCommentIntentBand =
  | "strong_signal"
  | "potential_signal"
  | "noise"
  | "negative";

export interface DouyinCommentIntentDecision {
  band: DouyinCommentIntentBand;
  positiveSignals: string[];
  negativeSignals: string[];
  reasons: string[];
  buyingStage: BuyingStage;
  confidence: number;
}

export interface AcquisitionDouyinCommentIngestionInput {
  scope: AcquisitionActorScope;
  runId: string | null;
  shardId: string | null;
  discoveryOperationId: string | null;
  sourceUrl: string;
  videoId: string;
  page: DouyinPublicCommentSamplePage;
}

export interface AcquisitionDouyinCommentIngestionResult {
  eventCount: number;
  evidenceCount: number;
  candidateIds: string[];
  unresolvedActorCount: number;
  strongSignalCount: number;
  invalidCommentCount: number;
}

export interface AcquisitionDouyinCommentIngestionServiceOptions {
  events: AcquisitionDouyinCommentEventRepository;
  domain: AcquisitionDomainService;
  individualSignals: AcquisitionIndividualSignalIngestionPort;
}

const MAX_DECISION_CODES = 12;

const POSITIVE_RULES = [
  ["price_inquiry", /(?:多少钱|报价|询价|价格|费用)/u],
  ["consultation", /(?:咨询|了解一下|怎么做|怎么联系)/u],
  ["budget", /(?:预算|\d+(?:\.\d+)?\s*(?:万|元|块))/u],
  ["quantity", /\d+\s*(?:套|个|件|台|批|箱|份|家|人)/u],
  ["procurement", /(?:采购|求购|招标)/u],
  ["supplier_sourcing", /(?:供应商|供货|厂家)/u],
  ["franchise", /加盟/u],
  ["cooperation", /合作/u],
  ["trial", /(?:试用|体验)/u],
  ["delivery", /(?:交付|交期|周期多久)/u],
  ["timeline", /(?:急|尽快|马上|本周|这周|下周|上线|月底|\d+天)/u],
  ["business_pain", /(?:获客难|成本太高|成本高|效率低|痛点|缺少|很难)/u],
  ["solution_search", /(?:解决方案|找方案|寻找方案)/u]
] as const;

const NEGATIVE_RULES = [
  ["explicit_rejection", /(?:不需要|不感兴趣|不用了|拒绝|别推销)/u],
  ["no_contact", /(?:请勿联系|勿扰|不要联系|别联系|请勿电话)/u],
  ["anti_marketing", /(?:不接受营销|拒绝推销|反营销)/u]
] as const;

function normalizedText(value: string) {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function uniqueBounded(values: string[]) {
  return [...new Set(values)].slice(0, MAX_DECISION_CODES);
}

function matchingCodes(
  text: string,
  rules: ReadonlyArray<readonly [string, RegExp]>
) {
  return uniqueBounded(rules.flatMap(([code, pattern]) =>
    pattern.test(text) ? [code] : []));
}

function noiseReason(text: string) {
  if (!/[\p{L}\p{N}]/u.test(text)) return "no_business_meaning";
  if (/(?:抽奖|点赞|关注|互关|扣[1一]|评论区见)/u.test(text)) {
    return "engagement_bait";
  }
  if (/(\S{1,4})\1{3,}/u.test(text)) return "copy_spam";
  return null;
}

function has(signals: string[], code: string) {
  return signals.includes(code);
}

function buyingStageFor(signals: string[], strong: boolean): BuyingStage {
  if (strong && (
    has(signals, "procurement")
    || has(signals, "supplier_sourcing")
    || has(signals, "delivery")
    || has(signals, "timeline")
    || (has(signals, "budget") && has(signals, "quantity"))
  )) return "purchase_ready";
  if (has(signals, "price_inquiry")
    || has(signals, "franchise")
    || has(signals, "cooperation")
    || has(signals, "trial")) return "comparison";
  if (has(signals, "solution_search") || has(signals, "consultation")) {
    return "solution_research";
  }
  if (has(signals, "business_pain")) return "problem_defined";
  return "awareness";
}

function isStrong(signals: string[]) {
  const procurementContext = has(signals, "procurement") && [
    "supplier_sourcing", "budget", "quantity", "timeline", "price_inquiry"
  ].some((code) => has(signals, code));
  const supplierContext = has(signals, "supplier_sourcing") && [
    "procurement", "budget", "quantity", "timeline"
  ].some((code) => has(signals, code));
  const priceContext = has(signals, "price_inquiry") && [
    "budget", "quantity", "procurement", "supplier_sourcing", "timeline"
  ].some((code) => has(signals, code));
  const commercialExperimentCount = ["franchise", "cooperation", "trial"]
    .filter((code) => has(signals, code)).length;
  return procurementContext
    || supplierContext
    || priceContext
    || (has(signals, "budget") && has(signals, "quantity"))
    || commercialExperimentCount >= 2
    || (has(signals, "delivery") && has(signals, "timeline"));
}

export function classifyDouyinCommentIntent(
  rawText: string
): DouyinCommentIntentDecision {
  const text = normalizedText(String(rawText ?? ""));
  const negativeSignals = matchingCodes(text, NEGATIVE_RULES);
  if (negativeSignals.length > 0) {
    return {
      band: "negative",
      positiveSignals: matchingCodes(text, POSITIVE_RULES),
      negativeSignals,
      reasons: negativeSignals.map((code) => `negative:${code}`),
      buyingStage: "awareness",
      confidence: 0.98
    };
  }

  const noise = noiseReason(text);
  if (!text || noise) {
    return {
      band: "noise",
      positiveSignals: [],
      negativeSignals: [],
      reasons: [`noise:${noise || "empty"}`],
      buyingStage: "awareness",
      confidence: 0.99
    };
  }

  const positiveSignals = matchingCodes(text, POSITIVE_RULES);
  if (positiveSignals.length === 0) {
    return {
      band: "noise",
      positiveSignals: [],
      negativeSignals: [],
      reasons: ["noise:no_business_meaning"],
      buyingStage: "awareness",
      confidence: 0.85
    };
  }
  const strong = isStrong(positiveSignals);
  const band = strong ? "strong_signal" : "potential_signal";
  return {
    band,
    positiveSignals,
    negativeSignals: [],
    reasons: uniqueBounded(positiveSignals.map((code) =>
      `${strong ? "strong" : "potential"}:${code}`)),
    buyingStage: buyingStageFor(positiveSignals, strong),
    confidence: strong
      ? Math.min(0.95, 0.78 + positiveSignals.length * 0.03)
      : Math.min(0.76, 0.55 + positiveSignals.length * 0.04)
  };
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function deterministicId(prefix: string, material: unknown) {
  return `${prefix}:${createHash("sha256")
    .update(JSON.stringify(material))
    .digest("hex")}`;
}

function validInstant(value: unknown) {
  return typeof value === "string" && Number.isFinite(new Date(value).getTime());
}

function canonicalInstant(value: string) {
  return new Date(value).toISOString();
}

function nonNegativeInteger(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function nullableString(value: unknown) {
  return value === null || typeof value === "string";
}

function normalizedOptional(value: unknown, maximum: number) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const normalized = normalizedText(value);
  return normalized && normalized.length <= maximum ? normalized : null;
}

type ValidComment = {
  commentId: string;
  text: string;
  occurredAt: string;
  publishedAt: string | null;
  likeCount: number;
  replyCount: number;
  ipLabel: string | null;
  actor: {
    displayName: string;
    handle: string | null;
    secUid: string | null;
  };
};

function validComment(value: unknown, capturedAt: string): ValidComment | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const comment = value as Partial<DouyinPublicComment>;
  const commentId = typeof comment.commentId === "string"
    ? comment.commentId.normalize("NFKC").trim()
    : "";
  const text = typeof comment.text === "string"
    ? comment.text.trim()
    : "";
  if (!/^[A-Za-z0-9._~-]{1,128}$/u.test(commentId)
    || !normalizedText(text)
    || text.length > 4_000
    || !nonNegativeInteger(comment.likeCount)
    || !nonNegativeInteger(comment.replyCount)
    || !nullableString(comment.ipLabel)
    || (comment.occurredAt !== null
      && (!boundedNonEmpty(comment.occurredAt, 100)
        || !validInstant(comment.occurredAt)))
    || !comment.actor
    || typeof comment.actor !== "object"
    || Array.isArray(comment.actor)
    || !nullableString(comment.actor.displayName)
    || !nullableString(comment.actor.handle)
    || !nullableString(comment.actor.secUid)
    || (comment.ipLabel !== null
      && normalizedText(comment.ipLabel!).length > 200)
    || (comment.actor.displayName !== null
      && normalizedText(comment.actor.displayName!).length > 200)
    || (comment.actor.handle !== null
      && normalizedText(comment.actor.handle!).length > 64)
    || (comment.actor.secUid !== null
      && normalizedText(comment.actor.secUid!).length > 128)) {
    return null;
  }
  const publishedAt = comment.occurredAt === null
    ? null
    : canonicalInstant(comment.occurredAt!);
  return {
    commentId,
    text,
    occurredAt: publishedAt ?? capturedAt,
    publishedAt,
    likeCount: comment.likeCount!,
    replyCount: comment.replyCount!,
    ipLabel: normalizedOptional(comment.ipLabel, 200),
    actor: {
      displayName: normalizedOptional(comment.actor.displayName, 200)
        ?? "抖音公开用户（身份待核验）",
      handle: normalizedOptional(comment.actor.handle, 64),
      secUid: normalizedOptional(comment.actor.secUid, 128)
    }
  };
}

function actorKey(comment: ValidComment) {
  const secUid = comment.actor.secUid
    ? `douyin:sec_uid:${comment.actor.secUid}`
    : null;
  if (secUid && isSafeAcquisitionPublicActorKey(secUid)) return secUid;
  const handle = comment.actor.handle
    ? `douyin:handle:${comment.actor.handle.toLocaleLowerCase("en-US")}`
    : null;
  if (handle && isSafeAcquisitionPublicActorKey(handle)) return handle;
  return `unmergeable:douyin:comment:${comment.commentId}`;
}

function boundedNonEmpty(value: unknown, maximum: number) {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= maximum;
}

function nullableBoundedNonEmpty(value: unknown, maximum: number) {
  return value === null || boundedNonEmpty(value, maximum);
}

function prepareSample(input: AcquisitionDouyinCommentIngestionInput) {
  const page = input?.page;
  const metadata = page?.metadata;
  const validSource = boundedNonEmpty(input?.sourceUrl, 4_000)
    && resolveDouyinVideoId(input.sourceUrl) === input.videoId;
  if (!boundedNonEmpty(input?.scope?.ownerId, 100)
    || !boundedNonEmpty(input?.scope?.teamId, 100)
    || !boundedNonEmpty(input?.scope?.actorId, 100)
    || !nullableBoundedNonEmpty(input?.runId, 255)
    || !nullableBoundedNonEmpty(input?.shardId, 255)
    || !nullableBoundedNonEmpty(input?.discoveryOperationId, 255)
    || !validSource
    || !/^[0-9]{1,32}$/u.test(input?.videoId || "")
    || page?.providerId !== DOUYIN_PUBLIC_COMMENT_PROVIDER_ID
    || page?.providerVersion !== DOUYIN_PUBLIC_COMMENT_PROVIDER_VERSION
    || page?.coverage !== DOUYIN_PUBLIC_COMMENT_COVERAGE
    || page?.replyBodiesIncluded !== false
    || !boundedNonEmpty(page?.capturedAt, 100)
    || !validInstant(page?.capturedAt)
    || !/^sha256:[a-f0-9]{64}$/u.test(page?.rawArtifactHash || "")
    || !Array.isArray(page?.comments)
    || page.comments.length > 100
    || (page.nextCursor !== null && !nonNegativeInteger(page.nextCursor))
    || typeof page.hasMore !== "boolean"
    || (page.reportedCommentCount !== null
      && !nonNegativeInteger(page.reportedCommentCount))
    || !metadata
    || !Number.isSafeInteger(metadata.requestedCommentCount)
    || metadata.requestedCommentCount < 1
    || metadata.requestedCommentCount > 100
    || metadata.returnedCommentCount !== page.comments.length
    || !nonNegativeInteger(metadata.duplicateCommentCount)
    || typeof metadata.partial !== "boolean"
    || typeof metadata.cursorProgressed !== "boolean") {
    throw new Error("ACQUISITION_DOUYIN_COMMENT_INVALID_SAMPLE");
  }
  const capturedAt = canonicalInstant(page.capturedAt);
  const comments = (page.comments as unknown[]).map((rawComment) =>
    validComment(rawComment, capturedAt));
  return {
    capturedAt,
    comments,
    invalidCommentCount: comments.filter((comment) => comment === null).length
  };
}

const DOUYIN_COMMENT_CONTENT_VERSION = "douyin-comment-content-version-v1";

function contentVersionArtifactHash(input: {
  eventId: string;
  textHash: string;
  normalizedContent: string;
}) {
  return sha256(JSON.stringify({
    schemaVersion: DOUYIN_COMMENT_CONTENT_VERSION,
    eventId: input.eventId,
    textHash: input.textHash,
    normalizedContent: input.normalizedContent
  }));
}

export class AcquisitionDouyinCommentIngestionService {
  private readonly events: AcquisitionDouyinCommentEventRepository;
  private readonly domain: AcquisitionDomainService;
  private readonly individualSignals: AcquisitionIndividualSignalIngestionPort;

  constructor(options: AcquisitionDouyinCommentIngestionServiceOptions) {
    this.events = options.events;
    this.domain = options.domain;
    this.individualSignals = options.individualSignals;
  }

  async ingestSample(
    input: AcquisitionDouyinCommentIngestionInput
  ): Promise<AcquisitionDouyinCommentIngestionResult> {
    const prepared = prepareSample(input);
    const capturedAt = prepared.capturedAt;
    const candidateIds: string[] = [];
    const seenCandidateIds = new Set<string>();
    const unresolvedActors = new Set<string>();
    let eventCount = 0;
    let evidenceCount = 0;
    let strongSignalCount = 0;
    const invalidCommentCount = prepared.invalidCommentCount;

    // This is a restartable cross-repository saga, not an atomic transaction.
    // Each step has deterministic identity, so exact retry resumes safely
    // after event, evidence, candidate, or link without duplicating facts.
    for (const comment of prepared.comments) {
      if (!comment) continue;
      const normalizedContent = normalizedText(comment.text);
      const textHash = sha256(normalizedContent);
      const eventId = deterministicId("douyin-comment-event", [
        input.scope.ownerId,
        input.scope.teamId,
        "douyin",
        comment.commentId
      ]);
      const event: DouyinCommentEvent = {
        eventId,
        platform: "douyin",
        eventType: "comment",
        platformEventId: comment.commentId,
        videoId: input.videoId,
        parentCommentId: null,
        text: comment.text,
        textHash,
        occurredAt: comment.occurredAt,
        capturedAt,
        likeCount: comment.likeCount,
        replyCount: comment.replyCount,
        ipLabel: comment.ipLabel,
        actor: comment.actor,
        sourceUrl: input.sourceUrl,
        coverage: "public_top_level_sample",
        accessStatus: "public_content",
        providerVersion: input.page.providerVersion,
        rawArtifactHash: input.page.rawArtifactHash
      };
      const observationId = deterministicId("douyin-comment-observation", [
        eventId,
        capturedAt,
        textHash,
        comment.likeCount,
        comment.replyCount,
        input.page.providerVersion,
        input.page.rawArtifactHash
      ]);
      const appended = await this.events.appendObservation({
        scope: input.scope,
        observationId,
        event
      });
      eventCount += 1;

      const authoritativeEvent = appended.event;
      const evidenceKey = `comment:${eventId}:evidence:${textHash}`;
      const evidence = await this.domain.appendEvidence(input.scope, {
        targetType: "individual_signal",
        sourcePlatform: "douyin",
        sourceTitle:
          `${authoritativeEvent.actor.displayName} 的抖音公开评论`.slice(0, 500),
        sourceSnippet: normalizedContent,
        publishedAt: authoritativeEvent.occurredAt,
        locale: "zh-CN",
        rawArtifactHash: contentVersionArtifactHash({
          eventId,
          textHash,
          normalizedContent
        }),
        contentHash: textHash,
        provenance: {
          kind: "platform_public_event",
          sourceUrl: authoritativeEvent.sourceUrl,
          platformEventId: authoritativeEvent.platformEventId,
          providerVersion: authoritativeEvent.providerVersion,
          coverage: "public_top_level_sample"
        },
        accessStatus: "public_content"
      }, evidenceKey);
      evidenceCount += 1;

      const decision = classifyDouyinCommentIntent(normalizedContent);
      if (decision.band === "strong_signal") strongSignalCount += 1;
      let candidateId: string | null = null;
      if (decision.band !== "noise") {
        const authoritativeComment: ValidComment = {
          commentId: authoritativeEvent.platformEventId,
          text: authoritativeEvent.text,
          occurredAt: authoritativeEvent.occurredAt,
          publishedAt: authoritativeEvent.occurredAt,
          likeCount: authoritativeEvent.likeCount,
          replyCount: authoritativeEvent.replyCount,
          ipLabel: authoritativeEvent.ipLabel,
          actor: authoritativeEvent.actor
        };
        const publicActorKey = actorKey(authoritativeComment);
        const demandSummary = [
          `抖音公开评论需求信号（非已核实客户事实）：${normalizedContent}`,
          `可审计规则：${decision.reasons.join("、")}`
        ].join("\n").slice(0, 2_000);
        const ingested = await this.individualSignals.ingest({
          scope: input.scope,
          provider: DOUYIN_PUBLIC_COMMENT_PROVIDER_ID,
          sourceUrl: authoritativeEvent.sourceUrl,
          sourceType: "video",
          subject: {
            publicActorKey,
            publicDisplayName: authoritativeEvent.actor.displayName,
            publicProfileUrl: authoritativeEvent.sourceUrl,
            sourcePlatform: "douyin",
            demandCategory: "抖音公开评论需求信号",
            demandSummary,
            locationHint: authoritativeEvent.ipLabel ?? "",
            buyingStage: decision.buyingStage,
            negativeSignals: decision.negativeSignals
          },
          evidence,
          idempotencyKey: deterministicId(
            "douyin-comment-signal",
            evidenceKey
          )
        });
        candidateId = ingested.candidate.id;
        if (!seenCandidateIds.has(candidateId)) {
          seenCandidateIds.add(candidateId);
          candidateIds.push(candidateId);
        }
        if (ingested.identityResolution.status === "needs_research") {
          unresolvedActors.add(ingested.identityResolution.dedupeKey);
        }
      }

      await this.events.linkEvent({
        scope: input.scope,
        eventId: appended.event.eventId,
        observationId: appended.observation.observationId,
        runId: input.runId,
        shardId: input.shardId,
        discoveryOperationId: input.discoveryOperationId,
        candidateId,
        evidenceId: evidence.id
      });
    }

    return {
      eventCount,
      evidenceCount,
      candidateIds,
      unresolvedActorCount: unresolvedActors.size,
      strongSignalCount,
      invalidCommentCount
    };
  }
}
