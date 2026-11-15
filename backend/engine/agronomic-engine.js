// ============================================================================
// BACKEND AGRONOMIC, BIOPHYSICAL & FINANCIAL ENGINE
// ============================================================================

function calculatePolygonAreaHa(latlngs) {
  if (!latlngs || latlngs.length < 3) return 50.0;
  const earthRadius = 6378137;
  let area = 0;
  for (let i = 0; i < latlngs.length; i++) {
    const p1 = latlngs[i];
    const p2 = latlngs[(i + 1) % latlngs.length];
    const lat1 = p1[0] * Math.PI / 180;
    const lat2 = p2[0] * Math.PI / 180;
    const dLon = (p2[1] - p1[1]) * Math.PI / 180;
    area += dLon * (2 + Math.sin(lat1) + Math.sin(lat2));
  }
  area = Math.abs(area * earthRadius * earthRadius / 2.0);
  return Math.max(1.0, Math.min(25000, area / 10000.0));
}

function estimateClimateNdvi(rainMm, tempC) {
  if (tempC < 0) return 0.12;
  const aridity = rainMm / Math.max(150, (tempC + 10) * 45);
  return Number(Math.max(0.10, Math.min(0.82, 0.14 + aridity * 0.48)).toFixed(2));
}

function computeEt0HargreavesSamani(tempC, solarMjM2Day) {
  return Number(Math.max(1.0, 0.0135 * (tempC + 17.78) * (solarMjM2Day / 2.45)).toFixed(2));
}

function computeWaterBalance(rainMmYear, et0MmDay) {
  return Math.round(rainMmYear - (et0MmDay * 365.0));
}

function computeFao33YieldPreservation(ky, rainDeltaPct, tempDeltaC, baseTempC, solarMjM2Day, mulchEsReduction, irrigated, frostActive, frostTolerance) {
  let etaEtc;
  if (irrigated) {
    etaEtc = Math.max(0.75, Math.min(1.0, 0.98 - Math.max(0, tempDeltaC) * 0.015 + mulchEsReduction * 0.05));
  } else {
    const et0Base = computeEt0HargreavesSamani(baseTempC, solarMjM2Day);
    const et0Stressed = computeEt0HargreavesSamani(baseTempC + tempDeltaC, solarMjM2Day);
    const effectiveSupply = (1.0 + rainDeltaPct / 100.0) * (1.0 + mulchEsReduction * 0.38);
    etaEtc = Math.max(0.35, Math.min(1.0, effectiveSupply * (et0Base / et0Stressed)));
  }
  let preserved = (1.0 - ky * (1.0 - etaEtc)) * 100;
  if (frostActive) preserved -= (1 - frostTolerance) * 22;
  return Math.round(Math.max(22, Math.min(99, preserved)));
}

function computeUreaSavingsBrl(nFixedKgHa) {
  return Math.round(((nFixedKgHa * 0.50) / 0.45) * 3.20);
}

function computeAgroShieldDecision(p, eff, currentState, stressRainPct = 0, stressTempDelta = 0) {
  const zarc = classifySoilZarc(p.soil);
  const dap = Number(p.dap ?? 20);
  const baseEto = Math.max(1.8, 0.0135 * (currentState.nasaTemp + stressTempDelta + 17.78) * (currentState.nasaSolar / 2.45));
  const dailyRainAvg = Math.max(0.2, (currentState.nasaRain / 365) * (1 + stressRainPct / 100));

  const { kc: kc0, zCm: z0 } = obterParametrosCulturaAgroShield(p.crop, dap);
  const cad0 = zarc.ad * z0 * 10.0;
  const smapSatFraction = Math.max(0.18, Math.min(0.95, (eff.smapMoisture - 8) / 28));
  let arm = Math.max(0, Math.min(cad0, smapSatFraction * cad0));
  if (p.irrigation === 'irrigado') arm = Math.max(arm, 0.78 * cad0);

  const armAtual = arm, cadAtual = cad0;
  const statusAtual = armAtual <= 0.5 * cadAtual ? 'Seco' : 'Úmido';
  let alertaIrrigacao = false, diasAteSeca = 14;

  for (let d = 1; d <= 14; d++) {
    const { kc, zCm } = obterParametrosCulturaAgroShield(p.crop, dap + d);
    const cadDiaria = zarc.ad * zCm * 10.0;
    const etc = baseEto * kc;
    const chuvaDia = stressRainPct <= -15 ? dailyRainAvg * 0.35 : (d % 4 === 0 ? dailyRainAvg * 2.2 : dailyRainAvg * 0.45);
    let armCalc = Math.max(0, Math.min(cadDiaria, arm + chuvaDia - etc));
    const satArm = smapSatFraction * cadDiaria;
    if (Math.abs(armCalc - satArm) > 0.2 * cadDiaria) armCalc = armCalc * 0.7 + satArm * 0.3;
    arm = armCalc;
    if (!alertaIrrigacao && arm <= 0.5 * cadDiaria) { alertaIrrigacao = true; diasAteSeca = d; }
  }

  const pctCad = Math.round((armAtual / Math.max(1, cadAtual)) * 100);
  let mensagemStatus = 'Terra com boa umidade para os próximos 14 dias';
  if (statusAtual === 'Seco') {
    mensagemStatus = p.irrigation === 'irrigado'
      ? 'Terra seca: hora de ligar a irrigação para não perder produção'
      : 'Terra com pouca água: cubra o solo com palhada antes de plantar';
  } else if (alertaIrrigacao) {
    mensagemStatus = p.irrigation === 'irrigado'
      ? `Atenção: programar irrigação em até ${diasAteSeca} dias`
      : `Atenção: umidade segura por cerca de ${diasAteSeca} dias sem chuva`;
  }

  return {
    zarcCode: zarc.zarcCode, ad: zarc.ad, dap, kc: kc0, zCm: Math.round(z0),
    cadMm: Math.round(cadAtual * 10) / 10, armMm: Math.round(armAtual * 10) / 10,
    pctCad, status: statusAtual, alertaIrrigacao, diasAteSeca, mensagemStatus
  };
}

