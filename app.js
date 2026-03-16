// RC Membrane Elements — In-plane stresses
// Design logic:
// - General method uses selected θ mode (principal/user/envelope)
// - Envelope mode compares principal θ and user θ only
// - Optimum method provides reference ρ′ and optimum angle θ′ for limitation checks and user information
// - Final design reinforcement is based on the selected GENERAL method only
// - IMPORTANT: |τxy| is used in reinforcement equations and concrete stress magnitude checks

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const fckRef = 40.0; // MPa
const colors = ['#2563eb', '#f97316', '#22c55e', '#a855f7', '#ef4444', '#14b8a6', '#eab308', '#0ea5e9', '#f43f5e', '#84cc16'];

let lastPlotData = null;

function fmt(x, d = 3) {
  if (!isFinite(x)) return '—';
  const v = Math.abs(x) < 0.5 * Math.pow(10, -d) ? 0 : x;
  return Number(v).toFixed(d);
}
function fmtDeg(x) {
  if (!isFinite(x)) return '—';
  const v = Math.abs(x) < 1e-10 ? 0 : x;
  return Number(v).toFixed(2);
}

function readGlobalInputs() {
  const fck = parseFloat($('#fck').value);
  const gammaC = parseFloat($('#gammaC').value);
  const ktc = parseFloat($('#ktc').value);
  const fyk = parseFloat($('#fyk').value);
  const gammaS = parseFloat($('#gammaS').value);
  const nu = parseFloat($('#nu').value);
  const thetaMode = ($('#thetaMode') ? $('#thetaMode').value : 'principal');

  if (![fck, gammaC, ktc, fyk, gammaS, nu].every(v => isFinite(v))) {
    throw new Error('Please enter valid numeric values for material inputs.');
  }
  if (fck <= 0 || gammaC <= 0 || ktc <= 0 || fyk <= 0 || gammaS <= 0 || nu <= 0) {
    throw new Error('Material inputs must be positive.');
  }

  const etaCc = Math.min(Math.pow(fckRef / fck, 1 / 3), 1.0);
  const fcd = etaCc * ktc * fck / gammaC;
  const fyd = fyk / gammaS;

  return { fck, gammaC, ktc, fyk, gammaS, nu, etaCc, fcd, fyd, thetaMode };
}

function readStressPoints() {
  return $$('#stressTbody tr').map((tr, idx) => {
    const inputs = $$('input', tr);
    const name = (inputs[0].value || '').trim() || `P${idx + 1}`;
    const sx = parseFloat(inputs[1].value);
    const sy = parseFloat(inputs[2].value);
    const txy = parseFloat(inputs[3].value);
    const thetaUserDeg = parseFloat(inputs[4].value);

    if (![sx, sy, txy].every(v => isFinite(v))) throw new Error(`Please enter valid stresses for ${name}.`);
    return { name, sx, sy, txy, thetaUserDeg };
  });
}

function principalStresses(sx, sy, txy) {
  const sAvg = 0.5 * (sx + sy);
  const R = Math.sqrt(Math.pow(0.5 * (sx - sy), 2) + txy * txy);
  const s1 = sAvg + R;
  const s2 = sAvg - R;
  const tauMax = R;
  const thetaP = 0.5 * Math.atan2(2 * txy, (sx - sy)); // radians
  return { sAvg, R, s1, s2, tauMax, thetaP };
}

// Reinforcement not required if both compressive and σx·σy > τxy^2
function reinforcementNoneCheck(sx, sy, txy) {
  return (sx < 0 && sy < 0 && (sx * sy > txy * txy));
}

function clampAcuteThetaRad(thetaRad) {
  let th = Math.abs(thetaRad) % Math.PI;
  if (th > Math.PI / 2) th = Math.PI - th;
  const eps = 1e-9;
  th = Math.max(eps, Math.min(Math.PI / 2 - eps, th));
  return th;
}

function cotFromThetaDeg(thetaDeg) {
  if (!isFinite(thetaDeg)) return NaN;
  const thRad = clampAcuteThetaRad(thetaDeg * Math.PI / 180);
  return 1 / Math.tan(thRad);
}

// θp from stress state; use σ2 direction for compressive principal direction; then take acute θ for cot.
function thetaConcreteFromStress(sx, sy, txy) {
  const pr = principalStresses(sx, sy, txy);
  const thetaP = pr.thetaP;
  const thetaCdir = thetaP + Math.PI / 2; // direction for σ2
  const thetaAcute = clampAcuteThetaRad(thetaCdir);

  return {
    thetaPdeg: thetaP * 180 / Math.PI,
    thetaCdeg: thetaCdir * 180 / Math.PI,
    thetaDeg: thetaAcute * 180 / Math.PI,
    thetaAcute,
    pr
  };
}

