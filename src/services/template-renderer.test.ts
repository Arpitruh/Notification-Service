import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  TemplateRenderer,
  TemplateNotFoundError,
  TemplateInvalidError,
  MissingTemplateVariablesError,
} from './template-renderer.js';

// Renderer pointed at the real shipped templates (src/templates).
const renderer = new TemplateRenderer();

// A separate temp directory for fixtures we control (malformed files, etc.).
const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-'));

function writeTemplate(id: string, json: string, hbs: string): void {
  fs.writeFileSync(path.join(fixtureDir, `${id}.json`), json);
  fs.writeFileSync(path.join(fixtureDir, `${id}.hbs`), hbs);
}

afterAll(() => {
  fs.rmSync(fixtureDir, { recursive: true, force: true });
});

describe('TemplateRenderer — existence validation', () => {
  it('throws TemplateNotFoundError for an unknown templateId', () => {
    expect(() => renderer.assertExists('does-not-exist')).toThrow(TemplateNotFoundError);
  });

  it('treats an unsafe templateId as not found (path traversal guard)', () => {
    expect(() => renderer.assertExists('../secret')).toThrow(TemplateNotFoundError);
  });

  it('throws TemplateNotFoundError when the .hbs pair is missing', () => {
    const r = new TemplateRenderer(fixtureDir);
    fs.writeFileSync(path.join(fixtureDir, 'orphan.json'), '{"subject":"x","requiredVariables":[]}');
    expect(() => r.assertExists('orphan')).toThrow(/missing orphan\.hbs/);
  });
});

describe('TemplateRenderer — variable validation', () => {
  it('throws MissingTemplateVariablesError naming a single missing variable', () => {
    try {
      renderer.validateVariables('welcome', { name: 'Arpit' });
      throw new Error('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(MissingTemplateVariablesError);
      expect((err as MissingTemplateVariablesError).missing).toEqual(['dashboardUrl']);
    }
  });

  it('reports ALL missing variables at once', () => {
    try {
      renderer.validateVariables('forgot-password', {});
      throw new Error('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(MissingTemplateVariablesError);
      expect((err as MissingTemplateVariablesError).missing).toEqual([
        'name',
        'resetUrl',
        'expiresInMinutes',
      ]);
    }
  });

  it('treats null and undefined as missing but empty string as present', () => {
    expect(() =>
      renderer.validateVariables('welcome', { name: null, dashboardUrl: undefined })
    ).toThrow(MissingTemplateVariablesError);
    expect(() =>
      renderer.validateVariables('welcome', { name: '', dashboardUrl: '' })
    ).not.toThrow();
  });

  it('allows extra variables not listed as required', () => {
    expect(() =>
      renderer.validateVariables('welcome', {
        name: 'Arpit',
        dashboardUrl: 'https://app.example.com',
        extra: 'ignored',
      })
    ).not.toThrow();
  });
});

describe('TemplateRenderer — rendering', () => {
  it('renders subject and html with substituted values', () => {
    const { subject, html } = renderer.render('welcome', {
      name: 'Arpit',
      dashboardUrl: 'https://app.example.com/dash',
    });
    expect(subject).toBe('Welcome aboard, Arpit!');
    expect(html).toContain('Arpit');
    expect(html).toContain('https://app.example.com/dash');
  });

  it('renders forgot-password with all required variables', () => {
    const { subject, html } = renderer.render('forgot-password', {
      name: 'Arpit',
      resetUrl: 'https://app.example.com/reset/abc',
      expiresInMinutes: 30,
    });
    expect(subject).toBe('Reset your password, Arpit');
    expect(html).toContain('30');
    expect(html).toContain('https://app.example.com/reset/abc');
  });

  it('escapes HTML-significant characters in payload values', () => {
    const { html } = renderer.render('welcome', {
      name: '<script>alert(1)</script>',
      dashboardUrl: 'https://app.example.com',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('TemplateRenderer — invalid metadata', () => {
  it('throws TemplateInvalidError on malformed JSON', () => {
    const r = new TemplateRenderer(fixtureDir);
    writeTemplate('badjson', '{ not valid json', '<p>{{x}}</p>');
    expect(() => r.assertExists('badjson')).toThrow(TemplateInvalidError);
  });

  it('throws TemplateInvalidError when subject is missing', () => {
    const r = new TemplateRenderer(fixtureDir);
    writeTemplate('nosubject', '{"requiredVariables":[]}', '<p>hi</p>');
    expect(() => r.assertExists('nosubject')).toThrow(TemplateInvalidError);
  });
});

describe('TemplateRenderer — caching', () => {
  it('reads files only once per templateId, then serves from cache', () => {
    const r = new TemplateRenderer();
    const spy = vi.spyOn(fs, 'readFileSync');
    const before = spy.mock.calls.length;

    r.render('welcome', { name: 'A', dashboardUrl: 'https://x' });
    const afterFirst = spy.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(before); // read .json + .hbs on first use

    r.render('welcome', { name: 'B', dashboardUrl: 'https://y' });
    const afterSecond = spy.mock.calls.length;
    expect(afterSecond).toBe(afterFirst); // no additional reads on second render

    spy.mockRestore();
  });
});
