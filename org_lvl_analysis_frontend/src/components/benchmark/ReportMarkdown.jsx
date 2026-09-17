/**
 * Minimal markdown renderer tuned for benchmark report prose.
 *
 * Deliberately narrow: headings, bullets, numbered lists, bold, inline code,
 * blockquote callouts and pipe tables. That is the whole grammar the narration
 * prompt asks the model to use, so a full parser dependency is not warranted.
 */

import React from "react";

function inline(text, keyPrefix) {
  const tokens = String(text).split(/(\*\*.*?\*\*|`.*?`|\*[^*]+\*)/g);
  return tokens.map((token, i) => {
    const key = `${keyPrefix}-${i}`;
    if (token.startsWith("**") && token.endsWith("**") && token.length > 4) {
      return <strong key={key} className="font-bold text-brand-600">{token.slice(2, -2)}</strong>;
    }
    if (token.startsWith("`") && token.endsWith("`") && token.length > 2) {
      return (
        <code key={key} className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-[0.85em] font-mono text-brand-600">
          {token.slice(1, -1)}
        </code>
      );
    }
    if (token.startsWith("*") && token.endsWith("*") && token.length > 2) {
      return <em key={key} className="italic text-slate-600">{token.slice(1, -1)}</em>;
    }
    return <React.Fragment key={key}>{token}</React.Fragment>;
  });
}

function Table({ rows, idx }) {
  if (rows.length < 2) return null;
  const cells = (line) => line.split("|").slice(1, -1).map((c) => c.trim());
  const header = cells(rows[0]);
  const body = rows.slice(2).map(cells);

  return (
    <div key={`tbl-${idx}`} className="my-4 rounded-xl border border-slate-200 overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-slate-50">
            {header.map((h, i) => (
              <th key={i} className="px-3 py-2 text-left text-[10px] uppercase tracking-wider font-bold text-slate-500 border-b border-slate-200">
                {inline(h, `th-${i}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, r) => (
            <tr key={r} className="border-b border-slate-100 last:border-0 hover:bg-brand-50/40 transition">
              {row.map((cell, c) => (
                <td key={c} className={`px-3 py-2 ${c === 0 ? "font-medium text-slate-700" : "text-slate-600 tabular-nums"}`}>
                  {inline(cell, `td-${r}-${c}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ReportMarkdown({ text, className = "" }) {
  if (!text) return null;

  const lines = String(text).split("\n");
  const out = [];
  let bullets = [];
  let ordered = [];
  let table = [];

  const flushBullets = (key) => {
    if (!bullets.length) return;
    out.push(
      <ul key={`ul-${key}`} className="my-3 space-y-1.5">
        {bullets.map((item, i) => (
          <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed text-slate-700">
            <span className="mt-[7px] w-1.5 h-1.5 rounded-full bg-brand-400 flex-shrink-0" />
            <span>{inline(item, `li-${key}-${i}`)}</span>
          </li>
        ))}
      </ul>
    );
    bullets = [];
  };

  const flushOrdered = (key) => {
    if (!ordered.length) return;
    out.push(
      <ol key={`ol-${key}`} className="my-3 space-y-2">
        {ordered.map((item, i) => (
          <li key={i} className="flex gap-3 text-[13px] leading-relaxed text-slate-700">
            <span className="flex-shrink-0 w-5 h-5 rounded-md bg-brand-50 border border-brand-200 text-brand-600 text-[10px] font-black flex items-center justify-center mt-0.5">
              {i + 1}
            </span>
            <span>{inline(item, `oli-${key}-${i}`)}</span>
          </li>
        ))}
      </ol>
    );
    ordered = [];
  };

  const flushTable = (key) => {
    if (table.length) {
      out.push(<Table key={`t-${key}`} rows={table} idx={key} />);
      table = [];
    }
  };

  const flushAll = (key) => { flushBullets(key); flushOrdered(key); flushTable(key); };

  lines.forEach((raw, index) => {
    const line = raw.trim();

    if (line.startsWith("|") && line.endsWith("|")) {
      flushBullets(index); flushOrdered(index);
      table.push(line);
      return;
    }
    flushTable(index);

    if (!line) { flushBullets(index); flushOrdered(index); return; }

    if (/^#{1,6}\s/.test(line)) {
      flushAll(index);
      const level = line.match(/^#+/)[0].length;
      const content = line.replace(/^#+\s*/, "");
      out.push(
        level <= 2 ? (
          <h3 key={index} className="text-base font-black text-brand-600 mt-6 mb-2 first:mt-0">
            {inline(content, `h-${index}`)}
          </h3>
        ) : (
          <h4 key={index} className="text-[13px] font-bold text-brand-600 uppercase tracking-wide mt-5 mb-1.5 first:mt-0">
            {inline(content, `h-${index}`)}
          </h4>
        )
      );
      return;
    }

    if (line.startsWith("> ")) {
      flushAll(index);
      out.push(
        <blockquote key={index} className="my-3 pl-4 border-l-[3px] border-amber-400 bg-amber-50/60 py-2.5 pr-3 rounded-r-lg">
          <p className="text-[13px] leading-relaxed text-amber-900">{inline(line.slice(2), `q-${index}`)}</p>
        </blockquote>
      );
      return;
    }

    if (/^[-*•]\s+/.test(line)) {
      flushOrdered(index);
      bullets.push(line.replace(/^[-*•]\s+/, ""));
      return;
    }

    if (/^\d+[.)]\s+/.test(line)) {
      flushBullets(index);
      ordered.push(line.replace(/^\d+[.)]\s+/, ""));
      return;
    }

    if (/^([-—_*]\s*){3,}$/.test(line)) {
      flushAll(index);
      out.push(<hr key={index} className="my-5 border-slate-200" />);
      return;
    }

    flushAll(index);
    out.push(
      <p key={index} className="text-[13px] leading-relaxed text-slate-700 my-2.5">
        {inline(line, `p-${index}`)}
      </p>
    );
  });

  flushAll("end");

  return <div className={className}>{out}</div>;
}
