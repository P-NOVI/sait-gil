# sait-gil

축제·역 출구처럼 인파가 몰리는 곳에서 시각장애인이 사람 사이를 안전하게 걷도록 돕는 음성 보행 안내 앱이다. PWA로 개발하고 Capacitor로 묶어 Android(이후 iOS) 앱으로 배포한다.

## 폴더 구성

| 폴더 | 내용 |
| --- | --- |
| `frontend/` | React 19 · Vite · TypeScript PWA (화면, 음성·길안내, 알림 중재) |
| `frontend/src/platform/` | 음성 입출력·진동·화면 유지 등 기기 기능 (웹은 Web API, 앱은 Capacitor 플러그인) |
| `frontend/android/` | Capacitor Android 프로젝트. YOLO26n 비전은 여기서 Kotlin 플러그인(CameraX · LiteRT)으로 돌린다 |
| `backend/` | FastAPI · Python 3.12 (Tmap 프록시, 혼잡도, 행사, 사용자 API) |
| `backend/app/services/` | Tmap·서울시·기상청 호출과 `core` 계산을 엮는 서비스 |
| `backend/core/` | 외부 API·DB 없는 순수 계산 (경로 선 위 점 찍기, DEM 경사, S-DoT 혼잡 매칭, 후보 경로 점수) |
| `ml/` | YOLO26n 인파 파인튜닝·LiteRT(`.tflite`) 변환, 혼잡 예측 |
| `pipeline/` | DEM 생성, S-DoT 센서 위치, 인구·학습 데이터 전처리 |
| `data/` | `pipeline/`이 만드는 데이터 (커밋하지 않음). 백엔드는 `data/processed/`를 읽는다 |
| `.github/` | 이슈·PR 템플릿, Action, 수집·예측 배치 워크플로 |

## 경로 결정 방식

경로는 Tmap 보행자 경로를 후보로 받아 우리가 점수를 매겨 고른다. 자체 도로망 그래프로 경로를 계산하지 않는다.

1. Tmap에 검색 옵션·경유지를 바꿔 후보 경로를 여러 개 요청한다.
2. 후보마다 경로 선 위에 일정 간격으로 점을 찍는다.
3. 각 점에서 DEM 고도를 읽어 경사를, 주변 S-DoT 센서로 혼잡도를 구한다.
4. 거리·경사·혼잡 점수로 후보를 고르고, 회전·횡단보도 안내는 고른 경로의 Tmap 응답을 쓴다.

- 점 간격, 센서 반경, 점수 가중치는 코드에 직접 쓰지 않고 설정으로 둔다.
- 대상은 시각장애인 하나다. 사용자 유형별 프로필이나 사용자별 경로 옵션을 만들지 않고, 점수 가중치는 한 벌만 쓴다.
- 접근성 설정(글자 크기, 음성 속도, 진동 세기, 인파 알림 민감도)은 안내 방식만 바꾸고 경로에는 영향을 주지 않는다. 기기 안에 저장한다.
- Tmap 경로 호출은 Free 기준 하루 1,000건이다. 후보 수와 재탐색 간격을 정할 때 이 한도를 고려한다.

### 미리 알림

- 고른 경로의 Tmap 응답에서 회전·횡단보도·계단 지점을, 경로 점수에서 혼잡 구간 시작 지점을 뽑아 경로 위 이벤트 목록으로 만든다.
- 길안내 엔진은 GPS로 경로 위 진행 거리를 구하고, 이벤트까지 남은 거리가 알림 거리 안에 들어오면 알림 중재로 보낸다. 예: "20미터 앞에서 오른쪽입니다", "300미터 앞부터 붐비는 구간입니다".
- 같은 이벤트는 한 번만 알린다. 알림 우선순위는 알림 중재 규칙(위험 > 경로 > 혼잡)을 따른다.
- 이벤트 종류별 알림 거리는 코드에 직접 쓰지 않고 설정값으로 둔다.

## 명령어

백엔드 (`backend/`, uv 사용)

```bash
uv sync
uv run fastapi dev app/main.py
uv run ruff check . && uv run ruff format --check .
uv run pytest
```

프론트엔드 (`frontend/`, npm 사용)

```bash
npm install
npm run dev
npm run lint && npm run format:check
npm test
npm run build
```

앱 (`frontend/`, Android Studio 필요)

```bash
npm run cap:sync
npm run cap:android
```

