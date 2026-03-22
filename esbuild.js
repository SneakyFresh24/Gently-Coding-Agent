const esbuild = require('esbuild');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outfile: 'out/extension.js',
    external: [
      'vscode',
      // Keep these as external - they have native bindings or special requirements
      'hnswlib-node',
      'xxhash-addon',
      'level',
      '@xenova/transformers',
      'web-tree-sitter',
      'onnxruntime-node',
      'sharp',
      'espree',
      'sql.js'
    ],
    logLevel: 'info',
    define: {
      'process.env.NODE_ENV': production ? '"production"' : '"development"',
    },
  });

  if (watch) {
    await ctx.watch();
    console.log('Watching for changes...');
  } else {
    await ctx.rebuild();
    await ctx.dispose();
    console.log('Build complete!');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
