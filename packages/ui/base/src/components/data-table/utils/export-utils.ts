"use client";

import { toast } from "sonner";

// Generic type for exportable data - should have string keys and values that can be converted to string
// Allow arrays for hierarchical data (subRows)
/** The subset of the ExcelJS surface this module uses. */
interface ExcelJSWorksheet {
  columns: { header: string; key: string; width: number }[];
  addRow(row: Record<string, unknown>): void;
  getRow(index: number): { font: unknown; fill: unknown };
}

interface ExcelJSWorkbook {
  addWorksheet(name: string): ExcelJSWorksheet;
  xlsx: { writeBuffer(): Promise<ArrayBuffer> };
}

/**
 * ExcelJS ships a minified bundle for size, loaded first, with the regular
 * entry as fallback. The minified path has no declarations (see
 * `src/types/exceljs-dist.d.ts`), so the shape is verified at runtime rather
 * than asserted.
 */
interface ExcelJSRuntime {
  Workbook: new () => ExcelJSWorkbook;
}

function isExcelJSRuntime(value: unknown): value is ExcelJSRuntime {
  return (
    typeof value === 'object' &&
    value !== null &&
    'Workbook' in value &&
    typeof Reflect.get(value, 'Workbook') === 'function'
  );
}

function requireExcelJSRuntime(value: unknown): ExcelJSRuntime {
  if (!isExcelJSRuntime(value)) {
    throw new Error('exceljs module did not expose a Workbook constructor');
  }
  return value;
}

async function loadExcelJS(): Promise<ExcelJSRuntime> {
  try {
    const minified = await import('exceljs/dist/exceljs.min.js');
    return requireExcelJSRuntime(minified.default);
  } catch {
    const regular = await import('exceljs');
    return requireExcelJSRuntime(regular.default);
  }
}

export type ExportableData = Record<string, unknown>;

/**
 * Flatten hierarchical data for export
 */
export function flattenHierarchicalData<T extends ExportableData>(
  data: T[],
  subRowsField = 'subRows',
  includeDepth = false
): T[] {
  const flattened: T[] = [];

  const flatten = (items: T[], depth = 0) => {
    items.forEach((item) => {
      const { [subRowsField]: subRows, ...itemData } = item as Record<string, unknown>;
      flattened.push(
        includeDepth
          ? ({ ...itemData, _depth: depth } as unknown as T)
          : (itemData as unknown as T)
      );

      if (subRows && Array.isArray(subRows) && subRows.length > 0) {
        flatten(subRows, depth + 1);
      }
    });
  };

  flatten(data);
  return flattened;
}

/**
 * Export only parent rows (remove subrows)
 */
export function exportParentRowsOnly<T extends ExportableData>(
  data: T[],
  subRowsField = 'subRows'
): T[] {
  return data.map((item) => {
    const { [subRowsField]: _, ...parentData } = item as Record<string, unknown>;
    return parentData as T;
  });
}

// Type for transformation function that developers can provide
export type DataTransformFunction<T extends ExportableData> = (row: T) => ExportableData;

/**
 * Convert array of objects to CSV string
 */
function convertToCSV<T extends ExportableData>(
  data: T[], 
  headers: string[], 
  columnMapping?: Record<string, string>,
  transformFunction?: DataTransformFunction<T>
): string {
  if (data.length === 0) {
    throw new Error("No data to export");
  }

  // Create CSV header row with column mapping if provided
  let csvContent = "";

  if (columnMapping) {
    // Use column mapping for header names
    const headerRow = headers.map(header => {
      const mappedHeader = columnMapping[header] || header;
      // Escape quotes and wrap in quotes if contains comma
      return mappedHeader.includes(",") || mappedHeader.includes('"')
        ? `"${mappedHeader.replace(/"/g, '""')}"`
        : mappedHeader;
    });
    csvContent = `${headerRow.join(",")}\n`;
  } else {
    // Use original headers
    csvContent = `${headers.join(",")}\n`;
  }

  // Add data rows
  for (const item of data) {
    // Apply transformation function if provided
    const transformedItem = transformFunction ? transformFunction(item) : item;
    
    const row = headers.map(header => {
      // Get the value for this header from the transformed item
      const value = transformedItem[header];

      // Convert all values to string and properly escape for CSV
      const cellValue = value === null || value === undefined ? "" : String(value);
      // Escape quotes and wrap in quotes if contains comma
      const escapedValue = cellValue.includes(",") || cellValue.includes('"')
        ? `"${cellValue.replace(/"/g, '""')}"`
        : cellValue;

      return escapedValue;
    });

    csvContent += `${row.join(",")}\n`;
  }

  return csvContent;
}

/**
 * Download blob as file
 */
function downloadFile(blob: Blob, filename: string) {
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);

  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = "hidden";

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Export data to CSV file
 */
