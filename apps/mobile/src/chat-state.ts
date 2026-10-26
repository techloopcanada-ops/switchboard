export interface ChatTarget { botId: string; chatKey: string }

export function sameChat(a: ChatTarget | null | undefined, b: ChatTarget | null | undefined): boolean {
  return !!a && !!b && a.botId === b.botId && a.chatKey === b.chatKey;
}

export interface SentDraft extends ChatTarget { id: string; text: string; revision: number; accepted: boolean; runId?: string }

/** An older run can finish after reconnecting and queuing another message. */
export function finishDraftRun(request: SentDraft | null, runId: string): { pending: SentDraft | null; completed: SentDraft | null } {
  return request?.runId === runId ? { pending: null, completed: request } : { pending: request, completed: null };
}

/** A repeated acknowledgement must not erase a newly typed, even identical, draft. */
export function canClearSentDraft(request: SentDraft, current: ChatTarget | null, text: string, revision: number): boolean {
  return !request.accepted && sameChat(request, current) && request.text === text && request.revision === revision;
}

/** Keep storage mutations ordered, including when one operation fails. */
export function serialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation);
    tail = result.catch(() => undefined);
    return result;
  };
}
