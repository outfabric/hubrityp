'use client';

import { AlertCircle, Upload } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';

import { Card } from '@/shared/ui/card';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_ROWS = 200;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CsvParseResult {
  /** Column headers from the first row. */
  headers: string[];
  /** Data rows (array of objects keyed by header). */
  rows: Record<string, string>[];
}

interface CsvUploadProps {
  /** Called after a file is successfully parsed. */
  onParsed: (result: CsvParseResult) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Dropzone for CSV file upload with client-side parsing via papaparse.
 *
 * Design system: Card interactive with dashed border, Upload icon centered,
 * text "Arraste um arquivo CSV ou clique para selecionar". Accepts only `.csv`.
 */
export function CsvUpload({ onParsed }: CsvUploadProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const parseFile = useCallback(
    async (file: File) => {
      setError(null);
      setIsParsing(true);

      try {
        const Papa = (await import('papaparse')).default;

        Papa.parse<Record<string, string>>(file, {
          header: true,
          skipEmptyLines: true,
          complete(results) {
            setIsParsing(false);

            if (!results.meta.fields || results.meta.fields.length === 0) {
              setError('O arquivo CSV parece estar vazio ou sem colunas.');
              return;
            }

            if (results.data.length === 0) {
              setError('Nenhuma linha encontrada no arquivo.');
              return;
            }

            if (results.data.length > MAX_ROWS) {
              setError(
                `Maximo de ${MAX_ROWS} linhas por importacao. Seu arquivo tem ${results.data.length}.`,
              );
              return;
            }

            onParsed({
              headers: results.meta.fields,
              rows: results.data,
            });
          },
          error() {
            setIsParsing(false);
            setError('Erro ao processar o arquivo CSV. Verifique o formato.');
          },
        });
      } catch {
        setIsParsing(false);
        setError('Erro ao carregar o processador de CSV.');
      }
    },
    [onParsed],
  );

  const handleFile = useCallback(
    (file: File | undefined) => {
      if (!file) return;

      if (!file.name.endsWith('.csv') && file.type !== 'text/csv') {
        setError('Apenas arquivos .csv sao aceitos.');
        return;
      }

      void parseFile(file);
    },
    [parseFile],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      handleFile(file);
    },
    [handleFile],
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleClick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      handleFile(file);
      // Reset so the same file can be re-selected
      e.target.value = '';
    },
    [handleFile],
  );

  return (
    <div className="space-y-3">
      <Card
        className={`duration-fast flex cursor-pointer flex-col items-center justify-center border-2 border-dashed p-8 transition-colors ${
          isDragOver
            ? 'border-brand-500 bg-brand-50'
            : 'border-border-strong hover:border-brand-500'
        } ${isParsing ? 'pointer-events-none opacity-60' : ''}`}
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClick();
          }
        }}
        aria-label="Area de upload de CSV"
        data-testid="csv-dropzone"
      >
        {isParsing ? (
          <div className="border-brand-500 h-6 w-6 animate-spin rounded-full border-2 border-t-transparent" />
        ) : (
          <Upload className="text-text-tertiary h-6 w-6" aria-hidden="true" />
        )}
        <p className="text-text-secondary mt-3 text-[15px]">
          {isParsing
            ? 'Processando arquivo...'
            : 'Arraste um arquivo CSV ou clique para selecionar'}
        </p>
      </Card>

      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={handleInputChange}
        data-testid="csv-file-input"
        aria-hidden="true"
        tabIndex={-1}
      />

      {error && (
        <div
          className="text-danger-700 flex items-start gap-2 text-[13px]"
          role="alert"
          data-testid="csv-upload-error"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
