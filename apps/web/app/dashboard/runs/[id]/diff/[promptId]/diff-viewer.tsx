"use client";

import type { FileDiff } from "@conductor/core";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface DiffViewerProps {
  file: FileDiff;
}

const STATUS_COLORS: Record<FileDiff["status"], string> = {
  added: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  modified: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  deleted: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  renamed: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
};

export function DiffViewer({ file }: DiffViewerProps): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Badge className={STATUS_COLORS[file.status]} variant="outline">
            {file.status}
          </Badge>
          <CardTitle className="text-sm font-mono">
            {file.oldPath !== undefined ? `${file.oldPath} → ` : ""}
            {file.path}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {file.hunks.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No content shown (binary or rename without changes)
          </p>
        ) : (
          <div className="font-mono text-xs overflow-x-auto rounded border bg-muted/30">
            {file.hunks.map((hunk) => {
              // Lines never reorder, so a counter-based key is stable across renders.
              // We avoid using the .map index directly to satisfy Biome's noArrayIndexKey.
              let counter = 0;
              return (
                <div key={`hunk-${hunk.oldStart}-${hunk.newStart}`}>
                  <div className="px-3 py-1 bg-muted/60 text-muted-foreground border-b">
                    @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
                  </div>
                  {hunk.lines.map((line) => {
                    const className =
                      line.type === "add"
                        ? "bg-green-500/10 text-green-700 dark:text-green-300"
                        : line.type === "remove"
                          ? "bg-red-500/10 text-red-700 dark:text-red-300"
                          : "";
                    const prefix = line.type === "add" ? "+" : line.type === "remove" ? "-" : " ";
                    counter += 1;
                    const lineKey = `${counter}:${line.type}:${line.content}`;
                    return (
                      <div key={lineKey} className={`px-3 py-0.5 whitespace-pre ${className}`}>
                        <span className="select-none mr-2 text-muted-foreground">{prefix}</span>
                        {line.content}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
