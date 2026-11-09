const K_PERIODS=[{days:7,label:'7 天'},{days:30,label:'30 天'},{days:90,label:'90 天'},{days:180,label:'半年'},{days:365,label:'1 年'},{days:2000,label:'全部'}];
function analyzePeriod(points,label){
  if(!points||points.length<3)return null;
  const closes=points.map(p=>p.c),highs=points.map(p=>p.h!=null?p.h:p.c),lows=points.map(p=>p.l!=null?p.l:p.c);
  const first=closes[0],last=closes[closes.length-1],periodHigh=Math.max(...highs),periodLow=Math.min(...lows);
  const ret=((last-first)/first)*100,range=periodHigh-periodLow||1,pos=(last-periodLow)/range;
  const distHigh=((periodHigh-last)/periodHigh)*100,distLow=((last-periodLow)/periodLow)*100;
  const mid=Math.floor(closes.length/2);
  const avg1=closes.slice(0,mid).reduce((a,b)=>a+b,0)/Math.max(mid,1);
  const avg2=closes.slice(mid).reduce((a,b)=>a+b,0)/Math.max(closes.length-mid,1);
  const momentum=((avg2-avg1)/avg1)*100;
  const n=Math.min(5,closes.length-1);
  const shortSlope=((closes[closes.length-1]-closes[closes.length-1-n])/closes[closes.length-1-n])*100;
  const vol=points.reduce((s,p)=>{const c=p.c||1;return s+(((p.h||c)-(p.l||c))/c);},0)/points.length*100;
  let score=0;const notes=[];
  if(ret>5){score+=2;notes.push('期間上漲 '+ret.toFixed(1)+'%，偏多');}
  else if(ret>0){score+=1;notes.push('期間小漲 '+ret.toFixed(1)+'%');}
  else if(ret>-5){score-=1;notes.push('期間小跌 '+ret.toFixed(1)+'%');}
  else{score-=2;notes.push('期間下跌 '+ret.toFixed(1)+'%，偏空');}
  if(pos<0.25){score+=2;notes.push('接近期間低點（位置 '+(pos*100).toFixed(0)+'%）');}
  else if(pos<0.4){score+=1;notes.push('位於區間偏下');}
  else if(pos>0.85){score-=2;notes.push('接近期間高點，追高風險較高');}
  else if(pos>0.7){score-=1;notes.push('位於區間偏上');}
  else notes.push('位於期間中段');
  if(momentum>2){score+=1;notes.push('後半段動能向上');}
  else if(momentum<-2){score-=1;notes.push('後半段動能轉弱');
  }
  if(shortSlope>1.5){score+=1;notes.push('近幾日偏強');}
  else if(shortSlope<-1.5){score-=1;notes.push('近幾日偏弱');}
  if(distHigh<3){score-=1;notes.push('距高點不到 3%');}
  if(distLow<3&&ret<0){score+=1;notes.push('距低點很近');
  }
  let rec,recClass,recText;
  if(score>=3){rec='偏買';recClass='rec-buy';recText='技術面偏多，可分批留意買點';}
  else if(score>=0){rec='觀望';recClass='rec-hold';recText='多空不明顯，建議等更明確訊號';}
  else{rec='偏慎';recClass='rec-wait';recText='技術面偏弱或位置偏高，不急於追價';}
  return{label,ret,periodHigh,periodLow,last,pos,distHigh,vol,score,notes,rec,recClass,recText,firstDate:points[0].d,lastDate:points[points.length-1].d};
}
async function loadKAnalysis(){
  const loading=document.getElementById('kAnalysisLoading'),content=document.getElementById('kAnalysisContent');
  if(!loading)return;
  loading.style.display='block';content.style.display='none';
  try{
    const results=(await Promise.all(K_PERIODS.map(async p=>{
      const data=await(await fetch('https://xaus.com/api/v1/history?days='+p.days)).json();
      return analyzePeriod(data.points||[],p.label);
    }))).filter(Boolean);
    document.getElementById('kGrid').innerHTML=results.map(a=>{
      const retCls=a.ret>=0?'change-up':'change-down';
      return '<div class="k-card"><h4><span>'+a.label+'</span><span class="rec '+a.recClass+'">'+a.rec+'</span></h4>'+
        '<div class="meta">'+a.firstDate+' → '+a.lastDate+' · 收盤 <strong>$'+a.last.toFixed(1)+'</strong></div>'+
        '<div class="meta">漲跌 <span class="'+retCls+'">'+(a.ret>=0?'+':'')+a.ret.toFixed(2)+'%</span> · 盤中高 $'+a.periodHigh.toFixed(1)+' · 盤中低 $'+a.periodLow.toFixed(1)+'</div>'+
        '<div class="meta">區間位置 '+(a.pos*100).toFixed(0)+'% · 距高點 '+a.distHigh.toFixed(1)+'% · 波動約 '+a.vol.toFixed(2)+'%/日</div>'+
        '<p style="font-size:0.85rem;margin:8px 0"><strong>'+a.recText+'</strong></p><ul>'+a.notes.map(n=>'<li>'+n+'</li>').join('')+'</ul></div>';
    }).join('');
    const by=Object.fromEntries(results.map(r=>[r.label,r]));
    const short=by['7 天']||by['30 天'],long=by['1 年']||by['全部'];
    const buyCount=results.filter(r=>r.score>=3).length,waitCount=results.filter(r=>r.score<0).length;
    let summary='<strong>綜合解讀：</strong> ';
    if(buyCount>=4)summary+='多數週期偏多，若要配置可考慮分批進場，並設停損。';
    else if(waitCount>=4)summary+='多數週期偏弱或位置偏高，宜觀望或等拉回再評估。';
    else if(short&&short.score>=2&&long&&long.score<0)summary+='短線偏強、長線仍弱（反彈格局），追高需謹慎。';
    else if(short&&short.score<0&&long&&long.score>=2)summary+='長線仍偏多但短線轉弱，可當成震盪中的進場觀察區。';
    else summary+='各週期訊號分歧，建議搭配上方好市多溢價，溢價低時再考慮分批。';
    summary+=' 目前現貨約 $'+(typeof currentSpot!=='undefined'&&currentSpot&&currentSpot.spot_usd_oz?Number(currentSpot.spot_usd_oz).toFixed(1):'—')+'。此為技術面簡易判斷，不構成投資建議。';
    document.getElementById('kSummary').innerHTML=summary;
    loading.style.display='none';content.style.display='block';
  }catch(e){console.error(e);loading.textContent='分析失敗，請稍後再試';}
}
window.loadKAnalysis=loadKAnalysis;
