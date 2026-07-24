import assert from "node:assert/strict";
import {
  ACQUISITION_MODEL_CONTENT_BUNDLE
} from "./acquisition-model-content.js";

const judgmentPrompt =
  ACQUISITION_MODEL_CONTENT_BUNDLE.promptTemplates[
    "acquisition.judgment.v1"
  ];
const judgmentTools =
  ACQUISITION_MODEL_CONTENT_BUNDLE.toolSchemas[
    "acquisition.judgment.v1"
  ];

assert.match(
  judgmentPrompt ?? "",
  /事实[\s\S]*推断[\s\S]*未知/
);
assert.match(
  judgmentPrompt ?? "",
  /最小货币单位[\s\S]*基点/
);
assert.deepEqual(
  judgmentTools?.map((tool) => tool.name),
  ["__goodjob_submit_acquisition_judgment"]
);
assert.equal(
  Array.isArray(judgmentTools?.[0]?.parameters.oneOf),
  true
);

console.log("acquisition model content tests passed");
