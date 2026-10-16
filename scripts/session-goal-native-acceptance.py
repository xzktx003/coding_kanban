#!/usr/bin/env python3
"""Explicit, private no-auth Goal compatibility checks against a real native CLI."""
import argparse
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tempfile


def scenario_status(result, exit_code):
    """A false native CAS assertion remains red, including on known versions."""
    return "passed" if exit_code == 0 and result.get("passed") is True else "failed"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--codex", help="Explicit absolute executable; never searches PATH or default CLI IPC")
    parser.add_argument("--output-dir", required=True, help="Artifact parent; each run creates a fresh private child directory")
    parser.add_argument("--scenario", choices=["metadata", "active", "runtime-clear", "cas", "all"], default="all")
    parser.add_argument("--skip-missing-cli", action="store_true", help="An unavailable explicit CLI is SKIPPED instead of an input error")
    args = parser.parse_args()
    if args.codex and not Path(args.codex).is_absolute():
        parser.error("--codex must be an absolute executable path")

    output = Path(args.output_dir).expanduser().resolve()
    try:
        output.mkdir(parents=True, exist_ok=True)
    except OSError as error:
        parser.error("Cannot create --output-dir: " + str(error))
    base = Path(tempfile.mkdtemp(prefix="goal-native-", dir=output))
    base.chmod(0o700)
    summary = {"status": "failed", "passed": False, "artifactDirectory": str(base), "scenarios": {}}

    def finish(status, code, reason=None):
        summary["status"] = status
        summary["passed"] = status == "passed"
        if reason:
            summary["reason"] = reason
        (base / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
        print(json.dumps(summary))
        return code

    if not args.codex:
        return finish("skipped", 0, "No --codex supplied; native acceptance was not run")
    binary = Path(args.codex).resolve()
    if not binary.is_file() or not os.access(binary, os.X_OK):
        return finish("skipped" if args.skip_missing_cli else "failed", 0 if args.skip_missing_cli else 2,
                      "Explicit native CLI is missing or not executable")
    summary["binary"] = str(binary)
    if sys.platform != "linux" or platform.machine() != "x86_64":
        return finish("failed", 2, "This network-isolated fixture requires Linux x86_64; there is no unfiltered fallback")
    if not shutil.which("strace"):
        return finish("failed", 2, "strace is required for the native network audit")

    fixtures = Path(__file__).resolve().parent / "fixtures" / "session-goal-native"
    repo = Path(__file__).resolve().parent.parent
    scenarios = ["metadata", "active", "runtime-clear", "cas"] if args.scenario == "all" else [args.scenario]
    if "runtime-clear" in scenarios:
        if not shutil.which("node") or not (repo / "packages/session-runtime/node_modules/tsx/dist/loader.mjs").is_file():
            return finish("failed", 2, "runtime-clear requires Node and this checkout's locked pnpm dependencies")

    for scenario in scenarios:
        directory = base / scenario
        directory.mkdir(mode=0o700)
        script = {"metadata": "metadata.py", "active": "active.py", "runtime-clear": "runtime_clear.py", "cas": "active.py"}[scenario]
        command = [sys.executable, "-B", str(fixtures / script), "--cli", str(binary), "--output-dir", str(directory)]
        if scenario in ("active", "cas"):
            command += ["--scenario", "full" if scenario == "active" else "cas"]
        with (directory / "stdout.log").open("w") as stdout, (directory / "stderr.log").open("w") as stderr:
            completed = subprocess.run(command, cwd=repo, stdout=stdout, stderr=stderr, check=False)
        artifacts = list(directory.glob("*/result.json"))
        result = {}
        if len(artifacts) == 1:
            try:
                result = json.loads(artifacts[0].read_text())
            except (OSError, ValueError):
                pass
        summary["scenarios"][scenario] = {
            "status": scenario_status(result, completed.returncode),
            "passed": result.get("passed") is True and completed.returncode == 0,
            "exitCode": completed.returncode,
            "artifactDirectory": str(artifacts[0].parent) if len(artifacts) == 1 else str(directory),
        }
    passed = all(value["status"] == "passed" for value in summary["scenarios"].values())
    return finish("passed" if passed else "failed", 0 if passed else 1)


if __name__ == "__main__":
    raise SystemExit(main())
