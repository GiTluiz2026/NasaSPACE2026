// ============================================================================
// FRONTEND APPLICATION STATE & UI CONTROLLER
// ============================================================================

let state = {
  regionKey: 'campo_mourao',
  lat: PRESETS.campo_mourao.lat,
  lon: PRESETS.campo_mourao.lon,
  areaHa: 84.5,
  areaUnit: 'ha',
  currentPolygon: PRESETS.campo_mourao.polygon,
  nasaTemp: PRESETS.campo_mourao.fallbackTemp,
  nasaTmin: PRESETS.campo_mourao.fallbackTmin,
  nasaRain: PRESETS.campo_mourao.fallbackRain,
  nasaSolar: PRESETS.campo_mourao.fallbackSolar,
  nasaLive: false,
  stacLive: false,
  stacItemId: null,
  stacCollection: 'sentinel-2-l2a',
  stacBbox: null,
  stacDate: null,
  stacCloudCover: null,
  ndviCurrent: PRESETS.campo_mourao.history[2026].ndvi,
  confidence: PRESETS.campo_mourao.confidence,
  ndviLayerEnabled: true,
  ndviOpacity: 0.75,
  selectedScenarioId: 'pragmatico',
  recommendedScenarioId: 'pragmatico',
  selectedRiskType: 'normal',
  scenarios: [],
  selectedYear: 2026,
  isCustomLocation: false,
  locationLabel: PRESETS.campo_mourao.name,
  lastResilience: { pragmatico: 91, financeiro: 72, blindagem: 96 },
  stacNoScene: false,
  agroShield: null,
  lastFuturesCalc: null
};

let experienceMode = 'produtor';
let wizardStep = 1;
let map, fieldPolygon, ndviTileLayer = null, ndviOfflineOverlay = null;
let drawMode = false, tempVertices = [], tempMarkers = [];
let historicalChart = null, radarChart = null, bonusWaterChartInstance = null;
let lastSyncedFuturesCrop = 'soja';

// ============================================================================
// AREA UNIT CONVERSION (HECTARES <-> ALQUEIRES)
// ============================================================================
function formatArea(haValue) {
  const unit = document.getElementById('area-unit-select')?.value || 'ha';
  if (unit === 'alq_sp') {
    return `${(haValue / 2.42).toFixed(1).replace('.', ',')} alq. paulista`;
  }
  if (unit === 'alq_mg') {
    return `${(haValue / 4.84).toFixed(1).replace('.', ',')} alq. mineiro`;
  }
  return `${haValue.toFixed(1).replace('.', ',')} ha`;
}

function updateAreaDisplay() {
  const formatted = formatArea(state.areaHa);
  document.getElementById('polygon-area').textContent = formatted;
  const sumEl = document.getElementById('summary-area-text');
  if (sumEl) sumEl.textContent = formatted;
  if (state.scenarios.length) {
    renderSimpleDecisionCard();
    updateLossAndFuturesUI();
  }
}

// ============================================================================
// MAP & SATELLITE LAYERS
// ============================================================================
function initMap() {
  const preset = PRESETS[state.regionKey];
  map = L.map('map', { zoomControl: true }).setView([preset.lat, preset.lon], preset.zoom);

  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Esri World Imagery',
    maxZoom: 19
  }).addTo(map);

  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    opacity: 0.65
  }).addTo(map);

  drawFieldPolygon(preset.polygon);

  map.on('click', function(e) {
    if (drawMode) {
      tempVertices.push([e.latlng.lat, e.latlng.lng]);
      const marker = L.circleMarker(e.latlng, {
        radius: 6, color: '#fbbf24', fillColor: '#059669', fillOpacity: 1, weight: 2
      }).addTo(map);
      tempMarkers.push(marker);
      document.getElementById('vertex-count').textContent = `${tempVertices.length} pontos`;

      if (tempVertices.length >= 2) {
        if (fieldPolygon) map.removeLayer(fieldPolygon);
        fieldPolygon = L.polygon(tempVertices, {
          color: '#fbbf24', fillColor: '#10b981', fillOpacity: 0.25, weight: 2.5, dashArray: '5, 5'
        }).addTo(map);
      }
    } else {
      const lat = e.latlng.lat;
      const lon = e.latlng.lng;
      const delta = 0.0038;
      const newPoly = [
        [lat + delta, lon - delta],
        [lat + delta, lon + delta],
        [lat - delta, lon + delta],
        [lat - delta, lon - delta]
      ];
      drawFieldPolygon(newPoly);
      updateCoordinatesAndFetchOrbital(lat, lon, newPoly, "Local marcado no mapa");
      showToast("Local atualizado! Analisando terra e clima...", "emerald");
    }
  });
}

function drawFieldPolygon(latlngs) {
  state.currentPolygon = latlngs;
  if (fieldPolygon) map.removeLayer(fieldPolygon);
  fieldPolygon = L.polygon(latlngs, {
    color: '#10b981',
    fillColor: '#059669',
    fillOpacity: state.ndviLayerEnabled ? 0.08 : 0.28,
    weight: 3
  }).addTo(map);

  state.areaHa = calculatePolygonAreaHa(latlngs);
  updateAreaDisplay();
}

function toggleAdvancedMapTools() {
  document.getElementById('advanced-map-tools').classList.toggle('hidden');
}

function toggleDrawMode() {
  drawMode = !drawMode;
  const btn = document.getElementById('btn-draw-poly');
  const finishBtn = document.getElementById('btn-finish-poly');
  const instr = document.getElementById('draw-instruction');

  if (drawMode) {
    tempVertices = [];
    tempMarkers.forEach(m => map.removeLayer(m));
    tempMarkers = [];
    if (fieldPolygon) map.removeLayer(fieldPolygon);
    clearNdviMapLayers();
    btn.classList.add('hidden');
    finishBtn.classList.remove('hidden');
    instr.classList.remove('hidden');
    document.getElementById('vertex-count').textContent = '0 pontos';
  } else {
    btn.classList.remove('hidden');
    finishBtn.classList.add('hidden');
    instr.classList.add('hidden');
  }
}

function finishPolygon() {
  if (tempVertices.length < 3) {
    showToast("Toque em pelo menos 3 cantos no mapa antes de fechar.", "amber");
    return;
  }
  tempMarkers.forEach(m => map.removeLayer(m));
  tempMarkers = [];
  drawFieldPolygon(tempVertices);

  let sumLat = 0, sumLon = 0;
  tempVertices.forEach(v => { sumLat += v[0]; sumLon += v[1]; });
  drawMode = false;
  document.getElementById('btn-draw-poly').classList.remove('hidden');
  document.getElementById('btn-finish-poly').classList.add('hidden');
  document.getElementById('draw-instruction').classList.add('hidden');

  updateCoordinatesAndFetchOrbital(sumLat / tempVertices.length, sumLon / tempVertices.length, tempVertices, "Área Desenhada");
  showToast(`Área marcada (${formatArea(state.areaHa)})!`, "emerald");
}

function resetPolygonToPreset() {
  if (drawMode) toggleDrawMode();
  selectPresetRegion(state.regionKey);
}

function clearNdviMapLayers() {
  if (ndviTileLayer && map && map.hasLayer(ndviTileLayer)) map.removeLayer(ndviTileLayer);
  if (ndviOfflineOverlay && map && map.hasLayer(ndviOfflineOverlay)) map.removeLayer(ndviOfflineOverlay);
}

function renderNdviMapLayer() {
  if (!map) return;
  clearNdviMapLayers();
  const modeBadge = document.getElementById('ndvi-layer-mode-badge');

  if (!state.ndviLayerEnabled) {
    if (fieldPolygon) fieldPolygon.setStyle({ fillOpacity: 0.28 });
    if (modeBadge) modeBadge.textContent = "Oculta";
    return;
  }
  if (fieldPolygon) fieldPolygon.setStyle({ fillOpacity: 0.08 });

  if (state.stacLive && state.stacItemId) {
    const tileUrl = `https://planetarycomputer.microsoft.com/api/data/v1/item/tiles/WebMercatorQuad/{z}/{x}/{y}@1x?collection=${encodeURIComponent(state.stacCollection)}&item=${encodeURIComponent(state.stacItemId)}&assets=B08&assets=B04&expression=(B08-B04)/(B08%2BB04)&asset_as_band=true&rescale=-0.1,0.85&colormap_name=rdylgn`;
    const tileBounds = state.stacBbox
      ? L.latLngBounds([state.stacBbox[1], state.stacBbox[0]], [state.stacBbox[3], state.stacBbox[2]])
      : (state.currentPolygon && state.currentPolygon.length >= 3 ? L.polygon(state.currentPolygon).getBounds() : null);
    let errHandled = false;
    ndviTileLayer = L.tileLayer(tileUrl, {
      opacity: state.ndviOpacity,
      minZoom: 8,
      maxZoom: 19,
      crossOrigin: true,
      ...(tileBounds ? { bounds: tileBounds } : {})
    });
    ndviTileLayer.on('tileerror', () => { if (!errHandled) { errHandled = true; renderOfflineNdviOverlay(); } });
    ndviTileLayer.addTo(map);
    if (modeBadge) modeBadge.textContent = `Satélite Ao Vivo (${state.stacDate})`;
  } else {
    renderOfflineNdviOverlay();
  }
}

function renderOfflineNdviOverlay() {
  if (!map || !state.ndviLayerEnabled || !state.currentPolygon || state.currentPolygon.length < 3) return;
  clearNdviMapLayers();
  const bounds = L.polygon(state.currentPolygon).getBounds();
  const canvas = document.createElement('canvas');
  canvas.width = 96; canvas.height = 96;
  const ctx = canvas.getContext('2d');
  const baseNdvi = state.ndviCurrent || 0.55;
  const imgData = ctx.createImageData(96, 96);

  for (let y = 0; y < 96; y++) {
    for (let x = 0; x < 96; x++) {
      const wave = Math.sin((x / 96) * 6) * Math.cos((y / 96) * 5) * 0.14;
      const v = Math.max(0.05, Math.min(0.90, baseNdvi + wave));
      let r, g, b;
      if (v < 0.28) { r = 220; g = 110; b = 38; }
      else if (v < 0.55) { r = 200; g = 185; b = 35; }
      else { r = 28; g = 165; b = 75; }
      const idx = (y * 96 + x) * 4;
      imgData.data[idx] = r; imgData.data[idx + 1] = g; imgData.data[idx + 2] = b; imgData.data[idx + 3] = 200;
    }
  }
  ctx.putImageData(imgData, 0, 0);
  ndviOfflineOverlay = L.imageOverlay(canvas.toDataURL(), bounds, { opacity: state.ndviOpacity }).addTo(map);
  const modeBadge = document.getElementById('ndvi-layer-mode-badge');
  if (modeBadge) modeBadge.textContent = "Mapa Calibrado";
}

