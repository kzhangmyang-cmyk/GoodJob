import assert from "node:assert/strict";
import { test } from "node:test";
import XLSX from "xlsx-js-style";
import type { DiscoveryEvidenceInput } from "./acquisition-domain.js";
import {
  AcquisitionDiscoveryOperationError,
  AcquisitionDiscoveryOperationService,
  ControlledPublicContentFetcher,
  InMemoryAcquisitionDiscoveryOperationRepository
} from "./acquisition-discovery-operations.js";
import { setProviderHttpTestTransport } from "./provider-http-client.js";

process.env.NODE_ENV = "test";

const NOW = "2026-07-24T08:00:00.000Z";
const scope = {
  ownerId: "owner-a",
  teamId: "team-a",
  actorId: "user-a"
};

function evidenceSink() {
  const appended: Array<{
    scope: typeof scope;
    input: DiscoveryEvidenceInput;
    idempotencyKey: string;
  }> = [];
  return {
    appended,
    port: {
      async appendEvidence(
        actualScope: typeof scope,
        input: DiscoveryEvidenceInput,
        idempotencyKey: string
      ) {
        appended.push({
          scope: structuredClone(actualScope),
          input: structuredClone(input),
          idempotencyKey
        });
        return {
          ...input,
          id: `evidence-${appended.length}`,
          ownerId: actualScope.ownerId,
          teamId: actualScope.teamId,
          supersedesEvidenceId: input.supersedesEvidenceId ?? null,
          fetchedAt: NOW
        };
      }
    }
  };
}

function serviceFixture(input: {
  fetch?: (sourceUrl: string) => Promise<{
    finalUrl: string;
    status: "succeeded" | "access_restricted";
    accessStatus: "public_content" | "access_restricted";
    httpStatus: number;
    contentType: string;
    title: string;
    text: string;
    rawArtifactHash: string;
    contentHash: string;
  }>;
} = {}) {
  const sink = evidenceSink();
  const repository =
    new InMemoryAcquisitionDiscoveryOperationRepository();
  const service = new AcquisitionDiscoveryOperationService({
    repository,
    evidence: sink.port,
    fetcher: {
      fetch: input.fetch ?? (async (sourceUrl) => ({
        finalUrl: sourceUrl,
        status: "succeeded",
        accessStatus: "public_content",
        httpStatus: 200,
        contentType: "text/html; charset=utf-8",
        title: "公开采购需求",
        text: "某制造企业正在公开寻找 CRM 与获客系统供应商。",
        rawArtifactHash: `sha256:${"a".repeat(64)}`,
        contentHash: `sha256:${"b".repeat(64)}`
      }))
    },
    masterSecret:
      "goodjob-discovery-operation-test-secret-at-least-32-bytes",
    idFactory: (prefix) => `${prefix}-${repository.size(prefix) + 1}`,
    now: () => NOW
  });
  return { service, repository, sink };
}

test("content fetch operation is idempotent, tenant scoped, and appends public evidence", async () => {
  const fixture = serviceFixture();
  const created = await fixture.service.createContentFetchOperation(
    scope,
    {
      sourceUrl: "https://example.com/public-opportunity",
      subjectChannel: "organization"
    },
    "fetch-key-1"
  );
  assert.equal(created.status, "queued");
  assert.equal(created.ownerId, scope.ownerId);

  const duplicate = await fixture.service.createContentFetchOperation(
    scope,
    {
      sourceUrl: "https://example.com/public-opportunity",
      subjectChannel: "organization"
    },
    "fetch-key-1"
  );
  assert.equal(duplicate.id, created.id);

  await assert.rejects(
    fixture.service.createContentFetchOperation(
      scope,
      {
        sourceUrl: "https://example.com/different",
        subjectChannel: "organization"
      },
      "fetch-key-1"
    ),
    (error: unknown) =>
      error instanceof AcquisitionDiscoveryOperationError
      && error.code === "IDEMPOTENCY_CONFLICT"
  );

  const completed = await fixture.service.executeContentFetchOperation(
    scope,
    created.id
  );
  assert.equal(completed.status, "succeeded");
  assert.equal(completed.accessStatus, "public_content");
  assert.equal(completed.evidenceCount, 1);
  assert.match(completed.contentHash ?? "", /^sha256:[a-f0-9]{64}$/);
  assert.equal(fixture.sink.appended.length, 1);
  assert.deepEqual(
    fixture.sink.appended[0]?.input.provenance,
    {
      kind: "user_submitted_url",
      sourceUrl: "https://example.com/public-opportunity",
      submittedBy: scope.actorId
    }
  );

  const replay = await fixture.service.executeContentFetchOperation(
    scope,
    created.id
  );
  assert.equal(replay.status, "succeeded");
  assert.equal(fixture.sink.appended.length, 1);

  await assert.rejects(
    fixture.service.getContentFetchOperation(
      { ...scope, ownerId: "owner-b" },
      created.id
    ),
    (error: unknown) =>
      error instanceof AcquisitionDiscoveryOperationError
      && error.code === "RESOURCE_NOT_FOUND"
  );
});

