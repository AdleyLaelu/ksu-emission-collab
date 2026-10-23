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
    // Results staleness tracking
    // ------------------------------
    resultsStale: true,
    lastGeneratedFingerprint: null,

    markResultsStale: () => set({ resultsStale: true }),
    markResultsFresh: (fingerprint) =>
      set({ resultsStale: false, lastGeneratedFingerprint: fingerprint }),

    /** Derive a simple fingerprint from current inputs to detect meaningful changes */
    computeInputFingerprint: () => {
      const s = get();
      const parts = [
        s.classificationState.city || s.classificationState.cityInput || "",
        s.classificationState.baseYear || "",
        s.penetrationState.projectedYear || "",
        s.trafficMode || "",
        String(s.classificationState.classificationData?.length || 0),
        String(s.penetrationState.penetrationData?.length || 0),
        String(s.trafficVolumeState.trafficVolumeData?.length || 0),
        String(s.projectedDemandState.projectedTrafficVolumeData?.length || 0),
        Object.keys(s.classificationState.vrYearUploads || {}).sort().join(","),
      ];
      return parts.join("|");
    },

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
    vrYearUploads: {},    // { [year]: { file, headers, data, uploadedAt } }
    selectedVrYear: null, // currently selected year in VR year list
  },
  setClassificationState: (partial) =>
    set((state) => {
      const update = { classificationState: { ...state.classificationState, ...partial } };
      // Mark stale if data-bearing fields changed
      if ('classificationData' in partial || 'city' in partial || 'cityInput' in partial || 'baseYear' in partial || 'classificationFile' in partial || 'vrYearUploads' in partial) {
        update.resultsStale = true;
      }
      return update;
    }),

    
  // ------------------------------
  // Penetration slice
  // ------------------------------
  penetrationState: {
    projectedYear: "",
    penetrationFile: null,
    penetrationHeaders: [],
    penetrationData: [],     // filtered
    allPenetrationData: [],  // original
    yearUploads: {},         // { [year]: { file, headers, data } }
    selectedYear: null,      // currently selected year in the year list
  },
  setPenetrationState: (partial) =>
    set((state) => {
      const update = { penetrationState: { ...state.penetrationState, ...partial } };
      if ('penetrationData' in partial || 'projectedYear' in partial || 'penetrationFile' in partial) {
        update.resultsStale = true;
      }
      return update;
    }),

  // ------------------------------
  // Traffic mode slice (ABM vs MFD, locked after Step 2 confirms)
  // ------------------------------
  trafficMode: null,       // "ABM" | "MFD" | null (not yet chosen)
  trafficModeLocked: false, // true after user proceeds past Step 2
  setTrafficMode: (mode) => set({ trafficMode: mode }),
  lockTrafficMode: () => set({ trafficModeLocked: true }),
  resetTrafficMode: () => set({ trafficMode: null, trafficModeLocked: false }),

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
    abmFile: null,  // uploaded ABM CSV file
    speedTable: [],
  },
  setTrafficVolumeState: (partial) =>
    set((state) => {
      const update = { trafficVolumeState: { ...state.trafficVolumeState, ...partial } };
      if ('trafficVolumeData' in partial || 'trafficVolumeFile' in partial || 'abmFile' in partial || 'trafficMFTParametersData' in partial) {
        update.resultsStale = true;
      }
      return update;
    }),

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
    abmProjectedFile: null,
    // Cache: { [year]: { file, chartData, methodUsed } }
    yearCache: {},
    // Per-year upload tracking (like penetrationState.yearUploads)
    selectedYear: null,
    // { [year]: { file, chartData, methodUsed } }
    yearUploads: {},
  },
  setProjectedDemandState: (partial) =>
    set((state) => {
      const update = { projectedDemandState: { ...state.projectedDemandState, ...partial } };
      if ('projectedTrafficVolumeData' in partial || 'projectedTrafficVolumeFile' in partial || 'abmProjectedFile' in partial) {
        update.resultsStale = true;
      }
      return update;
    }),

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
        transactionId: null,
        vrYearUploads: {},
        selectedVrYear: null,
      },
    })),
}));

export default useAppStore;
