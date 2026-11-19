import { describe, expect, it } from 'vitest';
import { dashboardHtml } from '../../src/dashboard/page.js';

describe('dashboard brand and footer', () => {
  it('rebrands the document and login/dashboard shells to Notification Service', () => {
    expect(dashboardHtml).toContain('<title>Notification Service • Dashboard</title>');
    expect(dashboardHtml).not.toContain('Notification Garden');
    expect(dashboardHtml).toContain('id="loginShell"');
    expect(dashboardHtml).toContain("('loginShell').classList.add('hidden')");
    expect(dashboardHtml).toContain("('loginShell').classList.remove('hidden')");
  });
  it('includes an accessible footer in both views with working internal and documentation links', () => {
    expect(dashboardHtml.match(/<footer class="footer"/g)).toHaveLength(2);
    expect(dashboardHtml).toContain('aria-label="Website information"');
    expect(dashboardHtml).toContain('href="/health"');
    expect(dashboardHtml).toContain('href="/ready"');
    expect(dashboardHtml).toContain('docs/DASHBOARD_EVENT_CONFIGURATION.md');
    expect(dashboardHtml).toContain('href="https://github.com/Arpitruh/Notification-Service/issues"');
  });
  it('keeps the existing application management navigation and application selector', () => {
    for (const section of ['applications','templates','users','team','audit','settings','credentials']) {
      expect(dashboardHtml).toContain('data-section="'+section+'"');
    }
    expect(dashboardHtml).toContain('id="appSelect"');
    expect(dashboardHtml).toContain('id="logout"');
  });
});
