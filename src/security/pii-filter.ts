/**
 * PII filter module.
 * Redacts SSNs, account numbers, and other PII from all tool outputs.
 * Applied to every string returned by any tool before reaching MCP transport.
 */

/*
 * Patterns are bounded by digit lookarounds rather than \b, so a number glued
 * to letters ("SSN123456789", "EIN12-3456789") is still caught, and a 9-digit
 * run is consumed whole by the SSN pattern before the EIN pattern can see any
 * part of it. They err toward over-redaction: a stray 9-digit run is masked.
 */

/** Matches SSN patterns: 123-45-6789, 123 45 6789, 123.45.6789, 123456789 */
const SSN_PATTERN = /(?<!\d)(\d{3})[-.\s]?(\d{2})[-.\s]?(\d{4})(?!\d)/g;

/** Matches bank account numbers and any other run of 8 or more digits */
const ACCOUNT_PATTERN = /(?<!\d)(\d{8,})(?!\d)/g;

/** Matches EIN patterns: 12-3456789, 12 3456789 (a bare 9-digit run is already masked as an SSN) */
const EIN_PATTERN = /(?<!\d)(\d{2})[-\s]?(\d{7})(?!\d)/g;

/**
 * Redact SSNs to ***-**-NNNN format (last 4 visible).
 */
export function redactSSN(text: string): string {
  return text.replace(SSN_PATTERN, (_match, _g1, _g2, last4: string) => {
    return `***-**-${last4}`;
  });
}

/**
 * Redact bank account numbers to ****NNNN (last 4 visible).
 * Only applies to sequences of 8+ digits.
 */
export function redactAccountNumber(text: string): string {
  return text.replace(ACCOUNT_PATTERN, (full: string) => `****${full.slice(-4)}`);
}

/**
 * Redact EINs to **-***NNNN format (last 4 visible).
 */
export function redactEIN(text: string): string {
  return text.replace(EIN_PATTERN, (_match, _prefix, suffix: string) => {
    return `**-***${suffix.slice(-4)}`;
  });
}

/**
 * Apply all PII redaction filters to a string.
 * Order matters: SSN first (most specific), then EIN, then account numbers.
 */
export function redactPII(text: string): string {
  let result = redactSSN(text);
  result = redactEIN(result);
  result = redactAccountNumber(result);
  return result;
}

/**
 * Deep-apply PII redaction to an object.
 * Recursively walks all string values and redacts PII.
 */
export function filterPII<T>(obj: T): T {
  if (typeof obj === 'string') {
    return redactPII(obj) as T;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => filterPII(item)) as T;
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = filterPII(value);
    }
    return result as T;
  }
  return obj;
}
