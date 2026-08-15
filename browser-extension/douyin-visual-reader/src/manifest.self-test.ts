import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  auditVisualReaderBundle,
  renderVisualReaderManifest
} from "../../../scripts/build-visual-reader-manifest.mts";

const templateUrl = new URL("../manifest.template.json", import.meta.url);

{
  const manifest = await renderVisualReaderManifest({
    templateUrl,
    originsLiteral: undefined,
    release: false
  });
  assert.deepEqual(manifest.permissions, ["activeTab", "scripting", "storage", "offscreen"]);
  assert.deepEqual(manifest.host_permissions, ["https://www.douyin.com/*"]);
  assert.deepEqual(manifest.content_scripts?.[0]?.matches, ["http://127.0.0.1:5191/*"]);
  assert.equal(manifest.background?.type, "module");
  assert.equal(manifest.action?.default_popup, "popup.html");
}

{
  const manifest = await renderVisualReaderManifest({
    templateUrl,
    originsLiteral: "https://crm.goodjob.example,https://growth.goodjob.example",
    release: true
  });
  assert.deepEqual(manifest.content_scripts?.[0]?.matches, [
    "https://crm.goodjob.example/*",
    "https://growth.goodjob.example/*"
  ]);
}

await assert.rejects(
  () => renderVisualReaderManifest({ templateUrl, originsLiteral: undefined, release: true }),
  /发布构建必须显式配置 HTTPS GoodJob origin/u
);
for (const originsLiteral of [
  "https://*/*",
  "https://goodjob.example/path",
  "http://goodjob.example",
  "https://user:pass@goodjob.example",
  "<all_urls>"
]) {
  await assert.rejects(
    () => renderVisualReaderManifest({ templateUrl, originsLiteral, release: true }),
    /GoodJob origin/u
  );
}

{
  const root = await mkdtemp(join(tmpdir(), "goodjob-visual-reader-"));
  try {
    await writeFile(join(root, "manifest.json"), JSON.stringify(await renderVisualReaderManifest({
      templateUrl,
      originsLiteral: "https://crm.goodjob.example",
      release: true
    })));
    await writeFile(join(root, "service-worker.js"), "globalThis.chrome.runtime.onMessage.addListener(() => undefined);\n");
    await writeFile(join(root, "goodjob-bridge-content.js"), "globalThis.addEventListener('message', () => undefined);\n");
    await writeFile(join(root, "douyin-content.js"), "globalThis.addEventListener('scroll', () => undefined);\n");
    await writeFile(join(root, "popup.js"), "globalThis.document.addEventListener('DOMContentLoaded', () => undefined);\n");
    await writeFile(join(root, "popup.html"), "<!doctype html><script type=\"module\" src=\"./popup.js\"></script>");
    await writeFile(join(root, "popup.css"), "body{color:#173d33}");
    const report = await auditVisualReaderBundle(root);
    assert.deepEqual(report, { files: 7, forbiddenFindings: [] });
    await writeFile(join(root, "service-worker.js"), "fetch('https://remote.example/api')\n//# sourceMappingURL=x.map");
    await assert.rejects(() => auditVisualReaderBundle(root), /远程网络|source map/u);
    const parsed = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
    parsed.permissions.push("cookies");
    await writeFile(join(root, "manifest.json"), JSON.stringify(parsed));
    await assert.rejects(() => auditVisualReaderBundle(root), /禁止权限/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

console.log("douyin visual reader manifest self-test passed");
