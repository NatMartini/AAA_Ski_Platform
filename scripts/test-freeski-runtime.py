"""Isolation/privacy regression tests using a fake upstream, never the real databases/models."""
import importlib.util
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parent.parent


class RuntimeIsolationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source_temp = tempfile.TemporaryDirectory(prefix="aaa-freeski-source-")
        cls.source = Path(cls.source_temp.name)
        cls.runtime = Path(tempfile.mkdtemp(prefix="isolation-test-", dir=ROOT / "storage" / "freeski"))
        files = {
            "server/shared/__init__.py": "",
            "server/shared/modelctrl_runtime.py": """class BrokerClient:
    def __init__(self, url=None): self.url=url
    def _request(self, method): raise RuntimeError('isolated broker fixture is offline')
""",
            "server/backend/__init__.py": "",
            "server/backend/db/__init__.py": "",
            "server/backend/routes/__init__.py": "",
            "server/backend/routes/catalog.py": """def get_catalog():
    return {'rubric_system':'csia','certification':{'levels':{}},
            'improvement':{'skills':[{'id':'parallel','label':'Parallel','available':True},
                                      {'id':'carving','label':'Carving','available':False}]}}
""",
            "server/shared/config.py": """from pathlib import Path
PROJECT_ROOT=Path(__file__).resolve().parents[1]
STORAGE_DIR=PROJECT_ROOT/'storage'
UPLOADS_DIR=STORAGE_DIR/'uploads'
REPORTS_DIR=STORAGE_DIR/'reports'
SENSOR_DIR=STORAGE_DIR/'sensor'
TRT_ENGINE_DIR=PROJECT_ROOT/'trt_engines'
PROCESSED_DIR=STORAGE_DIR/'processed'
DB_CONFIG={}
FEATURE_NEW_SCORER=False
FEATURE_IDENTITY_GATE=True
""",
            "server/backend/config.py": """from pathlib import Path
from functools import lru_cache
PROJECT_ROOT=Path(__file__).resolve().parents[1]
class Settings:
    storage_dir=PROJECT_ROOT/'storage'
    uploads_dir=storage_dir/'uploads'
    sensor_dir=storage_dir/'sensor'
    capture_dir=storage_dir/'captures'
    voice_dir=storage_dir/'voice'
    sqlite_path=storage_dir/'freeski.db'
    dev_mode=False
    def ensure_bootable(self):
        for p in (self.uploads_dir,self.sensor_dir,self.capture_dir,self.voice_dir,self.sqlite_path.parent):
            p.mkdir(parents=True,exist_ok=True)
@lru_cache
def get_settings():
    s=Settings()
    s.ensure_bootable()
    return s
settings=get_settings()
""",
            "server/backend/db/database.py": """from contextlib import contextmanager
import sqlite3
from backend.config import settings
@contextmanager
def connection():
    c=sqlite3.connect(settings.sqlite_path)
    c.row_factory=sqlite3.Row
    try:
        yield c
        c.commit()
    except Exception:
        c.rollback()
        raise
    finally:
        c.close()
""",
            "server/backend/auth.py": """from dataclasses import dataclass
@dataclass
class CurrentUser:
    id:int
    email:str
def current_user():
    return CurrentUser(1,'aaa-bridge@example.com')
""",
            "server/backend/modelctrl_worker.py": """import json,os,sys
from pathlib import Path
from shared import config
from backend.config import settings
def main(argv):
    request=Path(argv[1])
    request.with_suffix('.bootstrap.json').write_text(json.dumps({
        'argv':argv,'sqlite':str(settings.sqlite_path),'uploads':str(config.UPLOADS_DIR),
        'db_options':config.DB_CONFIG['options'],'new_scorer':config.FEATURE_NEW_SCORER,
        'identity':config.FEATURE_IDENTITY_GATE,'entrypoint':os.environ['FREESKI_WORKER_ENTRYPOINT'],
        'http_imported':'backend.main' in sys.modules}))
    return 0
""",
            "server/backend/main.py": """from fastapi import FastAPI
from backend.db.database import connection
with connection() as c:
    c.executescript('CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT); CREATE TABLE upload_jobs(id TEXT PRIMARY KEY,user_id INTEGER,video_sha1 TEXT,video_path TEXT,status TEXT,analysis_id INTEGER,finished_at TEXT); CREATE TABLE analyses(id INTEGER PRIMARY KEY,user_id INTEGER);')
    c.execute('INSERT INTO users VALUES(1,?)',('aaa-bridge@example.com',))
app=FastAPI()
@app.get('/media/uploads/private')
def raw_media(): return {'secret':'private'}
@app.post('/api/auth/register')
def register(payload:dict): return {'ok':True}
""",
        }
        for relative, text in files.items():
            target = cls.source / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(text)
        cls.original_modules = {key: value for key, value in sys.modules.items() if key == "backend" or key.startswith("backend.") or key == "shared" or key.startswith("shared.")}
        for key in cls.original_modules:
            del sys.modules[key]
        cls.env_patch = patch.dict(os.environ, {"FREESKI_ROOT": str(cls.source), "AAA_FREESKI_RUNTIME_DIR": str(cls.runtime),
            "FREESKI_RUNTIME_JWT_SECRET": "a" * 64, "FREESKI_RUNTIME_NONCE": "b" * 64,
            "FREESKI_SERVICE_PASSWORD": "c" * 64, "FREESKI_SERVICE_IDENTIFIER": "aaa-bridge@example.com",
            "MODELCTRL_URL": "http://127.0.0.1:8765"})
        cls.env_patch.start()
        spec = importlib.util.spec_from_file_location("aaa_runtime_test", ROOT / "scripts" / "freeski-runtime.py")
        cls.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.module)
        cls.client = TestClient(cls.module.app, raise_server_exceptions=False)

    @classmethod
    def tearDownClass(cls):
        cls.client.close()
        cls.env_patch.stop()
        for key in list(sys.modules):
            if key == "backend" or key.startswith("backend.") or key == "shared" or key.startswith("shared."):
                del sys.modules[key]
        sys.modules.update(cls.original_modules)
        shutil.rmtree(cls.runtime)
        cls.source_temp.cleanup()

    def create_job(self, status="done", sha1=None, video_path=None, user_id=1):
        from uuid import uuid4
        job_id = uuid4().hex
        sha1 = sha1 or uuid4().hex + "a" * 8
        video = Path(video_path) if video_path else self.runtime / "uploads" / f"{sha1}.mp4"
        video.parent.mkdir(parents=True, exist_ok=True)
        video.write_text("private source")
        with self.module.connection() as c:
            c.execute("INSERT INTO upload_jobs(id,user_id,video_sha1,video_path,status) VALUES(?,?,?,?,?)", (job_id,user_id,sha1,str(video),status))
        return job_id, sha1, video

    def test_only_private_database_and_directories_are_initialized(self):
        self.assertFalse((self.source / "server" / "storage").exists())
        self.assertEqual(self.module.settings.sqlite_path, self.runtime / "freeski.db")
        self.assertTrue(self.module.settings.sqlite_path.is_file())
        self.assertIn("default_transaction_read_only=on", self.module.engine_config.DB_CONFIG["options"])

    def test_independent_broker_worker_uses_identical_isolation_without_importing_http(self):
        request = self.runtime / "worker-request.json"
        request.write_text("{}")
        completed = subprocess.run([sys.executable, str(ROOT / "scripts" / "freeski-runtime.py"),
                                    "--job-file", str(request)], capture_output=True, text=True, timeout=20)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        record = json.loads(request.with_suffix(".bootstrap.json").read_text())
        self.assertEqual(record["argv"], ["--job-file", str(request)])
        self.assertEqual(Path(record["sqlite"]), self.runtime / "freeski.db")
        self.assertEqual(Path(record["uploads"]), self.runtime / "uploads")
        self.assertIn("default_transaction_read_only=on", record["db_options"])
        self.assertFalse(record["new_scorer"])
        self.assertTrue(record["identity"])
        self.assertFalse(record["http_imported"])
        self.assertEqual(Path(record["entrypoint"]), ROOT / "scripts" / "freeski-runtime.py")
        self.assertFalse((self.source / "server" / "storage").exists())

    def test_path_escape_and_sibling_runtime_are_rejected(self):
        for outside in (self.source / "outside.mp4", self.runtime.parent / "launcher.json", self.runtime / ".." / "another-runtime" / "freeski.db"):
            with self.assertRaises(RuntimeError): self.module.private_path(outside)

    def test_raw_media_and_other_upstream_apis_are_hidden(self):
        self.assertEqual(self.client.get("/media/uploads/private").status_code, 404)
        self.assertEqual(self.client.get("/api/maintenance/uploads").status_code, 404)
        self.assertEqual(self.client.get("/api/aaa/health").json(), {"ok":True,"isolated":True,"featureNewScorer":False,"identityGate":True})

    def test_catalog_reads_upstream_availability_without_opening_other_apis(self):
        from backend.routes import catalog
        expected = catalog.get_catalog()
        with patch.object(catalog, "get_catalog", return_value=expected) as reader:
            response = self.client.get("/api/aaa/catalog")
            reader.assert_called_once_with()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), expected)
        self.assertEqual(response.headers["cache-control"], "private, no-store")
        self.assertEqual(self.client.get("/api/catalog").status_code, 404)
        self.assertEqual(self.client.post("/api/aaa/catalog").status_code, 405)

    def test_catalog_does_not_read_reference_data_for_other_accounts(self):
        from backend.routes import catalog
        self.module.app.dependency_overrides[self.module.current_user] = lambda: self.module.CurrentUser(2, "student@example.com")
        try:
            with patch.object(catalog, "get_catalog") as reader:
                self.assertEqual(self.client.get("/api/aaa/catalog").status_code, 404)
                reader.assert_not_called()
        finally:
            self.module.app.dependency_overrides.clear()

    def test_catalog_requires_authentication_before_reading_reference_data(self):
        from backend.routes import catalog
        from fastapi import HTTPException
        def anonymous():
            raise HTTPException(401, "Not authenticated")
        self.module.app.dependency_overrides[self.module.current_user] = anonymous
        try:
            with patch.object(catalog, "get_catalog") as reader:
                self.assertEqual(self.client.get("/api/aaa/catalog").status_code, 401)
                reader.assert_not_called()
        finally:
            self.module.app.dependency_overrides.clear()

    def test_request_lookup_recovers_the_owner_scoped_durable_job(self):
        key = "aaa:booking:lost-response"
        expected_id = hashlib.sha256(f"1\0{key}".encode()).hexdigest()[:32]
        job_id, _, _ = self.create_job()
        with self.module.connection() as conn:
            conn.execute("UPDATE upload_jobs SET id=? WHERE id=?", (expected_id, job_id))
        response = self.client.get(f"/api/aaa/requests/{key}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"state": "found", "jobId": expected_id})
        self.assertEqual(response.headers["cache-control"], "private, no-store")
        # Existing durable acceptance is authoritative, even during other POSTs.
        with patch.object(self.module, "analysis_submissions", 1):
            self.assertEqual(self.client.get(f"/api/aaa/requests/{key}").json(), response.json())

    def test_request_lookup_waits_for_inflight_submissions(self):
        url = "/api/aaa/requests/aaa:account:not-submitted"
        self.assertEqual(self.client.get(url).json(), {"state": "absent"})
        with patch.object(self.module, "analysis_submissions", 1):
            self.assertEqual(self.client.get(url).json(), {"state": "pending"})
        self.assertEqual(self.client.get(url).json(), {"state": "absent"})

    def test_request_lookup_detects_submission_finishing_during_the_read(self):
        original = self.module.connection
        @contextmanager
        def completing_submission():
            with original() as conn:
                yield conn
            self.module.analysis_submission_version += 1
        with patch.object(self.module, "connection", completing_submission):
            response = self.client.get("/api/aaa/requests/aaa:booking:read-race")
        self.assertEqual(response.json(), {"state": "pending"})

    def test_request_lookup_auth_and_key_checks_precede_database_reads(self):
        from fastapi import HTTPException
        url = "/api/aaa/requests/aaa:booking:private"
        for identity, status in ((lambda: self.module.CurrentUser(2, "student@example.com"), 404),
                                 (lambda: (_ for _ in ()).throw(HTTPException(401, "Not authenticated")), 401)):
            self.module.app.dependency_overrides[self.module.current_user] = identity
            try:
                with patch.object(self.module, "connection") as database:
                    self.assertEqual(self.client.get(url).status_code, status)
                    database.assert_not_called()
            finally:
                self.module.app.dependency_overrides.clear()
        for key in ("unscoped", "aaa:coach:private", "aaa:booking:", "aaa:account:" + "x" * 129):
            with self.subTest(key=key), patch.object(self.module, "connection") as database:
                self.assertEqual(self.client.get(f"/api/aaa/requests/{key}").status_code, 404)
                database.assert_not_called()

    def test_request_lookup_never_exposes_another_owners_record(self):
        key = "aaa:booking:foreign-owner"
        expected_id = hashlib.sha256(f"1\0{key}".encode()).hexdigest()[:32]
        job_id, _, _ = self.create_job(user_id=2)
        with self.module.connection() as conn:
            conn.execute("UPDATE upload_jobs SET id=? WHERE id=?", (expected_id, job_id))
        self.assertEqual(self.client.get(f"/api/aaa/requests/{key}").json(), {"state": "absent"})

    def test_analyze_tracking_is_released_when_the_upstream_route_fails(self):
        version = self.module.analysis_submission_version
        response = self.client.post("/api/analyze", json={})
        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.module.analysis_submissions, 0)
        self.assertEqual(self.module.analysis_submission_version, version + 1)

    def test_broker_origin_is_loopback_only(self):
        for origin in ("http://127.0.0.1:8765", "http://localhost:8765/", "http://[::1]:8765"):
            with self.subTest(origin=origin):
                self.assertEqual(self.module.safe_modelctrl_url(origin), origin.rstrip("/"))
        for origin in ("https://127.0.0.1:8765", "http://example.com", "http://127.0.0.1.evil.test:8765",
                       "http://user:password@127.0.0.1:8765", "http://@localhost:8765",
                       "http://localhost:8765/api", "http://localhost:8765?", "http://localhost:8765#",
                       "http://localhost:0", "http://localhost:65536", "http://localhost:",
                       "http://localhost:8765\n", "http://localhost\\evil.test", "not a URL"):
            with self.subTest(origin=origin):
                with self.assertRaisesRegex(RuntimeError, "loopback HTTP origin"):
                    self.module.safe_modelctrl_url(origin)

    def test_scheduler_exposes_only_verified_runtime_and_block_reason(self):
        snapshot = {"runtime": {"state": "stopped", "pid": 1234, "model": "private-model"},
                    "effective_block": "待命：等待转发门卫安装", "blocked": "less specific",
                    "assistant_pool": {"released": False}, "jobs": [{"command": "private"}],
                    "token": "never disclose"}
        with patch.object(self.module, "BrokerClient") as broker:
            broker.return_value._request.return_value = snapshot
            response = self.client.get("/api/aaa/scheduler")
            broker.assert_called_once_with(url="http://127.0.0.1:8765")
            broker.return_value._request.assert_called_once_with("status")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"connected": True, "runtimeState": "stopped",
                                          "waitingReason": "待命：等待转发门卫安装"})

    def test_scheduler_does_not_read_broker_for_other_accounts(self):
        self.module.app.dependency_overrides[self.module.current_user] = lambda: self.module.CurrentUser(2, "student@example.com")
        try:
            with patch.object(self.module, "BrokerClient") as broker:
                self.assertEqual(self.client.get("/api/aaa/scheduler").status_code, 404)
                broker.assert_not_called()
        finally:
            self.module.app.dependency_overrides.clear()

    def test_scheduler_requires_authentication_before_reading_broker(self):
        def anonymous():
            raise self.module.HTTPException(status_code=401, detail="Not authenticated")
        self.module.app.dependency_overrides[self.module.current_user] = anonymous
        try:
            with patch.object(self.module, "BrokerClient") as broker:
                self.assertEqual(self.client.get("/api/aaa/scheduler").status_code, 401)
                broker.assert_not_called()
        finally:
            self.module.app.dependency_overrides.clear()

    def test_invalid_broker_origin_is_rejected_before_worker_startup(self):
        request = self.runtime / "refused-worker-request.json"
        request.write_text("{}")
        with patch.dict(os.environ, {"MODELCTRL_URL": "http://private:credential@outside.example.com"}):
            completed = subprocess.run([sys.executable, str(ROOT / "scripts" / "freeski-runtime.py"),
                                        "--job-file", str(request)], capture_output=True, text=True, timeout=20)
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("ModelCtrl must use a loopback HTTP origin", completed.stderr)
        self.assertNotIn("credential", completed.stderr)
        self.assertNotIn("outside.example.com", completed.stderr)
        self.assertFalse(request.with_suffix(".bootstrap.json").exists())

    def test_scheduler_offline_or_malformed_state_remains_unavailable(self):
        unavailable = {"connected": False, "runtimeState": None, "waitingReason": None}
        with patch.object(self.module, "BrokerClient") as broker:
            broker.return_value._request.side_effect = RuntimeError("Bearer private-value J:/private/token.txt")
            self.assertEqual(self.client.get("/api/aaa/scheduler").json(), unavailable)
            broker.return_value._request.side_effect = None
            for snapshot in ({}, [], {"runtime": {"state": "invented"}}, {"runtime": None}):
                broker.return_value._request.return_value = snapshot
                self.assertEqual(self.client.get("/api/aaa/scheduler").json(), unavailable)
        with patch.dict(os.environ, {"MODELCTRL_URL": "http://outside.example.com"}):
            with patch.object(self.module, "BrokerClient") as broker:
                self.assertEqual(self.client.get("/api/aaa/scheduler").json(), unavailable)
                broker.assert_not_called()

    def test_scheduler_filters_private_reason_and_falls_back_to_blocked(self):
        reasons = ("https://private.example/path", "C:\\Users\\private", "/home/private", "Bearer abc",
                   "token=private", "api_key:private", "https:private.example", "密码=private",
                   "eyJheader.payload.signature", "paused\nprivate", "private\x7f", "private\x85")
        with patch.object(self.module, "BrokerClient") as broker:
            for reason in reasons:
                broker.return_value._request.return_value = {"runtime": {"state": "ready"}, "effective_block": reason}
                self.assertEqual(self.client.get("/api/aaa/scheduler").json(),
                                 {"connected": True, "runtimeState": "ready", "waitingReason": None})
            broker.return_value._request.return_value = {"runtime": {"state": "starting"}, "effective_block": None,
                                                        "blocked": "检测到游戏：cs2.exe"}
            self.assertEqual(self.client.get("/api/aaa/scheduler").json()["waitingReason"], "检测到游戏：cs2.exe")
            broker.return_value._request.return_value["blocked"] = "等" * 1000
            self.assertEqual(len(self.client.get("/api/aaa/scheduler").json()["waitingReason"]), 400)

    def test_scheduler_keeps_real_block_reason_during_model_teardown(self):
        with patch.object(self.module, "BrokerClient") as broker:
            broker.return_value._request.return_value = {"runtime": {"state": "stopping"},
                                                        "effective_block": "正在等待上一个模型完全退出"}
            self.assertEqual(self.client.get("/api/aaa/scheduler").json(),
                             {"connected": True, "runtimeState": None, "waitingReason": "正在等待上一个模型完全退出"})

    def test_registration_requires_nonce_and_exact_dedicated_identity(self):
        payload = {"email":"aaa-bridge@example.com","password":"c" * 64}
        self.assertEqual(self.client.post("/api/auth/register", json=payload).status_code, 404)
        headers = {"x-aaa-runtime-nonce":"b" * 64}
        self.assertEqual(self.client.post("/api/auth/register", json={**payload,"email":"person@example.com"}, headers=headers).status_code, 403)
        self.assertEqual(self.client.post("/api/auth/register", json=payload, headers=headers).status_code, 200)
        self.assertEqual(self.client.post("/api/auth/register", content="broken", headers=headers).status_code, 400)

    def test_settlement_ack_preserves_upload_cache_results_and_job(self):
        job_id, sha1, video = self.create_job()
        cache = self.runtime / "cache" / "uploads" / sha1
        cache.mkdir(parents=True)
        (cache / "pose.npy").write_text("private pose")
        processed = self.runtime / "uploads" / "processed"
        processed.mkdir(exist_ok=True)
        artifact = processed / f"{sha1}_keypoints.npz"
        artifact.write_text("private skeleton")
        response = self.client.delete(f"/api/aaa/jobs/{job_id}")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(video.exists())
        self.assertTrue(cache.exists())
        self.assertTrue(artifact.exists())
        self.assertTrue((self.runtime / "acknowledgements" / f"{job_id}.json").is_file())
        with self.module.connection() as c:
            self.assertEqual(c.execute("SELECT status FROM upload_jobs WHERE id=?", (job_id,)).fetchone()[0], "done")
        self.assertEqual(self.client.delete(f"/api/aaa/jobs/{job_id}").status_code, 200)

    def test_cleanup_is_scoped_and_cannot_remove_running_files(self):
        job_id, _, video = self.create_job(status="running")
        self.assertEqual(self.client.delete(f"/api/aaa/jobs/{job_id}").status_code, 409)
        self.assertTrue(video.exists())
        stranger, _, other = self.create_job(user_id=2)
        self.assertEqual(self.client.delete(f"/api/aaa/jobs/{stranger}").status_code, 404)
        self.assertTrue(other.exists())

    def test_cleanup_refuses_an_outside_path_from_a_corrupt_job_record(self):
        job_id, _, outside = self.create_job(video_path=self.source / "protected.mp4")
        self.assertEqual(self.client.delete(f"/api/aaa/jobs/{job_id}").status_code, 500)
        self.assertTrue(outside.exists())
        self.assertTrue(self.module.settings.sqlite_path.exists())

    def test_cleanup_keeps_a_shared_video_while_another_job_is_active(self):
        first, sha1, video = self.create_job()
        second, _, _ = self.create_job(status="running", sha1=sha1)
        self.assertEqual(self.client.delete(f"/api/aaa/jobs/{first}").status_code, 200)
        self.assertTrue(video.exists())
        with self.module.connection() as c: c.execute("UPDATE upload_jobs SET status='done' WHERE id=?", (second,))
        self.assertEqual(self.client.delete(f"/api/aaa/jobs/{second}").status_code, 200)
        self.assertTrue(video.exists())

    def test_orphan_sweep_keeps_existing_uploads_without_a_retention_authorization(self):
        orphan = self.runtime / "uploads" / ("tmp_" + "d" * 32 + ".mp4")
        fresh = self.runtime / "uploads" / ("tmp_" + "e" * 32 + ".mp4")
        orphan.write_text("interrupted private upload")
        fresh.write_text("fresh upload")
        old = time.time() - 7200
        os.utime(orphan, (old, old))
        _, _, active = self.create_job(status="running")
        os.utime(active, (old, old))
        self.module.cleanup_orphan_artifacts()
        self.assertTrue(orphan.exists())
        self.assertTrue(fresh.exists())
        self.assertTrue(active.exists())
        self.assertTrue(self.module.settings.sqlite_path.exists())

    def test_old_unsettled_terminal_jobs_remain_available_for_manual_retry(self):
        for status in ("done", "error", "cancelled"):
            job_id, _, video = self.create_job(status=status)
            with self.module.connection() as c:
                c.execute("UPDATE upload_jobs SET finished_at=datetime('now','-2 hours') WHERE id=?", (job_id,))
            self.module.cleanup_orphan_artifacts()
            self.assertTrue(video.is_file())
            with self.module.connection() as c:
                self.assertEqual(c.execute("SELECT status FROM upload_jobs WHERE id=?", (job_id,)).fetchone()[0], status)
        self.assertFalse(hasattr(self.module, "cleanup_abandoned_results"))


if __name__ == "__main__":
    unittest.main()
