// script.js
'use strict'; // Optional, but good practice

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
    flex_metal_uninsulated: 0.0015,
};

const FITTING_K_FACTORS = {
    elbow90_r_d_1_5: 0.25,
    elbow90_r_d_1_0: 0.40,
    elbow90_r_d_2_0: 0.20,
    elbow90_mitred_novanes: 1.2,
    elbow45_r_d_1_5: 0.15,
    transition_sudden_contraction: function(A_upstream, A_downstream) {
        if (A_upstream <= 0 || A_downstream <= 0 || A_downstream >= A_upstream) return 0;
        const areaRatio = A_downstream / A_upstream;
        if (areaRatio < 0.2) return 0.4 * (1 - areaRatio);
        if (areaRatio < 0.5) return 0.3 * (1 - areaRatio);
        return 0.2 * (1 - areaRatio);
    },
    transition_sudden_expansion: function(A_upstream, A_downstream) {
        if (A_downstream <= 0 || A_upstream <= 0 || A_upstream >= A_downstream) return 0;
        const areaRatio = A_upstream / A_downstream;
        return Math.pow(1 - areaRatio, 2);
    },
    transition_gradual_expansion_15deg: function(A_upstream, A_downstream) {
        if (A_downstream <= 0 || A_upstream <= 0 || A_upstream >= A_downstream) return 0;
        const areaRatio = A_upstream / A_downstream;
        return (0.25 * Math.pow(1 - areaRatio, 2)) + 0.02;
    },
    transition_gradual_contraction_30deg: function(A_upstream, A_downstream) {
        if (A_upstream <= 0 || A_downstream <= 0 || A_downstream >= A_upstream) return 0;
        return 0.05;
    },
    damper_butterfly_fully_open: 0.35,
    damper_butterfly_45deg: 1.7,
    damper_gate_fully_open: 0.15,
    outlet_weather_cap: 1.0,
    outlet_low_loss_louver: 0.5,
    outlet_bird_screen: 0.7,
    outlet_open: 0.0,
    outlet_vertical_stack: 0.05,
    outlet_gooseneck: 2.0,
    hood_entry_assumed: 0.5
};

const STANDARD_DUCT_SIZES_MM = [80, 100, 125, 150, 160, 180, 200, 224, 250, 280, 300, 315, 355, 400, 450, 500, 560, 630, 710, 800, 900, 1000];
const TARGET_VELOCITY_MS = 10.0;

const GAS_UNIT_TEXT_TO_VALUE = {
    "m³/h": "m3h", "m3/h": "m3h",
    "kwh": "kwh",
    "btu/h": "btuh",
    "kg/h": "kgh"
};

