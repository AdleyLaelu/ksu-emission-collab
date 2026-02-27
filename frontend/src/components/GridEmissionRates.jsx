import React, { useState, useEffect } from "react";
import useAppStore from "../useAppStore";
import Atlanta from "../assets/Georgia.svg";
import LosAngeles from "../assets/California.svg";
import Seattle from "../assets/Seattle.svg";
import NewYork from "../assets/NewYork.svg";
import gridDataImg from "../assets/griddata1.png";
import VehicleStepper from "./VerticalStepper";
import AnalysisImage from "./AnalysisImage";
import {
  getAnalysisImgUrl,
  buildAnalysisFileName,
} from "../utils/analysisAssets";

import {
  Card,
  CardContent,
  Typography,
  List,
  ListItem,
  Divider,
} from "@mui/material";
import Button from "@mui/material/Button";
import { toast } from "react-toastify";

// --- Reusable Zoom Toolbar Component ---
const ZoomToolbar = ({ onZoomIn, onZoomOut, onReset }) => (
  <div className="absolute top-4 right-4 z-10 flex bg-white rounded border border-gray-300 shadow-sm overflow-hidden select-none">
    <button
      onClick={onZoomIn}
      className="px-3 py-1 text-blue-600 hover:bg-gray-50 border-r border-gray-200 text-lg font-bold leading-none transition-colors"
      title="Zoom In"
      type="button"
    >
      +
    </button>
    <button
      onClick={onZoomOut}
      className="px-3 py-1 text-blue-600 hover:bg-gray-50 border-r border-gray-200 text-lg font-bold leading-none transition-colors"
      title="Zoom Out"
      type="button"
    >
      -
    </button>
    <button
      onClick={onReset}
      className="px-3 py-1 text-xs font-semibold text-blue-600 hover:bg-gray-50 uppercase tracking-wide transition-colors"
      title="Reset Zoom"
      type="button"
    >
      RESET
    </button>
  </div>
);

