# System Design v4 — 小島農園 管理システム

**Version**: 4.0  
**Date**: 2026-05-05  
**Author**: Claude (Senior Full-Stack Engineer)  
**Status**: Awaiting Approval

---

## 1. System Overview & Objectives

### Background
v3 is a single-file Streamlit app that covers the full order processing pipeline: fetch FAX images from email → AI parse → validate → generate PDF labels → optionally sync to Google Sheets. It works correctly, but:

- **Streamlit cold-start** takes 3–8 seconds per page interaction (full Python re-run)
- **UI is rigid**: layout, fonts, colors, and interactivity are constrained by Streamlit components
- **No persistent state**: every re-render re-reads config files and re-instantiates clients
- **Single-user, single-process**: no concurrency, no background jobs

### v4 Goals
| Goal | Measure of Success |
|---|---|
| Sub-second UI interactions | All client-side interactions < 200 ms |
| Modern, branded UI | Custom dashboard layout with Japanese typography |
| Decoupled architecture | Frontend and backend independently deployable |
| Full feature parity | All v3 features working in v4 |
| Maintainability | Clear separation of concerns; no 1200-line files |

---

## 2. Proposed Tech Stack & Architecture

### Stack

| Layer | Technology | Justification |
|---|---|---|
| Frontend | **Next.js 15** (App Router, TypeScript) | React server components + client interactivity; excellent Japanese font support via next/font |
| Backend API | **FastAPI** (Python 3.11+) | Keeps all existing Python logic intact; async support; auto-generates OpenAPI docs |
| Auth | **Supabase Auth** | Already provisioned (hynedtzwxuinruxsxvlm); JWT sessions |
| Database | **Supabase Postgres** | Already provisioned; stores orders, verifications, config master data |
| PDF Generation | **ReportLab** (existing) | Migrated as-is into FastAPI endpoint; no rewrite needed |
| AI Parsing | **Gemini API** (existing) | Migrated as-is; `gemini-2.5-flash` with existing prompt |
| Storage | **Supabase Storage** | FAX images uploaded here; signed URLs passed to Gemini |
| Background Jobs | **FastAPI BackgroundTasks** | Async email polling; no extra infra needed for v1 |
| Deployment | **Vercel** (Next.js) + **Railway / Fly.io** (FastAPI) | Zero-config deployments; free tiers sufficient |

### Architecture Diagram

```
┌─────────────────────────────────────────────────────┐
│                   Browser (Next.js)                  │
│  /login  /dashboard/verifications  /dashboard/orders │
│  /dashboard/products  /dashboard/config              │
└───────────────┬─────────────────────────────────────┘
                │ HTTPS (JWT in cookie)
┌───────────────▼─────────────────────────────────────┐
│              FastAPI Backend (:8000)                 │
│                                                      │
│  POST /api/ocr/parse          ← image → Gemini       │
│  POST /api/ocr/verify         ← corrected lines      │
│  GET  /api/orders             ← list orders          │
│  GET  /api/orders/{id}/pdf    ← generate PDF         │
│  GET  /api/email/fetch        ← IMAP poll            │
│  CRUD /api/config/*           ← stores, items, units │
└───────┬───────────────────────────────────┬──────────┘
        │ SQL (RLS)                          │ Supabase Storage
┌───────▼──────────────┐          ┌─────────▼──────────┐
│  Supabase Postgres   │          │  Supabase Storage  │
│  (existing schema)   │          │  (fax-images bucket)│
└──────────────────────┘          └────────────────────┘
```

---

## 3. UI/UX Improvement Plan

### Current Streamlit Constraints
- Fixed sidebar layout; no custom nav
- Tables use `st.dataframe` (read-only) or `st.data_editor` (functional but slow)
- No optimistic UI; every button click triggers full page reload
- No keyboard shortcuts; no drag-and-drop
- Font rendering is inconsistent on Windows

### v4 Dashboard Layout

```
┌──────────────────────────────────────────────────────────────┐
│ 🌿 小島農園  [検証待ち 3]   [注文]   [商品]   [設定]   田中 ▾  │  ← Top nav
├──────┬───────────────────────────────────────────────────────┤
│      │                                                        │
│ Side │   Main Content Area                                    │
│  bar │   (route-based, full height)                          │
│      │                                                        │
└──────┴───────────────────────────────────────────────────────┘
```

#### Key Screen: OCR Verification (`/dashboard/verifications`)

