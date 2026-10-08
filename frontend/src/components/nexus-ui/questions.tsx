"use client";

import * as React from "react";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  Edit03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel";
import { cn } from "@/lib/utils";

export type QuestionType = "single" | "multiple";

export type QuestionOptionInput = {
  value: string;
  label: React.ReactNode;
  description?: React.ReactNode;
};

export type QuestionInput = {
  id: string;
  type: QuestionType;
  prompt: React.ReactNode;
  header?: string;
  options: QuestionOptionInput[];
  required?: boolean;
};

export const QUESTION_OTHER_VALUE = "__other__";
export const QUESTION_NO_PREFERENCE_VALUE = "__no_preference__";
export const QUESTION_NO_PREFERENCE_LABEL = "[No Preference]";

export type RegisteredQuestion = {
  id: string;
  type: QuestionType;
  prompt: React.ReactNode;
  header?: string;
  required?: boolean;
  index: number;
  options?: QuestionOptionInput[];
};

type QuestionScope = {
  id: string;
  type: QuestionType;
};

export type QuestionSubmissionAnswer = {
  value: string;
  label: React.ReactNode;
};

const NO_PREFERENCE_ANSWER: QuestionSubmissionAnswer = {
  value: QUESTION_NO_PREFERENCE_VALUE,
  label: QUESTION_NO_PREFERENCE_LABEL,
};

export type SingleQuestionAnswerState = {
  type: "single";
  value: string;
  other?: string;
};

export type MultipleQuestionAnswerState = {
  type: "multiple";
  value: string[];
  other?: string;
};

export type QuestionAnswerState =
  | SingleQuestionAnswerState
  | MultipleQuestionAnswerState;

export type QuestionsSubmission = Array<
  | {
      questionId: string;
      prompt: React.ReactNode;
      type: "single";
      status: "answered";
      answer: QuestionSubmissionAnswer;
    }
  | {
      questionId: string;
      prompt: React.ReactNode;
      type: "single";
      status: "skipped";
      answer: QuestionSubmissionAnswer;
    }
  | {
      questionId: string;
      prompt: React.ReactNode;
      type: "multiple";
      status: "answered";
      answer: QuestionSubmissionAnswer[];
    }
  | {
      questionId: string;
      prompt: React.ReactNode;
      type: "multiple";
      status: "skipped";
      answer: QuestionSubmissionAnswer[];
    }
>;

function isQuestionAnswered(
  question: RegisteredQuestion,
  answer: QuestionAnswerState | undefined,
): boolean {
  if (!answer || answer.type !== question.type) return false;

  if (question.type === "single") {
    if (answer.value === QUESTION_OTHER_VALUE) {
      return Boolean(answer.other?.trim());
    }
    return Boolean(answer.value);
  }

  return answer.value.length > 0 || Boolean(answer.other?.trim());
}

function isBlockedByRequired(
  question: RegisteredQuestion | undefined,
  answers: Record<string, QuestionAnswerState>,
): boolean {
  return Boolean(
    question?.required && !isQuestionAnswered(question, answers[question.id]),
  );
}

function isOtherAnswer(
  answer: QuestionAnswerState | undefined,
  type: QuestionType,
): boolean {
  if (!answer || answer.type !== type) return false;
  if (type === "single") return answer.value === QUESTION_OTHER_VALUE;
  return (
    answer.value.includes(QUESTION_OTHER_VALUE) || Boolean(answer.other?.trim())
  );
}

function canSubmitQuestions(
  questions: RegisteredQuestion[],
  answers: Record<string, QuestionAnswerState>,
): boolean {
  if (questions.length === 0) return false;
  return !questions.some(
    (question) =>
      question.required && !isQuestionAnswered(question, answers[question.id]),
  );
}

function optionLabel(
  question: RegisteredQuestion,
  value: string,
  other?: string,
): React.ReactNode {
  if (value === QUESTION_OTHER_VALUE) {
    return other?.trim() || "Other";
  }
  return question.options?.find((option) => option.value === value)?.label ?? value;
}

