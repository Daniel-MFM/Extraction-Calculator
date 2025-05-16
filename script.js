// script.js

// --- Constants ---
const NCV_VALUES = { // Net Calorific Values in kWh per unit (m³ or kg)
    natural_pt_m3h: 10.0,  // Typical G20/G25 in Portugal (confirm local value if critical)
    propane_m3h: 25.5,     // Propane by volume (if ever used, usually by weight)
    butane_m3h: 32.0,      // Butane by volume (if ever used, usually by weight)
    propane_kgh: 12.8,     // Propane by weight (LHV)
    butane_kgh: 12.6       // Butane by weight (LHV)
};

const SENSIBLE_FACTORS = { // Approximate fraction of total power released as sensible heat
    // Fryers
    fryer_open_pot: 0.55, fryer_tube: 0.60, fryer_pressure: 0.40,
    // Grills & Griddles
    grill_charbroiler_radiant: 0.70, grill_charbroiler_lava: 0.75, griddle_plate: 0.60, grill_clam_shell: 0.50,
    // Ranges & Hobs
    range_open_burner_gas: 0.50, range_hot_top_electric: 0.55, range_induction: 0.45, wok_range_gas: 0.65,
    // Ovens
    oven_convection: 0.40, oven_deck: 0.35, oven_combi: 0.50, oven_pizza_conveyor: 0.40, oven_rotisserie: 0.55,
    // Steamers & Boilers
    steamer_pressureless: 0.30, steamer_pressure: 0.25, pasta_cooker: 0.40, kettle_steam_jacketed: 0.30,
    // Holding & Warming
    bain_marie: 0.40, holding_cabinet_heated: 0.30,
    // Other
    dishwasher_conveyor_hooded: 0.20, // Primarily latent, SHF is low
    other: 0.50,
    // Simpler original categories (can be kept for ease or if data is not specific)
    fryer: 0.6, grill: 0.7, range_top: 0.5, oven: 0.4, steamer: 0.3,
};

const HOOD_FACTORS = { // (m³/h)/kW of sensible heat for Heat Load method
    wall: { low: 150, high: 180 },
    island: { low: 200, high: 250 },
    eyebrow: { low: 120, high: 150 }
};

const DIMENSIONAL_FACE_VELOCITIES_MS = { // m/s for Hood Dimension method (Wall/Island)
    light: 0.30,
    medium: 0.45,
    heavy: 0.65
};
const DEFAULT_EYEBROW_APM = 500; // m³/h per meter length for eyebrow dimensional method default

const DUCT_ROUGHNESS = { // Absolute roughness in meters (m)
    galvanized: 0.00015,
    stainless: 0.00005,
    pvc: 0.000005,
    aluminum: 0.00003,
    black_steel: 0.00005,
    flex_metal_uninsulated: 0.0015, // Can vary significantly
    // concrete: 0.001, // If you decide to add it
};

const FITTING_K_FACTORS = {
    // Elbows (Round - K values can vary slightly with Re, but often taken as constant for turbulent flow)
    // R/D is radius of curvature of centerline / Diameter
    elbow90_r_d_1_5: 0.25,  // Smooth 90-degree elbow, R/D = 1.5 (standard smooth)
    elbow90_r_d_1_0: 0.40,  // Smooth 90-degree elbow, R/D = 1.0 (Short Radius)
    elbow90_r_d_2_0: 0.20,  // Smooth 90-degree elbow, R/D = 2.0 (Long Radius)
    elbow90_mitred_novanes: 1.2, // Mitred 90-degree elbow, no vanes
    elbow45_r_d_1_5: 0.15,  // Smooth 45-degree elbow, R/D = 1.5

    // Transitions (K applied to upstream dynamic pressure V1^2*rho/2)
    // These are functions to be called with upstream and downstream areas.
    // Area arguments should be in m^2.
    transition_sudden_contraction: function(A_upstream, A_downstream) {
        if (A_upstream <= 0 || A_downstream <= 0 || A_downstream >= A_upstream) return 0; // No loss if expanding or invalid
        const areaRatio = A_downstream / A_upstream; // σ = A2/A1
        // K_c based on V1 (upstream velocity). From various sources (e.g. Idelchik, ASHRAE):
        // For σ = 0, K ≈ 0.5; σ = 0.2, K ≈ 0.37; σ = 0.4, K ≈ 0.27; σ = 0.6, K ≈ 0.16; σ = 0.8, K ≈ 0.06
        // A simple approximation: (0.5 * (1 - areaRatio)) could be used, but more precise fits exist.
        // Using a polynomial fit or lookup table for more accuracy is better. For simplicity:
        if (areaRatio < 0.2) return 0.4 * (1 - areaRatio); // Approximate
        if (areaRatio < 0.5) return 0.3 * (1 - areaRatio); // Approximate
        return 0.2 * (1 - areaRatio);      // Approximate
    },
    transition_sudden_expansion: function(A_upstream, A_downstream) {
        if (A_downstream <= 0 || A_upstream <= 0 || A_upstream >= A_downstream) return 0; // No loss if contracting or invalid
        const areaRatio = A_upstream / A_downstream; // σ = A1/A2
        return Math.pow(1 - areaRatio, 2); // Standard Borda-Carnot equation for K based on V1
    },
    // For gradual, K depends greatly on angle (theta) and area ratio.
    // These are VERY rough placeholders and ideally should use more detailed formulas or tables.
    transition_gradual_expansion_15deg: function(A_upstream, A_downstream) { // Angle approx 15-20 deg
        if (A_downstream <= 0 || A_upstream <= 0 || A_upstream >= A_downstream) return 0;
        const areaRatio = A_upstream / A_downstream; // A1/A2
        // For well-designed diffusers (e.g. 2*theta < 15-20 deg), K can be ~0.15 to 0.3 of sudden expansion.
        return (0.25 * Math.pow(1 - areaRatio, 2)) + 0.02; // Highly approximate, ensure it's reasonable
    },
    transition_gradual_contraction_30deg: function(A_upstream, A_downstream) { // Angle approx 30-40 deg
        if (A_upstream <= 0 || A_downstream <= 0 || A_downstream >= A_upstream) return 0;
        // K for well-designed gradual contraction is typically small, e.g., 0.03-0.07
        return 0.05; // Simplified K value
    },

    // Other common fittings (examples)
    damper_butterfly_fully_open: 0.35,
    damper_butterfly_45deg: 1.7,
    damper_gate_fully_open: 0.15,


    // Outlets (as before) - K applied to P_dyn of final duct segment
    outlet_weather_cap: 1.0,
    outlet_low_loss_louver: 0.5,
    outlet_bird_screen: 0.7,
    outlet_open: 0.0,
    outlet_vertical_stack: 0.05, // Minimal loss if open vertical stack
    outlet_gooseneck: 2.0,       // Higher loss

    // Entry Loss
    hood_entry_assumed: 0.5 // K for air entering the first duct segment from the hood plenum
};

const STANDARD_DUCT_SIZES_MM = [80, 100, 125, 150, 160, 180, 200, 224, 250, 280, 300, 315, 355, 400, 450, 500, 560, 630, 710, 800, 900, 1000];
const TARGET_VELOCITY_MS = 10.0; // Target velocity for initial duct sizing recommendation

const GAS_UNIT_TEXT_TO_VALUE = { // For CSV import robustness
    "m³/h": "m3h", "m3/h": "m3h",
    "kwh": "kwh", // If power is directly given in kWh for gas usage (less common)
    "btu/h": "btuh",
    "kg/h": "kgh"
};

// Air Properties Constants (Reference values for Sutherland's Law and Density)
const R_SPECIFIC_AIR = 287.058; // J/(kg·K), Specific gas constant for dry air
const ATMOSPHERIC_PRESSURE_PA = 101325; // Pa, Standard atmospheric pressure at sea level

// Sutherland's Law constants for air viscosity
const MU_REF_SUTHERLAND = 1.716e-5; // Pa·s (Reference viscosity at T_REF_SUTHERLAND) - some use 1.7894e-5 at 273.15K for air
const T_REF_SUTHERLAND = 273.15;    // K (Reference temperature for Sutherland's law - 0°C)
const C_SUTHERLAND = 110.4;         // K (Sutherland's constant for air)


