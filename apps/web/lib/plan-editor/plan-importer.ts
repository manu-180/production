import { extractTitle, parseFrontmatter } from "./markdown-utils";

export interface ImportedPrompt {
  filename: string;
  title: string | null;
  content: string;
  frontmatter: Record<string, unknown>;
  order_index: number;
}

/**
 * Natural sort comparator for filenames.
 * Handles numeric prefixes like "01-setup.md" < "02-build.md" < "10-deploy.md".
 */
function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function fileToImportedPrompt(filename: string, text: string, orderIndex: number): ImportedPrompt {
  const { frontmatter, body } = parseFrontmatter(text);
  const title = extractTitle(text) !== "Untitled" ? extractTitle(text) : null;
  return {
    filename,
    title,
    content: body,
    frontmatter,
    order_index: orderIndex,
  };
}

/**
 * Parse an array of File objects (must all be .md) into ImportedPrompt objects.
 * Files are sorted by name before processing so numeric prefixes determine order.
 */
export async function parseMarkdownFiles(files: File[]): Promise<ImportedPrompt[]> {
  const mdFiles = files.filter((f) => f.name.endsWith(".md"));

  if (mdFiles.length === 0) {
    throw new Error("No .md files found. Please upload Markdown files.");
  }

  const sorted = [...mdFiles].sort((a, b) => naturalCompare(a.name, b.name));

  const results = await Promise.all(
    sorted.map(async (file, index) => {
      const text = await file.text();
      return fileToImportedPrompt(file.name, text, index);
    }),
  );

  return results;
}

/**
 * ZIP files are not supported for direct upload.
 * Throw a descriptive error so the UI can surface clear guidance.
 */
export async function parseZipFile(_file: File): Promise<ImportedPrompt[]> {
  throw new Error(
    "ZIP upload is not supported yet. Please extract the archive and upload the .md files directly.",
  );
}
