import { useState, useEffect, useCallback, useRef } from "react";

const API = import.meta?.env?.VITE_API || "/api";

const apiFetch = (url, options = {}) =>
  fetch(url, { ...options, credentials: "include", headers: { ...(options.headers || {}) } });

const apiJson = async (url, options) => {
  const r = await apiFetch(url, options);
  const d = await r.json().catch(() => null);
  if (r.status === 401) throw new Error("unauthorized");
  if (!r.ok) throw new Error(d?.error || "Request failed");
  return d;
};

// --- utils ---
const fmtSz = b => { if (!b) return "0 B"; const k=1024,s=["B","KB","MB","GB"]; const i=Math.floor(Math.log(b)/Math.log(k)); return `${(b/k**i).toFixed(1)} ${s[i]}`; };
const fmtDate = d => d ? new Date(d).toLocaleString("en-GB",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}) : "-";
const ago = d => { if(!d)return"Never"; const s=Math.floor((Date.now()-new Date(d))/1000); if(s<60)return"just now"; if(s<3600)return`${Math.floor(s/60)}m ago`; if(s<86400)return`${Math.floor(s/3600)}h ago`; return`${Math.floor(s/86400)}d ago`; };
const fmtUptime = sec => { const s=Number(sec||0),d=Math.floor(s/86400),h=Math.floor((s%86400)/3600),m=Math.floor((s%3600)/60); if(d>0)return`${d}d ${h}h`; if(h>0)return`${h}h ${m}m`; return`${m}m`; };

const SHOW_ICONS = true;

// --- SVG icons ---
const IconSet = {
  Home: (p) => <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  Dashboard: (p) => <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>,
  Save: (p) => <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>,
  Activity: (p) => <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
  Shield: (p) => <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  Sync: (p) => <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21v-5h5"/></svg>,
  Lock: (p) => <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
  Building: (p) => <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><rect width="16" height="20" x="4" y="2" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/></svg>,
  Check: (p) => <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="20 6 9 17 4 12"/></svg>,
  Alert: (p) => <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>,
  X: (p) => <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/></svg>,
  Folder: (p) => <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>,
  Database: (p) => <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/></svg>,
  Box: (p) => <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>,
  Clock: (p) => <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  Zap: (p) => <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
  Play: (p) => <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><polygon points="5 3 19 12 5 21 5 3"/></svg>,
  Pause: (p) => <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>,
  Stop: (p) => <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="3" y="3" width="18" height="18" rx="2"/></svg>,
  Settings: (p) => <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  User: (p) => <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  Search: (p) => <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/></svg>,
  Download: (p) => <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>,
  Restore: (p) => <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>,
  Trash: (p) => <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>,
  Globe: (p) => <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="10"/><line x1="2" x2="22" y1="12" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>,
  Info: (p) => <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="16" y2="12"/><line x1="12" x2="12.01" y1="8" y2="8"/></svg>
};

const Icons = SHOW_ICONS ? IconSet : new Proxy(IconSet, { get: () => () => null });

// --- color palette ---
const C = {
  bg:          "#020818",
  surface:     "#080e1c",
  card:        "#0b1224",
  border:      "#1e293b",
  border2:     "#334155",
  accent:      "#0ea5e9",
  accentHover: "#0284c7",
  accentLight: "#38bdf8",
  accentGlow:  "rgba(14,165,233,0.15)",
  accentGlow2: "rgba(14,165,233,0.08)",
  blueLight:   "#bae6fd",
  blueDim:     "#7dd3fc",
  text:        "#f8fafc",
  textMid:     "#f8fafc",
  textDim:     "#f8fafc",
  textMuted:   "#f8fafc",
  gold:      "#fbbf24",
  green:     "#10b981",
  greenDim:  "#065f46",
  red:       "#ef4444",
  redDim:    "#f87171",
};

