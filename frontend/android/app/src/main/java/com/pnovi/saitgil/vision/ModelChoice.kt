package com.pnovi.saitgil.vision

// 디버그 빌드에서 비교할 모델 고르기(#128). Android 클래스를 쓰지 않아 단위 테스트로 본다.
// available 은 assets 에 실제로 있는 모델 경로다.

/** current 다음 차례의 있는 모델. 끝이면 처음으로 돌아간다. 있는 모델이 없으면 null */
fun nextModel(models: List<DetectorModel>, available: Set<String>, current: String): DetectorModel? {
    val present = models.filter { it.asset in available }
    if (present.isEmpty()) return null
    val index = present.indexOfFirst { it.asset == current }
    return present[(index + 1) % present.size]
}

/** 저장해 둔 모델이 아직 있으면 그것, 없으면(파일을 뺐거나 처음) 기본 모델 */
fun savedModelOrDefault(saved: String?, available: Set<String>, default: String): String =
    saved?.takeIf { it in available } ?: default

/** 로그·안내에 쓸 모델 이름. 비교 목록에 없으면 파일 경로 그대로다 */
fun modelLabel(models: List<DetectorModel>, asset: String): String =
    models.firstOrNull { it.asset == asset }?.label ?: asset
