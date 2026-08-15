import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
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
    const releaseOptions = {
      templateUrl,
      originsLiteral: "https://crm.goodjob.example",
      release: true
    } as const;
    const validManifest = await renderVisualReaderManifest(releaseOptions);
    await writeFile(join(root, "manifest.json"), JSON.stringify(validManifest));
    await writeFile(join(root, "service-worker.js"), "globalThis.chrome.runtime.onMessage.addListener(() => undefined);\n");
    await writeFile(join(root, "goodjob-bridge-content.js"), "globalThis.addEventListener('message', () => undefined);\n");
    await writeFile(join(root, "douyin-content.js"), "globalThis.addEventListener('scroll', () => undefined);\n");
    await writeFile(join(root, "popup.js"), "globalThis.document.addEventListener('DOMContentLoaded', () => undefined);\n");
    await writeFile(join(root, "popup.html"), "<!doctype html><script type=\"module\" src=\"./popup.js\"></script>");
    await writeFile(join(root, "popup.css"), "body{color:#173d33}");
    const report = await auditVisualReaderBundle(root, releaseOptions);
    assert.deepEqual(report, { files: 7, forbiddenFindings: [] });
    const validCheck = spawnSync("npm", ["run", "check:visual-reader-bundle"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        VISUAL_READER_DIST_DIR: root,
        VISUAL_READER_RELEASE: "1",
        GOODJOB_APP_ORIGINS: "https://crm.goodjob.example"
      },
      encoding: "utf8"
    });
    assert.equal(validCheck.status, 0,
      "the read-only command accepts a release manifest rendered from this exact template and origin");
    await writeFile(join(root, "service-worker.js"), "fetch('https://remote.example/api')\n//# sourceMappingURL=x.map");
    await assert.rejects(() => auditVisualReaderBundle(root, releaseOptions), /远程网络|source map/u);
    const parsed = structuredClone(validManifest);
    parsed.permissions.push("cookies");
    await writeFile(join(root, "manifest.json"), JSON.stringify(parsed));
    await assert.rejects(() => auditVisualReaderBundle(root, releaseOptions), /禁止权限/u);
    await writeFile(join(root, "service-worker.js"), "globalThis.chrome.runtime.onMessage.addListener(() => undefined);\n");

    const tamperedManifests: Array<[string, Record<string, unknown>]> = [
      ["evil but syntactically specific origin", {
        ...structuredClone(validManifest),
        content_scripts: [{
          ...structuredClone(validManifest.content_scripts?.[0]),
          matches: ["https://evil.example/*"]
        }]
      }],
      ["remote CSP", {
        ...structuredClone(validManifest),
        content_security_policy: {
          extension_pages: "script-src 'self' https://evil.example; object-src 'self'"
        }
      }],
      ["optional permission", {
        ...structuredClone(validManifest),
        optional_permissions: ["cookies"]
      }],
      ["changed content script", {
        ...structuredClone(validManifest),
        content_scripts: [{
          ...structuredClone(validManifest.content_scripts?.[0]),
          js: ["goodjob-bridge-content.js", "evil.js"]
        }]
      }]
    ];
    for (const [name, tampered] of tamperedManifests) {
      await writeFile(join(root, "manifest.json"), JSON.stringify(tampered));
      await assert.rejects(
        () => auditVisualReaderBundle(root, releaseOptions),
        /manifest|权限|origin|CSP|content-script/iu,
        name
      );
    }

    const commandTamper = tamperedManifests[0][1];
    await writeFile(join(root, "manifest.json"), JSON.stringify(commandTamper));
    const checked = spawnSync("npm", ["run", "check:visual-reader-bundle"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        VISUAL_READER_DIST_DIR: root,
        VISUAL_READER_RELEASE: "1",
        GOODJOB_APP_ORIGINS: "https://crm.goodjob.example"
      },
      encoding: "utf8"
    });
    assert.notEqual(checked.status, 0, "the check command rejects an already-tampered manifest");
    const afterCheck = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
    assert.deepEqual(afterCheck, commandTamper, "check is read-only and cannot repair evidence");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

console.log("douyin visual reader manifest self-test passed");
