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

            toast.success("¡Onboarding completado! Disfrutá Conductor.");
          } catch (error) {
            console.error("Error marking onboarding complete:", error);
          }
        };

        const tourSteps: Array<Record<string, unknown>> = [
          {
            popover: {
              title: "Bienvenido a Conductor 👋",
              description:
                "Hagamos un recorrido rápido por las funciones principales. Podés saltearlo en cualquier momento.",
              side: "over",
              align: "center",
            },
          },
          {
            element: '[data-tour="sidebar"]',
            popover: {
              title: "Navegación",
              description:
                "Desde acá podés navegar entre Ejecuciones, Planes, Programaciones, Plantillas y Configuración.",
              side: "right",
            },
          },
          {
            element: '[data-tour="nav-plans"]',
            popover: {
              title: "Planes",
              description:
                "Un Plan es una secuencia de prompts que ejecuta Claude. Creá planes para tareas recurrentes como revisiones de código, refactoring o documentación.",
              side: "right",
            },
          },
          {
            element: '[data-tour="nav-runs"]',
            popover: {
              title: "Ejecuciones",
              description:
                "Cada vez que ejecutás un plan, se crea una Ejecución. Seguí el progreso en tiempo real y revisá los logs cuando termine.",
              side: "right",
            },
          },
          {
            element: '[data-tour="nav-schedules"]',
            popover: {
              title: "Programaciones",
              description:
                "Automatizá la ejecución de planes con horarios cron. Configuralo una vez y olvidate — las ejecuciones pasan solas.",
              side: "right",
            },
          },
          {
            element: '[data-tour="nav-templates"]',
            popover: {
              title: "Plantillas",
              description:
                "Empezá rápido con plantillas prediseñadas para tareas comunes como MVP de app web, Refactoring o Generación de tests.",
              side: "right",
            },
          },
          {
            element: '[data-tour="nav-settings"]',
            popover: {
              title: "Configuración y Notificaciones",
              description:
                "Configurá canales de notificación (Slack, Email, Discord), conectá GitHub y administrá tu cuenta.",
              side: "right",
            },
          },
          {
            popover: {
              title: "Consejo Pro: Atajos de teclado",
              description:
                "Presioná ? en cualquier momento para ver todos los atajos de teclado. Usá Cmd+K para abrir la paleta de comandos. Presioná g p para ir a Planes.",
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
          doneBtnText: "Finalizar",
          nextBtnText: "Siguiente",
          prevBtnText: "Anterior",
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
