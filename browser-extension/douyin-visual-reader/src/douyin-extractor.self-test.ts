import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";
import {
  extractVisibleTopLevelComments,
  findExactReadOnlyAction,
  type DouyinDomAdapter
} from "./douyin-extractor";

const fixtureRoot = new URL("../fixtures/", import.meta.url);

async function fixture(name: string) {
  const html = await readFile(new URL(name, fixtureRoot), "utf8");
  return parseHTML(html).document;
}

function adapter(document: Document): DouyinDomAdapter {
  return {
    queryAll: (root, selector) => Array.from(root.querySelectorAll(selector)),
    role: (element) => element.getAttribute("role"),
    accessibleName: (element) => element.getAttribute("aria-label")?.trim() ?? "",
    innerText: (element) => (element as HTMLElement).innerText.trim(),
    attribute: (element, name) => element.getAttribute(name),
    parent: (element) => element.parentElement,
    visible: (element) => !element.hasAttribute("hidden"),
    bounds: (element) => {
      const literal = element.getAttribute("data-fixture-bounds");
      if (!literal) return { x: 0, y: 0, width: 0, height: 0 };
      const [x, y, width, height] = literal.split(",").map(Number);
      return { x, y, width, height };
    },
    viewport: () => ({ width: 1440, height: 900, deviceScaleFactor: 2 }),
    now: () => new Date("2026-08-15T08:00:00.000Z")
  };
}

async function extract(name: string, sourceUrl = "https://www.douyin.com/video/123456789") {
  const document = await fixture(name);
  return extractVisibleTopLevelComments({ document, adapter: adapter(document), sourceUrl });
}

{
  const result = await extract("normal.html");
  assert.equal(result.status, "ok");
  assert.equal(result.observations.length, 1);
  assert.deepEqual(result.observations[0], {
    clientObservationKey: "dom:207a2465da707950c36164288d5e426e",
    sourceUrl: "https://www.douyin.com/video/123456789",
    videoId: "123456789",
    visibleText: "正在寻找可以长期合作的获客方案",
    displayName: "林经理",
    visibleTimeText: "1小时前",
    likeCount: 12,
    replyCount: 3,
    platformCommentId: "987654321",
    publicProfileUrl: "https://www.douyin.com/user/MS4wLjABAAAA",
    secUid: "MS4wLjABAAAA",
    extractionMethod: "dom",
    fieldConfidences: {
      visibleText: 0.99,
      displayName: 0.96,
      visibleTimeText: 0.95,
      likeCount: 0.94,
      replyCount: 0.94,
      platformCommentId: 0.98,
      publicProfileUrl: 0.98,
      secUid: 0.98
    },
    viewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
    cardBounds: { x: 720, y: 220, width: 520, height: 140 },
    readerVersion: "goodjob-visual-reader/1.0.0",
    capturedAt: "2026-08-15T08:00:00.000Z",
    redactedCrop: null
  });
}

{
  const document = await fixture("normal.html");
  const base = adapter(document);
  const result = await extractVisibleTopLevelComments({
    document,
    sourceUrl: "https://www.douyin.com/video/123456789",
    adapter: {
      ...base,
      bounds: (element) => element.getAttribute("role") === "article"
        ? { x: -20, y: -10, width: 200, height: 100 }
        : base.bounds(element),
      viewport: () => ({ width: 100, height: 80, deviceScaleFactor: 2 })
    }
  });
  assert.deepEqual(result.observations[0]?.cardBounds, {
    x: 0, y: 0, width: 100, height: 80
  }, "partially visible cards are clamped to protocol-safe viewport bounds");
}

{
  const missingName = await extract("missing-name.html");
  assert.equal(missingName.observations[0]?.displayName, null);
  assert.equal(missingName.observations[0]?.publicProfileUrl, null);
  assert.equal(missingName.observations[0]?.secUid, null);
  const missingId = await extract("missing-id.html");
  assert.equal(missingId.observations[0]?.platformCommentId, null);
  assert.match(missingId.observations[0]?.clientObservationKey ?? "", /^dom:[0-9a-f]{64}$/u);
}

