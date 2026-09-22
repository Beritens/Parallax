import JSZip from 'jszip';
import type { Entry } from '../model';
import type { ColmapRequest } from './colmap';

export async function exportColmap(subjectId: string, entries: Entry[], horizontalFov: number, method: 'colmap' | 'vggt' = 'colmap') {
  const zip = new JSZip();
  const request: ColmapRequest = { version:1, subjectId, horizontalFov, images:[] };
  for (const [index, entry] of entries.entries()) {
    // Decode with the same browser orientation as the reference viewer, strip EXIF,
    // and use PNG so COLMAP sees exactly the stored reference coordinate system.
    const image = new Image(); image.src = entry.reference.uri; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = entry.reference.width; canvas.height = entry.reference.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not prepare reference photos.');
    context.drawImage(image,0,0,canvas.width,canvas.height);
    const blob = await new Promise<Blob>((resolve,reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Could not encode reference photo.')), 'image/png'));
    const name = `reference-${index+1}.png`;
    zip.file(`images/${name}`,await blob.arrayBuffer());
    request.images.push({id:entry.id,name,width:canvas.width,height:canvas.height});
  }
  zip.file('request.json',JSON.stringify(request,null,2));
  const blob = await zip.generateAsync({type:'blob'}), url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = `parallax-${method}.zip`; link.click();
  setTimeout(() => URL.revokeObjectURL(url),60_000);
}
