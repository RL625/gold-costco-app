function norm(raw){
  if(!raw||!raw.length)return[];
  // CoinGecko OHLC: [ms, o,h,l,c]
  // Coinbase candle: [sec, low, high, open, close, volume]
  return raw.map(function(r){
    if(!Array.isArray(r)||r.length<5)return null;
    if(r[0]>1e12){
      return {t:r[0],time:Math.floor(r[0]/1000),o:+r[1],h:+r[2],l:+r[3],c:+r[4]};
    }
    // Coinbase or sec-based
    if(r.length>=6 && r[1]<r[2]){
      // [t, low, high, open, close, vol]
      return {t:r[0]*1000,time:+r[0],o:+r[3],h:+r[2],l:+r[1],c:+r[4]};
    }
    return {t:r[0]*1000,time:+r[0],o:+r[1],h:+r[2],l:+r[3],c:+r[4]};
  }).filter(function(x){return x&&x.c>0}).sort(function(a,b){return a.time-b.time});
}
async function fetchCoinbase(){
  var res=await fetch('https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=86400');
  if(!res.ok)throw new Error('Coinbase HTTP '+res.status);
  var raw=await res.json();
  if(!Array.isArray(raw)||!raw.length)throw new Error('Coinbase空資料');
  return norm(raw);
}
async function fetchApi(d){
  if(cache[d]&&Date.now()-cache[d].ts<180000)return cache[d].data;
  var err=null;
  // 1) Coinbase 優先（穩定、CORS OK、約 300 日）
  try{
    var cb=await fetchCoinbase();
    if(cb.length>=3){
      // 依天數切片後快取
      var data=cb;
      if(d&&d<400){
        var cut=cb[cb.length-1].time-d*86400;
        var sliced=cb.filter(function(x){return x.time>=cut});
        if(sliced.length>=3)data=sliced;
      }
      cache[d]={data:data,ts:Date.now()};
      if(!master||cb.length>(master?master.length:0))master=cb;
      return data;
    }
  }catch(e){err=e}
  // 2) CoinGecko 備援
  for(var a=0;a<2;a++){
    if(a)await sleep(1500*a);
    try{
      var res=await fetch(CG+'/coins/bitcoin/ohlc?vs_currency=usd&days='+(d||90));
      if(res.status===429){err=new Error('CoinGecko限流');continue}
      if(!res.ok)throw new Error('CG HTTP '+res.status);
      var raw=await res.json();
      if(!Array.isArray(raw))throw new Error('CG格式錯誤');
      var data=norm(raw);
      if(data.length<3)throw new Error('CG資料過少');
      cache[d]={data:data,ts:Date.now()};
      return data;
    }catch(e){err=e}
  }
  // 3) Kraken 備援
  try{
    var kr=await fetch('https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=1440');
    if(!kr.ok)throw new Error('Kraken HTTP '+kr.status);
    var kj=await kr.json();
    var key=Object.keys(kj.result||{}).filter(function(k){return k!=='last'})[0];
    var rows=(kj.result&&kj.result[key])||[];
    // [time, open, high, low, close, vwap, volume, count]
    var data=rows.map(function(r){
      return {t:r[0]*1000,time:+r[0],o:+r[1],h:+r[2],l:+r[3],c:+r[4]};
    }).filter(function(x){return x.c>0}).sort(function(a,b){return a.time-b.time});
    if(data.length<3)throw new Error('Kraken資料過少');
    if(d&&d<400){
      var cut2=data[data.length-1].time-d*86400;
      var s2=data.filter(function(x){return x.time>=cut2});
      if(s2.length>=3)data=s2;
    }
    cache[d]={data:data,ts:Date.now()};
    if(!master||data.length>(master?master.length:0))master=data;
    return data;
  }catch(e3){err=err||e3}
  throw err||new Error('無法取得K線');
}
function slice(oh,d){
  if(!oh||!oh.length)return[];
  var cut=Date.now()/1000-d*86400;
  var s=oh.filter(function(x){return x.time>=cut});
  // 至少回傳既有資料，避免「資料不足」
  if(s.length>=2)return s;
  return oh.slice(-Math.min(oh.length,Math.max(5,Math.floor(d/2)||5)));
}
async function ensure(){
  if(master&&master.length>30)return master;
  var tryOrder=[365,180,90,30];
  var lastErr=null;
  for(var i=0;i<tryOrder.length;i++){
    try{
      var data=await fetchApi(tryOrder[i]);
      if(data&&data.length){
        if(!master||data.length>master.length)master=data;
        if(master.length>=10)return master;
      }
    }catch(e){lastErr=e}
  }
  if(master&&master.length)return master;
  throw lastErr||new Error('無法取得K線');
}
async function getDays(d){
  await ensure();
  var span=master.length?(master[master.length-1].time-master[0].time)/86400:0;
  if(d<=span+15)return slice(master,d);
  try{
    var full=await fetchApi(d>=300?365:d>=120?180:90);
    if(full.length>(master?master.length:0))master=full;
    return slice(full,d);
  }catch(e){
    return slice(master,d);
  }
}