const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;600;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: ${C.bg}; }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: ${C.surface}; }
  ::-webkit-scrollbar-thumb { background: ${C.border2}; border-radius: 2px; }
  ::-webkit-scrollbar-thumb:hover { background: ${C.accent}; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
  @keyframes spin { to{transform:rotate(360deg)} }
  @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
  @keyframes shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
  @keyframes glow { 0%,100%{box-shadow:0 0 20px rgba(14,165,233,.3)} 50%{box-shadow:0 0 40px rgba(14,165,233,.6)} }
`;

const pal = [
  ["#0a1e3d","#60a5fa"],["#0f172a","#38bdf8"],["#1e1b4b","#818cf8"],
  ["#064e3b","#34d399"],["#4a044e","#e879f9"],["#450a0a","#f87171"],
];
const Avatar = ({ name, i, size=32 }) => {
  const [bg,fg] = pal[(i||0)%pal.length];
  const init = name.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase();
  return (
    <div style={{width:size,height:size,borderRadius:"50%",background:bg,border:`1px solid ${fg}40`,color:fg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:size*0.32,fontWeight:700,flexShrink:0,letterSpacing:"-0.02em"}}>
      {init}
    </div>
  );
};

const Dot = ({ s }) => {
  const color = s==="ok"?"#10b981":s==="warn"||s==="pending"?"#f59e0b":"#ef4444";
  return (
    <span style={{position:"relative",display:"inline-flex",alignItems:"center",justifyContent:"center",width:10,height:10,flexShrink:0}}>
      {s==="pending" && <span style={{position:"absolute",inset:0,borderRadius:"50%",background:color,opacity:.4,animation:"pulse 1.5s infinite"}} />}
      <span style={{width:7,height:7,borderRadius:"50%",background:color,display:"block"}} />
    </span>
  );
};

const BackupProgress = ({ p, compact=false, clientId, onPause, onStop }) => {
  if (!p) return null;
  const pct = Math.max(0, Math.min(100, Number(p.percent ?? 0) || 0));
  const isErr = p.status === "error" || p.status === "cancelled";
  const isDone = p.status === "done";
  const isPaused = p.stage === "paused";
  const isRunning = p.status === "running" && !isPaused;
  const label =
    typeof p.message === "string" && p.message.trim()
      ? p.message
      : (isErr ? "Backup failed" : isDone ? "Backup complete" : isPaused ? "Paused" : "Backup running…");

  return (
    <div style={{minWidth:compact?160:260}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:6}}>
            <div style={{fontSize:11,color:isErr?C.red:isPaused?"#f59e0b":C.textMuted,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{label}</div>
            <div style={{fontSize:11,fontFamily:"JetBrains Mono,monospace",color:C.textMuted,flexShrink:0}}>{isErr?"—":`${Math.round(pct)}%`}</div>
          </div>
          <div style={{height:8,background:"rgba(255,255,255,.06)",border:`1px solid ${C.border2}`,borderRadius:999,overflow:"hidden",marginTop:4}}>
            <div style={{height:"100%",width:isErr?"100%":`${pct}%`,background:isErr?"rgba(239,68,68,.55)":isPaused?"rgba(245,158,11,.6)":`linear-gradient(90deg,${C.blueDim},${C.accent})`,transition:"width .25s ease"}} />
          </div>
        </div>
        {!compact && clientId && (isRunning || isPaused) && (
          <div style={{display:"flex",gap:4,flexShrink:0}}>
            <button title={isPaused?"Resume":"Pause"} onClick={onPause}
              style={{padding:"3px 8px",borderRadius:6,border:`1px solid ${isPaused?"#f59e0b40":C.border2}`,background:isPaused?"rgba(245,158,11,.12)":"rgba(255,255,255,.04)",color:C.text,cursor:"pointer",fontSize:12,display:"flex",alignItems:"center",gap:4,fontFamily:"inherit"}}>
              {isPaused?<IconSet.Play/>:<IconSet.Pause/>}
            </button>
            <button title="Stop" onClick={onStop}
              style={{padding:"3px 8px",borderRadius:6,border:`1px solid ${C.redDim}50`,background:"rgba(239,68,68,.08)",color:C.text,cursor:"pointer",fontSize:12,display:"flex",alignItems:"center",gap:4,fontFamily:"inherit"}}>
              <IconSet.Stop/>
            </button>
          </div>
        )}
      </div>
      {!compact && p?.detail?.stage==="download" && (
        <div style={{marginTop:6,fontSize:10,color:C.textMuted,fontFamily:"JetBrains Mono,monospace",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
          {typeof p.detail.doneFiles==="number"&&typeof p.detail.totalFiles==="number"?`${p.detail.doneFiles}/${p.detail.totalFiles} files`:""}
          {typeof p.detail.doneBytes==="number"&&typeof p.detail.totalBytes==="number"&&p.detail.totalBytes>0?` • ${fmtSz(p.detail.doneBytes)} / ${fmtSz(p.detail.totalBytes)}`:""}
        </div>
      )}
    </div>
  );
};

const Tag = ({ children, color="accent" }) => {
  const map = {
    accent: [C.accentGlow, C.blueDim],
    red:    ["rgba(239,68,68,.12)", C.redDim],
    green:  ["rgba(16,185,129,.12)", "#34d399"],
    gold:   ["rgba(251,191,36,.12)", "#fbbf24"],
    blue:   ["rgba(96,165,250,.12)", "#60a5fa"],
    purple: ["rgba(167,139,250,.12)","#a78bfa"],
    gray:   ["rgba(255,255,255,.06)","#94a3b8"],
  };
  const [bg,fg] = map[color]||map.gray;
  return (
    <span style={{background:bg,color:C.text,border:`1px solid ${fg}30`,fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:20,whiteSpace:"nowrap",letterSpacing:"0.04em",textTransform:"uppercase"}}>
      {children}
    </span>
  );
};

const Field = ({ label, children }) => (
  <div style={{marginBottom:16}}>
    <label style={{display:"block",fontSize:10,fontWeight:700,color:C.text,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:6}}>{label}</label>
    {children}
  </div>
);

const Spinner = () => (
  <span style={{width:14,height:14,borderRadius:"50%",border:`2px solid ${C.border2}`,borderTopColor:C.text,display:"inline-block"}} />
);

const Input = (p) => (
  <input {...p} style={{width:"100%",background:"rgba(0,0,0,.4)",border:`1px solid ${C.border2}`,color:C.text,borderRadius:8,padding:"10px 14px",fontSize:13,outline:"none",boxSizing:"border-box",fontFamily:"inherit",transition:"border-color .2s,box-shadow .2s",...p.style}}
    onFocus={e=>{ e.target.style.borderColor=C.accent; e.target.style.boxShadow=`0 0 0 3px ${C.accentGlow}`; }}
    onBlur={e=>{ e.target.style.borderColor=C.border2; e.target.style.boxShadow="none"; }} />
);

const SelectInput = ({ children, ...p }) => (
  <select {...p} style={{width:"100%",background:"rgba(0,0,0,.4)",border:`1px solid ${C.border2}`,color:C.text,borderRadius:8,padding:"10px 14px",fontSize:13,outline:"none",boxSizing:"border-box",fontFamily:"inherit"}}>
    {children}
  </select>
);

const Btn = ({ children, onClick, variant="ghost", small, disabled, loading, style={} }) => {
  const variants = {
    primary: { background:`linear-gradient(135deg,${C.accent},${C.accentHover})`, color:"#fff", border:"none", boxShadow:`0 4px 15px ${C.accentGlow}` },
    success: { background:"linear-gradient(135deg,#10b981,#059669)", color:"#fff", border:"none", boxShadow:"0 4px 15px rgba(16,185,129,.25)" },
    danger:  { background:"transparent", color:C.text, border:`1px solid ${C.redDim}50` },
    ghost:   { background:"rgba(255,255,255,.04)", color:C.text, border:`1px solid ${C.border2}` },
    amber:   { background:"linear-gradient(135deg,#d97706,#b45309)", color:"#fff", border:"none" },
  };
  const v = variants[variant]||variants.ghost;
  return (
    <button onClick={onClick} disabled={disabled||loading}
      style={{...v,padding:small?"5px 14px":"9px 20px",borderRadius:8,fontSize:small?11:13,fontWeight:700,cursor:disabled?"not-allowed":"pointer",opacity:disabled||loading?.7:1,display:"inline-flex",alignItems:"center",gap:6,whiteSpace:"nowrap",flexShrink:0,transition:"opacity .15s,transform .1s,box-shadow .2s",fontFamily:"inherit",...style}}
      onMouseEnter={e=>{ if(!disabled&&!loading){ e.currentTarget.style.opacity="0.9"; e.currentTarget.style.transform="translateY(-1px)"; }}}
      onMouseLeave={e=>{ e.currentTarget.style.opacity="1"; e.currentTarget.style.transform="none"; }}>
      {loading ? <span style={{display:"flex",animation:"spin 1s linear infinite"}}>{SHOW_ICONS ? <IconSet.Sync/> : <Spinner />}</span> : children}
    </button>
  );
};

const IconBtn = ({ title, onClick, children, danger }) => (
  <button title={title} onClick={onClick}
    style={{width:30,height:30,borderRadius:7,border:`1px solid ${danger?C.redDim+"40":C.border2}`,background:danger?"rgba(239,68,68,.08)":"rgba(255,255,255,.03)",color:C.text,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,transition:"all .15s"}}
    onMouseEnter={e=>{ e.currentTarget.style.borderColor=danger?C.redDim:C.accent; e.currentTarget.style.background=danger?"rgba(239,68,68,.15)":C.accentGlow2; e.currentTarget.style.color=C.text; }}
    onMouseLeave={e=>{ e.currentTarget.style.borderColor=danger?C.redDim+"40":C.border2; e.currentTarget.style.background=danger?"rgba(239,68,68,.08)":"rgba(255,255,255,.03)"; e.currentTarget.style.color=C.text; }}>
    {children}
  </button>
);

// --- Toast ---
const useToast = () => {
  const [toasts, setToasts] = useState([]);
  const show = (msg, type="ok") => {
    const id = Date.now();
    setToasts(t=>[...t,{id,msg,type}]);
    setTimeout(()=>setToasts(t=>t.filter(x=>x.id!==id)),3500);
  };
  return [toasts, show];
};

const ToastStack = ({ toasts }) => (
  <div style={{position:"fixed",top:20,right:20,zIndex:999,display:"flex",flexDirection:"column",gap:8}}>
    {toasts.map(t=>(
      <div key={t.id} style={{padding:"12px 18px",borderRadius:10,fontSize:13,fontWeight:500,backdropFilter:"blur(12px)",animation:"fadeIn .25s ease",
        background:t.type==="ok"?"rgba(16,185,129,.15)":t.type==="err"?"rgba(239,68,68,.15)":C.accentGlow2,
        color:C.text,
        border:`1px solid ${t.type==="ok"?"rgba(52,211,153,.3)":t.type==="err"?"rgba(239,68,68,.3)":C.accentGlow}`,
        boxShadow:"0 8px 32px rgba(0,0,0,.4)", display:"flex", alignItems:"center", gap:SHOW_ICONS?8:0}}>
        {SHOW_ICONS && <span style={{fontSize:16,display:"flex"}}>{t.type==="ok"?<IconSet.Check/>:t.type==="err"?<IconSet.X/>:<IconSet.Info/>}</span>}
        {t.msg}
      </div>
    ))}
  </div>
);

// --- Add Client modal ---
const EMPTY_FORM = {
  name:"",
  domain:"",
  plan:"Basic",
  schedule:"02:00",
  ftp:{ host:"", port:"21", user:"", password:"", remotePath:"/public_html", tls:false },
  db:{ host:"", port:"3306", user:"", password:"", database:"", pmaUrl:"https://zpanel.zergaw.com:2087/pma/" },
};

function AddClientModal({ onClose, onSaved, showToast }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [ftpResult, setFtpResult] = useState(null);
  const [dbResult, setDbResult] = useState(null);
  const [ftpTesting, setFtpTesting] = useState(false);
  const [dbTesting, setDbTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const set = (k,v)=>setForm(f=>({...f,[k]:v}));
  const setFtp = (k,v)=>setForm(f=>({...f,ftp:{...f.ftp,[k]:v}}));
  const setDb = (k,v)=>setForm(f=>({...f,db:{...f.db,[k]:v}}));

  const testFtp = async()=>{
    setFtpTesting(true);setFtpResult(null);
    try{
      const d=await apiJson(`${API}/test-ftp`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(form.ftp)});
      setFtpResult({ ok:Boolean(d.success), message:d.success?`Connected — ${d.files} item(s) in path`:(d.error||"Failed") });
    }catch{setFtpResult({ok:false,message:"Could not reach server"});}
    setFtpTesting(false);
  };

  const testDb = async()=>{
    setDbTesting(true);setDbResult(null);
    try{
      const d=await apiJson(`${API}/test-mysql`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(form.db)});
      setDbResult({ ok:Boolean(d.success), message:d.success?`Connected — databases: ${(d.databases||[]).join(", ")||"none"}`:(d.error||"Failed") });
    }catch{setDbResult({ok:false,message:"Could not reach server"});}
    setDbTesting(false);
  };

  const bothOk = ftpResult?.ok && dbResult?.ok;
  const canSave = Boolean(form.name && form.ftp.host && form.ftp.user && form.ftp.password && form.db.user && form.db.password && form.db.database && form.db.pmaUrl && bothOk);

  const save = async()=>{
    if(!bothOk){ showToast("Test both FTP and DB export first","err"); return; }
    setSaving(true);
    try{
      const d=await apiJson(`${API}/clients`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(form)});
      if(d.success){onSaved(d.client);showToast(`${form.name} added`);onClose();}else showToast(d.error||"Failed","err");
    }catch(e){showToast(e.message||"Server error","err");}
    setSaving(false);
  };

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.8)",backdropFilter:"blur(8px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200,padding:16}}>
      <div style={{background:C.surface,border:`1px solid ${C.border2}`,borderRadius:16,width:680,maxWidth:"100%",maxHeight:"92vh",overflow:"auto",boxShadow:`0 40px 80px rgba(0,0,0,.6),0 0 0 1px ${C.border}`,animation:"fadeIn .2s ease"}}>
        <div style={{padding:"24px 28px 0"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
            <div>
              <div style={{fontSize:18,fontWeight:800,color:C.text}}>Add New Client</div>
              <div style={{fontSize:12,color:C.textDim,marginTop:2}}>Both FTP and DB export are required. Test both before saving.</div>
            </div>
            <button onClick={onClose} style={{width:32,height:32,borderRadius:8,border:`1px solid ${C.border2}`,background:"transparent",color:C.textDim,cursor:"pointer",fontSize:18,display:"flex",alignItems:"center",justifyContent:"center"}}><Icons.X/></button>
          </div>
        </div>

        <div style={{padding:"0 28px 28px"}}>
          {/* Basic info */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 16px"}}>
            <Field label="Client Name *"><Input value={form.name} onChange={e=>set("name",e.target.value)} placeholder="hageraman.com" /></Field>
            <Field label="Domain"><Input value={form.domain} onChange={e=>set("domain",e.target.value)} placeholder="hageraman.com" /></Field>
            <Field label="Daily Backup Time (UTC)"><Input type="time" value={form.schedule} onChange={e=>set("schedule",e.target.value)} /></Field>
            <div/>
          </div>

          {/* FTP */}
          <div style={{height:1,background:C.border,margin:"18px 0"}} />
          <div style={{fontSize:11,fontWeight:700,color:C.textDim,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:12}}>FTP — Web Files *</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:"0 12px"}}>
            <Field label="FTP Host *"><Input value={form.ftp.host} onChange={e=>setFtp("host",e.target.value)} placeholder="196.188.249.61" /></Field>
            <Field label="Port"><Input value={form.ftp.port} onChange={e=>setFtp("port",e.target.value)} placeholder="21" style={{width:70}} /></Field>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 12px"}}>
            <Field label="FTP Username *"><Input value={form.ftp.user} onChange={e=>setFtp("user",e.target.value)} placeholder="ftpuser" /></Field>
            <Field label="FTP Password *"><Input type="password" value={form.ftp.password} onChange={e=>setFtp("password",e.target.value)} placeholder="********" /></Field>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:"0 12px",alignItems:"end"}}>
            <Field label="Remote Path">
              <Input value={form.ftp.remotePath} onChange={e=>setFtp("remotePath",e.target.value)} placeholder="/public_html" />
            </Field>
            <div style={{paddingBottom:16}}>
              <label style={{display:"inline-flex",alignItems:"center",gap:8,fontSize:12,color:C.textDim,cursor:"pointer"}}>
                <input type="checkbox" checked={Boolean(form.ftp.tls)} onChange={e=>setFtp("tls",e.target.checked)} style={{accentColor:C.accent}} />
                FTPS
              </label>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <Btn onClick={testFtp} loading={ftpTesting} variant="ghost" small disabled={!form.ftp.host||!form.ftp.user||!form.ftp.password}><Icons.Zap/> Test FTP</Btn>
            {ftpResult&&<span style={{fontSize:12,fontWeight:700,color:ftpResult.ok?C.green:C.red}}>{ftpResult.ok?"✓":"✗"} {ftpResult.message}</span>}
          </div>

          {/* MySQL */}
          <div style={{height:1,background:C.border,margin:"18px 0"}} />
          <div style={{fontSize:11,fontWeight:700,color:C.textDim,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:12}}>Database Export (phpMyAdmin) *</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:"0 12px"}}>
            <Field label="MySQL Host (optional)"><Input value={form.db.host} onChange={e=>setDb("host",e.target.value)} placeholder="zpanel.zergaw.com" /></Field>
            <Field label="Port"><Input value={form.db.port} onChange={e=>setDb("port",e.target.value)} placeholder="3306" style={{width:70}} /></Field>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 12px"}}>
            <Field label="MySQL Username *"><Input value={form.db.user} onChange={e=>setDb("user",e.target.value)} placeholder="dbuser" /></Field>
            <Field label="MySQL Password *"><Input type="password" value={form.db.password} onChange={e=>setDb("password",e.target.value)} placeholder="********" /></Field>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 12px"}}>
            <Field label="Database Name *"><Input value={form.db.database} onChange={e=>setDb("database",e.target.value)} placeholder="site_db" /></Field>
            <Field label="phpMyAdmin URL">
              <Input value={form.db.pmaUrl} onChange={e=>setDb("pmaUrl",e.target.value)} placeholder="https://zpanel.zergaw.com:2087/pma/" />
            </Field>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <Btn onClick={testDb} loading={dbTesting} variant="ghost" small disabled={!form.db.user||!form.db.password||!form.db.database||!form.db.pmaUrl}><Icons.Zap/> Test Export</Btn>
            {dbResult&&<span style={{fontSize:12,fontWeight:700,color:dbResult.ok?C.green:C.red}}>{dbResult.ok?"✓":"✗"} {dbResult.message}</span>}
          </div>

          {!bothOk && (form.ftp.host||form.db.user||form.db.pmaUrl) && (
            <div style={{marginTop:14,padding:"10px 14px",borderRadius:10,background:"rgba(239,68,68,.08)",border:"1px solid rgba(239,68,68,.25)",fontSize:12,color:C.red}}>
              Both FTP and DB export checks must succeed before you can save.
            </div>
          )}

          <div style={{display:"flex",justifyContent:"space-between",marginTop:20}}>
            <Btn onClick={onClose} variant="ghost">Cancel</Btn>
            <Btn onClick={save} variant="success" loading={saving} disabled={!canSave}>Save Client</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

function EditClientModal({ client, onClose, onSaved, showToast }) {
  const [form, setForm] = useState(()=>({
    name: client?.name || "",
    domain: client?.domain || "",
    plan: client?.plan || "Basic",
    schedule: client?.schedule || "02:00",
    ftp: {
      host: client?.ftp?.host || "",
      port: client?.ftp?.port || "21",
      user: client?.ftp?.user || "",
      password: client?.ftp?.password ? "****" : "",
      remotePath: client?.ftp?.remotePath || "/public_html",
      tls: Boolean(client?.ftp?.tls),
    },
    db: {
      host: client?.db?.host || "",
      port: client?.db?.port || "3306",
      user: client?.db?.user || "",
      password: client?.db?.password ? "****" : "",
      database: client?.db?.database || "",
      pmaUrl: client?.db?.pmaUrl || "https://zpanel.zergaw.com:2087/pma/",
    },
    webArchive: {
      enabled: Boolean(client?.webArchive?.enabled),
      webRoot: client?.webArchive?.webRoot || "public_html",
      ssh: {
        host: client?.webArchive?.ssh?.host || client?.ftp?.host || "",
        port: String(client?.webArchive?.ssh?.port || "22"),
        user: client?.webArchive?.ssh?.user || String(client?.ftp?.user || "").split("@")[0] || "",
        password: client?.webArchive?.ssh?.password ? "****" : "",
      },
    },
  }));

  const [ftpResult, setFtpResult] = useState(null);
  const [dbResult, setDbResult] = useState(null);
  const [webResult, setWebResult] = useState(null);
  const [ftpTesting, setFtpTesting] = useState(false);
  const [dbTesting, setDbTesting] = useState(false);
  const [webTesting, setWebTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  const set = (k,v)=>setForm(f=>({...f,[k]:v}));
  const setFtp = (k,v)=>setForm(f=>({...f,ftp:{...f.ftp,[k]:v}}));
  const setDb = (k,v)=>setForm(f=>({...f,db:{...f.db,[k]:v}}));
  const setWeb = (k,v)=>setForm(f=>({...f,webArchive:{...f.webArchive,[k]:v}}));
  const setSsh = (k,v)=>setForm(f=>({...f,webArchive:{...f.webArchive,ssh:{...f.webArchive.ssh,[k]:v}}}));

  const orig = client || {};
  const dirtyConn =
    (form.ftp.host !== (orig.ftp?.host||"")) ||
    (String(form.ftp.port||"") !== String(orig.ftp?.port||"21")) ||
    (form.ftp.user !== (orig.ftp?.user||"")) ||
    (String(form.ftp.remotePath||"") !== String(orig.ftp?.remotePath||"/public_html")) ||
    (Boolean(form.ftp.tls) !== Boolean(orig.ftp?.tls)) ||
    (form.ftp.password !== "****") ||
    (String(form.db.host||"") !== String(orig.db?.host||"")) ||
    (String(form.db.port||"") !== String(orig.db?.port||"3306")) ||
    (String(form.db.user||"") !== String(orig.db?.user||"")) ||
    (String(form.db.database||"") !== String(orig.db?.database||"")) ||
    (String(form.db.pmaUrl||"") !== String(orig.db?.pmaUrl||"")) ||
    (form.db.password !== "****") ||
    (Boolean(form.webArchive.enabled) !== Boolean(orig.webArchive?.enabled)) ||
    (String(form.webArchive.webRoot||"") !== String(orig.webArchive?.webRoot||"")) ||
    (String(form.webArchive.ssh?.host||"") !== String(orig.webArchive?.ssh?.host||orig.ftp?.host||"")) ||
    (String(form.webArchive.ssh?.port||"") !== String(orig.webArchive?.ssh?.port||"22")) ||
    (String(form.webArchive.ssh?.user||"") !== String(orig.webArchive?.ssh?.user||String(orig.ftp?.user||"").split("@")[0]||"")) ||
    (form.webArchive.ssh?.password !== "****");

  const bothOk = ftpResult?.ok && dbResult?.ok && (!form.webArchive.enabled || webResult?.ok);
  const canSaveBase = Boolean(form.name && form.ftp.host && form.ftp.user && form.db.user && form.db.database && form.db.pmaUrl);
  const canSave = canSaveBase && (!dirtyConn || bothOk);

  const testFtp = async()=>{
    if(form.ftp.password==="****"){ showToast("Enter FTP password to test","err"); return; }
    setFtpTesting(true);setFtpResult(null);
    try{
      const d=await apiJson(`${API}/test-ftp`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(form.ftp)});
      setFtpResult({ ok:Boolean(d.success), message:d.success?`Connected — ${d.files} item(s) in path`:(d.error||"Failed") });
    }catch{setFtpResult({ok:false,message:"Could not reach server"});}
    setFtpTesting(false);
  };

  const testDb = async()=>{
    if(form.db.password==="****"){ showToast("Enter DB password to test export","err"); return; }
    setDbTesting(true);setDbResult(null);
    try{
      const d=await apiJson(`${API}/test-mysql`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(form.db)});
      setDbResult({ ok:Boolean(d.success), message:d.success?`Export OK — ${form.db.database}`:(d.error||"Failed") });
    }catch{setDbResult({ok:false,message:"Could not reach server"});}
    setDbTesting(false);
  };

  const testWeb = async()=>{
    if(!form.webArchive.enabled){ showToast("Enable SSH archive first","err"); return; }
    if(!form.webArchive.ssh.host||!form.webArchive.ssh.user) { showToast("SSH host + user required","err"); return; }
    if(form.webArchive.ssh.password==="****"){ showToast("Enter SSH password to test","err"); return; }
    setWebTesting(true);setWebResult(null);
    try{
      const d=await apiJson(`${API}/test-web-archive`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ssh:form.webArchive.ssh, webRoot:form.webArchive.webRoot})});
      setWebResult({ ok:Boolean(d.success), message:d.success?`OK — ${fmtSz(d.size||0)}`:(d.error||"Failed") });
    }catch{setWebResult({ok:false,message:"Could not reach server"});}
    setWebTesting(false);
  };

  const save = async()=>{
    if(dirtyConn && !bothOk){ showToast(form.webArchive.enabled ? "Test FTP + DB export + SSH archive first (or revert connection changes)" : "Test both FTP and DB export first (or revert connection changes)","err"); return; }
    setSaving(true);
    try{
      const payload = {
        name: form.name,
        domain: form.domain,
        plan: form.plan,
        schedule: form.schedule,
        ftp: form.ftp,
        db: form.db,
        webArchive: form.webArchive,
      };
      const r = await apiFetch(`${API}/clients/${client.id}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      const d = await r.json().catch(()=>({}));
      if(r.status===401) throw new Error("unauthorized");
      if(!r.ok) throw new Error(d?.error||"Failed");
      showToast("Client updated");
      onSaved?.();
      onClose();
    }catch(e){
      showToast(e.message||"Failed","err");
    }finally{
      setSaving(false);
    }
  };

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.8)",backdropFilter:"blur(8px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200,padding:16}}>
      <div style={{background:C.surface,border:`1px solid ${C.border2}`,borderRadius:16,width:680,maxWidth:"100%",maxHeight:"92vh",overflow:"auto",boxShadow:`0 40px 80px rgba(0,0,0,.6),0 0 0 1px ${C.border}`,animation:"fadeIn .2s ease"}}>
        <div style={{padding:"24px 28px 0"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
            <div>
              <div style={{fontSize:18,fontWeight:800,color:C.text}}>Edit Client</div>
              <div style={{fontSize:12,color:C.textDim,marginTop:2}}>{dirtyConn ? "Connection changed — test FTP + export before saving." : "Edit anything (schedule, plan, host, etc)."} </div>
            </div>
            <button onClick={onClose} style={{width:32,height:32,borderRadius:8,border:`1px solid ${C.border2}`,background:"transparent",color:C.textDim,cursor:"pointer",fontSize:18,display:"flex",alignItems:"center",justifyContent:"center"}}><Icons.X/></button>
          </div>
        </div>

        <div style={{padding:"0 28px 28px"}}>
          {/* Basic info */}
          <div style={{fontSize:11,fontWeight:700,color:C.textDim,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:12}}>Client Details</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 12px"}}>
            <Field label="Client Name *"><Input value={form.name} onChange={e=>set("name",e.target.value)} placeholder="Client name" /></Field>
            <Field label="Domain"><Input value={form.domain} onChange={e=>set("domain",e.target.value)} placeholder="example.com" /></Field>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 12px"}}>
            <Field label="Plan"><Input value={form.plan} onChange={e=>set("plan",e.target.value)} placeholder="Basic" /></Field>
            <Field label="Daily Backup Time (UTC)"><Input type="time" value={form.schedule} onChange={e=>set("schedule",e.target.value)} /></Field>
          </div>

          {/* FTP */}
          <div style={{height:1,background:C.border,margin:"18px 0"}} />
          <div style={{fontSize:11,fontWeight:700,color:C.textDim,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:12}}>FTP — Web Files *</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:"0 12px"}}>
            <Field label="Host *"><Input value={form.ftp.host} onChange={e=>setFtp("host",e.target.value)} placeholder="zpanel.zergaw.com" /></Field>
            <Field label="Port"><Input value={form.ftp.port} onChange={e=>setFtp("port",e.target.value)} placeholder="21" style={{width:70}} /></Field>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 12px"}}>
            <Field label="Username *"><Input value={form.ftp.user} onChange={e=>setFtp("user",e.target.value)} placeholder="ftpuser" /></Field>
            <Field label="Password *"><Input type="password" value={form.ftp.password} onFocus={()=>{ if(form.ftp.password==="****") setFtp("password",""); }} onChange={e=>setFtp("password",e.target.value)} placeholder="********" /></Field>
          </div>
          <Field label="Remote Path">
            <Input value={form.ftp.remotePath} onChange={e=>setFtp("remotePath",e.target.value)} placeholder="/public_html" />
          </Field>
          <div style={{paddingBottom:16}}>
            <label style={{display:"inline-flex",alignItems:"center",gap:8,fontSize:12,color:C.textDim,cursor:"pointer"}}>
              <input type="checkbox" checked={Boolean(form.ftp.tls)} onChange={e=>setFtp("tls",e.target.checked)} style={{accentColor:C.accent}} />
              FTPS
            </label>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <Btn onClick={testFtp} loading={ftpTesting} variant="ghost" small disabled={!form.ftp.host||!form.ftp.user||!form.ftp.password}><Icons.Zap/> Test FTP</Btn>
            {ftpResult&&<span style={{fontSize:12,fontWeight:700,color:ftpResult.ok?C.green:C.red}}>{ftpResult.ok?"✓":"✗"} {ftpResult.message}</span>}
          </div>

          {/* Web archive via SSH (optional) */}
          <div style={{height:1,background:C.border,margin:"18px 0"}} />
          <div style={{fontSize:11,fontWeight:700,color:C.textDim,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:12}}>Fast Web Backup (SSH Archive)</div>
          <div style={{padding:"10px 12px",borderRadius:10,background:"rgba(14,165,233,.06)",border:`1px solid ${C.border2}`,marginBottom:12,fontSize:12,color:C.textDim,lineHeight:1.5}}>
            Creates a single <span style={{fontFamily:"JetBrains Mono,monospace"}}>.tar.gz</span> on the CWP server, downloads it via FTP, then deletes it.
          </div>
          <label style={{display:"inline-flex",alignItems:"center",gap:8,fontSize:12,color:C.textDim,cursor:"pointer",marginBottom:10}}>
            <input type="checkbox" checked={Boolean(form.webArchive.enabled)} onChange={e=>{ setWeb("enabled",e.target.checked); setWebResult(null); }} style={{accentColor:C.accent}} />
            Enable SSH archive mode
          </label>

          {form.webArchive.enabled && (
            <>
              <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:"0 12px"}}>
                <Field label="SSH Host *"><Input value={form.webArchive.ssh.host} onChange={e=>setSsh("host",e.target.value)} placeholder={form.ftp.host||"server host"} /></Field>
                <Field label="SSH Port"><Input value={form.webArchive.ssh.port} onChange={e=>setSsh("port",e.target.value)} placeholder="22" style={{width:70}} /></Field>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 12px"}}>
                <Field label="SSH Username *"><Input value={form.webArchive.ssh.user} onChange={e=>setSsh("user",e.target.value)} placeholder="account user or root" /></Field>
                <Field label="SSH Password *"><Input type="password" value={form.webArchive.ssh.password} onFocus={()=>{ if(form.webArchive.ssh.password==="****") setSsh("password",""); }} onChange={e=>setSsh("password",e.target.value)} placeholder="********" /></Field>
              </div>
              <Field label="Web Root Folder"><Input value={form.webArchive.webRoot} onChange={e=>setWeb("webRoot",e.target.value)} placeholder="public_html" /></Field>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <Btn onClick={testWeb} loading={webTesting} variant="ghost" small disabled={!form.webArchive.ssh.host||!form.webArchive.ssh.user||!form.webArchive.ssh.password}><Icons.Zap/> Test SSH Archive</Btn>
                {webResult&&<span style={{fontSize:12,fontWeight:700,color:webResult.ok?C.green:C.red}}>{webResult.ok?"✓":"✗"} {webResult.message}</span>}
              </div>
            </>
          )}

          {/* DB */}
          <div style={{height:1,background:C.border,margin:"18px 0"}} />
          <div style={{fontSize:11,fontWeight:700,color:C.textDim,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:12}}>Database Export (phpMyAdmin) *</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:"0 12px"}}>
            <Field label="MySQL Host (optional)"><Input value={form.db.host} onChange={e=>setDb("host",e.target.value)} placeholder="zpanel.zergaw.com" /></Field>
            <Field label="Port"><Input value={form.db.port} onChange={e=>setDb("port",e.target.value)} placeholder="3306" style={{width:70}} /></Field>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 12px"}}>
            <Field label="MySQL Username *"><Input value={form.db.user} onChange={e=>setDb("user",e.target.value)} placeholder="dbuser" /></Field>
            <Field label="MySQL Password *"><Input type="password" value={form.db.password} onFocus={()=>{ if(form.db.password==="****") setDb("password",""); }} onChange={e=>setDb("password",e.target.value)} placeholder="********" /></Field>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 12px"}}>
            <Field label="Database Name *"><Input value={form.db.database} onChange={e=>setDb("database",e.target.value)} placeholder="site_db" /></Field>
            <Field label="phpMyAdmin URL *">
              <Input value={form.db.pmaUrl} onChange={e=>setDb("pmaUrl",e.target.value)} placeholder="https://zpanel.zergaw.com:2087/pma/" />
            </Field>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <Btn onClick={testDb} loading={dbTesting} variant="ghost" small disabled={!form.db.user||!form.db.password||!form.db.database||!form.db.pmaUrl}><Icons.Zap/> Test Export</Btn>
            {dbResult&&<span style={{fontSize:12,fontWeight:700,color:dbResult.ok?C.green:C.red}}>{dbResult.ok?"✓":"✗"} {dbResult.message}</span>}
          </div>

          <div style={{display:"flex",justifyContent:"space-between",marginTop:20}}>
            <Btn onClick={onClose} variant="ghost">Cancel</Btn>
            <Btn onClick={save} variant="success" loading={saving} disabled={!canSave}>Save Changes</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Schedule modal ---
