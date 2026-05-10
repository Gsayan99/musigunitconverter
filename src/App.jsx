import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Calculator, Info, ArrowRightLeft, Zap, Waves, Activity, RotateCcw, ChevronUp, ChevronDown, Timer, X, ArrowDownUp, Layers, FlaskConical, Plus, Minus, Trash2, Flame, Coffee, Play, Square, Upload, Download, BarChart2 } from 'lucide-react';

// --- MATH HELPERS (FFT & Interpolation) ---
const trapz = (x, y) => {
  let sum = 0;
  for (let i = 0; i < x.length - 1; i++) {
    sum += (y[i] + y[i + 1]) * (x[i + 1] - x[i]) / 2;
  }
  return sum;
};

// Fixed Interpolation: Strictly zero-pad out-of-bounds to prevent sinc ringing in time domain!
const interp1 = (x, y, xq) => {
  return xq.map(xq_val => {
    if (xq_val < x[0]) return 0;
    if (xq_val > x[x.length - 1]) return 0;
    let i = 0, j = x.length - 1;
    while (i <= j) {
      let mid = Math.floor((i + j) / 2);
      if (x[mid] <= xq_val) i = mid + 1;
      else j = mid - 1;
    }
    if (j < 0) return 0;
    if (j >= x.length - 1) return y[x.length - 1];
    const t = (xq_val - x[j]) / (x[j + 1] - x[j]);
    return y[j] + t * (y[j + 1] - y[j]);
  });
};

