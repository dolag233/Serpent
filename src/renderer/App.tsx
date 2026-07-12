import { useCallback, useEffect, useState, type ReactNode } from 'react';

import type { SerpentLibraryApi } from '../shared/library-api';
import type { PublicError, PublicErrorCode } from '../shared/protocol/errors';
import type { RendererLibrarySummary } from '../shared/protocol/responses';

type LibraryRecord = RendererLibrarySummary;

type RendererWindow = Window & {
  serpent?: { library?: SerpentLibraryApi };
};

type UiState = 'booting' | 'idle' | 'creating' | 'opening' | 'closing' | 'ready';

type IconName =
  | 'archive'
  | 'chevron'
  | 'close'
  | 'collection'
  | 'collapse-left'
  | 'collapse-right'
  | 'folder'
  | 'grid'
  | 'info'
  | 'link'
  | 'menu'
  | 'plus'
  | 'search'
  | 'smart'
  | 'tag';

const iconPaths: Record<IconName, ReactNode> = {
  archive: <><path d="M4 7h16v12H4z" /><path d="M3 4h18v3H3zM9 11h6" /></>,
  chevron: <path d="m9 18 6-6-6-6" />,
  close: <path d="m7 7 10 10M17 7 7 17" />,
  collection: <><rect x="4" y="5" width="16" height="14" rx="1.5" /><path d="m8 14 3-3 5 5 2-2 2 2M8 8h.01" /></>,
  'collapse-left': <><path d="M5 4h14v16H5zM10 4v16" /><path d="m15 9-3 3 3 3" /></>,
  'collapse-right': <><path d="M5 4h14v16H5zM14 4v16" /><path d="m9 9 3 3-3 3" /></>,
  folder: <path d="M3 6.5h7l2 2h9v10H3z" />,
  grid: <><rect x="4" y="4" width="6" height="6" /><rect x="14" y="4" width="6" height="6" /><rect x="4" y="14" width="6" height="6" /><rect x="14" y="14" width="6" height="6" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></>,
  link: <><path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2" /><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  plus: <path d="M12 5v14M5 12h14" />,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></>,
  smart: <path d="m12 3 1.7 5.3H19l-4.3 3.2 1.6 5.2-4.3-3.2-4.3 3.2 1.6-5.2L5 8.3h5.3z" />,
  tag: <path d="M4 5h7l9 9-6 6-9-9zM8 8h.01" />,
};

function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg aria-hidden="true" className="icon" viewBox="0 0 24 24" width={size} height={size}>
      {iconPaths[name]}
    </svg>
  );
}

function ToolButton({
  label,
  icon,
  onClick,
  pressed,
}: {
  label: string;
  icon: IconName;
  onClick?: () => void;
  pressed?: boolean;
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={pressed}
      className="tool-button"
      onClick={onClick}
      title={label}
      type="button"
    >
      <Icon name={icon} />
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="nav-section">
      <div className="nav-section-heading">
        <span>{title}</span>
        <button aria-label={`添加${title}`} className="tiny-action" type="button">
          <Icon name="plus" size={13} />
        </button>
      </div>
      {children}
    </section>
  );
}

function NavRow({
  icon,
  label,
  count,
  active,
  disabled,
}: {
  icon: IconName;
  label: string;
  count?: string;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button className={`nav-row${active ? ' is-active' : ''}`} disabled={disabled} type="button">
      <Icon name={icon} size={15} />
      <span>{label}</span>
      {count && <span className="nav-count">{count}</span>}
    </button>
  );
}

function EmptyNavigation() {
  return (
    <>
      <NavRow active icon="grid" label="所有资产" />
      <NavRow disabled icon="archive" label="最近使用" />
      <Section title="文件夹">
        <p className="nav-empty">打开资源库后显示目录</p>
      </Section>
      <Section title="合集">
        <p className="nav-empty">尚无可用合集</p>
      </Section>
      <Section title="智能合集">
        <p className="nav-empty">保存的查询将显示在这里</p>
      </Section>
      <Section title="其他">
        <NavRow disabled icon="tag" label="标签" />
        <NavRow disabled icon="link" label="链接文件夹" />
      </Section>
    </>
  );
}

