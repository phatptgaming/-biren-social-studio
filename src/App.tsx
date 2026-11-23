import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { HistoryPost, ServiceStatus, Toast, View } from './types';
import { Overview } from './components/Overview';
import { Composer } from './components/Composer';
import { History } from './components/History';
import { Connections } from './components/Connections';
import { Settings } from './components/Settings';

const navItems: Array<{ id: View; label: string; icon: string }> = [
  { id: 'overview', label: 'Tổng quan', icon: '⌂' }, { id: 'create', label: 'Tạo bài đăng', icon: '✦' },
  { id: 'history', label: 'Lịch sử bài đăng', icon: '◷' }, { id: 'connections', label: 'Kết nối dịch vụ', icon: '⊙' }, { id: 'settings', label: 'Cài đặt', icon: '⚙' }
];
const fallbackStatus: ServiceStatus = { gemini: { configured: false, model: 'gemini-2.5-flash' }, comfy: { connected: false, configured: false, message: 'Chưa kiểm tra' }, facebook: { configured: false, connected: false, pageCount: 0, appConfigured: false } };

function App() {
  const [view, setView] = useState<View>('overview');
  const [status, setStatus] = useState<ServiceStatus>(fallbackStatus);
  const [posts, setPosts] = useState<HistoryPost[]>([]);
  const [toast, setToast] = useState<Toast | null>(null);
  const [loading, setLoading] = useState(true);
  const notify = useCallback((type: Toast['type'], message: string) => { setToast({ type, message }); window.setTimeout(() => setToast(null), 4500); }, []);
  const refresh = useCallback(async () => { try { const [nextStatus, history] = await Promise.all([api.status(), api.posts()]); setStatus(nextStatus); setPosts(history.posts); } catch (error) { notify('error', error instanceof Error ? error.message : 'Không tải được dữ liệu.'); } finally { setLoading(false); } }, [notify]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { const params = new URLSearchParams(window.location.search); if (params.get('facebook') === 'connected') { notify('success', 'Đã kết nối Facebook và tải Fanpage.'); void refresh(); window.history.replaceState({}, '', window.location.pathname); } if (params.get('facebook') === 'error') { notify('error', params.get('message') || 'Kết nối Facebook thất bại.'); window.history.replaceState({}, '', window.location.pathname); } }, [notify, refresh]);
  const pageTitle = navItems.find((item) => item.id === view)?.label || 'Tổng quan';
  return <div className="app-shell"><aside className="sidebar"><div className="brand"><div className="brand-mark">B</div><div><strong>Biren</strong><span>Social Studio</span></div></div><div className="workspace-label">KHÔNG GIAN LÀM VIỆC</div><nav>{navItems.map((item) => <button key={item.id} className={`nav-item ${view === item.id ? 'active' : ''}`} onClick={() => setView(item.id)}><span className="nav-icon">{item.icon}</span>{item.label}{item.id === 'create' && <span className="nav-hot">Mới</span>}</button>)}</nav><div className="sidebar-bottom"><div className="mini-status"><span className="pulse" />{status.facebook.connected ? 'Facebook đã kết nối' : 'Chưa kết nối Facebook'}</div><div className="profile"><div className="avatar">BD</div><div><strong>BirenDev</strong><span>Local workspace</span></div><span className="dots">•••</span></div></div></aside><main className="main-content"><header className="topbar"><div><div className="breadcrumb">Biren Social Studio <span>/</span> {pageTitle}</div><h1>{pageTitle}</h1></div><div className="topbar-actions"><div className="connection-pill"><span className={status.facebook.connected ? 'dot green' : 'dot amber'} />{status.facebook.connected ? `${status.facebook.pageCount} Fanpage` : 'Chưa kết nối'}</div><button className="icon-button" title="Làm mới trạng thái" onClick={() => void refresh()}>↻</button><button className="primary-button compact" onClick={() => setView('create')}>＋ Tạo bài mới</button></div></header>{loading ? <div className="loading-state"><div className="spinner" />Đang tải không gian làm việc…</div> : <>{view === 'overview' && <Overview status={status} posts={posts} onCreate={() => setView('create')} onNavigate={setView} />}{view === 'create' && <Composer status={status} notify={notify} onPublished={() => { void refresh(); setView('history'); }} />}{view === 'history' && <History posts={posts} notify={notify} onRefresh={refresh} onReuse={(post) => { setView('create'); window.dispatchEvent(new CustomEvent('reuse-post', { detail: post })); }} />}{view === 'connections' && <Connections status={status} notify={notify} onRefresh={refresh} />}{view === 'settings' && <Settings status={status} notify={notify} onRefresh={refresh} />}</>}</main>{toast && <div className={`toast ${toast.type}`}><span>{toast.type === 'success' ? '✓' : toast.type === 'error' ? '!' : 'i'}</span>{toast.message}</div>}</div>;
}
export default App;
