import { describe, it, expect } from 'vitest';
import { parseTaxYear, acquirePageLock } from '../../src/browser/context.js';
import { summarizeError } from '../../src/server.js';
import { fillFieldsSchema, MAX_FIELD_VALUE_LENGTH } from '../../src/tools/generic.js';

describe('parseTaxYear', () => {
  it('defaults to 2025', () => {
    expect(parseTaxYear(undefined)).toBe('2025');
  });

  it('accepts a four-digit year', () => {
    expect(parseTaxYear('2024')).toBe('2024');
  });

  it.each(['25', '2025/../evil', '2025@evil.com', '2025?x=1', 'abcd', '19999'])('rejects %s', bad => {
    expect(() => parseTaxYear(bad)).toThrow(/FREETAXUSA_TAX_YEAR/);
  });
});

describe('summarizeError', () => {
  it('keeps only the first line', () => {
    const err = new Error('locator.click: Timeout 3000ms exceeded.\nCall log:\n  - waiting for #secret');
    expect(summarizeError(err)).toBe('locator.click: Timeout 3000ms exceeded.');
  });

  it('caps long messages', () => {
    expect(summarizeError(new Error('x'.repeat(1000))).length).toBeLessThanOrEqual(201);
  });
});

describe('fillFieldsSchema', () => {
  it('rejects oversized values', () => {
    const r = fillFieldsSchema.safeParse({ fields: [{ label: 'Wages', value: 'x'.repeat(MAX_FIELD_VALUE_LENGTH + 1) }] });
    expect(r.success).toBe(false);
  });

  it('accepts normal values', () => {
    expect(fillFieldsSchema.safeParse({ fields: [{ label: 'Wages', value: '52340' }] }).success).toBe(true);
  });
});

describe('acquirePageLock', () => {
  it('stays exclusive when a holder releases before the next acquire', async () => {
    const r1 = await acquirePageLock();
    r1();
    const r2 = await acquirePageLock();
    let third = false;
    const p3 = acquirePageLock().then(r => {
      third = true;
      r();
    });
    await new Promise(r => setTimeout(r, 10));
    expect(third).toBe(false);
    r2();
    await p3;
    expect(third).toBe(true);
  });
});
