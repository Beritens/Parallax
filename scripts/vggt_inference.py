"""Local VGGT camera-only inference; input ZIP matches the COLMAP photo export."""
import argparse
import json
import math
import re
import tempfile
import zipfile
from contextlib import nullcontext
from datetime import datetime, timezone
from pathlib import Path


def original_intrinsics(matrix, width, height, size=518):
    """Undo official load_and_preprocess_images(mode='pad') resize and padding."""
    if width >= height:
        resized_width, resized_height = size, round(height * size / width / 14) * 14
    else:
        resized_width, resized_height = round(width * size / height / 14) * 14, size
    if min(resized_width, resized_height) <= 0:
        raise ValueError('Image aspect ratio is too extreme for VGGT.')
    sx, sy = resized_width / width, resized_height / height
    left, top = (size - resized_width) // 2, (size - resized_height) // 2
    return {'fx': float(matrix[0][0]) / sx, 'fy': float(matrix[1][1]) / sy,
            'cx': (float(matrix[0][2]) - left) / sx, 'cy': (float(matrix[1][2]) - top) / sy}


def reconstruction(request, extrinsics, intrinsics):
    import numpy as np
    rotations, centers = [], []
    for extrinsic in extrinsics:
        r = np.asarray(extrinsic[:, :3], dtype=np.float64)
        # Remove float32 roundoff before rebasing and validating proper rotations.
        u, _, vt = np.linalg.svd(r)
        r = u @ np.diag([1, 1, np.linalg.det(u @ vt)]) @ vt
        rotations.append(r)
        centers.append(-r.T @ np.asarray(extrinsic[:, 3], dtype=np.float64))
    distances = [float(np.linalg.norm(c - centers[0])) for c in centers]
    baseline = next((i for i, d in enumerate(distances) if d > 1e-6), None)
    if baseline is None:
        raise ValueError('VGGT predicted no usable camera baseline.')
    cameras = {}
    for i, photo in enumerate(request['images']):
        r = rotations[i] @ rotations[0].T
        c = rotations[0] @ (centers[i] - centers[0]) / distances[baseline]
        k = original_intrinsics(intrinsics[i], photo['width'], photo['height'])
        if not all(math.isfinite(v) for v in k.values()) or min(k['fx'], k['fy']) <= 0:
            raise ValueError('VGGT predicted invalid camera intrinsics.')
        k.update(source='vggt', horizontalFov=math.degrees(2 * math.atan(photo['width'] / (2 * k['fx']))))
        cameras[photo['id']] = {'rotation': r.flatten().tolist(), 'translation': (-r @ c).tolist(),
                               'center': c.tolist(), 'intrinsics': k, 'inliers': None, 'reprojectionError': None}
    ids = [p['id'] for p in request['images']]
    return {'version': 1, 'method': 'vggt', 'estimatedAt': datetime.now(timezone.utc).isoformat(),
            'entryIds': ids, 'originEntryId': ids[0], 'baselineEntryId': ids[baseline],
            'scale': 'arbitrary', 'horizontalFov': request['horizontalFov'], 'cameras': cameras,
            'unresolved': {}, 'pointCount': 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input')
    parser.add_argument('output')
    parser.add_argument('--device', choices=['auto', 'cpu', 'cuda'], default='auto')
    parser.add_argument('--checkpoint', help='Local official model.pt, otherwise download facebook/VGGT-1B')
    parser.add_argument('--threads', type=int, default=4)
    args = parser.parse_args()
    output = Path(args.output)
    if output.exists():
        raise ValueError(f'Output already exists: {output}')
    output.parent.mkdir(parents=True, exist_ok=True)
    try:
        import torch
        from PIL import Image
        from vggt.models.vggt import VGGT
        from vggt.utils.load_fn import load_and_preprocess_images
        from vggt.utils.pose_enc import pose_encoding_to_extri_intri
    except ImportError as error:
        raise RuntimeError('Install the VGGT Python environment described in README.md; set VGGT_PYTHON to its python executable.') from error
    if args.threads < 1:
        raise ValueError('--threads must be positive.')
    torch.set_num_threads(args.threads)
    device = ('cuda' if torch.cuda.is_available() else 'cpu') if args.device == 'auto' else args.device
    if device == 'cuda' and not torch.cuda.is_available():
        raise ValueError('CUDA is unavailable. Use --device cpu or repair the NVIDIA driver.')
    with tempfile.TemporaryDirectory(prefix='parallax-vggt-') as directory, zipfile.ZipFile(args.input) as archive:
        request = json.loads(archive.read('request.json'))
        photos = request.get('images', [])
        if request.get('version') != 1 or not isinstance(request.get('subjectId'), str) or len(photos) < 2:
            raise ValueError('Invalid photo request.')
        paths = []
        for photo in photos:
            name = photo['name']
            if not re.fullmatch(r'reference-\d+\.png', name):
                raise ValueError('Unsafe image filename.')
            path = Path(directory) / name
            path.write_bytes(archive.read(f'images/{name}'))
            with Image.open(path) as image:
                if image.size != (photo['width'], photo['height']):
                    raise ValueError('Photo dimensions differ from the request.')
            paths.append(str(path))
        print(f'Loading VGGT-1B on {device}; first run downloads approximately 5 GB of weights.', flush=True)
        model = VGGT(enable_point=False, enable_depth=False, enable_track=False)
        if args.checkpoint:
            state = torch.load(args.checkpoint, map_location='cpu', weights_only=True, mmap=True)
        else:
            from huggingface_hub import hf_hub_download
            checkpoint = hf_hub_download('facebook/VGGT-1B', 'model.pt')
            state = torch.load(checkpoint, map_location='cpu', weights_only=True, mmap=True)
        camera_state = {k: v for k, v in state.items() if k.startswith(('aggregator.', 'camera_head.'))}
        model.load_state_dict(camera_state, strict=True)
        del state, camera_state
        model = model.to(device).eval()
        images = load_and_preprocess_images(paths, mode='pad').to(device)
        context = (torch.autocast('cuda', dtype=torch.bfloat16 if torch.cuda.get_device_capability()[0] >= 8 else torch.float16)
                   if device == 'cuda' else nullcontext())
        print(f'Predicting {len(photos)} cameras together at {images.shape[-1]}px. CPU inference can take several minutes.', flush=True)
        with torch.inference_mode(), context:
            predictions = model(images)
            extrinsic, intrinsic = pose_encoding_to_extri_intri(predictions['pose_enc'].float(), images.shape[-2:])
        result = reconstruction(request, extrinsic[0].cpu().numpy(), intrinsic[0].cpu().numpy())
        with output.open('x') as file:
            json.dump({'version': 1, 'subjectId': request['subjectId'], 'reconstruction': result}, file, indent=2, allow_nan=False)
        print(f'Predicted {len(photos)} cameras. These are unverified learned estimates, not matched/registered cameras.', flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        raise SystemExit(f'VGGT failed: {error}')