const R_SPECIFIC_AIR = 287.058;
const ATMOSPHERIC_PRESSURE_PA = 101325;
const MU_REF_SUTHERLAND = 1.716e-5;
const T_REF_SUTHERLAND = 273.15;
const C_SUTHERLAND = 110.4;

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
        explanation_list_equip_intro: "Select equipment type for typical sensible heat factors:",
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
        import_csv_success: "Imported {count} appliance(s).",
        import_csv_no_data: "No valid appliance data found in CSV or failed to parse.",
        import_csv_error: "Failed to process CSV file. Please ensure it's correctly formatted.",
        import_csv_read_error: "Error reading file.",
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
        equip_type_fryer: "Fryer (General)", equip_type_grill: "Grill (General)", equip_type_range_top: "Range Top (General)",
        equip_type_oven: "Oven (General)", equip_type_steamer: "Steamer (General)",
        optgroup_fryers: "Fryers", optgroup_grills: "Grills & Griddles", optgroup_ranges: "Ranges & Hobs",
        optgroup_ovens: "Ovens", optgroup_steamers: "Steamers & Boilers", optgroup_holding: "Holding & Warming",
        optgroup_dishwashers: "Dishwashers", optgroup_other_equip: "Other Equipment",
        summary_title: "Calculation Summary",
        summary_total_sensible: "Total Sensible Heat Load:",
        summary_hood_factor: "Selected Hood Factor Range (k):",
        summary_airflow_label: "Estimated Airflow at Hood:",
        comparison_title: "Calculation Method Comparison",
        comparison_text_default: "Select a calculation method and enter data to see a comparison.",
        comparison_heat_load_active: "If estimated by Hood Dimensions (using current L/D & medium duty for Wall/Island): <strong>{dim_airflow} m³/h</strong>. Current Heat Load method: <strong>{heat_airflow_range} m³/h</strong>.",
        comparison_dimensions_active: "If estimated by Heat Load (using current appliances): <strong>{heat_airflow_range} m³/h</strong>. Current Dimensions method: <strong>{dim_airflow} m³/h</strong>.",
        comparison_no_dim_data: "Enter hood dimensions to see a dimensional estimate for comparison.",
        comparison_no_appliance_data: "Add appliances to see a heat load estimate for comparison.",
        comparison_eyebrow_dim_note: " (Eyebrow dimensional estimate based on entered L and APM).",
        comparison_disclaimer: "Note: This comparison is illustrative. The Heat Load method is generally more accurate for kitchen ventilation design when appliance data is available. The Hood Dimensions method provides a rough estimate.",
        pressure_title: "Duct System & Pressure Drop Estimation",
        pressure_manual_toggle_label: "Use Manual Airflow:",
        pressure_manual_input_label: "Manual Airflow (m³/h):",
        exhaust_air_temp_label: "Exhaust Air Temperature (°C):",
        pressure_note: "Note: Pressure drop calculation assumes standard atmospheric pressure unless altitude is specified. Filter loss must be entered accurately. This is a simplified estimate.",
        pressure_recom_duct: "Recommended Duct Diameter (Reference):",
        pressure_duct_mat_galv: "Galvanized Steel", pressure_duct_mat_stain: "Stainless Steel",
        pressure_duct_mat_pvc: "PVC", pressure_duct_mat_aluminum: "Aluminum",
        pressure_duct_mat_black_steel: "Black Carbon Steel", pressure_duct_mat_flex_metal: "Flexible Metal Duct",
        pressure_filter_label: "Filter Pressure Drop (Pa):",
        pressure_outlet_label: "Exhaust Outlet Type:",
        pressure_outlet_cap: "Weather Cap", pressure_outlet_louver: "Low Loss Louvre",
        pressure_outlet_screen: "Bird Screen Only", pressure_outlet_open: "Open Duct",
        pressure_outlet_vertical_stack: "Vertical Discharge Stack", pressure_outlet_gooseneck: "Gooseneck/Chinese Cap",
        pressure_velocity_label: "Calculated Air Velocity (1st Segment):",
        pressure_velocity_recom: "(Recommended: 7-12 m/s)",
        pressure_total_label: "Estimated Total Pressure Drop:",
        delete_button: "Delete", remove_button: "Remove",
        gas_unit_m3h: "m³/h", gas_unit_kgh: "kg/h",
        gas_type_natural: "G20/G25 (Natural Gas)", gas_type_propane: "G31 (Propane)", gas_type_butane: "G30 (Butane)",
        duct_system_layout_title: "Duct System Layout",
        add_duct_segment: "Add Duct Segment", add_fitting: "Add Fitting",
        ds_order: "Order", ds_type: "Element Type", ds_details_dimensions: "Details / Dimensions",
        ds_parameters: "Parameters (Length/Qty/Material)", ds_action: "Action",
        segment_type_segment: "Duct Segment", segment_type_fitting: "Fitting",
        segment_shape: "Shape:", segment_shape_round: "Round", segment_shape_rect: "Rectangular",
        segment_diameter: "Diameter (mm):", segment_width: "Width (mm):", segment_height: "Height (mm):",
        segment_material: "Material:", segment_length: "Length (m):",
        fitting_type: "Fitting Type:", fitting_quantity: "Quantity:",
        fitting_udiameter: "Upstream Dia. (mm):", fitting_ddiameter: "Downstream Dia. (mm):",
        fitting_uwidth: "Upstream W (mm):", fitting_uheight: "Upstream H (mm):",
        fitting_dwidth: "Downstream W (mm):", fitting_dheight: "Downstream H (mm):",
        fitting_ushape: "Upstream Shape:", fitting_dshape: "Downstream Shape:",
        fitting_elbow90_r_d_1_5: "Elbow 90° (R/D=1.5)", fitting_elbow90_r_d_1_0: "Elbow 90° (R/D=1.0, Short)",
        fitting_elbow90_r_d_2_0: "Elbow 90° (R/D=2.0, Long)", fitting_elbow90_mitred_novanes: "Elbow 90° (Mitred, no vanes)",
        fitting_elbow45_r_d_1_5: "Elbow 45° (R/D=1.5)",
        fitting_transition_sudden_contraction: "Sudden Contraction", fitting_transition_sudden_expansion: "Sudden Expansion",
        fitting_transition_gradual_contraction_30deg: "Gradual Contraction (~30°)", fitting_transition_gradual_expansion_15deg: "Gradual Expansion (~15°)",
        fitting_damper_butterfly_fully_open: "Damper (Butterfly, Open)", fitting_damper_butterfly_45deg: "Damper (Butterfly, 45°)",
        fitting_damper_gate_fully_open: "Damper (Gate, Open)",
        fitting_hood_entry_assumed: "Hood Entry Loss",
        option_placeholder_select: "Select...",
    },
    pt: { // Ensure all keys from 'en' are mirrored here with Portuguese translations
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
        explanation_p1_equip: "O \"Fator de Calor Sensível\" representa a fração aproximada da potência total de um equipamento que é libertada como calor sensível...",
        explanation_list_equip_intro: "Selecione o tipo de equipamento para fatores de calor sensível típicos:",
        explanation_title_outlet: "Tipo de Saída de Exaustão & Perda de Carga",
        explanation_p1_outlet: "O tipo de terminação na conduta de exaustão impacta significativamente a perda de carga...",
        explanation_list_outlet: [
            "<strong>Chapéu Chinês (K ≈ 1.0):</strong> Comum, resistência moderada.",
            "<strong>Grelha Baixa Perda (K ≈ 0.5):</strong> Projetada para menor resistência.",
            "<strong>Rede Anti-pássaro Apenas (K ≈ 0.7):</strong> Obstrução mínima.",
            "<strong>Conduta Aberta (K ≈ 0.0):</strong> Sem resistência da própria saída.",
            "<strong>Descarga Vertical Livre (K ≈ 0.05):</strong> Resistência mínima, boa dispersão.",
            "<strong>Pescoço de Ganso / Chapéu Tipo Chinês (K ≈ 2.0):</strong> Resistência elevada."
        ],
        explanation_title_velocity: "Velocidade do Ar na Conduta",
        explanation_p1_velocity: "Manter a velocidade do ar dentro de um intervalo recomendado (tipicamente 7-12 m/s) é importante:",
        explanation_list_velocity: [
            "<strong>Muito Baixa (&lt; 5-7 m/s):</strong> Partículas de gordura podem depositar-se...",
            "<strong>Muito Alta (> 12-15 m/s):</strong> Causa ruído excessivo...",
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
        import_csv_success: "Importados {count} equipamentos.",
        import_csv_no_data: "Não foram encontrados dados válidos de equipamentos no CSV ou falha ao processar.",
        import_csv_error: "Falha ao processar o ficheiro CSV. Por favor, garanta que está formatado corretamente.",
        import_csv_read_error: "Erro ao ler o ficheiro.",
        equip_type_fryer_open_pot: "Fritadeira de Cuba Aberta", equip_type_fryer_tube: "Fritadeira de Tubos", equip_type_fryer_pressure: "Fritadeira de Pressão",
        equip_type_grill_charbroiler_radiant: "Grelhador Carvão (Radiante)", equip_type_grill_charbroiler_lava: "Grelhador Carvão (Pedra Lávica)",
        equip_type_griddle_plate: "Chapa de Fritar", equip_type_grill_clam_shell: "Grelhador de Contacto",
        equip_type_range_open_burner_gas: "Fogão a Gás (Queimador Aberto)", equip_type_range_hot_top_electric: "Placa Elétrica Contínua",
        equip_type_range_induction: "Fogão de Indução", equip_type_wok_range_gas: "Fogão Wok a Gás",
        equip_type_oven_convection: "Forno de Convecção", equip_type_oven_deck: "Forno de Lastro",
        equip_type_oven_combi: "Forno Combinado (Geral)", equip_type_oven_pizza_conveyor: "Forno de Pizza (Tapete)",
        equip_type_oven_rotisserie: "Forno de Espeto Rotativo",
        equip_type_steamer_pressureless: "Panela a Vapor (Sem Pressão)", equip_type_steamer_pressure: "Panela a Vapor (Pressão)",
        equip_type_pasta_cooker: "Cozedor de Massas", equip_type_kettle_steam_jacketed: "Caldeira Encamisada a Vapor",
        equip_type_bain_marie: "Banho-Maria / Cuba Quente", equip_type_holding_cabinet_heated: "Armário de Manutenção Aquecido",
        equip_type_dishwasher_conveyor_hooded: "Máquina Lavar Loiça (Tapete, com Hotte)",
        equip_type_other: "Outro",
        equip_type_fryer: "Fritadeira (Geral)", equip_type_grill: "Grelhador (Geral)", equip_type_range_top: "Placa / Fogão (Geral)",
        equip_type_oven: "Forno (Geral)", equip_type_steamer: "Panela a Vapor (Geral)",
        optgroup_fryers: "Fritadeiras", optgroup_grills: "Grelhadores & Chapas", optgroup_ranges: "Fogões",
        optgroup_ovens: "Fornos", optgroup_steamers: "Panelas a Vapor & Caldeiras", optgroup_holding: "Manutenção e Aquecimento",
        optgroup_dishwashers: "Máquinas de Lavar Loiça", optgroup_other_equip: "Outros Equipamentos",
        summary_title: "Resumo do Cálculo",
        summary_total_sensible: "Carga Térmica Sensível Total:",
        summary_hood_factor: "Intervalo Fator Hotte (k):",
        summary_airflow_label: "Caudal Estimado na Hotte:",
        comparison_title: "Comparação de Métodos de Cálculo",
        comparison_text_default: "Selecione um método de cálculo e insira os dados para ver uma comparação.",
        comparison_heat_load_active: "Se estimado por Dimensões da Hotte (usando C/P atuais & carga média para Mural/Ilha): <strong>{dim_airflow} m³/h</strong>. Método Carga Térmica atual: <strong>{heat_airflow_range} m³/h</strong>.",
        comparison_dimensions_active: "Se estimado por Carga Térmica (usando equipamentos atuais): <strong>{heat_airflow_range} m³/h</strong>. Método Dimensões atual: <strong>{dim_airflow} m³/h</strong>.",
        comparison_no_dim_data: "Insira as dimensões da hotte para ver uma estimativa dimensional para comparação.",
        comparison_no_appliance_data: "Adicione equipamentos para ver uma estimativa por carga térmica para comparação.",
        comparison_eyebrow_dim_note: " (Estimativa dimensional de hotte compensada baseada em C e CPM inseridos).",
        comparison_disclaimer: "Nota: Esta comparação é ilustrativa. O método de Carga Térmica é geralmente mais preciso para o dimensionamento da ventilação de cozinhas quando os dados dos equipamentos estão disponíveis. O método por Dimensões da Hotte fornece uma estimativa aproximada.",
        pressure_title: "Sistema de Condutas & Estimativa de Perda de Carga",
        pressure_manual_toggle_label: "Usar Caudal Manual:",
        pressure_manual_input_label: "Caudal Manual (m³/h):",
        exhaust_air_temp_label: "Temperatura do Ar de Exaustão (°C):",
        pressure_note: "Nota: O cálculo da perda de carga assume pressão atmosférica normal ao nível do mar. A perda dos filtros deve ser inserida corretamente. Esta é uma estimativa simplificada.",
        pressure_recom_duct: "Diâmetro de Conduta Recomendado (Referência):",
        pressure_duct_mat_galv: "Aço Galvanizado", pressure_duct_mat_stain: "Aço Inoxidável",
        pressure_duct_mat_pvc: "PVC", pressure_duct_mat_aluminum: "Alumínio",
        pressure_duct_mat_black_steel: "Aço Carbono", pressure_duct_mat_flex_metal: "Conduta Flexível Metálica",
        pressure_filter_label: "Perda de Carga Filtro (Pa):",
        pressure_outlet_label: "Tipo Saída Exaustão:",
        pressure_outlet_cap: "Chapéu Chinês", pressure_outlet_louver: "Grelha Baixa Perda",
        pressure_outlet_screen: "Rede Anti-pássaro", pressure_outlet_open: "Conduta Aberta",
        pressure_outlet_vertical_stack: "Descarga Vertical Livre", pressure_outlet_gooseneck: "Pescoço de Ganso",
        pressure_velocity_label: "Velocidade do Ar Calculada (1º Troço):",
        pressure_velocity_recom: "(Recomendado: 7-12 m/s)",
        pressure_total_label: "Perda de Carga Total Estimada:",
        delete_button: "Eliminar", remove_button: "Remover",
        gas_unit_m3h: "m³/h", gas_unit_kgh: "kg/h",
        gas_type_natural: "G20/G25 (Gás Natural)", gas_type_propane: "G31 (Propano)", gas_type_butane: "G30 (Butano)",
        duct_system_layout_title: "Traçado do Sistema de Condutas",
        add_duct_segment: "Adicionar Troço de Conduta", add_fitting: "Adicionar Acessório",
        ds_order: "Ordem", ds_type: "Tipo Elemento", ds_details_dimensions: "Detalhes / Dimensões",
        ds_parameters: "Parâmetros (Comp./Qtd./Material)", ds_action: "Ação",
        segment_type_segment: "Troço de Conduta", segment_type_fitting: "Acessório",
        segment_shape: "Forma:", segment_shape_round: "Circular", segment_shape_rect: "Retangular",
        segment_diameter: "Diâmetro (mm):", segment_width: "Largura (mm):", segment_height: "Altura (mm):",
        segment_material: "Material:", segment_length: "Comprimento (m):",
        fitting_type: "Tipo Acessório:", fitting_quantity: "Quantidade:",
        fitting_udiameter: "Diâm. Montante (mm):", fitting_ddiameter: "Diâm. Jusante (mm):",
        fitting_uwidth: "Larg. Montante (mm):", fitting_uheight: "Alt. Montante (mm):",
        fitting_dwidth: "Larg. Jusante (mm):", fitting_dheight: "Alt. Jusante (mm):",
        fitting_ushape: "Forma Montante:", fitting_dshape: "Forma Jusante:",
        fitting_elbow90_r_d_1_5: "Curva 90° (R/D=1.5)", fitting_elbow90_r_d_1_0: "Curva 90° (R/D=1.0, Curta)",
        fitting_elbow90_r_d_2_0: "Curva 90° (R/D=2.0, Longa)", fitting_elbow90_mitred_novanes: "Curva 90° (Gomos, s/ guias)",
        fitting_elbow45_r_d_1_5: "Curva 45° (R/D=1.5)",
        fitting_transition_sudden_contraction: "Contração Brusca", fitting_transition_sudden_expansion: "Expansão Brusca",
        fitting_transition_gradual_contraction_30deg: "Contração Gradual (~30°)", fitting_transition_gradual_expansion_15deg: "Expansão Gradual (~15°)",
        fitting_damper_butterfly_fully_open: "Registo (Borboleta, Aberto)", fitting_damper_butterfly_45deg: "Registo (Borboleta, 45°)",
        fitting_damper_gate_fully_open: "Registo (Gaveta, Aberto)",
        fitting_hood_entry_assumed: "Perda Entrada na Hotte",
        option_placeholder_select: "Selecione...",
    }
};

// --- Global State Variables ---
let currentLang = 'pt';
let currentCalculationMethod = 'heatLoad';
let lastCalculatedAirflowLowM3H = 0;
let lastCalculatedAirflowHighM3H = 0;
let applianceDataForComparison = [];
let ductSystemLayout = [];
let nextDuctElementId = 0;

