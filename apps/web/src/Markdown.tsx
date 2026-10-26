import { useLayoutEffect, useRef } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

export async function copyText(text: string, notify: (message: string) => void): Promise<void> {
  try {
    if (navigator.clipboard) await navigator.clipboard.writeText(text);
    else {
      // HTTP LAN origins lack Clipboard API; the user-triggered fallback still works there.
      const field = document.createElement('textarea');
      field.value = text;
      field.setAttribute('aria-label', 'Text to copy');
      field.style.cssText = 'position:fixed;left:-9999px;top:0';
      const focused = document.activeElement;
      document.body.append(field);
      field.select();
      try { if (!document.execCommand('copy')) throw new Error('Copy unavailable'); }
      finally { field.remove(); if (focused instanceof HTMLElement) focused.focus({ preventScroll: true }); }
    }
    notify('Copied.');
  } catch { notify('Could not copy. Select the text and copy it manually.'); }
}

export default function Markdown({ text, notify = () => undefined }: { text: string; notify?: (message: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const notification = useRef(notify);
  notification.current = notify;
  useLayoutEffect(() => {
    if (!container.current) return;
    const fragment = DOMPurify.sanitize(marked.parse(text, { async: false }), {
      USE_PROFILES: { html: true }, RETURN_DOM_FRAGMENT: true,
      FORBID_TAGS: ['img', 'style', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'object', 'embed', 'video', 'audio', 'source', 'link', 'meta'],
      FORBID_ATTR: ['style'],
    });
    for (const pre of fragment.querySelectorAll('pre')) {
      const code = pre.querySelector('code');
      if (!code) continue;
      const source = code.textContent ?? '';
      const language = [...code.classList].find(value => value.startsWith('language-'))?.slice(9) || 'text';
      const block = document.createElement('div');
      block.className = 'code-block';
      const toolbar = document.createElement('div');
      toolbar.className = 'code-toolbar';
      const label = document.createElement('span');
      label.textContent = language;
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = 'Copy';
      button.setAttribute('aria-label', `Copy ${language} code`);
      button.addEventListener('click', () => { void copyText(source, notification.current); });
      toolbar.append(label, button);
      pre.replaceWith(block);
      block.append(toolbar, pre);
    }
    for (const link of fragment.querySelectorAll('a')) link.setAttribute('rel', 'noreferrer noopener');
    container.current.replaceChildren(fragment);
  }, [text]);
  return <div className="markdown" ref={container} />;
}
