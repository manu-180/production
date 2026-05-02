"use client";

import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/ui/format";
import { cn } from "@/lib/utils";
import { FileTextIcon, UploadIcon, XIcon } from "lucide-react";
import { useCallback } from "react";
import { useDropzone } from "react-dropzone";

interface UploadZoneProps {
  onFiles: (files: File[]) => void;
  accept?: Record<string, string[]>;
  label?: string;
  currentFiles?: File[];
  onRemoveFile?: (index: number) => void;
}

export function UploadZone({
  onFiles,
  accept = { "text/markdown": [".md"] },
  label = "Arrastrá archivos .md acá o hacé clic para explorar",
  currentFiles = [],
  onRemoveFile,
}: UploadZoneProps) {
  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      onFiles(acceptedFiles);
    },
    [onFiles],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept,
    multiple: true,
    onDrop,
  });

  return (
    <div className="flex flex-col gap-3">
      {/* Drop zone */}
      <div
        {...getRootProps()}
        aria-label={label}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-colors outline-none",
          "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          isDragActive
            ? "border-primary bg-primary/5 text-primary"
            : "border-border bg-muted/30 text-muted-foreground hover:border-primary/50 hover:bg-muted/50",
        )}
      >
        <input {...getInputProps()} aria-label="File input" />
        <div
          className={cn(
            "flex size-12 items-center justify-center rounded-full transition-colors",
            isDragActive ? "bg-primary/10" : "bg-muted",
          )}
        >
          <UploadIcon
            className={cn(
              "size-6 transition-colors",
              isDragActive ? "text-primary" : "text-muted-foreground",
            )}
            aria-hidden="true"
          />
        </div>
        <div>
          <p className="text-sm font-medium">
            {isDragActive ? "Soltá los archivos para subir" : label}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Soporta archivos {Object.values(accept).flat().join(", ")}
          </p>
        </div>
      </div>

      {/* File list */}
      {currentFiles.length > 0 && (
        <ul
          className="flex flex-col gap-1.5"
          aria-label={`${currentFiles.length} archivo${currentFiles.length === 1 ? "" : "s"} seleccionado${currentFiles.length === 1 ? "" : "s"}`}
        >
          {currentFiles.map((file, index) => (
            <li
              key={`${file.name}-${index}`}
              className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm"
            >
              <FileTextIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate font-medium" title={file.name}>
                {file.name}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatBytes(file.size)}
              </span>
              {onRemoveFile && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => onRemoveFile(index)}
                  aria-label={`Eliminar archivo ${file.name}`}
                  className="ml-1 shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <XIcon aria-hidden="true" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