function skippedSubmission(
  question: RegisteredQuestion,
): QuestionsSubmission[number] {
  return question.type === "single"
    ? {
        questionId: question.id,
        prompt: question.prompt,
        type: "single",
        status: "skipped",
        answer: NO_PREFERENCE_ANSWER,
      }
    : {
        questionId: question.id,
        prompt: question.prompt,
        type: "multiple",
        status: "skipped",
        answer: [NO_PREFERENCE_ANSWER],
      };
}

function buildSubmission(
  questions: RegisteredQuestion[],
  answers: Record<string, QuestionAnswerState>,
): QuestionsSubmission {
  return questions.map((question) => {
    const answer = answers[question.id];
    if (!isQuestionAnswered(question, answer)) {
      return skippedSubmission(question);
    }

    if (question.type === "single" && answer?.type === "single") {
      return {
        questionId: question.id,
        prompt: question.prompt,
        type: "single",
        status: "answered",
        answer: {
          value: answer.value,
          label: optionLabel(question, answer.value, answer.other),
        },
      };
    }

    if (question.type === "multiple" && answer?.type === "multiple") {
      const submissionAnswers = answer.value.map((value) => ({
        value,
        label: optionLabel(question, value, answer.other),
      }));

      if (answer.other?.trim() && !answer.value.includes(QUESTION_OTHER_VALUE)) {
        submissionAnswers.push({
          value: QUESTION_OTHER_VALUE,
          label: answer.other.trim(),
        });
      }

      return {
        questionId: question.id,
        prompt: question.prompt,
        type: "multiple",
        status: "answered",
        answer: submissionAnswers,
      };
    }

    return skippedSubmission(question);
  });
}

function createQuestionsFromItems(items: QuestionInput[]): RegisteredQuestion[] {
  return items.map((item, index) => ({
    id: item.id,
    type: item.type,
    prompt: item.prompt,
    header: item.header,
    required: item.required ?? false,
    index,
    options: item.options,
  }));
}

type QuestionsRootContextValue = {
  questions: RegisteredQuestion[];
  index: number;
  answers: Record<string, QuestionAnswerState>;
  selectSingle: (
    questionId: string,
    value: string,
    other?: string,
    options?: { autoAdvance?: boolean },
  ) => void;
  toggleMultiple: (questionId: string, value: string) => void;
  setMultipleOther: (questionId: string, other: string) => void;
  clearAnswer: (questionId: string) => void;
  skip: () => void;
  submit: () => void;
  goNext: () => void;
  goPrev: () => void;
  carouselApi: CarouselApi | null;
  setCarouselApi: (api: CarouselApi | undefined) => void;
  onDismiss?: () => void;
};

const QuestionsRootContext =
  React.createContext<QuestionsRootContextValue | null>(null);

const QuestionContext = React.createContext<QuestionScope | null>(null);

function useQuestionsRoot(component: string): QuestionsRootContextValue {
  const ctx = React.useContext(QuestionsRootContext);
  if (!ctx) {
    throw new Error(`${component} must be used within Questions`);
  }
  return ctx;
}

function useQuestion(component: string): QuestionScope {
  const ctx = React.useContext(QuestionContext);
  if (!ctx) {
    throw new Error(`${component} must be used within Question`);
  }
  return ctx;
}

export type QuestionsProps = Omit<React.ComponentProps<typeof Card>, "onSubmit"> & {
  items: QuestionInput[];
  autoAdvance?: boolean;
  onSubmit?: (submission: QuestionsSubmission) => void;
  onSkip?: (questionId: string) => void;
  onDismiss?: () => void;
};

