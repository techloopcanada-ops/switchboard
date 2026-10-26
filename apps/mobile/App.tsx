import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Keyboard, Pressable, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { api, clearConnection, loadConnection, saveConnection, Socket, type Approval, type ApprovalResolved, type Bot, type Connection, type ServerMessage } from './src/connection';
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
  const keyboardOpen = useKeyboardOpen();

  useEffect(() => { loadConnection().then(setConnection); }, []);

  // One socket per connection; screens subscribe to server messages through `listeners`.
  useEffect(() => {
    if (!connection) return;
    const next = new Socket(connection);
    setSocket(next);
    const onMessage = (message: ServerMessage) => {
      switch (message.type) {
        case 'hello': setBots(message.bots); setApprovals(message.approvals); setVersion(message.version); break;
        case 'bots': setBots(message.bots); break;
        case 'approval': setApprovals(list => [...list.filter(a => a.id !== message.request.id), message.request]); break;
        case 'approval_resolved': setApprovals(list => list.filter(a => a.id !== (message.resolved as ApprovalResolved).id)); break;
        default: break;
      }
      for (const listener of listeners.current) listener(message);
    };
    next.listeners.add(onMessage);
    next.statusListeners.add(setOnline);
    next.connect();
    registerForPush(connection, 'Phone').then(setPush);
    const sub = AppState.addEventListener('change', state => { if (state === 'active') api<Approval[]>(connection, '/api/approvals').then(setApprovals).catch(() => undefined); });
    return () => { sub.remove(); next.close(); setSocket(null); };
  }, [connection]);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(() => setTab('approvals'));
    return () => sub.remove();
  }, []);

  const decide = useCallback((id: string, decision: 'allow' | 'deny', remember = false) => {
    if (!connection) return;
    setApprovals(list => list.filter(a => a.id !== id));
    api(connection, `/api/approvals/${id}`, { method: 'POST', body: JSON.stringify({ decision, by: 'phone', remember }) }).catch(() => undefined);
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
    </SafeAreaView>
  );
}
