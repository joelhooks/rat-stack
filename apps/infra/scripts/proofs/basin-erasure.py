# /// script
# requires-python = ">=3.14,<3.15"
# dependencies = ["pyiceberg[pyarrow]==0.12.0", "pyarrow==25.0.1"]
# ///
import argparse
import json
import logging
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

SCOPE_MESSAGE = (
    "R2 Data Catalog REST token requires Workers R2 Data Catalog Read and Write "
    "plus Workers R2 Storage Bucket Item Read and Write, scoped to the throwaway bucket."
)


class ProofInvariant(Exception):
    pass


def require(condition):
    if not condition:
        raise ProofInvariant()


def engine():
    import pyarrow as pa
    from pydantic import BaseModel, ConfigDict, Field, SecretStr
    from pyiceberg.catalog.rest import RestCatalog
    from pyiceberg.exceptions import ForbiddenError, NoSuchTableError, UnauthorizedError
    from pyiceberg.expressions import In
    from pyiceberg.schema import Schema
    from pyiceberg.types import NestedField, StringType

    class Input(BaseModel):
        model_config = ConfigDict(strict=True, extra="forbid")
        accountId: str = Field(pattern=r"^[a-f0-9]{32}$")
        runId: str = Field(pattern=r"^[a-f0-9]{32}$")
        bucket: str
        uri: str
        warehouse: str
        deadlineSeconds: int = Field(gt=0)
        pollSeconds: int = Field(gt=0)
        snapshotAgeSeconds: int = Field(gt=0)

    logging.disable(logging.CRITICAL)
    try:
        values = Input.model_validate_json(sys.stdin.read())
        require(values.bucket == f"rat-stack-erasure-proof-{values.runId}")
        require(values.uri == f"https://catalog.cloudflarestorage.com/{values.accountId}/{values.bucket}")
        require(values.warehouse == f"{values.accountId}_{values.bucket}")
        require(values.pollSeconds < values.deadlineSeconds)
        require(values.snapshotAgeSeconds < values.deadlineSeconds)
        token = SecretStr(os.environ["BASIN_PROOF_TOKEN"])
        catalog = RestCatalog(
            name="erasure_proof",
            warehouse=values.warehouse,
            uri=values.uri,
            token=token.get_secret_value(),
        )
        catalog.create_namespace_if_not_exists("default")
        identifier = ("default", "intake_raw")
        try:
            table = catalog.load_table(identifier)
        except NoSuchTableError:
            table = catalog.create_table(
                identifier,
                schema=Schema(NestedField(1, "value", StringType(), required=False)),
            )
        require(len(table.scan(limit=1).to_arrow()) == 0)
        require(table.schema() == Schema(NestedField(1, "value", StringType(), required=False)))
        target_rows = [
            json.dumps({"actor": "erase@example.test", "kind": "contact", "email": "erase@example.test"}, sort_keys=True),
            json.dumps({"actor": "erase@example.test", "kind": "statement", "result": "erase-me"}, sort_keys=True),
        ]
        survivor = json.dumps({"actor": "keep@example.test", "kind": "contact", "result": "keep-me"}, sort_keys=True)
        table.append(pa.table({"value": pa.array([*target_rows, survivor], type=pa.large_string())}))
        table.refresh()
        require(sorted(table.scan(limit=4).to_arrow().column("value").to_pylist()) == sorted([*target_rows, survivor]))
        original_files = {task.file.file_path for task in table.scan().plan_files()}
        old_snapshots = {snapshot.snapshot_id for snapshot in table.snapshots()}
        require(len(original_files) == 1 and len(old_snapshots) > 0)
        require(all(table.io.new_input(path).exists() for path in original_files))
        table.delete(In("value", target_rows))
        table.refresh()
        require(table.scan(limit=3).to_arrow().column("value").to_pylist() == [survivor])
        live_files = {task.file.file_path for task in table.scan().plan_files()}
        require(original_files.isdisjoint(live_files))
        require(all(table.io.new_input(path).exists() for path in original_files))
        maintenance = urllib.request.Request(
            f"https://api.cloudflare.com/client/v4/accounts/{values.accountId}/r2-catalog/{values.bucket}/maintenance-configs",
            data=json.dumps({"snapshot_expiration": {"state": "enabled", "max_snapshot_age": f"{values.snapshotAgeSeconds}s", "min_snapshots_to_keep": 1}}).encode(),
            headers={"Authorization": f"Bearer {token.get_secret_value()}", "Content-Type": "application/json"},
            method="POST",
        )
        class MaintenanceResponse(BaseModel):
            model_config = ConfigDict(strict=True)
            success: bool
        with urllib.request.urlopen(maintenance, timeout=values.deadlineSeconds) as response:
            require(MaintenanceResponse.model_validate_json(response.read()).success)
        deadline = time.monotonic() + values.deadlineSeconds
        while True:
            table.refresh()
            retained = {snapshot.snapshot_id for snapshot in table.snapshots()}
            expired = old_snapshots - retained
            gone = sum(not table.io.new_input(path).exists() for path in original_files)
            if expired == old_snapshots and gone == len(original_files):
                require(table.scan(limit=3).to_arrow().column("value").to_pylist() == [survivor])
                require(all(table.io.new_input(task.file.file_path).exists() for task in table.scan().plan_files()))
                print(json.dumps({"rowsWritten": 3, "rowsRemaining": 1, "snapshotsExpired": len(expired), "parquetGone": gone}))
                return 0
            remaining = deadline - time.monotonic()
            require(remaining > 0)
            time.sleep(min(values.pollSeconds, remaining))
    except (ForbiddenError, UnauthorizedError):
        print(SCOPE_MESSAGE, file=sys.stderr)
        return 3
    except urllib.error.HTTPError as failure:
        if failure.code in (401, 403):
            print(SCOPE_MESSAGE, file=sys.stderr)
            return 3
        print("Basin erasure proof failed.", file=sys.stderr)
        return 1
    except Exception:
        print("Basin erasure proof failed.", file=sys.stderr)
        return 1


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--engine", action="store_true")
    parser.add_argument("--profile", default="ratstack")
    parser.add_argument("--deadline-seconds", type=int)
    parser.add_argument("--poll-seconds", type=int)
    parser.add_argument("--snapshot-age-seconds", type=int)
    args = parser.parse_args()
    if args.engine:
        return engine()
    if args.profile != "ratstack" or not all(value is not None and value > 0 for value in (args.deadline_seconds, args.poll_seconds, args.snapshot_age_seconds)):
        print("Supply the ratstack profile and positive proof observation bounds.", file=sys.stderr)
        return 1
    repo = Path(__file__).resolve().parents[4]
    config = {
        "python": sys.executable,
        "script": str(Path(__file__).resolve()),
        "deadlineSeconds": args.deadline_seconds,
        "pollSeconds": args.poll_seconds,
        "snapshotAgeSeconds": args.snapshot_age_seconds,
    }
    environment = dict(os.environ)
    environment["ALCHEMY_PROFILE"] = args.profile
    environment["BASIN_PROOF_RUN_ID"] = environment.get("BASIN_PROOF_RUN_ID") or uuid.uuid4().hex
    command = [
        "pnpm", "--filter", "@rat-stack/infra", "exec", "node", "--import",
        "./node_modules/alchemy/bin/register-oxc.js",
        "../../packages/deploy/src/basin-proof-cli.ts", json.dumps(config),
    ]
    result = subprocess.run(command, cwd=repo, env=environment, capture_output=True, text=True)
    counts = None
    for line in result.stdout.splitlines():
        try:
            candidate = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(candidate, dict) and set(candidate) == {"resourcesCreated", "resourcesDestroyed", "rowsWritten", "rowsRemaining", "snapshotsExpired", "parquetGone", "failures"} and all(type(value) is int and value >= 0 for value in candidate.values()):
            counts = candidate
    if counts is not None:
        print(json.dumps(counts))
    if result.returncode != 0:
        print(SCOPE_MESSAGE if SCOPE_MESSAGE in result.stderr else "Basin erasure proof failed; inspect the private proof receipt before retrying.", file=sys.stderr)
    return result.returncode


if __name__ == "__main__":
    sys.exit(main())
