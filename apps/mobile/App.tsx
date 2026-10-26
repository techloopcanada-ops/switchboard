import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { api, clearConnection, loadConnection, saveConnection, Socket, type Approval, type ApprovalResolved, type Bot, type ChatEvent, type Connection, type ServerMessage } from './src/connection';
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

function Root() {
  const [connection, setConnection] = useState<Connection | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>('chat');
  const [bots, setBots] = useState<Bot[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [online, setOnline] = useState(false);
  const [push, setPush] = useState<PushStatus | null>(null);
  const [version, setVersion] = useState('');
  const socketRef = useRef<Socket | null>(null);
  const chatListeners = useRef(new Set<(event: ChatEvent) => void>());

  useEffect(() => { loadConnection().then(setConnection); }, []);

  // One socket per connection; screens subscribe to chat events through chatListeners.
  useEffect(() => {
    if (!connection) return;
    const socket = new Socket(connection);
    socketRef.current = socket;
    const onMessage = (message: ServerMessage) => {
      switch (message.type) {
        case 'hello': setBots(message.bots); setApprovals(message.approvals); setVersion(message.version); break;
        case 'bots': setBots(message.bots); break;
        case 'approval': setApprovals(list => [...list.filter(a => a.id !== message.request.id), message.request]); break;
        case 'approval_resolved': setApprovals(list => list.filter(a => a.id !== (message.resolved as ApprovalResolved).id)); break;
        case 'chat': for (const l of chatListeners.current) l(message.event); break;
        default: break;
      }
    };
    socket.listeners.add(onMessage);
    socket.statusListeners.add(setOnline);
    socket.connect();
    registerForPush(connection, 'Phone').then(setPush);
    const sub = AppState.addEventListener('change', state => { if (state === 'active') api<Approval[]>(connection, '/api/approvals').then(setApprovals).catch(() => undefined); });
    return () => { sub.remove(); socket.close(); socketRef.current = null; };
  }, [connection]);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(() => setTab('approvals'));
    return () => sub.remove();
  }, []);

  const decide = useCallback(async (id: string, decision: 'allow' | 'deny') => {
    if (!connection) return;
    setApprovals(list => list.filter(a => a.id !== id));
    await api(connection, `/api/approvals/${id}`, { method: 'POST', body: JSON.stringify({ decision, by: 'phone' }) }).catch(() => undefined);
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

  const subscribeChat = useCallback((listener: (event: ChatEvent) => void) => {
    chatListeners.current.add(listener);
    return () => { chatListeners.current.delete(listener); };
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
      <View style={[s.between, { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.line }]}>
        <Text style={s.h2}>Switchboard</Text>
        <View style={s.row}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: online ? C.mint : C.danger }} />
          <Text style={s.muted}>{online ? 'connected' : 'reconnecting…'}</Text>
        </View>
      </View>
      <View style={s.flex}>
        {tab === 'chat' && <ChatScreen connection={connection} bots={bots} socket={socketRef.current} subscribe={subscribeChat} online={online} />}
        {tab === 'approvals' && <ApprovalsScreen approvals={approvals} onDecide={decide} />}
        {tab === 'settings' && <SettingsScreen connection={connection} version={version} push={push} onRetryPush={() => registerForPush(connection, 'Phone').then(setPush)} onUnpair={unpair} />}
      </View>
      <View style={s.tabBar}>
        {tabs.map(t => (
          <Pressable key={t.id} style={s.tab} onPress={() => setTab(t.id)} accessibilityRole="tab" accessibilityState={{ selected: tab === t.id }}>
            <Text style={{ fontSize: 18 }}>{t.icon}</Text>
            <Text style={[s.tabText, tab === t.id && s.tabTextActive]}>{t.label}</Text>
            {t.id === 'approvals' && approvals.length > 0 && <View style={s.badge}><Text style={s.badgeText}>{approvals.length}</Text></View>}
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}
