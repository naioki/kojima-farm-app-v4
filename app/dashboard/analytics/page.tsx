import { getAnalytics } from "@/app/actions/analytics-actions";
import { AnalyticsClient } from "./_components/analytics-client";

export default async function AnalyticsPage() {
  const data = await getAnalytics();
  return <AnalyticsClient {...data} />;
}
