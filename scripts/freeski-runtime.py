"""AAA-only FreeSki backend. The existing repository and reference corpus are read-only.

This wrapper imports the real FastAPI/analysis implementation, redirects every
mutable path before importing backend.main, and adds owner-scoped cleanup.
"""
from __future__ import annotations

import ast
import hmac
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import time
from urllib.parse import urlsplit, urlunsplit

sys.dont_write_bytecode = True
AAA_ROOT = Path(__file__).resolve().parent.parent
WORKER_JOB_FILE = None
if __name__ == "__main__" and len(sys.argv) > 1:
    if len(sys.argv) != 3 or sys.argv[1] not in ("--job-file", "--modelctrl-job-file"):
        raise RuntimeError("Usage: freeski-runtime.py [--job-file <absolute worker request>]")
    WORKER_JOB_FILE = sys.argv[2]
    # Broker specs never carry AAA credentials. The independently granted
    # process reads the same private server configuration as the launcher.
    from dotenv import load_dotenv
    load_dotenv(AAA_ROOT / ".env.local", override=False)
    load_dotenv(AAA_ROOT / ".env", override=False)

ALLOWED_ROOT = (AAA_ROOT / "storage" / "freeski").resolve()
RUNTIME_ROOT = Path(os.environ.get("AAA_FREESKI_RUNTIME_DIR", str(ALLOWED_ROOT / "runtime"))).resolve()
FREESKI_ROOT = Path(os.environ.get("FREESKI_ROOT", r"J:\Freeski\FreeSkiclaude")).resolve()
SERVER_ROOT = FREESKI_ROOT / "server"


def safe_modelctrl_url(raw: str) -> str:
    """Broker credentials may only be sent to the local HTTP controller."""
    try:
        if not isinstance(raw, str) or any(ch.isspace() or ord(ch) < 32 or ord(ch) == 127 for ch in raw):
            raise ValueError("Invalid URL text")
        parsed = urlsplit(raw)
        if (parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "localhost", "::1")
                or parsed.username is not None or parsed.password is not None
                or parsed.path not in ("", "/") or "?" in raw or "#" in raw or "\\" in raw
                or parsed.netloc.endswith(":")
                or (parsed.port is not None and not 1 <= parsed.port <= 65535)):
            raise ValueError("Not a loopback broker origin")
        return urlunsplit((parsed.scheme, parsed.netloc, "", "", ""))
    except (TypeError, ValueError):
        # Do not put a misconfigured URL or embedded credentials into logs.
        raise RuntimeError("ModelCtrl must use a loopback HTTP origin") from None


# Validate before importing either the API queue or the broker worker, so all
# upstream broker requests inherit the same fail-closed local origin.
os.environ["MODELCTRL_URL"] = safe_modelctrl_url(os.environ.get("MODELCTRL_URL", "http://127.0.0.1:8765"))


def private_path(candidate: Path) -> Path:
    resolved = candidate.resolve()
    if (RUNTIME_ROOT == ALLOWED_ROOT or not RUNTIME_ROOT.is_relative_to(ALLOWED_ROOT)
            or not ALLOWED_ROOT.is_relative_to(AAA_ROOT)
            or (resolved != RUNTIME_ROOT and not resolved.is_relative_to(RUNTIME_ROOT))):
        raise RuntimeError("FreeSki mutable path must stay inside AAA private runtime")
    if resolved.is_relative_to((FREESKI_ROOT / "server" / "storage").resolve()):
        raise RuntimeError("Refusing historical FreeSki storage")
    return resolved


private_path(RUNTIME_ROOT)
if not (SERVER_ROOT / "backend" / "main.py").is_file():
    raise RuntimeError("FreeSki source repository is missing")
for required_secret in ("FREESKI_RUNTIME_JWT_SECRET", "FREESKI_RUNTIME_NONCE", "FREESKI_SERVICE_PASSWORD"):
    if len(os.environ.get(required_secret, "")) < 32:
        raise RuntimeError("AAA FreeSki credentials have not been provisioned")
SERVICE_EMAIL = os.environ.get("FREESKI_SERVICE_IDENTIFIER", "")
if "@" not in SERVICE_EMAIL:
    raise RuntimeError("AAA service identifier must be its dedicated email")

