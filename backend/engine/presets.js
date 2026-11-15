// ============================================================================
// BACKEND DATA & AGRONOMIC PARAMETERS (PRESETS, ZARC & CROP ECONOMICS)
// ============================================================================

const PRESETS = {
  campo_mourao: {
    name: "Campo Mourão - PR",
    lat: -24.0458, lon: -52.3831, zoom: 14,
    soil: "argiloso", crop: "soja", irrigation: "sequeiro",
    smapMoisture: 21.4, smapDelta: -14, ndviPeak: 0.78, ndviOff: 0.24, bareSoilDays: 68,
    fallbackTemp: 22.8, fallbackTmin: 11.2, fallbackRain: 1480, fallbackSolar: 18.4, confidence: 89,
    polygon: [[-24.0420, -52.3880], [-24.0420, -52.3780], [-24.0495, -52.3780], [-24.0495, -52.3880]],
    history: {
      2021: { smap: 24.5, ndvi: 0.62, bare: 54 },
      2022: { smap: 18.2, ndvi: 0.51, bare: 82 },
      2023: { smap: 23.8, ndvi: 0.64, bare: 58 },
      2024: { smap: 19.5, ndvi: 0.55, bare: 76 },
      2025: { smap: 20.8, ndvi: 0.58, bare: 71 },
      2026: { smap: 21.4, ndvi: 0.59, bare: 68 }
    }
  },
  sorriso: {
    name: "Sorriso - MT",
    lat: -12.5425, lon: -55.7211, zoom: 14,
    soil: "franco", crop: "soja", irrigation: "sequeiro",
    smapMoisture: 19.1, smapDelta: -19, ndviPeak: 0.82, ndviOff: 0.19, bareSoilDays: 94,
    fallbackTemp: 25.9, fallbackTmin: 19.4, fallbackRain: 1920, fallbackSolar: 20.1, confidence: 92,
    polygon: [[-12.5380, -55.7270], [-12.5380, -55.7150], [-12.5470, -55.7150], [-12.5470, -55.7270]],
    history: {
      2021: { smap: 22.1, ndvi: 0.66, bare: 80 },
      2022: { smap: 20.4, ndvi: 0.63, bare: 88 },
      2023: { smap: 18.0, ndvi: 0.57, bare: 102 },
      2024: { smap: 19.8, ndvi: 0.61, bare: 91 },
      2025: { smap: 18.9, ndvi: 0.59, bare: 96 },
      2026: { smap: 19.1, ndvi: 0.60, bare: 94 }
    }
  },
  rio_verde: {
    name: "Rio Verde - GO",
    lat: -17.7923, lon: -50.9192, zoom: 14,
    soil: "argiloso", crop: "soja", irrigation: "sequeiro",
    smapMoisture: 20.2, smapDelta: -16, ndviPeak: 0.79, ndviOff: 0.21, bareSoilDays: 85,
    fallbackTemp: 24.1, fallbackTmin: 15.8, fallbackRain: 1610, fallbackSolar: 19.5, confidence: 90,
    polygon: [[-17.7885, -50.9245], [-17.7885, -50.9140], [-17.7960, -50.9140], [-17.7960, -50.9245]],
    history: {
      2021: { smap: 23.0, ndvi: 0.65, bare: 72 },
      2022: { smap: 19.1, ndvi: 0.58, bare: 90 },
      2023: { smap: 21.0, ndvi: 0.61, bare: 81 },
      2024: { smap: 19.7, ndvi: 0.59, bare: 87 },
      2025: { smap: 20.0, ndvi: 0.60, bare: 86 },
      2026: { smap: 20.2, ndvi: 0.60, bare: 85 }
    }
  },
  petrolina: {
    name: "Petrolina - PE",
    lat: -9.3891, lon: -40.5027, zoom: 14,
    soil: "arenoso", crop: "milho", irrigation: "irrigado",
    smapMoisture: 13.5, smapDelta: -26, ndviPeak: 0.68, ndviOff: 0.16, bareSoilDays: 125,
    fallbackTemp: 27.4, fallbackTmin: 20.8, fallbackRain: 540, fallbackSolar: 22.3, confidence: 86,
    polygon: [[-9.3855, -40.5075], [-9.3855, -40.4980], [-9.3925, -40.4980], [-9.3925, -40.5075]],
    history: {
      2021: { smap: 15.2, ndvi: 0.52, bare: 112 },
      2022: { smap: 14.8, ndvi: 0.50, bare: 118 },
      2023: { smap: 12.1, ndvi: 0.44, bare: 138 },
      2024: { smap: 13.9, ndvi: 0.48, bare: 122 },
      2025: { smap: 13.1, ndvi: 0.46, bare: 129 },
      2026: { smap: 13.5, ndvi: 0.47, bare: 125 }
    }
  }
};

