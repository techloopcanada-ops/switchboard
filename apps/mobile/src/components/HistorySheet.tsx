import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Pressable, SectionList, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, type Bot, type Connection, type SessionRow } from '../connection';
import { groupSessions, relativeTime, searchSessions } from '../history';
import { C, s } from '../theme';
import { ActionSheet } from './ActionSheet';
import { sameChat } from '../chat-state';
import { listDrafts, saveDraft, type SavedDraft } from '../storage';

interface HistoryRow extends SessionRow { local?: boolean }

/** Every conversation across all bots. Tap to open; long-press for rename and delete. */
export function HistorySheet({ visible, connection, bots, currentChatKey, onOpen, onClose, onDeleted }: {
  visible: boolean;
  connection: Connection;
  bots: Bot[];
  currentChatKey: string | undefined;
  onOpen: (session: SessionRow) => void;
  onClose: () => void;
  onDeleted: (session: SessionRow) => void;
}) {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [drafts, setDrafts] = useState<SavedDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [menuFor, setMenuFor] = useState<HistoryRow | null>(null);
  const [renaming, setRenaming] = useState<SessionRow | null>(null);
  const [title, setTitle] = useState('');
  const loadVersion = useRef(0);

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true); setError('');
    const saved = await listDrafts();
    if (version !== loadVersion.current) return;
    setDrafts(saved);
    try {
      const next = await api<SessionRow[]>(connection, '/api/sessions/list');
      if (version === loadVersion.current) setSessions(next);
    }
    catch (e) { if (version === loadVersion.current) setError((e as Error).message); }
    finally { if (version === loadVersion.current) setLoading(false); }
  }, [connection]);

  useEffect(() => {
    if (visible) { setQuery(''); void load(); }
    return () => { ++loadVersion.current; };
  }, [visible, load]);

  const sections = useMemo(() => {
    const local: HistoryRow[] = drafts.filter(draft => bots.some(bot => bot.id === draft.botId) && !sessions.some(session => sameChat(session, draft))).map(draft => ({
      ...draft, id: `draft:${draft.botId}:${draft.chatKey}`, local: true, title: draft.text.trim().slice(0, 80) || 'Unsent draft', preview: draft.text,
      channel: 'phone draft', createdAt: draft.updatedAt, messageCount: 0,
    }));
    const matching = searchSessions(local, query) as HistoryRow[];
    return [...(matching.length ? [{ title: 'Drafts on this phone', data: matching }] : []), ...groupSessions(searchSessions(sessions, query))];
  }, [sessions, drafts, bots, query]);
  const botOf = (id: string) => bots.find(b => b.id === id);

  async function saveRename() {
    if (!renaming || !title.trim()) return;
    try { await api(connection, `/api/sessions/${renaming.id}`, { method: 'PUT', body: JSON.stringify({ title: title.trim() }) }); setRenaming(null); await load(); }
    catch (e) { Alert.alert('Could not rename', (e as Error).message); }
  }

  function confirmDelete(session: HistoryRow) {
    Alert.alert(session.local ? 'Delete this draft?' : 'Delete this conversation?', session.local ? 'This unsent draft will be removed from your phone.' : `"${session.title || 'Untitled'}" and its messages will be removed from your computer.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          if (!session.local) await api(connection, `/api/sessions/${session.id}`, { method: 'DELETE' });
          await saveDraft(session, ''); onDeleted(session); await load();
        }
        catch (e) { Alert.alert('Could not delete', (e as Error).message); }
      } },
    ]);
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <SafeAreaView style={s.safe}>
        <KeyboardAvoidingView style={s.flex} behavior="padding">
          <View style={[s.between, { padding: 14, gap: 10 }]}>
            <Text style={s.h1}>Conversations</Text>
            <Pressable style={[s.button, s.buttonQuiet, { paddingVertical: 8 }]} onPress={onClose} accessibilityRole="button"><Text style={s.buttonQuietText}>Close</Text></Pressable>
          </View>
          <View style={{ paddingHorizontal: 14, paddingBottom: 8 }}>
            <TextInput style={[s.input, { fontSize: 16 }]} value={query} onChangeText={setQuery} placeholder="Search conversations" placeholderTextColor={C.muted} selectionColor={C.accent} cursorColor={C.accent} autoCorrect={false} />
          </View>
          {loading && !sessions.length ? <ActivityIndicator color={C.accent} style={{ marginTop: 24 }} /> : null}
          {error ? <Text style={[s.muted, { color: C.danger, padding: 14 }]}>{error}</Text> : null}
          <SectionList
            sections={sections}
            keyExtractor={item => item.id}
            refreshing={loading}
            onRefresh={load}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 24 }}
            ListEmptyComponent={!loading && !error ? <Text style={[s.muted, { padding: 24, textAlign: 'center' }]}>{query ? 'No conversations match.' : 'Your conversations will appear here once you send a message.'}</Text> : undefined}
            renderSectionHeader={({ section }) => <Text style={[s.caption, { paddingTop: 16, paddingBottom: 6, backgroundColor: C.bg }]}>{section.title}</Text>}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => { onClose(); onOpen(item); }}
                onLongPress={() => setMenuFor(item)}
                accessibilityRole="button"
                accessibilityLabel={`Open ${item.title || 'conversation'}`}
                style={({ pressed }) => [{ paddingVertical: 12, paddingHorizontal: 12, borderRadius: 12, marginBottom: 6, backgroundColor: item.chatKey === currentChatKey ? C.card : 'transparent', borderWidth: 1, borderColor: item.chatKey === currentChatKey ? C.line : 'transparent' }, pressed && { opacity: 0.7 }]}
              >
                <View style={s.between}>
                  <Text style={[s.body, { fontWeight: '700', flex: 1 }]} numberOfLines={1}>{botOf(item.botId)?.emoji ?? '💬'} {item.title || 'Untitled'}</Text>
                  <Pressable onPress={() => setMenuFor(item)} hitSlop={12} accessibilityLabel="Conversation options"><Text style={{ color: C.muted, fontSize: 20, paddingHorizontal: 6 }}>⋯</Text></Pressable>
                </View>
                {item.preview ? <Text style={s.muted} numberOfLines={1}>{item.preview}</Text> : null}
                <Text style={[s.muted, { fontSize: 11 }]}>{botOf(item.botId)?.name ?? item.botId} · {item.channel} · {relativeTime(item.updatedAt)} · {item.messageCount ?? 0} messages</Text>
              </Pressable>
            )}
          />
        </KeyboardAvoidingView>
        <ActionSheet
          visible={!!menuFor}
          title={menuFor?.title || 'Conversation'}
          onClose={() => setMenuFor(null)}
          actions={menuFor ? [
              ...(!menuFor.local ? [{ label: 'Rename', onPress: () => { setRenaming(menuFor); setTitle(menuFor.title); } }] : []),
            { label: 'Delete', danger: true, onPress: () => confirmDelete(menuFor) },
          ] : []}
        />
        <Modal visible={!!renaming} transparent animationType="fade" onRequestClose={() => setRenaming(null)} statusBarTranslucent navigationBarTranslucent>
          <KeyboardAvoidingView style={{ flex: 1, backgroundColor: '#000A', justifyContent: 'center', padding: 20 }} behavior="padding">
            <View style={[s.card, { gap: 12 }]}>
              <Text style={s.h2}>Rename conversation</Text>
              <TextInput style={[s.input, { fontSize: 16 }]} value={title} onChangeText={setTitle} autoFocus maxLength={80} selectionColor={C.accent} cursorColor={C.accent} placeholder="Title" placeholderTextColor={C.muted} onSubmitEditing={saveRename} />
              <View style={s.row}>
                <Pressable style={[s.button, s.buttonQuiet, s.flex]} onPress={() => setRenaming(null)}><Text style={s.buttonQuietText}>Cancel</Text></Pressable>
                <Pressable style={[s.button, s.flex]} onPress={saveRename}><Text style={s.buttonText}>Save</Text></Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </SafeAreaView>
    </Modal>
  );
}
