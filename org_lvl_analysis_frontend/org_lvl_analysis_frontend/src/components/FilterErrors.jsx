import React, { useState, useEffect } from "react";
import { filterErrors as filterErrorsBackend } from "../api/backend";

export default function FilterErrors({
  validatedDf,
  setValidatedDf,
  empCol,
  mgrCol,
}) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [selectedFlags, setSelectedFlags] = useState({});

  const hasFlags =
    validatedDf &&
    validatedDf.length > 0 &&
    Object.keys(validatedDf[0]).some((k) => k.startsWith("FLAG_"));

  // Check if filtering was already completed (no flags but result exists)
  const isAlreadyFiltered = result && !hasFlags;

  const getFlaggedCounts = () => {
    if (!hasFlags || !validatedDf) return null;

    const flagColumns = Object.keys(validatedDf[0]).filter(k => k.startsWith("FLAG_"));
    const counts = {};
    
    flagColumns.forEach(flag => {
      counts[flag] = validatedDf.filter(row => row[flag] === true || row[flag] === 1 || row[flag] === "1").length;
    });

    return counts;
  };

  const flagCounts = getFlaggedCounts();
  const totalFlagged = flagCounts ? Object.values(flagCounts).reduce((sum, count) => sum + count, 0) : 0;

  // Initialize selected flags when flag counts change
  useEffect(() => {
    if (flagCounts) {
      const initialSelection = {};
      Object.keys(flagCounts).forEach(flag => {
        if (flagCounts[flag] > 0) {
          initialSelection[flag] = true; // Default all to checked
        }
      });
      setSelectedFlags(initialSelection);
    }
  }, [validatedDf]);

  const handleFlagToggle = (flag) => {
    setSelectedFlags(prev => ({
      ...prev,
      [flag]: !prev[flag]
    }));
  };

  const handleSelectAll = () => {
    const newSelection = {};
    Object.keys(flagCounts || {}).forEach(flag => {
      if (flagCounts[flag] > 0) {
        newSelection[flag] = true;
      }
    });
    setSelectedFlags(newSelection);
  };

  const handleDeselectAll = () => {
    setSelectedFlags({});
  };

  const getSelectedFlagCount = () => {
    if (!flagCounts) return 0;
    return Object.keys(selectedFlags).reduce((sum, flag) => {
      return sum + (selectedFlags[flag] ? flagCounts[flag] : 0);
    }, 0);
  };

  const selectedCount = getSelectedFlagCount();

