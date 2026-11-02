import time
from backend.dashboard.connectors import state, failed, reconcile
from backend.db.connection import transaction

def test_circuit_recovery_on_force():
    toolkit = "gmail"
    failed(toolkit, RuntimeError("timeout"))
    current = state(toolkit)
    assert current["failures"] > 0
    # Reconcile with forced reset clears failure count
    reconciled = reconcile(toolkit, {"id": "ca_test"}, force_reset=True)
    assert reconciled["failures"] == 0
    assert reconciled["retry_at"] == 0
