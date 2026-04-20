import type React from 'react';

/** Strip YAML frontmatter (---...---) from markdown content. */
export function stripFrontmatter(md: string): string {
  if (!md.startsWith("---")) return md;
  const end = md.indexOf("---", 3);
  if (end === -1) return md;
  return md.slice(end + 3).trim();
}

export const mdComponents: any = {
  img: ({node, ...props}: any) => (
    <img {...props} referrerPolicy="no-referrer" loading="lazy" />
  ),
  table: ({ children, ...props }: any) => (
    <div style={{ overflowX: 'auto', margin: '16px 0', borderRadius: 8, overflow: 'hidden', border: '1px solid #30363d' }}>
      <table {...props} style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-base)' }}>{children}</table>
    </div>
  ),
  th: ({ children, ...props }: any) => (
    <th {...props} style={{
      padding: '11px 16px', textAlign: 'left', fontWeight: 600,
      background: '#1f2937', color: '#f9fafb', borderBottom: '2px solid #3b82f6',
    }}>{children}</th>
  ),
  td: ({ children, ...props }: any) => (
    <td {...props} style={{ padding: '9px 16px', color: '#c9d1d9' }}>{children}</td>
  ),
  tbody: ({ children, ...props }: any) => (
    <tbody {...props}>
      {Array.isArray(children) ? children.map((child: any, i: number) => {
        if (!child) return child;
        return (
          <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : '#161b22' }}>
            {child.props?.children}
          </tr>
        );
      }) : children}
    </tbody>
  ),
  pre: ({ children, ...props }: any) => (
    <pre {...props} style={{
      background: '#0d1117', border: '1px solid #30363d', borderRadius: 8,
      padding: '16px', overflow: 'auto', fontSize: 'var(--fs-sm)', lineHeight: 1.6,
      margin: '16px 0',
    }}>{children}</pre>
  ),
  code: ({ children, className, ...props }: any) => {
    const isBlock = className?.startsWith('hljs') || className?.startsWith('language-');
    if (isBlock) return <code className={className} {...props}>{children}</code>;
    return (
      <code style={{
        background: 'rgba(59,130,246,0.1)', padding: '2px 6px', borderRadius: 4,
        fontSize: '0.9em', color: '#93c5fd',
      }} {...props}>{children}</code>
    );
  },
};

async function openInAppWindow(url: string) {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('open_url_window', { url });
}

export function CardHeader({ meta, onJumpToArticle, onSelectAccount }: {
  meta: { title: string; url: string; publish_time: string; author: string; account?: string; account_id?: number; article_id?: string };
  onJumpToArticle?: (articleId: string) => void;
  onSelectAccount?: (accountId: number) => void;
}) {
  const canJump = !!meta.article_id && !!onJumpToArticle;
  const canSelectAccount = !!meta.account_id && !!onSelectAccount;
  const linkStyle: React.CSSProperties = { color: '#58a6ff', textDecoration: 'none', cursor: 'pointer' };

  return (
    <div style={{
      padding: '14px 20px',
      background: '#161b22',
      borderBottom: '1px solid #30363d',
      fontSize: 'var(--fs-sm)',
      lineHeight: 1.9,
      color: '#8b949e',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>
      <div>
        <a
          href="#"
          onClick={(e) => { e.preventDefault(); if (canJump) onJumpToArticle!(meta.article_id!); }}
          style={{
            color: '#e6edf3', textDecoration: 'none', fontWeight: 500, fontSize: 'var(--fs-base)',
            borderBottom: canJump ? '1px dashed #58a6ff60' : 'none',
            cursor: canJump ? 'pointer' : 'default',
          }}
        >
          {meta.title}
        </a>
      </div>
      <div>{meta.publish_time ? meta.publish_time.replace('T', ' ').slice(0, 16) : ''}</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {meta.account && (
          <a
            href="#"
            onClick={(e) => { e.preventDefault(); if (canSelectAccount) onSelectAccount!(meta.account_id!); }}
            style={{ ...linkStyle, borderBottom: canSelectAccount ? '1px dashed #58a6ff60' : 'none' }}
            onMouseEnter={e => (e.currentTarget.style.textDecoration = 'underline')}
            onMouseLeave={e => (e.currentTarget.style.textDecoration = 'none')}
          >
            {meta.account}
          </a>
        )}
        {meta.author && <span>{meta.author}</span>}
        <a
          href="#"
          onClick={(e) => { e.preventDefault(); openInAppWindow(meta.url); }}
          style={linkStyle}
          onMouseEnter={e => (e.currentTarget.style.textDecoration = 'underline')}
          onMouseLeave={e => (e.currentTarget.style.textDecoration = 'none')}
        >
          微信原文 ↗
        </a>
      </div>
    </div>
  );
}