// Optimum reinforcement reference (ρ′) and optimum angle (θ′)
function optimumReference(sx, sy, txy, fyd) {
  const tauAbs = Math.abs(txy);
  const tau2 = txy * txy; // τxy^2 (sign cancels)

  let caseName = '—';
  let rhoPx = NaN, rhoPy = NaN, sigmaPcdRaw = NaN;
  let cotThetaPrime = NaN, thetaPrimeDeg = NaN;

  if (tauAbs < 1e-12) {
    // Pure normal stress state: define ρ′ from σ only; θ′ not meaningful.
    return {
      caseName: 'No shear',
      tau: txy,
      tauAbs,
      cotThetaPrime: NaN,
      thetaPrimeDeg: NaN,
      rhoXprime: Math.max(0, sx / fyd),
      rhoYprime: Math.max(0, sy / fyd),
      sigmaPcdRaw: 0,
      sigmaPcdAbs: 0
    };
  }

  // Case A: σx ≥ -|τ| and σy ≥ -|τ|
  if (sx >= -tauAbs && sy >= -tauAbs) {
    caseName = 'Case A';
    cotThetaPrime = 1.0;
    thetaPrimeDeg = 45.0;
    rhoPx = (sx + tauAbs) / fyd;
    rhoPy = (sy + tauAbs) / fyd;
    sigmaPcdRaw = 2 * tauAbs;
  }
    
  // Case B: σx < -|τ| and σx ≤ σy and (σxσy ≤ τ^2)
  else if (sx < -tauAbs && sx <= sy && (sx * sy <= tau2)) {
    caseName = 'Case B';
    cotThetaPrime = (-sx) / tauAbs; // >0 because sx is compressive
    thetaPrimeDeg = Math.atan(1 / cotThetaPrime) * 180 / Math.PI;
    rhoPx = 0;
    rhoPy = (sy + (tau2 / Math.abs(sx))) / fyd; // τ^2/σx (σx negative)
    sigmaPcdRaw = Math.abs(sx) * (1 + Math.pow(txy / sx, 2));
  }
  // Case C: σy < -|τ| and σx ≥ σy and (σxσy ≤ τ^2)
  else if (sy < -tauAbs && sx >= sy && (sx * sy <= tau2)) {
    caseName = 'Case C';
    cotThetaPrime = tauAbs / (-sy); // >0 because sy is compressive
    thetaPrimeDeg = Math.atan(1 / cotThetaPrime) * 180 / Math.PI;
    rhoPx = (sx + (tau2 / Math.abs(sy))) / fyd; // τ^2/σy (σy negative)
    rhoPy = 0;
    sigmaPcdRaw = Math.abs(sy) * (1 + Math.pow(txy / sy, 2));
  }

  return {
    caseName,
    tau: txy,
    tauAbs,
    cotThetaPrime,
    thetaPrimeDeg,
    rhoXprime: isFinite(rhoPx) ? Math.max(0, rhoPx) : NaN,
    rhoYprime: isFinite(rhoPy) ? Math.max(0, rhoPy) : NaN,
    sigmaPcdRaw,
    sigmaPcdAbs: isFinite(sigmaPcdRaw) ? Math.abs(sigmaPcdRaw) : NaN
  };
}

function limitationBand(rhoPrime) {
  if (!isFinite(rhoPrime) || rhoPrime <= 0) {
    return { applicable: false, lo: 0, hi: Infinity };
  }
  return { applicable: true, lo: 0.4 * rhoPrime, hi: 2.5 * rhoPrime };
}

