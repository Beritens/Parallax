import { CameraView } from 'expo-camera';
import { Ref, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { referenceFrame } from './gestures';

export type CameraPreviewProps = {
  ref: Ref<CameraView>;
  onReady: () => void;
  onAspect: (aspect: number) => void;
  onError: (message: string) => void;
};

export default function CameraPreview({ ref, onReady, onError }: CameraPreviewProps) {
  const [size, setSize] = useState({ width: 1, height: 1 });
  // Give the native preview a 4:3 sensor frame, then apply the same centered
  // cover crop as Image. Android's ratio="4:3" otherwise letterboxes the view;
  // iOS also uses the preview's bounds when producing the still image.
  const frame = referenceFrame(size.width, size.height, 3 / 4, true);
  return <View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]} onLayout={event => setSize(event.nativeEvent.layout)}>
    <CameraView ref={ref} facing="back" mirror={false} ratio="4:3"
      style={{ position: 'absolute', width: frame.width, height: frame.height,
        left: (size.width - frame.width) / 2, top: (size.height - frame.height) / 2 }}
      onCameraReady={onReady} onMountError={event => onError(event.message)} />
  </View>;
}
