/* eslint-disable no-console */
const { spawnSync } = require('child_process');

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
  return result.status === 0;
}

const checks = [
  {
    name: 'Prompt contract + family overrides',
    command: 'npm',
    args: [
      'exec',
      'vitest',
      'run',
      'src/agent/prompts/PromptBuilder.test.ts',
      'src/agent/prompts/families/index.test.ts'
    ]
  },
  {
    name: 'Resilience flow + service classifiers',
    command: 'npm',
    args: [
      'exec',
      'vitest',
      'run',
      'src/services/OpenRouterService.test.ts',
      'src/views/chat/handlers/ChatFlowManager.test.ts',
      'src/views/chat/toolcall/ToolCallManager.test.ts',
      'src/views/chat/validation/MessageValidator.test.ts'
    ]
  },
  {
    name: 'Resilience runtime engines',
    command: 'npm',
    args: [
      'exec',
      'vitest',
      'run',
      'src/views/chat/runtime/TurnEngine.test.ts',
      'src/views/chat/runtime/RetryPolicyEngine.test.ts',
      'src/views/chat/runtime/StreamContractEngine.test.ts',
      'src/views/chat/runtime/LifecycleGuard.test.ts',
      'src/core/streaming/tests/StreamRecoveryManager.test.ts',
      'src/core/resilience/R4SoakHarness.test.ts'
    ]
  },
  {
    name: 'R2 tool + hook orchestration',
    command: 'npm',
    args: [
      'exec',
      'vitest',
      'run',
      'src/hooks/HookManager.test.ts',
      'src/agent/agentManager/tests/ToolRunStateMachine.test.ts',
      'src/agent/agentManager/tests/ToolRetryPolicyEngine.test.ts',
      'src/agent/agentManager/tests/ToolManager.circuit.test.ts',
      'src/agent/agentManager/tests/ToolManager.orchestration.test.ts',
      'src/agent/agentManager/tests/ToolManager.askQuestion.test.ts',
      'src/views/chat/handlers/ExecutionDispatchers.test.ts'
    ]
  },
  {
    name: 'R3 subagent orchestration',
    command: 'npm',
    args: [
      'exec',
      'vitest',
      'run',
      'src/views/chat/runtime/SubagentRunStateMachine.test.ts',
      'src/views/chat/runtime/SubagentRetryPolicyEngine.test.ts',
      'src/views/chat/runtime/SubagentOrchestrator.test.ts',
      'src/views/chat/handlers/ExecutionDispatchers.test.ts'
    ]
  },
  {
    name: 'R4 hardening gate (chaos/replay SLO blocker)',
    command: 'npm',
    args: ['run', 'resilience:hardening-gate']
  },
  {
    name: 'Mode behavior consistency',
    command: 'npm',
    args: [
      'exec',
      'vitest',
      'run',
      'src/modes/tests/ModeManager.test.ts',
      'src/modes/tests/ModeToolConsistency.test.ts',
      'src/modes/tests/ModeContractV2.test.ts'
    ]
  },
  {
    name: 'TypeScript compile',
    command: 'npm',
    args: ['run', 'compile', '--', '--noEmit']
  }
];

let failed = false;
for (const check of checks) {
  console.log(`\n[release-gate] Running: ${check.name}`);
  const ok = run(check.command, check.args);
  if (!ok) {
    console.error(`[release-gate] FAILED: ${check.name}`);
    failed = true;
    break;
  }
  console.log(`[release-gate] PASSED: ${check.name}`);
}

if (failed) {
  console.error('\n[release-gate] Release gate failed. Keep Production flags disabled.');
  process.exit(1);
}

console.log('\n[release-gate] All checks passed. Release gate is green.');
