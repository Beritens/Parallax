import React, { useMemo, useRef, useState } from 'react';
import { Image, Modal, PanResponder, Platform, Text, View, ViewStyle } from 'react-native';
import { Entry, Subject } from './model';
import { artworkViewerLayout, estimateSubject, nearestArtwork, Orbit, orbitFromCamera, orbitPosition, snapArtworkOrbit } from './artworkGeometry';
import { Button, colors } from './ui';
import Range from './Range';

export function ArtworkViewer({ subject, entries }: { subject: Subject; entries: Entry[] }) {
  const [open, setOpen] = useState(false);
  const reconstruction = subject.reconstruction;
  const estimate = useMemo(() => reconstruction ? estimateSubject(entries, reconstruction) : null, [entries, reconstruction]);
  if (!reconstruction) return null;
  return <View style={{ gap: 6 }}>
    <Button label="View artworks" secondary disabled={!estimate} onPress={() => setOpen(true)} />
    {!estimate && <Text style={{ color: colors.muted, fontSize: 12 }}>Subject position needs at least two reliable, converging viewpoints. Add another perspective or update the camera estimates.</Text>}
    <Modal visible={open && !!estimate} animationType="fade" onRequestClose={() => setOpen(false)}>
      {open && estimate && <OrbitViewer subject={subject} entries={entries} estimate={estimate} onClose={() => setOpen(false)} />}
    </Modal>
  </View>;
}

function OrbitViewer({ subject, entries, estimate, onClose }: {
  subject: Subject; entries: Entry[]; estimate: NonNullable<ReturnType<typeof estimateSubject>>; onClose: () => void;
}) {
  const reconstruction = subject.reconstruction!;
  const initial = orbitFromCamera(reconstruction.cameras[estimate.rays[0].id].center, estimate.point);
  const [orbit, setOrbit] = useState<Orbit>(initial);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const latest = useRef(orbit); latest.current = orbit;
  const start = useRef(orbit);
  const snap = useRef(() => {});
  snap.current = () => {
    const next = snapArtworkOrbit(entries, reconstruction, estimate.point, latest.current);
    latest.current = next;
    setOrbit(next);
  };
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { start.current = latest.current; },
    onPanResponderMove: (_, gesture) => {
      const next = { ...start.current, yaw: start.current.yaw - gesture.dx * 0.008,
        pitch: Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, start.current.pitch + gesture.dy * 0.008)) };
      latest.current = next;
      setOrbit(next);
    },
    onPanResponderRelease: () => snap.current(),
    onPanResponderTerminate: () => snap.current(),
  })).current;
  const selected = nearestArtwork(entries, reconstruction, orbitPosition(estimate.point, orbit), estimate.point);
  const layout = selected && artworkViewerLayout(selected, reconstruction.cameras[selected.id], estimate.point, size, orbit.radius);
  const anchor = layout?.anchor;
  let artworkStyle: ViewStyle = {};
  if (selected && layout) {
    artworkStyle = { position: 'absolute', width: layout.width, height: layout.height,
      left: layout.left, top: layout.top,
      transform: [{ rotate: `${selected.alignment.rotation}deg` }] };
  }
  const outside = selected && anchor && (anchor.x < 0 || anchor.y < 0 || anchor.x > selected.artwork.width || anchor.y > selected.artwork.height);
  return <View style={{ flex: 1, backgroundColor: colors.background, padding: 20, paddingTop: 48, gap: 12 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <Text style={{ flex: 1, color: colors.ink, fontSize: 22 }}>{subject.name}</Text><Button secondary label="Close viewer" onPress={onClose} />
    </View>
    <View {...pan.panHandlers} accessibilityLabel="Artwork orbit viewer" onLayout={event => setSize(event.nativeEvent.layout)}
      style={[{ flex: 1, minHeight: 160, overflow: 'hidden', backgroundColor: '#1B2822', borderRadius: 16 },
        Platform.OS === 'web' ? { touchAction: 'none' } as ViewStyle : {}]}>
      {selected && <View pointerEvents="none" style={artworkStyle}><Image source={{ uri: selected.artwork.uri }} accessibilityLabel={`Artwork ${entries.indexOf(selected) + 1} centered on estimated subject`} resizeMode="contain" style={{ width: '100%', height: '100%' }} /></View>}
      <View pointerEvents="none" style={{ position: 'absolute', left: '50%', top: '50%', marginLeft: -5, marginTop: -5,
        width: 10, height: 10, borderRadius: 5, borderWidth: 1, borderColor: '#FFFFFFAA', backgroundColor: '#00000033' }} />
    </View>
    <Text accessibilityLiveRegion="polite" style={{ color: colors.ink }}>Artwork {selected ? entries.indexOf(selected) + 1 : '—'} of {entries.length}{selected?.description ? ` · ${selected.description}` : ''}</Text>
    {!!outside && <Text style={{ color: colors.muted }}>The estimated subject falls outside this artwork’s edges.</Text>}
    <View style={{ width: '100%', maxWidth: 720, alignSelf: 'center', gap: 4 }}>
      <Range label="Orbit azimuth" min={-180} max={180} value={((orbit.yaw * 180 / Math.PI + 180) % 360 + 360) % 360 - 180} onChange={value => setOrbit({ ...orbit, yaw: value * Math.PI / 180 })} />
      <Range label="Orbit elevation" min={-89} max={89} value={orbit.pitch * 180 / Math.PI} onChange={value => setOrbit({ ...orbit, pitch: value * Math.PI / 180 })} />
      <Button secondary label="Reset viewpoint" onPress={() => setOrbit(initial)} />
    </View>
  </View>;
}
