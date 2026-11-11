# ml

YOLO26n 인파 탐지 파인튜닝·LiteRT(`.tflite`) 변환과 LightGBM 혼잡 예측 코드를 둔다.

- 학습 데이터와 가중치(`*.pt`, 변환 중간 파일 `*.onnx`, 배포용 `*.tflite`)는 커밋하지 않는다.
- 배포용 `.tflite`는 Android 앱 assets(`frontend/android/app/src/main/assets/models/`)에 넣어 앱과 함께 배포한다. 앱 빌드 전에 이 폴더로 복사한다.
- 학습 영상은 공개 허용 데이터나 동의받은 촬영분만 쓰고, 얼굴 등은 비식별 처리한다.
