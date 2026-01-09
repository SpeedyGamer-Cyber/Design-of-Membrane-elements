// RC Membrane Design — v5 update
// - θ used in Method 1 is θc = θp + 90° (principal concrete compressive direction)
// - Concrete stress check is NOT clipped. If σcd > ν·fcd → NOT OK: increase fck.
// - Method 2 detail kept; Provided reinforcement = Method 1 with Method 2 bounds (0.4ρ′..2.5ρ′).
// - Dynamic grid & probe retained.

const rad2deg = (r)=>r*180/Math.PI; const clamp=(x,l,h)=>Math.max(l,Math.min(h,x));
const colors=['#4EA3FF','#00C2A8','#FF5D6C','#FFBD2F','#B28DFF','#33D17A','#FF8A4E','#8CE1FF','#C1FF72','#FF7DD0'];
function niceStep(raw){ const r=Math.max(raw,1e-12); const p=10**Math.floor(Math.log10(r)); const s=r/p; return (s<=1?1:s<=2?2:s<=2.5?2.5:s<=5?5:10)*p; }

// Theme
function applyTheme(t){ document.documentElement.setAttribute('data-theme',t); const b=document.getElementById('theme-toggle'); if(b) b.textContent = t==='light'?'☀️ Light': t==='dark'?'🌙 Dark':'🖥️ Auto'; }
function loadTheme(){ applyTheme(localStorage.getItem('rcm-theme')||'dark'); }
function toggleTheme(){ const cur=document.documentElement.getAttribute('data-theme')||'dark'; const next=cur==='dark'?'light':(cur==='light'?'auto':'dark'); localStorage.setItem('rcm-theme',next); applyTheme(next); }

// Cache elements
const fckEl=document.getElementById('fck'); const fykEl=document.getElementById('fyk'); const gcEl=document.getElementById('gamma_c'); const gsEl=document.getElementById('gamma_s'); const nuEl=document.getElementById('nu_coeff');

// Inputs
function getInputs(){ const fck=+fckEl.value, fyk=+fykEl.value, gc=+gcEl.value, gs=+gsEl.value, nu=+nuEl.value; const rows=[...document.querySelectorAll('#stress-table tbody tr')]; const pts=rows.map((tr,i)=>{const t=tr.querySelectorAll('td');return{sx:+t[1].querySelector('input').value, sy:+t[2].querySelector('input').value, txy:+t[3].querySelector('input').value, label:t[4].querySelector('input').value||`P${i+1}`};}); return {fck,fyk,gamma_c:gc,gamma_s:gs,nu,points:pts}; }

// Principal state (σ1 ≥ σ2)
function principalState(sx, sy, txy){ const s_avg=0.5*(sx+sy), diff=0.5*(sx-sy); const R=Math.hypot(diff,txy); const s1=s_avg+R, s2=s_avg-R, tau_max=R; const theta_p=0.5*Math.atan2(2*txy,(sx-sy)); return { s1,s2,tau_max,theta_p,s_avg,R }; }

// θ for Method 1: concrete compressive direction (σ2): θc = θp + 90°
function thetaConcreteFromPrincipals(P){ return P.theta_p + Math.PI/2; }