// --- Translations ---
const translations = {
    en: {
        title: "Kitchen Hood Airflow Estimator",
        disclaimer: "<strong>Disclaimer:</strong> This tool provides an estimate. Results MUST be verified by a qualified HVAC professional familiar with local regulations before system design or installation.",
        calculation_method_title: "Calculation Method:",
        calc_method_heat_load: "Heat Load Method (Appliance Power)",
        calc_method_hood_dim: "Hood Dimensions Method",
        hood_type_label: "Hood Type:",
        hood_type_wall: "Wall-Mounted Canopy", hood_type_island: "Island Canopy", hood_type_eyebrow: "Eyebrow / Backshelf",

        hood_dim_title: "Hood Dimension Inputs",
        hood_length_label: "Hood Length (m):",
        hood_depth_label: "Hood Depth (m):",
        duty_level_label: "Typical Cooking Duty Level:",
        duty_light: "Light Duty (e.g., Ovens, Steaming)",
        duty_medium: "Medium Duty (e.g., Ranges, Fryers)",
        duty_heavy: "Heavy Duty (e.g., Charbroilers, Woks)",
        eyebrow_apm_label: "Required Airflow per Meter Length (m³/h/m):",
        hood_dim_note: "Note: This method provides a general estimate. Face velocities for duty levels are typical values. Eyebrow/backshelf calculations are based on airflow per meter.",

        explanation_title_equip: "Equipment Type & Sensible Heat Factor",
        explanation_p1_equip: "The \"Sensible Heat Factor\" represents the approximate fraction of an appliance's total power that is released as sensible heat (heat causing temperature change via convection/radiation), which drives the thermal plume captured by the hood. The remaining heat is mainly latent heat (from steam/evaporation) or lost elsewhere. Different appliance types release heat differently:",
        explanation_list_equip: [ /* This list will now be much longer if you include all subtypes */
            "<strong>Fryer (General Factor: 0.6):</strong> High heat transfer to oil, significant convection/radiation from surfaces.",
            "<strong>Open Pot Fryer (Factor: 0.55):</strong> Specific type.",
            // ... many more detailed appliance explanations would go here based on your SENSIBLE_FACTORS keys
            "<strong>Other (Factor: 0.5):</strong> Default average used if type is unknown."
        ],
        explanation_title_outlet: "Exhaust Outlet Type & Pressure Loss",
        explanation_p1_outlet: "The type of termination on the exhaust duct significantly impacts pressure loss (resistance). Lower loss means less fan power is needed. Typical loss coefficients (K) are used in the calculation:",
        explanation_list_outlet: [
            "<strong>Weather Cap (K ≈ 1.0):</strong> Common, moderate resistance.",
            "<strong>Low Loss Louvre (K ≈ 0.5):</strong> Designed for lower resistance, better performance.",
            "<strong>Bird Screen Only (K ≈ 0.7):</strong> Minimal obstruction, but offers less weather protection.",
            "<strong>Open Duct (K ≈ 0.0):</strong> No resistance from outlet itself (but usually requires some termination).",
            "<strong>Vertical Discharge Stack (K ≈ 0.05):</strong> Minimal resistance, good dispersal.",
            "<strong>Gooseneck / Chinese Cap (K ≈ 2.0):</strong> Higher resistance, specific applications."
        ],
        explanation_title_velocity: "Duct Air Velocity",
        explanation_p1_velocity: "Maintaining air velocity within a recommended range (typically 7-12 m/s for main kitchen exhaust ducts) is important for several reasons:",
        explanation_list_velocity: [
            "<strong>Too Low (&lt; 5-7 m/s):</strong> Grease particles may deposit inside ducts, increasing fire risk and reducing airflow over time.",
            "<strong>Too High (> 12-15 m/s):</strong> Causes excessive noise, increases pressure drop (requiring more fan power), and can increase wear on ductwork.",
            "<strong>Target (≈ 10 m/s):</strong> Used here for recommending an initial duct size, balancing particle transport and efficiency."
        ],
        explanation_close: "Close",
        list_unavailable: "[List explanation not available in this language]",

        appliances_title: "Appliances Under Hood (Heat Load Method)",
        diversity_factor_label: "Simultaneous Use Factor (Diversity):",
        th_appliance_name: "Appliance Name", th_equipment_type: "Equipment Type", th_gas_type: "Gas Type",
        th_gas_usage: "Gas Usage", th_gas_unit: "Unit", th_electric_usage: "Electric Usage (kW)",
        th_total_power: "Total Power (kW)", th_sensible_factor: "Sensible Factor", th_sensible_heat: "Sensible Heat (kW)",
        th_action: "Action",
        add_appliance: "Add Appliance", import_csv: "Import CSV", export_csv: "Export to CSV",

        // Equipment type translations (examples, expand for all new types)
        equip_type_fryer_open_pot: "Open Pot Fryer", equip_type_fryer_tube: "Tube-Type Fryer", equip_type_fryer_pressure: "Pressure Fryer",
        equip_type_grill_charbroiler_radiant: "Charbroiler (Radiant)", equip_type_grill_charbroiler_lava: "Charbroiler (Lava Rock)",
        equip_type_griddle_plate: "Griddle Plate", equip_type_grill_clam_shell: "Clam Shell Grill",
        equip_type_range_open_burner_gas: "Gas Range (Open Burner)", equip_type_range_hot_top_electric: "Electric Hot Top Range",
        equip_type_range_induction: "Induction Range", equip_type_wok_range_gas: "Gas Wok Range",
        equip_type_oven_convection: "Convection Oven", equip_type_oven_deck: "Deck Oven",
        equip_type_oven_combi: "Combi Oven (General)", equip_type_oven_pizza_conveyor: "Pizza Conveyor Oven",
        equip_type_oven_rotisserie: "Rotisserie Oven",
        equip_type_steamer_pressureless: "Pressureless Steamer", equip_type_steamer_pressure: "Pressure Steamer",
        equip_type_pasta_cooker: "Pasta Cooker / Boiler", equip_type_kettle_steam_jacketed: "Steam Jacketed Kettle",
        equip_type_bain_marie: "Bain Marie / Hot Well", equip_type_holding_cabinet_heated: "Heated Holding Cabinet",
        equip_type_dishwasher_conveyor_hooded: "Dishwasher (Conveyor, Hooded)",
        equip_type_other: "Other",
        // Original simpler types
        equip_type_fryer: "Fryer (General)", equip_type_grill: "Grill (General)", equip_type_range_top: "Range Top (General)",
        equip_type_oven: "Oven (General)", equip_type_steamer: "Steamer (General)",

        summary_title: "Calculation Summary",
        // ... more translations for summary, comparison, pressure drop sections
    },
    pt: {
        title: "Estimador de Caudal para Hotte de Cozinha",
        disclaimer: "<strong>Aviso:</strong> Esta ferramenta fornece uma estimativa. Os resultados DEVEM ser verificados por um profissional de AVAC qualificado e familiarizado com os regulamentos locais antes do projeto ou instalação do sistema.",
        calculation_method_title: "Método de Cálculo:",
        calc_method_heat_load: "Método Carga Térmica (Potência Equip.)",
        calc_method_hood_dim: "Método Dimensões da Hotte",
        hood_type_label: "Tipo de Hotte:",
        hood_type_wall: "Mural (Canópia)", hood_type_island: "Central (Ilha)", hood_type_eyebrow: "Compensada / Prateleira",

        hood_dim_title: "Dados Dimensionais da Hotte",
        hood_length_label: "Comprimento Hotte (m):",
        hood_depth_label: "Profundidade Hotte (m):",
        duty_level_label: "Nível de Carga Típico da Cozinha:",
        duty_light: "Carga Ligeira (Ex: Fornos, Vapor)",
        duty_medium: "Carga Média (Ex: Fogões, Fritadeiras)",
        duty_heavy: "Carga Pesada (Ex: Grelhadores, Woks)",
        eyebrow_apm_label: "Caudal Necessário por Metro Linear (m³/h/m):",
        hood_dim_note: "Nota: Este método fornece uma estimativa geral. As velocidades faciais para os níveis de carga são valores típicos. Cálculos para hottes compensadas baseiam-se no caudal por metro.",

        explanation_title_equip: "Tipo de Equipamento & Fator de Calor Sensível",
        explanation_p1_equip: "O \"Fator de Calor Sensível\" representa a fração aproximada da potência total de um equipamento que é libertada como calor sensível (calor que causa alteração de temperatura por convecção/radiação), o qual impulsiona a pluma térmica capturada pela hotte. O calor restante é principalmente calor latente (de vapor/evaporação) ou perdido de outra forma. Diferentes tipos de equipamentos libertam calor de forma diferente:",
        explanation_list_equip: [
            "<strong>Fritadeira (Geral - Fator: 0.6):</strong> Elevada transferência de calor para o óleo...",
            "<strong>Fritadeira de Cuba Aberta (Fator: 0.55):</strong> Tipo específico.",
            // ... many more detailed appliance explanations would go here
            "<strong>Outro (Fator: 0.5):</strong> Média padrão usada se o tipo for desconhecido."
        ],
        explanation_title_outlet: "Tipo de Saída de Exaustão & Perda de Carga",
        explanation_p1_outlet: "O tipo de terminação na conduta de exaustão impacta significativamente a perda de carga (resistência). Menor perda significa que é necessária menos potência do ventilador. Coeficientes de perda típicos (K) são usados no cálculo:",
        explanation_list_outlet: [
            "<strong>Chapéu Chinês (K ≈ 1.0):</strong> Comum, resistência moderada.",
            "<strong>Grelha Baixa Perda (K ≈ 0.5):</strong> Projetada para menor resistência.",
            "<strong>Rede Anti-pássaro Apenas (K ≈ 0.7):</strong> Obstrução mínima.",
            "<strong>Conduta Aberta (K ≈ 0.0):</strong> Sem resistência da própria saída.",
            "<strong>Descarga Vertical Livre (K ≈ 0.05):</strong> Resistência mínima, boa dispersão.",
            "<strong>Pescoço de Ganso / Chapéu Tipo Chinês (K ≈ 2.0):</strong> Resistência elevada."
        ],
        explanation_title_velocity: "Velocidade do Ar na Conduta",
        explanation_p1_velocity: "Manter a velocidade do ar dentro de um intervalo recomendado (tipicamente 7-12 m/s para condutas principais de exaustão de cozinha) é importante por várias razões:",
        explanation_list_velocity: [
            "<strong>Muito Baixa (&lt; 5-7 m/s):</strong> Partículas de gordura podem depositar-se dentro das condutas...",
            "<strong>Muito Alta (> 12-15 m/s):</strong> Causa ruído excessivo, aumenta a perda de carga...",
            "<strong>Alvo (≈ 10 m/s):</strong> Usado aqui para recomendar um tamanho inicial de conduta."
        ],
        explanation_close: "Fechar",
        list_unavailable: "[Explicação da lista não disponível neste idioma]",

        appliances_title: "Equipamentos Sob a Hotte (Método Carga Térmica)",
        diversity_factor_label: "Fator de Simultaneidade (Diversidade):",
        th_appliance_name: "Nome Equipamento", th_equipment_type: "Tipo Equipamento", th_gas_type: "Tipo Gás",
        th_gas_usage: "Consumo Gás", th_gas_unit: "Unid.", th_electric_usage: "Consumo Elétrico (kW)",
        th_total_power: "Potência Total (kW)", th_sensible_factor: "Fator Sensível", th_sensible_heat: "Calor Sensível (kW)",
        th_action: "Ação",
        add_appliance: "Adicionar Equipamento", import_csv: "Importar CSV", export_csv: "Exportar para CSV",

        // Equipment type translations (PT - examples, expand for all new types)
        equip_type_fryer_open_pot: "Fritadeira de Cuba Aberta", equip_type_fryer_tube: "Fritadeira de Tubos", equip_type_fryer_pressure: "Fritadeira de Pressão",
        // ... continue for all equip_type keys
        equip_type_other: "Outro",
        equip_type_fryer: "Fritadeira (Geral)", equip_type_grill: "Grelhador (Geral)", equip_type_range_top: "Placa / Fogão (Geral)",
        equip_type_oven: "Forno (Geral)", equip_type_steamer: "Panela a Vapor (Geral)",

        summary_title: "Resumo do Cálculo",
        // ... (rest of pt translations will go in the next part)
    }
    // ... any other languages ...
};

