@AGENTS.md

Context recovery 순서: `AGENTS.md` → `RoverCarrot/AGENTS.md` → `RoverCarrot/docs/milestones/README.md` → active milestone → `IMPLEMENTATION_PLAN.md`의 현재 위치(handoff: State·Next role)와 How to use this plan(agent workflow) → 현재 Step → 관련 analysis/source

이 파일은 진입점일 뿐이며 source of truth는 위 문서들이다.

## Codex 위임

사용자가 "codex한테 시켜"라고 하면 다음 절차를 따른다.

1. 시작 전 상태 확인
   - 현재 branch와 working tree 상태(`git status`)를 먼저 확인한다.
   - 기존 미커밋 변경이 있으면 임의로 포함하거나 덮어쓰지 말고 먼저 사용자에게 보고한다.
2. 실행
   - 현재 저장소 루트에서 다음 형식으로 실행한다:
     `codex exec --sandbox workspace-write -c approval_policy=never "<지시>"`
   - 같은 Codex 위임 작업을 바로 이어서 지시하는 경우에만 `codex exec resume --last "<지시>"`를 사용한다.
   - 다른 Codex 실행이 중간에 있었거나 같은 작업인지 확실하지 않으면 `--last`를 사용하지 말고 새 exec를 시작한다.
   - Codex는 작업에 필요한 파일 수정과 자체 검증만 수행한다. git commit, push, rebase, reset, clean 등 Git 이력이나 원격 상태를 변경하는 작업은 맡기지 않는다.
3. 완료 대기
   - `codex exec`는 장시간 실행될 수 있으므로 foreground Bash timeout에 의존하지 않는다. 필요하면 background task로 실행하고 종료 상태와 결과를 확인할 때까지 기다린다.
   - Codex가 완전히 종료되기 전에는 diff 검토, stage, commit, push를 시작하지 않는다.
   - 실행이 중단되거나 종료 여부가 불명확하면 완료로 간주하지 말고 사용자에게 보고한다.
4. Claude의 직접 검토
   - `git status`, `git diff --check`, `git diff`를 직접 확인한다.
   - 작업 성격에 맞는 저장소 검증 명령도 직접 실행한다. RoverCarrot은 `RoverCarrot/package.json`의 `test`, `check`, `smoke`, `typecheck`, `lint`, `build`, `check:boundaries`, `validate:detect` 스크립트를 기준으로 한다.
   - Codex의 최종 설명을 그대로 신뢰하지 말고 실제 working tree, diff, 테스트 결과를 기준으로 검토한다.
5. commit & push
   - 변경이 사용자 지시와 저장소 규칙에 부합하고 검증도 통과했을 때만 Claude가 필요한 파일만 stage해서 commit & push한다.
   - 예상하지 못한 변경, 테스트 실패, 저장소 규칙 위반, Codex 실행 실패/중단, 사용자 판단이 필요한 문제가 있으면 commit/push하지 말고 사용자에게 보고한다.
