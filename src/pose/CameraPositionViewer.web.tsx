import React, { useEffect, useRef } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { PosePanelProps } from '../PosePanel';
import { colors } from '../ui';
import { cameraFrustum, cameraScene, cameraViewAfterDrag, cameraViewPoint, type Vector3 } from './cameraPlot';
import type { Reconstruction } from './types';

type ViewState = { yaw: number; pitch: number; zoom: number };
type ScreenPoint = { x: number; y: number; depth: number };
type Segment = { a: Vector3; b: Vector3; color: string; width: number; dash?: number[]; depth?: number };

const CAMERA_COLORS = ['#356F5B', '#547EAD', '#C26D4E', '#8465A4', '#B9862E', '#4F918F', '#B05D78'];
const INITIAL_VIEW: ViewState = { yaw: -0.72, pitch: 0.48, zoom: 1 };
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

export function CameraPositionViewer({ entries, reconstruction }: Pick<PosePanelProps, 'entries'> & { reconstruction: Reconstruction }) {
  const scene = cameraScene(entries, reconstruction);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawRef = useRef<() => void>(() => {});
  const view = useRef<ViewState>({ ...INITIAL_VIEW });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchDistance = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, rect.width), height = Math.max(1, rect.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const pixelWidth = Math.round(width*dpr), pixelHeight = Math.round(height*dpr);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = pixelWidth; canvas.height = pixelHeight; }
      const context = canvas.getContext('2d');
      if (!context) return;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      context.fillStyle = colors.white;
      context.fillRect(0, 0, width, height);

      const project = (point: Vector3): ScreenPoint => {
        const rotated = cameraViewPoint(point, scene.center, scene.radius, view.current);
        const perspective = 4.2-rotated[2];
        const focal = Math.min(width, height)*1.38*view.current.zoom;
        return { x: width/2+rotated[0]*focal/perspective, y: height/2-rotated[1]*focal/perspective, depth: rotated[2] };
      };

      const segments: Segment[] = [];
      const gridExtent = scene.radius*1.55;
      for (let i = -4; i <= 4; i++) {
        const offset = i*gridExtent/4;
        segments.push(
          { a: [scene.center[0]-gridExtent, 0, scene.center[2]+offset], b: [scene.center[0]+gridExtent, 0, scene.center[2]+offset], color: i === 0 ? '#CDD4C7' : '#E7E9E2', width: i === 0 ? 1.1 : 0.7 },
          { a: [scene.center[0]+offset, 0, scene.center[2]-gridExtent], b: [scene.center[0]+offset, 0, scene.center[2]+gridExtent], color: i === 0 ? '#CDD4C7' : '#E7E9E2', width: i === 0 ? 1.1 : 0.7 },
        );
      }

      const axisLength = scene.radius*0.62;
      const axes: { label: string; end: Vector3; color: string }[] = [
        { label: 'X', end: [axisLength,0,0], color: '#C65F55' },
        { label: 'Y', end: [0,axisLength,0], color: '#5B9760' },
        { label: 'Z', end: [0,0,axisLength], color: '#537BA9' },
      ];
      for (const axis of axes) segments.push({ a: [0,0,0], b: axis.end, color: axis.color, width: 2 });

      const cameraGeometry = scene.cameras.map((camera, index) => {
        const frustum = cameraFrustum(camera, scene.radius*0.34);
        const color = camera.tentative ? '#B7791F' : camera.origin ? '#69851A' : CAMERA_COLORS[index%CAMERA_COLORS.length];
        const dash = camera.tentative ? [5,4] : undefined;
        for (const corner of frustum.corners) segments.push({ a: frustum.apex, b: corner, color, width: 1.7, dash });
        for (let i = 0; i < 4; i++) segments.push({ a: frustum.corners[i], b: frustum.corners[(i+1)%4], color, width: i === 0 ? 3.2 : 1.7, dash });
        return { camera, color, screen: project(camera.center) };
      });

      const projectedSegments = segments.map(segment => {
        const a = project(segment.a), b = project(segment.b);
        return { ...segment, pa: a, pb: b, depth: (a.depth+b.depth)/2 };
      }).sort((a,b) => a.depth-b.depth);
      context.lineCap = 'round';
      context.lineJoin = 'round';
      for (const segment of projectedSegments) {
        context.setLineDash(segment.dash ?? []);
        context.beginPath(); context.moveTo(segment.pa.x, segment.pa.y); context.lineTo(segment.pb.x, segment.pb.y);
        context.strokeStyle = segment.color; context.lineWidth = segment.width; context.stroke();
      }
      context.setLineDash([]);

      context.font = '600 10px system-ui, sans-serif';
      context.textAlign = 'center'; context.textBaseline = 'middle';
      for (const item of cameraGeometry.sort((a,b) => a.screen.depth-b.screen.depth)) {
        const radius = item.camera.origin ? 11 : 10;
        context.beginPath(); context.arc(item.screen.x, item.screen.y, radius, 0, Math.PI*2);
        context.fillStyle = item.camera.tentative ? '#FFF7E6' : item.camera.origin ? colors.accent : item.color; context.fill();
        context.strokeStyle = item.camera.tentative ? item.color : colors.white; context.lineWidth = 2;
        context.setLineDash(item.camera.tentative ? [3,2] : []); context.stroke(); context.setLineDash([]);
        context.fillStyle = item.camera.tentative || item.camera.origin ? colors.ink : colors.white;
        context.fillText(String(item.camera.label), item.screen.x, item.screen.y+0.5);
      }
      context.font = '700 10px system-ui, sans-serif';
      for (const axis of axes) {
        const end = project(axis.end);
        context.fillStyle = axis.color;
        context.fillText(axis.label, end.x, end.y-8);
      }
    };
    drawRef.current = draw;
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      view.current.zoom = clamp(view.current.zoom*Math.exp(-event.deltaY*0.0012), 0.45, 3.5);
      draw();
    };
    canvas.addEventListener('wheel', wheel, { passive: false });
    draw();
    return () => { observer.disconnect(); canvas.removeEventListener('wheel', wheel); };
  }, [entries, reconstruction]);

  if (scene.cameras.length < 2) return null;
  const reset = () => { view.current = { ...INITIAL_VIEW }; drawRef.current(); };
  const pointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [a,b] = [...pointers.current.values()];
      pinchDistance.current = Math.hypot(a.x-b.x, a.y-b.y);
    }
  };
  const pointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 1) {
      const orbit = cameraViewAfterDrag(view.current, event.clientX-previous.x, event.clientY-previous.y);
      view.current.yaw = orbit.yaw; view.current.pitch = orbit.pitch;
    } else if (pointers.current.size === 2) {
      const [a,b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x-b.x, a.y-b.y);
      if (pinchDistance.current) view.current.zoom = clamp(view.current.zoom*distance/pinchDistance.current, 0.45, 3.5);
      pinchDistance.current = distance;
    }
    drawRef.current();
  };
  const pointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(event.pointerId); pinchDistance.current = null;
  };
  const keyDown = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    const handled = ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-','_','0','r','R'].includes(event.key);
    if (!handled) return;
    event.preventDefault();
    if (event.key === 'ArrowLeft') view.current.yaw += 0.12;
    if (event.key === 'ArrowRight') view.current.yaw -= 0.12;
    if (event.key === 'ArrowUp') view.current.pitch = clamp(view.current.pitch-0.12, -1.45, 1.45);
    if (event.key === 'ArrowDown') view.current.pitch = clamp(view.current.pitch+0.12, -1.45, 1.45);
    if (event.key === '+' || event.key === '=') view.current.zoom = clamp(view.current.zoom*1.15, 0.45, 3.5);
    if (event.key === '-' || event.key === '_') view.current.zoom = clamp(view.current.zoom/1.15, 0.45, 3.5);
    if (event.key === '0' || event.key.toLowerCase() === 'r') view.current = { ...INITIAL_VIEW };
    drawRef.current();
  };

  return <View style={{ gap: 6 }}>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.ink, fontSize: 12, fontWeight: '600' }}>Estimated camera positions</Text>
        <Text style={{ color: colors.muted, fontSize: 11 }}>Interactive 3D · arbitrary scale</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Reset 3D camera view" onPress={reset}
        style={({pressed}) => ({ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: '#E8EBE1', opacity: pressed ? 0.7 : 1 })}>
        <Text style={{ color: colors.ink, fontSize: 11, fontWeight: '600' }}>Reset view</Text>
      </Pressable>
    </View>
    <View style={{ height: 255, borderWidth: 1, borderColor: colors.line, borderRadius: 10, overflow: 'hidden', backgroundColor: colors.white }}>
      <canvas ref={canvasRef} tabIndex={0} aria-label={`Interactive 3D view of ${scene.cameras.length} estimated cameras. Drag to orbit, wheel or pinch to zoom, and use arrow keys to rotate.`}
        onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onKeyDown={keyDown}
        style={{ display: 'block', width: '100%', height: '100%', cursor: 'grab', touchAction: 'none', outlineColor: colors.ink }} />
    </View>
    <Text style={{ color: colors.muted, fontSize: 11 }}>Drag to orbit · wheel or pinch to zoom · dashed orange = tentative</Text>
    <Text style={{ color: colors.muted, fontSize: 10 }}>Thick frustum edge = image top</Text>
    <Text style={{ color: colors.muted, fontSize: 10 }}>Axes follow the highlighted origin reference: X right · Y down · Z forward</Text>
  </View>;
}
