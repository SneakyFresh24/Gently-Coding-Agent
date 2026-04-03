/* eslint-disable no-console */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const THRESHOLDS = {
  terminalCoverageMin: 0.999,
  recoveryRateMin: 0.95,
  silentAbortsMax: 0,
  stuckStatesMax: 0,
  replayMismatchMax: 0
};

const suites = [
  {
    id: 'chat',
    testFile: 'src/views/chat/handlers/ChatFlowManager.soak.test.ts'
  },
  {
    id: 'tool',
    testFile: 'src/agent/agentManager/tests/ToolManager.soak.test.ts'
  },
  {
    id: 'subagent',
    testFile: 'src/views/chat/runtime/SubagentOrchestrator.soak.test.ts'
  }
];

function runVitestForSuite(testFile, reportFile) {
  const result = spawnSync(
    'npm',
    ['exec', 'vitest', 'run', testFile],
    {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        GENTLY_R4_REPORT_FILE: reportFile
      }
    }
  );
  return result.status === 0;
}

function validateSuiteReport(report) {
  const violations = [];

  if (typeof report.totalFlows !== 'number' || report.totalFlows < 1000) {
    violations.push(`totalFlows < 1000 (${report.totalFlows})`);
  }
  if (report.silentAborts > THRESHOLDS.silentAbortsMax) {
    violations.push(`silentAborts > ${THRESHOLDS.silentAbortsMax} (${report.silentAborts})`);
  }
  if (report.stuckStates > THRESHOLDS.stuckStatesMax) {
    violations.push(`stuckStates > ${THRESHOLDS.stuckStatesMax} (${report.stuckStates})`);
  }
  if (report.terminalCoverage < THRESHOLDS.terminalCoverageMin) {
    violations.push(
      `terminalCoverage < ${THRESHOLDS.terminalCoverageMin} (${Number(report.terminalCoverage).toFixed(6)})`
    );
  }
  if (report.recoveryRate < THRESHOLDS.recoveryRateMin) {
    violations.push(`recoveryRate < ${THRESHOLDS.recoveryRateMin} (${Number(report.recoveryRate).toFixed(6)})`);
  }
  if (report.replayMismatchCount > THRESHOLDS.replayMismatchMax) {
    violations.push(`replayMismatchCount > ${THRESHOLDS.replayMismatchMax} (${report.replayMismatchCount})`);
  }
  if (report.replayDeterministic !== true) {
    violations.push('replayDeterministic is false');
  }
  if (report.pass !== true) {
    violations.push('suite pass flag is false');
  }

  return violations;
}

function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gently-r4-gate-'));
  const suiteResults = [];
  let gateFailed = false;

  for (const suite of suites) {
    const reportFile = path.join(tempDir, `${suite.id}.json`);
    console.log(`\n[r4-gate] Running suite: ${suite.id}`);

    const ok = runVitestForSuite(suite.testFile, reportFile);
    if (!ok) {
      suiteResults.push({
        suite: suite.id,
        pass: false,
        violations: ['vitest_run_failed']
      });
      gateFailed = true;
      continue;
    }

    if (!fs.existsSync(reportFile)) {
      suiteResults.push({
        suite: suite.id,
        pass: false,
        violations: ['missing_suite_report']
      });
      gateFailed = true;
      continue;
    }

    const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
    const violations = validateSuiteReport(report);
    const passed = violations.length === 0;
    if (!passed) {
      gateFailed = true;
    }

    suiteResults.push({
      ...report,
      violations
    });

    console.log(
      `[r4-gate] ${suite.id}: pass=${passed ? 'yes' : 'no'},`
      + ` silent=${report.silentAborts},`
      + ` stuck=${report.stuckStates},`
      + ` terminal=${(Number(report.terminalCoverage) * 100).toFixed(3)}%,`
      + ` recovery=${(Number(report.recoveryRate) * 100).toFixed(3)}%,`
      + ` replayMismatch=${report.replayMismatchCount}`
    );
    if (!passed) {
      console.log(`[r4-gate] ${suite.id} violations: ${violations.join('; ')}`);
    }
  }

  const aggregate = {
    generatedAt: new Date().toISOString(),
    thresholds: THRESHOLDS,
    totalSuites: suites.length,
    passingSuites: suiteResults.filter((suite) => suite.pass === true && (!suite.violations || suite.violations.length === 0)).length,
    pass: !gateFailed,
    suites: suiteResults
  };

  const defaultReportPath = path.join(tempDir, 'r4-hardening-gate-report.json');
  const reportPath = path.resolve(process.env.GENTLY_R4_GATE_REPORT || defaultReportPath);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(aggregate, null, 2), 'utf8');

  console.log(`\n[r4-gate] JSON report: ${reportPath}`);
  console.log(`[r4-gate] Result: ${aggregate.pass ? 'PASS' : 'FAIL'}`);

  if (!aggregate.pass) {
    process.exit(1);
  }
}

main();
