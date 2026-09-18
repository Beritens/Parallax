import type { Entry, Subject } from './model';
import type { Reconstruction } from './pose/types';
export type PosePanelProps = { subject: Subject; entries: Entry[]; disabled: boolean; autoRunId: string | null;
  onBusy: (busy: boolean) => void; onSave: (result: Reconstruction) => Promise<void> };
export function PosePanel(_props: PosePanelProps) { return null; }
