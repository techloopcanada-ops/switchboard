let token = '';
export function getToken() { return token; }
export function setToken(value: string) {
  token = value.trim();
  try { localStorage.setItem('switchboard.token', token); } catch { /* Memory auth still works without storage. */ }
}
export async function bootstrap() {
  try {
    const response = await fetch('/api/bootstrap');
    if (!response.ok) throw new Error('Enter the token from your Switchboard server.');
    setToken((await response.json() as { token: string }).token);
  } catch {
    try { token = localStorage.getItem('switchboard.token') ?? ''; } catch { token = ''; }
  }
  if (!token) throw new Error('Enter the token from your Switchboard server.');
  await api('/api/status');
}
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('switchboard:unauthorized'));
    throw new Error((data as { error?: string }).error ?? `Request failed (${response.status}).`);
  }
  return data as T;
}
