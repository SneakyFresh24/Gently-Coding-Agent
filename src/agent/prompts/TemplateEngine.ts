type TemplateValue = string | number | boolean | null | undefined | Record<string, unknown>;

export interface TemplateEngineOptions {
  mode?: 'strict' | 'warn';
  onWarning?: (warning: string) => void;
}

/**
 * Lightweight, deterministic placeholder renderer.
 * Supports {{key}} and dotted paths like {{runtime.retry_count}}.
 */
export class TemplateEngine {
  render(
    template: string,
    values: Record<string, TemplateValue>,
    options: TemplateEngineOptions = {}
  ): string {
    const mode = options.mode || 'warn';
    const warnings: string[] = [];

    const escapedToken = '__GENTLY_ESCAPED_OPEN__';
    const normalized = template.replace(/\\\{\{/g, escapedToken);

    const rendered = normalized.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, path) => {
      const resolved = this.resolvePath(values, path);
      if (resolved === undefined || resolved === null) {
        const warning = `Missing template value for "${path}"`;
        if (mode === 'strict') {
          throw new Error(`[TemplateEngine] ${warning}`);
        }
        warnings.push(warning);
        return '';
      }

      if (typeof resolved === 'object') {
        return JSON.stringify(resolved);
      }
      return String(resolved);
    });

    for (const warning of warnings) {
      options.onWarning?.(warning);
    }

    return rendered.replace(new RegExp(escapedToken, 'g'), '{{');
  }

  private resolvePath(values: Record<string, TemplateValue>, path: string): unknown {
    const segments = path.split('.');
    let current: unknown = values;
    for (const segment of segments) {
      if (current == null || typeof current !== 'object' || !(segment in current)) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[segment];
    }
    return current;
  }
}