test("content fetch operation listing is tenant scoped, limited, and newest first", async () => {
  const fixture = serviceFixture();
  const first = await fixture.service.createContentFetchOperation(
    scope,
    {
      sourceUrl: "https://example.com/first",
      subjectChannel: "organization"
    },
    "fetch-list-key-1"
  );
  await fixture.service.createContentFetchOperation(
    {
      ownerId: "owner-b",
      teamId: scope.teamId,
      actorId: "user-b"
    },
    {
      sourceUrl: "https://example.com/foreign",
      subjectChannel: "organization"
    },
    "fetch-list-key-foreign"
  );
  const latest = await fixture.service.createContentFetchOperation(
    scope,
    {
      sourceUrl: "https://example.com/latest",
      subjectChannel: "individual"
    },
    "fetch-list-key-2"
  );

  const listed = await fixture.service.listContentFetchOperations(
    scope,
    { limit: 1 }
  );

  assert.deepEqual(listed.map((operation) => operation.id), [latest.id]);
  assert.notEqual(listed[0]?.id, first.id);
  assert.equal(listed[0]?.ownerId, scope.ownerId);
  assert.equal(
    "idempotencyKeyHash" in (listed[0] ?? {}),
    false
  );
});

test("access restricted content is recorded honestly and never presented as fetched content", async () => {
  const fixture = serviceFixture({
    fetch: async (sourceUrl) => ({
      finalUrl: sourceUrl,
      status: "access_restricted",
      accessStatus: "access_restricted",
      httpStatus: 403,
      contentType: "text/html",
      title: "",
      text: "",
      rawArtifactHash: `sha256:${"c".repeat(64)}`,
      contentHash: `sha256:${"d".repeat(64)}`
    })
  });
  const created = await fixture.service.createContentFetchOperation(
    scope,
    {
      sourceUrl: "https://example.com/login-required",
      subjectChannel: "individual"
    },
    "fetch-key-restricted"
  );
  const completed = await fixture.service.executeContentFetchOperation(
    scope,
    created.id
  );
  assert.equal(completed.status, "access_restricted");
  assert.equal(completed.accessStatus, "access_restricted");
  assert.equal(completed.evidenceCount, 1);
  assert.equal(
    fixture.sink.appended[0]?.input.accessStatus,
    "access_restricted"
  );
  assert.match(
    fixture.sink.appended[0]?.input.sourceSnippet ?? "",
    /限制访问/
  );
});

test("unexpected fetch failures persist the content-fetch fallback code", async () => {
  const fixture = serviceFixture({
    fetch: async () => {
      throw new Error("unexpected upstream failure");
    }
  });
  const created = await fixture.service.createContentFetchOperation(
    scope,
    {
      sourceUrl: "https://example.com/unavailable",
      subjectChannel: "organization"
    },
    "fetch-key-unexpected-failure"
  );

  await assert.rejects(
    fixture.service.executeContentFetchOperation(scope, created.id)
  );
  const failed = await fixture.service.getContentFetchOperation(
    scope,
    created.id
  );

  assert.equal(failed.status, "failed");
  assert.equal(failed.errorCode, "CONTENT_FETCH_FAILED");
});

test("import operation accepts raw bytes and lists only the newest tenant records", async () => {
  const fixture = serviceFixture();
  const csv = new TextEncoder().encode(
    "标题,摘要\r\n公开商机,客户正在寻找 CRM"
  );
  const first = await fixture.service.createImportOperation(
    scope,
    {
      fileName: "first.csv",
      mediaType: "text/csv",
      content: csv,
      subjectChannel: "organization",
      columnMapping: {
        sourceTitle: "标题",
        sourceSnippet: "摘要"
      }
    },
    "import-list-key-1"
  );
  await fixture.service.createImportOperation(
    {
      ownerId: "owner-b",
      teamId: scope.teamId,
      actorId: "user-b"
    },
    {
      fileName: "foreign.csv",
      mediaType: "text/csv",
      content: csv,
      subjectChannel: "organization",
      columnMapping: {
        sourceTitle: "标题",
        sourceSnippet: "摘要"
      }
    },
    "import-list-key-foreign"
  );
  const latest = await fixture.service.createImportOperation(
    scope,
    {
      fileName: "latest.csv",
      mediaType: "text/csv",
      content: csv,
      subjectChannel: "individual",
      columnMapping: {
        sourceTitle: "标题",
        sourceSnippet: "摘要"
      }
    },
    "import-list-key-2"
  );

  const listed = await fixture.service.listImportOperations(
    scope,
    { limit: 1 }
  );

  assert.deepEqual(listed.map((operation) => operation.id), [latest.id]);
  assert.notEqual(listed[0]?.id, first.id);
  assert.equal(listed[0]?.ownerId, scope.ownerId);
  assert.equal("artifactCiphertext" in (listed[0] ?? {}), false);
  assert.equal("columnMapping" in (listed[0] ?? {}), false);
});

