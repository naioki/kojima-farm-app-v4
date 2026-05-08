import sys
sys.path.insert(0, ".")
from app.services.email_reader import check_email_for_orders

results = check_email_for_orders(
    imap_server="imap.lolipop.jp",
    email_address="order@kojimanouen.com",
    password="r_wa378-YXDUHT2",
    sender_email=None,
    days_back=7,
    imap_port=993,
)
print(f"Results: {len(results)}")
for r in results:
    print(f"  type={r['type']} subject={r['subject']} text_len={len(r.get('text_body','') or '')}")
    if r.get('text_body'):
        print(f"  body_preview={repr(r['text_body'][:200])}")
