import { isIP } from 'node:net';
import * as dns from 'node:dns/promises';

/**
 * Returns true if the given hostname resolves to a private, loopback,
 * or link-local address that should not be reached via server-side requests
 * (SSRF protection).
 *
 * Blocks: 127.x.x.x, 10.x.x.x, 172.16-31.x.x, 192.168.x.x,
 *         169.254.x.x, 0.0.0.0, ::1, fc/fd (ULA), fe80 (link-local).
 */
export function isBlockedHost(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    normalized === 'localhost'
    || normalized === '0.0.0.0'
    || normalized === '::1'
    || normalized.endsWith('.localhost')
  ) {
    return true;
  }

  const ipVersion = isIP(normalized);
  if (ipVersion === 4) {
    const octets = normalized.split('.').map((part) => Number.parseInt(part, 10));
    const [a, b] = octets;
    return (
      a === 10
      || a === 127
      || (a === 169 && b === 254)
      || (a === 172 && b !== undefined && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
    );
  }

  if (ipVersion === 6) {
    return normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
  }

  return false;
}

/**
 * Validates that a URL is safe for server-side requests.
 * Throws if the URL is malformed, uses a disallowed protocol,
 * or targets a blocked (private/loopback) host.
 *
 * Also resolves the hostname via DNS and checks whether the resolved IP
 * is private/loopback to prevent DNS rebinding attacks.
 */
export async function ensureSafeUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('URL must be a valid absolute URL');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('URL must use http or https');
  }

  if (isBlockedHost(parsed.hostname)) {
    throw new Error('URL host is not allowed (private/loopback address)');
  }

  // DNS resolution check: prevent DNS rebinding where a public domain resolves to a private IP
  if (!isIP(parsed.hostname)) {
    try {
      const { address } = await dns.lookup(parsed.hostname);
      if (isBlockedHost(address)) {
        throw new Error('URL host resolves to a blocked (private/loopback) address');
      }
    } catch (err) {
      // Re-throw our own errors (blocked address); swallow DNS failures
      // so that unreachable hosts are handled at fetch-time instead.
      if (err instanceof Error && err.message.includes('blocked')) {
        throw err;
      }
    }
  }

  return parsed;
}