# Explicit overrides win over the original repository's dotenv values.
os.environ["JWT_SECRET"] = os.environ["FREESKI_RUNTIME_JWT_SECRET"]
os.environ["FREESKI_DEV"] = "0"
os.environ["FREESKI_FEATURE_NEW_SCORER"] = "0"
os.environ["FREESKI_FEATURE_IDENTITY_GATE"] = "1"
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
os.environ["FREESKI_WORKER_ENTRYPOINT"] = str(Path(__file__).resolve())
os.environ["FREESKI_WORKER_CWD"] = str(AAA_ROOT)
sys.path.insert(0, str(SERVER_ROOT))

from shared import config as engine_config  # noqa: E402

original_engine_cache = engine_config.TRT_ENGINE_DIR
engine_config.STORAGE_DIR = private_path(RUNTIME_ROOT)
engine_config.UPLOADS_DIR = private_path(RUNTIME_ROOT / "uploads")
engine_config.REPORTS_DIR = private_path(RUNTIME_ROOT / "reports")
engine_config.SENSOR_DIR = private_path(RUNTIME_ROOT / "sensor")
engine_config.TRT_ENGINE_DIR = private_path(RUNTIME_ROOT / "trt_engines")
# DATA_DIR / PROCESSED_DIR / models / rubrics remain the original read-only references.
engine_config.DB_CONFIG = {
    **engine_config.DB_CONFIG,
    "connect_timeout": 5,
    "options": "-c default_transaction_read_only=on",
}
if engine_config.FEATURE_NEW_SCORER or not engine_config.FEATURE_IDENTITY_GATE:
    raise RuntimeError("Required scoring safety flags were not applied")

def isolated_settings():
    """Use the real Settings definitions without their eager historical mkdir calls.

    This is trusted repository source, just as with a normal import. The one
    eager bootstrap is deferred so class defaults can be redirected first.
    An upstream bootstrap change fails closed rather than touching old storage.
    """
    spec = importlib.util.find_spec("backend.config")
    if spec is None or spec.loader is None:
        raise RuntimeError("FreeSki backend configuration is unavailable")
    source = spec.loader.get_source("backend.config")
    tree = ast.parse(source, filename=spec.origin)
    bootstraps = [node for node in tree.body if
                  isinstance(node, ast.Assign) and len(node.targets) == 1
                  and isinstance(node.targets[0], ast.Name) and node.targets[0].id == "settings"
                  and isinstance(node.value, ast.Call) and isinstance(node.value.func, ast.Name)
                  and node.value.func.id == "get_settings" and not node.value.args and not node.value.keywords]
    if len(bootstraps) != 1:
        raise RuntimeError("FreeSki configuration bootstrap changed; isolation must be reviewed")
    tree.body.remove(bootstraps[0])
    module = importlib.util.module_from_spec(spec)
    sys.modules["backend.config"] = module
    exec(compile(tree, spec.origin, "exec"), module.__dict__)
    for name, value in {
        "storage_dir": RUNTIME_ROOT, "uploads_dir": RUNTIME_ROOT / "uploads",
        "sensor_dir": RUNTIME_ROOT / "sensor", "capture_dir": RUNTIME_ROOT / "captures",
        "voice_dir": RUNTIME_ROOT / "voice", "sqlite_path": RUNTIME_ROOT / "freeski.db",
    }.items():
        setattr(module.Settings, name, private_path(value))
    module.settings = module.get_settings()
    return module.settings


settings = isolated_settings()
for mutable_path in (
    settings.storage_dir, settings.uploads_dir, settings.sensor_dir, settings.capture_dir,
    settings.voice_dir, settings.sqlite_path, engine_config.UPLOADS_DIR,
    engine_config.REPORTS_DIR, engine_config.TRT_ENGINE_DIR,
):
    private_path(mutable_path)
if settings.dev_mode:
    raise RuntimeError("Development authentication is forbidden in the AAA bridge")
settings.ensure_bootable()
engine_config.REPORTS_DIR.mkdir(parents=True, exist_ok=True)

# Reuse this machine's existing compiled model engines by copying them; never write back.
if Path(original_engine_cache).is_dir() and not engine_config.TRT_ENGINE_DIR.exists():
    shutil.copytree(original_engine_cache, engine_config.TRT_ENGINE_DIR)

if WORKER_JOB_FILE is not None:
    # Heavy imports happen only in the broker-owned worker, after identical
    # private storage, reference DB read-only and scoring flags are applied.
    from backend.modelctrl_worker import main as modelctrl_worker_main
    raise SystemExit(modelctrl_worker_main(["--job-file", WORKER_JOB_FILE]))

