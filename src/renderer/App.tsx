import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import type { AssetSummary, ManagedFolderSummary } from '../shared/asset-types';
import type { SerpentLibraryApi } from '../shared/library-api';
import type { PublicError, PublicErrorCode, PublicErrorReason } from '../shared/protocol/errors';
import type { ImportConflictPlan, RendererLibrarySummary } from '../shared/protocol/responses';

type RendererWindow = Window & { serpent?: { library?: SerpentLibraryApi } };
type UiState = 'booting' | 'idle' | 'creating' | 'opening' | 'closing' | 'loading' | 'importing' | 'ready';
type DialogKind = 'library' | 'folder' | null;
type AssetScope = 'all' | 'root' | string;
type IconName = 'archive' | 'chevron' | 'close' | 'collection' | 'collapse-left' | 'collapse-right' | 'file' | 'folder' | 'grid' | 'info' | 'link' | 'menu' | 'plus' | 'refresh' | 'search' | 'smart' | 'tag' | 'upload' | 'warning';

const iconPaths: Record<IconName, ReactNode> = {
  archive: <><path d="M4 7h16v12H4z" /><path d="M3 4h18v3H3zM9 11h6" /></>, chevron: <path d="m9 18 6-6-6-6" />,
  close: <path d="m7 7 10 10M17 7 7 17" />, collection: <><rect x="4" y="5" width="16" height="14" rx="1.5" /><path d="m8 14 3-3 5 5 2-2 2 2" /></>,
  'collapse-left': <><path d="M5 4h14v16H5zM10 4v16" /><path d="m15 9-3 3 3 3" /></>, 'collapse-right': <><path d="M5 4h14v16H5zM14 4v16" /><path d="m9 9 3 3-3 3" /></>,
  file: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5" /></>, folder: <path d="M3 6.5h7l2 2h9v10H3z" />,
  grid: <><rect x="4" y="4" width="6" height="6" /><rect x="14" y="4" width="6" height="6" /><rect x="4" y="14" width="6" height="6" /><rect x="14" y="14" width="6" height="6" /></>, info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></>,
  link: <><path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2" /><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2" /></>, menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  plus: <path d="M12 5v14M5 12h14" />, refresh: <><path d="M20 7v5h-5" /><path d="M18.4 16a8 8 0 1 1 1.3-8.5L20 12" /></>, search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></>,
  smart: <path d="m12 3 1.7 5.3H19l-4.3 3.2 1.6 5.2-4.3-3.2-4.3 3.2 1.6-5.2L5 8.3h5.3z" />, tag: <path d="M4 5h7l9 9-6 6-9-9zM8 8h.01" />,
  upload: <><path d="M12 16V4m0 0L7 9m5-5 5 5" /><path d="M4 14v6h16v-6" /></>, warning: <><path d="M12 3 2.8 20h18.4z" /><path d="M12 9v5m0 3h.01" /></>,
};

function Icon({ name, size = 16 }: { name: IconName; size?: number }) { return <svg aria-hidden="true" className="icon" viewBox="0 0 24 24" width={size} height={size}>{iconPaths[name]}</svg>; }
function ToolButton({ label, icon, onClick, pressed, disabled }: { label: string; icon: IconName; onClick?: () => void; pressed?: boolean; disabled?: boolean }) { return <button aria-label={label} aria-pressed={pressed} className="tool-button" disabled={disabled} onClick={onClick} title={label} type="button"><Icon name={icon} /></button>; }
function NavRow({ icon, label, count, active, onClick, depth = 0, disabled }: { icon: IconName; label: string; count?: number; active?: boolean; onClick?: () => void; depth?: number; disabled?: boolean }) { return <button className={`nav-row${active ? ' is-active' : ''}`} disabled={disabled} onClick={onClick} style={{ paddingLeft: 7 + depth * 14 }} type="button"><Icon name={icon} size={15} /><span>{label}</span>{count !== undefined && <span className="nav-count">{count}</span>}</button>; }
function Section({ title, action, children }: { title: string; action?: () => void; children: ReactNode }) { return <section className="nav-section"><div className="nav-section-heading"><span>{title}</span>{action && <button aria-label={`添加${title}`} className="tiny-action" onClick={action} type="button"><Icon name="plus" size={13} /></button>}</div>{children}</section>; }

