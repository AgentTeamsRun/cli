export type PlanPreviewHtmlSafetyResult =
  | { ok: true }
  | { ok: false; reasons: string[] };

const hasRemoteDependency = (html: string): boolean => {
  return /\b(?:src|href)\s*=\s*["']https?:\/\//i.test(html)
    || /@import\s+(?:url\()?["']?https?:\/\//i.test(html)
    || /url\(\s*["']?https?:\/\//i.test(html);
};

export const validatePlanPreviewHtmlSafety = (html: string): PlanPreviewHtmlSafetyResult => {
  const reasons: string[] = [];
  const trimmedHtml = typeof html === "string" ? html.trim() : "";
  const lowerHtml = trimmedHtml.toLowerCase();

  if (trimmedHtml.length === 0) {
    reasons.push("HTML content is empty");
  }
  if (/<script\b/i.test(trimmedHtml)) {
    reasons.push("script tags are not allowed");
  }
  if (/\son[a-z]+\s*=/i.test(trimmedHtml)) {
    reasons.push("inline event handlers are not allowed");
  }
  if (/<form\b/i.test(trimmedHtml)) {
    reasons.push("form elements are not allowed");
  }
  if (hasRemoteDependency(trimmedHtml)) {
    reasons.push("remote assets and CSS imports are not allowed");
  }
  if (!/:root\b/i.test(trimmedHtml)) {
    reasons.push("theme CSS must define :root tokens");
  }
  if (!/--text\b/i.test(trimmedHtml) || !/var\(\s*--text\s*\)/i.test(trimmedHtml)) {
    reasons.push("theme CSS must define and use --text via var(--text)");
  }
  if (
    !/@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)/i.test(trimmedHtml)
    && !/\[data-theme\s*=\s*["']?night["']?\]/i.test(trimmedHtml)
  ) {
    reasons.push("theme CSS must include a dark mode rule using prefers-color-scheme or [data-theme=\"night\"]");
  }
  if (!/body[^{]*\{[^}]*background(?:-color)?\s*:\s*transparent\b/is.test(lowerHtml)) {
    reasons.push("theme CSS must keep body background transparent");
  }

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
};
