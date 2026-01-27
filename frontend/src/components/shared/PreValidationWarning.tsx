"use client";

import React from "react";
import { ValidationResult, ValidationState, ValidationSeverity } from "@/lib/validation/preValidation";

// ============================================================
// 单条警告组件
// ============================================================

interface ValidationItemProps {
  result: ValidationResult;
  locale?: string;
}

function ValidationItem({ result, locale = "zh" }: ValidationItemProps) {
  const isZh = locale.startsWith("zh");
  const message = isZh ? result.message : (result.messageEn || result.message);
  const suggestion = isZh ? result.suggestion : (result.suggestioEn || result.suggestion);

  const config = {
    error: {
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      bg: "bg-red-500/10 dark:bg-red-500/20",
      border: "border-red-500/30",
      icon_color: "text-red-500",
      text: "text-red-600 dark:text-red-400",
    },
    warning: {
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      ),
      bg: "bg-yellow-500/10 dark:bg-yellow-500/20",
      border: "border-yellow-500/30",
      icon_color: "text-yellow-500",
      text: "text-yellow-600 dark:text-yellow-400",
    },
    info: {
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      bg: "bg-blue-500/10 dark:bg-blue-500/20",
      border: "border-blue-500/30",
      icon_color: "text-blue-500",
      text: "text-blue-600 dark:text-blue-400",
    },
  };

  const style = config[result.severity];

  return (
    <div className={`flex items-start gap-2 px-3 py-2 rounded-lg border ${style.bg} ${style.border}`}>
      <span className={`flex-shrink-0 mt-0.5 ${style.icon_color}`}>
        {style.icon}
      </span>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${style.text}`}>
          {message}
        </p>
        {suggestion && (
          <p className={`text-xs mt-0.5 opacity-80 ${style.text}`}>
            {suggestion}
          </p>
        )}
      </div>
    </div>
  );
}

// ============================================================
// 主警告容器组件
// ============================================================

interface PreValidationWarningProps {
  validation: ValidationState;
  locale?: string;
  className?: string;
  showAll?: boolean;        // 是否显示所有警告（默认只显示错误和警告）
  maxItems?: number;        // 最多显示几条
}

export function PreValidationWarning({
  validation,
  locale = "zh",
  className = "",
  showAll = false,
  maxItems = 3,
}: PreValidationWarningProps) {
  // 过滤要显示的结果
  const itemsToShow = showAll
    ? validation.results
    : [...validation.errors, ...validation.warnings];

  if (itemsToShow.length === 0) {
    return null;
  }

  // 限制显示数量
  const displayItems = itemsToShow.slice(0, maxItems);
  const remaining = itemsToShow.length - maxItems;

  return (
    <div className={`space-y-2 ${className}`}>
      {displayItems.map((result) => (
        <ValidationItem key={result.id} result={result} locale={locale} />
      ))}
      {remaining > 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400 px-3">
          {locale.startsWith("zh")
            ? `还有 ${remaining} 条提示...`
            : `${remaining} more warning(s)...`}
        </p>
      )}
    </div>
  );
}

// ============================================================
// 内联警告组件（用于输入框下方）
// ============================================================

interface InlineValidationProps {
  results: ValidationResult[];
  locale?: string;
  className?: string;
}

export function InlineValidation({ results, locale = "zh", className = "" }: InlineValidationProps) {
  if (results.length === 0) return null;

  // 只显示最严重的一条
  const sorted = [...results].sort((a, b) => {
    const order: Record<ValidationSeverity, number> = { error: 0, warning: 1, info: 2 };
    return order[a.severity] - order[b.severity];
  });

  const result = sorted[0];
  const isZh = locale.startsWith("zh");
  const message = isZh ? result.message : (result.messageEn || result.message);

  const colorMap = {
    error: "text-red-500",
    warning: "text-yellow-500",
    info: "text-blue-500",
  };

  return (
    <p className={`text-xs mt-1 ${colorMap[result.severity]} ${className}`}>
      {message}
    </p>
  );
}

// ============================================================
// 提交按钮包装组件
// ============================================================

interface ValidatedButtonProps {
  validation: ValidationState;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
  loadingText?: string;
  isLoading?: boolean;
  locale?: string;
}

export function ValidatedButton({
  validation,
  onClick,
  children,
  className = "",
  loadingText,
  isLoading = false,
  locale = "zh",
}: ValidatedButtonProps) {
  const isDisabled = !validation.canSubmit || isLoading;

  // 获取禁用原因
  const disabledReason = validation.errors[0];
  const isZh = locale.startsWith("zh");

  return (
    <div className="w-full">
      <button
        onClick={onClick}
        disabled={isDisabled}
        className={`
          w-full py-3 rounded-xl font-semibold text-sm
          transition-all duration-200
          ${isDisabled
            ? "bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed"
            : className
          }
        `}
      >
        {isLoading ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            {loadingText || children}
          </span>
        ) : (
          children
        )}
      </button>

      {/* 禁用时显示原因 */}
      {isDisabled && disabledReason && !isLoading && (
        <p className="text-xs text-center mt-2 text-red-500">
          {isZh ? disabledReason.message : (disabledReason.messageEn || disabledReason.message)}
        </p>
      )}
    </div>
  );
}

// ============================================================
// Hook: 使用前置校验
// ============================================================

import { useMemo } from "react";
import { mergeValidations, ValidationResult as VR } from "@/lib/validation/preValidation";

export function usePreValidation(validators: (() => VR[])[]): ValidationState {
  return useMemo(() => {
    const allResults: VR[] = [];
    for (const validator of validators) {
      allResults.push(...validator());
    }
    return mergeValidations(allResults);
  }, [validators]);
}

export default PreValidationWarning;
