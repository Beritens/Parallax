import React, { useEffect, useRef, useState } from 'react';
import { Image, Text, TextInput, View } from 'react-native';
import { Button, colors } from './ui';
import type { PosePanelProps } from './PosePanel';
import { estimatePoses } from './pose/client.web';
import { CameraPositionViewer } from './pose/CameraPositionViewer.web';

export function PosePanel({ subject, entries, disabled, autoRunId, onBusy, onSave }: PosePanelProps) {
  const [fov, setFov] = useState(String(subject.reconstruction?.horizontalFov ?? 60));
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [details, setDetails] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const autoStarted = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  async function run() {
    if (controller.current) return;
    const horizontalFov = Number(fov);
    if (!Number.isFinite(horizontalFov) || horizontalFov < 20 || horizontalFov > 120) { setError('Enter a horizontal field of view between 20° and 120°.'); return; }
    const abort = new AbortController(); controller.current = abort;
    onBusy(true); setError(''); setProgress('Preparing reference photos…');
    try {
      const result = await estimatePoses({ images: entries.map(e => ({ id: e.id, ...e.reference })), horizontalFov }, setProgress, abort.signal);
      if (abort.signal.aborted || !mounted.current) return;
      setProgress('Saving camera poses…'); await onSave(result); setDetails(true);
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : 'Camera estimation failed.'); }
    finally { controller.current = null; if (mounted.current) { setProgress(''); onBusy(false); } }
  }
  useEffect(() => {
    if (autoRunId && autoStarted.current !== autoRunId && entries.some(e => e.id === autoRunId) && entries.length >= 2 && !disabled) {
      autoStarted.current = autoRunId; void run();
    }
  }, [autoRunId, disabled]);
  const reconstruction = subject.reconstruction;
  const count = reconstruction ? Object.keys(reconstruction.cameras).length : 0;
  const tentativeCount = reconstruction ? Object.values(reconstruction.cameras).filter(pose => pose.status === 'tentative').length : 0;
  const stale = reconstruction && (entries.length !== reconstruction.entryIds.length || entries.some(e => !reconstruction.entryIds.includes(e.id)));
  return <View style={{ gap: 9, paddingTop: 10, borderTopWidth: 1, borderColor: colors.line }}>
    <Text style={{ color: colors.ink, fontWeight: '600' }}>Reference camera poses</Text>
    <Text style={{ color: colors.muted, fontSize: 12 }}>{entries.length < 2 ? 'Add another overlapping reference to estimate camera poses.' : reconstruction ? `${count} of ${entries.length} camera estimates shown${tentativeCount ? ` · ${tentativeCount} tentative` : ''}${stale ? ' · update needed' : ''}. ${reconstruction.pointCount} scene points.` : 'Estimate cameras from overlapping reference photos.'}</Text>
    {reconstruction && <CameraPositionViewer entries={entries} reconstruction={reconstruction} />}
    {entries.length >= 2 && <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ color: colors.muted, fontSize: 12 }}>Assumed horizontal FOV (°)</Text>
        <TextInput accessibilityLabel={`Horizontal field of view for ${subject.name}`} value={fov} onChangeText={setFov} editable={!disabled} keyboardType="numeric" style={{ width: 60, borderWidth: 1, borderColor: colors.line, padding: 8, borderRadius: 6 }} />
      </View>
      <Text style={{ color: colors.muted, fontSize: 11 }}>Approximate intrinsics, arbitrary scale. Use photos from different positions with scene depth. Photos stay on this device.</Text>
      {progress ? <><Text accessibilityLiveRegion="polite" style={{ color: colors.ink, fontSize: 12 }}>{progress}</Text><Button secondary label="Cancel estimation" onPress={() => controller.current?.abort()} /></> :
        <Button secondary label={reconstruction ? 'Re-estimate cameras' : 'Estimate cameras'} disabled={disabled} onPress={() => void run()} />}
    </>}
    {!!error && <Text accessibilityRole="alert" style={{ color: '#A12B25', fontSize: 12 }}>{error}</Text>}
    {reconstruction && <Button secondary label={details ? 'Hide camera details' : 'Show camera details'} onPress={() => setDetails(!details)} />}
    {details && reconstruction && entries.map((entry, index) => {
      const pose = reconstruction.cameras[entry.id];
      return <View key={entry.id} style={{ flexDirection: 'row', gap: 10, paddingVertical: 6 }}>
        <Image source={{ uri: entry.reference.uri }} style={{ width: 52, height: 52, borderRadius: 6 }} />
        <View style={{ flex: 1, gap: 3 }}><Text style={{ color: pose?.status === 'tentative' ? '#946019' : colors.ink, fontSize: 12 }}>Reference {index+1}{entry.id === reconstruction.originEntryId ? ' · origin' : ''}{pose?.status === 'tentative' ? ' · tentative' : ''}</Text>
          <Text style={{ color: colors.muted, fontSize: 11 }}>{pose ? `Position: ${pose.center.map(x => x.toFixed(2)).join(', ')}\n${pose.status === 'tentative' ? `${pose.inliers} of ${pose.correspondences} 3D matches agreed` : `${pose.inliers} inliers`} · ${pose.reprojectionError.toFixed(2)} px median error${pose.warning ? `\n${pose.warning}` : ''}` : reconstruction.unresolved[entry.id] ?? 'Not estimated yet.'}</Text>
        </View>
      </View>;
    })}
  </View>;
}