// --- Global State Variables ---
let currentLang = 'pt'; // Default language set to Portuguese
let currentCalculationMethod = 'heatLoad'; // 'heatLoad' or 'hoodDimension'

let lastCalculatedAirflowLowM3H = 0;
let lastCalculatedAirflowHighM3H = 0; // Used for pressure drop if not manual, and for comparison
let applianceDataForComparison = []; // Stores sensible heat of appliances for comparison text

// For new duct system layout
let ductSystemLayout = []; // Array of objects: {id, type: 'segment'/'fitting', ...details}
let nextDuctElementId = 0; // To give unique IDs to duct system rows for easy deletion/management

// --- DOM Element References (Initial Batch) ---
// Language buttons
const langButtons = document.querySelectorAll('.lang-btn');

// Calculation Method
const calculationMethodRadios = document.querySelectorAll('input[name="calculationMethod"]');
const appliancesSection = document.getElementById('appliancesSection');
const hoodDimensionInputsSection = document.getElementById('hoodDimensionInputsSection');

// Hood Type & Dimensional Inputs
const hoodTypeSelect = document.getElementById('hoodType');
const hoodLengthInput = document.getElementById('hoodLength');
const hoodDepthInput = document.getElementById('hoodDepth');
const cookingDutyLevelSelect = document.getElementById('cookingDutyLevel');
const eyebrowAirflowPerMeterInput = document.getElementById('eyebrowAirflowPerMeter');
const dimensionalInputs = document.querySelectorAll('.data-input-dim'); // Class for all dimensional method inputs
const hoodDepthWrapper = document.getElementById('hoodDepthWrapper');
const cookingDutyLevelWrapper = document.getElementById('cookingDutyLevelWrapper');
const eyebrowAirflowPerMeterWrapper = document.getElementById('eyebrowAirflowPerMeterWrapper');

// Explanation Sections
const infoIcons = document.querySelectorAll('.info-icon');
const explanationSections = document.querySelectorAll('.explanation-section');
const closeExplanationBtns = document.querySelectorAll('.closeExplanationBtn');

// Appliances Table (Heat Load Method)
const diversityFactorInput = document.getElementById('diversityFactor');
const tableBody = document.getElementById('applianceTableBody');
const addApplianceBtn = document.getElementById('addApplianceBtn');
const importCsvBtn = document.getElementById('importCsvBtn');
const csvFileInput = document.getElementById('csvFileInput');
const exportCsvBtn = document.getElementById('exportCsvBtn');

// Summary Section
const totalSensibleHeatDisplay = document.getElementById('totalSensibleHeat');
const hoodFactorDisplay = document.getElementById('hoodFactorDisplay');
const estimatedAirflowDisplay = document.getElementById('estimatedAirflow');
const estimatedAirflowWrapper = document.getElementById('estimatedAirflowWrapper');
const totalSensibleHeatWrapper = document.getElementById('totalSensibleHeatWrapper');
const hoodFactorWrapper = document.getElementById('hoodFactorWrapper');

// Comparison Section
const comparisonTextDisplay = document.getElementById('comparisonText');

// Pressure Drop General Config
const manualAirflowToggle = document.getElementById('manualAirflowToggle');
const manualAirflowInputWrapper = document.getElementById('manualAirflowInputWrapper');
const manualAirflowInput = document.getElementById('manualAirflowInput');
const exhaustAirTempInput = document.getElementById('exhaustAirTemp'); // New

// Duct System Layout Table (New)
const ductSystemTableBody = document.getElementById('ductSystemTableBody');
const addDuctSegmentBtn = document.getElementById('addDuctSegmentBtn');
const addFittingBtn = document.getElementById('addFittingBtn');

// Pressure Drop Fixed Inputs / Outputs (some of these inputs will be dynamic with the new duct layout)
const recommendedDuctDisplay = document.getElementById('recommendedDuct');
// const ductDiameterInput = document.getElementById('ductDiameter'); // To be replaced by dynamic segment inputs
// const ductLengthInput = document.getElementById('ductLength');     // To be replaced
// const ductMaterialSelect = document.getElementById('ductMaterial'); // To be replaced
// const elbows90Input = document.getElementById('elbows90');       // To be replaced
// const elbows45Input = document.getElementById('elbows45');       // To be replaced
const filterPressureDropInput = document.getElementById('filterPressureDrop');
const outletTypeSelect = document.getElementById('outletType');
const calculatedVelocityDisplay = document.getElementById('calculatedVelocity');
const estimatedPressureDropDisplay = document.getElementById('estimatedPressureDrop');

// A class for inputs that trigger pressure calculation or config changes for pressure drop
const pressureConfigInputs = document.querySelectorAll('.data-input-pressure-config');


// --- Utility Functions ---

/**
 * Calculates air density and dynamic viscosity based on temperature.
 * Assumes standard atmospheric pressure at sea level.
 * @param {number} temperatureCelsius - Exhaust air temperature in Celsius.
 * @returns {object} { density: kg/m³, viscosity: Pa·s }
 */
function getAirProperties(temperatureCelsius) {
    const tempKelvin = temperatureCelsius + 273.15;

    // Density (ρ) = P / (R_specific * T)
    const density = ATMOSPHERIC_PRESSURE_PA / (R_SPECIFIC_AIR * tempKelvin);

    // Dynamic Viscosity (μ) using Sutherland's Law
    // μ = μ_ref * (T_ref + C) / (T + C) * (T / T_ref)^(3/2)
    const viscosity = MU_REF_SUTHERLAND *
                      ((T_REF_SUTHERLAND + C_SUTHERLAND) / (tempKelvin + C_SUTHERLAND)) *
                      Math.pow(tempKelvin / T_REF_SUTHERLAND, 1.5);

    return { density, viscosity };
}


/**
 * Sets the display language for the page.
 * @param {string} lang - Language code ('en', 'pt', etc.).
 */