test("CSV import preserves artifact and row provenance with partial row errors", async () => {
  const fixture = serviceFixture();
  const csv = [
    "\ufeff标题,摘要,平台,链接,时间,语言",
    "\"采购 CRM\",\"希望本月比较三家供应商\",百度,https://example.cn/a,2026-07-20T00:00:00.000Z,zh-CN",
    "\"缺少摘要\",,百度,https://example.cn/b,,zh-CN",
    "\"带逗号的标题\",\"预算约 10 万, 要求私有化\",官网,https://example.cn/c,,zh-CN"
  ].join("\r\n");
  const created = await fixture.service.createImportOperation(
    scope,
    {
      fileName: "公开商机.csv",
      mediaType: "text/csv",
      contentBase64: Buffer.from(csv).toString("base64"),
      subjectChannel: "organization",
      columnMapping: {
        sourceTitle: "标题",
        sourceSnippet: "摘要",
        sourcePlatform: "平台",
        sourceUrl: "链接",
        publishedAt: "时间",
        locale: "语言"
      }
    },
    "import-key-csv"
  );
  assert.equal(created.status, "queued");
  assert.match(created.artifactHash, /^sha256:[a-f0-9]{64}$/);

  const completed = await fixture.service.executeImportOperation(
    scope,
    created.id
  );
  assert.equal(completed.status, "partial_success");
  assert.equal(completed.rowCount, 3);
  assert.equal(completed.acceptedRowCount, 2);
  assert.equal(completed.errorRows.length, 1);
  assert.equal(completed.errorRows[0]?.rowNumber, 3);
  assert.equal(fixture.sink.appended.length, 2);
  assert.deepEqual(
    fixture.sink.appended[1]?.input.provenance,
    {
      kind: "import_artifact_row",
      importBatchId: created.id,
      artifactHash: created.artifactHash,
      sheetName: "CSV",
      rowNumber: 4
    }
  );
  assert.match(
    fixture.sink.appended[1]?.input.sourceSnippet ?? "",
    /预算约 10 万, 要求私有化/
  );

  const replay = await fixture.service.executeImportOperation(
    scope,
    created.id
  );
  assert.equal(replay.acceptedRowCount, 2);
  assert.equal(fixture.sink.appended.length, 2);
});

test("XLSX import reads bounded worksheets and keeps sheet provenance", async () => {
  const fixture = serviceFixture();
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["标题", "摘要", "平台", "语言"],
    ["寻找获客系统", "连锁门店计划近期采购", "客户授权表", "zh-CN"]
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, "线索");
  const buffer = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx"
  }) as Buffer;

  const created = await fixture.service.createImportOperation(
    scope,
    {
      fileName: "公开商机.xlsx",
      mediaType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      contentBase64: buffer.toString("base64"),
      subjectChannel: "individual",
      columnMapping: {
        sourceTitle: "标题",
        sourceSnippet: "摘要",
        sourcePlatform: "平台",
        locale: "语言"
      }
    },
    "import-key-xlsx"
  );
  const completed = await fixture.service.executeImportOperation(
    scope,
    created.id
  );
  assert.equal(completed.status, "succeeded");
  assert.equal(completed.rowCount, 1);
  assert.equal(completed.acceptedRowCount, 1);
  assert.deepEqual(
    fixture.sink.appended[0]?.input.provenance,
    {
      kind: "import_artifact_row",
      importBatchId: created.id,
      artifactHash: created.artifactHash,
      sheetName: "线索",
      rowNumber: 2
    }
  );
  assert.equal(
    fixture.sink.appended[0]?.input.targetType,
    "individual_signal"
  );
});

test("controlled content fetcher blocks unsafe URLs and parses bounded public HTML", async () => {
  const fetcher = new ControlledPublicContentFetcher({
    maxResponseBytes: 32 * 1024,
    timeoutMs: 1_000
  });
  await assert.rejects(
    fetcher.fetch("http://example.com/plain-http"),
    (error: unknown) =>
      error instanceof AcquisitionDiscoveryOperationError
      && error.code === "UNSAFE_SOURCE_URL"
  );
  await assert.rejects(
    fetcher.fetch("https://127.0.0.1/private"),
    (error: unknown) =>
      error instanceof AcquisitionDiscoveryOperationError
      && error.code === "UNSAFE_SOURCE_URL"
  );

  setProviderHttpTestTransport(async () => new Response(
    "<html><head><title>公开 商机</title><style>hidden</style></head>"
      + "<body><script>secret()</script><h1>采购需求</h1>"
      + "<p>需要对比 AI 获客系统。</p></body></html>",
    {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" }
    }
  ));
  try {
    const result = await fetcher.fetch(
      "https://public.example.com/opportunity"
    );
    assert.equal(result.status, "succeeded");
    assert.equal(result.title, "公开 商机");
    assert.match(result.text, /采购需求/);
    assert.doesNotMatch(result.text, /secret/);
    assert.match(result.rawArtifactHash, /^sha256:[a-f0-9]{64}$/);
    assert.match(result.contentHash, /^sha256:[a-f0-9]{64}$/);
  } finally {
    setProviderHttpTestTransport(null);
  }
});
