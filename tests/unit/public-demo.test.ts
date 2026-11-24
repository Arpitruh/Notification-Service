import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoHtml } from '../../src/dashboard/demo.js';
test('public demo is explicitly simulated and contains no production API calls', () => {
  assert.match(demoHtml, /Simulation mode/);
  assert.match(demoHtml, /No production data or real emails/);
  assert.doesNotMatch(demoHtml, /fetch\(|\/api\/v1\//);
  const script = demoHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
});
