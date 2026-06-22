import React from "react";
import PptxGenJS from "pptxgenjs";

/* =========================================================
   HELPERS
========================================================= */
function getSerializedSvg(svgEl) {
  const serializer = new XMLSerializer();
  let svgString = serializer.serializeToString(svgEl);

  // Ensure SVG namespace exists (important for PPT compatibility)
  if (!svgString.includes("xmlns=")) {
    svgString = svgString.replace(
      "<svg",
      '<svg xmlns="http://www.w3.org/2000/svg"'
    );
  }

  return svgString;
}

/* =========================================================
   SVG DOWNLOAD
========================================================= */
export function downloadSvg(svgEl) {
  if (!svgEl) {
    alert("SVG element not found");
    return;
  }

  const svgString = getSerializedSvg(svgEl);

  const blob = new Blob(
    [svgString],
    { type: "image/svg+xml;charset=utf-8" }
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "OrgChart.svg";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/* =========================================================
   SVG → PPT (PURE FRONTEND, NO PNG, NO BACKEND)
========================================================= */
export function downloadPptFromSvg(svgEl) {
  if (!svgEl) {
    alert("SVG element not found");
    return;
  }

  const svgString = getSerializedSvg(svgEl);
  const svgBlob = new Blob(
    [svgString],
    { type: "image/svg+xml;charset=utf-8" }
  );

  const svgUrl = URL.createObjectURL(svgBlob);
  const img = new Image();

  img.onload = () => {
    const pptx = new PptxGenJS();
    const slide = pptx.addSlide();

    // Slide size ≈ 10 x 5.63 inches
    const slideW = 10;
    const slideH = 5.63;
    const margin = 0.25;

    slide.addImage({
      data: svgUrl,
      x: margin,
      y: margin,
      w: slideW - margin * 2,
      h: slideH - margin * 2
    });

    pptx.writeFile("OrgChart.pptx");
    URL.revokeObjectURL(svgUrl);
  };

  img.onerror = () => {
    URL.revokeObjectURL(svgUrl);
    alert("Failed to load SVG for PPT export");
  };

  img.src = svgUrl;
}

/* =========================================================
   DEFAULT COMPONENT
========================================================= */
export default function ExportPPT({ df = null }) {
  if (!df) return null;
  
  return (
    <button
      onClick={() => {
        console.log("Export functionality for general use");
      }}
      className="w-full px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white rounded-lg shadow-md hover:shadow-lg transition-all duration-200 font-medium"
    >
      Export to Excel
    </button>
  );
}