export function App() {
  const api = (window as RendererWindow).serpent?.library;
  const [library, setLibrary] = useState<RendererLibrarySummary | null>(null);
  const [folders, setFolders] = useState<ManagedFolderSummary[]>([]);
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

  const selectedFolderId = assetScope === 'all' || assetScope === 'root' ? undefined : assetScope;
  const selectedFolder = folders.find((folder) => folder.folderId === selectedFolderId);
  const selectedAsset = assets.find((asset) => asset.assetId === selectedAssetId);
  const visibleAssets = useMemo(() => assets, [assets]);

  const loadContent = useCallback(async (activeLibrary: RendererLibrarySummary, scope: AssetScope) => {
    if (!api) return;
    const scopedRequest = scope === 'all'
      ? { libraryId: activeLibrary.libraryId, recursive: true }
      : scope === 'root'
        ? { libraryId: activeLibrary.libraryId, recursive: false }
        : { libraryId: activeLibrary.libraryId, folderId: scope, recursive: false };
    const [folderResult, assetResult, allResult] = await Promise.all([
      api.listFolders({ libraryId: activeLibrary.libraryId }),
      api.listAssets(scopedRequest),
      scope === 'all'
        ? Promise.resolve(undefined)
        : api.listAssets({ libraryId: activeLibrary.libraryId, recursive: true }),
    ]);
    if (!folderResult.ok) throw new LibraryOperationError(folderResult.error);
    if (!assetResult.ok) throw new LibraryOperationError(assetResult.error);
    if (allResult && !allResult.ok) throw new LibraryOperationError(allResult.error);
    setFolders(folderResult.value);
    setAssets(assetResult.value);
    setAllAssetCount(allResult?.value.length ?? assetResult.value.length);
  }, [api]);

  const restore = useCallback(async () => {
    if (!api) { setError('无法连接到 Serpent 桌面服务。请重新启动应用。'); setUiState('idle'); return; }
    let activeLibrary: RendererLibrarySummary | null = null;
    try {
      const result = await api.listOpen();
      if (!result.ok) throw new LibraryOperationError(result.error);
      activeLibrary = result.value[0] ?? null;
      setLibrary(activeLibrary);
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
      await loadContent(result.value, 'all');
    } catch (caught) {
      setError(toMessage(caught, '资源库操作失败。'));
    } finally {
      setUiState(opened ? 'ready' : 'idle');
    }
  }

  async function chooseFolder(scope: AssetScope) {
    if (!library) return;
    setAssetScope(scope);
    setSelectedAssetId(undefined);
    setUiState('loading');
    try {
      await loadContent(library, scope);
    } catch (caught) {
      setError(toMessage(caught, '无法读取资产。'));
    } finally {
      setUiState('ready');
    }
  }

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
      setAssets([]);
      setAllAssetCount(0);
      setAssetScope('all');
    } catch (caught) {
      setError(toMessage(caught, '关闭失败。'));
    } finally {
      setUiState(closed ? 'idle' : 'ready');
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
    if (!dialog && !conflicts) return;
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
      if (dialog) {
        setDialog(null);
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
  }, [api, conflicts, dialog]);

  const busy = ['booting', 'creating', 'opening', 'closing', 'loading', 'importing'].includes(uiState);
  return <main className={`app-shell${leftOpen ? '' : ' left-collapsed'}${rightOpen ? '' : ' right-collapsed'}`}>
    <header className="app-toolbar">
      <div className="toolbar-cluster toolbar-leading"><ToolButton icon="menu" label={leftOpen ? '收起导航' : '展开导航'} onClick={() => setLeftOpen((v) => !v)} pressed={leftOpen} /><div className="brand-mark"><span className="brand-glyph">S</span><span>Serpent</span></div></div>
      <div className="scope-trace"><span className="scope-root">资源库</span><Icon name="chevron" size={12} /><span className="scope-chip">{library?.displayName ?? '尚未打开'}</span>{library && <span className="scope-chip scope-chip-muted">{assetScope === 'all' ? '所有资产' : assetScope === 'root' ? '资源库根目录' : selectedFolder?.name}</span>}</div>
      <div className="toolbar-cluster toolbar-actions"><button className="search-control" disabled><Icon name="search" size={15} /><span>搜索资源库</span><kbd>⌘ K</kbd></button><ToolButton icon="collapse-right" label={rightOpen ? '收起检查器' : '展开检查器'} onClick={() => setRightOpen((v) => !v)} pressed={rightOpen} /></div>
    </header>
    <aside className="navigation-pane"><div className="pane-header"><span>资源导航</span><span className="status-dot" data-active={Boolean(library)} /></div><nav className="navigation-scroll">
      <NavRow active={library ? assetScope === 'all' : true} count={library ? allAssetCount : undefined} icon="grid" label="所有资产" onClick={() => void chooseFolder('all')} disabled={!library} />
      <NavRow icon="archive" label="最近使用" disabled />
      <Section title="文件夹" action={library ? () => { setDialogValue('新建文件夹'); setDialog('folder'); } : undefined}>
        {library ? <><NavRow active={assetScope === 'root'} icon="folder" label="资源库根目录" onClick={() => void chooseFolder('root')} />{folders.map((folder) => <NavRow active={assetScope === folder.folderId} depth={folder.relativePath.split('/').length} icon="folder" key={folder.folderId} label={folder.name} onClick={() => void chooseFolder(folder.folderId)} />)}</> : <p className="nav-empty">打开资源库后显示目录</p>}
      </Section>
      <Section title="合集"><p className="nav-empty">跨文件夹分类将在后续切片提供</p></Section><Section title="其他"><NavRow disabled icon="tag" label="标签" /><NavRow disabled icon="link" label="链接文件夹" /></Section>
    </nav><div className="pane-footer"><span className="storage-pulse" /><span>{library ? '本地资源库 · 已连接' : '本地优先 · 未连接'}</span></div></aside>
    <section className="workspace"><div className="workspace-bar"><div className="workspace-title"><span>{library ? assetScope === 'all' ? '所有资产' : assetScope === 'root' ? '资源库根目录' : selectedFolder?.name : '工作区'}</span><span className="item-count">{library ? `${visibleAssets.length} 项` : '未载入'}</span></div><div className="workspace-tools">
      <button className="compact-action" disabled={!library || busy} onClick={() => void importAssets('files')} type="button"><Icon name="upload" size={14} />导入文件</button><button className="compact-action" disabled={!library || busy} onClick={() => void importAssets('folder')} type="button"><Icon name="folder" size={14} />导入文件夹</button><ToolButton disabled={!library || busy} icon="refresh" label="刷新磁盘变化" onClick={() => void refreshAssets()} /><span className="tool-separator" /><ToolButton icon="grid" label="网格视图" pressed />
    </div></div><div className="workspace-canvas">
      {busy && <div className="activity-strip" role="status"><span className="activity-pulse" />{uiState === 'importing' ? '正在安全复制与登记资产…' : '正在同步资源库…'}</div>}
      {library ? visibleAssets.length ? <div className="asset-grid">{visibleAssets.map((asset) => <button className={`asset-card${selectedAssetId === asset.assetId ? ' is-selected' : ''}${asset.availability === 'missing' ? ' is-missing' : ''}`} key={asset.assetId} onClick={() => setSelectedAssetId(asset.assetId)} type="button"><div className="asset-preview"><span className="asset-extension">{extension(asset.displayName)}</span>{asset.availability === 'missing' && <span className="missing-banner"><Icon name="warning" size={12} />文件丢失</span>}<Icon name="file" size={28} /></div><div className="asset-caption"><strong title={asset.displayName}>{asset.displayName}</strong><span>{formatBytes(asset.byteSize)} · {formatDate(asset.modifiedAt)}</span></div></button>)}</div> : <div className="empty-library"><div className="empty-orbit"><Icon name="upload" size={24} /></div><span className="eyebrow">MANAGED ASSETS</span><h1>{selectedFolder ? '这个文件夹还是空的' : '把第一批素材放进来'}</h1><p>文件将复制到清晰可读的 Assets 目录，同时建立稳定的资产身份。</p><div className="empty-actions"><button className="primary-button" onClick={() => void importAssets('files')} type="button">导入文件</button><button className="secondary-button" onClick={() => void importAssets('folder')} type="button">导入文件夹</button></div></div> : <div className="empty-state"><div className="empty-index">01</div><div className="empty-copy"><span className="eyebrow">LOCAL ASSET WORKSPACE</span><h1>从一个本地资源库开始</h1><p>文件、目录与元数据都保留在你掌控的位置。</p><div className="empty-actions"><button className="primary-button" onClick={() => { setDialogValue('我的资源库'); setDialog('library'); }} type="button"><Icon name="plus" size={15} />创建资源库</button><button className="secondary-button" onClick={() => void runLibraryOperation('open')} type="button"><Icon name="folder" size={15} />打开资源库</button></div></div></div>}
      {(error || notice) && <div className={`toast${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}><Icon name={error ? 'warning' : 'info'} size={15} /><span>{error ?? notice}</span><button aria-label="关闭提示" onClick={() => { setError(null); setNotice(null); }} type="button"><Icon name="close" size={13} /></button></div>}
    </div></section>
    <aside className="inspector-pane"><div className="pane-header"><span>检查器</span><ToolButton icon="info" label="检查器信息" /></div>{selectedAsset ? <div className="inspector-content"><div className="selected-file-hero"><Icon name="file" size={36} /><span>{extension(selectedAsset.displayName)}</span></div><div className="inspector-identity"><div><span className="micro-label">当前选择</span><strong>{selectedAsset.displayName}</strong></div></div><dl className="metadata-list"><div><dt>状态</dt><dd>{selectedAsset.availability === 'available' ? '可用' : '文件丢失'}</dd></div><div><dt>大小</dt><dd className="mono">{formatBytes(selectedAsset.byteSize)}</dd></div><div><dt>修改</dt><dd>{formatDate(selectedAsset.modifiedAt)}</dd></div></dl><section className="inspector-section"><h2>资源库路径</h2><p className="path-block">{selectedAsset.relativeFilePath}</p></section></div> : library ? <div className="inspector-content"><div className="inspector-identity"><div className="inspector-badge">{initials(library.displayName)}</div><div><span className="micro-label">当前资源库</span><strong>{library.displayName}</strong></div></div><dl className="metadata-list"><div><dt>状态</dt><dd><span className="status-dot" data-active="true" />已打开</dd></div><div><dt>资产</dt><dd className="mono">{allAssetCount}</dd></div><div><dt>文件夹</dt><dd className="mono">{folders.length}</dd></div></dl><section className="inspector-section"><h2>位置</h2><p className="path-block">{library.displayPath}</p></section><button className="secondary-button inspector-close-library" onClick={() => void closeLibrary()} type="button">关闭资源库</button></div> : <div className="inspector-empty"><Icon name="info" size={18} /><strong>没有活动资源库</strong><p>打开资源库后查看当前范围与资产详情。</p></div>}</aside>
    {!leftOpen && <button className="pane-reveal pane-reveal-left" onClick={() => setLeftOpen(true)} type="button"><Icon name="collapse-left" size={15} /></button>}{!rightOpen && <button className="pane-reveal pane-reveal-right" onClick={() => setRightOpen(true)} type="button"><Icon name="collapse-right" size={15} /></button>}
    {dialog && <div className="dialog-backdrop" role="presentation"><form aria-labelledby="create-dialog-title" aria-modal="true" className="create-dialog" onSubmit={(event) => { event.preventDefault(); if (!dialogValue.trim()) return; if (dialog === 'library') { setDialog(null); void runLibraryOperation('create'); } else void createFolder(); }} role="dialog"><div className="dialog-heading"><div><span className="eyebrow">{dialog === 'library' ? 'NEW LOCAL LIBRARY' : 'MANAGED FOLDER'}</span><h2 id="create-dialog-title">{dialog === 'library' ? '创建资源库' : '新建文件夹'}</h2></div><button aria-label="取消" className="dialog-close" onClick={() => setDialog(null)} type="button"><Icon name="close" size={16} /></button></div><label className="field-label" htmlFor="dialog-name">名称</label><input autoFocus className="text-field" id="dialog-name" maxLength={255} onChange={(event) => setDialogValue(event.target.value)} value={dialogValue} /><p className="field-help">{dialog === 'library' ? '下一步由系统选择本地保存位置。' : `将在“${selectedFolder?.name ?? '资源库根目录'}”内创建真实目录。`}</p><div className="dialog-actions"><button className="secondary-button" onClick={() => setDialog(null)} type="button">取消</button><button className="primary-button" disabled={!dialogValue.trim()} type="submit">创建</button></div></form></div>}
    {conflicts && <div className="dialog-backdrop" role="presentation"><div aria-labelledby="conflict-dialog-title" aria-modal="true" className="conflict-dialog" role="dialog"><div className="dialog-heading"><div><span className="eyebrow">IMPORT REVIEW</span><h2 id="conflict-dialog-title">处理导入冲突</h2></div></div><div className="conflict-summary"><div><strong>{conflicts.fileCount}</strong><span>待导入文件</span></div><div><strong>{conflicts.suspectedDuplicateCount}</strong><span>疑似重复</span></div><div><strong>{conflicts.nameConflictCount}</strong><span>同名冲突</span></div></div><label className="decision-field"><span>疑似重复</span><select autoFocus value={duplicateDecision} onChange={(event) => setDuplicateDecision(event.target.value as typeof duplicateDecision)}><option value="skip">跳过</option><option value="merge">合并到已有资产</option><option value="create-copy">创建副本</option></select></label><label className="decision-field"><span>同名冲突</span><select value={nameDecision} onChange={(event) => setNameDecision(event.target.value as typeof nameDecision)}><option value="keep-both">保留两者</option><option value="replace">替换现有资产</option><option value="skip">跳过</option></select></label>{conflicts.examples.length > 0 && <div className="conflict-examples">{conflicts.examples.map((item, index) => <span key={`${item.displayName}-${index}`}><Icon name="file" size={13} />{item.displayName}</span>)}</div>}<div className="dialog-actions"><button className="secondary-button" onClick={() => void abandonConflicts()} type="button">取消</button><button className="primary-button" onClick={() => void resolveConflicts()} type="button">应用并导入</button></div></div></div>}
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
  CANCELLED: '操作已取消。', INTERNAL_ERROR: 'Serpent 无法完成这项操作，请重试。', INVALID_LIBRARY_NAME: '请输入可跨平台安全使用的资源库名称。', INVALID_LIBRARY_PATH: '请选择有效的本地文件夹。', INVALID_FOLDER_NAME: '请输入可跨平台安全使用的文件夹名称。', FOLDER_ALREADY_EXISTS: '当前位置已经存在同名文件夹。', FOLDER_NOT_FOUND: '找不到所选资源库文件夹。', INVALID_IMPORT_SOURCE: '无法读取所选导入内容。', INVALID_IMPORT_DECISION: '导入冲突处理选项无效。', IMPORT_NOT_FOUND: '待处理的导入已失效，请重新选择文件。', IMPORT_APPLY_FAILED: '无法安全完成导入。', LIBRARY_ALREADY_EXISTS: '该位置已经存在同名文件或文件夹。', LIBRARY_NOT_FOUND: '找不到所选资源库。', NOT_A_LIBRARY: '所选文件夹不是有效的 Serpent 资源库。', LIBRARY_CORRUPT: '资源库数据库或迁移记录已损坏。', LIBRARY_VERSION_TOO_NEW: '该资源库由更新版本的 Serpent 创建。', LIBRARY_NOT_WRITABLE: 'Serpent 无法写入所选位置。', LIBRARY_CLEANUP_FAILED: '创建失败，且临时文件无法自动清理。', LIBRARY_NOT_OPEN: '该资源库当前没有打开。',
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
