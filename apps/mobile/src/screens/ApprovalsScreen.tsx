import React, { useEffect, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import type { Approval } from '../connection';
import { C, s } from '../theme';

function remaining(expiresAt: number, now: number): string {
  const sec = Math.max(0, Math.round((expiresAt - now) / 1000));
  return sec >= 60 ? `${Math.floor(sec / 60)}m ${sec % 60}s` : `${sec}s`;
}

export function ApprovalsScreen({ approvals, onDecide }: { approvals: Approval[]; onDecide: (id: string, decision: 'allow' | 'deny') => Promise<void> }) {
  const [now, setNow] = useState(Date.now());
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <FlatList
      data={approvals}
      keyExtractor={a => a.id}
      contentContainerStyle={{ padding: 12, gap: 10 }}
      ListEmptyComponent={<View style={{ padding: 24, gap: 8 }}><Text style={s.h2}>Nothing waiting</Text><Text style={s.muted}>When a bot wants to write a file, run a command, fetch a page or send a message, it pauses here until you allow or deny it. Unanswered requests are denied when they expire.</Text></View>}
      renderItem={({ item }) => (
        <View style={s.card}>
          <View style={s.between}>
            <Text style={s.caption}>{item.botName} · {item.category}</Text>
            <Text style={[s.caption, { color: item.expiresAt - now < 30_000 ? C.danger : C.muted }]}>{remaining(item.expiresAt, now)}</Text>
          </View>
          <Text style={s.h2}>{item.summary}</Text>
          <Text style={s.muted}>{item.toolName} · from {item.channel}</Text>
          <Pressable onPress={() => setOpen(open === item.id ? null : item.id)}><Text style={[s.muted, { color: C.mint }]}>{open === item.id ? 'Hide details' : 'Show details'}</Text></Pressable>
          {open === item.id && <Text style={[s.tool, { color: C.text }]} selectable>{JSON.stringify(item.args, null, 2).slice(0, 3000)}</Text>}
          <View style={[s.row, { marginTop: 6 }]}>
            <Pressable style={[s.button, s.flex]} onPress={() => onDecide(item.id, 'allow')} accessibilityLabel={`Allow ${item.summary}`}><Text style={s.buttonText}>Allow</Text></Pressable>
            <Pressable style={[s.button, s.buttonDanger, s.flex]} onPress={() => onDecide(item.id, 'deny')} accessibilityLabel={`Deny ${item.summary}`}><Text style={s.buttonDangerText}>Deny</Text></Pressable>
          </View>
        </View>
      )}
    />
  );
}
