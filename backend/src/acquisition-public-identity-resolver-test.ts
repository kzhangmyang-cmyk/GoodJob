import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  isSafeAcquisitionPublicActorKey,
  resolveAcquisitionPublicIdentity
} from "./acquisition-public-identity-resolver.js";

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

test("accepts only the strict unresolved opaque actor key emitted by public adapters", () => {
  const sourceUrl =
    "https://www.douyin.com/video/7536012345678909876";
  const actualAdapterKey =
    `unresolved-public-signal:douyin:sha256:${digest(sourceUrl)}`;

  assert.equal(isSafeAcquisitionPublicActorKey(actualAdapterKey), true);

  for (const malformed of [
    `unresolved-public-signals:douyin:sha256:${digest(sourceUrl)}`,
    `unresolved-public-signal::sha256:${digest(sourceUrl)}`,
    `unresolved-public-signal:douyin:mobile:sha256:${digest(sourceUrl)}`,
    `unresolved-public-signal:Douyin:sha256:${digest(sourceUrl)}`,
    `unresolved-public-signal:douyin:sha256:${digest(sourceUrl).toUpperCase()}`,
    `unresolved-public-signal:douyin:sha256:${"a".repeat(63)}`,
    `unresolved-public-signal:douyin:sha256:${"a".repeat(65)}`,
    `unresolved-public-signal:douyin:sha256:${"g".repeat(64)}`,
    `unresolved-public-signal:${"a".repeat(240)}:sha256:${"b".repeat(64)}`
  ]) {
    assert.equal(
      isSafeAcquisitionPublicActorKey(malformed),
      false,
      malformed
    );
  }
});

test("keeps an adapter unresolved key unresolved even when its URL hash matches", () => {
  const sourceUrl =
    "https://www.douyin.com/video/7536012345678909876";
  const resolution = resolveAcquisitionPublicIdentity({
    ownerId: "owner-resolver",
    teamId: "team-resolver",
    provider: "baidu_ai_search",
    sourceUrl,
    sourceType: "video",
    subject: {
      kind: "individual",
      publicActorKey:
        `unresolved-public-signal:douyin:sha256:${digest(sourceUrl)}`,
      publicProfileUrl: sourceUrl,
      sourcePlatform: "douyin"
    }
  });

  assert.equal(resolution.status, "needs_research");
  assert.equal(
    resolution.reasonCode,
    "insufficient_provider_public_actor_identity"
  );
});

test("fails closed when an opaque public actor key does not hash the normalized source URL", () => {
  const profileUrl =
    "https://www.douyin.com/user/MS4wLjABAAAAresolver";
  const resolution = resolveAcquisitionPublicIdentity({
    ownerId: "owner-resolver",
    teamId: "team-resolver",
    provider: "douyin",
    sourceUrl: profileUrl,
    sourceType: "profile",
    subject: {
      kind: "individual",
      publicActorKey:
        `public:douyin:sha256:${digest(`${profileUrl}-different`)}`,
      publicProfileUrl: profileUrl,
      sourcePlatform: "douyin"
    }
  });

  assert.equal(resolution.status, "needs_research");
  assert.equal(resolution.basis, null);
});

test("matches opaque actor hashes against the normalized public source URL", () => {
  const sourceUrl =
    "https://WWW.DOUYIN.COM/user/MS4wLjABAAAAnormalized/?b=2&a=1#public";
  const normalizedSourceUrl =
    "https://www.douyin.com/user/MS4wLjABAAAAnormalized?a=1&b=2";
  const resolution = resolveAcquisitionPublicIdentity({
    ownerId: "owner-resolver",
    teamId: "team-resolver",
    provider: "douyin",
    sourceUrl,
    sourceType: "profile",
    subject: {
      kind: "individual",
      publicActorKey:
        `public:douyin:sha256:${digest(normalizedSourceUrl)}`,
      publicProfileUrl: normalizedSourceUrl,
      sourcePlatform: "douyin"
    }
  });

  assert.equal(resolution.status, "resolved");
  assert.equal(resolution.basis, "provider_public_actor");
});
