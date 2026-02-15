// RC Membrane Elements — In-plane stresses
// Update: include σ_cd check even when "No reinforcement required" condition is met.
// Logic summary:
//  - θ from stress state (principal stress direction θp -> compressive direction θc -> acute θ for cotθ)
//  - General method: ρ_raw -> ρ_gen=max(0,ρ_raw)
//  - Optimum reference: ρ'
//  - Provided: ρ_prov = max(ρ_gen, ρ')
//  - Final limitation checks on ρ_prov: if ρ' > 0 then 0.4ρ' ≤ ρ_prov ≤ 2.5ρ'
//  - Concrete compression check always performed: σ_cd ≤ ν·f_cd (even if reinforcement not required)

const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

const fckRef = 40.0; // MPa
const colors = ['#2563eb','#f97316','#22c55e','#a855f7','#ef4444','#14b8a6','#eab308','#0ea5e9','#f43f5e','#84cc16'];

function fmt(x, d=3){
  if (!isFinite(x)) return '—';
  const v = Math.abs(x) < 0.5 * Math.pow(10, -d) ? 0 : x;
  return Number(v).toFixed(d);
}
function fmtDeg(x){
  if (!isFinite(x)) return '—';
  const v = Math.abs(x) < 1e-10 ? 0 : x;
  return Number(v).toFixed(2);
}

function readGlobalInputs(){
  const fck = parseFloat($('#fck').value);
  const gammaC = parseFloat($('#gammaC').value);
  const ktc = parseFloat($('#ktc').value);
  const fyk = parseFloat($('#fyk').value);
  const gammaS = parseFloat($('#gammaS').value);
  const nu = parseFloat($('#nu').value);

  if (![fck, gammaC, ktc, fyk, gammaS, nu].every(v => isFinite(v))) {
    throw new Error('Please enter valid numeric values for material inputs.');
  }
  if (fck <= 0 || gammaC <= 0 || ktc <= 0 || fyk <= 0 || gammaS <= 0 || nu <= 0) {
    throw new Error('Material inputs must be positive.');
  }

  const etaCc = Math.min(Math.pow(fckRef / fck, 1/3), 1.0);
  const fcd = etaCc * ktc * fck / gammaC;
  const fyd = fyk / gammaS;

  return { fck, gammaC, ktc, fyk, gammaS, nu, etaCc, fcd, fyd };
}

function readStressPoints(){
  return $$('#stressTbody tr').map((tr, idx) => {
    const inputs = $$('input', tr);
    const name = inputs[0].value.trim() || `P${idx+1}`;
    const sx = parseFloat(inputs[1].value);
    const sy = parseFloat(inputs[2].value);
    const txy = parseFloat(inputs[3].value);
    if (![sx, sy, txy].every(v => isFinite(v))) throw new Error(`Please enter valid stresses for ${name}.`);
    return { name, sx, sy, txy };
  });
}

function principalStresses(sx, sy, txy){
  const sAvg = 0.5 * (sx + sy);
  const R = Math.sqrt(Math.pow(0.5*(sx - sy), 2) + txy*txy);
  const s1 = sAvg + R;
  const s2 = sAvg - R;
  const tauMax = R;
  const thetaP = 0.5 * Math.atan2(2*txy, (sx - sy)); // radians
  return { sAvg, R, s1, s2, tauMax, thetaP };
}

function reinforcementNoneCheck(sx, sy, txy){
  return (sx < 0 && sy < 0 && (sx*sy > txy*txy));
}

function optimumReference(sx, sy, txy, fyd){
  const tau = Math.abs(txy);
  let caseName = '—';
  let rhoPx = NaN, rhoPy = NaN, sigmaPcdRaw = NaN;

  if (sx >= -tau && sy >= -tau){
    caseName = 'Case A';
    rhoPx = (sx + tau) / fyd;
    rhoPy = (sy + tau) / fyd;
    sigmaPcdRaw = 2 * tau;
  } else if (sx < -tau && sx <= sy && (sx*sy <= tau*tau)){
    caseName = 'Case B';
    rhoPx = 0;
    rhoPy = (sy + (tau*tau)/sx) / fyd;
    sigmaPcdRaw = sx * (1 + Math.pow(tau/sx, 2));
  } else if (sy < -tau && sx >= sy && (sx*sy <= tau*tau)){
    caseName = 'Case C';
    rhoPx = (sx + (tau*tau)/sy) / fyd;
    rhoPy = 0;
    sigmaPcdRaw = sy * (1 + Math.pow(tau/sy, 2));
  }

  return {
    caseName,
    tau,
    rhoXprime: isFinite(rhoPx) ? Math.max(0, rhoPx) : NaN,
    rhoYprime: isFinite(rhoPy) ? Math.max(0, rhoPy) : NaN,
    sigmaPcdRaw
  };
}