# Importing main only now is essential: its startup migrates SQLite and recovers jobs.
from backend.main import app  # noqa: E402
from backend.auth import CurrentUser, current_user  # noqa: E402
from backend.db.database import connection  # noqa: E402
from shared.modelctrl_runtime import BrokerClient  # noqa: E402
from fastapi import Depends, HTTPException, Request  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402

JOB_ID = re.compile(r"^[a-f0-9]{32}$")
VIDEO_SHA1 = re.compile(r"^[a-f0-9]{40}$")
REQUEST_KEY = re.compile(r"^aaa:(?:booking|account):[A-Za-z0-9_-]{1,128}$")
analysis_submissions = 0
analysis_submission_version = 0


@app.middleware("http")
async def private_bridge_routes(request: Request, call_next):
    global analysis_submissions, analysis_submission_version
    route = request.url.path
    if route == "/health":
        return JSONResponse({"ok": True, "isolated": True, "featureNewScorer": False, "identityGate": True})
    allowed = route in ("/health", "/api/auth/login", "/api/auth/register", "/api/profile", "/api/analyze")
    allowed = allowed or route.startswith("/api/jobs/") or route.startswith("/api/aaa/")
    if not allowed:
        return JSONResponse({"detail": "Not found"}, status_code=404)
    if route == "/api/auth/register":
        provided = request.headers.get("x-aaa-runtime-nonce", "")
        if not re.fullmatch(r"[a-f0-9]{64}", provided) or not hmac.compare_digest(provided, os.environ["FREESKI_RUNTIME_NONCE"]):
            return JSONResponse({"detail": "Not found"}, status_code=404)
        try:
            body = await request.json()
        except Exception:
            return JSONResponse({"detail": "Invalid request"}, status_code=400)
        if not isinstance(body, dict):
            return JSONResponse({"detail": "Invalid request"}, status_code=400)
        if body.get("email") != SERVICE_EMAIL or body.get("password") != os.environ["FREESKI_SERVICE_PASSWORD"]:
            return JSONResponse({"detail": "Invalid service registration"}, status_code=403)
    if route == "/api/analyze" and request.method == "POST":
        analysis_submissions += 1
        analysis_submission_version += 1
        try:
            return await call_next(request)
        finally:
            analysis_submissions -= 1
    return await call_next(request)


def require_service(user: CurrentUser) -> None:
    if user.email.casefold() != SERVICE_EMAIL.casefold():
        raise HTTPException(404, "Not found")


@app.get("/api/aaa/health")
def bridge_health(user: CurrentUser = Depends(current_user)):
    require_service(user)
    return {"ok": True, "isolated": True, "featureNewScorer": False, "identityGate": True}


@app.get("/api/aaa/catalog")
def bridge_catalog(user: CurrentUser = Depends(current_user)):
    require_service(user)
    # Read the same rubric/reference catalog and availability gates as FreeSki.
    # This import and directory read happen only for the dedicated service user.
    from backend.routes.catalog import get_catalog
    return JSONResponse(get_catalog(), headers={"Cache-Control": "private, no-store"})


@app.get("/api/aaa/requests/{request_key}")
def bridge_request_lookup(request_key: str, user: CurrentUser = Depends(current_user)):
    require_service(user)
    if not REQUEST_KEY.fullmatch(request_key):
        raise HTTPException(404, "Not found")
    # FreeSki persists jobs under this deterministic, account-scoped key; the
    # request string itself is not stored in upload_jobs. Reuse its exact hash.
    job_id = hashlib.sha256(f"{user.id}\0{request_key}".encode()).hexdigest()[:32]
    # Check submissions before AND after the DB read. While an analyze POST is
    # in flight, absence cannot justify releasing a business reservation.
    pending = analysis_submissions > 0
    version = analysis_submission_version
    with connection() as conn:
        row = conn.execute("SELECT id FROM upload_jobs WHERE id=? AND user_id=?", (job_id, user.id)).fetchone()
    if row is not None:
        result = {"state": "found", "jobId": row["id"]}
    else:
        changed = version != analysis_submission_version
        result = {"state": "pending" if pending or changed or analysis_submissions > 0 else "absent"}
    return JSONResponse(result, headers={"Cache-Control": "private, no-store"})


