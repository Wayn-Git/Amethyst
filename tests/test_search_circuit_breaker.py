import pytest
from backend.web.circuit_breaker import SearchCircuitBreaker, ProviderStatus, get_circuit_breaker

def test_circuit_breaker_initially_healthy():
    cb = SearchCircuitBreaker()
    assert cb.is_available("langsearch")
    status = cb.get_status()
    assert "langsearch" in status
    assert status["langsearch"]["status"] == ProviderStatus.HEALTHY.value

def test_circuit_breaker_rate_limit_cooldown():
    cb = SearchCircuitBreaker()
    cb.record_failure("langsearch", status_code=429, error_msg="Rate limit exceeded")
    assert not cb.is_available("langsearch")
    status = cb.get_status()["langsearch"]
    assert status["status"] == ProviderStatus.RATE_LIMITED.value
    assert status["cooldown_seconds"] > 0

def test_circuit_breaker_credits_exhausted_cooldown():
    cb = SearchCircuitBreaker()
    cb.record_failure("exa", status_code=402, error_msg="Payment required")
    assert not cb.is_available("exa")
    status = cb.get_status()["exa"]
    assert status["status"] == ProviderStatus.CREDITS_EXHAUSTED.value
    assert status["cooldown_seconds"] >= 1700  # ~30 min cooldown

def test_circuit_breaker_auth_failed_disabled_until_reset():
    cb = SearchCircuitBreaker()
    cb.record_failure("firecrawl", status_code=401, error_msg="Unauthorized")
    assert not cb.is_available("firecrawl")
    assert cb.get_status()["firecrawl"]["status"] == ProviderStatus.AUTH_FAILED.value
    cb.reset("firecrawl")
    assert cb.is_available("firecrawl")
    assert cb.get_status()["firecrawl"]["status"] == ProviderStatus.HEALTHY.value

def test_circuit_breaker_success_clears_failures():
    cb = SearchCircuitBreaker()
    cb.record_failure("langsearch", status_code=500, error_msg="Server error")
    cb.record_success("langsearch")
    assert cb.is_available("langsearch")
    assert cb.get_status()["langsearch"]["consecutive_failures"] == 0

def test_global_singleton():
    cb1 = get_circuit_breaker()
    cb2 = get_circuit_breaker()
    assert cb1 is cb2