function designReinforcement(point, mat) {
  const { sx, sy, txy, thetaUserDeg } = point;
  const { fyd, fcd, nu, thetaMode } = mat;

  const tauAbs = Math.abs(txy);
  const sigmaLimit = nu * fcd;

  // θ from principal stress state
  const th = thetaConcreteFromStress(sx, sy, txy);
  const cotP = 1 / Math.tan(th.thetaAcute);

  // user θ
  const cotU = cotFromThetaDeg(thetaUserDeg);
  const userThetaValid = isFinite(cotU) && cotU > 0;

  // General method (principal) — |τxy| used in reinforcement and σcd
  const rhoXrawP = (sx + tauAbs * cotP) / fyd;
  const rhoYrawP = (sy + tauAbs / cotP) / fyd;
  const rhoXgenP = Math.max(0, rhoXrawP);
  const rhoYgenP = Math.max(0, rhoYrawP);
  const sigmaCdP = Math.abs(tauAbs * (cotP + 1 / cotP));

  // General method (user)
  let rhoXrawU = NaN, rhoYrawU = NaN, rhoXgenU = NaN, rhoYgenU = NaN, sigmaCdU = NaN;
  if (userThetaValid) {
    rhoXrawU = (sx + tauAbs * cotU) / fyd;
    rhoYrawU = (sy + tauAbs / cotU) / fyd;
    rhoXgenU = Math.max(0, rhoXrawU);
    rhoYgenU = Math.max(0, rhoYrawU);
    sigmaCdU = Math.abs(tauAbs * (cotU + 1 / cotU));
  }

  // Select θ for GENERAL method per thetaMode (Option 2)
  let thetaUsedDeg = th.thetaDeg;
  let cotUsed = cotP;
  let genBasis = 'principal';

  if (thetaMode === 'user' && userThetaValid) {
    thetaUsedDeg = clampAcuteThetaRad(thetaUserDeg * Math.PI / 180) * 180 / Math.PI;
    cotUsed = cotU;
    genBasis = 'user';
  } else if (thetaMode === 'envelope' && userThetaValid) {
    // conservative envelope between principal and user for GENERAL method
    const sumP = rhoXgenP + rhoYgenP;
    const sumU = rhoXgenU + rhoYgenU;
    if (sumU > sumP + 1e-12) {
      thetaUsedDeg = clampAcuteThetaRad(thetaUserDeg * Math.PI / 180) * 180 / Math.PI;
      cotUsed = cotU;
      genBasis = 'envelope(user governs)';
    } else {
      thetaUsedDeg = th.thetaDeg;
      cotUsed = cotP;
      genBasis = 'envelope(principal governs)';
    }
  }

  // Used GENERAL method based on selected θ
  const rhoXrawUsed = (sx + tauAbs * cotUsed) / fyd;
  const rhoYrawUsed = (sy + tauAbs / cotUsed) / fyd;
  const rhoXgenUsed = Math.max(0, rhoXrawUsed);
  const rhoYgenUsed = Math.max(0, rhoYrawUsed);
  const sigmaCdUsed = Math.abs(tauAbs * (cotUsed + 1 / cotUsed));

  // reinforcement required check
  const noReinf = reinforcementNoneCheck(sx, sy, txy);

  // concrete check always (based on used θ for σcd reporting)
  const okConcrete = sigmaCdUsed <= sigmaLimit + 1e-9;

  if (noReinf) {
    return {
      requiresReinf: false,
      method: 'No reinforcement required (σcd checked)',
      thetaPdeg: th.thetaPdeg,
      thetaCdeg: th.thetaCdeg,
      thetaDeg: th.thetaDeg,
      thetaUserDeg,
      thetaUsedDeg,
      cotP,
      cotU,
      cotUsed,
      genBasis,

      // general method reporting
      rhoXrawP, rhoYrawP, rhoXgenP, rhoYgenP, sigmaCdP,
      rhoXrawU, rhoYrawU, rhoXgenU, rhoYgenU, sigmaCdU,
      rhoXraw: 0, rhoYraw: 0,
      rhoXgen: 0, rhoYgen: 0,

      // optimum not applicable
      rhoXprime: 0, rhoYprime: 0,
      refCase: '—', refTau: txy, refTauAbs: tauAbs,
      refCotThetaPrime: NaN, refThetaPrimeDeg: NaN,
      refSigmaPcdRaw: 0, refSigmaPcdAbs: 0,

      // envelope
      rhoXprov: 0, rhoYprov: 0,
      rhoX: 0, rhoY: 0,
      governsX: '—', governsY: '—',
      limX: { applicable: false, lo: 0, hi: Infinity },
      limY: { applicable: false, lo: 0, hi: Infinity },
      limPassX: true,
      limPassY: true,
      okLimit: true,

      sigmaCd: sigmaCdUsed,
      sigmaLimit,
      okConcrete,
      ok: okConcrete,
      pr: th.pr
    };
  }

  // Optimum reference (independent of thetaMode) — Option 2
  const ref = optimumReference(sx, sy, txy, fyd);
  const rhoXprime = ref.rhoXprime;
  const rhoYprime = ref.rhoYprime;

  // Final provided reinforcement is based on selected GENERAL method only
  const rhoXprov = rhoXgenUsed;
  const rhoYprov = rhoYgenUsed;

  const governsX = `General (${genBasis})`;
  const governsY = `General (${genBasis})`;    
    
  const limX = limitationBand(rhoXprime);
  const limY = limitationBand(rhoYprime);

  const limPassX = (!limX.applicable) ? true : (rhoXprov >= limX.lo - 1e-12 && rhoXprov <= limX.hi + 1e-12);
  const limPassY = (!limY.applicable) ? true : (rhoYprov >= limY.lo - 1e-12 && rhoYprov <= limY.hi + 1e-12);

  const okLimit = limPassX && limPassY;
  const ok = okConcrete && okLimit;

  return {
    requiresReinf: true,
    method: 'General method + optimum limitation check',
    thetaPdeg: th.thetaPdeg,
    thetaCdeg: th.thetaCdeg,
    thetaDeg: th.thetaDeg,
    thetaUserDeg,
    thetaUsedDeg,
    cotP,
    cotU,
    cotUsed,
    genBasis,

    // general reporting
    rhoXrawP, rhoYrawP, rhoXgenP, rhoYgenP, sigmaCdP,
    rhoXrawU, rhoYrawU, rhoXgenU, rhoYgenU, sigmaCdU,
    rhoXraw: rhoXrawUsed,
    rhoYraw: rhoYrawUsed,
    rhoXgen: rhoXgenUsed,
    rhoYgen: rhoYgenUsed,

    // optimum reporting
    rhoXprime,
    rhoYprime,
    refCase: ref.caseName,
    refTau: ref.tau,
    refTauAbs: ref.tauAbs,
    refCotThetaPrime: ref.cotThetaPrime,
    refThetaPrimeDeg: ref.thetaPrimeDeg,
    refSigmaPcdRaw: ref.sigmaPcdRaw,
    refSigmaPcdAbs: ref.sigmaPcdAbs,

    // envelope
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

    sigmaCd: sigmaCdUsed,
    sigmaLimit,
    okConcrete,
    okLimit,
    ok,
    pr: th.pr
  };
}

