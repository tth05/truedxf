"""All suites: every module in this package is imported in sorted name order, so the registry
(and generation) order is stable and adding a suite needs no edit here."""

import importlib
import pkgutil

for _m in sorted(m.name for m in pkgutil.iter_modules(__path__)):
    if not _m.startswith("_"):
        importlib.import_module(f"{__name__}.{_m}")
