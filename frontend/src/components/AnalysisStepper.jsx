import React from "react";
import EnergyConsumptionAndEmissionRates from "./EnergyConsumptionAndEmissionRates";
import GridEmissionRates from "./GridEmissionRates";
import IconButton from "@mui/material/IconButton";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import Stack from "@mui/material/Stack";

const steps = [
  "Vehicle Energy Consumption and Emission Rates",
  " Grid Emission Rates",
];


import useAppStore from "../useAppStore";

function AnalysisStepper({ finalNext, activeStep, setActiveStep }) {

  // Get all user selections from Zustand
  const classificationState = useAppStore((s) => s.classificationState);
  const ConsumptionAndEmissionState = useAppStore((s) => s.ConsumptionAndEmission);

  // Combine all user selections into one variable
  const userSelections = {
    fuelType: ConsumptionAndEmissionState.FuelType,
    emissionType: ConsumptionAndEmissionState.EmissionType,
    vehicleAge: ConsumptionAndEmissionState.VehicleAge,
    city: classificationState.city || classificationState.cityInput,
  };

  const handleNext = () => {
    console.log("next button clicked");
    if (activeStep < steps.length - 1) {
      setActiveStep((prev) => prev + 1);
    } else if (steps.length == 2) {
      finalNext();
    }
  };

  const handleBack = () => {
    if (activeStep > 0) {
      setActiveStep((prev) => prev - 1);
    } else if (typeof finalNext === 'function') {
      // If on first analysis step, call parent to go back to previous main step
      finalNext('back');
    }
  };

  return (
    <div className="flex flex-col items-center gap-5 pl-6 pt-4">
      {/* Step-wise content only, stepper UI removed */}
      <div className="w-full">
        {activeStep === 0 && (
          <EnergyConsumptionAndEmissionRates activeStep={activeStep} userSelections={userSelections} />
        )}
        {activeStep === 1 && (
          <GridEmissionRates activeStep={activeStep} />
        )}
      </div>

      {/* Navigation Buttons */}
      {activeStep === 0 ? (
        <div className="w-full max-w-3xl mx-auto flex flex-row items-center gap-6 mt-2">
          <button
            onClick={handleBack}
            className="px-6 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600 transition-colors -ml-50"
          >
            Back
          </button>
          <div className="flex flex-row items-center gap-2 w-full relative" style={{ minHeight: '56px' }}>
            <button
              className="bg-blue-500 text-white px-4 py-2 rounded disabled:opacity-50 absolute"
              style={{ minWidth: '90px', right: '-400px' }}
              onClick={handleNext}
              disabled={activeStep === 1}
            >
              Next
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-row mt-4 w-full items-center justify-between px-8">
          <button
            onClick={handleBack}
            className="px-6 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600 transition-colors"
            style={{ marginLeft: '28px' }}
          >
            Back
          </button>
          <div></div>
          <button
            className="bg-green-600 text-white px-4 py-2 rounded"
            onClick={finalNext}
            style={{ minWidth: '120px', marginRight: '20px' }}
          >
            Go to Results
          </button>
        </div>
      )}
    </div>
  );
}

export default AnalysisStepper;