function bonusClassifySoil(clayPercent, sandPercent) {
  if (clayPercent >= 35.0) return 'Argiloso';
  if (clayPercent >= 15.0 && clayPercent < 35.0) return sandPercent < 85.0 ? 'Médio' : 'Arenoso';
  return 'Arenoso';
}

function bonusCalculateAD(vwc33, vwc1500, tipoSolo = 'Médio') {
  const ad = vwc33 - vwc1500;
  if (!(ad > 0)) {
    const fallbacks = { Argiloso: 0.15, 'Médio': 0.11, Arenoso: 0.07 };
    return fallbacks[tipoSolo] ?? 0.11;
  }
  return ad;
}

function bonusRunWaterBalanceSimulation(weatherRows, ad, plantingDate, vwc33, vwc1500, cultura) {
  const results = [];
  let armPrev = null;

  for (const row of weatherRows) {
    const dap = bonusDiffDays(bonusParseISODate(row.date), plantingDate);
    if (dap < 0) continue;

    const { kc, zCm } = obterParametrosCulturaAgroShield(cultura, dap);
    const cadDiaria = ad * zCm * 10.0;
    const satSm = row.satellite_soil_moisture;
    const adRef = vwc33 - vwc1500;

    if (armPrev === null) {
      if (satSm !== null && satSm !== undefined && !Number.isNaN(satSm) && adRef > 0) {
        const satFraction = (satSm - vwc1500) / adRef;
        armPrev = Math.max(0.0, Math.min(satFraction * cadDiaria, cadDiaria));
      } else {
        armPrev = cadDiaria;
      }
    }

    const eto = row.et0_fao_evapotranspiration || 0.0;
    const chuva = row.precipitation_sum || 0.0;
    let armCalc = Math.max(0.0, Math.min(armPrev + chuva - (eto * kc), cadDiaria));

    if (satSm !== null && satSm !== undefined && !Number.isNaN(satSm) && adRef > 0) {
      const satArm = Math.max(0.0, Math.min(((satSm - vwc1500) / adRef) * cadDiaria, cadDiaria));
      if (Math.abs(armCalc - satArm) > 0.2 * cadDiaria) {
        armCalc = armCalc * 0.7 + satArm * 0.3;
      }
    }

    results.push({
      date: row.date,
      arm_mm: Math.round(armCalc * 100) / 100,
      cad_diaria_mm: Math.round(cadDiaria * 100) / 100,
      chuva_mm: Math.round(chuva * 100) / 100,
      eto_mm: Math.round(eto * 100) / 100
    });
    armPrev = armCalc;
  }
  return results;
}

