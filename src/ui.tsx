import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export const colors = { background: '#F6F5EF', ink: '#243E35', muted: '#6E786E', line: '#DCE0D4', accent: '#DBF08A', white: '#FFFFFF' };
export function Button({ label, onPress, secondary = false, disabled = false }: { label: string; onPress: () => void; secondary?: boolean; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.button, secondary && styles.secondary, (disabled || pressed) && { opacity: disabled ? 0.4 : 0.7 }]}>
    <Text style={[styles.buttonText, secondary && { color: colors.ink }]}>{label}</Text>
  </Pressable>;
}
export function Message({ children }: { children: React.ReactNode }) {
  return <View accessibilityRole="alert" style={styles.message}><Text style={{ color: colors.ink, lineHeight: 21 }}>{children}</Text></View>;
}
const styles = StyleSheet.create({
  button: { minHeight: 42, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 11, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.ink },
  secondary: { backgroundColor: 'transparent', borderColor: colors.line }, buttonText: { color: colors.white, fontSize: 14, fontWeight: '600' },
  message: { padding: 16, backgroundColor: '#F4E8CC', borderRadius: 12, marginVertical: 8 },
});
