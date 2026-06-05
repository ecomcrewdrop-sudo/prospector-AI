import { useEffect, useState, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api } from '../lib/api';

// Fix Leaflet default icon paths for bundlers
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const STAGE_COLORS = {
  new:         '#64748b',
  contacted:   '#3b82f6',
  replied:     '#eab308',
  interested:  '#f97316',
  negotiating: '#a855f7',
  won:         '#22c55e',
  lost:        '#ef4444',
};

const STAGE_LABELS = {
  new: 'Nuevo', contacted: 'Contactado', replied: 'Respondió',
  interested: 'Interesado', negotiating: 'Negociando', won: 'Ganado', lost: 'Perdido',
};

function makeIcon(color) {
  return L.divIcon({
    className: '',
    html: `<div style="
      width: 12px; height: 12px;
      background: ${color};
      border: 2px solid white;
      border-radius: 50%;
      box-shadow: 0 0 6px ${color}88;
    "></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });
}

export default function ProspectMap({ sessionId, onProspectClick }) {
  const [prospects, setProspects]   = useState([]);
  const [filter, setFilter]         = useState({ stage: '', minScore: 0 });
  const [loading, setLoading]       = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.getProspectsMap(sessionId);
    if (res.success) setProspects(res.data);
    setLoading(false);
  }, [sessionId]);

  useEffect(() => { load(); }, [load]);

  const filtered = prospects.filter(p => {
    if (filter.stage && p.stage !== filter.stage) return false;
    if (p.score < filter.minScore) return false;
    return true;
  });

  const center = [4.711, -74.0721]; // Colombia

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96 bg-slate-900 rounded-2xl border border-slate-800">
        <p className="text-slate-500">Cargando mapa...</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Filtros */}
      <div className="flex flex-wrap gap-3 items-center">
        <select
          value={filter.stage}
          onChange={e => setFilter(f => ({ ...f, stage: e.target.value }))}
          className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-primary-500"
        >
          <option value="">Todas las etapas</option>
          {Object.entries(STAGE_LABELS).map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>

        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-400">Score mín:</span>
          <input
            type="range" min={0} max={100} step={10}
            value={filter.minScore}
            onChange={e => setFilter(f => ({ ...f, minScore: parseInt(e.target.value) }))}
            className="w-28"
          />
          <span className="text-sm font-bold text-white w-6">{filter.minScore}</span>
        </div>

        <span className="text-xs text-slate-500 ml-auto">{filtered.length} prospectos en el mapa</span>
      </div>

      {/* Leyenda */}
      <div className="flex flex-wrap gap-3">
        {Object.entries(STAGE_COLORS).map(([stage, color]) => (
          <div key={stage} className="flex items-center gap-1.5">
            <div style={{ background: color, boxShadow: `0 0 6px ${color}88` }} className="w-2.5 h-2.5 rounded-full" />
            <span className="text-xs text-slate-400">{STAGE_LABELS[stage]}</span>
          </div>
        ))}
      </div>

      {/* Mapa */}
      <div className="rounded-2xl overflow-hidden border border-slate-800" style={{ height: '500px' }}>
        {prospects.length === 0 ? (
          <div className="flex items-center justify-center h-full bg-slate-900">
            <div className="text-center text-slate-500">
              <p className="text-lg font-bold mb-1">Sin datos de ubicación</p>
              <p className="text-sm">Los prospectos nuevos de Google Maps incluirán coordenadas automáticamente</p>
            </div>
          </div>
        ) : (
          <MapContainer center={center} zoom={6} style={{ height: '100%', width: '100%' }}>
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            />
            <MarkerClusterGroup chunkedLoading>
              {filtered.map(p => (
                <Marker
                  key={p.id}
                  position={[p.lat, p.lon]}
                  icon={makeIcon(STAGE_COLORS[p.stage] || STAGE_COLORS.new)}
                >
                  <Popup>
                    <div className="min-w-[160px]">
                      <p className="font-bold text-sm">{p.name}</p>
                      <p className="text-xs text-gray-600">{p.niche}</p>
                      <p className="text-xs mt-1">Score: <strong>{p.score}</strong></p>
                      <p className="text-xs">Etapa: <strong>{STAGE_LABELS[p.stage]}</strong></p>
                      {p.phone && <p className="text-xs">{p.phone}</p>}
                      {onProspectClick && (
                        <button
                          onClick={() => onProspectClick(p)}
                          className="mt-2 w-full text-xs bg-blue-600 text-white py-1 px-2 rounded font-bold hover:bg-blue-500"
                        >
                          Ver detalle
                        </button>
                      )}
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MarkerClusterGroup>
          </MapContainer>
        )}
      </div>
    </div>
  );
}