function getCropPhenologyStage(cultura, dap) {
  const c = (cultura || 'soja').toLowerCase();
  const d = Number(dap || 20);
  if (c === 'soja') {
    if (d <= 15) return { code: 'VE–V2', name: 'Emergência e Raiz Inicial', critical: false };
    if (d <= 45) return { code: 'V3–V8', name: 'Crescimento Vegetativo', critical: false };
    if (d <= 75) return { code: 'R1–R4', name: 'Floração e Formação de Vagens', critical: true };
    if (d <= 100) return { code: 'R5–R6', name: 'Enchimento de Grãos', critical: true };
    return { code: 'R7–R8', name: 'Maturação Final', critical: false };
  }
  if (c === 'milho') {
    if (d <= 18) return { code: 'VE–V3', name: 'Estabelecimento Inicial', critical: false };
    if (d <= 50) return { code: 'V4–V12', name: 'Definição de Potencial Produtivo', critical: true };
    if (d <= 85) return { code: 'VT–R3', name: 'Pendoamento e Polinização', critical: true };
    return { code: 'R4–R6', name: 'Enchimento e Maturação Fisiológica', critical: false };
  }
  if (c === 'feijao') {
    if (d <= 15) return { code: 'V1–V3', name: 'Abertura de Folhas Primárias', critical: false };
    if (d <= 35) return { code: 'V4', name: 'Ramificação Vegetativa', critical: false };
    if (d <= 65) return { code: 'R5–R8', name: 'Florada e Enchimento de Vagens', critical: true };
    return { code: 'R9', name: 'Maturação de Colheita', critical: false };
  }
  if (c === 'mandioca') {
    if (d <= 30) return { code: 'Fase 1', name: 'Brotação e Enraizamento', critical: true };
    if (d <= 90) return { code: 'Fase 2', name: 'Formação de Parte Aérea', critical: false };
    return { code: 'Fase 3–4', name: 'Engrossamento de Raízes Tuberosas', critical: true };
  }
  if (c === 'algodao') {
    if (d <= 25) return { code: 'V1–V5', name: 'Plântula e Enraizamento', critical: false };
    if (d <= 65) return { code: 'B1–F1', name: 'Botão Floral e Primeiras Flores', critical: true };
    if (d <= 110) return { code: 'F2–C1', name: 'Desenvolvimento de Maçãs e Capulhos', critical: true };
    return { code: 'C2+', name: 'Abertura de Capulhos', critical: false };
  }
  if (d <= 20) return { code: 'Fase Inicial', name: 'Emergência e Perfilhamento', critical: false };
  if (d <= 55) return { code: 'Alongamento', name: 'Alongamento de Colmos', critical: true };
  if (d <= 85) return { code: 'Espigamento', name: 'Floração e Enchimento de Grãos', critical: true };
  return { code: 'Maturação', name: 'Maturação de Colheita', critical: false };
}