function setLanguage(lang) {
    if (!translations[lang]) {
        console.warn(`Translations for language "${lang}" not found. Defaulting to 'en'.`);
        lang = 'en'; // Fallback to English if specified lang not found
    }
    currentLang = lang;
    document.documentElement.lang = lang;

    // Update all elements with data-translate-key
    document.querySelectorAll('[data-translate-key]').forEach(element => {
        const key = element.getAttribute('data-translate-key');
        const translation = translations[lang][key];

        if (translation != null) { // Check if translation exists
            if (key === 'disclaimer' || element.innerHTML.includes('<strong>') && translations[lang][key].includes('<strong>')) {
                // For elements where HTML content is expected (like disclaimer or list items with <strong>)
                element.innerHTML = translation;
            } else if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
                if (element.placeholder && translations[lang][element.placeholder_key || key + '_placeholder']) { // Allow specific placeholder key
                    element.placeholder = translations[lang][element.placeholder_key || key + '_placeholder'];
                } else if (element.placeholder && typeof translation === 'string') { // Fallback if translation is simple string for placeholder
                    element.placeholder = translation;
                }
                if (element.title && translations[lang][element.title_key || key + '_title']) {
                    element.title = translations[lang][element.title_key || key + '_title'];
                } else if (element.title && typeof translation === 'string') {
                    element.title = translation;
                }
            } else if (element.tagName === 'OPTION') {
                // Check if a specific value attribute maps to a translation key
                const valueKey = `option_${element.parentElement.id}_${element.value}`; // e.g. option_hoodType_wall
                if(translations[lang][valueKey]) {
                    element.textContent = translations[lang][valueKey];
                } else {
                     element.textContent = translation; // Fallback to direct key if it's a simple option text
                }
            } else if (key.startsWith('explanation_list_') && Array.isArray(translation)) {
                const listElement = document.querySelector(`[data-translate-key="${key}"]`);
                if (listElement) {
                    listElement.innerHTML = translation.map(item => `<li>${item}</li>`).join('');
                } else {
                    console.error(`Translation list element not found for key: ${key}`);
                }
            } else {
                element.textContent = translation;
            }
        } else if (key.startsWith('explanation_list_')) {
            // If explanation list items are missing for the language, show a message
            const listElement = document.querySelector(`[data-translate-key="${key}"]`);
            if (listElement) {
                listElement.innerHTML = `<li>${translations[lang].list_unavailable || (translations.en && translations.en.list_unavailable) || "Content not available."}</li>`;
            }
        } else {
            // console.warn(`Translation not found for key: ${key} in language: ${lang}`);
        }
    });

    // Update dynamically generated select options in appliance table rows
    tableBody.querySelectorAll('.appliance-row').forEach(row => {
        const equipSelect = row.querySelector('.equipment-type');
        if (equipSelect) {
            const currentEquipValue = equipSelect.value;
            // Rebuild equipment options with translations
            equipSelect.innerHTML = ''; // Clear existing
            // Add optgroups and options as defined in your enhanced list
            // This needs careful construction based on your new SENSIBLE_FACTORS structure
            // Example for a flat list (adapt for optgroups):
            Object.keys(SENSIBLE_FACTORS).forEach(factorKey => {
                const optionText = translations[lang][`equip_type_${factorKey}`] || factorKey.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                const option = new Option(optionText, factorKey);
                equipSelect.add(option);
            });
            equipSelect.value = currentEquipValue; // Restore selection
        }

        const gasSelect = row.querySelector('.gas-type');
        if (gasSelect) {
            const currentGasValue = gasSelect.value;
            gasSelect.innerHTML = `
                <option value="natural_pt">${translations[lang].gas_type_natural || "Natural Gas"}</option>
                <option value="propane">${translations[lang].gas_type_propane || "Propane"}</option>
                <option value="butane">${translations[lang].gas_type_butane || "Butane"}</option>
            `;
            gasSelect.value = currentGasValue;
        }
        const unitSelect = row.querySelector('.gas-unit');
        if (unitSelect) {
            const currentUnitValue = unitSelect.value;
            unitSelect.innerHTML = `
                <option value="m3h">${translations[lang].gas_unit_m3h || "m³/h"}</option>
                <option value="kgh">${translations[lang].gas_unit_kgh || "kg/h"}</option>
            `;
            unitSelect.value = currentUnitValue;
        }
        const deleteBtn = row.querySelector('.delete-btn');
        if (deleteBtn) {
            deleteBtn.textContent = translations[lang].delete_button || "Delete";
        }
        const nameInput = row.querySelector('.appliance-name');
        if(nameInput) {
            nameInput.placeholder = translations[lang].th_appliance_name || 'Appliance Name';
        }
    });

    // Update language toggle button active state
    langButtons.forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-lang') === lang);
    });

    // Update titles for info icons
    infoIcons.forEach(icon => {
        const targetSectionId = icon.getAttribute('data-target-section');
        let titleKey = '';
        if (targetSectionId === 'explanationSectionEquip') titleKey = 'explanation_title_equip';
        else if (targetSectionId === 'explanationSectionOutlet') titleKey = 'explanation_title_outlet';
        else if (targetSectionId === 'explanationSectionVelocity') titleKey = 'explanation_title_velocity';

        if (titleKey) {
            icon.title = translations[lang][titleKey] || (translations.en && translations.en[titleKey]) || "Click for explanation";
        }
        // (The rest of the script, including event listeners and initialization, will be in the final third)
    });

    // Update appliance table rows (using the globally defined helper function)
    tableBody.querySelectorAll('.appliance-row').forEach(row => updateApplianceRowTranslations(row, lang));

    // Update duct system table rows (using the globally defined helper function)
    ductSystemTableBody.querySelectorAll('.duct-system-row').forEach(row => updateDuctSystemRowTranslations(row, lang));

    // Update general select options (e.g. hoodType, cookingDutyLevel, outletType)
    document.querySelectorAll('#outletType option').forEach(opt => {
        const key = `pressure_outlet_${opt.value}`; // Assuming this naming convention for options
        if(translations[lang][key]) opt.textContent = translations[lang][key];
    });
    document.querySelectorAll('#cookingDutyLevel option').forEach(opt => {
        const key = `duty_${opt.value}`;
        if(translations[lang][key]) opt.textContent = translations[lang][key];
    });
    document.querySelectorAll('#hoodType option').forEach(opt => {
        const key = `hood_type_${opt.value}`;
        if(translations[lang][key]) opt.textContent = translations[lang][key];
    });

    performCalculations(); // Refresh all calculations and dependent text
} // End of the main setLanguage function

// script.js (Continued - Final Third)

// (Code from the first and second thirds should be above this)
// This includes: Constants, Translations, Global Variables, DOM References,
// getAirProperties, setLanguage, updateApplianceRowTranslations, updateDuctSystemRowTranslations,
// toggleGasUnitSelector, addApplianceRow, deleteApplianceRow,
// calculateAirflowByHeatLoad, calculateAirflowByDimensions, performCalculations,
// updateComparisonText, calculateRecommendedDuct,
// toggleCalculationMethodView, toggleDimensionalInputsBasedOnHoodType,
// and the start of the duct system UI functions from the second third.


// --- Duct System Layout UI Functions (Continued & Refined) ---

/**
 * Adds a new duct segment row to the UI and layout array.
 * (Refined version from second third - ensure all event listeners correctly update the layout array)
 */
function addDuctSegmentRowUI() {
    const segmentId = `el-${nextDuctElementId++}`; // Generic element ID
    const defaultDiameter = calculateRecommendedDuct(lastCalculatedAirflowHighM3H) || 200;
    const newSegment = {
        id: segmentId, type: 'segment',
        length: 1, shape: 'round', diameter: defaultDiameter,
        width: defaultDiameter > 200 ? defaultDiameter : 300, // Sensible defaults
        height: defaultDiameter > 200 ? defaultDiameter * 0.75 : 200,
        material: 'galvanized'
    };
    ductSystemLayout.push(newSegment);

    const row = ductSystemTableBody.insertRow();
    row.classList.add('duct-system-row', 'duct-segment-row');
    row.setAttribute('data-id', segmentId);

    // Order Cell
    const orderCell = row.insertCell(); // Populated by updateDuctSystemRowOrder

    // Type Cell
    const typeCell = row.insertCell();
    typeCell.textContent = translations[currentLang].segment_type_segment;

    // Details/Dimensions Cell
    const detailsCell = row.insertCell();
    detailsCell.classList.add('space-y-1');

    // Shape Selector
    const shapeSelect = document.createElement('select');
    shapeSelect.className = 'duct-shape-select w-full p-1 border border-gray-300 rounded-md shadow-sm text-xs data-duct-input';
    shapeSelect.innerHTML = `
        <option value="round">${translations[currentLang].segment_shape_round}</option>
        <option value="rectangular">${translations[currentLang].segment_shape_rect}</option>
    `;
    shapeSelect.value = newSegment.shape;
    const shapeWrapper = document.createElement('div');
    shapeWrapper.innerHTML = `<label class="text-xs font-medium">${translations[currentLang].segment_shape}</label>`;
    shapeWrapper.appendChild(shapeSelect);
    detailsCell.appendChild(shapeWrapper);

    // Diameter Input (for round)
    const diameterInput = document.createElement('input');
    diameterInput.type = 'number'; diameterInput.min = 50; diameterInput.step = 10; diameterInput.value = newSegment.diameter;
    diameterInput.className = 'duct-diameter-input w-full p-1 border border-gray-300 rounded-md shadow-sm text-xs data-duct-input';
    const diameterWrapper = document.createElement('div');
    diameterWrapper.innerHTML = `<label class="text-xs font-medium">${translations[currentLang].segment_diameter}</label>`;
    diameterWrapper.appendChild(diameterInput);
    detailsCell.appendChild(diameterWrapper);

    // Width & Height Inputs (for rectangular)
    const rectDimWrapper = document.createElement('div');
    rectDimWrapper.className = 'rect-dimensions-wrapper space-y-1';
    const widthInput = document.createElement('input');
    widthInput.type = 'number'; widthInput.min = 50; widthInput.step = 10; widthInput.value = newSegment.width;
    widthInput.className = 'duct-width-input w-full p-1 border border-gray-300 rounded-md shadow-sm text-xs data-duct-input';
    const widthWrapper = document.createElement('div');
    widthWrapper.innerHTML = `<label class="text-xs font-medium">${translations[currentLang].segment_width}</label>`; widthWrapper.appendChild(widthInput);
    rectDimWrapper.appendChild(widthWrapper);

    const heightInput = document.createElement('input');
    heightInput.type = 'number'; heightInput.min = 50; heightInput.step = 10; heightInput.value = newSegment.height;
    heightInput.className = 'duct-height-input w-full p-1 border border-gray-300 rounded-md shadow-sm text-xs data-duct-input';
    const heightWrapper = document.createElement('div');
    heightWrapper.innerHTML = `<label class="text-xs font-medium">${translations[currentLang].segment_height}</label>`; heightWrapper.appendChild(heightInput);
    rectDimWrapper.appendChild(heightWrapper);
    detailsCell.appendChild(rectDimWrapper);

    const toggleSegmentInputs = (shape) => {
        diameterWrapper.style.display = shape === 'round' ? 'block' : 'none';
        rectDimWrapper.style.display = shape === 'rectangular' ? 'block' : 'none';
        const segment = ductSystemLayout.find(s => s.id === segmentId);
        if (segment) { segment.shape = shape; }
        performCalculations();
    };
    shapeSelect.addEventListener('change', (e) => toggleSegmentInputs(e.target.value));
    toggleSegmentInputs(newSegment.shape);

    // Parameters Cell (Length, Material)
    const paramsCell = row.insertCell();
    paramsCell.classList.add('space-y-1');

    const lengthInput = document.createElement('input');
    lengthInput.type = 'number'; lengthInput.min = 0.1; lengthInput.step = 0.1; lengthInput.value = newSegment.length;
    lengthInput.className = 'duct-length-input w-full p-1 border border-gray-300 rounded-md shadow-sm text-xs data-duct-input';
    const lengthWrapper = document.createElement('div');
    lengthWrapper.innerHTML = `<label class="text-xs font-medium">${translations[currentLang].segment_length}</label>`;
    lengthWrapper.appendChild(lengthInput);
    paramsCell.appendChild(lengthWrapper);

    const materialSelect = document.createElement('select');
    materialSelect.className = 'duct-material-select w-full p-1 border border-gray-300 rounded-md shadow-sm text-xs data-duct-input';
    Object.keys(DUCT_ROUGHNESS).forEach(matKey => {
        const optionText = translations[currentLang][`pressure_duct_mat_${matKey}`] || matKey.replace(/_/g, ' ');
        materialSelect.add(new Option(optionText, matKey));
    });
    materialSelect.value = newSegment.material;
    const materialWrapper = document.createElement('div');
    materialWrapper.innerHTML = `<label class="text-xs font-medium">${translations[currentLang].segment_material}</label>`;
    materialWrapper.appendChild(materialSelect);
    paramsCell.appendChild(materialWrapper);

    // Action Cell
    const actionCell = row.insertCell();
    const removeBtn = document.createElement('button');
    removeBtn.className = 'text-red-600 hover:text-red-800 remove-item-btn text-sm p-1';
    removeBtn.textContent = translations[currentLang].remove_button;
    removeBtn.onclick = () => deleteDuctSystemRow(segmentId);
    actionCell.appendChild(removeBtn);

    // Event listeners for this row's inputs
    [diameterInput, widthInput, heightInput, lengthInput, materialSelect, shapeSelect].forEach(inputEl => {
        inputEl.addEventListener('change', () => {
            const segment = ductSystemLayout.find(s => s.id === segmentId);
            if (segment) {
                segment.length = parseFloat(lengthInput.value);
                segment.shape = shapeSelect.value;
                segment.diameter = parseFloat(diameterInput.value);
                segment.width = parseFloat(widthInput.value);
                segment.height = parseFloat(heightInput.value);
                segment.material = materialSelect.value;
                performCalculations();
            }
        });
        if(inputEl.type === 'number') inputEl.addEventListener('input', () => { /* Can add debounced live update if needed */ });
    });
    updateDuctSystemRowOrder();
    updateDuctSystemRowTranslations(row, currentLang); // Translate new row
    performCalculations();
}


