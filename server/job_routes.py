"""HTTP adapter for the durable JobService; app.py supplies auth and ownership."""
from __future__ import annotations
import json
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from typing import Literal

class JobParams(BaseModel):
    params: dict = {}

class CpuRetry(BaseModel):
    revision: str

class JobAcknowledge(BaseModel):
    state: Literal["applied", "dismissed"]

def create_job_router(service, project_exists, *, auth_dependency=None, write_dependency=None, validate_request=None):
    router=APIRouter()
    read_dependencies = []
    if auth_dependency is not None:
        read_dependencies.append(Depends(auth_dependency))
    write_dependencies = list(read_dependencies)
    if write_dependency is not None:
        write_dependencies.append(Depends(write_dependency))
    read_auth = {"dependencies": read_dependencies}
    write_auth = {"dependencies": write_dependencies}
    def public_job(item):
        request = item['request']
        public = {k:v for k,v in request.items() if not k.startswith('_')}
        public['reused_vocal'] = bool(request.get('_reuse_vocal_id') or request.get('_has_vocal'))
        public['model'] = {kind: {key: model[key] for key in ('id', 'name', 'type') if key in model}
                           for kind, model in (('alignment', request.get('_model')), ('vocal', request.get('_vocal_model'))) if model} or None
        return {**item, 'request': public}
    def check_project(pid):
        if not project_exists(pid): raise HTTPException(404, {"code":"project_not_found","message":"project not found","retryable":False})
    @router.post("/projects/{pid}/jobs/{kind}", status_code=202, **read_auth)
    def create_kind(pid: str, kind: str, body: JobParams, request: Request, subject=Depends(write_dependency) if write_dependency else None):
        check_project(pid)
        # A repeated client intent resolves to its original task, before any
        # current model, device or resource settings are consulted.
        incoming = dict(body.params)
        idem_key = request.headers.get('idempotency-key')
        if kind in {'alignment','vocal'} and idem_key:
            with service.db.connect() as c:
                previous = c.execute(
                    'SELECT j.*, i.request_hash FROM job_idempotency i JOIN jobs j ON j.id=i.job_id WHERE i.project_id=? AND i.idem_key=?',
                    (pid, idem_key),
                ).fetchone()
            if previous:
                old = service._job(previous)
                owner, previous_kind, _ = json.loads(previous['request_hash'])
                if owner != (subject or 'local') or previous_kind != kind or incoming != old['request'].get('_client_params'):
                    raise HTTPException(409, 'idempotency key was used for another request')
                if kind == 'alignment':
                    from .alignment_models import check_snapshot
                    try: check_snapshot(old['request']['_model'])
                    except ValueError as exc: raise HTTPException(409, str(exc))
                return public_job(old)
        if validate_request:
            validate_request(pid, kind, body.params)
        if kind in {'alignment','vocal'}: body.params['_client_params'] = incoming
        try: return public_job(service.create(pid, kind, body.params, idem_key=idem_key, subject=subject or "local"))
        except ValueError as exc: raise HTTPException(409, {"code":"idempotency_mismatch","message":str(exc),"retryable":False})
    @router.get("/projects/{pid}/jobs", **read_auth)
    def list_jobs(pid: str, limit: int=50):
        check_project(pid)
        return {"schema_version":"studio-job-list-v1","items":[public_job(j) for j in service.list(pid, max(1,min(limit,100)))]}
    def owned(jid):
        item=service.get(jid)
        if not item: raise HTTPException(404, {"code":"job_not_found","message":"job not found","retryable":False})
        return item
    @router.post('/jobs/{jid}/retry-cpu', status_code=202, **read_auth)
    def retry_cpu(jid: str, body: CpuRetry, request: Request, subject=Depends(write_dependency) if write_dependency else None):
        old = owned(jid)
        if old['status'] != 'failed' or not (old.get('error') or {}).get('cpu_retry') or old['kind'] not in {'vocal','alignment'}:
            raise HTTPException(409, '此失败不支持 CPU 重试，请按错误说明处理')
        params = old['request']
        revision = params.get('revision', params.get('bound_revision'))
        with service.db.connect() as c:
            project = c.execute('SELECT current_revision,source_asset_id FROM projects WHERE id=?', (old['project_id'],)).fetchone()
        if not project or project[0] != revision or body.revision != revision or project[1] != params['asset_id']:
            raise HTTPException(409, '项目版本或源音频已改变，请重新发起任务')
        if old['kind'] == 'alignment':
            from .alignment_models import check_snapshot
            try: check_snapshot(params['_model'])
            except ValueError as exc: raise HTTPException(409, str(exc))
        fresh = {k:v for k,v in params.items() if k not in {'devices','cpu_retry','retry_of'}}
        if fresh.get('_vocal_model'):
            from .vocal_models import check_snapshot as check_vocal_snapshot
            try: check_vocal_snapshot(fresh['_vocal_model'])
            except ValueError as exc: raise HTTPException(409, str(exc))
        fresh['cpu_retry'] = True
        fresh['retry_of'] = jid
        try:
            return public_job(service.create(old['project_id'], old['kind'], fresh, idem_key=request.headers.get('idempotency-key'), subject=subject or 'local'))
        except ValueError as exc:
            raise HTTPException(409, str(exc))
    @router.get("/jobs/{jid}", **read_auth)
    def get(jid): return public_job(owned(jid))
    @router.post("/jobs/{jid}/cancel", **write_auth)
    def cancel(jid): owned(jid); return public_job(service.cancel(jid))
    @router.post("/jobs/{jid}/acknowledge", **write_auth)
    def acknowledge(jid: str, body: JobAcknowledge):
        owned(jid)
        return public_job(service.acknowledge(jid, body.state))
    @router.get("/jobs/{jid}/result", **read_auth)
    def result(jid):
        owned(jid); value=service.result(jid)
        if value is None: raise HTTPException(409,{"code":"result_not_ready","message":"result is not ready","retryable":True})
        return {"schema_version":"studio-job-result-v1","job_id":jid,**value}
    return router
