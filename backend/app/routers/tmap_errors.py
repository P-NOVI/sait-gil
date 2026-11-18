"""Tmap 오류를 사용자에게 보일 문장의 HTTP 오류로 바꾼다.

Tmap 원문("Tmap 연결 실패: ConnectTimeout" 등)은 앱이 화면과 음성으로
그대로 내보내므로 응답에 넣지 않고 로그에만 남긴다.
"""

import logging

from fastapi import HTTPException, status

from app.services.tmap_client import TmapError

logger = logging.getLogger(__name__)

TMAP_DOWN = "지도 서비스에 연결하지 못했습니다. 잠시 뒤 다시 시도하세요."

# 앱 키·요청 한도 문제는 사용자 입력 탓이 아니라 Tmap 쪽 문제로 본다.
_SERVICE_ERRORS = (401, 403, 429)


def tmap_http_error(error: TmapError, bad_request: str | None = None) -> HTTPException:
    """요청 값 문제(4xx)는 bad_request 문장의 400 으로, 그 밖은 502 로 알린다.

    bad_request 가 없으면 모두 502 로 알린다.
    """
    logger.warning("Tmap 오류 %s: %s", error.status_code, error.message)
    is_bad_request = (
        400 <= error.status_code < 500 and error.status_code not in _SERVICE_ERRORS
    )
    if bad_request and is_bad_request:
        return HTTPException(status.HTTP_400_BAD_REQUEST, bad_request)
    return HTTPException(status.HTTP_502_BAD_GATEWAY, TMAP_DOWN)
