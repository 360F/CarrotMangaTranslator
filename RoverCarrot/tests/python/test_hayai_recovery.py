"""Exercise Hayai OCR degeneration recovery without loading the model."""
from __future__ import annotations

import ast
import contextlib
import json
import math
from pathlib import Path
import re
import sys
import tempfile
from types import SimpleNamespace
import unicodedata
import unittest


SCRIPT = Path(__file__).resolve().parents[2] / "runtime/hayai/worker.py"
MAX_NEW_TOKENS = 128


def load_recovery_pipeline(recognized):
    tree = ast.parse(SCRIPT.read_text(encoding="utf-8"))
    names = {
        "process_page", "read_json", "require_regions", "require_box", "box_contains",
        "require_ocr_subdivision", "ocr_subdivision_mode", "first_pass_boxes",
        "retry_boxes", "recognize_work", "with_ocr_health", "dialogue_hint",
        "effect_item", "normalize_text", "recognize_batch", "GenerationLengthRecorder",
    }
    nodes = [ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0)]
    nodes.extend(node for node in tree.body if (
        isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in names
    ) or isinstance(node, ast.Assign))
    calls: list[list[tuple[float, ...]]] = []

    def recognize_batch_resilient(_model, _tokenizer, _processor, _device, crops, **_kwargs):
        calls.append(list(crops))
        return [recognized(crop) for crop in crops]

    namespace = dict(
        json=json, math=math, re=re, sys=sys, unicodedata=unicodedata, Path=Path,
        Any=object, Mapping=dict, Sequence=list,
        Image=SimpleNamespace(open=lambda _path: FakeImage()),
        ImageOps=SimpleNamespace(exif_transpose=lambda image: image),
        crop_region=lambda _image, box: tuple(box),
        recognize_batch_resilient=recognize_batch_resilient,
        torch=SimpleNamespace(inference_mode=contextlib.nullcontext),
    )
    exec(compile(ast.fix_missing_locations(ast.Module(body=nodes, type_ignores=[])), str(SCRIPT), "exec"), namespace)
    return namespace, calls


class FakeImage:
    size = (1000, 1000)
    width, height = size

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def convert(self, _mode):
        return self


def region(region_id, bbox, **extra):
    return {"id": region_id, "regionId": f"D{region_id:03d}", "kind": "dialogue", "bbox": bbox, **extra}


LEFT = [100.0, 100.0, 150.0, 400.0]
RIGHT = [150.0, 100.0, 200.0, 400.0]
WHOLE = [100.0, 100.0, 200.0, 400.0]
LOOP = "ペラ" * 64


