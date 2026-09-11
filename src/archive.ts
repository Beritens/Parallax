import JSZip from 'jszip';
import { Collection, Photo } from './model';

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
