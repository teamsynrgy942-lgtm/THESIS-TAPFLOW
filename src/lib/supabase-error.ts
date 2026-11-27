export interface SupabaseErrorDescription {
  code: string | null;
  message: string | null;
  details: string | null;
  hint: string | null;
}

function redact(value: unknown, redactions: readonly string[]): string | null {
  if (typeof value !== 'string') return null;
  let text = value;
  // Replace longer known values first in case one credential contains another.
  for (const secret of [...redactions].filter(Boolean).sort((a, b) => b.length - a.length)) {
    text = text.replaceAll(secret, '[redacted]');
  }
  return text
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted]')
    .replace(/\bsb_(?:publishable|secret)_[A-Za-z0-9_-]+\b/g, '[redacted]')
    // Quoted values can contain whitespace, punctuation, and escaped quotes.
    .replace(/(\b(?:access_token|refresh_token|apikey|api_key|password|authorization)\b["'`]?\s*[:=]\s*)("(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|(?:Bearer\s+)?[^\s,;}\])]+)/gi, '$1[redacted]')
    .replace(/\bBearer\s+(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|[^\s,;'"`}\])]+)/gi, 'Bearer [redacted]');
}

/** Project safe error fields only; never log response, client, or session objects. */
export function describeSupabaseError(error: unknown, redactions: readonly string[] = []): SupabaseErrorDescription {
  const value = typeof error === 'object' && error !== null
    ? error as Record<string, unknown> : {};
  return {
    code: redact(value.code, redactions),
    message: redact(typeof error === 'string' ? error : value.message, redactions),
    details: redact(value.details, redactions),
    hint: redact(value.hint, redactions),
  };
}
