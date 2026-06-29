"use client";

import type { MonthlySales, ItemSales, CustomerSales, OpsStatus } from "@/app/actions/analytics-actions";

function fmt(n: number) {
  return n.toLocaleString("ja-JP");
}

function fmtYen(n: number) {
  return `¥${fmt(Math.round(n))}`;
}

function monthLabel(m: string) {
  const [y, mo] = m.split("-");
  return `${y}年${parseInt(mo)}月`;
}

// Simple SVG bar chart
function BarChart({ data, current }: { data: MonthlySales[]; current: string }) {
  const sorted = [...data].sort((a, b) => a.month.localeCompare(b.month)).slice(-6);
  const max = Math.max(...sorted.map((d) => Number(d.subtotal_excl_tax)), 1);
  const w = 60;
  const gap = 8;
  const totalW = sorted.length * (w + gap) - gap;
  const h = 120;

  return (
    <svg viewBox={`0 0 ${totalW} ${h + 24}`} className="w-full max-w-lg">
      {sorted.map((d, i) => {
        const val = Number(d.subtotal_excl_tax);
        const barH = Math.max(4, (val / max) * h);
        const x = i * (w + gap);
        const isCurrent = d.month === current;
        return (
          <g key={d.month}>
            <rect
              x={x}
              y={h - barH}
              width={w}
              height={barH}
              rx={3}
              fill={isCurrent ? "#16a34a" : "#86efac"}
            />
            <text
              x={x + w / 2}
              y={h + 14}
              textAnchor="middle"
              fontSize={9}
              fill="#6b7280"
            >
              {d.month.slice(5)}月
            </text>
          </g>
        );
      })}
    </svg>
  );
}

interface Props {
  monthly: MonthlySales[];
  items: ItemSales[];
  customers: CustomerSales[];
  ops: OpsStatus;
}

