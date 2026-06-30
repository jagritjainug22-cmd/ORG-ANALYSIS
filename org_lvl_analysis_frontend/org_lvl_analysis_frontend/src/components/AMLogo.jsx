import React from "react";

export default function AMLogo({ className = "h-8" }) {
  return (
    <img
      src="/am-logo.png"
      alt="Alvarez & Marsal"
      className={`${className} object-contain`}
    />
  );
}
