"use client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BellIcon } from "lucide-react";

export function NotificationBell() {
  // Stubbed for Phase 11 — wire to real run-events feed in a later iteration.
  const count = 0;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label="Notificaciones" className="relative">
            <BellIcon className="size-4" />
            {count > 0 && (
              <span
                className="absolute -top-0.5 -right-0.5 inline-flex size-3.5 items-center justify-center rounded-full bg-rose-500 text-[9px] font-semibold text-white"
                aria-label={`${count} sin leer`}
              >
                {count}
              </span>
            )}
          </Button>
        }
      />
      <PopoverContent align="end" className="w-72 p-3">
        <div className="text-sm font-medium">Notificaciones</div>
        <div className="mt-2 text-xs text-muted-foreground">
          Estás al día. Los eventos de ejecución en vivo aparecerán acá.
        </div>
      </PopoverContent>
    </Popover>
  );
}
