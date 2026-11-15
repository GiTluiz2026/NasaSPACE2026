// ============================================================================
// BACKEND ORBITAL & METEOROLOGICAL SERVICES
// (NASA POWER, Sentinel-2 STAC, ISRIC SoilGrids v2.0, Open-Meteo API)
// ============================================================================

function polygonToGeoJsonRing(latlngs) {
  const ring = latlngs.map(pt => [Number(pt[1].toFixed(6)), Number(pt[0].toFixed(6))]);
  if (ring.length > 0 && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) {
    ring.push([ring[0][0], ring[0][1]]);
  }
  return ring;
}

function bonusToISODate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function bonusParseISODate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function bonusAddDays(d, days) {
  const copy = new Date(d.getTime());
  copy.setDate(copy.getDate() + days);
  return copy;
}

function bonusDiffDays(a, b) {
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((utcA - utcB) / 86400000);
}

async function fetchPlanetaryComputerNDVI(polygonLatLngs) {
  const stacBadge = document.getElementById('status-stac');
  const preset = PRESETS[state.regionKey];
  const geojsonPoly = { type: "Polygon", coordinates: [polygonToGeoJsonRing(polygonLatLngs)] };
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - 180);
  const dtRange = `${startDate.toISOString().split('T')[0]}T00:00:00Z/${endDate.toISOString().split('T')[0]}T23:59:59Z`;

  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 7500);
    const res = await fetch('https://planetarycomputer.microsoft.com/api/stac/v1/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        collections: ['sentinel-2-l2a'],
        intersects: geojsonPoly,
        datetime: dtRange,
        query: { 'eo:cloud_cover': { lt: 45 } },
        limit: 3,
        sortby: [{ field: 'properties.datetime', direction: 'desc' }]
      })
    });
    clearTimeout(tid);
    if (!res.ok) throw new Error('STAC error');
    const data = await res.json();

    if (!data.features || data.features.length === 0) {
      state.stacLive = false;
      state.stacNoScene = true;
      state.stacItemId = null;
      state.stacBbox = null;
      state.ndviCurrent = estimateClimateNdvi(state.nasaRain, state.nasaTemp);
      if (stacBadge) stacBadge.textContent = "STAC: Sem cena terrestre";
    } else {
      const feat = data.features[0];
      state.stacLive = true;
      state.stacNoScene = false;
      state.stacItemId = feat.id;
      state.stacCollection = feat.collection || 'sentinel-2-l2a';
      state.stacBbox = Array.isArray(feat.bbox) && feat.bbox.length >= 4 ? feat.bbox : null;
      state.stacDate = (feat.properties.datetime || '').split('T')[0];
      state.stacCloudCover = Number((feat.properties['eo:cloud_cover'] ?? 10).toFixed(1));

      try {
        const statsCtrl = new AbortController();
        const statsTid = setTimeout(() => statsCtrl.abort(), 7000);
        const statsUrl = `https://planetarycomputer.microsoft.com/api/data/v1/item/statistics?collection=${encodeURIComponent(state.stacCollection)}&item=${encodeURIComponent(state.stacItemId)}&assets=B08&assets=B04&expression=(B08-B04)/(B08%2BB04)&asset_as_band=true`;
        const statsRes = await fetch(statsUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: statsCtrl.signal,
          body: JSON.stringify({ type: 'Feature', properties: {}, geometry: geojsonPoly })
        });
        clearTimeout(statsTid);

        if (statsRes.ok) {
          const statsJson = await statsRes.json();
          const firstKey = Object.keys(statsJson)[0];
          const bandStats = statsJson[firstKey] || statsJson;
          if (bandStats && typeof bandStats.mean === 'number' && !isNaN(bandStats.mean)) {
            state.ndviCurrent = Number(Math.max(-0.1, Math.min(0.95, bandStats.mean)).toFixed(2));
          }
        }
      } catch (statsErr) {
        state.ndviCurrent = state.isCustomLocation
          ? estimateClimateNdvi(state.nasaRain, state.nasaTemp)
          : (preset.history[state.selectedYear]?.ndvi ?? preset.ndviOff);
      }

      if (stacBadge) stacBadge.textContent = `STAC Sentinel-2: Online (${state.stacDate})`;
    }
  } catch (e) {
    state.stacLive = false;
    state.stacNoScene = false;
    state.ndviCurrent = state.isCustomLocation
      ? estimateClimateNdvi(state.nasaRain, state.nasaTemp)
      : (preset.history[state.selectedYear]?.ndvi ?? preset.ndviOff);
    if (stacBadge) stacBadge.textContent = "STAC: Cache Regional";
  }

  renderNdviMapLayer();
  updateDiagnosticUI();
  runSimulation();
}

