const tests = [
  "./manifest.self-test.ts",
  "./protocol.self-test.ts",
  "./douyin-extractor.self-test.ts",
  "./popup-model.self-test.ts",
  "./tab-guard.self-test.ts",
  "./orchestration.self-test.ts",
  "./reader-reliability.self-test.ts",
  "./content-start.self-test.ts",
  "./service-reliability.self-test.ts",
  "./restart-recovery.self-test.ts"
];

for (const test of tests) await import(test);

console.log("douyin visual reader extension self-test passed");

export {};
