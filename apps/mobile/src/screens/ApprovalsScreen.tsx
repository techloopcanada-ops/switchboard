import React from 'react';
import { FlatList, Text, View } from 'react-native';
import { ApprovalCard, type Decide } from '../components/ApprovalCard';
import type { Approval } from '../connection';
import { s } from '../theme';

export function ApprovalsScreen({ approvals, onDecide }: { approvals: Approval[]; onDecide: Decide }) {
  return (
    <FlatList
      data={approvals}
      keyExtractor={a => a.id}
      contentContainerStyle={{ padding: 12, gap: 10, flexGrow: 1 }}
      ListEmptyComponent={
        <View style={{ padding: 24, gap: 8 }}>
          <Text style={s.h2}>Nothing waiting</Text>
          <Text style={s.muted}>When a bot wants to write a file, run a command, fetch a page or save a skill, it pauses here and in the chat until you decide. Unanswered requests are denied when they expire.</Text>
        </View>
      }
      renderItem={({ item }) => <ApprovalCard approval={item} onDecide={onDecide} />}
    />
  );
}
