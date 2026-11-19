import struct, unittest
from disc import Disc, inspect_exe
from assets import chunks, tim

class Formats(unittest.TestCase):
    def test_rc_sector_alignment(self):
        b=bytearray(6144);struct.pack_into('<4I',b,0,1,3,9,4)
        b[2048:2051]=b'abc';b[4096:4100]=b'defg'
        self.assertEqual(list(chunks(b)),[(1,2048,b'abc'),(9,4096,b'defg')])
        with self.assertRaises(ValueError): list(chunks(b[:-1]))
    def test_tim_palette_and_nibble_order(self):
        palette=[0,31,31<<5,31<<10]+[0]*12
        b=struct.pack('<2I',16,8)+struct.pack('<I4H',44,0,0,16,1)+struct.pack('<16H',*palette)
        b+=struct.pack('<I4H',14,0,0,1,1)+bytes([0x10,0x32])
        im,info=tim(b)
        self.assertEqual(list(im.getdata()),[(0,0,0,0),(255,0,0,255),(0,255,0,255),(0,0,255,255)])
        self.assertEqual(info['width'],4)
        with self.assertRaises(ValueError): tim(b[:-1])
    def test_palette_only_resource(self):
        b=struct.pack('<2I',16,9)+struct.pack('<I4H',524,0,490,256,1)+bytes(512)
        b+=struct.pack('<I4H',12,384,0,0,0)
        im,info=tim(b)
        self.assertTrue(info['palette_only'])
        self.assertEqual(im.size,(256,1))
    def test_exe_header(self):
        b=bytearray(2052);b[:8]=b'PS-X EXE';struct.pack_into('<4I',b,16,0x8003ee18,0,0x80010000,4)
        self.assertTrue(inspect_exe(b)['payload_present'])
        self.assertFalse(inspect_exe(b[:-1])['payload_present'])
    def test_directory_endian_validation(self):
        b=bytearray(34);b[0]=34;b[32]=1
        struct.pack_into('<I',b,2,50);struct.pack_into('>I',b,6,50)
        self.assertEqual(Disc.record(b)['lba'],50)
        b[6]=1
        with self.assertRaises(ValueError): Disc.record(b)

if __name__=='__main__': unittest.main()
