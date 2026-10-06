"use client"

import * as React from "react"
import { createContext, useContext, useState, useMemo, useCallback, useRef, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Check,
  ChevronLeft,
  ChevronRight,
  X,
  CornerDownLeft,
} from "lucide-react"
import { cn } from "cn"

export type QuestionOptionInput = {
  value: string
  label: React.ReactNode
  hint?: React.ReactNode
  description?: React.ReactNode
}

export type QuestionInput = {
  id: string
  type: "single" | "multiple"
  prompt: React.ReactNode
  header?: string
  options: QuestionOptionInput[]
  required?: boolean
}

export type QuestionSubmissionAnswer = {
  value: string
  label: React.ReactNode
}

export type QuestionsSubmission = Array<
  | {
      questionId: string
      prompt: React.ReactNode
      type: "single"
      status: "answered"
      answer: QuestionSubmissionAnswer
    }
  | {
      questionId: string
      prompt: React.ReactNode
      type: "single"
      status: "skipped"
      answer: QuestionSubmissionAnswer
    }
  | {
      questionId: string
      prompt: React.ReactNode
      type: "multiple"
      status: "answered"
      answer: QuestionSubmissionAnswer[]
    }
  | {
      questionId: string
      prompt: React.ReactNode
      type: "multiple"
      status: "skipped"
      answer: QuestionSubmissionAnswer[]
    }
>

export const QUESTION_OTHER_VALUE = "__other__"
export const QUESTION_NO_PREFERENCE_VALUE = "__no_preference__"
export const QUESTION_NO_PREFERENCE_LABEL = "[No Preference]"

type AnswerState = Record<
  string,
  | { value: string; label: React.ReactNode; customText?: string }
  | Array<{ value: string; label: React.ReactNode; customText?: string }>
>

interface QuestionsContextType {
  items: QuestionInput[]
  index: number
  setIndex: (idx: number | ((prev: number) => number)) => void
  answers: AnswerState
  otherInputs: Record<string, string>
  setOtherInput: (questionId: string, text: string) => void
  selectOption: (questionId: string, option: { value: string; label: React.ReactNode }) => void
  isAnswered: (questionId: string) => boolean
  canSubmit: boolean
  canGoNext: boolean
  canGoPrev: boolean
  next: () => void
  prev: () => void
  skip: () => void
  submit: () => void
  dismiss: () => void
  autoAdvance: boolean
  activeQuestion: QuestionInput | undefined
}

const QuestionsContext = createContext<QuestionsContextType | null>(null)

export function useQuestions() {
  const ctx = useContext(QuestionsContext)
  if (!ctx) {
    throw new Error("Questions components must be used within a <Questions> root provider")
  }
  return ctx
}

export interface QuestionsProps extends React.HTMLAttributes<HTMLDivElement> {
  items: QuestionInput[]
  autoAdvance?: boolean
  onSubmit?: (submission: QuestionsSubmission) => void
  onSkip?: (questionId: string) => void
  onDismiss?: () => void
  children: React.ReactNode
}