// --- DOM Element References ---
const langButtons = document.querySelectorAll('.lang-btn');
const calculationMethodRadios = document.querySelectorAll('input[name="calculationMethod"]');
const appliancesSection = document.getElementById('appliancesSection');
const hoodDimensionInputsSection = document.getElementById('hoodDimensionInputsSection');
const hoodTypeSelect = document.getElementById('hoodType');
const hoodLengthInput = document.getElementById('hoodLength');
const hoodDepthInput = document.getElementById('hoodDepth');
const cookingDutyLevelSelect = document.getElementById('cookingDutyLevel');
const eyebrowAirflowPerMeterInput = document.getElementById('eyebrowAirflowPerMeter');
const dimensionalInputs = document.querySelectorAll('.data-input-dim');
const hoodDepthWrapper = document.getElementById('hoodDepthWrapper');
const cookingDutyLevelWrapper = document.getElementById('cookingDutyLevelWrapper');
const eyebrowAirflowPerMeterWrapper = document.getElementById('eyebrowAirflowPerMeterWrapper');
const infoIcons = document.querySelectorAll('.info-icon');
const explanationSections = document.querySelectorAll('.explanation-section');
const closeExplanationBtns = document.querySelectorAll('.closeExplanationBtn');
const diversityFactorInput = document.getElementById('diversityFactor');
const tableBody = document.getElementById('applianceTableBody');
const addApplianceBtn = document.getElementById('addApplianceBtn');
const importCsvBtn = document.getElementById('importCsvBtn');
const csvFileInput = document.getElementById('csvFileInput');
const exportCsvBtn = document.getElementById('exportCsvBtn');
const totalSensibleHeatDisplay = document.getElementById('totalSensibleHeat');
const hoodFactorDisplay = document.getElementById('hoodFactorDisplay');
const estimatedAirflowDisplay = document.getElementById('estimatedAirflow');
const estimatedAirflowWrapper = document.getElementById('estimatedAirflowWrapper');
const totalSensibleHeatWrapper = document.getElementById('totalSensibleHeatWrapper');
const hoodFactorWrapper = document.getElementById('hoodFactorWrapper');
const comparisonTextDisplay = document.getElementById('comparisonText');
const manualAirflowToggle = document.getElementById('manualAirflowToggle');
const manualAirflowInputWrapper = document.getElementById('manualAirflowInputWrapper');
const manualAirflowInput = document.getElementById('manualAirflowInput');
const exhaustAirTempInput = document.getElementById('exhaustAirTemp');
const ductSystemTableBody = document.getElementById('ductSystemTableBody');
const addDuctSegmentBtn = document.getElementById('addDuctSegmentBtn');
const addFittingBtn = document.getElementById('addFittingBtn');
const recommendedDuctDisplay = document.getElementById('recommendedDuct');
const filterPressureDropInput = document.getElementById('filterPressureDrop');
const outletTypeSelect = document.getElementById('outletType');
const calculatedVelocityDisplay = document.getElementById('calculatedVelocity');
const estimatedPressureDropDisplay = document.getElementById('estimatedPressureDrop');
const pressureConfigInputs = document.querySelectorAll('.data-input-pressure-config');

// --- Utility Functions ---
function getAirProperties(temperatureCelsius) {
    const tempKelvin = temperatureCelsius + 273.15;
    const density = ATMOSPHERIC_PRESSURE_PA / (R_SPECIFIC_AIR * tempKelvin);
    const viscosity = MU_REF_SUTHERLAND * ((T_REF_SUTHERLAND + C_SUTHERLAND) / (tempKelvin + C_SUTHERLAND)) * Math.pow(tempKelvin / T_REF_SUTHERLAND, 1.5);
    return { density, viscosity };
}