class HayaiOcrRecoveryTest(unittest.TestCase):
    def run_page(self, regions, recognized):
        runtime, calls = load_recovery_pipeline(recognized)
        with tempfile.TemporaryDirectory(prefix="hayai-recovery-") as root:
            manifest = Path(root) / "regions.json"
            manifest.write_text(json.dumps({
                "schemaVersion": runtime["REGION_SCHEMA"], "width": 1000, "height": 1000,
                "dialogueRegions": regions, "effectRegions": [],
            }), encoding="utf-8")
            payload = runtime["process_page"](
                image_path=Path(root) / "page.png", region_path=manifest,
                output_path=Path(root) / "out.json", model=None, tokenizer=None,
                processor=None, device=None, batch_size=8,
                max_new_tokens=MAX_NEW_TOKENS, max_num_patches=256,
            )
        return payload["items"], calls

    def test_healthy_regions_keep_the_whole_region_read(self):
        retry = {"mode": "retry", "bboxes": [RIGHT, LEFT]}
        items, calls = self.run_page(
            [region(1, WHOLE, ocrSubdivision=retry), region(2, [300.0, 300.0, 340.0, 360.0])],
            lambda crop: ("あああああ!" if crop[0] == 300.0 else "今日は", 6),
        )
        self.assertEqual(calls, [[tuple(WHOLE), (300.0, 300.0, 340.0, 360.0)]])
        self.assertEqual([item["ocrText"] for item in items], ["今日は", "あああああ!"])
        self.assertTrue(all("ocrHealth" not in item for item in items))

    def test_exhausted_whole_read_retries_once_in_segment_order(self):
        segments = {tuple(RIGHT): "右の列", tuple(LEFT): "左の列"}
        retry = {"mode": "retry", "bboxes": [RIGHT, LEFT]}
        items, calls = self.run_page(
            [region(1, WHOLE, ocrSubdivision=retry)],
            lambda crop: (LOOP, MAX_NEW_TOKENS) if crop == tuple(WHOLE) else (segments[crop], 4),
        )
        self.assertEqual(calls, [[tuple(WHOLE)], [tuple(RIGHT), tuple(LEFT)]])
        self.assertEqual(items[0]["ocrText"], "右の列左の列")
        self.assertEqual(items[0]["ocrHealth"]["status"], "recovered")
        self.assertNotIn("recognitionSegments", items[0])

    def test_retry_that_degenerates_again_is_marked_without_more_attempts(self):
        retry = {"mode": "retry", "bboxes": [RIGHT, LEFT]}
        items, calls = self.run_page(
            [region(1, WHOLE, ocrSubdivision=retry)],
            lambda crop: (LOOP, MAX_NEW_TOKENS) if crop != tuple(LEFT) else ("左", 2),
        )
        self.assertEqual(len(calls), 2)
        self.assertEqual(items[0]["ocrText"], LOOP)
        self.assertEqual(items[0]["ocrHealth"], {
            "status": "failed", "reason": "generation-budget-exhausted",
            "strategy": "retry-subdivision", "segments": 2, "regionId": "D001",
        })

    def test_exhausted_region_without_geometry_is_marked_failed(self):
        items, calls = self.run_page([region(1, WHOLE)], lambda _crop: (LOOP, MAX_NEW_TOKENS))
        self.assertEqual(len(calls), 1)
        self.assertEqual(items[0]["ocrHealth"]["strategy"], "none")
        self.assertEqual(items[0]["ocrHealth"]["status"], "failed")
        self.assertNotIn("segments", items[0]["ocrHealth"])

    def test_preemptive_subdivision_reads_segments_and_never_retries(self):
        preemptive = {"mode": "preemptive", "bboxes": [RIGHT, LEFT]}
        items, calls = self.run_page(
            [region(1, WHOLE, ocrSubdivision=preemptive)],
            lambda crop: ("右", 3) if crop == tuple(RIGHT) else ("左", 3),
        )
        self.assertEqual(calls, [[tuple(RIGHT), tuple(LEFT)]])
        self.assertEqual(items[0]["ocrText"], "右左")
        self.assertEqual(items[0]["ocrHealth"], {
            "status": "subdivided", "strategy": "preemptive-subdivision",
            "segments": 2, "regionId": "D001",
        })
        items, calls = self.run_page(
            [region(1, WHOLE, ocrSubdivision=preemptive)],
            lambda _crop: (LOOP, MAX_NEW_TOKENS),
        )
        self.assertEqual(len(calls), 1)
        self.assertEqual(items[0]["ocrHealth"]["strategy"], "preemptive-subdivision")

    def test_existing_recognition_segments_keep_their_contract(self):
        items, calls = self.run_page(
            [region(1, WHOLE, recognitionBboxes=[RIGHT, LEFT])],
            lambda crop: ("右", 2) if crop == tuple(RIGHT) else ("左", 2),
        )
        self.assertEqual(calls, [[tuple(RIGHT), tuple(LEFT)]])
        self.assertEqual(items[0]["ocrText"], "右左")
        self.assertEqual([segment["ocrText"] for segment in items[0]["recognitionSegments"]], ["右", "左"])
        self.assertNotIn("ocrHealth", items[0])

    def test_unknown_generation_length_is_never_treated_as_exhausted(self):
        retry = {"mode": "retry", "bboxes": [RIGHT, LEFT]}
        items, calls = self.run_page(
            [region(1, WHOLE, ocrSubdivision=retry)], lambda _crop: (LOOP, None),
        )
        self.assertEqual(len(calls), 1)
        self.assertNotIn("ocrHealth", items[0])

    def test_invalid_subdivision_geometry_is_rejected(self):
        runtime, _calls = load_recovery_pipeline(lambda _crop: ("", 0))
        for subdivision in (
            {"mode": "retry", "bboxes": [RIGHT, [150.0, 100.0, 260.0, 400.0]]},
            {"mode": "retry", "bboxes": [LEFT] * 9},
            {"mode": "always", "bboxes": [RIGHT, LEFT]},
        ):
            with self.subTest(subdivision=subdivision), self.assertRaises(RuntimeError):
                runtime["require_regions"]([region(1, WHOLE, ocrSubdivision=subdivision)], "dialogue")

    def test_generation_lengths_come_from_the_decoded_token_ids(self):
        runtime, _calls = load_recovery_pipeline(lambda _crop: ("", 0))

        class Tokenizer:
            eos_token_id = 3

            def decode(self, token_ids, skip_special_tokens=True):
                return "x" * len(token_ids)

        class Model:
            def __init__(self, decode_calls):
                self.decode_calls = decode_calls

            def generate(self, *, tokenizer, **_kwargs):
                assert tokenizer.eos_token_id == 3
                if self.decode_calls is None:
                    return ["a", "b"]
                return [tokenizer.decode([1] * count) for count in self.decode_calls]

        class Inputs(dict):
            def to(self, _device):
                return self

        def processor(**_kwargs):
            return Inputs(pixel_values=None, pixel_attention_mask=None, spatial_shapes=None)

        recognize = runtime["recognize_batch"]
        self.assertEqual(
            recognize(Model([128, 5]), Tokenizer(), processor, None, ["a", "b"],
                      max_new_tokens=MAX_NEW_TOKENS, max_num_patches=256),
            [("x" * 128, 128), ("x" * 5, 5)],
        )
        self.assertEqual(
            recognize(Model(None), Tokenizer(), processor, None, ["a", "b"],
                      max_new_tokens=MAX_NEW_TOKENS, max_num_patches=256),
            [("a", None), ("b", None)],
        )


if __name__ == "__main__":
    unittest.main()
