from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from datetime import datetime, timezone
import os
import re

from backend.db.store import get_policy_versions, get_policy, add_policy_version, get_runs
from backend.retrieval.vector_store import reindex_policy
from backend.retrieval.document_parser import parse_policy_text

router = APIRouter()

class PolicyPutRequest(BaseModel):
    text: str

@router.get("/policies")
def list_policies():
    return get_policy_versions()

@router.get("/policies/{name}")
def get_single_policy(name: str):
    if not name.endswith(".md"):
        name += ".md"
    pol = get_policy(name)
    if not pol:
        raise HTTPException(status_code=404, detail="Policy not found")
    return pol

@router.put("/policies/{name}")
def update_policy(name: str, req: PolicyPutRequest):
    if not name.endswith(".md"):
        name += ".md"
    
    # Validate front-matter
    from fastapi.responses import JSONResponse
    from backend.retrieval.document_parser import parse_frontmatter
    try:
        fm, body = parse_frontmatter(req.text)
        if "name" not in fm or "version" not in fm or "effective_date" not in fm:
            return JSONResponse(status_code=422, content={"code": "INVALID_POLICY", "message": "Missing required front-matter fields (name, version, effective_date)."})
        if fm["name"] != name.replace(".md", ""):
            return JSONResponse(status_code=422, content={"code": "INVALID_POLICY", "message": "Name in front-matter must match path name."})
        
        doc = parse_policy_text(req.text, name)
        if not doc.chunks:
            return JSONResponse(status_code=422, content={"code": "INVALID_POLICY", "message": "At least one '- ' bullet is required."})
    except Exception as e:
        return JSONResponse(status_code=422, content={"code": "INVALID_POLICY", "message": f"Parse error: {e}"})
        
    old_pol = get_policy(name)
    if old_pol:
        # Bump version
        old_v = old_pol["version"]
        if old_v.startswith("v"):
            try:
                num = int(old_v[1:])
                new_v = f"v{num + 1}"
            except ValueError:
                new_v = old_v + "-updated"
        else:
            new_v = old_v + "-updated"
    else:
        new_v = "v1"
        
    # Bump version in text
    new_text = re.sub(r'version:\s*\S+', f'version: {new_v}', req.text, count=1)
    if 'version:' not in req.text and '---\n' in req.text:
        new_text = req.text.replace('---\n', f'---\nversion: {new_v}\n', 1)
        
    # Re-parse to get doc with updated version metadata for ChromaDB indexing
    try:
        new_doc = parse_policy_text(new_text, name)
    except Exception as e:
        return JSONResponse(status_code=422, content={"code": "INVALID_POLICY", "message": f"Parse error on new text: {e}"})
        
    # Append to DB
    add_policy_version(
        name=name,
        version=new_v,
        text=new_text,
        effective_date=new_doc.metadata.effective_date,
        created_at=datetime.now(timezone.utc).isoformat()
    )
    
    # Re-index directly from parsed doc without touching disk
    from backend.retrieval.vector_store import get_policy_collection, index_policy_documents
    try:
        collection = get_policy_collection()
        existing = collection.get(where={"source": name}, include=[])
        if existing.get("ids"):
            collection.delete(ids=existing.get("ids"))
            
        index_policy_documents(documents=[new_doc], collection=collection)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to re-index: {e}")
        
    # Find stale run ids
    # A run is stale if its policy_versions[name] is not the latest version (new_v)
    stale_run_ids = []
    runs = get_runs(limit=10000) # fetch all
    for r in runs:
        if r["stale"]: # already determined by get_runs
            # well get_runs determines if ANY policy is stale, which is what we need.
            # But the requirement is to return stale_run_ids for THIS PUT.
            pass
            
    # wait, stale_run_ids means runs that are stale because of this update or in general?
    # "stale_run_ids from PUT lists exactly those runs." -> runs that are now stale.
    # We can just fetch all runs where policy_versions[name] exists and != new_v.
    from backend.db.store import _get_conn
    conn = _get_conn()
    try:
        cur = conn.execute("SELECT run_id, result_json FROM runs")
        import json
        for row in cur.fetchall():
            run_id = row[0]
            rj = json.loads(row[1])
            pv = rj.get("policy_versions", {})
            if name in pv and pv[name] != new_v:
                stale_run_ids.append(run_id)
    finally:
        conn.close()
        
    return {
        "name": name,
        "version": new_v,
        "stale_run_ids": stale_run_ids
    }
