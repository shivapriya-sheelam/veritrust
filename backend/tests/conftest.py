import os
import tempfile
import pytest

@pytest.fixture(autouse=True, scope="session")
def isolated_environment():
    import tempfile
    tmpdir = tempfile.mkdtemp()
    
    db_path = os.path.join(tmpdir, "test.db")
    chroma_dir = os.path.join(tmpdir, "chroma")
    policies_dir = os.path.join(tmpdir, "policies")
    
    import shutil
    shutil.copytree("data/policies", policies_dir)
    
    from backend import config
    config.DB_PATH = db_path
    config.CHROMA_DIR = chroma_dir
    
    os.environ["DB_PATH"] = db_path
    os.environ["CHROMA_DIR"] = chroma_dir
    os.environ["POLICIES_DIR"] = policies_dir
    
    # Reset Chroma client
    from backend.retrieval import vector_store
    vector_store._chroma_client = None
    
    # Init DB and seed policies
    from backend.db.store import init_db
    from backend.retrieval.vector_store import index_all_policies
    init_db()
    index_all_policies()