{
  const document = await fixture("missing-id.html");
  const base = adapter(document);
  const first = await extractVisibleTopLevelComments({
    document,
    adapter: base,
    sourceUrl: "https://www.douyin.com/video/123456789"
  });
  const moved = await extractVisibleTopLevelComments({
    document,
    adapter: {
      ...base,
      bounds: (element) => element.getAttribute("role") === "article"
        ? { x: 120, y: 420, width: 640, height: 180 }
        : base.bounds(element)
    },
    sourceUrl: "https://www.douyin.com/video/123456789"
  });
  assert.equal(
    moved.observations[0]?.clientObservationKey,
    first.observations[0]?.clientObservationKey,
    "a comment without a platform ID keeps its digest when the virtual card moves"
  );
  const body = document.querySelector('[aria-label="评论内容"]');
  assert.ok(body);
  body.textContent = "同一个位置换成一条新评论";
  const replaced = await extractVisibleTopLevelComments({
    document,
    adapter: base,
    sourceUrl: "https://www.douyin.com/video/123456789"
  });
  assert.notEqual(
    replaced.observations[0]?.clientObservationKey,
    first.observations[0]?.clientObservationKey,
    "a new visible comment at the same position gets a different digest"
  );
}

{
  const reply = await extract("reply.html");
  assert.equal(reply.observations.length, 1);
  assert.equal(reply.observations[0]?.visibleText, "一级评论正文");
  assert.doesNotMatch(JSON.stringify(reply), /二级回复/u);
  assert.equal((await extract("ad.html")).observations.length, 0);
}

for (const [name, reason] of [
  ["login.html", "login_required"],
  ["captcha.html", "captcha_present"],
  ["security.html", "security_verification"],
  ["selector-drift.html", "selector_drift"]
] as const) {
  const result = await extract(name);
  assert.equal(result.status, "blocked");
  assert.equal(result.reason, reason);
  assert.equal(result.observations.length, 0);
}

{
  const folded = await fixture("folded.html");
  const action = findExactReadOnlyAction(folded, adapter(folded));
  assert.equal(action.status, "one");
  assert.equal(action.accessibleName, "展开");
  const ambiguous = await fixture("ambiguous-action.html");
  assert.deepEqual(findExactReadOnlyAction(ambiguous, adapter(ambiguous)), {
    status: "ambiguous",
    accessibleName: null,
    element: null
  });
}

{
  const forbidden = await extract("forbidden-content.html");
  const serialized = JSON.stringify(forbidden);
  assert.equal(forbidden.observations[0]?.visibleText, "唯一允许的可见正文");
  assert.equal(forbidden.observations[0]?.publicProfileUrl, null);
  assert.doesNotMatch(serialized, /avatar|secret|脚本内部|data-react|javascript:/u);
}

{
  const document = await fixture("virtual-node-reuse.html");
  const first = await extractVisibleTopLevelComments({
    document,
    adapter: adapter(document),
    sourceUrl: "https://www.douyin.com/video/123456789"
  });
  const result = first;
  assert.equal(new Set(result.observations.map((item) => item.clientObservationKey)).size, 2);
  assert.deepEqual(result.observations.map((item) => item.platformCommentId), ["1001", "1002"]);
  const reused = document.querySelector('#comment-1001');
  assert.ok(reused);
  reused.id = "comment-1003";
  const body = reused.querySelector('[aria-label="评论内容"]');
  assert.ok(body);
  body.textContent = "虚拟列表复用了同一个节点";
  const second = await extractVisibleTopLevelComments({
    document,
    adapter: adapter(document),
    sourceUrl: "https://www.douyin.com/video/123456789"
  });
  assert.notEqual(second.observations[0]?.clientObservationKey, first.observations[0]?.clientObservationKey);
  assert.equal(second.observations[0]?.platformCommentId, "1003");
}

await assert.rejects(
  () => extract("normal.html", "https://www.douyin.com/video/123456789?modal=1"),
  /抖音视频地址无效/u
);

console.log("douyin visual reader extractor self-test passed");