function toggleNdviLayer(enabled) {
  state.ndviLayerEnabled = enabled;
  renderNdviMapLayer();
}

function updateNdviOpacity(val) {
  state.ndviOpacity = Number(val);
  document.getElementById('ndvi-opacity-val').textContent = `${Math.round(state.ndviOpacity * 100)}%`;
  if (ndviTileLayer && map.hasLayer(ndviTileLayer)) ndviTileLayer.setOpacity(state.ndviOpacity);
  if (ndviOfflineOverlay && map.hasLayer(ndviOfflineOverlay)) ndviOfflineOverlay.setOpacity(state.ndviOpacity);
}

// ============================================================================
// REGION & LOCATION ACTIONS
// ============================================================================
function selectPresetRegion(key) {
  state.regionKey = key;
  state.isCustomLocation = false;
  const preset = PRESETS[key];
  state.locationLabel = preset.name;
  state.lat = preset.lat;
  state.lon = preset.lon;
  state.nasaTemp = preset.fallbackTemp;
  state.nasaTmin = preset.fallbackTmin;
  state.nasaRain = preset.fallbackRain;
  state.nasaSolar = preset.fallbackSolar;
  state.stacLive = false;
  state.ndviCurrent = preset.history[state.selectedYear]?.ndvi ?? preset.ndviOff;

  document.getElementById('input-soil').value = preset.soil;
  document.getElementById('input-crop').value = preset.crop;
  document.getElementById('input-irrigation').value = preset.irrigation;
  syncVisualButtonsFromSelects();

  if (map) {
    map.setView([preset.lat, preset.lon], preset.zoom);
    drawFieldPolygon(preset.polygon);
  }
  updateDiagnosticUI();
  updateHistoricalChart();
  runSimulation();
  updateCoordinatesAndFetchOrbital(preset.lat, preset.lon, preset.polygon, preset.name, false);
}

function setSatellitesLoadingState() {
  const waterStatus = document.getElementById('fg-water-status');
  const ndviStatus = document.getElementById('fg-ndvi-status');
  const ndviPill = document.getElementById('fg-ndvi-pill');
  if (waterStatus) waterStatus.textContent = "Calculando umidade...";
  if (ndviStatus) ndviStatus.textContent = "Lendo imagem de satélite...";
  if (ndviPill) {
    ndviPill.textContent = "Buscando...";
    ndviPill.className = "px-2.5 py-1 rounded-full text-xs font-extrabold bg-slate-200 text-slate-700 animate-pulse";
  }
}

function updateCoordinatesAndFetchOrbital(lat, lon, polygonLatLngs, label, isCustom = true) {
  state.lat = lat;
  state.lon = lon;
  state.isCustomLocation = isCustom;
  state.locationLabel = label;
  document.getElementById('coords-display').textContent = `Lat: ${lat.toFixed(4)}° | Lon: ${lon.toFixed(4)}°`;
  if (isCustom) setSatellitesLoadingState();
  fetchNasaPowerClimatology(lat, lon);
  fetchPlanetaryComputerNDVI(polygonLatLngs || state.currentPolygon);
  updateHistoricalChart();
}

function getEffectiveOrbitalMetrics() {
  const preset = PRESETS[state.regionKey];
  const yrData = preset.history[state.selectedYear] || preset.history[2026];
  const et0 = computeEt0HargreavesSamani(state.nasaTemp, state.nasaSolar);
  const waterBalance = computeWaterBalance(state.nasaRain, et0);

  if (!state.isCustomLocation) {
    return { smapMoisture: yrData.smap, smapDelta: preset.smapDelta, bareSoilDays: yrData.bare, et0, waterBalance };
  }
  const soilType = document.getElementById('input-soil')?.value || 'argiloso';
  const textureBonus = soilType === 'argiloso' ? 3.2 : (soilType === 'franco' ? 1.2 : -2.5);
  const normalizedBh = Math.max(-1.0, Math.min(1.0, waterBalance / 1200));
  const dynamicSmap = Number(Math.max(6.5, Math.min(34.0, 20.5 + normalizedBh * 9.5 + textureBonus)).toFixed(1));
  return {
    smapMoisture: dynamicSmap,
    smapDelta: Math.round(normalizedBh * 22),
    bareSoilDays: Math.round(Math.max(15, Math.min(220, 95 - (state.ndviCurrent * 85) - normalizedBh * 30))),
    et0,
    waterBalance
  };
}

// ============================================================================
// UI UPDATES & SIMULATION
// ============================================================================
function updateDiagnosticUI() {
  const eff = getEffectiveOrbitalMetrics();

  document.getElementById('metric-solar').textContent = `${state.nasaSolar.toFixed(1)} MJ`;
  document.getElementById('metric-et0').textContent = `${eff.et0.toFixed(2)} mm/d`;
  document.getElementById('metric-bh').textContent = `${eff.waterBalance >= 0 ? '+' : ''}${eff.waterBalance} mm`;

  const smapVal = eff.smapMoisture;
  const smapPct = Math.max(10, Math.min(95, Math.round((smapVal / 32) * 100)));
  document.getElementById('fg-water-bar').style.width = `${smapPct}%`;
  document.getElementById('fg-water-bar').className = `h-full rounded-full transition-all duration-500 ${smapVal < 16 ? 'bg-rose-500' : (smapVal < 22 ? 'bg-amber-500' : 'bg-emerald-500')}`;
  document.getElementById('fg-water-status').textContent = smapVal < 16
    ? `Terra Seca (${smapVal}%)`
    : (smapVal < 22 ? `Umidade Média (${smapVal}%)` : `Boa Umidade (${smapVal}%)`);
  const wPill = document.getElementById('fg-water-pill');
  wPill.textContent = smapVal < 16 ? 'Alerta' : (smapVal < 22 ? 'Atenção' : 'Ótimo');
  wPill.className = `px-2.5 py-1 rounded-full text-xs font-extrabold ${smapVal < 16 ? 'bg-rose-200 text-rose-950' : (smapVal < 22 ? 'bg-amber-200/80 text-amber-950' : 'bg-emerald-200 text-emerald-950')}`;

  const ndviPct = Math.max(8, Math.min(98, Math.round(state.ndviCurrent * 100)));
  const ndviBar = document.getElementById('fg-ndvi-bar');
  ndviBar.style.width = `${ndviPct}%`;
  ndviBar.className = `h-full rounded-full transition-all duration-500 ${state.ndviCurrent < 0.30 ? 'bg-rose-500' : (state.ndviCurrent < 0.50 ? 'bg-amber-500' : 'bg-emerald-500')}`;

  document.getElementById('fg-ndvi-status').textContent = state.stacNoScene
    ? `Sem leitura terrestre (${state.ndviCurrent.toFixed(2)})`
    : (state.ndviCurrent < 0.30
      ? `Terra Descoberta (${state.ndviCurrent.toFixed(2)})`
      : (state.ndviCurrent < 0.55 ? `Verde Médio (${state.ndviCurrent.toFixed(2)})` : `Bem Verde (${state.ndviCurrent.toFixed(2)})`));

  const ndviPill = document.getElementById('fg-ndvi-pill');
  ndviPill.textContent = state.stacNoScene ? 'Água/Nuvem' : (state.ndviCurrent < 0.30 ? 'Exposta' : 'Saudável');
  ndviPill.className = `px-2.5 py-1 rounded-full text-xs font-extrabold ${state.stacNoScene ? 'bg-slate-200 text-slate-800' : (state.ndviCurrent < 0.30 ? 'bg-amber-200/80 text-amber-950' : 'bg-emerald-200/80 text-emerald-950')}`;

  document.getElementById('fg-temp').textContent = `${state.nasaTemp.toFixed(1)} °C`;
  document.getElementById('fg-rain').textContent = `${state.nasaRain.toLocaleString('pt-BR')} mm`;

  document.getElementById('val-smap').textContent = `${smapVal}% vol (${eff.smapDelta > 0 ? '+' : ''}${eff.smapDelta}%)`;
  document.getElementById('val-ndvi').textContent = state.stacLive && state.stacDate
    ? `NDVI ${state.ndviCurrent.toFixed(2)} (${state.stacDate})`
    : `NDVI ${state.ndviCurrent.toFixed(2)}`;
  document.getElementById('bare-soil-text').textContent = `Janela histórica de solo descoberto: ${eff.bareSoilDays} dias/ano.`;
}

function getFarmProfile() {
  return {
    crop: document.getElementById('input-crop').value,
    soil: document.getElementById('input-soil').value,
    compaction: document.getElementById('input-compaction').value,
    irrigation: document.getElementById('input-irrigation').value,
    ph: Number(document.getElementById('input-ph').value),
    mo: Number(document.getElementById('input-mo').value),
    dap: Number(document.getElementById('input-dap').value),
    machConv: document.getElementById('mach-conv').checked,
    machMiudas: document.getElementById('mach-miudas').checked,
    machColhedora: document.getElementById('mach-colhedora').checked,
    machRolofaca: document.getElementById('mach-rolofaca').checked,
    mktGraos: document.getElementById('mkt-graos').checked,
    mktPecuaria: document.getElementById('mkt-pecuaria').checked,
    mktCobertura: document.getElementById('mkt-cobertura').checked,
    soilWeight: Number(document.getElementById('prio-soil-vs-cash').value) / 100,
    waterWeight: Number(document.getElementById('prio-water').value) / 100,
    pestWeight: Number(document.getElementById('prio-pest').value) / 100
  };
}

