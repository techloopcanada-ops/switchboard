import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { ActionSheet } from '../components/ActionSheet';
import { ApprovalCard, type Decide } from '../components/ApprovalCard';
import { HistorySheet } from '../components/HistorySheet';
import { api, type Approval, type Bot, type Connection, type ServerMessage, type SessionRow, type Socket } from '../connection';
import { Markdown } from '../markdown';
import { CURRENT_KEY, draftKey, getJson, newChatKey, removeKey, setJson } from '../storage';
import { C, s } from '../theme';

interface Item {
  id: string;
  role: 'user' | 'bot' | 'tool' | 'error' | 'note';
  text: string;
  streaming?: boolean;
  meta?: string;
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
  const runId = useRef<string | null>(null);
  const streamId = useRef<string | null>(null);
  const sessionId = useRef<string | null>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const list = useRef<FlatList<Item>>(null);
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  currentRef.current = current;
  const bot = bots.find(b => b.id === current?.botId);

  const push = useCallback((item: Item) => setItems(previous => [...previous, item]), []);

  const load = useCallback(async (target: Current, quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const data = await api<{ session: { id: string } | null; messages: StoredMessage[] }>(connection, `/api/sessions?bot=${encodeURIComponent(target.botId)}&chat=${encodeURIComponent(target.chatKey)}`);
      if (currentRef.current?.chatKey !== target.chatKey) return;
      sessionId.current = data.session?.id ?? null;
      setItems(previous => (quiet && !data.messages.length ? previous : fromStored(data.messages)));
    } catch (e) {
      if (!quiet) setItems([{ id: 'load-error', role: 'error', text: `Could not load this conversation. ${(e as Error).message}` }]);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [connection]);

  const open = useCallback(async (target: Current, note?: string) => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    setCurrent(target);
    currentRef.current = target;
    void setJson(CURRENT_KEY, target);
    runId.current = null; streamId.current = null; pendingId.current = null; sessionId.current = null;
    setBusy(false);
    setItems(note ? [{ id: `note-${Date.now()}`, role: 'note', text: note }] : []);
    const draft = await getJson<string>(draftKey(target.chatKey));
    setText(draft ?? '');
    await load(target);
    if (note) setItems(previous => (previous.some(i => i.role === 'note') ? previous : [{ id: `note-${Date.now()}`, role: 'note', text: note }, ...previous]));
  }, [load]);

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
    setText(value);
    const target = currentRef.current;
    if (!target) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => { void (value ? setJson(draftKey(target.chatKey), value) : removeKey(draftKey(target.chatKey))); }, 300);
  }

  useEffect(() => subscribe(message => {
    const cur = currentRef.current;
    if (!cur) return;
    if (message.type === 'chat') {
      const e = message.event;
      if (e.type === 'start') {
        if (e.chatKey !== cur.chatKey || e.botId !== cur.botId) return;
        runId.current = e.runId; sessionId.current = e.sessionId; streamId.current = null;
        setBusy(true);
        return;
      }
      if (e.runId !== runId.current) return;
      if (e.type === 'delta') {
        if (!streamId.current) {
          const id = `stream-${e.runId}-${Date.now()}`;
          streamId.current = id;
          push({ id, role: 'bot', text: e.text, streaming: true });
        } else {
          const id = streamId.current;
          setItems(previous => previous.map(i => (i.id === id ? { ...i, text: i.text + e.text } : i)));
        }
      } else if (e.type === 'tool_start') {
        streamId.current = null;
        push({ id: `tool-${e.toolCallId}`, role: 'tool', text: `→ ${e.toolName}…` });
      } else if (e.type === 'tool_end') {
        setItems(previous => previous.map(i => (i.id === `tool-${e.toolCallId}` ? { ...i, text: `${e.isError ? '✗' : '✓'} ${e.toolName}${e.output ? `: ${e.output.slice(0, 140).replace(/\s+/g, ' ')}` : ''}` } : i)));
      } else if (e.type === 'done' || e.type === 'error') {
        if (e.type === 'error') push({ id: `err-${Date.now()}`, role: 'error', text: e.message });
        runId.current = null; streamId.current = null; pendingId.current = null;
        setBusy(false);
        void load(cur, true);
        setTimeout(() => input.current?.focus(), 50);
      }
    } else if (message.type === 'command_result' && message.requestId === pendingId.current) {
      pendingId.current = null;
      setBusy(false);
      const c = message.command;
      if (c.switchBot) void open({ botId: c.switchBot, chatKey: newChatKey() }, c.reply);
      else if (c.newConversation) void open({ botId: cur.botId, chatKey: newChatKey() }, c.reply);
      else push({ id: `note-${Date.now()}`, role: 'note', text: c.reply });
    } else if (message.type === 'chat_result' && message.requestId === pendingId.current) {
      pendingId.current = null;
      setBusy(false);
    } else if (message.type === 'error' && message.requestId === pendingId.current) {
      pendingId.current = null; runId.current = null;
      setBusy(false);
      push({ id: `err-${Date.now()}`, role: 'error', text: message.message });
    } else if (message.type === 'skill_learned') {
      push({ id: `learned-${Date.now()}`, role: 'note', text: `Learned a new skill: ${message.name}` });
    }
  }), [subscribe, push, load, open]);

  function send(raw?: string) {
    const body = (raw ?? text).trim();
    const cur = currentRef.current;
    if (!body || busy || !cur) return;
    const id = `${Date.now()}`;
    if (!socket?.send({ type: 'chat', id, botId: cur.botId, chatKey: cur.chatKey, text: body })) {
      push({ id: `err-${id}`, role: 'error', text: 'Not connected to your computer. Your message is still in the box; wait for the connection to return.' });
      return;
    }
    pendingId.current = id;
    setBusy(true);
    push({ id: `u${id}`, role: 'user', text: body });
    setText('');
    if (draftTimer.current) clearTimeout(draftTimer.current);
    void removeKey(draftKey(cur.chatKey));
  }

  function abort() {
    if (sessionId.current) socket?.send({ type: 'abort', sessionId: sessionId.current });
  }

  async function openBot(botId: string) {
    if (busy || botId === current?.botId) return;
    try {
      const sessions = await api<SessionRow[]>(connection, `/api/sessions/list?bot=${encodeURIComponent(botId)}`);
      const latest = sessions[0];
      await open(latest ? { botId, chatKey: latest.chatKey } : { botId, chatKey: newChatKey() });
    } catch {
      await open({ botId, chatKey: newChatKey() });
    }
  }

  async function learn() {
    const cur = currentRef.current;
    if (!cur) return;
    push({ id: `note-${Date.now()}`, role: 'note', text: 'Reviewing this conversation for something worth keeping…' });
    try {
      const result = await api<{ message: string }>(connection, '/api/learn', { method: 'POST', body: JSON.stringify({ botId: cur.botId, chatKey: cur.chatKey }) });
      push({ id: `note-${Date.now()}`, role: 'note', text: result.message });
    } catch (e) {
      push({ id: `err-${Date.now()}`, role: 'error', text: (e as Error).message });
    }
  }

  function clearMessages() {
    const cur = currentRef.current;
    if (!cur) return;
    Alert.alert('Clear this conversation?', 'The messages are removed from your computer. The conversation itself stays.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: async () => { await api(connection, '/api/sessions/reset', { method: 'POST', body: JSON.stringify(cur) }).catch(() => undefined); setItems([]); } },
    ]);
  }

  function deleteConversation() {
    const cur = currentRef.current;
    if (!cur) return;
    Alert.alert('Delete this conversation?', 'It is removed from your computer and cannot be recovered.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        if (sessionId.current) await api(connection, `/api/sessions/${sessionId.current}`, { method: 'DELETE' }).catch(() => undefined);
        await open({ botId: cur.botId, chatKey: newChatKey() });
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
        <Pressable style={[s.chip, { paddingVertical: 8 }]} onPress={() => setHistoryOpen(true)} accessibilityRole="button" accessibilityLabel="Conversations"><Text style={s.chipText}>☰ Chats</Text></Pressable>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, alignItems: 'center' }} style={s.flex}>
          {bots.map(b => (
            <Pressable key={b.id} style={[s.chip, b.id === current?.botId && s.chipActive]} onPress={() => void openBot(b.id)} disabled={busy} accessibilityRole="button">
              <Text style={[s.chipText, b.id === current?.botId && s.chipTextActive]}>{b.emoji} {b.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <Pressable style={[s.chip, { paddingVertical: 8 }]} onPress={() => current && void open({ botId: current.botId, chatKey: newChatKey() })} disabled={busy} accessibilityRole="button" accessibilityLabel="New conversation"><Text style={s.chipText}>＋</Text></Pressable>
        <Pressable style={[s.chip, { paddingVertical: 8 }]} onPress={() => setMenuOpen(true)} accessibilityRole="button" accessibilityLabel="More"><Text style={s.chipText}>⋯</Text></Pressable>
      </View>

      <KeyboardAvoidingView style={s.flex} behavior="padding">
        {loading ? <ActivityIndicator color={C.accent} style={{ marginTop: 24 }} /> : (
          <FlatList
            ref={list}
            style={s.flex}
            data={items}
            keyExtractor={i => i.id}
            contentContainerStyle={{ padding: 12, gap: 10, flexGrow: 1 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            onScroll={onScroll}
            scrollEventThrottle={64}
            onContentSizeChange={() => { if (atBottom) list.current?.scrollToEnd({ animated: false }); }}
            ListEmptyComponent={<View style={{ padding: 24, gap: 8 }}><Text style={s.h2}>{bot ? `${bot.emoji} ${bot.name}` : 'No bots yet'}</Text><Text style={s.muted}>{bot ? bot.description || 'Say hello. Type / for commands.' : 'Create a bot on your computer first.'}</Text></View>}
            ListFooterComponent={pending.length ? <View style={{ gap: 10, marginTop: 4 }}>{pending.map(a => <ApprovalCard key={a.id} approval={a} onDecide={onDecide} />)}</View> : undefined}
            renderItem={({ item }) => item.role === 'user' ? <View style={s.bubbleUser}><Text selectable style={[s.body, { fontSize: 16 }]}>{item.text}</Text></View>
              : item.role === 'tool' ? <Text style={[s.tool, { paddingHorizontal: 6 }]} numberOfLines={3}>{item.text}</Text>
                : item.role === 'error' ? <Text style={[s.muted, { color: C.danger, paddingHorizontal: 6 }]} selectable>{item.text}</Text>
                  : item.role === 'note' ? <View style={{ alignSelf: 'center', backgroundColor: C.line, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, maxWidth: '94%' }}><Text selectable style={[s.muted, { color: C.text }]}>{item.text}</Text></View>
                    : <View style={s.bubbleBot}><Markdown text={item.text || (item.streaming ? '…' : '')} />{item.meta ? <Text style={[s.muted, { marginTop: 6, fontSize: 11 }]}>{item.meta}</Text> : null}</View>}
          />
        )}
        {!atBottom && items.length > 3 ? (
          <Pressable style={{ position: 'absolute', right: 14, bottom: 96, backgroundColor: C.card, borderColor: C.line, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }} onPress={() => list.current?.scrollToEnd({ animated: true })} accessibilityRole="button"><Text style={s.chipText}>↓ Latest</Text></Pressable>
        ) : null}

        {commandHints.length ? (
          <View style={{ borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.card }}>
            {commandHints.map(([command, hint]) => (
              <Pressable key={command} style={[s.between, { paddingHorizontal: 14, paddingVertical: 10 }]} onPress={() => { onChangeText(command); input.current?.focus(); }} accessibilityRole="button">
                <Text style={[s.body, { fontWeight: '700' }]}>{command.trim()}</Text><Text style={s.muted}>{hint}</Text>
              </Pressable>
            ))}
          </View>
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
            editable={!!current}
            returnKeyType="default"
            autoCapitalize="sentences"
            accessibilityLabel="Message"
          />
          {busy ? (
            <Pressable style={[s.button, s.buttonDanger, { height: 46, justifyContent: 'center' }]} onPress={abort} accessibilityRole="button" accessibilityLabel="Stop"><Text style={s.buttonDangerText}>Stop</Text></Pressable>
          ) : (
            <Pressable style={[s.button, { height: 46, justifyContent: 'center', opacity: !text.trim() || !online ? 0.5 : 1 }]} onPress={() => send()} disabled={!text.trim() || !online} accessibilityRole="button" accessibilityLabel="Send"><Text style={s.buttonText}>Send</Text></Pressable>
          )}
        </View>
      </KeyboardAvoidingView>

      <HistorySheet
        visible={historyOpen}
        connection={connection}
        bots={bots}
        currentChatKey={current?.chatKey}
        onClose={() => setHistoryOpen(false)}
        onOpen={session => void open({ botId: session.botId, chatKey: session.chatKey })}
        onDeleted={session => { if (session.chatKey === currentRef.current?.chatKey) void open({ botId: session.botId, chatKey: newChatKey() }); }}
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
