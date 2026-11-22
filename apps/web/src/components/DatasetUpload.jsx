import { useCallback, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, FileSpreadsheet, UploadCloud, X } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../lib/api';
import { Button, Banner } from './ui';
import { formatBytes } from '../lib/format';

const MAX_MB = 20;
const ACCEPTED = ['.csv', '.xlsx'];

/**
 * Drag-and-drop upload (UI spec §5.3).
 * Client checks are a courtesy only — the server re-validates extension, MIME
 * type, size, structure and headers before any import is accepted.
 */
export default function DatasetUpload({ onUploaded, compact = false }) {
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(null); // null | 'uploading' | 'accepted'
  const inputRef = useRef(null);

  const validate = (candidate) => {
    const name = candidate.name.toLowerCase();
    if (!ACCEPTED.some((ext) => name.endsWith(ext))) {
      return 'Only .csv and .xlsx files are supported.';
    }
    if (candidate.size === 0) return 'That file is empty.';
    if (candidate.size > MAX_MB * 1024 * 1024) return `Files must be smaller than ${MAX_MB} MB.`;
    return null;
  };

  const handleFile = (candidate) => {
    const problem = validate(candidate);
    if (problem) {
      setError(problem);
      setFile(null);
      return;
    }
    setError(null);
    setFile(candidate);
  };

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) handleFile(dropped);
  }, []);

  const upload = async () => {
    if (!file) return;
    setError(null);
    setProgress('uploading');
    try {
      const result = await api.uploadDataset(file);
      setProgress('accepted');
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
      onUploaded?.(result);
      setTimeout(() => setProgress(null), 4000);
    } catch (err) {
      setProgress(null);
      setError(err.message || 'Upload failed. Please try again.');
    }
  };

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={clsx(
          'relative rounded-xl border-2 border-dashed transition-colors',
          dragging ? 'border-accent bg-accent-soft' : 'border-navy-200 bg-navy-50/40 hover:border-navy-300',
          compact ? 'px-4 py-5' : 'px-6 py-10',
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED.join(',')}
          className="sr-only"
          id="dataset-file-input"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />

        {file ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-accent shadow-sm">
                <FileSpreadsheet size={18} />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{file.name}</p>
                <p className="text-xs text-ink-muted">{formatBytes(file.size)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setFile(null); if (inputRef.current) inputRef.current.value = ''; }}>
                <X size={13} /> Clear
              </Button>
              <Button size="sm" onClick={upload} loading={progress === 'uploading'}>
                {progress === 'uploading' ? 'Uploading…' : 'Upload & process'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center text-center">
            <span className={clsx('mb-3 flex items-center justify-center rounded-full', compact ? 'h-9 w-9' : 'h-12 w-12', 'bg-white text-navy-500 shadow-sm')}>
              <UploadCloud size={compact ? 17 : 21} />
            </span>
            <p className="text-sm font-medium text-ink">
              Drag and drop your file here, or{' '}
              <label htmlFor="dataset-file-input" className="cursor-pointer text-accent underline-offset-2 hover:underline">
                browse
              </label>
            </p>
            <p className="mt-1 text-xs text-ink-muted">
              CSV or Excel (.xlsx) up to {MAX_MB} MB, maximum 50,000 rows. The first row must contain column headers.
            </p>
          </div>
        )}
      </div>

      {error && (
        <Banner tone="danger" title="Upload problem" icon={AlertCircle} onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}

      {progress === 'accepted' && (
        <Banner tone="ok" title="File accepted" icon={CheckCircle2}>
          Processing has started in the background. This page updates automatically when the import
          finishes — you can keep working.
        </Banner>
      )}
    </div>
  );
}
