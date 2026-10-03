"""Integrity checks for repository-local tool downloads (no network/GPU)."""
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest

MODULE = Path(__file__).resolve().parents[2] / 'runtime/llama/build.py'
SPEC = importlib.util.spec_from_file_location('llama_recipe', MODULE)
RECIPE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RECIPE)


class RecipeIntegrityTests(unittest.TestCase):
    def test_verified_download_and_cached_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'source'
            output = Path(directory) / 'download'
            source.write_bytes(b'pinned bytes')
            digest = hashlib.sha256(source.read_bytes()).hexdigest()
            RECIPE.verified_download(source.as_uri(), output, digest, source.stat().st_size)
            source.unlink()
            RECIPE.verified_download(source.as_uri(), output, digest, output.stat().st_size)

    def test_existing_mismatch_is_rejected_and_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'download'
            output.write_bytes(b'changed')
            with self.assertRaisesRegex(RuntimeError, 'Integrity mismatch'):
                RECIPE.verified_download('https://unused.invalid/', output, '0' * 64, 7)
            self.assertEqual(output.read_bytes(), b'changed')

    def test_size_mismatch_is_rejected_even_with_matching_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'download'
            output.write_bytes(b'pinned bytes')
            digest = hashlib.sha256(output.read_bytes()).hexdigest()
            with self.assertRaisesRegex(RuntimeError, 'Integrity mismatch'):
                RECIPE.verified_download('https://unused.invalid/', output, digest, 1)


if __name__ == '__main__':
    unittest.main()