const CROP_ECONOMICS = {
  soja:     { name: 'Soja',     unitShort: 'sc', unitFull: 'sacas (60kg)', yieldHa: 62,  price: 128, costHa: 4100 },
  milho:    { name: 'Milho',    unitShort: 'sc', unitFull: 'sacas (60kg)', yieldHa: 115, price: 58,  costHa: 3900 },
  feijao:   { name: 'Feijão',   unitShort: 'sc', unitFull: 'sacas (60kg)', yieldHa: 38,  price: 235, costHa: 4600 },
  mandioca: { name: 'Mandioca', unitShort: 't',  unitFull: 'toneladas',    yieldHa: 26,  price: 520, costHa: 6800 },
  algodao:  { name: 'Algodão',  unitShort: '@',  unitFull: 'arrobas (@)',  yieldHa: 310, price: 138, costHa: 14500 },
  trigo:    { name: 'Trigo',    unitShort: 'sc', unitFull: 'sacas (60kg)', yieldHa: 52,  price: 76,  costHa: 3200 }
};

function classifySoilZarc(soilKey) {
  if (soilKey === 'argiloso') return { tipo: 'Argiloso', zarcCode: 'Tipo 3 (Argiloso)', ad: 0.15 };
  if (soilKey === 'arenoso') return { tipo: 'Arenoso', zarcCode: 'Tipo 1 (Arenoso)', ad: 0.07 };
  return { tipo: 'Médio', zarcCode: 'Tipo 2 (Médio)', ad: 0.11 };
}

function obterParametrosCulturaAgroShield(cultura, dap) {
  const c = (cultura || 'soja').toLowerCase();
  let kc = 0.6, raiz = Math.min(5.0 + 0.6 * dap, 50.0);
  if (c === 'soja') { kc = dap <= 20 ? 0.40 : (dap <= 50 ? 0.80 : (dap <= 90 ? 1.15 : 0.50)); raiz = Math.min(5.0 + 0.8 * dap, 60.0); }
  else if (c === 'milho') { kc = dap <= 20 ? 0.30 : (dap <= 50 ? 0.75 : (dap <= 90 ? 1.20 : 0.50)); raiz = Math.min(5.0 + 1.0 * dap, 80.0); }
  else if (c === 'feijao') { kc = dap <= 15 ? 0.40 : (dap <= 35 ? 0.80 : (dap <= 65 ? 1.15 : 0.45)); raiz = Math.min(5.0 + 0.7 * dap, 45.0); }
  else if (c === 'mandioca') { kc = dap <= 30 ? 0.35 : (dap <= 90 ? 0.85 : 0.90); raiz = Math.min(5.0 + 0.9 * dap, 90.0); }
  else if (c === 'algodao') { kc = dap <= 25 ? 0.35 : (dap <= 65 ? 0.80 : (dap <= 110 ? 1.15 : 0.60)); raiz = Math.min(5.0 + 0.9 * dap, 85.0); }
  else if (c === 'trigo') { kc = dap <= 20 ? 0.35 : (dap <= 50 ? 0.75 : (dap <= 85 ? 1.15 : 0.40)); raiz = Math.min(5.0 + 0.8 * dap, 65.0); }
  return { kc, zCm: Math.max(5.0, raiz) };
}
