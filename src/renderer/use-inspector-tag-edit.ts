import { useRef, useState } from 'react';

export function useInspectorTagEdit(selectionKey: string, onRemove?: (id: string) => void | Promise<void>) {
  const initial = () => ({ key: selectionKey, active: false, saving: false, removed: [] as string[] });
  const [state, setState] = useState(initial);
  const committing = useRef(false);
  if (state.key !== selectionKey) setState(initial());
  const active = state.key === selectionKey && state.active;
  return {
    active,
    saving: state.saving,
    removed: active ? state.removed : [],
    begin: () => setState({ ...initial(), active: true }),
    cancel: () => { if (!state.saving) setState(initial()); },
    remove: (id: string) => {
      if (!active) { void onRemove?.(id); return; }
      if (!state.saving) setState(current => ({ ...current,
        removed: [...new Set([...current.removed, id])],
      }));
    },
    commit: async () => {
      if (!active || state.saving || committing.current) return;
      committing.current = true;
      const key = selectionKey;
      setState(current => ({ ...current, saving: true }));
      try {
        for (const id of state.removed) await onRemove?.(id);
        setState(current => current.key === key ? initial() : current);
      } catch {
        setState(current => current.key === key ? { ...current, saving: false } : current);
      } finally { committing.current = false; }
    },
  };
}
