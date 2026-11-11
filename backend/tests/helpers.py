from core.geo import LngLat

# 위도 0.001도는 약 111m 다.
LAT_STEP_M = 111.19


def tmap_response(
    vertices: list[LngLat],
    turn_types: list[int],
    facility_types: list[int] | None = None,
    total_time_s: int = 0,
) -> dict:
    """꼭짓점마다 안내점(turnType), 꼭짓점 사이마다 구간(facilityType)을 둔 응답."""
    features: list[dict] = []
    last = len(vertices) - 1
    for i, vertex in enumerate(vertices):
        properties: dict = {
            "index": len(features),
            "turnType": turn_types[i],
            "pointType": "SP" if i == 0 else "EP" if i == last else "GP",
            "description": "",
        }
        if i == 0:
            properties["totalTime"] = total_time_s
        features.append(_feature("Point", list(vertex), properties))
        if i < last:
            facility = facility_types[i] if facility_types else 11
            features.append(
                _feature(
                    "LineString",
                    [list(vertex), list(vertices[i + 1])],
                    {"index": len(features), "facilityType": str(facility)},
                )
            )
    return {"type": "FeatureCollection", "features": features}


def _feature(kind: str, coordinates: list, properties: dict) -> dict:
    return {
        "type": "Feature",
        "geometry": {"type": kind, "coordinates": coordinates},
        "properties": properties,
    }