function thetaConcreteFromStress(sx, sy, txy){
  const pr = principalStresses(sx, sy, txy);
  const thetaP = pr.thetaP;
  const thetaDir1 = thetaP;
  const thetaDir2 = thetaP + Math.PI/2;

  const useDir2 = (pr.s2 <= pr.s1);
  const thetaCdir = useDir2 ? thetaDir2 : thetaDir1;

  let th = Math.abs(thetaCdir) % Math.PI;
  if (th > Math.PI/2) th = Math.PI - th;

  const eps = 1e-9;
  th = Math.max(eps, Math.min(Math.PI/2 - eps, th));

  return {
    thetaPdeg: thetaP * 180/Math.PI,
    thetaCdeg: thetaCdir * 180/Math.PI,
    thetaDeg: th * 180/Math.PI,
    thetaAcute: th,
    pr
  };
}

function limitationBand(rhoPrime){
  if (!isFinite(rhoPrime) || rhoPrime <= 0) {
    return { applicable: false, lo: 0, hi: Infinity };
  }
  return { applicable: true, lo: 0.4 * rhoPrime, hi: 2.5 * rhoPrime };
}

function designReinforcement(point, mat){
  const {sx, sy, txy} = point;
  const {fyd, fcd, nu} = mat;
  const tau = Math.abs(txy);
  const sigmaLimit = nu * fcd;

  const pr = principalStresses(sx, sy, txy);

  // Always compute θ and σ_cd for reporting + concrete check
  const th = thetaConcreteFromStress(sx, sy, txy);
  const cot = 1 / Math.tan(th.thetaAcute);
  const sigmaPcdRaw = tau * (cot + 1/cot);
  const sigmaCd = Math.abs(sigmaPcdRaw);
  const okConcrete = sigmaCd <= sigmaLimit + 1e-9;

  const noReinf = reinforcementNoneCheck(sx, sy, txy);
  if (noReinf){
    return {
      requiresReinf: false,
      method: 'No reinforcement required (σcd checked)',
      caseName: 'Compression-dominant',
      thetaPdeg: th.thetaPdeg,
      thetaCdeg: th.thetaCdeg,
      thetaDeg: th.thetaDeg,
      cot,
      rhoXraw: 0, rhoYraw: 0,
      rhoXgen: 0, rhoYgen: 0,
      rhoXprime: 0, rhoYprime: 0,
      rhoXprov: 0, rhoYprov: 0,
      rhoX: 0, rhoY: 0,
      governsX: '—', governsY: '—',
      limX: { applicable: false, lo: 0, hi: Infinity },
      limY: { applicable: false, lo: 0, hi: Infinity },
      limPassX: true,
      limPassY: true,
      refCase: '—', refTau: tau, refSigmaPcdRaw: 0,
      sigmaCd,
      sigmaPcdRaw,
      sigmaLimit,
      okConcrete,
      okLimit: true,
      ok: okConcrete,
      pr
    };
  }

  const rhoXraw = (sx + tau * cot) / fyd;
  const rhoYraw = (sy + tau / cot) / fyd;

  const rhoXgen = Math.max(0, rhoXraw);
  const rhoYgen = Math.max(0, rhoYraw);

  const ref = optimumReference(sx, sy, txy, fyd);
  const rhoXprime = ref.rhoXprime;
  const rhoYprime = ref.rhoYprime;

  const rhoXprov = Math.max(rhoXgen, isFinite(rhoXprime) ? rhoXprime : 0);
  const rhoYprov = Math.max(rhoYgen, isFinite(rhoYprime) ? rhoYprime : 0);

  const governsX = (isFinite(rhoXprime) && rhoXprime > rhoXgen + 1e-12) ? 'Optimum (ρ′)' : 'General (ρgen)';
  const governsY = (isFinite(rhoYprime) && rhoYprime > rhoYgen + 1e-12) ? 'Optimum (ρ′)' : 'General (ρgen)';

  const limX = limitationBand(rhoXprime);
  const limY = limitationBand(rhoYprime);

  const limPassX = (!limX.applicable) ? true : (rhoXprov >= limX.lo - 1e-12 && rhoXprov <= limX.hi + 1e-12);
  const limPassY = (!limY.applicable) ? true : (rhoYprov >= limY.lo - 1e-12 && rhoYprov <= limY.hi + 1e-12);

  const okLimit = limPassX && limPassY;
  const ok = okConcrete && okLimit;

  return {
    requiresReinf: true,
    method: 'General + Optimum envelope',
    caseName: 'Envelope of ρgen and ρ′',
    thetaPdeg: th.thetaPdeg,
    thetaCdeg: th.thetaCdeg,
    thetaDeg: th.thetaDeg,
    cot,
    rhoXraw,
    rhoYraw,
    rhoXgen,
    rhoYgen,
    rhoXprime,
    rhoYprime,
    rhoXprov,
    rhoYprov,
    rhoX: rhoXprov,
    rhoY: rhoYprov,
    governsX,
    governsY,
    limX,
    limY,
    limPassX,
    limPassY,
    refCase: ref.caseName,
    refTau: ref.tau,
    refSigmaPcdRaw: ref.sigmaPcdRaw,
    sigmaCd,
    sigmaPcdRaw,
    sigmaLimit,
    okConcrete,
    okLimit,
    ok,
    pr
  };
}

