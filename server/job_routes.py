"""HTTP adapter for the durable JobService; app.py supplies auth and ownership."""
from __future__ import annotations
import asyncio, json
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

class JobRequest(BaseModel):
    kind: str = Field(min_length=1, max_length=40)
    params: dict = {}

class JobParams(BaseModel):
    params: dict = {}

class CpuRetry(BaseModel):
    revision: str

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
    def check_project(pid):
        if not project_exists(pid): raise HTTPException(404, {"code":"project_not_found","message":"project not found","retryable":False})
    @router.post("/projects/{pid}/jobs", status_code=202, **write_auth)
    def create(pid: str, body: JobRequest, request: Request, subject=Depends(write_dependency) if write_dependency else None):
        check_project(pid)
        if validate_request:
            validate_request(pid, body.kind, body.params)
        try: return service.create(pid, body.kind, body.params, idem_key=request.headers.get("idempotency-key"), subject=subject or "local")
        except ValueError as exc: raise HTTPException(409, {"code":"idempotency_mismatch","message":str(exc),"retryable":False})
    @router.post("/projects/{pid}/jobs/{kind}", status_code=202, **write_auth)
    def create_kind(pid: str, kind: str, body: JobParams, request: Request, subject=Depends(write_dependency) if write_dependency else None):
        check_project(pid)
        if validate_request:
            validate_request(pid, kind, body.params)
        try: return service.create(pid, kind, body.params, idem_key=request.headers.get("idempotency-key"), subject=subject or "local")
        except ValueError as exc: raise HTTPException(409, {"code":"idempotency_mismatch","message":str(exc),"retryable":False})
    @router.get("/projects/{pid}/jobs", **read_auth)
    def list_jobs(pid: str, limit: int=50):
        check_project(pid)
        with service.db.connect() as c: rows=c.execute("SELECT id FROM jobs WHERE project_id=? ORDER BY created_at DESC LIMIT ?",(pid,max(1,min(limit,100)))).fetchall()
        return {"schema_version":"studio-job-list-v1","items":[service.get(r[0]) for r in rows]}
    def owned(jid):
        item=service.get(jid)
        if not item: raise HTTPException(404, {"code":"job_not_found","message":"job not found","retryable":False})
        return item
    @router.post('/jobs/{jid}/retry-cpu', status_code=202, **write_auth)
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
        public = {'asset_id', 'retry_analysis_id'} if old['kind'] == 'vocal' else {'revision','use_hints','line_blank','rest_blank','rest_token','clear_unmatched','merge_short_gaps','gap_threshold_ms'}
        fresh = {k:v for k,v in params.items() if k in public}
        if validate_request: validate_request(old['project_id'], old['kind'], fresh)
        fresh['cpu_retry'] = True
        fresh['retry_of'] = jid
        try:
            return service.create(old['project_id'], old['kind'], fresh, idem_key=request.headers.get('idempotency-key'), subject=subject or 'local')
        except ValueError as exc:
            raise HTTPException(409, str(exc))
    @router.get("/jobs/{jid}", **read_auth)
    def get(jid): return owned(jid)
    @router.post("/jobs/{jid}/cancel", **write_auth)
    def cancel(jid): owned(jid); return service.cancel(jid)
    @router.get("/jobs/{jid}/result", **read_auth)
    def result(jid):
        owned(jid); value=service.result(jid)
        if value is None: raise HTTPException(409,{"code":"result_not_ready","message":"result is not ready","retryable":True})
        return {"schema_version":"studio-job-result-v1","job_id":jid,**value}
    @router.get("/jobs/{jid}/events", **read_auth)
    async def events(jid, request: Request, after_seq: int=0):
        owned(jid)
        try:
            cursor=max(after_seq, int(request.headers.get("last-event-id",0) or 0))
        except (TypeError, ValueError):
            raise HTTPException(400, {"code":"invalid_event_cursor","message":"Last-Event-ID must be an integer","retryable":False})
        async def stream():
            while True:
                for event in service.events(jid,cursor_ref[0]):
                    nonlocal_cursor=event["seq"]
                    yield f"id: {event['seq']}\ndata: {json.dumps(event,ensure_ascii=False)}\n\n"
                    # local cursor is advanced by refreshed snapshot below
                    cursor_ref[0]=nonlocal_cursor
                item=service.get(jid)
                if item["status"] in {"succeeded","failed","cancelled","interrupted"}: return
                if await request.is_disconnected(): return
                yield ": heartbeat\n\n"
                await asyncio.sleep(0.25)
        cursor_ref=[cursor]
        return StreamingResponse(stream(),media_type="text/event-stream",headers={"Cache-Control":"no-cache","X-Accel-Buffering":"no"})
    return router