export function exportToCSV<T extends ExportableData>(
  data: T[],
  filename: string,
  headers: string[] = Object.keys(data[0] || {}),
  columnMapping?: Record<string, string>,
  transformFunction?: DataTransformFunction<T>
): boolean {
  if (data.length === 0) {
    console.error("No data to export");
    return false;
  }

  try {
    // Apply transformation function first if provided, then filter data to only include specified headers
    const processedData = data.map(item => {
      // Apply transformation function if provided
      const transformedItem = transformFunction ? transformFunction(item) : item;
      
      // Filter to only include specified headers
      const filteredItem: ExportableData = {};
      for (const header of headers) {
        if (header in transformedItem) {
          filteredItem[header] = transformedItem[header];
        }
      }
      return filteredItem;
    });

    const csvContent = convertToCSV(processedData, headers, columnMapping);
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    downloadFile(blob, `${filename}.csv`);
    return true;
  } catch (error) {
    console.error("Error creating CSV:", error);
    return false;
  }
}

/**
 * Export data to Excel file using ExcelJS (secure alternative to xlsx)
 */
export async function exportToExcel<T extends ExportableData>(
  data: T[],
  filename: string,
  columnMapping?: Record<string, string>,
  columnWidths?: { wch: number }[],
  headers?: string[],
  transformFunction?: DataTransformFunction<T>
): Promise<boolean> {
  if (typeof window === "undefined") {
    console.error("Excel export is only available in the browser");
    return false;
  }

  if (data.length === 0) {
    console.error("No data to export");
    return false;
  }

  try {
    const ExcelJS = await loadExcelJS();

    // If no column mapping is provided, create one from the data keys
    const mapping = columnMapping ||
      Object.keys(data[0] || {}).reduce<Record<string, string>>((acc, key) => {
        acc[key] = key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ');
        return acc;
      }, {});

    // Create a new workbook and worksheet
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Data");

    // Determine columns to export
    const columnsToExport = headers || Object.keys(mapping);

    // Set up columns with headers and widths
    worksheet.columns = columnsToExport.map((key, index) => ({
      header: mapping[key] || key,
      key: key,
      width: columnWidths?.[index]?.wch || 15, // Default width of 15 if not specified
    }));

    // Apply transformation function first if provided, then add data rows
    data.forEach(item => {
      const transformedItem = transformFunction ? transformFunction(item) : item;

      const row: Record<string, any> = {};
      for (const key of columnsToExport) {
        if (key in transformedItem) {
          row[key] = transformedItem[key];
        }
      }
      worksheet.addRow(row);
    });

    // Style the header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    // Generate Excel file buffer
    const buffer = await workbook.xlsx.writeBuffer();

    // Create blob and download
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });

    downloadFile(blob, `${filename}.xlsx`);
    return true;
  } catch (error) {
    console.error("Error creating Excel file:", error);
    return false;
  }
}

/**
 * Unified export function that handles loading states and error handling
 */
export async function exportData<T extends ExportableData>(
  type: "csv" | "excel",
  getData: () => Promise<T[]>,
  onLoadingStart?: () => void,
  onLoadingEnd?: () => void,
  options?: {
    headers?: string[];
    columnMapping?: Record<string, string>;
    columnWidths?: { wch: number }[];
    entityName?: string;
    transformFunction?: DataTransformFunction<T>;
  }
): Promise<boolean> {
  // Use a consistent toast ID to ensure only one toast is shown at a time
  const TOAST_ID = "export-data-toast";
  
  try {
    // Start loading
    if (onLoadingStart) onLoadingStart();

    // Show toast for long operations using consistent ID
    toast.loading("Preparing export...", {
      description: "Fetching data for export...",
      id: TOAST_ID
    });

    // Get the data
    const exportData = await getData();

    // Update the same toast for processing
    toast.loading("Processing data...", {
      description: "Generating export file...",
      id: TOAST_ID
    });

    if (exportData.length === 0) {
      toast.error("Export failed", {
        description: "No data available to export.",
        id: TOAST_ID
      });
      return false;
    }

    // Get entity name for display in notifications
    const entityName = options?.entityName || "items";

    // Generate timestamp for filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `${entityName}-export-${timestamp}`;

    // Export based on type
    let success = false;
    if (type === "csv") {
      success = exportToCSV(
        exportData,
        filename,
        options?.headers,
        options?.columnMapping,
        options?.transformFunction
      );
      if (success) {
        toast.success("Export successful", {
          description: `Exported ${String(exportData.length)} ${entityName} to CSV.`,
          id: TOAST_ID
        });
      }
    } else {
      success = await exportToExcel(
        exportData,
        filename,
        options?.columnMapping,
        options?.columnWidths,
        options?.headers,
        options?.transformFunction
      );
      if (success) {
        toast.success("Export successful", {
          description: `Exported ${String(exportData.length)} ${entityName} to Excel.`,
          id: TOAST_ID
        });
      }
    }

    return success;
  } catch (error) {
    console.error("Error exporting data:", error);
    
    toast.error("Export failed", {
      description: "There was a problem exporting the data. Please try again.",
      id: TOAST_ID
    });
    return false;
  } finally {
    // End loading regardless of result
    if (onLoadingEnd) onLoadingEnd();
  }
}
