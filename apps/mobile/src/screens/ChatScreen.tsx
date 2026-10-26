import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { api, type Bot, type ChatEvent, type Connection, type Socket } from '../connection';
import { C, s } from '../theme';

interface Item {
  id: string;
  role: 'user' | 'bot' | 'tool' | 'error';
  text: string;
  streaming?: boolean;
  meta?: string;
}

interface StoredMessage {
  role: 'user' | 'assistant' | 'toolResult' | 'system';
  content: string | { type: string; text?: string; name?: string; arguments?: unknown }[];
  toolName?: string;
  isError?: boolean;
  timestamp?: number;
}

function fromStored(messages: StoredMessage[]): Item[] {
  const items: Item[] = [];
  messages.forEach((m, i) => {
    if (m.role === 'user') {
      items.push({ id: `u${i}`, role: 'user', text: typeof m.content === 'string' ? m.content : m.content.map(c => c.text ?? '').join('') });
    } else if (m.role === 'assistant') {
      const parts = Array.isArray(m.content) ? m.content : [];
      const text = parts.filter(c => c.type === 'text').map(c => c.text ?? '').join('').trim();
      const calls = parts.filter(c => c.type === 'toolCall').map(c => c.name ?? 'tool');
      if (calls.length) items.push({ id: `t${i}`, role: 'tool', text: calls.map(n => `→ ${n}`).join('\n') });
      if (text) items.push({ id: `a${i}`, role: 'bot', text });
    } else if (m.role === 'toolResult') {
      const text = Array.isArray(m.content) ? m.content.map(c => c.text ?? '').join('') : '';
      items.push({ id: `r${i}`, role: 'tool', text: `${m.isError ? '✗' : '✓'} ${m.toolName ?? 'tool'}${text ? `: ${text.slice(0, 160).replace(/\s+/g, ' ')}` : ''}` });
    }
  });
  return items;
}