function designOne(pt, mats){
  const { sx, sy, txy } = pt; const { fck, fyk, gamma_c, gamma_s, nu } = mats;
  const fcd = fck / gamma_c; const fyd = fyk / gamma_s;
  const P = principalState(sx,sy,txy);

  // θ used in Method 1
  const theta_c = thetaConcreteFromPrincipals(P);
  const tan_th = Math.tan(theta_c);
  const cot_th = (Math.abs(tan_th) < 1e-12) ? 1e12 : 1 / tan_th;

  // Reinforcement requirement (no steel if both comp and σxσy > τ²)
  const bothComp=(sx<0)&&(sy<0); const compCond=(sx*sy>(txy*txy));
  const reinforcementRequired = !(bothComp && compCond);

  // Method 1 (General) using θc
  const rho_x_M1=(sx + txy*cot_th)/fyd; const rho_y_M1=(sy + txy/cot_th)/fyd;
  const sigma_cd_M1=Math.abs(txy)*(Math.abs(cot_th)+Math.abs(1/cot_th));

  // Method 2 (Optimum) — Cases A/B/C
  let rho_x_opt=0, rho_y_opt=0, sigma_cd_opt=0, optCase='A';
  const caseA=(sx>=-Math.abs(txy))&&(sy>=-Math.abs(txy));
  const caseB=(sx<-Math.abs(txy))&&(sx<=sy)&&(sx*sy<=(txy*txy));
  const caseC=(sy<-Math.abs(txy))&&(sx>=sy)&&(sx*sy<=(txy*txy));
  if (caseA){ rho_x_opt=(sx+Math.abs(txy))/fyd; rho_y_opt=(sy+Math.abs(txy))/fyd; sigma_cd_opt=2*Math.abs(txy); optCase='A'; }
  else if (caseB){ rho_x_opt=0; rho_y_opt=(sy+(txy*txy)/sx)/fyd; sigma_cd_opt=sx/(1+(txy/sx)**2); optCase='B'; }
  else if (caseC){ rho_x_opt=(sx+(txy*txy)/sy)/fyd; rho_y_opt=0; sigma_cd_opt=sy/(1+(txy/sy)**2); optCase='C'; }
  else { rho_x_opt=(sx+Math.abs(txy))/fyd; rho_y_opt=(sy+Math.abs(txy))/fyd; sigma_cd_opt=2*Math.abs(txy); optCase='A*'; }

  // Limits derived from Method 2
  const rho_x_min=0.4*Math.max(0,rho_x_opt), rho_x_max=2.5*Math.max(0,rho_x_opt);
  const rho_y_min=0.4*Math.max(0,rho_y_opt), rho_y_max=2.5*Math.max(0,rho_y_opt);

  // Provided reinforcement = Method 1 with Method 2 bounds
  const rho_x_final=Math.max(0, Math.min(Math.max(rho_x_M1, rho_x_min), (rho_x_max>0?rho_x_max:Infinity)));
  const rho_y_final=Math.max(0, Math.min(Math.max(rho_y_M1, rho_y_min), (rho_y_max>0?rho_y_max:Infinity)));

  // Concrete stress check — NOT clipped
  const sigma_cd_limit = nu * fcd;               // capacity
  const concreteOk = sigma_cd_M1 <= sigma_cd_limit;
  const fcd_req = concreteOk ? null : (sigma_cd_M1/nu); // required design compressive strength
  const fck_req = concreteOk ? null : (fcd_req*gamma_c); // required cylinder strength

  return { ...P,
    fcd,fyd,nu,gamma_c,
    reinforcementRequired,
    theta_c,tan_th,cot_th,
    // Method 1
    rho_x_M1,rho_y_M1,sigma_cd_M1,
    // Method 2
    rho_x_opt,rho_y_opt,sigma_cd_opt,optCase,
    // limits
    limits:{rho_x_min,rho_x_max,rho_y_min,rho_y_max,sigma_cd_limit},
    // provided
    rho_x_final,rho_y_final,
    // concrete
    concreteOk,fcd_req,fck_req
  };
}

let VIEW={zoom:1,panX:0,panY:0}, PROBE={enabled:false,x:null,y:null,locked:false}, LAST_RESULTS=[], TRANSFORM=null;

function runDesign(){ const inp=getInputs(); const res=inp.points.map(p=>({p,res:designOne(p,inp)})); LAST_RESULTS=res; renderSummary(res); renderDetails(res); drawMohr(res); }

