import { useState } from 'react';
import type { Dispatch, DragEvent, RefObject, SetStateAction } from 'react';
import type { MediaAsset, ServiceStatus } from '../types';

type Props = { step: number; status: ServiceStatus; asset: MediaAsset | null; processed: MediaAsset | null; currentImage: MediaAsset | null; imageMode: 'original' | 'processed'; setImageMode: Dispatch<SetStateAction<'original' | 'processed'>>; fileRef: RefObject<HTMLInputElement | null>; upload: (file: File) => Promise<void>; processImage: () => Promise<void>; processing: { progress: number; message: string } | null; setAsset: Dispatch<SetStateAction<MediaAsset | null>>; setProcessed: Dispatch<SetStateAction<MediaAsset | null>>; setStep: Dispatch<SetStateAction<number>>; busy: boolean };

export function ImageStepAuto({ step, status, asset, processed, currentImage, imageMode, setImageMode, fileRef, upload, processImage, processing, setAsset, setProcessed, setStep, busy }: Props) {
  const [dragActive, setDragActive] = useState(false);
  const comfyReady = status.comfy.connected && status.comfy.configured;
  const warnings = status.comfy.workflowWarnings || [];
  const drop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void upload(file);
  };
  return <section className={`panel compose-section ${step === 2 ? 'focused' : ''}`}>
    <div className="section-number">02</div><div className="section-content">
      <div className="section-title"><div><h3>Hình ảnh sản phẩm</h3><p>Ảnh gốc luôn được giữ lại; AI chỉ là lựa chọn bổ sung.</p></div>{asset && <span className="file-chip">✓ {asset.originalName}</span>}</div>
      {!asset ? <button
        className={`dropzone ${dragActive ? 'drag-active' : ''}`}
        onClick={() => fileRef.current?.click()}
        onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragActive(false)}
        onDrop={drop}
      ><span className="upload-icon">↑</span><strong>Kéo thả ảnh vào đây hoặc <u>chọn tệp</u></strong><small>JPG, PNG hoặc WebP · Tối đa 10 MB</small></button> : <>
        <div className="image-workspace">
          <div className="image-preview">
            <img src={currentImage?.url} alt="Ảnh sản phẩm" />
            <button className="remove-image" title="Xóa ảnh" onClick={() => { setAsset(null); setProcessed(null); setImageMode('original'); }}>×</button>
            <span className="image-tag">{imageMode === 'processed' ? 'ẢNH ĐÃ LÀM ĐẸP' : 'ẢNH GỐC'}</span>
          </div>
          <div className="image-options">
            <button className={`image-option ${imageMode === 'original' ? 'selected' : ''}`} onClick={() => setImageMode('original')}><span className="radio" /><div><strong>Giữ nguyên ảnh gốc</strong><small>Luôn khả dụng, không thay đổi bất kỳ chi tiết nào.</small></div></button>
            <button className={`image-option ${imageMode === 'processed' ? 'selected' : ''}`} disabled={!processed} onClick={() => processed && setImageMode('processed')}><span className="radio" /><div><strong>AI làm đẹp hình ảnh</strong><small>{processed ? 'Đã có output thật từ ComfyUI.' : 'Workflow sẽ giữ sản phẩm và chữ ở mức thay đổi thấp.'}</small></div><span className="ai-mini">✦</span></button>
            {!processed && <button className="outline-button full" disabled={busy || !comfyReady} onClick={() => void processImage()}>{busy ? <><span className="mini-spinner" /> Đang kiểm tra và xử lý…</> : '✦ Làm đẹp bằng ComfyUI'}</button>}
            {processed && <button className="outline-button full" disabled={busy || !comfyReady} onClick={() => { setProcessed(null); setImageMode('original'); void processImage(); }}>{busy ? <><span className="mini-spinner" /> Đang xử lý lại…</> : '↻ Xử lý lại bằng ComfyUI'}</button>}
            {processing && <div className="comfy-progress"><div className="comfy-progress-bar" style={{ width: `${processing.progress}%` }} /><small>{processing.progress}% · {processing.message}</small></div>}
            {!comfyReady && <small className="comfy-inline-warning">{status.comfy.message} Ảnh gốc vẫn có thể dùng để xem trước và đăng bài.</small>}
            {comfyReady && warnings.map((warning) => <small className="comfy-inline-warning" key={warning}>{warning}</small>)}
          </div>
        </div>
        {processed && <div className="image-compare"><div><span>ẢNH GỐC</span><img src={asset.url} alt="So sánh ảnh gốc" /></div><div><span>OUTPUT COMFYUI</span><img src={processed.url} alt="So sánh ảnh đã xử lý" /></div></div>}
      </>}
      <input ref={fileRef} className="hidden-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.currentTarget.value = ''; }} />
      {asset && <div className="section-actions"><button className="ghost-button" onClick={() => setStep(1)}>← Nội dung</button><button className="primary-button" onClick={() => setStep(3)}>Tiếp tục xem trước →</button></div>}
    </div>
  </section>;
}
