#!/usr/bin/env python3
"""Run verdify-campaign-ci unchanged, optionally on one shard of its selection.

usage: campaign_shard.py /usr/local/bin/verdify-campaign-ci
CAMPAIGN_SHARD=i/n keeps every n-th file (from i, 1-based) of the tool's sorted
selection; unset or empty runs the tool's full selection exactly as before.
"""

import importlib.machinery
import importlib.util
import os
import sys
from pathlib import Path

tool = sys.argv[1]
loader = importlib.machinery.SourceFileLoader("verdify_campaign_ci", tool)
spec = importlib.util.spec_from_loader(loader.name, loader)
module = importlib.util.module_from_spec(spec)
loader.exec_module(module)

# "ci / campaign" aggregates these shards (CI audit 2026-11-16), so the tool's
# selection must hold every dashboard-db file. A tools image that predates the
# dashboard glob would silently run the legacy set; refuse it.
dashboard_db = {str(path) for path in Path("tests").glob("test_dashboard_db_*.py")}
selected_files, _missing = module.selection()
absent = sorted(dashboard_db - set(selected_files))
if not dashboard_db or absent:
    raise SystemExit(
        "campaign selection lacks dashboard-db files (move the agents-ci-tools digest): " + ", ".join(absent)
    )

shard = os.environ.get("CAMPAIGN_SHARD", "")
if shard:
    index, count = (int(part) for part in shard.split("/"))
    if not 1 <= index <= count:
        raise SystemExit(f"invalid CAMPAIGN_SHARD={shard}")
    full_selection = module.selection

    def selection(select=None):
        selected, missing = full_selection(select)
        kept = selected[index - 1 :: count]
        print(f"campaign shard {index}/{count}: {len(kept)} of {len(selected)} files: " + ", ".join(kept), flush=True)
        if not kept:
            raise ValueError(f"campaign shard {shard} selected no files")
        return kept, missing

    module.selection = selection

raise SystemExit(module.main())