function computeNasaCropAlerts(p, eff, currentState, shield, stressRainPct = 0, stressTempDelta = 0, frostActive = false, forcedSituation = 'auto') {
  const cropCfg = CROP_ECONOMICS[p.crop] || CROP_ECONOMICS.soja;
  const dap = Number(p.dap ?? 20);
  const stage = getCropPhenologyStage(p.crop, dap);
  const { kc, zCm } = obterParametrosCulturaAgroShield(p.crop, dap);

  const effectiveTemp = Number((currentState.nasaTemp + stressTempDelta).toFixed(1));
  const effectiveTmin = frostActive ? 1.8 : Number((currentState.nasaTmin + stressTempDelta * 0.6).toFixed(1));
  const effectiveSolar = Number((currentState.nasaSolar + (stressTempDelta > 1.5 ? 2.4 : 0)).toFixed(1));
  const et0Today = computeEt0HargreavesSamani(effectiveTemp, effectiveSolar);
  const etcToday = Number((et0Today * kc).toFixed(2));

  let pctCad = shield ? shield.pctCad : 68;
  let armMm = shield ? shield.armMm : 32;
  let cadMm = shield ? shield.cadMm : 48;
  let diasAteSeca = shield ? shield.diasAteSeca : 9;
  let ndviVal = currentState.ndviCurrent || 0.62;

  if (forcedSituation === 'seca') {
    pctCad = 36;
    armMm = Number((cadMm * 0.36).toFixed(1));
    diasAteSeca = 2;
  } else if (forcedSituation === 'calor') {
    pctCad = Math.min(pctCad, 54);
  } else if (forcedSituation === 'ndvi_baixo') {
    ndviVal = 0.27;
  }

  const expectedNdviMin = dap < 18 ? 0.22 : (dap <= 85 ? 0.52 : 0.35);
  const laminaReposicaoMm = Math.max(8, Math.round(cadMm - armMm));
  const alerts = [];

  // 1. Alerta Hídrico na Zona Radicular (NASA SMAP + SoilGrids + FAO-56)
  if (pctCad <= 50 || forcedSituation === 'seca') {
    alerts.push({
      id: 'water_deficit',
      severity: 'critico',
      icon: '🔴',
      badge: `NASA SMAP + FAO-56 • ARM ${armMm} mm / CAD ${cadMm} mm (${pctCad}%)`,
      title: `Déficit Hídrico na Raiz (${cropCfg.name} aos ${dap} DAP — ${stage.name})`,
      diagnosis: `A reserva de água nos ${Math.round(zCm)} cm de raiz caiu para ${pctCad}% da Capacidade de Água Disponível (CAD), enquanto a planta consome ${etcToday} mm/dia (Kc = ${kc.toFixed(2)}). ${stage.critical ? 'A lavoura está em fase crítica de definição de produtividade!' : 'O crescimento radicular pode travar se faltar umidade.'}`,
      actions: [
        p.irrigation === 'irrigado'
          ? `Ligar irrigação nas próximas 24–48h aplicando lâmina de reposição de ${laminaReposicaoMm} mm para elevar a raiz (${Math.round(zCm)} cm) à Capacidade de Campo.`
          : `Sistema em sequeiro: suspender movimentação de solo e manter palhada intacta (reduz evaporação superficial em até 38%).`,
        `Adubação: NÃO aplicar ureia em cobertura hoje — com solo a ${pctCad}% da CAD, a perda por volatilização de amônia (NH₃) ultrapassa 35%.`,
        `Comercialização (CPR/Barter): Segurar novas travas futuras até a entrada da próxima frente de chuva.`
      ]
    });
  } else if (diasAteSeca <= 6) {
    alerts.push({
      id: 'water_warning',
      severity: 'atencao',
      icon: '🟡',
      badge: `Open-Meteo + SoilGrids • Reserva p/ ${diasAteSeca} dias (${pctCad}% CAD)`,
      title: `Atenção Hídrica: Umidade entra no limite crítico em ${diasAteSeca} dias`,
      diagnosis: `Com evapotranspiração da cultura (ETc) em ${etcToday} mm/dia nos ${Math.round(zCm)} cm de raiz, a água facilmente disponível se esgota em cerca de ${diasAteSeca} dias se não chover.`,
      actions: [
        p.irrigation === 'irrigado'
          ? `Programar turno de rega preventivo de ${Math.max(10, Math.round(etcToday * 3))} mm antes que o armazenamento caia abaixo de 50% da CAD.`
          : `Aproveitar a umidade atual (${pctCad}% da CAD) caso precise realizar tratos culturais nos próximos ${Math.max(1, diasAteSeca - 2)} dias.`,
        `Monitorar previsão de chuva de 7 dias no gráfico hidrológico do Passo 3.`
      ]
    });
  }

  // 2. Alerta Térmico de Onda de Calor e Radiação Solar (NASA POWER T2M + ALLSKY_SFC_SW_DWN)
  if (effectiveTemp >= 28.5 || stressTempDelta >= 2.0 || forcedSituation === 'calor') {
    const displayTemp = forcedSituation === 'calor' ? Math.max(33.4, effectiveTemp + 4.5).toFixed(1) : effectiveTemp.toFixed(1);
    const displaySolar = forcedSituation === 'calor' ? Math.max(23.8, effectiveSolar + 3.2).toFixed(1) : effectiveSolar.toFixed(1);
    alerts.push({
      id: 'heat_radiation',
      severity: 'atencao',
      icon: '🟠',
      badge: `NASA POWER • T2M ${displayTemp} °C | Radiação ${displaySolar} MJ/m²/d`,
      title: `Estresse Térmico e Alta Demanda Evaporativa em ${cropCfg.name} (${stage.code})`,
      diagnosis: `Os sensores orbitais NASA POWER (CERES / MERRA-2) indicam forte radiação solar incidente (${displaySolar} MJ/m²/dia) e temperatura elevada, acelerando a demanda atmosférica (ET₀ = ${et0Today} mm/dia) e o risco de abortamento floral.`,
      actions: [
        `Janela de Pulverização: PROIBIDO aplicar defensivos/foliares entre 10h00 e 16h00 (alta evaporação da gota e fitotoxidez por temperatura).`,
        `Aplicar somente no início da manhã (até 09h) ou período noturno com umidade relativa > 55%.`,
        stage.critical
          ? `Fase reprodutiva (${stage.code}): considerar aplicação de bioestimulantes/aminoácidos ou potássio foliar para mitigação de estresse oxidativo.`
          : `Manter cobertura morta sobre a entrelinha para reduzir a temperatura superficial do solo em até 4 °C.`
      ]
    });
  }

  // 3. Alerta de Risco de Frio Intenso / Geada (NASA POWER T2M_MIN)
  if (frostActive || effectiveTmin <= 6.0 || forcedSituation === 'geada') {
    const displayTmin = forcedSituation === 'geada' ? '1,8' : effectiveTmin.toFixed(1).replace('.', ',');
    alerts.push({
      id: 'frost_risk',
      severity: 'critico',
      icon: '🔵',
      badge: `NASA POWER T2M_MIN • Mínima Crítica: ${displayTmin} °C`,
      title: `Alerta de Frio Intenso / Risco de Geada para ${cropCfg.name}`,
      diagnosis: `A climatologia de temperatura mínima a 2 metros (NASA POWER T2M_MIN) aponta risco de resfriamento radiativo severo (${displayTmin} °C) na região do talhão durante a fase ${stage.name}.`,
      actions: [
        p.irrigation === 'irrigado'
          ? `Defesa Ativa: Em noite de geada, acionar irrigação por aspersão na madrugada para proteção térmica por liberação de calor latente da água.`
          : `Evitar qualquer revolvimento do solo ou roçada antes da massa polar (solo úmido e compacto retém mais calor diurno).`,
        `Não aplicar herbicidas pós-emergentes 48h antes ou 72h após o frio intenso devido à queda no metabolismo da planta.`,
        `Se estiver planejando sucessão de inverno, priorizar Aveia Preta ou Trigo no lugar de milho safrinha tardio.`
      ]
    });
  }

  // 4. Alerta de Anomalia de Vigor Vegetativo (Copernicus Sentinel-2 STAC NDVI)
  if ((dap >= 20 && ndviVal < expectedNdviMin) || forcedSituation === 'ndvi_baixo') {
    alerts.push({
      id: 'ndvi_drop',
      severity: 'atencao',
      icon: '🟣',
      badge: `Sentinel-2 L2A (B08/B04) • NDVI Atual: ${ndviVal.toFixed(2)} (Esperado ≥ ${expectedNdviMin.toFixed(2)})`,
      title: `Vigor Vegetativo (NDVI) Abaixo do Esperado aos ${dap} DAP`,
      diagnosis: `A leitura óptica do satélite Sentinel-2 sobre o polígono mostra reflectância fotossintética (NDVI = ${ndviVal.toFixed(2)}) inferior ao padrão fenológico da cultura de ${cropCfg.name} na fase ${stage.code}.`,
      actions: [
        `Vistoria Dirigida no Mapa: Ativar a camada NDVI no mapa do Passo 1 e caminhar até as manchas amarelas/vermelhas do talhão.`,
        `Inspecionar ataque inicial de pragas de solo/desfolhadoras, nematoides ou manchas de compactação/acidez (pH atual: ${p.ph}).`,
        `Se confirmado amarelecimento nutricional e houver umidade no solo (> 60% CAD), realizar adubação nitrogenada ou foliar localizada.`
      ]
    });
  }

  // 5. Condição Orbital Ideal (Quando não há alertas críticos)
  if (alerts.length === 0 || forcedSituation === 'ideal') {
    if (forcedSituation === 'ideal') alerts.length = 0;
    alerts.push({
      id: 'optimal_window',
      severity: 'otimo',
      icon: '🟢',
      badge: `NASA POWER + Sentinel-2 • CAD ${pctCad}% | NDVI ${ndviVal.toFixed(2)} | ETc ${etcToday} mm/d`,
      title: `Condições Orbitais Ideais para ${cropCfg.name} (${dap} DAP — ${stage.name})`,
      diagnosis: `O cruzamento da NASA POWER com o Balanço Hídrico mostra raiz de ${Math.round(zCm)} cm bem suprida (${pctCad}% da CAD) e dossel saudável (NDVI ${ndviVal.toFixed(2)}). Consumo diário atual de ${etcToday} mm/dia.`,
      actions: [
        `Janela Verde de Manejo: Umidade do solo e temperatura favoráveis para adubação em cobertura e aplicações fitossanitárias preventivas com alta absorção.`,
        `Monitoramento: Próxima revisão crítica de umidade recomendada em ${Math.min(7, diasAteSeca)} dias.`,
        `Segurança Comercial: Baixo risco físico atual — janela favorável para travar custos em contratos futuros respeitando o limite seguro do Passo 3.`
      ]
    });
  }

  return {
    cropName: cropCfg.name,
    dap,
    stageCode: stage.code,
    stageName: stage.name,
    zCm: Math.round(zCm),
    kc,
    et0Today,
    etcToday,
    pctCad,
    armMm,
    cadMm,
    ndviVal,
    alerts
  };
}

