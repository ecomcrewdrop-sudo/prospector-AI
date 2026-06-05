import { useState, useEffect, useCallback } from 'react';
import { DndContext, DragOverlay, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { motion } from 'framer-motion';
import { Star, Phone, Globe, GripVertical } from 'lucide-react';
import { api } from '../lib/api';

const STAGES = [
  { id: 'new',         label: 'Nuevo',      color: 'border-slate-500',  bg: 'bg-slate-500/10',  dot: 'bg-slate-400' },
  { id: 'contacted',   label: 'Contactado', color: 'border-blue-500',   bg: 'bg-blue-500/10',   dot: 'bg-blue-400' },
  { id: 'replied',     label: 'Respondió',  color: 'border-yellow-500', bg: 'bg-yellow-500/10', dot: 'bg-yellow-400' },
  { id: 'interested',  label: 'Interesado', color: 'border-orange-500', bg: 'bg-orange-500/10', dot: 'bg-orange-400' },
  { id: 'negotiating', label: 'Negociando', color: 'border-purple-500', bg: 'bg-purple-500/10', dot: 'bg-purple-400' },
  { id: 'won',         label: 'Ganado',     color: 'border-green-500',  bg: 'bg-green-500/10',  dot: 'bg-green-400' },
  { id: 'lost',        label: 'Perdido',    color: 'border-red-500',    bg: 'bg-red-500/10',    dot: 'bg-red-400' },
];

function ProspectCard({ prospect, onClick, isDragging }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: prospect.id,
    data: { stage: prospect.stage, prospect },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const tags = prospect.tags ? JSON.parse(prospect.tags) : [];
  const scoreColor = prospect.score >= 80 ? 'text-green-400' : prospect.score >= 60 ? 'text-yellow-400' : 'text-slate-400';

  return (
    <div ref={setNodeRef} style={style} {...attributes}
         className="bg-slate-800/80 border border-slate-700/60 rounded-xl p-3 cursor-pointer hover:border-slate-600 transition-colors group"
         onClick={() => onClick(prospect)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm text-white truncate">{prospect.name}</p>
          <p className="text-xs text-slate-400 truncate">{prospect.niche || '—'}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`text-sm font-black ${scoreColor}`}>{prospect.score}</span>
          <div {...listeners} className="opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing transition-opacity">
            <GripVertical size={14} className="text-slate-600" />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 mt-2">
        {prospect.phone && <span className="flex items-center gap-1 text-xs text-slate-500"><Phone size={10}/> {prospect.phone.slice(-7)}</span>}
        {prospect.website && <span className="flex items-center gap-1 text-xs text-slate-500"><Globe size={10}/> web</span>}
        {prospect.rating && <span className="flex items-center gap-1 text-xs text-slate-500"><Star size={10}/> {prospect.rating}</span>}
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {tags.slice(0, 3).map(tag => (
            <span key={tag} className="bg-primary-500/15 text-primary-300 px-1.5 py-0.5 rounded-full text-[10px] font-medium">#{tag}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function StageColumn({ stage, prospects, onCardClick, activeId }) {
  return (
    <div className={`flex-shrink-0 w-[85vw] md:w-60 snap-center flex flex-col border-t-2 ${stage.color} rounded-xl ${stage.bg} border border-slate-800`}>
      <div className="p-3 border-b border-slate-800/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${stage.dot}`} />
            <span className="font-bold text-sm text-white">{stage.label}</span>
          </div>
          <span className="bg-slate-700 text-slate-300 text-xs font-bold px-2 py-0.5 rounded-full">{prospects.length}</span>
        </div>
      </div>

      <SortableContext items={prospects.map(p => p.id)} strategy={verticalListSortingStrategy}>
        <div className="flex-1 p-2 space-y-2 overflow-y-auto custom-scrollbar min-h-[120px]">
          {prospects.map(prospect => (
            <ProspectCard
              key={prospect.id}
              prospect={prospect}
              onClick={onCardClick}
              isDragging={activeId === prospect.id}
            />
          ))}
          {prospects.length === 0 && (
            <div className="flex items-center justify-center h-20 text-slate-600 text-sm border-2 border-dashed border-slate-700/50 rounded-xl">
              Arrastra aquí
            </div>
          )}
        </div>
      </SortableContext>
    </div>
  );
}

export default function CRMBoard({ sessionId, onProspectClick }) {
  const [boardData, setBoardData] = useState({});
  const [activeId, setActiveId]   = useState(null);
  const [loading, setLoading]     = useState(true);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const loadProspects = useCallback(async () => {
    setLoading(true);
    const res = await api.getProspects(sessionId, { limit: 500 });
    if (res.success) {
      const grouped = {};
      STAGES.forEach(s => { grouped[s.id] = []; });
      res.data.forEach(p => {
        const stage = STAGES.find(s => s.id === p.stage) ? p.stage : 'new';
        if (!grouped[stage]) grouped[stage] = [];
        grouped[stage].push(p);
      });
      setBoardData(grouped);
    }
    setLoading(false);
  }, [sessionId]);

  useEffect(() => { loadProspects(); }, [loadProspects]);

  const findProspect = (id) => {
    for (const stage of Object.values(boardData)) {
      const p = stage.find(p => p.id === id);
      if (p) return p;
    }
    return null;
  };

  const findStageOfProspect = (id) => {
    for (const [stageId, prospects] of Object.entries(boardData)) {
      if (prospects.find(p => p.id === id)) return stageId;
    }
    return null;
  };

  const handleDragStart = ({ active }) => setActiveId(active.id);

  const handleDragEnd = async ({ active, over }) => {
    setActiveId(null);
    if (!over) return;

    const activeStage = findStageOfProspect(active.id);
    // over.id can be a prospect id or a stage id
    const overStage = findStageOfProspect(over.id) || over.id;

    if (activeStage === overStage) return;
    if (!STAGES.find(s => s.id === overStage)) return;

    // Optimistic update
    setBoardData(prev => {
      const next = { ...prev };
      const prospect = next[activeStage].find(p => p.id === active.id);
      if (!prospect) return prev;
      next[activeStage] = next[activeStage].filter(p => p.id !== active.id);
      next[overStage] = [{ ...prospect, stage: overStage }, ...next[overStage]];
      return next;
    });

    await api.updateProspectStage(active.id, overStage, sessionId);
  };

  const activeProspect = activeId ? findProspect(activeId) : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500">
        Cargando pipeline CRM...
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex gap-4 overflow-x-auto pb-4 custom-scrollbar snap-x snap-mandatory" style={{ minHeight: '500px' }}>
        {STAGES.map(stage => (
          <StageColumn
            key={stage.id}
            stage={stage}
            prospects={boardData[stage.id] || []}
            onCardClick={onProspectClick}
            activeId={activeId}
          />
        ))}
      </div>

      <DragOverlay>
        {activeProspect ? (
          <div className="bg-slate-800 border border-primary-500 rounded-xl p-3 shadow-2xl w-56 rotate-2 opacity-90">
            <p className="font-semibold text-sm text-white truncate">{activeProspect.name}</p>
            <p className="text-xs text-slate-400">{activeProspect.niche}</p>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
