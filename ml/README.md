# ml

YOLO26n 인파 탐지 파인튜닝·LiteRT(`.tflite`) 변환과 LightGBM 혼잡 예측 코드를 둔다.

- 학습 데이터와 가중치(`*.pt`, 변환 중간 파일 `*.onnx`, 배포용 `*.tflite`)는 커밋하지 않는다.
- 배포용 `.tflite`는 Android 앱 assets(`frontend/android/app/src/main/assets/models/`)에 넣어 앱과 함께 배포한다. 앱 빌드 전에 이 폴더로 복사한다.
  - 파일 이름은 `sidewalk_yolo26n.tflite` 다(`DetectorConfig.modelAsset`). 학습 노트북이 내보낸 `weights/best.tflite` 를 이 이름으로 바꿔 넣는다.
  - 앱은 입력 (1,3,640,640) float32, 출력 (1,12,8400) float32 인 모델만 쓴다(`format="litert"`, `nms` 없이 내보낸 YOLO26n g8v2). 모양이 다르거나 파일이 없으면 인식 없이 카메라만 켠다.
    - Ultralytics 8.4.211 에서 `nms=False` 를 주면 end2end 출력 (1,300,6) 이 되므로 `nms` 는 아예 주지 않는다.
  - 경량화 비교(#128): 디버그 빌드는 아래 파일이 있으면 개발용 미리보기를 길게 눌러 차례로 바꿔 쓴다(`DetectorConfig.compareModels`). 고른 모델은 기억하고, 로그 `추론 측정` 줄에 모델 이름·기기·단계별 시간·fps·배터리 온도를 남긴다. 릴리스 빌드는 `sidewalk_yolo26n.tflite` 하나만 쓴다.

    | 이름 | 파일 | 내보내기 |
    |---|---|---|
    | fp32 | `sidewalk_yolo26n.tflite` | `format="litert"` |
    | fp16 | `sidewalk_yolo26n_fp16.tflite` | fp32 모델의 가중치만 float16 으로 바꾼 것 |
    | int8 | `sidewalk_yolo26n_int8.tflite` | `format="litert", quantize=8, data=<보정용 yaml>` (정적 INT8, 입출력·검출 머리는 float) |

    측정 결과(2026-11-24): mAP 는 PC 에서 val 에서 뽑은 평가 이미지 1,735장으로, 속도는 SM-G991N(Galaxy S21) CPU 4스레드로 실제 보행 안내 중에 쟀다.

    | 이름 | 크기 | mAP50 | mAP50-95 | 추론 평균 | fps |
    |---|---|---|---|---|---|
    | fp32 | 9.9MB | 0.662 | 0.440 | 163ms | 5.7 |
    | fp16 | 5.2MB | 0.662 | 0.440 | 157ms | 5.9 |
    | int8 | 3.0MB | 0.648 | 0.420 | 58ms | 14.2 |

    - 전처리 약 9ms, 후처리 약 1ms 는 세 모델이 같다. 모델을 바꾼 직후 1분도 값이 튀지 않아 구간 전체 평균을 썼다.
    - int8(160초)→fp16(292초)→fp32(144초) 순서로 한 번씩만 남아 시간에 따른 변화를 상쇄하지 못했다. 그래서 fp16 과 fp32 의 차이(6ms)는 속도 차이로 보지 않는다.
    - PC(x86) CPU 에서는 int8 이 fp32 보다 느렸다(45ms, 30ms).
- 학습 영상은 공개 허용 데이터나 동의받은 촬영분만 쓰고, 얼굴 등은 비식별 처리한다.

## 유동인구 예측 (`foot_traffic/`)

배리어프리 `ml/foot_traffic`을 그대로 가져왔다. 서비스 모델은 다시 학습하지 않고 배리어프리에서 학습한 것을 쓴다.

```bash
cd ml
uv sync
uv run python -m foot_traffic.storage download --dest <폴더>   # 이력·날씨·달력·모델 받기
uv run python -m foot_traffic.daily                           # 오늘·내일·모레 예측 → 수집 DB
uv run pytest
```

- 이력·날씨·달력·모델 파일은 Neon Object storage 버킷(`config.yaml`의 `storage`)에 둔다. 접속 정보는 `ml/.env`(`.env.example` 참고)와 저장소 Secrets에 넣는다.
- 매일 배치는 `.github/workflows/forecast-daily.yml`이 S-DoT 수집 뒤에 돌린다.
- 달력(`interim/calendar/daily.parquet`)은 2026년 12월까지 있다. 그 뒤를 예측하려면 배리어프리 12단계로 달력을 늘려 다시 올린다.
