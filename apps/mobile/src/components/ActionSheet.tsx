import React from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { C, s } from '../theme';

export interface SheetAction {
  label: string;
  danger?: boolean;
  onPress: () => void;
}

/** A bottom sheet of actions. Android alerts allow only three buttons, so menus use this. */
export function ActionSheet({ visible, title, actions, onClose }: { visible: boolean; title?: string; actions: SheetAction[]; onClose: () => void }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={{ flex: 1, backgroundColor: '#000A', justifyContent: 'flex-end' }} onPress={onClose} accessibilityLabel="Close menu">
        <View style={{ backgroundColor: C.card, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 12, paddingBottom: 28, gap: 4, borderWidth: 1, borderColor: C.line }}>
          {title ? <Text style={[s.caption, { padding: 8 }]}>{title}</Text> : null}
          {actions.map(action => (
            <Pressable key={action.label} style={{ paddingVertical: 14, paddingHorizontal: 12, borderRadius: 10 }} onPress={() => { onClose(); action.onPress(); }} accessibilityRole="button">
              <Text style={{ color: action.danger ? C.danger : C.text, fontSize: 16, fontWeight: '600' }}>{action.label}</Text>
            </Pressable>
          ))}
          <Pressable style={{ paddingVertical: 14, paddingHorizontal: 12 }} onPress={onClose} accessibilityRole="button"><Text style={{ color: C.muted, fontSize: 16 }}>Cancel</Text></Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}
