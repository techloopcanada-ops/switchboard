import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, ScrollView, Text, TextInput, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { ActionSheet } from '../components/ActionSheet';
import { ApprovalCard, type Decide } from '../components/ApprovalCard';
import { HistorySheet } from '../components/HistorySheet';
import { api, type Approval, type Bot, type Connection, type ServerMessage, type SessionRow, type Socket } from '../connection';
import { Markdown } from '../markdown';
import { canClearSentDraft, finishDraftRun, sameChat, type SentDraft } from '../chat-state';
import { CURRENT_KEY, getJson, newChatKey, readDraft, saveDraft, setJson } from '../storage';
import { C, s } from '../theme';

interface Item {
  id: string;
  role: 'user' | 'bot' | 'tool' | 'error' | 'note';
  text: string;
  streaming?: boolean;
  meta?: string;
  retry?: string;
}

interface StoredMessage {
  role: 'user' | 'assistant' | 'toolResult' | 'system';
  content: string | { type: string; text?: string; name?: string; arguments?: unknown }[];
  toolName?: string;
  isError?: boolean;
  usage?: { cost?: { total?: number } };
}

interface Current {
  botId: string;
  chatKey: string;
}

const COMMANDS = [
  ['/help', 'Show commands'], ['/bots', 'List bots'], ['/bot ', 'Switch bot'], ['/new', 'New conversation'],
  ['/skills', 'List skills'], ['/learn', 'Suggest a skill from this chat'], ['/usage', 'Spend this month'], ['/status', 'What can this do'],
] as const;

function fromStored(messages: StoredMessage[]): Item[] {
  const items: Item[] = [];
  messages.forEach((m, i) => {
    if (m.role === 'user') {
      items.push({ id: `u${i}`, role: 'user', text: typeof m.content === 'string' ? m.content : m.content.map(c => c.text ?? '').join('') });
    } else if (m.role === 'assistant') {
      const parts = Array.isArray(m.content) ? m.content : [];
      const text = parts.filter(c => c.type === 'text').map(c => c.text ?? '').join('').trim();
      const calls = parts.filter(c => c.type === 'toolCall').map(c => c.name ?? 'tool');
      if (text) items.push({ id: `a${i}`, role: 'bot', text, meta: m.usage?.cost?.total ? `$${m.usage.cost.total.toFixed(4)}` : undefined });
      if (calls.length) items.push({ id: `t${i}`, role: 'tool', text: calls.map(n => `→ ${n}`).join('  ') });
    } else if (m.role === 'toolResult') {
      const text = Array.isArray(m.content) ? m.content.map(c => c.text ?? '').join('') : '';
      items.push({ id: `r${i}`, role: 'tool', text: `${m.isError ? '✗' : '✓'} ${m.toolName ?? 'tool'}${text ? `: ${text.slice(0, 140).replace(/\s+/g, ' ')}` : ''}` });
    }
  });
  return items;
}

