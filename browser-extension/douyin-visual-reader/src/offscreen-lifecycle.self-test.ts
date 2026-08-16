import { strict as assert } from "node:assert";
import {
  createOffscreenCaptureLifecycle,
  createSensitiveResourceScope,
  runPreparedOcr
} from "./offscreen-lifecycle";

{
  const lifecycle = createOffscreenCaptureLifecycle();
  let releases = 0;
  const first = lifecycle.begin(0, () => { releases += 1; });
  assert.ok(first);
  assert.equal(lifecycle.active(first), true);
  lifecycle.end(0);
  assert.equal(releases, 1, "session end actively releases in-flight raw resources");
  assert.equal(lifecycle.active(first), false);
  assert.equal(lifecycle.begin(0, () => { releases += 1; }), null,
    "a late process message from the ended generation is rejected");
  const replacement = lifecycle.begin(1, () => { releases += 1; });
  assert.ok(replacement, "the next runtime generation can prepare a capture");
  lifecycle.finish(replacement);
  lifecycle.end(1);
  assert.equal(releases, 1, "finished capture resources are not released twice");
}

{
  const lifecycle = createOffscreenCaptureLifecycle();
  const resources = createSensitiveResourceScope();
  let rawScreenshot: string | null = "data:image/png;base64,full-tab";
  const pixels = resources.track(new Uint8ClampedArray([9, 8, 7, 255]), (value) => value.fill(0));
  const scratchCanvas = resources.track({ width: 800, height: 360 }, (value) => {
    value.width = 1;
    value.height = 1;
  });
  let finishEncode: (() => void) | null = null;
  const token = lifecycle.begin(0, () => {
    rawScreenshot = null;
    resources.disposeAll();
  });
  assert.ok(token);
  const encoding = new Promise<void>((resolve) => { finishEncode = resolve; });
  lifecycle.end(0);
  assert.equal(rawScreenshot, null,
    "end clears the full-tab PNG reference while an encoder is pending");
  assert.deepEqual(Array.from(pixels), [0, 0, 0, 0],
    "end zeroes encoder scratch pixels while an encoder is pending");
  assert.deepEqual(scratchCanvas, { width: 1, height: 1 },
    "end releases encoder scratch canvases while an encoder is pending");
  const finish = finishEncode as (() => void) | null;
  if (!finish) throw new Error("missing deferred encoder resolver");
  finish();
  await encoding;
}

{
  const recreated = createOffscreenCaptureLifecycle();
  recreated.synchronize(3);
  assert.equal(recreated.begin(2, () => undefined), null,
    "a recreated offscreen document rejects delayed messages older than the service-worker generation");
  assert.ok(recreated.begin(3, () => undefined));
}

{
  const order: string[] = [];
  const result = await runPreparedOcr({
    prepare: async () => { order.push("prepare"); return { bytes: new Uint8Array([1]) }; },
    releaseRaw: () => { order.push("release-raw"); },
    recognize: async (prepared) => {
      order.push("recognize");
      assert.deepEqual(Array.from(prepared.bytes), [1]);
      return "recognized";
    },
    releasePrepared: (prepared) => { prepared.bytes.fill(0); order.push("release-redacted"); }
  });
  assert.equal(result, "recognized");
  assert.deepEqual(order, ["prepare", "release-raw", "recognize", "release-redacted"],
    "raw screenshot/image/full-canvas resources are released before OCR can wait or hang");
}

{
  let rawReleased = false;
  await assert.rejects(() => runPreparedOcr({
    prepare: async () => { throw new Error("decode failed"); },
    releaseRaw: () => { rawReleased = true; },
    recognize: async () => "unreachable",
    releasePrepared: () => undefined
  }), /decode failed/u);
  assert.equal(rawReleased, true, "decode/crop failure still releases every raw resource");
}

{
  let preparedReleased = false;
  await assert.rejects(() => runPreparedOcr({
    prepare: async () => ({ bytes: new Uint8Array([2]) }),
    releaseRaw: () => undefined,
    recognize: async () => { throw new Error("OCR failed"); },
    releasePrepared: (prepared) => { prepared.bytes.fill(0); preparedReleased = true; }
  }), /OCR failed/u);
  assert.equal(preparedReleased, true, "OCR failure releases the redacted bytes");
}

console.log("offscreen lifecycle self-test passed");
