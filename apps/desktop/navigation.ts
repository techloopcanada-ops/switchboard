export function isSameOrigin(url: string, appUrl: string): boolean {
  try { return new URL(url).origin === new URL(appUrl).origin; }
  catch { return false; }
}

export function isExternalWebUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password;
  } catch { return false; }
}