/**
 * Adds a new fitting row to the UI and layout array. (More detailed)
 */
function addFittingRowUI() {
    const fittingId = `el-${nextDuctElementId++}`;
    const newFitting = {
        id: fittingId, type: 'fitting', fittingKey: '', quantity: 1,
        // Transition-specific properties, initially null or based on previous segment
        shape_upstream: 'round', d_upstream: 200, w_upstream: null, h_upstream: null,
        shape_downstream: 'round', d_downstream: 200, w_downstream: null, h_downstream: null,
    };
    // Try to infer upstream dimensions from the previous element
    if (ductSystemLayout.length > 0) {
        const prevElement = ductSystemLayout[ductSystemLayout.length - 1];
        if (prevElement.type === 'segment') {
            newFitting.shape_upstream = prevElement.shape;
            if (prevElement.shape === 'round') newFitting.d_upstream = prevElement.diameter;
            else { newFitting.w_upstream = prevElement.width; newFitting.h_upstream = prevElement.height; }
            // Default downstream to same as upstream for non-transition fittings
            newFitting.shape_downstream = newFitting.shape_upstream;
            newFitting.d_downstream = newFitting.d_upstream;
            newFitting.w_downstream = newFitting.w_upstream;
            newFitting.h_downstream = newFitting.h_upstream;
        } else if (prevElement.type === 'fitting') { // If previous was a fitting, use its downstream
            newFitting.shape_upstream = prevElement.shape_downstream;
            newFitting.d_upstream = prevElement.d_downstream;
            newFitting.w_upstream = prevElement.w_downstream;
            newFitting.h_upstream = prevElement.h_downstream;
            // Default downstream to same as upstream
            newFitting.shape_downstream = newFitting.shape_upstream;
            newFitting.d_downstream = newFitting.d_upstream;
            newFitting.w_downstream = newFitting.w_upstream;
            newFitting.h_downstream = newFitting.h_upstream;
        }
    }
    ductSystemLayout.push(newFitting);

    const row = ductSystemTableBody.insertRow();
    row.classList.add('duct-system-row', 'duct-fitting-row');
    row.setAttribute('data-id', fittingId);

    row.insertCell(); // Order
    row.insertCell().textContent = translations[currentLang].segment_type_fitting; // Type

    const detailsCell = row.insertCell(); detailsCell.classList.add('space-y-1');
    const paramsCell = row.insertCell(); paramsCell.classList.add('space-y-1'); // Quantity
    const actionCell = row.insertCell();

    // Fitting Type Select
    const fittingTypeSelect = document.createElement('select');
    fittingTypeSelect.className = 'fitting-type-select w-full p-1 border border-gray-300 rounded-md shadow-sm text-xs data-duct-input';
    // Populate in updateDuctSystemRowTranslations or here - doing it here for initial setup
    const placeholderText = translations[currentLang].option_placeholder_select || "Select...";
    fittingTypeSelect.innerHTML = `<option value="">${placeholderText}</option>`;
    Object.keys(FITTING_K_FACTORS).forEach(fitKey => { // Filter or categorize if list is too long
        if (fitKey !== 'hood_entry_assumed' && !fitKey.startsWith('outlet_')) { // Exclude system-level items
            const optionText = translations[currentLang][`fitting_${fitKey}`] || fitKey.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            fittingTypeSelect.add(new Option(optionText, fitKey));
        }
    });
    const fittingTypeWrapper = document.createElement('div');
    fittingTypeWrapper.innerHTML = `<label class="text-xs font-medium">${translations[currentLang].fitting_type}</label>`;
    fittingTypeWrapper.appendChild(fittingTypeSelect);
    detailsCell.appendChild(fittingTypeWrapper);

    // Transition Inputs Wrapper (initially hidden)
    const transitionInputsWrapper = document.createElement('div');
    transitionInputsWrapper.className = 'transition-inputs-wrapper hidden space-y-1 mt-1';
    // Upstream Shape (mostly for display, could be auto-detected from previous segment)
    // Downstream Shape, D/W-H (these define the *exit* of the transition)
    const dsShapeSelect = document.createElement('select'); /* ... similar to segment shapeSelect ... */
    dsShapeSelect.className = 'fitting-dshape-select w-full p-1 border ... text-xs data-duct-input';
    dsShapeSelect.innerHTML = `<option value="round">Round</option><option value="rectangular">Rectangular</option>`;
    const dsShapeWrapper = document.createElement('div'); dsShapeWrapper.innerHTML = `<label class="text-xs">Downstream Shape:</label>`; dsShapeWrapper.appendChild(dsShapeSelect);
    transitionInputsWrapper.appendChild(dsShapeWrapper);

    const dsDiameterInput = document.createElement('input'); /* type=number, className, value */
    dsDiameterInput.type = 'number'; dsDiameterInput.className = 'fitting-ddiameter-input w-full p-1 border ... text-xs data-duct-input';
    const dsDiameterWrapper = document.createElement('div'); dsDiameterWrapper.innerHTML = `<label class="text-xs">Downstream Dia. (mm):</label>`; dsDiameterWrapper.appendChild(dsDiameterInput);
    transitionInputsWrapper.appendChild(dsDiameterWrapper);

    const dsRectWrapper = document.createElement('div'); dsRectWrapper.className = 'hidden space-y-1'; // for downstream W/H
    const dsWidthInput = document.createElement('input'); /* type=number */ dsWidthInput.type = 'number'; dsWidthInput.className='fitting-dwidth-input w-full p-1 border ... text-xs data-duct-input';
    const dsHeightInput = document.createElement('input'); /* type=number */ dsHeightInput.type = 'number'; dsHeightInput.className='fitting-dheight-input w-full p-1 border ... text-xs data-duct-input';
    const dsWidthWrapper = document.createElement('div'); dsWidthWrapper.innerHTML = `<label class="text-xs">Downstream W (mm):</label>`; dsWidthWrapper.appendChild(dsWidthInput);
    const dsHeightWrapper = document.createElement('div'); dsHeightWrapper.innerHTML = `<label class="text-xs">Downstream H (mm):</label>`; dsHeightWrapper.appendChild(dsHeightInput);
    dsRectWrapper.appendChild(dsWidthWrapper); dsRectWrapper.appendChild(dsHeightWrapper);
    transitionInputsWrapper.appendChild(dsRectWrapper);

    detailsCell.appendChild(transitionInputsWrapper);

    const toggleTransitionInputs = (shape) => {
        dsDiameterWrapper.style.display = shape === 'round' ? 'block' : 'none';
        dsRectWrapper.style.display = shape === 'rectangular' ? 'block' : 'none';
        const fitting = ductSystemLayout.find(f => f.id === fittingId);
        if (fitting) { fitting.shape_downstream = shape; performCalculations(); }
    };
    dsShapeSelect.addEventListener('change', (e) => toggleTransitionInputs(e.target.value));
    // Set initial state based on newFitting.shape_downstream
    dsShapeSelect.value = newFitting.shape_downstream;
    toggleTransitionInputs(newFitting.shape_downstream);
    if(newFitting.shape_downstream === 'round') dsDiameterInput.value = newFitting.d_downstream || '';
    else {dsWidthInput.value = newFitting.w_downstream || ''; dsHeightInput.value = newFitting.h_downstream || '';}


    // Quantity Input (for elbows, etc.)
    const quantityInput = document.createElement('input');
    quantityInput.type = 'number'; quantityInput.min = 1; quantityInput.step = 1; quantityInput.value = newFitting.quantity;
    quantityInput.className = 'fitting-quantity-input w-full p-1 border border-gray-300 rounded-md shadow-sm text-xs data-duct-input';
    const quantityWrapper = document.createElement('div');
    quantityWrapper.innerHTML = `<label class="text-xs font-medium">${translations[currentLang].fitting_quantity}</label>`;
    quantityWrapper.appendChild(quantityInput);
    paramsCell.appendChild(quantityWrapper); // Quantity goes into params cell

    const removeBtn = document.createElement('button'); /* ... same as segment ... */
    removeBtn.className = 'text-red-600 hover:text-red-800 remove-item-btn text-sm p-1';
    removeBtn.textContent = translations[currentLang].remove_button;
    removeBtn.onclick = () => deleteDuctSystemRow(fittingId);
    actionCell.appendChild(removeBtn);

    fittingTypeSelect.addEventListener('change', (e) => {
        const selectedKey = e.target.value;
        const fitting = ductSystemLayout.find(f => f.id === fittingId);
        if (fitting) fitting.fittingKey = selectedKey;
        transitionInputsWrapper.classList.toggle('hidden', !selectedKey.includes('transition'));
        quantityWrapper.style.display = selectedKey.includes('transition') ? 'none' : 'block'; // Hide qty for transitions
        if (selectedKey.includes('transition') && fitting) { // For transitions, set quantity to 1
            fitting.quantity = 1;
            quantityInput.value = 1;
        }
        performCalculations();
    });
    // Set initial visibility based on selected key (if any)
    transitionInputsWrapper.classList.toggle('hidden', !newFitting.fittingKey.includes('transition'));
    quantityWrapper.style.display = newFitting.fittingKey.includes('transition') ? 'none' : 'block';


    // Event listeners for fitting inputs
    [quantityInput, dsDiameterInput, dsWidthInput, dsHeightInput, dsShapeSelect].forEach(inputEl => {
         inputEl.addEventListener('change', () => {
            const fitting = ductSystemLayout.find(f => f.id === fittingId);
            if (fitting) {
                fitting.quantity = parseInt(quantityInput.value);
                fitting.shape_downstream = dsShapeSelect.value;
                fitting.d_downstream = parseFloat(dsDiameterInput.value);
                fitting.w_downstream = parseFloat(dsWidthInput.value);
                fitting.h_downstream = parseFloat(dsHeightInput.value);
                performCalculations();
            }
        });
    });
    updateDuctSystemRowOrder();
    updateDuctSystemRowTranslations(row, currentLang);
    performCalculations();
}


