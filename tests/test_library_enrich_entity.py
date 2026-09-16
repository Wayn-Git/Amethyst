from backend.library.enrich import parse_enrichment, Enrichment

def test_parse_enrichment_extracts_structured_entity():
    raw_json = '''{
        "category": "movie",
        "summary": "A horror-comedy film where a creature preys on people who show anxiety.",
        "tags": ["cinema", "comedy"],
        "entity": {
            "title": "Remain Calm",
            "subtitle": "Jake Lewis · Horror Comedy",
            "rating": "10.0/10 TMDB",
            "synopsis": "A creature forces victims to smile to survive.",
            "actions": [
                {"label": "Watch trailer", "url": "https://youtube.com/watch?v=123", "kind": "trailer"},
                {"label": "Open details", "url": "https://themoviedb.org/movie/456", "kind": "details"}
            ],
            "attributes": {
                "Genre": "Horror Comedy",
                "Rating": "10.0/10 TMDB",
                "Cast": "Pauly Shore, Doug Jones",
                "Creator": "Jake Lewis",
                "Runtime": "13 min",
                "Released": "13 Oct 2026"
            }
        },
        "resources": []
    }'''
    res = parse_enrichment(raw_json)
    assert res is not None
    assert hasattr(res, "entity")
    assert res.entity is not None
    assert res.entity["title"] == "Remain Calm"
    assert res.entity["subtitle"] == "Jake Lewis · Horror Comedy"
    assert res.entity["attributes"]["Cast"] == "Pauly Shore, Doug Jones"
    assert len(res.entity["actions"]) == 2
