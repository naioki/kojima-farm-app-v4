"use client";

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
} from "@react-pdf/renderer";
import type { Invoice, InvoiceItem, CompanySettings } from "@/app/actions/invoice-actions";

// システムフォントを使用（日本語対応）
Font.registerHyphenationCallback((word) => [word]);

const S = StyleSheet.create({
  page: { padding: 40, fontSize: 9, fontFamily: "Helvetica", color: "#111" },
  row: { flexDirection: "row" },
  col: { flexDirection: "column" },

  // ヘッダー
  headerSection: { flexDirection: "row", marginBottom: 20 },
  issuerBlock: { flex: 1 },
  metaBlock: { width: 200, alignItems: "flex-end" },
  issuerName: { fontSize: 13, fontFamily: "Helvetica-Bold", marginBottom: 3 },
  issuerSub: { fontSize: 8, color: "#555", lineHeight: 1.6 },
  docTitle: { fontSize: 18, fontFamily: "Helvetica-Bold", marginBottom: 6 },
  metaLine: { fontSize: 8, color: "#333", lineHeight: 1.8 },

  // 請求先
  billToSection: { marginBottom: 14 },
  billToName: { fontSize: 11, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  billToLabel: { fontSize: 8, color: "#555" },

  // 区切り線
  divider: { borderBottomWidth: 0.5, borderBottomColor: "#999", marginVertical: 6 },
  thickDivider: { borderBottomWidth: 1, borderBottomColor: "#333", marginVertical: 6 },

  // 明細テーブル
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderTopWidth: 0.5,
    borderTopColor: "#aaa",
    borderBottomWidth: 0.5,
    borderBottomColor: "#aaa",
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 3,
    paddingHorizontal: 4,
    borderBottomWidth: 0.3,
    borderBottomColor: "#ddd",
  },
  colName: { flex: 3 },
  colQty: { width: 50, textAlign: "right" },
  colUnit: { width: 30, textAlign: "center" },
  colPrice: { width: 60, textAlign: "right" },
  colAmount: { width: 65, textAlign: "right" },
  colTax: { width: 30, textAlign: "center" },
  thText: { fontSize: 8, fontFamily: "Helvetica-Bold", color: "#444" },
  tdText: { fontSize: 8 },

  // 合計
  totalSection: { marginTop: 10, alignItems: "flex-end" },
  totalRow: { flexDirection: "row", paddingVertical: 2, width: 240 },
  totalLabel: { flex: 1, fontSize: 8, color: "#555", textAlign: "right", paddingRight: 8 },
  totalValue: { width: 80, fontSize: 8, textAlign: "right", fontFamily: "Helvetica" },
  grandTotalRow: {
    flexDirection: "row",
    paddingVertical: 4,
    width: 240,
    borderTopWidth: 1,
    borderTopColor: "#333",
    marginTop: 3,
  },
  grandLabel: { flex: 1, fontSize: 10, fontFamily: "Helvetica-Bold", textAlign: "right", paddingRight: 8 },
  grandValue: { width: 80, fontSize: 10, fontFamily: "Helvetica-Bold", textAlign: "right" },

  // フッター
  footer: { marginTop: 20, fontSize: 8, color: "#555" },
  footerNote: { marginTop: 4, fontSize: 7.5, color: "#666" },
  regNum: { marginTop: 6, fontSize: 8 },
});

function fmt(n: number) {
  return `\xA5${Math.round(n).toLocaleString()}`;
}

function fmtDate(s: string | null) {
  if (!s) return "—";
  return s.slice(0, 10);
}

interface Props {
  invoice: Invoice;
  items: InvoiceItem[];
  company: CompanySettings | null;
  customerName: string;
}

