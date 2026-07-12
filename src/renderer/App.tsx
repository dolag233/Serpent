import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';

import type { AssetSummary, AssetMetadataResult, CollectionSummary, LinkedFolderSummary, ManagedFolderSummary, SmartCollectionSummary, TagSummary } from '../shared/asset-types';
import type { SerpentLibraryApi, RelinkBatchPreviewResult, ImportValidatedResult } from '../shared/library-api';
import type { PublicError, PublicErrorCode, PublicErrorReason } from '../shared/protocol/errors';
import type { ImportConflictPlan, RendererLibrarySummary, ExportProgressEvent, ImportProgressEvent } from '../shared/protocol/responses';

type RendererWindow = Window & { serpent?: { library?: SerpentLibraryApi } };
type UiState = 'booting' | 'idle' | 'creating' | 'opening' | 'closing' | 'loading' | 'importing' | 'ready';
type DialogKind = 'library' | 'folder' | 'tag' | 'collection' | null;
type AssetScope = 'all' | 'root' | string;
type IconName = 'archive' | 'chevron' | 'close' | 'collection' | 'collapse-left' | 'collapse-right' | 'file' | 'folder' | 'grid' | 'heart' | 'info' | 'link' | 'menu' | 'plus' | 'refresh' | 'search' | 'smart' | 'star' | 'tag' | 'trash' | 'upload' | 'warning';

const iconPaths: Record<IconName, ReactNode> = {
  archive: <><path d="M4 7h16v12H4z" /><path d="M3 4h18v3H3zM9 11h6" /></>, chevron: <path d="m9 18 6-6-6-6" />,
  close: <path d="m7 7 10 10M17 7 7 17" />, collection: <><rect x="4" y="5" width="16" height="14" rx="1.5" /><path d="m8 14 3-3 5 5 2-2 2 2" /></>,
  'collapse-left': <><path d="M5 4h14v16H5zM10 4v16" /><path d="m15 9-3 3 3 3" /></>, 'collapse-right': <><path d="M5 4h14v16H5zM14 4v16" /><path d="m9 9 3 3-3 3" /></>,
  file: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5" /></>, folder: <path d="M3 6.5h7l2 2h9v10H3z" />,
  grid: <><rect x="4" y="4" width="6" height="6" /><rect x="14" y="4" width="6" height="6" /><rect x="4" y="14" width="6" height="6" /><rect x="14" y="14" width="6" height="6" /></>,
  heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.8 1.1-1.1a5.5 5.5 0 0 0 0-7.8Z" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></>,
  link: <><path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2" /><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2" /></>, menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  plus: <path d="M12 5v14M5 12h14" />, refresh: <><path d="M20 7v5h-5" /><path d="M18.4 16a8 8 0 1 1 1.3-8.5L20 12" /></>, search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></>,
  smart: <path d="m12 3 1.7 5.3H19l-4.3 3.2 1.6 5.2-4.3-3.2-4.3 3.2 1.6-5.2L5 8.3h5.3z" />,
  star: <path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.9-6.2-3.3-6.2 3.3 1.2-6.9-5-4.9 6.9-1z" />,
  tag: <path d="M4 5h7l9 9-6 6-9-9zM8 8h.01" />,
  trash: <><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M10 11v6M14 11v6" /></>,
  upload: <><path d="M12 16V4m0 0L7 9m5-5 5 5" /><path d="M4 14v6h16v-6" /></>, warning: <><path d="M12 3 2.8 20h18.4z" /><path d="M12 9v5m0 3h.01" /></>,
};

function Icon({ name, size = 16 }: { name: IconName; size?: number }) { return <svg aria-hidden="true" className="icon" viewBox="0 0 24 24" width={size} height={size}>{iconPaths[name]}</svg>; }
function ToolButton({ label, icon, onClick, pressed, disabled }: { label: string; icon: IconName; onClick?: () => void; pressed?: boolean; disabled?: boolean }) { return <button aria-label={label} aria-pressed={pressed} className="tool-button" disabled={disabled} onClick={onClick} title={label} type="button"><Icon name={icon} /></button>; }
function NavRow({ icon, label, count, active, onClick, onContextMenu, depth = 0, disabled }: { icon: IconName; label: string; count?: number; active?: boolean; onClick?: () => void; onContextMenu?: (e: React.MouseEvent) => void; depth?: number; disabled?: boolean }) { return <button className={`nav-row${active ? ' is-active' : ''}`} disabled={disabled} onClick={onClick} onContextMenu={onContextMenu} style={{ paddingLeft: 7 + depth * 14 }} type="button"><Icon name={icon} size={15} /><span>{label}</span>{count !== undefined && <span className="nav-count">{count}</span>}</button>; }
function Section({ title, action, children }: { title: string; action?: () => void; children: ReactNode }) { return <section className="nav-section"><div className="nav-section-heading"><span>{title}</span>{action && <button aria-label={`添加${title}`} className="tiny-action" onClick={action} type="button"><Icon name="plus" size={13} /></button>}</div>{children}</section>; }

