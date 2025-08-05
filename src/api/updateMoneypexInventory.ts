import * as XLSX from 'xlsx';
import { ParsedInventoryItem } from '_shared/types';
import { MONEYPEX_EXCEL_HEADERS } from '_shared/constants';

export function prepareMoneypexInventoryExcel(
  updatedItems: ParsedInventoryItem[],
  localInventoryMap: Record<string, number>
): Blob {

  const rows = updatedItems.map((item) => {
    const newStock = localInventoryMap[item.Barcode ?? ''] ?? item.Stock;

    return {
      'Barcode': item.Barcode || '',
      'Name': item.Name,
      'Code': '',
      'PurchasePrice(Unit)': item.PurchasePrice,
      'SalePrice(Unit)': item.SalePrice,
      'PackSalePrice': '',
      'CartonSalePrice': '',
      'Stock(Uint)': newStock,
      'QuantityInPack': '',
      'PackInCarton': '',
      'WeightUnits': '',
      'IsService': '',
      'ExpireDate': '',
      'IsAlert': '',
      'AlertMessage': '',
      'VATPercentage': '',
      'IsVAT': '',
      'IsSalesByQuantity': '',
      'IsParent': '',
      'ParentName': '',
      'CategoryName': '',
      'Sub Category': '',
      'Manufacture': '',
      'DiscountAmount': '',
      'Discount%': '',
      'DiscountExpireDate': '',
      'Description': '',
      'ShopName': '',
      'ExpiryAlert': '',
      'QuantityAlert': '',
      'TradePrice': '',
      'TradePackPrice': '',
      'TradeCartonPrice': ''
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(rows, { header: MONEYPEX_EXCEL_HEADERS });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');

  const arrayBuffer = XLSX.write(workbook, {
    bookType: 'xlsx',
    type: 'array'
  }) as Uint8Array;

  const blob = new Blob([arrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });

  return blob;
}

export async function uploadMoneypexInventoryExcel(blob: Blob): Promise<void> {
  const formData = new FormData();
  formData.append('File', new File([blob], 'ProductImport.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  }));
  formData.append('isAddForSync', 'true');

  const response = await fetch('https://pos.moneypex.com/Product/ImportProduct', {
    method: 'POST',
    mode: 'cors',
    credentials: 'include',
    headers: {
      'accept': '*/*',
      'x-requested-with': 'XMLHttpRequest'
    },
    referrer: 'https://pos.moneypex.com/Product/ImportProduct',
    referrerPolicy: 'strict-origin-when-cross-origin',
    body: formData
  });

  if (!response.ok) {
    const text = await response.text();
    console.error('❌ Upload failed:', text);
    throw new Error(`Upload failed: ${response.status}`);
  }

  console.log('✅ Inventory uploaded to Moneypex.');
}

export async function updateMoneypexInventory(
  updatedItems: ParsedInventoryItem[],
  localInventory: ParsedInventoryItem[]
): Promise<void> {
  // Create a map of barcode to stock quantity from local inventory
  const localInventoryMap: Record<string, number> = {};
  localInventory.forEach(item => {
    if (item.Barcode) {
      localInventoryMap[item.Barcode] = item.Stock;
    }
  });

  // Update the local inventory stock with the updated items
  updatedItems.forEach(updatedItem => {
    if (updatedItem.Barcode) {
      localInventoryMap[updatedItem.Barcode] = updatedItem.Stock;
    }
  });

  // Prepare and upload the Excel file
  const blob = prepareMoneypexInventoryExcel(updatedItems, localInventoryMap);
  await uploadMoneypexInventoryExcel(blob);
}