export function AnalyticsClient({ monthly, items, customers, ops }: Props) {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const prevMonth = (() => {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  })();

  const cur = monthly.find((m) => m.month === currentMonth);
  const prev = monthly.find((m) => m.month === prevMonth);

  const momRatio =
    cur && prev && Number(prev.subtotal_excl_tax) > 0
      ? ((Number(cur.subtotal_excl_tax) / Number(prev.subtotal_excl_tax) - 1) * 100).toFixed(1)
      : null;

  const curItems = items.filter((i) => i.month === currentMonth);
  const curCustomers = customers.filter((c) => c.month === currentMonth);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      <h1 className="text-xl font-semibold">売上ダッシュボード</h1>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="今月売上（税抜）"
          value={cur ? fmtYen(Number(cur.subtotal_excl_tax)) : "—"}
          sub={cur ? `税込 ${fmtYen(Number(cur.total_incl_tax))}` : undefined}
        />
        <KpiCard
          label="前月比"
          value={momRatio !== null ? `${Number(momRatio) >= 0 ? "+" : ""}${momRatio}%` : "—"}
          positive={momRatio !== null ? Number(momRatio) >= 0 : undefined}
        />
        <KpiCard
          label="今月受注数"
          value={cur ? `${cur.order_count}件` : "—"}
        />
        <KpiCard
          label="未承認受注"
          value={`${ops.pending_review_count}件`}
          alert={ops.pending_review_count > 0}
        />
      </div>

      {/* ops status */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="本日受注" value={`${ops.today_orders}件`} small />
        <KpiCard label="本日納品" value={`${ops.today_deliveries}件`} small />
        <KpiCard label="承認済" value={`${ops.approved_count}件`} small />
        <KpiCard label="出荷済" value={`${ops.shipped_count}件`} small />
      </div>

      {/* Monthly bar chart */}
      <div className="rounded-lg border p-4">
        <p className="text-sm font-medium mb-3">月別売上推移（税抜）</p>
        {monthly.length > 0 ? (
          <BarChart data={monthly} current={currentMonth} />
        ) : (
          <p className="text-sm text-muted-foreground">データなし</p>
        )}
      </div>

      {/* Item & Customer tables */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Item ranking */}
        <div className="rounded-lg border">
          <div className="p-3 border-b">
            <p className="text-sm font-medium">品目別売上（今月）</p>
          </div>
          {curItems.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">データなし</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left p-2 pl-3 font-medium">品目</th>
                  <th className="text-right p-2 font-medium">数量</th>
                  <th className="text-right p-2 pr-3 font-medium">金額</th>
                </tr>
              </thead>
              <tbody>
                {curItems
                  .sort((a, b) => Number(b.subtotal_excl_tax) - Number(a.subtotal_excl_tax))
                  .slice(0, 10)
                  .map((r) => (
                    <tr key={r.product_name} className="border-b last:border-0">
                      <td className="p-2 pl-3">{r.product_name}</td>
                      <td className="p-2 text-right text-muted-foreground">
                        {fmt(Number(r.total_qty))}{r.unit}
                      </td>
                      <td className="p-2 pr-3 text-right font-mono">
                        {fmtYen(Number(r.subtotal_excl_tax))}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Customer ranking */}
        <div className="rounded-lg border">
          <div className="p-3 border-b">
            <p className="text-sm font-medium">納入先別売上（今月）</p>
          </div>
          {curCustomers.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">データなし</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left p-2 pl-3 font-medium">納入先</th>
                  <th className="text-right p-2 font-medium">受注数</th>
                  <th className="text-right p-2 pr-3 font-medium">金額</th>
                </tr>
              </thead>
              <tbody>
                {curCustomers
                  .sort((a, b) => Number(b.total_incl_tax) - Number(a.total_incl_tax))
                  .map((r) => (
                    <tr key={r.customer_name} className="border-b last:border-0">
                      <td className="p-2 pl-3">{r.customer_name}</td>
                      <td className="p-2 text-right text-muted-foreground">
                        {r.order_count}件
                      </td>
                      <td className="p-2 pr-3 text-right font-mono">
                        {fmtYen(Number(r.total_incl_tax))}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Monthly trend table */}
      <div className="rounded-lg border">
        <div className="p-3 border-b">
          <p className="text-sm font-medium">月別推移</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[480px]">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="text-left p-2 pl-3 font-medium">月</th>
                <th className="text-right p-2 font-medium">受注数</th>
                <th className="text-right p-2 font-medium">売上（税抜）</th>
                <th className="text-right p-2 font-medium">消費税</th>
                <th className="text-right p-2 pr-3 font-medium">合計（税込）</th>
              </tr>
            </thead>
            <tbody>
              {[...monthly]
                .sort((a, b) => b.month.localeCompare(a.month))
                .slice(0, 12)
                .map((r) => (
                  <tr key={r.month} className="border-b last:border-0">
                    <td className="p-2 pl-3">{monthLabel(r.month)}</td>
                    <td className="p-2 text-right text-muted-foreground">{r.order_count}件</td>
                    <td className="p-2 text-right font-mono">{fmtYen(Number(r.subtotal_excl_tax))}</td>
                    <td className="p-2 text-right font-mono text-muted-foreground">
                      {fmtYen(Number(r.total_tax))}
                    </td>
                    <td className="p-2 pr-3 text-right font-mono font-medium">
                      {fmtYen(Number(r.total_incl_tax))}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  positive,
  alert,
  small,
}: {
  label: string;
  value: string;
  sub?: string;
  positive?: boolean;
  alert?: boolean;
  small?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${alert ? "border-amber-400 bg-amber-50" : ""}`}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={`font-semibold mt-1 ${small ? "text-base" : "text-xl"} ${
          positive === true ? "text-green-600" : positive === false ? "text-red-500" : ""
        } ${alert ? "text-amber-700" : ""}`}
      >
        {value}
      </p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}