export function App() {
  const api = (window as RendererWindow).serpent?.library;
  // Library / folder / assets (existing)
  const [library, setLibrary] = useState<RendererLibrarySummary | null>(null);
  const [folders, setFolders] = useState<ManagedFolderSummary[]>([]);
  const [linkedFolders, setLinkedFolders] = useState<LinkedFolderSummary[]>([]);
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [assetScope, setAssetScope] = useState<AssetScope>('all');
  const [allAssetCount, setAllAssetCount] = useState(0);
  const [selectedAssetId, setSelectedAssetId] = useState<string | undefined>();
  const [uiState, setUiState] = useState<UiState>('booting');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [dialogValue, setDialogValue] = useState('我的资源库');
  const [conflicts, setConflicts] = useState<ImportConflictPlan | null>(null);
  const [duplicateDecision, setDuplicateDecision] = useState<'skip' | 'merge' | 'create-copy'>('skip');
  const [nameDecision, setNameDecision] = useState<'keep-both' | 'replace' | 'skip'>('keep-both');
  const [leftOpen, setLeftOpen] = useState(() => window.innerWidth > 800);
  const [rightOpen, setRightOpen] = useState(() => window.innerWidth > 1020);

  // Tags
  const [tags, setTags] = useState<TagSummary[]>([]);
  const [activeTagId, setActiveTagId] = useState<string | null>(null);
  // Per-tag asset membership cache (local-session only; reset on close).
  // NOTE: client-side tag filter is limited to assets tagged in the current session.
  // Full tag filtering requires the search API (slice 0005).
  const [tagMembership, setTagMembership] = useState<Map<string, Set<string>>>(new Map());

  // Collections
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
  const [collectionRecursive, setCollectionRecursive] = useState(true);

  // Smart collections
  const [smartCollections, setSmartCollections] = useState<SmartCollectionSummary[]>([]);

  // Metadata editor
  const [assetMetadata, setAssetMetadata] = useState<AssetMetadataResult | null>(null);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [versionConflict, setVersionConflict] = useState(false);
  // Pending edit values
  const [editLabel, setEditLabel] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editRating, setEditRating] = useState(0);
  const [editFavorite, setEditFavorite] = useState(false);
  const [editSourceUrl, setEditSourceUrl] = useState('');

  // Inline tag/collection editors
  const [showTagInput, setShowTagInput] = useState(false);
  const [tagInputValue, setTagInputValue] = useState('');
  const [showCollectionInput, setShowCollectionInput] = useState(false);
  const [collectionInputValue, setCollectionInputValue] = useState('');

  // Trash / Delete / Relink state
  const [showTrash, setShowTrash] = useState(false);
  const [trashedAssets, setTrashedAssets] = useState<AssetSummary[]>([]);
  const [deleteLinkedDialog, setDeleteLinkedDialog] = useState<{ assetIds: string[]; displayNames: string; deleteSourceFile: boolean } | null>(null);
  const [permanentDeleteDialog, setPermanentDeleteDialog] = useState<string | null>(null);
  const [batchRelinkPreview, setBatchRelinkPreview] = useState<RelinkBatchPreviewResult | null>(null);
  const [batchRelinkKeepMetadata, setBatchRelinkKeepMetadata] = useState(true);

  // Export / Import state
  const [exportProgress, setExportProgress] = useState<ExportProgressEvent | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgressEvent | null>(null);

  // AI analysis state
  const [aiConfigOpen, setAiConfigOpen] = useState(false);
  const [aiProvider, setAiProvider] = useState<'openai' | 'gemini' | 'anthropic'>('openai');
  const [aiModel, setAiModel] = useState('gpt-4o-mini');
  const [aiApiKey, setAiApiKey] = useState('');
  const [aiHasKey, setAiHasKey] = useState(false);
  const [aiLabelEnabled, setAiLabelEnabled] = useState(true);
  const [aiDescriptionEnabled, setAiDescriptionEnabled] = useState(true);
  const [aiTagsEnabled, setAiTagsEnabled] = useState(true);
  const [aiStructuredEnabled, setAiStructuredEnabled] = useState(false);
  const [aiLanguage, setAiLanguage] = useState('auto');
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiContent, setAiContent] = useState<{
    label?: string;
    description?: string;
    tags?: string[];
    structuredMetadata?: Record<string, unknown>;
    modelVersion?: string;
  } | null>(null);
  const [importValidated, setImportValidated] = useState<ImportValidatedResult | null>(null);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [includeLinkedContent, setIncludeLinkedContent] = useState(false);

  const selectedFolderId = assetScope === 'all' || assetScope === 'root' ? undefined : assetScope;
  const selectedFolder = folders.find((folder) => folder.folderId === selectedFolderId);
  const selectedAsset = showTrash
    ? trashedAssets.find((a) => a.assetId === selectedAssetId)
    : assets.find((asset) => asset.assetId === selectedAssetId);

  const isLinkedScope = assetScope !== 'all' && assetScope !== 'root' && linkedFolders.some((lf) => lf.folderId === assetScope);

  // Tag-filtered asset set
  const tagFilteredAssetIds = useMemo(() => {
    if (!activeTagId) return null;
    return tagMembership.get(activeTagId) ?? new Set<string>();
  }, [activeTagId, tagMembership]);

  const visibleAssets = useMemo(() => {
    if (showTrash) return trashedAssets;
    if (activeTagId && tagFilteredAssetIds) {
      return assets.filter((a) => tagFilteredAssetIds.has(a.assetId));
    }
    return assets;
  }, [assets, trashedAssets, showTrash, activeTagId, tagFilteredAssetIds]);

  // Collection tree helper
  const collectionTree = useMemo(() => {
    const byParent = new Map<string | null, CollectionSummary[]>();
    for (const c of collections) {
      const key = c.parentId;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key)!.push(c);
    }
    for (const children of byParent.values()) children.sort((a, b) => a.position - b.position);
    return byParent;
  }, [collections]);

  function renderCollectionNodes(parentId: string | null, depth: number): ReactNode {
    const children = collectionTree.get(parentId) ?? [];
    return children.map((c) => (
      <NavRow
        key={c.collectionId}
        icon="collection"
        label={c.name}
        count={c.assetCount}
        active={activeCollectionId === c.collectionId && !activeTagId}
        depth={depth}
        onContextMenu={(e) => { e.preventDefault(); if (confirm(`删除合集"${c.name}"？\n（仅删除合集结构，不删除资产）`)) void deleteCollection(c.collectionId); }}
        onClick={() => void chooseCollection(c.collectionId)}
      />
    ));
  }

  const loadContent = useCallback(async (activeLibrary: RendererLibrarySummary, scope: AssetScope, opts?: { trashMode?: boolean }) => {
    if (!api) return;
    const trashMode = opts?.trashMode ?? false;
    const scopedRequest = scope === 'all'
      ? { libraryId: activeLibrary.libraryId, recursive: true }
      : scope === 'root'
        ? { libraryId: activeLibrary.libraryId, recursive: false }
        : { libraryId: activeLibrary.libraryId, folderId: scope, recursive: false };
    const libId = { libraryId: activeLibrary.libraryId };
    const [
      folderResult, assetResult, allResult, linkedResult,
      tagResult, collectionResult, smartResult,
    ] = await Promise.all([
      api.listFolders(libId),
      trashMode
        ? api.listTrash(libId)
        : api.listAssets(scopedRequest),
      trashMode || scope === 'all'
        ? Promise.resolve(undefined)
        : api.listAssets({ libraryId: activeLibrary.libraryId, recursive: true }),
      api.listLinkedFolders(libId),
      api.listTags(libId),
      api.listCollections(libId),
      api.listSmartCollections(libId),
    ]);
    if (!folderResult.ok) throw new LibraryOperationError(folderResult.error);
    if (!assetResult.ok) throw new LibraryOperationError(assetResult.error);
    if (allResult && !allResult.ok) throw new LibraryOperationError(allResult.error);
    if (!linkedResult.ok) throw new LibraryOperationError(linkedResult.error);
    if (!tagResult.ok) throw new LibraryOperationError(tagResult.error);
    if (!collectionResult.ok) throw new LibraryOperationError(collectionResult.error);
    if (!smartResult.ok) throw new LibraryOperationError(smartResult.error);
    setFolders(folderResult.value);
    if (trashMode) {
      setTrashedAssets(assetResult.value);
    } else {
      setAssets(assetResult.value);
    }
    setAllAssetCount(allResult?.value.length ?? assetResult.value.length);
    setLinkedFolders(linkedResult.value);
    setTags(tagResult.value);
    setCollections(collectionResult.value);
    setSmartCollections(smartResult.value);
  }, [api]);

  const restore = useCallback(async () => {
    if (!api) { setError('无法连接到 Serpent 桌面服务。请重新启动应用。'); setUiState('idle'); return; }
    let activeLibrary: RendererLibrarySummary | null = null;
    try {
      const result = await api.listOpen();
      if (!result.ok) throw new LibraryOperationError(result.error);
      activeLibrary = result.value[0] ?? null;
      setLibrary(activeLibrary);
      setShowTrash(false);
      setTrashedAssets([]);
      if (activeLibrary) await loadContent(activeLibrary, 'all');
      setUiState(activeLibrary ? 'ready' : 'idle');
    } catch (caught) { setError(toMessage(caught, '无法恢复工作区。')); setUiState(activeLibrary ? 'ready' : 'idle'); }
  }, [api, loadContent]);
  useEffect(() => { void Promise.resolve().then(restore); }, [restore]);

  async function runLibraryOperation(kind: 'create' | 'open') {
    if (!api) return;
    setError(null);
    setUiState(kind === 'create' ? 'creating' : 'opening');
    let opened = false;
    try {
      const result = kind === 'create'
        ? await api.create({ displayName: dialogValue.trim() })
        : await api.open();
      if (!result.ok) {
        if (result.error.code === 'CANCELLED') return;
        throw new LibraryOperationError(result.error);
      }
      opened = true;
      setLibrary(result.value);
      setAssetScope('all');
      setActiveTagId(null);
      setActiveCollectionId(null);
      api?.setActiveContext(result.value.libraryId);
      await loadContent(result.value, 'all');
    } catch (caught) {
      setError(toMessage(caught, '资源库操作失败。'));
    } finally {
      setUiState(opened ? 'ready' : 'idle');
    }
  }

  async function chooseFolder(scope: AssetScope) {
    if (!library) return;
    setShowTrash(false);
    setAssetScope(scope);
    setSelectedAssetId(undefined);
    setActiveTagId(null);
    setActiveCollectionId(null);
    const folderId = (scope === 'all' || scope === 'root') ? undefined : scope;
    api?.setActiveContext(library.libraryId, folderId);
    setUiState('loading');
    try {
      await loadContent(library, scope);
    } catch (caught) {
      setError(toMessage(caught, '无法读取资产。'));
    } finally {
      setUiState('ready');
    }
  }

  async function enterTrash() {
    if (!library) return;
    setShowTrash(true);
    setActiveTagId(null);
    setActiveCollectionId(null);
    setSelectedAssetId(undefined);
    setAssetScope('all');
    api?.setActiveContext(library.libraryId);
    setUiState('loading');
    try {
      await loadContent(library, 'all', { trashMode: true });
    } catch (caught) {
      setError(toMessage(caught, '无法读取回收站。'));
    } finally {
      setUiState('ready');
    }
  }

  // --- Tag CRUD ---

  async function createTag() {
    if (!api || !library || !tagInputValue.trim()) return;
    setUiState('loading');
    try {
      const result = await api.createTag({ libraryId: library.libraryId, name: tagInputValue.trim() });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setShowTagInput(false);
      setTagInputValue('');
      await loadContent(library, assetScope);
    } catch (caught) {
      setError(toMessage(caught, '创建标签失败。'));
    } finally {
      setUiState('ready');
    }
  }

  async function deleteTag(tagId: string) {
    if (!api || !library) return;
    setUiState('loading');
    try {
      const result = await api.deleteTag({ libraryId: library.libraryId, tagId });
      if (!result.ok) throw new LibraryOperationError(result.error);
      if (activeTagId === tagId) {
        setActiveTagId(null);
        await loadContent(library, assetScope);
      } else {
        // Refresh tag list only
        const tagResult = await api.listTags({ libraryId: library.libraryId });
        if (tagResult.ok) setTags(tagResult.value);
      }
    } catch (caught) {
      setError(toMessage(caught, '删除标签失败。'));
    } finally {
      setUiState('ready');
    }
  }

  async function chooseTag(tagId: string) {
    if (!library) return;
    setShowTrash(false);
    setActiveTagId(tagId);
    setActiveCollectionId(null);
    setAssetScope('all');
    setSelectedAssetId(undefined);
    api?.setActiveContext(library.libraryId);
    setUiState('loading');
    try {
      // Load all assets for client-side tag filter
      await loadContent(library, 'all');
    } catch (caught) {
      setError(toMessage(caught, '无法读取标签资产。'));
    } finally {
      setUiState('ready');
    }
  }

  // --- Collection CRUD ---

  async function createCollection() {
    if (!api || !library || !collectionInputValue.trim()) return;
    setUiState('loading');
    try {
      const result = await api.createCollection({ libraryId: library.libraryId, name: collectionInputValue.trim() });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setShowCollectionInput(false);
      setCollectionInputValue('');
      await loadContent(library, assetScope);
    } catch (caught) {
      setError(toMessage(caught, '创建合集失败。'));
    } finally {
      setUiState('ready');
    }
  }

  async function deleteCollection(collectionId: string) {
    if (!api || !library) return;
    setUiState('loading');
    try {
      const result = await api.deleteCollection({ libraryId: library.libraryId, collectionId });
      if (!result.ok) throw new LibraryOperationError(result.error);
      if (activeCollectionId === collectionId) {
        setActiveCollectionId(null);
        await loadContent(library, assetScope);
      } else {
        const colResult = await api.listCollections({ libraryId: library.libraryId });
        if (colResult.ok) setCollections(colResult.value);
      }
    } catch (caught) {
      setError(toMessage(caught, '删除合集失败。'));
    } finally {
      setUiState('ready');
    }
  }

  async function chooseCollection(collectionId: string) {
    if (!api || !library) return;
    setShowTrash(false);
    setActiveCollectionId(collectionId);
    setActiveTagId(null);
    setAssetScope('all');
    setSelectedAssetId(undefined);
    api?.setActiveContext(library.libraryId);
    setUiState('loading');
    try {
      const result = await api.listCollectionAssets({ libraryId: library.libraryId, collectionId, recursive: collectionRecursive });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setAssets(result.value);
      setAllAssetCount(result.value.length);
      // Also refresh sidebar metadata
      const [tagResult, collectionResult, smartResult] = await Promise.all([
        api.listTags({ libraryId: library.libraryId }),
        api.listCollections({ libraryId: library.libraryId }),
        api.listSmartCollections({ libraryId: library.libraryId }),
      ]);
      if (tagResult.ok) setTags(tagResult.value);
      if (collectionResult.ok) setCollections(collectionResult.value);
      if (smartResult.ok) setSmartCollections(smartResult.value);
    } catch (caught) {
      setError(toMessage(caught, '无法读取合集内容。'));
    } finally {
      setUiState('ready');
    }
  }

  // --- Asset metadata ---

  async function loadMetadata() {
    if (!api || !library || !selectedAssetId) return;
    setMetadataLoading(true);
    setVersionConflict(false);
    try {
      const result = await api.getAssetMetadata({ libraryId: library.libraryId, assetId: selectedAssetId });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setAssetMetadata(result.value);
      setEditLabel(result.value.label ?? '');
      setEditDescription(result.value.description ?? '');
      setEditRating(result.value.rating);
      setEditFavorite(result.value.favorite);
      setEditSourceUrl(result.value.sourcePageUrl ?? '');
    } catch (caught) {
      setError(toMessage(caught, '无法读取元数据。'));
    } finally {
      setMetadataLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    if (selectedAssetId) {
      void Promise.resolve().then(async () => {
        if (!api || !library) return;
        setMetadataLoading(true);
        setVersionConflict(false);
        try {
          const result = await api.getAssetMetadata({ libraryId: library.libraryId, assetId: selectedAssetId });
          if (!cancelled && result.ok) {
            setAssetMetadata(result.value);
            setEditLabel(result.value.label ?? '');
            setEditDescription(result.value.description ?? '');
            setEditRating(result.value.rating);
            setEditFavorite(result.value.favorite);
            setEditSourceUrl(result.value.sourcePageUrl ?? '');
          } else if (!cancelled && !result.ok) {
            throw new LibraryOperationError(result.error);
          }
        } catch (caught) {
          if (!cancelled) setError(toMessage(caught, '无法读取元数据。'));
        } finally {
          if (!cancelled) setMetadataLoading(false);
        }
      });
    } else {
      queueMicrotask(() => {
        setAssetMetadata(null);
        setVersionConflict(false);
      });
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAssetId]);

  async function saveMetadata(fields: {
    label?: string;
    description?: string;
    rating?: number;
    favorite?: boolean;
    sourcePageUrl?: string;
  }) {
    if (!api || !library || !selectedAssetId || !assetMetadata) return;
    setVersionConflict(false);
    try {
      const result = await api.setAssetMetadata({
        libraryId: library.libraryId,
        assetId: selectedAssetId,
        expectedVersion: assetMetadata.entityVersion,
        ...fields,
      });
      if (!result.ok) {
        if (result.error.code === 'VERSION_CONFLICT') {
          setVersionConflict(true);
          setNotice('元数据版本冲突——另一个操作已修改了这些字段。请刷新后重新编辑。');
          return;
        }
        throw new LibraryOperationError(result.error);
      }
      setAssetMetadata(result.value);
      setNotice('元数据已保存。');
    } catch (caught) {
      setError(toMessage(caught, '保存元数据失败。'));
    }
  }

  // --- Existing operations ---

  async function createFolder() {
    if (!api || !library) return;
    setUiState('loading');
    try {
      const result = await api.createFolder({ libraryId: library.libraryId, parentFolderId: selectedFolderId, name: dialogValue.trim() });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setDialog(null);
      setNotice(`已创建文件夹“${result.value.name}”。`);
      await loadContent(library, assetScope);
    } catch (caught) {
      setError(toMessage(caught, '创建文件夹失败。'));
    } finally {
      setUiState('ready');
    }
  }

  async function importAssets(kind: 'files' | 'folder') {
    if (!api || !library) return;
    setUiState('importing'); setError(null); setNotice(null);
    try {
      const result = kind === 'files'
        ? await api.importFiles({ libraryId: library.libraryId, targetFolderId: selectedFolderId })
        : await api.importFolder({ libraryId: library.libraryId, targetFolderId: selectedFolderId });
      if (!result.ok) {
        if (result.error.code === 'CANCELLED') return;
        throw new LibraryOperationError(result.error);
      }
      if ('importId' in result.value) {
        setConflicts(result.value);
        return;
      }
      setNotice(importSummary(result.value));
      await loadContent(library, assetScope);
    } catch (caught) {
      setError(toMessage(caught, '导入失败。'));
    } finally {
      setUiState('ready');
    }
  }

  async function resolveConflicts() {
    if (!api || !library || !conflicts) return;
    setUiState('importing');
    try {
      const result = await api.resolveImport({ importId: conflicts.importId, suspectedDuplicate: duplicateDecision, nameConflict: nameDecision });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setConflicts(null);
      setNotice(importSummary(result.value));
      await loadContent(library, assetScope);
    } catch (caught) {
      setError(toMessage(caught, '无法继续导入。'));
    } finally {
      setUiState('ready');
    }
  }

  async function abandonConflicts() {
    if (!api || !conflicts) return;
    const plan = conflicts;
    setConflicts(null);
    try {
      const result = await api.abandonImport({ importId: plan.importId });
      if (!result.ok) throw new LibraryOperationError(result.error);
    } catch (caught) {
      setError(toMessage(caught, '无法取消待处理导入。'));
    }
  }

  async function refreshAssets() {
    if (!api || !library) return;
    setUiState('loading');
    try {
      const result = await api.refreshAssets({ libraryId: library.libraryId });
      if (!result.ok) throw new LibraryOperationError(result.error);
      await loadContent(library, assetScope);
      setNotice(result.value.changedCount ? `已同步 ${result.value.changedCount} 项外部变化。` : '磁盘内容已是最新状态。');
    } catch (caught) {
      setError(toMessage(caught, '刷新失败。'));
    } finally {
      setUiState('ready');
    }
  }

  async function importFolderAsLinked() {
    if (!api || !library) return;
    setUiState('importing'); setError(null); setNotice(null);
    try {
      const result = await api.importFolderAsLinked({ libraryId: library.libraryId, displayName: undefined });
      if (!result.ok) {
        if (result.error.code === 'CANCELLED') return;
        throw new LibraryOperationError(result.error);
      }
      setNotice(`已链接文件夹“${result.value.displayName}”。`);
      await loadContent(library, assetScope);
    } catch (caught) {
      setError(toMessage(caught, '链接文件夹失败。'));
    } finally {
      setUiState('ready');
    }
  }

  async function relinkFolder(folderId: string) {
    if (!api || !library) return;
    setUiState('loading');
    try {
      const result = await api.relinkMissingFolder({ libraryId: library.libraryId, folderId });
      if (!result.ok) {
        if (result.error.code === 'CANCELLED') return;
        throw new LibraryOperationError(result.error);
      }
      setNotice(`已重新定位链接文件夹“${result.value.displayName}”。`);
      await loadContent(library, assetScope);
    } catch (caught) {
      setError(toMessage(caught, '重新定位失败。'));
    } finally {
      setUiState('ready');
    }
  }

  async function closeLibrary() {
    if (!api || !library) return;
    setUiState('closing');
    let closed = false;
    try {
      const result = await api.close({ libraryId: library.libraryId });
      if (!result.ok) throw new LibraryOperationError(result.error);
      closed = true;
      setLibrary(null);
      setFolders([]);
      setLinkedFolders([]);
      setAssets([]);
      setAllAssetCount(0);
      setAssetScope('all');
      setShowTrash(false);
      setTrashedAssets([]);
      setTags([]);
      setCollections([]);
      setSmartCollections([]);
      setActiveTagId(null);
      setActiveCollectionId(null);
      setTagMembership(new Map());
      api?.setActiveContext(null);
    } catch (caught) {
      setError(toMessage(caught, '关闭失败。'));
    } finally {
      setUiState(closed ? 'idle' : 'ready');
    }
  }

  // --- Trash operations ---

  async function trashManagedAssets(assetIds: string[]) {
    if (!api || !library) return;
    setUiState('loading');
    try {
      const result = await api.trashAssets({ libraryId: library.libraryId, assetIds });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setNotice(`${result.value.trashedCount} 项资产已移入回收站。`);
      setSelectedAssetId(undefined);
      await loadContent(library, assetScope);
    } catch (caught) {
      setError(toMessage(caught, '删除失败。'));
    } finally {
      setUiState('ready');
    }
  }

  async function restoreTrashedAssets(assetIds: string[]) {
    if (!api || !library) return;
    setUiState('loading');
    try {
      const result = await api.restoreAssets({ libraryId: library.libraryId, assetIds });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setNotice(`${result.value.restoredCount} 项资产已恢复至原位置。`);
      setSelectedAssetId(undefined);
      await loadContent(library, 'all', { trashMode: true });
    } catch (caught) {
      setError(toMessage(caught, '恢复失败。'));
    } finally {
      setUiState('ready');
    }
  }

  async function deletePermanentFromTrash() {
    if (!api || !library || !permanentDeleteDialog) return;
    const assetIds = [permanentDeleteDialog];
    setPermanentDeleteDialog(null);
    setUiState('loading');
    try {
      const result = await api.deleteAssetsPermanent({ libraryId: library.libraryId, assetIds });
      if (!result.ok) throw new LibraryOperationError(result.error);
      let msg = `已永久删除 ${result.value.deletedCount} 项。`;
      if (result.value.skippedCount > 0) {
        msg += ` ${result.value.skippedCount} 项因文件占用跳过：${result.value.skippedReasons.join('；')}`;
      }
      setNotice(msg);
      setSelectedAssetId(undefined);
      await loadContent(library, 'all', { trashMode: true });
    } catch (caught) {
      setError(toMessage(caught, '永久删除失败。'));
    } finally {
      setUiState('ready');
    }
  }

  async function purgeTrash() {
    if (!api || !library) return;
    setUiState('loading');
    try {
      const result = await api.purgeTrash({ libraryId: library.libraryId });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setNotice(`已清理 ${result.value.purgedCount} 项过期资产。`);
      await loadContent(library, 'all', { trashMode: true });
    } catch (caught) {
      setError(toMessage(caught, '清空回收站失败。'));
    } finally {
      setUiState('ready');
    }
  }

  // --- Linked asset delete ---

  async function executeDeleteLinked() {
    if (!api || !library || !deleteLinkedDialog) return;
    const { assetIds, deleteSourceFile } = deleteLinkedDialog;
    setDeleteLinkedDialog(null);
    setUiState('loading');
    try {
      const result = await api.deleteLinkedAssets({ libraryId: library.libraryId, assetIds, deleteSourceFile });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setNotice(`已删除 ${result.value.deletedCount} 项链接资产。`);
      setSelectedAssetId(undefined);
      await loadContent(library, assetScope);
    } catch (caught) {
      setError(toMessage(caught, '删除链接资产失败。'));
    } finally {
      setUiState('ready');
    }
  }

  // --- Relink operations ---

  async function relinkMissingAsset() {
    if (!api || !library || !selectedAssetId) return;
    setUiState('loading');
    try {
      const result = await api.relinkAsset({ libraryId: library.libraryId, assetId: selectedAssetId });
      if (!result.ok) {
        if (result.error.code === 'CANCELLED') return;
        throw new LibraryOperationError(result.error);
      }
      setNotice('资产已成功找回。');
      await loadContent(library, assetScope);
    } catch (caught) {
      setError(toMessage(caught, '找回资产失败。'));
    } finally {
      setUiState('ready');
    }
  }

  async function startBatchRelink() {
    if (!api || !library) return;
    setUiState('loading');
    try {
      const result = await api.relinkBatchPreview({ libraryId: library.libraryId, keepMetadata: batchRelinkKeepMetadata });
      if (!result.ok) {
        if (result.error.code === 'CANCELLED') return;
        throw new LibraryOperationError(result.error);
      }
      setBatchRelinkPreview(result.value);
    } catch (caught) {
      setError(toMessage(caught, '批量重新定位预览失败。'));
    } finally {
      setUiState('ready');
    }
  }

  async function applyBatchRelink() {
    if (!api || !library || !batchRelinkPreview) return;
    setUiState('loading');
    try {
      const result = await api.relinkBatchApply({ libraryId: library.libraryId, keepMetadata: batchRelinkKeepMetadata });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setBatchRelinkPreview(null);
      setNotice(`批量重新定位完成：恢复 ${result.value.restoredCount} 项，${result.value.unchangedMissingCount} 项仍丢失。`);
      await loadContent(library, assetScope);
    } catch (caught) {
      setBatchRelinkPreview(null);
      setError(toMessage(caught, '批量重新定位失败。'));
    } finally {
      setUiState('ready');
    }
  }

  // --- Export / Import operations ---

  async function exportLibrary() {
    if (!api || !library) return;
    setExportDialogOpen(false);
    setExportProgress({
      type: 'export.progress', exportId: '', libraryId: library.libraryId,
      phase: 'snapshot-db', filesProcessed: 0, totalFiles: 0,
      bytesProcessed: 0, totalBytes: 0,
    });
    try {
      const result = await api.exportLibrary({ libraryId: library.libraryId, includeLinkedContent });
      if (!result.ok) {
        if (result.error.code === 'CANCELLED') {
          setNotice('导出已取消。');
        } else {
          throw new LibraryOperationError(result.error);
        }
      }
    } catch (caught) {
      setError(toMessage(caught, '导出失败。'));
    } finally {
      setTimeout(() => {
        setExportProgress((prev) => {
          if (prev?.phase === 'complete' || prev?.phase === 'cancelled') return null;
          return prev;
        });
      }, 4000);
    }
  }

  async function startImport() {
    if (!api) return;
    setImportProgress({
      type: 'import.progress', importId: '',
      phase: 'validate', filesProcessed: 0, totalFiles: 0,
      bytesProcessed: 0, totalBytes: 0,
    });
    try {
      const result = await api.importLibrary();
      if (!result.ok) {
        if (result.error.code === 'CANCELLED') {
          setImportProgress(null);
          return;
        }
        throw new LibraryOperationError(result.error);
      }
      setImportValidated(result.value);
      setImportProgress(null);
    } catch (caught) {
      setError(toMessage(caught, '导入验证失败。'));
      setImportProgress(null);
    }
  }

  async function completeImportCopy() {
    if (!api || !importValidated) return;
    setImportProgress({
      type: 'import.progress', importId: importValidated.importId,
      phase: 'copy', filesProcessed: 0, totalFiles: 0,
      bytesProcessed: 0, totalBytes: 0,
    });
    try {
      const result = await api.importLibraryCopy({ importId: importValidated.importId });
      if (!result.ok) {
        if (result.error.code === 'CANCELLED') {
          setNotice('导入已取消。');
        } else {
          throw new LibraryOperationError(result.error);
        }
      }
      setImportValidated(null);
    } catch (caught) {
      setError(toMessage(caught, '导入失败。'));
      setImportProgress(null);
    }
  }

  async function completeImportInPlace() {
    if (!api || !importValidated) return;
    setImportProgress({
      type: 'import.progress', importId: importValidated.importId,
      phase: 'open', filesProcessed: 0, totalFiles: 0,
      bytesProcessed: 0, totalBytes: 0,
    });
    try {
      const result = await api.importLibraryOpenInPlace({ importId: importValidated.importId });
      if (!result.ok) {
        if (result.error.code === 'CANCELLED') {
          setNotice('导入已取消。');
        } else {
          throw new LibraryOperationError(result.error);
        }
      }
      setImportValidated(null);
    } catch (caught) {
      setError(toMessage(caught, '导入失败。'));
      setImportProgress(null);
    }
  }

  useEffect(() => {
    if (!api || !library) return;
    return api.onAssetsChanged((event) => {
      if (event.libraryId !== library.libraryId) return;
      void Promise.resolve().then(async () => {
        try {
          await loadContent(library, assetScope);
          const missing = event.missingCount ? `，其中 ${event.missingCount} 项丢失` : '';
          setNotice(`已自动同步 ${event.changedCount} 项磁盘变化${missing}。`);
        } catch (caught) {
          setError(toMessage(caught, '磁盘内容已变化，但界面刷新失败。'));
        }
      });
    });
  }, [api, assetScope, library, loadContent]);

  useEffect(() => {
    if (!api || !library) return;
    return api.onProgress((event) => {
      if (event.type === 'export.progress') {
        setExportProgress(event);
        if (event.phase === 'complete') {
          setNotice(`导出完成：${event.totalFiles} 文件，${formatBytes(event.totalBytes)}。`);
        }
      } else if (event.type === 'import.progress') {
        setImportProgress(event);
        if (event.phase === 'complete') {
          setImportProgress(null);
        }
      }
    });
  }, [api, library]);

  useEffect(() => {
    if (!dialog && !conflicts && !permanentDeleteDialog && !deleteLinkedDialog && !batchRelinkPreview) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        const modal = document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
        const focusable = modal?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
        );
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
        return;
      }
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (permanentDeleteDialog) { setPermanentDeleteDialog(null); return; }
      if (deleteLinkedDialog) { setDeleteLinkedDialog(null); return; }
      if (batchRelinkPreview) { setBatchRelinkPreview(null); return; }
      if (dialog) {
        setDialog(null);
        setShowTagInput(false);
        setShowCollectionInput(false);
        return;
      }
      if (!api || !conflicts) return;
      const importId = conflicts.importId;
      setConflicts(null);
      void Promise.resolve().then(async () => {
        try {
          const result = await api.abandonImport({ importId });
          if (!result.ok) throw new LibraryOperationError(result.error);
        } catch (caught) {
          setError(toMessage(caught, '无法取消待处理导入。'));
        }
      });
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [api, conflicts, dialog, permanentDeleteDialog, deleteLinkedDialog, batchRelinkPreview]);

  function workspaceTitle() {
    if (!library) return '工作区';
    if (showTrash) return '回收站';
    if (activeTagId) { const t = tags.find((x) => x.tagId === activeTagId); return t ? `标签：${t.name}` : '标签筛选'; }
    if (activeCollectionId) { const c = collections.find((x) => x.collectionId === activeCollectionId); return c ? `合集：${c.name}` : '合集视图'; }
    if (assetScope === 'all') return '所有资产';
    if (assetScope === 'root') return '资源库根目录';
    return selectedFolder?.name ?? '工作区';
  }

  function scopeChipLabel() {
    if (showTrash) return '回收站';
    if (activeTagId) { const t = tags.find((x) => x.tagId === activeTagId); return t ? `标签 · ${t.name}` : '标签'; }
    if (activeCollectionId) { const c = collections.find((x) => x.collectionId === activeCollectionId); return c ? `合集 · ${c.name}` : '合集'; }
    if (assetScope === 'all') return '所有资产';
    if (assetScope === 'root') return '资源库根目录';
    return selectedFolder?.name;
  }

  const busy = ['booting', 'creating', 'opening', 'closing', 'loading', 'importing'].includes(uiState);

  // --- Metadata editor helpers ---
  function handleMetadataLabelInput(event: FormEvent<HTMLInputElement>) {
    const value = (event.target as HTMLInputElement).value;
    setEditLabel(value);
  }

  function handleMetadataLabelSave() {
    if (!assetMetadata || editLabel === (assetMetadata.label ?? '')) return;
    void saveMetadata({ label: editLabel || undefined });
  }

  function handleMetadataDescriptionInput(event: FormEvent<HTMLTextAreaElement>) {
    const value = (event.target as HTMLTextAreaElement).value;
    setEditDescription(value);
  }

  function handleMetadataDescriptionSave() {
    if (!assetMetadata || editDescription === (assetMetadata.description ?? '')) return;
    void saveMetadata({ description: editDescription || undefined });
  }

  function handleRatingClick(rating: number) {
    if (!assetMetadata) return;
    setEditRating(rating);
    void saveMetadata({ rating });
  }

  function handleFavoriteToggle() {
    if (!assetMetadata) return;
    const next = !editFavorite;
    setEditFavorite(next);
    void saveMetadata({ favorite: next });
  }

  function handleSourceUrlInput(event: FormEvent<HTMLInputElement>) {
    const value = (event.target as HTMLInputElement).value;
    setEditSourceUrl(value);
  }

  function handleSourceUrlSave() {
    if (!assetMetadata || editSourceUrl === (assetMetadata.sourcePageUrl ?? '')) return;
    void saveMetadata({ sourcePageUrl: editSourceUrl || undefined });
  }

  // ── AI Analysis ────────────────────────────────────────────────────

  async function loadAiConfig() {
    if (!api) return;
    const result = await api.getAiConfig();
    if (!result.ok) return;
    setAiProvider((result.value.provider as 'openai' | 'gemini' | 'anthropic') ?? 'openai');
    setAiModel(result.value.model ?? 'gpt-4o-mini');
    setAiHasKey(result.value.hasKey);
    setAiLabelEnabled(result.value.enabledFields.label);
    setAiDescriptionEnabled(result.value.enabledFields.description);
    setAiTagsEnabled(result.value.enabledFields.tags);
    setAiStructuredEnabled(result.value.enabledFields.structuredMetadata);
    setAiLanguage(result.value.language);
  }

  async function saveAiConfig() {
    if (!api || !aiApiKey.trim()) return;
    const result = await api.setAiConfig({
      provider: aiProvider,
      model: aiModel,
      apiKey: aiApiKey.trim(),
      enabledFields: {
        label: aiLabelEnabled,
        description: aiDescriptionEnabled,
        tags: aiTagsEnabled,
        structuredMetadata: aiStructuredEnabled,
      },
      language: aiLanguage,
    });
    if (!result.ok) {
      setError(toMessage(result.error, 'AI 配置保存失败。'));
      return;
    }
    setAiHasKey(true);
    setAiApiKey('');
    setAiConfigOpen(false);
    setNotice('AI 配置已保存。');
  }

  async function handleAnalyzeClick() {
    if (!api || !library || !selectedAssetId) return;
    setAiAnalyzing(true);
    setAiContent(null);
    try {
      const result = await api.analyzeAsset({
        libraryId: library.libraryId,
        assetId: selectedAssetId,
      });
      if (!result.ok) {
        setError(toMessage(result.error, 'AI 分析失败。'));
        return;
      }
      if ('reason' in result.value) {
        setNotice(`AI 分析暂不可用：${result.value.reason}`);
        return;
      }
      setAiContent({
        label: result.value.generatedFields.label,
        description: result.value.generatedFields.description,
        tags: result.value.generatedFields.tags,
        structuredMetadata: result.value.generatedFields.structuredMetadata,
        modelVersion: result.value.modelVersion,
      });
      setNotice('AI 分析完成。');
      // Refresh metadata to show updated tags
      if (selectedAssetId) void loadMetadata();
    } finally {
      setAiAnalyzing(false);
    }
  }

  // Handle inline input keydown for tag/collection creation
  function handleTagInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      void createTag();
    } else if (e.key === 'Escape') {
      setShowTagInput(false);
      setTagInputValue('');
    }
  }

  function handleCollectionInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      void createCollection();
    } else if (e.key === 'Escape') {
      setShowCollectionInput(false);
      setCollectionInputValue('');
    }
  }

  return <main className={`app-shell${leftOpen ? '' : ' left-collapsed'}${rightOpen ? '' : ' right-collapsed'}`}>
    <header className="app-toolbar">
      <div className="toolbar-cluster toolbar-leading"><ToolButton icon="menu" label={leftOpen ? '收起导航' : '展开导航'} onClick={() => setLeftOpen((v) => !v)} pressed={leftOpen} /><div className="brand-mark"><span className="brand-glyph">S</span><span>Serpent</span></div></div>
      <div className="scope-trace"><span className="scope-root">资源库</span><Icon name="chevron" size={12} /><span className="scope-chip">{library?.displayName ?? '尚未打开'}</span>{library && <span className="scope-chip scope-chip-muted">{scopeChipLabel()}</span>}</div>
      <div className="toolbar-cluster toolbar-actions"><button className="search-control" disabled><Icon name="search" size={15} /><span>搜索资源库</span><kbd>⌘ K</kbd></button><ToolButton icon="collapse-right" label={rightOpen ? '收起检查器' : '展开检查器'} onClick={() => setRightOpen((v) => !v)} pressed={rightOpen} /></div>
    </header>
    <aside className="navigation-pane"><div className="pane-header"><span>资源导航</span><span className="status-dot" data-active={Boolean(library)} /></div><nav className="navigation-scroll">
      <NavRow active={library ? assetScope === 'all' && !activeTagId && !activeCollectionId && !showTrash : true} count={library ? allAssetCount : undefined} icon="grid" label="所有资产" onClick={() => void chooseFolder('all')} disabled={!library} />
      <NavRow active={Boolean(library && showTrash && !activeTagId && !activeCollectionId)} count={trashedAssets.length || undefined} disabled={!library} icon="trash" label="回收站" onClick={() => void enterTrash()} />
      <NavRow icon="archive" label="最近使用" disabled />
      <Section title="文件夹" action={library ? () => { setDialogValue('新建文件夹'); setDialog('folder'); } : undefined}>
        {library ? <><NavRow active={assetScope === 'root' && !activeTagId && !activeCollectionId} icon="folder" label="资源库根目录" onClick={() => void chooseFolder('root')} />{folders.map((folder) => <NavRow active={assetScope === folder.folderId && !activeTagId && !activeCollectionId} depth={folder.relativePath.split('/').length} icon="folder" key={folder.folderId} label={folder.name} onClick={() => void chooseFolder(folder.folderId)} />)}</> : <p className="nav-empty">打开资源库后显示目录</p>}
      </Section>
      <Section title="标签" action={library ? () => { setShowTagInput(true); setTagInputValue(''); } : undefined}>
        {library ? <>
          {showTagInput && <div className="nav-section"><input autoFocus className="text-field" maxLength={255} onBlur={() => { setShowTagInput(false); setTagInputValue(''); }} onChange={(e) => setTagInputValue(e.target.value)} onKeyDown={handleTagInputKeyDown} placeholder="输入标签名称，回车创建" style={{ height: 27, margin: '2px 0 4px 0', fontSize: 11 }} value={tagInputValue} /></div>}
          {tags.length ? tags.map((tag) => <NavRow active={activeTagId === tag.tagId} icon="tag" key={tag.tagId} label={tag.name} count={tag.assetCount} onContextMenu={(e) => { e.preventDefault(); if (confirm(`删除标签"${tag.name}"？`)) void deleteTag(tag.tagId); }} onClick={() => void chooseTag(tag.tagId)} />) : <p className="nav-empty">尚无标签</p>}
        </> : <p className="nav-empty">打开资源库后显示标签</p>}
      </Section>
      <Section title="合集" action={library ? () => { setShowCollectionInput(true); setCollectionInputValue(''); } : undefined}>
        {library ? <>
          {showCollectionInput && <div className="nav-section"><input autoFocus className="text-field" maxLength={255} onBlur={() => { setShowCollectionInput(false); setCollectionInputValue(''); }} onChange={(e) => setCollectionInputValue(e.target.value)} onKeyDown={handleCollectionInputKeyDown} placeholder="输入合集名称，回车创建" style={{ height: 27, margin: '2px 0 4px 0', fontSize: 11 }} value={collectionInputValue} /></div>}
          {activeCollectionId && <div style={{ padding: '0 5px 2px' }}><label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--tertiary)', cursor: 'pointer' }}><input checked={collectionRecursive} onChange={(e) => { setCollectionRecursive(e.target.checked); if (activeCollectionId) void chooseCollection(activeCollectionId); }} type="checkbox" />包含子合集</label></div>}
          {collections.length ? renderCollectionNodes(null, 0) : <p className="nav-empty">尚无合集</p>}
        </> : <p className="nav-empty">打开资源库后显示合集</p>}
      </Section>
      <Section title="智能合集">
        {library ? (smartCollections.length ? smartCollections.map((sc) => <NavRow active={false} icon="smart" key={sc.collectionId} label={sc.name} disabled />) : <p className="nav-empty">尚无智能合集（切片 0005 启用查询）</p>) : <p className="nav-empty">打开资源库后显示智能合集</p>}
      </Section>
      <Section title="链接文件夹" action={library ? () => void importFolderAsLinked() : undefined}>
        {library ? (linkedFolders.length ? linkedFolders.map((lf) => <NavRow active={assetScope === lf.folderId && !activeTagId && !activeCollectionId} icon={lf.status === 'offline' ? 'warning' : 'link'} key={lf.folderId} label={lf.displayName} count={lf.assetCount} onClick={lf.status === 'offline' ? () => void relinkFolder(lf.folderId) : () => void chooseFolder(lf.folderId)} />) : <p className="nav-empty">链接外部文件夹作为资产来源</p>) : <p className="nav-empty">打开资源库后显示链接文件夹</p>}
      </Section>
    </nav><div className="pane-footer"><span className="storage-pulse" /><span>{library ? '本地资源库 · 已连接' : '本地优先 · 未连接'}</span></div></aside>
    <section className="workspace"><div className="workspace-bar"><div className="workspace-title"><span>{workspaceTitle()}</span><span className="item-count">{library ? `${visibleAssets.length} 项` : '未载入'}</span></div><div className="workspace-tools">
      {library && showTrash ? <><button className="compact-action" disabled={busy} onClick={() => { if (confirm('确定要清空回收站吗？这将永久删除所有超过 30 天的已删除资产。')) void purgeTrash(); }} type="button"><Icon name="trash" size={14} />清空回收站</button>{selectedAsset && <><span className="tool-separator" /><button className="compact-action" disabled={busy} onClick={() => void restoreTrashedAssets([selectedAssetId!])} type="button"><Icon name="upload" size={14} />恢复到原位置</button><button className="compact-action" disabled={busy} onClick={() => { setPermanentDeleteDialog(selectedAsset.assetId); }} type="button"><Icon name="close" size={14} />永久删除</button></>}</> : <>
        {library && selectedAsset && selectedAsset.availability === 'missing' && !selectedAsset.deletedAt && <><button className="compact-action" disabled={busy} onClick={() => void relinkMissingAsset()} type="button"><Icon name="search" size={14} />找回</button><span className="tool-separator" /></>}
        {library && !showTrash && selectedAsset && !selectedAsset.deletedAt && !isLinkedScope && <><button className="compact-action" disabled={busy} onClick={() => { void trashManagedAssets([selectedAssetId!]); }} type="button"><Icon name="trash" size={14} />删除</button></>}
        {library && selectedAsset && selectedAsset.availability === 'available' && !selectedAsset.deletedAt && isLinkedScope && <><span className="tool-separator" /><button className="compact-action" disabled={busy} onClick={() => { setDeleteLinkedDialog({ assetIds: [selectedAssetId!], displayNames: selectedAsset.displayName, deleteSourceFile: false }); }} type="button"><Icon name="link" size={14} />删除（链接）</button></>}
        {library && !showTrash && visibleAssets.some((a) => a.availability === 'missing' && !a.deletedAt) && <><span className="tool-separator" /><button className="compact-action" disabled={busy} onClick={() => void startBatchRelink()} type="button"><Icon name="folder" size={14} />批量重新定位</button></>}
      </>}
      <span className="tool-separator" /><button className="compact-action" disabled={!library || busy} onClick={() => void importAssets('files')} type="button"><Icon name="upload" size={14} />导入文件</button><button className="compact-action" disabled={!library || busy} onClick={() => void importAssets('folder')} type="button"><Icon name="folder" size={14} />导入文件夹</button><button className="compact-action" disabled={!library || busy} onClick={() => void importFolderAsLinked()} type="button"><Icon name="link" size={14} />导入链接文件夹</button><span className="tool-separator" /><button className="compact-action" disabled={!library || busy} onClick={() => setExportDialogOpen(true)} type="button"><Icon name="archive" size={14} />导出资源库</button><button className="compact-action" disabled={busy} onClick={() => void startImport()} type="button"><Icon name="folder" size={14} />导入资源库</button><ToolButton disabled={!library || busy} icon="refresh" label="刷新磁盘变化" onClick={() => void refreshAssets()} /><span className="tool-separator" /><ToolButton icon="grid" label="网格视图" pressed />
      {library && selectedAsset && !showTrash && !selectedAsset.deletedAt && <><span className="tool-separator" /><button className="compact-action" disabled={aiAnalyzing || !aiHasKey} onClick={() => void handleAnalyzeClick()} type="button"><Icon name="smart" size={14} />{aiAnalyzing ? '分析中…' : 'AI 分析'}</button></>}
      {library && <><span className="tool-separator" /><button className="compact-action" onClick={() => { void loadAiConfig(); setAiConfigOpen(true); }} type="button"><Icon name="info" size={14} />AI 设置</button></>}
    </div></div><div className="workspace-canvas">
      {busy && <div className="activity-strip" role="status"><span className="activity-pulse" />{uiState === 'importing' ? '正在安全复制与登记资产…' : '正在同步资源库…'}</div>}
      {exportProgress && exportProgress.phase !== 'complete' && (
        <div className="activity-strip" role="status">
          <span className="activity-pulse" />
          正在导出资源库：{exportProgress.phase === 'snapshot-db' ? '快照数据库…' : exportProgress.phase === 'enumerate' ? '枚举文件…' : `复制中 ${exportProgress.filesProcessed}/${exportProgress.totalFiles} · ${formatBytes(exportProgress.bytesProcessed)}/${formatBytes(exportProgress.totalBytes)}`}
        </div>
      )}
      {importProgress && importProgress.phase !== 'complete' && (
        <div className="activity-strip" role="status">
          <span className="activity-pulse" />
          导入资源库：{importProgress.phase === 'validate' ? '验证中…' : importProgress.phase === 'copy' ? '复制中…' : '打开中…'}
        </div>
      )}
      {library ? visibleAssets.length ? <div className="asset-grid">{visibleAssets.map((asset) => <button className={`asset-card${selectedAssetId === asset.assetId ? ' is-selected' : ''}${asset.availability === 'missing' ? ' is-missing' : ''}${asset.deletedAt ? ' is-trashed' : ''}`} key={asset.assetId} onClick={() => setSelectedAssetId(asset.assetId)} type="button"><div className="asset-preview"><span className="asset-extension">{extension(asset.displayName)}</span>{asset.availability === 'missing' && <span className="missing-banner"><Icon name="warning" size={12} />文件丢失</span>}{asset.deletedAt && <span className="missing-banner" style={{ background: 'var(--raised-2)', color: 'var(--secondary)', bottom: 6, right: 6 }}><Icon name="trash" size={12} />回收站{asset.remainingDays !== null && ` · ${asset.remainingDays}天`}</span>}<Icon name="file" size={28} /></div><div className="asset-caption"><strong title={asset.displayName}>{asset.displayName}</strong>{asset.deletedAt && asset.trashedFromPath ? <span style={{ color: 'var(--tertiary)', fontSize: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={asset.trashedFromPath}>{asset.trashedFromPath}</span> : <span>{formatBytes(asset.byteSize)} · {formatDate(asset.modifiedAt)}</span>}</div></button>)}</div> : <div className="empty-library"><div className="empty-orbit"><Icon name="upload" size={24} /></div><span className="eyebrow">MANAGED ASSETS</span><h1>{selectedFolder ? '这个文件夹还是空的' : '把第一批素材放进来'}</h1><p>文件将复制到清晰可读的 Assets 目录，同时建立稳定的资产身份。</p><div className="empty-actions"><button className="primary-button" onClick={() => void importAssets('files')} type="button">导入文件</button><button className="secondary-button" onClick={() => void importAssets('folder')} type="button">导入文件夹</button></div></div> : <div className="empty-state"><div className="empty-index">01</div><div className="empty-copy"><span className="eyebrow">LOCAL ASSET WORKSPACE</span><h1>从一个本地资源库开始</h1><p>文件、目录与元数据都保留在你掌控的位置。</p><div className="empty-actions"><button className="primary-button" onClick={() => { setDialogValue('我的资源库'); setDialog('library'); }} type="button"><Icon name="plus" size={15} />创建资源库</button><button className="secondary-button" onClick={() => void runLibraryOperation('open')} type="button"><Icon name="folder" size={15} />打开资源库</button></div></div></div>}
      {(error || notice) && <div className={`toast${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}><Icon name={error ? 'warning' : 'info'} size={15} /><span>{error ?? notice}</span><button aria-label="关闭提示" onClick={() => { setError(null); setNotice(null); }} type="button"><Icon name="close" size={13} /></button></div>}
    </div></section>
    <aside className="inspector-pane"><div className="pane-header"><span>检查器</span><ToolButton icon="info" label="检查器信息" /></div>{selectedAsset ? <div className="inspector-content">
      <div className="selected-file-hero"><Icon name="file" size={36} /><span>{extension(selectedAsset.displayName)}</span></div>
      <div className="inspector-identity"><div><span className="micro-label">当前选择</span><strong>{selectedAsset.displayName}</strong></div></div>
      <dl className="metadata-list">
        <div><dt>状态</dt><dd>{selectedAsset.deletedAt ? `回收站（${selectedAsset.remainingDays ?? '?'}天后自动清理）` : selectedAsset.availability === 'available' ? '可用' : '文件丢失'}</dd></div>
        <div><dt>大小</dt><dd className="mono">{formatBytes(selectedAsset.byteSize)}</dd></div>
        <div><dt>修改</dt><dd>{formatDate(selectedAsset.modifiedAt)}</dd></div>
        {selectedAsset.deletedAt && <div><dt>删除时间</dt><dd>{formatDate(selectedAsset.deletedAt)}</dd></div>}
        {selectedAsset.trashedFromPath && <div><dt>原始位置</dt><dd className="mono" style={{ fontSize: 9 }}>{selectedAsset.trashedFromPath}</dd></div>}
      </dl>
      {/* --- Asset metadata editor --- */}
      <section className="inspector-section">
        <h2>元数据</h2>
        {metadataLoading ? <span className="micro-label">加载中…</span> : assetMetadata ? <>
          {versionConflict && <div className="inline-error"><Icon name="warning" size={14} /><div><strong>版本冲突</strong><p>元数据已被其他操作修改。请刷新以获取最新版本。</p><button onClick={() => void loadMetadata()} type="button">刷新元数据</button></div></div>}
          <div className="editor-field">
            <label className="micro-label" htmlFor="meta-label">标签 (Label)</label>
            <input className="text-field" id="meta-label" maxLength={255} onBlur={handleMetadataLabelSave} onChange={handleMetadataLabelInput} onKeyDown={(e) => { if (e.key === 'Enter') handleMetadataLabelSave(); }} style={{ height: 28, fontSize: 11 }} value={editLabel} />
          </div>
          <div className="editor-field" style={{ marginTop: 10 }}>
            <label className="micro-label" htmlFor="meta-desc">描述</label>
            <textarea className="text-field" id="meta-desc" maxLength={10000} onBlur={handleMetadataDescriptionSave} onChange={handleMetadataDescriptionInput} rows={3} style={{ height: 'auto', resize: 'vertical', fontSize: 11, paddingTop: 6 }} value={editDescription} />
          </div>
          <div className="editor-field" style={{ marginTop: 10 }}>
            <label className="micro-label">评分</label>
            <div style={{ display: 'flex', gap: 2, marginTop: 3 }}>
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  aria-label={`${star} 星`}
                  onClick={() => handleRatingClick(star)}
                  style={{ padding: 0, border: 0, background: 'transparent', cursor: 'pointer', color: star <= editRating ? '#d99a3e' : 'var(--tertiary)' }}
                  type="button"
                >
                  <Icon name="star" size={16} />
                </button>
              ))}
              {editRating > 0 && (
                <button
                  aria-label="清除评分"
                  onClick={() => handleRatingClick(0)}
                  style={{ padding: '0 0 0 4px', border: 0, background: 'transparent', color: 'var(--tertiary)', cursor: 'pointer', fontSize: 10 }}
                  type="button"
                >
                  清除
                </button>
              )}
            </div>
          </div>
          <div className="editor-field" style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
            <label className="micro-label" style={{ flex: 1 }}>喜欢</label>
            <button
              aria-label={editFavorite ? '取消喜欢' : '标记喜欢'}
              onClick={handleFavoriteToggle}
              style={{ padding: 2, border: 0, background: 'transparent', cursor: 'pointer', color: editFavorite ? '#e76b7a' : 'var(--tertiary)' }}
              type="button"
            >
              <Icon name="heart" size={18} />
            </button>
          </div>
          <div className="editor-field" style={{ marginTop: 10 }}>
            <label className="micro-label" htmlFor="meta-url">源链接 (URL)</label>
            <input className="text-field" id="meta-url" maxLength={255} onBlur={handleSourceUrlSave} onChange={handleSourceUrlInput} onKeyDown={(e) => { if (e.key === 'Enter') handleSourceUrlSave(); }} placeholder="https://…" style={{ height: 28, fontSize: 11 }} value={editSourceUrl} />
          </div>
          <div className="editor-field" style={{ marginTop: 10 }}>
            <label className="micro-label">色卡 (Palette)</label>
            {assetMetadata.palette ? (
              <div className="path-block" style={{ marginTop: 3, fontSize: 10 }}>{assetMetadata.palette}</div>
            ) : (
              <p style={{ margin: '3px 0 0', color: 'var(--tertiary)', fontSize: 10 }}>无人工色卡（切片 0006 提供编辑）</p>
            )}
          </div>
          <div style={{ marginTop: 8, color: 'var(--tertiary)', fontSize: 9, fontFamily: "'IBM Plex Mono', monospace" }}>
            版本 {assetMetadata.entityVersion} · {formatDate(assetMetadata.updatedAt)}
          </div>
        </> : <p className="nav-empty" style={{ margin: '4px 0 0' }}>选择资产以查看元数据</p>}
      </section>
      <section className="inspector-section"><h2>资源库路径</h2><p className="path-block">{selectedAsset.relativeFilePath}</p></section>
      {/* --- AI Content --- */}
      {aiContent && <section className="inspector-section"><h2 style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 3, background: 'var(--accent, #6c8ee0)', color: '#fff', fontSize: 9, fontWeight: 700, lineHeight: '16px' }}>AI</span>AI 生成内容</h2>
        {aiContent.label && <div className="editor-field" style={{ marginTop: 8 }}><label className="micro-label">标签 (Label) · AI</label><p className="path-block" style={{ color: 'var(--secondary)', fontSize: 11, margin: '2px 0 0' }}>{aiContent.label}</p></div>}
        {aiContent.description && <div className="editor-field" style={{ marginTop: 8 }}><label className="micro-label">描述 · AI</label><p className="path-block" style={{ color: 'var(--secondary)', fontSize: 11, margin: '2px 0 0' }}>{aiContent.description}</p></div>}
        {aiContent.tags && aiContent.tags.length > 0 && <div className="editor-field" style={{ marginTop: 8 }}><label className="micro-label">标签 · AI</label><div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 3 }}>{aiContent.tags.map((tag) => <span className="tag-chip" key={tag}>{tag}</span>)}</div></div>}
        {aiContent.modelVersion && <div style={{ marginTop: 8, color: 'var(--tertiary)', fontSize: 9, fontFamily: "'IBM Plex Mono', monospace" }}>{aiContent.modelVersion}</div>}
      </section>}
    </div> : library ? <div className="inspector-content"><div className="inspector-identity"><div className="inspector-badge">{initials(library.displayName)}</div><div><span className="micro-label">当前资源库</span><strong>{library.displayName}</strong></div></div><dl className="metadata-list"><div><dt>状态</dt><dd><span className="status-dot" data-active="true" />已打开</dd></div><div><dt>资产</dt><dd className="mono">{allAssetCount}</dd></div><div><dt>文件夹</dt><dd className="mono">{folders.length}</dd></div></dl><section className="inspector-section"><h2>位置</h2><p className="path-block">{library.displayPath}</p></section><button className="secondary-button inspector-close-library" onClick={() => void closeLibrary()} type="button">关闭资源库</button></div> : <div className="inspector-empty"><Icon name="info" size={18} /><strong>没有活动资源库</strong><p>打开资源库后查看当前范围与资产详情。</p></div>}</aside>
    {!leftOpen && <button className="pane-reveal pane-reveal-left" onClick={() => setLeftOpen(true)} type="button"><Icon name="collapse-left" size={15} /></button>}{!rightOpen && <button className="pane-reveal pane-reveal-right" onClick={() => setRightOpen(true)} type="button"><Icon name="collapse-right" size={15} /></button>}
    {dialog && <div className="dialog-backdrop" role="presentation"><form aria-labelledby="create-dialog-title" aria-modal="true" className="create-dialog" onSubmit={(event) => { event.preventDefault(); if (!dialogValue.trim()) return; if (dialog === 'library') { setDialog(null); void runLibraryOperation('create'); } else void createFolder(); }} role="dialog"><div className="dialog-heading"><div><span className="eyebrow">{dialog === 'library' ? 'NEW LOCAL LIBRARY' : 'MANAGED FOLDER'}</span><h2 id="create-dialog-title">{dialog === 'library' ? '创建资源库' : '新建文件夹'}</h2></div><button aria-label="取消" className="dialog-close" onClick={() => setDialog(null)} type="button"><Icon name="close" size={16} /></button></div><label className="field-label" htmlFor="dialog-name">名称</label><input autoFocus className="text-field" id="dialog-name" maxLength={255} onChange={(event) => setDialogValue(event.target.value)} value={dialogValue} /><p className="field-help">{dialog === 'library' ? '下一步由系统选择本地保存位置。' : `将在“${selectedFolder?.name ?? '资源库根目录'}”内创建真实目录。`}</p><div className="dialog-actions"><button className="secondary-button" onClick={() => setDialog(null)} type="button">取消</button><button className="primary-button" disabled={!dialogValue.trim()} type="submit">创建</button></div></form></div>}
    {conflicts && <div className="dialog-backdrop" role="presentation"><div aria-labelledby="conflict-dialog-title" aria-modal="true" className="conflict-dialog" role="dialog"><div className="dialog-heading"><div><span className="eyebrow">IMPORT REVIEW</span><h2 id="conflict-dialog-title">处理导入冲突</h2></div></div><div className="conflict-summary"><div><strong>{conflicts.fileCount}</strong><span>待导入文件</span></div><div><strong>{conflicts.suspectedDuplicateCount}</strong><span>疑似重复</span></div><div><strong>{conflicts.nameConflictCount}</strong><span>同名冲突</span></div></div><label className="decision-field"><span>疑似重复</span><select autoFocus value={duplicateDecision} onChange={(event) => setDuplicateDecision(event.target.value as typeof duplicateDecision)}><option value="skip">跳过</option><option value="merge">合并到已有资产</option><option value="create-copy">创建副本</option></select></label><label className="decision-field"><span>同名冲突</span><select value={nameDecision} onChange={(event) => setNameDecision(event.target.value as typeof nameDecision)}><option value="keep-both">保留两者</option><option value="replace">替换现有资产</option><option value="skip">跳过</option></select></label>{conflicts.examples.length > 0 && <div className="conflict-examples">{conflicts.examples.map((item, index) => <span key={`${item.displayName}-${index}`}><Icon name="file" size={13} />{item.displayName}</span>)}</div>}<div className="dialog-actions"><button className="secondary-button" onClick={() => void abandonConflicts()} type="button">取消</button><button className="primary-button" onClick={() => void resolveConflicts()} type="button">应用并导入</button></div></div></div>}
    {exportDialogOpen && <div className="dialog-backdrop" role="presentation"><div aria-modal="true" className="create-dialog" role="dialog"><div className="dialog-heading"><div><span className="eyebrow">EXPORT LIBRARY</span><h2>导出资源库</h2></div><button aria-label="取消" className="dialog-close" onClick={() => setExportDialogOpen(false)} type="button"><Icon name="close" size={16} /></button></div><p style={{ color: 'var(--secondary)', fontSize: 12, lineHeight: 1.6 }}>将资源库导出到指定文件夹。导出内容包括所有托管资产、数据库、修订记录和回收站文件。</p><label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, color: '#c7cac7', fontSize: 12, cursor: 'pointer' }}><input checked={includeLinkedContent} onChange={(e) => setIncludeLinkedContent(e.target.checked)} type="checkbox" />包含链接文件夹源内容</label><div className="dialog-actions"><button className="secondary-button" onClick={() => setExportDialogOpen(false)} type="button">取消</button><button className="primary-button" onClick={() => void exportLibrary()} type="button">选择目标文件夹并导出</button></div></div></div>}
    {importValidated && <div className="dialog-backdrop" role="presentation"><div aria-modal="true" className="create-dialog" role="dialog"><div className="dialog-heading"><div><span className="eyebrow">IMPORT LIBRARY</span><h2>导入资源库</h2></div><button aria-label="取消" className="dialog-close" onClick={() => setImportValidated(null)} type="button"><Icon name="close" size={16} /></button></div><p style={{ color: 'var(--secondary)', fontSize: 12, lineHeight: 1.6 }}>资源库 <strong>{importValidated.displayName}</strong> 验证通过。请选择导入方式：</p><div className="dialog-actions"><button className="secondary-button" onClick={() => setImportValidated(null)} type="button">取消</button><button className="secondary-button" onClick={() => void completeImportInPlace()} type="button">原地打开（不复制）</button><button className="primary-button" onClick={() => void completeImportCopy()} type="button">复制到新位置</button></div></div></div>}
    {permanentDeleteDialog && <div className="dialog-backdrop" role="presentation"><div aria-modal="true" className="create-dialog" role="dialog"><div className="dialog-heading"><div><span className="eyebrow">PERMANENT DELETE</span><h2>永久删除确认</h2></div><button aria-label="取消" className="dialog-close" onClick={() => setPermanentDeleteDialog(null)} type="button"><Icon name="close" size={16} /></button></div><p style={{ color: 'var(--secondary)', fontSize: 12, lineHeight: 1.6 }}>确定要永久删除此资产吗？文件将从回收站彻底移除，此操作不可撤销。</p><div className="dialog-actions"><button className="secondary-button" onClick={() => setPermanentDeleteDialog(null)} type="button">取消</button><button className="primary-button" onClick={() => void deletePermanentFromTrash()} type="button">永久删除</button></div></div></div>}
    {deleteLinkedDialog && <div className="dialog-backdrop" role="presentation"><div aria-modal="true" className="create-dialog" role="dialog"><div className="dialog-heading"><div><span className="eyebrow">DELETE LINKED ASSET</span><h2>删除链接资产</h2></div><button aria-label="取消" className="dialog-close" onClick={() => setDeleteLinkedDialog(null)} type="button"><Icon name="close" size={16} /></button></div><p style={{ color: 'var(--secondary)', fontSize: 12, lineHeight: 1.6 }}>确定要删除链接资产"{deleteLinkedDialog.displayNames}"吗？这只会移除 Serpent 中的记录，不会影响磁盘源文件。</p><label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, color: '#c7cac7', fontSize: 12, cursor: 'pointer' }}><input checked={deleteLinkedDialog.deleteSourceFile} onChange={(e) => setDeleteLinkedDialog({ ...deleteLinkedDialog, deleteSourceFile: e.target.checked })} type="checkbox" />同步删除磁盘源文件（移入系统回收站）</label><div className="dialog-actions"><button className="secondary-button" onClick={() => setDeleteLinkedDialog(null)} type="button">取消</button><button className="primary-button" onClick={() => void executeDeleteLinked()} type="button">删除</button></div></div></div>}
    {batchRelinkPreview && <div className="dialog-backdrop" role="presentation"><div aria-modal="true" className="conflict-dialog" role="dialog"><div className="dialog-heading"><div><span className="eyebrow">BATCH RELINK</span><h2>批量重新定位预览</h2></div><button aria-label="取消" className="dialog-close" onClick={() => setBatchRelinkPreview(null)} type="button"><Icon name="close" size={16} /></button></div><div className="conflict-summary" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}><div><strong>{batchRelinkPreview.totalCount}</strong><span>总计丢失</span></div><div><strong>{batchRelinkPreview.matchedCount}</strong><span>新位置匹配</span></div><div><strong>{batchRelinkPreview.unmatchedCount}</strong><span>未找到</span></div></div>{batchRelinkPreview.examples.length > 0 && <div className="conflict-examples">{batchRelinkPreview.examples.map((item, index) => <span key={`${item.relativeFilePath}-${index}`} style={{ color: item.matched ? 'var(--accent)' : 'var(--warning)' }}><Icon name={item.matched ? 'file' : 'warning'} size={13} />{item.relativeFilePath}</span>)}</div>}<label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, color: '#c7cac7', fontSize: 12, cursor: 'pointer' }}><input checked={batchRelinkKeepMetadata} onChange={(e) => setBatchRelinkKeepMetadata(e.target.checked)} type="checkbox" />沿用原资产信息（保留标签、描述、评分、合集等人工元数据）</label><div className="dialog-actions"><button className="secondary-button" onClick={() => setBatchRelinkPreview(null)} type="button">取消</button><button className="primary-button" disabled={batchRelinkPreview.matchedCount === 0} onClick={() => void applyBatchRelink()} type="button">应用批量重新定位</button></div></div></div>}
    {aiConfigOpen && <div className="dialog-backdrop" role="presentation"><div aria-modal="true" className="create-dialog" role="dialog"><div className="dialog-heading"><div><span className="eyebrow">AI CONFIGURATION</span><h2>AI 配置 (BYOK)</h2></div><button aria-label="取消" className="dialog-close" onClick={() => { setAiConfigOpen(false); setAiApiKey(''); }} type="button"><Icon name="close" size={16} /></button></div><p style={{ color: 'var(--secondary)', fontSize: 12, lineHeight: 1.6 }}>配置第三方云端视觉模型 API Key。Key 将加密存储于本地操作系统安全凭据中，Serpent 不代理、不计费、不追踪额度。</p>
      <div className="editor-field" style={{ marginTop: 12 }}>
        <label className="micro-label">供应商</label>
        <select className="text-field" onChange={(e) => setAiProvider(e.target.value as 'openai' | 'gemini' | 'anthropic')} style={{ height: 30, fontSize: 12, marginTop: 3 }} value={aiProvider}>
          <option value="openai">OpenAI (GPT-4o / GPT-4o-mini)</option>
          <option disabled value="gemini">Gemini（切片 0009 后续实现）</option>
          <option disabled value="anthropic">Anthropic（切片 0009 后续实现）</option>
        </select>
      </div>
      <div className="editor-field" style={{ marginTop: 10 }}>
        <label className="micro-label">模型</label>
        <input className="text-field" maxLength={255} onChange={(e) => setAiModel(e.target.value)} placeholder="gpt-4o-mini" style={{ height: 28, fontSize: 11, marginTop: 3 }} value={aiModel} />
      </div>
      <div className="editor-field" style={{ marginTop: 10 }}>
        <label className="micro-label">API Key</label>
        <input className="text-field" maxLength={512} onChange={(e) => setAiApiKey(e.target.value)} placeholder={aiHasKey ? '（已配置，重新输入可覆盖）' : 'sk-…'} style={{ height: 28, fontSize: 11, marginTop: 3 }} type="password" value={aiApiKey} />
      </div>
      <div className="editor-field" style={{ marginTop: 10 }}>
        <label className="micro-label">语言</label>
        <input className="text-field" maxLength={35} onChange={(e) => setAiLanguage(e.target.value)} placeholder="auto (跟随系统)" style={{ height: 28, fontSize: 11, marginTop: 3 }} value={aiLanguage} />
      </div>
      <div style={{ marginTop: 14 }}>
        <label className="micro-label" style={{ marginBottom: 5, display: 'block' }}>AI 写入开关（按字段）</label>
        {([
          { key: 'label', label: '标签 (Label)', state: aiLabelEnabled, setter: setAiLabelEnabled },
          { key: 'description', label: '描述', state: aiDescriptionEnabled, setter: setAiDescriptionEnabled },
          { key: 'tags', label: '标签 (Tags)', state: aiTagsEnabled, setter: setAiTagsEnabled },
          { key: 'structured', label: '结构化元信息', state: aiStructuredEnabled, setter: setAiStructuredEnabled },
        ] as const).map((field) => (
          <label key={field.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', color: '#c7cac7', fontSize: 12, cursor: 'pointer' }}>
            <input checked={field.state} onChange={(e) => field.setter(e.target.checked)} type="checkbox" />
            {field.label}
          </label>
        ))}
      </div>
      <div className="dialog-actions" style={{ marginTop: 14 }}>
        <button className="secondary-button" onClick={() => { setAiConfigOpen(false); setAiApiKey(''); }} type="button">取消</button>
        <button className="primary-button" disabled={!aiApiKey.trim() && !aiHasKey} onClick={() => void saveAiConfig()} type="button">保存配置</button>
      </div></div></div>}
  </main>;
}

function initials(value: string) { return value.trim().slice(0, 2).toUpperCase() || 'SP'; }
function extension(name: string) { const value = name.split('.').pop(); return value && value !== name ? value.slice(0, 5).toUpperCase() : 'FILE'; }
function formatBytes(bytes: number) { if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`; if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`; return `${(bytes / 1024 ** 3).toFixed(1)} GB`; }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.valueOf()) ? '未知时间' : new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(date); }
function importSummary(value: { importedCount: number; skippedCount: number; replacedCount: number }) { return `导入完成：新增 ${value.importedCount} 项${value.replacedCount ? `，替换 ${value.replacedCount} 项` : ''}${value.skippedCount ? `，跳过 ${value.skippedCount} 项` : ''}。`; }
function toMessage(error: unknown, fallback: string) {
  if (error instanceof LibraryOperationError) {
    const message = PUBLIC_ERROR_MESSAGES_ZH[error.code] ?? fallback;
    const reason = error.reason ? PUBLIC_ERROR_REASONS_ZH[error.reason] : undefined;
    return reason ? `${message} 原因：${reason}` : message;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

const PUBLIC_ERROR_MESSAGES_ZH: Partial<Record<PublicErrorCode, string>> = {
  CANCELLED: '操作已取消。', INTERNAL_ERROR: 'Serpent 无法完成这项操作，请重试。', INVALID_LIBRARY_NAME: '请输入可跨平台安全使用的资源库名称。', INVALID_LIBRARY_PATH: '请选择有效的本地文件夹。', INVALID_FOLDER_NAME: '请输入可跨平台安全使用的文件夹名称。', FOLDER_ALREADY_EXISTS: '当前位置已经存在同名文件夹。', FOLDER_NOT_FOUND: '找不到所选资源库文件夹。', INVALID_IMPORT_SOURCE: '无法读取所选导入内容。', INVALID_IMPORT_DECISION: '导入冲突处理选项无效。', IMPORT_NOT_FOUND: '待处理的导入已失效，请重新选择文件。', IMPORT_APPLY_FAILED: '无法安全完成导入。', LIBRARY_ALREADY_EXISTS: '该位置已经存在同名文件或文件夹。', LIBRARY_NOT_FOUND: '找不到所选资源库。', NOT_A_LIBRARY: '所选文件夹不是有效的 Serpent 资源库。', LIBRARY_CORRUPT: '资源库数据库或迁移记录已损坏。', LIBRARY_VERSION_TOO_NEW: '该资源库由更新版本的 Serpent 创建。', LIBRARY_NOT_WRITABLE: 'Serpent 无法写入所选位置。', LIBRARY_CLEANUP_FAILED: '创建失败，且临时文件无法自动清理。', LIBRARY_NOT_OPEN: '该资源库当前没有打开。', ASSET_NOT_FOUND: '找不到所选资产。', VERSION_CONFLICT: '元数据已被其他操作修改。请刷新后重新编辑。',
};
const PUBLIC_ERROR_REASONS_ZH: Record<PublicErrorReason, string> = {
  PERMISSION_DENIED: '当前用户没有读取源文件或写入目标位置的权限。',
  PATH_LIMIT_EXCEEDED: '目标文件系统拒绝了该路径或名称长度。',
  DISK_FULL: '目标磁盘空间不足。',
  READ_ONLY_FILESYSTEM: '目标位置位于只读文件系统。',
  SOURCE_NOT_FOUND: '源文件在导入过程中消失或无法找到。',
  SOURCE_CHANGED: '源文件在复制过程中发生了变化。',
  SYMBOLIC_LINK_NOT_ALLOWED: '目录中包含当前切片不支持的符号链接。',
  UNSUPPORTED_FILE_ENTRY: '目录中包含普通文件和文件夹之外的项目。',
  NAME_NOT_SUPPORTED: '当前目标文件系统不接受其中的文件名。',
  IO_ERROR: '操作系统报告了磁盘读写错误。',
};
class LibraryOperationError extends Error {
  readonly code: PublicError['code'];
  readonly reason?: PublicErrorReason;
  constructor(error: PublicError) {
    super(error.message);
    this.code = error.code;
    this.reason = error.reason;
  }
}
