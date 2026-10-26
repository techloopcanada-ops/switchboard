import Markdown, { copyText } from './Markdown';
import { groupTranscript, toolSummary, type ToolActivity } from './transcript-state';
import type { LiveRun } from './chat-state';
import type { Message } from './types';

function Tools({ tools }: { tools: ToolActivity[] }) {
  return <div className="tool-timeline">{tools.map(tool => <details className={`tool-row${tool.isError ? ' error' : ''}`} key={tool.id}>
    <summary><span className="tool-status" aria-label={tool.output === undefined ? 'Pending' : tool.isError ? 'Failed' : 'Completed'}>{tool.output === undefined ? '◌' : tool.isError ? '×' : '✓'}</span><strong>{tool.name}</strong><span className="tool-summary">{toolSummary(tool.args)}</span></summary>
    <div className="tool-details"><h4>Arguments</h4><pre>{JSON.stringify(tool.args ?? {}, null, 2)}</pre><h4>Output</h4><pre>{tool.output ?? 'Waiting for the tool or your approval…'}</pre></div>
  </details>)}</div>;
}

function ErrorNote({ error, text, onRetry }: { error: string; text: string; onRetry: (text: string) => void }) {
  return <div className="inline-error" role="alert"><p>{error}</p><button type="button" onClick={() => onRetry(text)} disabled={!text}>Retry</button></div>;
}

export default function Transcript({ messages, run, notify, onRetry }: {
  messages: Message[];
  run?: LiveRun;
  notify: (message: string) => void;
  onRetry: (text: string) => void;
}) {
  const rows = groupTranscript(messages);
  const lastAssistant = rows.map(row => row.role).lastIndexOf('assistant');
  const latestUser = [...rows].reverse().find(row => row.role === 'user')?.text ?? '';
  return <>
    {rows.map((row, index) => <article className={`transcript-message ${row.role}`} key={index}>
      {row.role === 'user' ? <div className="user-bubble">{row.text}</div> : <>
        {row.text && <Markdown text={row.text} notify={notify} />}
        {row.tools.length > 0 && <Tools tools={row.tools} />}
        {row.error && <ErrorNote error={row.error} text={row.retryText} onRetry={onRetry} />}
        {row.role === 'assistant' && <div className="reply-footer"><button className="copy-reply" type="button" aria-label="Copy assistant message" onClick={() => void copyText(row.text, notify)} disabled={!row.text}>Copy</button>
          {index === lastAssistant && !run?.active && (row.usage || run?.costUsd !== undefined) && <small className="reply-usage">${(run?.costUsd ?? row.usage?.cost.total ?? 0).toFixed(5)} · {(run?.inputTokens ?? row.usage?.input ?? 0).toLocaleString()} input / {(run?.outputTokens ?? row.usage?.output ?? 0).toLocaleString()} output tokens</small>}
        </div>}
      </>}
    </article>)}
    {run?.active && <article className="transcript-message assistant streaming" aria-label="Assistant is responding">
      {run.text ? <Markdown text={run.text} notify={notify} /> : <p className="thinking" role="status">Thinking…</p>}
      {run.tools.length > 0 && <Tools tools={run.tools} />}
    </article>}
    {run?.error && !rows.some(row => row.error === run.error) && <ErrorNote error={run.error} text={latestUser} onRetry={onRetry} />}
  </>;
}
