"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

interface OnboardingTourProps {
  onboardingCompleted: boolean;
}

interface DriverInstance {
  drive: () => void;
  destroy: () => void;
}

export function OnboardingTour({ onboardingCompleted }: OnboardingTourProps) {
  const driverRef = useRef<DriverInstance | null>(null);
  const hasInitialized = useRef(false);

  useEffect(() => {
    // Don't show tour if already completed
    if (onboardingCompleted) {
      return;
    }

    // Prevent double initialization
    if (hasInitialized.current) {
      return;
    }
    hasInitialized.current = true;

    // Dynamically import driver.js to avoid hydration issues
    const initTour = async () => {
      try {
        const module = await import("driver.js");
        const driver = module.driver || module.default;
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require("driver.js/dist/driver.css");

        const markOnboardingComplete = async () => {
          try {
            const response = await fetch("/api/settings", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ onboarding_completed: true }),
            });

            if (!response.ok) {
              console.error("Failed to mark onboarding complete");
              return;
            }

            toast.success("Onboarding completed! Enjoy using Conductor.");
          } catch (error) {
            console.error("Error marking onboarding complete:", error);
          }
        };

        const tourSteps: Array<Record<string, unknown>> = [
          {
            popover: {
              title: "Welcome to Conductor 👋",
              description:
                "Let's take a quick tour of the main features. You can skip this at any time.",
              side: "over",
              align: "center",
            },
          },
          {
            element: '[data-tour="sidebar"]',
            popover: {
              title: "Navigation",
              description:
                "Navigate between Runs, Plans, Schedules, Templates, and Settings from here.",
              side: "right",
            },
          },
          {
            element: '[data-tour="nav-plans"]',
            popover: {
              title: "Plans",
              description:
                "A Plan is a sequence of prompts that Claude executes. Create plans for recurring tasks like code reviews, refactoring, or documentation.",
              side: "right",
            },
          },
          {
            element: '[data-tour="nav-runs"]',
            popover: {
              title: "Runs",
              description:
                "Each time you execute a plan, it creates a Run. Watch progress in real-time and review logs when done.",
              side: "right",
            },
          },
          {
            element: '[data-tour="nav-schedules"]',
            popover: {
              title: "Schedules",
              description:
                "Automate plan execution with cron schedules. Set it and forget it — runs happen automatically.",
              side: "right",
            },
          },
          {
            element: '[data-tour="nav-templates"]',
            popover: {
              title: "Templates",
              description:
                "Get started quickly with pre-built templates for common tasks like Web App MVP, Refactoring, or Test Generation.",
              side: "right",
            },
          },
          {
            element: '[data-tour="nav-settings"]',
            popover: {
              title: "Settings & Notifications",
              description:
                "Configure notification channels (Slack, Email, Discord), connect GitHub, and manage your account.",
              side: "right",
            },
          },
          {
            popover: {
              title: "Pro Tip: Keyboard Shortcuts",
              description:
                "Press ? anywhere to see all keyboard shortcuts. Use Cmd+K to open the command palette. Press g p to go to Plans.",
              side: "over",
              align: "center",
            },
          },
        ];

        const config: Record<string, unknown> = {
          showProgress: true,
          steps: tourSteps,
          allowClose: true,
          overlayOpacity: 0.5,
          smoothScroll: true,
          doneBtnText: "Finish",
          nextBtnText: "Next",
          prevBtnText: "Previous",
        };

        const driverInstance = driver(config);
        driverRef.current = driverInstance;

        // Start the tour after a brief delay to ensure DOM is ready
        const timeoutId = setTimeout(() => {
          driverInstance.drive();
        }, 500);

        // Listen for tour destruction (when user clicks finish or close)
        const originalDestroy = driverInstance.destroy.bind(driverInstance);
        driverInstance.destroy = () => {
          clearTimeout(timeoutId);
          void markOnboardingComplete();
          return originalDestroy();
        };

        return () => {
          clearTimeout(timeoutId);
          if (driverRef.current) {
            try {
              driverRef.current.destroy();
            } catch {
              // Ignore errors on cleanup
            }
          }
        };
      } catch (error) {
        console.error("Failed to initialize onboarding tour:", error);
      }
    };

    void initTour();
  }, [onboardingCompleted]);

  return null;
}
