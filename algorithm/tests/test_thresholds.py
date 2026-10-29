import json
from decimal import Decimal

from algorithm.algo.thresholds import (
    DEFAULT_THRESHOLDS,
    THRESHOLD_VERSION,
    ThresholdConfig,
    export_thresholds,
)


def test_export_thresholds_covers_every_field():
    data = json.loads(export_thresholds())
    assert set(data) == set(ThresholdConfig.model_fields)
    assert data["version"] == THRESHOLD_VERSION
    assert data["counterparty_hhi"] is None


def test_export_thresholds_round_trips():
    exported = export_thresholds()
    assert ThresholdConfig.model_validate_json(exported) == DEFAULT_THRESHOLDS


def test_export_thresholds_custom_config():
    config = ThresholdConfig(version=7, dti_high=Decimal("0.6"))
    data = json.loads(export_thresholds(config))
    assert data["version"] == 7
    assert data["dti_high"] == "0.6"
