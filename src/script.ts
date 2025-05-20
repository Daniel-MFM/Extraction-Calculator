// src/script.ts

/**
 * @file Manages the application logic for the Kitchen Hood Airflow Estimator.
 * This includes state management, DOM manipulation, and calculation logic.
 */

/**
 * Represents the type of energy an piece of equipment uses.
 */
export enum EquipmentType {
  ELECTRIC = 'ELECTRIC', // Equipment powered by electricity.
  GAS = 'GAS',           // Equipment powered by gas.
}

/**
 * Represents the unit of gas consumption.
 */
export enum GasUnit {
  M3_PER_HOUR = 'M3_PER_HOUR',   // Cubic meters per hour (m³/h).
  KG_PER_HOUR = 'KG_PER_HOUR',   // Kilograms per hour (kg/h).
  KW = 'KW',                     // Kilowatts (kW) - direct power input.
  BTU_PER_HOUR = 'BTU_PER_HOUR', // British Thermal Units per hour (BTU/h).
}

/**
 * Interface for a piece of kitchen equipment.
 * Defines the structure for storing data about each equipment item.
 */
export interface Equipment {
  id: string;                      // Unique identifier (e.g., timestamp or counter).
  name: string;                    // User-defined name for the equipment.
  type: EquipmentType;             // Type of energy source (ELECTRIC or GAS).
  gasType?: string;                // Key in GAS_CALORIFIC_VALUES, if type is GAS.
  gasConsumption?: number;         // Consumption value, if type is GAS.
  gasUnit?: GasUnit;               // Unit of gasConsumption, if type is GAS.
  electricConsumption?: number;    // Electric consumption in kW, if type is ELECTRIC.
  sensibleFactor: number;          // User-defined factor (e.g., 0.3 to 0.7) for sensible heat.
  totalPower?: number;             // Calculated total power in kW.
  sensibleHeat?: number;           // Calculated sensible heat in kW (totalPower * sensibleFactor).
}

/**
 * Interface for a type of kitchen hood.
 * Defines the structure for different hood types and their K factors.
 */
export interface HoodType {
  id: string;                      // Unique identifier for the hood type.
  name: string;                    // Display name of the hood type.
  kFactorMin: number;              // Minimum K factor for this hood type.
  kFactorMax: number;              // Maximum K factor for this hood type.
  kFactorDefault: number;          // Default K factor for calculation.
  notes?: string;                  // Additional notes or context for the hood type.
}

/**
 * Interface for gas calorific values.
 * Defines the structure for storing calorific properties of different gases.
 */
export interface GasCalorificValue {
  id: string;                      // Unique identifier for the gas type.
  name: string;                    // Display name of the gas.
  value: number;                   // Calorific value in kWh per unit (e.g., kWh/m³ or kWh/kg).
  unit: 'kWh/m³' | 'kWh/kg';       // Unit corresponding to the calorific value.
}

/**
 * Display names for EquipmentType.
 * Used for populating UI elements like dropdowns.
 */
export const EQUIPMENT_TYPES: { [key in EquipmentType]: string } = {
  [EquipmentType.ELECTRIC]: 'Elétrico',
  [EquipmentType.GAS]: 'Gás',
};

/**
 * Display names and conversion factors for GasUnit.
 * - `factorToKwh` for M3_PER_HOUR and KG_PER_HOUR is `null` as they depend on the selected gas's calorific value.
 * - `KW` has a direct 1-to-1 conversion to kWh (assuming 1 hour of operation for power).
 * - `BTU_PER_HOUR` uses a standard conversion factor to kW.
 */
export const GAS_UNITS: {
  [key in GasUnit]: { displayName: string; factorToKwh: number | null };
} = {
  [GasUnit.M3_PER_HOUR]: { displayName: 'm³/h', factorToKwh: null },
  [GasUnit.KG_PER_HOUR]: { displayName: 'kg/h', factorToKwh: null },
  [GasUnit.KW]: { displayName: 'kW', factorToKwh: 1 }, // kW is already a power unit.
  [GasUnit.BTU_PER_HOUR]: { displayName: 'BTU/h', factorToKwh: 0.000293071 }, // Standard conversion factor.
};

/**
 * Standard kitchen hood types and their K factors.
 * K factors are typically in (m³/h)/kW. These values are indicative and may vary.
 */
export const HOOD_TYPES: HoodType[] = [
  {
    id: 'wall_mounted',
    name: 'Hotte de Encosto (Mural)',
    kFactorMin: 150,
    kFactorMax: 250,
    kFactorDefault: 200,
    notes: 'Carga média',
  },
  {
    id: 'island_central',
    name: 'Hotte Central (Ilha)',
    kFactorMin: 250,
    kFactorMax: 350,
    kFactorDefault: 300,
    notes: 'Carga média',
  },
  {
    id: 'eyebrow',
    name: 'Hotte de Sobrancelha',
    kFactorMin: 100, // Placeholder - research may be needed for more accurate values.
    kFactorMax: 200, // Placeholder - research may be needed for more accurate values.
    kFactorDefault: 150, // Placeholder - research may be needed for more accurate values.
    notes: 'Valores de K típicos a pesquisar',
  },
  {
    id: 'slot',
    name: 'Hotte de Fenda',
    kFactorMin: 100, // Placeholder - research may be needed for more accurate values.
    kFactorMax: 200, // Placeholder - research may be needed for more accurate values.
    kFactorDefault: 150, // Placeholder - research may be needed for more accurate values.
    notes: 'Valores de K típicos a pesquisar',
  },
];