// --- UI Update & Management Functions ---
function setLanguage(lang) {
    // ... (setLanguage function as provided in "Final Third", including calls to updateApplianceRowTranslations and updateDuctSystemRowTranslations)
    // Ensure translations object is complete for all keys used here.
    if (!translations[lang]) {
        console.warn(`Translations for language "${lang}" not found. Defaulting to 'en'.`);
        lang = 'en';
    }
    currentLang = lang;
    document.documentElement.lang = lang;

    document.querySelectorAll('[data-translate-key]').forEach(element => {
        const key = element.getAttribute('data-translate-key');
        const translation = translations[lang][key];

        if (translation != null) {
            if (key === 'disclaimer' || (element.innerHTML.includes('<strong>') && typeof translation === 'string' && translation.includes('<strong>'))) {
                element.innerHTML = translation;
            } else if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
                const placeholderKey = element.dataset.placeholderKey || key + '_placeholder';
                const titleKey = element.dataset.titleKey || key + '_title';
                if (element.placeholder && translations[lang][placeholderKey]) {
                    element.placeholder = translations[lang][placeholderKey];
                } else if (element.placeholder && typeof translation === 'string' && !key.startsWith('explanation_')) {
                     element.placeholder = translation;
                }
                if (element.title && translations[lang][titleKey]) {
                    element.title = translations[lang][titleKey];
                } else if (element.title && typeof translation === 'string' && !key.startsWith('explanation_')) {
                     element.title = translation;
                }
            } else if (element.tagName === 'OPTION') {
                const valueKey = `option_${element.parentElement.id}_${element.value}`;
                 if(translations[lang][valueKey]) {
                    element.textContent = translations[lang][valueKey];
                } else if (translations[lang][element.dataset.translateKey]) {
                    element.textContent = translations[lang][element.dataset.translateKey];
                }
                 else if (typeof translation === 'string'){ // Fallback to direct key only if it's simple string
                     element.textContent = translation;
                 }
            } else if (key.startsWith('explanation_list_') && Array.isArray(translation)) {
                const listElement = document.querySelector(`[data-translate-key="${key}"]`);
                if (listElement) {
                    listElement.innerHTML = translation.map(item => `<li>${item}</li>`).join('');
                }
            } else if (typeof translation === 'string') {
                element.textContent = translation;
            }
        } else if (key.startsWith('explanation_list_')) {
            const listElement = document.querySelector(`[data-translate-key="${key}"]`);
            if (listElement) {
                listElement.innerHTML = `<li>${translations[lang]?.list_unavailable || translations.en?.list_unavailable || "Content not available."}</li>`;
            }
        }
    });

    tableBody.querySelectorAll('.appliance-row').forEach(row => updateApplianceRowTranslations(row, lang));
    ductSystemTableBody.querySelectorAll('.duct-system-row').forEach(row => updateDuctSystemRowTranslations(row, lang));

    document.querySelectorAll('#outletType option').forEach(opt => {
        const key = `pressure_outlet_${opt.value}`;
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

    langButtons.forEach(btn => btn.classList.toggle('active', btn.getAttribute('data-lang') === lang));

    infoIcons.forEach(icon => {
        const targetSectionId = icon.getAttribute('data-target-section');
        let titleKey = '';
        if (targetSectionId === 'explanationSectionEquip') titleKey = 'explanation_title_equip';
        else if (targetSectionId === 'explanationSectionOutlet') titleKey = 'explanation_title_outlet';
        else if (targetSectionId === 'explanationSectionVelocity') titleKey = 'explanation_title_velocity';
        if (titleKey && translations[lang][titleKey]) icon.title = translations[lang][titleKey];
         else if (titleKey && translations.en[titleKey]) icon.title = translations.en[titleKey]; // Fallback to EN if current lang missing
    });

    performCalculations();
}

function updateApplianceRowTranslations(row, lang) {
    const equipSelect = row.querySelector('.equipment-type');
    if (equipSelect) {
        const currentEquipValue = equipSelect.value;
        equipSelect.innerHTML = '';

        const addOptionToSelect = (sel, value, textKey) => {
            const text = translations[lang][textKey] || value.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            const option = new Option(text, value);
            sel.add(option);
        };

        const equipOptgroups = {
            optgroup_fryers: ['fryer_open_pot', 'fryer_tube', 'fryer_pressure', 'fryer'],
            optgroup_grills: ['grill_charbroiler_radiant', 'grill_charbroiler_lava', 'griddle_plate', 'grill_clam_shell', 'grill'],
            optgroup_ranges: ['range_open_burner_gas', 'range_hot_top_electric', 'range_induction', 'wok_range_gas', 'range_top'],
            optgroup_ovens: ['oven_convection', 'oven_deck', 'oven_combi', 'oven_pizza_conveyor', 'oven_rotisserie', 'oven'],
            optgroup_steamers: ['steamer_pressureless', 'steamer_pressure', 'pasta_cooker', 'kettle_steam_jacketed', 'steamer'],
            optgroup_holding: ['bain_marie', 'holding_cabinet_heated'],
            optgroup_dishwashers: ['dishwasher_conveyor_hooded'],
            optgroup_other_equip: ['other']
        };

        for (const groupKey in equipOptgroups) {
            const optgroup = document.createElement('optgroup');
            optgroup.label = translations[lang][groupKey] || groupKey.replace('optgroup_', '').replace(/_/g, ' ');
            equipOptgroups[groupKey].forEach(equipKey => {
                if (SENSIBLE_FACTORS.hasOwnProperty(equipKey)) {
                    addOptionToSelect(optgroup, equipKey, `equip_type_${equipKey}`);
                }
            });
            equipSelect.appendChild(optgroup);
        }
        if (equipSelect.querySelector(`option[value="${currentEquipValue}"]`)) {
            equipSelect.value = currentEquipValue;
        } else if (equipOptgroups.optgroup_other_equip.length > 0 && SENSIBLE_FACTORS.hasOwnProperty(equipOptgroups.optgroup_other_equip[0])) {
            equipSelect.value = equipOptgroups.optgroup_other_equip[0];
        }
    }

    const gasSelect = row.querySelector('.gas-type');
    if (gasSelect) {
        const currentGasValue = gasSelect.value;
        gasSelect.innerHTML = `
            <option value="natural_pt">${translations[lang].gas_type_natural}</option>
            <option value="propane">${translations[lang].gas_type_propane}</option>
            <option value="butane">${translations[lang].gas_type_butane}</option>
        `;
        gasSelect.value = currentGasValue;
    }
    const unitSelect = row.querySelector('.gas-unit');
    if (unitSelect) {
        const currentUnitValue = unitSelect.value;
        unitSelect.innerHTML = `
            <option value="m3h">${translations[lang].gas_unit_m3h}</option>
            <option value="kgh">${translations[lang].gas_unit_kgh}</option>
        `;
        unitSelect.value = currentUnitValue;
    }
    const deleteBtn = row.querySelector('.delete-btn');
    if (deleteBtn) deleteBtn.textContent = translations[lang].delete_button;
    const nameInput = row.querySelector('.appliance-name');
    if (nameInput) nameInput.placeholder = translations[lang].th_appliance_name;
}

function updateDuctSystemRowTranslations(row, lang) {
    const typeCell = row.cells[1]; // Assuming type is the second cell
    if (row.classList.contains('duct-segment-row')) {
        typeCell.textContent = translations[lang].segment_type_segment;
    } else if (row.classList.contains('duct-fitting-row')) {
        typeCell.textContent = translations[lang].segment_type_fitting;
    }

    const shapeSelect = row.querySelector('.duct-shape-select');
    if (shapeSelect) {
        shapeSelect.querySelector('option[value="round"]').textContent = translations[lang].segment_shape_round;
        shapeSelect.querySelector('option[value="rectangular"]').textContent = translations[lang].segment_shape_rect;
    }
    const diameterLabel = row.querySelector('.duct-diameter-input')?.previousElementSibling;
    if(diameterLabel) diameterLabel.textContent = translations[lang].segment_diameter;
    // ... translate all other labels (width, height, length, material, fitting type, quantity, etc.)
    // For select options within the row (material, fitting type), repopulate them:
    const materialSelect = row.querySelector('.duct-material-select');
    if (materialSelect) {
        const currentMaterial = materialSelect.value;
        materialSelect.innerHTML = '';
        Object.keys(DUCT_ROUGHNESS).forEach(matKey => {
            const optionText = translations[lang][`pressure_duct_mat_${matKey}`] || matKey.replace(/_/g, ' ');
            materialSelect.add(new Option(optionText, matKey));
        });
        materialSelect.value = currentMaterial;
    }

    const fittingTypeSelect = row.querySelector('.fitting-type-select');
    if (fittingTypeSelect) {
        const currentFitting = fittingTypeSelect.value;
        const placeholderText = translations[lang].option_placeholder_select || "Select...";
        fittingTypeSelect.innerHTML = `<option value="">${placeholderText}</option>`;
        Object.keys(FITTING_K_FACTORS).forEach(fitKey => {
            if (fitKey !== 'hood_entry_assumed' && !fitKey.startsWith('outlet_')) {
                const optionText = translations[lang][`fitting_${fitKey}`] || fitKey.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                fittingTypeSelect.add(new Option(optionText, fitKey));
            }
        });
        fittingTypeSelect.value = currentFitting;
    }

    const removeBtn = row.querySelector('.remove-item-btn');
    if (removeBtn) removeBtn.textContent = translations[lang].remove_button;

     // Translate labels within the row by finding them (more robustly if they have specific classes or structure)
     const labelsToTranslate = {
        '.duct-shape-select': 'segment_shape',
        '.duct-diameter-input': 'segment_diameter',
        '.duct-width-input': 'segment_width',
        '.duct-height-input': 'segment_height',
        '.duct-length-input': 'segment_length',
        '.duct-material-select': 'segment_material',
        '.fitting-type-select': 'fitting_type',
        '.fitting-quantity-input': 'fitting_quantity',
        '.fitting-dshape-select': 'fitting_dshape', // Example, add actual keys
        '.fitting-ddiameter-input': 'fitting_ddiameter',
        '.fitting-dwidth-input': 'fitting_dwidth',
        '.fitting-dheight-input': 'fitting_dheight',

    };
    for (const selector in labelsToTranslate) {
        const inputElement = row.querySelector(selector);
        if (inputElement && inputElement.previousElementSibling && inputElement.previousElementSibling.tagName === 'LABEL') {
            const labelKey = labelsToTranslate[selector];
            const labelText = translations[lang][labelKey];
            if (labelText) {
                inputElement.previousElementSibling.textContent = labelText;
            }
        } else if (inputElement && inputElement.parentElement && inputElement.parentElement.firstChild && inputElement.parentElement.firstChild.tagName === 'LABEL'){
             const labelKey = labelsToTranslate[selector];
            const labelText = translations[lang][labelKey];
            if (labelText) {
                inputElement.parentElement.firstChild.textContent = labelText;
            }
        }
    }
}

function toggleGasUnitSelector(gasTypeSelectElement, gasUnitSelectElement) {
    const selectedGas = gasTypeSelectElement.value;
    const isLPG = selectedGas === 'propane' || selectedGas === 'butane';
    gasUnitSelectElement.style.display = isLPG ? 'inline-block' : 'none';
    if (isLPG && gasUnitSelectElement.value === 'm3h') gasUnitSelectElement.value = 'kgh';
    else if (!isLPG) gasUnitSelectElement.value = 'm3h';
}

function addApplianceRow(rowData = null) {
    // ... (addApplianceRow function as provided, ensuring it uses updateApplianceRowTranslations or has its own translation logic for new rows)
    const row = tableBody.insertRow();
    row.classList.add('appliance-row');
    const lang = currentLang;

    let equipmentOptionsHTML = '';
    const equipOptgroups = {
        optgroup_fryers: ['fryer_open_pot', 'fryer_tube', 'fryer_pressure', 'fryer'],
        optgroup_grills: ['grill_charbroiler_radiant', 'grill_charbroiler_lava', 'griddle_plate', 'grill_clam_shell', 'grill'],
        optgroup_ranges: ['range_open_burner_gas', 'range_hot_top_electric', 'range_induction', 'wok_range_gas', 'range_top'],
        optgroup_ovens: ['oven_convection', 'oven_deck', 'oven_combi', 'oven_pizza_conveyor', 'oven_rotisserie', 'oven'],
        optgroup_steamers: ['steamer_pressureless', 'steamer_pressure', 'pasta_cooker', 'kettle_steam_jacketed', 'steamer'],
        optgroup_holding: ['bain_marie', 'holding_cabinet_heated'],
        optgroup_dishwashers: ['dishwasher_conveyor_hooded'],
        optgroup_other_equip: ['other']
    };
    for (const groupKey in equipOptgroups) {
        const groupLabel = translations[lang][groupKey] || groupKey.replace('optgroup_', '').replace(/_/g, ' ');
        equipmentOptionsHTML += `<optgroup label="${groupLabel}">`;
        equipOptgroups[groupKey].forEach(equipKey => {
            if (SENSIBLE_FACTORS.hasOwnProperty(equipKey)) {
                const optionText = translations[lang][`equip_type_${equipKey}`] || equipKey.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                equipmentOptionsHTML += `<option value="${equipKey}">${optionText}</option>`;
            }
        });
        equipmentOptionsHTML += `</optgroup>`;
    }

    const inputClasses = "w-full p-2 border border-gray-300 rounded-md shadow-sm text-sm data-input"; // Tailwind classes
    row.innerHTML = `
        <td><input type="text" placeholder="${translations[lang].th_appliance_name}" class="${inputClasses} appliance-name"></td>
        <td><select class="${inputClasses} equipment-type">${equipmentOptionsHTML}</select></td>
        <td><select class="${inputClasses} gas-type"><option value="natural_pt">${translations[lang].gas_type_natural}</option><option value="propane">${translations[lang].gas_type_propane}</option><option value="butane">${translations[lang].gas_type_butane}</option></select></td>
        <td><input type="number" step="0.01" min="0" placeholder="0.0" class="${inputClasses} gas-usage"></td>
        <td><select class="${inputClasses} gas-unit-selector gas-unit" style="display: none;"><option value="m3h">${translations[lang].gas_unit_m3h}</option><option value="kgh">${translations[lang].gas_unit_kgh}</option></select></td>
        <td><input type="number" step="0.1" min="0" placeholder="0.0" class="${inputClasses} electric-usage"></td>
        <td><span class="calculated-value total-power">0.0 kW</span></td>
        <td><span class="calculated-value sensible-factor">0.0</span></td>
        <td><span class="calculated-value sensible-heat">0.0 kW</span></td>
        <td><button class="text-red-600 hover:text-red-800 delete-btn text-sm font-medium">${translations[lang].delete_button}</button></td>
    `;

    if (rowData) {
        row.querySelector('.appliance-name').value = rowData.name || '';
        row.querySelector('.equipment-type').value = rowData.equipValue || equipOptgroups.optgroup_other_equip[0];
        row.querySelector('.gas-type').value = rowData.gasTypeValue || 'natural_pt';
        row.querySelector('.gas-usage').value = rowData.gasUsage || '';
        row.querySelector('.gas-unit').value = rowData.gasUnitValue || 'm3h';
        row.querySelector('.electric-usage').value = rowData.electricUsage || '';
    }

    const newGasTypeSelect = row.querySelector('.gas-type');
    const newGasUnitSelect = row.querySelector('.gas-unit');
    toggleGasUnitSelector(newGasTypeSelect, newGasUnitSelect);
    newGasTypeSelect.addEventListener('change', () => {
        toggleGasUnitSelector(newGasTypeSelect, newGasUnitSelect);
        performCalculations();
    });

    row.querySelectorAll('.data-input, .equipment-type, .gas-unit').forEach(el => {
        el.addEventListener('change', performCalculations);
        if (el.tagName === 'INPUT' && el.type === 'number') el.addEventListener('input', performCalculations);
    });
    row.querySelector('.delete-btn').addEventListener('click', (e) => deleteApplianceRow(e.target.closest('tr')));

    if (!rowData) performCalculations();
}

function deleteApplianceRow(rowElement) {
    if (rowElement) {
        rowElement.remove();
        performCalculations();
    }
}

// --- Core Calculation Functions ---
function calculateAirflowByHeatLoad() { /* ... as provided ... */
    let totalSensibleHeat = 0;
    applianceDataForComparison = [];
    tableBody.querySelectorAll('.appliance-row').forEach(row => {
        const equipmentType = row.querySelector('.equipment-type').value;
        const gasType = row.querySelector('.gas-type').value;
        const gasUsage = parseFloat(row.querySelector('.gas-usage').value) || 0;
        const gasUnit = row.querySelector('.gas-unit').value;
        const electricUsage = parseFloat(row.querySelector('.electric-usage').value) || 0;
        let ncv = 0;
        if (gasType === 'natural_pt') ncv = NCV_VALUES.natural_pt_m3h;
        else if (gasType === 'propane') ncv = (gasUnit === 'kgh') ? NCV_VALUES.propane_kgh : NCV_VALUES.propane_m3h;
        else if (gasType === 'butane') ncv = (gasUnit === 'kgh') ? NCV_VALUES.butane_kgh : NCV_VALUES.butane_m3h;
        const gasPower = gasUsage * ncv;
        const totalPower = electricUsage + gasPower;
        const sensibleFactor = SENSIBLE_FACTORS[equipmentType] || SENSIBLE_FACTORS.other;
        const sensibleHeat = totalPower * sensibleFactor;
        row.querySelector('.total-power').textContent = `${totalPower.toFixed(1)} kW`;
        row.querySelector('.sensible-factor').textContent = sensibleFactor.toFixed(1);
        row.querySelector('.sensible-heat').textContent = `${sensibleHeat.toFixed(1)} kW`;
        totalSensibleHeat += sensibleHeat;
        applianceDataForComparison.push({ sensibleHeat });
    });
    const diversity = parseFloat(diversityFactorInput.value) || 1.0;
    totalSensibleHeat *= diversity;
    totalSensibleHeatDisplay.textContent = `${totalSensibleHeat.toFixed(1)} kW`;
    const selectedHoodType = hoodTypeSelect.value;
    const hoodFactorRange = HOOD_FACTORS[selectedHoodType] || { low: 0, high: 0 };
    hoodFactorDisplay.textContent = `${hoodFactorRange.low}-${hoodFactorRange.high} (m³/h)/kW`;
    const airflowLow = totalSensibleHeat * hoodFactorRange.low;
    const airflowHigh = totalSensibleHeat * hoodFactorRange.high;
    return { airflowLow, airflowHigh, totalSensibleHeat };
}

function calculateAirflowByDimensions() { /* ... as provided ... */
    const length = parseFloat(hoodLengthInput.value) || 0;
    const depth = parseFloat(hoodDepthInput.value) || 0;
    const duty = cookingDutyLevelSelect.value;
    const selectedHoodType = hoodTypeSelect.value;
    const apm = parseFloat(eyebrowAirflowPerMeterInput.value) || 0;
    let airflow = 0;
    if (selectedHoodType === 'eyebrow') {
        if (length > 0 && apm > 0) airflow = length * apm;
    } else {
        const faceVelocity = DIMENSIONAL_FACE_VELOCITIES_MS[duty] || DIMENSIONAL_FACE_VELOCITIES_MS.medium;
        if (length > 0 && depth > 0) airflow = length * depth * faceVelocity * 3600;
    }
    return { airflowLow: airflow, airflowHigh: airflow, totalSensibleHeat: 0 };
}

function performCalculations() { /* ... as provided ... */
    try {
        let results = { airflowLow: 0, airflowHigh: 0, totalSensibleHeat: 0 };
        if (currentCalculationMethod === 'heatLoad') {
            results = calculateAirflowByHeatLoad();
            totalSensibleHeatWrapper.style.display = 'block';
            hoodFactorWrapper.style.display = 'block';
        } else {
            results = calculateAirflowByDimensions();
            totalSensibleHeatWrapper.style.display = 'none';
            hoodFactorWrapper.style.display = 'none';
        }
        lastCalculatedAirflowLowM3H = results.airflowLow;
        lastCalculatedAirflowHighM3H = results.airflowHigh;
        if (results.airflowLow === results.airflowHigh) {
             estimatedAirflowDisplay.textContent = `${results.airflowHigh.toFixed(0)} m³/h`;
        } else {
             estimatedAirflowDisplay.textContent = `${results.airflowLow.toFixed(0)} - ${results.airflowHigh.toFixed(0)} m³/h`;
        }
        let airflowForPressureCalc = lastCalculatedAirflowHighM3H;
        if (manualAirflowToggle.checked) {
            airflowForPressureCalc = parseFloat(manualAirflowInput.value) || lastCalculatedAirflowHighM3H;
        }
        const recommendedDiameter = calculateRecommendedDuct(airflowForPressureCalc);
        recommendedDuctDisplay.textContent = `${recommendedDiameter} mm`;
        const firstSegmentRow = ductSystemTableBody.querySelector('.duct-segment-row');
        if (firstSegmentRow && !manualAirflowToggle.checked) { // Removed currentCalculationMethod !== 'manual' as manualAirflowToggle is the primary check
            const shapeSelect = firstSegmentRow.querySelector('.duct-shape-select');
            if (shapeSelect && shapeSelect.value === 'round') {
                const diameterInput = firstSegmentRow.querySelector('.duct-diameter-input');
                if (diameterInput && !diameterInput.value && recommendedDiameter > 0) {
                    diameterInput.value = recommendedDiameter;
                    // Update the layout array too
                    const segmentId = firstSegmentRow.dataset.id;
                    const segment = ductSystemLayout.find(s => s.id === segmentId);
                    if(segment) segment.diameter = recommendedDiameter;
                }
            }
        }
        updateComparisonText();
        calculatePressureDrop();
    } catch (error) {
        console.error("Error during performCalculations:", error);
        estimatedAirflowDisplay.textContent = "Error";
    }
}

function updateComparisonText() { /* ... as provided ... */
    let comparisonKey = "comparison_text_default";
    let heatLoadAirflowForComparisonRange = "0 - 0";
    let dimAirflowForComparison = 0;
    const lang = currentLang;
    const heatLoadResultsForComparison = calculateAirflowByHeatLoad();
    heatLoadAirflowForComparisonRange = `${heatLoadResultsForComparison.airflowLow.toFixed(0)} - ${heatLoadResultsForComparison.airflowHigh.toFixed(0)}`;
    const appliancesPresent = tableBody.querySelectorAll('.appliance-row').length > 0 && heatLoadResultsForComparison.totalSensibleHeat > 0;
    const dimResultsForComparison = calculateAirflowByDimensions();
    dimAirflowForComparison = dimResultsForComparison.airflowHigh;
    const dimensionsEntered = (hoodTypeSelect.value === 'eyebrow' && (parseFloat(hoodLengthInput.value) > 0 && parseFloat(eyebrowAirflowPerMeterInput.value) > 0)) ||
                              (hoodTypeSelect.value !== 'eyebrow' && (parseFloat(hoodLengthInput.value) > 0 && parseFloat(hoodDepthInput.value) > 0));
    if (currentCalculationMethod === 'heatLoad') {
        if (!appliancesPresent) comparisonKey = "comparison_no_appliance_data";
        else if (!dimensionsEntered) comparisonKey = "comparison_no_dim_data";
        else comparisonKey = "comparison_heat_load_active";
    } else {
        if (!dimensionsEntered) comparisonKey = "comparison_no_dim_data";
        else if (!appliancesPresent) comparisonKey = "comparison_no_appliance_data";
        else comparisonKey = "comparison_dimensions_active";
    }
    let text = translations[lang][comparisonKey] || "";
    text = text.replace('{dim_airflow}', dimAirflowForComparison.toFixed(0));
    text = text.replace('{heat_airflow_range}', heatLoadAirflowForComparisonRange);
    if (dimensionsEntered && hoodTypeSelect.value === 'eyebrow' && (comparisonKey === "comparison_heat_load_active" || comparisonKey === "comparison_dimensions_active")) {
        text += (translations[lang].comparison_eyebrow_dim_note || "");
    }
    comparisonTextDisplay.innerHTML = text;
}

function calculateRecommendedDuct(airflowM3H) { /* ... as provided ... */
    if (airflowM3H <= 0) return 0;
    const airflowM3S = airflowM3H / 3600;
    const requiredAreaM2 = airflowM3S / TARGET_VELOCITY_MS;
    const calculatedDiameterM = Math.sqrt((4 * requiredAreaM2) / Math.PI);
    const calculatedDiameterMM = calculatedDiameterM * 1000;
    const recommendedSize = STANDARD_DUCT_SIZES_MM.find(size => size >= calculatedDiameterMM);
    return recommendedSize || STANDARD_DUCT_SIZES_MM[STANDARD_DUCT_SIZES_MM.length - 1];
}

// --- UI Toggling Functions ---
function toggleCalculationMethodView() { /* ... as provided ... */
    if (currentCalculationMethod === 'heatLoad') {
        appliancesSection.style.display = 'block';
        hoodDimensionInputsSection.style.display = 'none';
        totalSensibleHeatWrapper.style.display = 'block';
        hoodFactorWrapper.style.display = 'block';
    } else {
        appliancesSection.style.display = 'none';
        hoodDimensionInputsSection.style.display = 'block';
        totalSensibleHeatWrapper.style.display = 'none';
        hoodFactorWrapper.style.display = 'none';
        toggleDimensionalInputsBasedOnHoodType();
    }
}

function toggleDimensionalInputsBasedOnHoodType() { /* ... as provided ... */
    const selectedHoodType = hoodTypeSelect.value;
    if (selectedHoodType === 'eyebrow') {
        hoodDepthWrapper.style.display = 'none';
        cookingDutyLevelWrapper.style.display = 'none';
        eyebrowAirflowPerMeterWrapper.style.display = 'block';
    } else {
        hoodDepthWrapper.style.display = 'block';
        cookingDutyLevelWrapper.style.display = 'block';
        eyebrowAirflowPerMeterWrapper.style.display = 'none';
    }
}

// --- Duct System Layout UI Functions ---
function addDuctSegmentRowUI() { /* ... as provided ... */
    const segmentId = `el-${nextDuctElementId++}`;
    const defaultDiameter = calculateRecommendedDuct(lastCalculatedAirflowHighM3H) || 200;
    const newSegment = {
        id: segmentId, type: 'segment',
        length: 1, shape: 'round', diameter: defaultDiameter,
        width: defaultDiameter > 200 ? defaultDiameter : 300,
        height: defaultDiameter > 200 ? Math.round(defaultDiameter * 0.75 / 10) * 10 : 200, // Rounded to nearest 10
        material: 'galvanized'
    };
    ductSystemLayout.push(newSegment);
    const row = ductSystemTableBody.insertRow();
    row.classList.add('duct-system-row', 'duct-segment-row');
    row.setAttribute('data-id', segmentId);
    const orderCell = row.insertCell();
    const typeCell = row.insertCell();
    typeCell.textContent = translations[currentLang].segment_type_segment;
    const detailsCell = row.insertCell(); detailsCell.classList.add('space-y-1');
    const shapeSelect = document.createElement('select');
    shapeSelect.className = 'duct-shape-select w-full p-1 border border-gray-300 rounded-md shadow-sm text-xs data-duct-input';
    shapeSelect.innerHTML = `<option value="round">${translations[currentLang].segment_shape_round}</option><option value="rectangular">${translations[currentLang].segment_shape_rect}</option>`;
    shapeSelect.value = newSegment.shape;
    const shapeWrapper = document.createElement('div'); shapeWrapper.innerHTML = `<label class="text-xs font-medium">${translations[currentLang].segment_shape}</label>`; shapeWrapper.appendChild(shapeSelect); detailsCell.appendChild(shapeWrapper);
    const diameterInput = document.createElement('input'); diameterInput.type = 'number'; diameterInput.min = 50; diameterInput.step = 10; diameterInput.value = newSegment.diameter; diameterInput.className = 'duct-diameter-input w-full p-1 border border-gray-300 rounded-md shadow-sm text-xs data-duct-input';
    const diameterWrapper = document.createElement('div'); diameterWrapper.innerHTML = `<label class="text-xs font-medium">${translations[currentLang].segment_diameter}</label>`; diameterWrapper.appendChild(diameterInput); detailsCell.appendChild(diameterWrapper);
    const rectDimWrapper = document.createElement('div'); rectDimWrapper.className = 'rect-dimensions-wrapper space-y-1';
    const widthInput = document.createElement('input'); widthInput.type = 'number'; widthInput.min = 50; widthInput.step = 10; widthInput.value = newSegment.width; widthInput.className = 'duct-width-input w-full p-1 border border-gray-300 rounded-md shadow-sm text-xs data-duct-input';
    const widthWrapper = document.createElement('div'); widthWrapper.innerHTML = `<label class="text-xs font-medium">${translations[currentLang].segment_width}</label>`; widthWrapper.appendChild(widthInput); rectDimWrapper.appendChild(widthWrapper);
    const heightInput = document.createElement('input'); heightInput.type = 'number'; heightInput.min = 50; heightInput.step = 10; heightInput.value = newSegment.height; heightInput.className = 'duct-height-input w-full p-1 border border-gray-300 rounded-md shadow-sm text-xs data-duct-input';
    const heightWrapper = document.createElement('div'); heightWrapper.innerHTML = `<label class="text-xs font-medium">${translations[currentLang].segment_height}</label>`; heightWrapper.appendChild(heightInput); rectDimWrapper.appendChild(heightWrapper); detailsCell.appendChild(rectDimWrapper);
    const toggleSegmentInputs = (shape) => { diameterWrapper.style.display = shape === 'round' ? 'block' : 'none'; rectDimWrapper.style.display = shape === 'rectangular' ? 'block' : 'none'; const segment = ductSystemLayout.find(s => s.id === segmentId); if (segment) { segment.shape = shape; } performCalculations(); };
    shapeSelect.addEventListener('change', (e) => toggleSegmentInputs(e.target.value)); toggleSegmentInputs(newSegment.shape);
    const paramsCell = row.insertCell(); paramsCell.classList.add('space-y-1');
    const lengthInput = document.createElement('input'); lengthInput.type = 'number'; lengthInput.min = 0.1; lengthInput.step = 0.1; lengthInput.value = newSegment.length; lengthInput.className = 'duct-length-input w-full p-1 border border-gray-300 rounded-md shadow-sm text-xs data-duct-input';
    const lengthWrapper = document.createElement('div'); lengthWrapper.innerHTML = `<label class="text-xs font-medium">${translations[currentLang].segment_length}</label>`; lengthWrapper.appendChild(lengthInput); paramsCell.appendChild(lengthWrapper);
    const materialSelect = document.createElement('select'); materialSelect.className = 'duct-material-select w-full p-1 border border-gray-300 rounded-md shadow-sm text-xs data-duct-input';
    Object.keys(DUCT_ROUGHNESS).forEach(matKey => { const optionText = translations[currentLang][`pressure_duct_mat_${matKey}`] || matKey.replace(/_/g, ' '); materialSelect.add(new Option(optionText, matKey)); });
    materialSelect.value = newSegment.material; const materialWrapper = document.createElement('div'); materialWrapper.innerHTML = `<label class="text-xs font-medium">${translations[currentLang].segment_material}</label>`; materialWrapper.appendChild(materialSelect); paramsCell.appendChild(materialWrapper);
    const actionCell = row.insertCell(); const removeBtn = document.createElement('button'); removeBtn.className = 'text-red-600 hover:text-red-800 remove-item-btn text-sm p-1'; removeBtn.textContent = translations[currentLang].remove_button; removeBtn.onclick = () => deleteDuctSystemRow(segmentId); actionCell.appendChild(removeBtn);
    [diameterInput, widthInput, heightInput, lengthInput, materialSelect, shapeSelect].forEach(inputEl => {
        inputEl.addEventListener('change', () => {
            const segment = ductSystemLayout.find(s => s.id === segmentId);
            if (segment) {
                segment.length = parseFloat(lengthInput.value); segment.shape = shapeSelect.value;
                segment.diameter = parseFloat(diameterInput.value); segment.width = parseFloat(widthInput.value);
                segment.height = parseFloat(heightInput.value); segment.material = materialSelect.value;
                performCalculations();
            }
        });
    });
    updateDuctSystemRowOrder(); updateDuctSystemRowTranslations(row, currentLang); performCalculations();
}

function addFittingRowUI() { /* ... as provided, ensure detailed input handling for transitions ... */
    const fittingId = `el-${nextDuctElementId++}`;
    let defaultUpstreamShape = 'round', defaultUpstreamD = 200, defaultUpstreamW = 300, defaultUpstreamH = 200;
    if (ductSystemLayout.length > 0) {
        const prevEl = ductSystemLayout[ductSystemLayout.length - 1];
        defaultUpstreamShape = prevEl.shape_downstream || prevEl.shape; // Use downstream shape of previous fitting, or shape of segment
        if (defaultUpstreamShape === 'round') defaultUpstreamD = prevEl.d_downstream || prevEl.diameter;
        else { defaultUpstreamW = prevEl.w_downstream || prevEl.width; defaultUpstreamH = prevEl.h_downstream || prevEl.height;}
    }
    const newFitting = {
        id: fittingId, type: 'fitting', fittingKey: '', quantity: 1,
        shape_upstream: defaultUpstreamShape, d_upstream: defaultUpstreamD, w_upstream: defaultUpstreamW, h_upstream: defaultUpstreamH,
        shape_downstream: defaultUpstreamShape, d_downstream: defaultUpstreamD, w_downstream: defaultUpstreamW, h_downstream: defaultUpstreamH,
    };
    ductSystemLayout.push(newFitting);
    const row = ductSystemTableBody.insertRow(); row.classList.add('duct-system-row', 'duct-fitting-row'); row.setAttribute('data-id', fittingId);
    row.insertCell(); row.insertCell().textContent = translations[currentLang].segment_type_fitting;
    const detailsCell = row.insertCell(); detailsCell.classList.add('space-y-1');
    const paramsCell = row.insertCell(); paramsCell.classList.add('space-y-1');
    const actionCell = row.insertCell();
    const fittingTypeSelect = document.createElement('select'); fittingTypeSelect.className = 'fitting-type-select w-full p-1 border border-gray-300 rounded-md shadow-sm text-xs data-duct-input';
    fittingTypeSelect.innerHTML = `<option value="">${translations[currentLang].option_placeholder_select}</option>`;
    Object.keys(FITTING_K_FACTORS).forEach(fitKey => { if (fitKey !== 'hood_entry_assumed' && !fitKey.startsWith('outlet_')) { const optText = translations[currentLang][`fitting_${fitKey}`] || fitKey.replace(/_/g, ' '); fittingTypeSelect.add(new Option(optText, fitKey)); }});
    const ftWrapper = document.createElement('div'); ftWrapper.innerHTML = `<label class="text-xs font-medium">${translations[currentLang].fitting_type}</label>`; ftWrapper.appendChild(fittingTypeSelect); detailsCell.appendChild(ftWrapper);

    const transitionInputsWrapper = document.createElement('div'); transitionInputsWrapper.className = 'transition-inputs-wrapper hidden space-y-1 mt-1';
    // Upstream display (read-only for user, reflects previous element's exit)
    const usDisplay = document.createElement('div'); usDisplay.className = 'text-xs p-1 bg-gray-100 rounded';
    transitionInputsWrapper.appendChild(usDisplay);

    const dsShapeSelect = document.createElement('select'); dsShapeSelect.className = 'fitting-dshape-select w-full p-1 border text-xs data-duct-input'; dsShapeSelect.innerHTML = `<option value="round">${translations[currentLang].segment_shape_round}</option><option value="rectangular">${translations[currentLang].segment_shape_rect}</option>`;
    const dsShapeWrapper = document.createElement('div'); dsShapeWrapper.innerHTML = `<label class="text-xs">${translations[currentLang].fitting_dshape}</label>`; dsShapeWrapper.appendChild(dsShapeSelect); transitionInputsWrapper.appendChild(dsShapeWrapper);
    const dsDiameterInput = document.createElement('input'); dsDiameterInput.type = 'number'; dsDiameterInput.className = 'fitting-ddiameter-input w-full p-1 border text-xs data-duct-input';
    const dsDiameterWrapper = document.createElement('div'); dsDiameterWrapper.innerHTML = `<label class="text-xs">${translations[currentLang].fitting_ddiameter}</label>`; dsDiameterWrapper.appendChild(dsDiameterInput); transitionInputsWrapper.appendChild(dsDiameterWrapper);
    const dsRectWrapper = document.createElement('div'); dsRectWrapper.className = 'hidden space-y-1';
    const dsWidthInput = document.createElement('input'); dsWidthInput.type = 'number'; dsWidthInput.className='fitting-dwidth-input w-full p-1 border text-xs data-duct-input';
    const dsHeightInput = document.createElement('input'); dsHeightInput.type = 'number'; dsHeightInput.className='fitting-dheight-input w-full p-1 border text-xs data-duct-input';
    const dsWidthWrapper = document.createElement('div'); dsWidthWrapper.innerHTML = `<label class="text-xs">${translations[currentLang].fitting_dwidth}</label>`; dsWidthWrapper.appendChild(dsWidthInput); dsRectWrapper.appendChild(dsWidthWrapper);
    const dsHeightWrapper = document.createElement('div'); dsHeightWrapper.innerHTML = `<label class="text-xs">${translations[currentLang].fitting_dheight}</label>`; dsHeightWrapper.appendChild(dsHeightInput); dsRectWrapper.appendChild(dsHeightWrapper);
    transitionInputsWrapper.appendChild(dsRectWrapper);
    detailsCell.appendChild(transitionInputsWrapper);

    const updateTransitionUpstreamDisplay = () => {
        const fitting = ductSystemLayout.find(f => f.id === fittingId);
        if (!fitting) return;
        let usText = `${translations[currentLang].fitting_ushape} ${translations[currentLang]['segment_shape_' + fitting.shape_upstream] || fitting.shape_upstream}, `;
        if (fitting.shape_upstream === 'round') usText += `${translations[currentLang].segment_diameter} ${fitting.d_upstream || 'N/A'}`;
        else usText += `${translations[currentLang].segment_width} ${fitting.w_upstream || 'N/A'}, ${translations[currentLang].segment_height} ${fitting.h_upstream || 'N/A'}`;
        usDisplay.textContent = usText;
    };

    const toggleTransitionInputsUI = (shape) => {
        dsDiameterWrapper.style.display = shape === 'round' ? 'block' : 'none';
        dsRectWrapper.style.display = shape === 'rectangular' ? 'block' : 'none';
    };
    fittingTypeSelect.addEventListener('change', (e) => {
        const selectedKey = e.target.value; const fitting = ductSystemLayout.find(f => f.id === fittingId);
        if (fitting) fitting.fittingKey = selectedKey;
        const isTransition = selectedKey.includes('transition');
        transitionInputsWrapper.classList.toggle('hidden', !isTransition);
        quantityWrapper.style.display = isTransition ? 'none' : 'block';
        if (isTransition && fitting) {
            fitting.quantity = 1; quantityInput.value = 1;
            dsShapeSelect.value = fitting.shape_downstream; toggleTransitionInputsUI(fitting.shape_downstream);
            dsDiameterInput.value = fitting.d_downstream || ''; dsWidthInput.value = fitting.w_downstream || ''; dsHeightInput.value = fitting.h_downstream || '';
            updateTransitionUpstreamDisplay();
        } performCalculations();
    });
    dsShapeSelect.addEventListener('change', (e) => { const fitting = ductSystemLayout.find(f => f.id === fittingId); if (fitting) fitting.shape_downstream = e.target.value; toggleTransitionInputsUI(e.target.value); performCalculations(); });
    [dsDiameterInput, dsWidthInput, dsHeightInput].forEach(input => input.addEventListener('change', (e) => {
        const fitting = ductSystemLayout.find(f => f.id === fittingId); if (!fitting) return;
        if (e.target.classList.contains('fitting-ddiameter-input')) fitting.d_downstream = parseFloat(e.target.value);
        else if (e.target.classList.contains('fitting-dwidth-input')) fitting.w_downstream = parseFloat(e.target.value);
        else if (e.target.classList.contains('fitting-dheight-input')) fitting.h_downstream = parseFloat(e.target.value);
        performCalculations();
    }));
    const quantityInput = document.createElement('input'); quantityInput.type = 'number'; quantityInput.min = 1; quantityInput.step = 1; quantityInput.value = newFitting.quantity; quantityInput.className = 'fitting-quantity-input w-full p-1 border text-xs data-duct-input';
    const quantityWrapper = document.createElement('div'); quantityWrapper.innerHTML = `<label class="text-xs font-medium">${translations[currentLang].fitting_quantity}</label>`; quantityWrapper.appendChild(quantityInput); paramsCell.appendChild(quantityWrapper);
    quantityInput.addEventListener('change', (e) => { const fitting = ductSystemLayout.find(f => f.id === fittingId); if (fitting) fitting.quantity = parseInt(e.target.value); performCalculations(); });
    const removeBtn = document.createElement('button'); removeBtn.className = 'text-red-600 hover:text-red-800 remove-item-btn text-sm p-1'; removeBtn.textContent = translations[currentLang].remove_button; removeBtn.onclick = () => deleteDuctSystemRow(fittingId); actionCell.appendChild(removeBtn);
    // Initial state after row creation
    toggleTransitionInputsUI(newFitting.shape_downstream);
    if(newFitting.fittingKey) { fittingTypeSelect.value = newFitting.fittingKey; fittingTypeSelect.dispatchEvent(new Event('change'));} // Trigger change to show/hide fields
    updateDuctSystemRowOrder(); updateDuctSystemRowTranslations(row, currentLang); performCalculations();
}

function deleteDuctSystemRow(elementId) { /* ... as provided ... */
    ductSystemLayout = ductSystemLayout.filter(el => el.id !== elementId);
    const rowToRemove = ductSystemTableBody.querySelector(`[data-id="${elementId}"]`);
    if (rowToRemove) rowToRemove.remove();
    updateDuctSystemRowOrder();
    performCalculations();
}

function updateDuctSystemRowOrder() { /* ... as provided ... */
    const rows = ductSystemTableBody.querySelectorAll('.duct-system-row');
    rows.forEach((row, index) => {
        const orderCell = row.cells[0];
        if (orderCell) orderCell.textContent = index + 1;
    });
}

// --- Pressure Drop Calculation (Rewritten) ---
function calculatePressureDrop() { /* ... as provided in "Final Third", ensure all references to element properties are correct ... */
    try {
        let airflowM3H = manualAirflowToggle.checked ? (parseFloat(manualAirflowInput.value) || 0) : lastCalculatedAirflowHighM3H;
        if (airflowM3H <= 0) {
            calculatedVelocityDisplay.textContent = `0.0 m/s`;
            estimatedPressureDropDisplay.textContent = `0 Pa`;
            return;
        }
        const airflowM3S = airflowM3H / 3600;
        const exhaustTempC = parseFloat(exhaustAirTempInput.value) || 20;
        const airProps = getAirProperties(exhaustTempC);
        let totalPressureDropPa = 0;
        let currentEffectiveAreaM2 = null; let firstSegmentVelocityDone = false;

        ductSystemLayout.forEach((element) => {
            if (element.type === 'segment') {
                const lengthM = parseFloat(element.length) || 0;
                const material = element.material || 'galvanized';
                const roughness = DUCT_ROUGHNESS[material] || DUCT_ROUGHNESS.galvanized;
                let areaM2, hydraulicDiameterM;
                if (element.shape === 'rectangular') {
                    const widthM = (parseFloat(element.width) || 0) / 1000; const heightM = (parseFloat(element.height) || 0) / 1000;
                    if (widthM <= 0 || heightM <= 0) return; areaM2 = widthM * heightM; hydraulicDiameterM = (2 * widthM * heightM) / (widthM + heightM);
                } else {
                    const diameterM = (parseFloat(element.diameter) || 0) / 1000; if (diameterM <= 0) return; areaM2 = Math.PI * Math.pow(diameterM / 2, 2); hydraulicDiameterM = diameterM;
                }
                currentEffectiveAreaM2 = areaM2;
                const velocityMs = airflowM3S / areaM2;
                if (!firstSegmentVelocityDone) { calculatedVelocityDisplay.textContent = `${velocityMs.toFixed(1)} m/s`; firstSegmentVelocityDone = true; }
                const P_dyn = (airProps.density * Math.pow(velocityMs, 2)) / 2;
                const Re = (airProps.density * velocityMs * hydraulicDiameterM) / airProps.viscosity;
                let frictionFactor = 0;
                if (Re > 4000) { const t1=(roughness/(3.7*hydraulicDiameterM)), t2=6.9/Re; frictionFactor=Math.pow(-1.8*Math.log10(Math.pow(t1,1.11)+t2),-2); }
                else if (Re > 0 && Re <= 2300) frictionFactor = 64 / Re;
                else if (Re > 2300 && Re <= 4000) { const t1=(roughness/(3.7*hydraulicDiameterM)), t2=6.9/Re; frictionFactor=Math.pow(-1.8*Math.log10(Math.pow(t1,1.11)+t2),-2); } // Approx.
                if (hydraulicDiameterM > 0 && lengthM > 0) totalPressureDropPa += frictionFactor * (lengthM / hydraulicDiameterM) * P_dyn;
            } else if (element.type === 'fitting') {
                const quantity = parseInt(element.quantity) || 1;
                let K_fitting = 0; let P_dyn_fitting = 0; let A_up = 0, A_down = 0;

                // Determine upstream area for this fitting (based on element's own upstream properties)
                if (element.shape_upstream === 'round') A_up = Math.PI * Math.pow((parseFloat(element.d_upstream)||0) / 2000, 2);
                else A_up = ((parseFloat(element.w_upstream)||0)/1000) * ((parseFloat(element.h_upstream)||0)/1000);

                if (A_up > 0) { const V_up = airflowM3S / A_up; P_dyn_fitting = (airProps.density * Math.pow(V_up, 2)) / 2; }

                if (element.fittingKey.includes('transition')) {
                    if (element.shape_downstream === 'round') A_down = Math.PI * Math.pow((parseFloat(element.d_downstream)||0) / 2000, 2);
                    else A_down = ((parseFloat(element.w_downstream)||0)/1000) * ((parseFloat(element.h_downstream)||0)/1000);
                    if (typeof FITTING_K_FACTORS[element.fittingKey] === 'function') K_fitting = FITTING_K_FACTORS[element.fittingKey](A_up, A_down);
                    else K_fitting = FITTING_K_FACTORS[element.fittingKey] || 0;
                    currentEffectiveAreaM2 = A_down > 0 ? A_down : A_up; // Update current area to downstream of transition
                } else {
                    K_fitting = FITTING_K_FACTORS[element.fittingKey] || 0;
                     // For non-transitions, currentEffectiveAreaM2 remains A_up (area does not change through fitting)
                     currentEffectiveAreaM2 = A_up > 0 ? A_up : currentEffectiveAreaM2;
                }
                totalPressureDropPa += quantity * K_fitting * P_dyn_fitting;
            }
        });
        // Add Hood Entry Loss (based on the first segment's properties)
        if (ductSystemLayout.length > 0 && ductSystemLayout[0].type === 'segment') {
            const firstSegment = ductSystemLayout[0]; let firstSegArea, V_first, Pd_first;
            if (firstSegment.shape === 'round') firstSegArea = Math.PI * Math.pow((parseFloat(firstSegment.diameter)||0)/2000, 2);
            else firstSegArea = ((parseFloat(firstSegment.width)||0)/1000) * ((parseFloat(firstSegment.height)||0)/1000);
            if (firstSegArea > 0) { V_first = airflowM3S / firstSegArea; Pd_first = (airProps.density * Math.pow(V_first, 2)) / 2; totalPressureDropPa += (FITTING_K_FACTORS.hood_entry_assumed || 0.5) * Pd_first; }
        }
        totalPressureDropPa += parseFloat(filterPressureDropInput.value) || 0; // Filter
        const k_outlet = FITTING_K_FACTORS['outlet_' + outletTypeSelect.value] || 0; // Outlet
        if (currentEffectiveAreaM2 && currentEffectiveAreaM2 > 0) { const V_out = airflowM3S / currentEffectiveAreaM2; const Pd_out = (airProps.density * Math.pow(V_out, 2)) / 2; totalPressureDropPa += k_outlet * Pd_out; }
        estimatedPressureDropDisplay.textContent = `${totalPressureDropPa.toFixed(0)} Pa`;
    } catch (error) { console.error("Error in calculatePressureDrop:", error); estimatedPressureDropDisplay.textContent = `Error Pa`; }
}

// --- CSV Functions ---
// parseCSV, handleCsvImport, exportToCSV functions as provided in "Final Third"
// Ensure all translation keys in exportToCSV are correct and complete.
function parseCSV(text) {
    const lines = text.trim().split('\n'); const data = [];
    const headerMap = { "appliancename": "name", "nomeequipamento": "name", "equipmenttype": "equipText", "tipoequipamento": "equipText", "gastype": "gasTypeText", "tipogás": "gasTypeText", "tipogas": "gasTypeText", "gasusage": "gasUsage", "consumogás": "gasUsage", "consumogas": "gasUsage", "gasunit": "gasUnitText", "unid.": "gasUnitText", "unit": "gasUnitText", "unidade": "gasUnitText", "electricusage(kw)": "electricUsage", "consumoelétrico(kw)": "electricUsage", "consumoeletrico(kw)": "electricUsage"};
    let headers = [];
    lines.forEach((line, index) => {
        const trimmedLine = line.trim(); if (!trimmedLine) return;
        const fields = []; let currentField = ''; let inQuotes = false;
        for (let i = 0; i < trimmedLine.length; i++) {
            const char = trimmedLine[i];
            if (char === '"' && (i === 0 || trimmedLine[i - 1] !== '"' || (inQuotes && i + 1 < trimmedLine.length && trimmedLine[i+1] === '"'))) { if (inQuotes && i + 1 < trimmedLine.length && trimmedLine[i+1] === '"') { currentField += '"'; i++; } else { inQuotes = !inQuotes; }}
            else if (char === ',' && !inQuotes) { fields.push(currentField.trim()); currentField = ''; } else { currentField += char; }
        }
        fields.push(currentField.trim());
        if (index === 0) { headers = fields.map(h => headerMap[h.toLowerCase().replace(/\s+/g, '').replace(/[()]/g, '')] || null); }
        else if (headers.length > 0) {
            const rowData = {}; fields.forEach((field, i) => { if (headers[i]) rowData[headers[i]] = field.replace(/^"|"$/g, '').replace(/""/g, '"'); });
            const equipTextLower = (rowData.equipText || "").toLowerCase();
            rowData.equipValue = Object.keys(SENSIBLE_FACTORS).find(key => (translations.en[`equip_type_${key}`] || "").toLowerCase() === equipTextLower || (translations.pt[`equip_type_${key}`] || "").toLowerCase() === equipTextLower || key.toLowerCase() === equipTextLower) || 'other';
            const gasTextLower = (rowData.gasTypeText || "").toLowerCase();
            rowData.gasTypeValue = Object.keys(translations.en).find(key => key.startsWith('gas_type_') && (translations.en[key] || "").toLowerCase().includes(gasTextLower))?.replace('gas_type_', '') || (gasTextLower.includes("natural") ? 'natural_pt' : gasTextLower.includes("propane") ? 'propane' : gasTextLower.includes("butane") ? 'butane' : 'natural_pt');
            rowData.gasUnitValue = GAS_UNIT_TEXT_TO_VALUE[(rowData.gasUnitText || "").toLowerCase()] || (rowData.gasTypeValue === 'natural_pt' ? 'm3h' : 'kgh');
            data.push(rowData);
        }
    }); return data;
}
function handleCsvImport(event) {
    const file = event.target.files[0]; if (!file) return; const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const csvText = e.target.result; const lines = csvText.split('\n');
            let dataStartIndex = lines.findIndex(line => line.toLowerCase().includes('appliance name') || line.toLowerCase().includes('nome equipamento')); if (dataStartIndex === -1) { dataStartIndex = 0; }
            const dataCsvText = lines.slice(dataStartIndex).join('\n'); const importedData = parseCSV(dataCsvText);
            if (importedData && importedData.length > 0) {
                tableBody.innerHTML = ''; importedData.forEach(rowData => addApplianceRow(rowData));
                document.querySelector('input[name="calculationMethod"][value="heatLoad"]').checked = true; currentCalculationMethod = 'heatLoad';
                toggleCalculationMethodView(); performCalculations();
                alert(translations[currentLang].import_csv_success.replace('{count}', importedData.length) || `Imported ${importedData.length} appliance(s).`);
            } else { alert(translations[currentLang].import_csv_no_data || "No valid appliance data found in CSV or failed to parse."); }
        } catch (error) { console.error("Error processing CSV file:", error); alert(translations[currentLang].import_csv_error || "Failed to process CSV file."); }
        finally { csvFileInput.value = ''; }
    };
    reader.onerror = function() { alert(translations[currentLang].import_csv_read_error || "Error reading file."); csvFileInput.value = ''; }; reader.readAsText(file);
}
function exportToCSV() {
    let csvContent = "data:text/csv;charset=utf-8,"; const lang = currentLang;
    csvContent += `"${translations[lang].title}"\r\n`;
    csvContent += `"${translations[lang].calculation_method_title}","${currentCalculationMethod === 'heatLoad' ? translations[lang].calc_method_heat_load : translations[lang].calc_method_hood_dim}"\r\n`;
    csvContent += `"${translations[lang].hood_type_label}","${hoodTypeSelect.options[hoodTypeSelect.selectedIndex].text}"\r\n`;
    if (currentCalculationMethod === 'heatLoad') {
        csvContent += `"${translations[lang].diversity_factor_label}","${diversityFactorInput.value}"\r\n`;
        csvContent += `"${translations[lang].summary_total_sensible}","${totalSensibleHeatDisplay.textContent}"\r\n`;
        csvContent += `"${translations[lang].summary_hood_factor}","${hoodFactorDisplay.textContent}"\r\n`;
    } else {
        csvContent += `"${translations[lang].hood_length_label}","${hoodLengthInput.value || 'N/A'} m"\r\n`;
        if (hoodTypeSelect.value !== 'eyebrow') { csvContent += `"${translations[lang].hood_depth_label}","${hoodDepthInput.value || 'N/A'} m"\r\n`; csvContent += `"${translations[lang].duty_level_label}","${cookingDutyLevelSelect.options[cookingDutyLevelSelect.selectedIndex].text}"\r\n`; }
        else { csvContent += `"${translations[lang].eyebrow_apm_label}","${eyebrowAirflowPerMeterInput.value || 'N/A'} m³/h/m"\r\n`; }
    }
    csvContent += `"${translations[lang].summary_airflow_label}","${estimatedAirflowDisplay.textContent}"\r\n\r\n`;
    if (tableBody.querySelectorAll('.appliance-row').length > 0) { /* ... appliance data export as before ... */ }
    csvContent += `"${translations[lang].pressure_title}"\r\n`; csvContent += `"${translations[lang].exhaust_air_temp_label}","${exhaustAirTempInput.value} °C"\r\n`; csvContent += `"${translations[lang].pressure_manual_toggle_label}","${manualAirflowToggle.checked ? 'ON' : 'OFF'}"\r\n`; if (manualAirflowToggle.checked) csvContent += `"${translations[lang].pressure_manual_input_label}","${manualAirflowInput.value || 'N/A'} m³/h"\r\n`; csvContent += `"${translations[lang].pressure_recom_duct}","${recommendedDuctDisplay.textContent}"\r\n`; csvContent += `"${translations[lang].pressure_filter_label}","${filterPressureDropInput.value || 'N/A'} Pa"\r\n`; csvContent += `"${translations[lang].pressure_outlet_label}","${outletTypeSelect.options[outletTypeSelect.selectedIndex].text}"\r\n`; csvContent += `"${translations[lang].pressure_velocity_label}","${calculatedVelocityDisplay.textContent}"\r\n`; csvContent += `"${translations[lang].pressure_total_label}","${estimatedPressureDropDisplay.textContent}"\r\n\r\n`;
    if(ductSystemLayout.length > 0) {
        csvContent += `"${translations[lang].duct_system_layout_title}"\r\n`;
        const dsHeaders = ["Order", "Element Type", "Shape/Fitting Key", "Dim1/Upstream", "Dim2/Downstream", "Length(m)/Qty", "Material"].map(h => `"${h}"`).join(","); // Simplified headers
        csvContent += dsHeaders + "\r\n";
        ductSystemLayout.forEach((el, index) => {
            let rowCsv = [`"${index + 1}"`];
            if (el.type === 'segment') {
                rowCsv.push(`"${translations[lang].segment_type_segment}"`); rowCsv.push(`"${el.shape}"`);
                rowCsv.push(`"${el.shape === 'round' ? el.diameter : el.width}"`); rowCsv.push(`"${el.shape === 'round' ? '' : el.height}"`);
                rowCsv.push(`"${el.length}"`); rowCsv.push(`"${el.material}"`);
            } else {
                rowCsv.push(`"${translations[lang].segment_type_fitting}"`); rowCsv.push(`"${el.fittingKey}"`);
                let upDim = el.shape_upstream === 'round' ? el.d_upstream : `${el.w_upstream}x${el.h_upstream}`;
                let downDim = el.shape_downstream === 'round' ? el.d_downstream : `${el.w_downstream}x${el.h_downstream}`;
                rowCsv.push(`"${el.fittingKey.includes('transition') ? upDim : ''}"`);
                rowCsv.push(`"${el.fittingKey.includes('transition') ? downDim : ''}"`);
                rowCsv.push(`"${el.quantity}"`); rowCsv.push(`""`);
            }
            csvContent += rowCsv.join(",") + "\r\n";
        });
    }
    const encodedUri = encodeURI(csvContent); const link = document.createElement("a"); link.setAttribute("href", encodedUri); link.setAttribute("download", `kitchen_airflow_estimate_${new Date().toISOString().slice(0,10)}.csv`); document.body.appendChild(link); link.click(); document.body.removeChild(link);
}