function Questions({
  className,
  items,
  autoAdvance = true,
  onSubmit,
  onSkip,
  onDismiss,
  children,
  ...props
}: QuestionsProps) {
  const questions = React.useMemo(() => createQuestionsFromItems(items), [items]);
  const [index, setIndex] = React.useState(0);
  const [answers, setAnswers] = React.useState<Record<string, QuestionAnswerState>>(
    {},
  );
  const answersRef = React.useRef(answers);
  const [carouselApi, setCarouselApi] = React.useState<CarouselApi | null>(null);

  const questionCount = questions.length;
  const clampedIndex =
    questionCount === 0 ? 0 : Math.min(Math.max(0, index), questionCount - 1);

  const goToIndex = React.useCallback(
    (nextIndex: number) => {
      if (questionCount === 0) return;
      const target = Math.min(Math.max(0, nextIndex), questionCount - 1);
      setIndex(target);
      carouselApi?.scrollTo(target);
    },
    [carouselApi, questionCount],
  );

  const clearAnswer = React.useCallback((questionId: string) => {
    setAnswers((prev) => {
      if (!(questionId in prev)) return prev;
      const next = { ...prev };
      delete next[questionId];
      answersRef.current = next;
      return next;
    });
  }, []);

  const selectSingle = React.useCallback(
    (
      questionId: string,
      value: string,
      other?: string,
      options?: { autoAdvance?: boolean },
    ) => {
      setAnswers((prev) => {
        const next = {
          ...prev,
          [questionId]: {
            type: "single" as const,
            value,
            ...(other ? { other } : {}),
          },
        };
        answersRef.current = next;
        return next;
      });

      if (options?.autoAdvance === false || !autoAdvance) return;

      const questionIndex = questions.findIndex((q) => q.id === questionId);
      if (questionIndex < 0 || questionIndex >= questions.length - 1) return;
      goToIndex(questionIndex + 1);
    },
    [autoAdvance, goToIndex, questions],
  );

  const toggleMultiple = React.useCallback((questionId: string, value: string) => {
    setAnswers((prev) => {
      const existing = prev[questionId];
      const currentValues =
        existing?.type === "multiple" ? existing.value : [];
      const nextValues = currentValues.includes(value)
        ? currentValues.filter((item) => item !== value)
        : [...currentValues, value];

      return {
        ...prev,
        [questionId]: {
          type: "multiple",
          value: nextValues,
          ...(existing?.type === "multiple" && existing.other
            ? { other: existing.other }
            : {}),
        },
      };
    });
  }, []);

  const setMultipleOther = React.useCallback((questionId: string, other: string) => {
    setAnswers((prev) => {
      const existing = prev[questionId];
      const currentValues = existing?.type === "multiple" ? existing.value : [];

      return {
        ...prev,
        [questionId]: {
          type: "multiple",
          value: currentValues,
          other,
        },
      };
    });
  }, []);

  const goNext = React.useCallback(() => {
    const current = questions[clampedIndex];
    if (!current || isBlockedByRequired(current, answers)) return;
    if (clampedIndex < questionCount - 1) goToIndex(clampedIndex + 1);
  }, [answers, clampedIndex, goToIndex, questionCount, questions]);

  const goPrev = React.useCallback(() => {
    if (clampedIndex > 0) {
      goToIndex(clampedIndex - 1);
    }
  }, [clampedIndex, goToIndex]);

  const skip = React.useCallback(() => {
    const current = questions[clampedIndex];
    if (!current || clampedIndex >= questionCount - 1) return;
    if (isBlockedByRequired(current, answers)) return;
    onSkip?.(current.id);
    goToIndex(clampedIndex + 1);
  }, [answers, clampedIndex, goToIndex, onSkip, questionCount, questions]);

  const submit = React.useCallback(() => {
    if (!canSubmitQuestions(questions, answers)) return;

    onSubmit?.(buildSubmission(questions, answers));
    answersRef.current = {};
    setAnswers({});
    goToIndex(0);
  }, [answers, goToIndex, onSubmit, questions]);

  React.useEffect(() => {
    if (!carouselApi) return;

    const onSelect = () => {
      const newIndex = carouselApi.selectedScrollSnap();
      const oldIndex = carouselApi.previousScrollSnap();
      if (newIndex === oldIndex) return;

      const oldQuestion = questions[oldIndex];
      if (
        newIndex > oldIndex &&
        isBlockedByRequired(oldQuestion, answersRef.current)
      ) {
        carouselApi.scrollTo(oldIndex);
        return;
      }

      setIndex(newIndex);
    };

    carouselApi.on("select", onSelect);
    return () => {
      carouselApi.off("select", onSelect);
    };
  }, [carouselApi, questions]);

  React.useEffect(() => {
    if (!carouselApi) return;
    if (carouselApi.selectedScrollSnap() !== clampedIndex) {
      carouselApi.scrollTo(clampedIndex);
    }
  }, [carouselApi, clampedIndex]);

  const rootValue = React.useMemo<QuestionsRootContextValue>(
    () => ({
      questions,
      index: clampedIndex,
      answers,
      selectSingle,
      toggleMultiple,
      setMultipleOther,
      clearAnswer,
      skip,
      submit,
      goNext,
      goPrev,
      carouselApi,
      setCarouselApi: (api) => setCarouselApi(api ?? null),
      onDismiss,
    }),
    [
      answers,
      clampedIndex,
      carouselApi,
      clearAnswer,
      goNext,
      goPrev,
      onDismiss,
      questions,
      selectSingle,
      setMultipleOther,
      skip,
      submit,
      toggleMultiple,
    ],
  );

  return (
    <QuestionsRootContext.Provider value={rootValue}>
      <Card
        data-slot="questions"
        className={cn(
          "mx-auto w-full max-w-xl gap-0 rounded-2xl border border-border/80 bg-card text-card-foreground px-1 pt-4 pb-1 shadow-sm",
          className,
        )}
        {...props}
      >
        {children}
      </Card>
    </QuestionsRootContext.Provider>
  );
}