const GridEmissionRates = ({ activeStep, isResults }) => {
  const classificationState = useAppStore((state) => state.classificationState);
  const trafficState = useAppStore((s) => s.trafficVolumeState);
  const statesList = ["", "Atlanta", "Los Angeles", "Seattle", "NewYork"];
  const cityImages = { Atlanta, LosAngeles, Seattle, NewYork };


  const scenarios = [
    {
      title: "Mid-case Scenario",
      description:
        "This scenario represents central estimates for fundamental inputs, including moderate renewable energy and battery technology costs (NREL, 2024), EIA AEO2023 Reference natural gas prices (U.S. EIA, 2023), and an average electricity demand growth of 1.8% per year from 2024 to 2050, reaching 6,509 TWh/year by 2050.",
    },
    {
      title: "Low Renewable Energy and Battery Costs",
      description:
        "This scenario mirrors the foundational assumptions of the Mid-case but posits a future where renewable energy and battery costs are considerably lower, using the advanced projections from the 2024 Annual Technology Baseline (ATB) (NREL, 2024), with performance improvements and cost declines, such as wind capital adders decreasing to $0/kW by 2050",
    },
    {
      title: "High Renewable Energy and Battery Costs",
      description:
        "Similar to the Mid-case but this scenario assumes more conservative ATB projections with higher renewable energy and battery costs and a $200/kW capital cost adder for wind through 2050, slowing clean technology adoption.",
    },
    {
      title: "High Demand Growth",
      description:
        "This scenario also uses the Mid-case base assumptions but anticipates 2.8% annual demand growth from 2024 to 2050, reaching 8,354 TWh/year by 2050, contrasting with 1.8% in the base assumptions.",
    },
    {
      title: "Low Natural Gas Prices",
      description:
        "This scenario retains the core assumptions of the Mid-case but applies the AEO2023 High Oil & Gas Resource/Technology case (U.S. EIA, 2023), in which prices begin at the 2025 Reference level and decline more sharply thereafter. By 2035, national average natural gas prices are projected to fall to approximately $2.50/MMBtu, compared to $3.50–$4.00/MMBtu in the Mid-case scenario.",
    },
    {
      title: "High Natural Gas Prices",
      description:
        "This scenario builds on the same foundational assumptions as the Mid-case but incorporates the AEO2023 Low Oil & Gas Resource/Technology case (U.S. EIA, 2023), which projects substantially higher natural gas prices over time. Prices start at the same level in 2025 but increase more rapidly, reaching over $6.00/MMBtu by 2035, compared to $3.50–$4.00/MMBtu in the Mid-case scenario, thereby enhancing the competitiveness of renewable energy and storage in the generation mix.",
    },
    {
      title: "Low Renewable Energy and Battery Costs with High Natural Gas Prices",
      description:
        " Building on the base assumptions of the Mid-case scenario, this case combines lower renewable energy and battery costs, based on the 2024 ATB advanced projections (NREL, 2024), which include wind adders dropping to $0/kW by 2050, with high natural gas prices, rising above $6.00/MMBtu by 2035. This combination creates one of the most favorable environments for renewable energy deployment among the eight modeled scenarios.",
    },
    {
      title: "High Renewable Energy and Battery Costs with Low Natural Gas Prices",
      description:
        "This scenario also builds on the same base assumptions as the first scenario but combines higher renewable energy and battery costs based on conservative ATB projections NREL, 2024), including a $200/kW capital cost adder for wind through 2050, with low natural gas prices, projected to reach around $2.50/MMBtu by 2035. This combination reduces the competitiveness of renewables and results in a slower decarbonization trajectory.",
    },
  ];

  const GridEmissionState = useAppStore((state) => state.GridEmission);
  const setGridEmissionState = useAppStore((state) => state.setGridEmission);

  const onDownload = async () => {
    const emission = GridEmissionState.EmissionType;
    const city = classificationState.cityInput;

    const url = getAnalysisImgUrl(emission, city);
    if (!url) {
      toast.error("Image not found for selected emission/city");
      return;
    }

    const filename = buildAnalysisFileName(emission, city, url);

    // Helper to download SVG as PNG
    async function downloadAsPng(url, filename) {
      try {
        const res = await fetch(url);
        const svgText = await res.text();
        const svg = new Blob([svgText], { type: 'image/svg+xml' });
        const urlObj = URL.createObjectURL(svg);
        const img = new window.Image();
        img.onload = function () {
          // Try to extract width/height from SVG if possible
          let width = img.width;
          let height = img.height;
          if ((!width || !height) && svgText) {
            const matchW = svgText.match(/width=["'](\d+)["']/);
            const matchH = svgText.match(/height=["'](\d+)["']/);
            width = matchW ? parseInt(matchW[1]) : 1200;
            height = matchH ? parseInt(matchH[1]) : 900;
          }
          const canvas = document.createElement('canvas');
          canvas.width = width || 1200;
          canvas.height = height || 900;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(blob => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = filename.replace(/\.svg$/i, '.png');
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(urlObj);
          }, 'image/png');
        };
        img.onerror = function () {
          toast.error('Failed to load SVG for PNG conversion.');
        };
        img.src = urlObj;
      } catch (e) {
        toast.error('Failed to fetch SVG for PNG conversion.');
      }
    }

    // Download logic: if SVG, convert to PNG, else download as is
    const downloadImage = async (url, filename) => {
      if (url.endsWith('.svg')) {
        await downloadAsPng(url, filename);
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    };

    await downloadImage(url, filename);

    // Use global notification system instead of toast
    if (typeof useAppStore.getState().addNotification === 'function') {
      useAppStore.getState().addNotification("Download started");
    }
  };

  // --- Zoom State for AnalysisImage ---
  const [imageZoom, setImageZoom] = useState(1);

  // Zoom Handlers (same as VehicleTrafficVolume)
  const handleZoomIn = () => setImageZoom((prev) => Math.min(prev + 0.25, 3.5)); // Max zoom 3.5x
  const handleZoomOut = () => setImageZoom((prev) => Math.max(prev - 0.25, 1)); // Min zoom 1x
  const handleResetZoom = () => setImageZoom(1);

  // Reset zoom when emission type or city changes
  useEffect(() => {
    setImageZoom(1);
  }, [GridEmissionState.EmissionType, classificationState.cityInput]);

  return (
    <div className="flex flex-row items-stretch gap-6 pl-6 pt-4">
      {/* Logo image on the left */}
      <div className="flex flex-col justify-start items-start pt-2 pr-2">
        <img
          src="src/assets/Logo2.jpg"
          alt="NREL Cambium"
          style={{ width: "160px", height: "auto" }}
        />
      </div>
      {/* Left panel: form + table */}
      <div className="flex flex-col gap-6">
        <Card variant="outlined" sx={{ backgroundColor: "#fafafa", mb: 4, maxWidth: 1200, px: 2, py: 1 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Scenarios
            </Typography>
            <Divider sx={{ my: 1 }} />
            <List>
              {scenarios.map(({ title, description }) => (
                <ListItem key={title} sx={{ display: "block", py: 1 }}>
                  <Typography variant="subtitle1" fontWeight="bold">
                    {title}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {description}
                  </Typography>
                </ListItem>
              ))}
            </List>
          </CardContent>
        </Card>
        <form className="flex items-end gap-4 p-4 rounded">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">
              Grid Emission Type
            </label>
            <select
              value={GridEmissionState.EmissionType}
              onChange={(e) =>
                setGridEmissionState({
                  EmissionType: e.target.value,
                })
              }
              className="border rounded px-2 py-1 w-65"
            >
              <option value="">Select Grid Emission Type</option>
              <option value="CO2">CO₂</option>
              <option value="N2O">N₂O</option>
              <option value="CH4">CH₄</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">City</label>
            <select
              value={classificationState.cityInput}
              disabled
              className="bg-gray-300 text-gray-600 rounded px-2 py-1 w-32"
            >
              <option value="">City</option>
              {statesList.slice(1).map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col justify-end h-full">
            <Button
              variant="contained"
              onClick={onDownload}
              disabled={
                !GridEmissionState.EmissionType || !classificationState.cityInput
              }
            >
              Download
            </Button>
          </div>
        </form>
        
        <div className="flex flex-row items-start gap-8 w-full">
          <div className="flex-1 relative">
            {classificationState.cityInput && GridEmissionState.EmissionType ? (
              <div className="relative w-full max-w-[600px]">
                <div className="w-full h-[220px] border border-gray-200 rounded-lg overflow-hidden bg-white shadow-sm group">
                  <div className="w-full h-full overflow-auto" style={{overflow: 'auto', position: 'relative'}}>
                    <img
                      src={getAnalysisImgUrl(GridEmissionState.EmissionType, classificationState.cityInput)}
                      alt="Grid Emission Plot"
                      className="transition-all duration-200 ease-out origin-top-left max-w-none object-contain rounded"
                      style={{
                        width: `${imageZoom * 100}%`,
                        height: 'auto',
                        display: 'block',
                      }}
                      onError={e => { e.target.style.display = 'none'; }}
                    />
                  </div>
                  <ZoomToolbar
                    onZoomIn={handleZoomIn}
                    onZoomOut={handleZoomOut}
                    onReset={handleResetZoom}
                  />
                </div>
              </div>
            ) : null}
          </div>
          <img
            src={gridDataImg}
            alt="Grid Data"
            className="h-[280px] object-contain rounded border border-gray-100"
            style={{ maxWidth: '99%', marginTop: '-56px', minHeight: '320px' }}
          />
        </div>

      </div>

      <div className="flex flex-col gap-6">
        <div className="ml-4 flex items-center gap-4">
          <VehicleStepper activeStep={isResults ? 1 : (typeof activeStep === 'number' ? activeStep : 0)}  />
        </div>
        {classificationState.city && cityImages[classificationState.city] && (
           <div className="flex flex-row gap-6 items-start">
             
           
 </div>
//           <div className="flex flex-row gap-6 items-start">
//   <img
//     src={cityImages[classificationState.city]}
//     alt={classificationState.city}
//     className="h-[50px] md:h-[50px] lg:h-[50px] w-auto object-contain rounded"
//   />
// </div>
        )}
      </div>
    </div>
  );
};

export default GridEmissionRates;
