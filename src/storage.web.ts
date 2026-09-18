import { appendEntry, Collection, Draft, emptyCollection, Photo } from './model';
import { makeArchive, readArchive } from './archive';
import * as DocumentPicker from 'expo-document-picker';

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('parallax', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('collection');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadCollection(): Promise<Collection> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('collection', 'readonly');
    const request = transaction.objectStore('collection').get('current');
    transaction.oncomplete = () => {
      db.close();
      const data = request.result ?? emptyCollection();
      if (data.schemaVersion !== 1) reject(new Error('Unsupported collection version.'));
      else resolve(data);
    };
    transaction.onabort = () => { db.close(); reject(transaction.error); };
  });
}

async function durablePhoto(photo: Photo): Promise<Photo> {
  const response = await fetch(photo.uri);
  if (!response.ok) throw new Error('Could not read the selected image. Please select it again.');
  const blob = await response.blob();
  const uri = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return { ...photo, uri, mimeType: blob.type || photo.mimeType };
}

export async function saveDraft(collection: Collection, draft: Draft): Promise<Collection> {
  const id = crypto.randomUUID();
  appendEntry(collection, draft, id, new Date().toISOString());
  const updated = appendEntry(collection, { ...draft, artwork: await durablePhoto(draft.artwork!), reference: await durablePhoto(draft.reference!) }, id, new Date().toISOString());
  await persistCollection(updated);
  return updated;
}

export async function persistCollection(collection: Collection) {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('collection', 'readwrite');
    transaction.objectStore('collection').put(collection, 'current');
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error('Could not save. Browser storage may be full.')); };
  });
}

export async function exportCollection(collection: Collection) {
  const bytes = await makeArchive(collection, async photo => new Uint8Array(await (await fetch(photo.uri)).arrayBuffer()));
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `parallax-${new Date().toISOString().slice(0, 10)}.zip`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const dataUri = (bytes: Uint8Array, mimeType: string) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result as string);
  reader.onerror = () => reject(reader.error ?? new Error('Could not read an image from the backup.'));
  reader.readAsDataURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeType }));
});

export async function importCollection(): Promise<Collection | null> {
  const picked = await DocumentPicker.getDocumentAsync({ type: ['application/zip', 'application/x-zip-compressed'], multiple: false, base64: false });
  if (picked.canceled) return null;
  const asset = picked.assets[0];
  const buffer = asset.file ? await asset.file.arrayBuffer() : await (await fetch(asset.uri)).arrayBuffer();
  const imported = await readArchive(new Uint8Array(buffer));
  const entries = await Promise.all(imported.collection.entries.map(async entry => ({ ...entry,
    artwork: { ...entry.artwork, uri: await dataUri(imported.files.get(entry.artwork.uri)!, entry.artwork.mimeType) },
    reference: { ...entry.reference, uri: await dataUri(imported.files.get(entry.reference.uri)!, entry.reference.mimeType) },
  })));
  const collection = { ...imported.collection, entries };
  await persistCollection(collection);
  return collection;
}
