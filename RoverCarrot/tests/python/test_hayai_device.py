"""Device refusal and OOM split rules, without importing torch or model code."""
import ast
from pathlib import Path
from types import SimpleNamespace
import unittest

SCRIPT = Path(__file__).resolve().parents[2] / 'runtime/hayai/worker.py'


def functions(*names):
    tree = ast.parse(SCRIPT.read_text())
    nodes = [ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0)]
    nodes += [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
    return compile(ast.fix_missing_locations(ast.Module(body=nodes, type_ignores=[])), str(SCRIPT), 'exec')


class DeviceTest(unittest.TestCase):
    def test_gpu_requested_without_gpu_never_uses_cpu(self):
        ns = {'torch': SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: False)), 'os': SimpleNamespace(environ={})}
        exec(functions('configure_requested_device'), ns)
        with self.assertRaisesRegex(RuntimeError, 'GPU'):
            ns['configure_requested_device']('gpu')

    def test_oom_splits_in_order_and_single_crop_failure_propagates(self):
        calls = []
        def recognize(_model, _tokenizer, _processor, _device, crops, **_kwargs):
            calls.append(list(crops))
            if len(crops) > 1:
                raise RuntimeError('CUDA out of memory')
            return [(str(crops[0]), 1)]
        ns = {'recognize_batch': recognize, 'release_gpu_memory': lambda: None}
        exec(functions('recognize_batch_resilient', 'is_gpu_out_of_memory'), ns)
        result = ns['recognize_batch_resilient'](None, None, None, None, [1, 2, 3], max_new_tokens=128, max_num_patches=256)
        self.assertEqual(result, [('1', 1), ('2', 1), ('3', 1)])
        self.assertEqual(calls, [[1, 2, 3], [1], [2, 3], [2], [3]])
        ns['recognize_batch'] = lambda *_a, **_kw: (_ for _ in ()).throw(RuntimeError('CUDA out of memory'))
        with self.assertRaisesRegex(RuntimeError, 'out of memory'):
            ns['recognize_batch_resilient'](None, None, None, None, [1], max_new_tokens=128, max_num_patches=256)


if __name__ == '__main__':
    unittest.main()