async function fetchNasaPowerClimatology(lat, lon) {
  const statusBadge = document.getElementById('status-nasa-power');
  const url = `https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=T2M,T2M_MIN,PRECTOTCORR,ALLSKY_SFC_SW_DWN&community=AG&longitude=${lon.toFixed(4)}&latitude=${lat.toFixed(4)}&format=JSON`;
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 6500);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(tid);
    if (!res.ok) throw new Error("NASA HTTP");
    const data = await res.json();
    const params = data.properties.parameter;
    const tempAnn = Number(params.T2M?.ANN);
    const tminMonthly = params.T2M_MIN ? Object.entries(params.T2M_MIN).filter(([k]) => k !== 'ANN').map(([, v]) => Number(v)) : [];
    const rainDaily = Number(params.PRECTOTCORR?.ANN);
    const solarAnn = Number(params.ALLSKY_SFC_SW_DWN?.ANN);

    if (!isNaN(tempAnn) && tempAnn > -50) {
      state.nasaTemp = Number(tempAnn.toFixed(1));
      state.nasaTmin = tminMonthly.length ? Number(Math.min(...tminMonthly).toFixed(1)) : Number((tempAnn - 10.5).toFixed(1));
      state.nasaRain = Math.round(rainDaily * 365);
      state.nasaSolar = Number(solarAnn.toFixed(1));
      state.nasaLive = true;
      if (statusBadge) statusBadge.textContent = "NASA POWER: Online";
    } else {
      throw new Error("Invalid values");
    }
  } catch (e) {
    const preset = PRESETS[state.regionKey];
    const latShift = lat - preset.lat;
    state.nasaTemp = Number((preset.fallbackTemp + latShift * 0.35).toFixed(1));
    state.nasaTmin = Number((preset.fallbackTmin + latShift * 0.45).toFixed(1));
    state.nasaRain = preset.fallbackRain;
    state.nasaSolar = preset.fallbackSolar;
    state.nasaLive = false;
    if (statusBadge) statusBadge.textContent = "NASA POWER: Cache Regional";
  }
  updateDiagnosticUI();
  runSimulation();
}

async function bonusFetchSoilProperties(lat, lon) {
  const cacheKey = `agroshield_soil_${lat.toFixed(4)}_${lon.toFixed(4)}`;
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch {}

  const url = new URL('https://rest.isric.org/soilgrids/v2.0/properties/query');
  url.searchParams.set('lon', lon);
  url.searchParams.set('lat', lat);
  ['clay', 'sand', 'wv0033', 'wv1500'].forEach(p => url.searchParams.append('property', p));
  ['0-5cm', '5-15cm'].forEach(d => url.searchParams.append('depth', d));
  url.searchParams.set('value', 'mean');

  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 9000);
    const resp = await fetch(url.toString(), { signal: ctrl.signal });
    clearTimeout(tid);
    if (!resp.ok) throw new Error(`SoilGrids HTTP ${resp.status}`);
    const data = await resp.json();

    const results = {};
    for (const layer of (data?.properties?.layers || [])) {
      const dFactor = layer.unit_measure?.d_factor || 1;
      const depths = layer.depths || [];
      if (!depths.length) continue;
      const values = depths.map(d => d.values?.mean ?? 0);
      results[layer.name] = (values.reduce((a, b) => a + b, 0) / values.length) / dFactor;
    }

    if ((results.clay || 0) === 0 && (results.sand || 0) === 0) throw new Error('Solo vazio');
    const payload = {
      clay: results.clay ?? 28,
      sand: results.sand ?? 42,
      wv0033: results.wv0033 ?? 0.30,
      wv1500: results.wv1500 ?? 0.19,
      source: 'SoilGrids'
    };
    try { localStorage.setItem(cacheKey, JSON.stringify(payload)); } catch {}
    return payload;
  } catch {
    return { clay: 28.0, sand: 42.0, wv0033: 0.30, wv1500: 0.19, source: 'Solo Estimado' };
  }
}

