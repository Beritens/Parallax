import type { RangeProps } from './Range';
import { colors } from './ui';

export default function Range({ label, min, max, value, onChange }: RangeProps) {
  return <input type="range" aria-label={label} min={min} max={max} step={max - min > 10 ? 1 : 0.01} value={value}
    onChange={event => onChange(Number(event.target.value))}
    style={{ width: '100%', height: 36, margin: 0, accentColor: colors.ink, cursor: 'pointer' }} />;
}
