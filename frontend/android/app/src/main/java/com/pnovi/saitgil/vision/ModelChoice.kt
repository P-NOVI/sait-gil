package com.pnovi.saitgil.vision

// 로그에 쓸 모델 이름(#128). Android 클래스를 쓰지 않아 단위 테스트로 본다.

/** 로그·안내에 쓸 모델 이름. 비교 목록에 없으면 파일 경로 그대로다 */
fun modelLabel(models: List<DetectorModel>, asset: String): String =
    models.firstOrNull { it.asset == asset }?.label ?: asset
