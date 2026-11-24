import { describe, it, expect } from 'vitest';
import { demoHtml } from '../../src/dashboard/demo.js';
describe('public demo',()=>{it('labels simulation and separates live delivery',()=>{expect(demoHtml).toContain('Simulation mode');expect(demoHtml).toContain('Live email test');expect(demoHtml).not.toContain('/api/v1/dashboard');for(const m of demoHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)){expect(()=>new Function(m[1]!)).not.toThrow();}});});
