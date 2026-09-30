"""Entry point usable from any working directory:

    tools/gen/.venv/Scripts/python tools/gen/run.py [--suite S ...] [--list] [--clean]
"""

import runpy
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.argv[0] = "truedxf_gen"
runpy.run_module("truedxf_gen", run_name="__main__", alter_sys=True)
