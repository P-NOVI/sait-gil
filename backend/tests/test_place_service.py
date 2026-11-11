from app.services.place_service import Address, Place, parse_address, parse_places


def poi(**fields: object) -> dict:
    base = {
        "name": "광화문",
        "pnsLon": "",
        "pnsLat": "",
        "frontLon": "126.9770",
        "frontLat": "37.5760",
        "noorLon": "126.9768",
        "noorLat": "37.5758",
        "upperAddrName": "서울",
        "middleAddrName": "종로구",
        "lowerAddrName": "세종로",
        "firstNo": "1",
        "secondNo": "0",
        "radius": "1.25",
    }
    return {**base, **fields}


def response(*pois: dict) -> dict:
    return {"searchPoiInfo": {"pois": {"poi": list(pois)}}}


def test_parse_places_prefers_pedestrian_entrance() -> None:
    places = parse_places(response(poi(pnsLon="126.9772", pnsLat="37.5762")))

    assert places == [
        Place(
            name="광화문",
            address="서울 종로구 세종로 1",
            position=(126.9772, 37.5762),
            distance_m=1250.0,
        )
    ]


def test_parse_places_falls_back_to_front_and_road_address() -> None:
    road = {"newAddress": [{"fullAddressRoad": "서울 종로구 세종대로 172"}]}

    place = parse_places(
        response(poi(pnsLon="0.0", pnsLat="0.0", newAddressList=road))
    )[0]

    assert place.position == (126.977, 37.576)
    assert place.address == "서울 종로구 세종대로 172"


def test_parse_places_lot_number_with_sub_number() -> None:
    place = parse_places(response(poi(firstNo="40", secondNo="3")))[0]

    assert place.address == "서울 종로구 세종로 40-3"


def test_parse_places_skips_places_without_position() -> None:
    no_position = poi(frontLon="", frontLat="", noorLon="0", noorLat="0")

    assert parse_places(response(no_position)) == []
    assert parse_places({}) == []


def test_parse_address_takes_road_address_from_last_part() -> None:
    full = (
        "서울특별시 중구 소공동,서울특별시 중구 정동 5-5,서울특별시 중구 세종대로 101"
    )
    info = {"fullAddress": full, "roadName": "세종대로", "buildingName": "시청역"}

    assert parse_address({"addressInfo": info}) == Address(
        full_address=full,
        road_address="서울특별시 중구 세종대로 101",
        road_name="세종대로",
        building_name="시청역",
    )


def test_parse_address_single_part_and_missing() -> None:
    address = parse_address({"addressInfo": {"fullAddress": " 서울 중구 을지로 65 "}})

    assert address is not None
    assert address.road_address == "서울 중구 을지로 65"
    assert parse_address({}) is None
