import { createFeedback } from '../api/feedback.js';

const allowedFeedbackCategories = ['BUG', 'SUGGESTION', 'CONVENTION', 'UX'] as const;

const normalizeCategory = (value: string) => value.trim().toUpperCase();

const isAllowedCategory = (value: string): value is (typeof allowedFeedbackCategories)[number] => {
  return (allowedFeedbackCategories as readonly string[]).includes(value);
};

export async function executeFeedbackCommand(
  apiUrl: string,
  headers: Record<string, string>,
  action: string,
  options: Record<string, unknown>,
): Promise<unknown> {
  switch (action) {
    case 'create': {
      const categoryRaw = typeof options.category === 'string' ? options.category : '';
      const title = typeof options.title === 'string' ? options.title.trim() : '';
      const content = typeof options.content === 'string' ? options.content.trim() : '';

      if (categoryRaw.trim().length === 0) {
        throw new Error('--category is required for feedback create');
      }
      if (title.length === 0) {
        throw new Error('--title is required for feedback create');
      }
      if (content.length === 0) {
        throw new Error('--content is required for feedback create');
      }

      const category = normalizeCategory(categoryRaw);
      if (!isAllowedCategory(category)) {
        throw new Error(`--category must be one of: ${allowedFeedbackCategories.join(', ')}`);
      }

      const feedback = await createFeedback(apiUrl, headers, {
        category,
        submitterType: 'AI',
        title,
        content,
      });

      return {
        message: '✔ Feedback submitted.',
        ...feedback,
      };
    }
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}
