"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUpdatePrompt } from "@/hooks/use-plan-mutations";
import { stripFrontmatter } from "@/lib/plan-editor/markdown-utils";
import { cn } from "@/lib/utils";
import type { Prompt } from "@conductor/db";
import { CheckIcon, Loader2Icon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FrontmatterForm } from "./frontmatter-form";

interface PromptEditorProps {
  prompt: Prompt;
  planId: string;
  allPrompts: Prompt[];
}

type SaveStatus = "idle" | "saving" | "saved";

const DEBOUNCE_MS = 600;

export function PromptEditor({ prompt, planId }: PromptEditorProps) {
  const updatePrompt = useUpdatePrompt(planId);
  const [content, setContent] = useState(prompt.content);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset when prompt changes (key-based re-mount handles this, but be safe)
  // biome-ignore lint/correctness/useExhaustiveDependencies: setContent/setSaveStatus are stable setState dispatchers; reset only when prompt ID or content changes
  useEffect(() => {
    setContent(prompt.content);
    setSaveStatus("idle");
  }, [prompt.id, prompt.content]);

  const save = useCallback(
    (valueToSave: string) => {
      setSaveStatus("saving");
      updatePrompt.mutate(
        { promptId: prompt.id, data: { content: valueToSave } },
        {
          onSuccess: () => {
            setSaveStatus("saved");
            setTimeout(() => setSaveStatus("idle"), 2000);
          },
          onError: () => {
            setSaveStatus("idle");
          },
        },
      );
    },
    [prompt.id, updatePrompt],
  );

  // Debounced auto-save
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally omit `save` and `prompt.content` — including them would cause infinite re-saves; content is the only reactive trigger needed
  useEffect(() => {
    if (content === prompt.content) {
      setSaveStatus("idle");
      return;
    }

    setSaveStatus("saving");

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      save(content);
    }, DEBOUNCE_MS);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [content]); // eslint-disable-line react-hooks/exhaustive-deps

  // Force-save keyboard shortcut (Cmd+S)
  useEffect(() => {
    function handleForceSave() {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (content !== prompt.content) {
        save(content);
      }
    }

    window.addEventListener("conductor:force-save", handleForceSave);
    return () => window.removeEventListener("conductor:force-save", handleForceSave);
  }, [content, prompt.content, save]);

  function handleTabKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Tab") {
      e.preventDefault();
      const textarea = e.currentTarget;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newValue = `${content.substring(0, start)}  ${content.substring(end)}`;
      setContent(newValue);
      // Restore cursor position after state update
      requestAnimationFrame(() => {
        textarea.selectionStart = start + 2;
        textarea.selectionEnd = start + 2;
      });
    }
  }

  return (
    <div className="flex flex-col gap-0 rounded-xl border border-border bg-card h-full min-h-0 overflow-hidden">
      {/* Tab bar with save status */}
      <Tabs defaultValue="edit" className="flex flex-col h-full min-h-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-1 shrink-0">
          <TabsList className="h-8 bg-transparent gap-1 p-0">
            <TabsTrigger value="edit" className="h-7 px-3 text-xs data-[state=active]:bg-muted">
              Edit
            </TabsTrigger>
            <TabsTrigger value="preview" className="h-7 px-3 text-xs data-[state=active]:bg-muted">
              Preview
            </TabsTrigger>
            <TabsTrigger
              value="frontmatter"
              className="h-7 px-3 text-xs data-[state=active]:bg-muted"
            >
              Frontmatter
            </TabsTrigger>
          </TabsList>

          {/* Save indicator */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground h-7">
            {saveStatus === "saving" && (
              <>
                <Loader2Icon className="size-3 animate-spin" />
                <span>Saving...</span>
              </>
            )}
            {saveStatus === "saved" && (
              <>
                <CheckIcon className="size-3 text-emerald-500" />
                <span className="text-emerald-500">Saved</span>
              </>
            )}
          </div>
        </div>

        {/* Edit tab */}
        <TabsContent value="edit" className="flex-1 min-h-0 overflow-hidden m-0">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleTabKey}
            className={cn(
              "w-full h-full resize-none font-mono text-sm bg-transparent",
              "focus:outline-none p-4",
              "placeholder:text-muted-foreground",
            )}
            placeholder="Write your prompt instructions here..."
            spellCheck={false}
            aria-label="Prompt content editor"
          />
        </TabsContent>

        {/* Preview tab */}
        <TabsContent value="preview" className="flex-1 min-h-0 overflow-auto m-0">
          <div className="prose prose-sm dark:prose-invert max-w-none p-4">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {stripFrontmatter(content) || "*No content to preview*"}
            </ReactMarkdown>
          </div>
        </TabsContent>

        {/* Frontmatter tab */}
        <TabsContent value="frontmatter" className="flex-1 min-h-0 overflow-auto m-0">
          <FrontmatterForm prompt={prompt} planId={planId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