const fftRadix2 = (re, im, inverse = false) => {
  const n = re.length;
  if ((n & (n - 1)) !== 0) throw new Error("Length not power of 2");
  let j = 0;
  for (let i = 0; i < n - 1; i++) {
    if (i < j) {
      let tr = re[j], ti = im[j];
      re[j] = re[i]; im[j] = im[i];
      re[i] = tr; im[i] = ti;
    }
    let m = n >> 1;
    while (j >= m) { j -= m; m >>= 1; }
    j += m;
  }
  for (let size = 2; size <= n; size *= 2) {
    let halfsize = size / 2;
    let tablestep = n / size;
    let theta = (inverse ? 2 : -2) * Math.PI / size;
    let w_r = Math.cos(theta), w_i = Math.sin(theta);
    for (let i = 0; i < n; i += size) {
      let u_r = 1, u_i = 0;
      for (let j = i, k = 0; j < i + halfsize; j++, k += tablestep) {
        let v_r = re[j + halfsize] * u_r - im[j + halfsize] * u_i;
        let v_i = re[j + halfsize] * u_i + im[j + halfsize] * u_r;
        re[j + halfsize] = re[j] - v_r;
        im[j + halfsize] = im[j] - v_i;
        re[j] += v_r;
        im[j] += v_i;
        let next_u_r = u_r * w_r - u_i * w_i;
        u_i = u_r * w_i + u_i * w_r;
        u_r = next_u_r;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }
};

const circshift = (arr, shift) => {
  const n = arr.length;
  shift = ((shift % n) + n) % n;
  return [...arr.slice(n - shift), ...arr.slice(0, n - shift)];
};

// --- LOGO SETUP ---
// To use your actual logo, uncomment the import line below and comment out the fallback variable:
import logo from './assets/musig_logo.png';
// const logo = ''; // Fallback variable to prevent ReferenceError if the image tag is uncommented alone

// --- MATERIALS DATABASE (Sellmeier Coefficients) ---
const MATERIALS = {
  'Fused Silica': { name: 'Fused Silica', type: 'sellmeier', c: [0.6961663, 0.4079426, 0.8974794, 0.004679148, 0.01351206, 97.9340025] },
  'BK7': { name: 'BK7 (N-BK7)', type: 'sellmeier', c: [1.03961212, 0.231792344, 1.01046945, 0.00600069867, 0.0200179144, 103.560653] },
  'Sapphire (o)': { name: 'Sapphire (Ordinary)', type: 'sellmeier', c: [1.43134930, 0.65054713, 5.3414021, 0.0052799261, 0.0142382647, 325.017834] },
  'Sapphire (e)': { name: 'Sapphire (Extraord.)', type: 'sellmeier', c: [1.5039759, 0.55069141, 6.5927379, 0.00548041129, 0.0147994281, 402.89514] },
  'YAG': { name: 'YAG (Undoped)', type: 'sellmeier', c: [2.28200, 3.27644, 0, 0.01185, 282.734, 0] },
  'BBO (o)': { name: 'BBO (Ordinary)', type: 'sellmeier', c: [2.7359, 1.8738, 0, 0.01878, 19.315, 0] },
  'BBO (e)': { name: 'BBO (Extraord.)', type: 'sellmeier', c: [2.3753, 1.2240, 0, 0.01224, 16.670, 0] },
  'CaF2': { name: 'CaF2', type: 'sellmeier', c: [0.5675888, 0.4710914, 3.8484723, 0.00252643, 0.01007833, 1200.556] },
  'Calcite (o)': { name: 'Calcite (Ordinary)', type: 'sellmeier', c: [0.8559, 0.8391, 0.0009, 0.00588, 0.0141, 0] },
  'ZnSe': { name: 'ZnSe (CVD)', type: 'sellmeier', c: [4.45813734, 0.467216334, 2.89566290, 0.200859853, 0.391371166, 47.1362108] }
};

const App = () => {
  const C_NM_FS = 299.792458;
  const FACTOR_CM_FS = 2.99792458e-5;

  const [mode, setMode] = useState('single');
  const [values, setValues] = useState({ nm: '', cm: '', fs: '', rad: '', time: '' });
  const [bwValues, setBwValues] = useState({ p1: '', u1: 'nm', p2: '', u2: 'nm' });
  const [dispSetup, setDispSetup] = useState({ centerLam: '800', spectralWidth: '20', tlPulseWidth: '47.07', components: [{ id: 1, material: 'Fused Silica', thickness: '1' }] });
  const [fluenceValues, setFluenceValues] = useState({ power: '', pUnit: 'mW', rep: '', rUnit: 'kHz', dia: '', dUnit: 'um' });
  const [fluenceResUnits, setFluenceResUnits] = useState({ energy: 'µJ', fluence: 'J/cm²' });

  // Autocorrelation State & Refs
  const [acSetup, setAcSetup] = useState({ centerLam: '800', spectralWidth: '30', tlPulseWidth: '31.38' });
  const [acSourceType, setAcSourceType] = useState('gaussian');
  const [acExpUnit, setAcExpUnit] = useState('nm');
  const [uploadedSpectrum, setUploadedSpectrum] = useState(null);
  const [isAcSimulating, setIsAcSimulating] = useState(false);

  const overlapCanvasRef = useRef(null);
  const traceCanvasRef = useRef(null);
  const spectrumCanvasRef = useRef(null);
  const animationRef = useRef(null);

  // Jacobian State & Refs
  const [jacobSetup, setJacobSetup] = useState({ direction: 'nm2cm' });
  const [jacobOriginal, setJacobOriginal] = useState(null);
  const [jacobConverted, setJacobConverted] = useState(null);
  const jacobOrigCanvasRef = useRef(null);
  const jacobConvCanvasRef = useRef(null);

  // Zoom Bounds Ref
  const bounds = useRef({
    overlap: [-100, 100],
    trace: [-150, 150],
    spectrum: [700, 900]
  });

  // Simulation Data Ref
  const simData = useRef({
    t: [], E1_Re: [], E1_Im: [],
    Mag: [], Phase: [], // Magnitude/Phase decoupling for perfect shifting
    tauArr: [], S_tau: [],
    origLambda: [], origI: [],
    retrievedLambda: [], retrieved_I: [],
    currentFrame: 0, nT: 0, dt: 0, tMin: 0,
    w0_val: 0, a_val: 0,
    hasCompletedOneSweep: false,
    acSourceType: 'gaussian'
  });

  const [showInfo, setShowInfo] = useState(false);

  // Initialize/Reset bounds dynamically for Autocorr
  useEffect(() => {
    if (mode !== 'autocorr') return;

    if (acSourceType === 'experimental' && uploadedSpectrum) {
      const minL = Math.min(...uploadedSpectrum.lambda);
      const maxL = Math.max(...uploadedSpectrum.lambda);
      const pad = (maxL - minL) * 0.1 || 50;
      bounds.current.spectrum = [minL - pad, maxL + pad];
    } else {
      const lam = parseFloat(acSetup.centerLam) || 800;
      const dLam = parseFloat(acSetup.spectralWidth) || 30;
      bounds.current.spectrum = [lam - dLam * 2.5, lam + dLam * 2.5];
    }

    bounds.current.overlap = [-100, 100];
    bounds.current.trace = [-150, 150];

    if (!isAcSimulating) {
      redrawStatic();
    }
  }, [acSetup.centerLam, acSetup.spectralWidth, acSourceType, uploadedSpectrum, mode]);


  // --- JACOBIAN LOGIC ---
  useEffect(() => {
    if (jacobOriginal) {
      const newX = [];
      const newY = [];
      const { x, y } = jacobOriginal;

      for (let i = 0; i < x.length; i++) {
        const xVal = x[i];
        const yVal = y[i];
        if (xVal <= 0) continue;

        if (jacobSetup.direction === 'nm2cm') {
          const cm = 10000000 / xVal;
          const i_cm = yVal * ((xVal * xVal) / 10000000);
          newX.push(cm);
          newY.push(i_cm);
        } else {
          const nm = 10000000 / xVal;
          const i_nm = yVal * ((xVal * xVal) / 10000000);
          newX.push(nm);
          newY.push(i_nm);
        }
      }

      // Sort ascending for proper plotting
      const sortedIndices = newX.map((_, i) => i).sort((a, b) => newX[a] - newX[b]);
      const finalX = sortedIndices.map(i => newX[i]);
      const finalY = sortedIndices.map(i => newY[i]);

      setJacobConverted({ x: finalX, y: finalY });
    } else {
      setJacobConverted(null);
    }
  }, [jacobOriginal, jacobSetup.direction]);

  const drawJacobPlot = (canvasRef, data, xLabel, color) => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    const w = canvasRef.current.width, h = canvasRef.current.height;

    if (!data || data.x.length === 0) {
      drawGridAndTicks(ctx, w, h, 0, 100, 0, 1, xLabel);
      return;
    }

    const xMin = Math.min(...data.x);
    const xMax = Math.max(...data.x);
    const pad = (xMax - xMin) * 0.05 || 10;
    drawGridAndTicks(ctx, w, h, xMin - pad, xMax + pad, 0, 1.1, xLabel);

    const maxY = Math.max(...data.y) || 1;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();

    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    for (let i = 0; i < data.x.length; i++) {
      const xP = ((data.x[i] - (xMin - pad)) / ((xMax + pad) - (xMin - pad))) * w;
      const yP = h - (data.y[i] / maxY) * (h * 0.8) - (0.1 * h);
      if (i === 0) ctx.moveTo(xP, yP);
      else ctx.lineTo(xP, yP);
    }
    ctx.stroke();
    ctx.restore();
  };

  useEffect(() => {
    if (mode === 'jacobian') {
      drawJacobPlot(jacobOrigCanvasRef, jacobOriginal, jacobSetup.direction === 'nm2cm' ? 'Wavelength λ (nm)' : 'Wavenumber ṽ (cm⁻¹)', '#64748b');
      drawJacobPlot(jacobConvCanvasRef, jacobConverted, jacobSetup.direction === 'nm2cm' ? 'Wavenumber ṽ (cm⁻¹)' : 'Wavelength λ (nm)', '#16a34a');
    }
  }, [jacobOriginal, jacobConverted, mode, jacobSetup.direction]);

  const handleJacobUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target.result;
      const lines = text.split('\n');
      const xVals = [], yVals = [];
      lines.forEach(line => {
        const parts = line.trim().split(/[\s,;\t]+/).filter(Boolean);
        if (parts.length >= 2) {
          const x = parseFloat(parts[0]);
          const y = parseFloat(parts[1]);
          if (!isNaN(x) && !isNaN(y)) {
            xVals.push(x);
            yVals.push(y);
          }
        }
      });

      if (xVals.length > 0) {
        const sortedIndices = xVals.map((_, i) => i).sort((a, b) => xVals[a] - xVals[b]);
        setJacobOriginal({
          x: sortedIndices.map(i => xVals[i]),
          y: sortedIndices.map(i => yVals[i])
        });
      } else {
        alert("Could not parse file. Ensure it contains two numerical columns.");
      }
    };
    reader.readAsText(file);
    e.target.value = null;
  };

  const downloadConvertedSpectra = () => {
    if (!jacobConverted) return;
    let content = "X\tIntensity\n";
    for (let i = 0; i < jacobConverted.x.length; i++) {
      content += `${jacobConverted.x[i].toFixed(6)}\t${jacobConverted.y[i].toExponential(6)}\n`;
    }
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const srcUnit = jacobSetup.direction === 'nm2cm' ? 'cm-1' : 'nm';
    a.download = `Jacobian_Converted_${srcUnit}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // --- HELPER FUNCTIONS ---
  const toFreq = (val, unit) => {
    const v = parseFloat(val);
    if (!v || v === 0) return 0;
    switch (unit) {
      case 'nm': return C_NM_FS / v;
      case 'cm': return v * FACTOR_CM_FS;
      case 'fs': return v;
      case 'rad': return v / (2 * Math.PI);
      case 'time': return 1 / v;
      default: return 0;
    }
  };

  const fromFreq = (freq, unit) => {
    if (!freq || freq === 0) return 0;
    switch (unit) {
      case 'nm': return C_NM_FS / freq;
      case 'cm': return freq / FACTOR_CM_FS;
      case 'fs': return freq;
      case 'rad': return freq * 2 * Math.PI;
      case 'time': return 1 / freq;
      default: return 0;
    }
  };

  const fmtDisplay = (num) => (!isFinite(num) || isNaN(num)) ? '-' : parseFloat(num.toFixed(7)).toString();
  const formatVal = (n) => parseFloat(n.toFixed(4)).toString();

  // --- LOGIC GROUPS ---
  const handleClear = () => {
    setValues({ nm: '', cm: '', fs: '', rad: '', time: '' });
    setBwValues({ p1: '', u1: 'nm', p2: '', u2: 'nm' });
    setDispSetup({ centerLam: '800', spectralWidth: '20', tlPulseWidth: '47.07', components: [{ id: Date.now(), material: 'Fused Silica', thickness: '1' }] });
    setFluenceValues({ power: '', pUnit: 'mW', rep: '', rUnit: 'kHz', dia: '', dUnit: 'um' });
  };

  const updateValues = (source, value) => {
    if (value === '' || isNaN(value)) {
      setValues(prev => ({ ...prev, [source]: value }));
      if (value === '') handleClear();
      return;
    }
    const val = parseFloat(value);
    if (val === 0 && (source === 'nm' || source === 'time')) {
      setValues(prev => ({ ...prev, [source]: value }));
      return;
    }
    let freq_fs = toFreq(val, source);
    setValues({
      nm: source === 'nm' ? value : fmtDisplay(fromFreq(freq_fs, 'nm')),
      cm: source === 'cm' ? value : fmtDisplay(fromFreq(freq_fs, 'cm')),
      fs: source === 'fs' ? value : fmtDisplay(fromFreq(freq_fs, 'fs')),
      rad: source === 'rad' ? value : fmtDisplay(fromFreq(freq_fs, 'rad')),
      time: source === 'time' ? value : fmtDisplay(fromFreq(freq_fs, 'time')),
    });
  };

  const updateBwValue = (point, val) => setBwValues(prev => ({ ...prev, [point]: val }));
  const updateBwUnit = (pointUnit, newUnit) => setBwValues(prev => ({ ...prev, [pointUnit]: newUnit }));

  const calculateBandwidth = () => {
    const freq1 = toFreq(bwValues.p1, bwValues.u1);
    const freq2 = toFreq(bwValues.p2, bwValues.u2);
    if (!freq1 || !freq2) return { dLam: '-', dWn: '-', dFreq: '-', dRad: '-', tlWidth: '-', centerLam: '-', centerWn: '-', isValid: false };
    const lam1 = fromFreq(freq1, 'nm');
    const lam2 = fromFreq(freq2, 'nm');
    const dFreqRaw = Math.abs(freq1 - freq2);
    return {
      dLam: fmtDisplay(Math.abs(lam1 - lam2)),
      dWn: fmtDisplay(Math.abs(fromFreq(freq1, 'cm') - fromFreq(freq2, 'cm'))),
      dFreq: fmtDisplay(dFreqRaw),
      dRad: fmtDisplay(Math.abs(fromFreq(freq1, 'rad') - fromFreq(freq2, 'rad'))),
      tlWidth: dFreqRaw > 0 ? fmtDisplay(0.441 / dFreqRaw) : '∞',
      centerLam: fmtDisplay((lam1 + lam2) / 2),
      centerWn: fmtDisplay((fromFreq(freq1, 'cm') + fromFreq(freq2, 'cm')) / 2),
      isValid: true
    };
  };

  const calculateTotalDispersion = () => {
    const lam0 = parseFloat(dispSetup.centerLam);
    if (!lam0 || lam0 <= 0) return null;
    let totalGDD = 0, totalTOD = 0;

    const componentResults = dispSetup.components.map(comp => {
      const L = parseFloat(comp.thickness);
      let gdd = 0, tod = 0;
      if (L > 0) {
        const h = 1e-4; const w0 = (2 * Math.PI * C_NM_FS) / lam0;
        const getPhi = (w) => {
          const l_um = ((2 * Math.PI * C_NM_FS) / w) / 1000;
          const c = MATERIALS[comp.material]?.c || [];
          let n2 = 1 + (c[0] * l_um * l_um) / (l_um * l_um - c[3]) + (c[1] * l_um * l_um) / (l_um * l_um - c[4]) + ((c[2] || 0) * l_um * l_um) / (l_um * l_um - (c[5] || 0));
          return (w * Math.sqrt(n2) * (L * 1e6)) / C_NM_FS;
        };
        const p0 = getPhi(w0), pp1 = getPhi(w0 + h), pm1 = getPhi(w0 - h), pp2 = getPhi(w0 + 2 * h), pm2 = getPhi(w0 - 2 * h);
        gdd = (pp1 - 2 * p0 + pm1) / (h * h);
        tod = (pp2 - 2 * pp1 + 2 * pm1 - pm2) / (2 * h * h * h);
      }
      totalGDD += gdd; totalTOD += tod;
      return { ...comp, gdd, tod };
    });

    let broadenedPulse = '-';
    const tlTau = parseFloat(dispSetup.tlPulseWidth);
    if (tlTau > 0) {
      const factor = Math.sqrt(1 + Math.pow((4 * Math.log(2) * totalGDD) / (tlTau * tlTau), 2));
      broadenedPulse = fmtDisplay(tlTau * factor);
    }
    return { totalGDD: fmtDisplay(totalGDD), totalTOD: fmtDisplay(totalTOD), broadenedPulse, components: componentResults };
  };

  const calculateFluence = () => {
    const p = parseFloat(fluenceValues.power), r = parseFloat(fluenceValues.rep), d = parseFloat(fluenceValues.dia);
    if (!p || !r) return { energy: '-', fluence: '-', hasEnergy: false, hasFluence: false };

    const P_watts = fluenceValues.pUnit === 'mW' ? p * 1e-3 : p * 1e-6;
    const R_hz = fluenceValues.rUnit === 'kHz' ? r * 1e3 : r * 1e6;
    const E_joules = P_watts / R_hz;

    const energyMult = { 'J': 1, 'mJ': 1e3, 'µJ': 1e6, 'nJ': 1e9, 'pJ': 1e12 };
    let dispE = fmtDisplay(E_joules * (energyMult[fluenceResUnits.energy] || 1e6));

    let dispF = '-';
    if (d > 0) {
      const D_cm = fluenceValues.dUnit === 'um' ? d * 1e-4 : d * 1e-1;
      const F_peak = (8 * E_joules) / (Math.PI * Math.pow(D_cm, 2));
      const fluenceMult = { 'J/cm²': 1, 'mJ/cm²': 1e3, 'µJ/cm²': 1e6, 'nJ/cm²': 1e9 };
      dispF = fmtDisplay(F_peak * (fluenceMult[fluenceResUnits.fluence] || 1));
    }
    return { energy: dispE, fluence: dispF, hasEnergy: true, hasFluence: d > 0 };
  };

  // Generalized Grid and Tick drawing
  const drawGridAndTicks = (ctx, w, h, xMin, xMax, yMin, yMax, xLabel) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#f8fafc'; // bg-slate-50
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = '#e2e8f0'; // slate-200
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 4; i++) { // Horizontal grid
      const y = (i / 4) * h;
      ctx.moveTo(0, y); ctx.lineTo(w, y);
    }
    for (let i = 1; i < 4; i++) { // Vertical grid
      const x = (i / 4) * w;
      ctx.moveTo(x, 0); ctx.lineTo(x, h);
    }
    ctx.stroke();

    // Center Axes (Darker line for 0 point)
    ctx.strokeStyle = '#cbd5e1'; // slate-300
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (yMin < 0 && yMax > 0) {
      const y0 = h - (0 - yMin) / (yMax - yMin) * h;
      ctx.moveTo(0, y0); ctx.lineTo(w, y0);
    }
    if (xMin < 0 && xMax > 0) {
      const x0 = (0 - xMin) / (xMax - xMin) * w;
      ctx.moveTo(x0, 0); ctx.lineTo(x0, h);
    }
    ctx.stroke();

    // Ticks & Labels
    ctx.fillStyle = '#64748b'; // slate-500
    ctx.font = '10px monospace';

    // X label top left corner
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(xLabel, 6, 6);

    // X Ticks
    ctx.textBaseline = 'bottom';
    const numTicks = 4;
    for (let i = 0; i <= numTicks; i++) {
      const xVal = xMin + (xMax - xMin) * (i / numTicks);
      const xPos = (i / numTicks) * w;

      let align = 'center';
      let shift = 0;
      if (i === 0) { align = 'left'; shift = 4; }
      if (i === numTicks) { align = 'right'; shift = -4; }

      ctx.textAlign = align;
      // Dynamically format ticks based on scale
      const isLarge = Math.abs(xVal) >= 1000;
      ctx.fillText(isLarge ? xVal.toFixed(0) : xVal.toPrecision(4), xPos + shift, h - 14);

      ctx.beginPath();
      ctx.moveTo(xPos, h);
      ctx.lineTo(xPos, h - 5);
      ctx.stroke();
    }
  };

  // --- AUTOCORRELATION LOGIC & CANVAS DRAWING ---
  const handleZoom = (type, direction) => {
    const factor = direction === 'in' ? 0.8 : 1.25;
    const [min, max] = bounds.current[type];
    const range = max - min;
    const center = (max + min) / 2;
    bounds.current[type] = [center - (range * factor) / 2, center + (range * factor) / 2];
    redrawStatic();
  };

  const drawOverlap = (tau) => {
    if (!overlapCanvasRef.current) return;
    const ctx = overlapCanvasRef.current.getContext('2d');
    const w = overlapCanvasRef.current.width, h = overlapCanvasRef.current.height;
    const [xMin, xMax] = bounds.current.overlap;
    drawGridAndTicks(ctx, w, h, xMin, xMax, -1.5, 1.5, "Time t (fs)");

    const { t, E1_Re, nT, dt, tMin, w0_val, a_val, Mag, Phase, acSourceType: simSourceType } = simData.current;
    if (!nT) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();
    ctx.lineWidth = 1.5;

    // E1 (Blue) - Base Pulse
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)';
    let firstBlue = true;
    for (let i = 0; i < nT; i++) {
      if (t[i] >= xMin && t[i] <= xMax) {
        const xP = (t[i] - xMin) / (xMax - xMin) * w;
        const yP = h - (E1_Re[i] - -1.5) / (1.5 - -1.5) * h;
        if (firstBlue) { ctx.moveTo(xP, yP); firstBlue = false; } else { ctx.lineTo(xP, yP); }
      }
    }
    ctx.stroke();

    // E2 shifted (Red) - Delayed Pulse
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.8)';
    let firstRed = true;
    for (let i = 0; i < nT; i++) {
      if (t[i] >= xMin && t[i] <= xMax) {
        let t_sh = t[i] - tau;
        let e2r = 0;

        if (simSourceType === 'gaussian') {
          // Analytical exact shift removes phase jitter
          e2r = Math.exp(-a_val * t_sh * t_sh) * Math.cos(w0_val * t_sh);
        } else {
          // Mathematical decoupled carrier shift completely preserves amplitude & phase exactly!
          let idxExact = (t_sh - tMin) / dt;
          if (idxExact >= 0 && idxExact < nT - 1) {
            let idx = Math.floor(idxExact);
            let frac = idxExact - idx;
            // Linearly interpolate the slowly-varying complex envelope
            let envRe = Mag[idx] * (1 - frac) + Mag[idx + 1] * frac;
            let p1 = Phase[idx];
            let p2 = Phase[idx + 1];

            // Handle precise phase wrapping for high-freq interpolation
            if (p2 - p1 > Math.PI) p2 -= 2 * Math.PI;
            else if (p1 - p2 > Math.PI) p2 += 2 * Math.PI;

            let phaseEnv = p1 * (1 - frac) + p2 * frac;
            const totalPhase = w0_val * t_sh + phaseEnv;
            e2r = envRe * Math.cos(totalPhase);
          }
        }
        const xP = (t[i] - xMin) / (xMax - xMin) * w;
        const yP = h - (e2r - -1.5) / (1.5 - -1.5) * h;
        if (firstRed) { ctx.moveTo(xP, yP); firstRed = false; } else { ctx.lineTo(xP, yP); }
      }
    }
    ctx.stroke();
    ctx.restore();
  };

  const drawTrace = (currentFrameIdx) => {
    if (!traceCanvasRef.current) return;
    const ctx = traceCanvasRef.current.getContext('2d');
    const w = traceCanvasRef.current.width, h = traceCanvasRef.current.height;
    const [xMin, xMax] = bounds.current.trace;
    drawGridAndTicks(ctx, w, h, xMin, xMax, 0, 4.5, "Delay τ (fs)");

    const { tauArr, S_tau } = simData.current;
    if (!tauArr || tauArr.length === 0) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();

    ctx.beginPath();
    ctx.strokeStyle = '#b91c1c';
    ctx.lineWidth = 2;
    for (let i = 0; i <= currentFrameIdx; i++) {
      const xP = (tauArr[i] - xMin) / (xMax - xMin) * w;
      const yP = h - (S_tau[i] - 0) / (4.5 - 0) * h;
      i === 0 ? ctx.moveTo(xP, yP) : ctx.lineTo(xP, yP);
    }
    ctx.stroke();
    ctx.restore();
  };

  const drawSpectrumOverlay = () => {
    if (!spectrumCanvasRef.current) return;
    const ctx = spectrumCanvasRef.current.getContext('2d');
    const w = spectrumCanvasRef.current.width, h = spectrumCanvasRef.current.height;
    const [xMin, xMax] = bounds.current.spectrum;
    drawGridAndTicks(ctx, w, h, xMin, xMax, 0, 1.1, "Wavelength λ (nm)");

    const { origLambda, origI, retrievedLambda, retrieved_I } = simData.current;
    if (!origLambda || origLambda.length === 0) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();

    const maxOrig = origI.reduce((a, b) => Math.max(a, b), 0) || 1;
    const maxRetr = retrieved_I?.reduce((a, b) => Math.max(a, b), 0) || 1;
    const getY = (val) => h - (val * h * 0.8) - (0.1 * h);

    // Original Spectrum (Dashed Gray)
    ctx.beginPath();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 2;
    let first = true;
    for (let i = 0; i < origLambda.length; i++) {
      if (origLambda[i] >= xMin && origLambda[i] <= xMax) {
        const xP = (origLambda[i] - xMin) / (xMax - xMin) * w;
        const yP = getY(origI[i] / maxOrig);
        if (first) { ctx.moveTo(xP, yP); first = false; } else ctx.lineTo(xP, yP);
      }
    }
    ctx.stroke();

    // Retrieved Spectrum (Solid Green) -> Only show if 1 sweep is done
    if (simData.current.hasCompletedOneSweep && retrievedLambda && retrievedLambda.length > 0) {
      ctx.beginPath();
      ctx.setLineDash([]);
      ctx.strokeStyle = '#16a34a';
      ctx.lineWidth = 2;
      first = true;
      for (let i = 0; i < retrievedLambda.length; i++) {
        if (retrievedLambda[i] >= xMin && retrievedLambda[i] <= xMax) {
          const xP = (retrievedLambda[i] - xMin) / (xMax - xMin) * w;
          const yP = getY(retrieved_I[i] / maxRetr);
          if (first) { ctx.moveTo(xP, yP); first = false; } else ctx.lineTo(xP, yP);
        }
      }
      ctx.stroke();
    }

    // Explicit Canvas Legend
    const legW = 100, legH = 46;
    const legX = w - legW - 10, legY = 10;

    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.fillRect(legX, legY, legW, legH);
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.strokeRect(legX, legY, legW, legH);

    // Reconstructed Legend Item
    ctx.beginPath();
    ctx.strokeStyle = '#16a34a';
    ctx.lineWidth = 2;
    ctx.moveTo(legX + 8, legY + 14); ctx.lineTo(legX + 24, legY + 14);
    ctx.stroke();
    ctx.fillStyle = '#334155';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '10px sans-serif';
    ctx.fillText('Reconstructed', legX + 30, legY + 14);

    // Original Legend Item
    ctx.beginPath();
    ctx.setLineDash([4, 2]);
    ctx.strokeStyle = '#64748b';
    ctx.moveTo(legX + 8, legY + 32); ctx.lineTo(legX + 24, legY + 32);
    ctx.stroke();
    ctx.fillText('Original', legX + 30, legY + 32);

    ctx.restore();
  };

  const redrawStatic = () => {
    const { tauArr, currentFrame } = simData.current;
    if (tauArr && tauArr.length > 0) {
      drawOverlap(tauArr[currentFrame]);
      drawTrace(currentFrame);
    } else {
      drawOverlap(0);
      drawTrace(0);
    }
    drawSpectrumOverlay();
  };

  const resetAcSimulation = () => {
    setIsAcSimulating(false);
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    simData.current = {
      t: [], E1_Re: [], E1_Im: [],
      Mag: [], Phase: [],
      tauArr: [], S_tau: [],
      origLambda: [], origI: [],
      retrievedLambda: [], retrieved_I: [],
      currentFrame: 0, nT: 0, dt: 0, tMin: 0,
      w0_val: 0, a_val: 0,
      hasCompletedOneSweep: false,
      acSourceType: 'gaussian'
    };
    redrawStatic();
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target.result;
      const lines = text.split('\n');
      const lams = [], ints = [];
      lines.forEach(line => {
        const parts = line.trim().split(/[\s,;\t]+/).filter(Boolean);
        if (parts.length >= 2) {
          const x = parseFloat(parts[0]);
          const i = parseFloat(parts[1]);
          if (!isNaN(x) && !isNaN(i) && x > 0) {
            // Apply user-selected input unit: map everything to nm internally
            const lam = acExpUnit === 'cm' ? 10000000 / x : x;
            lams.push(lam);
            ints.push(i);
          }
        }
      });
      if (lams.length > 0) {
        setUploadedSpectrum({ lambda: lams, intensity: ints });
      } else {
        alert("Could not parse file. Ensure it contains two numerical columns.");
      }
    };
    reader.readAsText(file);
    e.target.value = null;
  };

  const runAcSimulation = () => {
    if (isAcSimulating) {
      cancelAnimationFrame(animationRef.current);
      setIsAcSimulating(false);
      return;
    }
    setIsAcSimulating(true);

    const nT = 16384;
    const tMin = -600, tMax = 600;
    const dt = (tMax - tMin) / nT;
    const t = Array.from({ length: nT }, (_, i) => tMin + i * dt);

    let E1_Re = new Float64Array(nT);
    let E1_Im = new Float64Array(nT);
    let Mag = new Float64Array(nT);
    let Phase = new Float64Array(nT);
    let w0_val = 0, a_val = 0;
    let origLambda = [], origI = [];

    if (acSourceType === 'gaussian') {
      const lam0 = parseFloat(acSetup.centerLam) || 800;
      const tl = parseFloat(acSetup.tlPulseWidth) || 50;
      w0_val = 2 * Math.PI * C_NM_FS / lam0;
      a_val = 2 * Math.log(2) / (tl * tl);

      for (let i = 0; i < nT; i++) {
        E1_Re[i] = Math.exp(-a_val * t[i] * t[i]) * Math.cos(w0_val * t[i]);
        E1_Im[i] = Math.exp(-a_val * t[i] * t[i]) * Math.sin(w0_val * t[i]);
      }

      const dLam = parseFloat(acSetup.spectralWidth) || 30;
      const f0 = C_NM_FS / lam0;
      const df = 0.441 / tl;
      origLambda = Array.from({ length: 400 }, (_, i) => lam0 - dLam * 2.5 + i * (dLam * 5) / 399);
      origI = origLambda.map(l => {
        const f = C_NM_FS / l;
        return Math.exp(-4 * Math.log(2) * Math.pow((f - f0) / df, 2));
      });

    } else {
      if (!uploadedSpectrum) {
        alert("Please upload an experimental spectrum file first.");
        setIsAcSimulating(false);
        return;
      }
      let o_sorted = uploadedSpectrum.lambda
        .map((l, i) => ({ l, i: uploadedSpectrum.intensity[i] }))
        .sort((a, b) => a.l - b.l);

      // Noise Floor subtraction ensures edges smoothly go to zero
      let intensities = o_sorted.map(o => o.i);
      let bg = Math.min(...intensities.slice(0, 10), ...intensities.slice(-10));
      if (isNaN(bg)) bg = 0;

      origLambda = o_sorted.map(o => o.l);
      origI = intensities.map(i => Math.max(0, i - bg));

      let omega_raw = origLambda.map(l => (2 * Math.PI * C_NM_FS) / l);
      let sortedIndices = omega_raw.map((v, i) => i).sort((a, b) => omega_raw[a] - omega_raw[b]);
      let o_raw_s = sortedIndices.map(i => omega_raw[i]);
      let I_raw_s = sortedIndices.map(i => origI[i]);

      let sumIw = 0, sumI = 0;
      for (let i = 0; i < o_raw_s.length; i++) { sumIw += o_raw_s[i] * I_raw_s[i]; sumI += I_raw_s[i]; }
      w0_val = sumIw / sumI;

      const dw = 2 * Math.PI / (tMax - tMin);
      const w_grid = Array.from({ length: nT }, (_, i) => (i - nT / 2) * dw + w0_val);
      const I_omega = interp1(o_raw_s, I_raw_s, w_grid);

      let E_omega_re = I_omega.map(val => val < 0 ? 0 : Math.sqrt(val));
      let E_omega_im = new Array(nT).fill(0);

      const E_re_shifted = circshift(E_omega_re, nT / 2);
      const E_im_shifted = circshift(E_omega_im, nT / 2);
      fftRadix2(E_re_shifted, E_im_shifted, true); // Inverse FFT

      let E_t_raw_re = circshift(E_re_shifted, nT / 2);
      let E_t_raw_im = circshift(E_im_shifted, nT / 2);

      let peakIdx = 0, maxVal = -1;
      for (let i = 0; i < nT; i++) {
        let mag = E_t_raw_re[i] * E_t_raw_re[i] + E_t_raw_im[i] * E_t_raw_im[i];
        if (mag > maxVal) { maxVal = mag; peakIdx = i; }
      }
      const shiftAmt = (nT / 2) - peakIdx;
      E_t_raw_re = circshift(E_t_raw_re, shiftAmt);
      E_t_raw_im = circshift(E_t_raw_im, shiftAmt);

      let maxE = 0;
      for (let i = 0; i < nT; i++) {
        let mag = Math.sqrt(E_t_raw_re[i] * E_t_raw_re[i] + E_t_raw_im[i] * E_t_raw_im[i]);
        if (mag > maxE) maxE = mag;
      }

      // Pure Magnitude and Phase Extraction completely solves fractional shifting phase drops!
      for (let i = 0; i < nT; i++) {
        Mag[i] = Math.sqrt(E_t_raw_re[i] * E_t_raw_re[i] + E_t_raw_im[i] * E_t_raw_im[i]) / maxE;
        Phase[i] = Math.atan2(E_t_raw_im[i], E_t_raw_re[i]);

        const totalPhase = w0_val * t[i] + Phase[i];
        E1_Re[i] = Mag[i] * Math.cos(totalPhase);
        E1_Im[i] = Mag[i] * Math.sin(totalPhase);
      }
    }

    if (origLambda.length > 0) {
      const minL = Math.min(...origLambda);
      const maxL = Math.max(...origLambda);
      const pad = (maxL - minL) * 0.1 || 50;
      bounds.current.spectrum = [minL - pad, maxL + pad];
    }

    const E_sq_int = trapz(t, Array.from(E1_Re).map((re, i) => re * re + E1_Im[i] * E1_Im[i]));

    const tauMin = -150, tauMax = 150, nTau = 2048;
    const tauArr = Array.from({ length: nTau }, (_, i) => tauMin + i * (tauMax - tauMin) / (nTau - 1));
    const d_tau = tauArr[1] - tauArr[0];
    const S_tau = new Array(nTau).fill(0);

    for (let j = 0; j < nTau; j++) {
      const tau = tauArr[j];
      let sum = 0;

      if (acSourceType === 'gaussian') {
        for (let i = 0; i < nT; i++) {
          let t_sh = t[i] - tau;
          let e2r = Math.exp(-a_val * t_sh * t_sh) * Math.cos(w0_val * t_sh);
          let e2i = Math.exp(-a_val * t_sh * t_sh) * Math.sin(w0_val * t_sh);
          const tr = E1_Re[i] + e2r;
          const ti = E1_Im[i] + e2i;
          sum += (tr * tr + ti * ti) * dt;
        }
      } else {
        // Interpolating MAGNITUDE and PHASE completely eliminates amplitude clipping!
        for (let i = 0; i < nT; i++) {
          let t_sh = t[i] - tau;
          let e2r = 0, e2i = 0;
          let idxExact = (t_sh - tMin) / dt;
          if (idxExact >= 0 && idxExact < nT - 1) {
            let idx = Math.floor(idxExact);
            let frac = idxExact - idx;

            let mag = Mag[idx] * (1 - frac) + Mag[idx + 1] * frac;
            let p1 = Phase[idx];
            let p2 = Phase[idx + 1];

            // Phase unwrapping avoids interpolation spikes
            if (p2 - p1 > Math.PI) p2 -= 2 * Math.PI;
            else if (p1 - p2 > Math.PI) p2 += 2 * Math.PI;

            let phaseEnv = p1 * (1 - frac) + p2 * frac;
            const totalPhase = w0_val * t_sh + phaseEnv;

            e2r = mag * Math.cos(totalPhase);
            e2i = mag * Math.sin(totalPhase);
          }
          const tr = E1_Re[i] + e2r;
          const ti = E1_Im[i] + e2i;
          sum += (tr * tr + ti * ti) * dt;
        }
      }
      S_tau[j] = sum / E_sq_int;
    }

    const N_fft = 8192;
    let basePts = Math.max(1, Math.min(20, Math.floor(nTau / 10)));
    let baseline = S_tau.slice(0, basePts).reduce((a, b) => a + b, 0) / basePts;
    let S_ac_only = S_tau.map(s => s - baseline);

    let S_re = new Array(N_fft).fill(0);
    let S_im = new Array(N_fft).fill(0);
    for (let i = 0; i < nTau; i++) { S_re[i] = S_ac_only[i]; }

    fftRadix2(S_re, S_im, false);

    let retrieved_I = [], retrievedLambda = [];

    for (let i = 1; i < N_fft / 2; i++) {
      let f = i / (d_tau * N_fft);
      let lam = C_NM_FS / f;

      if (lam > 100 && lam < 10000) {
        retrievedLambda.push(lam);
        retrieved_I.push(Math.sqrt(S_re[i] * S_re[i] + S_im[i] * S_im[i]));
      }
    }

    let idxs = retrievedLambda.map((_, i) => i).sort((a, b) => retrievedLambda[a] - retrievedLambda[b]);
    retrievedLambda = idxs.map(i => retrievedLambda[i]);
    retrieved_I = idxs.map(i => retrieved_I[i]);

    simData.current = {
      nT, dt, t, tMin, E1_Re, E1_Im, Mag, Phase, w0_val, a_val,
      tauArr, S_tau,
      origLambda, origI,
      retrievedLambda, retrieved_I,
      currentFrame: 0,
      hasCompletedOneSweep: false,
      acSourceType
    };

    drawSpectrumOverlay();

    let frame = 0;
    const animStep = 2;

    const animate = () => {
      let currentFrameIdx = Math.floor(frame);
      if (currentFrameIdx < nTau) {
        simData.current.currentFrame = currentFrameIdx;
        drawOverlap(tauArr[currentFrameIdx]);
        drawTrace(currentFrameIdx);
        frame += animStep;
        animationRef.current = requestAnimationFrame(animate);
      } else {
        if (!simData.current.hasCompletedOneSweep) {
          simData.current.hasCompletedOneSweep = true;
          drawSpectrumOverlay();
        }
        frame = 0;
        simData.current.currentFrame = 0;
        animationRef.current = requestAnimationFrame(animate);
      }
    };
    animate();
  };

  useEffect(() => {
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    }
  }, [mode]);

  const dispResults = useMemo(() => calculateTotalDispersion(), [dispSetup]);
  const bwResults = calculateBandwidth();
  const fluenceResults = calculateFluence();

  return (
    <div className="min-h-screen bg-white text-gray-800 font-sans p-4 md:p-8 flex flex-col items-center relative">

      {/* --- LOGO SECTION --- */}
      <div className="w-full flex justify-center md:justify-start md:absolute md:top-4 md:left-4 z-10 mb-4 md:mb-0">
        {/* To show your logo, uncomment the line below */}
        <img src={logo} alt="Lab Logo" className="h-20 md:h-32 w-auto object-contain opacity-90 hover:opacity-100 transition-opacity" />
      </div>

      <div className="w-full max-w-4xl mb-6 text-center mt-2 md:mt-0">
        <div className="flex items-center justify-center gap-3 mb-2">
          <div className="p-3 bg-red-600 rounded-xl shadow-lg shadow-red-500/20">
            <Calculator className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-gray-800 tracking-tight">
            Laser Calculator
          </h1>
        </div>
        <p className="text-gray-600 mb-6">MuSIG, SSCU, IISc</p>

        <div className="flex justify-start md:justify-center gap-2 bg-gray-100 p-1 rounded-lg w-full md:w-fit mx-auto shadow-inner overflow-x-auto max-w-full">
          {[
            { id: 'single', label: 'Unit Converter' },
            { id: 'bandwidth', label: 'Bandwidth' },
            { id: 'dispersion', label: 'Dispersion' },
            { id: 'fluence', label: 'Fluence' },
            { id: 'jacobian', label: 'Spectral Jacobian' },
            { id: 'autocorr', label: 'Autocorrelation' }
          ].map((m) => (
            <button key={m.id} onClick={() => setMode(m.id)} className={`px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 whitespace-nowrap ${mode === m.id ? 'bg-white text-red-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {mode === 'single' && (
        <div className="w-full max-w-3xl grid grid-cols-1 md:grid-cols-2 gap-4 mb-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <InputCard label="Wavelength" symbol="λ" unit="nm" value={values.nm} onChange={(v) => updateValues('nm', v)} step={1} icon={<Waves className="w-5 h-5 text-red-500" />} />
          <InputCard label="Wavenumber" symbol="ṽ" unit="cm⁻¹" value={values.cm} onChange={(v) => updateValues('cm', v)} step={100} icon={<ArrowRightLeft className="w-5 h-5 text-red-500" />} />
          <InputCard label="Frequency" symbol="ν" unit="fs⁻¹" value={values.fs} onChange={(v) => updateValues('fs', v)} step={0.01} icon={<Activity className="w-5 h-5 text-red-500" />} />
          <InputCard label="Angular Freq" symbol="ω" unit="rad/fs" value={values.rad} onChange={(v) => updateValues('rad', v)} step={0.1} icon={<Zap className="w-5 h-5 text-red-500" />} />
        </div>
      )}

      {mode === 'bandwidth' && (
        <div className="w-full max-w-3xl animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 mb-6">
            <div className="flex flex-col gap-2">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider ml-1">Start Point</span>
              <SelectableInputCard value={bwValues.p1} unit={bwValues.u1} onValueChange={(v) => updateBwValue('p1', v)} onUnitChange={(u) => updateBwUnit('u1', u)} options={[{ v: 'nm', l: 'nm' }, { v: 'cm', l: 'cm⁻¹' }, { v: 'fs', l: 'fs⁻¹' }, { v: 'rad', l: 'rad/fs' }]} placeholder="e.g. 800" />
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider ml-1">End Point</span>
              <SelectableInputCard value={bwValues.p2} unit={bwValues.u2} onValueChange={(v) => updateBwValue('p2', v)} onUnitChange={(u) => updateBwUnit('u2', u)} options={[{ v: 'nm', l: 'nm' }, { v: 'cm', l: 'cm⁻¹' }, { v: 'fs', l: 'fs⁻¹' }, { v: 'rad', l: 'rad/fs' }]} placeholder="e.g. 400" />
            </div>
          </div>

          <div className={`bg-red-50 border border-red-200 rounded-xl p-6 shadow-sm transition-opacity duration-300 ${!bwResults.isValid ? 'opacity-75 grayscale' : 'opacity-100'}`}>
            <h3 className="text-red-800 font-bold mb-4 flex items-center gap-2"><ArrowDownUp size={18} /> Calculated Bandwidth</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ResultRow label="Wavelength Diff (Δλ)" value={bwResults.dLam} unit="nm" />
              <ResultRow label="Wavenumber Diff (Δṽ)" value={bwResults.dWn} unit="cm⁻¹" />
              <ResultRow label="Frequency Diff (Δν)" value={bwResults.dFreq} unit="fs⁻¹" />
              <ResultRow label="Angular Diff (Δω)" value={bwResults.dRad} unit="rad/fs" />
              <div className="md:col-span-2 pt-3 border-t border-red-100 mt-2">
                <div className="bg-red-600 rounded-lg p-3 text-white flex flex-col sm:flex-row justify-between items-center shadow-md">
                  <span className="text-xs font-bold uppercase tracking-wider text-red-100">TL Pulse Width (Gaussian)</span>
                  <div className="text-right flex items-baseline gap-1"><span className="font-mono text-xl font-bold">{bwResults.tlWidth}</span><span className="text-xs text-red-200">fs</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {mode === 'dispersion' && (
        <div className="w-full max-w-3xl animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="flex flex-col gap-2">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider ml-1">Central Wavelength</span>
              <InputCard label="" symbol="λ₀" unit="nm" value={dispSetup.centerLam} onChange={(v) => handleDispSetup('centerLam', v)} step={10} icon={<Waves className="w-4 h-4 text-red-500" />} placeholder="e.g. 800" />
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider ml-1">Spectral FWHM</span>
              <InputCard label="" symbol="Δλ" unit="nm" value={dispSetup.spectralWidth} onChange={(v) => handleDispSetup('spectralWidth', v)} step={5} icon={<ArrowRightLeft className="w-4 h-4 text-red-500" />} placeholder="e.g. 20" />
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider ml-1">TL Pulse Width</span>
              <InputCard label="" symbol="τ₀" unit="fs" value={dispSetup.tlPulseWidth} onChange={(v) => handleDispSetup('tlPulseWidth', v)} step={5} icon={<Timer className="w-4 h-4 text-red-500" />} placeholder="e.g. 50" />
            </div>
          </div>
          <div className="mb-6 space-y-4">
            <div className="flex justify-between items-end">
              <h3 className="text-red-800 font-bold flex items-center gap-2 text-sm uppercase tracking-wide"><Layers size={16} /> Setup Components</h3>
            </div>
            {dispSetup.components.map((comp) => (
              <div key={comp.id} className="bg-white border-2 border-gray-100 rounded-xl p-3 shadow-sm flex flex-col md:flex-row gap-3 items-center">
                <div className="flex-1 w-full">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">Material</span>
                  <div className="bg-gray-50 rounded-lg p-1 border border-gray-200 focus-within:border-red-400 flex items-center h-10">
                    <div className="pl-2 text-red-400"><FlaskConical size={14} /></div>
                    <select value={comp.material} onChange={(e) => setDispSetup(p => ({ ...p, components: p.components.map(c => c.id === comp.id ? { ...c, material: e.target.value } : c) }))} className="w-full h-full pl-2 text-sm font-semibold text-gray-800 outline-none bg-transparent">
                      {Object.keys(MATERIALS).map(m => (<option key={m} value={m}>{MATERIALS[m].name}</option>))}
                    </select>
                  </div>
                </div>
                <div className="w-full md:w-32">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">Thickness</span>
                  <div className="bg-gray-50 rounded-lg border border-gray-200 focus-within:border-red-400 flex items-center h-10 overflow-hidden">
                    <input type="number" value={comp.thickness} onChange={(e) => setDispSetup(p => ({ ...p, components: p.components.map(c => c.id === comp.id ? { ...c, thickness: e.target.value } : c) }))} className="w-full h-full pl-3 text-sm font-mono font-bold text-gray-800 outline-none bg-transparent" />
                    <span className="pr-3 text-xs text-red-400 font-medium">mm</span>
                  </div>
                </div>
                <button onClick={() => setDispSetup(p => ({ ...p, components: p.components.filter(c => c.id !== comp.id) }))} className="p-2 text-gray-400 hover:text-red-500 rounded-lg"><Trash2 size={18} /></button>
              </div>
            ))}
            <button onClick={() => setDispSetup(p => ({ ...p, components: [...p.components, { id: Date.now(), material: 'Fused Silica', thickness: '1' }] }))} className="w-full py-3 border-2 border-dashed border-red-200 text-red-400 rounded-xl hover:bg-red-50 font-semibold text-sm flex justify-center gap-2"><Plus size={16} /> Add Material</button>
          </div>
          {dispResults && (
            <div className="bg-red-600 rounded-xl p-6 shadow-lg text-white">
              <h3 className="font-bold mb-4 flex items-center gap-2 text-red-100"><Activity size={18} /> Total System Dispersion</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white/10 p-4 rounded-lg">
                  <span className="text-red-200 text-xs font-bold uppercase">Total GDD</span>
                  <div className="text-2xl font-mono mt-1 font-bold">{dispResults.totalGDD} <span className="text-xs text-red-200">fs²</span></div>
                </div>
                <div className="bg-white/10 p-4 rounded-lg">
                  <span className="text-red-200 text-xs font-bold uppercase">Total TOD</span>
                  <div className="text-2xl font-mono mt-1 font-bold">{dispResults.totalTOD} <span className="text-xs text-red-200">fs³</span></div>
                </div>
                <div className="bg-white/10 p-4 rounded-lg shadow-inner border border-white/20">
                  <span className="text-white text-xs font-bold uppercase">Broadened Pulse</span>
                  <div className="text-2xl font-mono mt-1 font-bold">{dispResults.broadenedPulse} <span className="text-xs text-red-100">fs</span></div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {mode === 'fluence' && (
        <div className="w-full max-w-3xl animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <SelectableInputCard value={fluenceValues.power} unit={fluenceValues.pUnit} onValueChange={(v) => setFluenceValues(p => ({ ...p, power: v }))} onUnitChange={(u) => setFluenceValues(p => ({ ...p, pUnit: u }))} options={[{ v: 'mW', l: 'mW' }, { v: 'uW', l: 'µW' }]} placeholder="Power (e.g. 100)" />
            <SelectableInputCard value={fluenceValues.rep} unit={fluenceValues.rUnit} onValueChange={(v) => setFluenceValues(p => ({ ...p, rep: v }))} onUnitChange={(u) => setFluenceValues(p => ({ ...p, rUnit: u }))} options={[{ v: 'kHz', l: 'kHz' }, { v: 'MHz', l: 'MHz' }]} placeholder="Rep Rate (e.g. 1)" />
            <SelectableInputCard value={fluenceValues.dia} unit={fluenceValues.dUnit} onValueChange={(v) => setFluenceValues(p => ({ ...p, dia: v }))} onUnitChange={(u) => setFluenceValues(p => ({ ...p, dUnit: u }))} options={[{ v: 'um', l: 'µm' }, { v: 'mm', l: 'mm' }]} placeholder="Spot Diam (e.g. 100)" />
          </div>
          <div className={`bg-red-50 border border-red-200 rounded-xl p-6 transition-opacity ${!fluenceResults.hasEnergy ? 'opacity-75 grayscale' : 'opacity-100'}`}>
            <h3 className="text-red-800 font-bold mb-4 flex items-center gap-2"><Flame size={18} /> Fluence Results</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div onClick={() => cycleFluenceRes('energy')} className={`bg-white p-4 rounded-lg border shadow-sm cursor-pointer ${!fluenceResults.hasFluence ? 'md:col-span-2' : ''}`}>
                <div className="flex justify-between items-center mb-2"><span className="text-gray-500 text-xs font-bold uppercase">Pulse Energy</span><RotateCcw size={12} className="text-gray-300" /></div>
                <div className="text-3xl font-mono text-gray-800 font-bold">{fluenceResults.energy} <span className="text-lg text-red-500">{fluenceResUnits.energy}</span></div>
              </div>
              <div onClick={() => fluenceResults.hasFluence && cycleFluenceRes('fluence')} className={`${fluenceResults.hasFluence ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-400'} p-4 rounded-lg border shadow-sm transition-colors`}>
                <div className="flex justify-between items-center mb-2"><span className="text-xs font-bold uppercase">Peak Fluence</span>{fluenceResults.hasFluence && <RotateCcw size={12} />}</div>
                <div className="text-3xl font-mono font-bold">{fluenceResults.fluence} <span className="text-lg">{fluenceResUnits.fluence}</span></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- JACOBIAN SECTION --- */}
      {mode === 'jacobian' && (
        <div className="w-full max-w-3xl animate-in fade-in slide-in-from-bottom-4 duration-300">
          {/* Input Toggle */}
          <div className="flex gap-4 mb-6 bg-white p-2 rounded-xl border border-red-100 shadow-sm w-fit mx-auto">
            <label className={`cursor-pointer px-4 py-2 rounded-lg text-sm font-bold transition-colors ${jacobSetup.direction === 'nm2cm' ? 'bg-red-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
              <input type="radio" className="hidden" value="nm2cm" checked={jacobSetup.direction === 'nm2cm'} onChange={() => setJacobSetup({ direction: 'nm2cm' })} />
              nm to cm⁻¹
            </label>
            <label className={`cursor-pointer px-4 py-2 rounded-lg text-sm font-bold transition-colors ${jacobSetup.direction === 'cm2nm' ? 'bg-red-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
              <input type="radio" className="hidden" value="cm2nm" checked={jacobSetup.direction === 'cm2nm'} onChange={() => setJacobSetup({ direction: 'cm2nm' })} />
              cm⁻¹ to nm
            </label>
          </div>

          {/* File Upload */}
          <div className="mb-6 bg-red-50 border-2 border-dashed border-red-200 rounded-xl p-6 text-center flex flex-col items-center">
            <Upload className="w-8 h-8 text-red-400 mx-auto mb-2" />
            <h4 className="text-red-800 font-bold mb-1">Upload Original Spectrum</h4>
            <p className="text-xs text-gray-500 mb-4">Text or CSV file with 2 columns. Column 1: {jacobSetup.direction === 'nm2cm' ? 'nm' : 'cm⁻¹'}, Column 2: Intensity.</p>
            <label className="cursor-pointer bg-white px-4 py-2 border border-red-300 rounded-lg text-red-600 font-bold text-sm shadow-sm hover:bg-red-50 transition-colors">
              Choose File
              <input type="file" accept=".txt,.csv,.dat" className="hidden" onChange={handleJacobUpload} />
            </label>
            {jacobOriginal && <div className="mt-4 text-xs font-bold text-green-600 bg-green-50 p-2 rounded border border-green-200">✓ Loaded {jacobOriginal.x.length} data points</div>}
          </div>

          {/* Plots and Download */}
          {jacobOriginal && (
            <div className="bg-white border border-red-200 rounded-xl p-4 md:p-6 shadow-sm mb-6">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-red-800 font-bold flex items-center gap-2">
                  <BarChart2 size={18} /> Jacobian Transformation Result
                </h3>
                {jacobConverted && (
                  <button
                    onClick={downloadConvertedSpectra}
                    className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold text-sm transition-colors shadow-sm"
                  >
                    <Download size={16} /> Download
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Original Plot */}
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-gray-500 uppercase mb-2 text-center">
                    Original I({jacobSetup.direction === 'nm2cm' ? 'λ' : 'ṽ'})
                  </span>
                  <div className="p-1 rounded-lg border border-slate-200 shadow-inner">
                    <canvas ref={jacobOrigCanvasRef} width={400} height={250} className="w-full h-40 md:h-48 rounded bg-slate-50"></canvas>
                  </div>
                </div>

                {/* Converted Plot */}
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-green-600 uppercase mb-2 text-center">
                    Converted I({jacobSetup.direction === 'nm2cm' ? 'ṽ' : 'λ'})
                  </span>
                  <div className="p-1 rounded-lg border border-green-200 shadow-inner">
                    <canvas ref={jacobConvCanvasRef} width={400} height={250} className="w-full h-40 md:h-48 rounded bg-green-50/30"></canvas>
                  </div>
                </div>
              </div>

              <div className="mt-4 p-3 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-800">
                <strong>Energy Conserved:</strong> The transformed intensity profile correctly integrates to the same area as the original profile by multiplying by the proper Jacobian factor |dx/dy|.
              </div>
            </div>
          )}
        </div>
      )}

      {mode === 'autocorr' && (
        <div className="w-full max-w-3xl animate-in fade-in slide-in-from-bottom-4 duration-300">
          {/* Input Toggle */}
          <div className="flex gap-4 mb-4 bg-white p-2 rounded-xl border border-red-100 shadow-sm w-fit mx-auto">
            <label className={`cursor-pointer px-4 py-2 rounded-lg text-sm font-bold transition-colors ${acSourceType === 'gaussian' ? 'bg-red-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
              <input type="radio" className="hidden" value="gaussian" checked={acSourceType === 'gaussian'} onChange={() => setAcSourceType('gaussian')} />
              Gaussian Spectrum
            </label>
            <label className={`cursor-pointer px-4 py-2 rounded-lg text-sm font-bold transition-colors ${acSourceType === 'experimental' ? 'bg-red-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
              <input type="radio" className="hidden" value="experimental" checked={acSourceType === 'experimental'} onChange={() => setAcSourceType('experimental')} />
              Experimental Spectrum
            </label>
          </div>

          {/* Setup Grid */}
          {acSourceType === 'gaussian' ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="flex flex-col gap-2">
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider ml-1">Center Wavelength</span>
                <InputCard label="" symbol="λ₀" unit="nm" value={acSetup.centerLam} onChange={(v) => handleAcSetup('centerLam', v)} step={10} icon={<Waves className="w-4 h-4 text-red-500" />} />
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider ml-1">Spectral FWHM</span>
                <InputCard label="" symbol="Δλ" unit="nm" value={acSetup.spectralWidth} onChange={(v) => handleAcSetup('spectralWidth', v)} step={5} icon={<ArrowRightLeft className="w-4 h-4 text-red-500" />} />
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider ml-1">TL Pulse Width</span>
                <InputCard label="" symbol="τ₀" unit="fs" value={acSetup.tlPulseWidth} onChange={(v) => handleAcSetup('tlPulseWidth', v)} step={5} icon={<Timer className="w-4 h-4 text-red-500" />} />
              </div>
            </div>
          ) : (
            <div className="mb-6 bg-red-50 border-2 border-dashed border-red-200 rounded-xl p-6 text-center flex flex-col items-center">
              <Upload className="w-8 h-8 text-red-400 mx-auto mb-2" />
              <h4 className="text-red-800 font-bold mb-1">Upload Spectrum File</h4>
              <div className="flex items-center gap-2 mb-4">
                <span className="text-xs font-bold text-gray-500 uppercase">Input Unit:</span>
                <div className="bg-white rounded border border-red-200 flex overflow-hidden">
                  <button
                    onClick={() => { setAcExpUnit('nm'); setUploadedSpectrum(null); }}
                    className={`px-3 py-1 text-xs font-bold transition-colors ${acExpUnit === 'nm' ? 'bg-red-500 text-white' : 'text-gray-500 hover:bg-red-50'}`}
                  >nm</button>
                  <button
                    onClick={() => { setAcExpUnit('cm'); setUploadedSpectrum(null); }}
                    className={`px-3 py-1 text-xs font-bold transition-colors border-l border-red-200 ${acExpUnit === 'cm' ? 'bg-red-500 text-white' : 'text-gray-500 hover:bg-red-50'}`}
                  >cm⁻¹</button>
                </div>
              </div>
              <p className="text-xs text-gray-500 mb-4">Text or CSV file with 2 columns: {acExpUnit === 'nm' ? 'Wavelength (nm)' : 'Wavenumber (cm⁻¹)'} and Intensity.</p>
              <label className="cursor-pointer bg-white px-4 py-2 border border-red-300 rounded-lg text-red-600 font-bold text-sm shadow-sm hover:bg-red-50 transition-colors">
                Choose File
                <input type="file" accept=".txt,.csv,.dat" className="hidden" onChange={handleFileUpload} />
              </label>
              {uploadedSpectrum && <div className="mt-4 text-xs font-bold text-green-600 bg-green-50 p-2 rounded border border-green-200">✓ Loaded {uploadedSpectrum.lambda.length} data points</div>}
            </div>
          )}

          {/* Canvas Section */}
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 md:p-6 shadow-sm mb-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-red-800 font-bold flex items-center gap-2">
                <Activity size={18} /> Field Autocorrelation Simulator
              </h3>
              <div className="flex gap-2">
                <button onClick={resetAcSimulation} className="flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors shadow-sm">
                  <RotateCcw size={16} /> Reset
                </button>
                <button onClick={runAcSimulation} className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm transition-colors shadow-sm ${isAcSimulating ? 'bg-red-200 text-red-800' : 'bg-red-600 hover:bg-red-700 text-white'}`}>
                  {isAcSimulating ? <Square size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
                  {isAcSimulating ? 'Stop' : 'Simulate'}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
              {/* Trace Canvas */}
              <div className="bg-white p-1 rounded-lg border border-red-100 shadow-inner flex flex-col md:col-span-2 relative group">
                <canvas ref={traceCanvasRef} width={800} height={200} className="w-full h-32 md:h-40 rounded bg-slate-50"></canvas>
                <div className="absolute bottom-6 right-2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => handleZoom('trace', 'in')} className="bg-white/90 hover:bg-white p-1.5 rounded shadow text-gray-700 border border-gray-200"><Plus size={14} /></button>
                  <button onClick={() => handleZoom('trace', 'out')} className="bg-white/90 hover:bg-white p-1.5 rounded shadow text-gray-700 border border-gray-200"><Minus size={14} /></button>
                </div>
              </div>

              {/* Overlap Canvas */}
              <div className="bg-white p-1 rounded-lg border border-red-100 shadow-inner flex flex-col relative group">
                <canvas ref={overlapCanvasRef} width={400} height={200} className="w-full h-32 md:h-40 rounded bg-slate-50"></canvas>
                <div className="absolute bottom-6 right-2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => handleZoom('overlap', 'in')} className="bg-white/90 hover:bg-white p-1.5 rounded shadow text-gray-700 border border-gray-200"><Plus size={14} /></button>
                  <button onClick={() => handleZoom('overlap', 'out')} className="bg-white/90 hover:bg-white p-1.5 rounded shadow text-gray-700 border border-gray-200"><Minus size={14} /></button>
                </div>
              </div>

              {/* Spectral Overlay Canvas */}
              <div className="bg-white p-1 rounded-lg border border-red-100 shadow-inner flex flex-col relative group">
                <canvas ref={spectrumCanvasRef} width={400} height={200} className="w-full h-32 md:h-40 rounded bg-slate-50"></canvas>

                {/* HTML Legend */}
                <div className="absolute top-2 left-2 bg-white/90 border border-slate-200 p-1.5 rounded shadow-sm flex flex-col gap-1 text-[9px] pointer-events-none z-10">
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-[2px] bg-green-600"></div>
                    <span className="text-slate-700 font-bold">Retrieved</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-0 border-t-[1.5px] border-dashed border-slate-500"></div>
                    <span className="text-slate-700 font-bold">Original</span>
                  </div>
                </div>

                <div className="absolute bottom-6 right-2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                  <button onClick={() => handleZoom('spectrum', 'in')} className="bg-white/90 hover:bg-white p-1.5 rounded shadow text-gray-700 border border-gray-200"><Plus size={14} /></button>
                  <button onClick={() => handleZoom('spectrum', 'out')} className="bg-white/90 hover:bg-white p-1.5 rounded shadow text-gray-700 border border-gray-200"><Minus size={14} /></button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- INFO / FOOTER --- */}
      <div className="flex flex-wrap gap-4 mb-10 justify-center mt-4">
        <button onClick={() => setShowInfo(!showInfo)} className="flex items-center gap-2 px-6 py-2 bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 rounded-lg transition-colors shadow-sm">
          <Info size={18} /> {showInfo ? 'Hide Formulas' : 'Mathematical Formulas'}
        </button>
      </div>

      {showInfo && (
        <div className="w-full max-w-3xl bg-red-50 border border-red-200 rounded-2xl p-6 backdrop-blur-sm animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="flex justify-between items-start mb-4">
            <h3 className="text-xl font-semibold text-gray-800">Mathematical Formulas</h3>
            <button onClick={() => setShowInfo(false)} className="text-gray-500 hover:text-gray-700"><X size={20} /></button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-gray-700 text-sm">
            <div className="space-y-3">
              <p><strong className="text-red-600">TL Pulse (Gaussian):</strong> <br /> Δτ · Δν ≈ 0.441</p>
              <p><strong className="text-red-600">Pulse Broadening:</strong> <br /> τ_out = τ₀ · √[1 + (4ln2 · GDD / τ₀²)²]</p>
              <p><strong className="text-red-600">Field Autocorrelation S(τ):</strong> <br /> S(τ) = ∫ |E(t) + E(t-τ)|² dt</p>
            </div>
            <div className="space-y-3">
              <p><strong className="text-red-600">Peak Fluence (F):</strong> <br /> F = 8 · E / (π · D²)</p>
              <p><strong className="text-red-600">Jacobian (nm to cm⁻¹):</strong> <br /> I(ṽ) = I(λ) · (λ² / 10⁷)</p>
              <p><strong className="text-red-600">Jacobian (cm⁻¹ to nm):</strong> <br /> I(λ) = I(ṽ) · (ṽ² / 10⁷)</p>
            </div>
          </div>
        </div>
      )}

      {/* SEO Section */}
      <div className="w-full max-w-3xl mt-12 text-gray-600 text-sm leading-relaxed border-t border-gray-200 pt-8 pb-8">
        <h2 className="text-lg font-bold text-gray-800 mb-3">Online Spectroscopy Unit Converter & Laser Simulator</h2>
        <p className="mb-4">
          This comprehensive tool is designed for <strong>Ultrafast Physicists</strong> and <strong>Laser Spectroscopists</strong> at the <strong>MuSIG Lab (IISc)</strong> and worldwide.
        </p>
        <h3 className="font-semibold text-gray-800 mb-2">How to convert nm to cm⁻¹ (Wavelength to Wavenumber)</h3>
        <p className="mb-4 bg-gray-50 p-3 rounded-lg border border-gray-200">
          To convert wavelength in nanometers (nm) to wavenumber in inverse centimeters (cm⁻¹), use the formula: <br />
          <strong className="text-red-600 font-mono text-base">ṽ (cm⁻¹) = 10,000,000 / λ (nm)</strong><br />
          Because 1 cm is equal to 10,000,000 nm, dividing 10⁷ by the wavelength in nm yields the number of waves per centimeter.
        </p>

        {/* DONATION BUTTON */}
        <div className="mt-8 flex justify-center">
          <a href="https://buymeacoffee.com/gsayan?status=1" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 bg-yellow-400 hover:bg-yellow-500 text-yellow-900 px-4 py-2 rounded-lg font-bold transition-colors shadow-sm">
            <Coffee size={20} />
            <span>Buy me a coffee</span>
          </a>
        </div>
      </div>
    </div>
  );
};

// --- REUSABLE COMPONENTS ---
const InputCard = ({ label, symbol, unit, value, onChange, step, icon, placeholder }) => (
  <div className="bg-red-50 rounded-xl p-5 border-2 border-red-200 focus-within:border-red-500 relative overflow-hidden transition-all h-full">
    {label && <div className="flex justify-between items-center mb-3"><span className="text-red-700 font-medium text-sm tracking-wider uppercase flex items-center gap-2">{icon} {label}</span><span className="text-red-500 font-serif italic text-lg">{symbol}</span></div>}
    <div className="relative flex bg-white rounded-lg border border-red-300 focus-within:border-red-500 overflow-hidden">
      <div className="flex flex-col border-r border-red-200 bg-red-50">
        <button onClick={() => onChange(((parseFloat(value) || 0) + step).toString())} className="px-2 h-6 hover:bg-red-100 text-red-600 transition-colors flex items-center"><ChevronUp size={14} /></button>
        <button onClick={() => onChange(((parseFloat(value) || 0) - step).toString())} className="px-2 h-6 hover:bg-red-100 text-red-600 border-t border-red-200 transition-colors flex items-center"><ChevronDown size={14} /></button>
      </div>
      <input type="number" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} step="any" className="w-full text-gray-800 text-2xl font-mono p-3 pr-16 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
      <div className="absolute right-3 top-1/2 -translate-y-1/2 text-red-500 pointer-events-none text-sm">{unit}</div>
    </div>
  </div>
);

const SelectableInputCard = ({ value, unit, onValueChange, onUnitChange, options, placeholder }) => (
  <div className="bg-white rounded-xl p-1 border-2 border-red-200 focus-within:border-red-500 flex items-center relative h-16 shadow-sm">
    <input type="number" value={value} onChange={(e) => onValueChange(e.target.value)} placeholder={placeholder} className="w-full h-full pl-4 text-2xl font-mono text-gray-800 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
    <div className="h-full border-l border-red-100 bg-red-50 flex items-center">
      <select value={unit} onChange={(e) => onUnitChange(e.target.value)} className="bg-transparent text-red-700 font-bold text-sm px-3 py-2 outline-none cursor-pointer text-center min-w-[80px]">
        {options.map((opt) => (<option key={opt.v} value={opt.v}>{opt.l}</option>))}
      </select>
      <div className="pointer-events-none absolute right-2 text-red-400"><ChevronDown size={12} /></div>
    </div>
  </div>
);

const ResultRow = ({ label, value, unit }) => (
  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-white p-3 rounded-lg border border-red-100 gap-1 sm:gap-0">
    <span className="text-xs font-bold uppercase text-gray-500">{label}</span>
    <div className="text-left sm:text-right">
      <span className="font-mono text-lg font-semibold text-gray-800">{value}</span>
      <span className="text-xs text-red-500 ml-1">{unit}</span>
    </div>
  </div>
);

export default App;