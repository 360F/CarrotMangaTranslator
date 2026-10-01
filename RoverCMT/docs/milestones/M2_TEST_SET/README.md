# M2 — Reviewed Test Set / Benchmark

**Status: not active** · [Planning index](../README.md) · [CURRENT](CURRENT.md) · [IDEAS](IDEAS.md) · [REJECTED](REJECTED.md)

## 목표

코딩 에이전트가 임의로 만든 테스트가 아니라, **사용자가 직접 검토하고 승인한** 장기 기준 테스트셋과 benchmark를 구축한다.

## 요구사항 (사용자 정의, 2026-10-01)

- pipeline 각 stage별 테스트와 stage별 실행시간 측정
- Full E2E 테스트와 Full E2E 실행시간 측정
- 사용자가 직접 선정하는 Golden Sample 약 3종. 내용 특성과 page 길이가 서로 다른 sample
- baseline과 candidate 결과 비교

## 운영 원칙

- 모든 commit마다 자동으로 돌리는 benchmark가 **아니다.** 사용자가 benchmark/test 실행을 요구할 때 실행한다.
- 개발 중 unit/smoke/regression test는 코딩 에이전트가 자유롭게 만들 수 있다. 이들은 M2의 장기 기준 셋이 아니다.
- 장기 기준 Golden Sample과 benchmark contract는 **사용자가 승인**한다.
- 승인된 base version은 임의로 수정하지 않는다. 변경이 필요하면 **새 version**을 만든다.
- 사용자가 최종 contract로 확정하지 않은 세부사항(반복 횟수, 자동 품질 판정 등)은 IDEAS에 두고 CURRENT로 임의 승격하지 않는다.

## M2와 다른 milestone의 관계

- M1-OBS-001의 stage timing 출력이 M2 측정의 기반이다.
- M3·M4는 M2 benchmark로 M1 baseline 대비 Before/After를 측정한다.

## 선례 (참고)

renderer spike는 이미 immutable/versioned 입력을 썼다: manifest v1/v2/v3, SHA-256으로 묶은 fixture·font·reference. 근거: [RENDERER_CONTRACT_ALIGNED_RECOMPARISON §6 Canonical v3 contract](../../analysis/RENDERER_CONTRACT_ALIGNED_RECOMPARISON.md#6-canonical-v3-contract), [RENDERER_FIXTURE_CENSUS §11 Fixture Manifest Design](../../analysis/RENDERER_FIXTURE_CENSUS.md#11-fixture-manifest-design).
