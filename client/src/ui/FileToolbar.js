// Topbar control cluster for local save/open — draw.io-style "File > Save
// As... / Open" but as two plain buttons, since that's the whole feature.
// A hidden <input type=file> drives Open (the only way to get a real file
// picker without extra permissions); Save just triggers a browser download.
export function mountFileToolbar(container, { onSave, onOpen }) {
  container.innerHTML = '';
  container.className = 'file-toolbar';

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'file-toolbar-button';
  saveButton.textContent = 'Save';
  saveButton.title = 'Save the project to a local file';
  saveButton.addEventListener('click', () => onSave());

  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'file-toolbar-button';
  openButton.textContent = 'Open';
  openButton.title = 'Open a project from a local file';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/json,.json';
  fileInput.hidden = true;
  openButton.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = ''; // allow picking the same file again later
    if (file) onOpen(file);
  });

  container.append(saveButton, openButton, fileInput);
}
