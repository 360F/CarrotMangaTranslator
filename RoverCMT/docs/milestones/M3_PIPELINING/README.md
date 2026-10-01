# M3 — Pipelining

**Status: not active** · [Planning index](../README.md) · [CURRENT](CURRENT.md) · [IDEAS](IDEAS.md) · [REJECTED](REJECTED.md)

## 목표

M1과 기능/품질 차이를 가능한 한 만들지 않으면서, pipeline 병렬화로 **전체 처리시간**을 단축한다.

## 원칙 (사용자 정의, 2026-10-01)

- stage dependency를 분석한다.
- 병렬화를 막는 공유 mutable state가 있으면 분리 가능한지 검토한다.
- GPU/CPU/model/runtime resource 충돌을 고려한다.
- M2 benchmark로 M1 baseline과 비교한다.
- 기능/품질은 M1과 큰 차이가 없어야 한다.
- 안전하고 실질적인 pipelining이 불가능하다고 확인되면 억지로 구현하지 않고, 이유를 기록하고 종료할 수 있다. 이 경우 근거와 함께 해당 item을 REJECTED로 옮긴다.

## 범위 구분

- **M3:** 여러 stage/page를 동시에 실행하는 것(scheduling, overlap, 공유 상태 분리).
- **M4:** 한 stage/runtime 자체를 빠르게 만드는 것. 두 milestone에 걸친 아이디어는 primary owner 하나에 두고 `Related items`로 연결한다.

## 출발점: 기존 Translation ↔ Erase 병렬 경로 (2026-10-01 결정)

- Carrot에는 이미 병렬 경로가 있다: `experimentalParallelAcceleration`이 켜지고 조건이 맞으면 translation lane 전체와 erase lane 전체를 `Promise.allSettled`로 겹친다. 각 lane은 page 순차다. 근거: [INPAINTING §8 Experimental Translation / Erase Parallel Path](../../analysis/INPAINTING_PIPELINE_MIGRATION_ANALYSIS.md#8-experimental-translation--erase-parallel-path).
- 이 경로는 **기존 기능이므로 M1에서 이식한다**([M1-CORE-002](../M1_LINUX_PORT/CURRENT.md#m1-core-002--기존-translation--erase-병렬-실행-경로-이식)). M3에서 처음 구현하는 기능이 아니다.
- M3는 M1에서 이식된 이 경로를 출발점이자 baseline으로 삼고, 그보다 넓은 pipelining/concurrency를 검토한다.
  - page N과 page N+1 overlap, page-level / stage-level concurrency → [M3-SCHED-002](IDEAS.md#m3-sched-002--page-level--stage-level-concurrency-전략)
  - Detection/OCR/Translation/Inpainting/Layout 사이 추가 overlap → [M3-SCHED-001](IDEAS.md#m3-sched-001--기존-translation--erase-병렬을-넘어선-추가-stage-overlap)
  - shared mutable state 제거/분리 → [M3-STATE-001](IDEAS.md#m3-state-001--공유-mutable-state-분리), translation memory 순서 의존 → [M3-TRANS-001](IDEAS.md#m3-trans-001--translation-memory-순차-dependency-완화)
  - GPU/CPU resource scheduling, model/runtime 의존으로 막히는 concurrency → [M3-RUNTIME-001](IDEAS.md#m3-runtime-001--pipelining을-위한-gpu-resource-scheduling), [M3-RUNTIME-002](IDEAS.md#m3-runtime-002--koharu-session-lifecycle이-병렬화를-방해하는-문제)
- 현재 CURRENT item은 없다. M3가 active가 되면 사용자가 IDEAS에서 CURRENT를 고른다.