export function InvoicePDFDocument({ invoice, items, company, customerName }: Props) {
  const has8 = Number(invoice.subtotal_8) > 0;
  const has10 = Number(invoice.subtotal_10) > 0;
  const hasReducedRate = has8; // 8%は軽減税率

  return (
    <Document title={`請求書 ${invoice.invoice_number}`}>
      <Page size="A4" style={S.page}>
        {/* ヘッダー */}
        <View style={S.headerSection}>
          {/* 自社情報 */}
          <View style={S.issuerBlock}>
            <Text style={S.issuerName}>{company?.company_name ?? "（会社名未設定）"}</Text>
            {company?.postal_code && (
              <Text style={S.issuerSub}>〒{company.postal_code}</Text>
            )}
            {company?.address && (
              <Text style={S.issuerSub}>{company.address}</Text>
            )}
            {company?.tel && (
              <Text style={S.issuerSub}>TEL: {company.tel}</Text>
            )}
            {company?.fax && (
              <Text style={S.issuerSub}>FAX: {company.fax}</Text>
            )}
            {company?.invoice_reg_num && (
              <Text style={[S.issuerSub, { marginTop: 4 }]}>
                適格請求書発行事業者番号: {company.invoice_reg_num}
              </Text>
            )}
          </View>

          {/* 請求書メタ情報 */}
          <View style={S.metaBlock}>
            <Text style={S.docTitle}>請 求 書</Text>
            <Text style={S.metaLine}>請求番号: {invoice.invoice_number}</Text>
            <Text style={S.metaLine}>請求日: {fmtDate(invoice.issue_date)}</Text>
            <Text style={S.metaLine}>支払期日: {fmtDate(invoice.due_date)}</Text>
            {invoice.period_start && (
              <Text style={S.metaLine}>
                対象期間: {fmtDate(invoice.period_start)} 〜 {fmtDate(invoice.period_end)}
              </Text>
            )}
          </View>
        </View>

        <View style={S.thickDivider} />

        {/* 請求先 */}
        <View style={S.billToSection}>
          <Text style={S.billToLabel}>請求先</Text>
          <Text style={S.billToName}>{customerName} 御中</Text>
        </View>

        <View style={S.divider} />

        {/* 明細ヘッダー */}
        <View style={S.tableHeader}>
          <View style={S.colName}><Text style={S.thText}>品目</Text></View>
          <View style={S.colQty}><Text style={S.thText}>数量</Text></View>
          <View style={S.colUnit}><Text style={S.thText}>単位</Text></View>
          <View style={S.colPrice}><Text style={S.thText}>単価</Text></View>
          <View style={S.colAmount}><Text style={S.thText}>金額</Text></View>
          <View style={S.colTax}><Text style={S.thText}>税率</Text></View>
        </View>

        {/* 明細行 */}
        {items.map((item, i) => {
          const isReduced = item.tax_rate === 8;
          return (
            <View key={i} style={S.tableRow}>
              <View style={S.colName}>
                <Text style={S.tdText}>
                  {item.product_name}{isReduced && hasReducedRate ? " ※" : ""}
                </Text>
              </View>
              <View style={S.colQty}>
                <Text style={S.tdText}>{Number(item.quantity).toLocaleString()}</Text>
              </View>
              <View style={S.colUnit}>
                <Text style={S.tdText}>{item.unit}</Text>
              </View>
              <View style={S.colPrice}>
                <Text style={S.tdText}>{fmt(Number(item.unit_price))}</Text>
              </View>
              <View style={S.colAmount}>
                <Text style={S.tdText}>{fmt(Number(item.subtotal))}</Text>
              </View>
              <View style={S.colTax}>
                <Text style={S.tdText}>{item.tax_rate}%</Text>
              </View>
            </View>
          );
        })}

        {/* 合計 */}
        <View style={S.totalSection}>
          {has8 && (
            <>
              <View style={S.totalRow}>
                <Text style={S.totalLabel}>8%対象（税抜）{hasReducedRate ? " ※" : ""}</Text>
                <Text style={S.totalValue}>{fmt(Number(invoice.subtotal_8))}</Text>
              </View>
              <View style={S.totalRow}>
                <Text style={S.totalLabel}>消費税（8%）</Text>
                <Text style={S.totalValue}>{fmt(Number(invoice.tax_8))}</Text>
              </View>
            </>
          )}
          {has10 && (
            <>
              <View style={S.totalRow}>
                <Text style={S.totalLabel}>10%対象（税抜）</Text>
                <Text style={S.totalValue}>{fmt(Number(invoice.subtotal_10))}</Text>
              </View>
              <View style={S.totalRow}>
                <Text style={S.totalLabel}>消費税（10%）</Text>
                <Text style={S.totalValue}>{fmt(Number(invoice.tax_10))}</Text>
              </View>
            </>
          )}
          <View style={S.grandTotalRow}>
            <Text style={S.grandLabel}>合計（税込）</Text>
            <Text style={S.grandValue}>{fmt(Number(invoice.total_amount))}</Text>
          </View>
        </View>

        {/* フッター */}
        {company?.bank_info && (
          <View style={S.footer}>
            <Text>【お振込先】{company.bank_info}</Text>
          </View>
        )}

        {hasReducedRate && (
          <Text style={S.footerNote}>※ 軽減税率（8%）対象商品</Text>
        )}

        {company?.invoice_reg_num && (
          <Text style={S.regNum}>
            ※ この請求書は適格請求書（インボイス）です。
            登録番号: {company.invoice_reg_num}
          </Text>
        )}
      </Page>
    </Document>
  );
}
