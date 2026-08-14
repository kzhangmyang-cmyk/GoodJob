import assert from "node:assert/strict";
import test from "node:test";
import {
  DouyinPublicCommentProviderError,
  createDouyinPublicCommentProvider,
  resolveDouyinVideoId,
  type DouyinPublicCommentTransport
} from "./douyin-public-comment-provider.js";

const videoId = "7521000000000000000";
const sourceUrl = `https://www.douyin.com/video/${videoId}`;

function payload(comments: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    status_code: 0,
    comments,
    cursor: 10,
    has_more: false,
    total: comments.length,
    ...overrides
  };
}

function response(body: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers }
  });
}

function comment(cid: string, overrides: Record<string, unknown> = {}) {
  return {
    cid,
    text: `公开评论 ${cid}`,
    create_time: 1_725_000_000,
    digg_count: 7,
    reply_comment_total: 2,
    ip_label: "上海",
    user: {
      nickname: "公开用户",
      short_id: "public_handle",
      sec_uid: "public-sec-uid",
      avatar_thumb: { url_list: ["https://avatar.example.invalid/private.jpg"] },
      ...overrides.user as Record<string, unknown>
    },
    ...overrides
  };
}

function scriptedTransport(responses: Array<Response | Error>) {
  let calls = 0;
  const transport: DouyinPublicCommentTransport = async (url, init) => {
    calls += 1;
    const requested = new URL(url);
    assert.equal(requested.origin, "https://www.iesdouyin.com");
    assert.equal(requested.pathname, "/web/api/v2/comment/list/");
    assert.equal(requested.searchParams.has("aweme_id"), true);
    assert.equal(init.method, "GET");
    const headers = new Headers(init.headers);
    assert.equal(headers.has("cookie"), false);
    assert.equal(headers.has("authorization"), false);
    const next = responses.shift();
    if (!next) throw new Error("unexpected transport call");
    if (next instanceof Error) throw next;
    return next;
  };
  return { transport, calls: () => calls };
}

test("resolves only supported direct video URLs or a controlled short-link final URL", () => {
  assert.equal(resolveDouyinVideoId(sourceUrl), videoId);
  assert.equal(
    resolveDouyinVideoId(`https://www.iesdouyin.com/share/video/${videoId}/`),
    videoId
  );
  assert.equal(resolveDouyinVideoId("https://example.com/video/7521000000000000000"), null);
  assert.equal(
    resolveDouyinVideoId("https://v.douyin.com/abc123/", sourceUrl),
    videoId
  );
  assert.equal(
    resolveDouyinVideoId("https://example.com/short", sourceUrl),
    null
  );
});

test("normalizes an allowed top-level comment shape without avatar or login fields", async () => {
  const script = scriptedTransport([response(payload([comment("cid-1")]))]);
  const provider = createDouyinPublicCommentProvider({ transport: script.transport });

  const page = await provider.fetchTopLevelSample({
    videoId,
    sourceUrl,
    cursor: 0,
    count: 20
  });

  assert.equal(script.calls(), 1);
  assert.deepEqual(page.comments, [{
    commentId: "cid-1",
    text: "公开评论 cid-1",
    occurredAt: "2024-08-30T06:40:00.000Z",
    likeCount: 7,
    replyCount: 2,
    ipLabel: "上海",
    actor: {
      displayName: "公开用户",
      handle: "public_handle",
      secUid: "public-sec-uid"
    }
  }]);
  assert.equal(page.replyBodiesIncluded, false);
  assert.equal(page.providerVersion, "douyin-public-comment-provider-v1");
  assert.match(page.rawArtifactHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(page).includes("avatar"), false);
  assert.equal(JSON.stringify(page).toLocaleLowerCase().includes("cookie"), false);
  assert.equal(JSON.stringify(page).toLocaleLowerCase().includes("login"), false);
});

test("deduplicates repeated cid values within one page", async () => {
  const provider = createDouyinPublicCommentProvider({
    transport: scriptedTransport([response(payload([comment("cid-1"), comment("cid-1")]))]).transport
  });
  const page = await provider.fetchTopLevelSample({ videoId, sourceUrl, cursor: 0, count: 20 });
  assert.deepEqual(page.comments.map((item) => item.commentId), ["cid-1"]);
  assert.equal(page.coverage.duplicateCommentCount, 1);
});

test("deduplicates a cid already returned for the same video on an earlier page", async () => {
  const provider = createDouyinPublicCommentProvider({
    transport: scriptedTransport([
      response(payload([comment("cid-1")], { cursor: 10, has_more: true })),
      response(payload([comment("cid-1"), comment("cid-2")], { cursor: 20, has_more: false }))
    ]).transport
  });
  await provider.fetchTopLevelSample({ videoId, sourceUrl, cursor: 0, count: 20 });
  const page = await provider.fetchTopLevelSample({ videoId, sourceUrl, cursor: 10, count: 20 });
  assert.deepEqual(page.comments.map((item) => item.commentId), ["cid-2"]);
  assert.equal(page.coverage.duplicateCommentCount, 1);
});

test("stops pagination as a partial sample when the next cursor does not progress", async () => {
  const provider = createDouyinPublicCommentProvider({
    transport: scriptedTransport([
      response(payload([comment("cid-1")], { cursor: 0, has_more: true }))
    ]).transport
  });
  const page = await provider.fetchTopLevelSample({ videoId, sourceUrl, cursor: 0, count: 20 });
  assert.equal(page.nextCursor, null);
  assert.equal(page.hasMore, false);
  assert.equal(page.coverage.partial, true);
  assert.equal(page.coverage.cursorProgressed, false);
});

test("retries a 429 twice while honoring Retry-After before returning the page", async () => {
  const script = scriptedTransport([
    response({ status_code: 0 }, 429, { "retry-after": "1" }),
    response({ status_code: 0 }, 429, { "retry-after": "1" }),
    response(payload([comment("cid-1")]))
  ]);
  const delays: number[] = [];
  const provider = createDouyinPublicCommentProvider({
    transport: script.transport,
    sleep: async (delayMs) => { delays.push(delayMs); }
  });
  const page = await provider.fetchTopLevelSample({ videoId, sourceUrl, cursor: 0, count: 20 });
  assert.equal(page.comments.length, 1);
  assert.equal(script.calls(), 3);
  assert.deepEqual(delays, [1_000, 1_000]);
});

test("maps restricted, malformed, empty, and cid-less payloads to stable errors", async () => {
  const cases: Array<{ body: Response; code: DouyinPublicCommentProviderError["code"] }> = [
    { body: response({ status_code: 0 }, 403), code: "access_restricted" },
    { body: response({ status_code: 0, comments: "not-an-array" }), code: "source_payload_invalid" },
    { body: response(payload([])), code: "no_public_comments" },
    { body: response(payload([comment("", { cid: undefined })])), code: "source_payload_invalid" }
  ];
  for (const item of cases) {
    const provider = createDouyinPublicCommentProvider({
      transport: scriptedTransport([item.body]).transport
    });
    await assert.rejects(
      () => provider.fetchTopLevelSample({ videoId, sourceUrl, cursor: 0, count: 20 }),
      (error: unknown) => error instanceof DouyinPublicCommentProviderError && error.code === item.code
    );
  }
});
