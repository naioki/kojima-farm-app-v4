import imaplib
import email
from datetime import datetime, timedelta
from email.header import decode_header

def decode_str(s):
    if not s:
        return ""
    parts = decode_header(s)
    result = ""
    for frag, enc in parts:
        if isinstance(frag, bytes):
            result += frag.decode(enc or "utf-8", errors="ignore")
        else:
            result += frag
    return result

mail = imaplib.IMAP4_SSL("imap.lolipop.jp", 993)
mail.login("order@kojimanouen.com", "r_wa378-YXDUHT2")
mail.select("inbox")

since = (datetime.now() - timedelta(days=7)).strftime("%d-%b-%Y")
status, msgs = mail.search(None, f"(SINCE {since})")
ids = msgs[0].split()
print(f"Found {len(ids)} emails since {since}")

for eid in ids[-10:]:
    s, data = mail.fetch(eid, "(RFC822.HEADER)")
    msg = email.message_from_bytes(data[0][1])
    subj = decode_str(msg["Subject"])
    frm = decode_str(msg["From"])
    content_type = msg.get_content_type()
    print(f"  ID={eid.decode()}  Subject={subj}  From={frm}  Type={content_type}")

mail.close()
mail.logout()
