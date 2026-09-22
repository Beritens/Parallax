import React, { useRef, useState } from 'react';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { ActivityIndicator, Image, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Alignment, initialAlignment, Photo } from './model';
import { AlignmentControls, AlignmentStage } from './AlignmentStage';
import { Button, colors, Message } from './ui';
import CameraPreview from './CameraPreview';
import { coverAlignment, reframeAlignment } from './cameraGeometry';

type Props = {
  photo?: Photo; artwork?: Photo; alignment: Alignment; onAlignment: (value: Alignment) => void;
  onPhoto: (value: Photo) => void; onBusy: (value: boolean) => void; fullscreen?: boolean;
  onBack: () => void; onClose: () => void; onContinue: () => void;
};

function EdgeButton({ label, symbol, onPress, disabled = false }: { label: string; symbol: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.edgeButton, (pressed || disabled) && { opacity: 0.4 }]}>
    <Text style={styles.edgeSymbol}>{symbol}</Text>
  </Pressable>;
}

export function Capture({ photo, artwork, alignment, onAlignment, onPhoto, onBusy, fullscreen = false, onBack, onClose, onContinue }: Props) {
  const camera = useRef<CameraView>(null);
  const lock = useRef(false);
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [ready, setReady] = useState(false);
  const [retaking, setRetaking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [peek, setPeek] = useState(false);
  const [previewAspect, setPreviewAspect] = useState(3 / 4);
  const viewport = useRef({ width: 1, height: 1 });
  const live = !photo || retaking;
  const displayedAspect = live ? previewAspect : photo.width / photo.height;
  const resetAlignment = artwork ? coverAlignment(artwork, displayedAspect) : initialAlignment;
  function changeFrame(from: number, to: number) {
    if (artwork && from !== to) onAlignment(reframeAlignment(alignment, artwork, viewport.current, from, to));
  }
  function acceptPhoto(next: Photo) {
    changeFrame(displayedAspect, next.width / next.height);
    onPhoto(next);
  }
  const overlayVisible = !!artwork && (!!permission?.granted || !live);
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); onBusy(true); setError('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not open the camera or image. Try again.'); }
    finally { lock.current = false; setBusy(false); onBusy(false); }
  }
  function upload() {
    void run(async () => {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, allowsEditing: false });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset.width || !asset.height) throw new Error('This image could not be read. Please choose another.');
      acceptPhoto({ uri: asset.uri, width: asset.width, height: asset.height, mimeType: asset.mimeType ?? 'image/jpeg', source: 'library', selectedAt: new Date().toISOString() });
      setRetaking(false); setPeek(false);
    });
  }
  function capture() {
    void run(async () => {
      if (!camera.current || !ready) throw new Error('The camera is still starting. Please try again.');
      const result = await camera.current.takePictureAsync({ quality: 1, imageType: 'jpg', isImageMirror: false });
      if (!result) throw new Error('The camera did not return a photo. Please try again.');
      acceptPhoto({ uri: result.uri, width: result.width, height: result.height, mimeType: 'image/jpeg', source: 'camera', selectedAt: new Date().toISOString() });
      setRetaking(false); setPeek(false);
    });
  }
  const retake = () => {
    changeFrame(displayedAspect, retaking && photo ? photo.width / photo.height : previewAspect);
    setReady(false); setRetaking(!retaking); setPeek(false); setError('');
  };
  const cameraContent = live ? permission?.granted ? <CameraPreview ref={camera}
    onAspect={aspect => {
      // A new camera's initial dimensions define its starting fit. Only rebase
      // an existing alignment (retake or an already-running stream resize).
      changeFrame(previewAspect, aspect);
      setPreviewAspect(aspect);
    }}
    onReady={() => setReady(true)} onError={message => { setReady(false); setError(message); }} />
    : <View style={styles.permission}>
      <Text style={styles.cameraTitle}>Camera access</Text>
      <Text style={styles.cameraText}>Or choose a photo from your library.</Text>
      <Pressable accessibilityRole="button" disabled={busy} style={styles.permissionButton}
        accessibilityLabel={permission?.canAskAgain === false ? 'Open camera settings' : 'Enable camera'}
        onPress={() => void run(async () => {
          if (permission?.canAskAgain === false) {
            if (Platform.OS === 'web') throw new Error('Allow camera access in your browser’s site settings, then reload. You can also upload a photo.');
            await Linking.openSettings();
          } else await requestPermission();
        })}><Text style={styles.permissionText}>{permission?.canAskAgain === false ? 'Open camera settings' : 'Enable camera'}</Text></Pressable>
    </View> : null;
  const image = artwork ? <AlignmentStage artwork={overlayVisible ? artwork : undefined} reference={live ? undefined : photo}
    alignment={peek ? { ...alignment, opacity: 0 } : alignment} onChange={next => onAlignment({ ...next, opacity: alignment.opacity })}
    interactive={!busy && !peek} captureFrame sourceAspect={previewAspect}>{cameraContent}</AlignmentStage>
    : live ? <View style={styles.fill}>{cameraContent}</View>
      : <Image source={{ uri: photo!.uri }} style={styles.fill} resizeMode="cover" />;
  const framedImage = <View style={fullscreen ? styles.viewport : styles.frame} onLayout={event => { viewport.current = event.nativeEvent.layout; }}>{image}</View>;

  if (fullscreen) return <View style={styles.immersive}>
    {framedImage}
    <View pointerEvents="box-none" style={[styles.top, { paddingTop: insets.top + 14 }]}>
      {artwork ? <EdgeButton label="Back" symbol="‹" onPress={onBack} disabled={busy} /> : <View style={{ width: 46 }} />}
      <View pointerEvents="none" style={styles.stepPill}><Text style={styles.stepText}>{artwork ? '2 / 3' : '1 / 3'}</Text></View>
      <EdgeButton label="Close" symbol="×" onPress={onClose} disabled={busy} />
    </View>
    {overlayVisible && <View style={[styles.side, { top: insets.top + 84 }]}>
      <EdgeButton label="Reset alignment" symbol="↺" disabled={busy} onPress={() => { onAlignment(resetAlignment); setPeek(false); }} />
      <EdgeButton label={peek ? 'Show artwork' : 'Hide artwork to compare'} symbol={peek ? '◉' : '◐'} disabled={busy} onPress={() => setPeek(!peek)} />
    </View>}
    <View pointerEvents="box-none" style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, 20) }]}>
      {!!error && <View accessibilityRole="alert" style={styles.error}><Text style={styles.errorText}>{error}</Text></View>}
      {overlayVisible && <Text pointerEvents="none" style={styles.hint}>Drag · pinch · twist</Text>}
      <View style={styles.captureRow}>
        <View style={styles.wing}><EdgeButton label="Upload photo" symbol="▧" onPress={upload} disabled={busy} /><Text style={styles.edgeCaption}>Library</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel={live ? 'Take photo' : artwork ? 'Confirm reference' : 'Use artwork'}
          disabled={busy || (live && (!permission?.granted || !ready))} onPress={live ? capture : onContinue}
          style={({ pressed }) => [styles.shutter, !live && styles.confirm, (busy || (live && (!permission?.granted || !ready)) || pressed) && { opacity: 0.35 }]}>
          {busy ? <ActivityIndicator color={live ? 'white' : '#151A16'} /> : live ? <View style={styles.shutterInner} /> : <Text style={styles.check}>✓</Text>}
        </Pressable>
        <View style={styles.wing}>{photo ? <><EdgeButton label={retaking ? 'Keep previous' : 'Retake photo'} symbol={retaking ? '↶' : '↻'} onPress={retake} disabled={busy} /><Text style={styles.edgeCaption}>{retaking ? 'Keep' : 'Retake'}</Text></> : <View style={{ width: 48 }} />}</View>
      </View>
    </View>
  </View>;

  return <View style={{ gap: 12 }}>
    {framedImage}
    {!!error && <Message>{error}</Message>}
    {live && permission?.granted && <Button label={busy ? 'Capturing…' : 'Take photo'} onPress={capture} disabled={busy || !ready} />}
    <View style={styles.actions}>
      <View style={{ flex: 1 }}><Button label="Upload photo" secondary onPress={upload} disabled={busy} /></View>
      {photo && <View style={{ flex: 1 }}><Button label={retaking ? 'Keep previous' : 'Retake photo'} secondary disabled={busy} onPress={retake} /></View>}
    </View>
    {artwork && <AlignmentControls alignment={alignment} onChange={onAlignment} resetTo={resetAlignment} />}
    <Button label={artwork ? 'Confirm reference →' : 'Use artwork →'} disabled={busy || live} onPress={onContinue} />
  </View>;
}

