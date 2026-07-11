import { el } from '../dom';
import { Store } from '../store';

export function renderAIConsoleTab(_store: Store): HTMLElement {
  const container = el('div', { className: 'sw-panel sw-ai-console' });
  const form = el('div', { className: 'sw-form' });

  const codexPathInput = el('input', {
    attrs: { type: 'text', placeholder: 'codex (optional path override)' },
  }) as HTMLInputElement;
  const cwdInput = el('input', {
    attrs: { type: 'text', placeholder: 'Workspace folder (optional)' },
  }) as HTMLInputElement;
  const promptInput = el('textarea', { attrs: { rows: '6', placeholder: 'Enter Codex prompt…' } }) as HTMLTextAreaElement;
  const runButton = el('button', { text: 'Run' }) as HTMLButtonElement;
  const output = el('pre', { className: 'sw-ai-log' }) as HTMLPreElement;

  codexPathInput.value = localStorage.getItem('ai.codexPath') || '';
  cwdInput.value = localStorage.getItem('ai.cwd') || '';
  if (!cwdInput.value && window.ai?.getDefaultCwd) {
    window.ai.getDefaultCwd().then((value) => {
      if (!cwdInput.value) {
        cwdInput.value = value;
      }
    }).catch(() => {});
  }

  let activeRunId: string | null = null;

  const appendOutput = (text: string) => {
    output.textContent += text;
    output.scrollTop = output.scrollHeight;
  };

  runButton.addEventListener('click', async () => {
    const prompt = promptInput.value.trim();
    if (!prompt) return;
    output.textContent = '';
    localStorage.setItem('ai.codexPath', codexPathInput.value.trim());
    localStorage.setItem('ai.cwd', cwdInput.value.trim());

    if (!window.ai) {
      appendOutput('AI bridge not available. Run in Electron with preload.\n');
      return;
    }
    const runId = await window.ai.runCodex({
      prompt,
      cwd: cwdInput.value.trim() || undefined,
      codexPath: codexPathInput.value.trim() || undefined,
    });
    activeRunId = runId;
  });

  if (window.ai) {
    window.ai.onData((event) => {
      if (activeRunId && event.runId !== activeRunId) return;
      appendOutput(event.data);
    });
    window.ai.onDone((event) => {
      if (activeRunId && event.runId !== activeRunId) return;
      appendOutput(`\n[done] exit code: ${event.code}\n`);
    });
    window.ai.onError((event) => {
      if (activeRunId && event.runId !== activeRunId) return;
      appendOutput(`\n[error] ${event.message}\n`);
    });
  } else {
    appendOutput('AI bridge not available. Run in Electron with preload.\n');
  }

  form.append(
    el('label', { text: 'Codex Path' }),
    codexPathInput,
    el('label', { text: 'Workspace' }),
    cwdInput,
    el('label', { text: 'Prompt' }),
    promptInput,
    el('div', { className: 'sw-row' }, runButton)
  );

  container.append(form, output);
  return container;
}
