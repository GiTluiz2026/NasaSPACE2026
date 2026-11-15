// ============================================================================
// BACKEND MARKET SERVICES (B3 STOCKS, COMMODITIES & EXCHANGE RATES)
// 100% Client-Side / GitHub Pages Compatible with Offline-First Fallback
// ============================================================================

const MARKET_STORAGE_KEYS = {
  brapiToken: 'agrocycle_brapi_token',
  customTickers: 'agrocycle_b3_custom_tickers',
  cachedMarket: 'agrocycle_market_cache'
};

const DEFAULT_B3_TICKERS = ['^BVSP', 'SLCE3', 'AGRO3', 'SMTO3', 'RAIZ4', 'KEPL3', 'PETR4', 'VALE3'];

const MARKET_FALLBACK = {
  updatedAt: null,
  isLiveFx: false,
  isLiveB3: false,
  fx: {
    USD: { code: 'USD/BRL', name: 'Dólar Comercial', bid: 5.78, pctChange: 0.42 },
    EUR: { code: 'EUR/BRL', name: 'Euro Comercial', bid: 6.14, pctChange: -0.18 }
  },
  // Benchmarks internacionais (CBOT / ICE) + fator de conversão para R$/unidade local
  commodities: [
    {
      id: 'soja',
      cropKey: 'soja',
      name: 'Soja em Grão',
      exchange: 'CBOT (ZS=F) / Paranaguá',
      unit: 'sc (60kg)',
      intlQuote: 1018.50,
      intlUnit: '¢/bu',
      pctChange: 0.85,
      // 1 saca 60kg = 2.20462 bushels; basis/prêmio porto + frete interno ajustado
      calcBrl: (usd) => Math.round((10.185 * 2.20462 * usd) * 0.985)
    },
    {
      id: 'milho',
      cropKey: 'milho',
      name: 'Milho Futuro',
      exchange: 'B3 (CCM) / CBOT (ZC=F)',
      unit: 'sc (60kg)',
      intlQuote: 431.25,
      intlUnit: '¢/bu',
      pctChange: -0.34,
      // 1 saca 60kg = 2.3621 bushels + prêmio interno Brasil
      calcBrl: (usd) => Math.round((4.3125 * 2.3621 * usd) * 1.02)
    },
    {
      id: 'algodao',
      cropKey: 'algodao',
      name: 'Algodão em Pluma',
      exchange: 'ICE (CT=F) / MT',
      unit: '@ (15kg)',
      intlQuote: 71.40,
      intlUnit: '¢/lb',
      pctChange: 1.12,
      // 1 arroba (15kg) = 33.0693 lb
      calcBrl: (usd) => Math.round((0.7140 * 33.0693 * usd) * 1.01)
    },
    {
      id: 'trigo',
      cropKey: 'trigo',
      name: 'Trigo Moagem',
      exchange: 'CBOT (ZW=F) / PR',
      unit: 'sc (60kg)',
      intlQuote: 562.00,
      intlUnit: '¢/bu',
      pctChange: 0.25,
      calcBrl: (usd) => Math.round((5.62 * 2.20462 * usd) * 1.06)
    },
    {
      id: 'boi',
      cropKey: null,
      name: 'Boi Gordo Futuro',
      exchange: 'B3 (BGI)',
      unit: '@ (15kg)',
      intlQuote: 318.50,
      intlUnit: 'R$/@',
      pctChange: 0.64,
      calcBrl: () => 318.50
    }
  ],
  stocks: [
    { symbol: '^BVSP', shortName: 'IBOVESPA', sector: 'Índice B3', price: 127850, changePct: 0.54, currency: 'PTS', isIndex: true },
    { symbol: 'SLCE3', shortName: 'SLC Agrícola', sector: 'Grãos & Algodão', price: 18.42, changePct: 1.38, currency: 'BRL' },
    { symbol: 'AGRO3', shortName: 'BrasilAgro', sector: 'Terras & Grãos', price: 24.15, changePct: 0.75, currency: 'BRL' },
    { symbol: 'SMTO3', shortName: 'São Martinho', sector: 'Açúcar & Etanol', price: 27.60, changePct: -0.43, currency: 'BRL' },
    { symbol: 'RAIZ4', shortName: 'Raízen', sector: 'Bioenergia', price: 2.94, changePct: -1.01, currency: 'BRL' },
    { symbol: 'KEPL3', shortName: 'Kepler Weber', sector: 'Armazenagem', price: 10.18, changePct: 1.90, currency: 'BRL' },
    { symbol: 'PETR4', shortName: 'Petrobras PN', sector: 'Energia / Diesel', price: 37.85, changePct: 0.62, currency: 'BRL' },
    { symbol: 'VALE3', shortName: 'Vale ON', sector: 'Mineração', price: 59.40, changePct: -0.28, currency: 'BRL' }
  ]
};

