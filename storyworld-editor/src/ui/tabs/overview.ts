import { el } from '../dom';
import { Store, touchStoryworld } from '../store';

export function renderOverviewTab(store: Store): HTMLElement {
  const state = store.getState();
  const storyworld = state.storyworld;

  const container = el('div', { className: 'sw-panel sw-overview' });
  const form = el('div', { className: 'sw-form' });

  const titleInput = el('input', { attrs: { type: 'text', value: storyworld.storyworld_title } }) as HTMLInputElement;
  const authorInput = el('input', { attrs: { type: 'text', value: storyworld.storyworld_author } }) as HTMLInputElement;
  const aboutInput = el('textarea', { attrs: { rows: '4' } }) as HTMLTextAreaElement;
  aboutInput.value = storyworld.about_text;
  const metaInput = el('textarea', { attrs: { rows: '2' } }) as HTMLTextAreaElement;
  metaInput.value = storyworld.meta_description;
  const languageInput = el('input', { attrs: { type: 'text', value: storyworld.language } }) as HTMLInputElement;
  const ratingInput = el('input', { attrs: { type: 'text', value: storyworld.rating } }) as HTMLInputElement;
  const themeInput = el('input', { attrs: { type: 'text', value: storyworld.css_theme } }) as HTMLInputElement;
  const fontSizeInput = el('input', { attrs: { type: 'text', value: storyworld.font_size } }) as HTMLInputElement;

  titleInput.addEventListener('input', () => {
    storyworld.storyworld_title = titleInput.value;
    touchStoryworld(storyworld);
  });
  authorInput.addEventListener('input', () => {
    storyworld.storyworld_author = authorInput.value;
    touchStoryworld(storyworld);
  });
  aboutInput.addEventListener('input', () => {
    storyworld.about_text = aboutInput.value;
    touchStoryworld(storyworld);
  });
  metaInput.addEventListener('input', () => {
    storyworld.meta_description = metaInput.value;
    touchStoryworld(storyworld);
  });
  languageInput.addEventListener('input', () => {
    storyworld.language = languageInput.value;
    touchStoryworld(storyworld);
  });
  ratingInput.addEventListener('input', () => {
    storyworld.rating = ratingInput.value;
    touchStoryworld(storyworld);
  });
  themeInput.addEventListener('input', () => {
    storyworld.css_theme = themeInput.value;
    touchStoryworld(storyworld);
  });
  fontSizeInput.addEventListener('input', () => {
    storyworld.font_size = fontSizeInput.value;
    touchStoryworld(storyworld);
  });

  form.append(
    el('label', { text: 'Title' }),
    titleInput,
    el('label', { text: 'Author' }),
    authorInput,
    el('label', { text: 'About Text' }),
    aboutInput,
    el('label', { text: 'Meta Description' }),
    metaInput,
    el('label', { text: 'Language' }),
    languageInput,
    el('label', { text: 'Rating' }),
    ratingInput,
    el('label', { text: 'Default Interface Theme' }),
    themeInput,
    el('label', { text: 'Default Font Size' }),
    fontSizeInput
  );

  container.appendChild(form);
  return container;
}
