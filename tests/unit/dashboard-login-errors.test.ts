import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('dashboard login diagnostics', () => {
  const source=readFileSync(new URL('../../src/api/routes/dashboard.routes.ts',import.meta.url),'utf8');
  const server=readFileSync(new URL('../../src/server.ts',import.meta.url),'utf8');
  it('reports upstream 401, 429 and 5xx separately', () => {
    expect(source).toContain('response.status === 401');
    expect(source).toContain('response.status === 429');
    expect(source).toContain('response.status >= 500');
    expect(source).toContain('Too many login attempts');
    expect(source).toContain('Auth Service is temporarily unavailable');
  });
  it('trusts the Render edge proxy for client IP rate limiting', () => {
    expect(server).toContain("app.set('trust proxy', 1)");
  });
});
