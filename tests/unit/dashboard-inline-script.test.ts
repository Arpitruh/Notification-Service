import { describe, expect, it } from 'vitest';
import { Script } from 'node:vm';
import { dashboardHtml } from '../../src/dashboard/page.js';

describe('dashboard embedded JavaScript', () => {
  it('compiles the actual rendered inline script, including the template gallery', () => {
    // Testing the TS source alone misses cooked template-literal escaping bugs.
    const inlineScript = dashboardHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(inlineScript).toBeDefined();
    expect(() => new Script(inlineScript!, { filename: 'notification-dashboard.js' })).not.toThrow();
  });

  it('keeps login feedback and the library wiring in the rendered page', () => {
    expect(dashboardHtml).toContain("loginForm').addEventListener('submit'");
    expect(dashboardHtml).toContain('Browse template library');
    expect(dashboardHtml).toContain('loginError');
    expect(dashboardHtml).toContain('loginProgress');
  });
});
