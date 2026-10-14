"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ListOrdered,
  X,
  MessageSquare,
  ShieldAlert,
  AlertTriangle,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import type {
  ApprovalCardOption,
  ApprovalCardProps,
  ApprovalCardQuestion,
  ApprovalCardStatus,
} from "./types";
import { formatQuestionSubmission } from "./format-submission.js";
import { cn } from "@/lib/utils.js";
import "./approval-card.css";

export function ApprovalCard({
  mode = "questions",
  className,
  disabled = false,
  children,
  // Review mode props
  title,
  description,
  status: propStatus = "pending",
  risk,
  category,
  result,
  approveLabel = "Approve",
  rejectLabel = "Decline",
  requestChangesLabel = "Request changes",
  onApprove,
  onReject,
  onRequestChanges,
  onDismiss,
  // Questions mode props
  questions = [],
  settledAnswers,
  onSubmitQuestions,
  onDismissQuestions,
  // Plan review mode props
  planId,
  summary,
  steps = [],
  settledStatus,
  onApprovePlan,
  onDiscardPlan,
  onEditPlanStep,
}: ApprovalCardProps) {
  // ----------------------------------------------------
  // 1. REVIEW & APPROVE MODE (choicescard.md ReviewFlow)
  // ----------------------------------------------------
  if (mode === "review" || onApprove || onReject) {
    const isSettled =
      propStatus === "approved" ||
      propStatus === "rejected" ||
      propStatus === "changes-requested" ||
      propStatus === "answered" ||
      propStatus === "discarded";

    const isSubmitting = propStatus === "submitting";

    if (isSettled) {
      const outcomeText =
        result ||
        (propStatus === "approved"
          ? "Approved and executed."
          : propStatus === "changes-requested"
          ? "Changes requested. The agent will revise."
          : "Declined.");

      const isGood = propStatus === "approved";

      return (
        <div className={cn("approval-card-root is-settled", className)}>
          <div className="approval-card-header">
            <div className="approval-card-title-group">
              <div
                className="approval-card-icon-pill"
                style={{
                  background: isGood
                    ? "var(--live-soft, rgba(16, 185, 129, 0.12))"
                    : "var(--surface-3, rgba(255, 255, 255, 0.08))",
                  color: isGood
                    ? "var(--live, #10b981)"
                    : "var(--text-faint, #94a3b8)",
                }}
              >
                {isGood ? (
                  <Check className="size-3.5" />
                ) : (
                  <X className="size-3.5" />
                )}
              </div>
              <span className="approval-card-heading">
                {typeof title === "string" ? title : "Decision recorded"}
              </span>
            </div>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 text-[12px] font-medium",
                isGood ? "text-[var(--live)]" : "text-[var(--text-dim)]"
              )}
            >
              {outcomeText}
            </span>
          </div>
        </div>
      );
    }

    return (
      <div
        className={cn(
          "approval-card-root",
          risk === "high" || risk === "critical"
            ? "is-high-risk"
            : risk === "medium"
            ? "is-medium-risk"
            : "",
          className
        )}
      >
        <div className="approval-card-header">
          <div className="approval-card-title-group">
            <div className="approval-card-icon-pill">
              <ShieldAlert className="size-3.5" />
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span className="approval-card-heading">
                  {title || "Approval required"}
                </span>
                {category && (
                  <span className="approval-card-category-tag">{category}</span>
                )}
                {risk && (
                  <span className="approval-card-risk-pill" data-risk={risk}>
                    <span className="approval-card-risk-dash" />
                    {risk.toUpperCase()}
                  </span>
                )}
              </div>
            </div>
          </div>
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Dismiss approval"
              className="approval-card-dismiss-btn"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        {description && (
          <p className="mt-2.5 text-[13px] text-[var(--text-dim)] leading-relaxed">
            {description}
          </p>
        )}

        {children && <div className="approval-card-body">{children}</div>}

        <div className="approval-card-footer">
          <span className="text-[11.5px] text-[var(--text-faint)]">
            Execution waits on your sign-off.
          </span>
          <div className="approval-card-actions-group">
            {onRequestChanges && (
              <button
                type="button"
                disabled={disabled || isSubmitting}
                onClick={() => onRequestChanges()}
                className="approval-card-btn-ghost"
              >
                {requestChangesLabel}
              </button>
            )}
            {onReject && (
              <button
                type="button"
                disabled={disabled || isSubmitting}
                onClick={onReject}
                className="approval-card-btn-ghost"
              >
                <X className="size-3.5" />
                {rejectLabel}
              </button>
            )}
            {onApprove && (
              <button
                type="button"
                disabled={disabled || isSubmitting}
                onClick={onApprove}
                className="approval-card-btn-primary"
              >
                <Check className="size-3.5" />
                {approveLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ----------------------------------------------------
  // 2. PLAN REVIEW MODE
  // ----------------------------------------------------
  if (
    mode === "plan" ||
    (steps && steps.length > 0 && questions.length === 0)
  ) {
    const isSettled = Boolean(settledStatus);

    if (isSettled) {
      return (
        <div className={cn("approval-card-root is-settled", className)}>
          <div className="approval-card-header">
            <div className="approval-card-title-group">
              <div
                className="approval-card-icon-pill"
                style={{
                  background:
                    settledStatus === "approved"
                      ? "var(--live-soft, rgba(16, 185, 129, 0.12))"
                      : "var(--surface-3)",
                  color:
                    settledStatus === "approved"
                      ? "var(--live, #10b981)"
                      : "var(--text-faint)",
                }}
              >
                {settledStatus === "approved" ? (
                  <Check className="size-3.5" />
                ) : (
                  <X className="size-3.5" />
                )}
              </div>
              <span className="approval-card-heading">
                {settledStatus === "approved" ? "Plan approved" : "Plan discarded"}
              </span>
              <span className="approval-card-step-badge">
                {steps.length} step{steps.length === 1 ? "" : "s"}
              </span>
            </div>
            <span className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--live)]">
              {settledStatus === "approved" ? "Executing steps" : "Discarded"}
            </span>
          </div>
        </div>
      );
    }

    return (
      <div className={cn("approval-card-root", className)}>
        <div className="approval-card-header">
          <div className="approval-card-title-group">
            <div className="approval-card-icon-pill">
              <ListOrdered className="size-3.5" />
            </div>
            <span className="approval-card-heading">{title || "Plan"}</span>
            <span className="approval-card-step-badge">
              {steps.length} step{steps.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>

        {summary && (
          <p className="mt-2.5 text-[13px] text-[var(--text-dim)] leading-relaxed">
            {summary}
          </p>
        )}

        {/* Step list */}
        <ol className="approval-plan-steps">
          {steps.map((step, idx) => (
            <li key={idx} className="approval-plan-step">
              <span className="approval-plan-step-num">{idx + 1}</span>

              <div className="approval-plan-step-body">
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
                    className="approval-plan-step-input"
                  />
                )}

                {step.detail && (
                  <p className="approval-plan-step-detail">{step.detail}</p>
                )}

                {step.tools && step.tools.length > 0 && (
                  <div className="approval-plan-step-tools">
                    {step.tools.map((tool, tIdx) => (
                      <span key={tIdx} className="approval-plan-tool-tag">
                        {tool}
                      </span>
                    ))}
                  </div>
                )}
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
          <div className="approval-card-footer">
            <span className="text-[11.5px] text-[var(--text-faint)]">
              Nothing runs until approved.
            </span>
            <div className="approval-card-actions-group">
              <button
                type="button"
                disabled={disabled}
                onClick={onDiscardPlan}
                className="approval-card-btn-ghost"
              >
                Discard
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={onApprovePlan}
                className="approval-card-btn-primary"
              >
                <Check className="size-3.5" />
                Approve and run
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ----------------------------------------------------
  // 3. QUESTIONS / CHOICES MODE (choicescard.md QuestionFlow)
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
  const cardRef = useRef<HTMLDivElement>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [customText, setCustomText] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const total = questions.length;
  const isMulti = total > 1;
  const currentQ = questions[currentIndex] || questions[0];

  const isSettled = Boolean(
    settledAnswers &&
      (Array.isArray(settledAnswers)
        ? settledAnswers.length > 0 &&
          settledAnswers.some((a) => a && a !== "—" && a !== "")
        : Boolean(settledAnswers))
  );

  const currentAnswer = currentQ ? answers[currentQ.id] : undefined;
  const isMultipleSelect = currentQ ? currentQ.type === "multiple" : false;

  const handleSelectOption = (opt: ApprovalCardOption) => {
    if (disabled || isSubmitting || !currentQ) return;

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
      // In single choice, auto advance to next question smoothly
      if (currentIndex < total - 1) {
        setTimeout(() => {
          setCurrentIndex((idx) => Math.min(total - 1, idx + 1));
        }, 180);
      }
    }
  };

  const handleCustomChange = (val: string) => {
    if (!currentQ) return;
    setCustomText((prev) => ({ ...prev, [currentQ.id]: val }));
    if (val.trim()) {
      setAnswers((prev) => ({
        ...prev,
        [currentQ.id]: { value: "custom", label: val },
      }));
    }
  };

  const handleSkip = () => {
    if (!currentQ) return;
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
    if (isSettled || disabled || isSubmitting || total === 0 || !currentQ)
      return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!cardRef.current || !cardRef.current.contains(document.activeElement)) {
        return;
      }

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
  }, [isSettled, currentIndex, total, currentQ, answers, disabled, isSubmitting]);

  // Settled card summary
  if (isSettled) {
    return (
      <div className={cn("approval-card-root is-settled", className)}>
        <div className="approval-card-header">
          <div className="approval-card-title-group">
            <div
              className="approval-card-icon-pill"
              style={{ background: "var(--live-soft)", color: "var(--live)" }}
            >
              <Check className="size-3.5" />
            </div>
            <span className="approval-card-heading">Answered</span>
          </div>
        </div>
        <div className="approval-settled-recap">
          {questions.map((q, idx) => (
            <div key={q.id || idx} className="approval-settled-row">
              <span className="approval-settled-q">
                {q.header || q.prompt}
              </span>
              <div className="approval-settled-a">
                {settledAnswers?.[idx] || "—"}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (total === 0 || !currentQ) return null;

  const isLastQuestion = currentIndex === total - 1;

  return (
    <div ref={cardRef} className={cn("approval-card-root", className)}>
      {/* Header */}
      <div className="approval-card-header">
        <div className="approval-card-title-group">
          <div className="approval-card-icon-pill">
            <MessageSquare className="size-3.5" />
          </div>
          <span className="approval-card-heading">
            {currentQ.header || "Question"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {isMulti && (
            <div className="approval-card-pagination">
              <button
                type="button"
                disabled={currentIndex === 0}
                onClick={() => setCurrentIndex((idx) => Math.max(0, idx - 1))}
                aria-label="Previous question"
                className="approval-card-page-btn"
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
                className="approval-card-page-btn"
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
              className="approval-card-dismiss-btn"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Question Prompt */}
      <div className="approval-card-prompt-wrap">
        <h3 className="approval-card-prompt">{currentQ.prompt}</h3>
        {isMultipleSelect && (
          <span className="approval-card-hint">Select all that apply</span>
        )}
      </div>

      {/* Options List */}
      <div className="approval-card-options-list">
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
                "approval-card-option",
                isSelected && "is-selected"
              )}
            >
              <span className="approval-card-option-badge">
                {isSelected ? <Check className="size-3" /> : oIdx + 1}
              </span>

              <div className="approval-card-option-content">
                <span className="approval-card-option-title">{opt.label}</span>
                {opt.description && (
                  <p className="approval-card-option-desc">{opt.description}</p>
                )}
              </div>
            </button>
          );
        })}

        {/* Freeform write-in input */}
        <div>
          <input
            type="text"
            value={customText[currentQ.id] || ""}
            disabled={disabled}
            placeholder="Something else / in your own words…"
            onChange={(e) => handleCustomChange(e.target.value)}
            className="approval-card-custom-input"
          />
        </div>
      </div>

      {/* Footer controls */}
      <div className="approval-card-footer">
        {isMulti ? (
          <button
            type="button"
            onClick={handleSkip}
            disabled={disabled}
            className="approval-card-btn-skip"
          >
            Skip
          </button>
        ) : (
          <div />
        )}

        <div className="approval-card-actions-group">
          {isMulti && !isLastQuestion ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => setCurrentIndex((idx) => idx + 1)}
              className="approval-card-btn-ghost"
            >
              Next
              <ChevronRight className="size-3" />
            </button>
          ) : (
            <button
              type="button"
              disabled={disabled || isSubmitting}
              onClick={doSubmit}
              className="approval-card-btn-primary"
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
