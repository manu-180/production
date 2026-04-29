"use client";

import { useState } from "react";
import { ClaudeTokenStep } from "./_components/claude-token-step";
import { DoneStep } from "./_components/done-step";
import { WorkingDirStep } from "./_components/working-dir-step";

const STEP_LABELS = ["Claude Token", "Working Directory", "Done"];

export default function OnboardingPage() {
  const [step, setStep] = useState(0);
  const [workingDir, setWorkingDir] = useState("");

  return (
    <div className="flex flex-col gap-8">
      {/* Step indicator */}
      <div className="flex items-center justify-center gap-0">
        {STEP_LABELS.map((label, i) => (
          <div key={label} className="flex items-center">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={`size-7 rounded-full flex items-center justify-center text-xs font-mono font-medium transition-colors ${
                  i < step
                    ? "bg-emerald-500 text-white"
                    : i === step
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {i < step ? "✓" : i + 1}
              </div>
              <span
                className={`text-[10px] font-mono uppercase tracking-wide ${
                  i === step ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {label}
              </span>
            </div>
            {i < STEP_LABELS.length - 1 && (
              <div
                className={`h-px w-16 mx-2 mb-5 transition-colors ${i < step ? "bg-emerald-500" : "bg-border"}`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step content */}
      {step === 0 && <ClaudeTokenStep onComplete={() => setStep(1)} />}
      {step === 1 && (
        <WorkingDirStep
          onComplete={(dir) => {
            setWorkingDir(dir);
            setStep(2);
          }}
        />
      )}
      {step === 2 && <DoneStep workingDir={workingDir} />}
    </div>
  );
}
