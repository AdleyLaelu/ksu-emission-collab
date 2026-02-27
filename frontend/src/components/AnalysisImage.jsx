import React from "react";
import { getAnalysisImgUrl, analysisKey } from "../utils/analysisAssets";

export default function AnalysisImage({
  emissionType,
  city,
  className = "max-w-[500px] w-full h-auto object-contain rounded mx-auto",
  fallback = null,
}) {
  const src = getAnalysisImgUrl(emissionType, city);
  // Debug once if needed:
  // console.log("Looking for:", analysisKey(emissionType, city), "->", src);
  if (!src) return <>{fallback}</>;
  return <img src={src} alt={`${emissionType} ${city} Analysis`} className={className} />;
}