export type QuestionProps = {
  id: string;
  children?: React.ReactNode;
};

function Question({ id, children }: QuestionProps) {
  const { questions } = useQuestionsRoot("Question");
  const registered = questions.find((question) => question.id === id);

  if (!registered) {
    throw new Error(`Question "${id}" is not in Questions items`);
  }

  const scope = React.useMemo<QuestionScope>(
    () => ({ id: registered.id, type: registered.type }),
    [registered.id, registered.type],
  );

  return (
    <QuestionContext.Provider value={scope}>
      <CardContent data-slot="question" className="w-full p-2">
        {children}
      </CardContent>
    </QuestionContext.Provider>
  );
}

const questionOptionsListClassName = cn(
  "flex w-full flex-col",
  "[--question-options-gap:--spacing(0)] gap-[length:var(--question-options-gap)]",
  "[&>*:not(:last-child)]:relative",
  "[&>*:not(:last-child)]:after:pointer-events-none",
  "[&>*:not(:last-child)]:after:absolute",
  "[&>*:not(:last-child)]:after:top-[calc(100%+var(--question-options-gap)/2)]",
  "[&>*:not(:last-child)]:after:-translate-y-1/2",
  "[&>*:not(:last-child)]:after:right-2.5",
  "[&>*:not(:last-child)]:after:left-2.5",
  "[&>*:not(:last-child)]:after:z-10",
  "[&>*:not(:last-child)]:after:h-px",
  "[&>*:not(:last-child)]:after:bg-border/20",
  "[&>*:not(:last-child)]:after:content-['']",
);

const questionRowClassName =
  "group/row flex min-h-11 w-full items-center gap-2.5 rounded-lg bg-transparent px-2.5 py-1.5 text-left transition-all hover:bg-muted/70";

const questionOptionRowClassName = cn(questionRowClassName, "active:scale-99");

export type QuestionOptionsProps = React.HTMLAttributes<HTMLDivElement>;

function QuestionOptions({ className, children, ...props }: QuestionOptionsProps) {
  const question = useQuestion("QuestionOptions");

  return (
    <div
      data-slot="question-options"
      role={question.type === "single" ? "listbox" : "group"}
      className={cn(questionOptionsListClassName, className)}
      {...props}
    >
      {React.Children.map(children, (child, optionIndex) => {
        if (!React.isValidElement(child)) return child;
        if (child.type !== QuestionOption) return child;
        return React.cloneElement(
          child as React.ReactElement<{ optionIndex?: number }>,
          { optionIndex },
        );
      })}
    </div>
  );
}

export type QuestionOptionProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "value"
> & {
  value: string;
  optionIndex?: number;
  description?: React.ReactNode;
  children?: React.ReactNode;
};

