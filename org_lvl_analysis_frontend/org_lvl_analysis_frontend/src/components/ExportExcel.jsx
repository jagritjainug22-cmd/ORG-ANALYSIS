import React, { useState } from "react";
import { exportExcel } from "../api/backend";

export default function ExportExcel({ df }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleExport = async () => {
    if (!df || df.length === 0) {
      setError("No data available to export");
      setTimeout(() => setError(null), 3000);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const blob = await exportExcel(df);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `org_data_export_${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      console.log("✅ Excel exported successfully");
    } catch (err) {
      console.error("❌ Export failed:", err);
      setError("Export failed. Please try again.");
      setTimeout(() => setError(null), 3000);
    } finally {
      setLoading(false);
    }
  };

  const hasData = df && df.length > 0;

  return (
    <div className="space-y-3">
      {/* Export Card */}
      <button
        onClick={handleExport}
        disabled={!hasData || loading}
        className={`w-full text-left p-4 rounded-lg border-2 transition-all duration-200 ${
          hasData && !loading
            ? "bg-gradient-to-br from-brand-50 to-brand-100 border-brand-200 hover:border-brand-300 hover:shadow-md cursor-pointer"
            : "bg-gray-50 border-gray-200 cursor-not-allowed opacity-60"
        }`}>
      
        <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
            hasData && !loading
              ? "bg-gradient-to-br from-brand-700 to-brand-500"
              : "bg-gray-400"
          }`}>
            {loading ? (
              <svg
                className="animate-spin h-5 w-5 text-white"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
            ) : (
              <svg
                className="w-5 h-5 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            )}
          </div>
          
          <div className="flex-1">
            <p className={`font-semibold text-sm ${
              hasData && !loading ? "text-gray-900" : "text-gray-500"
            }`}>
              {loading ? "Exporting..." : "Export to Excel"}
            </p>
            <p className={`text-xs mt-0.5 ${
              hasData && !loading ? "text-gray-600" : "text-gray-400"
            }`}>
              {hasData
                ? `${df.length.toLocaleString()} rows available`
                : "No data to export"}
            </p>
          </div>

          {hasData && !loading && (
            <svg
              className="w-5 h-5 text-brand-600 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
          )}
        </div>
      </button>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 animate-fadeIn">
          <div className="flex items-center gap-2">
            <svg
              className="w-4 h-4 text-red-600 flex-shrink-0"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                clipRule="evenodd"
              />
            </svg>
            <p className="text-xs text-red-700 font-medium">{error}</p>
          </div>
        </div>
      )}

      {/* Info Text */}
      {hasData && !loading && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <div className="flex items-start gap-2">
            <svg
              className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                clipRule="evenodd"
              />
            </svg>
            <p className="text-xs text-blue-700">
              Exports current module's data as Excel file
            </p>
          </div>
        </div>
      )}
    </div>
  );
}