export function ChatScreen({ connection, bots, socket, subscribe, online, approvals, onDecide, visible }: {
  connection: Connection;
  bots: Bot[];
  socket: Socket | null;
  subscribe: (listener: (message: ServerMessage) => void) => () => void;
  online: boolean;
  approvals: Approval[];
  onDecide: Decide;
  visible: boolean;
}) {
  const [current, setCurrent] = useState<Current | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const currentRef = useRef<Current | null>(null);
  const pendingId = useRef<string | null>(null);
  const sentDraft = useRef<SentDraft | null>(null);
  const runId = useRef<string | null>(null);
  const streamId = useRef<string | null>(null);
  const sessionId = useRef<string | null>(null);
  const textRef = useRef('');
  const draftRevision = useRef(0);
  const openVersion = useRef(0);
  const loadVersion = useRef(0);
  const navigating = useRef(false);
  const storageWarning = useRef(false);
  const wasOnline = useRef(online);
  const reconnectNotice = useRef<Item | null>(null);
  const list = useRef<FlatList<Item>>(null);
  const contentHeight = useRef(0);
  const dragging = useRef(false);
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  currentRef.current = current;
  const bot = bots.find(b => b.id === current?.botId);

  const push = useCallback((item: Item) => setItems(previous => [...previous, item]), []);

  const persist = useCallback((work: Promise<void>) => {
    void work.catch(() => {
      if (!storageWarning.current) {
        storageWarning.current = true;
        Alert.alert('Could not save on this phone', 'Your draft is still visible, but may not survive closing the app. Copy it before leaving.');
      }
    });
  }, []);

  const acknowledge = useCallback(() => {
    const request = sentDraft.current;
    if (!request || request.accepted) return;
    if (canClearSentDraft(request, currentRef.current, textRef.current, draftRevision.current)) {
      textRef.current = '';
      setText('');
      persist(saveDraft(request, ''));
    }
    request.accepted = true;
  }, [persist]);

  const load = useCallback(async (target: Current, quiet = false) => {
    const version = ++loadVersion.current;
    const view = openVersion.current;
    const stillCurrent = () => version === loadVersion.current && view === openVersion.current && sameChat(currentRef.current, target);
    if (!quiet) setLoading(true);
    try {
      const data = await api<{ session: { id: string } | null; messages: StoredMessage[] }>(connection, `/api/sessions?bot=${encodeURIComponent(target.botId)}&chat=${encodeURIComponent(target.chatKey)}`);
      if (!stillCurrent()) return;
      sessionId.current = data.session?.id ?? null;
      setItems(previous => (quiet && !data.messages.length ? previous : fromStored(data.messages)));
    } catch (e) {
      if (stillCurrent()) push({ id: `load-error-${Date.now()}`, role: 'error', text: `Could not load this conversation. ${(e as Error).message}` });
    } finally {
      if (stillCurrent()) setLoading(false);
    }
  }, [connection, push]);

  const open = useCallback(async (target: Current, note?: string) => {
    const version = ++openVersion.current;
    navigating.current = true;
    ++loadVersion.current;
    setCurrent(target);
    currentRef.current = target;
    persist(setJson(CURRENT_KEY, target));
    runId.current = null; streamId.current = null; pendingId.current = null; sessionId.current = null;
    sentDraft.current = null;
    reconnectNotice.current = null;
    setBusy(false);
    setLoading(true);
    setAtBottom(true);
    textRef.current = ''; setText(''); ++draftRevision.current;
    setItems(note ? [{ id: `note-${Date.now()}`, role: 'note', text: note }] : []);
    const draft = await readDraft(target);
    if (version !== openVersion.current || !sameChat(currentRef.current, target)) return;
    textRef.current = draft; setText(draft);
    await load(target);
    if (version === openVersion.current) navigating.current = false;
    if (note && version === openVersion.current) setItems(previous => (previous.some(i => i.role === 'note') ? previous : [{ id: `note-${Date.now()}`, role: 'note', text: note }, ...previous]));
  }, [load, persist]);

  useEffect(() => () => { ++openVersion.current; ++loadVersion.current; }, []);

  // Restore the last conversation on launch; fall back to a new one with the first bot.
  useEffect(() => {
    if (current || !bots.length) return;
    let cancelled = false;
    void (async () => {
      const saved = await getJson<Current>(CURRENT_KEY);
      if (cancelled) return;
      const target = saved && bots.some(b => b.id === saved.botId) ? saved : { botId: bots[0]!.id, chatKey: newChatKey() };
      await open(target);
    })();
    return () => { cancelled = true; };
  }, [bots, current, open]);

  // Remember what was typed in each conversation, so leaving and returning never loses it.
  function onChangeText(value: string) {
    textRef.current = value;
    ++draftRevision.current;
    setText(value);
    const target = currentRef.current;
    if (!target) return;
    persist(saveDraft(target, value));
  }

  useEffect(() => {
    if (wasOnline.current === online) return;
    wasOnline.current = online;
    if (!online) {
      const request = sentDraft.current;
      if (request || runId.current) {
        reconnectNotice.current = { id: `offline-${Date.now()}`, role: 'error', text: 'Connection interrupted. Review the refreshed conversation before sending again.', retry: request?.text };
        push(reconnectNotice.current);
      }
      pendingId.current = null; sentDraft.current = null;
      setBusy(false);
    } else if (currentRef.current) {
      const view = openVersion.current;
      const notice = reconnectNotice.current;
      reconnectNotice.current = null;
      void load(currentRef.current, true).then(() => {
        if (notice && view === openVersion.current) setItems(previous => previous.some(item => item.id === notice.id) ? previous : [...previous, notice]);
      });
    }
  }, [online, load, push]);

  useEffect(() => subscribe(message => {
    const cur = currentRef.current;
    if (!cur) return;
    if (message.type === 'chat') {
      const e = message.event;
      if (e.type === 'start') {
        if (e.chatKey !== cur.chatKey || e.botId !== cur.botId) return;
        ++loadVersion.current;
        setLoading(false);
        if (sentDraft.current) sentDraft.current.runId = e.runId;
        acknowledge();
        runId.current = e.runId; sessionId.current = e.sessionId; streamId.current = null;
        setBusy(true);
        return;
      }
      if (e.runId !== runId.current) return;
      if (e.type === 'delta') {
        ++loadVersion.current;
        if (!streamId.current) {
          const id = `stream-${e.runId}-${Date.now()}`;
          streamId.current = id;
          push({ id, role: 'bot', text: e.text, streaming: true });
        } else {
          const id = streamId.current;
          setItems(previous => previous.map(i => (i.id === id ? { ...i, text: i.text + e.text } : i)));
        }
      } else if (e.type === 'tool_start') {
        ++loadVersion.current;
        streamId.current = null;
        push({ id: `tool-${e.toolCallId}`, role: 'tool', text: `→ ${e.toolName}…` });
      } else if (e.type === 'tool_end') {
        ++loadVersion.current;
        setItems(previous => previous.map(i => (i.id === `tool-${e.toolCallId}` ? { ...i, text: `${e.isError ? '✗' : '✓'} ${e.toolName}${e.output ? `: ${e.output.slice(0, 140).replace(/\s+/g, ' ')}` : ''}` } : i)));
      } else if (e.type === 'done' || e.type === 'error') {
        const { pending: nextRequest, completed } = finishDraftRun(sentDraft.current, e.runId);
        const failure = e.type === 'error' ? { id: `err-${Date.now()}`, role: 'error' as const, text: e.message, retry: completed?.text } : null;
        if (failure && !textRef.current && completed?.accepted && draftRevision.current === completed.revision) {
          textRef.current = completed.text; setText(textRef.current);
          persist(saveDraft(cur, textRef.current));
        }
        runId.current = null; streamId.current = null;
        sentDraft.current = nextRequest;
        pendingId.current = nextRequest?.id ?? null;
        setBusy(!!nextRequest);
        const view = openVersion.current;
        void load(cur, true).then(() => { if (failure && view === openVersion.current) push(failure); });
      }
    } else if (message.type === 'command_result' && message.requestId === pendingId.current) {
      acknowledge();
      sentDraft.current = null;
      pendingId.current = null;
      setBusy(false);
      const c = message.command;
      if (c.switchBot) void open({ botId: c.switchBot, chatKey: newChatKey() }, c.reply);
      else if (c.newConversation) void open({ botId: cur.botId, chatKey: newChatKey() }, c.reply);
      else push({ id: `note-${Date.now()}`, role: 'note', text: c.reply });
    } else if (message.type === 'chat_result' && message.requestId === pendingId.current) {
      if (!message.result.error) acknowledge();
      else push({ id: `err-${Date.now()}`, role: 'error', text: message.result.error, retry: sentDraft.current?.text });
      sentDraft.current = null;
      pendingId.current = null;
      setBusy(false);
    } else if (message.type === 'error' && message.requestId === pendingId.current) {
      const retry = sentDraft.current?.text;
      sentDraft.current = null;
      pendingId.current = null; runId.current = null;
      setBusy(false);
      push({ id: `err-${Date.now()}`, role: 'error', text: message.message, retry });
    } else if (message.type === 'skill_learned') {
      push({ id: `learned-${Date.now()}`, role: 'note', text: `Learned a new skill: ${message.name}` });
    }
  }), [subscribe, push, load, open, acknowledge, persist]);

  function send(raw?: string) {
    const body = (raw ?? text).trim();
    const cur = currentRef.current;
    if (!body || busy || loading || navigating.current || !cur || pendingId.current) return;
    const id = `${Date.now()}`;
    if (!socket?.send({ type: 'chat', id, botId: cur.botId, chatKey: cur.chatKey, text: body })) {
      push({ id: `err-${id}`, role: 'error', text: 'Not connected to your computer. Your message is still in the box; wait for the connection to return.' });
      return;
    }
    pendingId.current = id;
    sentDraft.current = { ...cur, id, text: raw ?? text, revision: draftRevision.current, accepted: false };
    setBusy(true);
    push({ id: `u${id}`, role: 'user', text: body });
  }

  function abort() {
    if (sessionId.current) socket?.send({ type: 'abort', sessionId: sessionId.current });
  }

  async function openBot(botId: string) {
    if (busy || loading || navigating.current || botId === current?.botId) return;
    const version = ++openVersion.current;
    navigating.current = true;
    setLoading(true);
    try {
      const sessions = await api<SessionRow[]>(connection, `/api/sessions/list?bot=${encodeURIComponent(botId)}`);
      const latest = sessions[0];
      if (version !== openVersion.current) return;
      await open(latest ? { botId, chatKey: latest.chatKey } : { botId, chatKey: newChatKey() });
    } catch (e) {
      if (version === openVersion.current) { navigating.current = false; setLoading(false); Alert.alert('Could not open bot', (e as Error).message); }
    }
  }

  async function learn() {
    const cur = currentRef.current;
    if (!cur) return;
    const view = openVersion.current;
    push({ id: `note-${Date.now()}`, role: 'note', text: 'Reviewing this conversation for something worth keeping…' });
    try {
      const result = await api<{ message: string }>(connection, '/api/learn', { method: 'POST', body: JSON.stringify({ botId: cur.botId, chatKey: cur.chatKey }) });
      if (view === openVersion.current && sameChat(currentRef.current, cur)) push({ id: `note-${Date.now()}`, role: 'note', text: result.message });
    } catch (e) {
      if (view === openVersion.current && sameChat(currentRef.current, cur)) push({ id: `err-${Date.now()}`, role: 'error', text: (e as Error).message });
    }
  }

  function clearMessages() {
    const cur = currentRef.current;
    if (!cur || busy || loading) return;
    Alert.alert('Clear this conversation?', 'The messages are removed from your computer. The conversation itself stays.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: async () => {
        const view = openVersion.current;
        if (!sameChat(currentRef.current, cur)) return;
        ++loadVersion.current;
        setLoading(true);
        try {
          await api(connection, '/api/sessions/reset', { method: 'POST', body: JSON.stringify(cur) });
          if (view === openVersion.current && sameChat(currentRef.current, cur)) { ++loadVersion.current; setItems([]); }
        } catch (e) { Alert.alert('Could not clear messages', (e as Error).message); }
        finally { if (view === openVersion.current && sameChat(currentRef.current, cur)) setLoading(false); }
      } },
    ]);
  }

  function deleteConversation() {
    const cur = currentRef.current;
    if (!cur || busy || loading) return;
    const deletingId = sessionId.current;
    Alert.alert('Delete this conversation?', 'It is removed from your computer and cannot be recovered.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          if (deletingId) await api(connection, `/api/sessions/${deletingId}`, { method: 'DELETE' });
          await saveDraft(cur, '');
          if (sameChat(currentRef.current, cur)) await open({ botId: cur.botId, chatKey: newChatKey() });
        } catch (e) { Alert.alert('Could not delete conversation', (e as Error).message); }
      } },
    ]);
  }

  const pending = useMemo(() => approvals.filter(a => a.botId === current?.botId && a.chatKey === current?.chatKey), [approvals, current]);
  const commandHints = text.startsWith('/') && !text.includes(' ') ? COMMANDS.filter(([c]) => c.startsWith(text.toLowerCase())) : [];

  function onScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    setAtBottom(contentSize.height - (contentOffset.y + layoutMeasurement.height) < 80);
  }

  return (
    <View style={[s.flex, !visible && { display: 'none' }]}>
      <View style={[s.row, { paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.line }]}>
        <Pressable style={[s.chip, { paddingVertical: 8 }]} onPress={() => setHistoryOpen(true)} disabled={busy} accessibilityRole="button" accessibilityLabel="Conversations"><Text style={s.chipText}>☰ Chats</Text></Pressable>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, alignItems: 'center' }} style={s.flex}>
          {bots.map(b => (
            <Pressable key={b.id} style={[s.chip, b.id === current?.botId && s.chipActive]} onPress={() => void openBot(b.id)} disabled={busy || loading} accessibilityRole="button">
              <Text style={[s.chipText, b.id === current?.botId && s.chipTextActive]}>{b.emoji} {b.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <Pressable style={[s.chip, { paddingVertical: 8 }]} onPress={() => current && void open({ botId: current.botId, chatKey: newChatKey() })} disabled={busy || loading} accessibilityRole="button" accessibilityLabel="New conversation"><Text style={s.chipText}>＋</Text></Pressable>
        <Pressable style={[s.chip, { paddingVertical: 8 }]} onPress={() => setMenuOpen(true)} disabled={busy || loading} accessibilityRole="button" accessibilityLabel="More"><Text style={s.chipText}>⋯</Text></Pressable>
      </View>

      <View style={s.flex}>
        {loading ? <ActivityIndicator color={C.accent} style={{ marginTop: 24 }} /> : (
          <FlatList
            ref={list}
            style={s.flex}
            data={items}
            keyExtractor={i => i.id}
            contentContainerStyle={{ padding: 12, gap: 10, flexGrow: 1 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            onScrollBeginDrag={() => { dragging.current = true; setAtBottom(false); }}
            onScroll={event => { if (dragging.current) onScroll(event); }}
            onScrollEndDrag={event => { onScroll(event); dragging.current = false; }}
            onMomentumScrollBegin={() => { dragging.current = true; }}
            onMomentumScrollEnd={event => { onScroll(event); dragging.current = false; }}
            scrollEventThrottle={64}
            // Use measured height: scrollToEnd estimates unmeasured tall markdown rows.
            onContentSizeChange={(_, height) => { contentHeight.current = height; if (atBottom && !dragging.current) list.current?.scrollToOffset({ offset: height, animated: false }); }}
            onLayout={() => { if (atBottom && !dragging.current) list.current?.scrollToOffset({ offset: contentHeight.current, animated: false }); }}
            ListEmptyComponent={<View style={{ padding: 24, gap: 8 }}><Text style={s.h2}>{bot ? `${bot.emoji} ${bot.name}` : 'No bots yet'}</Text><Text style={s.muted}>{bot ? bot.description || 'Say hello. Type / for commands.' : 'Create a bot on your computer first.'}</Text></View>}
            ListFooterComponent={pending.length ? <View style={{ gap: 10, marginTop: 4 }}>{pending.map(a => <ApprovalCard key={a.id} approval={a} onDecide={onDecide} />)}</View> : undefined}
            renderItem={({ item }) => item.role === 'user' ? <View style={s.bubbleUser}><Text selectable style={[s.body, { fontSize: 16 }]}>{item.text}</Text></View>
              : item.role === 'tool' ? <Text style={[s.tool, { paddingHorizontal: 6 }]} numberOfLines={3}>{item.text}</Text>
                : item.role === 'error' ? <View style={{ gap: 8 }}><Text style={[s.muted, { color: C.danger, paddingHorizontal: 6 }]} selectable>{item.text}</Text>{item.retry && <Pressable accessibilityRole="button" onPress={() => {
                    const restore = () => { onChangeText(item.retry!); input.current?.focus(); };
                    if (textRef.current && textRef.current !== item.retry) Alert.alert('Replace the current draft?', 'Your failed message will be placed in the message box.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Restore message', onPress: restore }]);
                    else restore();
                  }}><Text style={[s.chipText, { color: C.mint }]}>Restore message</Text></Pressable>}</View>
                  : item.role === 'note' ? <View style={{ alignSelf: 'center', backgroundColor: C.line, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, maxWidth: '94%' }}><Text selectable style={[s.muted, { color: C.text }]}>{item.text}</Text></View>
                    : <View style={s.bubbleBot}><Markdown text={item.text || (item.streaming ? '…' : '')} />{item.meta ? <Text style={[s.muted, { marginTop: 6, fontSize: 11 }]}>{item.meta}</Text> : null}</View>}
          />
        )}
        {!atBottom && items.length > 0 ? (
          <Pressable style={{ alignSelf: 'flex-end', marginHorizontal: 14, marginVertical: 8, backgroundColor: C.card, borderColor: C.line, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }} onPress={() => { setAtBottom(true); list.current?.scrollToOffset({ offset: contentHeight.current, animated: true }); }} accessibilityRole="button"><Text style={s.chipText}>↓ Latest</Text></Pressable>
        ) : null}

        {commandHints.length ? (
          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 120, flexGrow: 0, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.card }}>
            {commandHints.map(([command, hint]) => (
              <Pressable key={command} style={[s.between, { paddingHorizontal: 14, paddingVertical: 10 }]} onPress={() => { onChangeText(command); input.current?.focus(); }} accessibilityRole="button">
                <Text style={[s.body, { fontWeight: '700' }]}>{command.trim()}</Text><Text style={s.muted}>{hint}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 10, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.bg }}>
          <TextInput
            ref={input}
            style={{ flex: 1, minHeight: 46, maxHeight: 140, backgroundColor: '#1B2340', borderWidth: 1, borderColor: '#3A4670', borderRadius: 14, color: '#FFFFFF', fontSize: 16, lineHeight: 22, paddingHorizontal: 14, paddingTop: 11, paddingBottom: 11, textAlignVertical: 'top' }}
            multiline
            value={text}
            onChangeText={onChangeText}
            placeholder={online ? `Message ${bot?.name ?? ''}` : 'Reconnecting…'}
            placeholderTextColor="#8D97BB"
            selectionColor={C.accent}
            cursorColor={C.accent}
            editable={!!current && !loading}
            returnKeyType="default"
            autoCapitalize="sentences"
            accessibilityLabel="Message"
          />
          {busy ? (
            <Pressable style={[s.button, s.buttonDanger, { height: 46, justifyContent: 'center' }]} onPress={abort} accessibilityRole="button" accessibilityLabel="Stop"><Text style={s.buttonDangerText}>Stop</Text></Pressable>
          ) : (
            <Pressable style={[s.button, { height: 46, justifyContent: 'center', opacity: !text.trim() || !online || loading ? 0.5 : 1 }]} onPress={() => send()} disabled={!text.trim() || !online || loading} accessibilityRole="button" accessibilityLabel="Send"><Text style={s.buttonText}>Send</Text></Pressable>
          )}
        </View>
      </View>

      <HistorySheet
        visible={historyOpen}
        connection={connection}
        bots={bots}
        currentChatKey={current?.chatKey}
        onClose={() => setHistoryOpen(false)}
        onOpen={session => void open({ botId: session.botId, chatKey: session.chatKey })}
        onDeleted={session => { if (sameChat(session, currentRef.current)) void open({ botId: session.botId, chatKey: newChatKey() }); }}
      />
      <ActionSheet
        visible={menuOpen}
        title="This conversation"
        onClose={() => setMenuOpen(false)}
        actions={[
          { label: 'Learn a skill from this chat', onPress: () => void learn() },
          { label: 'Clear messages', onPress: clearMessages },
          { label: 'Delete conversation', danger: true, onPress: deleteConversation },
        ]}
      />
    </View>
  );
}
