import { describe, expect, it, vi } from 'vitest';
import { TemplateEngine } from './TemplateEngine';

describe('TemplateEngine', () => {
  it('interpolates placeholders deterministically', () => {
    const engine = new TemplateEngine();
    const result = engine.render('Hello {{name}} in {{env}}', { name: 'Gently', env: 'test' });
    expect(result).toBe('Hello Gently in test');
  });

  it('supports escaped opening braces', () => {
    const engine = new TemplateEngine();
    const result = engine.render('\\{{name}} {{name}}', { name: 'Gently' });
    expect(result).toBe('{{name}} Gently');
  });

  it('warns on missing values in warn mode', () => {
    const engine = new TemplateEngine();
    const warningSpy = vi.fn();
    const result = engine.render('Hello {{missing}}', {}, { mode: 'warn', onWarning: warningSpy });
    expect(result).toBe('Hello ');
    expect(warningSpy).toHaveBeenCalled();
  });

  it('throws on missing values in strict mode', () => {
    const engine = new TemplateEngine();
    expect(() => engine.render('Hello {{missing}}', {}, { mode: 'strict' })).toThrow();
  });
});