function runSimulation() {
  const p = getFarmProfile();
  const eff = getEffectiveOrbitalMetrics();
  const isDry = (p.irrigation === 'sequeiro' && (state.nasaRain < 1200 || eff.smapMoisture < 20));
  const isLowMO = p.mo < 2.0;
  const rainDeltaPct = Number(document.getElementById('stress-rain')?.value || 0);
  const tempDelta = Number(document.getElementById('stress-temp')?.value || 0);

  const shield = computeAgroShieldDecision(p, eff, state, rainDeltaPct, tempDelta);
  state.agroShield = shield;

  const summerMap = {
    soja: 'Soja Precoce (Ciclo 115d)',
    milho: 'Milho Verão + Fixação de N',
    feijao: 'Feijão-Comum / Caupi',
    mandioca: 'Mandioca Consorciada com Feijão',
    algodao: 'Algodão em Plantio Direto',
    trigo: 'Soja Fixadora de N'
  };
  const summer1 = summerMap[p.crop] || 'Soja Fixadora de N';
  const canSmall = p.machMiudas && p.mktCobertura;

  const safrinhaPragmatic = canSmall
    ? (isDry ? 'Sorgo Granífero + Braquiária' : 'Milho Safrinha + Braquiária Ruziziensis')
    : (isDry ? 'Sorgo Granífero Solteiro' : 'Milho Safrinha + Feijão-Caupi');
  const safrinhaCash = (p.irrigation === 'irrigado' || !isDry) ? 'Milho Safrinha Alta Tecnologia' : 'Sorgo Granífero';
  const safrinhaShield = canSmall ? 'Crotalária Ochroleuca + Milheto' : 'Feijão-Guandu + Sorgo Forrageiro';

  const winterPragmatic = canSmall
    ? ((state.nasaTmin <= 9.5 || Math.abs(state.lat) >= 24.5) ? 'Aveia Preta + Braquiária' : 'Crotalária Spectabilis (Cobertura)')
    : 'Aveia Preta (Palhada / Pastejo)';
  const winterCash = p.mktGraos ? (state.nasaTemp < 24.5 ? 'Trigo Comercial / Cevada' : 'Feijão-Caupi / Gergelim') : 'Milheto para Pastejo';
  const winterShield = canSmall ? 'Mix Cobertura (Nabo + Crotalária + Braquiária)' : 'Aveia Preta + Ervilhaca';

  const nSaved1 = computeUreaSavingsBrl((canSmall ? 110 : 75) + (isLowMO ? 15 : 0));
  const netMargin1 = Math.round(3850 + (p.irrigation === 'irrigado' ? 950 : 0) + (p.mo * 80));

  const nSaved2 = computeUreaSavingsBrl(30);
  const netMargin2 = Math.round(4290 + (p.irrigation === 'irrigado' ? 1200 : -280));

  const nSaved3 = computeUreaSavingsBrl((canSmall ? 150 : 105) + (isLowMO ? 20 : 0));
  const netMargin3 = Math.round(3320 + (p.mktPecuaria ? 520 : 0) + (p.mo * 90));

  let recommendedId = 'pragmatico';
  if (shield.status === 'Seco' || (shield.alertaIrrigacao && shield.diasAteSeca <= 4)) recommendedId = 'blindagem';
  else if (p.soilWeight <= 0.30 && p.waterWeight <= 0.50) recommendedId = 'financeiro';
  else if (p.soilWeight >= 0.80) recommendedId = 'blindagem';

  state.recommendedScenarioId = recommendedId;
  if (!state.userManuallyPickedScenario) state.selectedScenarioId = recommendedId;

  state.scenarios = [
    {
      id: 'pragmatico',
      badge: '⚖️ Equilíbrio (Lucro + Terra Forte)',
      title: 'Plano Equilibrado (Recomendado)',
      subtitle: 'Dá boa colheita e deixa palha na terra para segurar a umidade.',
      cycles: [
        { period: '1ª Safra • Verão', crop: summer1, role: 'Renda principal da propriedade' },
        { period: '2ª Safra • Safrinha', crop: safrinhaPragmatic, role: 'Colheita extra + raiz que segura água' },
        { period: '3ª Safra • Inverno', crop: winterPragmatic, role: 'Cobre a terra e economiza adubo' }
      ],
      ureaSaved: nSaved1,
      projectedMarginValue: netMargin1,
      plainExplain: 'Você colhe bem no verão e na safrinha e ainda protege a terra no inverno para gastar menos com ureia.',
      scores: [86, 88, 84, 86, 85, 78, 80]
    },
    {
      id: 'financeiro',
      badge: '💰 Dinheiro Mais Rápido',
      title: 'Plano Foco em Venda Rápida',
      subtitle: 'Prioriza lavouras de venda imediata nas 3 épocas do ano.',
      cycles: [
        { period: '1ª Safra • Verão', crop: summer1, role: 'Venda rápida na cooperativa' },
        { period: '2ª Safra • Safrinha', crop: safrinhaCash, role: 'Segunda colheita comercial' },
        { period: '3ª Safra • Inverno', crop: winterCash, role: 'Terceira safra de venda (exige mais chuva)' }
      ],
      ureaSaved: nSaved2,
      projectedMarginValue: netMargin2,
      plainExplain: 'Gera mais dinheiro rápido se chover bem, mas deixa pouca palha e sofre mais se faltar chuva.',
      scores: [52, 54, 48, 56, 54, 52, 92]
    },
    {
      id: 'blindagem',
      badge: '🛡️ Proteção Máxima da Terra',
      title: 'Plano Terra Forte & Contra Seca',
      subtitle: 'Ideal para terra cansada, dura ou região com pouca chuva.',
      cycles: [
        { period: '1ª Safra • Verão', crop: summer1, role: 'Base comercial da safra' },
        { period: '2ª Safra • Safrinha', crop: safrinhaShield, role: 'Corta pragas de raiz e aduba a terra' },
        { period: '3ª Safra • Inverno', crop: winterShield, role: 'Solta a terra dura sem precisar subsolar' }
      ],
      ureaSaved: nSaved3,
      projectedMarginValue: netMargin3,
      plainExplain: 'As raízes fundas descompactam o solo sozinhas, seguram a chuva e cortam pragas de raiz.',
      scores: [94, 96, 94, 94, 95, 84, 68]
    }
  ];

  renderSimpleDecisionCard();
  renderTechScenarios();
  updateRadarChart();
  updateClimateStress();
}

function renderSimpleDecisionCard() {
  const shield = state.agroShield;
  const chosen = state.scenarios.find(s => s.id === state.selectedScenarioId) || state.scenarios[0];
  if (!chosen || !shield) return;

  const banner = document.getElementById('semaphore-banner');
  const iconEl = document.getElementById('semaphore-icon');
  const titleEl = document.getElementById('semaphore-title');
  const subEl = document.getElementById('semaphore-subtitle');

  if (shield.status === 'Seco') {
    banner.className = "p-5 sm:p-6 bg-rose-950 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-4";
    iconEl.textContent = "🔴";
    titleEl.textContent = "Alerta: Terra com pouca água hoje";
    subEl.textContent = shield.mensagemStatus;
  } else if (shield.alertaIrrigacao) {
    banner.className = "p-5 sm:p-6 bg-amber-900 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-4";
    iconEl.textContent = "🟡";
    titleEl.textContent = "Atenção: Umidade no limite para os próximos dias";
    subEl.textContent = shield.mensagemStatus;
  } else {
    banner.className = "p-5 sm:p-6 bg-emerald-950 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-4";
    iconEl.textContent = "🟢";
    titleEl.textContent = "Tudo certo: Terra com boa umidade para plantar";
    subEl.textContent = shield.mensagemStatus;
  }

  document.getElementById('summary-area-text').textContent = formatArea(state.areaHa);
  document.getElementById('recommended-plan-title').textContent = `🌱 ${chosen.title}`;

  document.getElementById('simple-3-cycles').innerHTML = chosen.cycles.map((c) => `
    <div class="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-1">
      <div class="text-[11px] font-extrabold uppercase text-emerald-700">${c.period}</div>
      <div class="text-sm font-extrabold text-slate-900">${c.crop}</div>
      <div class="text-xs text-slate-600">${c.role}</div>
    </div>
  `).join('');

  const totalMargin = Math.round(chosen.projectedMarginValue * state.areaHa);
  document.getElementById('simple-total-margin').textContent = `R$ ${totalMargin.toLocaleString('pt-BR')}`;
  document.getElementById('simple-unit-margin').textContent = `R$ ${chosen.projectedMarginValue.toLocaleString('pt-BR')} por hectare (${formatArea(state.areaHa)})`;
  document.getElementById('simple-urea-saved').textContent = `R$ ${chosen.ureaSaved}/ha (Total: R$ ${Math.round(chosen.ureaSaved * state.areaHa).toLocaleString('pt-BR')})`;
}

function toggleComparePlansModal() {
  const modal = document.getElementById('compare-plans-modal');
  modal.classList.toggle('hidden');
  if (!modal.classList.contains('hidden')) {
    document.getElementById('modal-plans-list').innerHTML = state.scenarios.map(sc => {
      const active = sc.id === state.selectedScenarioId;
      return `
        <div onclick="choosePlanFromModal('${sc.id}')" class="p-4 rounded-2xl border-2 ${active ? 'border-emerald-600 bg-emerald-50/60' : 'border-slate-200 hover:border-emerald-400'} cursor-pointer flex flex-col justify-between space-y-3 transition">
          <div class="space-y-2">
            <span class="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-slate-900 text-white">${sc.badge}</span>
            <div class="text-sm font-extrabold text-slate-900">${sc.title}</div>
            <p class="text-xs text-slate-600">${sc.plainExplain}</p>
            <div class="space-y-1 pt-1 text-xs">
              ${sc.cycles.map(c => `<div class="bg-white p-2 rounded-lg border border-slate-200"><strong>${c.period}:</strong> ${c.crop}</div>`).join('')}
            </div>
          </div>
          <div class="pt-2 border-t border-slate-200">
            <div class="text-xs font-extrabold text-emerald-900">Sobra est.: R$ ${sc.projectedMarginValue.toLocaleString('pt-BR')}/ha</div>
            <button type="button" class="mt-2 w-full py-2 rounded-xl ${active ? 'bg-emerald-600 text-white' : 'bg-slate-900 text-white'} text-xs font-bold">
              ${active ? '✓ Plano Selecionado' : 'Escolher este Plano'}
            </button>
          </div>
        </div>
      `;
    }).join('');
  }
}

function selectScenario(id) {
  state.selectedScenarioId = id;
  state.userManuallyPickedScenario = true;
  renderSimpleDecisionCard();
  renderTechScenarios();
  updateClimateStress();
  showToast("Plano selecionado!", "emerald");
}

function choosePlanFromModal(id) {
  selectScenario(id);
  toggleComparePlansModal();
}