function computeAll(){
  const mat = readGlobalInputs();
  const points = readStressPoints();

  $('#etaCc').textContent = fmt(mat.etaCc, 3);
  $('#fcd').textContent = fmt(mat.fcd, 3);
  $('#fyd').textContent = fmt(mat.fyd, 3);
  $('#nuFcd').textContent = fmt(mat.nu * mat.fcd, 3);

  const results = points.map((p, idx) => {
    const pr = principalStresses(p.sx, p.sy, p.txy);
    const reinf = designReinforcement(p, mat);
    return { ...p, color: colors[idx % colors.length], ...pr, thetaPdeg: pr.thetaP * 180/Math.PI, reinf };
  });

  return { mat, points, results };
}

function setStatus(msg, type='info'){
  const el = $('#status');
  el.textContent = msg;
  el.style.color = (type === 'error') ? 'var(--danger)' : 'var(--muted)';
}

function renderSummary({results}){
  const tbody = $('#resultsTbody');
  tbody.innerHTML = '';

  results.forEach(r => {
    const badgeClass = r.reinf.ok ? 'badge--ok' : 'badge--bad';
    const statusText = r.reinf.ok ? 'OK' : (r.reinf.okConcrete ? 'Limit' : 'Check');

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="badge" style="border-color: color-mix(in srgb, ${r.color} 55%, var(--border));"><span class="swatch" style="background:${r.color}"></span>${r.name}</span></td>
      <td>${fmt(r.s1,3)}</td>
      <td>${fmt(r.s2,3)}</td>
      <td>${fmt(r.tauMax,3)}</td>
      <td>${fmtDeg(r.thetaPdeg)}</td>
      <td>${fmt(r.reinf.rhoX,5)}</td>
      <td>${fmt(r.reinf.rhoY,5)}</td>
      <td>${fmt(r.reinf.sigmaCd,3)}</td>
      <td>${fmt(r.reinf.sigmaLimit,3)}</td>
      <td><span class="badge ${badgeClass}">${statusText}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

function renderDetailed({mat, results}){
  const root = $('#details');

  const matBlock = `
    <div class="calc-block">
      <h3>Material design strengths</h3>
      <div class="step">
        <div class="title">1) Concrete strength reduction factor</div>
        <div class="eq">η<sub>cc</sub> = (f<sub>ck,ref</sub> / f<sub>ck</sub>)<sup>1/3</sup> ≤ 1.0  |  f<sub>ck,ref</sub> = ${fmt(fckRef,0)} MPa<br/>
        η<sub>cc</sub> = (${fmt(fckRef,0)} / ${fmt(mat.fck,3)})<sup>1/3</sup> = ${fmt(mat.etaCc,3)}</div>
      </div>
      <div class="step">
        <div class="title">2) Design compressive strength of concrete</div>
        <div class="eq">f<sub>cd</sub> = η<sub>cc</sub> · k<sub>tc</sub> · f<sub>ck</sub> / γ<sub>c</sub><br/>
        f<sub>cd</sub> = ${fmt(mat.etaCc,3)} · ${fmt(mat.ktc,3)} · ${fmt(mat.fck,3)} / ${fmt(mat.gammaC,3)} = ${fmt(mat.fcd,3)} MPa</div>
      </div>
      <div class="step">
        <div class="title">3) Design yield strength of reinforcement</div>
        <div class="eq">f<sub>yd</sub> = f<sub>yk</sub> / γ<sub>s</sub><br/>
        f<sub>yd</sub> = ${fmt(mat.fyk,3)} / ${fmt(mat.gammaS,3)} = ${fmt(mat.fyd,3)} MPa</div>
      </div>
      <div class="step">
        <div class="title">4) Concrete stress limit</div>
        <div class="eq">σ<sub>cd</sub> ≤ ν·f<sub>cd</sub>  with ν = ${fmt(mat.nu,3)}<br/>
        ν·f<sub>cd</sub> = ${fmt(mat.nu,3)} · ${fmt(mat.fcd,3)} = ${fmt(mat.nu*mat.fcd,3)} MPa</div>
      </div>
    </div>
  `;

  const pointBlocks = results.map((r) => {
    const sx = r.sx, sy = r.sy, txy = r.txy;
    const tauAbs = Math.abs(txy);
    const reinf = r.reinf;

    const badge = reinf.ok ? `<span class="badge badge--ok">OK</span>` : `<span class="badge badge--bad">Check</span>`;

    const noneCond = reinforcementNoneCheck(sx, sy, txy);
    const noneText = noneCond
      ? `Condition met: σ<sub>x</sub> < 0, σ<sub>y</sub> < 0 and (σ<sub>x</sub>·σ<sub>y</sub>) > τ<sub>xy</sub><sup>2</sup> ⇒ reinforcement not required.`
      : `Condition not met ⇒ reinforcement design required.`;

    const stepE = `
      <div class="eq">
        Principal stress direction angle: θ<sub>p</sub> = ${fmtDeg(reinf.thetaPdeg)}°.<br/>
        Compressive principal direction: θ<sub>c</sub> = ${fmtDeg(reinf.thetaCdeg)}°.<br/>
        Acute equivalent used in cotθ: θ = ${fmtDeg(reinf.thetaDeg)}° ⇒ cotθ = ${fmt(reinf.cot,6)}<br/><br/>
        σ<sub>cd</sub> = |τ|·(cotθ + 1/cotθ) = ${fmt(reinf.sigmaCd,3)} MPa ≤ ν·f<sub>cd</sub> = ${fmt(reinf.sigmaLimit,3)} MPa ⇒ ${reinf.okConcrete ? 'PASS' : 'FAIL'}
        ${reinf.requiresReinf ? '<br/><br/>ρ calculations shown below.' : '<br/><br/>No reinforcement required; concrete compression check still reported above.'}
        ${reinf.requiresReinf ? `<br/>ρ<sub>x,raw</sub> = (${fmt(sx,3)} + ${fmt(tauAbs,3)}·${fmt(reinf.cot,6)})/${fmt(mat.fyd,3)} = ${fmt(reinf.rhoXraw,6)}<br/>
        ρ<sub>y,raw</sub> = (${fmt(sy,3)} + ${fmt(tauAbs,3)}/${fmt(reinf.cot,6)})/${fmt(mat.fyd,3)} = ${fmt(reinf.rhoYraw,6)}<br/>
        Avoid negative: ρ<sub>x,gen</sub> = ${fmt(reinf.rhoXgen,6)} ; ρ<sub>y,gen</sub> = ${fmt(reinf.rhoYgen,6)}` : ''}
      </div>
    `;

    const refCase = reinf.refCase || '—';
    const rhoXprimeFormula = (refCase === 'Case B') ? '0'
      : (refCase === 'Case A') ? '(σx + |τ|)/fyd'
      : (refCase === 'Case C') ? '(σx + |τ|^2/σy)/fyd'
      : '—';

    const rhoYprimeFormula = (refCase === 'Case C') ? '0'
      : (refCase === 'Case A') ? '(σy + |τ|)/fyd'
      : (refCase === 'Case B') ? '(σy + |τ|^2/σx)/fyd'
      : '—';

    const sigmaPrimeFormula = (refCase === 'Case A') ? '2|τ|'
      : (refCase === 'Case B') ? 'σx·[1+(|τ|/σx)^2]'
      : (refCase === 'Case C') ? 'σy·[1+(|τ|/σy)^2]'
      : '—';

    const limXtxt = reinf.limX && reinf.limX.applicable ? `[${fmt(reinf.limX.lo,6)}, ${fmt(reinf.limX.hi,6)}]` : 'N/A';
    const limYtxt = reinf.limY && reinf.limY.applicable ? `[${fmt(reinf.limY.lo,6)}, ${fmt(reinf.limY.hi,6)}]` : 'N/A';

    const stepF = reinf.requiresReinf ? `
      <div class="eq">
        <b>Optimum reinforcement reference (ρ')</b><br/>
        Inputs used for this step: |τ<sub>xy</sub>| = ${fmt(Math.abs(reinf.refTau),3)} MPa, f<sub>yd</sub> = ${fmt(mat.fyd,3)} MPa, σ<sub>x</sub> = ${fmt(sx,3)} MPa, σ<sub>y</sub> = ${fmt(sy,3)} MPa<br/>
        <b>${refCase}</b> applied.<br/>
        ρ'<sub>x</sub> = ${rhoXprimeFormula} = ${fmt(reinf.rhoXprime,6)}<br/>
        ρ'<sub>y</sub> = ${rhoYprimeFormula} = ${fmt(reinf.rhoYprime,6)}<br/>
        σ'<sub>cd</sub> = ${sigmaPrimeFormula} = ${fmt(reinf.refSigmaPcdRaw,3)} MPa<br/><br/>

        <b>Envelope reinforcement</b><br/>
        ρ<sub>x,prov</sub> = ${fmt(reinf.rhoXprov,6)} (governs: ${reinf.governsX})<br/>
        ρ<sub>y,prov</sub> = ${fmt(reinf.rhoYprov,6)} (governs: ${reinf.governsY})<br/><br/>

        <b>Final limitation checks on ρ<sub>prov</sub></b><br/>
        X: 0.4ρ'<sub>x</sub> ≤ ρ<sub>x,prov</sub> ≤ 2.5ρ'<sub>x</sub> ⇒ bounds ${limXtxt} ; ρ<sub>x,prov</sub> = ${fmt(reinf.rhoXprov,6)} ⇒ ${reinf.limPassX ? 'PASS' : 'FAIL'}<br/>
        Y: 0.4ρ'<sub>y</sub> ≤ ρ<sub>y,prov</sub> ≤ 2.5ρ'<sub>y</sub> ⇒ bounds ${limYtxt} ; ρ<sub>y,prov</sub> = ${fmt(reinf.rhoYprov,6)} ⇒ ${reinf.limPassY ? 'PASS' : 'FAIL'}
      </div>
    ` : `
      <div class="eq"><b>Optimum reference & limitation checks</b><br/>
      Not applicable because reinforcement is not required by the stress condition. Concrete σ<sub>cd</sub> check is still performed in Step E.</div>
    `;

    return `
      <div class="calc-block">
        <h3>${r.name} <span class="badge" style="margin-left:8px;border-color:color-mix(in srgb, ${r.color} 55%, var(--border));"><span class="swatch" style="background:${r.color}"></span>${reinf.method}</span> ${badge}</h3>

        <div class="step"><div class="title">A) Given in-plane stresses (MPa)</div>
          <div class="eq">σ<sub>x</sub> = ${fmt(sx,3)} ,  σ<sub>y</sub> = ${fmt(sy,3)} ,  τ<sub>xy</sub> = ${fmt(txy,3)} (|τ<sub>xy</sub>| = ${fmt(tauAbs,3)})</div>
        </div>

        <div class="step"><div class="title">B) Principal stresses and maximum shear stress</div>
          <div class="eq">σ<sub>1</sub>, σ<sub>2</sub> = (σ<sub>x</sub> + σ<sub>y</sub>)/2 ± √(((σ<sub>x</sub> − σ<sub>y</sub>)/2)<sup>2</sup> + τ<sub>xy</sub><sup>2</sup>)<br/>
          (σ<sub>x</sub>+σ<sub>y</sub>)/2 = (${fmt(sx,3)} + ${fmt(sy,3)})/2 = ${fmt(r.sAvg,3)}<br/>
          √(((σ<sub>x</sub>−σ<sub>y</sub>)/2)<sup>2</sup> + τ<sub>xy</sub><sup>2</sup>) = √((( ${fmt(sx,3)} − ${fmt(sy,3)} )/2)<sup>2</sup> + (${fmt(txy,3)})<sup>2</sup>) = ${fmt(r.R,3)}<br/>
          ⇒ σ<sub>1</sub> = ${fmt(r.s1,3)} ; σ<sub>2</sub> = ${fmt(r.s2,3)} ; τ<sub>max</sub> = ${fmt(r.tauMax,3)}</div>
        </div>

        <div class="step"><div class="title">C) Principal stress direction angle</div>
          <div class="eq">tan(2θ<sub>p</sub>) = 2τ<sub>xy</sub> / (σ<sub>x</sub> − σ<sub>y</sub>)<br/>
          2θ<sub>p</sub> = atan2(2·${fmt(txy,3)}, ${fmt(sx - sy,3)}) ⇒ θ<sub>p</sub> = ${fmtDeg(r.thetaPdeg)}°</div>
        </div>

        <div class="step"><div class="title">D) Check if reinforcement is required</div>
          <div class="eq">If σ<sub>x</sub> and σ<sub>y</sub> are both compressive (σ<sub>x</sub>, σ<sub>y</sub> &lt; 0) and (σ<sub>x</sub>·σ<sub>y</sub>) &gt; τ<sub>xy</sub><sup>2</sup>, reinforcement is not required.<br/>
          Here: σ<sub>x</sub>·σ<sub>y</sub> = (${fmt(sx,3)})·(${fmt(sy,3)}) = ${fmt(sx*sy,3)} ; τ<sub>xy</sub><sup>2</sup> = (${fmt(txy,3)})<sup>2</sup> = ${fmt(txy*txy,3)}<br/>
          ${noneText}</div>
        </div>

        <div class="step"><div class="title">E) Concrete compression check & (if required) general method</div>
          ${stepE}
        </div>

        <div class="step"><div class="title">F) Optimum reference, envelope & limitation checks</div>
          ${stepF}
        </div>

      </div>
    `;
  }).join('');

  root.innerHTML = matBlock + pointBlocks;
}

// Mohr's Circle (FIXED)
function drawMohr({results}){
  const canvas = $('#mohrCanvas');
  const ctx = canvas.getContext('2d');

  const cssWidth = canvas.clientWidth;
  const cssHeight = canvas.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const W = cssWidth;
  const H = cssHeight;

  let sigMin = Infinity, sigMax = -Infinity;
  let tauAbsMax = 0;
  results.forEach(r => {
    sigMin = Math.min(sigMin, r.s2, r.s1, r.sx, r.sy);
    sigMax = Math.max(sigMax, r.s2, r.s1, r.sx, r.sy);
    tauAbsMax = Math.max(tauAbsMax, Math.abs(r.tauMax), Math.abs(r.txy));
  });

  const sigRange0 = Math.max(1e-6, sigMax - sigMin);
  sigMin -= 0.15 * sigRange0;
  sigMax += 0.15 * sigRange0;

  const tauPad = 0.25 * Math.max(1, tauAbsMax);
  let tauMin = -(tauAbsMax + tauPad);
  let tauMax = +(tauAbsMax + tauPad);

  const plot = { left: 60, right: 20, top: 20, bottom: 52 };
  const pxW = W - plot.left - plot.right;
  const pxH = H - plot.top - plot.bottom;

  const sigRange = Math.max(1e-6, sigMax - sigMin);
  const tauRange = Math.max(1e-6, tauMax - tauMin);
  const scale = Math.min(pxW / sigRange, pxH / tauRange);

  const sigMid = 0.5 * (sigMin + sigMax);
  const needSigRange = pxW / scale;
  sigMin = sigMid - 0.5 * needSigRange;
  sigMax = sigMid + 0.5 * needSigRange;

  const needTauRange = pxH / scale;
  tauMin = -0.5 * needTauRange;
  tauMax = +0.5 * needTauRange;

  const xOf = s => plot.left + (s - sigMin) * scale;
  const yOf = t => plot.top + (tauMax - t) * scale;

  ctx.clearRect(0,0,W,H);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--panel').trim();
  ctx.fillRect(0,0,W,H);

  const gridColor = getComputedStyle(document.documentElement).getPropertyValue('--border').trim();
  const textColor = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim();
  const axisColor = getComputedStyle(document.documentElement).getPropertyValue('--text').trim();

  function niceStep(range){
    const rough = range / 8;
    const pow10 = Math.pow(10, Math.floor(Math.log10(rough)));
    const n = rough / pow10;
    const step = (n < 1.5) ? 1 : (n < 3) ? 2 : (n < 7) ? 5 : 10;
    return step * pow10;
  }

  const sxStep = niceStep(sigMax - sigMin);
  const txStep = niceStep(tauMax - tauMin);

  ctx.lineWidth = 1;
  ctx.strokeStyle = gridColor;

  const xStart = Math.floor(sigMin / sxStep) * sxStep;
  for (let s = xStart; s <= sigMax + 1e-9; s += sxStep){
    const x = xOf(s);
    ctx.beginPath();
    ctx.moveTo(x, plot.top);
    ctx.lineTo(x, H - plot.bottom);
    ctx.stroke();
  }

  const yStart = Math.floor(tauMin / txStep) * txStep;
  for (let t = yStart; t <= tauMax + 1e-9; t += txStep){
    const y = yOf(t);
    ctx.beginPath();
    ctx.moveTo(plot.left, y);
    ctx.lineTo(W - plot.right, y);
    ctx.stroke();
  }

  const x0 = xOf(0);
  const y0 = yOf(0);
  ctx.strokeStyle = axisColor;
  ctx.lineWidth = 1.5;

  ctx.beginPath();
  ctx.moveTo(plot.left, y0);
  ctx.lineTo(W - plot.right, y0);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x0, plot.top);
  ctx.lineTo(x0, H - plot.bottom);
  ctx.stroke();

  ctx.fillStyle = axisColor;
  ctx.font = '600 13px ui-sans-serif, system-ui, -apple-system, Segoe UI';
  ctx.fillText('σ (MPa)', W - plot.right - 60, y0 - 8);
  ctx.save();
  ctx.translate(x0 + 10, plot.top + 16);
  ctx.rotate(-Math.PI/2);
  ctx.fillText('τ (MPa)', 0, 0);
  ctx.restore();

  ctx.fillStyle = textColor;
  ctx.font = '12px ui-sans-serif, system-ui, -apple-system, Segoe UI';

  for (let s = xStart; s <= sigMax + 1e-9; s += sxStep){
    const x = xOf(s);
    ctx.beginPath();
    ctx.moveTo(x, y0-4);
    ctx.lineTo(x, y0+4);
    ctx.strokeStyle = axisColor;
    ctx.stroke();
    ctx.fillText(s.toFixed(0), x-8, H - plot.bottom + 18);
  }

  for (let t = yStart; t <= tauMax + 1e-9; t += txStep){
    const y = yOf(t);
    ctx.beginPath();
    ctx.moveTo(x0-4, y);
    ctx.lineTo(x0+4, y);
    ctx.strokeStyle = axisColor;
    ctx.stroke();
    if (Math.abs(t) > 1e-9) ctx.fillText(t.toFixed(0), 10, y+4);
  }

  results.forEach((r, idx) => {
    const cx = xOf(r.sAvg);
    const cy = yOf(0);
    const rpx = r.R * scale;

    ctx.strokeStyle = r.color;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(cx, cy, rpx, 0, 2*Math.PI);
    ctx.stroke();

    const Ax = xOf(r.sx), Ay = yOf(r.txy);
    const Bx = xOf(r.sy), By = yOf(-r.txy);

    ctx.fillStyle = r.color;
    ctx.beginPath(); ctx.arc(Ax, Ay, 3.6, 0, 2*Math.PI); ctx.fill();
    ctx.beginPath(); ctx.arc(Bx, By, 3.6, 0, 2*Math.PI); ctx.fill();

    const s1x = xOf(r.s1);
    const s2x = xOf(r.s2);
    ctx.fillStyle = r.color;
    ctx.font = '600 12px ui-sans-serif, system-ui, -apple-system, Segoe UI';
    ctx.fillText(`σ1=${r.s1.toFixed(2)}`, s1x - 28, y0 - 10 - (idx%2)*14);
    ctx.fillText(`σ2=${r.s2.toFixed(2)}`, s2x - 28, y0 + 18 + (idx%2)*14);
  });

  const legend = $('#legend');
  legend.innerHTML = results.map(r => `
    <div class="legend-item"><span class="swatch" style="background:${r.color}"></span><span>${r.name}</span></div>
  `).join('');
}

function addStressRow(name=''){
  const tbody = $('#stressTbody');
  const idx = tbody.children.length + 1;
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input class="in-table" value="${name || ('P'+idx)}" /></td>
    <td><input class="in-table" type="number" step="0.01" value="0" /></td>
    <td><input class="in-table" type="number" step="0.01" value="0" /></td>
    <td><input class="in-table" type="number" step="0.01" value="0" /></td>
    <td><button class="btn btn--ghost btn--danger" type="button" title="Remove">✖</button></td>
  `;
  tbody.appendChild(tr);
  updateRemoveButtons();
}

function updateRemoveButtons(){
  const rows = $$('#stressTbody tr');
  rows.forEach((tr) => {
    const btn = $('button', tr);
    btn.disabled = rows.length === 1;
    btn.onclick = () => {
      if (rows.length === 1) return;
      tr.remove();
      updateRemoveButtons();
    };
  });
}

function setupTheme(){
  const saved = localStorage.getItem('theme') || 'light';
  document.documentElement.dataset.theme = saved;
  $('#themeToggle').addEventListener('click', () => {
    const next = (document.documentElement.dataset.theme === 'dark') ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('theme', next);
    try { drawMohr(computeAll()); } catch { /* ignore */ }
  });
}

function main(){
  setupTheme();
  updateRemoveButtons();

  $('#addPointBtn').addEventListener('click', () => addStressRow());
  $('#printBtn').addEventListener('click', () => window.print());

  $('#calcBtn').addEventListener('click', () => {
    try{
      const data = computeAll();
      renderSummary(data);
      renderDetailed(data);
      setStatus(`Calculated ${data.results.length} point(s).`, 'info');
    }catch(err){
      setStatus(err.message || String(err), 'error');
    }
  });

  $('#plotBtn').addEventListener('click', () => {
    try{
      const data = computeAll();
      renderSummary(data);
      renderDetailed(data);
      drawMohr(data);
      setStatus(`Plotted Mohr's circle for ${data.results.length} point(s).`, 'info');
      document.getElementById('mohrPanel').scrollIntoView({behavior:'smooth', block:'start'});
    }catch(err){
      setStatus(err.message || String(err), 'error');
    }
  });

  try{
    const data = computeAll();
    renderSummary(data);
    renderDetailed(data);
    drawMohr(data);
    setStatus('Ready. Update inputs and press Calculate.', 'info');
  }catch{
    setStatus('Ready.', 'info');
  }

  window.addEventListener('resize', () => {
    try{ drawMohr(computeAll()); }catch{ /* ignore */ }
  });
}

document.addEventListener('DOMContentLoaded', main);
