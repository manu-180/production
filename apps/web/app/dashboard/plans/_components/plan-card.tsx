"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatRelativeTime } from "@/lib/ui/format";
import { cn } from "@/lib/utils";
import type { Plan } from "@conductor/db";
import { CopyIcon, MoreHorizontalIcon, PencilIcon, TrashIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

const MAX_VISIBLE_TAGS = 3;

interface PlanCardProps {
  plan: Plan;
  onDelete?: () => void;
}

export function PlanCard({ plan, onDelete }: PlanCardProps) {
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const visibleTags = plan.tags.slice(0, MAX_VISIBLE_TAGS);
  const extraTagCount = plan.tags.length - MAX_VISIBLE_TAGS;

  return (
    <>
      <Card
        className={cn(
          "relative flex flex-col transition-all duration-150",
          "hover:ring-2 hover:ring-primary/40 hover:shadow-md",
        )}
      >
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <CardTitle className="truncate">
                  <Link
                    href={`/dashboard/plans/${plan.id}`}
                    className="hover:underline focus-visible:underline outline-none"
                    aria-label={`Open plan: ${plan.name}`}
                  >
                    {plan.name}
                  </Link>
                </CardTitle>
                {plan.is_template && (
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    TEMPLATE
                  </Badge>
                )}
              </div>
              {plan.description && (
                <p
                  className="mt-1 text-sm text-muted-foreground line-clamp-2"
                  title={plan.description}
                >
                  {plan.description}
                </p>
              )}
            </div>

            {/* Actions dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${plan.name}`} />
                }
              >
                <MoreHorizontalIcon aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="bottom">
                <DropdownMenuItem
                  render={
                    <Link
                      href={`/dashboard/plans/${plan.id}`}
                      className="flex items-center gap-1.5"
                    />
                  }
                >
                  <PencilIcon aria-hidden="true" />
                  View / Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  render={
                    <Link
                      href={`/dashboard/plans/new?from=${plan.id}`}
                      className="flex items-center gap-1.5"
                    />
                  }
                >
                  <CopyIcon aria-hidden="true" />
                  Duplicate
                </DropdownMenuItem>
                {onDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      className="gap-1.5"
                      onClick={() => setConfirmDeleteOpen(true)}
                    >
                      <TrashIcon aria-hidden="true" />
                      Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardHeader>

        {/* Tags */}
        {plan.tags.length > 0 && (
          <CardContent className="py-0">
            <div className="flex flex-wrap gap-1">
              {visibleTags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
              {extraTagCount > 0 && (
                <Badge variant="outline" className="text-xs">
                  +{extraTagCount} more
                </Badge>
              )}
            </div>
          </CardContent>
        )}

        {/* Footer: relative time */}
        <CardFooter className="mt-auto pt-3">
          <div className="flex w-full items-center justify-between text-xs text-muted-foreground">
            <span aria-label="Number of prompts">—</span>
            <time dateTime={plan.updated_at} title={new Date(plan.updated_at).toLocaleString()}>
              {formatRelativeTime(plan.updated_at)}
            </time>
          </div>
        </CardFooter>
      </Card>

      {/* Delete confirmation dialog */}
      <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete plan</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{" "}
              <strong className="text-foreground">{plan.name}</strong>? This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter showCloseButton>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmDeleteOpen(false);
                onDelete?.();
              }}
              aria-label={`Confirm delete plan ${plan.name}`}
            >
              Delete plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
