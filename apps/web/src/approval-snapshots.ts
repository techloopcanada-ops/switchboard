import type { ApprovalRequest } from './types.ts';

export function createApprovalSnapshots() {
  let revision = 0;
  return {
    invalidate() { revision++; },
    async refresh(load: () => Promise<ApprovalRequest[]>, apply: (requests: ApprovalRequest[]) => void): Promise<void> {
      const requestedAt = ++revision;
      const requests = await load();
      // A newer request or live event makes this snapshot obsolete.
      if (requestedAt === revision) apply(requests);
    },
  };
}
