export interface OtpauthPayload {
  issuer: string;
  accountName: string;
  secret: string;
}

export const normalizeSecret = (value: string) => value.toUpperCase().replace(/\s+/g, '');

export const isBase32Secret = (value: string) => /^[A-Z2-7]+$/.test(normalizeSecret(value));

export function parseOtpauthPayload(value: string): OtpauthPayload | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  if (/^otpauth-migration:\/\//i.test(trimmed)) {
    throw new Error('Google Authenticator migration QR codes are not supported yet.');
  }

  if (/^otpauth:\/\//i.test(trimmed)) {
    const parsed = new URL(trimmed);
    const secret = normalizeSecret(parsed.searchParams.get('secret') || '');

    if (!secret) {
      throw new Error('The QR code does not include a secret key.');
    }

    const issuerParam = parsed.searchParams.get('issuer') || '';
    const label = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    const [issuerFromLabel, accountNameFromLabel] = label.includes(':')
      ? label.split(/:(.+)/)
      : ['', label];

    return {
      issuer: issuerParam || issuerFromLabel || 'Authenticator',
      accountName: accountNameFromLabel || '',
      secret,
    };
  }

  if (isBase32Secret(trimmed)) {
    return {
      issuer: 'Authenticator',
      accountName: '',
      secret: normalizeSecret(trimmed),
    };
  }

  throw new Error('Use a Base32 secret key or an otpauth QR code.');
}

export function buildOtpauthUri(payload: OtpauthPayload) {
  const issuer = payload.issuer.trim() || 'Authenticator';
  const accountName = payload.accountName.trim() || 'Vault Item';
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = new URLSearchParams({
    secret: normalizeSecret(payload.secret),
    issuer,
  });

  return `otpauth://totp/${label}?${params.toString()}`;
}
