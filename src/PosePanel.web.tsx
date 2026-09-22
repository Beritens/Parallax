import React, { useEffect, useRef, useState } from 'react';
import { Image, Pressable, Text, TextInput, View } from 'react-native';
import { Button, colors } from './ui';
import type { PosePanelProps } from './PosePanel';
import { estimatePoses } from './pose/client.web';
import { exportColmap } from './pose/colmapExport.web';
import { readLocalPoseResult } from './pose/colmap';
import { CameraPositionViewer } from './pose/CameraPositionViewer.web';

export function PosePanel({ subject, entries, disabled, autoRunId, onBusy, onSave }: PosePanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [method, setMethod] = useState<'browser' | 'colmap' | 'vggt'>(subject.reconstruction?.method === 'vggt' ? 'vggt' : subject.reconstruction?.method === 'colmap' ? 'colmap' : 'browser');
  const [localBusy, setLocalBusy] = useState(false);
  const [fov, setFov] = useState(String(subject.reconstruction?.horizontalFov ?? 60));
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [details, setDetails] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const autoStarted = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  async function localAction(action: () => Promise<void>) {
    setLocalBusy(true); onBusy(true); setError('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Local pose operation failed.'); }
    finally { setLocalBusy(false); onBusy(false); }
  }
  async function run() {
    if (controller.current) return;
    const horizontalFov = Number(fov);
    if (!Number.isFinite(horizontalFov) || horizontalFov < 20 || horizontalFov > 120) { setError('Enter a horizontal field of view between 20° and 120°.'); return; }
    const abort = new AbortController(); controller.current = abort;
    onBusy(true); setError(''); setProgress('Preparing reference photos…');
    try {
      const result = await estimatePoses({ images: entries.map(e => ({ id: e.id, ...e.reference })), horizontalFov }, setProgress, abort.signal);
      if (abort.signal.aborted || !mounted.current) return;
      setProgress('Saving camera poses…'); await onSave(result);
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : 'Camera estimation failed.'); }
    finally { controller.current = null; if (mounted.current) { setProgress(''); onBusy(false); } }
  }
  useEffect(() => {
    if (autoRunId && autoStarted.current !== autoRunId && entries.some(e => e.id === autoRunId) && entries.length >= 2 && !disabled) {
      autoStarted.current = autoRunId; if (method === 'browser') void run();
    }
  }, [autoRunId, disabled]);
  const reconstruction = subject.reconstruction;
  const localLabel = method === 'vggt' ? 'VGGT' : 'COLMAP';
  const count = reconstruction ? Object.keys(reconstruction.cameras).length : 0;
  const tentativeCount = reconstruction ? Object.values(reconstruction.cameras).filter(pose => pose.status === 'tentative').length : 0;
  const stale = reconstruction && (entries.length !== reconstruction.entryIds.length || entries.some(e => !reconstruction.entryIds.includes(e.id)));
  return <View style={{ gap: 10, paddingTop: 4 }}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} disabled={disabled && !expanded}
      onPress={() => setExpanded(!expanded)} style={({ pressed }) => ({ alignSelf: 'flex-start', paddingVertical: 5, opacity: pressed ? 0.55 : 1 })}>
      <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '600' }}>{expanded ? 'Hide debug' : progress ? 'Debug · working…' : 'Debug'}</Text>
    </Pressable>
    {expanded && <View style={{ gap: 9, padding: 12, borderWidth: 1, borderColor: colors.line, borderRadius: 12 }}>
      <Text style={{ color: colors.ink, fontWeight: '600' }}>Camera reconstruction</Text>
      <Text style={{ color: colors.muted, fontSize: 12 }}>{entries.length < 2 ? 'Add another overlapping reference.' : reconstruction ? `${count}/${entries.length} cameras${tentativeCount ? ` · ${tentativeCount} tentative` : ''}${stale ? ' · update needed' : ''}${reconstruction.method === 'vggt' ? ' · unverified' : ` · ${reconstruction.pointCount} points`}` : 'No camera estimate.'}</Text>
      {reconstruction && <Text style={{ color: colors.muted, fontSize: 12 }}>{reconstruction.method === 'vggt' ? 'VGGT' : reconstruction.method === 'colmap' ? 'COLMAP' : 'Browser · SuperPoint / LightGlue'}</Text>}
      {reconstruction && <CameraPositionViewer entries={entries} reconstruction={reconstruction} />}
      {entries.length >= 2 && <>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Button secondary={method !== 'browser'} label="Browser estimation" disabled={disabled || localBusy} onPress={() => setMethod('browser')} />
        <Button secondary={method !== 'colmap'} label="COLMAP (local)" disabled={disabled || localBusy} onPress={() => setMethod('colmap')} />
        <Button secondary={method !== 'vggt'} label="VGGT (local)" disabled={disabled || localBusy} onPress={() => setMethod('vggt')} />
      </View>
      {method !== 'vggt' && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ color: colors.muted, fontSize: 12 }}>Assumed horizontal FOV (°)</Text>
        <TextInput accessibilityLabel={`Horizontal field of view for ${subject.name}`} value={fov} onChangeText={setFov} editable={!disabled} keyboardType="numeric" style={{ width: 60, borderWidth: 1, borderColor: colors.line, padding: 8, borderRadius: 6 }} />
      </View>}
      <Text style={{ color: colors.muted, fontSize: 11 }}>Approximate intrinsics, arbitrary scale. Use photos from different positions with scene depth. Photos stay on this device.</Text>
      {method !== 'browser' ? <>
        <Text style={{ color: colors.muted, fontSize: 12 }}>{method === 'vggt' ? 'VGGT runs locally in Python/PyTorch. Export photos, follow the README setup, run the command, then import its predictions. It predicts focal lengths and poses; it does not verify them with feature matches.' : 'COLMAP runs on your computer, outside the browser. Export the photos, run the command below from the local Parallax project with COLMAP installed, then import the result. FOV initializes focal length; COLMAP refines it.'}</Text>
        <Text selectable style={{ color: colors.ink, fontSize: 12 }}>pnpm {method} parallax-{method}.zip {method}-result.json</Text>
        <Button secondary label={localBusy ? 'Processing…' : `Export ${localLabel} photos`} disabled={disabled || localBusy} onPress={() => void localAction(async () => {
          const value = method === 'vggt' ? 60 : Number(fov);
          if (!Number.isFinite(value) || value < 20 || value > 120) throw new Error('Enter a horizontal field of view between 20° and 120°.');
          await exportColmap(subject.id, entries, value, method);
        })} />
        <Button secondary label={`Import ${localLabel} result`} disabled={disabled || localBusy} onPress={() => {
          const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json';
          input.onchange = () => { const file = input.files?.[0]; if (file) void localAction(async () => {
            const result = readLocalPoseResult(JSON.parse(await file.text()), subject.id, entries.map(e => e.id), method);
            await onSave(result);
          }); }; input.click();
        }} />
      </> : progress ? <><Text accessibilityLiveRegion="polite" style={{ color: colors.ink, fontSize: 12 }}>{progress}</Text><Button secondary label="Cancel estimation" onPress={() => controller.current?.abort()} /></> :
        <Button secondary label={reconstruction ? 'Re-estimate cameras' : 'Estimate cameras'} disabled={disabled} onPress={() => void run()} />}
    </>}
      {!!error && <Text accessibilityRole="alert" style={{ color: '#A12B25', fontSize: 12 }}>{error}</Text>}
      {reconstruction && <Button secondary label={details ? 'Hide camera details' : 'Show camera details'} onPress={() => setDetails(!details)} />}
      {details && reconstruction && entries.map((entry, index) => {
        const pose = reconstruction.cameras[entry.id];
        return <View key={entry.id} style={{ flexDirection: 'row', gap: 10, paddingVertical: 6 }}>
          <Image source={{ uri: entry.reference.uri }} style={{ width: 52, height: 52, borderRadius: 6 }} />
          <View style={{ flex: 1, gap: 3 }}><Text style={{ color: pose?.status === 'tentative' ? '#946019' : colors.ink, fontSize: 12 }}>Reference {index+1}{entry.id === reconstruction.originEntryId ? ' · origin' : ''}{pose?.status === 'tentative' ? ' · tentative' : ''}</Text>
            <Text style={{ color: colors.muted, fontSize: 11 }}>{pose ? `Position: ${pose.center.map(x => x.toFixed(2)).join(', ')}\n${reconstruction.method === 'vggt' ? 'VGGT prediction · no measured inliers or reprojection error' : `${pose.status === 'tentative' ? `${pose.inliers} of ${pose.correspondences} 3D matches agreed` : `${pose.inliers} inliers`} · ${pose.reprojectionError?.toFixed(2)} px median error`}${pose.warning ? `\n${pose.warning}` : ''}` : reconstruction.unresolved[entry.id] ?? 'Not estimated yet.'}</Text>
          </View>
        </View>;
      })}
    </View>}
  </View>;
}
