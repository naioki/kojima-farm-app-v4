"""
Supabase client factory for the FastAPI backend.
Uses the service-role key so it can bypass RLS when needed
(e.g. creating verifications, uploading images).
All tenant-scoped queries should still pass tenant_id explicitly.
"""
import os
from functools import lru_cache

from supabase import create_client, Client


@lru_cache(maxsize=1)
def get_supabase() -> Client:
    url = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return create_client(url, key)
