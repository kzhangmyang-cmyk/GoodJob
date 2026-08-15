const tests = [
  "./manifest.self-test.ts",
  "./protocol.self-test.ts",
  "./douyin-extractor.self-test.ts",
  "./popup-model.self-test.ts",
  "./orchestration.self-test.ts"
];

for (const test of tests) await import(test);

console.log("douyin visual reader extension self-test passed");

export {};
