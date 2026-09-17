import Storage from 'expo-sqlite/kv-store';
import { Directory, File, Paths } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { appendEntry, Collection, Draft, emptyCollection, Photo } from './model';
import { extension, makeArchive, readArchive } from './archive';

const KEY = 'parallax-collection-v1';
const resolve = (photo: Photo): Photo => ({ ...photo, uri: photo.uri.startsWith('parallax/') ? new File(Paths.document, photo.uri).uri : photo.uri });
const relative = (photo: Photo) => ({ ...photo, uri: photo.uri.replace(Paths.document.uri, '').replace(/^\/+/, '') });
const persistCollection = (collection: Collection) => Storage.setItem(KEY, JSON.stringify({ ...collection,
  entries: collection.entries.map(entry => ({ ...entry, artwork: relative(entry.artwork), reference: relative(entry.reference) })) }));
export async function loadCollection(): Promise<Collection> {
  const data = await Storage.getItem(KEY);
  if (!data) return emptyCollection();
  const collection: Collection = JSON.parse(data);
  if (collection.schemaVersion !== 1) throw new Error('This collection uses an unsupported data version.');
  return { ...collection, entries: collection.entries.map(e => ({ ...e, artwork: resolve(e.artwork), reference: resolve(e.reference) })) };
}

export async function saveDraft(collection: Collection, draft: Draft): Promise<Collection> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  // Validate before touching the filesystem.
  appendEntry(collection, draft, id, new Date().toISOString());
  const directory = new Directory(Paths.document, 'parallax', id);
  directory.create({ intermediates: true });
  try {
    const copy = (photo: Photo, role: string): Photo => {
      const target = new File(directory, `${role}.${extension(photo)}`);
      new File(photo.uri).copy(target);
      return { ...photo, uri: target.uri };
    };
    const updated = appendEntry(collection, { ...draft, artwork: copy(draft.artwork!, 'artwork'), reference: copy(draft.reference!, 'reference') }, id, new Date().toISOString());
    await persistCollection(updated);
    return updated;
  } catch (error) {
    if (directory.exists) directory.delete();
    throw error;
  }
}

export async function exportCollection(collection: Collection) {
  if (!(await Sharing.isAvailableAsync())) throw new Error('File sharing is unavailable on this device.');
  const bytes = await makeArchive(collection, photo => new File(photo.uri).bytes());
  const file = new File(Paths.cache, `parallax-${Date.now()}.zip`);
  try {
    file.write(bytes);
    await Sharing.shareAsync(file.uri, { mimeType: 'application/zip', UTI: 'public.zip-archive', dialogTitle: 'Export Parallax collection' });
  } finally {
    if (file.exists) file.delete();
  }
}

export async function importCollection(): Promise<Collection | null> {
  const picked = await DocumentPicker.getDocumentAsync({ type: ['application/zip', 'application/x-zip-compressed'], multiple: false });
  if (picked.canceled) return null;
  const imported = await readArchive(await new File(picked.assets[0].uri).bytes());
  const root = new Directory(Paths.document, 'parallax', `import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  root.create({ intermediates: true });
  try {
    const entries = imported.collection.entries.map((entry, index) => {
      const directory = new Directory(root, String(index));
      directory.create();
      const store = (photo: Photo, role: string) => {
        const file = new File(directory, `${role}.${extension(photo)}`);
        file.write(imported.files.get(photo.uri)!);
        return { ...photo, uri: file.uri };
      };
      return { ...entry, artwork: store(entry.artwork, 'artwork'), reference: store(entry.reference, 'reference') };
    });
    const collection = { ...imported.collection, entries };
    await persistCollection(collection);
    return collection;
  } catch (error) {
    if (root.exists) root.delete();
    throw error;
  }
}
