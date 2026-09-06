import { type ReactNode } from 'react';

import type { PluginReadmeBlock, PluginReadmeInline } from '../plugins/plugin-community-readme';
import { Icon } from './Icons';

type PluginReadmeViewProps = {
  readonly blocks: readonly PluginReadmeBlock[];
  readonly empty: string;
  readonly imageLabel: string;
  readonly onOpenUrl: (href: string) => void;
};

export function PluginReadmeView({
  blocks,
  empty,
  imageLabel,
  onOpenUrl,
}: PluginReadmeViewProps): ReactNode {
  if (blocks.length === 0) {
    return <p className="app-settings-hint">{empty}</p>;
  }
  return (
    <div className="plugin-community-readme">
      {blocks.map((block, index) => (
        <ReadmeBlock block={block} imageLabel={imageLabel} key={`${block.type}:${index}`} onOpenUrl={onOpenUrl} />
      ))}
    </div>
  );
}

function ReadmeBlock({
  block,
  imageLabel,
  onOpenUrl,
}: {
  readonly block: PluginReadmeBlock;
  readonly imageLabel: string;
  readonly onOpenUrl: (href: string) => void;
}): ReactNode {
  switch (block.type) {
    case 'heading': {
      const children = <ReadmeInlines imageLabel={imageLabel} nodes={block.children} onOpenUrl={onOpenUrl} />;
      if (block.level === 1) return <h4>{children}</h4>;
      if (block.level === 2) return <h5>{children}</h5>;
      return <h6>{children}</h6>;
    }
    case 'paragraph':
      return <p><ReadmeInlines imageLabel={imageLabel} nodes={block.children} onOpenUrl={onOpenUrl} /></p>;
    case 'blockquote':
      return <blockquote><ReadmeInlines imageLabel={imageLabel} nodes={block.children} onOpenUrl={onOpenUrl} /></blockquote>;
    case 'list':
      return block.ordered ? (
        <ol>
          {block.items.map((item, index) => (
            <li key={index}><ReadmeInlines imageLabel={imageLabel} nodes={item} onOpenUrl={onOpenUrl} /></li>
          ))}
        </ol>
      ) : (
        <ul>
          {block.items.map((item, index) => (
            <li key={index}><ReadmeInlines imageLabel={imageLabel} nodes={item} onOpenUrl={onOpenUrl} /></li>
          ))}
        </ul>
      );
    case 'code':
      return <pre><code>{block.value}</code></pre>;
    case 'hr':
      return <hr />;
    default:
      return null;
  }
}

function ReadmeInlines({
  imageLabel,
  nodes,
  onOpenUrl,
}: {
  readonly imageLabel: string;
  readonly nodes: readonly PluginReadmeInline[];
  readonly onOpenUrl: (href: string) => void;
}): ReactNode {
  return nodes.map((node, index) => {
    switch (node.type) {
      case 'text':
        return <span key={index}>{node.value}</span>;
      case 'code':
        return <code key={index}>{node.value}</code>;
      case 'strong':
        return <strong key={index}><ReadmeInlines imageLabel={imageLabel} nodes={node.children} onOpenUrl={onOpenUrl} /></strong>;
      case 'em':
        return <em key={index}><ReadmeInlines imageLabel={imageLabel} nodes={node.children} onOpenUrl={onOpenUrl} /></em>;
      case 'link':
        return (
          <button
            className="plugin-community-readme-link"
            key={index}
            onClick={() => onOpenUrl(node.href)}
            type="button"
          >
            <ReadmeInlines imageLabel={imageLabel} nodes={node.children} onOpenUrl={onOpenUrl} />
          </button>
        );
      case 'image':
        return (
          <button
            className="plugin-community-readme-image"
            key={index}
            onClick={() => onOpenUrl(node.href)}
            type="button"
          >
            <Icon name="external-link" size={12} />
            {node.alt.trim() === '' ? imageLabel : node.alt}
          </button>
        );
      default:
        return null;
    }
  });
}
