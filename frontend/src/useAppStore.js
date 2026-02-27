// src/useAppStore.js
import { create } from "zustand";

/**
 * Global App Store (Zustand)
 * - Mirrors your existing slices
 * - Adds derived fields (speed/weight) and speedTable holder
 * - Extends payload builders to include speed & vehicle weight
 * - Keeps "latest payload/response" for quick debugging
 */
const useAppStore = create((set, get) => ({
    // ------------------------------
    // Vehicle Data for Graphs (persisted across steps)
    // ------------------------------
    vehicleData: {},
    setVehicleData: (dataOrUpdater) =>
      set((state) => ({
        vehicleData:
          typeof dataOrUpdater === "function"
            ? dataOrUpdater(state.vehicleData)
            : dataOrUpdater,
      })),
    resetVehicleData: () => set({ vehicleData: {} }),
  // ------------------------------
  // Notification slice
  // ------------------------------
  notifications: [],
  addNotification: (text) =>
    set((state) => ({
      notifications: [
        ...state.notifications,
        { id: Date.now(), text, at: Date.now(), read: false },
      ],
    })),
  markAllNotificationsAsRead: () =>
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, read: true })),
    })),
  // ------------------------------
  // Classification slice
  // ------------------------------
  classificationState: {
    baseYear: "",
    vehicleType: "",
    city: "",
    cityInput: "",
    classificationFile: null,
    classificationHeaders: [],
    classificationData: [],     // filtered
    allClassificationData: [],  // original
    transactionId: null,
  },
  setClassificationState: (partial) =>
    set((state) => ({
      classificationState: { ...state.classificationState, ...partial },
    })),

    
  // ------------------------------
  // Penetration slice
  // ------------------------------
  penetrationState: {
    projectedYear: "",
    penetrationFile: null,
    penetrationHeaders: [],
    penetrationData: [],     // filtered
    allPenetrationData: [],  // original
  },
  setPenetrationState: (partial) =>
    set((state) => ({
      penetrationState: { ...state.penetrationState, ...partial },
    })),

  // ------------------------------
  // Traffic volume slice
  // ------------------------------
  trafficVolumeState: {
    trafficVolumeFile: null,
    trafficVolumeHeaders: [],
    trafficVolumeData: [],
    trafficMFTParametersFile: null,
    trafficMFTParametersData: [],
    trafficMFTParametersHeaders: [],
    // NEW: computed speeds per (tract, hour) etc. — fill this from your effects
    speedTable: [], // rows like { tract, hour, volume, uf, kj, speed, density }
  },
  setTrafficVolumeState: (partial) =>
    set((state) => ({
      trafficVolumeState: { ...state.trafficVolumeState, ...partial },
    })),

  // ------------------------------
  // Consumption & Emission slice (Vehicle Energy Consumption & Emission Rates)
  // ------------------------------
  ConsumptionAndEmission: {
    FuelType: "",       // e.g., "Diesel Fuel"
    EmissionType: "",   // e.g., "PM2.5 Brake Wear"
    VehicleAge: "",     // e.g., "1".."30"
  },
  setConsumptionAndEmission: (partial) =>
    set((state) => ({
      ConsumptionAndEmission: { ...state.ConsumptionAndEmission, ...partial },
    })),

  // ------------------------------
  // Grid Emission slice
  // ------------------------------
  GridEmission: {
    EmissionType: "",   // e.g., "CO2 Emissions"
  },
  setGridEmission: (partial) =>
    set((state) => ({
      GridEmission: { ...state.GridEmission, ...partial },
    })),

  // ------------------------------
  // Projected Demand slice
  // ------------------------------
  projectedDemandState: {
    projectedTrafficVolumeFile: null,
    projectedTrafficVolumeData: [],
    projectedTrafficVolumeHeaders: [],
  },
  setProjectedDemandState: (partial) =>
    set((state) => ({
      projectedDemandState: { ...state.projectedDemandState, ...partial },
    })),

  // ------------------------------
  // Theme slice
  // ------------------------------
  theme: "light",
  setTheme: (theme) => set({ theme }),

  // ------------------------------
  // Derived values (filled dynamically by your components/effects)
  // ------------------------------
  derived: {
    // City/tract average speed in km/h (volume-weighted), computed from volume+MFD
    speedKmh: null,
    // Vehicle curb weight in kg, derived from classification table or backend metadata
    vehicleWeightKg: null,
  },
  setDerived: (partial) =>
    set((state) => ({ derived: { ...state.derived, ...partial } })),

  // ============================================================
  // Helpers: Build payloads for backend APIs
  // ============================================================

  /**
   * Build JSON for Vehicle Energy Consumption & Emission prediction.
   * Combines ConsumptionAndEmission, city, and NEW derived fields.
   */
  buildConsumptionPayload: () => {
    const { ConsumptionAndEmission, classificationState, derived } = get();
    return {
      fuel_type: ConsumptionAndEmission.FuelType || "",
      emission_type: ConsumptionAndEmission.EmissionType || "",
      vehicle_age: Number(ConsumptionAndEmission.VehicleAge || 0),
      city: classificationState.city || classificationState.cityInput || "",
      // NEW dynamic fields (null until computed by your effects)
      speed_kmh: derived.speedKmh,
      vehicle_weight_kg: derived.vehicleWeightKg,
    };
  },

  /**
   * Build JSON for Grid Emission related calls.
   */
  buildGridPayload: () => {
    const { GridEmission, classificationState } = get();
    return {
      emission_type: GridEmission.EmissionType || "",
      city: classificationState.city || classificationState.cityInput || "",
    };
  },

  // ============================================================
  // Optional: keep latest request/response in store for debugging/Results
  // ============================================================
  latestConsumptionPayload: null,
  latestConsumptionResponse: null,
  setLatestConsumptionPayload: (payload) => set({ latestConsumptionPayload: payload }),
  setLatestConsumptionResponse: (resp) => set({ latestConsumptionResponse: resp }),

  latestGridPayload: null,
  latestGridResponse: null,
  setLatestGridPayload: (payload) => set({ latestGridPayload: payload }),
  setLatestGridResponse: (resp) => set({ latestGridResponse: resp }),

  // ============================================================
  // Optional: quick reset helpers (use wherever handy)
  // ============================================================
  resetConsumptionAndEmission: () =>
    set(() => ({
      ConsumptionAndEmission: { FuelType: "", EmissionType: "", VehicleAge: "" },
    })),
  resetGridEmission: () =>
    set(() => ({
      GridEmission: { EmissionType: "" },
    })),
  resetClassification: () =>
    set(() => ({
      classificationState: {
        baseYear: "",
        vehicleType: "",
        city: "",
        cityInput: "",
        classificationFile: null,
        classificationHeaders: [],
        classificationData: [],
        allClassificationData: [],
      },
    })),
}));

export default useAppStore;