export function ChatScreen({ connection, bots, socket, subscribe, online }: {
  connection: Connection;
  bots: Bot[];
  socket: Socket | null;
  subscribe: (listener: (event: ChatEvent) => void) => () => void;
  online: boolean;
}) {
  const [botId, setBotId] = useState<string>('');
  const [items, setItems] = useState<Item[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const activeRun = useRef<string | null>(null);
  const sessionId = useRef<string | null>(null);
  const list = useRef<FlatList<Item>>(null);
  const chatKey = `mobile:${connection.deviceId}`;
  const bot = bots.find(b => b.id === botId) ?? bots[0];

  useEffect(() => { if (!botId && bots[0]) setBotId(bots[0].id); }, [bots, botId]);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const data = await api<{ session: { id: string }; messages: StoredMessage[] }>(connection, `/api/sessions?bot=${encodeURIComponent(id)}&chat=${encodeURIComponent(chatKey)}`);
      sessionId.current = data.session.id;
      setItems(fromStored(data.messages));
    } catch (e) {
      setItems([{ id: 'err', role: 'error', text: (e as Error).message }]);
    } finally {
      setLoading(false);
    }
  }, [connection, chatKey]);

  useEffect(() => { if (bot) void load(bot.id); }, [bot?.id, load]);

  useEffect(() => subscribe(event => {
    if (event.type === 'start') {
      if (event.chatKey !== chatKey || event.botId !== bot?.id) return;
      activeRun.current = event.runId;
      sessionId.current = event.sessionId;
      setItems(list => [...list, { id: event.runId, role: 'bot', text: '', streaming: true }]);
      return;
    }
    if (event.runId !== activeRun.current) return;
    if (event.type === 'delta') setItems(list => list.map(i => i.id === event.runId ? { ...i, text: i.text + event.text } : i));
    if (event.type === 'tool_start') setItems(list => [...list.filter(i => i.id !== event.runId), { id: `${event.toolCallId}`, role: 'tool', text: `→ ${event.toolName}` }, ...list.filter(i => i.id === event.runId)]);
    if (event.type === 'tool_end') setItems(list => list.map(i => i.id === event.toolCallId ? { ...i, text: `${event.isError ? '✗' : '✓'} ${event.toolName}${event.output ? `: ${event.output.slice(0, 160).replace(/\s+/g, ' ')}` : ''}` } : i));
    if (event.type === 'done') { setItems(list => list.map(i => i.id === event.runId ? { ...i, text: i.text || event.text, streaming: false, meta: event.costUsd ? `$${event.costUsd.toFixed(4)}` : undefined } : i)); setBusy(false); activeRun.current = null; }
    if (event.type === 'error') { setItems(list => [...list.filter(i => i.id !== event.runId || i.text), { id: `e${Date.now()}`, role: 'error', text: event.message }]); setBusy(false); activeRun.current = null; }
  }), [subscribe, chatKey, bot?.id]);

  function send() {
    const body = text.trim();
    if (!body || !bot || busy) return;
    if (!socket?.send({ type: 'chat', id: `${Date.now()}`, botId: bot.id, chatKey, text: body })) {
      setItems(list => [...list, { id: `e${Date.now()}`, role: 'error', text: 'Not connected. Wait for the connection to come back.' }]);
      return;
    }
    setItems(list => [...list, { id: `u${Date.now()}`, role: 'user', text: body }]);
    setText('');
    setBusy(true);
  }

  async function reset() {
    if (!bot) return;
    await api(connection, '/api/sessions/reset', { method: 'POST', body: JSON.stringify({ botId: bot.id, chatKey }) }).catch(() => undefined);
    setItems([]);
  }

  function abort() {
    if (sessionId.current) socket?.send({ type: 'abort', sessionId: sessionId.current });
  }

  return (
    <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={60}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 12, paddingVertical: 10 }} style={{ flexGrow: 0 }}>
        {bots.map(b => (
          <Pressable key={b.id} style={[s.chip, b.id === bot?.id && s.chipActive]} onPress={() => setBotId(b.id)} disabled={busy}>
            <Text style={[s.chipText, b.id === bot?.id && s.chipTextActive]}>{b.emoji} {b.name}</Text>
          </Pressable>
        ))}
        {bot && <Pressable style={s.chip} onPress={reset} disabled={busy}><Text style={s.chipText}>↺ New</Text></Pressable>}
      </ScrollView>
      {loading ? <ActivityIndicator color={C.accent} style={{ marginTop: 24 }} /> : (
        <FlatList
          ref={list}
          data={items}
          keyExtractor={i => i.id}
          contentContainerStyle={{ padding: 12, gap: 8 }}
          onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
          ListEmptyComponent={<View style={{ padding: 24, gap: 8 }}><Text style={s.h2}>{bot ? `${bot.emoji} ${bot.name}` : 'No bots yet'}</Text><Text style={s.muted}>{bot ? bot.description || 'Say hello. Tool calls that need approval will show up in the Approvals tab.' : 'Create a bot on your computer first.'}</Text></View>}
          renderItem={({ item }) => item.role === 'user' ? <View style={s.bubbleUser}><Text style={s.body}>{item.text}</Text></View>
            : item.role === 'tool' ? <Text style={[s.tool, { paddingHorizontal: 6 }]}>{item.text}</Text>
              : item.role === 'error' ? <Text style={[s.muted, { color: C.danger, paddingHorizontal: 6 }]}>{item.text}</Text>
                : <View style={s.bubbleBot}><Text style={s.body}>{item.text || (item.streaming ? '…' : '')}</Text>{item.meta && <Text style={[s.muted, { marginTop: 6 }]}>{item.meta}</Text>}</View>}
        />
      )}
      <View style={[s.row, { padding: 10, borderTopWidth: 1, borderTopColor: C.line }]}>
        <TextInput style={[s.input, s.flex, { maxHeight: 120 }]} multiline value={text} onChangeText={setText} placeholder={online ? `Message ${bot?.name ?? ''}` : 'Reconnecting…'} placeholderTextColor={C.muted} editable={!!bot} />
        {busy ? <Pressable style={[s.button, s.buttonDanger]} onPress={abort}><Text style={s.buttonDangerText}>Stop</Text></Pressable>
          : <Pressable style={s.button} onPress={send} disabled={!text.trim() || !bot || !online}><Text style={s.buttonText}>Send</Text></Pressable>}
      </View>
    </KeyboardAvoidingView>
  );
}
