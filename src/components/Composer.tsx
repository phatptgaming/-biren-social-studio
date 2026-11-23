import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { HistoryPost, MediaAsset, Page, ServiceStatus, Toast } from '../types';
import { ContentStep } from './ContentStep';
import { ImageStep } from './ImageStep';
import { PreviewStep } from './PreviewStep';

export function Composer({ status, notify, onPublished }: { status: ServiceStatus; notify: (type: Toast['type'], message: string) => void; onPublished: () => void }) {
  const [step, setStep] = useState(1);
  const [input, setInput] = useState('');
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [asset, setAsset] = useState<MediaAsset | null>(null);
  const [processed, setProcessed] = useState<MediaAsset | null>(null);
  const [imageMode, setImageMode] = useState<'original' | 'processed'>('original');
  const [pages, setPages] = useState<Page[]>([]);
  const [pageId, setPageId] = useState('');
  const [confirming, setConfirming] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { void api.pages().then((result) => { setPages(result.pages); if (result.pages[0]) setPageId(result.pages[0].id); }).catch(() => undefined); }, []);
  useEffect(() => { const handleReuse = (event: Event) => { const post = (event as CustomEvent<HistoryPost>).detail; setCaption(post.caption); setInput(post.caption); setStep(1); }; window.addEventListener('reuse-post', handleReuse); return () => window.removeEventListener('reuse-post', handleReuse); }, []);
  const generate = async (action: string = 'generate') => { const source = input.trim() || caption.trim(); if (!source) { notify('error', 'Hãy nhập thông tin sản phẩm trước.'); return; } setBusy(true); try { const result = await api.generate(source, action); setCaption(result.content); setStep(1); notify('success', 'Đã tạo nội dung bằng Gemini.'); } catch (error) { notify('error', error instanceof Error ? error.message : 'Không tạo được nội dung.'); } finally { setBusy(false); } };
  const upload = async (file: File) => { if (!file.type.startsWith('image/')) { notify('error', 'Vui lòng chọn tệp ảnh.'); return; } setBusy(true); try { const result = await api.upload(file); setAsset(result); setProcessed(null); setImageMode('original'); notify('success', 'Đã tải ảnh gốc lên.'); } catch (error) { notify('error', error instanceof Error ? error.message : 'Tải ảnh thất bại.'); } finally { setBusy(false); } };
  const processImage = async () => { if (!asset) return; setBusy(true); try { const result = await api.processImage(asset.fileName); setProcessed(result); setImageMode('processed'); notify('success', 'ComfyUI đã xử lý ảnh thành công.'); } catch (error) { notify('error', error instanceof Error ? error.message : 'Xử lý ảnh thất bại.'); } finally { setBusy(false); } };
  const publish = async () => { setBusy(true); try { await api.publish(caption.trim(), pageId, imageMode === 'processed' ? processed?.fileName : asset?.fileName); notify('success', 'Đăng bài thành công và đã lưu lịch sử.'); setConfirming(false); onPublished(); } catch (error) { notify('error', error instanceof Error ? error.message : 'Đăng bài thất bại.'); setConfirming(false); } finally { setBusy(false); } };
  const currentImage = imageMode === 'processed' && processed ? processed : asset;
  return <div className="page-body composer-page"><div className="composer-intro"><div><div className="section-kicker">TẠO BÀI ĐĂNG MỚI</div><h2>Biến ý tưởng thành nội dung<br /><em>sẵn sàng để bán hàng.</em></h2></div><div className="progress-steps">{['Nội dung', 'Hình ảnh', 'Xem trước'].map((label, index) => <div key={label} className={`progress-step ${step === index + 1 ? 'current' : ''} ${step > index + 1 ? 'done' : ''}`}><span>{step > index + 1 ? '✓' : index + 1}</span>{label}</div>)}</div></div><div className="composer-layout"><div className="composer-main"><ContentStep step={step} input={input} setInput={setInput} caption={caption} setCaption={setCaption} busy={busy} generate={generate} setStep={setStep} /><ImageStep step={step} status={status} asset={asset} processed={processed} currentImage={currentImage} imageMode={imageMode} setImageMode={setImageMode} fileRef={fileRef} upload={upload} processImage={processImage} setAsset={setAsset} setProcessed={setProcessed} setStep={setStep} busy={busy} /><PreviewStep step={step} caption={caption} pages={pages} pageId={pageId} setPageId={setPageId} currentImage={currentImage} setStep={setStep} setConfirming={setConfirming} /></div><aside className="composer-aside"><div className="tip-card"><div className="tip-icon">✦</div><strong>Mẹo để bài đăng hiệu quả</strong><ul><li>Giữ câu mở đầu ngắn và thu hút.</li><li>Nêu rõ giá và cách đặt hàng.</li><li>Thêm 2–4 hashtag phù hợp.</li></ul></div><div className="privacy-note"><span>⌁</span><div><strong>Quyền riêng tư</strong><p>API Key và token được lưu ở backend. Ảnh gốc không bị thay đổi.</p></div></div></aside></div>{confirming && <div className="modal-backdrop"><div className="confirm-modal"><div className="modal-icon">↗</div><h3>Xác nhận đăng bài?</h3><p>Bài viết sẽ được đăng lên <strong>{pages.find((page) => page.id === pageId)?.name}</strong> bằng Meta Graph API. Bạn có chắc muốn tiếp tục?</p><div className="modal-actions"><button className="ghost-button" onClick={() => setConfirming(false)}>Quay lại chỉnh sửa</button><button className="publish-button" disabled={busy} onClick={() => void publish()}>{busy ? <span className="mini-spinner" /> : 'Xác nhận đăng'}</button></div></div></div>}</div>;
}