function SchedModal({ client, onClose, onSaved, showToast }) {
  const [sched, setSched] = useState(client.schedule||"02:00");
  const [saving, setSaving] = useState(false);
  const save = async()=>{ setSaving(true); await apiFetch(`${API}/clients/${client.id}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({schedule:sched})}); onSaved(sched);showToast("Schedule updated");onClose();setSaving(false); };
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.8)",backdropFilter:"blur(8px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200}}>
      <div style={{background:C.surface,border:`1px solid ${C.border2}`,borderRadius:14,padding:28,width:340,boxShadow:"0 40px 80px rgba(0,0,0,.6)",animation:"fadeIn .2s ease"}}>
        <div style={{fontSize:16,fontWeight:700,color:C.text,marginBottom:4}}>Edit Schedule</div>
        <div style={{fontSize:12,color:C.textDim,marginBottom:20}}>{client.name}</div>
        <Field label="Daily Backup Time (UTC)"><Input type="time" value={sched} onChange={e=>setSched(e.target.value)} /></Field>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:4}}>
          <Btn onClick={onClose} variant="ghost" small>Cancel</Btn>
          <Btn onClick={save} variant="primary" small loading={saving}>Save</Btn>
        </div>
      </div>
    </div>
  );
}

// --- Login page ---
function LoginPage({ onLoggedIn }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const signIn = async(e)=>{ e?.preventDefault?.(); setError(""); setLoading(true);
    try { const r=await apiFetch(`${API}/auth/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username,password})});
      const d=await r.json().catch(()=>({})); if(!r.ok)throw new Error(d.error||"Login failed"); onLoggedIn?.(d.user||{username});
    } catch(err){ setError(err.message||"Login failed"); } finally{ setLoading(false); } };

  return (
    <div style={{minHeight:"100vh",background:`radial-gradient(ellipse 80% 60% at 50% -10%,rgba(14,165,233,.25),transparent),radial-gradient(ellipse 60% 50% at 80% 80%,rgba(2,132,199,.15),transparent),${C.bg}`,display:"flex",alignItems:"center",justifyContent:"center",padding:24,fontFamily:"Inter,sans-serif"}}>
      <style>{GLOBAL_CSS}</style>

      <div style={{width:"min(420px,100%)",background:C.surface,border:`1px solid ${C.border2}`,borderRadius:20,padding:32,boxShadow:`0 40px 80px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.04)`}}>
          <div style={{display:"flex",justifyContent:"center",marginBottom:24}}>
            <div style={{width:48,height:48,borderRadius:14,background:`linear-gradient(135deg,${C.accent},#0369a1)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,color:"#fff",fontWeight:900,letterSpacing:"0.08em",boxShadow:`0 8px 24px ${C.accentGlow}`}}>
              CWP
            </div>
          </div>
          <div style={{textAlign:"center",marginBottom:28}}>
            <div style={{fontSize:18,fontWeight:900,color:C.text,letterSpacing:"-0.02em"}}>Sign in</div>
          </div>

          <form onSubmit={signIn}>
            <Field label="Username"><Input autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)} placeholder="admin" /></Field>
            <Field label="Password"><Input autoComplete="current-password" type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Enter password..." /></Field>

            {error&&(
              <div style={{marginBottom:16,padding:"11px 14px",borderRadius:10,border:`1px solid rgba(239,68,68,.3)`,background:"rgba(239,68,68,.08)",color:C.text,fontSize:13,display:"flex",alignItems:"center"}}>
                {error}
              </div>
            )}

            <Btn variant="primary" loading={loading} disabled={!username||!password} style={{width:"100%",justifyContent:"center",padding:"12px 20px",fontSize:14}}>
                Continue
              </Btn>
          </form>
      </div>
    </div>
  );
}

// --- Stat card ---
const StatCard = ({ label, value, color, icon, sub }) => (
  <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:"18px 20px",position:"relative",overflow:"hidden"}}>
    <div style={{position:"absolute",top:-20,right:-20,width:80,height:80,borderRadius:"50%",background:`radial-gradient(circle,${color}15,transparent 70%)`}} />
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
      <div style={{fontSize:11,fontWeight:600,color:C.textDim,letterSpacing:"0.06em",textTransform:"uppercase"}}>{label}</div>
      <span style={{fontSize:20,color:C.text,display:"flex"}}>{icon}</span>
    </div>
    <div style={{fontSize:28,fontWeight:900,color:C.text,fontFamily:"JetBrains Mono,monospace",letterSpacing:"-0.02em",lineHeight:1}}>{value}</div>
    {sub&&<div style={{fontSize:11,color:C.textMuted,marginTop:6}}>{sub}</div>}
  </div>
);

// --- Sidebar ---
function Sidebar({ page, setPage, clients, selected, setSelected, setTab, search, setSearch, setShowAdd, user, signOut }) {
  const nav = [
    { id:"home",      icon:<Icons.Home/>,      label:"Home" },
    { id:"dashboard", icon:<Icons.Dashboard/>, label:"Dashboard" },
    { id:"backups",   icon:<Icons.Save/>,      label:"All Backups" },
    { id:"activity",  icon:<Icons.Activity/>,  label:"Activity Log" },
    { id:"user",      icon:<Icons.User/>,      label:"User Settings" },
  ];
  const filtered = clients.filter(c=>c.name?.toLowerCase().includes(search.toLowerCase())||c.domain?.toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={{background:C.surface,borderRight:`1px solid ${C.border}`,display:"flex",flexDirection:"column",position:"sticky",top:0,height:"100vh",overflow:"hidden"}}>
      {/* Logo */}
      <div style={{padding:"20px 16px 16px",borderBottom:`1px solid ${C.border}`}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:20}}>
          <div style={{width:34,height:34,borderRadius:10,background:`linear-gradient(135deg,${C.accent},#0369a1)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:900,letterSpacing:"0.08em",color:"#fff",boxShadow:`0 4px 12px ${C.accentGlow}`,flexShrink:0}}>
            CWP
          </div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:13,fontWeight:800,color:C.text,letterSpacing:"-0.01em"}}>CWP Backup</div>
            <div style={{fontSize:10,color:C.textMuted}}></div>
          </div>
        </div>

        {/* Nav items */}
        <div style={{display:"flex",flexDirection:"column",gap:2}}>
          {nav.map(n=>{
            const active = page===n.id;
            return (
              <button key={n.id} onClick={()=>{ setPage(n.id); setSelected(null); }}
                style={{display:"flex",alignItems:"center",gap:9,padding:"9px 12px",borderRadius:9,border:`1px solid ${active?C.border2:"transparent"}`,cursor:"pointer",background:active?C.redGlow2:"transparent",color:active?C.pinkDim:C.textMuted,fontSize:13,fontWeight:active?700:500,textAlign:"left",width:"100%",transition:"all .15s",fontFamily:"inherit"}}>
                <span style={{fontSize:16,display:"flex"}}>{n.icon}</span>
                <span style={{flex:1}}>{n.label}</span>
                {active&&<span style={{width:4,height:4,borderRadius:"50%",background:C.accent,flexShrink:0}} />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Search */}
      <div style={{padding:"12px 16px",borderBottom:`1px solid ${C.border}`}}>
        <div style={{position:"relative"}}>
          {SHOW_ICONS && <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",fontSize:14,color:C.textMuted,display:"flex"}}><IconSet.Search/></span>}
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search clients..."
            style={{width:"100%",background:"rgba(0,0,0,.4)",border:`1px solid ${C.border}`,color:C.text,borderRadius:8,padding:SHOW_ICONS?"8px 10px 8px 30px":"8px 10px",fontSize:12,outline:"none",boxSizing:"border-box",fontFamily:"inherit"}}
            onFocus={e=>e.target.style.borderColor=C.accent} onBlur={e=>e.target.style.borderColor=C.border} />
        </div>
      </div>

      {/* Client list */}
      <div style={{flex:1,overflowY:"auto",padding:"10px 10px"}}>
        <div style={{fontSize:9,fontWeight:700,color:C.textMuted,letterSpacing:"0.1em",textTransform:"uppercase",padding:"2px 8px 8px"}}>Clients ({clients.length})</div>

        {/* Overview row */}
        <div onClick={()=>{ setPage("dashboard"); setSelected(null); }}
          style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",borderRadius:9,cursor:"pointer",marginBottom:2,
            background:page==="dashboard"&&!selected?C.accentGlow2:"transparent",
            border:`1px solid ${page==="dashboard"&&!selected?C.border2:"transparent"}`,transition:"all .15s"}}>
          {SHOW_ICONS && <div style={{width:28,height:28,borderRadius:8,background:C.accentGlow,border:`1px solid ${C.border2}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,color:C.accentLight,flexShrink:0}}><IconSet.Globe/></div>}
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:12,fontWeight:600,color:C.textMid}}>Overview</div>
            <div style={{fontSize:10,color:C.textMuted}}>{clients.length} clients total</div>
          </div>
        </div>

        {filtered.map((c,i)=>(
          <div key={c.id} onClick={()=>{ setPage("dashboard"); setSelected(c); setTab("backups"); }}
            style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",borderRadius:9,cursor:"pointer",marginBottom:2,
              background:selected?.id===c.id?C.accentGlow2:"transparent",
              border:`1px solid ${selected?.id===c.id?C.border2:"transparent"}`,transition:"all .15s"}}
            onMouseEnter={e=>{ if(selected?.id!==c.id){ e.currentTarget.style.background="rgba(255,255,255,.02)"; e.currentTarget.style.borderColor=C.border; }}}
            onMouseLeave={e=>{ if(selected?.id!==c.id){ e.currentTarget.style.background="transparent"; e.currentTarget.style.borderColor="transparent"; }}}>
            <Avatar name={c.name} i={i} size={28} />
            <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:12,fontWeight:600,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.name}</div>
              <div style={{fontSize:10,color:C.textMuted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.domain}</div>
            </div>
            <Dot s={c.status} />
          </div>
        ))}

        {filtered.length===0&&search&&(
          <div style={{padding:"16px 8px",textAlign:"center",color:C.textMuted,fontSize:12}}>No clients match "{search}"</div>
        )}
      </div>

      {/* Footer */}
      <div style={{padding:"12px 14px 16px",borderTop:`1px solid ${C.border}`}}>
        <button onClick={()=>setShowAdd(true)}
          style={{width:"100%",padding:"10px 0",background:`linear-gradient(135deg,${C.accent},${C.accentHover})`,color:"#fff",border:"none",borderRadius:9,fontSize:13,fontWeight:700,cursor:"pointer",marginBottom:12,fontFamily:"inherit",boxShadow:`0 4px 12px ${C.accentGlow}`,transition:"opacity .15s"}}
          onMouseEnter={e=>e.currentTarget.style.opacity=".9"} onMouseLeave={e=>e.currentTarget.style.opacity="1"}>
          + Add Client
        </button>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{display:"flex",alignItems:"center",gap:7}}>
            {SHOW_ICONS && <div style={{width:24,height:24,borderRadius:6,background:C.accentGlow,border:`1px solid ${C.border2}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,color:C.accentLight}}><IconSet.User/></div>}
            <span style={{fontSize:12,color:C.textDim,fontWeight:500}}>{user?.username||"admin"}</span>
          </div>
          <button onClick={signOut} style={{fontSize:11,color:C.textMuted,background:"none",border:"none",cursor:"pointer",fontFamily:"inherit",padding:"3px 8px",borderRadius:5,transition:"color .15s"}}
            onMouseEnter={e=>e.currentTarget.style.color=C.text} onMouseLeave={e=>e.currentTarget.style.color=C.textMuted}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Page header ---
const PageHeader = ({ title, sub, children }) => (
  <div style={{padding:"20px 28px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:12,background:`linear-gradient(180deg,rgba(14,165,233,.04),transparent)`}}>
    <div>
      <div style={{fontSize:18,fontWeight:800,color:C.text,letterSpacing:"-0.02em"}}>{title}</div>
      {sub&&<div style={{fontSize:12,color:C.textDim,marginTop:2}}>{sub}</div>}
    </div>
    {children&&<div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>{children}</div>}
  </div>
);

// --- Home page ---
function HomePage({ user, clients, stats, system, log, setPage, runBackup, pauseBackup, stopBackup, runningIds, progressById }) {
  const totalBackups = clients.reduce((a,c)=>a+(c.backups?.length||0),0);
  const logColors = { info:C.text, warn:C.text, error:C.text };

  return (
    <>
      <PageHeader title={`Welcome back, ${user?.username||"admin"}`} sub="">
        <Btn variant="primary" small onClick={()=>setPage("dashboard")}>Open Dashboard</Btn>
      </PageHeader>

      <div style={{padding:"20px 28px",borderBottom:`1px solid ${C.border}`}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14}}>
          <StatCard label="Total Clients"   value={stats?.total??"-"}                                icon={<Icons.Building/>} color={C.blueDim} sub={`${stats?.healthy??0} healthy`} />
          <StatCard label="Total Backups"   value={totalBackups}                                      icon={<Icons.Save/>} color="#a78bfa" sub="across all clients" />
          <StatCard label="Data Stored"     value={system?.store?fmtSz(system.store.backupsBytes):"-"} icon={<Icons.Database/>} color={C.green}   sub={`${system?.store?.backupsFiles??0} files`} />
          <StatCard label="Server Uptime"   value={system?.uptimeSeconds?fmtUptime(system.uptimeSeconds):"-"} icon={<Icons.Clock/>} color={C.gold}  sub="continuous" />
        </div>
      </div>

      <div style={{padding:"24px 28px",display:"grid",gridTemplateColumns:"1fr 320px",gap:20,alignItems:"start"}}>
        {/* Left */}
        <div style={{display:"flex",flexDirection:"column",gap:16}}>

          {/* Client status */}
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,overflow:"hidden"}}>
            <div style={{padding:"16px 20px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontSize:14,fontWeight:700,color:C.text}}>Client Status</div>
                <Btn small variant="ghost" onClick={()=>setPage("dashboard")}>View all</Btn>
              </div>
            <div style={{padding:"8px 12px"}}>
              {clients.length===0
                ? <div style={{textAlign:"center",padding:"28px 0",color:C.textMuted,fontSize:13}}>No clients yet. Add your first client.</div>
                : clients.slice(0,6).map((c,i)=>(
                    <div key={c.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 8px",borderRadius:9,marginBottom:2,cursor:"pointer",transition:"background .15s"}}
                      onMouseEnter={e=>e.currentTarget.style.background=C.accentGlow2} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                      <Avatar name={c.name} i={i} size={32} />
                       <div style={{flex:1,minWidth:0}}>
                         <div style={{fontSize:13,fontWeight:600,color:C.textMid}}>{c.name}</div>
                         <div style={{fontSize:11,color:C.textMuted}}>{c.domain}</div>
                         {(progressById?.[c.id]?.status==="running") && (
                           <div style={{marginTop:6}}><BackupProgress p={progressById[c.id]} clientId={c.id} onPause={()=>pauseBackup(c.id)} onStop={()=>stopBackup(c.id,c.name)} /></div>
                         )}
                       </div>
                      <div style={{fontSize:11,color:C.textMuted}}>{ago(c.lastBackup)}</div>
                      <div style={{display:"flex",alignItems:"center",gap:5}}><Dot s={c.status}/><span style={{fontSize:11,color:C.textDim}}>{c.status==="ok"?"Healthy":c.status==="warn"?"Warning":"Error"}</span></div>
                      <IconBtn title="Backup" onClick={()=>runBackup(c.id,c.name)}>{runningIds.has(c.id)?<span style={{display:"flex",animation:"spin 1s linear infinite"}}><Icons.Sync/></span>:<Icons.Play/>}</IconBtn>
                    </div>
                  ))
              }
            </div>
          </div>

          {/* Recent activity */}
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,overflow:"hidden"}}>
            <div style={{padding:"16px 20px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontSize:14,fontWeight:700,color:C.text}}>Recent Activity</div>
                <Btn small variant="ghost" onClick={()=>setPage("activity")}>View all</Btn>
              </div>
            <div style={{padding:"8px 20px 12px"}}>
              {log.length===0
                ? <div style={{padding:"20px 0",color:C.textMuted,fontSize:13}}>No activity yet.</div>
                : log.slice(0,6).map(e=>(
                    <div key={e.id} style={{display:"flex",gap:10,padding:"8px 0",borderBottom:`1px solid ${C.border}`,alignItems:"flex-start"}}>
                      <div style={{width:44,flexShrink:0,fontSize:10,fontFamily:"JetBrains Mono,monospace",color:C.textMuted,paddingTop:2}}>{new Date(e.ts).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</div>
                      <div style={{width:7,height:7,borderRadius:"50%",background:logColors[e.level]||C.textMuted,marginTop:5,flexShrink:0}} />
                      <div style={{fontSize:12,color:logColors[e.level]||C.textMid,flex:1,lineHeight:1.5}}>{e.message}</div>
                    </div>
                  ))
              }
            </div>
          </div>
        </div>

        {/* Right */}
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          {/* Quick actions */}
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:18}}>
            <div style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:14,display:"flex",alignItems:"center",gap:6}}><Icons.Zap/> Quick Actions</div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              <Btn variant="success" onClick={()=>{ clients.forEach(c=>runBackup(c.id,c.name)); }} disabled={clients.length===0} style={{justifyContent:"center",width:"100%"}}><Icons.Play/> Backup All Clients</Btn>
              <Btn variant="primary" onClick={()=>setPage("dashboard")} style={{justifyContent:"center",width:"100%"}}><Icons.Dashboard/> Open Dashboard</Btn>
              <Btn variant="ghost" onClick={()=>setPage("backups")} style={{justifyContent:"center",width:"100%"}}><Icons.Save/> View All Backups</Btn>
              <Btn variant="ghost" onClick={()=>setPage("activity")} style={{justifyContent:"center",width:"100%"}}><Icons.Activity/> Activity Log</Btn>
            </div>
          </div>

          {/* Data store */}
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:18}}>
            <div style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:14,display:"flex",alignItems:"center",gap:6}}><Icons.Database/> Data Store</div>
            {[["Backup Files",system?.store?system.store.backupsFiles:"-",C.blueDim],["Total Size",system?.store?fmtSz(system.store.backupsBytes):"-",C.green],["Config Data",system?.store?fmtSz(system.store.dataFileBytes):"-","#a78bfa"]].map(([l,v,c])=>(
              <div key={l} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 12px",borderRadius:8,background:"rgba(0,0,0,.3)",marginBottom:6}}>
                <span style={{fontSize:12,color:C.textDim}}>{l}</span>
                <span style={{fontSize:13,fontWeight:700,color:c,fontFamily:"JetBrains Mono,monospace"}}>{v}</span>
              </div>
            ))}
          </div>

          {/* System info */}
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:18}}>
            <div style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:14,display:"flex",alignItems:"center",gap:6}}><Icons.Settings/> System</div>
            {[["Node.js",system?.node||"-"],["Server time",system?.now?new Date(system.now).toLocaleTimeString():"-"],["Uptime",system?.uptimeSeconds?fmtUptime(system.uptimeSeconds):"-"],["Healthy",`${stats?.healthy??0} / ${stats?.total??0}`]].map(([k,v])=>(
              <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderBottom:`1px solid ${C.border}`,fontSize:12}}>
                <span style={{color:C.textDim}}>{k}</span>
                <span style={{color:C.textMid,fontFamily:"JetBrains Mono,monospace",fontSize:11}}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

// --- Dashboard ---
function DashboardPage({ clients, stats, runBackup, pauseBackup, stopBackup, runningIds, progressById, setSelected, setTab, showToast, setShowAdd }) {
  return (
    <>
      <PageHeader title="Dashboard" sub="All clients and backup status">
        <Btn variant="success" small onClick={()=>{ clients.forEach(c=>runBackup(c.id,c.name)); showToast(`Backup started for all ${clients.length} clients`); }} disabled={clients.length===0}><Icons.Play/> Backup All Now</Btn>
        <Btn variant="primary" small onClick={()=>setShowAdd(true)}><Icons.Building/> Add Client</Btn>
      </PageHeader>

      <div style={{padding:"20px 28px",borderBottom:`1px solid ${C.border}`}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14}}>
          <StatCard label="Total Clients" value={stats?.total??"-"} icon={<Icons.Building/>} color={C.blueDim} />
          <StatCard label="Healthy"       value={stats?.healthy??"-"} icon={<Icons.Check/>} color={C.green} />
          <StatCard label="Warnings"      value={stats?.warning??"-"} icon={<Icons.Alert/>} color={C.gold} />
          <StatCard label="Errors"        value={stats?.error??"-"}   icon={<Icons.X/>} color={C.redDim} />
        </div>
      </div>

      <div style={{padding:"20px 28px"}}>
        {clients.length===0
          ? <div style={{textAlign:"center",padding:"80px 0",color:C.textMuted}}>
              <div style={{fontSize:48,marginBottom:14,color:C.accentLight,display:"flex",justifyContent:"center"}}><Icons.Building/></div>
              <div style={{fontSize:18,fontWeight:700,color:C.textDim,marginBottom:8}}>No clients yet</div>
              <div style={{fontSize:13,marginBottom:20}}>Add your first CWP client to start managing backups.</div>
              <Btn variant="primary" onClick={()=>setShowAdd(true)}>+ Add First Client</Btn>
            </div>
          : <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,overflow:"hidden"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                <thead>
                  <tr style={{background:"rgba(0,0,0,.3)"}}>
                    {["Client","Domain","Plan","Last Backup","Schedule","Status",""].map(h=>(
                      <th key={h} style={{textAlign:"left",fontSize:10,fontWeight:700,color:C.textMuted,padding:"12px 16px",borderBottom:`1px solid ${C.border}`,letterSpacing:"0.08em",textTransform:"uppercase"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {clients.map((c,i)=>(
                    <tr key={c.id} style={{cursor:"pointer",borderBottom:`1px solid ${C.border}`,transition:"background .15s"}}
                      onClick={()=>{ setSelected(c); setTab("backups"); }}
                      onMouseEnter={e=>e.currentTarget.style.background=C.accentGlow2}
                      onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                      <td style={{padding:"14px 16px"}}><div style={{display:"flex",alignItems:"center",gap:10}}><Avatar name={c.name} i={i} size={30}/><span style={{fontWeight:600,color:C.textMid}}>{c.name}</span></div></td>
                      <td style={{padding:"14px 16px",color:C.textDim,fontSize:12}}>{c.domain}</td>
                      <td style={{padding:"14px 16px"}}><Tag color="accent">{c.plan}</Tag></td>
                      <td style={{padding:"14px 16px",fontSize:12,color:C.textDim}}>{ago(c.lastBackup)}</td>
                      <td style={{padding:"14px 16px",fontSize:12,color:C.textMid,fontFamily:"JetBrains Mono,monospace"}}>{c.schedule} UTC</td>
                      <td style={{padding:"14px 16px"}}>
                        <div style={{display:"flex",flexDirection:"column",gap:6}}>
                          <div style={{display:"flex",alignItems:"center",gap:6}}><Dot s={c.status}/><span style={{fontSize:12,color:C.textDim}}>{c.status==="ok"?"Healthy":c.status==="warn"?"Warning":"Error"}</span></div>
                          {(progressById?.[c.id]?.status==="running") && (
                            <BackupProgress p={progressById[c.id]} clientId={c.id}
                              onPause={()=>pauseBackup(c.id)}
                              onStop={()=>stopBackup(c.id,c.name)} />
                          )}
                        </div>
                      </td>
                      <td style={{padding:"14px 16px"}} onClick={e=>e.stopPropagation()}>
                        {!runningIds.has(c.id) && <IconBtn title="Run backup" onClick={()=>runBackup(c.id,c.name)}><Icons.Play/></IconBtn>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
        }
      </div>
    </>
  );
}

// --- Client detail ---
function ClientDetailPage({ selected, clients, tab, setTab, backups, filter, setFilter, runBackup, pauseBackup, stopBackup, runningIds, progressById, deleteClient, deleteBackup, showToast, setShowSched, setShowEditClient, reload }) {
  const progress = progressById?.[selected?.id];
  // Only show manual backups (scheduled ones are not stored)
  const manualBackups = backups.filter(b=>b.source==="manual"||b.source==="combined"||!b.source||b.source==="ftp");
  const shownBackups =
    filter==="all" ? manualBackups
    : filter==="web" ? manualBackups.filter(b=>b.type==="zip"||b.type==="tar")
    : manualBackups.filter(b=>b.type===filter);
  const badgeColor = { tar:"blue", sql:"purple", cwp:"green", zip:"amber" };
  const [backupEdit, setBackupEdit] = useState(() => ({
    cwpNative: selected?.backup?.cwpNative !== false,
    webZip: selected?.backup?.webZip === true,
    dbZip: selected?.backup?.dbZip === true,
  }));
  const [savingBackup, setSavingBackup] = useState(false);

  useEffect(() => {
    setBackupEdit({
      cwpNative: selected?.backup?.cwpNative !== false,
      webZip: selected?.backup?.webZip === true,
      dbZip: selected?.backup?.dbZip === true,
    });
  }, [selected?.id]);

  return (
    <>
      <div style={{padding:"16px 28px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:12,background:`linear-gradient(180deg,rgba(14,165,233,.04),transparent)`}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <Avatar name={selected.name} i={clients.indexOf(selected)} size={40} />
          <div>
            <div style={{fontSize:17,fontWeight:800,color:C.text,letterSpacing:"-0.01em"}}>{selected.name}</div>
            <div style={{fontSize:12,color:C.textDim,marginTop:1}}>{selected.domain} - {selected.cwp?.host}</div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:6,marginLeft:4}}><Dot s={selected.status}/><span style={{fontSize:12,color:C.textDim}}>{selected.status==="ok"?"Healthy":selected.status==="warn"?"Warning":"Error"}</span></div>
        </div>
        <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
          <Btn variant="success" small loading={runningIds.has(selected.id)} onClick={()=>runBackup(selected.id,selected.name)}><Icons.Play/> Backup Now</Btn>
          <Btn variant="ghost" small onClick={()=>setShowSched(true)}><Icons.Clock/> {selected.schedule} UTC</Btn>
          <Btn variant="danger" small onClick={()=>deleteClient(selected.id)}><Icons.X/> Remove</Btn>
        </div>
      </div>

      <div style={{padding:"16px 28px",borderBottom:`1px solid ${C.border}`}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14}}>
          <StatCard label="Backups"    value={manualBackups.length}                                          icon={<Icons.Save/>} color={C.blueDim} />
          <StatCard label="Web Files"  value={manualBackups.filter(b=>b.type==="tar"||b.type==="zip").length} icon={<Icons.Globe/>} color="#a78bfa" />
          <StatCard label="DB Dumps"   value={manualBackups.filter(b=>b.type==="sql").length}                 icon={<Icons.Database/>} color="#f472b6" />
          <StatCard label="Last Run"   value={ago(selected.lastBackup)}                                 icon={<Icons.Clock/>} color={C.green} />
        </div>
      </div>

      {progress?.status==="running" && (
        <div style={{padding:"14px 28px",borderBottom:`1px solid ${C.border}`}}>
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:"14px 16px"}}>
            <div style={{fontSize:12,fontWeight:800,color:C.textMid,marginBottom:8}}>Backup Progress</div>
            <BackupProgress p={progress} clientId={selected.id}
              onPause={()=>pauseBackup(selected.id)}
              onStop={()=>stopBackup(selected.id,selected.name)} />
          </div>
        </div>
      )}

      <div style={{padding:"20px 28px"}}>
        {/* Tabs */}
        <div style={{display:"flex",gap:0,marginBottom:20,borderBottom:`1px solid ${C.border}`}}>
          {[["backups","Backup Files"],["log","Activity Log"],["settings","Settings"]].map(([t,l])=>(
            <button key={t} onClick={()=>setTab(t)}
              style={{padding:"10px 20px",border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:700,background:"transparent",
                color:C.text,borderBottom:`2px solid ${tab===t?C.accent:"transparent"}`,transition:"all .15s",marginBottom:-1}}>
              {l}
            </button>
          ))}
        </div>

        {tab==="backups"&&(
          <>
            <div style={{display:"flex",gap:6,marginBottom:16,flexWrap:"wrap"}}>
              {[["all","All"],["zip","ZIP"],["tar","TAR"],["sql","Database"]].map(([v,l])=>(
                <button key={v} onClick={()=>setFilter(v)}
                  style={{padding:"6px 14px",borderRadius:7,fontSize:11,fontWeight:700,border:`1px solid ${filter===v?C.accent:C.border2}`,
                    background:filter===v?C.accentGlow:"transparent",color:C.text,cursor:"pointer",transition:"all .15s",fontFamily:"inherit"}}>
                  {l}
                </button>
              ))}
            </div>
            {shownBackups.length===0
              ? <div style={{textAlign:"center",padding:"60px 0",color:C.textMuted}}>
                  {SHOW_ICONS && <div style={{fontSize:40,marginBottom:12,color:C.textMuted,display:"flex",justifyContent:"center"}}><IconSet.Save/></div>}
                  <div style={{fontSize:15,fontWeight:600,color:C.textDim,marginBottom:6}}>No backup files yet</div>
                  <div style={{fontSize:13}}>Run a backup to get started.</div>
                </div>
              : <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,overflow:"hidden"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                    <thead><tr style={{background:"rgba(0,0,0,.3)"}}>
                      {["Filename","Type","Size","Date","Source","Actions"].map(h=>(
                        <th key={h} style={{textAlign:"left",fontSize:10,fontWeight:700,color:C.textMuted,padding:"12px 16px",borderBottom:`1px solid ${C.border}`,letterSpacing:"0.08em",textTransform:"uppercase"}}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>{shownBackups.map(b=>(
                      <tr key={b.id} style={{borderBottom:`1px solid ${C.border}`,transition:"background .15s"}}
                        onMouseEnter={e=>e.currentTarget.style.background=C.accentGlow2} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                        <td style={{padding:"12px 16px",fontSize:11,fontFamily:"JetBrains Mono,monospace",color:C.textMid,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:200}}>{b.name}</td>
                        <td style={{padding:"12px 16px"}}><Tag color={badgeColor[b.type]||"gray"}>{b.type?.toUpperCase()}</Tag></td>
                        <td style={{padding:"12px 16px",fontSize:12,color:C.textDim}}>{b.size?fmtSz(b.size):"-"}</td>
                        <td style={{padding:"12px 16px",fontSize:11,color:C.textDim}}>{fmtDate(b.date)}</td>
                        <td style={{padding:"12px 16px"}}><Tag color="blue">{b.source||"ftp"}</Tag></td>
                        <td style={{padding:"12px 16px"}}>
                          <div style={{display:"flex",gap:5}}>
                            {b.localPath&&<a href={`${API}/clients/${selected.id}/backups/${b.id}/download`} download style={{textDecoration:"none"}}><IconBtn title="Download"><Icons.Download/></IconBtn></a>}
                            <IconBtn title="Restore" onClick={()=>showToast(`Restore: ${b.name}`,"info")}><Icons.Restore/></IconBtn>
                            <IconBtn title="Verify" onClick={()=>showToast(`Verifying...`,"info")}><Icons.Check/></IconBtn>
                            <IconBtn title="Delete" danger onClick={()=>deleteBackup(b.id)}><Icons.Trash/></IconBtn>
                          </div>
                        </td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
            }
          </>
        )}

        {tab==="settings"&&(
          <div style={{maxWidth:500}}>
            <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,overflow:"hidden"}}>
              <div style={{padding:"14px 20px",borderBottom:`1px solid ${C.border}`,fontSize:13,fontWeight:700,color:C.textMid}}>FTP Connection</div>
              <div style={{padding:"8px 20px 16px"}}>
                {[
                  ["Host", selected.ftp?.host],
                  ["Port", selected.ftp?.port || "21"],
                  ["Username", selected.ftp?.user],
                  ["Remote Path", selected.ftp?.remotePath || "/public_html"],
                  ["Password", selected.ftp?.password ? "Configured" : "Not set"],
                  ["FTPS (TLS)", selected.ftp?.tls ? "Yes" : "No"],
                ].map(([k,v])=>(
                  <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"10px 0",borderBottom:`1px solid ${C.border}`,fontSize:13}}>
                    <span style={{color:C.textDim}}>{k}</span>
                    <span style={{color:C.textMid,fontFamily:"JetBrains Mono,monospace",fontSize:12}}>{v||"-"}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{marginTop:14,background:C.card,border:`1px solid ${C.border}`,borderRadius:14,overflow:"hidden"}}>
              <div style={{padding:"14px 20px",borderBottom:`1px solid ${C.border}`,fontSize:13,fontWeight:700,color:C.textMid,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <span>MySQL Dump</span>
                {selected.db?.pmaUrl && (
                  <a href={selected.db.pmaUrl} target="_blank" rel="noreferrer"
                    style={{fontSize:11,color:C.accent,textDecoration:"none",fontWeight:600,display:"inline-flex",alignItems:"center",gap:4}}>
                    <Icons.Globe style={{width:"0.85em",height:"0.85em"}}/> Open phpMyAdmin
                  </a>
                )}
              </div>
              <div style={{padding:"8px 20px 16px"}}>
                {[
                  ["Host", selected.db?.host],
                  ["Port", selected.db?.port || "3306"],
                  ["Username", selected.db?.user],
                  ["Database", selected.db?.database],
                  ["Password", selected.db?.password ? "Configured" : "Not set"],
                  ["phpMyAdmin", selected.db?.pmaUrl || "-"],
                ].map(([k,v])=>(
                  <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"10px 0",borderBottom:`1px solid ${C.border}`,fontSize:13}}>
                    <span style={{color:C.textDim}}>{k}</span>
                    {k==="phpMyAdmin" && selected.db?.pmaUrl
                      ? <a href={selected.db.pmaUrl} target="_blank" rel="noreferrer" style={{color:C.accent,fontSize:12,fontFamily:"JetBrains Mono,monospace"}}>{selected.db.pmaUrl}</a>
                      : <span style={{color:C.textMid,fontFamily:"JetBrains Mono,monospace",fontSize:12}}>{v||"-"}</span>
                    }
                  </div>
                ))}
              </div>
            </div>

            <div style={{marginTop:14,display:"flex",gap:8,flexWrap:"wrap"}}>
              <Btn variant="primary" small onClick={()=>setShowEditClient(true)}>Edit Client</Btn>
              <Btn variant="ghost" small onClick={()=>setShowSched(true)}>Edit Schedule</Btn>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// --- All backups page ---
function BackupsPage({ clients, runBackup, runningIds, showToast }) {
  const [typeFilter, setTypeFilter] = useState("all");
  const [clientFilter, setClientFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [runningAll, setRunningAll] = useState(false);
  const badgeColor = { tar:"blue", sql:"purple", cwp:"green", zip:"amber" };

  // Only show manual backups — scheduled backups are not stored
  const allBackups = clients.flatMap(c=>(c.backups||[])
    .filter(b=>b.source==="manual"||b.source==="combined"||!b.source||b.source==="ftp")
    .map(b=>({...b,clientName:c.name,clientId:c.id,clientDomain:c.domain})));
  const filtered = allBackups
    .filter(b=>
      typeFilter==="all" ? true
      : typeFilter==="web" ? (b.type==="tar"||b.type==="zip")
      : b.type===typeFilter
    )
    .filter(b=>clientFilter==="all"||b.clientId===clientFilter)
    .filter(b=>!search||b.name?.toLowerCase().includes(search.toLowerCase())||b.clientName?.toLowerCase().includes(search.toLowerCase()));

  const backupAll = ()=>{ setRunningAll(true); clients.forEach(c=>runBackup(c.id,c.name)); showToast(`Backup started for all ${clients.length} clients`); setTimeout(()=>setRunningAll(false),3000); };

  return (
    <>
      <PageHeader title="All Backups" sub={`${filtered.length} records - ${fmtSz(filtered.reduce((a,b)=>a+(b.size||0),0))} total`}>
        <Btn variant="success" small loading={runningAll} disabled={clients.length===0} onClick={backupAll}><Icons.Play/> Backup All Clients</Btn>
      </PageHeader>

      <div style={{padding:"14px 28px",borderBottom:`1px solid ${C.border}`,display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search filename or client..."
          style={{background:"rgba(0,0,0,.4)",border:`1px solid ${C.border2}`,color:C.text,borderRadius:8,padding:"8px 14px",fontSize:12,outline:"none",width:220,fontFamily:"inherit"}}
          onFocus={e=>e.target.style.borderColor=C.accent} onBlur={e=>e.target.style.borderColor=C.border2} />
        <select value={clientFilter} onChange={e=>setClientFilter(e.target.value)}
          style={{background:"rgba(0,0,0,.4)",border:`1px solid ${C.border2}`,color:C.text,borderRadius:8,padding:"8px 12px",fontSize:12,outline:"none",fontFamily:"inherit"}}>
          <option value="all">All clients</option>
          {clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div style={{display:"flex",gap:4}}>
          {[["all","All"],["zip","ZIP"],["tar","TAR"],["sql","Database"]].map(([v,l])=>(
            <button key={v} onClick={()=>setTypeFilter(v)}
            style={{padding:"7px 14px",borderRadius:7,fontSize:11,fontWeight:700,border:`1px solid ${typeFilter===v?C.accent:C.border2}`,background:typeFilter===v?C.accentGlow:"transparent",color:C.text,cursor:"pointer",transition:"all .15s",fontFamily:"inherit"}}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <div style={{padding:"16px 28px",borderBottom:`1px solid ${C.border}`}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14}}>
          <StatCard label="Total Backups" value={allBackups.length}                                          icon={<Icons.Save/>} color={C.blueDim} />
          <StatCard label="Web Files"     value={allBackups.filter(b=>b.type==="tar"||b.type==="zip").length} icon={<Icons.Globe/>} color="#a78bfa" />
          <StatCard label="DB Dumps"      value={allBackups.filter(b=>b.type==="sql").length}                 icon={<Icons.Database/>} color="#f472b6" />
          <StatCard label="Total Stored"  value={fmtSz(allBackups.reduce((a,b)=>a+(b.size||0),0))}           icon={<Icons.Box/>} color={C.green} />
        </div>
      </div>

      <div style={{padding:"20px 28px"}}>
        {filtered.length===0
          ? <div style={{textAlign:"center",padding:"80px 0",color:C.textMuted}}>
              <div style={{fontSize:48,marginBottom:14,color:C.textMuted,display:"flex",justifyContent:"center"}}><Icons.Save/></div>
              <div style={{fontSize:18,fontWeight:700,color:C.textDim,marginBottom:8}}>No backups found</div>
              <div style={{fontSize:13}}>Run backups from the dashboard or click Backup All above.</div>
            </div>
          : <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,overflow:"hidden"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                <thead><tr style={{background:"rgba(0,0,0,.3)"}}>
                  {["Client","Filename","Type","Size","Date","Source","Actions"].map(h=>(
                    <th key={h} style={{textAlign:"left",fontSize:10,fontWeight:700,color:C.textMuted,padding:"12px 16px",borderBottom:`1px solid ${C.border}`,letterSpacing:"0.08em",textTransform:"uppercase"}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>{filtered.map(b=>(
                  <tr key={b.id+b.clientId} style={{borderBottom:`1px solid ${C.border}`,transition:"background .15s"}}
                    onMouseEnter={e=>e.currentTarget.style.background=C.accentGlow2} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <td style={{padding:"12px 16px"}}>
                      <div style={{fontSize:12,fontWeight:600,color:C.textMid}}>{b.clientName}</div>
                      <div style={{fontSize:10,color:C.textMuted}}>{b.clientDomain}</div>
                    </td>
                    <td style={{padding:"12px 16px",fontSize:11,fontFamily:"JetBrains Mono,monospace",color:C.textMid,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:180}}>{b.name}</td>
                    <td style={{padding:"12px 16px"}}><Tag color={badgeColor[b.type]||"gray"}>{b.type?.toUpperCase()}</Tag></td>
                    <td style={{padding:"12px 16px",fontSize:12,color:C.textDim}}>{b.size?fmtSz(b.size):"-"}</td>
                    <td style={{padding:"12px 16px",fontSize:11,color:C.textDim}}>{fmtDate(b.date)}</td>
                    <td style={{padding:"12px 16px"}}><Tag color="blue">{b.source||"ftp"}</Tag></td>
                    <td style={{padding:"12px 16px"}}>
                      <div style={{display:"flex",gap:5}}>
                        {b.localPath&&<a href={`${API}/clients/${b.clientId}/backups/${b.id}/download`} download style={{textDecoration:"none"}}><IconBtn title="Download"><Icons.Download/></IconBtn></a>}
                        <IconBtn title="Restore" onClick={()=>showToast(`Restore: ${b.name}`,"info")}><Icons.Restore/></IconBtn>
                        <IconBtn title="Verify" onClick={()=>showToast("Verifying...","info")}><Icons.Check/></IconBtn>
                      </div>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
        }
      </div>
    </>
  );
}

// --- Activity log page ---
function ActivityPage({ log, clients }) {
  const [levelFilter, setLevelFilter] = useState("all");
  const [clientFilter, setClientFilter] = useState("all");
  const [search, setSearch] = useState("");
  const levelColor = { info:C.text, warn:C.text, error:C.text };
  const levelBg = { info:C.accentGlow, warn:"rgba(251,191,36,.1)", error:"rgba(239,68,68,.1)" };

  const filtered = log
    .filter(e=>levelFilter==="all"||e.level===levelFilter)
    .filter(e=>clientFilter==="all"||e.clientId===clientFilter)
    .filter(e=>!search||e.message?.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <PageHeader title="Activity Log" sub={`${filtered.length} events`} />

      <div style={{padding:"14px 28px",borderBottom:`1px solid ${C.border}`,display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search messages..."
          style={{background:"rgba(0,0,0,.4)",border:`1px solid ${C.border2}`,color:C.text,borderRadius:8,padding:"8px 14px",fontSize:12,outline:"none",width:240,fontFamily:"inherit"}}
          onFocus={e=>e.target.style.borderColor=C.accent} onBlur={e=>e.target.style.borderColor=C.border2} />
        <select value={clientFilter} onChange={e=>setClientFilter(e.target.value)}
          style={{background:"rgba(0,0,0,.4)",border:`1px solid ${C.border2}`,color:C.text,borderRadius:8,padding:"8px 12px",fontSize:12,outline:"none",fontFamily:"inherit"}}>
          <option value="all">All clients</option>
          {clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div style={{display:"flex",gap:4}}>
          {[["all","All"],["info","Info"],["warn","Warn"],["error","Error"]].map(([v,l])=>(
            <button key={v} onClick={()=>setLevelFilter(v)}
            style={{padding:"7px 14px",borderRadius:7,fontSize:11,fontWeight:700,border:`1px solid ${levelFilter===v?C.accent:C.border2}`,background:levelFilter===v?C.accentGlow:"transparent",color:C.text,cursor:"pointer",transition:"all .15s",fontFamily:"inherit"}}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <div style={{padding:"20px 28px"}}>
        {filtered.length===0
          ? <div style={{textAlign:"center",padding:"80px 0",color:C.textMuted}}>
              <div style={{fontSize:48,marginBottom:14,color:C.textMuted,display:"flex",justifyContent:"center"}}><Icons.Activity/></div>
              <div style={{fontSize:18,fontWeight:700,color:C.textDim}}>No events found</div>
            </div>
          : <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,overflow:"hidden"}}>
              {filtered.map((e,idx)=>{
                const client = clients.find(c=>c.id===e.clientId);
                return (
                  <div key={e.id} style={{display:"flex",gap:12,padding:"13px 20px",borderBottom:idx<filtered.length-1?`1px solid ${C.border}`:"none",alignItems:"flex-start",transition:"background .15s"}}
                    onMouseEnter={ev=>ev.currentTarget.style.background=C.accentGlow2} onMouseLeave={ev=>ev.currentTarget.style.background="transparent"}>
                    <div style={{width:54,flexShrink:0,fontSize:10,fontFamily:"JetBrains Mono,monospace",color:C.textMuted,paddingTop:2}}>{new Date(e.ts).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"})}</div>
                    <span style={{display:"inline-block",padding:"2px 8px",borderRadius:5,fontSize:10,fontWeight:700,background:levelBg[e.level]||"transparent",color:levelColor[e.level]||C.textMid,flexShrink:0}}>{(e.level||"info").toUpperCase()}</span>
                    {client&&<span style={{fontSize:11,color:C.textDim,flexShrink:0,paddingTop:2,fontWeight:500}}>{client.name}</span>}
                    <div style={{fontSize:13,color:levelColor[e.level]||C.textMid,flex:1,lineHeight:1.5}}>{e.message}</div>
                    <div style={{fontSize:10,color:C.textMuted,flexShrink:0,paddingTop:2}}>{new Date(e.ts).toLocaleDateString("en-GB",{day:"2-digit",month:"short"})}</div>
                  </div>
                );
              })}
            </div>
        }
      </div>
    </>
  );
}

// --- User settings page ---
function UserSettingsPage({ signOut, showToast }) {
  const [loading, setLoading] = useState(true);
  const [envOverrides, setEnvOverrides] = useState(false);
  const [username, setUsername] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await apiJson(`${API}/auth/settings`);
        if (!alive) return;
        setEnvOverrides(Boolean(d?.envOverridesAuth));
        setUsername(String(d?.user?.username || "admin"));
      } catch (e) {
        if (e.message === "unauthorized") signOut();
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [signOut]);

  const save = async () => {
    if (envOverrides) return;
    if (!currentPassword) return showToast("Current password required", "err");
    if (newPassword && newPassword.length < 6) return showToast("New password must be at least 6 characters", "err");
    if (newPassword !== confirm) return showToast("New password confirmation does not match", "err");

    setSaving(true);
    try {
      const r = await apiFetch(`${API}/auth/change`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword,
          newUsername: username,
          newPassword: newPassword || "",
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.status === 401) return signOut();
      if (!r.ok) throw new Error(d?.error || "Failed to save");
      showToast("Updated. Please sign in again.");
      signOut();
    } catch (e) {
      showToast(e.message || "Failed to save", "err");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader title="User Settings" sub="" />
      <div style={{padding:"20px 28px",maxWidth:560}}>
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,overflow:"hidden"}}>
          <div style={{padding:"14px 20px",borderBottom:`1px solid ${C.border}`,fontSize:13,fontWeight:700,color:C.textMid}}>Account</div>
          <div style={{padding:"16px 20px"}}>
            {loading ? (
              <div style={{color:C.textDim,fontSize:13}}>Loading...</div>
            ) : envOverrides ? (
              <div style={{color:C.textDim,fontSize:13,lineHeight:1.6}}>
                Username/password are controlled by server environment variables. Disable that to edit from the UI.
              </div>
            ) : (
              <>
                <Field label="Username"><Input value={username} onChange={e=>setUsername(e.target.value)} /></Field>
                <Field label="Current Password"><Input type="password" value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} /></Field>
                <Field label="New Password"><Input type="password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} placeholder="Leave blank to keep current" /></Field>
                <Field label="Confirm New Password"><Input type="password" value={confirm} onChange={e=>setConfirm(e.target.value)} placeholder="Repeat new password" /></Field>
                <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                  <Btn variant="ghost" small onClick={()=>{ setCurrentPassword(""); setNewPassword(""); setConfirm(""); showToast("Cleared"); }}>Clear</Btn>
                  <Btn variant="success" small loading={saving} onClick={save}>Save</Btn>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// --- Main app ---
export default function App() {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [page, setPage] = useState("home");
  const [system, setSystem] = useState(null);
  const [clients, setClients] = useState([]);
  const [stats, setStats] = useState(null);
  const [log, setLog] = useState([]);
  const [selected, setSelected] = useState(null);
  const [backups, setBackups] = useState([]);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showSched, setShowSched] = useState(false);
  const [showEditClient, setShowEditClient] = useState(false);
  const [tab, setTab] = useState("backups");
  const [runningIds, setRunningIds] = useState(new Set());
  const [progressById, setProgressById] = useState({});
  const [toasts, showToast] = useToast();

  const signOut = useCallback(async()=>{ try{await apiFetch(`${API}/auth/logout`,{method:"POST"});}catch{} setUser(null);setPage("home");setSelected(null); },[]);

  useEffect(()=>{
    let alive=true;
    apiFetch(`${API}/auth/me`).then(async r=>{ if(!alive||!r.ok)return; const d=await r.json().catch(()=>null); if(d?.user){setUser(d.user);setPage("home");} }).catch(()=>{}).finally(()=>{ if(alive)setAuthChecked(true); });
    return()=>{alive=false;};
  },[]);

  useEffect(()=>{ if(!user)return; let alive=true; apiJson(`${API}/system`).then(d=>{if(alive)setSystem(d);}).catch(e=>{if(e.message==="unauthorized")signOut();}); return()=>{alive=false;}; },[signOut,user]);

  const load = useCallback(async()=>{
    if(!user)return;
    try{
      const[cl,st,lg,pr]=await Promise.all([
        apiJson(`${API}/clients`),
        apiJson(`${API}/stats`),
        apiJson(`${API}/log`),
        apiJson(`${API}/progress`),
      ]);
      setClients(cl);
      setStats(st);
      setLog(lg);
      setProgressById(pr||{});
      if(selected){const fresh=cl.find(c=>c.id===selected.id);if(fresh)setSelected(fresh);}
    } catch(e){if(e.message==="unauthorized")signOut();}
  },[selected?.id,signOut,user]);

  useEffect(()=>{ if(!user)return; load(); const t=setInterval(load,30000); return()=>clearInterval(t); },[load,user]);

  useEffect(() => {
    if (!user) return;
    const es = new EventSource(`${API}/events`);

    const onLog = (ev) => {
      try {
        const entry = JSON.parse(ev.data);
        setLog(prev => [entry, ...prev].slice(0, 200));
        if (
          typeof entry?.message === "string" &&
          (entry.message.includes("Backup complete") || entry.message.includes("Backup completed with warnings"))
        ) {
          load();
        }
      } catch {}
    };

    const onProgress = (ev) => {
      try {
        const p = JSON.parse(ev.data);
        if (!p?.clientId) return;
        setProgressById(prev => ({ ...prev, [p.clientId]: p }));
        if (p.status === "done" || p.status === "error" || p.status === "cancelled") {
          setRunningIds(s => { const n=new Set(s); n.delete(p.clientId); return n; });
          if (p.status === "error" || p.status === "cancelled") {
            // Auto-remove any incomplete backup entries on failure/cancel
            setTimeout(async()=>{
              try {
                const cl=await apiJson(`${API}/clients/${p.clientId}/backups`);
                const incomplete=(cl||[]).filter(b=>b.status!=="ok");
                for(const b of incomplete){
                  await apiFetch(`${API}/clients/${p.clientId}/backups/${b.id}`,{method:"DELETE"}).catch(()=>{});
                }
              } catch {}
              load();
            },500);
          } else {
            load();
          }
        }
      } catch {}
    };

    es.addEventListener("log", onLog);
    es.addEventListener("progress", onProgress);
    es.addEventListener("error", () => {});

    return () => {
      try { es.removeEventListener("log", onLog); } catch {}
      try { es.removeEventListener("progress", onProgress); } catch {}
      es.close();
    };
  }, [load, user]);

  useEffect(()=>{ if(!user||!selected)return; apiJson(`${API}/clients/${selected.id}/backups`).then(setBackups).catch(e=>{if(e.message==="unauthorized")signOut();}); },[selected?.id,signOut,user]);

  const runBackup = async(id,name)=>{
    setRunningIds(s=>new Set([...s,id]));
    const r=await apiFetch(`${API}/clients/${id}/backup`,{method:"POST"});
    if(r.status===401) return signOut();
    showToast(`Backup started for ${name}`);
    setTimeout(load,800);
  };

  const pauseBackup = async(id)=>{
    const r=await apiFetch(`${API}/clients/${id}/backup/pause`,{method:"POST"});
    if(r.status===401) return signOut();
    const d=await r.json().catch(()=>({}));
    showToast(d.paused?"Backup paused":"Backup resumed");
  };

  const stopBackup = async(id,name)=>{
    const r=await apiFetch(`${API}/clients/${id}/backup/stop`,{method:"POST"});
    if(r.status===401) return signOut();
    showToast(`Stopping backup for ${name}`,"err");
    // Remove any incomplete backup entries for this client when stopped
    setTimeout(async()=>{
      const cl=await apiJson(`${API}/clients/${id}/backups`).catch(()=>[]);
      const incomplete=(cl||[]).filter(b=>b.status!=="ok");
      for(const b of incomplete){
        await apiFetch(`${API}/clients/${id}/backups/${b.id}`,{method:"DELETE"}).catch(()=>{});
      }
      load();
    },2000);
  };

  const deleteClient = async(id)=>{ if(!confirm("Remove this client and all records?"))return; const r=await apiFetch(`${API}/clients/${id}`,{method:"DELETE"}); if(r.status===401)return signOut(); if(selected?.id===id)setSelected(null); load();showToast("Client removed"); };

  const deleteBackup = async(bkId)=>{ const r=await apiFetch(`${API}/clients/${selected.id}/backups/${bkId}`,{method:"DELETE"}); if(r.status===401)return signOut(); setBackups(b=>b.filter(x=>x.id!==bkId));showToast("Backup deleted"); };

  if(!authChecked) return (
    <div style={{minHeight:"100vh",background:C.bg,display:"grid",placeItems:"center",fontFamily:"Inter,sans-serif"}}>
      <style>{GLOBAL_CSS}</style>
      <div style={{display:"flex",alignItems:"center",gap:12,color:C.textDim}}>
        <div style={{width:16,height:16,borderRadius:"50%",border:`2px solid ${C.border2}`,borderTopColor:C.accent,animation:"spin 1s linear infinite"}} />
        Loading...
      </div>
    </div>
  );

  if(!user) return <LoginPage onLoggedIn={u=>{setUser(u);setPage("home");}} />;

  return (
    <div style={{display:"grid",gridTemplateColumns:"220px 1fr",minHeight:"100vh",background:C.bg,color:C.text,fontFamily:"Inter,sans-serif"}}>
      <style>{GLOBAL_CSS}</style>
      <ToastStack toasts={toasts} />

      {showAdd&&<AddClientModal onClose={()=>setShowAdd(false)} onSaved={c=>{setClients(cl=>[...cl,c]);load();}} showToast={showToast} />}
      {showSched&&selected&&<SchedModal client={selected} onClose={()=>setShowSched(false)} onSaved={s=>{setSelected(c=>({...c,schedule:s}));load();}} showToast={showToast} />}
      {showEditClient&&selected&&<EditClientModal client={selected} onClose={()=>setShowEditClient(false)} onSaved={load} showToast={showToast} />}

      <Sidebar page={page} setPage={setPage} clients={clients} selected={selected} setSelected={setSelected} setTab={setTab} search={search} setSearch={setSearch} setShowAdd={setShowAdd} user={user} signOut={signOut} />

      <div style={{display:"flex",flexDirection:"column",minHeight:"100vh",overflow:"auto"}}>
        {page==="home"&&<HomePage user={user} clients={clients} stats={stats} system={system} log={log} setPage={setPage} runBackup={runBackup} pauseBackup={pauseBackup} stopBackup={stopBackup} runningIds={runningIds} progressById={progressById} />}
        {page==="dashboard"&&!selected&&<DashboardPage clients={clients} stats={stats} runBackup={runBackup} pauseBackup={pauseBackup} stopBackup={stopBackup} runningIds={runningIds} progressById={progressById} setSelected={setSelected} setTab={setTab} showToast={showToast} setShowAdd={setShowAdd} />}
        {page==="dashboard"&&selected&&<ClientDetailPage selected={selected} clients={clients} tab={tab} setTab={setTab} backups={backups} filter={filter} setFilter={setFilter} runBackup={runBackup} pauseBackup={pauseBackup} stopBackup={stopBackup} runningIds={runningIds} progressById={progressById} deleteClient={deleteClient} deleteBackup={deleteBackup} showToast={showToast} setShowSched={setShowSched} setShowEditClient={setShowEditClient} reload={load} />}
        {page==="backups"&&<BackupsPage clients={clients} runBackup={runBackup} runningIds={runningIds} showToast={showToast} />}
        {page==="activity"&&<ActivityPage log={log} clients={clients} />}
        {page==="user"&&<UserSettingsPage signOut={signOut} showToast={showToast} />}
      </div>
    </div>
  );
}
