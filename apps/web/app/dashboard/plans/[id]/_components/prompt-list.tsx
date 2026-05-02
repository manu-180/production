"use client";

import { Button } from "@/components/ui/button";
import { useCreatePrompt, useDeletePrompt, useReorderPrompts } from "@/hooks/use-plan-mutations";
import { cn } from "@/lib/utils";
import type { Prompt } from "@conductor/db";
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVerticalIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

interface PromptListProps {
  planId: string;
  prompts: Prompt[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

interface SortablePromptItemProps {
  prompt: Prompt;
  index: number;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  isDeleting: boolean;
}

function SortablePromptItem({
  prompt,
  index,
  isSelected,
  onSelect,
  onDelete,
  isDeleting,
}: SortablePromptItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: prompt.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const displayTitle = prompt.title ?? prompt.filename ?? "Sin título";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-2 rounded-lg px-2 py-2 cursor-pointer group select-none",
        isSelected ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-muted/50",
        isDragging && "z-50 shadow-md",
      )}
      onClick={() => onSelect(prompt.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(prompt.id);
        }
      }}
      aria-selected={isSelected}
      aria-label={`Prompt ${index + 1}: ${displayTitle}`}
    >
      {/* Drag handle */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab opacity-0 group-hover:opacity-100 transition-opacity shrink-0 p-0.5 rounded hover:text-foreground text-muted-foreground"
        onClick={(e) => e.stopPropagation()}
        aria-label="Arrastrar para reordenar"
        tabIndex={-1}
      >
        <GripVerticalIcon className="size-4" />
      </button>

      {/* Order index */}
      <span className="text-xs text-muted-foreground w-5 shrink-0 text-right tabular-nums">
        {index + 1}
      </span>

      {/* Title */}
      <span className="text-sm truncate flex-1 min-w-0">{displayTitle}</span>

      {/* Delete button */}
      <button
        type="button"
        className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 p-0.5 rounded text-muted-foreground hover:text-rose-500"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(prompt.id);
        }}
        disabled={isDeleting}
        aria-label={`Eliminar prompt: ${displayTitle}`}
        tabIndex={-1}
      >
        <Trash2Icon className="size-3.5" />
      </button>
    </div>
  );
}

export function PromptList({ planId, prompts, selectedId, onSelect }: PromptListProps) {
  // Local optimistic order state
  const [localPrompts, setLocalPrompts] = useState<Prompt[]>(prompts);

  // Keep local state in sync with server data (when not dragging)
  useEffect(() => {
    setLocalPrompts(prompts);
  }, [prompts]);

  const createPrompt = useCreatePrompt(planId);
  const deletePrompt = useDeletePrompt(planId);
  const reorderPrompts = useReorderPrompts(planId);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = localPrompts.findIndex((p) => p.id === active.id);
    const newIndex = localPrompts.findIndex((p) => p.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(localPrompts, oldIndex, newIndex);
    setLocalPrompts(reordered);
    reorderPrompts.mutate(reordered.map((p) => p.id));
  }

  function handleAddPrompt() {
    createPrompt.mutate(
      {
        content: "",
        title: `Prompt ${localPrompts.length + 1}`,
      },
      {
        onSuccess: (newPrompt) => {
          onSelect(newPrompt.id);
        },
        onError: () => {
          toast.error("Error al crear el prompt");
        },
      },
    );
  }

  function handleDeletePrompt(promptId: string) {
    deletePrompt.mutate(promptId, {
      onError: () => {
        toast.error("Error al eliminar el prompt");
      },
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between px-2 py-1 mb-1">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Prompts
        </h2>
        <span className="text-xs text-muted-foreground tabular-nums">{localPrompts.length}</span>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext
          items={localPrompts.map((p) => p.id)}
          strategy={verticalListSortingStrategy}
        >
          {localPrompts.map((prompt, index) => (
            <SortablePromptItem
              key={prompt.id}
              prompt={prompt}
              index={index}
              isSelected={selectedId === prompt.id}
              onSelect={onSelect}
              onDelete={handleDeletePrompt}
              isDeleting={deletePrompt.isPending}
            />
          ))}
        </SortableContext>
      </DndContext>

      {localPrompts.length === 0 && (
        <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center">
          <p className="text-xs text-muted-foreground">Sin prompts aún</p>
        </div>
      )}

      <Button
        variant="ghost"
        size="sm"
        className="mt-2 w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
        onClick={handleAddPrompt}
        disabled={createPrompt.isPending}
      >
        <PlusIcon className="size-4" />
        Agregar prompt
      </Button>
    </div>
  );
}
