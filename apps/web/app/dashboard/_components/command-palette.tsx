"use client";
import {
  ActivityIcon,
  FileTextIcon,
  HomeIcon,
  PlusIcon,
  SettingsIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useState } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useShortcut } from "@/hooks/use-keyboard-shortcuts";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { setTheme } = useTheme();

  useShortcut("mod+k", (e) => {
    e.preventDefault();
    setOpen((o) => !o);
  }, { allowInInput: true });

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  useEffect(() => {
    function onOpenEvent() {
      setOpen(true);
    }
    window.addEventListener("open-command-palette", onOpenEvent);
    return () => window.removeEventListener("open-command-palette", onOpenEvent);
  }, []);

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Command palette" description="Quick navigation and actions">
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Navigate">
          <CommandItem onSelect={() => go("/dashboard")}>
            <HomeIcon className="mr-2 size-4" /> Dashboard
          </CommandItem>
          <CommandItem onSelect={() => go("/dashboard/runs")}>
            <ActivityIcon className="mr-2 size-4" /> Runs
          </CommandItem>
          <CommandItem onSelect={() => go("/dashboard/plans")}>
            <FileTextIcon className="mr-2 size-4" /> Plans
          </CommandItem>
          <CommandItem onSelect={() => go("/dashboard/settings")}>
            <SettingsIcon className="mr-2 size-4" /> Settings
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => go("/dashboard/plans/new")}>
            <PlusIcon className="mr-2 size-4" /> New plan
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Theme">
          <CommandItem onSelect={() => { setTheme("light"); setOpen(false); }}>
            Light
          </CommandItem>
          <CommandItem onSelect={() => { setTheme("dark"); setOpen(false); }}>
            Dark
          </CommandItem>
          <CommandItem onSelect={() => { setTheme("system"); setOpen(false); }}>
            System
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