function renderSummary(results){ const tbody=document.querySelector('#results-table tbody'); tbody.innerHTML=''; results.forEach(({p,res})=>{
  const checks=[];
  if(!res.reinforcementRequired){ checks.push('σx, σy both comp. and σx·σy > τ²'); }
  else {
    checks.push('Bounds: 0.4ρ′≤ρ≤2.5ρ′ applied');
    if(res.concreteOk){ checks.push(`σcd (${res.sigma_cd_M1.toFixed(3)}) ≤ ν·fcd (${res.limits.sigma_cd_limit.toFixed(3)})`); }
    else { checks.push(`σcd (${res.sigma_cd_M1.toFixed(3)}) > ν·fcd (${res.limits.sigma_cd_limit.toFixed(3)}) → NOT OK: increase fck ≥ ${res.fck_req.toFixed(1)} MPa`); }
  }
  const tr=document.createElement('tr'); tr.innerHTML=`
    <td>${p.label}</td>
    <td>${res.s1.toFixed(3)}</td>
    <td>${res.s2.toFixed(3)}</td>
    <td>${res.tau_max.toFixed(3)}</td>
    <td>${rad2deg(res.theta_p).toFixed(2)}</td>
    <td>${res.reinforcementRequired?'<span class="badge warn">Yes</span>':'<span class="badge ok">No</span>'}</td>
    <td>${res.reinforcementRequired?'Method 1 (limited by Method 2)':'-'}</td>
    <td>${res.reinforcementRequired?res.rho_x_final.toExponential(3):'-'}</td>
    <td>${res.reinforcementRequired?res.rho_y_final.toExponential(3):'-'}</td>
    <td>${res.reinforcementRequired?res.sigma_cd_M1.toFixed(3):'-'}</td>
    <td>${checks.join('; ')}</td>`; tbody.appendChild(tr);
}); }

function renderDetails(list){ const box=document.getElementById('details-container'); box.innerHTML=''; list.forEach(({p,res},i)=>{ const color=colors[i%colors.length]; const ac=document.createElement('div'); ac.className='ac-item'; ac.innerHTML=`
  <div class="ac-header" style="border-left:6px solid ${color}"><h3>${p.label} — Detailed Steps</h3><span>click to expand</span></div>
  <div class="ac-body">${detailHTML(p,res)}</div>`; ac.querySelector('.ac-header').addEventListener('click',()=>ac.classList.toggle('open')); if(i===0) ac.classList.add('open'); box.appendChild(ac); }); }

