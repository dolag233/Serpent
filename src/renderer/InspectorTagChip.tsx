import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ContextMenu, ContextMenuBackdrop, ContextMenuItem, useContextMenu } from './context-menu';
import { Icon } from './Icons';
import { useLocale } from './i18n';
import { isImeKeyboardEvent } from './ime-safe-dismiss';

export interface InspectorTagChipProps {
  id: string;
  name: string;
  color?: string;
  source?: string;
  showAiBadge: boolean;
  editing: boolean;
  onFilter?: () => void;
  onRemove?: () => void;
  onRename?: (name: string) => Promise<boolean>;
}

export function InspectorTagChip({ id, name, color, source, showAiBadge, editing, onFilter, onRemove, onRename }: InspectorTagChipProps) {
  const { t } = useLocale();
  const { active, open } = useContextMenu();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(name);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const attemptedValue = useRef<string | null>(null);
  useEffect(() => { if (renaming) { input.current?.focus(); const field = input.current; if (field) field.setSelectionRange(field.value.length, field.value.length); } }, [renaming]);
  const startRename = () => { if (onRename) { attemptedValue.current = null; setDraft(name); setRenaming(true); } };
  const submit = async (reason: "enter" | "blur") => {
    if (submitting.current || !renaming) return;
    const value = draft.trim();
    if (!value || value === name) { setRenaming(false); return; }
    if (reason === "blur" && attemptedValue.current === value) return;
    attemptedValue.current = value;
    submitting.current = true;
    setSaving(true);
    try { if (await onRename?.(value)) setRenaming(false); }
    finally { submitting.current = false; setSaving(false); }
  };
  const modifier = /Mac/i.test(navigator.platform) ? '⌘' : 'Ctrl';
  const shortcut = t('inspector.tagFilterGesture', { modifier });
  return <>
    <span className={`tag-chip inspector-tag-chip${editing ? ' is-editing' : ''}`} data-source={source}
      style={{ borderColor: color, '--tag-chip-color': color } as CSSProperties}
      onContextMenu={event => {
        event.preventDefault(); event.stopPropagation();
        open({ type: 'organization', id, name }, { x: event.clientX, y: event.clientY });
      }}>
      {source === 'ai' && showAiBadge
        ? <span className="inspector-ai-badge inspector-ai-badge-inline" aria-label={t('inspector.aiBadge')} data-hover-tip={t('inspector.aiBadge')}>AI</span>
        : source !== 'ai' ? <span className="tag-chip-dot" style={{ background: color }} /> : null}
      {renaming ? <input className="inspector-tag-rename" aria-label={t('tagMgmt.rename')}
        ref={input} value={draft} readOnly={saving} maxLength={80} size={Math.max(2, Array.from(draft).length)}
        onChange={event => { attemptedValue.current = null; setDraft(event.target.value); }} onBlur={() => { void submit("blur"); }}
        onKeyDown={event => {
          event.stopPropagation();
          if (isImeKeyboardEvent(event)) return;
          if (event.key === 'Enter') { event.preventDefault(); void submit("enter"); }
          if (event.key === 'Escape') { event.preventDefault(); setRenaming(false); }
        }} /> : <button className="inspector-tag-label" type="button" data-hover-tip={name}
          onClick={event => { if ((modifier === '⌘' ? event.metaKey : event.ctrlKey)) onFilter?.(); }}
          onDoubleClick={event => { if (!event.ctrlKey && !event.metaKey) startRename(); }}
          onKeyDown={event => {
            if (event.key === 'Enter' && (modifier === '⌘' ? event.metaKey : event.ctrlKey)) {
              event.preventDefault(); onFilter?.();
            } else if (event.key === 'F2') { event.preventDefault(); startRename(); }
          }}><span className="tag-chip-name">{name}</span></button>}
      {editing && onRemove && !renaming ? <button className="tag-chip-remove" type="button"
        aria-label={t('inspector.removeTag')} data-hover-tip={t('inspector.removeTag')}
        onClick={event => { event.stopPropagation(); onRemove(); }}>
        <Icon name="close" size={9} />
      </button> : null}
    </span>
    {active?.descriptor.type === 'organization' && active.descriptor.id === id ? <ContextMenuBackdrop><ContextMenu ariaLabel={name} position={active.position}>
      <ContextMenuItem key="filter" label={t('inspector.filterTag')} shortcut={shortcut} disabled={!onFilter} onAction={() => onFilter?.()} />
      <ContextMenuItem key="rename" label={t('tagMgmt.rename')} shortcut="F2" disabled={!onRename} onAction={startRename} />
      <ContextMenuItem key="remove" label={t('inspector.removeTag')} disabled={!onRemove} onAction={() => onRemove?.()} />
    </ContextMenu></ContextMenuBackdrop> : null}
  </>;
}