const styles = StyleSheet.create({
  viewport: { flex: 1, overflow: 'hidden' },
  immersive: { flex: 1, backgroundColor: '#101412' }, fill: { width: '100%', height: '100%' },
  frame: { width: '100%', aspectRatio: 3 / 4, borderRadius: 20, overflow: 'hidden', backgroundColor: '#101412' },
  permission: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 26, gap: 14, paddingBottom: 110 },
  cameraTitle: { color: 'white', fontSize: 25, fontWeight: '400', letterSpacing: -0.8 }, cameraText: { color: '#99A69B', textAlign: 'center', fontSize: 13, lineHeight: 20 },
  permissionButton: { borderWidth: 1, borderColor: '#566157', paddingHorizontal: 22, paddingVertical: 14, borderRadius: 28, marginTop: 8 }, permissionText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 10 },
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  edgeButton: { width: 46, height: 46, backgroundColor: '#10141299', borderRadius: 23, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#FFFFFF24' },
  edgeSymbol: { fontSize: 27, color: '#FFF', lineHeight: 32, fontWeight: '300' }, stepPill: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, backgroundColor: '#10141299' },
  stepText: { color: '#FFF', fontSize: 10, letterSpacing: 1.6, fontWeight: '600' },
  side: { position: 'absolute', right: 18, gap: 12 },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 24, paddingTop: 14, gap: 12, backgroundColor: '#10141255' },
  hint: { textAlign: 'center', color: '#FFF', fontSize: 12, textShadowColor: '#000', textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } },
  captureRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, wing: { width: 70, alignItems: 'center', gap: 6 }, edgeCaption: { color: '#FFF', fontSize: 11 },
  shutter: { width: 78, height: 78, borderRadius: 39, borderWidth: 2, borderColor: '#FFF', padding: 5, alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: '100%', height: '100%', borderRadius: 34, backgroundColor: '#FFF' }, confirm: { backgroundColor: colors.accent, borderColor: colors.accent }, check: { fontSize: 34, color: '#19241C' },
  error: { backgroundColor: '#45281FEB', borderRadius: 12, padding: 12 }, errorText: { color: '#FFF', fontSize: 12, lineHeight: 18 },
});
