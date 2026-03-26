import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Loader2, BookOpen, ExternalLink, RefreshCw, Rss, ChevronLeft, Menu, Layers, Settings, X } from 'lucide-react';
import "./App.css";

interface Account {
  id: number;
  biz: string;
  name: string;
  avatar_url?: string;
  description?: string;
}

interface Article {
  id: number;
  title: string;
  url: string;
  publish_time: string;
  digest?: string;
  cover_url?: string;
  author?: string;
  account?: string;
  markdown?: string;
  html_path?: string;
  account_id?: number;
}

function App() {
  const [targetUrl, setTargetUrl] = useState("https://mp.weixin.qq.com/s/");
  const [status, setStatus] = useState("已就绪");
  const [isLoading, setIsLoading] = useState(false);
  
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(-1); // -1 for All Articles
  const [articles, setArticles] = useState<Article[]>([]);
  const [selectedArticleId, setSelectedArticleId] = useState<number | null>(null);
  const [activeArticle, setActiveArticle] = useState<Article | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Layout States
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [listWidth, setListWidth] = useState(360);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [isResizingList, setIsResizingList] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const API_BASE = "http://127.0.0.1:8889";

  // Initial Load: Fetch Accounts and All Articles
  useEffect(() => {
    fetchAccounts();
    fetchArticles(-1);
  }, []);

  // Load Articles when Account changes
  useEffect(() => {
    if (selectedAccountId !== null) {
      fetchArticles(selectedAccountId);
    }
  }, [selectedAccountId]);

  // Load full content when Article changes
  useEffect(() => {
    if (selectedArticleId !== null) {
      const art = articles.find(a => a.id === selectedArticleId);
      if (art) {
        fetch(`${API_BASE}/check?url=${encodeURIComponent(art.url)}`)
          .then(r => r.json())
          .then(resp => {
            if (resp.status === "cached") {
              setActiveArticle(resp.data);
            }
          });
      }
    }
  }, [selectedArticleId, articles]);

  // Listeners for background extraction
  useEffect(() => {
    const unlisten1 = listen("article-received", () => {
      setStatus("正在提取内容...");
      setIsLoading(true);
    });

    const unlisten2 = listen<any>("server-response", (e) => {
      const resp = e.payload;
      if (resp.status === "ok" || resp.status === "cached") {
        setStatus("✅ 处理成功");
        setIsLoading(false);
        fetchAccounts();
        fetchArticles(selectedAccountId || -1);
      } else {
        setStatus("⚠️ " + (resp.message || "处理失败"));
        setIsLoading(false);
      }
    });

    return () => {
      unlisten1.then(f => f());
      unlisten2.then(f => f());
    };
  }, [selectedAccountId]);

  // Resizing logic (kept as before)
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingSidebar && !isSidebarCollapsed) {
        const newWidth = Math.max(150, Math.min(500, e.clientX));
        setSidebarWidth(newWidth);
      } else if (isResizingList) {
        const currentSidebarWidth = isSidebarCollapsed ? 72 : sidebarWidth;
        const newWidth = Math.max(200, Math.min(600, e.clientX - currentSidebarWidth));
        setListWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizingSidebar(false);
      setIsResizingList(false);
      document.body.style.cursor = 'default';
    };

    if (isResizingSidebar || isResizingList) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingSidebar, isResizingList, sidebarWidth, isSidebarCollapsed]);

  const fetchAccounts = async () => {
    try {
      const resp = await fetch(`${API_BASE}/accounts`).then(r => r.json());
      if (resp.status === "ok") setAccounts(resp.data);
    } catch (err) {
      console.error("Failed to fetch accounts", err);
    }
  };

  const fetchArticles = async (accountId: number) => {
    const url = accountId === -1 ? `${API_BASE}/articles` : `${API_BASE}/articles?account_id=${accountId}`;
    try {
      const resp = await fetch(url).then(r => r.json());
      if (resp.status === "ok") setArticles(resp.data);
    } catch (err) {
      console.error("Failed to fetch articles", err);
    }
  };

  const handleSync = async () => {
    setStatus("正在同步...");
    try {
      const resp = await fetch(`${API_BASE}/sync`, { method: 'POST' }).then(r => r.json());
      setStatus("✅ " + (resp.message || "同步完成"));
      fetchAccounts();
      fetchArticles(selectedAccountId || -1);
    } catch (err) {
      setStatus("⚠️ 同步失败");
    }
  };

  const handleDeleteArticle = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (!confirm("确定要删除这篇文章吗？")) return;
    try {
      await fetch(`${API_BASE}/articles/${id}`, { method: 'DELETE' });
      fetchArticles(selectedAccountId || -1);
      if (selectedArticleId === id) setActiveArticle(null);
    } catch (err) {
      console.error("Delete failed", err);
    }
  };

  const handleLoadUrl = async () => {
    const trimmed = targetUrl.trim();
    if (!trimmed || trimmed === "https://mp.weixin.qq.com/s/") return;
    
    setIsLoading(true);
    setStatus("检查缓存...");
    try {
      const resp = await fetch(`${API_BASE}/check?url=${encodeURIComponent(trimmed)}`).then(r => r.json());
      if (resp.status === "cached") {
        setStatus("✅ 已从缓存加载");
        setIsLoading(false);
        setActiveArticle(resp.data);
        fetchAccounts();
        fetchArticles(selectedAccountId || -1);
      } else {
        setStatus("后台采集中...");
        await invoke("open_article", { url: trimmed });
      }
    } catch (err) {
      setStatus("⚠️ 服务器错误");
      setIsLoading(false);
    }
  };

  return (
    <div className="app-container">
      {/* Pane 1: Sidebar (Accounts) */}
      <aside 
        className={`sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`}
        style={{ width: isSidebarCollapsed ? 72 : 280 }}
      >
        <div className="sidebar-header">
          <h2 className="sidebar-title">
            <Rss size={20} />
            <span>公众号订阅</span>
          </h2>
          <button className="btn-icon" onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}>
            {isSidebarCollapsed ? <Menu size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>
        <div className="account-list">
          {/* Virtual Entry: All Articles */}
          <div 
            className={`account-item ${selectedAccountId === -1 ? 'active' : ''}`}
            onClick={() => setSelectedAccountId(-1)}
            title="全部文章"
          >
            <div className="account-avatar" style={{ background: '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
              <Layers size={18} />
            </div>
            <div className="account-info">
              <div className="account-name">全部文章</div>
            </div>
          </div>

          {accounts.map(acc => (
            <div 
              key={acc.id} 
              className={`account-item ${selectedAccountId === acc.id ? 'active' : ''}`}
              onClick={() => setSelectedAccountId(acc.id)}
              title={isSidebarCollapsed ? acc.name : ""}
            >
              <img 
                src={acc.avatar_url || "https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07xvMibqLuWicX7Y16H1xP81v6B0Sraia9zK0dYniamHwJxiaGvH6v97K8K1icYibib9eA/0"} 
                alt={acc.name} 
                className="account-avatar"
              />
              <div className="account-info">
                <div className="account-name">{acc.name}</div>
              </div>
            </div>
          ))}
        </div>
        
        <div className="sidebar-footer" style={{ padding: '10px', borderTop: '1px solid #30363d' }}>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
            <button className="primary-btn" style={{ flex: 1, height: '36px' }} onClick={handleSync} title="同步本地离线文件">
              <RefreshCw size={14} /> {!isSidebarCollapsed && "同步本地"}
            </button>
            {!isSidebarCollapsed && (
              <button className="btn-icon" style={{ background: '#21262d' }} onClick={() => setIsSettingsOpen(true)}>
                <Settings size={18} />
              </button>
            )}
          </div>
          <div className="status-bar" style={{ fontSize: '0.75rem', color: '#8b949e', paddingLeft: isSidebarCollapsed ? '25px' : '5px' }}>
            <div className="status-dot" style={{ background: status.includes('✅') ? '#4ade80' : '#facc15' }}></div>
            {!isSidebarCollapsed && status}
          </div>
        </div>
      </aside>

      {/* Pane 2: Article List */}
      <section className="article-list-pane" style={{ width: listWidth }}>
        <header className="list-header">
          <div className="search-input-wrapper">
            <input 
              type="text" 
              className="search-input" 
              placeholder="搜索文章标题..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </header>
        <div className="list-content">
          {articles.filter(a => a.title.toLowerCase().includes(searchQuery.toLowerCase())).map(art => (
            <div 
              key={art.id} 
              className={`article-card ${selectedArticleId === art.id ? 'active' : ''}`}
              onClick={() => setSelectedArticleId(art.id)}
            >
              <div className="article-card-left">
                <div className="article-card-title">{art.title}</div>
                <div className="article-card-digest">{art.digest || "暂无摘要"}</div>
                <div className="article-card-meta">
                  {art.publish_time} · {art.account}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end' }}>
                 {art.cover_url && (
                  <img src={art.cover_url} alt="Cover" className="article-card-thumb" />
                )}
                <button className="btn-icon delete-btn" onClick={(e) => handleDeleteArticle(e, art.id)}>
                  <X size={14} style={{ color: '#f85149' }} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Resizer 2 */}
      <div 
        className={`resizer ${isResizingList ? 'resizing' : ''}`} 
        onMouseDown={() => setIsResizingList(true)}
      />

      {/* Pane 3: Reader View */}
      <main className="reader-pane">
        {activeArticle ? (
          <>
            <div className="reader-toolbar">
              <button className="btn-icon" title="刷新公众号" onClick={() => fetchAccounts()}>
                <RefreshCw size={18} />
              </button>
              <button className="btn-icon" title="打开原文" onClick={() => window.open(activeArticle.url)}>
                <ExternalLink size={18} />
              </button>
            </div>
            <div className="reader-content animate-in">
              <div className="markdown-body">
                <ReactMarkdown 
                  remarkPlugins={[remarkGfm]}
                  components={{
                    img: ({node, ...props}) => (
                      <img {...props} referrerPolicy="no-referrer" loading="lazy" />
                    )
                  }}
                >
                  {activeArticle.markdown || ""}
                </ReactMarkdown>
              </div>
            </div>
          </>
        ) : (
          <div className="reader-empty">
            <div className="reader-empty-icon"><BookOpen size={64} /></div>
            <h3>请选择文章或进入设置抓取链接</h3>
          </div>
        )}
      </main>

      {/* Settings Modal/Overlay */}
      {isSettingsOpen && (
        <div className="settings-overlay animate-in" onClick={() => setIsSettingsOpen(false)}>
          <div className="settings-modal" onClick={e => e.stopPropagation()}>
            <div className="settings-header">
              <h3>公众号设置与工具</h3>
              <button className="btn-icon" onClick={() => setIsSettingsOpen(false)}><X size={20} /></button>
            </div>
            <div className="settings-body">
              <section className="settings-section">
                <h4>通过链接抓取文章</h4>
                <p>在此粘贴微信公众号文章的 URL 链接。系统将自动抓取内容并保存到你的本地库中。</p>
                <div className="input-group" style={{ marginTop: '15px' }}>
                  <input 
                    type="text" 
                    className="url-input" 
                    value={targetUrl}
                    onChange={(e) => setTargetUrl(e.target.value)}
                    placeholder="https://mp.weixin.qq.com/s/..."
                    onKeyDown={(e) => e.key === "Enter" && handleLoadUrl()}
                  />
                  <button className="primary-btn" style={{ minWidth: '80px' }} onClick={handleLoadUrl} disabled={isLoading}>
                    {isLoading ? <Loader2 className="animate-spin" size={14} /> : "抓取内容"}
                  </button>
                </div>
                {status && status !== "已就绪" && <div className="settings-status">{status}</div>}
              </section>
              <section className="settings-section">
                <h4>数据库管理</h4>
                <p>如果你的离线文件夹中有新文件，点击下方按钮强制同步到本地数据库中。</p>
                <button className="primary-btn" onClick={handleSync} style={{ width: '100%', background: '#30363d', marginTop: '10px' }}>
                  强制重新同步本地文件
                </button>
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

