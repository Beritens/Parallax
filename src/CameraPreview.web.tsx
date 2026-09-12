import { CameraView } from 'expo-camera';
import { useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import type { CameraPreviewProps } from './CameraPreview';

export default function CameraPreview({ ref, onReady, onAspect, onError }: CameraPreviewProps) {
  const host = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onReady, onAspect });
  callbacks.current = { onReady, onAspect };
  useEffect(() => {
    const video = host.current?.querySelector('video');
    if (!video) return;
    const update = () => {
      if (!video.videoWidth || !video.videoHeight || video.readyState < 2) return;
      callbacks.current.onAspect(video.videoWidth / video.videoHeight);
      callbacks.current.onReady();
    };
    video.addEventListener('loadeddata', update);
    video.addEventListener('resize', update);
    update();
    return () => {
      video.removeEventListener('loadeddata', update);
      video.removeEventListener('resize', update);
    };
  }, []);
  return <div ref={host} className="parallax-camera-preview" style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
    {/* Expo 57 mirrors a detected front webcam even with mirror=false. Scope
        the override to the video only, so artwork and controls never flip. */}
    <style>{'.parallax-camera-preview video { transform: none !important; object-fit: cover; object-position: center; }'}</style>
    <CameraView ref={ref} facing="back" mirror={false} style={StyleSheet.absoluteFill} onMountError={event => onError(event.message)} />
  </div>;
}
