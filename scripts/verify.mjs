import { execSync } from "node:child_process";
import { performance } from "node:perf_hooks";

console.log("\n=======================================================");
console.log("   OmniVault Unified Verification Test Harness");
console.log("=======================================================\n");

const steps = [
  {
    name: "Frontend TypeScript & Vite Production Build",
    command: "npm run build",
  },
  {
    name: "Rust Core Compilation Check (cargo check)",
    command: "cargo check --manifest-path src-tauri/Cargo.toml",
  },
  {
    name: "Rust Core Unit Test Suite (cargo test)",
    command: "cargo test --manifest-path src-tauri/Cargo.toml",
  },
  {
    name: "Structural & Design Token Integrity Assertions",
    command: "node test/baseline_test.mjs",
  },
];

let allPassed = true;
const startTime = performance.now();

for (const [index, step] of steps.entries()) {
  const stepNum = index + 1;
  process.stdout.write(`[${stepNum}/${steps.length}] Running: ${step.name}... `);
  const stepStart = performance.now();

  try {
    execSync(step.command, { stdio: "pipe", encoding: "utf-8" });
    const stepDuration = ((performance.now() - stepStart) / 1000).toFixed(2);
    console.log(`✅ PASSED (${stepDuration}s)`);
  } catch (error) {
    console.log(`❌ FAILED`);
    console.error(`\nError in step: ${step.name}`);
    if (error.stdout) console.error(error.stdout.toString());
    if (error.stderr) console.error(error.stderr.toString());
    allPassed = false;
    process.exit(1);
  }
}

const totalDuration = ((performance.now() - startTime) / 1000).toFixed(2);
console.log("\n-------------------------------------------------------");
console.log(`✅ All verification checks passed cleanly in ${totalDuration}s.`);
console.log("=======================================================\n");
