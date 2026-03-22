import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as https from 'https';
import { spawnSync } from 'child_process';

type RunnerStatus = 'success' | 'no_patch' | 'invalid_patch' | 'infra_error' | 'timeout';

interface RunnerResult {
  status: RunnerStatus;
  patch: string;
  error: string | null;
  usage: Record<string, unknown> | null;
  duration_ms: number;
}

interface Args {
  repoDir: string;
  problemFile: string;
  model: string;
  maxTokens: number;
  temperature: number;
  timeoutSec: number;
}

function parseArgs(argv: string[]): Args {
  const map = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key || !key.startsWith('--') || !value) continue;
    map.set(key, value);
  }

  const repoDir = map.get('--repo_dir');
  const problemFile = map.get('--problem_file');
  const model = map.get('--model');
  const maxTokensRaw = map.get('--max_tokens') || '8192';
  const temperatureRaw = map.get('--temperature') || '0.0';
  const timeoutRaw = map.get('--timeout_sec') || '1800';

  if (!repoDir || !problemFile || !model) {
    throw new Error('Missing required args: --repo_dir --problem_file --model');
  }

  return {
    repoDir,
    problemFile,
    model,
    maxTokens: Number(maxTokensRaw),
    temperature: Number(temperatureRaw),
    timeoutSec: Number(timeoutRaw),
  };
}

function runGit(args: string[], cwd: string, timeoutMs: number): { code: number; stdout: string; stderr: string } {
  const res = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
  });

  return {
    code: res.status ?? 1,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
  };
}

function extractDiffFromAssistant(raw: string): string {
  const text = raw.replace(/\r\n/g, '\n').trim();
  if (!text) return '';

  const diffFence = text.match(/```diff\s*([\s\S]*?)```/i);
  if (diffFence?.[1]) return diffFence[1].trim();

  const anyFence = text.match(/```(?:\w+)?\s*([\s\S]*?)```/i);
  if (anyFence?.[1]) return anyFence[1].trim();

  return text;
}

function postJson(
  url: string,
  payload: Record<string, unknown>,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const data = JSON.stringify(payload);
    const req = https.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data).toString(),
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 500,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('request_timeout'));
    });
    req.on('error', (err) => reject(err));
    req.write(data);
    req.end();
  });
}

async function callOpenRouter(args: Args, apiKey: string, prompt: string): Promise<{ content: string; usage: Record<string, unknown> | null }> {
  const systemPrompt = [
    'You are a senior software engineer working on a real repository.',
    'Return ONLY a valid unified git diff patch that fixes the issue.',
    'Rules:',
    '- No markdown, no explanations, only patch text.',
    '- Keep changes minimal and focused on the issue.',
    '- Patch must be relative to repository root and apply with git apply.',
  ].join('\n');

  const payload = {
    model: args.model,
    temperature: args.temperature,
    max_tokens: args.maxTokens,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ],
  };

  const response = await postJson(
    'https://openrouter.ai/api/v1/chat/completions',
    payload,
    {
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://github.com/SneakyFresh24/Gently-Coding-Agent',
      'X-Title': 'Gently SWE-Bench Runner',
    },
    args.timeoutSec * 1000
  );

  if (response.statusCode !== 200) {
    throw new Error(`openrouter_http_${response.statusCode}: ${response.body}`);
  }

  const parsed = JSON.parse(response.body);
  const content = parsed?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error(`openrouter_invalid_response: ${response.body}`);
  }

  return {
    content,
    usage: parsed?.usage ?? null,
  };
}

function buildProblemPrompt(problemStatement: string): string {
  return [
    'Fix the following software issue in the checked-out repository.',
    '',
    'Issue:',
    problemStatement,
    '',
    'Output format:',
    'Return a unified git diff patch only.',
  ].join('\n');
}

async function main(): Promise<void> {
  const started = Date.now();
  let patchFilePath: string | null = null;

  try {
    const args = parseArgs(process.argv.slice(2));
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY is required');
    }

    const problem = fs.readFileSync(args.problemFile, 'utf8');
    const prompt = buildProblemPrompt(problem);

    const completion = await callOpenRouter(args, apiKey, prompt);
    const diff = extractDiffFromAssistant(completion.content);

    if (!diff.trim()) {
      const out: RunnerResult = {
        status: 'no_patch',
        patch: '',
        error: 'Model returned empty diff',
        usage: completion.usage,
        duration_ms: Date.now() - started,
      };
      process.stdout.write(JSON.stringify(out));
      return;
    }

    patchFilePath = path.join(os.tmpdir(), `gently_swebench_${Date.now()}.diff`);
    fs.writeFileSync(patchFilePath, `${diff}\n`, 'utf8');

    const applyRes = runGit(['apply', '--whitespace=nowarn', patchFilePath], args.repoDir, args.timeoutSec * 1000);
    if (applyRes.code !== 0) {
      const out: RunnerResult = {
        status: 'invalid_patch',
        patch: '',
        error: `git apply failed: ${applyRes.stderr || applyRes.stdout}`,
        usage: completion.usage,
        duration_ms: Date.now() - started,
      };
      process.stdout.write(JSON.stringify(out));
      return;
    }

    const diffRes = runGit(['diff', 'HEAD'], args.repoDir, 60_000);
    if (diffRes.code !== 0) {
      const out: RunnerResult = {
        status: 'infra_error',
        patch: '',
        error: `git diff failed: ${diffRes.stderr || diffRes.stdout}`,
        usage: completion.usage,
        duration_ms: Date.now() - started,
      };
      process.stdout.write(JSON.stringify(out));
      return;
    }

    const out: RunnerResult = {
      status: diffRes.stdout.trim() ? 'success' : 'no_patch',
      patch: diffRes.stdout,
      error: null,
      usage: completion.usage,
      duration_ms: Date.now() - started,
    };
    process.stdout.write(JSON.stringify(out));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status: RunnerStatus = message.includes('request_timeout') ? 'timeout' : 'infra_error';
    const out: RunnerResult = {
      status,
      patch: '',
      error: message,
      usage: null,
      duration_ms: Date.now() - started,
    };
    process.stdout.write(JSON.stringify(out));
  } finally {
    if (patchFilePath && fs.existsSync(patchFilePath)) {
      fs.unlinkSync(patchFilePath);
    }
  }
}

void main();
