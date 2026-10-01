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

## 이미 알려진 사실 (analysis 인용)

- Carrot에는 이미 실험적 병렬 경로가 있다: `experimentalParallelAcceleration`이 켜지고 조건이 맞으면 translation lane 전체와 erase lane 전체를 `Promise.allSettled`로 겹친다. 각 lane은 page 순차다. 근거: [INPAINTING §8 Experimental Translation / Erase Parallel Path](../../analysis/INPAINTING_PIPELINE_MIGRATION_ANALYSIS.md#8-experimental-translation--erase-parallel-path).
- 이 경로를 M1에서 이식할지, M3에서 재설계할지는 아직 결정되지 않았다([M3-SCHED-001](IDEAS.md#m3-sched-001--detectionocrtranslationerase-stage-overlap)).
- 현재 CURRENT item은 없다. M3가 active가 되면 사용자가 IDEAS에서 CURRENT를 고른다.
