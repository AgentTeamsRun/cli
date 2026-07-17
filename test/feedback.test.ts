import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import axios from 'axios';
import { executeFeedbackCommand } from '../src/commands/feedback.js';

describe('feedback command', () => {
  const apiUrl = 'http://localhost:3001';
  const headers = { 'X-API-Key': 'key_test123', 'Content-Type': 'application/json' };

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('returns the created feedback response including its id', async () => {
    const response = {
      data: {
        id: 'feedback-1',
        category: 'UX',
        submitterType: 'AI',
        title: 'Output contract',
        content: 'Return the created feedback id.',
      },
    };
    const postSpy = jest.spyOn(axios, 'post').mockResolvedValueOnce({ data: response } as never);

    const result = await executeFeedbackCommand(apiUrl, headers, 'create', {
      category: 'ux',
      title: ' Output contract ',
      content: ' Return the created feedback id. ',
    });

    expect(postSpy).toHaveBeenCalledWith(
      'http://localhost:3001/api/feedbacks',
      {
        category: 'UX',
        submitterType: 'AI',
        title: 'Output contract',
        content: 'Return the created feedback id.',
      },
      { headers },
    );
    expect(result).toEqual({ message: '✔ Feedback submitted.', ...response });
    expect(JSON.parse(JSON.stringify(result))).toHaveProperty('data.id', 'feedback-1');
  });
});
