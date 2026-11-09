"""特征衍生包：算子库 + 两种作者形态 + 内置特征。

对外只用三样东西：compute()（算特征）、FeatureDef（写定义）、describe()（看算子目录）。
"""
from __future__ import annotations

from .defs import BUILTIN_FEATURES, FeatureDef, FeatureDefError, compute
from .operators import Frame, OperatorError, UnknownColumn, UnknownOperator, describe, families

__all__ = [
    "BUILTIN_FEATURES",
    "FeatureDef",
    "FeatureDefError",
    "Frame",
    "OperatorError",
    "UnknownColumn",
    "UnknownOperator",
    "compute",
    "describe",
    "families",
]