export function Questions({
  items = [],
  autoAdvance = true,
  onSubmit,
  onSkip,
  onDismiss,
  className,
  children,
  ...props
}: QuestionsProps) {
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<AnswerState>({})
  const [otherInputs, setOtherInputs] = useState<Record<string, string>>({})
  const containerRef = useRef<HTMLDivElement>(null)

  const activeQuestion = items[index]

  const isAnswered = useCallback(
    (questionId: string) => {
      const q = items.find((item) => item.id === questionId)
      if (!q) return false
      const ans = answers[questionId]
      if (!ans) return false

      if (q.type === "single") {
        const item = ans as { value: string; label: React.ReactNode; customText?: string }
        if (!item || !item.value) return false
        if (item.value === QUESTION_OTHER_VALUE) {
          const custom = (otherInputs[questionId] || item.customText || "").trim()
          return custom.length > 0
        }
        return true
      } else {
        const list = (ans as Array<{ value: string; label: React.ReactNode; customText?: string }>) || []
        if (list.length === 0) return false
        const otherSelected = list.some((i) => i.value === QUESTION_OTHER_VALUE)
        if (otherSelected) {
          const custom = (otherInputs[questionId] || "").trim()
          return custom.length > 0 || list.length > 1
        }
        return true
      }
    },
    [items, answers, otherInputs]
  )

  const canSubmit = useMemo(() => {
    return items.every((q) => {
      if (!q.required) return true
      return isAnswered(q.id)
    })
  }, [items, isAnswered])

  const canGoPrev = index > 0
  const canGoNext = useMemo(() => {
    if (index >= items.length - 1) return false
    if (!activeQuestion) return false
    if (activeQuestion.required) {
      return isAnswered(activeQuestion.id)
    }
    return true
  }, [index, items.length, activeQuestion, isAnswered])

  const next = useCallback(() => {
    if (index < items.length - 1) {
      setIndex((i) => i + 1)
    }
  }, [index, items.length])

  const prev = useCallback(() => {
    if (index > 0) {
      setIndex((i) => i - 1)
    }
  }, [index])

  const skip = useCallback(() => {
    if (activeQuestion) {
      onSkip?.(activeQuestion.id)
    }
    if (index < items.length - 1) {
      setIndex((i) => i + 1)
    }
  }, [activeQuestion, onSkip, index, items.length])

  const submit = useCallback(() => {
    if (!canSubmit) return

    const submission: QuestionsSubmission = items.map((q) => {
      const answered = isAnswered(q.id)
      const rawAns = answers[q.id]
      const otherText = (otherInputs[q.id] || "").trim()

      if (q.type === "single") {
        if (!answered || !rawAns) {
          return {
            questionId: q.id,
            prompt: q.prompt,
            type: "single",
            status: "skipped",
            answer: {
              value: QUESTION_NO_PREFERENCE_VALUE,
              label: QUESTION_NO_PREFERENCE_LABEL,
            },
          }
        }
        const item = rawAns as { value: string; label: React.ReactNode }
        const label = item.value === QUESTION_OTHER_VALUE && otherText ? otherText : item.label
        return {
          questionId: q.id,
          prompt: q.prompt,
          type: "single",
          status: "answered",
          answer: {
            value: item.value === QUESTION_OTHER_VALUE ? otherText : item.value,
            label,
          },
        }
      } else {
        const list = (rawAns as Array<{ value: string; label: React.ReactNode }>) || []
        if (!answered || list.length === 0) {
          return {
            questionId: q.id,
            prompt: q.prompt,
            type: "multiple",
            status: "skipped",
            answer: [
              {
                value: QUESTION_NO_PREFERENCE_VALUE,
                label: QUESTION_NO_PREFERENCE_LABEL,
              },
            ],
          }
        }
        const formattedAnswers = list.map((item) => {
          const label = item.value === QUESTION_OTHER_VALUE && otherText ? otherText : item.label
          return {
            value: item.value === QUESTION_OTHER_VALUE ? otherText : item.value,
            label,
          }
        })
        return {
          questionId: q.id,
          prompt: q.prompt,
          type: "multiple",
          status: "answered",
          answer: formattedAnswers,
        }
      }
    })

    onSubmit?.(submission)
  }, [canSubmit, items, isAnswered, answers, otherInputs, onSubmit])

  const selectOption = useCallback(
    (questionId: string, option: { value: string; label: React.ReactNode }) => {
      const q = items.find((item) => item.id === questionId)
      if (!q) return

      if (q.type === "single") {
        setAnswers((prev) => ({
          ...prev,
          [questionId]: option,
        }))

        // Auto-advance for single selection if enabled and not the last question
        if (autoAdvance && option.value !== QUESTION_OTHER_VALUE && index < items.length - 1) {
          setTimeout(() => {
            setIndex((curr) => (curr < items.length - 1 ? curr + 1 : curr))
          }, 160)
        }
      } else {
        setAnswers((prev) => {
          const currentList = (prev[questionId] as Array<{ value: string; label: React.ReactNode }>) || []
          const exists = currentList.some((item) => item.value === option.value)
          const nextList = exists
            ? currentList.filter((item) => item.value !== option.value)
            : [...currentList, option]
          return {
            ...prev,
            [questionId]: nextList,
          }
        })
      }
    },
    [items, autoAdvance, index]
  )

  const setOtherInput = useCallback((questionId: string, text: string) => {
    setOtherInputs((prev) => ({
      ...prev,
      [questionId]: text,
    }))
  }, [])

  const contextValue = useMemo(
    () => ({
      items,
      index,
      setIndex,
      answers,
      otherInputs,
      setOtherInput,
      selectOption,
      isAnswered,
      canSubmit,
      canGoNext,
      canGoPrev,
      next,
      prev,
      skip,
      submit,
      dismiss: () => onDismiss?.(),
      autoAdvance,
      activeQuestion,
    }),
    [
      items,
      index,
      answers,
      otherInputs,
      setOtherInput,
      selectOption,
      isAnswered,
      canSubmit,
      canGoNext,
      canGoPrev,
      next,
      prev,
      skip,
      submit,
      onDismiss,
      autoAdvance,
      activeQuestion,
    ]
  )

  // Keyboard shortcut support: 1-9 to pick, Enter to submit/advance
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Do not intercept if typing in an input or textarea
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      ) {
        return
      }

      if (!activeQuestion) return

      const num = parseInt(e.key, 10)
      if (!isNaN(num) && num >= 1 && num <= activeQuestion.options.length) {
        e.preventDefault()
        const opt = activeQuestion.options[num - 1]
        if (opt) selectOption(activeQuestion.id, opt)
      } else if (e.key === "Enter") {
        e.preventDefault()
        if (index === items.length - 1 && canSubmit) {
          submit()
        } else if (canGoNext) {
          next()
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [activeQuestion, selectOption, index, items.length, canSubmit, canGoNext, submit, next])

  return (
    <QuestionsContext.Provider value={contextValue}>
      <div
        ref={containerRef}
        data-slot="questions-card"
        className={cn(
          "relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[#121622]/90 backdrop-blur-xl p-5 shadow-2xl transition-all duration-300",
          "text-white/90 text-sm font-body selection:bg-accent-500/30",
          className
        )}
        {...props}
      >
        {children}
      </div>
    </QuestionsContext.Provider>
  )
}

