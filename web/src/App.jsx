import React, { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';

function detectApiBase() {
  if (import.meta.env.VITE_API_BASE && import.meta.env.VITE_API_BASE.trim() !== '') {
    return import.meta.env.VITE_API_BASE.trim();
  }
  if (typeof window !== 'undefined') {
    const { protocol, hostname } = window.location;
    return `${protocol}//${hostname}:8000`;
  }
  return 'http://localhost:8000';
}
const API = detectApiBase();

export default function App() {
  const containerRef = useRef(null);
  const wavesurferRef = useRef(null);
  const [file, setFile] = useState(null);
  const [uploadPct, setUploadPct] = useState(0);
  const [status, setStatus] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [zoom, setZoom] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const ws = WaveSurfer.create({
      container: containerRef.current,
      height: 140,
      waveColor: '#8ea1e1',
      progressColor: '#3b5bdb',
      cursorColor: '#1f2937',
      responsive: true,
      autoCenter: true,
      minPxPerSec: 50,
      plugins: [RegionsPlugin.create()]
    });
    wavesurferRef.current = ws;
    return () => ws.destroy();
  }, []);

  useEffect(() => { wavesurferRef.current?.zoom(zoom || 0); }, [zoom]);

  function onChoose(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 500 * 1024 * 1024) {
      setError('File exceeds 500 MB limit.');
      return;
    }
    setError(null);
    setFile(f);
    const url = URL.createObjectURL(f);
    wavesurferRef.current?.load(url);
  }

  async function uploadAndAnalyze() {
    if (!file) return;
    try {
      setStatus({ state: 'uploading', message: 'Uploading…' });
      const form = new FormData();
      form.append('file', file);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API}/api/upload`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setUploadPct(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onreadystatechange = () => {
        if (xhr.readyState === 4) {
          if (xhr.status >= 200 && xhr.status < 300) {
            const { fileId } = JSON.parse(xhr.responseText);
            pollStatus(fileId);
          } else {
            setError(`Upload failed (${xhr.status})`);
            setStatus(null);
          }
        }
      };
      xhr.send(form);
    } catch (e) {
      setError(e.message);
      setStatus(null);
    }
  }

  async function pollStatus(id) {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API}/api/status/${id}`);
        const data = await res.json();
        setStatus(data);
        if (data.status === 'done') {
          clearInterval(interval);
          const r = await fetch(`${API}/api/result/${id}`);
          const json = await r.json();
          setResult(json);
          drawRegions(json.segments);
        }
        if (data.status === 'error') clearInterval(interval);
      } catch (e) {
        setError('Lost connection while checking status.');
      }
    }, 1200);
  }

  function drawRegions(segments) {
    const ws = wavesurferRef.current;
    ws.clearRegions();
    segments.forEach((s, i) => {
      ws.addRegion({
        id: `seg-${i}`,
        start: s.startSec,
        end: s.endSec,
        drag: false,
        resize: false,
        color: 'rgba(16,185,129,0.25)'
      });
    });
    ws.on('region-click', (region) => {
      ws.play(region.start, region.end);
    });
  }

  function fmtTime(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }
  function fmtDb(x) { return x != null ? `${x.toFixed(1)} dBFS` : '—'; }

  return (
    <div style={{ padding: 16, maxWidth: 1200, margin: '0 auto', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <h1>LaughTrackr</h1>
      <p>Upload a set (≤ 500 MB). We’ll mark where the audience laughed and let you jump to those moments.</p>

      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 12 }}>
        <input type="file" accept="audio/*" onChange={onChoose} />
        <button onClick={uploadAndAnalyze} disabled={!file}>Upload & Analyze</button>
        <label>Zoom: <input type="range" min="0" max="200" value={zoom} onChange={(e)=>setZoom(Number(e.target.value))} /></label>
      </div>

      {error && <div style={{ color: '#b91c1c', marginTop: 12 }}>{error}</div>}
      <div style={{ marginTop: 16 }} ref={containerRef} />

      {status && (
        <div style={{ marginTop: 12, padding: 8, border: '1px solid #e5e7eb', borderRadius: 8 }}>
          <strong>Status:</strong> {status.status || status.state} — {status.message}
          {status.status === 'uploading' && (
            <div style={{ marginTop: 8 }}>
              <div style={{ height: 6, background: '#e5e7eb' }}>
                <div style={{ width: `${uploadPct}%`, height: 6, background: '#3b82f6' }} />
              </div>
            </div>
          )}
          {typeof status.progress === 'number' && (
            <div style={{ marginTop: 6 }}>
              Analysis {Math.round(status.progress * 100)}%
            </div>
          )}
        </div>
      )}

      {result && (
        <div style={{ marginTop: 16 }}>
          <h3>Segments</h3>
          <table width="100%" cellPadding="6" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th align="left">#</th>
                <th align="left">When</th>
                <th align="left">Dur</th>
                <th align="left">Peak dBFS</th>
                <th align="left">Min dBFS</th>
                <th align="left">Avg RMS</th>
              </tr>
            </thead>
            <tbody>
              {result.segments.map((s, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #eee', cursor: 'pointer' }}
                    onClick={() => wavesurferRef.current?.play(s.startSec, s.endSec)}>
                  <td>{i + 1}</td>
                  <td>{fmtTime(s.startSec)}–{fmtTime(s.endSec)}</td>
                  <td>{s.durationSec.toFixed(2)}s</td>
                  <td>{fmtDb(s.peakDbfs)}</td>
                  <td>{fmtDb(s.minDbfs)}</td>
                  <td>{s.avgRms?.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
