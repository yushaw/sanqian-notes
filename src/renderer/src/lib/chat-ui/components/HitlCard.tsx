/**
 * HITL (Human-in-the-Loop) Card Component
 *
 * Displays HITL prompts for user approval or input.
 * Designed to work in narrow width containers (like side panels).
 */

import { memo, useState, useEffect, useRef, type KeyboardEvent } from 'react';
import type { HitlInterruptData, HitlResponse, HitlRiskLevel } from '../core/types';

export interface HitlCardProps {
  /** Interrupt data from backend */
  interrupt: HitlInterruptData;
  /** Called when user approves (for approval_request) */
  onApprove?: (remember?: boolean) => void;
  /** Called when user rejects (for approval_request) */
  onReject?: (remember?: boolean) => void;
  /** Called when user submits input (for user_input_request) */
  onSubmit?: (response: HitlResponse) => void;
  /** Called when user cancels */
  onCancel?: () => void;
  /** Whether in dark mode */
  isDarkMode?: boolean;
  /** Custom strings for i18n */
  strings?: {
    approve?: string;
    reject?: string;
    submit?: string;
    cancel?: string;
    rememberChoice?: string;
    requiredField?: string;
    timeoutIn?: string;
    seconds?: string;
    executeTool?: string;
    toolLabel?: string;
    argsLabel?: string;
    defaultPrefix?: string;
    enterResponse?: string;
    approvalRequest?: string;
    inputRequest?: string;
  };
}

const defaultStrings = {
  approve: 'Approve',
  reject: 'Reject',
  submit: 'Submit',
  cancel: 'Cancel',
  rememberChoice: 'Remember this choice',
  requiredField: 'This field is required',
  timeoutIn: 'Timeout in',
  seconds: 's',
  executeTool: 'Execute',
  toolLabel: 'Tool',
  argsLabel: 'Args',
  defaultPrefix: 'Default',
  enterResponse: 'Enter your response...',
  approvalRequest: 'Approval Request',
  inputRequest: 'Input Request',
};

/** Risk level colors */
const riskColors: Record<HitlRiskLevel, { bg: string; border: string; text: string; icon: string }> = {
  low: {
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
    text: 'text-blue-700 dark:text-blue-300',
    icon: 'ℹ️',
  },
  medium: {
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    text: 'text-amber-700 dark:text-amber-300',
    icon: '⚠️',
  },
  high: {
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    text: 'text-red-700 dark:text-red-300',
    icon: '🚨',
  },
};