```
┌─ FAX画像 ──────────────┐  ┌─ 解析結果 (編集可) ──────────────┐
│                        │  │ 店舗    品目    箱数  端数  総数  │
│  [FAX image preview]   │  │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                        │  │ 山田商店 胡瓜   3    5    95   ✏ │
│                        │  │ 山田商店 長ネギ  2    0    100  ✏ │
│                        │  │ + 行を追加                       │
│                        │  ├─────────────────────────────────┤
│                        │  │ [却下]              [✓ 承認・PDF] │
└────────────────────────┘  └─────────────────────────────────┘
```

- **Side-by-side layout**: FAX image left, editable grid right — impossible in Streamlit
- **Inline editing**: click a cell to edit (React state, no round-trip until submit)
- **Optimistic confirmation**: PDF download starts immediately on approve
- **Confidence highlighting**: low-confidence cells highlighted in amber

#### Key Screen: PDF Labels
- Preview rendered in-browser via `/api/orders/{id}/pdf` (streamed PDF)
- One-click download without page reload

### Typography
- `Noto Sans JP` via `next/font/google` — crisp Japanese rendering at all sizes
- Consistent `16px` base; no Streamlit widget font overrides needed

---

## 4. Data Flow

```
1. EMAIL FETCH
   Cron / manual trigger
        │
        ▼
   FastAPI: email_reader.py (IMAP)
   → downloads image attachments
   → uploads to Supabase Storage (fax-images/{date}/{uuid}.jpg)
   → creates ocr_verifications row (status: pending, image_url: signed URL)

2. OCR PARSE
   User opens /dashboard/verifications
        │
        ▼
   Next.js fetches pending verifications from Supabase (direct RLS query)
   User clicks "解析" on a pending row
        │
        ▼
   POST /api/ocr/parse { verification_id }
   FastAPI: downloads image → Gemini API (existing prompt + item master)
   → returns parsed_lines JSON, confidence_flags
   → stores in ocr_verifications.raw_ocr_json, parsed_lines, confidence_flags
   → status: needs_review

3. HUMAN VERIFICATION
   User reviews/edits table in browser (React state only — no DB writes yet)
   User clicks "承認・PDF"
        │
        ▼
   POST /api/ocr/verify { verification_id, corrected_lines, order_date }
   FastAPI: calls approve_ocr_verification() RPC (existing Supabase function)
   → creates orders + order_lines rows
   → status: corrected

4. PDF GENERATION
   Same POST /api/ocr/verify response includes order_id
        │
        ▼
   GET /api/orders/{order_id}/pdf
   FastAPI: queries order + lines → LabelPDFGenerator (existing ReportLab code)
   → streams PDF as application/pdf
   Browser: triggers download

5. GOOGLE SHEETS SYNC (optional)
   POST /api/orders/{order_id}/sync-sheets
   FastAPI: delivery_converter + delivery_sheet_writer (existing code, unchanged)
```

---

## 5. Core Logic Migration Strategy

All existing Python business logic is **migrated without rewriting**. Only the Streamlit UI layer is replaced.

| v3 File | v4 Location | Change |
|---|---|---|
| `email_reader.py` | `backend/app/services/email_reader.py` | None — copy as-is |
| `pdf_generator.py` | `backend/app/services/pdf_generator.py` | None — copy as-is |
| `config_manager.py` | `backend/app/services/config_manager.py` | Reads from Supabase tables instead of JSON files |
| `email_config_manager.py` | `backend/app/services/email_config_manager.py` | Reads from Supabase `email_config` table |
| `delivery_converter.py` | `backend/app/services/delivery_converter.py` | None — copy as-is |
| `delivery_sheet_writer.py` | `backend/app/services/delivery_sheet_writer.py` | None — copy as-is |
| `app.py` (Gemini prompt) | `backend/app/services/ocr_parser.py` | Extract prompt + `validate_and_fix_order_data()` logic |
| `app.py` (label logic) | `backend/app/services/label_builder.py` | Extract `generate_labels_from_data()` |

### Critical Logic: The "×数字" Rule (must preserve exactly)

```python
# In ocr_parser.py — this logic MUST be preserved verbatim in the Gemini prompt:
# 「×数字」が総数の品目：boxes = 総数÷unit（切り捨て）, remainder = 総数 - unit×boxes
# Exception: items with receive_as_boxes=True (e.g. 胡瓜平箱) → ×数字 = boxes directly

# In label_builder.py — this logic MUST be preserved verbatim:
total_boxes = boxes + (1 if remainder > 0 else 0)
# Full boxes: quantity = unit, sequence = i+1 / total_boxes, is_fraction = False
# Last box:   quantity = remainder, sequence = total_boxes / total_boxes, is_fraction = True
```

