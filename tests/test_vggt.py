"""Run with the VGGT environment: python -m unittest discover -s tests -p 'test_vggt.py'."""
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from vggt_inference import original_intrinsics, reconstruction

class VggtGeometryTests(unittest.TestCase):
    def test_padding_and_resize_are_inverted(self):
        for width, height in [(640,480),(480,640),(640,640)]:
            rw = 518 if width >= height else round(width*518/height/14)*14
            rh = 518 if height >= width else round(height*518/width/14)*14
            sx,sy=rw/width,rh/height
            matrix=[[500*sx,0,320*sx+(518-rw)//2],[0,510*sy,240*sy+(518-rh)//2],[0,0,1]]
            k=original_intrinsics(matrix,width,height)
            for name,value in [('fx',500),('fy',510),('cx',320),('cy',240)]:
                self.assertAlmostEqual(k[name],value)

    def test_rebase_preserves_projection_and_camera_convention(self):
        import numpy as np
        r=np.diag([-1.,-1.,1.])
        extrinsics=np.stack([np.column_stack((r,[2.,0.,0.])),np.column_stack((r,[4.,0.,0.]))])
        request={'horizontalFov':60,'images':[{'id':i,'width':640,'height':480} for i in ['a','b']]}
        k=np.array([[500,0,259],[0,500,259],[0,0,1]])
        result=reconstruction(request,extrinsics,np.stack([k,k]))
        np.testing.assert_allclose(result['cameras']['a']['center'],[0,0,0])
        np.testing.assert_allclose(result['cameras']['b']['center'],[-1,0,0])
        np.testing.assert_allclose(result['cameras']['b']['translation'],[1,0,0])
        self.assertIsNone(result['cameras']['b']['reprojectionError'])
        with self.assertRaises(ValueError):
            reconstruction(request,np.stack([extrinsics[0],extrinsics[0]]),np.stack([k,k]))

if __name__ == '__main__':
    unittest.main()