function QuestionOption({
  value,
  optionIndex = 0,
  description,
  className,
  children,
  onClick,
  ...props
}: QuestionOptionProps) {
  const question = useQuestion("QuestionOption");
  const root = useQuestionsRoot("QuestionOption");
  const answer = root.answers[question.id];
  const displayIndex = optionIndex + 1;

  const isSelected =
    question.type === "single"
      ? answer?.type === "single" && answer.value === value
      : answer?.type === "multiple" && answer.value.includes(value);

  const handleSelect = () => {
    if (question.type === "single") {
      if (isSelected) {
        root.clearAnswer(question.id);
        return;
      }
      root.selectSingle(question.id, value);
      return;
    }
    root.toggleMultiple(question.id, value);
  };

  if (question.type === "multiple") {
    return (
      <label
        data-slot="question-option"
        data-selected={isSelected ? "true" : "false"}
        className={cn(
          questionOptionRowClassName,
          "cursor-pointer",
          isSelected && "bg-muted",
          className,
        )}
      >
        <Checkbox
          checked={isSelected}
          onCheckedChange={handleSelect}
          className="mx-1.25 size-4.5 shadow-none transition-colors group-hover/row:data-[state=unchecked]:border-ring/50 cursor-pointer"
        />
        <div className="flex min-w-0 flex-1 flex-col text-left" data-slot="question-option-text">
          <span
            data-slot="question-option-label"
            className={cn(
              "truncate text-sm text-foreground transition-all group-hover/row:text-primary",
              isSelected && "text-primary font-medium",
            )}
          >
            {children}
          </span>
          {description && (
            <span data-slot="question-option-desc" className="truncate text-xs text-muted-foreground mt-0.5">
              {description}
            </span>
          )}
        </div>
      </label>
    );
  }

  return (
    <button
      type="button"
      role="option"
      aria-selected={isSelected}
      data-selected={isSelected ? "true" : "false"}
      data-slot="question-option"
      className={cn(
        questionOptionRowClassName,
        "cursor-pointer",
        isSelected && "bg-muted",
        className,
      )}
      onClick={(event) => {
        onClick?.(event);
        handleSelect();
      }}
      {...props}
    >
      <span
        data-slot="question-option-badge"
        className={cn(
          "relative flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted/60 border border-border/40 transition-all group-hover/row:bg-accent/15 group-hover/row:border-accent/30",
          isSelected && "bg-accent text-accent-foreground border-accent font-semibold",
        )}
      >
        <span
          className={cn(
            "text-xs font-mono transition-all text-muted-foreground group-hover/row:text-foreground",
            isSelected && "text-accent-foreground font-semibold",
          )}
        >
          {displayIndex}
        </span>
      </span>
      <div className="flex min-w-0 flex-1 flex-col text-left" data-slot="question-option-text">
        <span
          data-slot="question-option-label"
          className={cn(
            "truncate text-sm text-foreground transition-all group-hover/row:text-primary",
            isSelected && "text-primary font-medium",
          )}
        >
          {children}
        </span>
        {description && (
          <span data-slot="question-option-desc" className="truncate text-xs text-muted-foreground mt-0.5">
            {description}
          </span>
        )}
      </div>
      <HugeiconsIcon
        icon={ArrowRight01Icon}
        strokeWidth={2.0}
        data-slot="question-option-arrow"
        className={cn(
          "size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100",
          isSelected && "opacity-100 text-accent",
        )}
      />
    </button>
  );
}

export type QuestionOtherProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange"
>;

