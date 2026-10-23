# VS Code에서 main에 커밋·푸시하기

대상 저장소: https://github.com/crusade153/daily-marketing

VS Code에서 이 프로젝트 폴더를 열고, **터미널 → 새 터미널**에서 PowerShell을 사용합니다. 아래 명령은 한 줄씩 실행하고, 오류가 나면 다음 단계로 넘어가기 전에 해결합니다. Windows 실행 정책에 막히지 않도록 `npm.cmd`, `npx.cmd`로 적었습니다.

## 1. 작업을 시작하기 전에 최신 main 받기

```powershell
cd C:\Users\User\Desktop\sap_link\daily-market
git status
git switch main
git pull --ff-only origin main
```

`git status`에 커밋하지 않은 변경이 있으면 먼저 아래 2~4단계로 그 변경을 저장합니다. `pull`은 작업을 시작하기 전, 변경이 없는 상태에서 실행하는 습관을 들이면 좋습니다. `--ff-only` 오류가 나면 로컬과 GitHub 이력을 확인해야 합니다.

## 2. 수정한 내용을 확인하고 검증하기

파일을 수정한 다음 실행합니다. 이 폴더의 개발 서버가 실행 중이면 해당 터미널에서 `Ctrl+C`로 종료한 뒤 빌드합니다.

```powershell
git status --short
git diff --stat
npm.cmd test
npm.cmd run lint
npm.cmd run build
npx.cmd tsc --noEmit
```

`git diff`는 기존 파일의 실제 변경 내용을 보여줍니다. `??`로 표시되는 새 파일은 VS Code에서 열어 내용도 확인합니다.

## 3. 이번에 올릴 파일을 선택하고 커밋하기

아래 `git add`는 예시입니다. **이번에 수정한 파일 경로로 바꾸세요.** 여러 파일은 공백으로 나열하거나 `git add`를 여러 번 실행합니다. VS Code 왼쪽 소스 제어에서 파일 옆 **+**를 눌러 선택해도 같습니다.

```powershell
git add -- app/page.tsx components/nav.tsx
git diff --cached --stat
git diff --cached
git status --short
git commit -m "요약 화면 표시 수정"
```

`add`는 커밋할 파일 선택, `commit`은 내 컴퓨터에 변경 이력을 저장하는 단계입니다. 삭제한 파일도 해당 경로를 `git add -- 파일경로`로 지정하면 삭제 내역이 포함됩니다. 커밋 메시지는 이번 작업 내용에 맞게 바꿉니다.

`.env*`, `.data/`, `.claude/`, `.vercel/`, `node_modules/`, `.next/`, `progress.md`는 `.gitignore`로 제외되어 있습니다. 환경변수·인증키·실제 업무 데이터는 올리지 않습니다. `progress.md`는 내부 수치와 계정 정보를 포함하는 로컬 작업 메모로 유지합니다.

## 4. GitHub에 푸시하고 확인하기

```powershell
git push origin main
git status --short --branch
git log -1 --oneline
```

`push`가 GitHub로 커밋을 보내는 단계입니다. 상태에 `main...origin/main`만 표시되고 변경 파일이나 `ahead`가 없으면 로컬과 원격이 동기화된 상태입니다. GitHub 저장소의 `main`에서도 마지막 커밋을 확인할 수 있습니다.

`push`에서 `rejected` 또는 `fetch first`가 나오면 먼저 `git fetch origin`으로 원격을 확인합니다. 현재 변경을 모두 커밋했고 로컬의 미전송 커밋만 있다면 `git rebase origin/main` 후 테스트·lint·build를 다시 통과시키고 `git push origin main`을 실행합니다. 충돌이 나면 파일을 해결한 뒤 `git add -- 해결한파일`, `git rebase --continue` 순서입니다. 되돌아가려면 `git rebase --abort`를 사용합니다. 강제 푸시는 사용하지 않습니다.

## 이번에 한 최초 연결 설정 (2026-10-23)

빈 GitHub 저장소에 처음 연결하기 위해 로컬 `master`를 `main`으로 변경하고 `origin`을 등록했습니다. **이 설정은 완료 후 반복하지 않습니다.**

```powershell
git branch -m main
git remote add origin https://github.com/crusade153/daily-marketing.git
git push -u origin main
```

연결 상태는 다음 명령으로 확인합니다.

```powershell
git branch --show-current
git remote -v
git branch -vv
```
