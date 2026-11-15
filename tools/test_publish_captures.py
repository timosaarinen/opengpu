"""Offline contracts for capture normalization, names and stable issue markup."""
import importlib.util
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch
from PIL import Image, PngImagePlugin

spec = importlib.util.spec_from_file_location("captures", Path(__file__).with_name("publish-captures.py"))
captures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(captures)


class CaptureTests(unittest.TestCase):
    def test_encoding_independent_pixels_and_legacy_file(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / "Same.png"
            image = Image.new("RGB", (8, 6), (9, 80, 120))
            image.save(source)
            item = captures.asset(source)
            encoded = captures.io.BytesIO()
            image.save(encoded, format="PNG", compress_level=0)
            legacy = encoded.getvalue()
            self.assertNotEqual(legacy, item["data"])
            source.write_bytes(legacy)
            self.assertEqual(item["sha256"], captures.asset(source)["sha256"])
            # RGB and fully opaque RGBA represent the same pixels too.
            image.convert("RGBA").save(source)
            self.assertEqual(item["sha256"], captures.asset(source)["sha256"])
            group = root / "group"
            group.mkdir()
            legacy_hash = captures.hashlib.sha256(legacy).hexdigest()
            old = group / f"same-{legacy_hash[:16]}.png"
            old.write_bytes(legacy)
            self.assertFalse(captures.store_asset(group, item))
            self.assertEqual(item["name"], old.name)
            self.assertEqual(item["stored_sha256"], legacy_hash)
            self.assertEqual(old.read_bytes(), legacy)
            self.assertEqual(len(list(group.iterdir())), 1)

    def test_canonical_file_reused_without_reencoding(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / "same.png"
            image = Image.new("RGB", (8, 6), (9, 80, 120))
            image.save(source)
            first = captures.asset(source)
            encoded = captures.io.BytesIO()
            image.save(encoded, format="PNG", compress_level=0)
            first["data"] = encoded.getvalue()
            group = root / "group"
            group.mkdir()
            self.assertTrue(captures.store_asset(group, first))
            renamed = root / "renamed.png"
            image.save(renamed)
            second = captures.asset(renamed)
            self.assertFalse(captures.store_asset(group, second))
            self.assertEqual(second["name"],first["name"])
            self.assertEqual(len(list(group.iterdir())),1)
            self.assertEqual((group / first["name"]).read_bytes(), first["data"])
            image = Image.new("RGB", (8, 6), (255, 0, 0))
            image.save(group / second["name"])
            with self.assertRaises(RuntimeError): captures.store_asset(group, second)

    def test_existing_legacy_comment_is_reused(self):
        items = [{"sha256":"pixels", "stored_sha256":"old-bytes", "label":"Night"}]
        current = captures.batch_fingerprint(items,"group","Review")
        legacy = captures.batch_fingerprint(items,"group","Review","stored_sha256")
        self.assertNotEqual(current, legacy)
        old = {"body":f"<!-- opengpu-captures:{legacy} -->\nHuman-edited review",
               "html_url":"https://example.com/comment/1"}
        response = type("Response", (), {"stdout":captures.json.dumps([[old]])})()
        with patch.object(captures,"run",return_value=response) as runner:
            result = captures.comment(Path.cwd(),"owner/project#1","New body",current,legacy)
            self.assertEqual(result,old["html_url"])
            self.assertEqual(runner.call_count,1)  # read only; no second comment

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
                self.assertEqual((result.mode,result.size),(image.mode,image.size))
                self.assertEqual(result.tobytes(),image.tobytes())
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
