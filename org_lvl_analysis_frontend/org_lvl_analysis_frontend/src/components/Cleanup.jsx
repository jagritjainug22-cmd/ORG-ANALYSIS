import React, { useState } from "react";
import { cleanup } from "../api/backend";

export default function Cleanup({ df, setDf, countryCol }) {
  const [removeEx, setRemoveEx] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const run = async () => {
    if (!df || df.length === 0) {
      setError("No data available. Please upload a file first.");
      return;
    }

    setIsProcessing(true);
    setError(null);
    setResult(null);

    try {
      // Pass countryCol to the cleanup API call
      const res = await cleanup(df, removeEx, countryCol);
      
      if (res.df) {
        setDf(res.df);
        setResult({
          removed: res.removed,
          remaining: res.df.length,
          original: df.length,
          countryFlagGenerated: countryCol ? true : false
        });
      }
    } catch (err) {
      console.error("Cleanup error:", err);
      setError(err.response?.data?.detail || "Failed to clean data. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Section */}
      <div className="bg-brand-50 border border-brand-200 rounded-lg p-3">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 bg-brand-500 rounded-lg flex items-center justify-center flex-shrink-0">
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
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </div>
          <div className="flex-1">
            <h3 className="text-base font-bold text-gray-900 mb-1">
              Data Cleanup
            </h3>
            <p className="text-sm text-gray-600">
              Remove flagged records and generate country flags for your dataset.
            </p>
          </div>
        </div>
      </div>

      {/* Configuration Section */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h4 className="text-base font-semibold text-gray-800 mb-3 flex items-center gap-2">
          <svg
            className="w-5 h-5 text-brand-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
            />
          </svg>
          Cleanup Options
        </h4>

        <div className="space-y-4">
          {/* Remove Exclusion Toggle */}
          <div className="flex items-start gap-4 p-4 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors">
            <div className="flex items-center h-6">
              <input
                id="remove-exclusion"
                type="checkbox"
                checked={removeEx}
                onChange={(e) => setRemoveEx(e.target.checked)}
                className="w-5 h-5 text-brand-500 bg-white border-gray-300 rounded focus:ring-2 focus:ring-brand-500 cursor-pointer"
                disabled={isProcessing}
              />
            </div>
            <div className="flex-1">
              <label
                htmlFor="remove-exclusion"
                className="font-medium text-gray-900 cursor-pointer block mb-1"
              >
                Remove Exclusion Records
              </label>
              <p className="text-sm text-gray-600">
                Automatically filter out records flagged for exclusion based on predefined criteria (0-include, 1-exclude).
              </p>
            </div>
            <div className="flex-shrink-0">
              {removeEx ? (
                <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                  Enabled
                </span>
              ) : (
                <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                  Disabled
                </span>
              )}
            </div>
          </div>

          {/* Country Flag Info */}
          {countryCol && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-2xl">🌍</span>
                <span className="text-sm font-semibold text-blue-900">Country Flag Generation</span>
              </div>
              <p className="text-sm text-blue-700">
                Flags will be generated from column: <strong>{countryCol}</strong>
              </p>
              <p className="text-xs text-blue-600 mt-1">
                A new "Country_Flag" column will be added to your data
              </p>
            </div>
          )}

          {/* Data Stats */}
          {df && df.length > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
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
                    d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                  />
                </svg>
                <span className="text-sm font-semibold text-blue-900">Current Dataset</span>
              </div>
              <p className="text-2xl font-bold text-blue-900">
                {df.length.toLocaleString()} <span className="text-base font-normal text-blue-700">rows</span>
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Action Button */}
      <div className="flex gap-3">
        <button
          onClick={run}
          disabled={isProcessing || !df || df.length === 0}
          className="flex-1 px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white rounded-md font-semibold shadow-sm hover:shadow-md transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm"
        >
          {isProcessing ? (
            <>
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
              <span className="text-sm">Processing Cleanup...</span>
            </>
          ) : (
            <>
              <svg
                className="w-5 h-5"
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
              <span className="text-sm">Run Cleanup Process</span>
            </>
          )}
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
            <p className="font-medium text-red-900">Cleanup Failed</p>
            <p className="text-sm text-red-700 mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Success Result */}
      {result && !error && (
        <div className="bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200 rounded-lg p-4 animate-fadeIn">
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
              <h4 className="font-bold text-green-900 text-base">
                Cleanup Completed Successfully!
              </h4>
              <p className="text-sm text-green-700">
                Your dataset has been cleaned and is ready for analysis
                {result.countryFlagGenerated && " • Country flags generated 🌍"}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            {/* Original Count */}
            <div className="bg-white rounded-lg p-3 border border-green-200">
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
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
                <span className="text-xs font-medium text-gray-600">Removed</span>
              </div>
              <p className="text-2xl font-bold text-red-600">
                {result.removed.toLocaleString()}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {((result.removed / result.original) * 100).toFixed(1)}% of total
              </p>
            </div>

            {/* Remaining Count */}
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
                <span className="text-xs font-medium text-gray-600">Remaining</span>
              </div>
              <p className="text-2xl font-bold text-green-600">
                {result.remaining.toLocaleString()}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {((result.remaining / result.original) * 100).toFixed(1)}% retained
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
              About Data Cleanup
            </p>
            <ul className="text-xs text-blue-700 space-y-1">
              <li>• Removes records marked with exclusion flags</li>
              <li>• Generates country flag emojis if country column is selected</li>
              <li>• Ensures data quality for accurate organizational analysis</li>
              <li>• This operation cannot be undone - original data is replaced</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}