import React, { useRef, useEffect, useMemo } from "react";
import GeorgiaSvgRaw from "../assets/Georgia.svg?raw";
import CaliforniaSvgRaw from "../assets/California.svg?raw";
import SeattleSvgRaw from "../assets/Seattle.svg?raw";
import NewYorkSvgRaw from "../assets/NewYork.svg?raw";

const SVG_RAW = {
  Atlanta: GeorgiaSvgRaw,
  "Los Angeles": CaliforniaSvgRaw,
  LosAngeles: CaliforniaSvgRaw,
  Seattle: SeattleSvgRaw,
  NewYork: NewYorkSvgRaw,
};

/**
 * Interactive SVG tract map that syncs with TrafficChart via shared hover/pin state.
 *
 * Mapping strategy: both this component and TrafficChart use the same TAB20 palette.
 * We extract the fill color from each SVG PatchCollection and reverse-lookup the
 * tractId from the parent-provided tractColors map.
 */
export default function InteractiveTractMap({
  city,
  tractColors = {},  // { tractId: "#hex" } — built by parent from chart data
  activeTract = null,
  pinnedTract = null,
  onTractHover,
  onTractClick,
}) {
  const containerRef = useRef(null);
  // Use refs for callbacks to avoid re-injecting SVG on every render
  const onHoverRef = useRef(onTractHover);
  const onClickRef = useRef(onTractClick);
  onHoverRef.current = onTractHover;
  onClickRef.current = onTractClick;

  const svgRaw = SVG_RAW[city];

  // Reverse map: "#hex" → tractId
  const colorToTract = useMemo(() => {
    const map = {};
    for (const [tractId, color] of Object.entries(tractColors)) {
      map[color.toLowerCase()] = tractId;
    }
    return map;
  }, [tractColors]);

  const hasInteraction = Object.keys(tractColors).length > 0;

  // Inject SVG and bind events (only re-runs when city or color mapping changes)
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !svgRaw) return;

    container.innerHTML = svgRaw;

    const svg = container.querySelector("svg");
    if (!svg) return;

    // Make SVG responsive
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.style.width = "100%";
    svg.style.height = "100%";

    if (!hasInteraction) return;

    // Map each PatchCollection to a tractId via its fill color
    const patches = container.querySelectorAll('[id^="PatchCollection_"]');

    patches.forEach((patch) => {
      const useEl = patch.querySelector("use");
      if (!useEl) return;

      const style = useEl.getAttribute("style") || "";
      const fillMatch = style.match(/fill:\s*(#[0-9a-fA-F]+)/);
      if (!fillMatch) return;

      const fillColor = fillMatch[1].toLowerCase();
      const tractId = colorToTract[fillColor];
      if (!tractId) return;

      patch.dataset.tractId = tractId;
      patch.style.cursor = "pointer";

      // Add transition for smooth highlight
      useEl.style.transition = "opacity 0.15s ease, filter 0.15s ease";

      patch.addEventListener("mouseenter", () => onHoverRef.current?.(tractId));
      patch.addEventListener("mouseleave", () => onHoverRef.current?.(null));
      patch.addEventListener("click", () => onClickRef.current?.(tractId));
    });

    return () => {
      container.innerHTML = "";
    };
  }, [svgRaw, colorToTract, hasInteraction]);

  // Highlight active tract without re-injecting SVG
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !hasInteraction) return;

    const highlighted = activeTract || pinnedTract;

    const patches = container.querySelectorAll("[data-tract-id]");
    patches.forEach((patch) => {
      const tractId = patch.dataset.tractId;
      const isHighlighted = tractId === highlighted;
      const useEl = patch.querySelector("use");
      if (!useEl) return;

      if (highlighted) {
        useEl.style.opacity = isHighlighted ? "1" : "0.3";
        useEl.style.filter = isHighlighted
          ? "drop-shadow(0 0 6px rgba(0,0,0,0.5))"
          : "";
        useEl.style.strokeWidth = isHighlighted ? "3px" : "";
      } else {
        useEl.style.opacity = "1";
        useEl.style.filter = "";
        useEl.style.strokeWidth = "";
      }
    });
  }, [activeTract, pinnedTract, hasInteraction]);

  if (!svgRaw) return null;

  return (
    <div
      ref={containerRef}
      className="w-full max-h-[350px] rounded"
      onMouseLeave={() => onHoverRef.current?.(null)}
    />
  );
}
