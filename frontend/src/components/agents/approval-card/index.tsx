"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ListOrdered,
  X,
  MessageSquare,
} from "lucide-react";
import type {
  ApprovalCardOption,
  ApprovalCardProps,
  ApprovalCardQuestion,
} from "./types";
import { formatQuestionSubmission } from "./format-submission.js";
import { cn } from "@/lib/utils.js";

export function ApprovalCard({
  mode = "questions",
  className,
  disabled = false,
  questions = [],
  settledAnswers,
  onSubmitQuestions,
  onDismissQuestions,
  planId,
  title = "Plan",
  summary,
  steps = [],
  settledStatus,
  onApprovePlan,
  onDiscardPlan,
  onEditPlanStep,
  onRequestChanges,
}: ApprovalCardProps) {
  // ----------------------------------------------------
  // PLAN REVIEW MODE
  // ----------------------------------------------------
  if (mode === "plan" || (steps && steps.length > 0 && questions.length === 0)) {
    const isSettled = Boolean(settledStatus);

    return (
      <div
        className={cn(
          "w-full max-w-2xl my-3 rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)] p-4 text-[var(--text)] transition-all",
          isSettled && "opacity-90 bg-[var(--canvas)]",
          className
        )}
      >
        <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <div className="flex size-6 items-center justify-center rounded-full bg-[var(--accent-wash)] text-[var(--accent)]">
              <ListOrdered className="size-3.5" />
            </div>
            <span className="text-[13px] font-semibold text-[var(--text)]">
              {title}
            </span>
            <span className="rounded-full bg-[var(--surface-3)] px-2 py-0.5 text-[11px] font-mono text-[var(--text-dim)]">
              {steps.length} step{steps.length === 1 ? "" : "s"}
            </span>
          </div>

          {isSettled && (
            <span className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--live)]">
              <Check className="size-3.5" />
              {settledStatus === "approved" ? "Approved" : "Discarded"}
            </span>
          )}
        </div>

        {summary && (
          <p className="mt-2.5 text-[13px] text-[var(--text-dim)] leading-relaxed">
            {summary}
          </p>
        )}

        {/* Step list */}
        <ol className="mt-3 flex flex-col gap-2">
          {steps.map((step, idx) => (
            <li
              key={idx}
              className="group rounded-[6px] border border-[var(--border)] bg-[var(--canvas)] p-2.5 transition-colors"
            >
              <div className="flex items-start gap-2.5">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--surface-3)] text-[11px] font-mono font-medium text-[var(--text-faint)]">
                  {idx + 1}
                </span>

                <div className="flex-1 min-w-0">
                  {isSettled ? (
                    <span className="text-[13px] font-medium text-[var(--text)] select-text">
                      {step.title}
                    </span>
                  ) : (
                    <input
                      type="text"
                      value={step.title}
                      disabled={disabled}
                      aria-label={`Step ${idx + 1}`}
                      onChange={(e) => onEditPlanStep?.(idx, e.target.value)}
                      className="w-full bg-transparent text-[13px] font-medium text-[var(--text)] outline-none border-b border-transparent focus:border-[var(--accent)] transition-colors px-0.5"
                    />
                  )}

                  {step.detail && (
                    <p className="mt-1 text-[12px] text-[var(--text-dim)] leading-normal">
                      {step.detail}
                    </p>
                  )}

                  {step.tools && step.tools.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {step.tools.map((tool, tIdx) => (
                        <span
                          key={tIdx}
                          className="rounded px-1.5 py-0.5 text-[10.5px] font-mono bg-[var(--surface-2)] text-[var(--text-faint)] border border-[var(--border)]"
                        >
                          {tool}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>

        {/* Actions */}
        {isSettled ? (
          <p className="mt-3 text-[12px] text-[var(--text-faint)]">
            {settledStatus === "approved"
              ? "Plan approved. Executing steps."
              : "Plan was discarded."}
          </p>
        ) : (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--border)]">
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={disabled}
                onClick={onApprovePlan}
                className="inline-flex items-center gap-1.5 rounded-[9999px] bg-[var(--accent)] px-3.5 py-1.5 text-[12.5px] font-medium text-white shadow-sm hover:opacity-95 active:scale-[0.98] transition-all disabled:opacity-50 cursor-pointer"
              >
                <Check className="size-3.5" />
                Approve and run
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={onDiscardPlan}
                className="inline-flex items-center gap-1.5 rounded-[9999px] border border-[var(--border)] bg-transparent px-3 py-1.5 text-[12.5px] font-medium text-[var(--text-dim)] hover:bg-[var(--surface-3)] hover:text-[var(--text)] active:scale-[0.98] transition-all disabled:opacity-50 cursor-pointer"
              >
                Discard
              </button>
            </div>
            <span className="text-[11.5px] text-[var(--text-faint)]">
              Nothing runs until approved.
            </span>
          </div>
        )}
      </div>
    );
  }

  // ----------------------------------------------------
  // QUESTIONS / CHOICES MODE
  // ----------------------------------------------------
  return (
    <QuestionsView
      questions={questions}
      settledAnswers={settledAnswers}
      disabled={disabled}
      className={className}
      onSubmit={onSubmitQuestions}
      onDismiss={onDismissQuestions}
    />
  );
}

function QuestionsView({
  questions = [],
  settledAnswers,
  disabled = false,
  className,
  onSubmit,
  onDismiss,
}: {
  questions: ApprovalCardQuestion[];
  settledAnswers?: string[];
  disabled?: boolean;
  className?: string;
  onSubmit?: (formattedAnswers: string[]) => void | Promise<void>;
  onDismiss?: () => void;
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [customText, setCustomText] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const total = questions.length;
  const isMulti = total > 1;
  const currentQ = questions[currentIndex] || questions[0];

  const isSettled = Boolean(settledAnswers && settledAnswers.length > 0);

  // Settled card summary
  if (isSettled) {
    return (
      <div
        className={cn(
          "w-full max-w-xl my-3 rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)] p-4 text-[var(--text)]",
          className
        )}
      >
        <div className="flex items-center gap-2 pb-2.5 border-b border-[var(--border)]">
          <div className="flex size-5 items-center justify-center rounded-full bg-[var(--live-soft)] text-[var(--live)]">
            <Check className="size-3" />
          </div>
          <span className="text-[12.5px] font-semibold text-[var(--text)]">
            Answered
          </span>
        </div>
        <div className="mt-3 flex flex-col gap-2.5">
          {questions.map((q, idx) => (
            <div key={q.id || idx} className="text-[12.5px]">
              <span className="font-medium text-[var(--text-dim)]">
                {q.header || q.prompt}
              </span>
              <p className="mt-0.5 text-[13px] text-[var(--text)] font-normal">
                {settledAnswers?.[idx] || "—"}
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (total === 0 || !currentQ) return null;

  const currentAnswer = answers[currentQ.id];
  const isMultipleSelect = currentQ.type === "multiple";

  const handleSelectOption = (opt: ApprovalCardOption) => {
    if (disabled || isSubmitting) return;

    if (isMultipleSelect) {
      const existing: ApprovalCardOption[] = Array.isArray(currentAnswer)
        ? currentAnswer
        : [];
      const foundIdx = existing.findIndex((e) => e.value === opt.value);
      let updated: ApprovalCardOption[];
      if (foundIdx >= 0) {
        updated = existing.filter((_, i) => i !== foundIdx);
      } else {
        updated = [...existing, opt];
      }
      setAnswers((prev) => ({ ...prev, [currentQ.id]: updated }));
    } else {
      setAnswers((prev) => ({ ...prev, [currentQ.id]: opt }));
      // In single choice, if not the last question, automatically advance after short pause
      if (currentIndex < total - 1) {
        setTimeout(() => {
          setCurrentIndex((idx) => Math.min(total - 1, idx + 1));
        }, 180);
      }
    }
  };

  const handleCustomChange = (val: string) => {
    setCustomText((prev) => ({ ...prev, [currentQ.id]: val }));
    if (val.trim()) {
      setAnswers((prev) => ({
        ...prev,
        [currentQ.id]: { value: "custom", label: val },
      }));
    }
  };

  const handleSkip = () => {
    setAnswers((prev) => ({ ...prev, [currentQ.id]: { status: "skipped" } }));
    if (currentIndex < total - 1) {
      setCurrentIndex((idx) => idx + 1);
    }
  };

  const doSubmit = async () => {
    if (disabled || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const formatted = formatQuestionSubmission(answers);
      await onSubmit?.(formatted);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Keyboard navigation: 1-9 to pick, Enter to advance/submit
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (disabled || isSubmitting) return;
      // Don't intercept if typing in an input
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      ) {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          if (currentIndex < total - 1) {
            setCurrentIndex((idx) => idx + 1);
          } else {
            doSubmit();
          }
        }
        return;
      }

      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= 9 && currentQ.options) {
        const targetOpt = currentQ.options[num - 1];
        if (targetOpt) {
          e.preventDefault();
          handleSelectOption(targetOpt);
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (currentIndex < total - 1) {
          setCurrentIndex((idx) => idx + 1);
        } else {
          doSubmit();
        }
      } else if (e.key === "ArrowRight" && currentIndex < total - 1) {
        e.preventDefault();
        setCurrentIndex((idx) => idx + 1);
      } else if (e.key === "ArrowLeft" && currentIndex > 0) {
        e.preventDefault();
        setCurrentIndex((idx) => idx - 1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentIndex, total, currentQ, answers, disabled, isSubmitting]);

  const hasAnsweredCurrent =
    currentAnswer !== undefined && currentAnswer !== null;
  const isLastQuestion = currentIndex === total - 1;

  return (
    <div
      className={cn(
        "w-full max-w-xl my-3 rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)] p-4 text-[var(--text)] transition-all",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <MessageSquare className="size-4 text-[var(--accent)]" />
          <span className="text-[13px] font-semibold text-[var(--text)]">
            {currentQ.header || "Question"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {isMulti && (
            <div className="flex items-center gap-1 text-[11px] font-mono text-[var(--text-faint)]">
              <button
                type="button"
                disabled={currentIndex === 0}
                onClick={() => setCurrentIndex((idx) => Math.max(0, idx - 1))}
                aria-label="Previous question"
                className="rounded p-1 hover:bg-[var(--surface-3)] disabled:opacity-30 cursor-pointer"
              >
                <ChevronLeft className="size-3.5" />
              </button>
              <span>
                {currentIndex + 1} of {total}
              </span>
              <button
                type="button"
                disabled={currentIndex === total - 1}
                onClick={() =>
                  setCurrentIndex((idx) => Math.min(total - 1, idx + 1))
                }
                aria-label="Next question"
                className="rounded p-1 hover:bg-[var(--surface-3)] disabled:opacity-30 cursor-pointer"
              >
                <ChevronRight className="size-3.5" />
              </button>
            </div>
          )}

          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Dismiss"
              className="rounded p-1 text-[var(--text-faint)] hover:text-[var(--text)] hover:bg-[var(--surface-3)] transition-colors cursor-pointer"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Question Prompt */}
      <div className="mt-3">
        <h3 className="text-[14px] font-medium text-[var(--text)] leading-snug">
          {currentQ.prompt}
        </h3>
        {isMultipleSelect && (
          <span className="mt-1 block text-[11.5px] text-[var(--text-faint)]">
            Select all that apply
          </span>
        )}
      </div>

      {/* Options List */}
      <div className="mt-3.5 flex flex-col gap-2">
        {(currentQ.options || []).map((opt, oIdx) => {
          const isSelected = isMultipleSelect
            ? Array.isArray(currentAnswer) &&
              currentAnswer.some((a) => a.value === opt.value)
            : currentAnswer?.value === opt.value;

          return (
            <button
              key={opt.value || oIdx}
              type="button"
              disabled={disabled}
              onClick={() => handleSelectOption(opt)}
              className={cn(
                "group relative flex w-full items-start gap-3 rounded-[8px] border p-3 text-left transition-all duration-150 cursor-pointer",
                isSelected
                  ? "border-[var(--accent)] bg-[var(--accent-wash)]"
                  : "border-[var(--border)] bg-[var(--canvas)] hover:border-[var(--border-strong,var(--text-faint))] hover:bg-[var(--surface-3)]"
              )}
            >
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded text-[11px] font-mono transition-colors",
                  isSelected
                    ? "bg-[var(--accent)] text-white font-medium"
                    : "border border-[var(--border)] text-[var(--text-faint)] group-hover:text-[var(--text)]"
                )}
              >
                {isSelected ? <Check className="size-3" /> : oIdx + 1}
              </span>

              <div className="flex-1 min-w-0">
                <span
                  className={cn(
                    "text-[13px] font-medium leading-tight block",
                    isSelected
                      ? "text-[var(--text)]"
                      : "text-[var(--text)] group-hover:text-[var(--text)]"
                  )}
                >
                  {opt.label}
                </span>
                {opt.description && (
                  <p className="mt-1 text-[11.5px] text-[var(--text-dim)] leading-normal">
                    {opt.description}
                  </p>
                )}
              </div>
            </button>
          );
        })}

        {/* Freeform write-in input */}
        <div className="mt-1">
          <input
            type="text"
            value={customText[currentQ.id] || ""}
            disabled={disabled}
            placeholder="Something else / in your own words…"
            onChange={(e) => handleCustomChange(e.target.value)}
            className="w-full rounded-[6px] border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-[12.5px] text-[var(--text)] placeholder-[var(--text-faint)] outline-none focus:border-[var(--accent)] transition-colors"
          />
        </div>
      </div>

      {/* Footer controls */}
      <div className="mt-4 flex items-center justify-between pt-2.5 border-t border-[var(--border)]">
        {isMulti ? (
          <button
            type="button"
            onClick={handleSkip}
            disabled={disabled}
            className="text-[12px] font-medium text-[var(--text-faint)] hover:text-[var(--text)] transition-colors cursor-pointer"
          >
            Skip
          </button>
        ) : (
          <div />
        )}

        <div className="flex items-center gap-2">
          {isMulti && !isLastQuestion ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => setCurrentIndex((idx) => idx + 1)}
              className="inline-flex items-center gap-1 rounded-[9999px] border border-[var(--border)] bg-[var(--surface-3)] px-3 py-1.5 text-[12px] font-medium text-[var(--text)] hover:bg-[var(--surface-2)] active:scale-[0.98] transition-all cursor-pointer"
            >
              Next
              <ChevronRight className="size-3" />
            </button>
          ) : (
            <button
              type="button"
              disabled={disabled || isSubmitting}
              onClick={doSubmit}
              className="inline-flex items-center gap-1.5 rounded-[9999px] bg-[var(--accent)] px-4 py-1.5 text-[12.5px] font-medium text-white shadow-sm hover:opacity-95 active:scale-[0.98] transition-all disabled:opacity-50 cursor-pointer"
            >
              <Check className="size-3.5" />
              {isSubmitting ? "Submitting…" : "Submit"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default ApprovalCard;
