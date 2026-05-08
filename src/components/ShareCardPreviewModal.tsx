import { useEffect, useMemo, useState } from "react";
import { Copy, Loader2, X } from "lucide-react";
import {
  copyImageBlobToClipboard,
  renderShareCardImage,
  type ShareCardImageData,
} from "../lib/shareCardImage";

interface ShareCardPreviewModalProps {
  data: ShareCardImageData;
  onClose: () => void;
}

export function ShareCardPreviewModal({ data, onClose }: ShareCardPreviewModalProps) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [status, setStatus] = useState<"rendering" | "ready" | "copying" | "copied" | "error">("rendering");
  const [error, setError] = useState<string | null>(null);

  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);

  useEffect(() => {
    let cancelled = false;
    setStatus("rendering");
    setError(null);
    setBlob(null);
    renderShareCardImage(data)
      .then((nextBlob) => {
        if (cancelled) return;
        setBlob(nextBlob);
        setStatus("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "生成失败");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [data]);

  useEffect(() => {
    if (!url) return;
    return () => URL.revokeObjectURL(url);
  }, [url]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  async function handleCopy() {
    if (!blob) return;
    try {
      setStatus("copying");
      await copyImageBlobToClipboard(blob);
      setStatus("copied");
      window.setTimeout(() => setStatus("ready"), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "复制失败");
      setStatus("error");
    }
  }

  return (
    <div className="share-preview-overlay" onMouseDown={onClose}>
      <section
        className="share-preview-modal"
        role="dialog"
        aria-modal="true"
        aria-label="分享长图预览"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="share-preview-header">
          <div>
            <div className="share-preview-kicker">分享长图</div>
            <h3>生成预览</h3>
          </div>
          <button type="button" className="share-preview-close" onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </div>

        <div className="share-preview-body">
          {status === "rendering" && (
            <div className="share-preview-loading">
              <Loader2 className="share-preview-spinner" size={22} />
              正在生成图片…
            </div>
          )}
          {url && (
            <img className="share-preview-image" src={url} alt="卡片分享长图预览" />
          )}
          {status === "error" && (
            <div className="share-preview-error">{error}</div>
          )}
        </div>

        <div className="share-preview-actions">
          <button
            type="button"
            className="share-preview-copy"
            disabled={!blob || status === "copying"}
            onClick={handleCopy}
          >
            {status === "copying" ? <Loader2 className="share-preview-spinner" size={15} /> : <Copy size={15} />}
            {status === "copied" ? "已复制到剪贴板" : "复制图片到剪贴板"}
          </button>
        </div>
      </section>
    </div>
  );
}