### Config Migration: JSON → Supabase
v3 uses flat JSON files under `config/`. v4 maps these to existing Supabase tables:

| v3 JSON | v4 Supabase Table |
|---|---|
| `stores.json` | `customers` |
| `items.json` | `products` |
| `units.json` | `product_standards` |
| `item_settings.json` | `product_standards` (unit_type, receipt_mode columns) |

---

## 6. Step-by-Step Implementation Plan

### Phase 1: Backend Foundation (Week 1)

1. **Scaffold FastAPI project**
   ```
   backend/
     app/
       main.py          ← FastAPI app + CORS + JWT middleware
       routers/
         ocr.py         ← /api/ocr/*
         orders.py      ← /api/orders/*
         email.py       ← /api/email/*
         config.py      ← /api/config/*
       services/        ← migrated Python files (copy from v3)
       models.py        ← Pydantic schemas matching DB tables
     requirements.txt
   ```

2. **Copy all v3 service files** into `backend/app/services/` unchanged

3. **Implement `POST /api/ocr/parse`**
   - Accept `{ verification_id }`
   - Download image from Supabase Storage
   - Run existing Gemini logic + `validate_and_fix_order_data()`
   - Return `{ parsed_lines, confidence_flags }`

4. **Implement `POST /api/ocr/verify`**
   - Call existing `approve_ocr_verification()` Supabase RPC
   - Return `{ order_id }`

5. **Implement `GET /api/orders/{id}/pdf`**
   - Query order + lines from Supabase
   - Run existing `LabelPDFGenerator`
   - Stream as `application/pdf`

6. **Implement `GET /api/email/fetch`**
   - Run existing `email_reader.py`
   - Upload images to Supabase Storage
   - Insert `ocr_verifications` rows

### Phase 2: Next.js Frontend (Week 2)

7. **Scaffold Next.js app** (already done: `kojima-farm-app-v4`)

8. **Implement `/dashboard/verifications`**
   - Fetch pending verifications via Supabase JS client (direct RLS query)
   - Image preview + editable table (React state)
   - "解析" button → POST `/api/ocr/parse`
   - "承認・PDF" button → POST `/api/ocr/verify` then GET `/api/orders/{id}/pdf`

9. **Implement `/dashboard/orders`**
   - List orders with status, date, customer summary
   - PDF download per order

10. **Implement `/dashboard/products` and `/dashboard/config`**
    - CRUD for products, product_standards, customers
    - Config for email settings

### Phase 3: Polish & Deploy (Week 3)

11. **Confidence highlighting** — amber background on cells where `confidence_flags` indicates low confidence
12. **Email auto-poll** — configurable interval via Supabase `email_config` table; FastAPI BackgroundTasks
13. **Google Sheets sync button** on order detail page
14. **Deploy**: FastAPI → Railway (Dockerfile); Next.js → Vercel (automatic from repo)
15. **E2E test**: full pipeline with real FAX image from v3 test data

---

## 7. Risk Register

| Risk | Mitigation |
|---|---|
| Gemini prompt produces different results after migration | Copy prompt string verbatim; add assertion tests on known FAX images |
| PDF layout differs from v3 | Run both generators on same data; diff output visually |
| `receive_as_boxes` logic silently broken | Unit test `label_builder.py` with 胡瓜平箱 case |
| IMAP credentials in Supabase not encrypted at rest | Use Supabase Vault or env vars; never store in plaintext columns |
| ReportLab `ipaexg.ttf` font path breaks in Docker | Bundle font in `backend/assets/`; use absolute path via `__file__` |

---

## Appendix: Directory Structure (Target)

```
kojima-farm-app-v4/
├── frontend/                    ← Next.js (existing app/)
│   ├── app/
│   │   ├── dashboard/
│   │   │   ├── verifications/
│   │   │   ├── orders/
│   │   │   ├── products/
│   │   │   └── config/
│   │   └── login/
│   └── lib/supabase/
│
└── backend/                     ← FastAPI (new)
    ├── app/
    │   ├── main.py
    │   ├── routers/
    │   ├── services/            ← v3 Python files migrated here
    │   └── models.py
    ├── assets/
    │   └── ipaexg.ttf
    └── requirements.txt
```

---

**Next step (pending your approval):** Begin Phase 1 — scaffold `backend/` and implement the three core API endpoints.
