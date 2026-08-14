import { createHash } from "node:crypto";

export const DOUYIN_PUBLIC_COMMENT_ENDPOINT =
  "https://www.iesdouyin.com/web/api/v2/comment/list/";
export const DOUYIN_PUBLIC_COMMENT_PROVIDER_VERSION =
  "douyin-public-comment-provider-v1";

export type DouyinPublicCommentProviderErrorCode =
  | "public_sample_unavailable"
  | "access_restricted"
  | "rate_limited"
  | "video_id_unresolved"
  | "source_payload_invalid"
  | "no_public_comments";

export class DouyinPublicCommentProviderError extends Error {
  constructor(public readonly code: DouyinPublicCommentProviderErrorCode) {
    super(code);
    this.name = "DouyinPublicCommentProviderError";
  }
}

export interface DouyinPublicComment {
  commentId: string;
  text: string;
  occurredAt: string | null;
  likeCount: number;
  replyCount: number;
  ipLabel: string | null;
  actor: {
    displayName: string | null;
    handle: string | null;
    secUid: string | null;
  };
}

export interface DouyinPublicCommentSamplePage {
  comments: DouyinPublicComment[];
  nextCursor: number | null;
  hasMore: boolean;
  reportedCommentCount: number | null;
  capturedAt: string;
  rawArtifactHash: string;
  providerVersion: typeof DOUYIN_PUBLIC_COMMENT_PROVIDER_VERSION;
  coverage: {
    duplicateCommentCount: number;
    partial: boolean;
    cursorProgressed: boolean;
  };
  replyBodiesIncluded: false;
}

export interface DouyinPublicCommentProviderPort {
  fetchTopLevelSample(input: {
    videoId: string;
    sourceUrl: string;
    cursor: number;
    count: number;
    signal?: AbortSignal;
  }): Promise<DouyinPublicCommentSamplePage>;
}

export type DouyinPublicCommentTransport = (
  url: string,
  init: RequestInit
) => Promise<Response>;

export interface DouyinPublicCommentProviderOptions {
  transport?: DouyinPublicCommentTransport;
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  now?: () => Date;
}

function normalizedHost(url: URL) {
  return url.hostname.replace(/\.$/u, "").toLocaleLowerCase("en-US");
}

function directVideoId(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const host = normalizedHost(url);
    const path = url.pathname;
    const match = (host === "douyin.com" || host.endsWith(".douyin.com"))
      ? /^\/video\/(\d+)\/?$/u.exec(path)
      : (host === "iesdouyin.com" || host.endsWith(".iesdouyin.com"))
        ? /^\/share\/video\/(\d+)\/?$/u.exec(path)
        : null;
    return match?.[1] || null;
  } catch {
    return null;
  }
}

function controlledShortLink(value: string) {
  try {
    const url = new URL(value);
    const host = normalizedHost(url);
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && !url.port
      && host === "v.douyin.com";
  } catch {
    return false;
  }
}

/**
 * Returns an ID only from the supported public video URLs. A short link can
 * contribute only when its caller supplies the final URL from the existing
 * controlled redirect resolver; this function never follows redirects itself.
 */
export function resolveDouyinVideoId(sourceUrl: string, controlledFinalUrl?: string) {
  const direct = directVideoId(sourceUrl);
  if (direct) return direct;
  return controlledFinalUrl && controlledShortLink(sourceUrl)
    ? directVideoId(controlledFinalUrl)
    : null;
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function text(value: unknown) {
  return typeof value === "string" ? value : null;
}

function nonNegativeInteger(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function occurredAt(value: unknown) {
  const seconds = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1_000).toISOString();
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeComment(value: unknown): DouyinPublicComment {
  const comment = object(value);
  const cid = text(comment?.cid);
  if (!comment || !cid) throw new DouyinPublicCommentProviderError("source_payload_invalid");
  const actor = object(comment.user) || {};
  return {
    commentId: cid,
    text: text(comment.text) || "",
    occurredAt: occurredAt(comment.create_time),
    likeCount: nonNegativeInteger(comment.digg_count),
    replyCount: nonNegativeInteger(comment.reply_comment_total),
    ipLabel: text(comment.ip_label),
    actor: {
      displayName: text(actor.nickname),
      handle: text(actor.short_id),
      secUid: text(actor.sec_uid)
    }
  };
}

function retryAfterMs(value: string | null, fallback: number) {
  if (!value) return fallback;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.floor(seconds * 1_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : fallback;
}

async function defaultSleep(delayMs: number, signal?: AbortSignal) {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason || new Error("aborted"));
    }, { once: true });
  });
}