function selectRiskSimulation(riskType, btnEl) {
  state.selectedRiskType = riskType || 'normal';
  document.querySelectorAll('.risk-sim-btn').forEach(b => {
    b.className = "risk-sim-btn py-2.5 px-3 rounded-xl border border-slate-200 bg-white hover:border-emerald-400 text-xs font-extrabold text-slate-800 cursor-pointer transition";
  });
  if (btnEl) {
    btnEl.className = "risk-sim-btn py-2.5 px-3 rounded-xl border-2 border-emerald-600 bg-emerald-50 text-xs font-extrabold text-slate-900 cursor-pointer transition";
  }

  const simMap = {
    normal: { rain: 0, temp: 0.0, frost: false, tip: "Em ano normal, manter palhada na entressafra economiza adubo e prepara a terra para o próximo plantio." },
    seca: { rain: -25, temp: 1.5, frost: false, tip: "Na seca (-25% chuva), a cobertura de braquiária ou sorgo segura até 40% mais umidade na raiz." },
    calor: { rain: -10, temp: 3.0, frost: false, tip: "No calor forte (+3°C), a palhada reduz a temperatura da terra em até 4°C e protege a florada." },
    geada: { rain: 0, temp: 0.0, frost: true, tip: "Com risco de geada, evite milho tardio no inverno e prefira Aveia Preta ou Trigo, que aguentam frio." }
  };
  const cfg = simMap[state.selectedRiskType] || simMap.normal;
  document.getElementById('stress-rain').value = cfg.rain;
  document.getElementById('stress-temp').value = cfg.temp;
  document.getElementById('stress-frost').checked = cfg.frost;
  document.getElementById('simple-prevention-tip').innerHTML = `💡 <strong>Dica de proteção:</strong> ${cfg.tip}`;
  runSimulation();
}

function updateClimateStress() {
  const rainDelta = Number(document.getElementById('stress-rain').value);
  const tempDelta = Number(document.getElementById('stress-temp').value);
  const frostActive = document.getElementById('stress-frost').checked;
  const isIrrigated = document.getElementById('input-irrigation').value === 'irrigado';

  document.getElementById('stress-rain-val').textContent = `${rainDelta > 0 ? '+' : ''}${rainDelta}%`;
  document.getElementById('stress-temp-val').textContent = `+${tempDelta.toFixed(1)} °C`;

  const p1 = computeFao33YieldPreservation(0.92, rainDelta, tempDelta, state.nasaTemp, state.nasaSolar, 0.35, isIrrigated, frostActive, 0.72);
  const p2 = computeFao33YieldPreservation(1.18, rainDelta, tempDelta, state.nasaTemp, state.nasaSolar, 0.05, isIrrigated, frostActive, 0.35);
  const p3 = computeFao33YieldPreservation(0.80, rainDelta, tempDelta, state.nasaTemp, state.nasaSolar, 0.45, isIrrigated, frostActive, 0.85);
  state.lastResilience = { pragmatico: p1, financeiro: p2, blindagem: p3 };

  const currentPct = state.lastResilience[state.selectedScenarioId] ?? p1;
  const pill = document.getElementById('simple-resilience-pill');
  if (pill) {
    pill.textContent = `🛡️ Segura ${currentPct}% da colheita`;
    pill.className = `px-3 py-1.5 rounded-xl text-xs font-extrabold self-start sm:self-center ${currentPct >= 80 ? 'bg-emerald-100 text-emerald-900' : (currentPct >= 65 ? 'bg-amber-100 text-amber-950' : 'bg-rose-100 text-rose-900')}`;
  }

  const resCards = document.getElementById('resilience-cards');
  if (resCards) {
    resCards.innerHTML = [
      { name: 'Equilibrado', val: p1 },
      { name: 'Venda Rápida', val: p2 },
      { name: 'Proteção Máxima', val: p3 }
    ].map(i => `<div class="p-2.5 rounded-xl border border-slate-200 bg-white text-center"><div class="text-[11px] font-bold text-slate-600">${i.name}</div><div class="text-lg font-extrabold text-slate-900">${i.val}%</div></div>`).join('');
  }

  updateLossAndFuturesUI();
}

// ============================================================================
// ESTIMATIVA DE PERDAS & CALCULADORA DE VENDAS FUTURAS (HEDGE / CPR)
// ============================================================================
function syncFuturesDefaultsForCrop(cropKey, force = false) {
  const cfg = CROP_ECONOMICS[cropKey] || CROP_ECONOMICS.soja;
  if (!force && lastSyncedFuturesCrop === cropKey) return;
  lastSyncedFuturesCrop = cropKey;

  const yieldEl = document.getElementById('fut-yield-ha');
  const priceEl = document.getElementById('fut-price');
  const costEl  = document.getElementById('fut-cost-ha');
  if (yieldEl) yieldEl.value = cfg.yieldHa;
  if (priceEl) priceEl.value = cfg.price;
  if (costEl)  costEl.value  = cfg.costHa;

  document.querySelectorAll('.fut-unit-label').forEach(el => { el.textContent = cfg.unitShort; });
  const badge = document.getElementById('futures-crop-badge');
  if (badge) badge.textContent = `${cfg.name} (${cfg.unitShort})`;
}

function calculateScenarioLossAndFutures(scenarioId) {
  const p = getFarmProfile();
  const cfg = CROP_ECONOMICS[p.crop] || CROP_ECONOMICS.soja;
  const sc = state.scenarios.find(s => s.id === scenarioId) || state.scenarios[0] || { ureaSaved: 350, title: 'Plano' };
  const area = Math.max(1, state.areaHa || 84.5);

  const yieldHa = Math.max(1, Number(document.getElementById('fut-yield-ha')?.value) || cfg.yieldHa);
  const price   = Math.max(1, Number(document.getElementById('fut-price')?.value) || cfg.price);
  const costHa  = Math.max(100, Number(document.getElementById('fut-cost-ha')?.value) || cfg.costHa);
  const hedgePct = Math.max(0, Math.min(85, Number(document.getElementById('fut-hedge-pct')?.value ?? 45)));

  const resiliencePct = state.lastResilience[scenarioId] ?? 91;
  const lossPct = Math.max(1, 100 - resiliencePct);

  const rainDelta = Number(document.getElementById('stress-rain')?.value || 0);
  const tempDelta = Number(document.getElementById('stress-temp')?.value || 0);
  const frostActive = Boolean(document.getElementById('stress-frost')?.checked);
  const isIrrigated = p.irrigation === 'irrigado';
  const bareSoilPreservedPct = computeFao33YieldPreservation(1.25, rainDelta, tempDelta, state.nasaTemp, state.nasaSolar, 0.0, isIrrigated, frostActive, 0.25);

  const potentialVol = yieldHa * area;
  const netVol = potentialVol * (resiliencePct / 100);
  const lossVol = Math.max(0, potentialVol - netVol);
  const lossBrl = Math.round(lossVol * price);

  const bareSoilNetVol = potentialVol * (bareSoilPreservedPct / 100);
  const avoidedLossVol = Math.max(0, netVol - bareSoilNetVol);
  const avoidedLossBrl = Math.round(avoidedLossVol * price);

  const effectiveCostHa = Math.max(0, costHa - (sc.ureaSaved || 0));
  const totalCostBrl = Math.round(effectiveCostHa * area);
  const breakEvenUnitHa = Number((effectiveCostHa / price).toFixed(1));
  const netYieldHa = Number((yieldHa * (resiliencePct / 100)).toFixed(1));

  const safeHedgeLimitPct = Math.max(20, Math.min(70, Math.round((resiliencePct * 0.65) / 5) * 5));

  const hedgedVol = netVol * (hedgePct / 100);
  const hedgedBrl = Math.round(hedgedVol * price);
  const spotVol = Math.max(0, netVol - hedgedVol);
  const spotBrl = Math.round(spotVol * price);

  const costCoveragePct = totalCostBrl > 0 ? Math.round((hedgedBrl / totalCostBrl) * 100) : 100;
  const grossRevenueBrl = hedgedBrl + spotBrl;
  const netProfitBrl = grossRevenueBrl - totalCostBrl;
  const netProfitHa = Math.round(netProfitBrl / area);

  return {
    cropName: cfg.name,
    unitShort: cfg.unitShort,
    unitFull: cfg.unitFull,
    area,
    yieldHa,
    netYieldHa,
    price,
    costHa,
    effectiveCostHa,
    ureaSavedHa: sc.ureaSaved || 0,
    resiliencePct,
    lossPct,
    potentialVol: Math.round(potentialVol),
    netVol: Math.round(netVol),
    lossVol: Math.round(lossVol),
    lossBrl,
    avoidedLossVol: Math.round(avoidedLossVol),
    avoidedLossBrl,
    totalCostBrl,
    breakEvenUnitHa,
    safeHedgeLimitPct,
    hedgePct,
    hedgedVol: Math.round(hedgedVol),
    hedgedBrl,
    spotVol: Math.round(spotVol),
    spotBrl,
    costCoveragePct,
    grossRevenueBrl,
    netProfitBrl,
    netProfitHa
  };
}