const run = async () => {
    if (!hasFlags || !empCol || !mgrCol) {
      setError("Please run validation first and ensure columns are selected.");
      return;
    }

    const selectedFlagsList = Object.keys(selectedFlags).filter(flag => selectedFlags[flag]);

    if (selectedFlagsList.length === 0) {
      setError("Please select at least one error type to filter.");
      return;
    }

    setIsProcessing(true);
    setError(null);
    setResult(null);

    try {
      // Map selected flag names to the boolean parameters the backend expects
      const removeDup      = selectedFlagsList.includes("FLAG_DUPLICATE_EMP_ID");
      const removeMissing  = selectedFlagsList.includes("FLAG_MISSING_MANAGER_ID");
      const removeInvalid  = selectedFlagsList.includes("FLAG_MANAGER_ID_NOT_EMPLOYEE");
      const removeCircular = selectedFlagsList.includes("FLAG_CIRCULAR_REFERENCE");

      const res = await filterErrorsBackend(
        validatedDf,
        empCol,
        mgrCol,
        removeDup,
        removeMissing,
        removeInvalid,
        removeCircular
      );

      if (res.df) {
        const originalCount = validatedDf.length;
        const filteredCount = res.df.length;
        const removedCount  = originalCount - filteredCount;

        setValidatedDf(res.df);
        setResult({
          original: originalCount,
          filtered: filteredCount,
          removed:  removedCount
        });
      }
    } catch (err) {
      console.error("Filter error:", err);
      setError(err.response?.data?.detail || "Failed to filter errors. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Section */}
      <div className="bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-lg p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 bg-gradient-to-br from-purple-600 to-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
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
                d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
              />
            </svg>
          </div>
          <div className="flex-1">
            <h3 className="text-xl font-bold text-gray-900 mb-2">
              Filter Errors
            </h3>
            <p className="text-sm text-gray-600">
              Select which validation errors to filter and remove from your dataset.
            </p>
          </div>
        </div>
      </div>

      {/* Status Section */}
      {!hasFlags && !isAlreadyFiltered ? (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
          <div className="flex items-start gap-3">
            <svg
              className="w-6 h-6 text-yellow-600 mt-0.5 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <div>
              <p className="font-semibold text-yellow-900 mb-1">
                Validation Required
              </p>
              <p className="text-sm text-yellow-800">
                Please run the <strong>Validate</strong> module first to flag records with errors before filtering.
              </p>
            </div>
          </div>
        </div>
      ) : isAlreadyFiltered ? (
        <div className="bg-green-50 border border-green-200 rounded-lg p-6">
          <div className="flex items-start gap-3">
            <svg
              className="w-6 h-6 text-green-600 mt-0.5 flex-shrink-0"
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
            <div>
              <p className="font-semibold text-green-900 mb-1">
                Dataset Already Filtered
              </p>
              <p className="text-sm text-green-800">
                Your dataset has been filtered and is now clean. All selected flagged records have been removed.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Flag Summary */}
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h4 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <svg
                className="w-5 h-5 text-purple-600"
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
              Flagged Records Summary
            </h4>

            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-1">
                  <svg
                    className="w-4 h-4 text-blue-600"
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
                  <span className="text-xs font-medium text-gray-600">Total Records</span>
                </div>
                <p className="text-2xl font-bold text-blue-900">
                  {validatedDf.length.toLocaleString()}
                </p>
              </div>

              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-1">
                  <svg
                    className="w-4 h-4 text-red-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                  <span className="text-xs font-medium text-gray-600">Total Flagged</span>
                </div>
                <p className="text-2xl font-bold text-red-900">
                  {totalFlagged.toLocaleString()}
                </p>
                <p className="text-xs text-red-700 mt-1">
                  {((totalFlagged / validatedDf.length) * 100).toFixed(1)}% of total
                </p>
              </div>

              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-1">
                  <svg
                    className="w-4 h-4 text-purple-600"
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
                  <span className="text-xs font-medium text-gray-600">Will Remove</span>
                </div>
                <p className="text-2xl font-bold text-purple-900">
                  {selectedCount.toLocaleString()}
                </p>
                <p className="text-xs text-purple-700 mt-1">
                  {((selectedCount / validatedDf.length) * 100).toFixed(1)}% of total
                </p>
              </div>
            </div>

            {/* Flag Selection with Checkboxes */}
            {flagCounts && Object.keys(flagCounts).length > 0 && (
              <div className="border-t border-gray-200 pt-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-medium text-gray-700">Select Errors to Filter:</p>
                  <div className="flex gap-2">
                    <button
                      onClick={handleSelectAll}
                      className="text-xs px-3 py-1 bg-purple-100 text-purple-700 rounded-md hover:bg-purple-200 transition-colors font-medium"
                    >
                      Select All
                    </button>
                    <button
                      onClick={handleDeselectAll}
                      className="text-xs px-3 py-1 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors font-medium"
                    >
                      Deselect All
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  {Object.entries(flagCounts).map(([flag, count]) => (
                    count > 0 && (
                      <label
                        key={flag}
                        className={`flex items-center justify-between rounded-lg px-4 py-3 cursor-pointer transition-all ${
                          selectedFlags[flag]
                            ? 'bg-purple-50 border-2 border-purple-300'
                            : 'bg-gray-50 border-2 border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className="flex items-center gap-3 flex-1">
                          <input
                            type="checkbox"
                            checked={selectedFlags[flag] || false}
                            onChange={() => handleFlagToggle(flag)}
                            className="w-5 h-5 text-purple-600 border-gray-300 rounded focus:ring-2 focus:ring-purple-500 cursor-pointer"
                          />
                          <div className="flex items-center gap-2">
                            <svg
                              className={`w-4 h-4 ${selectedFlags[flag] ? 'text-purple-600' : 'text-red-600'}`}
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path
                                fillRule="evenodd"
                                d="M3 6a3 3 0 013-3h10a1 1 0 01.8 1.6L14.25 8l2.55 3.4A1 1 0 0116 13H6a1 1 0 00-1 1v3a1 1 0 11-2 0V6z"
                                clipRule="evenodd"
                              />
                            </svg>
                            <span className={`text-sm font-medium ${selectedFlags[flag] ? 'text-purple-900' : 'text-gray-700'}`}>
                              {flag.replace("FLAG_", "").replace(/_/g, " ")}
                            </span>
                          </div>
                        </div>
                        <span className={`text-sm font-bold ${selectedFlags[flag] ? 'text-purple-600' : 'text-red-600'}`}>
                          {count.toLocaleString()}
                        </span>
                      </label>
                    )
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Action Button */}
          <div>
            <button
              onClick={run}
              disabled={isProcessing || !empCol || !mgrCol || selectedCount === 0}
              className="w-full px-6 py-4 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white rounded-lg font-semibold shadow-lg hover:shadow-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
            >
              {isProcessing ? (
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
                  <span className="text-lg">Filtering Records...</span>
                </>
              ) : selectedCount === 0 ? (
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
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                  <span className="text-lg">Select Errors to Filter</span>
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
                      d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
                    />
                  </svg>
                  <span className="text-lg">Filter {selectedCount.toLocaleString()} Selected Record{selectedCount !== 1 ? 's' : ''}</span>
                </>
              )}
            </button>
            
            {selectedCount === 0 && totalFlagged > 0 && (
              <p className="text-sm text-yellow-700 text-center mt-2">
                ⚠ Please select at least one error type to filter
              </p>
            )}
            
            {totalFlagged === 0 && hasFlags && (
              <p className="text-sm text-green-700 text-center mt-2">
                ✓ No flagged records found - dataset is already clean!
              </p>
            )}
          </div>
        </>
      )}

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
            <p className="font-medium text-red-900">Filter Failed</p>
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
                Filtering Complete!
              </h4>
              <p className="text-sm text-green-700">
                Selected invalid records have been removed from your dataset
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            {/* Original Count */}
            <div className="bg-white rounded-lg p-4 border border-green-200">
              <div className="flex items-center gap-2 mb-2">
                <svg
                  className="w-5 h-5 text-gray-600"
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
                <span className="text-xs font-medium text-gray-600">Original</span>
              </div>
              <p className="text-2xl font-bold text-gray-900">
                {result.original.toLocaleString()}
              </p>
              <p className="text-xs text-gray-500 mt-1">rows</p>
            </div>

            {/* Removed Count */}
            <div className="bg-white rounded-lg p-4 border border-green-200">
              <div className="flex items-center gap-2 mb-2">
                <svg
                  className="w-5 h-5 text-red-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
                <span className="text-xs font-medium text-gray-600">Removed</span>
              </div>
              <p className="text-2xl font-bold text-red-600">
                {result.removed.toLocaleString()}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {((result.removed / result.original) * 100).toFixed(1)}% filtered
              </p>
            </div>

            {/* Clean Count */}
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
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <span className="text-xs font-medium text-gray-600">Clean</span>
              </div>
              <p className="text-2xl font-bold text-green-600">
                {result.filtered.toLocaleString()}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {((result.filtered / result.original) * 100).toFixed(1)}% retained
              </p>
            </div>
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
              About Selective Error Filtering
            </p>
            <ul className="text-xs text-blue-700 space-y-1">
              <li>• Choose which types of errors to remove from your dataset</li>
              <li>• Uncheck errors you want to keep for further analysis</li>
              <li>• All checked errors will be filtered out</li>
              <li>• This operation cannot be undone - filtered data replaces the current dataset</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}