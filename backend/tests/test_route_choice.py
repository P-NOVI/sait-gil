from core.route_choice import RouteKind, RouteOption, ScoredRoute, choose_routes

MARGIN = 10.0


def choose(*routes: ScoredRoute) -> list[RouteOption]:
    return choose_routes(routes, congestion_margin=MARGIN, slope_margin=MARGIN)


def test_three_different_routes_in_order() -> None:
    options = choose(
        ScoredRoute(500, congestion_score=100, slope_score=100),
        ScoredRoute(600, congestion_score=50, slope_score=200),
        ScoredRoute(700, congestion_score=300, slope_score=0),
    )

    assert options == [
        RouteOption(0, (RouteKind.RECOMMENDED,)),
        RouteOption(1, (RouteKind.LESS_CROWDED,)),
        RouteOption(2, (RouteKind.GENTLE,)),
    ]


def test_recommended_wins_when_candidates_are_not_better_by_margin() -> None:
    options = choose(
        ScoredRoute(500, congestion_score=100, slope_score=100),
        ScoredRoute(600, congestion_score=95, slope_score=90),
    )

    assert options == [
        RouteOption(
            0, (RouteKind.RECOMMENDED, RouteKind.LESS_CROWDED, RouteKind.GENTLE)
        )
    ]


def test_one_candidate_can_be_both_less_crowded_and_gentle() -> None:
    options = choose(
        ScoredRoute(500, congestion_score=100, slope_score=100),
        ScoredRoute(600, congestion_score=0, slope_score=0),
    )

    assert options == [
        RouteOption(0, (RouteKind.RECOMMENDED,)),
        RouteOption(1, (RouteKind.LESS_CROWDED, RouteKind.GENTLE)),
    ]


def test_tie_prefers_shorter_candidate() -> None:
    options = choose(
        ScoredRoute(500, congestion_score=100, slope_score=0),
        ScoredRoute(800, congestion_score=0, slope_score=0),
        ScoredRoute(600, congestion_score=0, slope_score=0),
    )

    assert options[1] == RouteOption(2, (RouteKind.LESS_CROWDED,))


def test_only_recommended_route() -> None:
    options = choose(ScoredRoute(500, congestion_score=100, slope_score=100))

    assert options == [
        RouteOption(
            0, (RouteKind.RECOMMENDED, RouteKind.LESS_CROWDED, RouteKind.GENTLE)
        )
    ]


def test_no_routes() -> None:
    assert choose() == []
