import {
  getCustomers,
  getProducts,
  getProductStandards,
  getPriceMaster,
} from "./_actions/master-actions";
import { CustomersTab } from "./_components/customers-tab";
import { ProductsTab } from "./_components/products-tab";
import { ProductStandardsTab } from "./_components/product-standards-tab";
import { PriceMasterTab } from "./_components/price-master-tab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";

export const runtime = "edge";

export default async function MasterPage() {
  const [customersResult, productsResult, standardsResult, pricesResult] =
    await Promise.all([
      getCustomers(),
      getProducts(),
      getProductStandards(),
      getPriceMaster(),
    ]);

  const hasError =
    !customersResult.success ||
    !productsResult.success ||
    !standardsResult.success ||
    !pricesResult.success;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">マスターデータ管理</h1>
        <p className="text-sm text-muted-foreground mt-1">
          顧客・商品・規格・価格マスターを管理します
        </p>
      </div>

      {hasError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>データの取得に一部失敗しました</AlertTitle>
          <AlertDescription>
            {!customersResult.success && `顧客: ${customersResult.error} `}
            {!productsResult.success && `商品: ${productsResult.error} `}
            {!standardsResult.success && `規格: ${standardsResult.error} `}
            {!pricesResult.success && `価格: ${pricesResult.error}`}
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="customers">
        <TabsList>
          <TabsTrigger value="customers">
            顧客{customersResult.success ? ` (${customersResult.data.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="products">
            商品{productsResult.success ? ` (${productsResult.data.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="standards">
            規格{standardsResult.success ? ` (${standardsResult.data.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="prices">
            価格マスター{pricesResult.success ? ` (${pricesResult.data.length})` : ""}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="customers" className="mt-4">
          <CustomersTab customers={customersResult.success ? customersResult.data : []} />
        </TabsContent>

        <TabsContent value="products" className="mt-4">
          <ProductsTab products={productsResult.success ? productsResult.data : []} />
        </TabsContent>

        <TabsContent value="standards" className="mt-4">
          <ProductStandardsTab
            standards={standardsResult.success ? standardsResult.data : []}
            products={productsResult.success ? productsResult.data : []}
          />
        </TabsContent>

        <TabsContent value="prices" className="mt-4">
          <PriceMasterTab priceMaster={pricesResult.success ? pricesResult.data : []} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