function QuestionOther({
  className,
  placeholder = "Other...",
  onKeyDown,
  ...props
}: QuestionOtherProps) {
  const question = useQuestion("QuestionOther");
  const root = useQuestionsRoot("QuestionOther");
  const answer = root.answers[question.id];

  const otherValue =
    answer?.type === "single" || answer?.type === "multiple"
      ? (answer.other ?? "")
      : "";

  const isOtherSelected = isOtherAnswer(answer, question.type);

  const handleOtherToggle = () => {
    if (question.type === "single") {
      if (otherValue.trim()) {
        root.selectSingle(
          question.id,
          QUESTION_OTHER_VALUE,
          otherValue.trim(),
          { autoAdvance: false },
        );
      }
      return;
    }
    root.toggleMultiple(question.id, QUESTION_OTHER_VALUE);
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value;
    if (question.type === "single") {
      if (!next.trim()) {
        root.clearAnswer(question.id);
        return;
      }
      root.selectSingle(question.id, QUESTION_OTHER_VALUE, next, {
        autoAdvance: false,
      });
      return;
    }
    root.setMultipleOther(question.id, next);
    if (next.trim() && !isOtherSelected) {
      root.toggleMultiple(question.id, QUESTION_OTHER_VALUE);
    }
  };

  if (question.type === "multiple") {
    return (
      <label
        data-slot="question-other"
        className={cn(questionRowClassName, "cursor-text", className)}
      >
        <Checkbox
          checked={isOtherSelected}
          onCheckedChange={handleOtherToggle}
          className="mx-1.25 size-4.5 shadow-none transition-colors group-hover/row:data-[state=unchecked]:border-ring/50"
        />
        <input
          type="text"
          value={otherValue}
          placeholder={placeholder}
          onChange={handleChange}
          onKeyDown={onKeyDown}
          className="text-foreground h-full min-w-0 flex-1 truncate text-sm transition-all outline-none placeholder:text-muted-foreground/60 bg-transparent border-none focus:outline-none"
          {...props}
        />
      </label>
    );
  }

  return (
    <div
      data-slot="question-other"
      className={cn(
        questionRowClassName,
        "cursor-text",
        isOtherSelected && "bg-muted",
        className,
      )}
    >
      <span
        data-slot="question-other-badge"
        className={cn(
          "relative flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted/60 border border-border/40 transition-all group-hover/row:bg-accent/15 group-hover/row:border-accent/30",
          isOtherSelected && "bg-accent text-accent-foreground border-accent",
        )}
      >
        <HugeiconsIcon
          icon={Edit03Icon}
          strokeWidth={2.0}
          className={cn(
            "size-3.5 text-muted-foreground transition-all group-hover/row:text-foreground",
            isOtherSelected && "text-accent-foreground",
          )}
        />
      </span>
      <input
        type="text"
        data-slot="question-other-input"
        value={otherValue}
        placeholder={placeholder}
        onChange={handleChange}
        onKeyDown={onKeyDown}
        className={cn(
          "text-foreground h-full min-w-0 flex-1 truncate text-sm transition-all outline-none placeholder:text-muted-foreground/60 bg-transparent border-none focus:outline-none",
          isOtherSelected && "text-foreground font-medium",
        )}
        {...props}
      />
    </div>
  );
}

export type QuestionsTitleProps = React.ComponentProps<typeof CardTitle>;

function QuestionsTitle({ className, children, ...props }: QuestionsTitleProps) {
  const root = useQuestionsRoot("QuestionsTitle");
  const current = root.questions[root.index];

  return (
    <div className="flex flex-1 flex-col gap-1 min-w-0">
      {current?.header && (
        <span
          data-slot="questions-header-tag"
          className="inline-flex items-center gap-1.5 self-start text-[11px] font-medium tracking-wide uppercase text-muted-foreground"
        >
          <span className="size-1.5 rounded-full bg-accent" />
          {current.header}
        </span>
      )}
      <CardTitle
        data-slot="questions-title"
        className={cn("text-sm font-medium leading-snug text-foreground", className)}
        {...props}
      >
        {children ?? current?.prompt}
      </CardTitle>
    </div>
  );
}

export type QuestionsDismissProps = React.ComponentProps<typeof Button>;

function QuestionsDismiss({ className, onClick, ...props }: QuestionsDismissProps) {
  const root = useQuestionsRoot("QuestionsDismiss");

  return (
    <Button
      type="button"
      size="icon-xs"
      variant="ghost"
      data-slot="questions-dismiss"
      className={cn(
        "cursor-pointer rounded-full bg-transparent text-[13px] text-muted-foreground hover:bg-muted active:scale-97",
        className,
      )}
      onClick={(event) => {
        onClick?.(event);
        root.onDismiss?.();
      }}
      {...props}
    >
      <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2.0} className="size-3.5" />
    </Button>
  );
}

export type QuestionsHeaderProps = React.ComponentProps<typeof CardHeader>;

