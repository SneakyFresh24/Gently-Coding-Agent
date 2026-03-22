const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

async function copySqlJsWasm() {
  const source = path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
  const targetDir = path.join(process.cwd(), 'out');
  const target = path.join(targetDir, 'sql-wasm.wasm');

  if (!fs.existsSync(source)) {
    throw new Error(`sql.js wasm not found at ${source}. Did you run npm install?`);
  }

  await fsp.mkdir(targetDir, { recursive: true });
  await fsp.copyFile(source, target);
  console.log(`[copy-sqljs-wasm] Copied ${source} -> ${target}`);
}

copySqlJsWasm().catch((error) => {
  console.error('[copy-sqljs-wasm] Failed:', error);
  process.exit(1);
});
