import { useEffect } from "react";
import { getTailorServerBase } from "../utils/tailorServer";

interface Props {
  pdfPath: string;
  onClose: () => void;
}

export default function PdfPreviewModal({ pdfPath, onClose }: Props) {
  const base = getTailorServerBase();
  const encoded = encodeURIComponent(pdfPath);
  const inlineUrl = `${base}/serve-pdf?path=${encoded}`;
  const downloadUrl = `${base}/serve-pdf?path=${encoded}&dl=1`;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="pdf-modal-overlay" onClick={onClose}>
      <div className="pdf-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pdf-modal-bar">
          <span className="pdf-modal-title">Atishay Kasliwal.pdf</span>
          <div className="pdf-modal-actions">
            <a
              className="pdf-modal-btn"
              href={downloadUrl}
              download="Atishay Kasliwal.pdf"
            >
              Download
            </a>
            <button type="button" className="pdf-modal-close" onClick={onClose}>✕</button>
          </div>
        </div>
        <iframe
          className="pdf-modal-frame"
          src={inlineUrl}
          title="Resume PDF preview"
        />
      </div>
    </div>
  );
}