function QuestionsHeader({ className, ...props }: QuestionsHeaderProps) {
  return (
    <CardHeader
      data-slot="questions-header"
      className={cn(
        "flex w-full flex-row items-center justify-between gap-2.5 px-3 pt-1 pb-2",
        className,
      )}
      {...props}
    />
  );
}

export type QuestionsFooterProps = React.ComponentProps<typeof CardFooter>;

function QuestionsFooter({ className, ...props }: QuestionsFooterProps) {
  return (
    <CardFooter
      data-slot="questions-footer"
      className={cn(
        "flex items-center justify-end gap-2 border-none bg-transparent px-3 pt-1 pb-2",
        className,
      )}
      {...props}
    />
  );
}

export type QuestionsSkipProps = React.ComponentProps<typeof Button>;

function QuestionsSkip({ className, disabled, onClick, ...props }: QuestionsSkipProps) {
  const { questions, index, answers, skip } = useQuestionsRoot("QuestionsSkip");
  const current = questions[index];
  const canSkip =
    index < questions.length - 1 &&
    Boolean(current) &&
    !isBlockedByRequired(current, answers);

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      data-slot="questions-skip"
      disabled={disabled ?? !canSkip}
      className={cn(
        "text-muted-foreground hover:text-foreground active:scale-99 cursor-pointer",
        className,
      )}
      onClick={(event) => {
        onClick?.(event);
        skip();
      }}
      {...props}
    >
      Skip
    </Button>
  );
}

export type QuestionsSubmitProps = React.ComponentProps<typeof Button> & {
  showOnLastQuestion?: boolean;
  disableUntilLastQuestion?: boolean;
};

function QuestionsSubmit({
  className,
  disabled,
  onClick,
  children = "Submit",
  showOnLastQuestion = false,
  disableUntilLastQuestion = false,
  ...props
}: QuestionsSubmitProps) {
  const { questions, index, answers, submit } = useQuestionsRoot("QuestionsSubmit");
  const canSubmit = canSubmitQuestions(questions, answers);
  const onLastQuestion = index >= questions.length - 1;

  if (showOnLastQuestion && !onLastQuestion) {
    return null;
  }

  const isDisabled =
    disabled ??
    (!canSubmit || (disableUntilLastQuestion && !onLastQuestion));

  return (
    <Button
      type="button"
      variant="default"
      size="sm"
      data-slot="questions-submit"
      disabled={isDisabled}
      className={cn("active:scale-99 cursor-pointer font-medium", className)}
      onClick={(event) => {
        onClick?.(event);
        submit();
      }}
      {...props}
    >
      {children}
    </Button>
  );
}

function useCarouselViewportHeight(
  wrapRef: React.RefObject<HTMLDivElement | null>,
  carouselApi: CarouselApi | null,
  activeIndex: number,
) {
  React.useLayoutEffect(() => {
    const vp = wrapRef.current?.querySelector<HTMLElement>(
      "[data-slot=carousel-content]",
    );
    if (!vp) return;
    const clear = () => {
      vp.style.height = "";
      vp.style.transition = "";
    };
    if (!carouselApi) return clear();
    vp.style.transition = "height 300ms ease-out";
    const sync = () => {
      const h = carouselApi.slideNodes()[activeIndex]?.offsetHeight ?? 0;
      vp.style.height = h > 0 ? `${h}px` : "";
    };
    sync();
    const slide = carouselApi.slideNodes()[activeIndex];
    if (!slide) return clear;
    const ro = new ResizeObserver(sync);
    ro.observe(slide);
    return () => {
      ro.disconnect();
      clear();
    };
  }, [wrapRef, carouselApi, activeIndex]);
}

export type QuestionsCarouselProps = React.ComponentProps<typeof Carousel>;

function QuestionsCarousel({
  setApi: setApiProp,
  className,
  children,
  ...props
}: QuestionsCarouselProps) {
  const { setCarouselApi } = useQuestionsRoot("QuestionsCarousel");

  return (
    <Carousel
      data-slot="questions-carousel"
      className={className}
      setApi={(api) => {
        setCarouselApi(api);
        setApiProp?.(api);
      }}
      opts={{ watchDrag: false }}
      {...props}
    >
      {children}
    </Carousel>
  );
}

