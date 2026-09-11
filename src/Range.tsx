import Slider from '@react-native-community/slider';
import { colors } from './ui';

export type RangeProps = { label: string; min: number; max: number; value: number; onChange: (value: number) => void };
export default function Range({ label, min, max, value, onChange }: RangeProps) {
  // Keep the native slider value nonzero: the library treats zero as unset.
  return <Slider accessibilityLabel={label} accessibilityValue={{ min, max, now: value }} minimumValue={1} maximumValue={max - min + 1}
    value={value - min + 1} onValueChange={v => onChange(v + min - 1)}
    minimumTrackTintColor={colors.ink} maximumTrackTintColor={colors.line} thumbTintColor={colors.ink} />;
}