/**
 * Rewritten Pressure Drop Calculation for Segmented System
 */
function calculatePressureDrop() {
    try {
        let airflowM3HForPressure = 0;
        if (manualAirflowToggle.checked) {
            airflowM3HForPressure = parseFloat(manualAirflowInput.value) || 0;
        } else {
            airflowM3HForPressure = lastCalculatedAirflowHighM3H;
        }

        if (airflowM3HForPressure <= 0 || ductSystemLayout.length === 0) {
            calculatedVelocityDisplay.textContent = `0.0 m/s`;
            estimatedPressureDropDisplay.textContent = `0 Pa`;
            return;
        }
        const airflowM3S = airflowM3HForPressure / 3600;
        const exhaustTempC = parseFloat(exhaustAirTempInput.value) || 20;
        const airProps = getAirProperties(exhaustTempC);

        let totalPressureDropPa = 0;
        let currentUpstreamAreaM2 = null; // Area of the current or previous segment exit
        let firstSegmentVelocityDone = false;

        ductSystemLayout.forEach((element, index) => {
            let segmentAreaM2, segmentHydraulicDiameterM, segmentVelocityMs, segment_P_dyn;

            if (element.type === 'segment') {
                const lengthM = parseFloat(element.length) || 0;
                const material = element.material || 'galvanized';
                const roughness = DUCT_ROUGHNESS[material] || DUCT_ROUGHNESS.galvanized;

                if (element.shape === 'rectangular') {
                    const widthM = parseFloat(element.width) / 1000 || 0;
                    const heightM = parseFloat(element.height) / 1000 || 0;
                    if (widthM <= 0 || heightM <= 0) return;
                    segmentAreaM2 = widthM * heightM;
                    segmentHydraulicDiameterM = (2 * widthM * heightM) / (widthM + heightM);
                } else { // round
                    const diameterM = parseFloat(element.diameter) / 1000 || 0;
                    if (diameterM <= 0) return;
                    segmentAreaM2 = Math.PI * Math.pow(diameterM / 2, 2);
                    segmentHydraulicDiameterM = diameterM;
                }
                currentUpstreamAreaM2 = segmentAreaM2; // Update for subsequent fittings

                segmentVelocityMs = airflowM3S / segmentAreaM2;
                segment_P_dyn = (airProps.density * Math.pow(segmentVelocityMs, 2)) / 2;

                if (!firstSegmentVelocityDone) {
                    calculatedVelocityDisplay.textContent = `${segmentVelocityMs.toFixed(1)} m/s`;
                    firstSegmentVelocityDone = true;
                }

                const Re = (airProps.density * segmentVelocityMs * segmentHydraulicDiameterM) / airProps.viscosity;
                let frictionFactor = 0;
                if (Re > 4000) {
                    const term1 = Math.pow((roughness / (3.7 * segmentHydraulicDiameterM)), 1.11);
                    const term2 = 6.9 / Re;
                    frictionFactor = Math.pow(-1.8 * Math.log10(term1 + term2), -2);
                } else if (Re > 0 && Re <= 2300) {
                    frictionFactor = 64 / Re;
                } else if (Re > 2300 && Re <= 4000) { // Transitional approx with Haaland
                    const term1 = Math.pow((roughness / (3.7 * segmentHydraulicDiameterM)), 1.11);
                    const term2 = 6.9 / Re;
                    frictionFactor = Math.pow(-1.8 * Math.log10(term1 + term2), -2);
                }

                if (segmentHydraulicDiameterM > 0) {
                    const frictionLossPaSegment = frictionFactor * (lengthM / segmentHydraulicDiameterM) * segment_P_dyn;
                    totalPressureDropPa += frictionLossPaSegment;
                }
            } else if (element.type === 'fitting') {
                const quantity = parseInt(element.quantity) || 1;
                let K_fitting = 0;
                let P_dyn_fitting = 0;

                // Determine P_dyn for the fitting based on its *own* upstream dimensions if defined,
                // otherwise, it's implicitly attached to the exit of the previous segment.
                let fittingUpstreamAreaM2 = currentUpstreamAreaM2; // Default to last segment's exit area

                // For transitions, K-factor is often based on V_upstream (larger pipe for contraction, smaller for expansion)
                // The `element` for fitting should store its own upstream and downstream characteristics if it's a transition.
                let A_up, A_down;
                if (element.fittingKey.includes('transition')) {
                    // Upstream of transition
                    if (element.shape_upstream === 'round') A_up = Math.PI * Math.pow(parseFloat(element.d_upstream) / 2000, 2);
                    else A_up = (parseFloat(element.w_upstream) / 1000) * (parseFloat(element.h_upstream) / 1000);
                    // Downstream of transition
                    if (element.shape_downstream === 'round') A_down = Math.PI * Math.pow(parseFloat(element.d_downstream) / 2000, 2);
                    else A_down = (parseFloat(element.w_downstream) / 1000) * (parseFloat(element.h_downstream) / 1000);

                    if (A_up > 0) {
                         const V_up = airflowM3S / A_up;
                         P_dyn_fitting = (airProps.density * Math.pow(V_up, 2)) / 2;
                         fittingUpstreamAreaM2 = A_up; // K is based on this section's P_dyn
                    }
                     if (typeof FITTING_K_FACTORS[element.fittingKey] === 'function') {
                        K_fitting = FITTING_K_FACTORS[element.fittingKey](A_up, A_down);
                    } else {
                        K_fitting = FITTING_K_FACTORS[element.fittingKey] || 0;
                    }
                    currentUpstreamAreaM2 = A_down; // The exit area of the transition is the new upstream for next element
                } else { // For non-transition fittings (elbows, dampers)
                    if (fittingUpstreamAreaM2 && fittingUpstreamAreaM2 > 0) {
                        const V_fit_up = airflowM3S / fittingUpstreamAreaM2;
                        P_dyn_fitting = (airProps.density * Math.pow(V_fit_up, 2)) / 2;
                    }
                    K_fitting = FITTING_K_FACTORS[element.fittingKey] || 0;
                    // For elbows etc., the area doesn't change through the fitting itself
                }
                totalPressureDropPa += quantity * K_fitting * P_dyn_fitting;
            }
        });

        // Add fixed losses: Filter and Outlet
        const filterDropPa = parseFloat(filterPressureDropInput.value) || 0;
        totalPressureDropPa += filterDropPa;

        const outletType = outletTypeSelect.value;
        const k_outlet = FITTING_K_FACTORS['outlet_' + outletType] || 0;
        if (currentUpstreamAreaM2 && currentUpstreamAreaM2 > 0) { // Use last known upstream area for outlet P_dyn
            const velocity_final_outlet = airflowM3S / currentUpstreamAreaM2;
            const P_dyn_final_outlet = (airProps.density * Math.pow(velocity_final_outlet, 2)) / 2;
            totalPressureDropPa += k_outlet * P_dyn_final_outlet;
        }
        // Add hood entry loss (K applied to P_dyn of the very first segment)
        if(ductSystemLayout.length > 0 && ductSystemLayout[0].type === 'segment') {
            const firstSegment = ductSystemLayout[0];
            let firstSegmentArea, firstSegmentVelocity, first_P_dyn;
             if (firstSegment.shape === 'rectangular') {
                firstSegmentArea = (parseFloat(firstSegment.width) / 1000) * (parseFloat(firstSegment.height) / 1000);
            } else { // round
                firstSegmentArea = Math.PI * Math.pow(parseFloat(firstSegment.diameter) / 2000, 2);
            }
            if (firstSegmentArea > 0) {
                firstSegmentVelocity = airflowM3S / firstSegmentArea;
                first_P_dyn = (airProps.density * Math.pow(firstSegmentVelocity, 2)) / 2;
                totalPressureDropPa += (FITTING_K_FACTORS.hood_entry_assumed || 0.5) * first_P_dyn;
            }
        }


        estimatedPressureDropDisplay.textContent = `${totalPressureDropPa.toFixed(0)} Pa`;

    } catch (error) {
        console.error("Error during calculatePressureDrop:", error);
        calculatedVelocityDisplay.textContent = `Error`; // Fallback
        estimatedPressureDropDisplay.textContent = `Error Pa`;
    }
}