function ReadyNavigation() {
  return (
    <>
      <NavRow active count="0" icon="grid" label="所有资产" />
      <NavRow count="0" icon="archive" label="最近使用" />
      <Section title="文件夹">
        <NavRow count="0" icon="folder" label="资源库根目录" />
      </Section>
      <Section title="合集">
        <p className="nav-empty">创建合集以跨文件夹分类</p>
      </Section>
      <Section title="智能合集">
        <p className="nav-empty">暂无保存的查询</p>
      </Section>
      <Section title="其他">
        <NavRow count="0" icon="tag" label="标签" />
        <NavRow count="0" icon="link" label="链接文件夹" />
      </Section>
    </>
  );
}

function LoadingMark() {
  return (
    <div aria-hidden="true" className="loading-mark">
      <span />
      <span />
      <span />
    </div>
  );
}

export function App() {
  const [library, setLibrary] = useState<LibraryRecord | null>(null);
  const [uiState, setUiState] = useState<UiState>('booting');
  const [error, setError] = useState<string | null>(null);
  const [leftOpen, setLeftOpen] = useState(() => window.innerWidth > 800);
  const [rightOpen, setRightOpen] = useState(() => window.innerWidth > 1020);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [libraryName, setLibraryName] = useState('我的资源库');

  const api = (window as RendererWindow).serpent?.library;

  const refresh = useCallback(async () => {
    if (!api) {
      setError('无法连接到 Serpent 桌面服务。请重新启动应用。');
      setUiState('idle');
      return;
    }

    setUiState('booting');
    try {
      const result = await api.listOpen();
      if (!result.ok) throw new LibraryOperationError(result.error);
      setLibrary(result.value[0] ?? null);
      setError(null);
      setUiState(result.value.length > 0 ? 'ready' : 'idle');
    } catch (caught) {
      setError(toMessage(caught, '无法读取已打开的资源库。'));
      setUiState('idle');
    }
  }, [api]);

  useEffect(() => {
    void Promise.resolve().then(refresh);
  }, [refresh]);

  const createLibrary = async (displayName: string) => {
    if (!api) return;

    setError(null);
    setUiState('creating');
    try {
      const result = await api.create({ displayName });
      if (!result.ok) {
        if (result.error.code === 'CANCELLED') {
          setUiState('idle');
          return;
        }
        throw new LibraryOperationError(result.error);
      }
      setLibrary(result.value);
      setUiState('ready');
    } catch (caught) {
      setError(toMessage(caught, '创建资源库失败。'));
      setUiState('idle');
    }
  };

  const openLibrary = async () => {
    if (!api) return;
    setError(null);
    setUiState('opening');
    try {
      const result = await api.open();
      if (!result.ok) {
        if (result.error.code === 'CANCELLED') {
          setUiState('idle');
          return;
        }
        throw new LibraryOperationError(result.error);
      }
      setLibrary(result.value);
      setUiState('ready');
    } catch (caught) {
      setError(toMessage(caught, '打开资源库失败。'));
      setUiState('idle');
    }
  };

  const closeLibrary = async () => {
    if (!api || !library) return;
    setError(null);
    setUiState('closing');
    try {
      const result = await api.close({ libraryId: library.libraryId });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setLibrary(null);
      setUiState('idle');
    } catch (caught) {
      setError(toMessage(caught, '关闭资源库失败。'));
      setUiState('ready');
    }
  };

  const busy = ['booting', 'creating', 'opening', 'closing'].includes(uiState);
  const busyLabel =
    uiState === 'creating'
      ? '正在创建资源库…'
      : uiState === 'opening'
        ? '正在打开资源库…'
        : uiState === 'closing'
          ? '正在安全关闭…'
          : '正在恢复工作区…';

  return (
    <main
      className={`app-shell${leftOpen ? '' : ' left-collapsed'}${rightOpen ? '' : ' right-collapsed'}`}
    >
      <header className="app-toolbar">
        <div className="toolbar-cluster toolbar-leading">
          <ToolButton
            icon="menu"
            label={leftOpen ? '收起导航' : '展开导航'}
            onClick={() => setLeftOpen((value) => !value)}
            pressed={leftOpen}
          />
          <div className="brand-mark" aria-label="Serpent">
            <span className="brand-glyph">S</span>
            <span>Serpent</span>
          </div>
        </div>

        <div className="scope-trace" aria-label="当前范围">
          <span className="scope-root">资源库</span>
          <Icon name="chevron" size={12} />
          <span className="scope-chip">{library?.displayName ?? '尚未打开'}</span>
          {library && <span className="scope-chip scope-chip-muted">所有资产</span>}
        </div>

        <div className="toolbar-cluster toolbar-actions">
          <button className="search-control" disabled={!library} type="button">
            <Icon name="search" size={15} />
            <span>搜索资源库</span>
            <kbd>⌘ K</kbd>
          </button>
          <ToolButton
            icon="collapse-right"
            label={rightOpen ? '收起检查器' : '展开检查器'}
            onClick={() => setRightOpen((value) => !value)}
            pressed={rightOpen}
          />
        </div>
      </header>

      <aside className="navigation-pane" aria-label="资源导航">
        <div className="pane-header">
          <span>资源导航</span>
          <span className="status-dot" data-active={Boolean(library)} />
        </div>
        <nav className="navigation-scroll">
          {library ? <ReadyNavigation /> : <EmptyNavigation />}
        </nav>
        <div className="pane-footer">
          <span className="storage-pulse" />
          <span>{library ? '本地资源库 · 已连接' : '本地优先 · 未连接'}</span>
        </div>
      </aside>

      <section className="workspace" aria-label="资源工作区">
        <div className="workspace-bar">
          <div className="workspace-title">
            <span>{library ? '所有资产' : '工作区'}</span>
            <span className="item-count">{library ? '0 项' : '未载入'}</span>
          </div>
          <div className="workspace-tools" aria-label="视图工具">
            <ToolButton icon="grid" label="网格视图" pressed />
            <span className="tool-separator" />
            <span className="zoom-label">缩略图</span>
            <input aria-label="缩略图大小" defaultValue="42" disabled={!library} max="100" min="0" type="range" />
          </div>
        </div>

        <div className="workspace-canvas">
          {busy ? (
            <div className="state-panel loading-state" role="status">
              <LoadingMark />
              <div>
                <strong>{busyLabel}</strong>
                <p>正在核对本地结构与数据库状态</p>
              </div>
            </div>
          ) : library ? (
            <div className="library-state">
              <div className="library-monogram" aria-hidden="true">
                {initials(library.displayName)}
              </div>
              <div className="library-state-copy">
                <span className="eyebrow">LIBRARY ONLINE</span>
                <h1>{library.displayName}</h1>
                <p className="path-text">{library.displayPath ?? `LOCAL LIBRARY · ${library.libraryId}`}</p>
                <p className="state-note">资源库结构已就绪。导入与媒体浏览将在后续切片中接入这个工作区。</p>
                {error && (
                  <div className="inline-error" role="alert">
                    <Icon name="info" size={16} />
                    <div>
                      <strong>操作未完成</strong>
                      <p>{error}</p>
                      <button onClick={() => setError(null)} type="button">关闭提示</button>
                    </div>
                  </div>
                )}
              </div>
              <div className="library-actions">
                <button className="secondary-button" disabled={uiState === 'closing'} onClick={closeLibrary} type="button">
                  关闭资源库
                </button>
              </div>
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-index" aria-hidden="true">
                01
              </div>
              <div className="empty-copy">
                <span className="eyebrow">LOCAL ASSET WORKSPACE</span>
                <h1>从一个本地资源库开始</h1>
                <p>Serpent 将文件、目录与元数据保留在你掌控的位置。创建新资源库，或打开已有的 Serpent 目录。</p>
                <div className="empty-actions">
                  <button className="primary-button" onClick={() => setCreateDialogOpen(true)} type="button">
                    <Icon name="plus" size={15} />
                    创建资源库
                  </button>
                  <button className="secondary-button" onClick={openLibrary} type="button">
                    <Icon name="folder" size={15} />
                    打开资源库
                  </button>
                </div>
                {error && (
                  <div className="inline-error" role="alert">
                    <Icon name="info" size={16} />
                    <div>
                      <strong>资源库操作未完成</strong>
                      <p>{error}</p>
                      <button onClick={refresh} type="button">重试连接</button>
                    </div>
                  </div>
                )}
              </div>
              <div className="empty-specimen" aria-hidden="true">
                <span>FILES</span>
                <span>COLLECTIONS</span>
                <span>METADATA</span>
              </div>
            </div>
          )}
        </div>
      </section>

      <aside className="inspector-pane" aria-label="检查器">
        <div className="pane-header">
          <span>检查器</span>
          <ToolButton icon="info" label="检查器信息" />
        </div>
        {library ? (
          <div className="inspector-content">
            <div className="inspector-identity">
              <div className="inspector-badge">{initials(library.displayName)}</div>
              <div>
                <span className="micro-label">当前资源库</span>
                <strong>{library.displayName}</strong>
              </div>
            </div>
            <dl className="metadata-list">
              <div>
                <dt>状态</dt>
                <dd><span className="status-dot" data-active="true" />已打开</dd>
              </div>
              <div>
                <dt>资产</dt>
                <dd className="mono">0</dd>
              </div>
              <div>
                <dt>标识</dt>
                <dd className="mono compact-id">{library.libraryId}</dd>
              </div>
            </dl>
            <section className="inspector-section">
              <h2>位置</h2>
              <p className="path-block">{library.displayPath ?? '本地磁盘 · 路径暂不可用'}</p>
            </section>
            <section className="inspector-section inspector-hint">
              <h2>选择</h2>
              <p>选择资产后，这里将显示预览、组织信息与技术元数据。</p>
            </section>
          </div>
        ) : (
          <div className="inspector-empty">
            <div className="inspector-empty-frame">
              <Icon name="info" size={18} />
            </div>
            <strong>没有活动资源库</strong>
            <p>打开资源库后，这里会显示当前范围与所选资产的详细信息。</p>
          </div>
        )}
      </aside>

      {!leftOpen && (
        <button className="pane-reveal pane-reveal-left" onClick={() => setLeftOpen(true)} type="button">
          <Icon name="collapse-left" size={15} />
        </button>
      )}
      {!rightOpen && (
        <button className="pane-reveal pane-reveal-right" onClick={() => setRightOpen(true)} type="button">
          <Icon name="collapse-right" size={15} />
        </button>
      )}

      {createDialogOpen && (
        <div className="dialog-backdrop" role="presentation">
          <form
            aria-labelledby="create-library-title"
            className="create-dialog"
            onSubmit={(event) => {
              event.preventDefault();
              const displayName = libraryName.trim();
              if (!displayName) return;
              setCreateDialogOpen(false);
              void createLibrary(displayName);
            }}
          >
            <div className="dialog-heading">
              <div>
                <span className="eyebrow">NEW LOCAL LIBRARY</span>
                <h2 id="create-library-title">创建资源库</h2>
              </div>
              <button aria-label="取消创建" className="dialog-close" onClick={() => setCreateDialogOpen(false)} type="button">
                <Icon name="close" size={16} />
              </button>
            </div>
            <label className="field-label" htmlFor="library-name">资源库名称</label>
            <input
              autoFocus
              className="text-field"
              id="library-name"
              maxLength={255}
              onChange={(event) => setLibraryName(event.target.value)}
              placeholder="例如：工作素材"
              value={libraryName}
            />
            <p className="field-help">下一步将由系统选择资源库的本地保存位置。</p>
            <div className="dialog-actions">
              <button className="secondary-button" onClick={() => setCreateDialogOpen(false)} type="button">取消</button>
              <button className="primary-button" disabled={!libraryName.trim()} type="submit">选择位置并创建</button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}

function initials(value: string) {
  return value.trim().slice(0, 2).toUpperCase() || 'SP';
}

function toMessage(error: unknown, fallback: string) {
  if (error instanceof LibraryOperationError) {
    return PUBLIC_ERROR_MESSAGES_ZH[error.code] ?? fallback;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

const PUBLIC_ERROR_MESSAGES_ZH: Record<PublicErrorCode, string> = {
  CANCELLED: '操作已取消。',
  INTERNAL_ERROR: 'Serpent 无法完成这项操作，请重试。',
  INVALID_LIBRARY_NAME: '请输入可在 macOS 与 Windows 安全使用的资源库名称。',
  INVALID_LIBRARY_PATH: '请选择有效的本地文件夹。',
  LIBRARY_ALREADY_EXISTS: '该位置已经存在同名文件或文件夹。',
  LIBRARY_NOT_FOUND: '找不到所选资源库文件夹。',
  NOT_A_LIBRARY: '所选文件夹不是有效的 Serpent 资源库。',
  LIBRARY_CORRUPT: '资源库数据库或迁移记录已损坏。',
  LIBRARY_VERSION_TOO_NEW: '该资源库由更新版本的 Serpent 创建。',
  LIBRARY_NOT_WRITABLE: 'Serpent 无法写入所选位置。',
  LIBRARY_CLEANUP_FAILED: '创建失败，且临时文件无法自动清理。',
  LIBRARY_NOT_OPEN: '该资源库当前没有打开。',
};

class LibraryOperationError extends Error {
  readonly code: PublicError['code'];

  constructor(error: PublicError) {
    super(error.message);
    this.code = error.code;
  }
}
