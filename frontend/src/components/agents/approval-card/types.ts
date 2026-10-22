import type { ReactNode } from "react";

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

export type ApprovalCardStatus =
  | 'pending'
  | 'submitting'
  | 'approved'
  | 'rejected'
  | 'changes-requested'
  | 'discarded'
  | 'answered';

export type ApprovalCardProps = {
  mode?: 'questions' | 'plan' | 'review';
  className?: string;
  disabled?: boolean;
  children?: ReactNode;

  // Review & Approve mode (choicescard.md spec)
  title?: ReactNode;
  description?: ReactNode;
  status?: ApprovalCardStatus;
  risk?: 'low' | 'medium' | 'high' | 'critical';
  category?: string;
  result?: ReactNode;
  approveLabel?: ReactNode;
  rejectLabel?: ReactNode;
  requestChangesLabel?: ReactNode;
  onApprove?: () => void | Promise<void>;
  onReject?: () => void | Promise<void>;
  onRequestChanges?: (feedback?: string) => void | Promise<void>;
  onDismiss?: () => void;

  // Questions mode
  questions?: ApprovalCardQuestion[];
  settledAnswers?: string[];
  onSubmitQuestions?: (formattedAnswers: string[]) => void | Promise<void>;
  onDismissQuestions?: () => void;

  // Plan review mode
  planId?: string;
  summary?: string;
  steps?: ApprovalCardPlanStep[];
  settledStatus?: 'approved' | 'discarded' | null;
  onApprovePlan?: () => void | Promise<void>;
  onDiscardPlan?: () => void | Promise<void>;
  onEditPlanStep?: (stepIndex: number, newTitle: string) => void;
};
