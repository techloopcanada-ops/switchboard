import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CommandOption } from './commands';

export default function Composer({ value, onChange, onSend, onStop, busy, connected, canSend, options, focusVersion, visible }: {
  value: string; onChange: (value: string) => void; onSend: () => void; onStop?: () => void;
  busy: boolean; connected: boolean; canSend: boolean; options: CommandOption[]; focusVersion: number; visible: boolean;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLUListElement>(null);
  const composing = useRef(false);
  const [active, setActive] = useState(0);
  const [dismissedValue, setDismissedValue] = useState<string>();
  const [focused, setFocused] = useState(false);
  const showPicker = focused && dismissedValue !== value && options.length > 0;
  useEffect(() => { setActive(0); }, [value]);
  useEffect(() => {
    if (showPicker) picker.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, showPicker, value, options.length]);
  useEffect(() => { if (visible) textarea.current?.focus({ preventScroll: true }); }, [focusVersion, visible]);
  useLayoutEffect(() => {
    const input = textarea.current;
    if (!input || !visible) return;
    function resize() {
      if (!input) return;
      const scrollTop = input.scrollTop;
      const caretAtEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
      const style = getComputedStyle(input);
      const line = Number.parseFloat(style.lineHeight) || 24;
      const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
      input.style.height = '0px';
      const maximum = Math.min(line * 8 + padding, Number.parseFloat(style.maxHeight) || Infinity);
      input.style.height = `${Math.min(Math.max(input.scrollHeight, line + padding), maximum)}px`;
      input.style.overflowY = input.scrollHeight > maximum ? 'auto' : 'hidden';
      input.scrollTop = caretAtEnd ? input.scrollHeight : scrollTop;
    }
    resize();
    const parent = input.parentElement;
    let width = parent?.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const nextWidth = parent?.getBoundingClientRect().width;
      if (nextWidth !== width) { width = nextWidth; resize(); }
    });
    if (parent) observer.observe(parent);
    window.addEventListener('resize', resize);
    return () => { observer.disconnect(); window.removeEventListener('resize', resize); };
  }, [value, visible]);
  function choose(option: CommandOption) {
    setDismissedValue(option.insert);
    onChange(option.insert);
    textarea.current?.focus({ preventScroll: true });
  }
  return <form className="composer" onSubmit={event => { event.preventDefault(); if (!composing.current && canSend) onSend(); }}>
    <div className="composer-input">
      {showPicker && <ul ref={picker} id="command-picker" className="command-picker" role="listbox" aria-label="Slash commands">{options.map((option, index) => <li id={`command-option-${index}`} key={option.id} role="option" aria-selected={index === active} onMouseDown={event => event.preventDefault()} onClick={() => choose(option)}><strong>{option.label}</strong><span>{option.description}</span></li>)}</ul>}
      <label className="sr-only" htmlFor="chat-message">Message</label>
      <textarea ref={textarea} id="chat-message" value={value} rows={1} placeholder="Message your bot, or type / for commands" aria-controls={showPicker ? 'command-picker' : undefined} aria-expanded={showPicker} aria-autocomplete="list" aria-activedescendant={showPicker ? `command-option-${active}` : undefined}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onChange={event => { setDismissedValue(undefined); onChange(event.target.value); }}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={event => {
          if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (showPicker && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) { event.preventDefault(); setActive(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length); return; }
          if (showPicker && event.key === 'Escape') { event.preventDefault(); setDismissedValue(value); return; }
          if (showPicker && ((event.key === 'Tab' && !event.shiftKey) || (event.key === 'Enter' && !event.shiftKey && options[active]?.insert !== value))) { event.preventDefault(); if (options[active]) choose(options[active]); return; }
          if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (canSend) onSend(); }
        }} />
    </div>
    <div className="composer-footer"><small className="composer-hint">{!connected ? 'Reconnecting… your draft is saved.' : busy ? 'Working · you can draft your next message' : 'Enter to send · Shift+Enter for a new line'}</small><div className="row">{onStop && <button type="button" onClick={onStop} disabled={!connected}>Stop</button>}<button className="primary" type="submit" disabled={!canSend}>Send <span aria-hidden="true">↑</span></button></div></div>
  </form>;
}
