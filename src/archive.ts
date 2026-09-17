import JSZip from 'jszip';
import { Alignment, Collection, Entry, Photo, Subject } from './model';

export const extension = (photo: Photo) => ({ 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif' }[photo.mimeType] ?? 'jpg');

export async function makeArchive(collection: Collection, read: (photo: Photo) => Promise<Uint8Array>) {
  const zip = new JSZip();
  const entries = [];
  for (const entry of collection.entries) {
    const paths = { artwork: `images/${entry.id}/artwork.${extension(entry.artwork)}`, reference: `images/${entry.id}/reference.${extension(entry.reference)}` };
    zip.file(paths.artwork, await read(entry.artwork));
    zip.file(paths.reference, await read(entry.reference));
    const { uri: artworkUri, ...artwork } = entry.artwork;
    const { uri: referenceUri, ...reference } = entry.reference;
    entries.push({ ...entry, artwork: { ...artwork, path: paths.artwork }, reference: { ...reference, path: paths.reference } });
  }
  zip.file('manifest.json', JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(),
    alignmentConvention: { origin: 'reference center', x: 'fraction of reference width, positive right',
      y: 'fraction of reference height, positive down', rotation: 'clockwise degrees',
      scale: 'multiplier after aspect-fit of artwork inside reference', order: 'fit, scale, rotate around artwork center, translate',
      opacity: 'preview only; originals are unmodified' },
    subjects: collection.subjects, entries }, null, 2));
  return zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
}

export type ImportedArchive = { collection: Collection; files: Map<string, Uint8Array> };

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, label: string) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`The backup has an invalid ${label}.`);
  return value;
};
const number = (value: unknown, label: string) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`The backup has an invalid ${label}.`);
  return value;
};
const date = (value: unknown, label: string) => {
  const result = text(value, label);
  if (!Number.isFinite(Date.parse(result))) throw new Error(`The backup has an invalid ${label}.`);
  return result;
};

function photo(value: unknown, label: string): Photo {
  if (!record(value)) throw new Error(`The backup has an invalid ${label}.`);
  const path = text(value.path, `${label} image path`);
  if (path.startsWith('/') || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`The backup has an unsafe ${label} image path.`);
  }
  const width = number(value.width, `${label} width`);
  const height = number(value.height, `${label} height`);
  if (width <= 0 || height <= 0) throw new Error(`The backup has invalid ${label} dimensions.`);
  const mimeType = text(value.mimeType, `${label} image type`).toLowerCase();
  if (!mimeType.startsWith('image/')) throw new Error(`The backup ${label} is not an image.`);
  if (value.source !== 'camera' && value.source !== 'library') throw new Error(`The backup has an invalid ${label} source.`);
  return { uri: path, width, height, mimeType, source: value.source, selectedAt: date(value.selectedAt, `${label} selection date`) };
}

function alignment(value: unknown): Alignment {
  if (!record(value)) throw new Error('The backup has invalid alignment data.');
  const result = {
    x: number(value.x, 'alignment position'), y: number(value.y, 'alignment position'),
    rotation: number(value.rotation, 'alignment rotation'), scale: number(value.scale, 'alignment scale'),
    opacity: number(value.opacity, 'alignment opacity'),
  };
  if (result.scale <= 0 || result.opacity < 0 || result.opacity > 1) throw new Error('The backup has invalid alignment data.');
  return result;
}

/** Parse and validate a Parallax ZIP without trusting file names or manifest values. */
export async function readArchive(bytes: Uint8Array): Promise<ImportedArchive> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(bytes); }
  catch { throw new Error('This file is not a readable ZIP backup.'); }
  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) throw new Error('This ZIP does not contain a Parallax manifest.');
  let manifest: unknown;
  try { manifest = JSON.parse(await manifestFile.async('string')); }
  catch { throw new Error('The backup manifest is not valid JSON.'); }
  if (!record(manifest) || manifest.schemaVersion !== 1) throw new Error('This backup uses an unsupported data version.');
  if (!Array.isArray(manifest.subjects) || !Array.isArray(manifest.entries)) throw new Error('The backup manifest is incomplete.');

  const subjectIds = new Set<string>();
  const subjects: Subject[] = manifest.subjects.map((value, index) => {
    if (!record(value)) throw new Error(`The backup has an invalid subject ${index + 1}.`);
    const subject = { id: text(value.id, 'subject ID'), name: text(value.name, 'subject name'), createdAt: date(value.createdAt, 'subject date') };
    if (subjectIds.has(subject.id)) throw new Error('The backup contains duplicate subject IDs.');
    subjectIds.add(subject.id);
    return subject;
  });

  const entryIds = new Set<string>();
  const paths = new Set<string>();
  const entries: Entry[] = manifest.entries.map((value, index) => {
    if (!record(value)) throw new Error(`The backup has an invalid entry ${index + 1}.`);
    const id = text(value.id, 'entry ID');
    if (entryIds.has(id)) throw new Error('The backup contains duplicate entry IDs.');
    entryIds.add(id);
    const subjectId = text(value.subjectId, 'entry subject');
    if (!subjectIds.has(subjectId)) throw new Error('The backup contains an entry for a missing subject.');
    const artwork = photo(value.artwork, 'artwork');
    const reference = photo(value.reference, 'reference');
    for (const item of [artwork, reference]) {
      if (paths.has(item.uri)) throw new Error('The backup reuses an image path.');
      paths.add(item.uri);
      const file = zip.file(item.uri);
      if (!file || file.dir) throw new Error(`The backup is missing ${item.uri}.`);
    }
    if (typeof value.description !== 'string') throw new Error('The backup has an invalid description.');
    return { id, subjectId, artwork, reference, alignment: alignment(value.alignment),
      description: value.description, createdAt: date(value.createdAt, 'entry date') };
  });

  const files = new Map<string, Uint8Array>();
  for (const path of paths) files.set(path, await zip.file(path)!.async('uint8array'));
  return { collection: { schemaVersion: 1, subjects, entries }, files };
}