export type QuestionsCarouselContentProps = React.ComponentProps<
  typeof CarouselContent
>;

function QuestionsCarouselContent({
  className,
  ...props
}: QuestionsCarouselContentProps) {
  const root = useQuestionsRoot("QuestionsCarouselContent");
  const wrapRef = React.useRef<HTMLDivElement>(null);
  useCarouselViewportHeight(wrapRef, root.carouselApi, root.index);

  return (
    <div ref={wrapRef} className="contents">
      <CarouselContent
        data-slot="questions-carousel-content"
        className={className}
        {...props}
      />
    </div>
  );
}

export type QuestionsCarouselItemProps = React.ComponentProps<
  typeof CarouselItem
>;

function QuestionsCarouselItem({
  className,
  children,
  ...props
}: QuestionsCarouselItemProps) {
  return (
    <CarouselItem
      data-slot="questions-carousel-item"
      className={cn("w-full self-start p-0 pl-0", className)}
      {...props}
    >
      {children}
    </CarouselItem>
  );
}

export type QuestionsCarouselPaginationProps = React.HTMLAttributes<HTMLDivElement>;

function QuestionsCarouselPagination({
  className,
  ...props
}: QuestionsCarouselPaginationProps) {
  return (
    <div
      data-slot="questions-carousel-pagination"
      className={cn("flex items-center gap-0.5", className)}
      {...props}
    />
  );
}

const carouselNavClassName =
  "flex size-6 cursor-pointer items-center justify-center rounded-full text-muted-foreground outline-0 transition-all hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-97 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50";

export type QuestionsCarouselNavButtonProps =
  React.ButtonHTMLAttributes<HTMLButtonElement>;

function QuestionsCarouselPrev({
  className,
  children,
  ...props
}: QuestionsCarouselNavButtonProps) {
  const { index, goPrev } = useQuestionsRoot("QuestionsCarouselPrev");

  return (
    <button
      type="button"
      data-slot="questions-carousel-prev"
      disabled={index <= 0}
      className={cn(carouselNavClassName, className)}
      onClick={() => goPrev()}
      {...props}
    >
      {children ?? (
        <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} className="size-4" />
      )}
    </button>
  );
}

function QuestionsCarouselNext({
  className,
  children,
  ...props
}: QuestionsCarouselNavButtonProps) {
  const { questions, index, answers, goNext } =
    useQuestionsRoot("QuestionsCarouselNext");
  const current = questions[index];
  const canGoNext =
    index < questions.length - 1 &&
    Boolean(current) &&
    !isBlockedByRequired(current, answers);

  return (
    <button
      type="button"
      data-slot="questions-carousel-next"
      disabled={!canGoNext}
      className={cn(carouselNavClassName, className)}
      onClick={() => goNext()}
      {...props}
    >
      {children ?? (
        <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="size-4" />
      )}
    </button>
  );
}

export type QuestionsCarouselIndexProps = React.HTMLAttributes<HTMLSpanElement> & {
  format?: "of" | "slash";
};

function QuestionsCarouselIndex({
  className,
  format = "of",
  ...props
}: QuestionsCarouselIndexProps) {
  const { questions, index } = useQuestionsRoot("QuestionsCarouselIndex");
  const count = questions.length;
  const current = count === 0 ? 0 : index + 1;

  return (
    <span
      data-slot="questions-carousel-index"
      className={cn(
        "text-xs leading-none font-mono text-muted-foreground tabular-nums px-1",
        className,
      )}
      {...props}
    >
      {format === "slash" ? `${current}/${count}` : `${current} of ${count}`}
    </span>
  );
}

export {
  Questions,
  Question,
  QuestionOptions,
  QuestionOption,
  QuestionOther,
  QuestionsTitle,
  QuestionsDismiss,
  QuestionsHeader,
  QuestionsFooter,
  QuestionsSkip,
  QuestionsSubmit,
  QuestionsCarousel,
  QuestionsCarouselContent,
  QuestionsCarouselItem,
  QuestionsCarouselPagination,
  QuestionsCarouselPrev,
  QuestionsCarouselNext,
  QuestionsCarouselIndex,
};