async function bonusFetchWeatherData(lat, lon, startDateStr, endDateStr) {
  const cacheKey = `agroshield_weather_${lat.toFixed(3)}_${lon.toFixed(3)}_${startDateStr}_${endDateStr}`;
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Date.now() - parsed.ts < 3600 * 1000) return parsed;
    }
  } catch {}

  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', lat);
  url.searchParams.set('longitude', lon);
  url.searchParams.set('start_date', startDateStr);
  url.searchParams.set('end_date', endDateStr);
  url.searchParams.set('daily', 'precipitation_sum,et0_fao_evapotranspiration');
  url.searchParams.set('hourly', 'soil_moisture_0_to_7cm');
  url.searchParams.set('timezone', 'America/Sao_Paulo');

  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 10000);
    const resp = await fetch(url.toString(), { signal: ctrl.signal });
    clearTimeout(tid);
    if (!resp.ok) throw new Error(`Open-Meteo HTTP ${resp.status}`);
    const data = await resp.json();

    const hourlyByDay = {};
    const hTimes = data?.hourly?.time || [];
    const hSm = data?.hourly?.soil_moisture_0_to_7cm || [];
    for (let i = 0; i < hTimes.length; i++) {
      const day = hTimes[i].slice(0, 10);
      const val = hSm[i];
      if (val !== null && val !== undefined) {
        if (!hourlyByDay[day]) hourlyByDay[day] = [];
        hourlyByDay[day].push(val);
      }
    }

    const dTimes = data?.daily?.time || [];
    const dRain = data?.daily?.precipitation_sum || [];
    const dEto = data?.daily?.et0_fao_evapotranspiration || [];
    const rows = dTimes.map((dateStr, idx) => {
      const smArr = hourlyByDay[dateStr];
      return {
        date: dateStr,
        precipitation_sum: dRain[idx] ?? 0,
        et0_fao_evapotranspiration: dEto[idx] ?? 0,
        satellite_soil_moisture: smArr && smArr.length ? smArr.reduce((a, b) => a + b, 0) / smArr.length : null
      };
    });

    const payload = { rows, source: 'Open-Meteo', ts: Date.now() };
    try { localStorage.setItem(cacheKey, JSON.stringify(payload)); } catch {}
    return payload;
  } catch {
    const rows = [];
    const start = bonusParseISODate(startDateStr);
    const total = bonusDiffDays(bonusParseISODate(endDateStr), start);
    for (let i = 0; i <= total; i++) {
      const cur = bonusAddDays(start, i);
      const seed = Math.abs(Math.sin(i * 1.7 + lat + lon));
      rows.push({
        date: bonusToISODate(cur),
        precipitation_sum: seed > 0.72 ? Math.round(seed * 24 * 10) / 10 : 0,
        et0_fao_evapotranspiration: Math.round((3.2 + seed * 2.1) * 10) / 10,
        satellite_soil_moisture: 0.24 + (seed - 0.5) * 0.04
      });
    }
    return { rows, source: 'Clima Simulado', ts: Date.now() };
  }
}
