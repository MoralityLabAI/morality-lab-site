import { StoryworldIO } from './StoryworldIO';
import { Storyworld } from './Storyworld';

export function initializeStoryworldReader() {
    const storyworldInput = document.getElementById('storyworldInput') as HTMLTextAreaElement;
    const loadStoryworldBtn = document.getElementById('loadStoryworld') as HTMLButtonElement;
    const outputDiv = document.getElementById('output') as HTMLDivElement;

    if (!storyworldInput || !loadStoryworldBtn || !outputDiv) {
        console.error("Storyworld Reader UI elements not found.");
        return;
    }

    loadStoryworldBtn.addEventListener('click', () => {
        const jsonContent = storyworldInput.value;
        if (!jsonContent) {
            outputDiv.textContent = 'Please paste storyworld JSON into the textarea.';
            return;
        }

        const storyworld = new Storyworld();
        try {
            const success = StoryworldIO.load_into_storyworld(storyworld, jsonContent);

            if (success) {
                outputDiv.textContent = `Storyworld "${storyworld.storyworld_title}" by ${storyworld.storyworld_author} loaded successfully!`;
                console.log('Loaded Storyworld:', storyworld);
            } else {
                outputDiv.textContent = 'Failed to load storyworld. Check console for errors.';
            }
        } catch (e: any) {
            outputDiv.textContent = `An error occurred: ${e.message}`;
            console.error('Loading error:', e);
        }
    });
}