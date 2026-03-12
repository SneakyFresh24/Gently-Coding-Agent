/**
 * HTML Generator for Svelte Webview
 * Loads the built Svelte app from webview-dist
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export function generateHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  initialState: Record<string, any> = {}
): string {
  // Get paths to built assets
  const distPath = vscode.Uri.joinPath(extensionUri, 'webview-dist');
  const indexHtmlPath = vscode.Uri.joinPath(distPath, 'index.html');

  // Check if file exists
  if (!fs.existsSync(indexHtmlPath.fsPath)) {
    console.error('[htmlGenerator] index.html not found! Falling back to old UI.');
    return getFallbackHtml();
  }

  // Read the built index.html
  let html = fs.readFileSync(indexHtmlPath.fsPath, 'utf8');

  // Inject initial state
  const stateScript = `
    <script>
      window.initialState = ${JSON.stringify(initialState)};
    </script>
  `;
  html = html.replace('<head>', `<head>${stateScript}`);

  // Replace asset paths with webview URIs
  html = html.replace(
    /(<link[^>]+href="|<script[^>]+src="|<img[^>]+src=")([^"]+)"/g,
    (match, prefix, assetPath) => {
      const cleanPath = assetPath.startsWith('/') ? assetPath.slice(1) : assetPath;
      const assetUri = webview.asWebviewUri(vscode.Uri.joinPath(distPath, cleanPath));
      return `${prefix}${assetUri}"`;
    }
  );

  // Add CSP meta tag
  const csp = `
    <meta http-equiv="Content-Security-Policy" 
          content="default-src 'none'; 
                   style-src ${webview.cspSource} 'unsafe-inline'; 
                   script-src ${webview.cspSource} 'unsafe-inline'; 
                   font-src ${webview.cspSource}; 
                   img-src ${webview.cspSource} https: data:;">
  `;

  // Insert CSP into head
  html = html.replace('</head>', `${csp}</head>`);

  return html;
}

/**
 * Fallback HTML if Svelte build is not found
 */
function getFallbackHtml(): string {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Gently - Build Error</title>
      <style>
        body {
          margin: 0;
          padding: 20px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
          background: #1e1e1e;
          color: #cccccc;
        }
        .error-container {
          max-width: 600px;
          margin: 50px auto;
          padding: 30px;
          background: #2d2d2d;
          border-radius: 8px;
          border: 1px solid #ff4444;
        }
        h1 { color: #ff4444; margin-top: 0; }
        code {
          background: #1e1e1e;
          padding: 2px 6px;
          border-radius: 3px;
          font-family: 'Courier New', monospace;
        }
        .command {
          background: #1e1e1e;
          padding: 15px;
          border-radius: 5px;
          margin: 15px 0;
          font-family: 'Courier New', monospace;
        }
      </style>
    </head>
    <body>
      <div class="error-container">
        <h1>⚠️ Webview Build Not Found</h1>
        <p>The Svelte webview build could not be found. Please run:</p>
        <div class="command">npm run build:webview</div>
        <p>Then reload the extension with <code>Ctrl+R</code> or <code>Cmd+R</code>.</p>
        <p><strong>Note:</strong> Make sure you're in the extension development host window when reloading.</p>
      </div>
    </body>
    </html>
  `;
}