function detailHTML(p,r){ const L=[]; const fmt=(x,d=6)=>Number(x).toExponential(d);
  L.push(`<h4>Given</h4><ul>
    <li>σx = ${p.sx} MPa, σy = ${p.sy} MPa, τxy = ${p.txy} MPa</li>
    <li>fcd = ${(r.fcd).toFixed(3)} MPa, fyd = ${(r.fyd).toFixed(3)} MPa, γc = ${r.gamma_c}, ν = ${r.nu}</li>
  </ul>`);
  L.push(`<h4>1) Principal stresses, shear & angles</h4>`);
  L.push(`<p>σ₁,₂ = (σx+σy)/2 ± √{[(σx−σy)/2]² + τxy²} → σ₁ = ${r.s1.toFixed(3)} MPa, σ₂ = ${r.s2.toFixed(3)} MPa</p>`);
  L.push(`<p>τmax = √{[(σx−σy)/2]² + τxy²} = ${r.tau_max.toFixed(3)} MPa</p>`);
  L.push(`<p>tan(2θp) = 2τxy/(σx−σy) → θp = ${rad2deg(r.theta_p).toFixed(3)}° (principal axes)</p>`);
  L.push(`<p><strong>θ (used in Method 1)</strong> = θp + 90° = ${rad2deg(r.theta_c).toFixed(3)}° &nbsp; (tanθ = ${r.tan_th.toFixed(6)}, cotθ = ${r.cot_th.toFixed(6)})</p>`);

  if(!r.reinforcementRequired){ L.push(`<h4>2) Reinforcement requirement</h4><p>σx<0 & σy<0 and σxσy>τ² ⇒ No design reinforcement required.</p>`); return `<div class="detail">${L.join('\n')}</div>`; }

  // Method 2 details
  const condA=(p.sx>=-Math.abs(p.txy))&&(p.sy>=-Math.abs(p.txy));
  const condB=(p.sx<-Math.abs(p.txy))&&(p.sx<=p.sy)&&(p.sx*p.sy <= (p.txy*p.txy));
  const condC=(p.sy<-Math.abs(p.txy))&&(p.sx>=p.sy)&&(p.sx*p.sy <= (p.txy*p.txy));
  L.push(`<h4>2) Method 2 (Optimum) — Case ${r.optCase}</h4>`);
  L.push(`<p>Case checks → A:${condA}, B:${condB}, C:${condC}</p>`);
  if(r.optCase.startsWith('A')){
    L.push(`<p>ρx′ = (σx + |τ|)/fyd = (${p.sx} + ${Math.abs(p.txy)}) / ${r.fyd.toFixed(3)} = ${fmt(r.rho_x_opt)}</p>`);
    L.push(`<p>ρy′ = (σy + |τ|)/fyd = (${p.sy} + ${Math.abs(p.txy)}) / ${r.fyd.toFixed(3)} = ${fmt(r.rho_y_opt)}</p>`);
    L.push(`<p>σcd′ = 2|τ| = ${(2*Math.abs(p.txy)).toFixed(6)} MPa</p>`);
  } else if(r.optCase==='B'){
    L.push(`<p>ρx′ = 0</p>`);
    L.push(`<p>ρy′ = (σy + τ²/σx)/fyd = (${p.sy} + ${(p.txy*p.txy).toFixed(6)}/${p.sx}) / ${r.fyd.toFixed(3)} = ${fmt(r.rho_y_opt)}</p>`);
    L.push(`<p>σcd′ = σx / (1 + (τ/σx)²) = ${p.sx} / (1 + (${p.txy}/${p.sx})²) = ${r.sigma_cd_opt.toFixed(6)} MPa</p>`);
  } else if(r.optCase==='C'){
    L.push(`<p>ρy′ = 0</p>`);
    L.push(`<p>ρx′ = (σx + τ²/σy)/fyd = (${p.sx} + ${(p.txy*p.txy).toFixed(6)}/${p.sy}) / ${r.fyd.toFixed(3)} = ${fmt(r.rho_x_opt)}</p>`);
    L.push(`<p>σcd′ = σy / (1 + (τ/σy)²) = ${p.sy} / (1 + (${p.txy}/${p.sy})²) = ${r.sigma_cd_opt.toFixed(6)} MPa</p>`);
  }

  // Limits & concrete stress
  L.push(`<h4>3) Limits from Method 2 & concrete stress</h4>`);
  L.push(`<p>x‑dir: 0.4·ρx′ = ${fmt(0.4*Math.max(0,r.rho_x_opt))}, 2.5·ρx′ = ${fmt(2.5*Math.max(0,r.rho_x_opt))}</p>`);
  L.push(`<p>y‑dir: 0.4·ρy′ = ${fmt(0.4*Math.max(0,r.rho_y_opt))}, 2.5·ρy′ = ${fmt(2.5*Math.max(0,r.rho_y_opt))}</p>`);
  L.push(`<p>σcd demand (Method 1): ${r.sigma_cd_M1.toFixed(6)} MPa; limit ν·fcd = ${r.nu} × ${r.fcd.toFixed(3)} = ${r.limits.sigma_cd_limit.toFixed(6)} MPa → ${r.concreteOk?'<strong>OK</strong>':'<strong>NOT OK</strong>'}</p>`);
  if(!r.concreteOk){ L.push(`<p><strong>Concrete capacity insufficient.</strong> Required: fcd ≥ σcd/ν = ${(r.fcd_req).toFixed(3)} MPa ⇒ fck ≥ ${r.fck_req.toFixed(1)} MPa (γc = ${r.gamma_c}).</p>`); }

  // Method 1 (provided) with bounds
  L.push(`<h4>4) Method 1 (General) with limitations → <u>Provided reinforcement</u></h4>`);
  L.push(`<p>ρx = (σx + τ·cotθ)/fyd = (${p.sx} + ${p.txy}·${(1/Math.tan(r.theta_c)).toFixed(6)}) / ${r.fyd.toFixed(3)} = ${fmt(r.rho_x_M1)} → limited to ${fmt(r.rho_x_final)}</p>`);
  L.push(`<p>ρy = (σy + τ/ cotθ)/fyd = (${p.sy} + ${p.txy}/ ${(1/Math.tan(r.theta_c)).toFixed(6)}) / ${r.fyd.toFixed(3)} = ${fmt(r.rho_y_M1)} → limited to ${fmt(r.rho_y_final)}</p>`);

  return `<div class="detail">${L.join('\n')}</div>`;
}

