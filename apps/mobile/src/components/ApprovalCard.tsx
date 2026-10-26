import React, { useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import type { Approval } from '../connection';
import { Markdown } from '../markdown';
import { C, s } from '../theme';

function remaining(expiresAt: number, now: number): string {
  const sec = Math.max(0, Math.round((expiresAt - now) / 1000));
  if (sec >= 3600) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  return sec >= 60 ? `${Math.floor(sec / 60)}m ${sec % 60}s` : `${sec}s`;
}

export type Decide = (id: string, decision: 'allow' | 'deny', remember?: boolean) => void;

/** One pending approval. Shown inline in the chat and on the Approvals tab. */
export function ApprovalCard({ approval, onDecide }: { approval: Approval; onDecide: Decide }) {
  const [now, setNow] = useState(Date.now());
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const isSkill = approval.toolName === 'save_skill';
  const args = (approval.args ?? {}) as Record<string, unknown>;
  const details = isSkill ? String(args.body ?? '') : JSON.stringify(approval.args, null, 2);
  const risky = approval.category === 'shell' || approval.category === 'self-modify';

  function always() {
    if (!risky) { onDecide(approval.id, 'allow', true); return; }
    Alert.alert(
      `Always allow ${approval.category} for ${approval.botName}?`,
      `${approval.botName} will stop asking before ${approval.category === 'shell' ? 'running commands' : 'changing its own skills and memory'}. You can change this later in Bots on your computer.`,
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Always allow', style: 'destructive', onPress: () => onDecide(approval.id, 'allow', true) }],
    );
  }

  return (
    <View style={[s.card, isSkill && { borderColor: C.mint }]}>
      <View style={s.between}>
        <Text style={s.caption}>{isSkill ? 'Suggested skill' : `${approval.botName} · ${approval.category}`}</Text>
        <Text style={[s.caption, { color: approval.expiresAt - now < 30_000 ? C.danger : C.muted }]}>{remaining(approval.expiresAt, now)}</Text>
      </View>
      <Text style={s.h2}>{isSkill ? String(args.name ?? approval.summary) : approval.summary}</Text>
      {isSkill && <Text style={s.muted}>{String(args.description ?? '')}</Text>}
      {!isSkill && <Text style={s.muted}>{approval.toolName} · from {approval.channel}</Text>}
      <Pressable onPress={() => setOpen(!open)} accessibilityRole="button"><Text style={[s.muted, { color: C.mint }]}>{open ? 'Hide details' : isSkill ? 'Read the steps' : 'Show details'}</Text></Pressable>
      {open && (isSkill
        ? <Markdown text={details.slice(0, 4000)} />
        : <Text style={[s.tool, { color: C.text }]} selectable>{details.slice(0, 3000)}</Text>)}
      <View style={[s.row, { marginTop: 6, flexWrap: 'wrap' }]}>
        <Pressable style={[s.button, s.flex]} onPress={() => onDecide(approval.id, 'allow')} accessibilityLabel={isSkill ? 'Save skill' : `Allow ${approval.summary}`}>
          <Text style={s.buttonText}>{isSkill ? 'Save skill' : 'Allow'}</Text>
        </Pressable>
        {!isSkill && (
          <Pressable style={[s.button, s.buttonQuiet, s.flex]} onPress={always} accessibilityLabel={`Always allow ${approval.category} for ${approval.botName}`}>
            <Text style={s.buttonQuietText}>Always</Text>
          </Pressable>
        )}
        <Pressable style={[s.button, s.buttonDanger, s.flex]} onPress={() => onDecide(approval.id, 'deny')} accessibilityLabel={isSkill ? 'Not now' : `Deny ${approval.summary}`}>
          <Text style={s.buttonDangerText}>{isSkill ? 'Not now' : 'Deny'}</Text>
        </Pressable>
      </View>
    </View>
  );
}
