import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { ContextMenu, ContextMenuBackdrop, ContextMenuItem, useContextMenu } from './context-menu';
import { Icon } from './Icons';
import { useLocale } from './i18n';
import { resolveSelectionPlatform } from './selection-modifiers';
import { isImeKeyboardEvent } from './ime-safe-dismiss';
import { formatRuntimeShortcut } from './shortcut-runtime';

export interface InspectorTagChipProps {
  id: string;
  name: string;
  color?: string;
  source?: string;
  showAiBadge: boolean;
  editing: boolean;
  selected?: boolean;
  onSelect?: (event: MouseEvent<HTMLButtonElement>) => void;
  onContextSelect?: () => void;
  onCopy?: () => void;
  onPaste?: () => void;
  onFilter?: () => void;
  onRemove?: () => void;
  onRename?: (name: string) => Promise<boolean>;
}

export function InspectorTagChip({ id, name, color, source, showAiBadge, editing, selected = false, onSelect, onContextSelect, onCopy, onPaste, onFilter, onRemove, onRename }: InspectorTagChipProps) {
  const { t } = useLocale();
  const { active, open } = useContextMenu();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(name);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const attemptedValue = useRef<string | null>(null);
  useEffect(() => { if (renaming) { input.current?.focus({ preventScroll: true }); input.current?.select(); } }, [renaming]);
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
  return <>
    <span className={`tag-chip inspector-tag-chip${editing ? ' is-editing' : ''}${selected ? ' is-selected' : ''}`} data-source={source}
      data-tag-selection-id={id}
      style={{ '--tag-chip-color': color } as CSSProperties}
      onContextMenu={event => {
        event.preventDefault(); event.stopPropagation();
        onContextSelect?.();
        open({ type: 'organization', id, name }, { x: event.clientX, y: event.clientY });
      }}>
      {source === 'ai' && showAiBadge
        ? <span className="inspector-ai-badge inspector-ai-badge-inline" aria-label={t('inspector.aiBadge')} data-hover-tip={t('inspector.aiBadge')}>AI</span>
        : source !== 'ai' ? <span className="tag-chip-dot" /> : null}
      {renaming ? <input className="inspector-tag-rename" aria-label={t('tagMgmt.rename')}
        ref={input} value={draft} readOnly={saving} maxLength={80} size={Math.max(2, Array.from(draft).length)}
        onChange={event => { attemptedValue.current = null; setDraft(event.target.value); }} onBlur={() => { void submit("blur"); }}
        onKeyDown={event => {
          event.stopPropagation();
          if (isImeKeyboardEvent(event)) return;
          if (event.key === 'Enter') { event.preventDefault(); void submit("enter"); }
          if (event.key === 'Escape') { event.preventDefault(); setRenaming(false); }
        }} /> : <button className="inspector-tag-label" type="button" data-hover-tip={name}
        aria-pressed={selected}
        onClick={event => onSelect?.(event)}
          onDoubleClick={event => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey) startRename(); }}
          onKeyDown={event => {
            const filterModifier = resolveSelectionPlatform(navigator.userAgent) === 'mac' ? event.metaKey : event.ctrlKey;
            if (event.key === 'Enter' && filterModifier) { event.preventDefault(); onFilter?.(); }
            else if (event.key === 'F2') { event.preventDefault(); startRename(); }
          }}><span className="tag-chip-name">{name}</span></button>}
      {editing && onRemove && !renaming ? <button className="tag-chip-remove" type="button"
        aria-label={t('inspector.removeTag')} data-hover-tip={t('inspector.removeTag')}
        onClick={event => { event.stopPropagation(); onRemove(); }}>
        <Icon name="close" size={9} />
      </button> : null}
    </span>
    {active?.descriptor.type === 'organization' && active.descriptor.id === id ? <ContextMenuBackdrop><ContextMenu ariaLabel={name} position={active.position}>
      {onCopy && <ContextMenuItem key="copy" label={t('inspector.copySelectedTags')} shortcut={formatRuntimeShortcut('asset.copy') ?? undefined} onAction={onCopy} />}
      {onPaste && <ContextMenuItem key="paste" label={t('inspector.pasteTags')} shortcut={formatRuntimeShortcut('asset.paste') ?? undefined} onAction={onPaste} />}
      <ContextMenuItem key="filter" label={t('inspector.filterTag')} disabled={!onFilter} onAction={() => onFilter?.()} />
      <ContextMenuItem key="rename" label={t('tagMgmt.rename')} shortcut="F2" disabled={!onRename} onAction={startRename} />
      <ContextMenuItem key="remove" label={t('inspector.removeTag')} disabled={!onRemove} onAction={() => onRemove?.()} />
    </ContextMenu></ContextMenuBackdrop> : null}
  </>;
}