// Plot with dynamic grid and probe
function drawMohr(results){ const canvas=document.getElementById('mohrCanvas'), ctx=canvas.getContext('2d'); const W=canvas.width,H=canvas.height; ctx.clearRect(0,0,W,H);
  const sAll=results.flatMap(({res})=>[res.s1,res.s2]); const tAll=results.flatMap(({res})=>[res.tau_max,-res.tau_max]); let sMin=Math.min(...sAll), sMax=Math.max(...sAll); let tMin=Math.min(...tAll), tMax=Math.max(...tAll); const pad=0.1; const sR=(sMax-sMin)||1; sMax+=pad*sR; sMin-=pad*sR; const tR=(tMax-tMin)||1; tMax+=pad*tR; tMin-=pad*tR;
  const left=60,right=W-20,top=20,bottom=H-60; const a=(right-left)/(sMax-sMin), b=left-a*sMin; const c=-(bottom-top)/(tMax-tMin), d=bottom-c*tMin; const cx0=0.5*(left+right), cy0=0.5*(top+bottom);
  const A=VIEW.zoom*a, B=VIEW.zoom*(b-cx0)+cx0+VIEW.panX, C=VIEW.zoom*c, D=VIEW.zoom*(d-cy0)+cy0+VIEW.panY; const Sx=s=>A*s+B, Sy=t=>C*t+D, invSx=x=>(x-B)/A, invSy=y=>(y-D)/C;
  const sVisMin=invSx(left), sVisMax=invSx(right), tVisMin=invSy(bottom), tVisMax=invSy(top); TRANSFORM={left,right,top,bottom,A,B,C,D,Sx,Sy,invSx,invSy,sVisMin,sVisMax,tVisMin,tVisMax};
  // axes
  ctx.strokeStyle='#2a3a72'; ctx.lineWidth=1.2; if(0>=tVisMin&&0<=tVisMax){ ctx.beginPath(); ctx.moveTo(Sx(sVisMin),Sy(0)); ctx.lineTo(Sx(sVisMax),Sy(0)); ctx.stroke(); } if(0>=sVisMin&&0<=sVisMax){ ctx.beginPath(); ctx.moveTo(Sx(0),Sy(tVisMax)); ctx.lineTo(Sx(0),Sy(tVisMin)); ctx.stroke(); }
  // grid
  ctx.font='12px system-ui'; ctx.fillStyle=getComputedStyle(document.body).getPropertyValue('--muted').trim()||'#b9c0d9'; const n=6; const sStep=niceStep((sVisMax-sVisMin)/n), tStep=niceStep((tVisMax-tVisMin)/n); const sStart=Math.ceil(sVisMin/sStep)*sStep, tStart=Math.ceil(tVisMin/tStep)*tStep; ctx.strokeStyle='#142050';
  for(let s=sStart; s<=sVisMax+1e-12; s+=sStep){ const x=Sx(s); ctx.beginPath(); ctx.moveTo(x,Sy(tVisMin)); ctx.lineTo(x,Sy(tVisMax)); ctx.stroke(); ctx.fillText(s.toFixed(Math.abs(sStep)<1?2:1), x-14, Sy(tVisMin)+40); }
  for(let t=tStart; t<=tVisMax+1e-12; t+=tStep){ const y=Sy(t); ctx.beginPath(); ctx.moveTo(Sx(sVisMin),y); ctx.lineTo(Sx(sVisMax),y); ctx.stroke(); if(Math.abs(t)>1e-9) ctx.fillText(t.toFixed(Math.abs(tStep)<1?2:1), Sx(sVisMin)-44, y+4); }
  if(0>=tVisMin&&0<=tVisMax) ctx.fillText('σ (MPa)', Sx(sVisMax)-48, Sy(0)-8); if(0>=sVisMin&&0<=sVisMax) ctx.fillText('τ (MPa)', Sx(0)+8, Sy(tVisMax)+14);
  // circles + principal labels
  const legend=document.getElementById('legend'); legend.innerHTML=''; results.forEach((item,i)=>{ const {p,res}=item; const color=colors[i%colors.length]; const cx=Sx(res.s_avg); const r=Math.abs(Sx(res.s_avg+res.R)-Sx(res.s_avg)); ctx.strokeStyle=color; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(cx, Sy(0), r, 0, Math.PI*2); ctx.stroke(); ctx.fillStyle=color; ctx.beginPath(); ctx.arc(Sx(res.s1), Sy(0), 3.5, 0, Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.arc(Sx(res.s2), Sy(0), 3.5, 0, Math.PI*2); ctx.fill(); ctx.textAlign='center'; ctx.fillText(`σ1=${res.s1.toFixed(2)}`, Sx(res.s1), Sy(0)-8); ctx.fillText(`σ2=${res.s2.toFixed(2)}`, Sx(res.s2), Sy(0)+16); const e=document.createElement('div'); e.className='entry'; e.innerHTML=`<span class="swatch" style="background:${color}"></span> ${p.label}`; legend.appendChild(e); });
  // probe overlay
  const probeDiv=ensureProbeDiv(); if(PROBE.enabled && PROBE.x!=null && PROBE.y!=null){ const inside=(PROBE.x>=left && PROBE.x<=right && PROBE.y>=top && PROBE.y<=bottom); if(inside){ const sigma=invSx(PROBE.x), tau=invSy(PROBE.y); let nearest=-1, minErr=Infinity; results.forEach((item,i)=>{ const {res}=item; const err=Math.abs(Math.hypot(sigma-res.s_avg, tau)-res.R); if(err<minErr){ minErr=err; nearest=i; } }); if(nearest>=0){ const {res}=results[nearest]; const cx=Sx(res.s_avg); const r=Math.abs(Sx(res.s_avg+res.R)-Sx(res.s_avg)); ctx.save(); ctx.strokeStyle=colors[nearest%colors.length]; ctx.lineWidth=3.5; ctx.setLineDash([6,4]); ctx.beginPath(); ctx.arc(cx,Sy(0),r,0,Math.PI*2); ctx.stroke(); ctx.restore(); }
    ctx.save(); ctx.strokeStyle='#8CE1FF'; ctx.setLineDash([5,4]); ctx.lineWidth=1.2; ctx.beginPath(); ctx.moveTo(PROBE.x,Sy(tVisMin)); ctx.lineTo(PROBE.x,Sy(tVisMax)); ctx.stroke(); ctx.beginPath(); ctx.moveTo(Sx(sVisMin),PROBE.y); ctx.lineTo(Sx(sVisMax),PROBE.y); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle='#8CE1FF'; ctx.beginPath(); ctx.arc(PROBE.x,PROBE.y,3,0,Math.PI*2); ctx.fill(); ctx.restore(); const rect=canvas.getBoundingClientRect(); probeDiv.style.display='block'; probeDiv.style.left=(rect.left+window.scrollX+PROBE.x)+'px'; probeDiv.style.top=(rect.top+window.scrollY+PROBE.y)+'px'; const nearTxt=nearest>=0?`, nearest: <strong>${results[nearest].p.label}</strong>`:''; probeDiv.innerHTML=`σ = ${sigma.toFixed(3)} MPa<br>τ = ${tau.toFixed(3)} MPa${nearTxt}${PROBE.locked?'<br><em>(locked)</em>':''}`; } else { probeDiv.style.display='none'; } } else { probeDiv.style.display='none'; }
  const zl=document.getElementById('zoom-level'); if(zl) zl.textContent=Math.round(VIEW.zoom*100)+'%';
}

function ensureProbeDiv(){ let d=document.getElementById('probe'); if(!d){ d=document.createElement('div'); d.id='probe'; d.className='probe'; d.style.display='none'; document.body.appendChild(d);} return d; }

function initZoomPan(){ const canvas=document.getElementById('mohrCanvas'); let dragging=false,lastX=0,lastY=0; canvas.addEventListener('mousedown',e=>{dragging=true;lastX=e.offsetX;lastY=e.offsetY}); window.addEventListener('mouseup',()=>{dragging=false}); window.addEventListener('mousemove',e=>{ if(!dragging) return; const r=canvas.getBoundingClientRect(); const x=e.clientX-r.left, y=e.clientY-r.top; VIEW.panX+=(x-lastX); VIEW.panY+=(y-lastY); lastX=x; lastY=y; runDesign(); }); canvas.addEventListener('wheel',e=>{ e.preventDefault(); const factor=(e.deltaY<0)?1.15:1/1.15; const prev=VIEW.zoom, next=clamp(prev*factor,0.2,10); const r=canvas.getBoundingClientRect(); const cx=r.width/2, cy=r.height/2; VIEW.panX=cx+(VIEW.panX-cx)*(next/prev); VIEW.panY=cy+(VIEW.panY-cy)*(next/prev); VIEW.zoom=next; runDesign(); },{passive:false}); canvas.addEventListener('mousemove',e=>{ if(!PROBE.enabled||dragging) return; const r=canvas.getBoundingClientRect(); PROBE.x=e.clientX-r.left; PROBE.y=e.clientY-r.top; if(!PROBE.locked) drawMohr(LAST_RESULTS); }); canvas.addEventListener('mouseleave',()=>{ if(!PROBE.enabled||PROBE.locked) return; PROBE.x=PROBE.y=null; const d=document.getElementById('probe'); if(d) d.style.display='none'; drawMohr(LAST_RESULTS); }); canvas.addEventListener('click',()=>{ if(!PROBE.enabled) return; PROBE.locked=!PROBE.locked; drawMohr(LAST_RESULTS); }); document.getElementById('zoom-in').addEventListener('click',()=>setZoom(VIEW.zoom*1.25)); document.getElementById('zoom-out').addEventListener('click',()=>setZoom(VIEW.zoom/1.25)); document.getElementById('zoom-reset').addEventListener('click',()=>{ VIEW.zoom=1; VIEW.panX=0; VIEW.panY=0; runDesign(); }); const probeBtn=document.getElementById('probe-toggle'); if(probeBtn){ probeBtn.addEventListener('click',()=>{ PROBE.enabled=!PROBE.enabled; PROBE.locked=false; probeBtn.textContent=PROBE.enabled?'Probe: On':'Probe: Off'; drawMohr(LAST_RESULTS); }); } }

function setZoom(z){ const prev=VIEW.zoom, next=clamp(z,0.2,10); const c=document.getElementById('mohrCanvas'); const cx=c.width/2, cy=c.height/2; VIEW.panX=cx+(VIEW.panX-cx)*(next/prev); VIEW.panY=cy+(VIEW.panY-cy)*(next/prev); VIEW.zoom=next; runDesign(); }

function renumberRows(){ document.querySelectorAll('#stress-table tbody tr').forEach((tr,i)=> tr.querySelector('td').textContent=String(i+1)); }
function addRow(v={sx:0,sy:0,txy:0,label:''}){ const tb=document.querySelector('#stress-table tbody'); const tr=document.createElement('tr'); tr.innerHTML=`<td></td><td><input type='number' step='0.1' value='${v.sx}'/></td><td><input type='number' step='0.1' value='${v.sy}'/></td><td><input type='number' step='0.1' value='${v.txy}'/></td><td><input type='text' value='${v.label}'/></td><td><button class='icon-btn remove' title='Remove'>✕</button></td>`; tr.querySelector('.remove').addEventListener('click',()=>{ tr.remove(); renumberRows(); }); tb.appendChild(tr); renumberRows(); }
function loadSample(){ const ex=[{sx:12,sy:-6,txy:4,label:'A'},{sx:-8,sy:-10,txy:5,label:'B'},{sx:3,sy:2,txy:1.5,label:'C'}]; const tb=document.querySelector('#stress-table tbody'); tb.innerHTML=''; ex.forEach(addRow); }

// Bootstrap
window.addEventListener('DOMContentLoaded',()=>{ loadTheme(); document.getElementById('theme-toggle').addEventListener('click',toggleTheme); document.getElementById('btn-run').addEventListener('click',runDesign); document.getElementById('btn-reset').addEventListener('click',()=>{ VIEW.zoom=1; VIEW.panX=0; VIEW.panY=0; window.location.reload(); }); document.getElementById('btn-print').addEventListener('click',()=>window.print()); document.getElementById('add-row').addEventListener('click',()=>addRow()); document.getElementById('sample-data').addEventListener('click',loadSample); document.querySelectorAll('.remove').forEach(b=>b.addEventListener('click',e=>{ e.target.closest('tr').remove(); renumberRows(); })); initZoomPan(); runDesign(); });