- 각 폴더의 `.env.example`을 복사해 `.env`를 만든다.
- 기기 기능(음성 입출력, 진동, 화면 유지, 위치 등)은 화면 코드에서 Web API를 직접 부르지 않고 `src/platform/`을 통해서만 쓴다.
- API 호출은 상대 경로 대신 `apiUrl()`을 쓴다. 앱에서는 주소가 `https://localhost`라 상대 경로가 백엔드로 가지 않는다.
- 카메라 영상은 기기 밖으로 보내지 않는다. Kotlin 비전 플러그인은 추론 결과(사람 박스 등)만 웹 쪽으로 넘긴다.
- 마일스톤마다 실제 Android 기기에서 앱으로 한 번씩 확인한다.
- 테스트는 외부 API를 실제로 호출하지 않고 mock을 쓴다.

## 코드 스타일

- 주석, 문서, 커밋, PR, 이슈는 한국어로 쓴다. 변수·함수·파일 이름은 영어로 쓴다.
- Python은 ruff 설정을 따르고 타입 힌트를 단다. 포맷은 ruff format이 정한다.
- TypeScript는 strict 모드를 유지하고, 포맷은 Prettier가 정한다. `any`로 타입 오류를 덮지 않는다.
- 들여쓰기는 4칸이다. TypeScript는 Prettier(`.prettierrc`), Python은 ruff가 맞춘다.
- 린트가 통과하지 않는 코드는 커밋하지 않는다.

## 브랜치

```
main   ← 배포용 (직접 push 금지)
 └─ dev   ← 통합 (직접 push 금지)
     └─ 타입/이슈번호-설명   예: feat/12-login
```

- 작업 브랜치는 항상 `dev`에서 분기한다.
- 이름은 `타입/이슈번호-설명`이다. 설명은 영어 소문자이고 단어는 `-`로 잇는다.

## 커밋

형식: `<gitmoji> <type>: <내용>` 예: `✨ feat: 로그인 화면 추가`

| 타입 | 설명 | gitmoji |
| --- | --- | --- |
| feat | 새로운 기능 추가 | ✨ |
| fix | 버그 수정 | 🐛 |
| docs | 문서 수정 | 📝 |
| style | 코드 포맷 변경, 코드 변경 없음 | 🎨 |
| refactor | 프로덕션 코드 리팩터링 | ♻️ |
| test | 테스트 추가·리팩터링, 프로덕션 코드 변경 없음 | ✅ |
| chore | 빌드·패키지·설정 변경, 프로덕션 코드 변경 없음 | 🔧 |

## 이슈-PR 워크플로

1. 이슈를 먼저 만든다. 템플릿은 feat, fix, 문서·리팩터링·기타 3종이다. 제목 앞의 `[#번호]`는 Action이 붙인다.
2. 이슈는 기능 묶음 하나에 하나만 만든다(예: "로그인 기능 구현"). 화면·세부 기능은 이슈를 따로 만들지 않고 작업 목록에 적는다.
3. `dev`를 최신으로 받고 작업 브랜치를 만든다.
4. 작업 브랜치를 push하고 PR을 올린다. base는 `dev`, 본문에 `Closes #번호`를 쓴다. PR 제목 앞의 `[#번호]`는 Action이 붙인다.
5. 리뷰어 1명 이상이 승인하면 `dev`에 **Squash and merge** 한다. Action이 `Closes` 이슈를 닫는다.
6. `dev` → `main` 배포 PR은 **Create a merge commit**으로 머지한다. Squash는 쓰지 않는다.
7. 머지 후 작업 브랜치를 지우고 로컬 `dev`를 최신화한다.

- PR 하나에는 이슈 하나만 담는다.
- GitHub 기본 기능은 `main`으로 머지될 때만 이슈를 닫는다. `dev` 머지에서 닫히는 것은 `close-issue-on-dev-merge` Action 덕분이다.
- 이슈·PR 템플릿과 Action은 `.github/`에 있다.

## 환경변수

- `.env`와 키 파일의 내용은 출력하거나 커밋하지 않는다. `.gitignore`에 둔다.
- 새 환경변수를 추가하면 같은 폴더의 `.env.example`에 키 이름만 추가한다. 값은 비운다.
- `VITE_`로 시작하는 프론트 환경변수는 브라우저에 노출된다. 비밀 값을 넣지 않는다.
- 비밀 키(API 키, `DATABASE_URL`, `SECRET_KEY` 등)는 백엔드에서만 쓴다.
- 키·URL·경로·매직 넘버는 코드에 직접 쓰지 않고 설정이나 환경변수로 분리한다.

## 건드리지 않는 것

- `package-lock.json`, `uv.lock`은 직접 편집하지 않는다. 설치 명령으로만 바꾼다.
- `*.db` 파일은 커밋하지 않는다.
- `dev`에 머지된 DB 마이그레이션 파일은 고치지 않는다. 바꿀 내용은 새 마이그레이션으로 만든다.

## 외부 데이터 · API

- OpenStreetMap 기반 데이터를 쓰는 화면에는 `© OpenStreetMap contributors` 출처 표기를 유지한다.
