import assert from "node:assert/strict";
import {
  ACQUISITION_MODEL_CONTENT_BUNDLE,
  ACQUISITION_MODEL_PROMPT_VERSION
} from "./acquisition-model-content.js";

const copilotPrompt =
  ACQUISITION_MODEL_CONTENT_BUNDLE.promptTemplates[
    "acquisition.pi.turn.v1"
  ];
const judgmentPrompt =
  ACQUISITION_MODEL_CONTENT_BUNDLE.promptTemplates[
    "acquisition.judgment.v1"
  ];
const judgmentTools =
  ACQUISITION_MODEL_CONTENT_BUNDLE.toolSchemas[
    "acquisition.judgment.v1"
  ];

assert.equal(
  ACQUISITION_MODEL_PROMPT_VERSION,
  "acquisition-model-prompt-bundle.v2"
);
assert.match(
  copilotPrompt ?? "",
  /企业公开需求[\s\S]*个人公开经营需求/
);
assert.match(
  copilotPrompt ?? "",
  /至少两个独立信号/
);
assert.match(
  copilotPrompt ?? "",
  /意向资格[\s\S]*财务价值[\s\S]*客户作战卡[\s\S]*人工审核/
);
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
