"""
backend/db/reset.py
-------------------
CLI for resetting the database.
Usage: python -m backend.db.reset --runs
"""

import argparse
import sys

from backend.db.store import reset_runs, init_db


def main() -> None:
    parser = argparse.ArgumentParser(description="Reset VeriTrust database tables")
    parser.add_argument("--runs", action="store_true", help="Clear runs and claims tables")
    parser.add_argument("--policies", action="store_true", help="Clear policies and re-index")
    args = parser.parse_args()

    init_db()

    action_taken = False
    if args.runs:
        reset_runs()
        print("Cleared runs and claims tables.")
        action_taken = True
        
    if args.policies:
        from backend.db.store import clear_policies
        from backend.retrieval.vector_store import index_all_policies
        clear_policies()
        index_all_policies()
        print("Cleared policies and re-indexed.")
        action_taken = True
        
    if not action_taken:
        print("No action specified. Use --runs or --policies.")
        sys.exit(1)


if __name__ == "__main__":
    main()