function updateLossAndFuturesUI() {
  const p = getFarmProfile();
  syncFuturesDefaultsForCrop(p.crop, false);

  const calc = calculateScenarioLossAndFutures(state.selectedScenarioId);
  state.lastFuturesCalc = calc;

  const u = calc.unitShort;
  const setEl = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };

  setEl('fut-hedge-val', `${calc.hedgePct}%`);
  setEl('fut-safe-limit-hint', `Limite seguro p/ este clima: até ${calc.safeHedgeLimitPct}%`);

  setEl('fut-net-prod', `${calc.netVol.toLocaleString('pt-BR')} ${u} (${calc.netYieldHa.toString().replace('.', ',')} ${u}/ha)`);
  setEl('fut-potential-prod', `Potencial sem perda: ${calc.potentialVol.toLocaleString('pt-BR')} ${u}`);
  setEl('fut-breakeven-text', `Paga custos com: ${calc.breakEvenUnitHa.toString().replace('.', ',')} ${u}/ha`);

  setEl('fut-loss-pct-badge', `-${calc.lossPct}%`);
  setEl('fut-loss-brl', `- R$ ${calc.lossBrl.toLocaleString('pt-BR')}`);
  setEl('fut-loss-vol', `${calc.lossVol.toLocaleString('pt-BR')} ${u} de quebra estimada`);
  setEl('fut-saved-loss-brl', calc.avoidedLossBrl > 0
    ? `🛡️ Plano evita R$ ${calc.avoidedLossBrl.toLocaleString('pt-BR')} de prejuízo`
    : `🛡️ Lavoura protegida no limite máximo`);

  setEl('fut-hedged-brl', `R$ ${calc.hedgedBrl.toLocaleString('pt-BR')}`);
  setEl('fut-hedged-vol', `${calc.hedgedVol.toLocaleString('pt-BR')} ${u} travadas (${calc.hedgePct}% da safra prevista)`);
  setEl('fut-cost-coverage', `Cobre ${calc.costCoveragePct}% do custo líquido da lavoura`);

  const statusBadge = document.getElementById('fut-hedge-status-badge');
  const advisoryBox = document.getElementById('fut-advisory-box');
  if (statusBadge && advisoryBox) {
    if (calc.hedgePct > calc.safeHedgeLimitPct) {
      statusBadge.textContent = 'Risco Alto';
      statusBadge.className = 'px-1.5 py-0.5 rounded bg-rose-200 text-rose-950 text-[10px] font-extrabold';
      advisoryBox.className = 'p-3 rounded-xl bg-rose-50 border border-rose-300 text-xs text-rose-950 leading-relaxed';
      advisoryBox.innerHTML = `⚠️ <strong>Atenção ao Risco de Entrega (Washout):</strong> Travar <strong>${calc.hedgePct}%</strong> está acima do limite seguro de <strong>${calc.safeHedgeLimitPct}%</strong> para o clima selecionado. Se houver seca ou geada, pode faltar produto para cumprir o contrato. Toque em <strong>Aplicar Trava Segura</strong>.`;
    } else if (calc.hedgePct < 20) {
      statusBadge.textContent = 'Pouca Trava';
      statusBadge.className = 'px-1.5 py-0.5 rounded bg-amber-200 text-amber-950 text-[10px] font-extrabold';
      advisoryBox.className = 'p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-950 leading-relaxed';
      advisoryBox.innerHTML = `💡 <strong>Dica de Proteção de Preço:</strong> Você travou apenas <strong>${calc.hedgePct}%</strong> (${calc.costCoveragePct}% dos custos). Recomenda-se travar cerca de <strong>${calc.safeHedgeLimitPct}%</strong> (${Math.round(calc.netVol * (calc.safeHedgeLimitPct / 100)).toLocaleString('pt-BR')} ${u}) em Barter ou Contrato Futuro para garantir os custos de plantio.`;
    } else {
      statusBadge.textContent = 'Trava Segura';
      statusBadge.className = 'px-1.5 py-0.5 rounded bg-emerald-200 text-emerald-950 text-[10px] font-extrabold';
      advisoryBox.className = 'p-3 rounded-xl bg-white border border-emerald-200 text-xs text-slate-700 leading-relaxed';
      advisoryBox.innerHTML = `✅ <strong>Estratégia Equilibrada:</strong> Travar <strong>${calc.hedgePct}%</strong> (${calc.hedgedVol.toLocaleString('pt-BR')} ${u} = <strong>R$ ${calc.hedgedBrl.toLocaleString('pt-BR')}</strong>) garante <strong>${calc.costCoveragePct}%</strong> dos custos da lavoura com folga segura contra quebras climáticas (limite seguro: <strong>${calc.safeHedgeLimitPct}%</strong>).`;
    }
  }

  const profitSign = calc.netProfitBrl >= 0 ? '' : '- ';
  setEl('fut-net-profit-brl', `${profitSign}R$ ${Math.abs(calc.netProfitBrl).toLocaleString('pt-BR')}`);
  setEl('fut-net-profit-ha', `${calc.netProfitHa >= 0 ? '' : '-'}R$ ${Math.abs(calc.netProfitHa).toLocaleString('pt-BR')} / ha (c/ economia de R$ ${calc.ureaSavedHa}/ha em adubo)`);
  setEl('fut-spot-vol', `Livre p/ vender na colheita: ${calc.spotVol.toLocaleString('pt-BR')} ${u} (R$ ${calc.spotBrl.toLocaleString('pt-BR')})`);

  const simpleTotalMargin = document.getElementById('simple-total-margin');
  const simpleUnitMargin = document.getElementById('simple-unit-margin');
  if (simpleTotalMargin && simpleUnitMargin) {
    simpleTotalMargin.textContent = `${profitSign}R$ ${Math.abs(calc.netProfitBrl).toLocaleString('pt-BR')}`;
    simpleUnitMargin.textContent = `R$ ${calc.netProfitHa.toLocaleString('pt-BR')} por hectare (${formatArea(state.areaHa)})`;
  }

  setEl('tech-futures-summary-pill', `Trava Simulada: ${calc.hedgePct}% • Cotação: R$ ${calc.price}/${u}`);
  const techTable = document.getElementById('tech-futures-table');
  if (techTable && state.scenarios.length) {
    techTable.innerHTML = state.scenarios.map(sc => {
      const c = calculateScenarioLossAndFutures(sc.id);
      const isSel = sc.id === state.selectedScenarioId;
      return `
        <div onclick="selectScenario('${sc.id}')" class="p-3.5 rounded-2xl border ${isSel ? 'border-emerald-600 bg-emerald-50/50' : 'border-slate-200 bg-slate-50'} space-y-2 cursor-pointer transition">
          <div class="flex items-center justify-between">
            <span class="font-extrabold text-slate-900">${sc.title}</span>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${c.lossPct <= 12 ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900'}">Quebra: -${c.lossPct}%</span>
          </div>
          <div class="grid grid-cols-2 gap-1.5 text-[11px]">
            <div class="bg-white p-2 rounded-lg border border-slate-200">
              <div class="text-slate-500">Colheita Líquida</div>
              <div class="font-extrabold text-slate-900">${c.netVol.toLocaleString('pt-BR')} ${u}</div>
            </div>
            <div class="bg-white p-2 rounded-lg border border-slate-200">
              <div class="text-slate-500">Perda Estimada</div>
              <div class="font-extrabold text-rose-700">- R$ ${c.lossBrl.toLocaleString('pt-BR')}</div>
            </div>
            <div class="bg-white p-2 rounded-lg border border-slate-200">
              <div class="text-slate-500">Trava Máx. Segura</div>
              <div class="font-extrabold text-sky-900">${c.safeHedgeLimitPct}% (${Math.round(c.netVol * c.safeHedgeLimitPct / 100).toLocaleString('pt-BR')} ${u})</div>
            </div>
            <div class="bg-white p-2 rounded-lg border border-slate-200">
              <div class="text-slate-500">Lucro Líquido</div>
              <div class="font-extrabold text-emerald-800">R$ ${c.netProfitBrl.toLocaleString('pt-BR')}</div>
            </div>
          </div>
          <div class="text-[11px] text-slate-600 flex justify-between pt-0.5">
            <span>Break-even: <strong>${c.breakEvenUnitHa.toString().replace('.', ',')} ${u}/ha</strong></span>
            <span class="text-emerald-800 font-bold">Evita: R$ ${c.avoidedLossBrl.toLocaleString('pt-BR')}</span>
          </div>
        </div>
      `;
    }).join('');
  }
}

function onFuturesInputChange() {
  updateLossAndFuturesUI();
}

function onFuturesHedgeSliderChange() {
  updateLossAndFuturesUI();
}

function applyRecommendedHedge() {
  const calc = calculateScenarioLossAndFutures(state.selectedScenarioId);
  const slider = document.getElementById('fut-hedge-pct');
  if (slider) {
    slider.value = calc.safeHedgeLimitPct;
    updateLossAndFuturesUI();
    showToast(`Trava ajustada para o limite seguro (${calc.safeHedgeLimitPct}%)!`, "emerald");
  }
}

function renderTechScenarios() {
  const container = document.getElementById('scenarios-container');
  if (!container) return;
  container.innerHTML = state.scenarios.map(sc => `
    <div onclick="selectScenario('${sc.id}')" class="bg-white rounded-2xl border ${sc.id === state.selectedScenarioId ? 'border-emerald-600 ring-2 ring-emerald-500/20' : 'border-slate-200'} p-4 space-y-2.5 cursor-pointer transition">
      <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-900">${sc.badge}</span>
      <h3 class="text-sm font-extrabold text-slate-900">${sc.title}</h3>
      <div class="space-y-1.5 text-xs">
        ${sc.cycles.map(c => `<div class="p-2 rounded-lg bg-slate-50 border border-slate-200"><strong>${c.period}:</strong> ${c.crop}</div>`).join('')}
      </div>
      <div class="text-xs font-bold text-emerald-800 pt-1">Margem: R$ ${sc.projectedMarginValue.toLocaleString('pt-BR')}/ha • Economia N: R$ ${sc.ureaSaved}/ha</div>
    </div>
  `).join('');

  const shieldPanel = document.getElementById('agro-shield-panel');
  if (shieldPanel && state.agroShield) {
    const s = state.agroShield;
    shieldPanel.innerHTML = `<div class="p-4 rounded-2xl bg-slate-900 text-white text-xs flex flex-wrap items-center justify-between gap-2">
      <div><strong>Motor Agro Shield (${s.zarcCode}):</strong> ARM ${s.armMm} / CAD ${s.cadMm} mm (${s.pctCad}%) • Kc ${s.kc.toFixed(2)}</div>
      <span class="px-2.5 py-1 rounded-full bg-emerald-600 font-bold">${s.status}</span>
    </div>`;
  }
}