async function requestWithRetry(
  transport: DouyinPublicCommentTransport,
  url: string,
  signal: AbortSignal | undefined,
  sleep: DouyinPublicCommentProviderOptions["sleep"]
) {
  for (let attempt = 0; attempt <= 2; attempt += 1) {
    try {
      const response = await transport(url, {
        method: "GET",
        headers: { accept: "application/json" },
        signal
      });
      if (response.status !== 429 && response.status < 500) return response;
      if (attempt === 2) {
        throw new DouyinPublicCommentProviderError(
          response.status === 429 ? "rate_limited" : "public_sample_unavailable"
        );
      }
      await (sleep || defaultSleep)(
        response.status === 429
          ? retryAfterMs(response.headers.get("retry-after"), 250 * (attempt + 1))
          : 250 * (attempt + 1),
        signal
      );
    } catch (error) {
      if (error instanceof DouyinPublicCommentProviderError) throw error;
      if (signal?.aborted || attempt === 2) {
        throw new DouyinPublicCommentProviderError("public_sample_unavailable");
      }
      await (sleep || defaultSleep)(250 * (attempt + 1), signal);
    }
  }
  throw new DouyinPublicCommentProviderError("public_sample_unavailable");
}

function responseError(status: number) {
  if (status === 401 || status === 403) return "access_restricted" as const;
  if (status === 429) return "rate_limited" as const;
  return "public_sample_unavailable" as const;
}

export function createDouyinPublicCommentProvider(
  options: DouyinPublicCommentProviderOptions = {}
): DouyinPublicCommentProviderPort {
  const transport = options.transport || ((url, init) => fetch(url, init));
  const seenCommentIds = new Map<string, Set<string>>();
  const visitedCursors = new Map<string, Set<number>>();

  return {
    async fetchTopLevelSample(input) {
      const resolvedVideoId = resolveDouyinVideoId(input.sourceUrl);
      if (!resolvedVideoId || resolvedVideoId !== input.videoId) {
        throw new DouyinPublicCommentProviderError("video_id_unresolved");
      }
      if (!Number.isInteger(input.cursor) || input.cursor < 0
        || !Number.isInteger(input.count) || input.count < 1) {
        throw new DouyinPublicCommentProviderError("source_payload_invalid");
      }
      const requestUrl = new URL(DOUYIN_PUBLIC_COMMENT_ENDPOINT);
      requestUrl.searchParams.set("aweme_id", input.videoId);
      requestUrl.searchParams.set("cursor", String(input.cursor));
      requestUrl.searchParams.set("count", String(input.count));
      const response = await requestWithRetry(
        transport,
        requestUrl.toString(),
        input.signal,
        options.sleep
      );
      if (!response.ok) {
        throw new DouyinPublicCommentProviderError(responseError(response.status));
      }
      let payload: Record<string, unknown> | null;
      try {
        payload = object(await response.json());
      } catch {
        payload = null;
      }
      if (!payload || payload.status_code !== 0 || !Array.isArray(payload.comments)) {
        throw new DouyinPublicCommentProviderError("source_payload_invalid");
      }
      if (!payload.comments.length) {
        throw new DouyinPublicCommentProviderError("no_public_comments");
      }
      const commentIds = seenCommentIds.get(input.videoId) || new Set<string>();
      seenCommentIds.set(input.videoId, commentIds);
      const comments: DouyinPublicComment[] = [];
      let duplicateCommentCount = 0;
      for (const raw of payload.comments) {
        const comment = normalizeComment(raw);
        if (commentIds.has(comment.commentId)) {
          duplicateCommentCount += 1;
          continue;
        }
        commentIds.add(comment.commentId);
        comments.push(comment);
      }
      const cursorSet = visitedCursors.get(input.videoId) || new Set<number>();
      visitedCursors.set(input.videoId, cursorSet);
      cursorSet.add(input.cursor);
      const hasMore = payload.has_more === true;
      const candidateCursor = nonNegativeInteger(payload.cursor, input.cursor);
      const cursorProgressed = !hasMore || !cursorSet.has(candidateCursor);
      const partial = hasMore && !cursorProgressed;
      if (hasMore && cursorProgressed) cursorSet.add(candidateCursor);
      return {
        comments,
        nextCursor: hasMore && cursorProgressed ? candidateCursor : null,
        hasMore: hasMore && cursorProgressed,
        reportedCommentCount: Number.isFinite(Number(payload.total))
          ? nonNegativeInteger(payload.total)
          : null,
        capturedAt: (options.now || (() => new Date()))().toISOString(),
        rawArtifactHash: sha256(JSON.stringify(payload)),
        providerVersion: DOUYIN_PUBLIC_COMMENT_PROVIDER_VERSION,
        coverage: { duplicateCommentCount, partial, cursorProgressed },
        replyBodiesIncluded: false
      };
    }
  };
}
