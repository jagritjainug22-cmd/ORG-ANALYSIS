import React, { useState } from "react";
import { hierarchy as hierarchyBackend, dbSaveBaseline } from "../api/backend";

export default function Hierarchy({
  validatedDf,
  setValidatedDf,
  setDfRecords,
  empCol,
  mgrCol,
  flcCol,
  fteCol,
  jobTitleCol,
  countryCol,
  onBaselineSaved,
  uploadedFileName,
  formulas = [],
  datasetId = null,
}) {
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [saveStatus, setSaveStatus] = useState(null);

  const columns = validatedDf?.length ? Object.keys(validatedDf[0]) : [];
  const canRun = validatedDf?.length > 0 && empCol && mgrCol;

  const runPreview = async () => {
    if (!canRun) {
      setError("Please ensure data is loaded and Employee/Manager columns are selected.");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setSaveStatus(null);

    try {
      const res = await hierarchyBackend(
        validatedDf,
        empCol,
        mgrCol,
        flcCol || null,
        fteCol || null,
        false,
        jobTitleCol || null,
        datasetId || null
      );

      if (res.df) {
        setValidatedDf(res.df);
        setDfRecords?.(res.df);
      }
      setPreview(res.preview || []);
      setResult({
        rowsProcessed: res.rows_processed || res.df?.length || 0,
        maxDepth: res.max_depth || 0,
      });

      // Auto-save the processed dataset to the database as the baseline
      // for the OrgSight 2.0 modelling workflow.
      if (res.df && onBaselineSaved) {
        try {
          setSaveStatus({ state: "saving" });
          const saved = await dbSaveBaseline({
            name: uploadedFileName || `Dataset ${new Date().toLocaleString()}`,
            records: res.df,
            empCol,
            mgrCol,
            fteCol: fteCol || null,
            flcCol: flcCol || null,
            jobTitleCol: jobTitleCol || null,
            countryCol: countryCol || null,
          });
          const defaultScenario = (saved.scenarios || []).find((s) => s.name === "Baseline")
            || (saved.scenarios || [])[0];
          onBaselineSaved({
            datasetId: saved.dataset_id,
            scenarios: saved.scenarios || [],
            activeScenarioId: defaultScenario?.id ?? null,
          });
          setSaveStatus({ state: "saved", datasetId: saved.dataset_id });
        } catch (saveErr) {
          console.warn("Baseline save failed (org chart will still work in legacy mode):", saveErr);
          setSaveStatus({ state: "error", message: saveErr.message });
        }
      }
    } catch (err) {
      console.error("Hierarchy preview failed:", err);
      setError(err.response?.data?.detail || "Failed to compute hierarchy preview. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const downloadExcel = async () => {
    if (!canRun) return;

    try {
      await hierarchyBackend(
        validatedDf,
        empCol,
        mgrCol,
        flcCol || null,
        fteCol || null,
        true,
        jobTitleCol || null,
        datasetId || null
      );
    } catch (err) {
      console.error("Hierarchy download failed:", err);
      setError(err.response?.data?.detail || "Failed to download hierarchy Excel.");
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Section */}
      <div className="bg-am-50 border border-am-200 rounded-lg p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 bg-am-500 rounded-lg flex items-center justify-center flex-shrink-0">
            <svg
              className="w-7 h-7 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
              />
            </svg>
          </div>
          <div className="flex-1">
            <h3 className="text-xl font-bold text-gray-900 mb-2">
              Hierarchy Analysis
            </h3>
            <p className="text-sm text-gray-600">
              Compute organizational hierarchy levels, reporting chains, and span metrics for your data.
            </p>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-4">
        <button
          onClick={runPreview}
          disabled={!canRun || loading}
          className="flex-1 px-6 py-4 bg-am-500 hover:bg-am-600 text-white rounded-lg font-semibold shadow-lg hover:shadow-xl transition-all duration-200 disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed flex items-center justify-center gap-3"
        >
          {loading ? (
            <>
              <svg
                className="animate-spin h-6 w-6 text-white"
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
              <span className="text-lg">Computing Hierarchy...</span>
            </>
          ) : (
            <>
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                />
              </svg>
              <span className="text-lg">Run Hierarchy Analysis</span>
            </>
          )}
        </button>

        <button
          onClick={downloadExcel}
          disabled={!canRun || !preview || preview.length === 0}
          className="px-6 py-4 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white rounded-lg font-semibold shadow-lg hover:shadow-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-3"
        >
          <svg
            className="w-6 h-6"
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
          <span>Download Excel</span>
        </button>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3 animate-fadeIn">
          <svg
            className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
              clipRule="evenodd"
            />
          </svg>
          <div>
            <p className="font-medium text-red-900">Analysis Failed</p>
            <p className="text-sm text-red-700 mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Success Result */}
      {result && !error && (
        <div className="bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200 rounded-lg p-6 animate-fadeIn">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 bg-green-600 rounded-lg flex items-center justify-center">
              <svg
                className="w-7 h-7 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <div>
              <h4 className="font-bold text-green-900 text-lg">
                Hierarchy Analysis Complete!
              </h4>
              <p className="text-sm text-green-700">
                Organizational structure has been computed successfully
              </p>
            </div>
          </div>

          {saveStatus?.state === "saving" && (
            <div className="mb-4 text-xs font-medium text-blue-800 bg-blue-50 border border-blue-200 rounded-md px-3 py-2">
              Saving baseline to OrgSight database...
            </div>
          )}
          {saveStatus?.state === "saved" && (
            <div className="mb-4 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
              Baseline saved to database (dataset #{saveStatus.datasetId}). Open Org Chart to start modelling.
            </div>
          )}
          {saveStatus?.state === "error" && (
            <div className="mb-4 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              Could not auto-save baseline to database. The org chart will still work in legacy in-memory mode.
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white rounded-lg p-4 border border-green-200">
              <div className="flex items-center gap-2 mb-2">
                <svg
                  className="w-5 h-5 text-green-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                <span className="text-xs font-medium text-gray-600">Rows Processed</span>
              </div>
              <p className="text-2xl font-bold text-green-900">
                {result.rowsProcessed.toLocaleString()}
              </p>
            </div>

            <div className="bg-white rounded-lg p-4 border border-green-200">
              <div className="flex items-center gap-2 mb-2">
                <svg
                  className="w-5 h-5 text-green-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z"
                  />
                </svg>
                <span className="text-xs font-medium text-gray-600">Maximum Depth</span>
              </div>
              <p className="text-2xl font-bold text-green-900">
                {result.maxDepth} {result.maxDepth === 1 ? 'level' : 'levels'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Preview Table */}
      {preview && preview.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
            <h4 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <svg
                className="w-5 h-5 text-am-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                />
              </svg>
              Data Preview
              <span className="text-sm font-normal text-gray-600 ml-2">
                (First {preview.length} rows)
              </span>
            </h4>
          </div>

          <div className="overflow-x-auto max-h-96">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 sticky top-0 z-10">
                <tr>
                  {Object.keys(preview[0]).map((col) => (
                    <th
                      key={col}
                      className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-b border-gray-200 whitespace-nowrap"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {preview.map((row, i) => (
                  <tr key={i} className="hover:bg-gray-50 transition-colors">
                    {Object.values(row).map((v, j) => (
                      <td
                        key={j}
                        className="px-4 py-3 text-gray-900 whitespace-nowrap"
                      >
                        {v ?? <span className="text-gray-400 italic">null</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Info Box */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <svg
            className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
              clipRule="evenodd"
            />
          </svg>
          <div>
            <p className="text-sm font-medium text-blue-900 mb-1">
              Hierarchy Computation
            </p>
            <ul className="text-xs text-blue-700 space-y-1">
              <li>• <strong>Levels:</strong> Calculates hierarchical level for each employee</li>
              <li>• <strong>Chains:</strong> Builds complete reporting chains from employee to top manager</li>
              <li>• <strong>Total Reports:</strong> Counts all direct and indirect reports</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}