/**
 * Calorific values (PCI - Poder Calorífico Inferior) for common gases.
 * These values represent the heat released by combustion.
 */
export const GAS_CALORIFIC_VALUES: { [key: string]: GasCalorificValue } = {
  natural_g20: {
    id: 'natural_g20',
    name: 'Gás Natural G20',
    value: 10, // kWh/m³
    unit: 'kWh/m³',
  },
  natural_g25: {
    id: 'natural_g25',
    name: 'Gás Natural G25',
    value: 8.6, // kWh/m³
    unit: 'kWh/m³',
  },
  propane_g31: {
    id: 'propane_g31',
    name: 'Propano G31',
    value: 12.8, // kWh/kg
    unit: 'kWh/kg',
  },
  butane_g30: {
    id: 'butane_g30',
    name: 'Butano G30',
    value: 12.7, // kWh/kg
    unit: 'kWh/kg',
  },
};

/**
 * General unit conversion factors.
 */
export const UNIT_CONVERSION_FACTORS = {
  BTU_PER_HOUR_TO_KW: 0.000293071, // Factor to convert BTU/h to kW.
};

/**
 * @namespace App
 * @description Main application object that encapsulates state, DOM interaction, and calculation logic.
 */
const App = {
  // --- STATE ---
  /**
   * @property {Equipment[]} equipmentList - Array holding all equipment items added by the user.
   */
  equipmentList: [] as Equipment[],
  /**
   * @property {number} simultaneityFactor - Factor accounting for simultaneous use of equipment (0.0 to 1.0).
   * Applied to the total sensible heat in the Heat Load calculation method.
   */
  simultaneityFactor: 1.0,
  /**
   * @property {string | null} selectedHoodType - ID of the currently selected hood type from `HOOD_TYPES`.
   * Used in the Heat Load calculation method.
   */
  selectedHoodType: HOOD_TYPES.length > 0 ? HOOD_TYPES[0].id : null,
  /**
   * @property {'heatload' | 'dimensions'} currentCalculationMethod - The calculation method currently selected by the user.
   */
  currentCalculationMethod: 'heatload' as 'heatload' | 'dimensions',
  /**
   * @property {object} hoodDimensions - Stores dimensions for the Hood Dimensions calculation method.
   * @property {number} hoodDimensions.length - Length of the hood in meters.
   * @property {number} hoodDimensions.width - Width of the hood in meters.
   * @property {number} hoodDimensions.captureVelocity - Desired capture velocity in m/s.
   */
  hoodDimensions: {
    length: 1.2, // Example default length in meters.
    width: 0.8,  // Example default width in meters.
    captureVelocity: 0.25 // Example default capture velocity in m/s.
  },

  // --- METHODS ---

  /**
   * @method init
   * @description Initializes the application. Sets up UI, populates dropdowns, attaches event listeners,
   * and performs initial calculations. Should be called on DOMContentLoaded.
   * @sideEffects Modifies DOM by populating dropdowns, setting initial input values, and adding an equipment row.
   *              Attaches multiple event listeners to various DOM elements.
   *              Calls `App.updateResults()` which further modifies the DOM with calculation results.
   */
  init: () => {
    // console.log("App initialized. Ensure DOM is ready before manipulating it.");

    // 1. Set up UI visibility for calculation methods and perform initial update.
    // This call also triggers App.updateResults() for the first time.
    App.toggleCalculationMethodUI();

    // 2. Populate dropdowns for selection.
    App.populateHoodTypesDropdown();
    // App.populateGasTypesDropdown(); // Placeholder for potential future global gas type selection.

    // 3. Set up event listeners for buttons and global inputs.

    // Add Equipment Button for the Heat Load method.
    const addEquipmentButton = document.getElementById('addEquipmentButton');
    if (addEquipmentButton) {
      addEquipmentButton.addEventListener('click', () => App.addEquipmentRow());
    } else {
      console.error('Add Equipment button not found.');
    }

    // Simultaneity Factor input for the Heat Load method.
    const simultaneityFactorInput = document.getElementById('simultaneityFactor') as HTMLInputElement;
    if (simultaneityFactorInput) {
        simultaneityFactorInput.value = App.simultaneityFactor.toString(); // Set initial value from state.
        simultaneityFactorInput.addEventListener('input', () => {
            const val = parseFloat(simultaneityFactorInput.value);
            if (!isNaN(val)) {
                App.simultaneityFactor = val; // Update state.
            }
            App.updateResults(); // Recalculate and update UI.
        });
    }

    // Hood Dimensions Inputs for the Hood Dimensions method.
    const hoodLengthInput = document.getElementById('hoodLength') as HTMLInputElement;
    const hoodWidthInput = document.getElementById('hoodWidth') as HTMLInputElement;
    const captureVelocityInput = document.getElementById('captureVelocity') as HTMLInputElement;

    // Set initial values for dimension inputs from state.
    if (hoodLengthInput) hoodLengthInput.value = App.hoodDimensions.length.toString();
    if (hoodWidthInput) hoodWidthInput.value = App.hoodDimensions.width.toString();
    if (captureVelocityInput) captureVelocityInput.value = App.hoodDimensions.captureVelocity.toString();

    // Common listener for dimension inputs.
    const dimensionInputsListener = () => {
        // Values are read and stored in App.calculateAirflowDimensions (called via App.updateResults).
        App.updateResults();
    };

    if (hoodLengthInput) hoodLengthInput.addEventListener('input', dimensionInputsListener);
    if (hoodWidthInput) hoodWidthInput.addEventListener('input', dimensionInputsListener);
    if (captureVelocityInput) captureVelocityInput.addEventListener('input', dimensionInputsListener);

    // Note: Event listener for hoodTypeSelect is set up within App.populateHoodTypesDropdown.

    // 4. Add an initial equipment row for the Heat Load method.
    // This also indirectly calls App.updateResults() via its internal logic.
    App.addEquipmentRow();

    // 5. Final comprehensive update based on all initial state.
    // Ensures all calculations and UI elements are consistent after setup.
    App.updateResults();
  },

  /**
   * @method toggleGasFields
   * @description Enables/disables gas-specific input fields in an equipment row based on equipment type.
   * Clears values of fields when they are disabled.
   * @param {HTMLTableRowElement} rowElement - The table row element containing the input fields.
   * @param {boolean} isGasType - True if the equipment type is GAS, false otherwise.
   * @sideEffects Modifies the `disabled` property and `value` of input fields within the row.
   *              Updates the corresponding `Equipment` object in `App.equipmentList`.
   *              Calls `App.updateAndDisplayEquipmentCalculations` which updates DOM and state.
   */
  toggleGasFields: (rowElement: HTMLTableRowElement, isGasType: boolean) => {
    const gasTypeSelect = rowElement.querySelector('.equip-gas-type-select') as HTMLSelectElement;
    const gasConsumptionInput = rowElement.querySelector('.equip-gas-consumption-input') as HTMLInputElement;
    const gasUnitSelect = rowElement.querySelector('.equip-gas-unit-select') as HTMLSelectElement;
    const electricConsumptionInput = rowElement.querySelector('.equip-electric-consumption-input') as HTMLInputElement;

    // Enable/disable fields based on whether the equipment is gas type.
    if (gasTypeSelect) gasTypeSelect.disabled = !isGasType;
    if (gasConsumptionInput) gasConsumptionInput.disabled = !isGasType;
    if (gasUnitSelect) gasUnitSelect.disabled = !isGasType;
    if (electricConsumptionInput) electricConsumptionInput.disabled = isGasType;

    // Clear values and update state when fields are disabled.
    const equipmentId = rowElement.dataset.equipmentId;
    if (!equipmentId) {
      console.error('Equipment ID not found on row element for toggleGasFields.');
      return;
    }
    const equipment = App.equipmentList.find(e => e.id === equipmentId);
    if (!equipment) {
      console.error(`Equipment with ID ${equipmentId} not found in App.equipmentList.`);
      return;
    }

    if (!isGasType) { // If switching to Electric
      if (gasConsumptionInput) gasConsumptionInput.value = '';
      if (gasTypeSelect) gasTypeSelect.value = ''; // Reset selection
      if (gasUnitSelect) gasUnitSelect.value = '';   // Reset selection
      equipment.gasType = undefined;
      equipment.gasConsumption = undefined;
      equipment.gasUnit = undefined;
    } else { // If switching to Gas
      if (electricConsumptionInput) electricConsumptionInput.value = '';
      equipment.electricConsumption = undefined;
    }

    // Update the specific equipment's calculations and display.
    // This implicitly calls App.updateResults() if changes are made that affect overall results.
    App.updateAndDisplayEquipmentCalculations(equipmentId);
  },

  /**
   * @method calculateEquipmentPower
   * @description Calculates the total power of a single piece of equipment in kW.
   * @param {Equipment} equipment - The equipment object to calculate power for.
   * @returns {number} The calculated total power in kW, or 0 if data is insufficient.
   */
  calculateEquipmentPower: (equipment: Equipment): number => {
    if (!equipment) return 0;

    if (equipment.type === EquipmentType.ELECTRIC) {
      return equipment.electricConsumption || 0; // Assumes electricConsumption is already in kW.
    }

    if (equipment.type === EquipmentType.GAS) {
      const { gasConsumption, gasType, gasUnit } = equipment;
      // Basic validation for gas equipment inputs.
      if (!gasConsumption || !gasType || !gasUnit || gasConsumption === 0) {
        return 0;
      }

      const gasCalorificData = GAS_CALORIFIC_VALUES[gasType];
      if (!gasCalorificData) {
        console.error(`Gas calorific value not found for type: ${gasType}`);
        return 0;
      }

      let powerInKw = 0;
      switch (gasUnit) {
        case GasUnit.KW: // If consumption is directly provided in kW.
          powerInKw = gasConsumption;
          break;
        case GasUnit.BTU_PER_HOUR:
          powerInKw = gasConsumption * UNIT_CONVERSION_FACTORS.BTU_PER_HOUR_TO_KW;
          break;
        case GasUnit.M3_PER_HOUR: // Requires calorific value in kWh/m³.
          if (gasCalorificData.unit === 'kWh/m³') {
            powerInKw = gasConsumption * gasCalorificData.value;
          } else {
            console.error(`Incompatible gas unit (${gasUnit}) and calorific value unit (${gasCalorificData.unit}) for ${gasType}. Expected kWh/m³.`);
            return 0;
          }
          break;
        case GasUnit.KG_PER_HOUR: // Requires calorific value in kWh/kg.
          if (gasCalorificData.unit === 'kWh/kg') {
            powerInKw = gasConsumption * gasCalorificData.value;
          } else {
            console.error(`Incompatible gas unit (${gasUnit}) and calorific value unit (${gasCalorificData.unit}) for ${gasType}. Expected kWh/kg.`);
            return 0;
          }
          break;
        default:
          console.warn(`Unknown gas unit: ${gasUnit}`);
          return 0;
      }
      return powerInKw;
    }
    return 0; // Default case if type is neither ELECTRIC nor GAS.
  },

  /**
   * @method calculateSensibleHeat
   * @description Calculates the sensible heat produced by a piece of equipment.
   * @param {Equipment} equipment - The equipment object. Requires `totalPower` and `sensibleFactor` to be set.
   * @returns {number} The calculated sensible heat in kW.
   */
  calculateSensibleHeat: (equipment: Equipment): number => {
    if (!equipment) return 0;
    // Sensible heat is total power multiplied by the sensible heat factor.
    return (equipment.totalPower || 0) * (equipment.sensibleFactor || 0);
  },

  /**
   * @method updateAndDisplayEquipmentCalculations
   * @description Recalculates total power and sensible heat for a specific equipment item
   * and updates its display in the table.
   * @param {string} equipmentId - The ID of the equipment to update.
   * @sideEffects Updates `totalPower` and `sensibleHeat` in the `App.equipmentList` for the given ID.
   *              Updates the text content of corresponding cells in the equipment table.
   */
  updateAndDisplayEquipmentCalculations: (equipmentId: string) => {
    const equipment = App.equipmentList.find(e => e.id === equipmentId);
    if (!equipment) {
      console.warn(`Equipment with ID ${equipmentId} not found for calculation update.`);
      return;
    }

    // Recalculate power and heat.
    equipment.totalPower = App.calculateEquipmentPower(equipment);
    equipment.sensibleHeat = App.calculateSensibleHeat(equipment);

    // Update the DOM.
    const rowElement = document.querySelector(`tr[data-equipment-id="${equipmentId}"]`);
    if (rowElement) {
      const totalPowerSpan = rowElement.querySelector('.equip-potencia-total span');
      if (totalPowerSpan) totalPowerSpan.textContent = equipment.totalPower.toFixed(2);

      const sensibleHeatSpan = rowElement.querySelector('.equip-calor-sensivel span');
      if (sensibleHeatSpan) sensibleHeatSpan.textContent = equipment.sensibleHeat.toFixed(2);
    } else {
      // This might happen if an update is triggered for an item being removed.
      // console.warn(`Row for equipment ID ${equipmentId} not found in DOM for update.`);
    }
  },

  /**
   * @method calculateTotalSensibleHeat
   * @description Calculates the total sensible heat from all equipment, adjusted by the simultaneity factor.
   * @returns {number} The total adjusted sensible heat in kW.
   * @sideEffects Reads the simultaneity factor from the DOM and updates `App.simultaneityFactor` state.
   *              Ensures individual equipment items have their sensible heat calculated if not already present.
   */
  calculateTotalSensibleHeat: (): number => {
    let totalSensibleHeat = 0;
    App.equipmentList.forEach(equipment => {
      // Ensure sensibleHeat is calculated if it wasn't (e.g., on initial load or for newly added items).
      if (equipment.sensibleHeat === undefined) {
         equipment.totalPower = App.calculateEquipmentPower(equipment);
         equipment.sensibleHeat = App.calculateSensibleHeat(equipment);
      }
      totalSensibleHeat += equipment.sensibleHeat || 0;
    });

    // Read simultaneity factor from DOM, parse it, and update App state.
    // This ensures the state is always in sync with the UI input for this factor.
    const simultaneityFactorInput = document.getElementById('simultaneityFactor') as HTMLInputElement;
    let currentSimultaneityFactor = App.simultaneityFactor; // Use stored value as primary.

    if (simultaneityFactorInput) {
        const domFactor = parseFloat(simultaneityFactorInput.value);
        if (!isNaN(domFactor) && domFactor >= 0 && domFactor <= 1) { // Basic validation.
            App.simultaneityFactor = domFactor; // Update state.
            currentSimultaneityFactor = domFactor;
        } else if (simultaneityFactorInput.value !== "") { // If input is not empty but invalid
            // console.warn("Invalid simultaneity factor in DOM, using stored value.");
            // Optionally, reset DOM input to stored valid value:
            // simultaneityFactorInput.value = App.simultaneityFactor.toString();
        }
    }
    return totalSensibleHeat * currentSimultaneityFactor;
  },

  /**
   * @method getHoodKFactor
   * @description Retrieves the K factor details for the currently selected hood type.
   * @returns {{ kValue: number; range: string; notes: string }} An object containing the default K value,
   *         a string representation of the K factor range, and any notes.
   *         Returns a fallback default if the selected hood type is not found.
   */
  getHoodKFactor: (): { kValue: number; range: string; notes: string } => {
    const selectedHoodTypeId = App.selectedHoodType;
    const hoodType = HOOD_TYPES.find(ht => ht.id === selectedHoodTypeId);

    if (!hoodType) {
      console.error(`Selected hood type ID "${selectedHoodTypeId}" not found.`);
      // Provide a fallback default to prevent errors and ensure the app can continue.
      const defaultHood = HOOD_TYPES[0] || { kFactorDefault: 200, kFactorMin: 150, kFactorMax: 250, notes: 'Default fallback' };
      return {
        kValue: defaultHood.kFactorDefault,
        range: `${defaultHood.kFactorMin}-${defaultHood.kFactorMax}`,
        notes: defaultHood.notes || ''
      };
    }
    return {
        kValue: hoodType.kFactorDefault,
        range: `${hoodType.kFactorMin}-${hoodType.kFactorMax}`,
        notes: hoodType.notes || ''
    };
  },

  /**
   * @method calculateAirflowHeatLoad
   * @description Calculates the estimated airflow based on the Heat Load method.
   * Formula: Total Sensible Heat * Hood K Factor.
   * @returns {number} The estimated airflow in m³/h.
   */
  calculateAirflowHeatLoad: (): number => {
    const totalSensibleHeat = App.calculateTotalSensibleHeat();
    const hoodKDetails = App.getHoodKFactor();
    return totalSensibleHeat * hoodKDetails.kValue;
  },

  /**
   * @method calculateAirflowDimensions
   * @description Calculates the estimated airflow based on the Hood Dimensions method.
   * Formula: Hood Length * Hood Width * Capture Velocity * 3600 (to convert m³/s to m³/h).
   * @returns {number} The estimated airflow in m³/h.
   * @sideEffects Reads hood dimensions from DOM and updates `App.hoodDimensions` state.
   */
  calculateAirflowDimensions: (): number => {
    const lengthEl = document.getElementById('hoodLength') as HTMLInputElement;
    const widthEl = document.getElementById('hoodWidth') as HTMLInputElement;
    const velocityEl = document.getElementById('captureVelocity') as HTMLInputElement;

    // Parse values, defaulting to 0 if parsing fails or element is not found.
    const length = parseFloat(lengthEl?.value) || 0;
    const width = parseFloat(widthEl?.value) || 0;
    const velocity = parseFloat(velocityEl?.value) || 0;

    // Store the latest values from DOM into App state.
    App.hoodDimensions.length = length;
    App.hoodDimensions.width = width;
    App.hoodDimensions.captureVelocity = velocity;

    // Basic validation: if any dimension is zero or negative, airflow is zero.
    if (length <= 0 || width <= 0 || velocity <= 0) {
      // Only warn if elements exist but values are invalid.
      // This prevents warnings during initial load before full DOM availability.
      if (lengthEl && widthEl && velocityEl && (lengthEl.value || widthEl.value || velocityEl.value )) {
        // console.warn("Hood dimension input elements have invalid (zero or negative) values.");
      }
      return 0;
    }
    // Convert m³/s (length * width * velocity) to m³/h (multiply by 3600).
    return length * width * velocity * 3600;
  },

  /**
   * @method addEquipmentRow
   * @description Adds a new row to the equipment table in the DOM and a corresponding
   *              equipment object to `App.equipmentList`.
   * @param {Partial<Equipment>} [initialData] - Optional data to pre-fill the new row.
   * @sideEffects Modifies the DOM by adding a `<tr>` to the equipment table.
   *              Updates `App.equipmentList`.
   *              Calls `App.toggleGasFields` and `App.updateAndDisplayEquipmentCalculations`.
   *              Attaches multiple event listeners to the inputs in the new row.
   */
  addEquipmentRow: (initialData?: Partial<Equipment>) => {
    const equipmentId = initialData?.id || Date.now().toString(); // Generate unique ID.
    // Define default values for a new equipment item.
    const newEquipment: Equipment = {
      id: equipmentId,
      name: initialData?.name || '',
      type: initialData?.type || EquipmentType.ELECTRIC, // Default to Electric.
      sensibleFactor: initialData?.sensibleFactor || 0.5, // Default sensible factor.
      electricConsumption: initialData?.electricConsumption,
      gasType: initialData?.gasType,
      gasConsumption: initialData?.gasConsumption,
      gasUnit: initialData?.gasUnit,
      // totalPower and sensibleHeat will be calculated.
    };
    App.equipmentList.push(newEquipment);

    const tableBody = document.getElementById('equipmentTableBody') as HTMLTableSectionElement;
    if (!tableBody) {
      console.error('Equipment table body not found.');
      return;
    }

    const row = tableBody.insertRow(); // Add new row to the table.
    row.dataset.equipmentId = equipmentId; // Store ID on the row for easy access.

    // --- Create and append cells for each equipment property ---

    // 1. Nome Equip. (Name)
    const nameCell = row.insertCell();
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'form-control form-control-sm equip-name-input';
    nameInput.value = newEquipment.name;
    nameInput.addEventListener('input', () => {
      newEquipment.name = nameInput.value;
      // No direct calculation update needed for name change, but could trigger validation if added.
    });
    nameCell.appendChild(nameInput);

    // 2. Tipo Equip. (Type: Electric/Gas)
    const typeCell = row.insertCell();
    const typeSelect = document.createElement('select');
    typeSelect.className = 'form-control form-control-sm equip-type-select';
    for (const key in EQUIPMENT_TYPES) {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = EQUIPMENT_TYPES[key as EquipmentType];
      typeSelect.appendChild(option);
    }
    typeSelect.value = newEquipment.type;
    typeSelect.addEventListener('change', () => {
      newEquipment.type = typeSelect.value as EquipmentType;
      App.toggleGasFields(row, newEquipment.type === EquipmentType.GAS); // Show/hide gas fields.
      // toggleGasFields calls updateAndDisplayEquipmentCalculations, which is sufficient here.
      // App.updateAndDisplayEquipmentCalculations(equipmentId) is called inside toggleGasFields.
      App.updateResults(); // Trigger global update.
    });
    typeCell.appendChild(typeSelect);

    // 3. Tipo Gás (Gas Type)
    const gasTypeCell = row.insertCell();
    const gasTypeSelect = document.createElement('select');
    gasTypeSelect.className = 'form-control form-control-sm equip-gas-type-select';
    const defaultGasOption = document.createElement('option');
    defaultGasOption.value = ''; // Default empty option.
    defaultGasOption.textContent = 'Selecione...';
    gasTypeSelect.appendChild(defaultGasOption);
    for (const key in GAS_CALORIFIC_VALUES) {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = GAS_CALORIFIC_VALUES[key].name;
      gasTypeSelect.appendChild(option);
    }
    gasTypeSelect.value = newEquipment.gasType || '';
    gasTypeSelect.addEventListener('change', () => {
      newEquipment.gasType = gasTypeSelect.value || undefined;
      App.updateAndDisplayEquipmentCalculations(equipmentId);
      App.updateResults();
    });
    gasTypeCell.appendChild(gasTypeSelect);

    // 4. Consumo Gás (Gas Consumption)
    const gasConsumptionCell = row.insertCell();
    const gasConsumptionInput = document.createElement('input');
    gasConsumptionInput.type = 'number';
    gasConsumptionInput.step = 'any'; // Allow decimal input.
    gasConsumptionInput.min = '0';
    gasConsumptionInput.className = 'form-control form-control-sm equip-gas-consumption-input';
    gasConsumptionInput.value = newEquipment.gasConsumption?.toString() || '';
    gasConsumptionInput.addEventListener('input', () => {
      newEquipment.gasConsumption = parseFloat(gasConsumptionInput.value) || undefined;
      App.updateAndDisplayEquipmentCalculations(equipmentId);
      App.updateResults();
    });
    gasConsumptionCell.appendChild(gasConsumptionInput);

    // 5. Unid. Gás (Gas Unit)
    const gasUnitCell = row.insertCell();
    const gasUnitSelect = document.createElement('select');
    gasUnitSelect.className = 'form-control form-control-sm equip-gas-unit-select';
    const defaultUnitOption = document.createElement('option');
    defaultUnitOption.value = ''; // Default empty option.
    defaultUnitOption.textContent = 'Unid.';
    gasUnitSelect.appendChild(defaultUnitOption);
    for (const key in GAS_UNITS) {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = GAS_UNITS[key as GasUnit].displayName;
      gasUnitSelect.appendChild(option);
    }
    gasUnitSelect.value = newEquipment.gasUnit || '';
    gasUnitSelect.addEventListener('change', () => {
      newEquipment.gasUnit = gasUnitSelect.value as GasUnit || undefined;
      App.updateAndDisplayEquipmentCalculations(equipmentId);
      App.updateResults();
    });
    gasUnitCell.appendChild(gasUnitSelect);

    // 6. Cons. Elétrico (kW) (Electric Consumption)
    const electricConsumptionCell = row.insertCell();
    const electricConsumptionInput = document.createElement('input');
    electricConsumptionInput.type = 'number';
    electricConsumptionInput.step = 'any';
    electricConsumptionInput.min = '0';
    electricConsumptionInput.className = 'form-control form-control-sm equip-electric-consumption-input';
    electricConsumptionInput.value = newEquipment.electricConsumption?.toString() || '';
    electricConsumptionInput.addEventListener('input', () => {
      newEquipment.electricConsumption = parseFloat(electricConsumptionInput.value) || undefined;
      App.updateAndDisplayEquipmentCalculations(equipmentId);
      App.updateResults();
    });
    electricConsumptionCell.appendChild(electricConsumptionInput);

    // 7. Potência Total (kW) (Total Power - calculated)
    const totalPowerCell = row.insertCell();
    totalPowerCell.className = 'equip-calculated-value equip-potencia-total'; // For styling.
    const totalPowerSpan = document.createElement('span'); // Use span for non-editable calculated value.
    totalPowerSpan.textContent = newEquipment.totalPower?.toFixed(2) || '0.00';
    totalPowerCell.appendChild(totalPowerSpan);

    // 8. Fator Sensível (Sensible Factor)
    const sensibleFactorCell = row.insertCell();
    const sensibleFactorInput = document.createElement('input');
    sensibleFactorInput.type = 'number';
    sensibleFactorInput.step = '0.05'; // Increment/decrement step.
    sensibleFactorInput.min = '0';
    sensibleFactorInput.max = '1'; // Factor should be between 0 and 1.
    sensibleFactorInput.className = 'form-control form-control-sm equip-sensible-factor-input';
    sensibleFactorInput.value = newEquipment.sensibleFactor.toString();
    sensibleFactorInput.addEventListener('input', () => {
      newEquipment.sensibleFactor = parseFloat(sensibleFactorInput.value) || 0;
      App.updateAndDisplayEquipmentCalculations(equipmentId);
      App.updateResults();
    });
    sensibleFactorCell.appendChild(sensibleFactorInput);

    // 9. Calor Sensível (kW) (Sensible Heat - calculated)
    const sensibleHeatCell = row.insertCell();
    sensibleHeatCell.className = 'equip-calculated-value equip-calor-sensivel'; // For styling.
    const sensibleHeatSpan = document.createElement('span'); // Use span for non-editable calculated value.
    sensibleHeatSpan.textContent = newEquipment.sensibleHeat?.toFixed(2) || '0.00';
    sensibleHeatCell.appendChild(sensibleHeatSpan);

    // 10. Ação (Action - Remove button)
    const actionCell = row.insertCell();
    actionCell.className = 'action-cell'; // For styling (e.g., text alignment).
    const removeButton = document.createElement('button');
    removeButton.className = 'btn btn-danger btn-sm';
    removeButton.textContent = 'Remover';
    removeButton.type = 'button'; // Prevent form submission if wrapped in a form.
    removeButton.addEventListener('click', () => App.removeEquipmentRow(equipmentId));
    actionCell.appendChild(removeButton);

    // Initial setup for the row based on its type.
    App.toggleGasFields(row, newEquipment.type === EquipmentType.GAS);
    App.updateAndDisplayEquipmentCalculations(equipmentId); // Calculate initial power/heat values for the new row.
    // App.updateResults(); // Not strictly needed here as addEquipmentRow is typically followed by updateResults in init or event handlers.
  },

  /**
   * @method removeEquipmentRow
   * @description Removes an equipment row from the table and the corresponding object from `App.equipmentList`.
   * @param {string} equipmentId - The ID of the equipment to remove.
   * @sideEffects Modifies the DOM by removing a `<tr>`. Updates `App.equipmentList`. Calls `App.updateResults`.
   */
  removeEquipmentRow: (equipmentId: string) => {
    App.equipmentList = App.equipmentList.filter(e => e.id !== equipmentId); // Remove from state.
    const rowToRemove = document.querySelector(`tr[data-equipment-id="${equipmentId}"]`);
    if (rowToRemove) {
      rowToRemove.remove(); // Remove from DOM.
    } else {
      console.warn(`Row with ID ${equipmentId} not found for removal.`);
    }
    App.updateResults(); // Recalculate and update global results.
  },

  /**
   * @method populateHoodTypesDropdown
   * @description Populates the hood type selection dropdown with options from `HOOD_TYPES`.
   * Sets the initial selected value based on `App.selectedHoodType`.
   * @sideEffects Modifies the DOM by adding `<option>` elements to the `hoodTypeSelect` dropdown.
   *              Attaches an event listener to the dropdown.
   */
  populateHoodTypesDropdown: () => {
    const hoodTypeSelect = document.getElementById('hoodTypeSelect') as HTMLSelectElement;
    if (!hoodTypeSelect) {
      console.error('Hood type select element not found.');
      return;
    }

    hoodTypeSelect.innerHTML = ''; // Clear any existing options.

    HOOD_TYPES.forEach(hoodType => {
      const option = document.createElement('option');
      option.value = hoodType.id;
      option.textContent = hoodType.name;
      hoodTypeSelect.appendChild(option);
    });

    // Set the initial selection in the dropdown.
    if (App.selectedHoodType) {
      hoodTypeSelect.value = App.selectedHoodType;
    } else if (HOOD_TYPES.length > 0) {
      // If no specific selection yet, but types exist, default to the first one.
      App.selectedHoodType = HOOD_TYPES[0].id;
      hoodTypeSelect.value = App.selectedHoodType;
    }

    // Update state and results when selection changes.
    hoodTypeSelect.addEventListener('change', () => {
      App.selectedHoodType = hoodTypeSelect.value;
      App.updateResults();
    });
  },

  /**
   * @method toggleCalculationMethodUI
   * @description Shows/hides UI sections based on the selected calculation method radio button.
   * Updates `App.currentCalculationMethod` state.
   * @sideEffects Modifies `display` style of `heatLoadSection` and `hoodDimensionsSection`.
   *              Updates `App.currentCalculationMethod`. Calls `App.updateResults`.
   */
  toggleCalculationMethodUI: () => {
    const heatLoadRadio = document.getElementById('heatLoadMethodRadio') as HTMLInputElement;
    const heatLoadSection = document.getElementById('heatLoadSection') as HTMLElement;
    const hoodDimensionsSection = document.getElementById('hoodDimensionsSection') as HTMLElement;

    // Ensure all required DOM elements are present.
    if (!heatLoadRadio || !heatLoadSection || !hoodDimensionsSection) {
      console.error('Required elements for UI toggling (radio buttons or sections) not found.');
      return;
    }

    if (heatLoadRadio.checked) { // Heat Load method selected.
      heatLoadSection.style.display = 'block';
      hoodDimensionsSection.style.display = 'none';
      App.currentCalculationMethod = 'heatload';
    } else { // Hood Dimensions method selected (assumes the other radio is checked).
      heatLoadSection.style.display = 'none';
      hoodDimensionsSection.style.display = 'block';
      App.currentCalculationMethod = 'dimensions';
    }
    // console.log('Calculation method set to:', App.currentCalculationMethod);
    App.updateResults(); // Update calculations and display based on the new method.
  },

  /**
   * @method updateResults
   * @description Orchestrates all calculations and updates the summary display areas in the DOM
   * based on the current calculation method and application state.
   * @sideEffects Reads from various state properties and DOM inputs.
   *              Modifies text content of summary DOM elements (e.g., total sensible heat, estimated airflow).
   */
  updateResults: () => {
    // console.log("App.updateResults called. Current method:", App.currentCalculationMethod);
    // console.log("Current equipment list:", JSON.parse(JSON.stringify(App.equipmentList)));
    // console.log("Current hood dimensions:", JSON.parse(JSON.stringify(App.hoodDimensions)));

    if (App.currentCalculationMethod === 'heatload') {
        // Calculate and display results for the Heat Load method.
        const totalSensibleHeat = App.calculateTotalSensibleHeat();
        const totalSensibleHeatOutput = document.getElementById('totalSensibleHeatOutput');
        if (totalSensibleHeatOutput) {
            totalSensibleHeatOutput.textContent = `${totalSensibleHeat.toFixed(2)} kW`;
        }

        const hoodKDetails = App.getHoodKFactor();
        const intervalFactorKOutput = document.getElementById('intervalFactorKOutput');
        if (intervalFactorKOutput) {
            intervalFactorKOutput.textContent = `${hoodKDetails.range} (m³/h)/kW (${hoodKDetails.notes})`;
        }

        const estimatedAirflowHL = App.calculateAirflowHeatLoad();
        const estimatedAirflowOutput = document.getElementById('estimatedAirflowOutput');
        if (estimatedAirflowOutput) {
            // Round to nearest integer for airflow.
            estimatedAirflowOutput.textContent = `${Math.round(estimatedAirflowHL)} m³/h`;
        }
    } else if (App.currentCalculationMethod === 'dimensions') {
        // Calculate and display results for the Hood Dimensions method.
        const estimatedAirflowDim = App.calculateAirflowDimensions();
        const estimatedAirflowDimensionsOutput = document.getElementById('estimatedAirflowDimensionsOutput');
        if (estimatedAirflowDimensionsOutput) {
          // Round to nearest integer for airflow.
          estimatedAirflowDimensionsOutput.textContent = `${Math.round(estimatedAirflowDim)} m³/h`;
        }
    }
    // For debugging: log the state after an update.
    // console.log("App state after updateResults:", JSON.parse(JSON.stringify(App)));
  }
  // Future methods related to duct system calculations could be added here.
};

// Make App globally accessible for event handlers in HTML and for debugging in the console.
// This is a common pattern for simple single-page applications not using a framework.
if (typeof window !== 'undefined') {
  (window as any).App = App;
}

// Ensure App.init is called only after the DOM is fully loaded and parsed.
document.addEventListener('DOMContentLoaded', App.init);