// --- CSV Functions (Updated export summary) ---
function parseCSV(text) { /* ... (from previous, ensure robustness) ... */
    const lines = text.trim().split('\n');
    const data = [];
    const headerMap = { // Lowercase, no spaces for robustness
        "appliancename": "name", "nomeequipamento": "name",
        "equipmenttype": "equipText", "tipoequipamento": "equipText",
        "gastype": "gasTypeText", "tipogás": "gasTypeText", "tipogas": "gasTypeText",
        "gasusage": "gasUsage", "consumogás": "gasUsage", "consumogas": "gasUsage",
        "gasunit": "gasUnitText", "unid.": "gasUnitText", "unit": "gasUnitText", "unidade": "gasUnitText",
        "electricusage(kw)": "electricUsage", "consumoelétrico(kw)": "electricUsage", "consumoeletrico(kw)": "electricUsage"
    };
    let headers = [];

    lines.forEach((line, index) => {
        const trimmedLine = line.trim(); if (!trimmedLine) return;
        // Basic CSV field splitting (handles quoted fields with commas inside)
        const fields = []; let currentField = ''; let inQuotes = false;
        for (let i = 0; i < trimmedLine.length; i++) {
            const char = trimmedLine[i];
            if (char === '"' && (i === 0 || trimmedLine[i - 1] !== '"' || (inQuotes && i + 1 < trimmedLine.length && trimmedLine[i+1] === '"'))) {
                if (inQuotes && i + 1 < trimmedLine.length && trimmedLine[i+1] === '"') { // Escaped quote ""
                    currentField += '"'; i++;
                } else { inQuotes = !inQuotes; }
            } else if (char === ',' && !inQuotes) {
                fields.push(currentField.trim()); currentField = '';
            } else { currentField += char; }
        }
        fields.push(currentField.trim());

        if (index === 0) { // Header row
             headers = fields.map(h => headerMap[h.toLowerCase().replace(/\s+/g, '').replace(/[()]/g, '')] || null);
        } else if (headers.length > 0) {
            const rowData = {};
            fields.forEach((field, i) => {
                if (headers[i]) rowData[headers[i]] = field.replace(/^"|"$/g, '').replace(/""/g, '"');
            });

            const equipTextLower = (rowData.equipText || "").toLowerCase();
            rowData.equipValue = Object.keys(SENSIBLE_FACTORS).find(key => (translations.en[`equip_type_${key}`] || "").toLowerCase() === equipTextLower || (translations.pt[`equip_type_${key}`] || "").toLowerCase() === equipTextLower || key.toLowerCase() === equipTextLower) || 'other';
            const gasTextLower = (rowData.gasTypeText || "").toLowerCase();
            rowData.gasTypeValue = Object.keys(translations.en).find(key => key.startsWith('gas_type_') && (translations.en[key] || "").toLowerCase().includes(gasTextLower))?.replace('gas_type_', '') || (gasTextLower.includes("natural") ? 'natural_pt' : gasTextLower.includes("propane") ? 'propane' : gasTextLower.includes("butane") ? 'butane' : 'natural_pt');
            rowData.gasUnitValue = GAS_UNIT_TEXT_TO_VALUE[(rowData.gasUnitText || "").toLowerCase()] || (rowData.gasTypeValue === 'natural_pt' ? 'm3h' : 'kgh');
            data.push(rowData);
        }
    });
    return data;
}

function handleCsvImport(event) { /* ... (from previous, ensure it switches method and calls performCalculations) ... */
    const file = event.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const csvText = e.target.result;
            const lines = csvText.split('\n');
            let dataStartIndex = lines.findIndex(line => line.toLowerCase().includes('appliance name') || line.toLowerCase().includes('nome equipamento'));
            if (dataStartIndex === -1) { dataStartIndex = 0; } // Assume data from first line if no header found

            const dataCsvText = lines.slice(dataStartIndex).join('\n');
            const importedData = parseCSV(dataCsvText);
            if (importedData && importedData.length > 0) {
                tableBody.innerHTML = ''; importedData.forEach(rowData => addApplianceRow(rowData));
                // Switch to heat load method
                document.querySelector('input[name="calculationMethod"][value="heatLoad"]').checked = true;
                currentCalculationMethod = 'heatLoad';
                toggleCalculationMethodView();
                performCalculations();
                alert(`${translations[currentLang].import_csv_success || `Imported ${importedData.length} appliance(s).`}`);
            } else { alert(translations[currentLang].import_csv_no_data || "No valid appliance data found in CSV or failed to parse."); }
        } catch (error) { console.error("Error processing CSV file:", error); alert(translations[currentLang].import_csv_error || "Failed to process CSV file."); }
        finally { csvFileInput.value = ''; }
    };
    reader.onerror = function() { alert(translations[currentLang].import_csv_read_error || "Error reading file."); csvFileInput.value = ''; };
    reader.readAsText(file);
}