export function QuestionsHeader({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="questions-header"
      className={cn("flex items-start justify-between gap-3 mb-4 pb-1", className)}
      {...props}
    >
      {children}
    </div>
  )
}

export function QuestionsTitle({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  const { activeQuestion } = useQuestions()
  const prompt = children ?? activeQuestion?.prompt

  return (
    <div className="flex-1 min-w-0">
      {activeQuestion?.header && (
        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 mb-2 rounded-full text-[10px] uppercase font-mono tracking-wider font-semibold bg-white/[0.06] text-white/70 border border-white/[0.08]">
          <span className="size-1.5 rounded-full bg-accent-500 animate-pulse" />
          <span>{activeQuestion.header}</span>
        </div>
      )}
      <h3
        data-slot="questions-title"
        className={cn(
          "font-heading text-base sm:text-[17px] font-semibold text-white/95 leading-snug tracking-tight",
          className
        )}
        {...props}
      >
        {prompt}
      </h3>
    </div>
  )
}

export function QuestionsDismiss({
  className,
  onClick,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { dismiss } = useQuestions()

  return (
    <button
      type="button"
      data-slot="questions-dismiss"
      onClick={(e) => {
        onClick?.(e)
        dismiss()
      }}
      aria-label="Dismiss questions"
      className={cn(
        "shrink-0 size-7 flex items-center justify-center rounded-lg text-white/40 hover:text-white/90 hover:bg-white/[0.08] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-500",
        className
      )}
      {...props}
    >
      <X className="size-4" />
    </button>
  )
}

export function QuestionsCarousel({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="questions-carousel"
      className={cn("relative w-full overflow-hidden", className)}
      {...props}
    >
      {children}
    </div>
  )
}

export function QuestionsCarouselPagination({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const { items } = useQuestions()
  if (items.length <= 1) return null

  return (
    <div
      data-slot="questions-carousel-pagination"
      className={cn("inline-flex items-center gap-1.5 bg-white/[0.04] border border-white/[0.08] rounded-full px-2 py-1 shrink-0", className)}
      {...props}
    >
      {children}
    </div>
  )
}

export function QuestionsCarouselPrev({
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { prev, canGoPrev } = useQuestions()

  return (
    <button
      type="button"
      data-slot="questions-carousel-prev"
      onClick={prev}
      disabled={!canGoPrev}
      aria-label="Previous question"
      className={cn(
        "size-5 flex items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30 disabled:pointer-events-none focus:outline-none",
        className
      )}
      {...props}
    >
      {children ?? <ChevronLeft className="size-3.5" />}
    </button>
  )
}

export function QuestionsCarouselIndex({
  format = "of",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { format?: "of" | "slash" }) {
  const { index, items } = useQuestions()
  const display = format === "slash" ? `${index + 1}/${items.length}` : `${index + 1} of ${items.length}`

  return (
    <span
      data-slot="questions-carousel-index"
      className={cn("text-[11px] font-mono tabular-nums text-white/70 px-1 select-none", className)}
      {...props}
    >
      {display}
    </span>
  )
}

export function QuestionsCarouselNext({
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { next, canGoNext } = useQuestions()

  return (
    <button
      type="button"
      data-slot="questions-carousel-next"
      onClick={next}
      disabled={!canGoNext}
      aria-label="Next question"
      className={cn(
        "size-5 flex items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30 disabled:pointer-events-none focus:outline-none",
        className
      )}
      {...props}
    >
      {children ?? <ChevronRight className="size-3.5" />}
    </button>
  )
}

export function QuestionsCarouselContent({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="questions-carousel-content"
      className={cn("relative w-full my-2", className)}
      {...props}
    >
      {children}
    </div>
  )
}

export function QuestionsCarouselItem({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-slot="questions-carousel-item" className={cn("w-full", className)} {...props}>
      {children}
    </div>
  )
}

const QuestionScopeContext = createContext<{ id: string } | null>(null)

export function useQuestionScope() {
  const ctx = useContext(QuestionScopeContext)
  if (!ctx) throw new Error("QuestionOption components must be inside a <Question id='...'> component")
  return ctx
}

export function Question({
  id,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { id: string }) {
  const { index, items } = useQuestions()
  const active = items[index]?.id === id

  if (!active) return null

  return (
    <QuestionScopeContext.Provider value={{ id }}>
      <div
        data-slot="question"
        className={cn("w-full space-y-2 transition-all duration-200", className)}
        {...props}
      >
        {children}
      </div>
    </QuestionScopeContext.Provider>
  )
}

export function QuestionOptions({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="question-options"
      className={cn("flex flex-col gap-2 py-1", className)}
      {...props}
    >
      {React.Children.map(children, (child, idx) => {
        if (React.isValidElement(child)) {
          const isOption = (child.type as any)?.name === "QuestionOption" || Boolean((child.props as any)?.value)
          if (!isOption) return child
          return React.cloneElement(child, {
            optionIndex: (child.props as { optionIndex?: number }).optionIndex ?? idx,
          } as Record<string, unknown>)
        }
        return child
      })}
    </div>
  )
}

export interface QuestionOptionProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string
  optionIndex?: number
  children: React.ReactNode
}

export function QuestionOption({
  value,
  optionIndex,
  className,
  onClick,
  children,
  ...props
}: QuestionOptionProps) {
  const { id } = useQuestionScope()
  const { items, answers, selectOption } = useQuestions()

  const q = items.find((item) => item.id === id)
  const isMulti = q?.type === "multiple"

  const ans = answers[id]
  const isSelected = isMulti
    ? ((ans as Array<{ value: string }>) || []).some((item) => item.value === value)
    : (ans as { value: string })?.value === value

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(e)
    selectOption(id, { value, label: children })
  }

  return (
    <button
      type="button"
      data-slot="question-option"
      role={isMulti ? "checkbox" : "radio"}
      aria-checked={isSelected}
      onClick={handleClick}
      className={cn(
        "group relative flex w-full items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl text-left border transition-all duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/50",
        isSelected
          ? "border-accent-500/60 bg-accent-500/15 shadow-[0_0_16px_var(--accent-soft)] text-white"
          : "border-white/[0.07] bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06] text-white/80 hover:text-white",
        className
      )}
      {...props}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {/* Selection indicator: Checkbox for multiple, badge or ring for single */}
        {isMulti ? (
          <div
            className={cn(
              "size-4 rounded-md border flex items-center justify-center shrink-0 transition-colors",
              isSelected
                ? "border-accent-500 bg-accent-600 text-white"
                : "border-white/30 bg-white/5 group-hover:border-white/50"
            )}
          >
            {isSelected && <Check className="size-3 stroke-[2.5]" />}
          </div>
        ) : (
          <div
            className={cn(
              "size-4 rounded-full border flex items-center justify-center shrink-0 transition-colors",
              isSelected
                ? "border-accent-500 bg-transparent"
                : "border-white/30 group-hover:border-white/50"
            )}
          >
            {isSelected && <div className="size-2 rounded-full bg-accent-500 shadow-[0_0_6px_var(--accent)]" />}
          </div>
        )}

        <span className="text-[13.5px] font-medium leading-relaxed truncate">{children}</span>
      </div>

      {/* Index badge */}
      {typeof optionIndex === "number" && (
        <span
          className={cn(
            "text-[10px] font-mono px-1.5 py-0.5 rounded-md border transition-colors shrink-0",
            isSelected
              ? "border-accent-500/40 bg-accent-500/10 text-accent-300"
              : "border-white/10 bg-white/[0.03] text-white/40 group-hover:text-white/60"
          )}
        >
          {optionIndex + 1}
        </span>
      )}
    </button>
  )
}

export function QuestionOther({
  placeholder = "Other...",
  className,
  onKeyDown,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  const { id } = useQuestionScope()
  const { items, answers, selectOption, otherInputs, setOtherInput } = useQuestions()

  const q = items.find((item) => item.id === id)
  const isMulti = q?.type === "multiple"

  const ans = answers[id]
  const isSelected = isMulti
    ? ((ans as Array<{ value: string }>) || []).some((item) => item.value === QUESTION_OTHER_VALUE)
    : (ans as { value: string })?.value === QUESTION_OTHER_VALUE

  const currentText = otherInputs[id] || ""

  const handleFocus = () => {
    if (!isSelected) {
      selectOption(id, { value: QUESTION_OTHER_VALUE, label: currentText || "Other" })
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setOtherInput(id, val)
    selectOption(id, { value: QUESTION_OTHER_VALUE, label: val || "Other" })
  }

  return (
    <div
      data-slot="question-other"
      className={cn(
        "group relative flex w-full items-center gap-3 px-3.5 py-2 rounded-xl border transition-all duration-200",
        isSelected
          ? "border-accent-500/60 bg-accent-500/10"
          : "border-white/[0.07] bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]",
        className
      )}
    >
      {isMulti ? (
        <div
          onClick={() => selectOption(id, { value: QUESTION_OTHER_VALUE, label: currentText || "Other" })}
          className={cn(
            "size-4 rounded-md border flex items-center justify-center shrink-0 cursor-pointer transition-colors",
            isSelected
              ? "border-accent-500 bg-accent-600 text-white"
              : "border-white/30 bg-white/5"
          )}
        >
          {isSelected && <Check className="size-3 stroke-[2.5]" />}
        </div>
      ) : (
        <div
          onClick={() => selectOption(id, { value: QUESTION_OTHER_VALUE, label: currentText || "Other" })}
          className={cn(
            "size-4 rounded-full border flex items-center justify-center shrink-0 cursor-pointer transition-colors",
            isSelected
              ? "border-accent-500 bg-transparent"
              : "border-white/30"
          )}
        >
          {isSelected && <div className="size-2 rounded-full bg-accent-500" />}
        </div>
      )}

      <input
        type="text"
        placeholder={placeholder}
        value={currentText}
        onFocus={handleFocus}
        onChange={handleChange}
        onKeyDown={onKeyDown}
        className="w-full bg-transparent text-[13px] text-white placeholder:text-white/30 focus:outline-none"
        {...props}
      />
    </div>
  )
}

export function QuestionsFooter({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="questions-footer"
      className={cn("flex items-center justify-between gap-3 pt-3 mt-3 border-t border-white/[0.08]", className)}
      {...props}
    >
      {children}
    </div>
  )
}

export function QuestionsSkip({
  disabled,
  className,
  onClick,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { skip, activeQuestion, isAnswered } = useQuestions()
  const isRequired = Boolean(activeQuestion?.required)
  const isDisabled = disabled ?? isRequired

  return (
    <button
      type="button"
      data-slot="questions-skip"
      disabled={isDisabled}
      onClick={(e) => {
        onClick?.(e)
        skip()
      }}
      className={cn(
        "text-xs font-medium text-white/50 hover:text-white/90 px-3 py-1.5 rounded-lg hover:bg-white/[0.06] transition-colors disabled:opacity-30 disabled:pointer-events-none focus:outline-none",
        className
      )}
      {...props}
    >
      {children ?? "Skip"}
    </button>
  )
}

export interface QuestionsSubmitProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  showOnLastQuestion?: boolean
  disableUntilLastQuestion?: boolean
}

export function QuestionsSubmit({
  showOnLastQuestion = false,
  disableUntilLastQuestion = false,
  disabled,
  className,
  onClick,
  children,
  ...props
}: QuestionsSubmitProps) {
  const { submit, canSubmit, index, items, next } = useQuestions()
  const isLast = index >= items.length - 1

  if (showOnLastQuestion && !isLast) {
    return null
  }

  const isLocked = disableUntilLastQuestion ? !isLast || !canSubmit : !canSubmit
  const isDisabled = disabled ?? isLocked

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(e)
    if (isLast) {
      submit()
    } else {
      next()
    }
  }

  return (
    <button
      type="button"
      data-slot="questions-submit"
      disabled={isDisabled}
      onClick={handleClick}
      className={cn(
        "inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-semibold uppercase tracking-wider transition-all duration-200 shadow-md",
        "bg-accent-600 hover:bg-accent-500 text-white",
        "disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none",
        "active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500",
        className
      )}
      {...props}
    >
      <span>{children ?? (isLast ? "Send answer" : "Next")}</span>
      <CornerDownLeft className="size-3 opacity-70" />
    </button>
  )
}
