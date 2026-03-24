const fs = require('fs');
const path = require('path');

const templates = [
  path.join(__dirname, '..', 'src', 'agent', 'prompts', 'templates', 'architect-base.md'),
  path.join(__dirname, '..', 'src', 'agent', 'prompts', 'templates', 'code-base.md')
];

const requiredPlaceholders = [
  '{{identity}}',
  '{{objective}}',
  '{{rules}}',
  '{{tooling}}',
  '{{runtime_hints}}',
  '{{response_formatting}}'
];

const forbiddenTokens = ['<INSERT_PROMPT_HERE>', '{{TODO}}', 'FIXME_PROMPT'];

let hasErrors = false;

for (const filePath of templates) {
  const content = fs.readFileSync(filePath, 'utf8');
  for (const placeholder of requiredPlaceholders) {
    if (!content.includes(placeholder)) {
      console.error(`[prompt-lint] Missing placeholder ${placeholder} in ${filePath}`);
      hasErrors = true;
    }
  }

  for (const token of forbiddenTokens) {
    if (content.includes(token)) {
      console.error(`[prompt-lint] Forbidden token ${token} found in ${filePath}`);
      hasErrors = true;
    }
  }
}

if (hasErrors) {
  process.exit(1);
}

console.log('[prompt-lint] OK');