function exportToCSV() { /* ... (Updated to reflect current method and new fields) ... */
    let csvContent = "data:text/csv;charset=utf-8,";
    const lang = currentLang;

    // General Info
    csvContent += `"${translations[lang].title}"\r\n`;
    csvContent += `"${translations[lang].calculation_method_title}","${currentCalculationMethod === 'heatLoad' ? translations[lang].calc_method_heat_load : translations[lang].calc_method_hood_dim}"\r\n`;
    csvContent += `"${translations[lang].hood_type_label}","${hoodTypeSelect.options[hoodTypeSelect.selectedIndex].text}"\r\n`;

    // Method Specific Summary
    if (currentCalculationMethod === 'heatLoad') {
        csvContent += `"${translations[lang].diversity_factor_label}","${diversityFactorInput.value}"\r\n`;
        csvContent += `"${translations[lang].summary_total_sensible}","${totalSensibleHeatDisplay.textContent}"\r\n`;
        csvContent += `"${translations[lang].summary_hood_factor}","${hoodFactorDisplay.textContent}"\r\n`;
    } else {
        csvContent += `"${translations[lang].hood_length_label}","${hoodLengthInput.value || 'N/A'} m"\r\n`;
        if (hoodTypeSelect.value !== 'eyebrow') {
            csvContent += `"${translations[lang].hood_depth_label}","${hoodDepthInput.value || 'N/A'} m"\r\n`;
            csvContent += `"${translations[lang].duty_level_label}","${cookingDutyLevelSelect.options[cookingDutyLevelSelect.selectedIndex].text}"\r\n`;
        } else {
            csvContent += `"${translations[lang].eyebrow_apm_label}","${eyebrowAirflowPerMeterInput.value || 'N/A'} m³/h/m"\r\n`;
        }
    }
    csvContent += `"${translations[lang].summary_airflow_label}","${estimatedAirflowDisplay.textContent}"\r\n\r\n`;

    // Appliance Data (if any)
    if (tableBody.querySelectorAll('.appliance-row').length > 0) {
        const headers = [translations[lang].th_appliance_name, translations[lang].th_equipment_type, translations[lang].th_gas_type, translations[lang].th_gas_usage, translations[lang].th_gas_unit, translations[lang].th_electric_usage, translations[lang].th_total_power, translations[lang].th_sensible_factor, translations[lang].th_sensible_heat].map(h => `"${h}"`).join(",");
        csvContent += headers + "\r\n";
        tableBody.querySelectorAll('.appliance-row').forEach(row => {
            const name = row.querySelector('.appliance-name').value.replace(/"/g, '""');
            const equipType = row.querySelector('.equipment-type').options[row.querySelector('.equipment-type').selectedIndex].text;
            // ... (rest of appliance data extraction as before)
            const gasType = row.querySelector('.gas-type').options[row.querySelector('.gas-type').selectedIndex].text;
            const gasUsage = row.querySelector('.gas-usage').value || "0";
            const gasUnitSelect = row.querySelector('.gas-unit');
            const gasUnit = gasUnitSelect.style.display === 'none' ? "N/A" : gasUnitSelect.options[gasUnitSelect.selectedIndex].text;
            const electricUsage = row.querySelector('.electric-usage').value || "0";
            const totalPower = row.querySelector('.total-power').textContent;
            const sensibleFactor = row.querySelector('.sensible-factor').textContent;
            const sensibleHeat = row.querySelector('.sensible-heat').textContent;
            const rowData = [`"${name}"`, `"${equipType}"`, `"${gasType}"`, gasUsage, `"${gasUnit}"`, electricUsage, `"${totalPower}"`, `"${sensibleFactor}"`, `"${sensibleHeat}"`];
            csvContent += rowData.join(",") + "\r\n";
        });
        csvContent += "\r\n";
    }

    // Duct System & Pressure Drop Summary
    csvContent += `"${translations[lang].pressure_title}"\r\n`;
    csvContent += `"${translations[lang].exhaust_air_temp_label}","${exhaustAirTempInput.value} °C"\r\n`;
    csvContent += `"${translations[lang].pressure_manual_toggle_label}","${manualAirflowToggle.checked ? 'ON' : 'OFF'}"\r\n`;
    if (manualAirflowToggle.checked) csvContent += `"${translations[lang].pressure_manual_input_label}","${manualAirflowInput.value || 'N/A'} m³/h"\r\n`;
    csvContent += `"${translations[lang].pressure_recom_duct}","${recommendedDuctDisplay.textContent}"\r\n`;
    csvContent += `"${translations[lang].pressure_filter_label}","${filterPressureDropInput.value || 'N/A'} Pa"\r\n`;
    csvContent += `"${translations[lang].pressure_outlet_label}","${outletTypeSelect.options[outletTypeSelect.selectedIndex].text}"\r\n`;
    csvContent += `"${translations[lang].pressure_velocity_label}","${calculatedVelocityDisplay.textContent}"\r\n`;
    csvContent += `"${translations[lang].pressure_total_label}","${estimatedPressureDropDisplay.textContent}"\r\n\r\n`;

    // Duct System Layout (NEW)
    if(ductSystemLayout.length > 0) {
        csvContent += `"${translations[lang].duct_system_layout_title}"\r\n`;
        const dsHeaders = [translations[lang].ds_order, translations[lang].ds_type, "Shape/Fitting", "Dim1(mm)/Up D(mm)", "Dim2(mm)/Down D(mm)", "Length(m)/Qty", "Material"].map(h => `"${h}"`).join(",");
        csvContent += dsHeaders + "\r\n";
        ductSystemLayout.forEach((el, index) => {
            let rowCsv = [`"${index + 1}"`];
            if (el.type === 'segment') {
                rowCsv.push(`"${translations[lang].segment_type_segment}"`);
                rowCsv.push(`"${el.shape === 'round' ? translations[lang].segment_shape_round : translations[lang].segment_shape_rect}"`);
                rowCsv.push(`"${el.shape === 'round' ? el.diameter : el.width}"`);
                rowCsv.push(`"${el.shape === 'round' ? '' : el.height}"`);
                rowCsv.push(`"${el.length}"`);
                rowCsv.push(`"${translations[lang]['pressure_duct_mat_' + el.material] || el.material}"`);
            } else { // fitting
                rowCsv.push(`"${translations[lang].segment_type_fitting}"`);
                rowCsv.push(`"${translations[lang]['fitting_' + el.fittingKey] || el.fittingKey}"`);
                if (el.fittingKey.includes('transition')) {
                    rowCsv.push(`"${el.d_upstream || (el.w_upstream + 'x' + el.h_upstream) || ''}"`); // Upstream
                    rowCsv.push(`"${el.d_downstream || (el.w_downstream + 'x' + el.h_downstream) || ''}"`); // Downstream
                } else {
                    rowCsv.push(`""`); // Dim1 for non-transition
                    rowCsv.push(`""`); // Dim2 for non-transition
                }
                rowCsv.push(`"${el.quantity}"`);
                rowCsv.push(`""`); // Material N/A for fitting
            }
            csvContent += rowCsv.join(",") + "\r\n";
        });
    }


    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `kitchen_airflow_estimate_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
}


// --- Event Listeners (Main Page Controls) ---
function setupEventListeners() {
    langButtons.forEach(btn => btn.addEventListener('click', (e) => setLanguage(e.target.getAttribute('data-lang'))));

    calculationMethodRadios.forEach(radio => {
        radio.addEventListener('change', (event) => {
            currentCalculationMethod = event.target.value;
            toggleCalculationMethodView();
            performCalculations();
        });
    });

    hoodTypeSelect.addEventListener('change', () => {
        if (currentCalculationMethod === 'hoodDimension') {
            toggleDimensionalInputsBasedOnHoodType();
        }
        performCalculations(); // Hood type affects heat load factors & dimensional defaults
    });

    dimensionalInputs.forEach(input => { // Inputs for dimensional method
        input.addEventListener('input', performCalculations);
        input.addEventListener('change', performCalculations);
    });
    
    diversityFactorInput.addEventListener('input', performCalculations);
    diversityFactorInput.addEventListener('change', performCalculations);


    // Appliance Table Buttons & File Input
    addApplianceBtn.addEventListener('click', () => addApplianceRow());
    importCsvBtn.addEventListener('click', () => csvFileInput.click());
    csvFileInput.addEventListener('change', handleCsvImport);
    exportCsvBtn.addEventListener('click', exportToCSV);

    // Duct System Buttons
    addDuctSegmentBtn.addEventListener('click', addDuctSegmentRowUI);
    addFittingBtn.addEventListener('click', addFittingRowUI);


    // Explanation Sections
    infoIcons.forEach(icon => {
        icon.addEventListener('click', (e) => {
            const targetId = e.target.getAttribute('data-target-section');
            const targetSection = document.getElementById(targetId);
            if (targetSection) {
                explanationSections.forEach(sec => { if(sec.id !== targetId) sec.style.display = 'none';}); // Hide others
                targetSection.style.display = targetSection.style.display === 'block' ? 'none' : 'block'; // Toggle
            }
        });
    });
    closeExplanationBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const targetSection = e.target.closest('.explanation-section');
            if (targetSection) targetSection.style.display = 'none';
        });
    });

    // Manual Airflow Override
    manualAirflowToggle.addEventListener('change', (e) => {
        const isManual = e.target.checked;
        manualAirflowInputWrapper.classList.toggle('hidden', !isManual);
        estimatedAirflowWrapper.style.opacity = isManual ? '0.5' : '1';
        if (isManual && !manualAirflowInput.value) {
            manualAirflowInput.value = lastCalculatedAirflowHighM3H.toFixed(0);
        }
        performCalculations(); // Recalculate pressure with new airflow source
    });
    manualAirflowInput.addEventListener('input', () => { if(manualAirflowToggle.checked) performCalculations(); });
    manualAirflowInput.addEventListener('change', () => { if(manualAirflowToggle.checked) performCalculations(); });


    // Inputs that directly affect pressure drop calculation (excluding dynamic duct system inputs handled per row)
    exhaustAirTempInput.addEventListener('input', performCalculations);
    exhaustAirTempInput.addEventListener('change', performCalculations);
    filterPressureDropInput.addEventListener('input', performCalculations);
    filterPressureDropInput.addEventListener('change', performCalculations);
    outletTypeSelect.addEventListener('change', performCalculations);

    // Generic listener for any other config inputs that should trigger a full recalc
    pressureConfigInputs.forEach(input => {
        input.addEventListener('input', performCalculations);
        input.addEventListener('change', performCalculations);
    });
}

// --- Initialization ---
function initializeApp() {
    setLanguage(currentLang); // Set to 'pt' by default (currentLang is 'pt')
    addApplianceRow();      // Add one default appliance row
    addDuctSegmentRowUI();  // Add one default duct segment row
    toggleCalculationMethodView(); // Set initial view based on default method
    toggleDimensionalInputsBasedOnHoodType();
    setupEventListeners();
    performCalculations(); // Perform initial calculation with default values
}

// Wait for the DOM to be fully loaded before initializing
document.addEventListener('DOMContentLoaded', initializeApp);