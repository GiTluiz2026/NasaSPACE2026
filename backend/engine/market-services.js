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
  // Benchmarks internacionais (CBOT / ICE) + fator de conversão dinâmico para R$/unidade local
  commodities: [
    {
      id: 'soja',
      cropKey: 'soja',
      yahooSymbol: 'ZS=F',
      name: 'Soja em Grão',
      exchange: 'CBOT (ZS=F) / Paranaguá',
      unit: 'sc (60kg)',
      intlQuote: 1018.50,
      intlUnit: '¢/bu',
      pctChange: 0.85,
      // 1 saca 60kg = 2.20462 bushels; basis/prêmio porto + frete interno ajustado
      calcBrl: (usd, quote = 1018.50) => Math.round(((quote / 100) * 2.20462 * usd) * 0.985)
    },
    {
      id: 'milho',
      cropKey: 'milho',
      yahooSymbol: 'ZC=F',
      name: 'Milho Futuro',
      exchange: 'B3 (CCM) / CBOT (ZC=F)',
      unit: 'sc (60kg)',
      intlQuote: 431.25,
      intlUnit: '¢/bu',
      pctChange: -0.34,
      // 1 saca 60kg = 2.3621 bushels + prêmio interno Brasil
      calcBrl: (usd, quote = 431.25) => Math.round(((quote / 100) * 2.3621 * usd) * 1.02)
    },
    {
      id: 'algodao',
      cropKey: 'algodao',
      yahooSymbol: 'CT=F',
      name: 'Algodão em Pluma',
      exchange: 'ICE (CT=F) / MT',
      unit: '@ (15kg)',
      intlQuote: 71.40,
      intlUnit: '¢/lb',
      pctChange: 1.12,
      // 1 arroba (15kg) = 33.0693 lb
      calcBrl: (usd, quote = 71.40) => Math.round(((quote / 100) * 33.0693 * usd) * 1.01)
    },
    {
      id: 'trigo',
      cropKey: 'trigo',
      yahooSymbol: 'ZW=F',
      name: 'Trigo Moagem',
      exchange: 'CBOT (ZW=F) / PR',
      unit: 'sc (60kg)',
      intlQuote: 562.00,
      intlUnit: '¢/bu',
      pctChange: 0.25,
      calcBrl: (usd, quote = 562.00) => Math.round(((quote / 100) * 2.20462 * usd) * 1.06)
    },
    {
      id: 'boi',
      cropKey: null,
      yahooSymbol: 'LE=F',
      name: 'Boi Gordo Futuro',
      exchange: 'B3 (BGI)',
      unit: '@ (15kg)',
      intlQuote: 318.50,
      intlUnit: 'R$/@',
      pctChange: 0.64,
      calcBrl: (_usd, quote = 318.50) => Number(quote.toFixed(2))
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
  try {
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
  } catch (e) {
    // Fallback oficial: API aberta de Câmbio (open.er-api.com)
    const res2 = await fetchWithTimeout('https://open.er-api.com/v6/latest/USD', 5000);
    if (!res2.ok) throw e;
    const d2 = await res2.json();
    const brl = Number(d2?.rates?.BRL);
    const eurRate = Number(d2?.rates?.EUR);
    if (!brl || isNaN(brl)) throw e;
    return {
      USD: { code: 'USD/BRL', name: 'Dólar Comercial', bid: Number(brl.toFixed(2)), pctChange: 0.0 },
      EUR: { code: 'EUR/BRL', name: 'Euro Comercial', bid: Number((eurRate ? brl / eurRate : brl * 1.07).toFixed(2)), pctChange: 0.0 }
    };
  }
}

async function fetchYahooChartQuote(yahooSymbol) {
  const target = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=5d`;
  const endpoints = [
    target,
    `https://corsproxy.io/?${encodeURIComponent(target)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`
  ];
  for (const url of endpoints) {
    try {
      const res = await fetchWithTimeout(url, 4200);
      if (!res.ok) continue;
      const json = await res.json();
      const meta = json?.chart?.result?.[0]?.meta;
      if (meta && typeof meta.regularMarketPrice === 'number') {
        const price = meta.regularMarketPrice;
        const prev = meta.chartPreviousClose || meta.previousClose || price;
        const changePct = prev > 0 ? Number((((price - prev) / prev) * 100).toFixed(2)) : 0;
        return { price, changePct, shortName: meta.shortName || yahooSymbol };
      }
    } catch (_) {}
  }
  return null;
}

async function fetchBrapiQuotes(tickers, token) {
  const list = Array.from(new Set(tickers.map(t => t.trim().toUpperCase()).filter(Boolean)));
  if (list.length === 0) return [];
  if (token) {
    const url = `https://brapi.dev/api/quote/${encodeURIComponent(list.join(','))}?token=${encodeURIComponent(token)}`;
    const res = await fetchWithTimeout(url, 6000);
    if (!res.ok) throw new Error(`Brapi HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data.results) ? data.results : [];
  }
  // Sem token, a Brapi aceita 1 ativo público por requisição
  const freeAllowed = list.filter(t => ['PETR4', 'VALE3', 'ITUB4', 'MGLU3'].includes(t));
  const settled = await Promise.allSettled(
    freeAllowed.map(async sym => {
      const res = await fetchWithTimeout(`https://brapi.dev/api/quote/${encodeURIComponent(sym)}`, 4500);
      if (!res.ok) return null;
      const data = await res.json();
      return data?.results?.[0] || null;
    })
  );
  return settled.map(s => (s.status === 'fulfilled' ? s.value : null)).filter(Boolean);
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

  // Busca cotações internacionais de Commodities (CBOT/ICE) em paralelo
  const commodities = await Promise.all(
    MARKET_FALLBACK.commodities.map(async c => {
      let quote = c.intlQuote;
      let pctChange = c.pctChange;
      if (c.yahooSymbol && c.id !== 'boi') {
        const yData = await fetchYahooChartQuote(c.yahooSymbol);
        if (yData && yData.price > 0) {
          quote = Number(yData.price.toFixed(2));
          pctChange = yData.changePct;
        }
      }
      return {
        ...c,
        intlQuote: quote,
        pctChange,
        priceBrl: c.calcBrl(usdRate, quote)
      };
    })
  );

  // Inicializa mapa de ações B3
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
      if (typeof r.regularMarketPrice === 'number') isLiveB3 = true;
    });
  } catch (err) {
    console.warn('Brapi fallback:', err.message);
  }

  // Para qualquer papel B3 (ex: ^BVSP, SLCE3, AGRO3, SMTO3, RAIZ4, KEPL3) ainda não atualizado via Brapi, busca no Yahoo Finance (.SA)
  const missingSymbols = Array.from(stockMap.values()).filter(s => !s.isLive).map(s => s.symbol);
  if (missingSymbols.length > 0) {
    await Promise.allSettled(
      missingSymbols.map(async sym => {
        const ySym = sym.startsWith('^') || sym.includes('.') ? sym : `${sym}.SA`;
        const yQuote = await fetchYahooChartQuote(ySym);
        if (yQuote && typeof yQuote.price === 'number') {
          const ex = stockMap.get(sym);
          if (ex) {
            stockMap.set(sym, {
              ...ex,
              shortName: ex.shortName === sym && yQuote.shortName ? yQuote.shortName : ex.shortName,
              price: Number(yQuote.price.toFixed(2)),
              changePct: yQuote.changePct,
              isLive: true
            });
            isLiveB3 = true;
          }
        }
      })
    );
  }

  if (!token && !isLiveB3) b3AuthNeeded = true;

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

