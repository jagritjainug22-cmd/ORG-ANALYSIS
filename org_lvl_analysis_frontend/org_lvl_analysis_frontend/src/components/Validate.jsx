import React, { useState } from "react";
import { validate as validateBackend } from "../api/backend";
import CompletenessHeatmap from "./CompletenessHeatmap";

export default function Validate({
  dfRecords,
  columns,
  setValidatedDf,
  empCol,
  setEmpCol,
  mgrCol,
  setMgrCol,
  jobTitleCol        // ← NEW
}) {
  const [errors, setErrors] = useState(null);
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [validationComplete, setValidationComplete] = useState(false);
  const [activeTab, setActiveTab] = useState("validation");

  const runValidation = async (download = false) => {
    if (!dfRecords || !empCol || !mgrCol) {
      setErrors({ error: "Please select both Employee and Manager columns." });
      return;
    }

    setLoading(true);
    setErrors(null);
    setDownloadUrl(null);
    setValidationComplete(false);

    try {
      const result = await validateBackend(dfRecords, empCol, mgrCol, null, download);

      if (download) {
        const blob = result instanceof Blob
          ? result
          : new Blob([result], {
              type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            });
        setDownloadUrl(window.URL.createObjectURL(blob));
      } else {
        setErrors(result);
        setValidationComplete(true);
        if (setValidatedDf && result.df_with_flags) {
          setValidatedDf(result.df_with_flags);
        }
      }
    } catch (err) {
      console.error("Validation error:", err);
      console.error("Backend response:", err.response?.data);

      setErrors(
        typeof err.response?.data === "object"
          ? err.response.data
          : { error: "Failed to validate data." }
      );
    }

    setLoading(false);
  };

  // Get top manager's full info (ID and Job Title)
  const getTopManagerInfo = () => {
    if (!errors?.top_manager || !dfRecords) return null;
    const topManagerRow = dfRecords.find(row => row[empCol] === errors.top_manager);
    if (!topManagerRow) return { id: errors.top_manager };
    return {
      id: errors.top_manager,
      jobTitle: jobTitleCol ? topManagerRow[jobTitleCol] || null : null
    };
  };

  const topManagerInfo = getTopManagerInfo();

  const hasErrors = errors && (
    errors.duplicate_ids?.length > 0 ||
    errors.missing_manager_ids?.length > 0 ||
    errors.invalid_manager_ids?.length > 0 ||
    errors.circular_reference_ids?.length > 0
  );

  const totalIssues = 
    (errors?.duplicate_ids?.length || 0) +
    (errors?.missing_manager_ids?.length || 0) +
    (errors?.invalid_manager_ids?.length || 0) +
    (errors?.circular_reference_ids?.length || 0);

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
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <div className="flex-1">
            <h3 className="text-xl font-bold text-gray-900 mb-2">
              Data Validation
            </h3>
            <p className="text-sm text-gray-600">
              Check hierarchy integrity and data completeness — duplicate IDs, missing managers,
              invalid relationships, and field-level gaps across your organisation.
            </p>
          </div>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 p-1 bg-gray-100 rounded-xl w-fit">
        <button
          type="button"
          onClick={() => setActiveTab("validation")}
          className={`px-4 py-2 text-sm rounded-lg transition-all ${
            activeTab === "validation"
              ? "bg-white shadow-sm text-gray-900 font-semibold"
              : "text-gray-500 hover:text-gray-700 font-medium"
          }`}
        >
          Validation Results
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("quality")}
          className={`px-4 py-2 text-sm rounded-lg transition-all ${
            activeTab === "quality"
              ? "bg-white shadow-sm text-gray-900 font-semibold"
              : "text-gray-500 hover:text-gray-700 font-medium"
          }`}
        >
          Data Quality
        </button>
      </div>

      {activeTab === "quality" && (
        <CompletenessHeatmap
          dfRecords={dfRecords}
          columns={columns}
          empCol={empCol}
          mgrCol={mgrCol}
        />
      )}

      {activeTab === "validation" && (
      <>
      {/* Column Selection Section */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h4 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
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
              d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2"
            />
          </svg>
          Column Configuration
        </h4>

        <div className="grid grid-cols-2 gap-6">
          {/* Employee Column Selector */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Employee ID Column
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <svg
                  className="h-5 w-5 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                  />
                </svg>
              </div>
              <select
                className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-am-500 focus:border-am-500 outline-none transition-all text-gray-900 bg-white"
                value={empCol}
                onChange={(e) => setEmpCol(e.target.value)}
                disabled={loading}
              >
                <option value="">Select Employee Column...</option>
                {columns?.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Manager Column Selector */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Manager ID Column
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <svg
                  className="h-5 w-5 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                  />
                </svg>
              </div>
              <select
                className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-am-500 focus:border-am-500 outline-none transition-all text-gray-900 bg-white"
                value={mgrCol}
                onChange={(e) => setMgrCol(e.target.value)}
                disabled={loading}
              >
                <option value="">Select Manager Column...</option>
                {columns?.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-4">
        <button
          onClick={() => runValidation(false)}
          disabled={loading || !empCol || !mgrCol}
          className="flex-1 px-6 py-4 bg-am-500 hover:bg-am-600 text-white rounded-lg font-semibold shadow-lg hover:shadow-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
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
              <span className="text-lg">Validating Data...</span>
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
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span className="text-lg">Run Validation</span>
            </>
          )}
        </button>

        <button
          onClick={() => runValidation(true)}
          disabled={loading || !empCol || !mgrCol}
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
          <span>Download Data with Flags</span>
        </button>
      </div>

      {/* Download Link */}
      {downloadUrl && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3 animate-fadeIn">
          <svg
            className="w-6 h-6 text-green-600 flex-shrink-0"
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
          <div className="flex-1">
            <p className="font-medium text-green-900">File Ready for Download</p>
            <a
              href={downloadUrl}
              download="validated_org_data.xlsx"
              className="text-sm text-green-700 hover:text-green-900 underline font-medium"
            >
              Click here to download validated_org_data.xlsx
            </a>
          </div>
        </div>
      )}

      {/* Validation Results Summary */}
      {validationComplete && !hasErrors && errors && (
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
                Validation Passed!
              </h4>
              <p className="text-sm text-green-700">
                No data quality issues detected
              </p>
            </div>
          </div>

          {topManagerInfo && (
            <div className="bg-white rounded-lg p-4 border border-green-200">
              <div className="flex items-center gap-2 mb-2">
                <svg
                  className="w-5 h-5 text-blue-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <span className="text-sm font-semibold text-gray-700">Detected Top Manager</span>
              </div>
              <div className="space-y-1">
                <p className="text-lg font-bold text-blue-900">{topManagerInfo.id}</p>
                {topManagerInfo.jobTitle && (
                  <p className="text-sm text-gray-600">
                    <span className="font-medium">Position:</span> {topManagerInfo.jobTitle}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Validation Errors — ALL four error cards live inside this single hasErrors guard */}
      {hasErrors && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 animate-fadeIn">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 bg-red-600 rounded-lg flex items-center justify-center">
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
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <div>
              <h4 className="font-bold text-red-900 text-lg">
                Validation Issues Found
              </h4>
              <p className="text-sm text-red-700">
                {totalIssues} {totalIssues === 1 ? 'issue' : 'issues'} detected in the data
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {/* Duplicate IDs */}
            {errors.duplicate_ids?.length > 0 && (
              <div className="bg-white rounded-lg p-4 border border-red-200">
                <div className="flex items-start gap-3">
                  <svg
                    className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                    />
                  </svg>
                  <div className="flex-1">
                    <p className="font-semibold text-red-900 mb-2">
                      Duplicate Employee IDs ({errors.duplicate_ids.length})
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {errors.duplicate_ids.slice(0, 10).map((id, idx) => (
                        <span
                          key={idx}
                          className="px-2 py-1 bg-red-100 text-red-800 text-xs font-medium rounded"
                        >
                          {id}
                        </span>
                      ))}
                      {errors.duplicate_ids.length > 10 && (
                        <span className="px-2 py-1 bg-gray-100 text-gray-600 text-xs font-medium rounded">
                          +{errors.duplicate_ids.length - 10} more
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Missing Manager IDs */}
            {errors.missing_manager_ids?.length > 0 && (
              <div className="bg-white rounded-lg p-4 border border-red-200">
                <div className="flex items-start gap-3">
                  <svg
                    className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <div className="flex-1">
                    <p className="font-semibold text-red-900 mb-2">
                      Missing Manager IDs ({errors.missing_manager_ids.length})
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {errors.missing_manager_ids.slice(0, 10).map((id, idx) => (
                        <span
                          key={idx}
                          className="px-2 py-1 bg-red-100 text-red-800 text-xs font-medium rounded"
                        >
                          {id}
                        </span>
                      ))}
                      {errors.missing_manager_ids.length > 10 && (
                        <span className="px-2 py-1 bg-gray-100 text-gray-600 text-xs font-medium rounded">
                          +{errors.missing_manager_ids.length - 10} more
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Invalid Manager IDs */}
            {errors.invalid_manager_ids?.length > 0 && (
              <div className="bg-white rounded-lg p-4 border border-red-200">
                <div className="flex items-start gap-3">
                  <svg
                    className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                    />
                  </svg>
                  <div className="flex-1">
                    <p className="font-semibold text-red-900 mb-2">
                      Invalid Manager IDs ({errors.invalid_manager_ids.length})
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {errors.invalid_manager_ids.slice(0, 10).map((id, idx) => (
                        <span
                          key={idx}
                          className="px-2 py-1 bg-red-100 text-red-800 text-xs font-medium rounded"
                        >
                          {id}
                        </span>
                      ))}
                      {errors.invalid_manager_ids.length > 10 && (
                        <span className="px-2 py-1 bg-gray-100 text-gray-600 text-xs font-medium rounded">
                          +{errors.invalid_manager_ids.length - 10} more
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Circular References — INSIDE the hasErrors wrapper */}
            {errors.circular_reference_ids?.length > 0 && (
              <div className="bg-white rounded-lg p-4 border border-red-200">
                <div className="flex items-start gap-3">
                  <svg
                    className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                  <div className="flex-1">
                    <p className="font-semibold text-red-900 mb-1">
                      Circular References ({errors.circular_reference_ids.length})
                    </p>
                    <p className="text-xs text-red-700 mb-2">
                      These employees form a loop in the reporting chain (e.g. A → B → C → A).
                      They must be resolved before running Hierarchy analysis.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {errors.circular_reference_ids.slice(0, 10).map((id, idx) => (
                        <span
                          key={idx}
                          className="px-2 py-1 bg-red-100 text-red-800 text-xs font-medium rounded"
                        >
                          {id}
                        </span>
                      ))}
                      {errors.circular_reference_ids.length > 10 && (
                        <span className="px-2 py-1 bg-gray-100 text-gray-600 text-xs font-medium rounded">
                          +{errors.circular_reference_ids.length - 10} more
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

          </div>{/* end space-y-4 */}
        </div>
      )}{/* end hasErrors */}

      {/* Top Manager Info (separate card when errors exist) */}
      {hasErrors && topManagerInfo && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 animate-fadeIn">
          <div className="flex items-center gap-2 mb-2">
            <svg
              className="w-5 h-5 text-blue-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span className="text-sm font-semibold text-gray-700">Detected Top Manager</span>
          </div>
          <div className="space-y-1">
            <p className="text-lg font-bold text-blue-900">{topManagerInfo.id}</p>
            {topManagerInfo.jobTitle && (
              <p className="text-sm text-gray-600">
                <span className="font-medium">Position:</span> {topManagerInfo.jobTitle}
              </p>
            )}
          </div>
        </div>
      )}

      {/* General Error */}
      {errors?.error && (
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
            <p className="font-medium text-red-900">Validation Error</p>
            <p className="text-sm text-red-700 mt-1">{errors.error}</p>
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
              Validation Checks
            </p>
            <ul className="text-xs text-blue-700 space-y-1">
              <li>• <strong>Duplicate IDs:</strong> Checks for employees with duplicate IDs</li>
              <li>• <strong>Missing Managers:</strong> Finds employees without manager assignments</li>
              <li>• <strong>Invalid Managers:</strong> Identifies manager IDs that don't exist in the employee list</li>
              <li>• <strong>Circular References:</strong> Detects employees caught in a reporting loop (e.g. A → B → A)</li>
              <li>• <strong>Top Manager:</strong> Automatically detects the organisation's top-level manager</li>
            </ul>
          </div>
        </div>
      </div>
      </>
      )}
    </div>
  );
}