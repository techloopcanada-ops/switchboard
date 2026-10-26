import type { Approval } from './connection';

/** Keep server snapshots, live events and confirmed decisions in one connection's order. */
export function createApprovalState(onChange: (requests: Approval[]) => void) {
  let requests: Approval[] = [];
  let revision = 0;
  let closed = false;
  const resolved = new Set<string>();
  const deciding = new Map<string, Promise<boolean | undefined>>();

  function replace(next: Approval[]) {
    if (closed) return;
    revision++;
    requests = next.filter(request => !resolved.has(request.id));
    onChange(requests);
  }

  function remove(id: string) {
    resolved.add(id);
    replace(requests.filter(request => request.id !== id));
  }

  return {
    get closed() { return closed; },
    replace,
    add(request: Approval) { replace([...requests.filter(item => item.id !== request.id), request]); },
    remove,
    async refresh(load: () => Promise<Approval[]>) {
      const requestedAt = ++revision;
      const next = await load();
      if (!closed && requestedAt === revision) replace(next);
    },
    decide(id: string, send: () => Promise<{ ok: boolean }>): Promise<boolean | undefined> {
      if (closed) return Promise.resolve(undefined);
      const pending = deciding.get(id);
      if (pending) return pending;
      const result = Promise.resolve().then(send).then(response => {
        if (closed) return undefined;
        if (typeof response?.ok !== 'boolean') throw new Error('The server did not confirm this decision.');
        // ok:false confirms that the request has already been resolved or expired.
        remove(id);
        return response.ok;
      }).finally(() => { deciding.delete(id); });
      deciding.set(id, result);
      return result;
    },
    close() { closed = true; revision++; },
  };
}
