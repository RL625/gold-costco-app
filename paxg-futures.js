/* PAXG/USDT futures helpers — Binance public API (client-side) */
(function (global) {
  const FAPI = 'https://fapi.binance.com';
  const INTERVAL_MAP = { '7': '4h', '30': '1d', '90': '1d', '180': '1d', '365': '1d', '2000': '1w' };
  const LIMIT_MAP = { '7': 42, '30': 30, '90': 90, '180': 180, '365': 365, '2000': 200 };

  function sma(arr, n) {
    const out = new Array(arr.length).fill(null);
    let sum = 0;
    for (let i = 0; i < arr.length; i++) {
      sum += arr[i];
      if (i >= n) sum -= arr[i - n];
      if (i >= n - 1) out[i] = sum / n;
    }
    return out;
  }

  function rsi(closes, n) {
    n = n || 14;
    const out = new Array(closes.length).fill(null);
    if (closes.length < n + 1) return out;
    let gains = 0, losses = 0;
    for (let i = 1; i <= n; i++) {
      const d = closes[i] - closes[i - 1];
      if (d >= 0) gains += d; else losses -= d;
    }
    let avgG = gains / n, avgL = losses / n;
    out[n] = avgL === 0 ? 100 : 100 - (100 / (1 + avgG / avgL));
    for (let i = n + 1; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
      avgG = (avgG * (n - 1) + g) / n;
      avgL = (avgL * (n - 1) + l) / n;
      out[i] = avgL === 0 ? 100 : 100 - (100 / (1 + avgG / avgL));
    }
    return out;
  }

  function atr(ohlc, n) {
    n = n || 14;
    const tr = [];
    for (let i = 0; i < ohlc.length; i++) {
      const h = ohlc[i].h, l = ohlc[i].l, c = i ? ohlc[i - 1].c : ohlc[i].c;
      tr.push(Math.max(h - l, Math.abs(h - c), Math.abs(l - c)));
    }
    return sma(tr, n);
  }

  async function fetchKlines(days) {
    const key = String(days);
    const interval = INTERVAL_MAP[key] || '1d';
    const limit = LIMIT_MAP[key] || 90;
    const res = await fetch(FAPI + '/fapi/v1/klines?symbol=PAXGUSDT&interval=' + interval + '&limit=' + limit);
    if (!res.ok) throw new Error('Binance API ' + res.status);
    const raw = await res.json();
    return raw.map(k => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5], time: Math.floor(k[0] / 1000) }));
  }

  async function fetchPremium() {
    const res = await fetch(FAPI + '/fapi/v1/premiumIndex?symbol=PAXGUSDT');
    if (!res.ok) throw new Error('premium ' + res.status);
    return res.json();
  }

  async function fetchTicker() {
    const res = await fetch(FAPI + '/fapi/v1/ticker/24hr?symbol=PAXGUSDT');
    if (!res.ok) throw new Error('ticker ' + res.status);
    return res.json();
  }

  function buildTradePlan(ohlc, fundingRate) {
    if (!ohlc || ohlc.length < 20) return null;
    const closes = ohlc.map(x => x.c);
    const last = closes[closes.length - 1];
    const ma20 = sma(closes, 20);
    const ma50 = sma(closes, Math.min(50, closes.length));
    const r = rsi(closes, 14);
    const a = atr(ohlc, 14);
    const lastRsi = r[r.length - 1];
    const lastAtr = a[a.length - 1] || (last * 0.01);
    const lastMa20 = ma20[ma20.length - 1];
    const lastMa50 = ma50[ma50.length - 1];

    let bias = '中性', direction = '觀望', score = 0;
    if (last > lastMa20) score += 1;
    if (last > lastMa50) score += 1;
    if (lastMa20 > lastMa50) score += 1;
    if (lastRsi != null && lastRsi < 35) score += 1;
    if (lastRsi != null && lastRsi > 65) score -= 1;
    if (lastRsi != null && lastRsi > 70) score -= 1;
    if (last < lastMa20) score -= 1;
    if (last < lastMa50) score -= 1;

    if (score >= 2) { bias = '偏多'; direction = '做多 (Long)'; }
    else if (score <= -2) { bias = '偏空'; direction = '做空 (Short)'; }

    let leverage = lastAtr / last > 0.02 ? 3 : (lastAtr / last > 0.012 ? 5 : 7);
    leverage = Math.min(10, Math.max(2, leverage));

    let entry = last, sl, tp1, tp2;
    if (direction.indexOf('做多') >= 0) {
      sl = last - 1.5 * lastAtr; tp1 = last + 2 * lastAtr; tp2 = last + 3.5 * lastAtr;
    } else if (direction.indexOf('做空') >= 0) {
      sl = last + 1.5 * lastAtr; tp1 = last - 2 * lastAtr; tp2 = last - 3.5 * lastAtr;
    } else {
      sl = last - 1.2 * lastAtr; tp1 = last + 1.5 * lastAtr; tp2 = last + 2.5 * lastAtr;
    }

    const risk = Math.abs(entry - sl);
    const rr1 = risk ? Math.abs(tp1 - entry) / risk : 0;
    const rr2 = risk ? Math.abs(tp2 - entry) / risk : 0;
    const fund = fundingRate != null ? Number(fundingRate) : null;
    let fundNote = '';
    if (fund != null) {
      if (fund > 0.0001) fundNote = '資金費率為正（多頭付空頭），長期持多成本較高';
      else if (fund < -0.0001) fundNote = '資金費率為負（空頭付多頭），持多可收資費';
      else fundNote = '資金費率接近中性';
    }

    return {
      bias, direction, score, last, lastRsi, lastAtr, entry, sl, tp1, tp2, leverage, risk, rr1, rr2,
      riskPct: 1.0, fund, fundNote, ma20: lastMa20, ma50: lastMa50
    };
  }

  let candleChart = null;

  async function renderCandle(containerId, days) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = '';
    if (typeof LightweightCharts === 'undefined') {
      el.innerHTML = '<p class="loading">K線函式庫載入中…</p>';
      return;
    }
    try {
      const ohlc = await fetchKlines(days);
      const chart = LightweightCharts.createChart(el, {
        width: el.clientWidth, height: el.clientHeight || 280,
        layout: { background: { color: '#1a2332' }, textColor: '#8b9bb4' },
        grid: { vertLines: { color: 'rgba(45,58,79,0.5)' }, horzLines: { color: 'rgba(45,58,79,0.5)' } },
        rightPriceScale: { borderColor: '#2d3a4f' },
        timeScale: { borderColor: '#2d3a4f', timeVisible: true }
      });
      const series = chart.addCandlestickSeries({
        upColor: '#22c55e', downColor: '#ef4444',
        borderUpColor: '#22c55e', borderDownColor: '#ef4444',
        wickUpColor: '#22c55e', wickDownColor: '#ef4444'
      });
      series.setData(ohlc.map(x => ({ time: x.time, open: x.o, high: x.h, low: x.l, close: x.c })));
      const closes = ohlc.map(x => x.c);
      const ma20 = sma(closes, 20);
      const maLine = chart.addLineSeries({ color: '#f5c518', lineWidth: 1, priceLineVisible: false });
      maLine.setData(ohlc.map((x, i) => ma20[i] != null ? { time: x.time, value: ma20[i] } : null).filter(Boolean));
      chart.timeScale().fitContent();
      candleChart = chart;
      window.addEventListener('resize', () => { if (candleChart && el) candleChart.applyOptions({ width: el.clientWidth }); });
      return ohlc;
    } catch (e) {
      console.error(e);
      el.innerHTML = '<p class="loading">無法載入幣安 K 線。' + (e.message || '') + '</p>';
      return null;
    }
  }

  function lightClass(level) {
    if (level === 'green') return 'light-green';
    if (level === 'yellow') return 'light-yellow';
    return 'light-red';
  }

  function buildSignals(plan, fund, lastRsi) {
    if (!plan) return null;
    let trend = 'yellow', trendText = '盤整';
    if (plan.last > plan.ma20 && plan.ma20 > plan.ma50) { trend = 'green'; trendText = '多頭排列'; }
    else if (plan.last < plan.ma20 && plan.ma20 < plan.ma50) { trend = 'red'; trendText = '空頭排列'; }
    else if (plan.last > plan.ma20) { trend = 'yellow'; trendText = '站上 MA20'; }
    else { trend = 'yellow'; trendText = '跌破 MA20'; }

    let mom = 'yellow', momText = '中性';
    if (lastRsi != null) {
      if (lastRsi >= 70) { mom = 'red'; momText = '超買 ' + lastRsi.toFixed(0); }
      else if (lastRsi <= 30) { mom = 'green'; momText = '超賣 ' + lastRsi.toFixed(0); }
      else if (lastRsi >= 55) { mom = 'green'; momText = '偏多 ' + lastRsi.toFixed(0); }
      else if (lastRsi <= 45) { mom = 'red'; momText = '偏空 ' + lastRsi.toFixed(0); }
      else { mom = 'yellow'; momText = '中性 ' + lastRsi.toFixed(0); }
    }

    const atrPct = plan.lastAtr / plan.last * 100;
    let vol = 'yellow', volText = atrPct.toFixed(2) + '%';
    if (atrPct < 0.8) { vol = 'green'; volText = '偏低 ' + atrPct.toFixed(2) + '%'; }
    else if (atrPct > 2.0) { vol = 'red'; volText = '偏高 ' + atrPct.toFixed(2) + '%'; }
    else { vol = 'yellow'; volText = '正常 ' + atrPct.toFixed(2) + '%'; }

    let fundL = 'yellow', fundText = '—';
    if (fund != null) {
      const fp = fund * 100;
      fundText = fp.toFixed(4) + '%';
      if (Math.abs(fp) < 0.005) { fundL = 'green'; fundText = '中性 ' + fundText; }
      else if (fp > 0.01) { fundL = 'red'; fundText = '多付費 ' + fundText; }
      else if (fp < -0.01) { fundL = 'green'; fundText = '空付費 ' + fundText; }
    }

    let dir = 'yellow', dirText = plan.direction;
    if (plan.direction.indexOf('做多') >= 0) dir = 'green';
    else if (plan.direction.indexOf('做空') >= 0) dir = 'red';
    else dirText = '觀望';

    let go = 'wait', goTitle = '⏳ 暫時觀望', goSub = '訊號分歧或條件不足，不建議立刻開單。';

    if (plan.direction.indexOf('做多') >= 0) {
      if (trend === 'green' && mom !== 'red' && vol !== 'red' && lastRsi < 70) {
        go = 'yes'; goTitle = '✅ 適合開多單'; goSub = '多頭結構成立，動能未超買，可考慮多單並設停損。';
      } else if (trend === 'green' && mom === 'red') {
        go = 'wait'; goTitle = '⚠️ 多頭但動能超買'; goSub = '趨勢向上但 RSI 偏高，等回檔再多較佳。';
      }
    } else if (plan.direction.indexOf('做空') >= 0) {
      if (trend === 'red' && mom !== 'green' && vol !== 'red') {
        go = 'yes'; goTitle = '✅ 適合開空單'; goSub = '空頭結構成立，動能未轉多，可考慮空單並設停損。';
      } else if (trend === 'red' && mom === 'green') {
        go = 'wait'; goTitle = '⚠️ 空頭但動能背離'; goSub = '價格偏空但 RSI 偏多，等動能轉弱再空較穩。';
      }
    } else {
      go = 'wait'; goTitle = '⏳ 暫時觀望'; goSub = '多空未明，不建議新開倉。';
    }

    if (vol === 'red' && (lastRsi > 75 || lastRsi < 25)) {
      go = 'no'; goTitle = '🚫 不適合開單'; goSub = '波動過大且動能極端，追價風險高。';
    }

    return {
      items: [
        { lab: '趨勢結構', level: trend, val: trendText },
        { lab: '動能 RSI', level: mom, val: momText },
        { lab: '波動 ATR', level: vol, val: volText },
        { lab: '資金費率', level: fundL, val: fundText },
        { lab: '系統方向', level: dir, val: dirText }
      ],
      go, goTitle, goSub
    };
  }

  function renderDashboard(signals) {
    const el = document.getElementById('paxgDashboard');
    if (!el || !signals) { if (el) el.innerHTML = ''; return; }
    const goClass = signals.go === 'yes' ? 'go-yes' : (signals.go === 'no' ? 'go-no' : 'go-wait');
    let html = '<div class="go-banner ' + goClass + '">' +
      '<div class="go-title">' + signals.goTitle + '</div>' +
      '<div class="go-sub">' + signals.goSub + '</div></div>';
    html += '<div class="signal-board">';
    signals.items.forEach(it => {
      html += '<div class="signal-cell"><div class="lab">' + it.lab + '</div>' +
        '<div class="light ' + lightClass(it.level) + '"></div>' +
        '<div class="val">' + it.val + '</div></div>';
    });
    html += '</div>';
    el.innerHTML = html;
  }

  async function loadPaxgPanel(days) {
    const status = document.getElementById('paxgStatus');
    const body = document.getElementById('paxgBody');
    if (status) status.textContent = '載入 PAXGUSDT 合約資料…';
    try {
      const [ohlc, prem, ticker] = await Promise.all([
        fetchKlines(days || 30),
        fetchPremium().catch(() => null),
        fetchTicker().catch(() => null)
      ]);
      await renderCandle('paxgCandle', days || 30);
      const fund = prem ? parseFloat(prem.lastFundingRate) : null;
      const mark = prem ? parseFloat(prem.markPrice) : (ohlc[ohlc.length - 1].c);
      const plan = buildTradePlan(ohlc, fund);
      const closes = ohlc.map(x => x.c);
      const lastRsi = rsi(closes, 14).slice(-1)[0];
      const signals = buildSignals(plan, fund, lastRsi);
      renderDashboard(signals);

      let html = '';
      if (ticker) {
        html += '<div class="price-grid" style="margin-bottom:12px">' +
          '<div class="price-box"><div class="label">標記價</div><div class="value">$' + mark.toFixed(2) + '</div><div class="sub">PAXGUSDT</div></div>' +
          '<div class="price-box"><div class="label">24h 漲跌</div><div class="value ' + (+ticker.priceChangePercent >= 0 ? 'change-up' : 'change-down') + '">' +
          (+ticker.priceChangePercent >= 0 ? '+' : '') + Number(ticker.priceChangePercent).toFixed(2) + '%</div><div class="sub">成交量 ' + Number(ticker.quoteVolume).toLocaleString(undefined,{maximumFractionDigits:0}) + '</div></div>' +
          '<div class="price-box"><div class="label">資金費率</div><div class="value">' + (fund != null ? (fund * 100).toFixed(4) + '%' : '—') + '</div><div class="sub">每結算週期</div></div>' +
          '<div class="price-box"><div class="label">RSI(14)</div><div class="value">' + (lastRsi != null ? lastRsi.toFixed(1) : '—') + '</div><div class="sub">' +
          (lastRsi > 70 ? '超買區' : lastRsi < 30 ? '超賣區' : '中性') + '</div></div></div>';
      }

      if (plan) {
        html += '<div class="advice-box" style="margin-top:8px">' +
          '<h3>合約指標摘要</h3>' +
          '<p style="font-size:0.9rem">偏向：<strong>' + plan.bias + '</strong> · 建議方向：<strong>' + plan.direction + '</strong></p>' +
          '<p style="font-size:0.85rem;color:var(--muted)">MA20 $' + (plan.ma20 ? plan.ma20.toFixed(1) : '—') +
          ' · MA50 $' + (plan.ma50 ? plan.ma50.toFixed(1) : '—') +
          ' · ATR(14) $' + plan.lastAtr.toFixed(1) +
          (plan.fundNote ? ' · ' + plan.fundNote : '') + '</p></div>';

        html += '<div class="advice-box strong-buy" style="margin-top:12px">' +
          '<h3>幣安 PAXG/USDT 合約開單參數建議</h3>' +
          '<p style="font-size:0.8rem;color:var(--muted);margin-bottom:8px">僅供參考，非投資建議。</p>' +
          '<div class="table-wrap"><table class="hist-table"><tbody>' +
          '<tr><td>方向</td><td><strong>' + plan.direction + '</strong></td></tr>' +
          '<tr><td>建議槓桿</td><td><strong>' + plan.leverage + 'x</strong></td></tr>' +
          '<tr><td>參考進場</td><td>$' + plan.entry.toFixed(2) + '</td></tr>' +
          '<tr><td>停損 (SL)</td><td>$' + plan.sl.toFixed(2) + '</td></tr>' +
          '<tr><td>停利 1 (TP1)</td><td>$' + plan.tp1.toFixed(2) + '（R:R ' + plan.rr1.toFixed(1) + '）</td></tr>' +
          '<tr><td>停利 2 (TP2)</td><td>$' + plan.tp2.toFixed(2) + '（R:R ' + plan.rr2.toFixed(1) + '）</td></tr>' +
          '<tr><td>建議風險</td><td>單筆約帳戶 ' + plan.riskPct + '%</td></tr>' +
          '</tbody></table></div>' +
          '<p style="font-size:0.8rem;color:var(--muted);margin-top:8px"><a class="buy" href="https://www.binance.com/zh-TC/futures/PAXGUSDT" target="_blank" rel="noopener">幣安 PAXGUSDT 合約 →</a></p></div>';
      }

      if (body) body.innerHTML = html;
      if (status) {
        status.className = 'status live';
        status.textContent = 'PAXGUSDT 合約資料 · 更新於 ' + new Date().toLocaleString('zh-TW');
      }
    } catch (e) {
      console.error(e);
      if (status) { status.className = 'status fallback'; status.textContent = '幣安 API 無法連線。'; }
      if (body) body.innerHTML = '<p class="loading">無法取得 PAXGUSDT。' + (e.message || e) + '</p>';
      const dash = document.getElementById('paxgDashboard');
      if (dash) dash.innerHTML = '';
    }
  }

  global.loadPaxgPanel = loadPaxgPanel;
  global.renderPaxgCandle = renderCandle;
})(window);
