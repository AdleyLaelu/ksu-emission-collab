import VehicleStepper from "./VerticalStepper";
import React, { useState } from "react";
import InputStepper from "./InputStepper";
import AnalysisStepper from "./AnalysisStepper";
import useAppStore from '../useAppStore';
import { notify } from "../utils/notify";
import FinalResultsPage from "./FinalResultsPage";

// Mode is now read from useAppStore.trafficMode

export default function ArrowStepper() {
  // Track Vehicle/Grid selection for Results step, default to empty
  const [resultsSelection, setResultsSelection] = useState("");
  const inputSteps = [
    "Vehicle Classification Data",
    "Projected Vehicle Penetration Rate Data",
    "Traffic Volume and Speed",
    "Projected Demand",
  ];
  const analysisSteps = [
    "Vehicle Energy Consumption and Emission Rates",
    "Grid Emission Rates"
  ];
  const [activeStep, setActiveStep] = useState(-1);
  // Track sub-step for Input Data
  const [inputSubStep, setInputSubStep] = useState(0);
  // Track sub-step for Analysis
  const [analysisSubStep, setAnalysisSubStep] = useState(0);
  const steps = ["Input Data", "Analysis", "Results"];

  const handleStart = () => setActiveStep(0);

  // Zustand store hooks (must be inside component)
  const classificationState = useAppStore((s) => s.classificationState);
  const penetrationState = useAppStore((s) => s.penetrationState);
  const trafficVolumeState = useAppStore((s) => s.trafficVolumeState);
  const ConsumptionAndEmission = useAppStore((s) => s.ConsumptionAndEmission);
  const GridEmission = useAppStore((s) => s.GridEmission);

  const trafficMode = useAppStore((s) => s.trafficMode);

  // Validation helpers based on selected traffic mode
  const trafficDataComplete = trafficMode === "ABM"
    ? trafficVolumeState.speedEstimated
    : trafficVolumeState.trafficMFTParametersData.length > 0;

  const inputDataComplete =
    classificationState.classificationData.length > 0 &&
    penetrationState.penetrationData.length > 0 &&
    trafficDataComplete;

  const analysisDataComplete =
    ConsumptionAndEmission.FuelType &&
    ConsumptionAndEmission.EmissionType &&
    ConsumptionAndEmission.VehicleAge &&
    GridEmission.EmissionType;

  const handleNext = () => {
    if (activeStep === 0 && !inputDataComplete) {
      notify('Please upload all required Input Data CSV files before proceeding to Analysis.');
      return;
    }
    if (activeStep === 1 && !analysisDataComplete) {
      notify('Please complete all Analysis selections before proceeding to Results.');
      return;
    }
    if (activeStep === 2 && (!resultsSelection || (resultsSelection !== 'VEHICLE' && resultsSelection !== 'GRID'))) {
      notify('Please select either Vehicle or Grid before proceeding.');
      return;
    }
    setActiveStep((s) => (s < steps.length - 1 ? s + 1 : s));
  };
  const handleBack = () => setActiveStep((s) => (s > 0 ? s - 1 : s));

  const getStepStyle = (index) => {
    const isActive = index === activeStep;
    const isCompleted = index < activeStep;

    let base =
      "relative flex items-center justify-center px-8 py-3 text-sm font-medium transition-all duration-200 ";

    if (index === 0) base += "clip-path-first ";
    else if (index === steps.length - 1) base += "clip-path-last ";
    else base += "clip-path-middle ";

    if (isActive) base += "bg-[#10b981] text-white z-20";
    else if (isCompleted) base += "bg-white text-green-700 z-10";
    else base += "bg-white text-gray-600 z-0";

    return base;
  };

  return (
    <div
      className="arrow-stepper flex flex-col gap-4 p-4"
    >
      <style>{`
        .arrow-stepper { --arrow: 10px; --border-width: 4px; }
        .clip-path-first {
          clip-path: polygon(
            0 0,
            calc(100% - var(--arrow)) 0,
            100% 50%,
            calc(100% - var(--arrow)) 100%,
            0 100%
          );
          margin-right: calc(-1 * var(--arrow));
        }
        .clip-path-first::before {
          content: "";
          position: absolute;
          top: calc(-1 * var(--border-width));
          left: calc(-1 * var(--border-width));
          right: calc(-1 * var(--border-width));
          bottom: calc(-1 * var(--border-width));
          background: #10b981;
          clip-path: polygon(
            0 0,
            calc(100% - var(--arrow)) 0,
            100% 50%,
            calc(100% - var(--arrow)) 100%,
            0 100%
          );
          z-index: -2;
        }
        .clip-path-first::after {
          content: "";
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          background: inherit;
          clip-path: polygon(
            calc(var(--border-width)) calc(var(--border-width)),
            calc(100% - var(--arrow) - var(--border-width)) calc(var(--border-width)),
            calc(100% - var(--border-width)) 50%,
            calc(100% - var(--arrow) - var(--border-width)) calc(100% - var(--border-width)),
            calc(var(--border-width)) calc(100% - var(--border-width))
          );
          z-index: -1;
        }
        .clip-path-middle {
          clip-path: polygon(
            0% 0%,
            calc(100% - var(--arrow)) 0%,
            100% 50%,
            calc(100% - var(--arrow)) 100%,
            0% 100%,
            var(--arrow) 50%
          );
          margin-right: calc(-1 * var(--arrow));
        }
        .clip-path-middle::before {
          content: "";
          position: absolute;
          top: calc(-1 * var(--border-width));
          left: calc(-1 * var(--border-width));
          right: calc(-1 * var(--border-width));
          bottom: calc(-1 * var(--border-width));
          background: #10b981;
          clip-path: polygon(
            0% 0%,
            calc(100% - var(--arrow)) 0%,
            100% 50%,
            calc(100% - var(--arrow)) 100%,
            0% 100%,
            var(--arrow) 50%
          );
          z-index: -2;
        }
        .clip-path-middle::after {
          content: "";
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          background: inherit;
          clip-path: polygon(
            calc(var(--border-width)) calc(var(--border-width)),
            calc(100% - var(--arrow) - var(--border-width)) calc(var(--border-width)),
            calc(100% - var(--border-width)) 50%,
            calc(100% - var(--arrow) - var(--border-width)) calc(100% - var(--border-width)),
            calc(var(--border-width)) calc(100% - var(--border-width)),
            calc(var(--arrow) + var(--border-width)) 50%
          );
          z-index: -1;
        }
        .clip-path-last {
          clip-path: polygon(
            0% 0%,
            100% 0%,
            100% 100%,
            0% 100%,
            var(--arrow) 50%
          );
        }
        .clip-path-last::before {
          content: "";
          position: absolute;
          top: calc(-1 * var(--border-width));
          left: calc(-1 * var(--border-width));
          right: calc(-1 * var(--border-width));
          bottom: calc(-1 * var(--border-width));
          background: #10b981;
          clip-path: polygon(
            0% 0%,
            100% 0%,
            100% 100%,
            0% 100%,
            var(--arrow) 50%
          );
          z-index: -2;
        }
        .clip-path-last::after {
          content: "";
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          background: inherit;
          clip-path: polygon(
            calc(var(--border-width)) calc(var(--border-width)),
            calc(100% - var(--border-width)) calc(var(--border-width)),
            calc(100% - var(--border-width)) calc(100% - var(--border-width)),
            calc(var(--border-width)) calc(100% - var(--border-width)),
            calc(var(--arrow) + var(--border-width)) 50%
          );
          z-index: -1;
        }
        .clip-path-first span,
        .clip-path-middle span,
        .clip-path-last span {
          position: relative;
          z-index: 1;
        }
      `}</style>

      {/* Top row: arrow stepper and vertical stepper side by side */}
      <div className="flex flex-row items-start gap-8 w-full max-w-7xl mx-auto justify-between">
        {/* Arrow stepper */}
        <div className="flex items-center gap-4">
          {steps.map((step, index) => (
            <div key={step} className={getStepStyle(index) + " min-w-[232px]"}>
              <span>{step}</span>
            </div>
          ))}
          {/* Start button beside Results */}
          {activeStep === -1 && (
            <button
              onClick={handleStart}
              className="ml-8 px-8 py-3 bg-blue-400 text-white rounded-lg font-medium hover:bg-blue-500 transition-colors"
            >
              Start
            </button>
          )}
        </div>
        {/* Vertical stepper: only show after Start is clicked */}
        {activeStep !== -1 && (
          <div>
            {(() => {
              let stepperActiveStep = 0;
              let stepperSteps = inputSteps;
              if (activeStep === 0) {
                stepperActiveStep = inputSubStep;
                stepperSteps = inputSteps;
                return <VehicleStepper activeStep={stepperActiveStep} steps={stepperSteps} onStepChange={setInputSubStep} />;
              } else if (activeStep === 1) {
                stepperActiveStep = analysisSubStep;
                stepperSteps = analysisSteps;
                return <VehicleStepper activeStep={stepperActiveStep} steps={stepperSteps} onStepChange={setAnalysisSubStep} />;
              } else if (activeStep === 2) {
                // Use Vehicle/Grid selection from FinalResultsPage
                stepperActiveStep = resultsSelection === "GRID" ? 1 : 0;
                stepperSteps = analysisSteps;
                // ADDED: onStepChange handler to switch tabs
                return (
                  <VehicleStepper
                    activeStep={stepperActiveStep}
                    steps={stepperSteps}
                    onStepChange={(index) => {
                       setResultsSelection(index === 0 ? "VEHICLE" : "GRID");
                    }}
                  />
                );
              }
              return <VehicleStepper activeStep={stepperActiveStep} steps={stepperSteps} />;
            })()}
          </div>
        )}
      </div>

            {/* Unified row: navigation and step content centered between edges and radio buttons */}
      <div className="flex flex-col gap-4 w-full items-center" style={{ paddingRight: activeStep !== -1 ? 280 : 0 }}>
        {/* Step Content (InputStepper, AnalysisStepper, GridEmissionRates) */}
        <div className="flex-1 w-full">
          {activeStep === 0 && (
            <div className="p-4 bg-white">
              <InputStepper
                finalNext={handleNext}
                activeStep={inputSubStep}
                setActiveStep={setInputSubStep}
              />
            </div>
          )}
          {activeStep === 1 && (
            <div className="p-4 bg-white">
              <AnalysisStepper
                finalNext={(direction) => {
                  if (direction === 'back') {
                    handleBack();
                  } else {
                    handleNext();
                  }
                }}
                activeStep={analysisSubStep}
                setActiveStep={setAnalysisSubStep}
                hideNavigation={false}
                customNavButton={({ activeStep: analysisStep, steps: analysisSteps }) =>
                  analysisStep === analysisSteps.length - 1 ? (
                    <div className="flex gap-4 justify-center mt-6">
                      <button
                        onClick={handleNext}
                        className="px-6 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
                      >
                        Go to Results
                      </button>
                    </div>
                  ) : null
                }
              />
            </div>
          )}
          {activeStep === 2 && (
            <div className="p-4 bg-white">
              <FinalResultsPage
                resultsSelection={resultsSelection}
                setResultsSelection={setResultsSelection}
              />
            </div>
          )}
        </div>

        {/* Navigation Buttons: Back button at the bottom */}
        {activeStep === 2 && (
          <div className="flex justify-start gap-4 w-full max-w-7xl mx-auto pb-4">
            <button
              onClick={handleBack}
              className="px-6 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600 transition-colors"
            >
              Back
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
