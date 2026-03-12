/**
 * Download Tree-sitter WASM Grammars
 * 
 * Utility script to download Tree-sitter WASM files for supported languages.
 * Run this during extension activation or as a setup script.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

/**
 * Grammar download configuration
 */
interface GrammarConfig {
  language: string;
  url: string;
  filename: string;
}

/**
 * Tree-sitter grammar URLs (from official releases)
 */
const GRAMMARS: GrammarConfig[] = [
  {
    language: 'typescript',
    url: 'https://github.com/tree-sitter/tree-sitter-typescript/releases/download/v0.20.3/tree-sitter-typescript.wasm',
    filename: 'tree-sitter-typescript.wasm'
  },
  {
    language: 'tsx',
    url: 'https://github.com/tree-sitter/tree-sitter-typescript/releases/download/v0.20.3/tree-sitter-tsx.wasm',
    filename: 'tree-sitter-tsx.wasm'
  },
  {
    language: 'javascript',
    url: 'https://github.com/tree-sitter/tree-sitter-javascript/releases/download/v0.20.1/tree-sitter-javascript.wasm',
    filename: 'tree-sitter-javascript.wasm'
  },
  {
    language: 'python',
    url: 'https://github.com/tree-sitter/tree-sitter-python/releases/download/v0.20.4/tree-sitter-python.wasm',
    filename: 'tree-sitter-python.wasm'
  },
  {
    language: 'go',
    url: 'https://github.com/tree-sitter/tree-sitter-go/releases/download/v0.20.0/tree-sitter-go.wasm',
    filename: 'tree-sitter-go.wasm'
  },
  {
    language: 'rust',
    url: 'https://github.com/tree-sitter/tree-sitter-rust/releases/download/v0.20.4/tree-sitter-rust.wasm',
    filename: 'tree-sitter-rust.wasm'
  },
  {
    language: 'html',
    url: 'https://github.com/tree-sitter/tree-sitter-html/releases/download/v0.20.0/tree-sitter-html.wasm',
    filename: 'tree-sitter-html.wasm'
  },
  {
    language: 'php',
    url: 'https://github.com/tree-sitter/tree-sitter-php/releases/download/v0.21.1/tree-sitter-php.wasm',
    filename: 'tree-sitter-php.wasm'
  }
];

/**
 * Download a file from URL
 */
function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirect
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          file.close();
          fs.unlinkSync(destPath);
          downloadFile(redirectUrl, destPath).then(resolve).catch(reject);
          return;
        }
      }

      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(destPath);
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        resolve();
      });

      file.on('error', (err) => {
        file.close();
        fs.unlinkSync(destPath);
        reject(err);
      });
    }).on('error', (err) => {
      file.close();
      fs.unlinkSync(destPath);
      reject(err);
    });
  });
}

/**
 * Download all Tree-sitter grammars
 */
export async function downloadAllGrammars(outputDir: string): Promise<void> {
  console.log('[GrammarDownloader] Starting grammar downloads...');
  console.log(`[GrammarDownloader] Output directory: ${outputDir}`);

  // Create output directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    console.log(`[GrammarDownloader] Created directory: ${outputDir}`);
  }

  const results: { language: string; success: boolean; error?: string }[] = [];

  for (const grammar of GRAMMARS) {
    const destPath = path.join(outputDir, grammar.filename);

    // Skip if already exists
    if (fs.existsSync(destPath)) {
      console.log(`[GrammarDownloader] ${grammar.language}: Already exists, skipping`);
      results.push({ language: grammar.language, success: true });
      continue;
    }

    try {
      console.log(`[GrammarDownloader] ${grammar.language}: Downloading from ${grammar.url}...`);
      await downloadFile(grammar.url, destPath);
      console.log(`[GrammarDownloader] ${grammar.language}: ✓ Downloaded successfully`);
      results.push({ language: grammar.language, success: true });
    } catch (error) {
      console.error(`[GrammarDownloader] ${grammar.language}: ✗ Failed:`, error);
      results.push({ 
        language: grammar.language, 
        success: false, 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // Summary
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  console.log('\n[GrammarDownloader] Download Summary:');
  console.log(`  ✓ Successful: ${successful}/${GRAMMARS.length}`);
  console.log(`  ✗ Failed: ${failed}/${GRAMMARS.length}`);

  if (failed > 0) {
    console.log('\n[GrammarDownloader] Failed downloads:');
    results.filter(r => !r.success).forEach(r => {
      console.log(`  - ${r.language}: ${r.error}`);
    });
  }

  console.log('\n[GrammarDownloader] Grammar downloads complete!');
}

/**
 * Check if all grammars are downloaded
 */
export function checkGrammarsExist(outputDir: string): boolean {
  if (!fs.existsSync(outputDir)) {
    return false;
  }

  for (const grammar of GRAMMARS) {
    const filePath = path.join(outputDir, grammar.filename);
    if (!fs.existsSync(filePath)) {
      return false;
    }
  }

  return true;
}

/**
 * Get list of missing grammars
 */
export function getMissingGrammars(outputDir: string): string[] {
  const missing: string[] = [];

  if (!fs.existsSync(outputDir)) {
    return GRAMMARS.map(g => g.language);
  }

  for (const grammar of GRAMMARS) {
    const filePath = path.join(outputDir, grammar.filename);
    if (!fs.existsSync(filePath)) {
      missing.push(grammar.language);
    }
  }

  return missing;
}

// CLI usage
if (require.main === module) {
  const outputDir = process.argv[2] || path.join(__dirname, '..', '..', '..', 'resources', 'tree-sitter');
  
  downloadAllGrammars(outputDir)
    .then(() => {
      console.log('Done!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Error:', error);
      process.exit(1);
    });
}