// --- Event Listeners & Initialization ---
function setupEventListeners() { /* ... as provided ... */
    langButtons.forEach(btn => btn.addEventListener('click', (e) => setLanguage(e.target.getAttribute('data-lang'))));
    calculationMethodRadios.forEach(radio => { radio.addEventListener('change', (event) => { currentCalculationMethod = event.target.value; toggleCalculationMethodView(); performCalculations(); }); });
    hoodTypeSelect.addEventListener('change', () => { if (currentCalculationMethod === 'hoodDimension') { toggleDimensionalInputsBasedOnHoodType(); } performCalculations(); });
    dimensionalInputs.forEach(input => { input.addEventListener('input', performCalculations); input.addEventListener('change', performCalculations); });
    diversityFactorInput.addEventListener('input', performCalculations); diversityFactorInput.addEventListener('change', performCalculations);
    addApplianceBtn.addEventListener('click', () => addApplianceRow());
    importCsvBtn.addEventListener('click', () => csvFileInput.click()); csvFileInput.addEventListener('change', handleCsvImport); exportCsvBtn.addEventListener('click', exportToCSV);
    addDuctSegmentBtn.addEventListener('click', addDuctSegmentRowUI); addFittingBtn.addEventListener('click', addFittingRowUI);
    infoIcons.forEach(icon => { icon.addEventListener('click', (e) => { const targetId = e.target.getAttribute('data-target-section'); const targetSection = document.getElementById(targetId); if (targetSection) { explanationSections.forEach(sec => { if(sec.id !== targetId) sec.style.display = 'none';}); targetSection.style.display = targetSection.style.display === 'block' ? 'none' : 'block'; }}); });
    closeExplanationBtns.forEach(btn => { btn.addEventListener('click', (e) => { const targetSection = e.target.closest('.explanation-section'); if (targetSection) targetSection.style.display = 'none'; }); });
    manualAirflowToggle.addEventListener('change', (e) => { const isManual = e.target.checked; manualAirflowInputWrapper.classList.toggle('hidden', !isManual); estimatedAirflowWrapper.style.opacity = isManual ? '0.5' : '1'; if (isManual && !manualAirflowInput.value) { manualAirflowInput.value = lastCalculatedAirflowHighM3H.toFixed(0); } performCalculations(); });
    manualAirflowInput.addEventListener('input', () => { if(manualAirflowToggle.checked) performCalculations(); }); manualAirflowInput.addEventListener('change', () => { if(manualAirflowToggle.checked) performCalculations(); });
    exhaustAirTempInput.addEventListener('input', performCalculations); exhaustAirTempInput.addEventListener('change', performCalculations);
    filterPressureDropInput.addEventListener('input', performCalculations); filterPressureDropInput.addEventListener('change', performCalculations);
    outletTypeSelect.addEventListener('change', performCalculations);
    pressureConfigInputs.forEach(input => { input.addEventListener('input', performCalculations); input.addEventListener('change', performCalculations); });
}

function initializeApp() {
    // Ensure DOM Refs are valid before use
    // (They are global, so should be fine if script is at end of body or DOMContentLoaded is used)
    addApplianceRow();
    addDuctSegmentRowUI();
    setupEventListeners(); // Set up listeners before initial setLanguage and calculations
    setLanguage(currentLang); // This will also call performCalculations at its end
    toggleCalculationMethodView();
    toggleDimensionalInputsBasedOnHoodType();
    // performCalculations(); // Might be redundant if setLanguage calls it and handles everything
}

document.addEventListener('DOMContentLoaded', initializeApp);