function computeAll() {
  const mat = readGlobalInputs();
  const points = readStressPoints();

  $('#etaCc').textContent = fmt(mat.etaCc, 3);
  $('#fcd').textContent = fmt(mat.fcd, 3);
  $('#fyd').textContent = fmt(mat.fyd, 3);
  $('#nuFcd').textContent = fmt(mat.nu * mat.fcd, 3);

  const results = points.map((p, idx) => {
    const pr = principalStresses(p.sx, p.sy, p.txy);
    const reinf = designReinforcement(p, mat);
    return { ...p, color: colors[idx % colors.length], ...pr, thetaPdeg: pr.thetaP * 180 / Math.PI, reinf };
  });

  return { mat, points, results };
}

function setStatus(msg, type = 'info') {
  const el = $('#status');
  el.textContent = msg;
  el.style.color = (type === 'error') ? 'var(--danger)' : 'var(--muted)';
}

function renderSummary({ results }) {
  const tbody = $('#resultsTbody');
  tbody.innerHTML = '';

  results.forEach(r => {
    const badgeClass = r.reinf.ok ? 'badge--ok' : 'badge--bad';
    const statusText = r.reinf.ok ? 'OK' : (r.reinf.okConcrete ? 'Limit' : 'Check');

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="badge" style="border-color: color-mix(in srgb, ${r.color} 55%, var(--border));">
        <span class="swatch" style="background:${r.color}"></span>${r.name}</span></td>
      <td>${fmt(r.s1, 3)}</td>
      <td>${fmt(r.s2, 3)}</td>
      <td>${fmt(r.tauMax, 3)}</td>
      <td>${fmtDeg(r.reinf.thetaPdeg)}</td>
      <td>${fmtDeg(r.reinf.thetaUsedDeg)}</td>
      <td>${fmt(r.reinf.rhoX, 5)}</td>
      <td>${fmt(r.reinf.rhoY, 5)}</td>
      <td>${fmt(r.reinf.sigmaCd, 3)}</td>
      <td>${fmt(r.reinf.sigmaLimit, 3)}</td>
      <td><span class="badge ${badgeClass}">${statusText}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

function renderDetailed({ mat, results }) {
  const root = $('#details');

  const matBlock = `
    <div class="calc-block">
      <h3>Material design strengths</h3>
      <div class="step">
        <div class="title">1) Concrete strength reduction factor</div>
        <div class="eq">
          η<sub>cc</sub> = (f<sub>ck,ref</sub> / f<sub>ck</sub>)<sup>1/3</sup> ≤ 1.0<br/>
          f<sub>ck,ref</sub> = ${fmt(fckRef, 0)} MPa<br/>
          η<sub>cc</sub> = (${fmt(fckRef, 0)} / ${fmt(mat.fck, 3)})<sup>1/3</sup> = ${fmt(mat.etaCc, 3)}
        </div>
      </div>
      <div class="step">
        <div class="title">2) Design compressive strength of concrete</div>
        <div class="eq">
          f<sub>cd</sub> = η<sub>cc</sub> · k<sub>tc</sub> · f<sub>ck</sub> / γ<sub>c</sub><br/>
          f<sub>cd</sub> = ${fmt(mat.etaCc, 3)} · ${fmt(mat.ktc, 3)} · ${fmt(mat.fck, 3)} / ${fmt(mat.gammaC, 3)} = ${fmt(mat.fcd, 3)} MPa
        </div>
      </div>
      <div class="step">
        <div class="title">3) Design yield strength of reinforcement</div>
        <div class="eq">
          f<sub>yd</sub> = f<sub>yk</sub> / γ<sub>s</sub><br/>
          f<sub>yd</sub> = ${fmt(mat.fyk, 3)} / ${fmt(mat.gammaS, 3)} = ${fmt(mat.fyd, 3)} MPa
        </div>
      </div>
      <div class="step">
        <div class="title">4) Concrete stress limit</div>
        <div class="eq">
          σ<sub>cd</sub> ≤ ν·f<sub>cd</sub> with ν = ${fmt(mat.nu, 3)}<br/>
          ν·f<sub>cd</sub> = ${fmt(mat.nu, 3)} · ${fmt(mat.fcd, 3)} = ${fmt(mat.nu * mat.fcd, 3)} MPa
        </div>
      </div>
    </div>
  `;

  const blocks = results.map(r => {
    const sx = r.sx, sy = r.sy, txy = r.txy;
    const reinf = r.reinf;
    const tauAbs = Math.abs(txy);

    const badge = reinf.ok ? `<span class="badge badge--ok">OK</span>` : `<span class="badge badge--bad">Check</span>`;

    const noReinf = reinforcementNoneCheck(sx, sy, txy);
    const noReinfText = noReinf
      ? `Condition met: σ<sub>x</sub><0, σ<sub>y</sub><0 and (σ<sub>x</sub>·σ<sub>y</sub>) > τ<sub>xy</sub><sup>2</sup> ⇒ reinforcement not required.`
      : `Condition not met ⇒ reinforcement design required.`;

    const userThetaLine = isFinite(reinf.thetaUserDeg)
      ? `User θ input = ${fmtDeg(reinf.thetaUserDeg)}° (acute used internally).`
      : `User θ input not provided (or invalid).`;

    const generalCompare = `
      <div class="eq">
        <b>General method (Principal θ) — using |τxy|</b><br/>
        θ (acute) = ${fmtDeg(reinf.thetaDeg)}° ⇒ cotθ = ${fmt(reinf.cotP, 6)}<br/>
        ρ<sub>x,raw</sub> = (σ<sub>x</sub> + |τ<sub>xy</sub>|·cotθ)/f<sub>yd</sub> = (${fmt(sx, 3)} + ${fmt(tauAbs, 3)}·${fmt(reinf.cotP, 6)})/${fmt(mat.fyd, 3)} = ${fmt(reinf.rhoXrawP, 6)}<br/>
        ρ<sub>y,raw</sub> = (σ<sub>y</sub> + |τ<sub>xy</sub>|/cotθ)/f<sub>yd</sub> = (${fmt(sy, 3)} + ${fmt(tauAbs, 3)}/${fmt(reinf.cotP, 6)})/${fmt(mat.fyd, 3)} = ${fmt(reinf.rhoYrawP, 6)}<br/>
        ρ<sub>x,gen</sub> = ${fmt(reinf.rhoXgenP, 6)} ; ρ<sub>y,gen</sub> = ${fmt(reinf.rhoYgenP, 6)}<br/>
        σ<sub>cd</sub> = |τxy|·(cotθ + 1/cotθ) = ${fmt(reinf.sigmaCdP, 3)} MPa
      </div>
      <div class="eq" style="margin-top:10px;">
        <b>General method (User θ) — using |τxy|</b><br/>
        ${userThetaLine}<br/>
        ${isFinite(reinf.cotU) ? `cotθ = ${fmt(reinf.cotU, 6)}<br/>` : `cotθ = —<br/>`}
        ρ<sub>x,raw</sub> = (${fmt(sx, 3)} + ${fmt(tauAbs, 3)}·${fmt(reinf.cotU, 6)})/${fmt(mat.fyd, 3)} = ${fmt(reinf.rhoXrawU, 6)}<br/>
        ρ<sub>y,raw</sub> = (${fmt(sy, 3)} + ${fmt(tauAbs, 3)}/${fmt(reinf.cotU, 6)})/${fmt(mat.fyd, 3)} = ${fmt(reinf.rhoYrawU, 6)}<br/>
        ${((isFinite(reinf.rhoXrawU) && reinf.rhoXrawU < 0) || (isFinite(reinf.rhoYrawU) && reinf.rhoYrawU < 0))
          ? '<br/><span style="color: var(--danger); font-weight: 700;">Calculated reinforcement using θ provided is negative. Please modify the angle θ.</span><br/>'
          : ''}
        ρ<sub>x,gen</sub> = ${fmt(reinf.rhoXgenU, 6)} ; ρ<sub>y,gen</sub> = ${fmt(reinf.rhoYgenU, 6)}<br/>
        σ<sub>cd</sub> = ${fmt(reinf.sigmaCdU, 3)} MPa
      </div>
      <div class="eq" style="margin-top:10px;">
        <b>θ used for GENERAL design</b>: ${fmtDeg(reinf.thetaUsedDeg)}° (${reinf.genBasis})<br/>
        Used (general) ρ<sub>x,gen</sub> = ${fmt(reinf.rhoXgen, 6)} ; ρ<sub>y,gen</sub> = ${fmt(reinf.rhoYgen, 6)}<br/>
        Used σ<sub>cd</sub> = ${fmt(reinf.sigmaCd, 3)} MPa ≤ ν·f<sub>cd</sub> = ${fmt(reinf.sigmaLimit, 3)} MPa ⇒ ${reinf.okConcrete ? 'PASS' : 'FAIL'}
      </div>
    `;

    // Optimum details: include θ′
    let optAngleLine = '';
    if (isFinite(reinf.refCotThetaPrime) && isFinite(reinf.refThetaPrimeDeg)) {
      optAngleLine = `cotθ′ = ${fmt(reinf.refCotThetaPrime, 6)} ⇒ θ′ = ${fmtDeg(reinf.refThetaPrimeDeg)}°`;
    } else {
      optAngleLine = `cotθ′ and θ′ not defined (no shear)`;
    }

    let optForm = '—';
    if (reinf.refCase === 'Case A') {
      optForm = `Case A: cotθ′=1 (θ′=45°), ρ′x=(σx+|τxy|)/fyd, ρ′y=(σy+|τxy|)/fyd, σ′cd=2|τxy|`;
    } else if (reinf.refCase === 'Case B') {
      optForm = `Case B: cotθ′=-σx/|τxy|, ρ′x=0, ρ′y=(σy+τxy^2/|σx|)/fyd, σ′cd=|σx|[1+(τxy/σx)^2]`;
    } else if (reinf.refCase === 'Case C') {
      optForm = `Case C: cotθ′=|τxy|/(-σy), ρ′x=(σx+τxy^2/|σy|)/fyd, ρ′y=0, σ′cd=|σy|[1+(τxy/σy)^2]`;
    } else if (reinf.refCase === 'No shear') {
      optForm = `No shear: ρ′x=max(0,σx/fyd), ρ′y=max(0,σy/fyd)`;
    }

    const optimumBlock = reinf.requiresReinf ? `
      <div class="eq">
        <b>Optimum reinforcement reference (ρ′) & optimum angle (θ′)</b><br/>
        τ<sub>xy</sub> = ${fmt(txy, 3)} MPa (|τ<sub>xy</sub>|=${fmt(tauAbs, 3)}), f<sub>yd</sub> = ${fmt(mat.fyd, 3)} MPa<br/>
        <b>${reinf.refCase}</b> applied.<br/>
        <b>Formulation:</b> ${optForm}<br/><br/>
        <b>Optimum angle:</b> ${optAngleLine}<br/>
        ρ′<sub>x</sub> = ${fmt(reinf.rhoXprime, 6)}<br/>
        ρ′<sub>y</sub> = ${fmt(reinf.rhoYprime, 6)}<br/>
        σ′<sub>cd</sub> = ${fmt(reinf.refSigmaPcdRaw, 3)} MPa; 
        <br/><br/>
        <b>Reinforcement limitation check</b><br/>
        ρ<sub>x,prov</sub> = ρ<sub>x,gen</sub> = ${fmt(reinf.rhoXprov, 6)} 
        ρ<sub>y,prov</sub> = ρ<sub>y,gen</sub> = ${fmt(reinf.rhoYprov, 6)} 
        <b>Limitation checks</b><br/>
        X: 0.4ρ'<sub>x</sub> ≤ ρ<sub>x,prov</sub> ≤ 2.5ρ'<sub>x</sub> ⇒ bounds: ${reinf.limX.applicable ? `[${fmt(reinf.limX.lo, 6)}, ${fmt(reinf.limX.hi, 6)}]` : 'N/A'} ⇒ ${reinf.limPassX ? 'PASS' : 'FAIL'}<br/>
        Y: 0.4ρ'<sub>y</sub> ≤ ρ<sub>y,prov</sub> ≤ 2.5ρ'<sub>y</sub> ⇒ bounds: ${reinf.limY.applicable ? `[${fmt(reinf.limY.lo, 6)}, ${fmt(reinf.limY.hi, 6)}]` : 'N/A'} ⇒ ${reinf.limPassY ? 'PASS' : 'FAIL'}
      </div>
    ` : `
      <div class="eq">
        <b>Optimum reference & limitation checks</b><br/>
        Not applicable because reinforcement is not required by the stress condition.
        Concrete σ<sub>cd</sub> check is still performed above.
      </div>
    `;

    return `
      <div class="calc-block">
        <h3>${r.name}
          <span class="badge" style="margin-left:8px;border-color:color-mix(in srgb, ${r.color} 55%, var(--border));">
            <span class="swatch" style="background:${r.color}"></span>${reinf.method}
          </span>
          ${badge}
        </h3>

        <div class="step">
          <div class="title">A) Given in-plane stresses (MPa)</div>
          <div class="eq">σ<sub>x</sub> = ${fmt(sx, 3)} , σ<sub>y</sub> = ${fmt(sy, 3)} , τ<sub>xy</sub> = ${fmt(txy, 3)} (|τ<sub>xy</sub>| = ${fmt(tauAbs, 3)})</div>
        </div>

        <div class="step">
          <div class="title">B) Principal stresses and maximum shear stress</div>
          <div class="eq">
            σ<sub>1</sub>, σ<sub>2</sub> = (σ<sub>x</sub> + σ<sub>y</sub>)/2 ± √(((σ<sub>x</sub> − σ<sub>y</sub>)/2)<sup>2</sup> + τ<sub>xy</sub><sup>2</sup>)<br/>
            (σ<sub>x</sub>+σ<sub>y</sub>)/2 = (${fmt(sx, 3)} + ${fmt(sy, 3)})/2 = ${fmt(r.sAvg, 3)}<br/>
            √(...) = ${fmt(r.R, 3)}<br/>
            ⇒ σ<sub>1</sub> = ${fmt(r.s1, 3)} ; σ<sub>2</sub> = ${fmt(r.s2, 3)} ; τ<sub>max</sub> = ${fmt(r.tauMax, 3)}
          </div>
        </div>

        <div class="step">
          <div class="title">C) Principal stress direction angle</div>
          <div class="eq">
            tan(2θ<sub>p</sub>) = 2τ<sub>xy</sub> / (σ<sub>x</sub> − σ<sub>y</sub>)<br/>
            2θ<sub>p</sub> = atan2(2·${fmt(txy, 3)}, ${fmt(sx - sy, 3)}) ⇒ θ<sub>p</sub> = ${fmtDeg(reinf.thetaPdeg)}°
          </div>
        </div>

        <div class="step">
          <div class="title">D) Check if reinforcement is required</div>
          <div class="eq">
            If σ<sub>x</sub> and σ<sub>y</sub> are both compressive (σ<sub>x</sub>, σ<sub>y</sub> < 0) and (σ<sub>x</sub>·σ<sub>y</sub>) > τ<sub>xy</sub><sup>2</sup>, reinforcement is not required.<br/>
            Here: σ<sub>x</sub>·σ<sub>y</sub> = (${fmt(sx, 3)})·(${fmt(sy, 3)}) = ${fmt(sx * sy, 3)} ;
            τ<sub>xy</sub><sup>2</sup> = (${fmt(txy, 3)})<sup>2</sup> = ${fmt(txy * txy, 3)}<br/>
            ${noReinfText}
          </div>
        </div>

        <div class="step">
          <div class="title">E) Concrete compression check & general method (principal and user θ)</div>
          ${generalCompare}
        </div>

        <div class="step">
          <div class="title">F) Optimum reference & limitation checks</div>
          ${optimumBlock}
        </div>
      </div>
    `;
  }).join('');

  root.innerHTML = matBlock + blocks;
}

function clearMohr() {
  const canvas = $('#mohrCanvas');
  const ctx = canvas.getContext('2d');
  const cssWidth = canvas.clientWidth;
  const cssHeight = canvas.clientHeight;
  const dpr = window.devicePixelRatio || 1;

  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const bg = getComputedStyle(document.documentElement).getPropertyValue('--panel').trim();
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  $('#legend').innerHTML = '';
}

// Mohr's Circle
function drawMohr({ results }) {
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

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--panel').trim();
  ctx.fillRect(0, 0, W, H);

  const gridColor = getComputedStyle(document.documentElement).getPropertyValue('--border').trim();
  const textColor = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim();
  const axisColor = getComputedStyle(document.documentElement).getPropertyValue('--text').trim();

  function niceStep(range) {
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
  for (let s = xStart; s <= sigMax + 1e-9; s += sxStep) {
    const x = xOf(s);
    ctx.beginPath();
    ctx.moveTo(x, plot.top);
    ctx.lineTo(x, H - plot.bottom);
    ctx.stroke();
  }

  const yStart = Math.floor(tauMin / txStep) * txStep;
  for (let t = yStart; t <= tauMax + 1e-9; t += txStep) {
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
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('τ (MPa)', 0, 0);
  ctx.restore();

  ctx.fillStyle = textColor;
  ctx.font = '12px ui-sans-serif, system-ui, -apple-system, Segoe UI';

  for (let s = xStart; s <= sigMax + 1e-9; s += sxStep) {
    const x = xOf(s);
    ctx.beginPath();
    ctx.moveTo(x, y0 - 4);
    ctx.lineTo(x, y0 + 4);
    ctx.strokeStyle = axisColor;
    ctx.stroke();
    ctx.fillText(s.toFixed(1), x - 8, H - plot.bottom + 18);
  }

  for (let t = yStart; t <= tauMax + 1e-9; t += txStep) {
    const y = yOf(t);
    ctx.beginPath();
    ctx.moveTo(x0 - 4, y);
    ctx.lineTo(x0 + 4, y);
    ctx.strokeStyle = axisColor;
    ctx.stroke();

    const tLabel = Math.abs(t) < 1e-9 ? 0 : t;
    ctx.fillText(tLabel.toFixed(1), 10, y + 4);
  }

  results.forEach((r, idx) => {
    const cx = xOf(r.sAvg);
    const cy = yOf(0);
    const rpx = r.R * scale;

    ctx.strokeStyle = r.color;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(cx, cy, rpx, 0, 2 * Math.PI);
    ctx.stroke();

    const Ax = xOf(r.sx), Ay = yOf(r.txy);
    const Bx = xOf(r.sy), By = yOf(-r.txy);

    ctx.fillStyle = r.color;
    ctx.beginPath(); ctx.arc(Ax, Ay, 3.6, 0, 2 * Math.PI); ctx.fill();
    ctx.beginPath(); ctx.arc(Bx, By, 3.6, 0, 2 * Math.PI); ctx.fill();

    const s1x = xOf(r.s1);
    const s2x = xOf(r.s2);

    ctx.fillStyle = r.color;
    ctx.font = '600 12px ui-sans-serif, system-ui, -apple-system, Segoe UI';
    ctx.fillText(`σ1=${r.s1.toFixed(2)}`, s1x - 28, y0 - 10 - (idx % 2) * 14);
    ctx.fillText(`σ2=${r.s2.toFixed(2)}`, s2x - 28, y0 + 18 + (idx % 2) * 14);
  });

  const legend = $('#legend');
  legend.innerHTML = results.map(r => `
    <div class="legend-item"><span class="swatch" style="background:${r.color}"></span><span>${r.name}</span></div>
  `).join('');
}

function addStressRow(name = '') {
  const tbody = $('#stressTbody');
  const idx = tbody.children.length + 1;
  const tr = document.createElement('tr');

  tr.innerHTML = `
    <td><input class="in-table" value="${name || ('P' + idx)}" /></td>
    <td><input class="in-table" type="number" step="0.01" value="0" /></td>
    <td><input class="in-table" type="number" step="0.01" value="0" /></td>
    <td><input class="in-table" type="number" step="0.01" value="0" /></td>
    <td><input class="in-table" type="number" step="0.1" value="45" /></td>
    <td><button class="btn btn--ghost btn--danger" type="button" title="Remove">✖</button></td>
  `;

  tbody.appendChild(tr);
  updateRemoveButtons();
}

function updateRemoveButtons() {
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

function setupTheme() {
  const saved = localStorage.getItem('theme') || 'light';
  document.documentElement.dataset.theme = saved;

  $('#themeToggle').addEventListener('click', () => {
    const next = (document.documentElement.dataset.theme === 'dark') ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('theme', next);
    try {
      if (lastPlotData) drawMohr(lastPlotData);
      else clearMohr();
    } catch { /* ignore */ }
  });
}

function main() {
  setupTheme();
  updateRemoveButtons();

  $('#addPointBtn').addEventListener('click', () => addStressRow());
  $('#printBtn').addEventListener('click', () => window.print());

  $('#calcBtn').addEventListener('click', () => {
    try {
      const data = computeAll();
      renderSummary(data);
      renderDetailed(data);
      lastPlotData = null;
      clearMohr();
      setStatus(`Calculated ${data.results.length} point(s).`, 'info');
    } catch (err) {
      setStatus(err.message || String(err), 'error');
    }
  });

  $('#plotBtn').addEventListener('click', () => {
    try {
      const data = computeAll();
      renderSummary(data);
      renderDetailed(data);
      lastPlotData = data;
      drawMohr(data);
      setStatus(`Plotted Mohr's circle for ${data.results.length} point(s).`, 'info');
      document.getElementById('mohrPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      setStatus(err.message || String(err), 'error');
    }
  });

  clearMohr();
  setStatus('Ready. Update inputs and press Calculate.', 'info');
  
  window.addEventListener('resize', () => {
    try {
      if (lastPlotData) drawMohr(lastPlotData);
      else clearMohr();
    } catch { /* ignore */ }
  });
}

document.addEventListener('DOMContentLoaded', main);
