import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, Keyboard, KeyboardAvoidingView, Pressable, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { api, clearConnection, loadConnection, saveConnection, Socket, type Approval, type Bot, type Connection, type ServerMessage } from './src/connection';
import { createApprovalState } from './src/approval-state';
import { registerForPush, type PushStatus } from './src/push';
import { ApprovalsScreen } from './src/screens/ApprovalsScreen';
import { ChatScreen } from './src/screens/ChatScreen';
import { PairScreen } from './src/screens/PairScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { C, s } from './src/theme';

type Tab = 'chat' | 'approvals' | 'settings';

export default function App() {
  return <SafeAreaProvider><Root /></SafeAreaProvider>;
}

/** True while the on-screen keyboard is up. The tab bar steps aside so the message box keeps the room. */
function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setOpen(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setOpen(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return open;
}

function Root() {
  const [connection, setConnection] = useState<Connection | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>('chat');
  const [bots, setBots] = useState<Bot[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [online, setOnline] = useState(false);
  const [push, setPush] = useState<PushStatus | null>(null);
  const [version, setVersion] = useState('');
  const [socket, setSocket] = useState<Socket | null>(null);
  const listeners = useRef(new Set<(message: ServerMessage) => void>());
  const approvalState = useRef<{ connection: Connection; state: ReturnType<typeof createApprovalState> } | null>(null);
  const keyboardOpen = useKeyboardOpen();

  useEffect(() => { loadConnection().then(setConnection); }, []);

  // One socket per connection; screens subscribe to server messages through `listeners`.
  useEffect(() => {
    if (!connection) return;
    const state = createApprovalState(setApprovals);
    approvalState.current = { connection, state };
    state.replace([]);
    setOnline(false);
    const next = new Socket(connection);
    setSocket(next);
    const onMessage = (message: ServerMessage) => {
      if (state.closed) return;
      switch (message.type) {
        case 'hello': setBots(message.bots); state.replace(message.approvals); setVersion(message.version); break;
        case 'bots': setBots(message.bots); break;
        case 'approval': state.add(message.request); break;
        case 'approval_resolved': state.remove(message.resolved.id); break;
        default: break;
      }
      for (const listener of listeners.current) listener(message);
    };
    next.listeners.add(onMessage);
    next.statusListeners.add(value => { if (!state.closed) setOnline(value); });
    next.connect();
    registerForPush(connection, 'Phone').then(value => { if (!state.closed) setPush(value); });
    const sub = AppState.addEventListener('change', appState => {
      if (appState === 'active') state.refresh(() => api<Approval[]>(connection, '/api/approvals')).catch(() => undefined);
    });
    return () => { state.close(); approvalState.current = null; sub.remove(); next.close(); setSocket(null); };
  }, [connection]);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(() => setTab('approvals'));
    return () => sub.remove();
  }, []);

  const decide = useCallback(async (id: string, decision: 'allow' | 'deny', remember = false) => {
    const current = approvalState.current;
    if (!connection || current?.connection !== connection) return;
    try {
      const ok = await current.state.decide(id, () => api<{ ok: boolean }>(connection, `/api/approvals/${id}`, { method: 'POST', body: JSON.stringify({ decision, by: 'phone', remember }) }));
      if (ok === false) Alert.alert('Request no longer waiting', 'It was already resolved or expired.');
    } catch (error) {
      if (!current.state.closed) Alert.alert('Decision not confirmed', `${error instanceof Error ? error.message : String(error)}\n\nIf the request is still waiting, you can retry.`);
    }
  }, [connection]);

  const pair = useCallback(async (next: Connection) => {
    await saveConnection(next);
    setConnection(next);
    setTab('chat');
  }, []);

  const unpair = useCallback(async () => {
    await clearConnection();
    setConnection(null);
    setBots([]); setApprovals([]); setPush(null);
  }, []);

  const subscribe = useCallback((listener: (message: ServerMessage) => void) => {
    listeners.current.add(listener);
    return () => { listeners.current.delete(listener); };
  }, []);

  const tabs = useMemo(() => ([
    { id: 'chat' as const, label: 'Chat', icon: '💬' },
    { id: 'approvals' as const, label: 'Approvals', icon: '✅' },
    { id: 'settings' as const, label: 'Settings', icon: '⚙️' },
  ]), []);

  if (connection === undefined) return <SafeAreaView style={s.safe}><StatusBar style="light" /></SafeAreaView>;
  if (!connection) return <SafeAreaView style={s.safe}><StatusBar style="light" /><PairScreen onPaired={pair} /></SafeAreaView>;

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar style="light" />
      {/* Keep keyboard coordinates relative to the screen, including both headers. */}
      <KeyboardAvoidingView style={s.flex} behavior="padding">
      <View style={[s.between, { paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.line }]}>
        <Text style={s.h2}>Switchboard</Text>
        <View style={s.row}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: online ? C.mint : C.danger }} />
          <Text style={s.muted}>{online ? 'connected' : 'reconnecting…'}</Text>
        </View>
      </View>
      <View style={s.flex}>
        <ChatScreen connection={connection} bots={bots} socket={socket} subscribe={subscribe} online={online} approvals={approvals} onDecide={decide} visible={tab === 'chat'} />
        {tab === 'approvals' && <ApprovalsScreen approvals={approvals} onDecide={decide} />}
        {tab === 'settings' && <SettingsScreen connection={connection} version={version} push={push} onRetryPush={() => registerForPush(connection, 'Phone').then(setPush)} onUnpair={unpair} />}
      </View>
      {!keyboardOpen && (
        <View style={s.tabBar}>
          {tabs.map(t => (
            <Pressable key={t.id} style={s.tab} onPress={() => setTab(t.id)} accessibilityRole="tab" accessibilityState={{ selected: tab === t.id }}>
              <Text style={{ fontSize: 18 }}>{t.icon}</Text>
              <Text style={[s.tabText, tab === t.id && s.tabTextActive]}>{t.label}</Text>
              {t.id === 'approvals' && approvals.length > 0 && <View style={s.badge}><Text style={s.badgeText}>{approvals.length}</Text></View>}
            </Pressable>
          ))}
        </View>
      )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
