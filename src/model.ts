export type Photo = {
  uri: string;
  width: number;
  height: number;
  mimeType: string;
  source: 'camera' | 'library';
  selectedAt: string;
};

// Translation is a fraction of the reference frame, measured from its center.
// Fit artwork inside the reference first, then scale, rotate, and translate.
export type Alignment = { x: number; y: number; rotation: number; scale: number; opacity: number };
export const initialAlignment: Alignment = { x: 0, y: 0, rotation: 0, scale: 1, opacity: 0.4 };
export type Entry = {
  id: string;
  subjectId: string;
  artwork: Photo;
  reference: Photo;
  alignment: Alignment;
  description: string;
  createdAt: string;
};
export type Subject = { id: string; name: string; createdAt: string };
export type Collection = { schemaVersion: 1; subjects: Subject[]; entries: Entry[] };
export const emptyCollection = (): Collection => ({ schemaVersion: 1, subjects: [], entries: [] });
export type Draft = { artwork?: Photo; reference?: Photo; alignment: Alignment; subject: string; description: string };
export const newDraft = (subject = ''): Draft => ({ alignment: { ...initialAlignment }, subject, description: '' });
export const normalizeSubject = (name: string) => name.trim().replace(/\s+/g, ' ');
export const subjectKey = (name: string) => normalizeSubject(name).toLowerCase();

export function appendEntry(collection: Collection, draft: Draft, id: string, now: string): Collection {
  const name = normalizeSubject(draft.subject);
  if (!name || !draft.artwork || !draft.reference) throw new Error('Add both photos and a subject before saving.');
  const subject = collection.subjects.find(s => subjectKey(s.name) === subjectKey(name))
    ?? { id: `subject-${id}`, name, createdAt: now };
  return {
    schemaVersion: 1,
    subjects: collection.subjects.some(s => s.id === subject.id) ? collection.subjects : [...collection.subjects, subject],
    entries: [...collection.entries, { id, subjectId: subject.id, artwork: draft.artwork, reference: draft.reference,
      alignment: { ...draft.alignment }, description: draft.description.trim(), createdAt: now }],
  };
}

export function fitInside(imageWidth: number, imageHeight: number, frameWidth: number, frameHeight: number) {
  const factor = Math.min(frameWidth / imageWidth, frameHeight / imageHeight);
  return { width: imageWidth * factor, height: imageHeight * factor };
}