def safe_waiting_reason(value) -> str | None:
    if not isinstance(value, str):
        return None
    # Reasons are ordinary UI text. Paths, URLs, credentials and controls are
    # operational details and must never cross the private bridge boundary.
    if (re.search(r"[/\\\x00-\x1f\x7f-\x9f]", value)
            or re.search(r"\b(?:https?|file|ftp|data|javascript|mailto):|\b(?:bearer|basic)\s+|(?:password|passwd|access[_-]?token|api[_-]?key|secret|authorization|cookie|token|jwt|密码|令牌|密钥)\s*[:=]|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b", value, re.I)):
        return None
    return value.strip()[:400] or None


@app.get("/api/aaa/scheduler")
def bridge_scheduler(user: CurrentUser = Depends(current_user)):
    require_service(user)
    unavailable = {"connected": False, "runtimeState": None, "waitingReason": None}
    try:
        origin = safe_modelctrl_url(os.environ.get("MODELCTRL_URL", "http://127.0.0.1:8765"))
        # The official SDK disables redirects and system proxies. Loading the
        # SDK/token and querying status happen only after authentication.
        state = BrokerClient(url=origin)._request("status")
        if not isinstance(state, dict) or not isinstance(state.get("runtime"), dict):
            return unavailable
        runtime_state = state["runtime"].get("state")
        if runtime_state not in ("stopped", "starting", "ready", "stopping"):
            return unavailable
        # The documented public state union has no 'stopping'. Keep the real
        # block reason while withholding a readiness claim during teardown.
        return {"connected": True, "runtimeState": None if runtime_state == "stopping" else runtime_state,
                "waitingReason": safe_waiting_reason(state.get("effective_block") or state.get("blocked"))}
    except Exception:
        # Outages keep jobs queued; never start a model or expose raw errors.
        return unavailable


def acknowledge_job(job_id: str, user_id: int) -> bool:
    """Acknowledge business settlement without deleting uploads, caches or history."""
    if not JOB_ID.fullmatch(job_id):
        return False
    with connection() as conn:
        row = conn.execute("SELECT * FROM upload_jobs WHERE id=? AND user_id=?", (job_id, user_id)).fetchone()
        if row is None:
            return False
        if row["status"] not in ("done", "error", "cancelled"):
            raise HTTPException(409, "Analysis is still running")
        sha1 = row["video_sha1"]
        if not VIDEO_SHA1.fullmatch(sha1):
            raise HTTPException(500, "Invalid runtime video record")
        video_path = private_path(Path(row["video_path"]))
        if video_path.parent != settings.uploads_dir or video_path.stem != sha1:
            raise HTTPException(500, "Invalid runtime upload path")
        acknowledgement = {"job_id": job_id, "user_id": user_id, "analysis_id": row["analysis_id"],
                           "video_sha1": sha1, "acknowledged_at": time.time()}
    ack_directory = private_path(RUNTIME_ROOT / "acknowledgements")
    ack_directory.mkdir(parents=True, exist_ok=True)
    ack_path = private_path(ack_directory / f"{job_id}.json")
    if not ack_path.exists():
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", prefix=f"{job_id}.",
                                         suffix=".tmp", dir=ack_directory, delete=False) as staged:
            json.dump(acknowledgement, staged, ensure_ascii=False)
            staged.flush()
            os.fsync(staged.fileno())
            staged_path = Path(staged.name)
        try:
            os.replace(staged_path, ack_path)
        finally:
            staged_path.unlink(missing_ok=True)
    return True


@app.delete("/api/aaa/jobs/{job_id}")
def cleanup_job(job_id: str, user: CurrentUser = Depends(current_user)):
    require_service(user)
    if not acknowledge_job(job_id, user.id):
        raise HTTPException(404, "Not found")
    return {"ok": True}


def cleanup_orphan_artifacts():
    """Retained compatibility hook: durable uploads and caches have no automatic TTL."""
    # Broker retry, a delayed business acknowledgement, and existing historical
    # uploads all need their original data. Retention changes require a separate
    # explicit user decision; this runtime never deletes those files by age.
    return None


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("AAA_FREESKI_PORT", "8000"))
    if not 1 <= port <= 65535:
        raise RuntimeError("Invalid AAA FreeSki port")
    uvicorn.run(app, host="127.0.0.1", port=port, access_log=False)
