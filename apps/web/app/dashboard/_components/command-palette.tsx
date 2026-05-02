"use client";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { useShortcut } from "@/hooks/use-keyboard-shortcuts";
import {
  ActivityIcon,
  BellIcon,
  CalendarIcon,
  FileTextIcon,
  HomeIcon,
  KeyboardIcon,
  LayoutTemplateIcon,
  PlusIcon,
  SettingsIcon,
  ZapIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

interface CommandPaletteProps {
  /** Controlled open state. When omitted the component manages its own state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Called when the user selects "Show Keyboard Shortcuts" */
  onShowShortcuts?: () => void;
}

export function CommandPalette({
  open: controlledOpen,
  onOpenChange,
  onShowShortcuts,
}: CommandPaletteProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;

  const setOpen = useCallback(
    (value: boolean) => {
      if (!isControlled) setInternalOpen(value);
      onOpenChange?.(value);
    },
    [isControlled, onOpenChange],
  );

  const router = useRouter();
  const { setTheme } = useTheme();

  // Cmd+K / Ctrl+K — allowed even when an input is focused
  useShortcut(
    "mod+k",
    (e) => {
      e.preventDefault();
      setOpen(!open);
    },
    { allowInInput: true },
  );

  // Listen for the custom event fired by the Topbar search button
  useEffect(() => {
    function onOpenEvent() {
      setOpen(true);
    }
    window.addEventListener("open-command-palette", onOpenEvent);
    return () => window.removeEventListener("open-command-palette", onOpenEvent);
  }, [setOpen]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router, setOpen],
  );

  const handleShowShortcuts = useCallback(() => {
    setOpen(false);
    onShowShortcuts?.();
    // Also dispatch a custom event so un-wired consumers can listen
    window.dispatchEvent(new CustomEvent("open-shortcuts-modal"));
  }, [setOpen, onShowShortcuts]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Paleta de comandos"
      description="Navegación rápida y acciones"
    >
      <CommandInput placeholder="Escribí un comando o buscá…" />
      <CommandList>
        <CommandEmpty>Sin resultados.</CommandEmpty>

        <CommandGroup heading="Navegación">
          <CommandItem
            keywords={["home", "overview", "dashboard"]}
            onSelect={() => go("/dashboard")}
          >
            <HomeIcon />
            Ir al Panel
            <CommandShortcut>G H</CommandShortcut>
          </CommandItem>
          <CommandItem
            keywords={["runs", "history", "executions"]}
            onSelect={() => go("/dashboard/runs")}
          >
            <ActivityIcon />
            Ir a Ejecuciones
            <CommandShortcut>G R</CommandShortcut>
          </CommandItem>
          <CommandItem
            keywords={["plans", "list", "tasks"]}
            onSelect={() => go("/dashboard/plans")}
          >
            <FileTextIcon />
            Ir a Planes
            <CommandShortcut>G P</CommandShortcut>
          </CommandItem>
          <CommandItem
            keywords={["templates", "browse", "library"]}
            onSelect={() => go("/dashboard/templates")}
          >
            <LayoutTemplateIcon />
            Explorar plantillas
          </CommandItem>
          <CommandItem
            keywords={["schedule", "cron", "recurring"]}
            onSelect={() => go("/dashboard/schedule")}
          >
            <CalendarIcon />
            Administrar programaciones
          </CommandItem>
          <CommandItem
            keywords={["settings", "preferences", "config"]}
            onSelect={() => go("/dashboard/settings")}
          >
            <SettingsIcon />
            Abrir configuración
            <CommandShortcut>G S</CommandShortcut>
          </CommandItem>
          <CommandItem
            keywords={["notifications", "alerts", "email"]}
            onSelect={() => go("/dashboard/settings/notifications")}
          >
            <BellIcon />
            Configuración de notificaciones
          </CommandItem>
          <CommandItem
            keywords={["integrations", "connect", "api", "webhooks"]}
            onSelect={() => go("/dashboard/integrations")}
          >
            <ZapIcon />
            Integraciones
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Acciones">
          <CommandItem
            keywords={["new", "create", "plan", "add"]}
            onSelect={() => go("/dashboard/plans/new")}
          >
            <PlusIcon />
            Crear nuevo plan
          </CommandItem>
          <CommandItem
            keywords={["shortcuts", "keyboard", "help", "keys"]}
            onSelect={handleShowShortcuts}
          >
            <KeyboardIcon />
            Ver atajos de teclado
            <CommandShortcut>?</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Tema">
          <CommandItem
            keywords={["light", "theme", "mode"]}
            onSelect={() => {
              setTheme("light");
              setOpen(false);
            }}
          >
            Claro
          </CommandItem>
          <CommandItem
            keywords={["dark", "theme", "mode"]}
            onSelect={() => {
              setTheme("dark");
              setOpen(false);
            }}
          >
            Oscuro
          </CommandItem>
          <CommandItem
            keywords={["system", "theme", "auto", "mode"]}
            onSelect={() => {
              setTheme("system");
              setOpen(false);
            }}
          >
            Sistema
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
