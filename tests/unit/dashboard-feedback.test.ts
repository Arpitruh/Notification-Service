import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dashboardHtml } from '../../src/dashboard/page.js';
import { Script } from 'node:vm';

const source = readFileSync(new URL('../../src/dashboard/page.ts', import.meta.url), 'utf8');
// The browser executes the cooked HTML string, not the raw template literal source.
const script = dashboardHtml.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];

describe('dashboard interaction feedback', () => {
  it('has valid browser-side JavaScript', () => {
    expect(script).toBeTruthy();
    expect(() => new Script(script!, { filename: 'dashboard-inline.js' })).not.toThrow();
  });
  it('shows progress and prevents duplicate sign-in submissions', () => {
    expect(source).toContain('id="loginSubmit"');
    expect(source).toContain('id="loginProgress"');
    expect(source).toContain('if(state.loginPending)return');
    expect(source).toContain("setBusy(button,true)");
    expect(source).toContain("setBusy(button,false)");
    expect(source).toContain('Loading your workspace');
  });
  it('shows skeletons during section changes with accessible loading state', () => {
    expect(source).toContain('function skeleton()');
    expect(source).toContain("root.setAttribute('aria-busy','true')");
    expect(source).toContain("root.setAttribute('aria-busy','false')");
    expect(source).toContain('async function render(){const version=++state.renderVersion;skeleton()');
    expect(source).toContain('prefers-reduced-motion:reduce');
  });
  it('shows actionable errors and tracks asynchronous button activity', () => {
    expect(source).toContain('function failure(message)');
    expect(source).toContain("action('Try again',()=>render()");
    expect(source).toContain("if(b.disabled)return;setBusy(b,true)");
    expect(source).toContain("show(err?.message||'Something went wrong','error')");
    expect(source).toContain('aria-live="assertive"');
  });
});
