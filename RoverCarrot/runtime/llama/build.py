#!/usr/bin/env python3
"""Pinned b9553 / CUDA 13.3 provisioning, without sudo or HOME writes.

Default: provision + configure. --build additionally compiles llama-server.
All large artifacts live in ignored test-data/runtime/llama-b9553.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import urllib.request
import zipfile
import zlib


def verified_download(url, destination, digest, size):
    if not destination.exists():
        partial = destination.with_suffix(destination.suffix + '.partial')
        with urllib.request.urlopen(url) as response, partial.open('wb') as output:
            shutil.copyfileobj(response, output)
        partial.rename(destination)
    with destination.open('rb') as stream:
        actual = hashlib.file_digest(stream, 'sha256').hexdigest()
    if destination.stat().st_size != size or actual != digest:
        raise RuntimeError(f'Integrity mismatch: {destination}; no substitution permitted')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--build', action='store_true')
    parser.add_argument('--jobs', type=int, default=2)
    args = parser.parse_args()
    if args.jobs < 1:
        parser.error('--jobs must be positive')
    project = Path(__file__).resolve().parents[2]
    pins = json.loads(Path(__file__).with_name('pins.json').read_text())
    root = project / 'test-data/runtime/llama-b9553'
    root.mkdir(parents=True, exist_ok=True)
    wheels = root / 'wheels'
    tools = root / 'toolchain'
    wheels.mkdir(exist_ok=True)
    tools.mkdir(exist_ok=True)
    for wheel in pins['wheels']:
        path = wheels / wheel['file']
        verified_download(wheel['url'], path, wheel['sha256'], wheel['bytes'])
        with zipfile.ZipFile(path) as archive:
            for member in archive.infolist():
                destination = tools / member.filename
                if destination.exists() and destination.is_file():
                    if destination.stat().st_size == member.file_size:
                        crc = 0
                        with destination.open('rb') as stream:
                            while chunk := stream.read(1024 * 1024):
                                crc = zlib.crc32(chunk, crc)
                        if crc == member.CRC:
                            continue
                    raise RuntimeError(f'Existing toolchain differs from pin: {destination}')
                archive.extract(member, tools)
        print(f"Verified {wheel['package']}=={wheel['version']}", flush=True)
    for path in tools.rglob('*'):
        if path.is_file() and (path.parent.name == 'bin' or path.name in ('ptxas', 'cicc')):
            path.chmod(path.stat().st_mode | 0o111)
    # NVIDIA 13 wheels split nvcc, CRT, NVVM, runtime, CCCL and cuBLAS.
    # Reassemble their canonical CUDA layout using links to verified bytes.
    cuda = root / 'cuda'
    cuda.mkdir(exist_ok=True)
    for package in (tools / 'nvidia').iterdir():
        if not package.is_dir():
            continue
        for directory in ('bin', 'include', 'lib', 'lib64', 'nvvm', 'cccl'):
            source = package / directory
            if not source.is_dir():
                continue
            target = cuda / ('lib64' if directory == 'lib' else directory)
            target.mkdir(exist_ok=True)
            for child in source.iterdir():
                link = target / child.name
                if link.is_symlink() and link.resolve() == child.resolve():
                    continue
                if link.exists() or link.is_symlink():
                    raise RuntimeError(f'CUDA layout collision: {link}')
                link.symlink_to(child, target_is_directory=child.is_dir())
    # Wheels ship SONAMEs without development aliases; CMake find_library
    # requires the unversioned linker names in the conventional toolkit root.
    for library in ('cudart', 'cublas', 'cublasLt', 'nvblas', 'nvvm'):
        matches = list((cuda / 'lib64').glob(f'lib{library}.so.*'))
        link = cuda / 'lib64' / f'lib{library}.so'
        if len(matches) == 1 and not link.exists():
            link.symlink_to(matches[0].name)
    # CUDA 13 nvcc.profile uses TOP/lib while CMake also searches lib64.
    if not (cuda / 'lib').exists():
        (cuda / 'lib').symlink_to('lib64', target_is_directory=True)
    source_pin = pins['source']
    archive_path = root / 'source.tar.gz'
    verified_download(source_pin['url'], archive_path, source_pin['sha256'], source_pin['bytes'])
    source = root / ('llama.cpp-' + pins['revision'])
    if not source.exists():
        with tarfile.open(archive_path) as archive:
            archive.extractall(root, filter='data')
    cmake = tools / 'cmake/data/bin/cmake'
    ninja = next(path for path in tools.rglob('ninja') if path.is_file())
    ninja.chmod(ninja.stat().st_mode | 0o111)
    env = dict(os.environ)
    env['PATH'] = f"{cmake.parent}:{ninja.parent}:{cuda / 'bin'}:{env.get('PATH', '')}"
    env['CUDACXX'] = str(cuda / 'bin/nvcc')
    env['CUDA_PATH'] = str(cuda)
    env['LD_LIBRARY_PATH'] = f"{cuda / 'lib64'}:{env.get('LD_LIBRARY_PATH', '')}"
    # Archive builds must not accidentally report RoverCMT's enclosing HEAD.
    # Source provenance is recorded separately in pins.json/binary-identity.json.
    env['GIT_CEILING_DIRECTORIES'] = str(root)
    env['GOCACHE'] = str(root / 'go-cache')
    env['GOMODCACHE'] = str(root / 'go-mod-cache')
    build = root / 'build-cuda'
    command = [str(cmake), '-S', str(source), '-B', str(build), '-G', 'Ninja',
               '-DCMAKE_BUILD_TYPE=Release', f'-DCUDAToolkit_ROOT={cuda}',
               '-DGGML_CUDA=ON', '-DGGML_NATIVE=OFF', '-DGGML_BACKEND_DL=ON',
               '-DGGML_CPU=OFF', '-DLLAMA_BUILD_BORINGSSL=ON', '-DGGML_CUDA_CUB_3DOT2=ON']
    # Same dependency tags as b9553. Use verified archives rather than invoking
    # FetchContent's Git clone/update, respecting the session's Git prohibition.
    for dependency in pins['dependencies']:
        archive_path = root / (dependency['name'] + '.tar.gz')
        verified_download(dependency['url'], archive_path, dependency['sha256'], dependency['bytes'])
        destination = root / ('dependency-' + dependency['name'])
        if not destination.exists():
            destination.mkdir()
            with tarfile.open(archive_path) as archive:
                archive.extractall(destination, filter='data')
        directories = [path for path in destination.iterdir() if path.is_dir()]
        if len(directories) != 1:
            raise RuntimeError(f'Unexpected dependency layout: {destination}')
        command.append(f"-DFETCHCONTENT_SOURCE_DIR_{dependency['name'].upper()}={directories[0]}")
    # WSL exposes the host driver outside the repository-local toolkit.
    # This is a linker input only, not a fabricated driver or CPU fallback.
    wsl_driver = Path('/usr/lib/wsl/lib/libcuda.so')
    if wsl_driver.is_file():
        command.append(f'-DCUDA_cuda_driver_LIBRARY={wsl_driver}')
    (root / 'configure-command.json').write_text(json.dumps(command, indent=2) + '\n')
    for version_command in ([str(cmake), '--version'], [str(ninja), '--version'],
                            [str(cuda / 'bin/nvcc'), '--version'], ['g++', '--version']):
        subprocess.run(version_command, env=env, check=True)
    print('Configure:', json.dumps(command), flush=True)
    subprocess.run(command, env=env, check=True)
    # The Windows CUDA job builds only ggml-cuda. Its release is combined with
    # the CPU job's server + all x64 CPU variants, not a CPU-less server.
    cpu_build = root / 'build-cpu'
    cpu_command = [str(cmake), '-S', str(source), '-B', str(cpu_build), '-G', 'Ninja',
                   '-DCMAKE_BUILD_TYPE=Release', '-DLLAMA_BUILD_BORINGSSL=ON',
                   '-DGGML_NATIVE=OFF', '-DGGML_BACKEND_DL=ON',
                   '-DGGML_CPU_ALL_VARIANTS=ON', '-DGGML_OPENMP=ON']
    cpu_command += [option for option in command if option.startswith('-DFETCHCONTENT_SOURCE_DIR_BORINGSSL=')]
    (root / 'configure-cpu-command.json').write_text(json.dumps(cpu_command, indent=2) + '\n')
    subprocess.run(cpu_command, env=env, check=True)
    if args.build:
        subprocess.run([str(cmake), '--build', str(build), '--parallel', str(args.jobs),
                        '--target', 'ggml-cuda'], env=env, check=True)
        subprocess.run([str(cmake), '--build', str(cpu_build), '--parallel', str(args.jobs),
                        '--target', 'llama-server'], env=env, check=True)
        output = root / 'bin'
        output.mkdir(exist_ok=True)
        inventory = []
        for directory in (cpu_build / 'bin', build / 'bin'):
            for artifact in sorted(directory.iterdir()):
                if directory == build / 'bin' and not artifact.name.startswith('libggml-cuda.so'):
                    continue
                if artifact.name != 'llama-server' and '.so' not in artifact.name:
                    continue
                destination = output / artifact.name
                if artifact.is_symlink():
                    if not destination.exists() and not destination.is_symlink():
                        destination.symlink_to(os.readlink(artifact))
                    continue
                shutil.copy2(artifact, destination)
                with destination.open('rb') as stream:
                    digest = hashlib.file_digest(stream, 'sha256').hexdigest()
                inventory.append({'file': destination.name, 'bytes': destination.stat().st_size,
                                  'sha256': digest})
        binary = output / 'llama-server'
        with binary.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        (root / 'binary-identity.json').write_text(json.dumps({
            'revision': pins['revision'], 'cuda': '13.3', 'binary': str(binary),
            'bytes': binary.stat().st_size, 'sha256': digest,
            'inventory': inventory, 'configure': command, 'configureCpu': cpu_command,
        }, indent=2) + '\n')


if __name__ == '__main__':
    main()
