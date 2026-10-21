export type ApprovalCardOption = {
  value: string;
  label: string;
  description?: string;
};

export type ApprovalCardQuestion = {
  id: string;
  header?: string;
  prompt: string;
  type?: 'single' | 'multiple';
  options?: ApprovalCardOption[];
  required?: boolean;
  allowCustom?: boolean;
};

export type ApprovalCardPlanStep = {
  title: string;
  detail?: string;
  tools?: string[];
};

export type ApprovalCardStatus = 'pending' | 'approved' | 'rejected' | 'discarded';

export type ApprovalCardProps = {
  mode?: 'questions' | 'plan';
  className?: string;
  disabled?: boolean;

  // Questions mode
  questions?: ApprovalCardQuestion[];
  settledAnswers?: string[];
  onSubmitQuestions?: (formattedAnswers: string[]) => void | Promise<void>;
  onDismissQuestions?: () => void;

  // Plan review mode
  planId?: string;
  title?: string;
  summary?: string;
  steps?: ApprovalCardPlanStep[];
  settledStatus?: 'approved' | 'discarded' | null;
  onApprovePlan?: () => void | Promise<void>;
  onDiscardPlan?: () => void | Promise<void>;
  onEditPlanStep?: (stepIndex: number, newTitle: string) => void;
  onRequestChanges?: (feedback: string) => void;
};
