import React from "react";

export default function SkeletonTableLoader() {
  const rows = [1, 2, 3, 4];

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-md animate-fadeInUp">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gradient-to-r from-brand-600 to-brand-500 text-white">
            <tr>
              <th scope="col" className="w-1 px-0 py-3"></th>
              <th scope="col" className="w-8 px-3 py-3"></th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider">Project</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider">Status</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider">Deadline</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider">Team</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider">Datasets</th>
              <th scope="col" className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row) => (
              <tr key={row} className="animate-pulse">
                {/* Accent line skeleton */}
                <td className="p-0 align-stretch">
                  <div className="w-1 h-full bg-slate-200" style={{ minHeight: 64 }} />
                </td>
                
                {/* Expand icon skeleton */}
                <td className="px-3 py-5 align-middle">
                  <div className="w-5 h-5 rounded bg-slate-200" />
                </td>

                {/* Project title and description skeleton */}
                <td className="px-6 py-5 align-middle">
                  <div className="w-48 h-4.5 bg-slate-250 rounded mb-2" />
                  <div className="w-72 h-3 bg-slate-150 rounded" />
                </td>

                {/* Status badge skeleton */}
                <td className="px-6 py-5 align-middle">
                  <div className="w-16 h-6 rounded-full bg-slate-200" />
                </td>

                {/* Deadline skeleton */}
                <td className="px-6 py-5 align-middle">
                  <div className="w-24 h-4.5 bg-slate-200 rounded mb-1" />
                  <div className="w-12 h-3 bg-slate-150 rounded" />
                </td>

                {/* Team avatar stack skeleton */}
                <td className="px-6 py-5 align-middle">
                  <div className="flex -space-x-2">
                    <div className="w-7 h-7 rounded-full bg-slate-200 border-2 border-white" />
                    <div className="w-7 h-7 rounded-full bg-slate-200 border-2 border-white" />
                    <div className="w-7 h-7 rounded-full bg-slate-150 border-2 border-white" />
                  </div>
                </td>

                {/* Datasets count skeleton */}
                <td className="px-6 py-5 align-middle">
                  <div className="w-8 h-5 bg-slate-200 rounded" />
                </td>

                {/* Open button skeleton */}
                <td className="px-6 py-5 align-middle text-right">
                  <div className="inline-block w-16 h-9 bg-slate-200 rounded-md" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      {/* Custom styled pulse values to create visual variation */}
      <style>{`
        .bg-slate-150 { background-color: #f1f5f9; }
        .bg-slate-250 { background-color: #cbd5e1; }
      `}</style>
    </div>
  );
}
