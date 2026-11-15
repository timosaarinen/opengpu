"""Offline contracts for capture normalization, names and stable issue markup."""
import importlib.util
import tempfile
from pathlib import Path
import unittest
from PIL import Image, PngImagePlugin

spec = importlib.util.spec_from_file_location("captures", Path(__file__).with_name("publish-captures.py"))
captures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(captures)


class CaptureTests(unittest.TestCase):
    def test_pixels_metadata_and_idempotence(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder)/"Night scene.png"
            image = Image.new("RGB", (3,2), (9,80,120))
            info = PngImagePlugin.PngInfo()
            info.add_text("source", "private local path")
            image.save(source, pnginfo=info)
            first, second = captures.asset(source), captures.asset(source)
            self.assertEqual(first,second)
            self.assertTrue(first["name"].startswith("night-scene-"))
            with Image.open(captures.io.BytesIO(first["data"])) as result:
                self.assertEqual(list(result.getdata()),list(image.getdata()))
                self.assertNotIn("source",result.info)
            one, fingerprint = captures.markdown([first],"owner/site","abc","group","Review")
            two, repeated = captures.markdown([second],"owner/site","def","group","Review")
            self.assertEqual(fingerprint,repeated)  # stable across a later hosting commit
            self.assertIn("![Night scene]",one)
            self.assertNotIn(str(folder),one)
            self.assertIn("/def/internal/images/",two)

    def test_formats_and_names(self):
        self.assertNotIn("..",captures.slug("../../unsafe/path"))
        with self.assertRaises(ValueError): captures.slug("...")
        with tempfile.TemporaryDirectory() as folder:
            text = Path(folder)/"source.c"
            text.write_text("not a capture")
            with self.assertRaises(ValueError): captures.asset(text)
            fake = Path(folder)/"fake.mp4"
            fake.write_bytes(b"not video")
            with self.assertRaises(ValueError): captures.asset(fake)


if __name__ == "__main__":
    unittest.main()
