# 🌱 AgroCycle AI — Planejador de Safra, Balanço Hídrico & Vendas Futuras

O **AgroCycle AI** é uma plataforma agrometeorológica e financeira *Offline-First* para planejamento de rotação/sucessão de culturas (3 safras), estimativa e previsão de água na raiz (7 dias), cálculo de quebra climática (FAO-33) e simulador de trava de safra / vendas futuras (CPR, Barter e Contrato Futuro).

---

## 📁 Estrutura do Repositório (Frontend × Backend)

O projeto está organizado separando claramente a camada de interface (**Frontend**) da camada de motores matemáticos, conectores orbitais e API (**Backend**), mantendo o arquivo `index.html` na raiz para funcionamento direto e imediato no **GitHub Pages**:

```text
├── index.html                        # Ponto de entrada principal (compatível direto com GitHub Pages)
├── .nojekyll                         # Garante que o GitHub Pages sirva todas as pastas sem bloqueios
├── .gitignore                        # Arquivos ignorados pelo Git
├── README.md                         # Documentação do sistema
│
├── frontend/                         # CAMADA DE INTERFACE E VISUALIZAÇÃO (UI/UX)
│   ├── css/
│   │   └── styles.css                # Estilos customizados, sliders, mapa responsivo e impressão PDF
│   └── js/
│       └── ui.js                     # Controlador de tela, Mapa Leaflet, Gráficos Chart.js, Wizard e Modais
│
└── backend/                          # CAMADA DE MOTORES AGRONÔMICOS, DADOS ORBITAIS E API
    ├── engine/                       # Motor Serverless / Offline-First (executado no GitHub Pages)
    │   ├── presets.js                # Calibração regional, parâmetros de cultura (Kc, raiz) e economia agrícola
    │   ├── agronomic-engine.js       # Cálculos FAO-56 (ET0), FAO-33 (quebra), ZARC, Ureia e Balanço Hídrico
    │   └── orbital-services.js       # Conectores NASA POWER, Sentinel-2 STAC, SoilGrids v2.0 e Open-Meteo
    └── api/                          # Servidor REST opcional em Python (FastAPI)
        ├── main.py                   # Endpoints REST (/api/health, /api/simulate-futures)
        └── requirements.txt          # Dependências Python
```

---

## 🚀 Como Publicar e Visualizar no GitHub Pages

1. Suba todos os arquivos e pastas deste diretório para o seu repositório no GitHub (`main` branch).
2. No GitHub, acesse **Settings** (Configurações) > **Pages** (no menu lateral esquerdo).
3. Em **Build and deployment**:
   - **Source**: selecione `Deploy from a branch`.
   - **Branch**: selecione `main` e a pasta `/ (root)`, depois clique em **Save**.
4. Aguarde cerca de 1 minuto. O GitHub Pages disponibilizará o link público carregando automaticamente o `index.html` com todos os módulos de `frontend/` e `backend/engine/`.

---

## 🧠 Principais Funcionalidades

- **Modo Produtor (Guiado em 3 Passos) & Modo Técnico (Painel Avançado)**:
  - Conversão instantânea entre **Hectares (ha)**, **Alqueire Paulista (2,42 ha)** e **Alqueire Mineiro (4,84 ha)**.
- **Sensoriamento Orbital Ao Vivo**:
  - **NASA POWER API**: Temperatura média, mínima, radiação solar e precipitação anual.
  - **Microsoft Planetary Computer STAC (Sentinel-2 L2A)**: Camada visual NDVI e estatística zonal real do talhão desenhado.
- **Previsão e Estimativa de Água na Raiz (Próximos 7 dias)**:
  - Integra **ISRIC SoilGrids v2.0** + **Open-Meteo API** para estimar a Água Disponível ($AD$), Capacidade de Água Disponível ($CAD$) e Água Armazenada ($ARM$) na profundidade efetiva da raiz.
- **Estimativa de Perdas (Quebra FAO-33) & Calculadora de Vendas Futuras**:
  - Calcula quebras físicas e financeiras em cenários de Seca, Calor ou Geada, mostra o **prejuízo evitado pelo manejo com cobertura**, o **Ponto de Equilíbrio (Break-even)** em sacas/ha e recomenda o **limite máximo seguro de trava futura (CPR / Barter)** para evitar risco de *washout*.
