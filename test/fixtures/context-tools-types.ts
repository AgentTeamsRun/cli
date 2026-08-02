import { omitDocumentEditorMirror } from '@agentteams/context-tools';

const envelope = omitDocumentEditorMirror({
  data: {
    id: 'document-1',
    body: '# Markdown body',
    bodyTiptap: '{"type":"doc","content":[]}',
    updatedAt: '2026-08-02T00:00:00.000Z',
  },
});

envelope.data.id satisfies string;
envelope.data.body satisfies string;
envelope.data.updatedAt satisfies string;
// @ts-expect-error MCP document payloads must not promise the removed editor mirror.
void envelope.data.bodyTiptap;

const flatDocument = omitDocumentEditorMirror({
  id: 'document-1',
  body: '# Markdown body',
  bodyTiptap: '{"type":"doc","content":[]}',
});

flatDocument.id satisfies string;
flatDocument.body satisfies string;
// @ts-expect-error Flat document payloads follow the same omission contract.
void flatDocument.bodyTiptap;

omitDocumentEditorMirror('unchanged') satisfies string;
