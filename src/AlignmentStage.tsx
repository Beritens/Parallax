import React, { useRef, useState } from 'react';
import { GestureResponderEvent, Image, PanResponder, Platform, StyleSheet, Text, View, ViewStyle } from 'react-native';
import Range from './Range';
import { Alignment, fitInside, initialAlignment, Photo } from './model';
import { Button, colors } from './ui';
import { moveArtwork, referenceFrame, TouchPoint } from './gestures';
const touchStyle: ViewStyle & { touchAction?: string } = Platform.OS === 'web' ? { touchAction: 'none' } : {};

export function AlignmentStage({ artwork, reference, alignment, onChange, children, interactive = true, fullscreen = false, captureFrame = false, sourceAspect = 3 / 4 }: {
  artwork?: Photo; reference?: Photo; alignment: Alignment; onChange: (alignment: Alignment) => void;
  children?: React.ReactNode; interactive?: boolean; fullscreen?: boolean; captureFrame?: boolean; sourceAspect?: number;
}) {
  const [size, setSize] = useState({ width: 1, height: 1 });
  const frame = referenceFrame(size.width, size.height, reference ? reference.width / reference.height : sourceAspect, fullscreen || captureFrame);
  const latest = useRef({ alignment, onChange, size, frame });
  latest.current = { alignment, onChange, size, frame };
  const previous = useRef<TouchPoint[]>([]);
  const origin = useRef({ x: 0, y: 0 });
  const touches = (event: GestureResponderEvent): TouchPoint[] => event.nativeEvent.touches
    .map(t => ({ id: String(t.identifier), x: t.pageX, y: t.pageY })).sort((a, b) => a.id.localeCompare(b.id)).slice(0, 2);
  const rebase = (event: GestureResponderEvent) => { previous.current = touches(event); };
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: event => {
      origin.current = { x: event.nativeEvent.pageX - event.nativeEvent.locationX, y: event.nativeEvent.pageY - event.nativeEvent.locationY };
      rebase(event);
    },
    onPanResponderStart: rebase,
    onPanResponderEnd: rebase,
    onPanResponderRelease: () => { previous.current = []; },
    onPanResponderTerminate: () => { previous.current = []; },
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: event => {
      const current = latest.current;
      const next = touches(event);
      const updated = moveArtwork(current.alignment, previous.current, next, { ...current.frame,
        centerX: origin.current.x + current.size.width / 2, centerY: origin.current.y + current.size.height / 2 });
      previous.current = next;
      latest.current.alignment = updated;
      current.onChange(updated);
    },
  })).current;
  const fitted = artwork ? fitInside(artwork.width, artwork.height, frame.width, frame.height) : size;
  return <View style={[styles.stage, (fullscreen || captureFrame) ? styles.fullscreen : { aspectRatio: reference ? reference.width / reference.height : 3 / 4 }]}
    onLayout={event => setSize(event.nativeEvent.layout)}>
    {reference && <Image source={{ uri: reference.uri }} style={StyleSheet.absoluteFill} resizeMode={fullscreen || captureFrame ? 'cover' : 'contain'} />}
    {children}
    {artwork && <View {...(interactive ? pan.panHandlers : {})} style={[StyleSheet.absoluteFill, touchStyle]}
      accessibilityLabel={interactive ? 'Artwork: drag to move, use two fingers to rotate and pinch to resize' : 'Aligned artwork preview'}>
      <View pointerEvents="none" style={{ position: 'absolute', left: (size.width - fitted.width) / 2 + alignment.x * frame.width,
        top: (size.height - fitted.height) / 2 + alignment.y * frame.height, width: fitted.width, height: fitted.height,
        opacity: alignment.opacity, transform: [{ rotate: `${alignment.rotation}deg` }, { scale: alignment.scale }] }}>
        <Image source={{ uri: artwork.uri }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
      </View>
    </View>}
  </View>;
}

export function AlignmentControls({ alignment, onChange }: { alignment: Alignment; onChange: (alignment: Alignment) => void }) {
  const control = (label: string, key: 'rotation' | 'scale' | 'opacity', min: number, max: number, value: string) =>
    <View style={styles.control} key={key}>
      <View style={styles.row}><Text style={styles.label}>{label}</Text><Text style={styles.value}>{value}</Text></View>
      <Range label={label} min={min} max={max} value={alignment[key]} onChange={v => onChange({ ...alignment, [key]: v })} />
    </View>;
  return <View style={styles.controls}>
    <Text style={styles.hint}>Drag the artwork to move it. Use the controls to fine-tune.</Text>
    {control('Rotation', 'rotation', -180, 180, `${Math.round(alignment.rotation)}°`)}
    {control('Size', 'scale', 0.2, 3, `${Math.round(alignment.scale * 100)}%`)}
    {control('Artwork opacity', 'opacity', 0, 1, `${Math.round(alignment.opacity * 100)}%`)}
    <Button label="Reset alignment" secondary onPress={() => onChange({ ...initialAlignment })} />
  </View>;
}

const styles = StyleSheet.create({
  stage: { width: '100%', backgroundColor: '#1B2822', overflow: 'hidden', borderRadius: 20 },
  fullscreen: { flex: 1, borderRadius: 0 },
  controls: { gap: 8, paddingTop: 12 }, control: { gap: 5 }, row: { flexDirection: 'row', justifyContent: 'space-between' },
  label: { color: colors.ink, fontSize: 14, fontWeight: '500' }, value: { color: colors.muted, fontSize: 14 },
  hint: { color: colors.muted, fontSize: 13, lineHeight: 19, marginBottom: 8 },
});