function fetchWithTimeout(url, timeoutMs = 5500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

function getSavedBrapiToken() {
  try {
    return (localStorage.getItem(MARKET_STORAGE_KEYS.brapiToken) || '').trim();
  } catch (_) {
    return '';
  }
}

function saveBrapiTokenToStorage(token) {
  try {
    const clean = (token || '').trim();
    if (clean) localStorage.setItem(MARKET_STORAGE_KEYS.brapiToken, clean);
    else localStorage.removeItem(MARKET_STORAGE_KEYS.brapiToken);
  } catch (_) {}
}

function getSavedCustomTickers() {
  try {
    const raw = localStorage.getItem(MARKET_STORAGE_KEYS.customTickers);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function saveCustomTickersToStorage(tickers) {
  try {
    localStorage.setItem(MARKET_STORAGE_KEYS.customTickers, JSON.stringify(tickers));
  } catch (_) {}
}

async function fetchLiveExchangeRates() {
  const res = await fetchWithTimeout('https://economia.awesomeapi.com.br/json/last/USD-BRL,EUR-BRL', 5000);
  if (!res.ok) throw new Error(`AwesomeAPI HTTP ${res.status}`);
  const data = await res.json();
  const usd = data.USDBRL ? {
    code: 'USD/BRL',
    name: 'Dólar Comercial',
    bid: Number(parseFloat(data.USDBRL.bid).toFixed(2)),
    pctChange: Number(parseFloat(data.USDBRL.pctChange).toFixed(2))
  } : MARKET_FALLBACK.fx.USD;

  const eur = data.EURBRL ? {
    code: 'EUR/BRL',
    name: 'Euro Comercial',
    bid: Number(parseFloat(data.EURBRL.bid).toFixed(2)),
    pctChange: Number(parseFloat(data.EURBRL.pctChange).toFixed(2))
  } : MARKET_FALLBACK.fx.EUR;

  return { USD: usd, EUR: eur };
}

async function fetchBrapiQuotes(tickers, token) {
  const list = Array.from(new Set(tickers.map(t => t.trim().toUpperCase()).filter(Boolean)));
  if (list.length === 0) return [];
  const tokenParam = token ? `?token=${encodeURIComponent(token)}` : '';
  const url = `https://brapi.dev/api/quote/${encodeURIComponent(list.join(','))}${tokenParam}`;
  const res = await fetchWithTimeout(url, 6000);
  if (!res.ok) throw new Error(`Brapi HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data.results) ? data.results : [];
}

async function fetchLiveMarketData(customTickers = []) {
  const token = getSavedBrapiToken();
  const allTickers = Array.from(new Set([...DEFAULT_B3_TICKERS, ...customTickers]));

  let fx = { ...MARKET_FALLBACK.fx };
  let isLiveFx = false;

  try {
    fx = await fetchLiveExchangeRates();
    isLiveFx = true;
  } catch (err) {
    console.warn('Market FX fallback:', err.message);
  }

  const usdRate = fx.USD.bid || 5.78;
  const commodities = MARKET_FALLBACK.commodities.map(c => ({
    ...c,
    priceBrl: c.calcBrl(usdRate)
  }));

  // Copia fallback de ações e inclui customTickers que ainda não estejam na lista
  const stockMap = new Map();
  MARKET_FALLBACK.stocks.forEach(s => stockMap.set(s.symbol, { ...s, isLive: false }));
  customTickers.forEach(sym => {
    const clean = sym.trim().toUpperCase();
    if (clean && !stockMap.has(clean)) {
      stockMap.set(clean, {
        symbol: clean,
        shortName: clean,
        sector: 'B3 Personalizado',
        price: null,
        changePct: 0,
        currency: 'BRL',
        isLive: false,
        isCustom: true
      });
    }
  });

  let isLiveB3 = false;
  let b3AuthNeeded = false;

  try {
    const results = await fetchBrapiQuotes(allTickers, token);
    results.forEach(r => {
      if (!r || !r.symbol) return;
      const existing = stockMap.get(r.symbol) || {
        symbol: r.symbol,
        shortName: r.shortName || r.symbol,
        sector: 'B3',
        currency: r.currency || 'BRL'
      };
      stockMap.set(r.symbol, {
        ...existing,
        shortName: existing.shortName || r.shortName || r.symbol,
        price: typeof r.regularMarketPrice === 'number' ? r.regularMarketPrice : existing.price,
        changePct: typeof r.regularMarketChangePercent === 'number' ? Number(r.regularMarketChangePercent.toFixed(2)) : existing.changePct,
        isLive: typeof r.regularMarketPrice === 'number'
      });
    });
    if (results.length > 0) isLiveB3 = true;
  } catch (err) {
    console.warn('Brapi full list fallback:', err.message);
    if (!token) {
      b3AuthNeeded = true;
      // Tenta ao menos os papéis públicos gratuitos da Brapi sem token
      try {
        const freeResults = await fetchBrapiQuotes(['PETR4', 'VALE3', 'ITUB4', 'MGLU3'], '');
        freeResults.forEach(r => {
          if (r && r.symbol && stockMap.has(r.symbol)) {
            const ex = stockMap.get(r.symbol);
            stockMap.set(r.symbol, {
              ...ex,
              price: typeof r.regularMarketPrice === 'number' ? r.regularMarketPrice : ex.price,
              changePct: typeof r.regularMarketChangePercent === 'number' ? Number(r.regularMarketChangePercent.toFixed(2)) : ex.changePct,
              isLive: true
            });
            isLiveB3 = true;
          }
        });
      } catch (_) {}
    }
  }

  return {
    updatedAt: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    isLiveFx,
    isLiveB3,
    b3AuthNeeded,
    fx,
    commodities,
    stocks: Array.from(stockMap.values())
  };
}
