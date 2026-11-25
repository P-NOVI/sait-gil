# Android 연결·권한 확인

## 서버 주소와 빌드

`frontend/`에서 `.env.android.example`을 `.env.android`로 복사한다.
`VITE_API_BASE_URL`에 배포된 HTTPS API 주소를 넣는다. 현재 주소는
`https://sait-gil-api.onrender.com`이며 끝에 `/api`를 붙이지 않는다.
이 파일은 커밋하지 않는다.

```bash
npm ci
npm run cap:sync
npm run cap:android
```

`cap:sync`는 Android 모드로 빌드하여 API 주소가 없거나 HTTP 주소이면 실패한다.
환경변수는 빌드 때 정해지므로 바꾼 뒤에는 다시 sync·APK 빌드·설치를 해야 한다.
일반 웹 배포는 기존 `npm run build`를 쓰며 같은 도메인의 `/api`를 사용한다.

## CORS

앱의 Origin은 `https://localhost`다. API 주소를 바꿔도 앱 Origin은 그대로다.
백엔드 기본값(`backend/app/config.py`)은 이 Origin과 iOS의 `capacitor://localhost`만 허용한다.
웹은 `/api`를 같은 주소로 넘겨 받아 CORS가 필요 없다.

Render 대시보드에 `ALLOWED_ORIGINS`를 별도로 설정했다면 그 값이 기본 목록을
덮어쓴다. 따로 둘 이유가 없으면 지우고, 둔다면 아래처럼 앱 Origin을 포함한 JSON 목록으로 설정하고 재배포한다.

```json
["https://localhost", "capacitor://localhost"]
```

네트워크 오류를 확인할 때는 휴대폰을 USB로 연결하고 Chrome의
`chrome://inspect/#devices`에서 WebView를 검사한다. 요청 주소가
`https://localhost/api/...`라면 API 주소를 넣고 다시 빌드해야 한다.
배포 API의 OPTIONS 응답이 400이고 `Access-Control-Allow-Origin`이 없다면 CORS 설정을 확인한다.

## 권한과 현재 구현 범위

| 기능   | Manifest                                     | 런타임 요청·현재 상태                                                                                                                                                                                                             |
| ------ | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 인터넷 | INTERNET                                     | 별도 사용자 허용 없이 HTTPS 요청                                                                                                                                                                                                  |
| 위치   | ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION | Geolocation 플러그인이 요청. 대략적 위치만 허용해도 위치를 받는다. 이때는 이탈·도착 판정을 보류하므로 안내 중 정확한 위치를 켜라고 한 번 읽고 화면에도 표시한다. 설정에서 켜고 앱으로 돌아오면 다시 확인해 정확한 위치로 추적한다 |
| 마이크 | RECORD_AUDIO                                 | 음성 검색 시 SpeechRecognition 플러그인이 요청. 거절하면 음성 인식 실패 안내와 글자 입력 제공                                                                                                                                     |
| 카메라 | CAMERA                                       | 선언만 있음. SaitgilVision은 뼈대이며 카메라 권한 요청·CameraX·LiteRT 추론은 후속 구현                                                                                                                                            |
| 진동   | VIBRATE                                      | 별도 사용자 권한 대화상자 없음                                                                                                                                                                                                    |

## 폰에서 확인할 순서

1. 새 APK를 설치하고 인터넷이 되는 상태에서 실행한다.
2. 위치를 허용하고 목적지 검색이 되는지 확인한다. 대략적인 위치 허용과 권한 거절도 각각 확인한다. 대략적인 위치로 안내를 시작하면 정확한 위치를 켜라는 안내가 나오고, 설정에서 켜고 돌아오면 안내가 이어지는지 확인한다.
3. 음성 검색 버튼을 눌러 마이크를 허용한 뒤 장소 확인·경로 선택·안내 시작까지 진행한다.
4. 마이크를 거절해도 글자로 검색하고 경로를 선택할 수 있는지 확인한다.
5. 안내 중 위치 갱신·음성·진동·안내 종료를 확인한다. 카메라 실제 인식은 아직 검증 대상이 아니다.

코드 검사·mock 테스트와 배포 API의 CORS 확인만으로 실제 폰 동작을 보증하지 않는다.
