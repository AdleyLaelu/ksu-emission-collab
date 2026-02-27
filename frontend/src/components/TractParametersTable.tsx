import { useMemo } from "react";
import { Box } from "@mui/material";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import useAppStore from "../useAppStore";

type AnyRow = Record<string, any>;

function TractParametersTable({ trafficState, alignLeft }: { trafficState: any, alignLeft?: boolean }) {
  const theme = useAppStore((s) => s.theme);

  const rawHeaders: string[] = trafficState.trafficMFTParametersHeaders ?? [];
  const rawData = trafficState.trafficMFTParametersData ?? [];

  const getSafeField = (h: string) => String(h).replace(/[^\w\s]/gi, '_').trim();

  const columns: GridColDef[] = useMemo(() => {
    const align = alignLeft ? 'left' : 'center';
    
    const snoCol: GridColDef = {
      field: 'sno',
      headerName: '',
      width: 40,
      sortable: false,
      align: 'center', 
      headerAlign: 'center',
      cellClassName: 'sno-cell',
      resizable: false,
      disableColumnReorder: true,
    };
    
    const baseColumns = rawHeaders.map((h) => {
      const fieldKey = getSafeField(h);
      const headerName = h === "R^2" ? "R²" : String(h);
      const lowerName = headerName.toLowerCase();

      let width: number;

      // Adjusted dynamic width for slightly larger font (7.8px multiplier)
      if (lowerName.includes('tract id')) {
        width = 110; 
      } else {
        const tightCalculatedWidth = headerName.length * 7.8 + 15; 
        width = Math.max(90, Math.min(300, tightCalculatedWidth));
      }

      return {
        field: fieldKey,
        headerName,
        width, 
        sortable: false,
        align,
        headerAlign: align,
        resizable: false,
        disableColumnReorder: true,
      };
    });
    return [snoCol, ...baseColumns];
  }, [rawHeaders, alignLeft]);

  const allRows: AnyRow[] = useMemo(() => {
    if (!rawData?.length) return [];
    
    return rawData.map((row: any, idx: number) => {
      const normalizedRow: AnyRow = { id: idx + 1, sno: idx + 1 };
      if (Array.isArray(row)) {
        rawHeaders.forEach((h, i) => {
          normalizedRow[getSafeField(h)] = row[i] !== undefined ? row[i] : null;
        });
      } else {
        rawHeaders.forEach((h) => {
          const safeKey = getSafeField(h);
          normalizedRow[safeKey] = row[h] !== undefined ? row[h] : (row[safeKey] ?? null);
        });
      }
      return normalizedRow;
    });
  }, [rawData, rawHeaders]);

  return allRows.length ? (
    <Box className="min-w-[60%]" sx={{ minHeight: 0 }}>
      <div style={{ height: 400, width: "100%" }}>
        <DataGrid
          rows={allRows}
          columns={columns}
          getRowId={(r) => r.id}
          disableColumnMenu
          disableRowSelectionOnClick
          checkboxSelection={false}
          hideFooterPagination={true}
          slots={{ footer: () => null }}
          
          // Increased heights to accommodate larger 14px text
          rowHeight={30} 
          columnHeaderHeight={32}
          
          sx={{
            border: '1px solid #e5e5e5', 
            borderRadius: 0, 
            fontFamily: '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important',
            
            // INCREASED FONT SIZE TO MATCH REFERENCE
            fontSize: '14px !important', 
            
            color: theme === "dark" ? "#fff" : "#000000 !important", 
            opacity: 0.9, 

            "& .MuiDataGrid-columnHeaders": {
              backgroundColor: theme === "dark" ? "#333" : "#f0f0f0 !important", 
              borderBottom: '1px solid #e5e5e5',
            },
            "& .MuiDataGrid-columnHeader": {
              borderRight: '1px solid #e5e5e5',
              backgroundColor: theme === "dark" ? "#333" : "#f0f0f0 !important",
              fontWeight: '700 !important',
              padding: '0 4px !important',
            },
            "& .MuiDataGrid-columnHeaderTitle": {
              fontWeight: '700 !important',
              overflow: 'visible',
            },
            "& .MuiDataGrid-cell": {
              borderRight: '1px solid #f0f0f0', 
              borderBottom: '1px solid #f5f5f5', 
              padding: '0 4px !important',
              backgroundColor: theme === "dark" ? "#18181b" : "#ffffff !important",
              color: theme === "dark" ? "#e5e7eb" : "#000000 !important",
            },
            "& .sno-cell": {
              backgroundColor: theme === "dark" ? "#1f2937" : "#f0f0f0 !important", 
              borderRight: '1px solid #e5e5e5',
              fontWeight: '400 !important',
              fontSize: '13px !important', // Kept slightly smaller for serial numbers
            },
            "& .MuiDataGrid-row:hover": { backgroundColor: 'inherit' },
            "& .MuiDataGrid-cell:focus, & .MuiDataGrid-columnHeader:focus": { outline: "none" },
          }}
        />
      </div>
    </Box>
  ) : null;
}

export default TractParametersTable;