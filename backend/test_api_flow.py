"""email_fetch.py のロジックをそのままトレースする"""
import sys, os
sys.path.insert(0, ".")
os.chdir(os.path.dirname(os.path.abspath(__file__)))

# .env.local を読み込む
from dotenv import load_dotenv
load_dotenv(".env.local")

from app.services.email_reader import check_email_for_orders
from app.services.supabase_client import get_supabase

DEFAULT_TENANT_ID = os.environ.get("DEFAULT_TENANT_ID", "00000000-0000-0000-0000-000000000001")

# 既登録 email_id を確認
sb = get_supabase()
existing = sb.table("ocr_verifications").select("confidence_flags").eq("tenant_id", DEFAULT_TENANT_ID).execute()
registered = set()
for row in (existing.data or []):
    flags = row.get("confidence_flags") or {}
    eid = flags.get("email_id")
    if eid:
        registered.add(str(eid))
print(f"Registered email_ids in DB: {registered}")
print(f"Total DB records: {len(existing.data or [])}")

# IMAP 取得
results = check_email_for_orders(
    imap_server="imap.lolipop.jp",
    email_address="order@kojimanouen.com",
    password="r_wa378-YXDUHT2",
    days_back=7,
    imap_port=993,
)
print(f"\nIMAP results: {len(results)}")
for r in results:
    eid = str(r.get("email_id",""))
    is_dup = eid in registered
    print(f"  email_id={eid} subject={r['subject']} type={r['type']} duplicate={is_dup}")
