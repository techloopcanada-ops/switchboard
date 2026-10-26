import React from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import type { Connection } from '../connection';
import type { PushStatus } from '../push';
import { C, s } from '../theme';

export function SettingsScreen({ connection, version, push, onRetryPush, onUnpair }: {
  connection: Connection;
  version: string;
  push: PushStatus | null;
  onRetryPush: () => void;
  onUnpair: () => Promise<void>;
}) {
  return (
    <ScrollView contentContainerStyle={[s.pad, { gap: 14 }]}>
      <View style={s.card}>
        <Text style={s.caption}>Connected computer</Text>
        <Text style={s.body}>{connection.url}</Text>
        <Text style={s.muted}>Switchboard {version || '…'} · device id {connection.deviceId}</Text>
      </View>
      <View style={s.card}>
        <Text style={s.caption}>Approval notifications</Text>
        <Text style={s.body}>{push ? push.detail : 'Checking…'}</Text>
        <Text style={s.muted}>Pushes go through Expo's notification service. The computer only sends the bot name and a one-line summary; the details stay on your network.</Text>
        {push && push.state !== 'registered' && <Pressable style={[s.button, s.buttonQuiet]} onPress={onRetryPush}><Text style={s.buttonQuietText}>Try again</Text></Pressable>}
      </View>
      <View style={s.card}>
        <Text style={s.caption}>How to use</Text>
        <Text style={s.body}>1. Chat: pick a bot at the top, send a message. Tool activity shows in green.</Text>
        <Text style={s.body}>2. Approvals: allow or deny what bots ask to do, from here or from the push.</Text>
        <Text style={s.body}>3. Everything else (providers, bots, channels, workflows, skills) is configured on the computer.</Text>
      </View>
      <Pressable style={[s.button, s.buttonDanger]} onPress={() => Alert.alert('Unpair this phone?', 'The computer will no longer send approvals here. You can pair again any time.', [{ text: 'Keep', style: 'cancel' }, { text: 'Unpair', style: 'destructive', onPress: () => { void onUnpair(); } }])}>
        <Text style={s.buttonDangerText}>Unpair</Text>
      </Pressable>
      <Text style={[s.muted, { textAlign: 'center' }]}>Switchboard mobile 0.1.0 · MIT · no accounts, no tracking</Text>
      <View style={{ height: 1, backgroundColor: C.line }} />
    </ScrollView>
  );
}
