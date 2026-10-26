import type { SessionRow } from './connection';

export interface HistorySection {
  title: string;
  data: SessionRow[];
}

const DAY = 24 * 60 * 60 * 1000;

/** Group conversations by recency, newest first. `now` is injectable so the grouping is testable. */
export function groupSessions(sessions: SessionRow[], now = Date.now()): HistorySection[] {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const today = startOfToday.getTime();
  const buckets: [string, (t: number) => boolean][] = [
    ['Today', t => t >= today],
    ['Yesterday', t => t >= today - DAY],
    ['Previous 7 days', t => t >= today - 7 * DAY],
    ['Earlier', () => true],
  ];
  const sections: HistorySection[] = buckets.map(([title]) => ({ title, data: [] }));
  for (const session of [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const index = buckets.findIndex(([, test]) => test(session.updatedAt));
    sections[index]?.data.push(session);
  }
  return sections.filter(section => section.data.length > 0);
}

export function relativeTime(timestamp: number, now = Date.now()): string {
  const minutes = Math.round((now - timestamp) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function searchSessions(sessions: SessionRow[], query: string): SessionRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return sessions;
  return sessions.filter(s => `${s.title} ${s.preview ?? ''}`.toLowerCase().includes(q));
}
