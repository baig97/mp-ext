import * as XLSX from "xlsx";
import { InventoryItem, ParsedInventoryItem } from "_shared/types";

export async function fetchInventoryFromMoneypex(): Promise<ParsedInventoryItem[]> {
  const exportUrl = "https://pos.moneypex.com/Product/ExportProducts?SupplierId=&CategoryId=&SearchFilter_Name=&ProductTypeId=";

  const body = new URLSearchParams();
  body.append("SearchFilter.Name", "");
  body.append("SearchFilter.CategoryId", "");
  body.append("SearchFilter.SupplierId", "");
  body.append("SearchFilter.ProductTypeId", "");

  const response = await fetch(exportUrl, {
    method: "GET",
    mode: "cors",
    credentials: "include",
    headers: {
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
      "Upgrade-Insecure-Requests": "1"
    },
    referrer: "https://pos.moneypex.com/Product/Index",
    referrerPolicy: "strict-origin-when-cross-origin"
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch inventory: ${response.status}`);
  }

  const blob = await response.blob();
  const arrayBuffer = await blob.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const jsonData = XLSX.utils.sheet_to_json<InventoryItem>(worksheet, { defval: null });

  if (!jsonData || jsonData.length === 0) {
    throw new Error("No data found in the inventory file.");
  }

  // Validate and parse the data
  const parsedData: ParsedInventoryItem[] = jsonData.map((item) => {
    if (!item.Name || !item.Type || typeof item.SalePrice !== "string" || typeof item.PurchasePrice !== "string" || typeof item.Stock !== "string" || !item.IsActive) {
      throw new Error("Invalid inventory item format.");
    }

    return {
      Name: item.Name,
      Type: item.Type,
      Barcode: item.Barcode || null,
      SalePrice: parseFloat(item.SalePrice),
      PurchasePrice: parseFloat(item.PurchasePrice),
      Stock: parseInt(item.Stock, 10),
      IsActive: item.IsActive === "Yes",
    };
  });

  return parsedData;
}