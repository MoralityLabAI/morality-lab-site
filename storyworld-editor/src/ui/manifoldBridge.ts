import { Storyworld } from '../Storyworld';
import { StoryworldSerializer } from '../StoryworldSerializer';

let manifoldWindow: Window | null = null;
let lastPayload: string | null = null;
let lastData: unknown | null = null;
let lastVersion: string | null = null;
let sendTimer: number | null = null;

const manifoldUrl = '/manifold.html';

const postToManifold = (data: unknown, version: string) => {
  if (!manifoldWindow || manifoldWindow.closed) return;
  manifoldWindow.postMessage({ type: 'storyworld:update', version, data }, '*');
};

export const openManifoldWindow = (): Window | null => {
  if (!manifoldWindow || manifoldWindow.closed) {
    manifoldWindow = window.open(manifoldUrl, 'sweepweave-manifold', 'width=1200,height=900');
  }
  if (manifoldWindow) {
    manifoldWindow.focus();
  }
  return manifoldWindow;
};

export const sendStoryworldToManifold = (storyworld: Storyworld) => {
  if (!manifoldWindow || manifoldWindow.closed) return;
  const version = storyworld.sweepweave_version ?? 'unknown';
  const data = StoryworldSerializer.to_project_dict(storyworld);
  lastData = data;
  lastVersion = version;
  const payload = JSON.stringify({ version, data });
  if (payload === lastPayload) return;
  lastPayload = payload;
  if (sendTimer) window.clearTimeout(sendTimer);
  sendTimer = window.setTimeout(() => {
    postToManifold(data, version);
  }, 200);
};

export const attachManifoldListener = (
  onSelectEncounter: (id: string) => void,
  getStoryworld: () => Storyworld
) => {
  window.addEventListener('message', (event) => {
    if (!event.data) return;
    if (event.data.type === 'manifold:selectEncounter') {
      if (typeof event.data.id === 'string') {
        onSelectEncounter(event.data.id);
      }
      return;
    }
    if (event.data.type === 'manifold:requestStoryworld') {
      sendStoryworldToManifold(getStoryworld());
      return;
    }
    if (event.data.type === 'manifold:ready' && lastData && lastVersion) {
      postToManifold(lastData, lastVersion);
    }
  });
};