function updateRadarChart() {
  const el = document.getElementById('radarChart');
  if (!el || !state.scenarios.length) return;
  if (radarChart) radarChart.destroy();
  radarChart = new Chart(el.getContext('2d'), {
    type: 'radar',
    data: {
      labels: ['Nitrogênio', 'Erosão', 'Mat. Orgânica', 'Pragas', 'Água', 'Forragem', 'Margem'],
      datasets: [
        { label: 'Equilibrado', data: state.scenarios[0].scores, borderColor: '#059669', backgroundColor: 'rgba(5,150,105,0.2)' },
        { label: 'Venda Rápida', data: state.scenarios[1].scores, borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.15)' },
        { label: 'Proteção Máxima', data: state.scenarios[2].scores, borderColor: '#0f766e', backgroundColor: 'rgba(15,118,110,0.15)' }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false, scales: { r: { min: 30, max: 100 } } }
  });
}

function updateHistoricalChart() {
  const el = document.getElementById('historicalChart');
  if (!el) return;
  const preset = PRESETS[state.regionKey];
  const years = ['2021', '2022', '2023', '2024', '2025', '2026'];
  if (historicalChart) historicalChart.destroy();
  historicalChart = new Chart(el.getContext('2d'), {
    type: 'bar',
    data: {
      labels: years,
      datasets: [
        { type: 'line', label: 'Umidade SMAP (%)', data: years.map(y => preset.history[y].smap), borderColor: '#059669' },
        { type: 'bar', label: 'Dias Solo Nu', data: years.map(y => preset.history[y].bare), backgroundColor: 'rgba(245,158,11,0.6)' }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false }
  });
}

function updateYearView(year) {
  state.selectedYear = Number(year);
  document.getElementById('selected-year-badge').textContent = year;
  updateDiagnosticUI();
  runSimulation();
}

function updatePriorityLabels() {
  const soil = Number(document.getElementById('prio-soil-vs-cash').value);
  document.getElementById('prio-balance-label').textContent = `${100 - soil}% / ${soil}%`;
  document.getElementById('prio-water-val').textContent = `${document.getElementById('prio-water').value}%`;
  document.getElementById('prio-pest-val').textContent = `${document.getElementById('prio-pest').value}%`;
}

// ============================================================================
// WIZARD & EXPERIENCE MODE SWITCHING
// ============================================================================
function goToWizardStep(step) {
  wizardStep = step;
  if (experienceMode !== 'produtor') return;

  document.getElementById('etapa-1').classList.toggle('hidden', step !== 1);
  document.getElementById('etapa-2').classList.toggle('hidden', step !== 2);
  document.getElementById('etapa-3').classList.toggle('hidden', step !== 3);

  [1, 2, 3].forEach(n => {
    const btn = document.getElementById(`wiz-btn-${n}`);
    const badge = btn.querySelector('span');
    const active = n === step;
    const done = n < step;
    btn.className = active
      ? "flex flex-col sm:flex-row items-center gap-1.5 sm:gap-3 p-3 rounded-2xl border-2 border-emerald-600 bg-white shadow-sm text-center sm:text-left transition cursor-pointer"
      : "flex flex-col sm:flex-row items-center gap-1.5 sm:gap-3 p-3 rounded-2xl border border-slate-200 bg-white/80 hover:border-emerald-400 text-center sm:text-left transition cursor-pointer";
    badge.className = active || done
      ? "w-7 h-7 rounded-full bg-emerald-600 text-white text-xs font-extrabold flex items-center justify-center shrink-0"
      : "w-7 h-7 rounded-full bg-slate-200 text-slate-700 text-xs font-extrabold flex items-center justify-center shrink-0";
  });

  if (step === 1 && map) setTimeout(() => map.invalidateSize(), 120);
  if (step === 3) runAgroShieldBonus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function toggleExperienceModeQuick() {
  setExperienceMode(experienceMode === 'produtor' ? 'tecnico' : 'produtor');
}

function setExperienceMode(mode) {
  experienceMode = mode;
  const isSimple = mode === 'produtor';

  document.getElementById('btn-mode-produtor').className = isSimple
    ? "px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer bg-emerald-500 text-slate-950 shadow-sm"
    : "px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer text-emerald-100 hover:text-white";
  document.getElementById('btn-mode-tecnico').className = !isSimple
    ? "px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer bg-emerald-500 text-slate-950 shadow-sm"
    : "px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer text-emerald-100 hover:text-white";

  document.getElementById('telemetry-bar').classList.toggle('hidden', isSimple);
  document.getElementById('wizard-nav').classList.toggle('hidden', !isSimple);
  document.getElementById('farmer-visual-gauges').classList.toggle('hidden', !isSimple);
  document.getElementById('tech-diagnostics-panel').classList.toggle('hidden', isSimple);
  document.getElementById('historical-player-box').classList.toggle('hidden', isSimple);
  document.getElementById('ndvi-controls-bar').classList.toggle('hidden', isSimple);

  document.getElementById('farmer-visual-inputs').classList.toggle('hidden', !isSimple);
  document.getElementById('tech-panel-step2').classList.toggle('hidden', isSimple);
  document.getElementById('wiz-footer-1').classList.toggle('hidden', !isSimple);
  document.getElementById('wiz-footer-2').classList.toggle('hidden', !isSimple);

  document.getElementById('farmer-decision-hub').classList.toggle('hidden', !isSimple);
  document.getElementById('tech-scenarios-wrapper').classList.toggle('hidden', isSimple);

  if (isSimple) {
    syncVisualButtonsFromSelects();
    goToWizardStep(wizardStep || 1);
  } else {
    ['etapa-1', 'etapa-2', 'etapa-3'].forEach(id => document.getElementById(id).classList.remove('hidden'));
    if (map) setTimeout(() => map.invalidateSize(), 120);
  }
}

// ============================================================================
// QUICK SELECTION HELPERS
// ============================================================================
function syncVisualButtonsFromSelects() {
  [
    { selectId: 'input-crop', btnClass: '.quick-crop-btn' },
    { selectId: 'input-soil', btnClass: '.quick-soil-btn' },
    { selectId: 'input-irrigation', btnClass: '.quick-irr-btn' }
  ].forEach(cfg => {
    const val = document.getElementById(cfg.selectId).value;
    document.querySelectorAll(cfg.btnClass).forEach(btn => {
      const isActive = (btn.getAttribute('onclick') || '').includes(`'${val}'`);
      btn.className = btn.className.replace('border-2 border-emerald-600 bg-emerald-50', 'border border-slate-200 bg-white hover:border-emerald-400');
      if (isActive) btn.className = btn.className.replace('border border-slate-200 bg-white hover:border-emerald-400', 'border-2 border-emerald-600 bg-emerald-50');
    });
  });
}

function quickSelectField(field, value, btnEl) {
  const mapIds = {
    crop: { selectId: 'input-crop', btnClass: '.quick-crop-btn' },
    soil: { selectId: 'input-soil', btnClass: '.quick-soil-btn' },
    irrigation: { selectId: 'input-irrigation', btnClass: '.quick-irr-btn' }
  };
  const cfg = mapIds[field];
  if (!cfg) return;
  document.getElementById(cfg.selectId).value = value;
  document.querySelectorAll(cfg.btnClass).forEach(b => {
    b.className = b.className.replace('border-2 border-emerald-600 bg-emerald-50', 'border border-slate-200 bg-white hover:border-emerald-400');
  });
  btnEl.className = btnEl.className.replace('border border-slate-200 bg-white hover:border-emerald-400', 'border-2 border-emerald-600 bg-emerald-50');
  updateDiagnosticUI();
  runSimulation();
}

function selectDapPreset(dap, btnEl) {
  document.getElementById('input-dap').value = dap;
  document.getElementById('val-dap').textContent = `${dap} dias`;
  document.querySelectorAll('.quick-dap-btn').forEach(b => {
    b.className = b.className.replace('border-2 border-emerald-600 bg-emerald-50', 'border border-slate-200 bg-white hover:border-emerald-400');
  });
  if (btnEl) btnEl.className = btnEl.className.replace('border border-slate-200 bg-white hover:border-emerald-400', 'border-2 border-emerald-600 bg-emerald-50');
  runSimulation();
}

function setSimpleMiudas(hasMiudas) {
  document.getElementById('mach-miudas').checked = hasMiudas;
  document.getElementById('simple-miudas-sim').className = hasMiudas
    ? "py-2.5 px-3 rounded-xl text-xs font-extrabold bg-emerald-600 text-white cursor-pointer transition"
    : "py-2.5 px-3 rounded-xl text-xs font-extrabold bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 cursor-pointer transition";
  document.getElementById('simple-miudas-nao').className = !hasMiudas
    ? "py-2.5 px-3 rounded-xl text-xs font-extrabold bg-amber-500 text-slate-950 cursor-pointer transition"
    : "py-2.5 px-3 rounded-xl text-xs font-extrabold bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 cursor-pointer transition";
  runSimulation();
}

function applyFarmerGoal(goal, btnEl) {
  const presets = {
    caixa: { soil: 20, water: 40, pest: 45 },
    equilibrio: { soil: 60, water: 75, pest: 70 },
    solo: { soil: 90, water: 90, pest: 90 }
  };
  const g = presets[goal] || presets.equilibrio;
  document.getElementById('prio-soil-vs-cash').value = g.soil;
  document.getElementById('prio-water').value = g.water;
  document.getElementById('prio-pest').value = g.pest;
  document.querySelectorAll('.goal-btn').forEach(b => {
    b.className = "goal-btn p-2.5 rounded-xl border border-slate-200 bg-white hover:border-emerald-500 text-center cursor-pointer transition";
  });
  if (btnEl) btnEl.className = "goal-btn p-2.5 rounded-xl border-2 border-emerald-600 bg-emerald-50 text-center cursor-pointer transition";
  state.userManuallyPickedScenario = false;
  updatePriorityLabels();
  runSimulation();
}

function useDeviceGPS() {
  if (!navigator.geolocation) {
    showToast("Toque direto no mapa para marcar sua terra!", "amber");
    return;
  }
  showToast("Buscando sua localização...", "emerald");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude, lon = pos.coords.longitude, d = 0.0038;
      const poly = [[lat + d, lon - d], [lat + d, lon + d], [lat - d, lon + d], [lat - d, lon - d]];
      map.setView([lat, lon], 14);
      drawFieldPolygon(poly);
      updateCoordinatesAndFetchOrbital(lat, lon, poly, "Minha Propriedade (GPS)");
      showToast("Localização encontrada!", "emerald");
    },
    () => showToast("Não foi possível usar o GPS. Toque no mapa.", "amber"),
    { timeout: 6000 }
  );
}

// ============================================================================
// REPORT & MODALS
// ============================================================================
function openReportModal() {
  const p = getFarmProfile();
  const chosen = state.scenarios.find(s => s.id === state.selectedScenarioId) || state.scenarios[0];
  const resiliencePct = state.lastResilience[chosen.id] ?? 91;
  const fut = state.lastFuturesCalc || calculateScenarioLossAndFutures(chosen.id);

  const reportText = `🌱 *PLANO SIMPLES DE SAFRA — AGROCYCLE AI*
----------------------------------------
📍 *Local:* ${state.locationLabel}
📐 *Tamanho:* ${formatArea(state.areaHa)}
🌾 *Lavoura Principal:* ${p.crop.toUpperCase()} (${p.soil}, ${p.irrigation})

✅ *${chosen.title.toUpperCase()}*
1️⃣ ${chosen.cycles[0].period}: *${chosen.cycles[0].crop}*
2️⃣ ${chosen.cycles[1].period}: *${chosen.cycles[1].crop}*
3️⃣ ${chosen.cycles[2].period}: *${chosen.cycles[2].crop}*

📊 *ESTIMATIVA DE PERDAS E VENDAS FUTURAS (${fut.cropName.toUpperCase()}):*
• Colheita Prevista (c/ clima): *${fut.netVol.toLocaleString('pt-BR')} ${fut.unitShort}* (${fut.netYieldHa.toString().replace('.', ',')} ${fut.unitShort}/ha)
• Perda / Quebra Estimada (-${fut.lossPct}%): *${fut.lossVol.toLocaleString('pt-BR')} ${fut.unitShort}* (- R$ ${fut.lossBrl.toLocaleString('pt-BR')})
• Prejuízo Evitado pelo Plano: *+ R$ ${fut.avoidedLossBrl.toLocaleString('pt-BR')}*
• Ponto de Equilíbrio (paga custos): *${fut.breakEvenUnitHa.toString().replace('.', ',')} ${fut.unitShort}/ha*
• Trava de Venda Futura (${fut.hedgePct}%): *${fut.hedgedVol.toLocaleString('pt-BR')} ${fut.unitShort}* = *R$ ${fut.hedgedBrl.toLocaleString('pt-BR')}* (cobre ${fut.costCoveragePct}% do custo; limite seguro: até ${fut.safeHedgeLimitPct}%)
• Saldo Livre p/ Colheita (Spot): *${fut.spotVol.toLocaleString('pt-BR')} ${fut.unitShort}* (R$ ${fut.spotBrl.toLocaleString('pt-BR')})

💰 *RESULTADO FINANCEIRO PROJETADO:*
• Lucro Líquido Estimado: *R$ ${fut.netProfitBrl.toLocaleString('pt-BR')}* (R$ ${fut.netProfitHa.toLocaleString('pt-BR')}/ha)
• Economia com adubo (Ureia): *R$ ${chosen.ureaSaved}/ha*
• Resistência ao clima: *${resiliencePct}% da colheita protegida*

💡 *Resumo:* ${chosen.plainExplain}

_Gerado pelo AgroCycle AI. Converse sempre com o técnico ou agrônomo da sua região antes do plantio._`;

  document.getElementById('report-content').textContent = reportText;
  document.getElementById('report-modal').classList.remove('hidden');
}

function closeReportModal() { document.getElementById('report-modal').classList.add('hidden'); }
function openTranslatorModal(topic) {
  const docs = {
    smap: { title: "Água no Solo (SMAP)", body: "Mede a umidade nos primeiros centímetros da terra para saber se há reserva hídrica para germinação." },
    ndvi: { title: "Verde da Lavoura (NDVI)", body: "Mostra onde há planta ativa (verde) e onde a terra está descoberta (vermelho/amarelo)." }
  };
  const d = docs[topic] || docs.smap;
  document.getElementById('trans-title').textContent = d.title;
  document.getElementById('trans-body').textContent = d.body;
  document.getElementById('translator-modal').classList.remove('hidden');
}
function closeTranslatorModal() { document.getElementById('translator-modal').classList.add('hidden'); }
function openScienceModal() { document.getElementById('science-modal').classList.remove('hidden'); }
function closeScienceModal() { document.getElementById('science-modal').classList.add('hidden'); }

async function copyReportToClipboard() {
  const text = document.getElementById('report-content').textContent;
  try {
    await navigator.clipboard.writeText(text);
    showToast("Copiado! Agora é só colar no WhatsApp.", "emerald");
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
    showToast("Copiado! Agora é só colar no WhatsApp.", "emerald");
  }
}

function showToast(message, type = "emerald") {
  const box = document.getElementById('toast-box');
  const toast = document.createElement('div');
  toast.className = `${type === "amber" ? "bg-amber-500 text-slate-950" : "bg-slate-900 text-white border border-emerald-500/40"} px-4 py-3 rounded-2xl shadow-xl text-xs font-bold transition-all duration-300`;
  toast.textContent = message;
  box.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ============================================================================
// PREVISÃO HÍDRICA DIÁRIA (CHART & UI)
// ============================================================================
function renderBonusWaterChart(dashboardData) {
  const canvas = document.getElementById('bonusWaterChart');
  if (!canvas || !window.Chart) return;

  const labels = dashboardData.map(d => {
    const [, m, day] = d.date.split('-');
    return `${day}/${m}`;
  });

  if (bonusWaterChartInstance) bonusWaterChartInstance.destroy();
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 200);
  gradient.addColorStop(0, 'rgba(16, 185, 129, 0.32)');
  gradient.addColorStop(1, 'rgba(16, 185, 129, 0)');

  bonusWaterChartInstance = new Chart(ctx, {
    data: {
      labels,
      datasets: [
        {
          type: 'line',
          label: 'Água estimada no solo (mm)',
          data: dashboardData.map(d => d.arm_mm),
          borderColor: '#059669',
          backgroundColor: gradient,
          borderWidth: 2.5,
          fill: true,
          tension: 0.35,
          pointRadius: 0,
          pointHoverRadius: 4
        },
        {
          type: 'bar',
          label: 'Chuva / Previsão (mm)',
          data: dashboardData.map(d => d.chuva_mm),
          backgroundColor: '#0284c7',
          borderRadius: 3
        },
        {
          type: 'bar',
          label: 'Déficit previsto / Irrigar (mm)',
          data: dashboardData.map(d => d.irrigacao_necessaria_mm),
          backgroundColor: '#f59e0b',
          borderRadius: 3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#475569', font: { size: 11, family: 'Inter' } } }
      },
      scales: {
        x: { ticks: { color: '#64748b', maxTicksLimit: 8, font: { size: 10 } }, grid: { display: false } },
        y: { ticks: { color: '#64748b', font: { size: 10 }, callback: v => `${v}mm` }, grid: { color: 'rgba(148,163,184,0.18)' } }
      }
    }
  });
}

async function runAgroShieldBonus() {
  const sourcePill = document.getElementById('bonus-source-pill');
  if (!sourcePill) return;
  sourcePill.textContent = 'Calculando previsão...';

  const p = getFarmProfile();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = bonusToISODate(today);
  const effectiveDap = Math.max(10, Math.min(140, Number(p.dap) || 20));
  const plantingDate = bonusAddDays(today, -effectiveDap);

  const soil = await bonusFetchSoilProperties(state.lat, state.lon);
  const tipoSolo = bonusClassifySoil(soil.clay, soil.sand);
  let vwc33 = soil.wv0033 > 1.0 ? soil.wv0033 / 100.0 : soil.wv0033;
  let vwc1500 = soil.wv1500 > 1.0 ? soil.wv1500 / 100.0 : soil.wv1500;
  const ad = bonusCalculateAD(vwc33, vwc1500, tipoSolo);

  const apiLimitDate = bonusAddDays(today, -90);
  const startWeather = plantingDate > apiLimitDate ? plantingDate : apiLimitDate;
  const endWeather = bonusAddDays(today, 7);

  const weather = await bonusFetchWeatherData(
    state.lat,
    state.lon,
    bonusToISODate(startWeather),
    bonusToISODate(endWeather)
  );

  const simResults = bonusRunWaterBalanceSimulation(weather.rows, ad, plantingDate, vwc33, vwc1500, p.crop);

  let armAtual = 0, cadAtual = 0, alertaIrrigacao = false, diasAteSeca = 0;
  let mensagemStatus = 'Solo com umidade adequada';
  let currentStatus = 'Úmido';

  const dashboardData = [];
  for (let i = 0; i < simResults.length; i++) {
    const res = simResults[i];
    let irrNec = 0;
    if (res.date >= todayStr && res.arm_mm < 0.5 * res.cad_diaria_mm) {
      irrNec = Math.round((res.cad_diaria_mm - res.arm_mm) * 100) / 100;
    }
    dashboardData.push({
      date: res.date,
      arm_mm: res.arm_mm,
      chuva_mm: res.chuva_mm,
      eto_mm: res.eto_mm,
      irrigacao_necessaria_mm: irrNec
    });

    if (res.date === todayStr) {
      armAtual = res.arm_mm;
      cadAtual = res.cad_diaria_mm;
      if (armAtual <= 0.5 * cadAtual) {
        currentStatus = 'Seco';
        mensagemStatus = 'Atenção: água abaixo do limite seguro';
      }
    }

    if (res.date > todayStr && !alertaIrrigacao && res.arm_mm <= 0.5 * res.cad_diaria_mm) {
      alertaIrrigacao = true;
      diasAteSeca = bonusDiffDays(bonusParseISODate(res.date), today);
      const chuvaPrev = res.chuva_mm;
      const chuvaAnt = i > 0 ? simResults[i - 1].chuva_mm : 0;
      if (chuvaPrev > 10 || chuvaAnt > 10) {
        alertaIrrigacao = false;
        mensagemStatus = `Chuva prevista (${Math.max(chuvaPrev, chuvaAnt)} mm) supre a planta`;
      } else {
        mensagemStatus = `Irrigar em até ${diasAteSeca} dias`;
      }
    }
  }

  const statusEl = document.getElementById('bonus-res-status');
  statusEl.textContent = currentStatus;
  statusEl.className = `text-lg font-extrabold ${currentStatus === 'Seco' ? 'text-rose-600' : 'text-emerald-700'}`;
  document.getElementById('bonus-res-msg').textContent = mensagemStatus;
  document.getElementById('bonus-res-soil').textContent = `Solo: ${tipoSolo}`;
  document.getElementById('bonus-res-cad').textContent = `Máx: ${cadAtual.toFixed(1)} mm`;
  sourcePill.textContent = `${soil.source} • ${weather.source}`;

  document.getElementById('bonus-res-arm').textContent = armAtual.toFixed(1);
  const pct = cadAtual > 0 ? Math.min(100, Math.round((armAtual / cadAtual) * 100)) : 0;
  const barEl = document.getElementById('bonus-res-arm-bar');
  barEl.style.width = `${pct}%`;
  barEl.className = `h-full rounded-full transition-all duration-500 ${pct <= 50 ? 'bg-amber-500' : 'bg-emerald-500'}`;
  document.getElementById('bonus-res-pct').textContent = `${pct}% da capacidade útil`;

  const irrTitle = document.getElementById('bonus-res-irr-title');
  const irrSub = document.getElementById('bonus-res-irr-sub');
  if (alertaIrrigacao) {
    irrTitle.textContent = `${diasAteSeca} dias`;
    irrTitle.className = 'text-lg font-extrabold text-amber-600';
    irrSub.textContent = 'Atenção necessária na semana';
  } else {
    irrTitle.textContent = 'Seguro';
    irrTitle.className = 'text-lg font-extrabold text-emerald-700';
    irrSub.textContent = 'Sem falta imediata prevista';
  }

  renderBonusWaterChart(dashboardData);
}

// ============================================================================
// BOLSA DE VALORES & COMMODITIES (B3 / CÂMBIO / CBOT)
// ============================================================================
let currentMarketData = null;

function formatMarketChangeBadge(pct) {
  const val = Number(pct || 0);
  const sign = val > 0 ? '+' : '';
  const cls = val > 0
    ? 'bg-emerald-100 text-emerald-800'
    : (val < 0 ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-700');
  return `<span class="px-1.5 py-0.5 rounded text-[10px] font-extrabold ${cls}">${sign}${val.toFixed(2).replace('.', ',')}%</span>`;
}

function renderMarketPanel(data) {
  if (!data) return;
  currentMarketData = data;

  const statusPill = document.getElementById('market-status-pill');
  const updatedEl = document.getElementById('market-updated-at');
  if (statusPill) {
    if (data.isLiveFx && data.isLiveB3) {
      statusPill.textContent = 'Ao Vivo (Câmbio + B3)';
      statusPill.className = 'px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 text-[10px] font-extrabold uppercase';
    } else if (data.isLiveFx) {
      statusPill.textContent = 'Câmbio Ao Vivo';
      statusPill.className = 'px-2 py-0.5 rounded-full bg-sky-100 text-sky-900 text-[10px] font-extrabold uppercase';
    } else {
      statusPill.textContent = 'Referência Offline';
      statusPill.className = 'px-2 py-0.5 rounded-full bg-slate-200 text-slate-800 text-[10px] font-extrabold uppercase';
    }
  }
  if (updatedEl) {
    updatedEl.textContent = data.updatedAt ? `Atualizado às ${data.updatedAt}` : 'Modo Offline';
  }

  // 1. Macro Bar: USD/BRL, EUR/BRL e IBOVESPA
  const macroBar = document.getElementById('market-macro-bar');
  if (macroBar) {
    const ibov = (data.stocks || []).find(s => s.symbol === '^BVSP') || { symbol: '^BVSP', shortName: 'IBOVESPA', price: 127850, changePct: 0.54, isLive: false };
    const usd = data.fx?.USD || { code: 'USD/BRL', name: 'Dólar Comercial', bid: 5.78, pctChange: 0 };
    const eur = data.fx?.EUR || { code: 'EUR/BRL', name: 'Euro Comercial', bid: 6.14, pctChange: 0 };

    macroBar.innerHTML = `
      <div class="p-3 rounded-2xl bg-white border border-slate-200 flex items-center justify-between">
        <div>
          <div class="text-[10px] font-extrabold uppercase text-slate-500">💵 ${usd.name}</div>
          <div class="text-base font-extrabold text-slate-900 mt-0.5">R$ ${usd.bid.toFixed(2).replace('.', ',')}</div>
        </div>
        <div class="text-right space-y-1">
          ${formatMarketChangeBadge(usd.pctChange)}
          <div class="text-[10px] text-slate-400 font-semibold">${data.isLiveFx ? 'AwesomeAPI' : 'Offline'}</div>
        </div>
      </div>
      <div class="p-3 rounded-2xl bg-white border border-slate-200 flex items-center justify-between">
        <div>
          <div class="text-[10px] font-extrabold uppercase text-slate-500">💶 ${eur.name}</div>
          <div class="text-base font-extrabold text-slate-900 mt-0.5">R$ ${eur.bid.toFixed(2).replace('.', ',')}</div>
        </div>
        <div class="text-right space-y-1">
          ${formatMarketChangeBadge(eur.pctChange)}
          <div class="text-[10px] text-slate-400 font-semibold">${data.isLiveFx ? 'AwesomeAPI' : 'Offline'}</div>
        </div>
      </div>
      <div class="p-3 rounded-2xl bg-white border border-slate-200 flex items-center justify-between">
        <div>
          <div class="text-[10px] font-extrabold uppercase text-slate-500">🏛️ IBOVESPA (B3)</div>
          <div class="text-base font-extrabold text-slate-900 mt-0.5">${ibov.price ? Math.round(ibov.price).toLocaleString('pt-BR') + ' pts' : '-'}</div>
        </div>
        <div class="text-right space-y-1">
          ${formatMarketChangeBadge(ibov.changePct)}
          <div class="text-[10px] text-slate-400 font-semibold">${ibov.isLive ? 'B3 Ao Vivo' : 'Referência'}</div>
        </div>
      </div>
    `;
  }

  // 2. Commodities List
  const commList = document.getElementById('market-commodities-list');
  if (commList) {
    commList.innerHTML = (data.commodities || []).map(c => {
      const canApply = Boolean(c.cropKey);
      return `
        <div class="py-2 flex items-center justify-between gap-2">
          <div class="min-w-0">
            <div class="text-xs font-extrabold text-slate-900 truncate">${c.name}</div>
            <div class="text-[10px] text-slate-500">${c.exchange} • Ref: ${c.intlQuote} ${c.intlUnit}</div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <div class="text-right">
              <div class="text-xs font-extrabold text-slate-900">R$ ${Number(c.priceBrl).toLocaleString('pt-BR')} <span class="text-[10px] font-semibold text-slate-500">/${c.unit}</span></div>
              <div>${formatMarketChangeBadge(c.pctChange)}</div>
            </div>
            ${canApply ? `
              <button type="button" onclick="applyMarketPriceToFutures('${c.cropKey}', ${c.priceBrl})" class="px-2 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-900 text-[10px] font-extrabold transition cursor-pointer" title="Aplicar cotação no simulador de vendas futuras">
                Usar
              </button>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  // 3. B3 Stocks Grid (excluindo ^BVSP que já está no macro bar)
  const stocksList = document.getElementById('market-stocks-list');
  if (stocksList) {
    const customSaved = typeof getSavedCustomTickers === 'function' ? getSavedCustomTickers() : [];
    const stocks = (data.stocks || []).filter(s => s.symbol !== '^BVSP');
    stocksList.innerHTML = stocks.map(s => {
      const isCustom = customSaved.includes(s.symbol);
      const priceText = typeof s.price === 'number'
        ? `R$ ${s.price.toFixed(2).replace('.', ',')}`
        : 'Indisponível';
      return `
        <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-2">
          <div class="min-w-0">
            <div class="flex items-center gap-1.5">
              <span class="text-xs font-extrabold text-slate-900">${s.symbol}</span>
              ${s.isLive ? '<span class="w-1.5 h-1.5 rounded-full bg-emerald-500" title="Cotação ao vivo"></span>' : ''}
              ${isCustom ? `<button type="button" onclick="removeCustomB3Ticker('${s.symbol}')" class="text-[10px] text-slate-400 hover:text-rose-600 font-bold cursor-pointer" title="Remover ativo">✕</button>` : ''}
            </div>
            <div class="text-[10px] text-slate-500 truncate">${s.shortName}</div>
          </div>
          <div class="text-right shrink-0">
            <div class="text-xs font-extrabold text-slate-900">${priceText}</div>
            <div>${formatMarketChangeBadge(s.changePct)}</div>
          </div>
        </div>
      `;
    }).join('');
  }
}

async function refreshMarketQuotes() {
  const btn = document.getElementById('btn-refresh-market');
  const pill = document.getElementById('market-status-pill');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Atualizando...';
  }
  if (pill) {
    pill.textContent = 'Buscando...';
    pill.className = 'px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-extrabold uppercase';
  }

  try {
    const customTickers = typeof getSavedCustomTickers === 'function' ? getSavedCustomTickers() : [];
    const data = await fetchLiveMarketData(customTickers);
    renderMarketPanel(data);
  } catch (err) {
    console.warn('Market refresh failed:', err);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🔄 Atualizar Bolsa';
    }
  }
}

function applyMarketPriceToFutures(cropKey, priceBrl) {
  if (!priceBrl || priceBrl <= 0) return;
  const p = getSelectedScenarioParams();
  if (p.crop !== cropKey) {
    const cropSel = document.getElementById('sel-crop');
    if (cropSel) {
      cropSel.value = cropKey;
      syncVisualButtonsFromSelects();
      updateDiagnosticUI();
      runSimulation();
    }
  }
  const priceEl = document.getElementById('fut-price');
  if (priceEl) {
    priceEl.value = Math.round(priceBrl);
    onFuturesInputChange();
    const card = document.getElementById('loss-and-futures-card');
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function pullActiveCropPriceFromMarket() {
  const p = getSelectedScenarioParams();
  const commodities = currentMarketData?.commodities || [];
  const match = commodities.find(c => c.cropKey === p.crop);
  if (match && match.priceBrl) {
    applyMarketPriceToFutures(p.crop, match.priceBrl);
  } else {
    const cfg = CROP_ECONOMICS[p.crop] || CROP_ECONOMICS.soja;
    const priceEl = document.getElementById('fut-price');
    if (priceEl) {
      priceEl.value = cfg.price;
      onFuturesInputChange();
    }
  }
}

function addCustomB3Ticker() {
  const input = document.getElementById('market-add-ticker');
  if (!input) return;
  const raw = input.value.trim().toUpperCase().replace(/[^A-Z0-9.^]/g, '');
  if (!raw) return;
  const list = getSavedCustomTickers();
  if (!list.includes(raw) && !DEFAULT_B3_TICKERS.includes(raw)) {
    list.push(raw);
    saveCustomTickersToStorage(list);
  }
  input.value = '';
  refreshMarketQuotes();
}

function removeCustomB3Ticker(symbol) {
  const list = getSavedCustomTickers().filter(t => t !== symbol);
  saveCustomTickersToStorage(list);
  refreshMarketQuotes();
}

function saveBrapiToken() {
  const input = document.getElementById('market-brapi-token');
  if (!input) return;
  saveBrapiTokenToStorage(input.value);
  refreshMarketQuotes();
}

function initMarketPanel() {
  const tokenInput = document.getElementById('market-brapi-token');
  if (tokenInput && typeof getSavedBrapiToken === 'function') {
    tokenInput.value = getSavedBrapiToken();
  }
  if (typeof MARKET_FALLBACK !== 'undefined') {
    const usd = MARKET_FALLBACK.fx.USD.bid;
    renderMarketPanel({
      ...MARKET_FALLBACK,
      commodities: MARKET_FALLBACK.commodities.map(c => ({ ...c, priceBrl: c.calcBrl(usd) }))
    });
    refreshMarketQuotes();
  }
}

// ============================================================================
// BOOTSTRAP
// ============================================================================
window.addEventListener('DOMContentLoaded', () => {
  if (typeof lucide !== 'undefined') lucide.createIcons();
  if (typeof L !== 'undefined') initMap();
  setExperienceMode('produtor');
  syncVisualButtonsFromSelects();
  updateDiagnosticUI();
  updateHistoricalChart();
  runSimulation();
  fetchNasaPowerClimatology(state.lat, state.lon);
  fetchPlanetaryComputerNDVI(state.currentPolygon);
  initMarketPanel();
});