export const HitlCard = memo(function HitlCard({
  interrupt,
  onApprove,
  onReject,
  onSubmit,
  onCancel,
  isDarkMode = false,
  strings = {},
}: HitlCardProps) {
  const t = { ...defaultStrings, ...strings };
  const isApproval = interrupt.interrupt_type === 'approval_request';
  const isUserInput = interrupt.interrupt_type === 'user_input_request';

  // State for user input
  const [answer, setAnswer] = useState(interrupt.default || '');
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [isComposing, setIsComposing] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number | null>(interrupt.timeout ?? null);
  const [rememberChoice, setRememberChoice] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Risk level styling for approval requests
  const riskLevel = interrupt.risk_level || 'medium';
  const riskStyle = riskColors[riskLevel];

  // Auto-focus input
  useEffect(() => {
    if (isUserInput) {
      if (interrupt.options && interrupt.options.length > 0) {
        // Options mode - no auto focus needed
      } else {
        // Text input mode
        inputRef.current?.focus();
        textareaRef.current?.focus();
      }
    }
  }, [isUserInput, interrupt.options]);

  // Timeout countdown
  useEffect(() => {
    if (timeLeft === null || timeLeft <= 0) return;

    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev === null || prev <= 1) {
          clearInterval(timer);
          // Auto-timeout
          if (isUserInput && onSubmit) {
            onSubmit({ timed_out: true });
          } else if (onCancel) {
            onCancel();
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [timeLeft, isUserInput, onSubmit, onCancel]);

  // Handle option toggle
  const handleOptionToggle = (index: number) => {
    if (interrupt.multi_select) {
      setSelectedIndices(prev => (prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]));
    } else {
      setSelectedIndices([index]);
    }
  };

  // Handle submit
  const handleSubmit = () => {
    if (isApproval) {
      onApprove?.(rememberChoice);
    } else if (isUserInput) {
      const hasOptions = interrupt.options && interrupt.options.length > 0;
      if (hasOptions) {
        const selectedAnswers = selectedIndices.map(i => interrupt.options![i]).join(', ');
        onSubmit?.({
          answer: selectedAnswers,
          selected_indices: selectedIndices,
        });
      } else {
        if (interrupt.required && !answer.trim()) {
          inputRef.current?.focus();
          textareaRef.current?.focus();
          return;
        }
        onSubmit?.({ answer: answer || interrupt.default || '' });
      }
    }
  };

  // Handle cancel/reject
  const handleCancel = () => {
    if (isApproval) {
      onReject?.(rememberChoice);
    } else {
      onSubmit?.({ cancelled: true });
    }
  };

  // Handle keyboard
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  };

  // Base card styles
  const cardBg = isDarkMode ? 'bg-zinc-800' : 'bg-white';
  const cardBorder = isDarkMode ? 'border-zinc-700' : 'border-zinc-200';
  const textPrimary = isDarkMode ? 'text-zinc-100' : 'text-zinc-900';
  const textSecondary = isDarkMode ? 'text-zinc-400' : 'text-zinc-500';
  const inputBg = isDarkMode ? 'bg-zinc-900' : 'bg-zinc-50';
  const inputBorder = isDarkMode ? 'border-zinc-600' : 'border-zinc-300';

  return (
    <div
      className={`rounded-xl border ${cardBorder} ${cardBg} animate-in fade-in slide-in-from-bottom-2 p-3 shadow-sm duration-200`}
      role="dialog"
      aria-modal="true"
      aria-label={isApproval ? t.approvalRequest : t.inputRequest}>
      {/* Header with icon and timeout */}
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {isApproval ? (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${riskStyle.bg} ${riskStyle.border} ${riskStyle.text} border`}>
              <span>{riskStyle.icon}</span>
              <span className="capitalize">{riskLevel}</span>
            </span>
          ) : (
            <span className="text-lg">💬</span>
          )}
        </div>
        {timeLeft !== null && timeLeft > 0 && (
          <span className={`text-xs ${textSecondary} whitespace-nowrap`}>
            {t.timeoutIn} {timeLeft}
            {t.seconds}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="space-y-2">
        {/* Question/Reason */}
        <p className={`text-sm font-medium ${textPrimary} break-words`}>
          {isApproval ? interrupt.reason || `${t.executeTool} ${interrupt.tool}?` : interrupt.question}
        </p>

        {/* Context (for user input) */}
        {isUserInput && interrupt.context && (
          <div className={`text-xs ${textSecondary} rounded p-2 ${inputBg} break-words`}>{interrupt.context}</div>
        )}

        {/* Tool info (for approval) */}
        {isApproval && interrupt.tool && (
          <div className={`text-xs ${textSecondary} rounded p-2 ${inputBg} space-y-1`}>
            <div>
              <span className="font-medium">{t.toolLabel}:</span> {interrupt.tool}
            </div>
            {interrupt.args && Object.keys(interrupt.args).length > 0 && (
              <div className="break-all">
                <span className="font-medium">{t.argsLabel}:</span>{' '}
                <code className="text-[10px]">{JSON.stringify(interrupt.args, null, 0)}</code>
              </div>
            )}
          </div>
        )}

        {/* Options (for user input with options) */}
        {isUserInput && interrupt.options && interrupt.options.length > 0 && (
          <div className="space-y-1.5">
            {interrupt.options.map((option, index) => (
              <label
                key={index}
                className={`flex cursor-pointer items-center gap-2 rounded p-2 transition-colors ${
                  selectedIndices.includes(index)
                    ? isDarkMode
                      ? 'border-blue-500/50 bg-blue-500/20'
                      : 'border-blue-200 bg-blue-50'
                    : `${inputBg} border-transparent hover:border-zinc-300`
                } border`}>
                <input
                  type={interrupt.multi_select ? 'checkbox' : 'radio'}
                  name="hitl-options"
                  checked={selectedIndices.includes(index)}
                  onChange={() => handleOptionToggle(index)}
                  className="shrink-0"
                />
                <span className={`text-sm ${textPrimary} break-words`}>{option}</span>
              </label>
            ))}
          </div>
        )}

        {/* Text input (for user input without options) */}
        {isUserInput && (!interrupt.options || interrupt.options.length === 0) && (
          <div>
            <input
              ref={inputRef}
              type="text"
              value={answer}
              onChange={e => setAnswer(e.target.value)}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => setIsComposing(true)}
              onCompositionEnd={() => setIsComposing(false)}
              placeholder={interrupt.default ? `${t.defaultPrefix}: ${interrupt.default}` : t.enterResponse}
              className={`w-full rounded-lg border px-3 py-2 text-sm ${inputBorder} ${inputBg} ${textPrimary} placeholder:${textSecondary} focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40`}
            />
            {interrupt.required && !answer.trim() && <p className="mt-1 text-xs text-red-500">{t.requiredField}</p>}
          </div>
        )}

        {/* Remember choice (for approval) */}
        {isApproval && (
          <label
            className="flex cursor-pointer items-center gap-2 text-xs"
            style={{ color: isDarkMode ? '#a1a1aa' : '#71717a' }}>
            <input
              type="checkbox"
              checked={rememberChoice}
              onChange={e => setRememberChoice(e.target.checked)}
              className="shrink-0"
            />
            {t.rememberChoice}
          </label>
        )}
      </div>

      {/* Actions */}
      <div className="mt-3 flex gap-2">
        <button
          onClick={handleCancel}
          style={{ color: isDarkMode ? '#f4f4f5' : '#18181b' }}
          className="flex-1 rounded-lg border border-zinc-600 px-3 py-2 text-sm font-medium transition-colors hover:bg-zinc-700">
          {isApproval ? t.reject : t.cancel}
        </button>
        <button
          onClick={handleSubmit}
          disabled={
            isUserInput && interrupt.required && !answer.trim() && (!interrupt.options || selectedIndices.length === 0)
          }
          className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium ${
            isApproval && riskLevel === 'high' ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-500 hover:bg-blue-600'
          } text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40`}>
          {isApproval ? t.approve : t.submit}
        </button>
      </div>
    </div>
  );
});

export default HitlCard;
